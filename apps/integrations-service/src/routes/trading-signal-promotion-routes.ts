import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { schema } from '@alice/database';
import { extractAuthContext, requirePermission } from '@alice/shared-utils';
import { z } from 'zod';
import { TradingSignalPromotionError } from '../trading-signal-promotion-service.js';

interface TradingAuthContext {
  tenantId: string;
  userId: string;
}

interface RegisterTradingSignalPromotionRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  sendKucoinErrorResponse: (res: Response, error: unknown) => boolean;
  getSignalPromotionPath: (params: {
    authContext: TradingAuthContext;
    signalId: string;
  }) => Promise<unknown>;
  findSignalById: (params: {
    authContext: TradingAuthContext;
    signalId: string;
  }) => Promise<schema.TradingSignal>;
  promoteSignalRealEligibility: (params: {
    authContext: TradingAuthContext;
    signal: schema.TradingSignal;
    reason: string;
  }) => Promise<unknown>;
}

const tradingUuidParamSchema = z.object({
  id: z.string().uuid('ID deve ser UUID válido'),
});

const promoteRealEligibilityBodySchema = z.object({
  reason: z.string().min(10).max(2000),
});

function getTradingAuthContext(req: Request): TradingAuthContext | null {
  const authContext = extractAuthContext(req);
  if (!authContext?.tenantId || !authContext?.userId) {
    return null;
  }
  return { tenantId: authContext.tenantId, userId: authContext.userId };
}

export function registerTradingSignalPromotionRoutes(
  app: Express,
  deps: RegisterTradingSignalPromotionRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');

  app.get('/api/integrations/trading/signals/:id/promotion-path', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const paramResult = tradingUuidParamSchema.safeParse(req.params);
      if (!paramResult.success) {
        res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
        return;
      }

      const summary = await deps.getSignalPromotionPath({
        authContext,
        signalId: paramResult.data.id,
      });

      res.json({ success: true, data: summary });
    } catch (error) {
      if (error instanceof TradingSignalPromotionError) {
        const status = error.code === 'SIGNAL_NOT_FOUND' ? 404 : 422;
        res.status(status).json({ error: error.message, code: error.code });
        return;
      }
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao consultar promotion path do sinal');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.post('/api/integrations/trading/signals/:id/promote-real-eligibility', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const paramResult = tradingUuidParamSchema.safeParse(req.params);
      if (!paramResult.success) {
        res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
        return;
      }

      const bodyResult = promoteRealEligibilityBodySchema.safeParse(req.body ?? {});
      if (!bodyResult.success) {
        res.status(400).json({ error: 'Dados inválidos', details: bodyResult.error.flatten() });
        return;
      }

      const signal = await deps.findSignalById({
        authContext,
        signalId: paramResult.data.id,
      });

      const updated = await deps.promoteSignalRealEligibility({
        authContext,
        signal,
        reason: bodyResult.data.reason,
      });

      res.json({
        success: true,
        data: updated,
        message: 'Sinal promovido para real eligibility com auditoria registrada.',
      });
    } catch (error) {
      if (error instanceof TradingSignalPromotionError) {
        const status = error.code === 'SIGNAL_NOT_FOUND' ? 404 : 422;
        res.status(status).json({ error: error.message, code: error.code });
        return;
      }
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao promover sinal para real eligibility');
      res.status(500).json({ error: errorMessage });
    }
  });
}
