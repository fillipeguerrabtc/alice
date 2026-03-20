import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { requirePermission } from '@alice/shared-utils';
import { z } from 'zod';
import { requireDelegatedAgentExecution } from '../delegated-execution.js';

interface GrafanaClientLike {
  request<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T>;
}

interface GithubActionsClientLike {
  isConfigured(): boolean;
  dispatchDeployStack(payload: {
    ref: string;
    inputs: Record<string, string>;
  }): Promise<void>;
}

interface RegisterGrafanaAndGithubRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  grafanaClient: GrafanaClientLike;
  githubActionsClient: GithubActionsClientLike;
}

const githubDeploySchema = z.object({
  stack: z.enum(['infra', 'alice', 'observability', 'backup', 'all']),
  version: z.string().min(2),
  rollback: z.boolean().optional(),
  rollbackVersion: z.string().optional(),
  dryRun: z.boolean().optional(),
  smartDeploy: z.boolean().optional(),
});

export function registerGrafanaAndGithubRoutes(
  app: Express,
  deps: RegisterGrafanaAndGithubRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');
  const { grafanaClient, githubActionsClient } = deps;

  // ============================================================================
  // GRAFANA API (Dashboards) - Read/Write via Integrations Service
  // ============================================================================

  app.get('/api/integrations/grafana/health', requirePermission('integrations:grafana:read'), async (_req: Request, res: Response) => {
    try {
      const data = await grafanaClient.request<{ database?: string; version?: string }>('GET', '/api/health');
      res.json({ success: true, data });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Falha ao consultar health do Grafana');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get(
    '/api/integrations/grafana/dashboards',
    requirePermission('integrations:grafana:read'),
    requireDelegatedAgentExecution({
      actionKey: 'observability.grafana.dashboard.list',
      logger,
      payloadResolver: (req) => req.query,
    }),
    async (req: Request, res: Response) => {
    try {
      const querySchema = z.object({
        query: z.string().optional(),
        tag: z.string().optional(),
        folderId: z.coerce.number().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      });
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Query inválida', details: parsed.error.flatten() });
        return;
      }
      const params = new URLSearchParams();
      params.set('type', 'dash-db');
      if (parsed.data.query) params.set('query', parsed.data.query);
      if (parsed.data.tag) params.set('tag', parsed.data.tag);
      if (parsed.data.folderId !== undefined) params.set('folderIds', parsed.data.folderId.toString());
      if (parsed.data.limit !== undefined) params.set('limit', parsed.data.limit.toString());

      const data = await grafanaClient.request<Array<{ id: number; uid: string; title: string; url: string }>>(
        'GET',
        `/api/search?${params.toString()}`
      );
      res.json({ success: true, data });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Falha ao listar dashboards do Grafana');
      res.status(500).json({ error: errorMessage });
    }
    },
  );

  app.get(
    '/api/integrations/grafana/dashboards/:uid',
    requirePermission('integrations:grafana:read'),
    requireDelegatedAgentExecution({
      actionKey: 'observability.grafana.dashboard.get',
      logger,
      payloadResolver: (req) => ({ uid: req.params.uid }),
    }),
    async (req: Request, res: Response) => {
    try {
      const uid = req.params.uid;
      if (!uid) {
        res.status(400).json({ error: 'UID inválido' });
        return;
      }
      const data = await grafanaClient.request<{ dashboard: Record<string, unknown> }>('GET', `/api/dashboards/uid/${uid}`);
      res.json({ success: true, data });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Falha ao obter dashboard do Grafana');
      res.status(500).json({ error: errorMessage });
    }
    },
  );

  app.post(
    '/api/integrations/grafana/dashboards',
    requirePermission('integrations:grafana:write'),
    requireDelegatedAgentExecution({
      actionKey: 'observability.grafana.dashboard.update',
      logger,
      payloadResolver: (req) => req.body,
    }),
    async (req: Request, res: Response) => {
    try {
      const bodySchema = z.object({
        dashboard: z.record(z.unknown()),
        folderId: z.number().int().optional(),
        folderUid: z.string().optional(),
        message: z.string().optional(),
        overwrite: z.boolean().optional(),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
        return;
      }
      if (!parsed.data.dashboard || Object.keys(parsed.data.dashboard).length === 0) {
        res.status(400).json({ error: 'Dashboard inválido (vazio).' });
        return;
      }
      const payload = {
        dashboard: parsed.data.dashboard,
        folderId: parsed.data.folderId,
        folderUid: parsed.data.folderUid,
        message: parsed.data.message ?? 'Atualizado via Alice Chat',
        overwrite: parsed.data.overwrite ?? true,
      };
      const data = await grafanaClient.request<Record<string, unknown>>('POST', '/api/dashboards/db', payload);
      logger.info({ dashboard: (parsed.data.dashboard as { title?: string }).title ?? 'unknown' }, 'Dashboard Grafana atualizado');
      res.json({ success: true, data });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Falha ao atualizar dashboard do Grafana');
      res.status(500).json({ error: errorMessage });
    }
    },
  );

  app.post(
    '/api/integrations/github/deploy-stack',
    requirePermission('admin:alice_core:write'),
    requireDelegatedAgentExecution({
      actionKey: 'platform.stack.deploy',
      actionKeyResolver: (req) => req.body?.rollback ? 'platform.stack.rollback' : 'platform.stack.deploy',
      logger,
      payloadResolver: (req) => req.body,
    }),
    async (req: Request, res: Response) => {
    if (!githubActionsClient.isConfigured()) {
      return res.status(503).json({ error: 'GitHub Actions not configured' });
    }

    const parseResult = githubDeploySchema.safeParse(req.body);
    if (!parseResult.success) {
      logger.warn({ errors: parseResult.error.flatten() }, 'Input inválido em /api/integrations/github/deploy-stack');
      return res.status(400).json({ error: 'Input inválido', details: parseResult.error.format() });
    }

    const payload = {
      ref: 'main',
      inputs: {
        stack: parseResult.data.stack,
        version: parseResult.data.version,
        rollback: parseResult.data.rollback ? 'true' : 'false',
        rollback_version: parseResult.data.rollbackVersion ?? '',
        dry_run: parseResult.data.dryRun ? 'true' : 'false',
        smart_deploy: parseResult.data.smartDeploy ? 'true' : 'false',
      },
    };

    const startedAt = Date.now();

    try {
      await githubActionsClient.dispatchDeployStack(payload);

      res.json({
        status: 'queued',
        workflow: 'deploy-stack-modular.yml',
        inputs: payload.inputs,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      logger.error({ error }, 'Falha ao disparar workflow deploy-stack-modular');
      res.status(500).json({
        error: 'Falha ao disparar workflow',
        durationMs: Date.now() - startedAt,
      });
    }
    },
  );
}
