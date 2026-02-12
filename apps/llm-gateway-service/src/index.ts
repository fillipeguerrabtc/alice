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
import type { Request, Response } from 'express';
import cors from 'cors';
import compression from 'compression';
import { createLogger } from '@alice/logger';
import {
  resolveNamespaceByRoute,
  requestGpu,
  requestGpuStream,
  GpuServiceType,
  GpuRequestPriority,
  registerShutdownCallback,
  ShutdownPriority,
} from '@alice/shared-utils';
import {
  createCorrelationMiddleware,
  createSecurityMiddleware,
  createErrorHandler,
  createNotFoundHandler,
  asyncHandler,
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

const { llmFallbackLogs, namespaces, agents } = schema;
import { z } from 'zod';

const logger = createLogger('llm-gateway');

const PORT = parseInt(process.env.PORT || '3011', 10);
const TRAINING_SERVICE_URL = process.env.TRAINING_SERVICE_URL || 'http://alice-training:3004';
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || '';
const DEFAULT_MODEL = process.env.DEFAULT_LLM_MODEL || 'Qwen2.5-7B-Instruct-AWQ';

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
  if (!ctx.tenantId && !ctx.namespaceId && !ctx.agentId) {
    return baseModel;
  }
  try {
    const query = new URLSearchParams();
    if (ctx.tenantId) query.set('tenantId', ctx.tenantId);
    if (ctx.namespaceId) query.set('namespaceId', ctx.namespaceId);
    if (ctx.agentId) query.set('agentId', ctx.agentId);
    const url = `${TRAINING_SERVICE_URL}/api/training/lora/active${query.size > 0 ? `?${query.toString()}` : ''}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Api-Secret': INTERNAL_API_SECRET,
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return baseModel;
    const data = (await res.json()) as { adapter?: { adapterName?: string } | null };
    return data?.adapter?.adapterName ?? baseModel;
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
  mensagemPreview?: string;
}): Promise<void> {
  try {
    const db = getDatabase();
    await db.insert(llmFallbackLogs).values({
      tenantId: params.tenantId,
      userId: params.userId ?? null,
      rota: params.rota,
      contextoInferido: params.contextoInferido,
      mensagemPreview: params.mensagemPreview ?? null,
    });
  } catch (err) {
    logger.warn({ err, params }, 'Falha ao registrar fallback em llm_fallback_logs');
  }
}

const app = express();
app.use(createCorrelationMiddleware({ serviceName: 'llm-gateway' }));
app.use(createSecurityMiddleware());
app.use(cors({ origin: true }));
app.use(compression());
app.use(express.json({ limit: '1mb' }));

function requireInternalAuth(req: Request, res: Response, next: () => void): void {
  if (req.path === '/health' || req.path === '/live' || req.path === '/ready') {
    return next();
  }
  const secret = req.headers['x-internal-api-secret'] as string;
  if (!INTERNAL_API_SECRET && process.env.NODE_ENV !== 'production') {
    return next();
  }
  if (!secret || secret !== INTERNAL_API_SECRET) {
    res.status(401).json({ error: 'Token de autenticação inválido ou ausente' });
    return;
  }
  next();
}
app.use(requireInternalAuth);

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
    const temperature = config?.temperature ?? 0.7;
    const maxTokens = config?.maxTokens ?? 2048;
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
      if (!namespaceId) {
        await logFallback({
          tenantId: context.tenantId,
          userId: context.userId,
          rota: context.route,
          contextoInferido,
          mensagemPreview: messages[messages.length - 1]?.content?.slice(0, 200),
        });
      }
    }

    const baseModel = config?.model ?? DEFAULT_MODEL;
    const model = await resolveModelWithAdapter(baseModel, {
      tenantId: context.tenantId,
      namespaceId: namespaceId ?? undefined,
      agentId: agentId ?? undefined,
    });

    const baseBody = {
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
      stream: false,
    };
    const body = extraBody ? { ...baseBody, ...extraBody } : baseBody;

    const priorityMap: Record<string, GpuRequestPriority> = {
      low: GpuRequestPriority.LOW,
      normal: GpuRequestPriority.MEDIUM,
      high: GpuRequestPriority.HIGH,
      critical: GpuRequestPriority.CRITICAL,
    };
    const gpuResponse = await requestGpu({
      serviceType: GpuServiceType.LLM,
      endpoint: '/v1/chat/completions',
      method: 'POST',
      priority: requestOptions?.priority ? priorityMap[requestOptions.priority] ?? GpuRequestPriority.CRITICAL : GpuRequestPriority.CRITICAL,
      timeout: requestOptions?.timeout ?? 60000,
      body,
    });

    if (!gpuResponse.success || !gpuResponse.data) {
      res.status(502).json({ error: gpuResponse.error || 'Erro no GPU Manager' });
      return;
    }

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
    const { messages, config, context } = parsed.data;
    const temperature = config?.temperature ?? 0.7;
    const maxTokens = config?.maxTokens ?? 2048;
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
      if (!namespaceId) {
        await logFallback({
          tenantId: context.tenantId,
          userId: context.userId,
          rota: context.route,
          contextoInferido,
          mensagemPreview: messages[messages.length - 1]?.content?.slice(0, 200),
        });
      }
    }

    const baseModel = config?.model ?? DEFAULT_MODEL;
    const model = await resolveModelWithAdapter(baseModel, {
      tenantId: context.tenantId,
      namespaceId: namespaceId ?? undefined,
      agentId: agentId ?? undefined,
    });

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
      },
    });

    if (!gpuResponse.ok || !gpuResponse.body) {
      const text = await gpuResponse.text().catch(() => '');
      res.status(502).json({ error: text || 'Erro no GPU Manager' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Plano Enterprise: Enviar metadata de fallback antes do stream (banner no Chat)
    const usedFallback = !namespaceId;
    const metadataEvent = `event: alice_metadata\ndata: ${JSON.stringify({ usedFallback })}\n\n`;
    res.write(metadataEvent);
    if (typeof (res as unknown as { flush?: () => void }).flush === 'function') {
      (res as unknown as { flush: () => void }).flush();
    }

    const reader = gpuResponse.body.getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
        if (typeof (res as unknown as { flush?: () => void }).flush === 'function') {
          (res as unknown as { flush: () => void }).flush();
        }
      }
      res.end();
    };
    pump().catch((err) => {
      logger.error({ err }, 'Erro ao encaminhar stream');
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
    server.on('error', (err) => {
      logger.error({ err }, 'Erro ao iniciar servidor');
      process.exit(1);
    });
  })
  .catch((err) => {
    logger.error({ err }, 'Falha ao conectar ao banco de dados');
    process.exit(1);
  });
