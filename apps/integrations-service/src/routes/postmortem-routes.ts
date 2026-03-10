import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { requirePermission } from '@alice/shared-utils';
import { and, desc, eq } from '@alice/database';
import { schema, withTenantContext } from '@alice/database';
import { z } from 'zod';
import {
  getQueueStats as getPostMortemQueueStats,
  retryDlqJob as retryPostMortemDlqJob,
} from '../postmortem-worker.js';
import { getSnapshotsByRefs } from '../snapshot-store.js';
import {
  createDatasetFromPostMortem,
  createDatasetsFromPostMortemsBatch,
} from '../dataset-generator.js';

interface RegisterPostMortemRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
}

export function registerPostMortemRoutes(
  app: Express,
  deps: RegisterPostMortemRoutesDeps = {},
): void {
  const logger = deps.logger ?? createLogger('integrations-service');
// GET /api/integrations/postmortem/:positionId - Buscar post-mortem de uma posição
app.get('/api/integrations/postmortem/:positionId', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) { res.status(403).json({ error: 'Tenant não identificado' }); return; }
    const positionId = req.params.positionId;
    if (!positionId) { res.status(400).json({ error: 'ID da posição é obrigatório' }); return; }
    const postmortem = await withTenantContext(tenantId, false, async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.tradingPostmortems)
        .where(and(
          eq(schema.tradingPostmortems.positionId, positionId),
          eq(schema.tradingPostmortems.tenantId, tenantId),
        ))
        .limit(1);
      return row ?? null;
    });

    if (!postmortem) {
      res.status(404).json({ error: 'Post-mortem não encontrado para esta posição' });
      return;
    }
    res.json({ success: true, data: postmortem });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar post-mortem');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/postmortem - Listar post-mortems do tenant
app.get('/api/integrations/postmortem', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) { res.status(403).json({ error: 'Tenant não identificado' }); return; }
    const limit = parseInt(req.query.limit as string) || 50;
    const isDemo = req.query.isDemo === 'true' ? true : req.query.isDemo === 'false' ? false : undefined;

    // Construir condição WHERE com isDemo na query SQL (não pós-filtro)
    const whereCondition = isDemo !== undefined
      ? and(eq(schema.tradingPostmortems.tenantId, tenantId), eq(schema.tradingPostmortems.isDemo, isDemo))
      : eq(schema.tradingPostmortems.tenantId, tenantId);

    const postmortems = await withTenantContext(tenantId, false, async (tx) =>
      tx
        .select()
        .from(schema.tradingPostmortems)
        .where(whereCondition)
        .orderBy(desc(schema.tradingPostmortems.createdAt))
        .limit(limit)
    );

    res.json({ success: true, data: postmortems });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao listar post-mortems');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/postmortem/queue/stats - Estatísticas da fila de post-mortem
app.get('/api/integrations/postmortem/queue/stats', requirePermission('integrations:trading:manage'), async (_req: Request, res: Response) => {
  try {
    const stats = await getPostMortemQueueStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar estatísticas da fila');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/postmortem/queue/retry/:jobId - Retry job da DLQ
app.post('/api/integrations/postmortem/queue/retry/:jobId', requirePermission('integrations:trading:manage'), async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) { res.status(403).json({ error: 'Tenant não identificado' }); return; }
    const success = await retryPostMortemDlqJob(req.params.jobId, tenantId);
    if (!success) {
      res.status(404).json({ error: 'Job não encontrado na DLQ' });
      return;
    }
    res.json({ success: true, message: 'Job reenfileirado com sucesso' });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao reenfileirar job');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/postmortem/snapshots/:positionId - Buscar snapshots de uma posição
app.get('/api/integrations/postmortem/snapshots/:positionId', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) { res.status(403).json({ error: 'Tenant não identificado' }); return; }
    const positionId = req.params.positionId;
    if (!positionId) { res.status(400).json({ error: 'ID da posição é obrigatório' }); return; }
    const snapshots = await getSnapshotsByRefs({
      tenantId,
      refKey: 'positionId',
      refValue: positionId,
    });
    res.json({ success: true, data: snapshots });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar snapshots');
    res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// TRAINING DATASETS — Envio single/batch de post-mortems para Training
// ============================================================================

// POST /api/integrations/postmortem/send-to-training - Enviar post-mortem individual para Training
app.post('/api/integrations/postmortem/send-to-training', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const bodySchema = z.object({
      postmortemId: z.string().uuid(),
      namespaceId: z.string().uuid(),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
      return;
    }

    const tenantId = req.tenantId;
    if (!tenantId) { res.status(403).json({ error: 'Tenant não identificado' }); return; }

    const targetNamespace = await withTenantContext(tenantId, false, async (tx) =>
      tx.query.namespaces.findFirst({
        where: and(
          eq(schema.namespaces.id, parsed.data.namespaceId),
          eq(schema.namespaces.tenantId, tenantId),
          eq(schema.namespaces.ativo, true)
        ),
        columns: { id: true },
      })
    );
    if (!targetNamespace) {
      res.status(403).json({ error: 'Namespace de destino não pertence ao tenant ou está inativo' });
      return;
    }

    const datasetId = await createDatasetFromPostMortem(parsed.data.postmortemId, tenantId, targetNamespace.id);
    if (!datasetId) {
      res.status(422).json({
        error: 'Não foi possível criar dataset — post-mortem não encontrado, incompleto ou já processado',
      });
      return;
    }

    res.json({
      success: true,
      data: { datasetId, postmortemId: parsed.data.postmortemId, namespaceId: targetNamespace.id },
      message: 'Dataset criado com status pending para aprovação',
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao enviar post-mortem para training');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/postmortem/send-to-training/batch - Enviar múltiplos post-mortems para Training
app.post('/api/integrations/postmortem/send-to-training/batch', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const bodySchema = z.object({
      postmortemIds: z.array(z.string().uuid()).min(1),
      namespaceId: z.string().uuid().optional(),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
      return;
    }

    if (parsed.data.postmortemIds.length > 100) {
      res.status(400).json({ error: 'Máximo de 100 post-mortems por batch' });
      return;
    }

    const tenantId = req.tenantId;
    if (!tenantId) { res.status(403).json({ error: 'Tenant não identificado' }); return; }
    let targetNamespaceId: string | undefined;
    const requestedNamespaceId = parsed.data.namespaceId;
    if (requestedNamespaceId) {
      const namespace = await withTenantContext(tenantId, false, async (tx) =>
        tx.query.namespaces.findFirst({
          where: and(
            eq(schema.namespaces.id, requestedNamespaceId),
            eq(schema.namespaces.tenantId, tenantId),
            eq(schema.namespaces.ativo, true)
          ),
          columns: { id: true },
        })
      );
      if (!namespace) {
        res.status(403).json({ error: 'Namespace de destino não pertence ao tenant ou está inativo' });
        return;
      }
      targetNamespaceId = namespace.id;
    }

    const results = await createDatasetsFromPostMortemsBatch(parsed.data.postmortemIds, tenantId, targetNamespaceId);

    const created = Object.values(results).filter(Boolean).length;
    const failed = parsed.data.postmortemIds.length - created;

    res.json({
      success: true,
      data: {
        results,
        summary: { total: parsed.data.postmortemIds.length, created, failed },
      },
      message: `${created} datasets criados com status pending para aprovação`,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao enviar batch de post-mortems para training');
    res.status(500).json({ error: errorMessage });
  }
});
}
