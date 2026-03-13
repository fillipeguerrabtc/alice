import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { and, desc, eq, inArray, sql } from '@alice/database';
import { getDatabase, schema } from '@alice/database';
import { extractAuthContext, requirePermission } from '@alice/shared-utils';
import { z } from 'zod';

interface TradingAuthContext {
  tenantId: string;
  userId: string;
}

interface TradingDatasetCreationResult {
  dataset: schema.TrainingData;
  created: boolean;
  status: schema.TrainingData['status'];
  qualityScore: number;
  duplicate: {
    isDuplicate: boolean;
    duplicateOfId?: string;
    similarityScore?: number;
  };
}

type TradingDatasetSourceType = typeof schema.trainingData.$inferSelect['sourceType'];

interface RegisterTradingDatasetRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  tradingSourceTypes: readonly TradingDatasetSourceType[];
  createTradingDatasetFromSignalSource: (params: {
    authContext: TradingAuthContext;
    signal: schema.TradingSignal;
    reviewNotes?: string;
    namespaceId?: string;
  }) => Promise<TradingDatasetCreationResult>;
}

function getTradingAuthContext(req: Request): TradingAuthContext | null {
  const authContext = extractAuthContext(req);
  if (!authContext?.tenantId || !authContext?.userId) {
    return null;
  }
  return { tenantId: authContext.tenantId, userId: authContext.userId };
}

function mapTrainingDataToTradingDatasetRow(row: typeof schema.trainingData.$inferSelect): Record<string, unknown> {
  const msgs = (row.messages ?? []) as Array<{ role: string; content: string }>;
  const userMsg = msgs.find((m) => m.role === 'user');
  const assistantMsg = msgs.find((m) => m.role === 'assistant');
  const meta = (row.sourceMetadata ?? {}) as Record<string, unknown>;
  const marketContext = meta.marketContext as Record<string, unknown> | undefined;
  const actionType = (meta.actionType as string) ?? 'signal';
  return {
    id: row.id,
    tenantId: row.tenantId,
    status: row.status,
    prompt: userMsg?.content ?? '',
    response: assistantMsg?.content ?? '',
    actionType,
    marketContext: marketContext ?? { symbol: 'N/A' },
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    qualityScore: row.qualityScore,
    reviewNotes: row.reviewNotes,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt,
    isDuplicate: row.isDuplicate ?? false,
    similarityScore: row.similarityScore,
    sourceMetadata: meta,
    criadoEm: row.criadoEm,
    usedInJobId: row.usedInJobId,
  };
}

const datasetsListQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'used']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const datasetFromSignalBodySchema = z.object({
  signalId: z.string().uuid(),
  namespaceId: z.string().uuid().optional(),
  reviewNotes: z.string().optional(),
});

const datasetReviewBodySchema = z.object({
  status: z.enum(['approved', 'rejected']),
  reviewNotes: z.string().optional(),
  namespaceId: z.string().uuid().optional().nullable(),
});

export function registerTradingDatasetRoutes(
  app: Express,
  deps: RegisterTradingDatasetRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');

  app.get('/api/integrations/trading/datasets/stats', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const db = getDatabase();
      const rows = await db
        .select({
          status: schema.trainingData.status,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.trainingData)
        .where(and(
          eq(schema.trainingData.tenantId, authContext.tenantId),
          inArray(schema.trainingData.sourceType, [...deps.tradingSourceTypes]),
        ))
        .groupBy(schema.trainingData.status);

      const stats = { pending: 0, approved: 0, rejected: 0, used: 0 };
      for (const row of rows) {
        if (row.status && row.status in stats) {
          (stats as Record<string, number>)[row.status] = Number(row.count ?? 0);
        }
      }

      res.json({ success: true, ...stats });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao obter stats de datasets de trading');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/integrations/trading/datasets', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }
      const parsed = datasetsListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Query inválida', details: parsed.error.flatten() });
        return;
      }

      const limit = parsed.data.limit ?? 50;
      const offset = parsed.data.offset ?? 0;
      const whereClause = and(
        eq(schema.trainingData.tenantId, authContext.tenantId),
        inArray(schema.trainingData.sourceType, [...deps.tradingSourceTypes]),
        parsed.data.status ? eq(schema.trainingData.status, parsed.data.status) : sql`1=1`,
      );

      const db = getDatabase();
      const total = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.trainingData)
        .where(whereClause);

      const rows = await db.query.trainingData.findMany({
        where: whereClause,
        orderBy: [desc(schema.trainingData.criadoEm)],
        limit,
        offset,
      });

      res.json({
        success: true,
        data: rows.map(mapTrainingDataToTradingDatasetRow),
        total: Number(total[0]?.count ?? 0),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao listar datasets de trading');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.post('/api/integrations/trading/datasets/from-signal', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }
      const parsed = datasetFromSignalBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
        return;
      }

      const db = getDatabase();
      let targetNamespaceId: string | undefined;
      if (parsed.data.namespaceId) {
        const targetNamespace = await db.query.namespaces.findFirst({
          where: and(
            eq(schema.namespaces.id, parsed.data.namespaceId),
            eq(schema.namespaces.tenantId, authContext.tenantId),
            eq(schema.namespaces.ativo, true),
          ),
          columns: { id: true },
        });
        if (!targetNamespace) {
          res.status(403).json({ error: 'Namespace de destino não pertence ao tenant ou está inativo' });
          return;
        }
        targetNamespaceId = targetNamespace.id;
      }

      const signal = await db.query.tradingSignals.findFirst({
        where: and(
          eq(schema.tradingSignals.id, parsed.data.signalId),
          eq(schema.tradingSignals.tenantId, authContext.tenantId),
        ),
      });
      if (!signal) {
        res.status(404).json({ error: 'Sinal não encontrado' });
        return;
      }

      const result = await deps.createTradingDatasetFromSignalSource({
        authContext,
        signal,
        namespaceId: targetNamespaceId,
        reviewNotes: parsed.data.reviewNotes,
      });

      res.json({
        success: true,
        data: result.dataset,
        meta: {
          created: result.created,
          status: result.status,
          qualityScore: result.qualityScore,
          duplicate: result.duplicate,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao criar dataset de trading');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.patch('/api/integrations/trading/datasets/:id/review', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }
      const parsed = datasetReviewBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
        return;
      }

      const db = getDatabase();
      const existing = await db.query.trainingData.findFirst({
        where: and(
          eq(schema.trainingData.id, req.params.id),
          eq(schema.trainingData.tenantId, authContext.tenantId),
          inArray(schema.trainingData.sourceType, [...deps.tradingSourceTypes]),
        ),
        columns: { id: true, sourceMetadata: true },
      });
      if (!existing) {
        res.status(404).json({ error: 'Dataset não encontrado' });
        return;
      }

      let nextSourceMetadata = (existing.sourceMetadata as Record<string, unknown>) ?? {};
      if (parsed.data.namespaceId !== undefined) {
        if (parsed.data.namespaceId === null) {
          const { namespaceId: _n, ...rest } = nextSourceMetadata;
          nextSourceMetadata = rest;
        } else {
          const namespace = await db.query.namespaces.findFirst({
            where: and(
              eq(schema.namespaces.id, parsed.data.namespaceId),
              eq(schema.namespaces.tenantId, authContext.tenantId),
            ),
            columns: { id: true },
          });
          if (!namespace) {
            res.status(400).json({ error: 'Namespace inválido ou não pertence ao tenant' });
            return;
          }
          nextSourceMetadata = { ...nextSourceMetadata, namespaceId: parsed.data.namespaceId };
        }
      }

      const [updated] = await db.update(schema.trainingData)
        .set({
          status: parsed.data.status,
          reviewNotes: parsed.data.reviewNotes ?? null,
          reviewedBy: authContext.userId,
          reviewedAt: new Date(),
          sourceMetadata: nextSourceMetadata,
        })
        .where(and(
          eq(schema.trainingData.id, req.params.id),
          eq(schema.trainingData.tenantId, authContext.tenantId),
        ))
        .returning();

      if (!updated) {
        res.status(404).json({ error: 'Dataset não encontrado' });
        return;
      }

      res.json({ success: true, data: mapTrainingDataToTradingDatasetRow(updated) });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao revisar dataset de trading');
      res.status(500).json({ error: errorMessage });
    }
  });
}
