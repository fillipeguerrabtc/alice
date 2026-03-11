import type { Express } from 'express';
import { connectWithRetry } from '@alice/database';
import { registerShutdownCallback, ShutdownPriority } from '@alice/shared-utils';

interface TrainingBootstrapLogger {
  info: (obj: object | string, msg?: string) => void;
  warn: (obj: object | string, msg?: string) => void;
  error: (obj: object | string, msg?: string) => void;
  fatal: (obj: object | string, msg?: string) => void;
}

type WorkerStopper = () => Promise<void>;

interface StartTrainingBootstrapParams {
  app: Express;
  logger: TrainingBootstrapLogger;
  port: number;
  trainingHttpServerTimeoutMs: number;
  trainingMetricsIntervalMs: number;
  trainingImmutableAuditCheckIntervalMs: number;
  namespaceProfileReconcileIntervalMs: number;
  trainingSchedulerPollMs: number;
  connectWithRetryMaxRetries: number;
  connectWithRetryInitialDelayMs: number;
  initializeAutoLearningScheduler: () => void;
  validateEmbeddingDimensionsSSOT: () => Promise<void>;
  initializeRedisCache: () => Promise<unknown>;
  initializeSessionAuthCache: () => Promise<unknown>;
  createAndStartWorkers: () => Array<WorkerStopper>;
  onServiceListening: () => {
    startTrainingMetricsScheduler: () => void;
    startTrainingImmutableAuditIntegrityScheduler: () => void;
    startNamespaceProfileReconcileScheduler: () => void;
    processScheduledJobs: () => Promise<unknown>;
    incrementSchedulerRunsMetric: (result: 'success' | 'error') => void;
    resumePendingFineTuningJobs: () => Promise<void>;
    resumePendingLoraJobs: () => Promise<void>;
  };
  stopTrainingMetricsScheduler: () => void;
  stopTrainingImmutableAuditIntegrityScheduler: () => void;
  stopNamespaceProfileReconcileScheduler: () => void;
  closeRedisCacheClient: () => Promise<void>;
  closeDatabasePool: () => Promise<void>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startTrainingBootstrap(params: StartTrainingBootstrapParams): Promise<void> {
  const {
    app,
    logger,
    port,
    trainingHttpServerTimeoutMs,
    trainingMetricsIntervalMs,
    trainingImmutableAuditCheckIntervalMs,
    namespaceProfileReconcileIntervalMs,
    trainingSchedulerPollMs,
    connectWithRetryMaxRetries,
    connectWithRetryInitialDelayMs,
    initializeAutoLearningScheduler,
    validateEmbeddingDimensionsSSOT,
    initializeRedisCache,
    initializeSessionAuthCache,
    createAndStartWorkers,
    onServiceListening,
    stopTrainingMetricsScheduler,
    stopTrainingImmutableAuditIntegrityScheduler,
    stopNamespaceProfileReconcileScheduler,
    closeRedisCacheClient,
    closeDatabasePool,
  } = params;

  try {
    await connectWithRetry({
      maxRetries: connectWithRetryMaxRetries,
      initialDelayMs: connectWithRetryInitialDelayMs,
      checkPgvector: true,
    });

    initializeAutoLearningScheduler();
    await validateEmbeddingDimensionsSSOT();

    await initializeRedisCache();
    await initializeSessionAuthCache();
    logger.info('Auth cache (session-auth) inicializado');

    const tradingWorkerStoppers = createAndStartWorkers();

    let autoLearningLoopActive = false;
    let resumePendingJobsInterval: NodeJS.Timeout | null = null;

    const server = app.listen(port, '0.0.0.0', () => {
      logger.info(
        {
          port,
          embeddingsConfigured: true,
          fineTuningConfigured: true,
          circuitBreaker: 'enabled',
        },
        'Training service iniciado com Circuit Breaker',
      );

      const runtimeCallbacks = onServiceListening();

      runtimeCallbacks.startTrainingMetricsScheduler();
      logger.info({ intervalMs: trainingMetricsIntervalMs }, 'Scheduler de métricas de training iniciado');

      runtimeCallbacks.startTrainingImmutableAuditIntegrityScheduler();
      logger.info(
        { intervalMs: trainingImmutableAuditCheckIntervalMs },
        'Scheduler de verificacao de integridade do ledger imutavel iniciado',
      );

      runtimeCallbacks.startNamespaceProfileReconcileScheduler();
      logger.info(
        { intervalMs: namespaceProfileReconcileIntervalMs },
        'Scheduler de reconciliação de namespace_profiles iniciado',
      );

      autoLearningLoopActive = true;
      void (async () => {
        while (autoLearningLoopActive) {
          try {
            await runtimeCallbacks.processScheduledJobs();
            runtimeCallbacks.incrementSchedulerRunsMetric('success');
          } catch (error: unknown) {
            runtimeCallbacks.incrementSchedulerRunsMetric('error');
            const errObj = error instanceof Error ? error : new Error(String(error));
            logger.warn({ err: errObj }, 'Falha ao processar jobs agendados de auto-learning');
          }
          await sleep(trainingSchedulerPollMs);
        }
      })();
      logger.info({ intervalMs: trainingSchedulerPollMs }, 'Scheduler de auto-learning iniciado');

      runtimeCallbacks.resumePendingFineTuningJobs().catch((error: unknown) => {
        const errObj = error instanceof Error ? error : new Error(String(error));
        logger.error({ err: errObj }, 'Falha ao retomar jobs de fine-tuning pendentes');
      });

      runtimeCallbacks.resumePendingLoraJobs().catch((error: unknown) => {
        const errObj = error instanceof Error ? error : new Error(String(error));
        logger.error({ err: errObj }, 'Falha ao retomar jobs de trading LoRA pendentes');
      });

      resumePendingJobsInterval = setInterval(() => {
        runtimeCallbacks.resumePendingFineTuningJobs().catch(() => {});
        runtimeCallbacks.resumePendingLoraJobs().catch(() => {});
      }, 30000);
    });

    server.timeout = trainingHttpServerTimeoutMs;
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;
    logger.info(
      {
        serverTimeoutMs: trainingHttpServerTimeoutMs,
        keepAliveTimeoutMs: server.keepAliveTimeout,
        headersTimeoutMs: server.headersTimeout,
      },
      'Timeouts HTTP do training-service configurados',
    );

    registerShutdownCallback(
      'training-http-server',
      async () => {
        logger.info('Encerrando HTTP server...');
        await new Promise<void>((resolve, reject) => {
          server.close((err) => {
            if (err) {
              logger.error({ error: err }, 'Erro ao fechar HTTP server');
              reject(err);
            } else {
              logger.info('HTTP server encerrado com sucesso');
              resolve();
            }
          });
        });
      },
      { priority: ShutdownPriority.HTTP_SERVER },
    );

    registerShutdownCallback(
      'training-redis-cache',
      async () => {
        logger.info('Encerrando cliente Redis cache...');
        await closeRedisCacheClient();
        logger.info('Cliente Redis cache encerrado com sucesso');
      },
      { priority: ShutdownPriority.CACHE },
    );

    registerShutdownCallback(
      'training-metrics-scheduler',
      async () => {
        stopTrainingMetricsScheduler();
      },
      { priority: ShutdownPriority.BACKGROUND_JOBS },
    );

    registerShutdownCallback(
      'training-immutable-audit-integrity-scheduler',
      async () => {
        stopTrainingImmutableAuditIntegrityScheduler();
      },
      { priority: ShutdownPriority.BACKGROUND_JOBS },
    );

    registerShutdownCallback(
      'training-namespace-profile-reconcile-scheduler',
      async () => {
        stopNamespaceProfileReconcileScheduler();
      },
      { priority: ShutdownPriority.BACKGROUND_JOBS },
    );

    registerShutdownCallback(
      'training-trading-workers',
      async () => {
        await Promise.all(tradingWorkerStoppers.map((stop) => stop()));
      },
      { priority: ShutdownPriority.BACKGROUND_JOBS },
    );

    registerShutdownCallback(
      'training-auto-learning-scheduler',
      async () => {
        autoLearningLoopActive = false;
        if (resumePendingJobsInterval) {
          clearInterval(resumePendingJobsInterval);
          resumePendingJobsInterval = null;
        }
      },
      { priority: ShutdownPriority.BACKGROUND_JOBS },
    );

    registerShutdownCallback(
      'training-database-pool',
      async () => {
        logger.info('Encerrando pool de conexões database...');
        await closeDatabasePool();
        logger.info('Pool de conexões encerrado com sucesso');
      },
      { priority: ShutdownPriority.DATABASE },
    );
  } catch (error) {
    logger.fatal(
      { error: error instanceof Error ? error.message : String(error) },
      '❌ FATAL: Falha ao conectar ao PostgreSQL - training-service não pode iniciar',
    );
    process.exit(1);
  }
}
