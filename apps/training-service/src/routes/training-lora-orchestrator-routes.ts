import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { and, eq, getDatabase, schema } from '@alice/database';
import { requirePermission } from '@alice/shared-utils';
import { z } from 'zod';

interface TenantResolutionSuccess {
  ok: true;
  tenantId: string;
  authContext: {
    userId: string | null;
  };
}

interface TenantResolutionError {
  ok: false;
  status: number;
  error: string;
}

type ResolveAuthorizedTenantIdFn = (
  req: Request,
  requestedTenantId?: string | null,
) => TenantResolutionSuccess | TenantResolutionError;

type AdapterScope = {
  tenantId?: string;
  namespaceId?: string;
  agentId?: string;
};

interface RegisterTrainingLoraOrchestratorRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  resolveAuthorizedTenantId: ResolveAuthorizedTenantIdFn;
  activateLoraAdapter: (
    jobId: string,
    approvedBy?: string | null,
  ) => Promise<{ success: boolean; adapterPath: string; message: string }>;
  getActiveAdapter: (scope?: AdapterScope) => Promise<unknown>;
  deactivateLoraAdapter: (scope?: AdapterScope) => Promise<void>;
  gpuManagerUrlOrchestrator: string;
  internalApiSecretOrchestrator?: string;
  fetchFn?: typeof fetch;
}

const loraJobIdParamSchema = z.object({
  id: z.string().uuid(),
});

const loraActiveQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
  namespaceId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
});

const loraActiveDeleteBodySchema = z.object({
  tenantId: z.string().uuid().optional(),
  namespaceId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
});

export function registerTrainingLoraOrchestratorRoutes(
  app: Express,
  deps: RegisterTrainingLoraOrchestratorRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('training-service');
  const fetchFn = deps.fetchFn ?? fetch;

  app.post('/api/training/lora/activate/:jobId', requirePermission('training:fine_tuning_jobs:start'), async (req: Request, res: Response) => {
    const paramsResult = loraJobIdParamSchema.safeParse({ id: req.params.jobId });
    if (!paramsResult.success) {
      return res.status(400).json({ error: 'jobId invalido', details: paramsResult.error.format() });
    }

    try {
      const tenantResolution = deps.resolveAuthorizedTenantId(req);
      if (!tenantResolution.ok) {
        return res.status(tenantResolution.status).json({ error: tenantResolution.error });
      }
      if (!tenantResolution.authContext.userId) {
        return res.status(403).json({ error: 'Usuario nao identificado para aprovacao' });
      }

      const db = getDatabase();
      const loraJob = await db.query.loraJobs.findFirst({
        where: and(
          eq(schema.loraJobs.id, paramsResult.data.id),
          eq(schema.loraJobs.tenantId, tenantResolution.tenantId),
        ),
        columns: { id: true },
      });
      if (!loraJob) {
        return res.status(404).json({ error: 'Job LoRA nao encontrado para o tenant autenticado' });
      }

      const result = await deps.activateLoraAdapter(paramsResult.data.id, tenantResolution.authContext.userId);
      logger.info({ jobId: paramsResult.data.id, approvedBy: tenantResolution.authContext.userId }, 'Adapter LoRA ativado via endpoint');
      return res.json(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error, jobId: req.params.jobId }, 'Falha ao ativar adapter LoRA');
      return res.status(400).json({ error: errorMessage });
    }
  });

  app.get('/api/training/lora/active', requirePermission('training:fine_tuning_jobs:read'), async (req: Request, res: Response) => {
    try {
      const parsed = loraActiveQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Parametros invalidos', details: parsed.error.format() });
      }
      const tenantResolution = deps.resolveAuthorizedTenantId(req, parsed.data.tenantId ?? null);
      if (!tenantResolution.ok) {
        return res.status(tenantResolution.status).json({ error: tenantResolution.error });
      }
      const active = await deps.getActiveAdapter({
        tenantId: tenantResolution.tenantId,
        namespaceId: parsed.data.namespaceId,
        agentId: parsed.data.agentId,
      });
      return res.json({ adapter: active });
    } catch (error) {
      logger.error({ error }, 'Falha ao consultar adapter ativo');
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  });

  app.delete('/api/training/lora/active', requirePermission('training:fine_tuning_jobs:start'), async (req: Request, res: Response) => {
    try {
      const parsed = loraActiveDeleteBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: 'Payload invalido', details: parsed.error.format() });
      }
      const tenantResolution = deps.resolveAuthorizedTenantId(req, parsed.data.tenantId ?? null);
      if (!tenantResolution.ok) {
        return res.status(tenantResolution.status).json({ error: tenantResolution.error });
      }
      await deps.deactivateLoraAdapter({
        tenantId: tenantResolution.tenantId,
        namespaceId: parsed.data.namespaceId,
        agentId: parsed.data.agentId,
      });
      return res.json({ success: true, message: 'Adapter LoRA desativado. vLLM usara modelo base.' });
    } catch (error) {
      logger.error({ error }, 'Falha ao desativar adapter LoRA');
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  });

  app.get('/api/training/gpu-orchestrator/state', requirePermission('training:fine_tuning_jobs:read'), async (_req: Request, res: Response) => {
    if (!deps.internalApiSecretOrchestrator) {
      return res.status(503).json({ error: 'Servico indisponivel', orchestratorAvailable: false });
    }
    try {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), 5000);
      const response = await fetchFn(`${deps.gpuManagerUrlOrchestrator}/api/gpu/orchestrator/state`, {
        signal: controller.signal,
        headers: {
          'X-Internal-Api-Secret': deps.internalApiSecretOrchestrator,
          Accept: 'application/json',
        },
      });
      clearTimeout(timeoutHandle);
      const data = (await response.json()) as Record<string, unknown>;
      return res.status(response.status).json(data);
    } catch (error) {
      logger.warn(
        { err: error instanceof Error ? error.message : String(error) },
        'Proxy gpu-orchestrator/state falhou',
      );
      return res.status(503).json({ error: 'GPU Manager indisponivel', orchestratorAvailable: false });
    }
  });

  app.post('/api/training/gpu-orchestrator/return', requirePermission('training:fine_tuning_jobs:start'), async (_req: Request, res: Response) => {
    if (!deps.internalApiSecretOrchestrator) {
      return res.status(503).json({ error: 'Servico indisponivel' });
    }
    try {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), 10000);
      const response = await fetchFn(`${deps.gpuManagerUrlOrchestrator}/api/gpu/orchestrator/return`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'X-Internal-Api-Secret': deps.internalApiSecretOrchestrator,
          'Content-Type': 'application/json',
        },
      });
      clearTimeout(timeoutHandle);
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      return res.status(response.status).json(data);
    } catch (error) {
      logger.warn(
        { err: error instanceof Error ? error.message : String(error) },
        'Proxy gpu-orchestrator/return falhou',
      );
      return res.status(503).json({ error: 'GPU Manager indisponivel' });
    }
  });

  logger.info('Training LoRA and GPU orchestrator routes registered');
}
