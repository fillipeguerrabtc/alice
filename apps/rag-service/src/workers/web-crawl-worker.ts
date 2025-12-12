import pLimit from 'p-limit';
import { createLogger } from '@alice/logger';
import type { Database } from '@alice/database';
import { webCrawlRequests, webCrawlResults } from '@alice/database';
import { sql, eq } from '@alice/database';
import { createWebSearchClient } from '../web-search.js';

const logger = createLogger('web-crawl-worker');

interface WebCrawlWorkerConfig {
  tenantId: string;
  concurrency: number;
  pollIntervalMs: number;
  maxAttempts: number;
  searxngUrl: string;
  searxngKey?: string;
}

export function startWebCrawlWorker(db: Database, config: WebCrawlWorkerConfig) {
  const limit = pLimit(config.concurrency);
  const webClient = createWebSearchClient({
    baseUrl: config.searxngUrl,
    apiKey: config.searxngKey,
    logger,
    metrics: { registry: {} as any } as any, // placeholder metrics
  });

  async function fetchNextRequest() {
    const result = await db.execute<any>(sql`
      SELECT * FROM web_crawl_requests
      WHERE tenant_id = ${config.tenantId}
        AND status = 'pending'
        AND (agendado_para IS NULL OR agendado_para <= NOW())
      ORDER BY prioridade ASC, agendado_para NULLS FIRST, criado_em ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);
    return result.rows[0] || null;
  }

  async function updateRequestStatus(id: string, status: 'running' | 'completed' | 'failed', erro?: string | null) {
    await db
      .update(webCrawlRequests)
      .set({
        status,
        erro: erro ?? null,
        iniciadoEm: status === 'running' ? sql`NOW()` : webCrawlRequests.iniciadoEm,
        finalizadoEm: status === 'completed' || status === 'failed' ? sql`NOW()` : webCrawlRequests.finalizadoEm,
      })
      .where(eq(webCrawlRequests.id, id));
  }

  async function processLoop() {
    try {
      const req = await fetchNextRequest();
      if (!req) return;

      await limit(async () => {
        await updateRequestStatus(req.id, 'running');
        try {
          const results = await webClient.search(req.url, req.paginas_max ?? 5);
          for (const r of results) {
            await db.insert(webCrawlResults).values({
              tenantId: config.tenantId,
              requestId: req.id,
              url: r.url,
              titulo: r.title,
              conteudo: r.description,
              metadata: {},
            });
          }
          await updateRequestStatus(req.id, 'completed');
        } catch (error) {
          await updateRequestStatus(req.id, 'failed', (error as Error).message);
        }
      });
    } catch (error) {
      logger.error({ error }, 'Erro no loop do web-crawl-worker');
    }
  }

  setInterval(processLoop, config.pollIntervalMs).unref();
  logger.info({ tenantId: config.tenantId, pollIntervalMs: config.pollIntervalMs }, 'Web-crawl worker iniciado');
}
