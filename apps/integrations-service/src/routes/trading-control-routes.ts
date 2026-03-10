import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { desc, eq, getDatabase, schema } from '@alice/database';
import { extractAuthContext, requirePermission } from '@alice/shared-utils';
import { getPublisher } from '../tradingBroadcast.js';
import { z } from 'zod';

interface RegisterTradingControlRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
}

export function registerTradingControlRoutes(
  app: Express,
  deps: RegisterTradingControlRoutesDeps = {},
): void {
  const logger = deps.logger ?? createLogger('integrations-service');

  // GET /api/integrations/trading/control-history - Histórico de handover/takeover
  app.get('/api/integrations/trading/control-history', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const authContext = extractAuthContext(req);
      if (!authContext?.tenantId || !authContext?.userId) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const querySchema = z.object({
        limit: z.coerce.number().int().min(1).max(200).optional(),
      });
      const queryResult = querySchema.safeParse(req.query);
      if (!queryResult.success) {
        res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
        return;
      }

      const limit = queryResult.data.limit ?? 50;
      const db = getDatabase();

      const history = await db
        .select()
        .from(schema.tradingControlHistory)
        .where(eq(schema.tradingControlHistory.tenantId, authContext.tenantId))
        .orderBy(desc(schema.tradingControlHistory.criadoEm))
        .limit(limit);

      const formattedHistory = history.map((entry) => ({
        id: entry.id,
        previousMode: entry.previousMode,
        newMode: entry.newMode,
        changedBy: entry.changedBy,
        reason: entry.reason,
        source: (entry.metadata as Record<string, unknown>)?.source || 'unknown',
        createdAt: entry.criadoEm?.toISOString() || new Date().toISOString(),
      }));

      res.json({
        success: true,
        data: formattedHistory,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao obter histórico de controle de trading');
      res.status(500).json({ error: errorMessage });
    }
  });

  // POST /api/integrations/trading/control - Mudar modo de controle (handover/takeover)
  app.post('/api/integrations/trading/control', requirePermission('integrations:trading:manage'), async (req: Request, res: Response) => {
    try {
      const authContext = extractAuthContext(req);
      if (!authContext?.tenantId || !authContext?.userId) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const controlSchema = z.object({
        mode: z.enum(['alice', 'manual']).optional(),
        action: z.enum(['takeover', 'handback']).optional(),
        reason: z.string().max(500).optional(),
        source: z.string().max(50).optional(),
      }).superRefine((data, ctx) => {
        if (!data.mode && !data.action) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'mode ou action é obrigatório',
            path: ['mode'],
          });
          return;
        }
        if (data.mode && data.action) {
          const expectedMode = data.action === 'takeover' ? 'manual' : 'alice';
          if (data.mode !== expectedMode) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `mode e action conflitantes. Para action=${data.action}, mode deve ser ${expectedMode}.`,
              path: ['action'],
            });
          }
        }
      });

      const parsed = controlSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Dados inválidos',
          details: parsed.error.errors,
        });
        return;
      }

      const requestedMode = parsed.data.mode
        ?? (parsed.data.action === 'takeover' ? 'manual' : 'alice');
      if (requestedMode === 'alice') {
        res.status(400).json({ error: 'Auto-execução de sinais está desativada para este tenant.' });
        return;
      }

      const action = parsed.data.action ?? 'takeover';
      const { reason, source } = parsed.data;
      const db = getDatabase();

      const [currentConfig] = await db
        .select()
        .from(schema.tradingRiskConfig)
        .where(eq(schema.tradingRiskConfig.tenantId, authContext.tenantId))
        .limit(1);

      if (!currentConfig) {
        res.status(404).json({ error: 'Configuração de trading não encontrada para este tenant' });
        return;
      }

      const previousMode = currentConfig.autoExecuteSignals ? 'alice' : 'manual';
      if (previousMode === requestedMode) {
        res.json({
          success: true,
          data: {
            previousMode,
            newMode: requestedMode,
            action,
            message: `Trading já está em modo ${requestedMode}`,
            changed: false,
          },
        });
        return;
      }

      await db
        .update(schema.tradingRiskConfig)
        .set({
          autoExecuteSignals: false,
          atualizadoEm: new Date(),
        })
        .where(eq(schema.tradingRiskConfig.tenantId, authContext.tenantId));

      const [historyEntry] = await db
        .insert(schema.tradingControlHistory)
        .values({
          tenantId: authContext.tenantId,
          previousMode,
          newMode: requestedMode,
          changedBy: authContext.userId,
          reason: reason || 'Takeover manual solicitado',
          metadata: {
            source: source || 'api',
            timestamp: new Date().toISOString(),
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
          },
        })
        .returning();

      logger.info({
        tenantId: authContext.tenantId,
        userId: authContext.userId,
        previousMode,
        newMode: requestedMode,
        reason,
        historyId: historyEntry?.id,
      }, 'Modo de controle de trading alterado');

      try {
        const publisher = getPublisher();
        if (publisher.isPublisherConnected()) {
          await publisher.publishControlChange({
            action,
            tenantId: authContext.tenantId,
            userId: authContext.userId,
            previousMode,
            newMode: requestedMode,
            reason,
          });
        } else {
          logger.warn('Redis publisher não conectado - broadcast de controle não enviado');
        }
      } catch (broadcastError) {
        logger.warn(
          { error: broadcastError instanceof Error ? broadcastError.message : 'Erro desconhecido' },
          'Falha ao publicar broadcast de controle',
        );
      }

      res.json({
        success: true,
        data: {
          previousMode,
          newMode: requestedMode,
          action,
          message: 'Controle manual assumido com sucesso',
          changed: true,
          historyId: historyEntry?.id,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao alterar modo de controle de trading');
      res.status(500).json({ error: errorMessage });
    }
  });
}
