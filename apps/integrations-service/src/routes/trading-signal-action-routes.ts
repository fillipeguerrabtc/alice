import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { and, eq } from '@alice/database';
import { getDatabase, schema } from '@alice/database';
import { extractAuthContext, requirePermission } from '@alice/shared-utils';
import { z } from 'zod';

type TradingMarketType = 'futures' | 'spot' | 'margin';
type TradingMarginMode = 'cross' | 'isolated';

interface TradingAuthContext {
  tenantId: string;
  userId: string;
}

interface TradingOperationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  auditLogId?: string;
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

interface RegisterTradingSignalActionRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  sendKucoinErrorResponse: (res: Response, error: unknown) => boolean;
  resolveTradingSymbolOrRespond: (
    res: Response,
    authContext: TradingAuthContext,
    symbol?: string,
    options?: { required?: boolean; marketType?: TradingMarketType; marginMode?: TradingMarginMode },
  ) => Promise<string | undefined>;
  createSignal: (
    authContext: TradingAuthContext,
    params: {
      signalType: 'entry_long' | 'entry_short' | 'exit' | 'adjust_sl' | 'adjust_tp' | 'hold' | 'neutral';
      symbol?: string;
      marketType?: TradingMarketType;
      marginMode?: TradingMarginMode;
      confidence: number;
      reasoning?: string;
      sourceModel?: string;
      suggestedPrice?: number;
      suggestedStopLoss?: number;
      suggestedTakeProfit?: number;
      suggestedSize?: number;
      metadata?: Record<string, unknown>;
    },
  ) => Promise<TradingOperationResult<schema.TradingSignal>>;
  deactivateSignal: (
    authContext: TradingAuthContext,
    signalId: string,
  ) => Promise<TradingOperationResult<schema.TradingSignal>>;
  createPendingOrderFromSignal: (
    authContext: TradingAuthContext,
    signalId: string,
    reason?: string,
    overrides?: {
      orderType?: 'limit' | 'market' | 'stop_limit' | 'stop_market' | 'take_profit';
      size?: number;
      price?: number;
      leverage?: number;
      stopLoss?: number;
      takeProfit?: number;
    },
  ) => Promise<TradingOperationResult<schema.TradingOrder>>;
  rejectSignal: (
    authContext: TradingAuthContext,
    signalId: string,
    reason?: string,
  ) => Promise<TradingOperationResult<schema.TradingSignal>>;
  recordTradingAuditEvent: (params: {
    authContext: TradingAuthContext;
    action: string;
    entityType: string;
    entityId: string;
    details: Record<string, unknown>;
    previousState?: Record<string, unknown>;
    newState?: Record<string, unknown>;
  }) => Promise<{ auditLogId: string }>;
  createTradingDatasetFromSignalSource: (params: {
    authContext: TradingAuthContext;
    signal: schema.TradingSignal;
    reviewNotes?: string;
  }) => Promise<TradingDatasetCreationResult>;
}

const createSignalBodySchema = z.object({
  signalType: z.enum(['entry_long', 'entry_short', 'exit', 'adjust_sl', 'adjust_tp', 'hold', 'neutral']),
  symbol: z.string().optional(),
  marketType: z.enum(['futures', 'spot', 'margin']).optional(),
  marginMode: z.enum(['cross', 'isolated']).optional(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().optional(),
  sourceModel: z.string().optional(),
  suggestedPrice: z.number().positive().optional(),
  suggestedStopLoss: z.number().positive().optional(),
  suggestedTakeProfit: z.number().positive().optional(),
  suggestedSize: z.number().positive().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const tradingUuidParamSchema = z.object({
  id: z.string().uuid('ID deve ser UUID válido'),
});

const optionalReasonSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().max(500).optional());

const approveSignalBodySchema = z.object({
  reason: optionalReasonSchema,
  overrides: z.object({
    orderType: z.enum(['limit', 'market', 'stop_limit', 'stop_market', 'take_profit']).optional(),
    size: z.number().positive().optional(),
    price: z.number().positive().optional(),
    leverage: z.number().min(1).max(100).optional(),
    stopLoss: z.number().positive().optional(),
    takeProfit: z.number().positive().optional(),
  }).optional(),
});

const rejectSignalBodySchema = z.object({
  reason: optionalReasonSchema,
});

function getTradingAuthContext(req: Request): TradingAuthContext | null {
  const authContext = extractAuthContext(req);
  if (!authContext?.tenantId || !authContext?.userId) {
    return null;
  }
  return { tenantId: authContext.tenantId, userId: authContext.userId };
}

export function registerTradingSignalActionRoutes(
  app: Express,
  deps: RegisterTradingSignalActionRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');

  app.post('/api/integrations/trading/signals', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }
      const validatedResult = createSignalBodySchema.safeParse(req.body);
      if (!validatedResult.success) {
        res.status(400).json({ error: 'Dados inválidos', details: validatedResult.error.flatten() });
        return;
      }
      const validated = validatedResult.data;
      const symbolParam = validated.symbol;
      const marketType = validated.marketType;
      const marginMode = validated.marginMode;
      const resolvedSymbol = symbolParam
        ? await deps.resolveTradingSymbolOrRespond(res, authContext, symbolParam, { required: true, marketType, marginMode })
        : undefined;
      if (symbolParam && !resolvedSymbol) return;

      const metadata = {
        ...(validated.metadata ?? {}),
        createdByUserId: authContext.userId,
      };
      const result = await deps.createSignal(
        authContext,
        { ...validated, symbol: resolvedSymbol, marketType, marginMode, metadata },
      );

      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }

      res.status(201).json({
        success: true,
        data: result.data,
        auditLogId: result.auditLogId,
      });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao criar sinal');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.delete('/api/integrations/trading/signals/:id', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
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

      const { id } = paramResult.data;
      const result = await deps.deactivateSignal(authContext, id);

      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }

      res.json({
        success: true,
        data: result.data,
      });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao desativar sinal');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.post('/api/integrations/trading/signals/:id/approve', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
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
      const bodyResult = approveSignalBodySchema.safeParse(req.body ?? {});
      if (!bodyResult.success) {
        res.status(400).json({ error: 'Dados inválidos', details: bodyResult.error.flatten() });
        return;
      }

      const db = getDatabase();
      const [signal] = await db
        .select()
        .from(schema.tradingSignals)
        .where(and(eq(schema.tradingSignals.id, paramResult.data.id), eq(schema.tradingSignals.tenantId, authContext.tenantId)))
        .limit(1);

      if (!signal) {
        res.status(404).json({ error: 'Sinal não encontrado.' });
        return;
      }

      const trainingOnlyTypes = ['neutral', 'hold'];
      if (trainingOnlyTypes.includes(signal.signalType)) {
        const datasetResult = await deps.createTradingDatasetFromSignalSource({
          authContext,
          signal,
          reviewNotes: bodyResult.data.reason,
        });

        const existingMetadata = (signal.metadata ?? {}) as Record<string, unknown>;
        const updatedMetadata = {
          ...existingMetadata,
          approvalStatus: 'approved',
          approvedAt: new Date().toISOString(),
          approvedBy: authContext.userId,
          approvalReason: bodyResult.data.reason ?? undefined,
          approvalType: 'training_only',
        };
        const [updatedSignal] = await db
          .update(schema.tradingSignals)
          .set({
            metadata: updatedMetadata as typeof signal.metadata,
            isActive: false,
          })
          .where(eq(schema.tradingSignals.id, signal.id))
          .returning();

        const auditResult = await deps.recordTradingAuditEvent({
          authContext,
          action: 'APPROVE_SIGNAL_TRAINING_ONLY',
          entityType: 'signal',
          entityId: signal.id,
          details: {
            reason: bodyResult.data.reason ?? null,
            dataset: {
              id: datasetResult.dataset.id,
              status: datasetResult.status,
              created: datasetResult.created,
              qualityScore: datasetResult.qualityScore,
              isDuplicate: datasetResult.duplicate.isDuplicate,
            },
          },
          previousState: signal as unknown as Record<string, unknown>,
          newState: updatedSignal as unknown as Record<string, unknown>,
        });

        logger.info(
          {
            signalId: signal.id,
            signalType: signal.signalType,
            userId: authContext.userId,
            datasetId: datasetResult.dataset.id,
            datasetStatus: datasetResult.status,
            datasetCreated: datasetResult.created,
            auditLogId: auditResult.auditLogId,
          },
          'Sinal neutral/hold aprovado para treinamento com dataset gerado (sem ordem criada)',
        );

        const datasetReviewMessage =
          datasetResult.status === 'pending'
            ? 'dataset enviado para revisão'
            : datasetResult.status === 'rejected'
              ? 'dataset rejeitado automaticamente por regras de qualidade/duplicidade'
              : `dataset com status ${datasetResult.status}`;

        res.status(200).json({
          success: true,
          data: {
            signalId: signal.id,
            signalType: signal.signalType,
            approvalType: 'training_only',
            dataset: {
              id: datasetResult.dataset.id,
              status: datasetResult.status,
              created: datasetResult.created,
              qualityScore: datasetResult.qualityScore,
              isDuplicate: datasetResult.duplicate.isDuplicate,
            },
            auditLogId: auditResult.auditLogId,
            message: `Sinal ${signal.signalType.toUpperCase()} aprovado para treinamento e ${datasetReviewMessage}. Nenhuma ordem foi criada.`,
          },
        });
        return;
      }

      const result = await deps.createPendingOrderFromSignal(
        authContext,
        paramResult.data.id,
        bodyResult.data.reason,
        bodyResult.data.overrides,
      );

      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }

      res.status(201).json({
        success: true,
        data: result.data,
      });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao aprovar sinal');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.post('/api/integrations/trading/signals/:id/reject', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
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
      const bodyResult = rejectSignalBodySchema.safeParse(req.body ?? {});
      if (!bodyResult.success) {
        res.status(400).json({ error: 'Dados inválidos', details: bodyResult.error.flatten() });
        return;
      }

      const result = await deps.rejectSignal(
        authContext,
        paramResult.data.id,
        bodyResult.data.reason,
      );

      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }

      res.json({
        success: true,
        data: result.data,
      });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao rejeitar sinal');
      res.status(500).json({ error: errorMessage });
    }
  });
}
