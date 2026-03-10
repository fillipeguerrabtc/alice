/**
 * LLM Gateway Service - Alice Enterprise Platform
 *
 * Ponto único de entrada para chamadas LLM. Resolve namespace/agente por rota,
 * aplica adaptador LoRA quando disponível, registra fallbacks em llm_fallback_logs
 * e encaminha para o GPU Manager.
 *
 * Plano Enterprise - Agentes Especializados por Namespace
 *
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 * Autor: Fillipe Guerra
 * Data: 11 de Fevereiro de 2026
 */

import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import compression from 'compression';
import crypto from 'node:crypto';
import { createLogger } from '@alice/logger';
import {
  resolveNamespaceByRoute,
  resolveLlmModelByScope,
  requestGpu,
  requestGpuStream,
  GpuServiceType,
  GpuRequestPriority,
  registerShutdownCallback,
  ShutdownPriority,
  getCorsConfig,
  requireInternalHmacAuth,
} from '@alice/shared-utils';
import {
  createCorrelationMiddleware,
  createSecurityMiddleware,
  createErrorHandler,
  createNotFoundHandler,
  asyncHandler,
  createAlicePrometheus,
} from '@alice/shared-utils';
import {
  getDatabase,
  schema,
  connectWithRetry,
  closeDatabasePool,
  eq,
  and,
  desc,
} from '@alice/database';

const { llmFallbackLogs, llmExecutionAudit, namespaces, agents } = schema;
import { z } from 'zod';
import {
  activatePromptTemplate,
  activateToolPolicy,
  createPromptTemplate,
  createToolPolicy,
  getPromptTemplateApprovalSchema,
  getPromptTemplateActivateSchema,
  getPromptTemplateCreateSchema,
  getPromptTemplateEvaluateSchema,
  getToolPolicyActivateSchema,
  getToolPolicyApprovalSchema,
  getToolPolicyCreateSchema,
  listToolPolicyApprovals,
  listPromptTemplateApprovals,
  listPromptTemplates,
  listToolPolicies,
  mergeGovernanceHints,
  parseGovernanceHints,
  recordPromptTemplateApproval,
  recordPromptTemplateEvaluation,
  recordToolPolicyApproval,
  resolveModelGovernance,
  resolveNamespaceProfileGovernanceDefaults,
  resolvePromptGovernance,
  resolveToolPolicyGovernance,
} from './governance.js';
import { resolveGovernanceActor } from './governance-auth.js';

const logger = createLogger('llm-gateway');

const PORT = parseInt(process.env.PORT || '3011', 10);
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || '';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DEFAULT_MODEL = process.env.DEFAULT_LLM_MODEL || 'Qwen2.5-7B-Instruct-AWQ';

if (!INTERNAL_API_SECRET && IS_PRODUCTION) {
  logger.error('INTERNAL_API_SECRET é obrigatório em produção para autenticação interna');
  process.exit(1);
}

const contextSchema = z.object({
  route: z.string().min(1),
  tenantId: z.string().uuid(),
  userId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  namespaceId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
});

const completeSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string(),
  })),
  config: z.object({
    model: z.string().optional(),
    temperature: z.number().optional(),
    maxTokens: z.number().optional(),
  }).optional(),
  context: contextSchema,
  /** Campos extras para o body do GPU (ex: response_format para structured output) */
  extraBody: z.record(z.unknown()).optional(),
  /** Opções de request (timeout ms, priority) para chamadas longas (ex: trading signals) */
  requestOptions: z.object({
    timeout: z.number().positive().optional(),
    priority: z.enum(['low', 'normal', 'high', 'critical']).optional(),
  }).optional(),
});

const streamSchema = completeSchema;

async function resolveModelWithAdapter(
  baseModel: string,
  ctx: { tenantId?: string; namespaceId?: string; agentId?: string }
): Promise<string> {
  try {
    return await resolveLlmModelByScope(baseModel, ctx, {
      cachePrefix: 'alice:llm-gateway:lora:active-adapter',
    });
  } catch (err) {
    logger.warn({ err, ctx }, 'Falha ao resolver LoRA adapter - usando modelo base');
    return baseModel;
  }
}

async function logFallback(params: {
  tenantId: string;
  userId?: string;
  rota: string;
  contextoInferido: string;
  serviceOrigem: string;
  chamada: string;
  motivoFallback: string;
  namespaceId?: string | null;
  agentId?: string | null;
  modeloBase: string;
  modeloResolvido: string;
  adapterEncontrado: boolean;
  mensagemPreview?: string;
}): Promise<void> {
  try {
    const db = getDatabase();
    await db.insert(llmFallbackLogs).values({
      tenantId: params.tenantId,
      userId: params.userId ?? null,
      rota: params.rota,
      contextoInferido: params.contextoInferido,
      serviceOrigem: params.serviceOrigem,
      chamada: params.chamada,
      motivoFallback: params.motivoFallback,
      namespaceId: params.namespaceId ?? null,
      agentId: params.agentId ?? null,
      modeloBase: params.modeloBase,
      modeloResolvido: params.modeloResolvido,
      adapterEncontrado: params.adapterEncontrado,
      mensagemPreview: params.mensagemPreview ?? null,
    });
  } catch (err) {
    logger.warn({ err, params }, 'Falha ao registrar fallback em llm_fallback_logs');
  }
}

function buildAuditFingerprint(payload: unknown): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex')
    .slice(0, 64);
}

function isStructuredOutputRequest(extraBody: Record<string, unknown> | undefined): boolean {
  if (!extraBody) return false;
  return Boolean(
    extraBody.response_format
    || extraBody.json_schema
    || extraBody.schema
    || extraBody.structured_output
  );
}

function sanitizeExtraBodyForGpu(extraBody: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!extraBody) return undefined;
  const filtered = Object.fromEntries(
    Object.entries(extraBody).filter(([key]) => !key.startsWith('alice_'))
  );
  return Object.keys(filtered).length > 0 ? filtered : undefined;
}

async function logExecutionAudit(params: {
  tenantId: string;
  userId?: string;
  namespaceId?: string | null;
  agentId?: string | null;
  conversationId?: string;
  route: string;
  operation: 'complete' | 'stream';
  modelName: string;
  adapterName?: string | null;
  structuredOutput: boolean;
  promptTemplateId?: string | null;
  promptVersion?: number | null;
  modelVersionId?: string | null;
  toolPolicyKey?: string | null;
  latencyMs: number;
  success: boolean;
  errorCode?: string | null;
  requestFingerprint: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const db = getDatabase();
    await db.insert(llmExecutionAudit).values({
      tenantId: params.tenantId,
      userId: params.userId ?? null,
      namespaceId: params.namespaceId ?? null,
      agentId: params.agentId ?? null,
      conversationId: params.conversationId ?? null,
      service: 'llm-gateway-service',
      operation: params.operation,
      route: params.route,
      modelName: params.modelName,
      modelVersionId: params.modelVersionId ?? null,
      promptTemplateId: params.promptTemplateId ?? null,
      promptVersion: params.promptVersion ?? null,
      adapterName: params.adapterName ?? null,
      structuredOutput: params.structuredOutput,
      toolPolicyKey: params.toolPolicyKey ?? null,
      requestFingerprint: params.requestFingerprint,
      latencyMs: params.latencyMs,
      success: params.success,
      errorCode: params.errorCode ?? null,
      metadata: params.metadata ?? {},
    });
  } catch (err) {
    logger.warn({ err, params }, 'Falha ao registrar llm_execution_audit');
  }
}

const app = express();
app.use(createCorrelationMiddleware({ serviceName: 'llm-gateway' }));
app.use(createSecurityMiddleware());
app.use(cors(getCorsConfig()));

const defaultCompressionFilter: (req: Request, res: Response) => boolean =
  typeof (compression as unknown as { filter?: (req: Request, res: Response) => boolean }).filter === 'function'
    ? (compression as unknown as { filter: (req: Request, res: Response) => boolean }).filter
    : () => true;

app.use(compression({
  filter: (req, res) => {
    const acceptHeader = req.headers.accept ?? '';
    if (typeof acceptHeader === 'string' && acceptHeader.includes('text/event-stream')) {
      return false;
    }
    if (req.path === '/api/llm/stream') {
      return false;
    }
    return defaultCompressionFilter(req, res);
  },
}));
app.use(express.json({ limit: '1mb' }));

// Prometheus: /metrics exposto antes do auth (scrape sem autenticação - rede interna)
const { metrics, metricsRouter, httpMetricsMiddleware } = createAlicePrometheus({
  serviceName: 'llm-gateway-service',
  collectDefaultMetrics: true,
});
app.use(metricsRouter);
app.use(httpMetricsMiddleware);

function requireInternalAuth(req: Request, res: Response, next: () => void): void {
  if (req.path === '/health' || req.path === '/live' || req.path === '/ready' || req.path === '/metrics') {
    return next();
  }

  const hasHmacHeaders = Boolean(
    req.headers['x-internal-signature']
    && req.headers['x-internal-timestamp']
    && req.headers['x-internal-user-id']
    && req.headers['x-internal-role']
  );
  if (hasHmacHeaders) {
    const hmacMiddleware = requireInternalHmacAuth();
    hmacMiddleware(req, res, next as NextFunction);
    return;
  }

  const secret = req.headers['x-internal-api-secret'] as string;
  if (!INTERNAL_API_SECRET && !IS_PRODUCTION) {
    return next();
  }
  if (!secret || secret !== INTERNAL_API_SECRET) {
    res.status(401).json({ error: 'Token de autenticação inválido ou ausente' });
    return;
  }
  logger.warn({ path: req.path }, 'Autenticação interna legada por segredo estático utilizada; migre para HMAC');
  next();
}
app.use(requireInternalAuth);

function resolveGovernanceActorFromRequest(req: Request, res: Response, providedActorUserId?: string | null): string | null {
  const resolution = resolveGovernanceActor({
    authenticatedUserId: req.user?.userId ?? null,
    authenticatedRole: req.user?.role ?? null,
    providedActorUserId: providedActorUserId ?? null,
  });

  if (!resolution.ok) {
    logger.warn(
      {
        path: req.path,
        method: req.method,
        userId: req.user?.userId ?? null,
        role: req.user?.role ?? null,
        reason: resolution.code,
      },
      'Bloqueio de mutação de governança por trust policy'
    );
    res.status(resolution.status).json({ error: resolution.code, message: resolution.message });
    return null;
  }

  return resolution.actorUserId;
}

function requireGovernanceMutationAuth(req: Request, res: Response, next: NextFunction): void {
  const actorUserId = resolveGovernanceActorFromRequest(req, res);
  if (!actorUserId) return;
  next();
}

const promptTemplateListQuerySchema = z.object({
  tenantId: z.string().uuid(),
  namespaceId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  promptKey: z.string().min(1).max(128).optional(),
  status: z.enum(['draft', 'active', 'deprecated', 'archived']).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

const promptTemplateApprovalListQuerySchema = z.object({
  tenantId: z.string().uuid(),
});

const toolPolicyListQuerySchema = z.object({
  tenantId: z.string().uuid(),
  namespaceId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  policyKey: z.string().min(1).max(120).optional(),
  status: z.enum(['draft', 'active', 'deprecated', 'archived']).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

const toolPolicyApprovalListQuerySchema = z.object({
  tenantId: z.string().uuid(),
});

app.get(
  '/api/llm/governance/prompt-templates',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = promptTemplateListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Query inválida', details: parsed.error.flatten() });
      return;
    }

    const rows = await listPromptTemplates(parsed.data);
    res.status(200).json({ templates: rows });
  })
);

app.post(
  '/api/llm/governance/prompt-templates',
  requireGovernanceMutationAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = getPromptTemplateCreateSchema().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Body inválido', details: parsed.error.flatten() });
      return;
    }

    const actorUserId = resolveGovernanceActorFromRequest(req, res, parsed.data.createdBy ?? null);
    if (!actorUserId) return;

    const created = await createPromptTemplate({
      ...parsed.data,
      createdBy: actorUserId,
    });
    res.status(201).json(created);
  })
);

app.post(
  '/api/llm/governance/prompt-templates/:templateId/evaluate',
  requireGovernanceMutationAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const parsedBody = getPromptTemplateEvaluateSchema().safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({ error: 'Body inválido', details: parsedBody.error.flatten() });
      return;
    }

    const templateId = req.params.templateId;
    if (!templateId) {
      res.status(400).json({ error: 'templateId obrigatório' });
      return;
    }

    const actorUserId = resolveGovernanceActorFromRequest(req, res, parsedBody.data.evaluatedBy ?? null);
    if (!actorUserId) return;

    try {
      const evaluation = await recordPromptTemplateEvaluation({
        templateId,
        ...parsedBody.data,
        evaluatedBy: actorUserId,
      });
      res.status(200).json(evaluation);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PROMPT_TEMPLATE_EVALUATION_UPDATE_FAILED';
      if (message === 'PROMPT_TEMPLATE_NOT_FOUND') {
        res.status(404).json({ error: message });
        return;
      }
      throw error;
    }
  })
);

app.post(
  '/api/llm/governance/prompt-templates/:templateId/approval',
  requireGovernanceMutationAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const parsedBody = getPromptTemplateApprovalSchema().safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({ error: 'Body inválido', details: parsedBody.error.flatten() });
      return;
    }

    const templateId = req.params.templateId;
    if (!templateId) {
      res.status(400).json({ error: 'templateId obrigatório' });
      return;
    }

    const actorUserId = resolveGovernanceActorFromRequest(req, res, parsedBody.data.approverUserId ?? null);
    if (!actorUserId) return;

    try {
      const summary = await recordPromptTemplateApproval({
        templateId,
        ...parsedBody.data,
        approverUserId: actorUserId,
      });
      res.status(200).json(summary);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PROMPT_TEMPLATE_APPROVAL_UPDATE_FAILED';
      if (message === 'PROMPT_TEMPLATE_NOT_FOUND') {
        res.status(404).json({ error: message });
        return;
      }
      throw error;
    }
  })
);

app.get(
  '/api/llm/governance/prompt-templates/:templateId/approvals',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = promptTemplateApprovalListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Query inválida', details: parsed.error.flatten() });
      return;
    }

    const templateId = req.params.templateId;
    if (!templateId) {
      res.status(400).json({ error: 'templateId obrigatório' });
      return;
    }

    try {
      const summary = await listPromptTemplateApprovals({
        tenantId: parsed.data.tenantId,
        templateId,
      });
      res.status(200).json(summary);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PROMPT_TEMPLATE_APPROVALS_LIST_FAILED';
      if (message === 'PROMPT_TEMPLATE_NOT_FOUND') {
        res.status(404).json({ error: message });
        return;
      }
      throw error;
    }
  })
);

app.post(
  '/api/llm/governance/prompt-templates/:templateId/activate',
  requireGovernanceMutationAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const parsedBody = getPromptTemplateActivateSchema().safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({ error: 'Body inválido', details: parsedBody.error.flatten() });
      return;
    }

    const templateId = req.params.templateId;
    if (!templateId) {
      res.status(400).json({ error: 'templateId obrigatório' });
      return;
    }

    const actorUserId = resolveGovernanceActorFromRequest(req, res, parsedBody.data.approvedBy ?? null);
    if (!actorUserId) return;

    try {
      const activated = await activatePromptTemplate({
        templateId,
        tenantId: parsedBody.data.tenantId,
        approvedBy: actorUserId,
      });
      res.status(200).json(activated);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PROMPT_TEMPLATE_ACTIVATE_FAILED';
      if (message === 'PROMPT_TEMPLATE_NOT_FOUND') {
        res.status(404).json({ error: message });
        return;
      }
      if (
        message === 'PROMPT_TEMPLATE_EVAL_NOT_PASSED'
        || message === 'PROMPT_TEMPLATE_APPROVER_REQUIRED'
        || message === 'PROMPT_TEMPLATE_DUAL_CONTROL_REQUIRED'
        || message === 'PROMPT_TEMPLATE_APPROVAL_THRESHOLD_NOT_MET'
      ) {
        res.status(409).json({ error: message });
        return;
      }
      throw error;
    }
  })
);

app.get(
  '/api/llm/governance/tool-policies',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = toolPolicyListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Query inválida', details: parsed.error.flatten() });
      return;
    }

    const rows = await listToolPolicies(parsed.data);
    res.status(200).json({ toolPolicies: rows });
  })
);

app.post(
  '/api/llm/governance/tool-policies',
  requireGovernanceMutationAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = getToolPolicyCreateSchema().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Body inválido', details: parsed.error.flatten() });
      return;
    }

    const actorUserId = resolveGovernanceActorFromRequest(req, res, parsed.data.createdBy ?? null);
    if (!actorUserId) return;

    const created = await createToolPolicy({
      ...parsed.data,
      createdBy: actorUserId,
    });
    res.status(201).json(created);
  })
);

app.post(
  '/api/llm/governance/tool-policies/:policyId/approval',
  requireGovernanceMutationAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const parsedBody = getToolPolicyApprovalSchema().safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({ error: 'Body inválido', details: parsedBody.error.flatten() });
      return;
    }

    const policyId = req.params.policyId;
    if (!policyId) {
      res.status(400).json({ error: 'policyId obrigatório' });
      return;
    }

    const actorUserId = resolveGovernanceActorFromRequest(req, res, parsedBody.data.approverUserId ?? null);
    if (!actorUserId) return;

    try {
      const summary = await recordToolPolicyApproval({
        policyId,
        ...parsedBody.data,
        approverUserId: actorUserId,
      });
      res.status(200).json(summary);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'TOOL_POLICY_APPROVAL_UPDATE_FAILED';
      if (message === 'TOOL_POLICY_NOT_FOUND') {
        res.status(404).json({ error: message });
        return;
      }
      throw error;
    }
  })
);

app.get(
  '/api/llm/governance/tool-policies/:policyId/approvals',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = toolPolicyApprovalListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Query inválida', details: parsed.error.flatten() });
      return;
    }

    const policyId = req.params.policyId;
    if (!policyId) {
      res.status(400).json({ error: 'policyId obrigatório' });
      return;
    }

    try {
      const summary = await listToolPolicyApprovals({
        tenantId: parsed.data.tenantId,
        policyId,
      });
      res.status(200).json(summary);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'TOOL_POLICY_APPROVALS_LIST_FAILED';
      if (message === 'TOOL_POLICY_NOT_FOUND') {
        res.status(404).json({ error: message });
        return;
      }
      throw error;
    }
  })
);

app.post(
  '/api/llm/governance/tool-policies/:policyId/activate',
  requireGovernanceMutationAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const parsedBody = getToolPolicyActivateSchema().safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({ error: 'Body inválido', details: parsedBody.error.flatten() });
      return;
    }

    const policyId = req.params.policyId;
    if (!policyId) {
      res.status(400).json({ error: 'policyId obrigatório' });
      return;
    }

    const actorUserId = resolveGovernanceActorFromRequest(req, res, parsedBody.data.approvedBy ?? null);
    if (!actorUserId) return;

    try {
      const activated = await activateToolPolicy({
        policyId,
        tenantId: parsedBody.data.tenantId,
        approvedBy: actorUserId,
      });
      res.status(200).json(activated);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'TOOL_POLICY_ACTIVATE_FAILED';
      if (message === 'TOOL_POLICY_NOT_FOUND') {
        res.status(404).json({ error: message });
        return;
      }
      if (
        message === 'TOOL_POLICY_APPROVER_REQUIRED'
        || message === 'TOOL_POLICY_DUAL_CONTROL_REQUIRED'
        || message === 'TOOL_POLICY_APPROVAL_THRESHOLD_NOT_MET'
      ) {
        res.status(409).json({ error: message });
        return;
      }
      throw error;
    }
  })
);

function getDb() {
  return getDatabase();
}

app.post(
  '/api/llm/complete',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = completeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Body inválido', details: parsed.error.flatten() });
      return;
    }
    const { messages, config, context, extraBody, requestOptions } = parsed.data;
    const requestStartedAt = Date.now();
    const structuredOutputRequested = isStructuredOutputRequest(extraBody);
    const requestGovernanceHints = parseGovernanceHints(extraBody);
    let promptTemplateId: string | null = requestGovernanceHints.promptTemplateId ?? null;
    let promptVersion: number | null = requestGovernanceHints.promptVersion ?? null;
    let toolPolicyKey: string | null = requestGovernanceHints.toolPolicyKey ?? null;
    let toolPolicyVersion: number | null = requestGovernanceHints.toolPolicyVersion ?? null;
    let modelVersionId: string | null = requestGovernanceHints.modelVersionId ?? null;
    let resolvedModelName: string | null = null;
    let allowedTools: string[] = [];
    let deniedTools: string[] = [];
    let requestFingerprint = '';
    const gpuExtraBody = sanitizeExtraBodyForGpu(extraBody);
    const temperature = config?.temperature ?? 0.7;
    const maxTokens = config?.maxTokens ?? 2048;
    let baseModel = config?.model ?? DEFAULT_MODEL;
    const isTradingRoute = context.route.startsWith('/trading');
    const scopeExplicitlyProvided = Boolean(context.namespaceId || context.agentId);
    let namespaceId = context.namespaceId ?? null;
    let agentId = context.agentId ?? null;
    let contextoInferido = 'default';

    if (!namespaceId && !agentId) {
      const db = getDb();
      const resolved = await resolveNamespaceByRoute(context.tenantId, context.route, {
        getNamespaceBySlug: async (tId, slug) => {
          const row = await db.query.namespaces.findFirst({
            where: and(
              eq(namespaces.tenantId, tId),
              eq(namespaces.slug, slug),
              eq(namespaces.ativo, true)
            ),
            columns: { id: true, tenantId: true, contextoSistema: true },
          });
          return row ?? null;
        },
        getNamespacesByTenant: async (tId) => {
          const rows = await db.query.namespaces.findMany({
            where: and(eq(namespaces.tenantId, tId), eq(namespaces.ativo, true)),
            columns: { id: true, slug: true, contextoSistema: true },
          });
          return rows;
        },
        getActiveAgentByNamespace: async (nsId) => {
          const row = await db.query.agents.findFirst({
            where: and(eq(agents.namespaceId, nsId), eq(agents.status, 'active')),
            orderBy: [desc(agents.atualizadoEm)],
            columns: { id: true },
          });
          return row ?? null;
        },
      });
      namespaceId = resolved.namespaceId;
      agentId = resolved.agentId;
      contextoInferido = resolved.context;
    }
    const useBaseModelForDefaultContext = !scopeExplicitlyProvided && contextoInferido === 'default';
    if (useBaseModelForDefaultContext) {
      namespaceId = null;
      agentId = null;
      logger.debug({ tenantId: context.tenantId, route: context.route }, 'Contexto default sem escopo explícito: usando modelo base sem adapter');
    }

    const namespaceProfileHints = await resolveNamespaceProfileGovernanceDefaults({
      tenantId: context.tenantId,
      namespaceId,
    });
    const governanceHints = mergeGovernanceHints(namespaceProfileHints, requestGovernanceHints);

    if (governanceHints.promptTemplateId) {
      try {
        const governance = await resolvePromptGovernance({
          tenantId: context.tenantId,
          namespaceId,
          agentId,
          hints: governanceHints,
        });
        promptTemplateId = governance.promptTemplateId;
        promptVersion = governance.promptVersion;
        toolPolicyKey = governance.toolPolicyKey;
      } catch (error) {
        const code = error instanceof Error ? error.message : 'PROMPT_TEMPLATE_INVALID';
        res.status(400).json({ error: code });
        return;
      }
    }

    try {
      const resolvedToolPolicy = await resolveToolPolicyGovernance({
        tenantId: context.tenantId,
        namespaceId,
        agentId,
        toolPolicyKey: toolPolicyKey ?? governanceHints.toolPolicyKey ?? null,
        toolPolicyVersion: toolPolicyVersion ?? governanceHints.toolPolicyVersion ?? null,
      });
      toolPolicyKey = resolvedToolPolicy.toolPolicyKey;
      toolPolicyVersion = resolvedToolPolicy.toolPolicyVersion;
      allowedTools = resolvedToolPolicy.allowTools;
      deniedTools = resolvedToolPolicy.denyTools;
    } catch (error) {
      const code = error instanceof Error ? error.message : 'TOOL_POLICY_INVALID';
      res.status(400).json({ error: code });
      return;
    }

    try {
      const resolvedModelGovernance = await resolveModelGovernance({
        tenantId: context.tenantId,
        namespaceId,
        agentId,
        hints: governanceHints,
        fallbackModel: baseModel,
      });
      modelVersionId = resolvedModelGovernance.modelVersionId;
      resolvedModelName = resolvedModelGovernance.modelName;
      baseModel = resolvedModelGovernance.baseModel;
    } catch (error) {
      const code = error instanceof Error ? error.message : 'MODEL_GOVERNANCE_INVALID';
      res.status(400).json({ error: code });
      return;
    }

    requestFingerprint = buildAuditFingerprint({
      route: context.route,
      tenantId: context.tenantId,
      namespaceId,
      agentId,
      promptTemplateId,
      promptVersion,
      modelVersionId,
      toolPolicyKey,
      toolPolicyVersion,
      lastUserMessage: messages[messages.length - 1]?.content ?? '',
    });
    if (isTradingRoute && (!namespaceId || !agentId)) {
      metrics.llm.fallbacksTotal.inc();
      await logFallback({
        tenantId: context.tenantId,
        userId: context.userId,
        rota: context.route,
        contextoInferido,
        serviceOrigem: 'llm-gateway-service',
        chamada: '/api/llm/complete',
        motivoFallback: 'namespace_unmapped',
        namespaceId,
        agentId,
        modeloBase: baseModel,
        modeloResolvido: baseModel,
        adapterEncontrado: false,
        mensagemPreview: messages[messages.length - 1]?.content?.slice(0, 200),
      });
      res.status(412).json({ error: 'TRADING_SCOPE_REQUIRED: namespace e agente de Trading ativos são obrigatórios.' });
      return;
    }

    const model = await resolveModelWithAdapter(baseModel, {
      tenantId: context.tenantId,
      namespaceId: namespaceId ?? undefined,
      agentId: agentId ?? undefined,
    });
    if (isTradingRoute && model === baseModel) {
      metrics.llm.fallbacksTotal.inc();
      await logFallback({
        tenantId: context.tenantId,
        userId: context.userId,
        rota: context.route,
        contextoInferido,
        serviceOrigem: 'llm-gateway-service',
        chamada: '/api/llm/complete',
        motivoFallback: 'adapter_missing',
        namespaceId,
        agentId,
        modeloBase: baseModel,
        modeloResolvido: model,
        adapterEncontrado: false,
        mensagemPreview: messages[messages.length - 1]?.content?.slice(0, 200),
      });
      res.status(412).json({ error: 'TRADING_SCOPE_REQUIRED: adapter LoRA ativo obrigatório para Trading.' });
      return;
    }
    const adapterEncontrado = model !== baseModel;
    const motivoFallback = !adapterEncontrado && !useBaseModelForDefaultContext
      ? (!namespaceId && !agentId ? 'namespace_unmapped' : 'adapter_missing')
      : null;
    if (motivoFallback) {
      metrics.llm.fallbacksTotal.inc();
      await logFallback({
        tenantId: context.tenantId,
        userId: context.userId,
        rota: context.route,
        contextoInferido,
        serviceOrigem: 'llm-gateway-service',
        chamada: '/api/llm/complete',
        motivoFallback,
        namespaceId,
        agentId,
        modeloBase: baseModel,
        modeloResolvido: model,
        adapterEncontrado,
        mensagemPreview: messages[messages.length - 1]?.content?.slice(0, 200),
      });
    }

    const baseBody = {
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
      stream: false,
    };
    const body = gpuExtraBody ? { ...baseBody, ...gpuExtraBody } : baseBody;

    const priorityMap: Record<string, GpuRequestPriority> = {
      low: GpuRequestPriority.LOW,
      normal: GpuRequestPriority.MEDIUM,
      high: GpuRequestPriority.HIGH,
      critical: GpuRequestPriority.CRITICAL,
    };
    const inferenceStart = process.hrtime.bigint();
    const gpuResponse = await requestGpu({
      serviceType: GpuServiceType.LLM,
      endpoint: '/v1/chat/completions',
      method: 'POST',
      priority: requestOptions?.priority ? priorityMap[requestOptions.priority] ?? GpuRequestPriority.CRITICAL : GpuRequestPriority.CRITICAL,
      timeout: requestOptions?.timeout ?? 60000,
      body,
    });

    if (!gpuResponse.success || !gpuResponse.data) {
      await logExecutionAudit({
        tenantId: context.tenantId,
        userId: context.userId,
        namespaceId,
        agentId,
        conversationId: context.conversationId,
        route: context.route,
        operation: 'complete',
        modelName: model,
        adapterName: model !== baseModel ? model : null,
        structuredOutput: structuredOutputRequested,
        promptTemplateId,
        promptVersion,
        modelVersionId,
        toolPolicyKey,
        latencyMs: Date.now() - requestStartedAt,
        success: false,
        errorCode: 'gpu_manager_error',
        requestFingerprint,
        metadata: {
          modelName: resolvedModelName,
          toolPolicyVersion,
          allowedTools,
          deniedTools,
        },
      });
      res.status(502).json({ error: gpuResponse.error || 'Erro no GPU Manager' });
      return;
    }

    metrics.llm.inferenceDuration.observe(
      { model, type: 'complete' },
      Number(process.hrtime.bigint() - inferenceStart) / 1e9
    );
    await logExecutionAudit({
      tenantId: context.tenantId,
      userId: context.userId,
      namespaceId,
      agentId,
      conversationId: context.conversationId,
      route: context.route,
      operation: 'complete',
      modelName: model,
      adapterName: model !== baseModel ? model : null,
      structuredOutput: structuredOutputRequested,
      promptTemplateId,
      promptVersion,
      modelVersionId,
      toolPolicyKey,
      latencyMs: Date.now() - requestStartedAt,
      success: true,
      requestFingerprint,
      metadata: {
        modelName: resolvedModelName,
        toolPolicyVersion,
        allowedTools,
        deniedTools,
      },
    });
    res.status(200).json(gpuResponse.data);
  })
);

app.post(
  '/api/llm/stream',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = streamSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Body inválido', details: parsed.error.flatten() });
      return;
    }
    const { messages, config, context, extraBody } = parsed.data;
    const requestStartedAt = Date.now();
    const structuredOutputRequested = isStructuredOutputRequest(extraBody);
    const requestGovernanceHints = parseGovernanceHints(extraBody);
    let promptTemplateId: string | null = requestGovernanceHints.promptTemplateId ?? null;
    let promptVersion: number | null = requestGovernanceHints.promptVersion ?? null;
    let toolPolicyKey: string | null = requestGovernanceHints.toolPolicyKey ?? null;
    let toolPolicyVersion: number | null = requestGovernanceHints.toolPolicyVersion ?? null;
    let modelVersionId: string | null = requestGovernanceHints.modelVersionId ?? null;
    let resolvedModelName: string | null = null;
    let allowedTools: string[] = [];
    let deniedTools: string[] = [];
    let requestFingerprint = '';
    const gpuExtraBody = sanitizeExtraBodyForGpu(extraBody);
    const temperature = config?.temperature ?? 0.7;
    const maxTokens = config?.maxTokens ?? 2048;
    let baseModel = config?.model ?? DEFAULT_MODEL;
    const isTradingRoute = context.route.startsWith('/trading');
    const scopeExplicitlyProvided = Boolean(context.namespaceId || context.agentId);
    let namespaceId = context.namespaceId ?? null;
    let agentId = context.agentId ?? null;
    let contextoInferido = 'default';

    if (!namespaceId && !agentId) {
      const db = getDb();
      const resolved = await resolveNamespaceByRoute(context.tenantId, context.route, {
        getNamespaceBySlug: async (tId, slug) => {
          const row = await db.query.namespaces.findFirst({
            where: and(
              eq(namespaces.tenantId, tId),
              eq(namespaces.slug, slug),
              eq(namespaces.ativo, true)
            ),
            columns: { id: true, tenantId: true, contextoSistema: true },
          });
          return row ?? null;
        },
        getNamespacesByTenant: async (tId) => {
          const rows = await db.query.namespaces.findMany({
            where: and(eq(namespaces.tenantId, tId), eq(namespaces.ativo, true)),
            columns: { id: true, slug: true, contextoSistema: true },
          });
          return rows;
        },
        getActiveAgentByNamespace: async (nsId) => {
          const row = await db.query.agents.findFirst({
            where: and(eq(agents.namespaceId, nsId), eq(agents.status, 'active')),
            orderBy: [desc(agents.atualizadoEm)],
            columns: { id: true },
          });
          return row ?? null;
        },
      });
      namespaceId = resolved.namespaceId;
      agentId = resolved.agentId;
      contextoInferido = resolved.context;
    }
    const useBaseModelForDefaultContext = !scopeExplicitlyProvided && contextoInferido === 'default';
    if (useBaseModelForDefaultContext) {
      namespaceId = null;
      agentId = null;
      logger.debug({ tenantId: context.tenantId, route: context.route }, 'Contexto default sem escopo explícito: usando modelo base sem adapter');
    }

    const namespaceProfileHints = await resolveNamespaceProfileGovernanceDefaults({
      tenantId: context.tenantId,
      namespaceId,
    });
    const governanceHints = mergeGovernanceHints(namespaceProfileHints, requestGovernanceHints);

    if (governanceHints.promptTemplateId) {
      try {
        const governance = await resolvePromptGovernance({
          tenantId: context.tenantId,
          namespaceId,
          agentId,
          hints: governanceHints,
        });
        promptTemplateId = governance.promptTemplateId;
        promptVersion = governance.promptVersion;
        toolPolicyKey = governance.toolPolicyKey;
      } catch (error) {
        const code = error instanceof Error ? error.message : 'PROMPT_TEMPLATE_INVALID';
        res.status(400).json({ error: code });
        return;
      }
    }

    try {
      const resolvedToolPolicy = await resolveToolPolicyGovernance({
        tenantId: context.tenantId,
        namespaceId,
        agentId,
        toolPolicyKey: toolPolicyKey ?? governanceHints.toolPolicyKey ?? null,
        toolPolicyVersion: toolPolicyVersion ?? governanceHints.toolPolicyVersion ?? null,
      });
      toolPolicyKey = resolvedToolPolicy.toolPolicyKey;
      toolPolicyVersion = resolvedToolPolicy.toolPolicyVersion;
      allowedTools = resolvedToolPolicy.allowTools;
      deniedTools = resolvedToolPolicy.denyTools;
    } catch (error) {
      const code = error instanceof Error ? error.message : 'TOOL_POLICY_INVALID';
      res.status(400).json({ error: code });
      return;
    }

    try {
      const resolvedModelGovernance = await resolveModelGovernance({
        tenantId: context.tenantId,
        namespaceId,
        agentId,
        hints: governanceHints,
        fallbackModel: baseModel,
      });
      modelVersionId = resolvedModelGovernance.modelVersionId;
      resolvedModelName = resolvedModelGovernance.modelName;
      baseModel = resolvedModelGovernance.baseModel;
    } catch (error) {
      const code = error instanceof Error ? error.message : 'MODEL_GOVERNANCE_INVALID';
      res.status(400).json({ error: code });
      return;
    }

    requestFingerprint = buildAuditFingerprint({
      route: context.route,
      tenantId: context.tenantId,
      namespaceId,
      agentId,
      promptTemplateId,
      promptVersion,
      modelVersionId,
      toolPolicyKey,
      toolPolicyVersion,
      lastUserMessage: messages[messages.length - 1]?.content ?? '',
    });
    if (isTradingRoute && (!namespaceId || !agentId)) {
      metrics.llm.fallbacksTotal.inc();
      await logFallback({
        tenantId: context.tenantId,
        userId: context.userId,
        rota: context.route,
        contextoInferido,
        serviceOrigem: 'llm-gateway-service',
        chamada: '/api/llm/stream',
        motivoFallback: 'namespace_unmapped',
        namespaceId,
        agentId,
        modeloBase: baseModel,
        modeloResolvido: baseModel,
        adapterEncontrado: false,
        mensagemPreview: messages[messages.length - 1]?.content?.slice(0, 200),
      });
      res.status(412).json({ error: 'TRADING_SCOPE_REQUIRED: namespace e agente de Trading ativos são obrigatórios.' });
      return;
    }

    const model = await resolveModelWithAdapter(baseModel, {
      tenantId: context.tenantId,
      namespaceId: namespaceId ?? undefined,
      agentId: agentId ?? undefined,
    });
    if (isTradingRoute && model === baseModel) {
      metrics.llm.fallbacksTotal.inc();
      await logFallback({
        tenantId: context.tenantId,
        userId: context.userId,
        rota: context.route,
        contextoInferido,
        serviceOrigem: 'llm-gateway-service',
        chamada: '/api/llm/stream',
        motivoFallback: 'adapter_missing',
        namespaceId,
        agentId,
        modeloBase: baseModel,
        modeloResolvido: model,
        adapterEncontrado: false,
        mensagemPreview: messages[messages.length - 1]?.content?.slice(0, 200),
      });
      res.status(412).json({ error: 'TRADING_SCOPE_REQUIRED: adapter LoRA ativo obrigatório para Trading.' });
      return;
    }
    const adapterEncontrado = model !== baseModel;
    const motivoFallback = !adapterEncontrado && !useBaseModelForDefaultContext
      ? (!namespaceId && !agentId ? 'namespace_unmapped' : 'adapter_missing')
      : null;
    if (motivoFallback) {
      metrics.llm.fallbacksTotal.inc();
      await logFallback({
        tenantId: context.tenantId,
        userId: context.userId,
        rota: context.route,
        contextoInferido,
        serviceOrigem: 'llm-gateway-service',
        chamada: '/api/llm/stream',
        motivoFallback,
        namespaceId,
        agentId,
        modeloBase: baseModel,
        modeloResolvido: model,
        adapterEncontrado,
        mensagemPreview: messages[messages.length - 1]?.content?.slice(0, 200),
      });
    }

    const inferenceStart = process.hrtime.bigint();
    const streamStartAt = Date.now();
    const correlationId = req.header('x-correlation-id') ?? req.header('x-request-id') ?? undefined;
    logger.info({ correlationId, tenantId: context.tenantId, route: context.route, model }, 'Iniciando proxy de stream LLM');
    const recordInference = () => {
      metrics.llm.inferenceDuration.observe(
        { model, type: 'stream' },
        Number(process.hrtime.bigint() - inferenceStart) / 1e9
      );
    };
    let streamErrorRecorded = false;
    const recordStreamError = () => {
      if (streamErrorRecorded) return;
      streamErrorRecorded = true;
      metrics.llm.requestsTotal.inc({ model, type: 'stream', status: 'error' });
    };

    const gpuResponse = await requestGpuStream({
      serviceType: GpuServiceType.LLM,
      endpoint: '/v1/chat/completions',
      method: 'POST',
      priority: GpuRequestPriority.CRITICAL,
      timeout: 60000,
      body: {
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
        stream: true,
        ...(gpuExtraBody ?? {}),
      },
    });

    if (!gpuResponse.ok || !gpuResponse.body) {
      const text = await gpuResponse.text().catch(() => '');
      recordStreamError();
      await logExecutionAudit({
        tenantId: context.tenantId,
        userId: context.userId,
        namespaceId,
        agentId,
        conversationId: context.conversationId,
        route: context.route,
        operation: 'stream',
        modelName: model,
        adapterName: model !== baseModel ? model : null,
        structuredOutput: structuredOutputRequested,
        promptTemplateId,
        promptVersion,
        modelVersionId,
        toolPolicyKey,
        latencyMs: Date.now() - requestStartedAt,
        success: false,
        errorCode: 'gpu_manager_stream_error',
        requestFingerprint,
        metadata: {
          modelName: resolvedModelName,
          toolPolicyVersion,
          allowedTools,
          deniedTools,
        },
      });
      res.status(502).json({ error: text || 'Erro no GPU Manager' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Plano Enterprise: Enviar metadata de fallback antes do stream (banner no Chat)
    const usedFallback = !namespaceId && !useBaseModelForDefaultContext;
    const metadataEvent = `event: alice_metadata\ndata: ${JSON.stringify({ usedFallback })}\n\n`;
    res.write(metadataEvent);
    if (typeof (res as unknown as { flush?: () => void }).flush === 'function') {
      (res as unknown as { flush: () => void }).flush();
    }

    const reader = gpuResponse.body.getReader();
    let firstChunkAt: number | null = null;
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (firstChunkAt === null) {
          firstChunkAt = Date.now();
          logger.info({ correlationId, ttftMs: firstChunkAt - streamStartAt, tenantId: context.tenantId }, 'Primeiro chunk recebido no stream LLM');
        }
        res.write(value);
        if (typeof (res as unknown as { flush?: () => void }).flush === 'function') {
          (res as unknown as { flush: () => void }).flush();
        }
      }
      recordInference();
      logger.info({ correlationId, tenantId: context.tenantId, durationMs: Date.now() - streamStartAt }, 'Stream LLM finalizado com sucesso');
      await logExecutionAudit({
        tenantId: context.tenantId,
        userId: context.userId,
        namespaceId,
        agentId,
        conversationId: context.conversationId,
        route: context.route,
        operation: 'stream',
        modelName: model,
        adapterName: model !== baseModel ? model : null,
        structuredOutput: structuredOutputRequested,
        promptTemplateId,
        promptVersion,
        modelVersionId,
        toolPolicyKey,
        latencyMs: Date.now() - requestStartedAt,
        success: true,
        requestFingerprint,
        metadata: {
          modelName: resolvedModelName,
          toolPolicyVersion,
          allowedTools,
          deniedTools,
        },
      });
      res.end();
    };
    req.on('close', () => {
      logger.info({ correlationId, tenantId: context.tenantId, durationMs: Date.now() - streamStartAt }, 'Conexão encerrada durante stream LLM');
    });
    pump().catch((err) => {
      logger.error({ err, correlationId, tenantId: context.tenantId }, 'Erro ao encaminhar stream');
      recordStreamError();
      void logExecutionAudit({
        tenantId: context.tenantId,
        userId: context.userId,
        namespaceId,
        agentId,
        conversationId: context.conversationId,
        route: context.route,
        operation: 'stream',
        modelName: model,
        adapterName: model !== baseModel ? model : null,
        structuredOutput: structuredOutputRequested,
        promptTemplateId,
        promptVersion,
        modelVersionId,
        toolPolicyKey,
        latencyMs: Date.now() - requestStartedAt,
        success: false,
        errorCode: 'stream_proxy_error',
        requestFingerprint,
        metadata: {
          modelName: resolvedModelName,
          toolPolicyVersion,
          allowedTools,
          deniedTools,
        },
      });
      res.end();
    });
  })
);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/live', (_req, res) => res.json({ status: 'ok' }));
app.get('/ready', (_req, res) => res.json({ status: 'ok' }));

app.use(createNotFoundHandler());
app.use(createErrorHandler());

registerShutdownCallback('llm-gateway-database-pool', closeDatabasePool, { priority: ShutdownPriority.DATABASE });

connectWithRetry()
  .then(() => {
    const server = app.listen(PORT, () => {
      logger.info({ port: PORT }, 'LLM Gateway Service iniciado');
    });
    server.timeout = 120000; // 120s para chamadas longas de streaming SSE
    server.keepAliveTimeout = 125000; // manter conexão ativa para stream contínuo
    server.headersTimeout = 126000; // ligeiramente maior que keepAliveTimeout
    server.on('error', (err) => {
      logger.error({ err }, 'Erro ao iniciar servidor');
      process.exit(1);
    });
  })
  .catch((err) => {
    logger.error({ err }, 'Falha ao conectar ao banco de dados');
    process.exit(1);
  });
