import pLimit from 'p-limit';
import { createLogger } from '@alice/logger';
import type { Database } from '@alice/database';
import { mediaJobs } from '@alice/database';
import { sql, eq } from '@alice/database';

const logger = createLogger('media-worker');

interface MediaWorkerConfig {
  tenantId: string;
  concurrency: number;
  pollIntervalMs: number;
  maxAttempts: number;
}

export function startMediaWorker(db: Database, config: MediaWorkerConfig) {
  const limit = pLimit(config.concurrency);

  async function fetchNextJob() {
    const result = await db.execute<any>(sql`
      SELECT * FROM media_jobs
      WHERE tenant_id = ${config.tenantId}
        AND status = 'pending'
        AND (agendado_para IS NULL OR agendado_para <= NOW())
      ORDER BY prioridade ASC, agendado_para NULLS FIRST, criado_em ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);
    return result.rows[0] || null;
  }

  async function markStatus(id: string, status: 'processing' | 'completed' | 'failed', erro?: string | null) {
    await db
      .update(mediaJobs)
      .set({
        status,
        erro: erro ?? null,
        tentativas: status === 'processing' ? sql`${mediaJobs.tentativas} + 1` : mediaJobs.tentativas,
        iniciadoEm: status === 'processing' ? sql`NOW()` : mediaJobs.iniciadoEm,
        finalizadoEm: status === 'completed' || status === 'failed' ? sql`NOW()` : mediaJobs.finalizadoEm,
      })
      .where(eq(mediaJobs.id, id));
  }

  async function processLoop() {
    try {
      const job = await fetchNextJob();
      if (!job) return;

      await limit(async () => {
        await markStatus(job.id, 'processing');
        try {
          // Placeholder: integração Salad/TTS/talking-head/lip-sync/long-video
          await markStatus(job.id, 'completed');
        } catch (error) {
          const attempts = (job.tentativas ?? 0) + 1;
          const status = attempts >= (job.maxTentativas ?? config.maxAttempts) ? 'failed' : 'pending';
          await db
            .update(mediaJobs)
            .set({
              status,
              erro: (error as Error).message,
              tentativas: attempts,
            })
            .where(eq(mediaJobs.id, job.id));
        }
      });
    } catch (error) {
      logger.error({ error }, 'Erro no loop do media-worker');
    }
  }

  setInterval(processLoop, config.pollIntervalMs).unref();
  logger.info({ tenantId: config.tenantId, pollIntervalMs: config.pollIntervalMs }, 'Media worker iniciado');
}
