import pLimit from 'p-limit';
import { createLearningTask, dequeueNextLearningTask, updateLearningTaskStatus } from '../learning-orchestrator.js';
import { createLogger } from '@alice/logger';
import type { Database } from '@alice/database';

const logger = createLogger('learning-worker');

interface LearningWorkerConfig {
  tenantId: string;
  concurrency: number;
  pollIntervalMs: number;
  maxAttempts: number;
}

export function startLearningWorker(db: Database, config: LearningWorkerConfig) {
  const limit = pLimit(config.concurrency);

  async function processLoop() {
    try {
      const task = await dequeueNextLearningTask(db, logger, config.tenantId);
      if (!task) return;

      await limit(async () => {
        try {
          // Placeholder: business logic será plugado pelo orchestrator de treinamento
          await updateLearningTaskStatus(db, logger, {
            taskId: task.id,
            tenantId: config.tenantId,
            status: 'completed',
            progresso: 100,
            resultado: { message: 'Processado pelo worker stub' },
          });
        } catch (error) {
          const attempts = (task.tentativas ?? 0) + 1;
          const status = attempts >= (task.maxTentativas ?? config.maxAttempts) ? 'failed' : 'pending';
          await updateLearningTaskStatus(db, logger, {
            taskId: task.id,
            tenantId: config.tenantId,
            status,
            erro: (error as Error).message,
          });
        }
      });
    } catch (error) {
      logger.error({ error }, 'Erro no loop do learning-worker');
    }
  }

  setInterval(processLoop, config.pollIntervalMs).unref();
  logger.info({ tenantId: config.tenantId, pollIntervalMs: config.pollIntervalMs }, 'Learning worker iniciado');
}
