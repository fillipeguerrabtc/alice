import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import type express from 'express';
import type { Logger } from 'pino';
import { z } from 'zod';
import {
  getDatabase,
  schema,
  eq,
  and,
  desc,
} from '@alice/database';
import {
  asyncHandler,
  GpuRequestPriority,
  GpuServiceType,
  requestGpu,
  requestGpuStream,
  resolveLlmModelByScope,
  resolveNamespaceByRoute,
} from '@alice/shared-utils';
import {
  mergeGovernanceHints,
  parseGovernanceHints,
  resolveModelGovernance,
  resolveNamespaceProfileGovernanceDefaults,
  resolvePromptGovernance,
  resolveToolPolicyGovernance,
} from './governance.js';
import type { LlmGatewayMetrics } from './llm-metrics.js';

const { llmFallbackLogs, llmExecutionAudit, namespaces, agents } = schema;

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
  extraBody: z.record(z.unknown()).optional(),
  requestOptions: z.object({
    timeout: z.number().positive().optional(),
    priority: z.enum(['low', 'normal', 'high', 'critical']).optional(),
  }).optional(),
});

const streamSchema = completeSchema;

async function resolveModelWithAdapter(
  logger: Logger,
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
}, logger: Logger): Promise<void> {
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
}, logger: Logger): Promise<void> {
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

function getDb() {
  return getDatabase();
}

export function registerLlmInferenceRoutes(params: {
  app: express.Express;
  logger: Logger;
  metrics: LlmGatewayMetrics;
  defaultModel: string;
  gpuRequestTimeoutMs: number;
}): void {
  const {
    app,
    logger,
    metrics,
    defaultModel,
    gpuRequestTimeoutMs,
  } = params;

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
      let baseModel = config?.model ?? defaultModel;
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
        }, logger);
        res.status(412).json({ error: 'TRADING_SCOPE_REQUIRED: namespace e agente de Trading ativos são obrigatórios.' });
        return;
      }

      const model = await resolveModelWithAdapter(logger, baseModel, {
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
        }, logger);
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
        }, logger);
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
        timeout: requestOptions?.timeout ?? gpuRequestTimeoutMs,
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
        }, logger);
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
      }, logger);
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
      let baseModel = config?.model ?? defaultModel;
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
        }, logger);
        res.status(412).json({ error: 'TRADING_SCOPE_REQUIRED: namespace e agente de Trading ativos são obrigatórios.' });
        return;
      }

      const model = await resolveModelWithAdapter(logger, baseModel, {
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
        }, logger);
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
        }, logger);
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
        timeout: gpuRequestTimeoutMs,
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
        }, logger);
        res.status(502).json({ error: text || 'Erro no GPU Manager' });
        return;
      }

      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

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
        }, logger);
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
        }, logger);
        res.end();
      });
    })
  );
}
