import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { requireInternalHmacAuth, requirePermission } from '@alice/shared-utils';
import {
  getAllSystemConfig,
  normalizeSystemConfigValue,
  setSystemConfig,
  SYSTEM_CONFIG_KNOWN_KEYS,
} from '@alice/database/system-config';
import { z } from 'zod';

type ImmutableAuditIntegrityHealthState = {
  status: 'unknown' | 'ok' | 'error';
  checkedAt: string | null;
  checkedStreams: number;
  brokenStreams: number;
  reason: string | null;
};

type TradingQueueNames = {
  universe: string;
  backtest: string;
  calibration: string;
  rebalance: string;
  modelRisk: string;
  portfolioAutoRun: string;
  signalAutoRun: string;
};

type EmbeddingsCircuitBreakerSnapshot = {
  opened: boolean;
  halfOpen: boolean;
  stats: {
    failures: number;
    successes: number;
    timeouts: number;
  };
};

type TradingEnqueueBasePayload = {
  tenantId: string;
  idempotencyKey: string;
};

type TradingUniverseEnqueuePayload = TradingEnqueueBasePayload & {
  instrumentId?: string;
};

type TradingBacktestEnqueuePayload = TradingEnqueueBasePayload & {
  strategyKey?: string;
};

type TradingCalibrationEnqueuePayload = TradingEnqueueBasePayload & {
  strategyKey?: string;
};

type TradingRebalanceEnqueuePayload = TradingEnqueueBasePayload & {
  portfolioId?: string;
};

type TradingModelRiskEnqueuePayload = TradingEnqueueBasePayload & {
  scope?: string;
  scopeKey?: string;
};

type TradingAutoPortfolioPayload = {
  runId: string;
  correlationId: string;
} & Record<string, unknown>;

type TradingAutoSignalPayload = {
  runId: string;
  correlationId: string;
} & Record<string, unknown>;

interface RegisterTrainingPlatformRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  getEmbeddingsCircuitBreakerSnapshot: () => EmbeddingsCircuitBreakerSnapshot;
  getImmutableAuditIntegrityState: () => ImmutableAuditIntegrityHealthState;
  isPoolHealthy: () => Promise<boolean>;
  tradingQueueNames: TradingQueueNames;
  enqueueTradingJob: (queueName: string, payload: Record<string, unknown>) => Promise<void>;
  parseTradingUniverseEnqueuePayload: (body: unknown) => TradingUniverseEnqueuePayload;
  parseTradingBacktestEnqueuePayload: (body: unknown) => TradingBacktestEnqueuePayload;
  parseTradingCalibrationEnqueuePayload: (body: unknown) => TradingCalibrationEnqueuePayload;
  parseTradingRebalanceEnqueuePayload: (body: unknown) => TradingRebalanceEnqueuePayload;
  parseTradingModelRiskEnqueuePayload: (body: unknown) => TradingModelRiskEnqueuePayload;
  parseTradingAutoPortfolioPayload: (body: unknown) => TradingAutoPortfolioPayload;
  parseTradingAutoSignalPayload: (body: unknown) => TradingAutoSignalPayload;
  buildTradingIdempotencyKey: (queueName: string, payload: Record<string, unknown>) => string;
}

const systemConfigPatchSchema = z.object({
  configs: z.record(z.string().min(1), z.string().min(1)),
});

const SYSTEM_CONFIG_PATCH_KEYS = [...SYSTEM_CONFIG_KNOWN_KEYS] as const;

export function registerTrainingPlatformRoutes(
  app: Express,
  deps: RegisterTrainingPlatformRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('training-service');

  app.get('/api/training/health', async (_req: Request, res: Response) => {
    const embeddingsCircuit = deps.getEmbeddingsCircuitBreakerSnapshot();
    const embeddingsCircuitState = embeddingsCircuit.opened ? 'open' : (embeddingsCircuit.halfOpen ? 'half-open' : 'closed');
    const immutableAuditState = deps.getImmutableAuditIntegrityState();
    const immutableAuditDegraded = immutableAuditState.status === 'error';
    const overallStatus = (embeddingsCircuitState === 'open' || immutableAuditDegraded) ? 'degraded' : 'ok';

    res.json({
      status: overallStatus,
      service: 'training-service',
      timestamp: new Date().toISOString(),
      embeddingsProvider: 'gpu-manager-service',
      model: 'Qwen/Qwen3-Embedding-0.6B (1024 dim -> Qdrant)',
      fineTuningStatus: 'enabled',
      circuitBreakers: {
        embeddings: {
          state: embeddingsCircuitState,
          stats: {
            failures: embeddingsCircuit.stats.failures,
            successes: embeddingsCircuit.stats.successes,
            timeouts: embeddingsCircuit.stats.timeouts,
          },
        },
      },
      immutableAuditIntegrity: immutableAuditState,
    });
  });

  app.get('/live', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'alive',
      service: 'training-service',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/ready', async (_req: Request, res: Response) => {
    try {
      const dbHealthy = await deps.isPoolHealthy();
      const embeddingsReady = !deps.getEmbeddingsCircuitBreakerSnapshot().opened;
      const allReady = dbHealthy && embeddingsReady;

      if (allReady) {
        res.status(200).json({
          status: 'ready',
          service: 'training-service',
          timestamp: new Date().toISOString(),
          dependencies: {
            postgresql: 'ready',
            embeddings: 'ready',
          },
        });
        return;
      }

      res.status(503).json({
        status: 'not_ready',
        service: 'training-service',
        reason: !dbHealthy ? 'PostgreSQL nao esta acessivel' : 'Embeddings circuit breaker aberto',
        timestamp: new Date().toISOString(),
        dependencies: {
          postgresql: dbHealthy ? 'ready' : 'not_ready',
          embeddings: embeddingsReady ? 'ready' : 'circuit_open',
        },
      });
    } catch (error) {
      logger.error({ error }, 'Erro ao verificar readiness');
      res.status(503).json({
        status: 'not_ready',
        service: 'training-service',
        reason: 'Erro ao verificar dependencias',
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.post('/internal/trading/enqueue/universe-scan', requireInternalHmacAuth(), async (req: Request, res: Response) => {
    const payload = deps.parseTradingUniverseEnqueuePayload(req.body);
    await deps.enqueueTradingJob(deps.tradingQueueNames.universe, payload as Record<string, unknown>);
    logger.info({ tenantId: payload.tenantId, instrumentId: payload.instrumentId, queue: deps.tradingQueueNames.universe }, 'Trading universe scan enfileirado');
    res.status(202).json({ queued: true, queue: deps.tradingQueueNames.universe, idempotencyKey: payload.idempotencyKey });
  });

  app.post('/internal/trading/enqueue/backtest', requireInternalHmacAuth(), async (req: Request, res: Response) => {
    const payload = deps.parseTradingBacktestEnqueuePayload(req.body);
    await deps.enqueueTradingJob(deps.tradingQueueNames.backtest, payload as Record<string, unknown>);
    logger.info({ tenantId: payload.tenantId, strategyKey: payload.strategyKey, queue: deps.tradingQueueNames.backtest }, 'Trading backtest enfileirado');
    res.status(202).json({ queued: true, queue: deps.tradingQueueNames.backtest, idempotencyKey: payload.idempotencyKey });
  });

  app.post('/internal/trading/enqueue/calibration', requireInternalHmacAuth(), async (req: Request, res: Response) => {
    const payload = deps.parseTradingCalibrationEnqueuePayload(req.body);
    await deps.enqueueTradingJob(deps.tradingQueueNames.calibration, payload as Record<string, unknown>);
    logger.info({ tenantId: payload.tenantId, strategyKey: payload.strategyKey, queue: deps.tradingQueueNames.calibration }, 'Trading calibration enfileirado');
    res.status(202).json({ queued: true, queue: deps.tradingQueueNames.calibration, idempotencyKey: payload.idempotencyKey });
  });

  app.post('/internal/trading/enqueue/portfolio-rebalance', requireInternalHmacAuth(), async (req: Request, res: Response) => {
    const payload = deps.parseTradingRebalanceEnqueuePayload(req.body);
    await deps.enqueueTradingJob(deps.tradingQueueNames.rebalance, payload as Record<string, unknown>);
    logger.info({ tenantId: payload.tenantId, portfolioId: payload.portfolioId, queue: deps.tradingQueueNames.rebalance }, 'Trading rebalance enfileirado');
    res.status(202).json({ queued: true, queue: deps.tradingQueueNames.rebalance, idempotencyKey: payload.idempotencyKey });
  });

  app.post('/internal/trading/enqueue/model-risk', requireInternalHmacAuth(), async (req: Request, res: Response) => {
    const payload = deps.parseTradingModelRiskEnqueuePayload(req.body);
    await deps.enqueueTradingJob(deps.tradingQueueNames.modelRisk, payload as Record<string, unknown>);
    logger.info({ tenantId: payload.tenantId, scope: payload.scope, scopeKey: payload.scopeKey, queue: deps.tradingQueueNames.modelRisk }, 'Trading model risk enfileirado');
    res.status(202).json({ queued: true, queue: deps.tradingQueueNames.modelRisk, idempotencyKey: payload.idempotencyKey });
  });

  app.post('/internal/trading/auto/portfolio-run', requireInternalHmacAuth(), async (req: Request, res: Response) => {
    try {
      const payload = deps.parseTradingAutoPortfolioPayload(req.body);
      const idempotencyKey = deps.buildTradingIdempotencyKey(deps.tradingQueueNames.portfolioAutoRun, payload);
      await deps.enqueueTradingJob(deps.tradingQueueNames.portfolioAutoRun, { ...payload, idempotencyKey });
      logger.info({ runId: payload.runId, correlationId: payload.correlationId }, 'Portfolio auto run enfileirado');
      res.status(202).json({ queued: true, queue: deps.tradingQueueNames.portfolioAutoRun });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao enfileirar portfolio auto run');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.post('/internal/trading/auto/signal-run', requireInternalHmacAuth(), async (req: Request, res: Response) => {
    try {
      const payload = deps.parseTradingAutoSignalPayload(req.body);
      const idempotencyKey = deps.buildTradingIdempotencyKey(deps.tradingQueueNames.signalAutoRun, payload);
      await deps.enqueueTradingJob(deps.tradingQueueNames.signalAutoRun, { ...payload, idempotencyKey });
      logger.info({ runId: payload.runId, correlationId: payload.correlationId }, 'Signal auto run enfileirado');
      res.status(202).json({ queued: true, queue: deps.tradingQueueNames.signalAutoRun });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao enfileirar signal auto run');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/training/system-config', requirePermission('config:system:read'), async (_req: Request, res: Response) => {
    try {
      const config = await getAllSystemConfig();
      res.json(config);
    } catch (error) {
      logger.error({ error }, 'Erro ao obter system config');
      res.status(500).json({ error: 'Erro ao obter configuracoes' });
    }
  });

  app.patch('/api/training/system-config', requirePermission('config:system:write'), async (req: Request, res: Response) => {
    try {
      const body = systemConfigPatchSchema.parse(req.body);
      const unknownKeys = Object.keys(body.configs).filter(
        (key) => !SYSTEM_CONFIG_PATCH_KEYS.includes(key as (typeof SYSTEM_CONFIG_PATCH_KEYS)[number]),
      );
      if (unknownKeys.length > 0) {
        res.status(400).json({
          error: 'Chaves de configuracao desconhecidas',
          unknownKeys,
        });
        return;
      }
      for (const [key, value] of Object.entries(body.configs)) {
        const normalized = normalizeSystemConfigValue(
          key as (typeof SYSTEM_CONFIG_PATCH_KEYS)[number],
          String(value),
        );
        await setSystemConfig(key, normalized);
      }
      const config = await getAllSystemConfig();
      res.json(config);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Payload invalido', details: error.flatten() });
        return;
      }
      logger.error({ error }, 'Erro ao atualizar system config');
      res.status(500).json({ error: 'Erro ao atualizar configuracoes' });
    }
  });
}
