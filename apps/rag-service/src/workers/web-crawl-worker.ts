import crypto from 'crypto';
import pLimit from 'p-limit';
import { createLogger } from '@alice/logger';
import type { Database } from '@alice/database';
import { webCrawlRequests, webCrawlResults } from '@alice/database';
import { eq, and, asc, sql } from '@alice/database';
import { createWebSearchClient } from '../web-search.js';
import * as cheerio from 'cheerio';

const logger = createLogger('web-crawl-worker');

interface WebCrawlWorkerConfig {
  tenantId: string;
  concurrency: number;
  pollIntervalMs: number;
  maxAttempts: number;
  searxngUrl: string;
  searxngKey?: string;
}

const DEFAULT_USER_AGENT = 'AliceCrawler/1.0 (+https://yesyoudeserve.duckdns.org)';

export function startWebCrawlWorker(db: Database, config: WebCrawlWorkerConfig) {
  const limit = pLimit(config.concurrency);
  // Nota: crawl é feito via HTTP direto; SearXNG não é usado como proxy aqui.

  async function fetchNextRequest() {
    const [row] = await db
      .select()
      .from(webCrawlRequests)
      .where(
        and(
          eq(webCrawlRequests.tenantId, config.tenantId),
          eq(webCrawlRequests.status, 'pending'),
          sql`(${webCrawlRequests.agendadoPara} IS NULL OR ${webCrawlRequests.agendadoPara} <= NOW())`
        )
      )
      .orderBy(
        asc(webCrawlRequests.prioridade),
        sql`${webCrawlRequests.agendadoPara} NULLS FIRST`,
        asc(webCrawlRequests.criadoEm)
      )
      .limit(1)
      .for('update', { skipLocked: true });

    return row || null;
  }

  async function updateRequestStatus(id: string, status: 'running' | 'completed' | 'failed', erro?: string | null) {
    const setData: Record<string, unknown> = {
      status,
      erro: erro ?? null,
    };

    if (status === 'running') {
      setData.iniciadoEm = sql`NOW()`;
    } else if (status === 'completed' || status === 'failed') {
      setData.finalizadoEm = sql`NOW()`;
    }

    await db
      .update(webCrawlRequests)
      .set(setData)
      .where(eq(webCrawlRequests.id, id));
  }

  function normalizeHtml(html: string) {
    const $ = cheerio.load(html);
    const title = ($('title').first().text() || '').trim();
    const desc = ($('meta[name="description"]').attr('content') || '').trim();
    const text = $('body').text().replace(/\s+/g, ' ').trim();
    return {
      title: title || 'Sem título',
      description: desc || text.slice(0, 400),
      content: text.slice(0, 10000),
    };
  }

  async function fetchPage(url: string, bytesMax: number, timeoutMs: number) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'User-Agent': DEFAULT_USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
        signal: controller.signal,
      });

      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > bytesMax) {
        throw new Error(`Página excedeu limite de ${bytesMax} bytes`);
      }

      const mimeType = res.headers.get('content-type') || undefined;
      const { title, description, content } = normalizeHtml(buf.toString('utf8'));
      const hashConteudo = crypto.createHash('sha256').update(buf).digest('hex');

      return {
        statusCode: res.status,
        mimeType,
        tamanhoBytes: buf.byteLength,
        titulo: title,
        conteudo: content,
        description,
        hashConteudo,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function processLoop() {
    try {
      const req = await fetchNextRequest();
      if (!req) return;

      await limit(async () => {
        await updateRequestStatus(req.id, 'running');
        try {
          // Crawl direto da URL solicitada (não mandar URL como query de busca)
          const page = await fetchPage(req.url, req.bytesMax, req.timeoutMs);
          await db.insert(webCrawlResults).values({
            tenantId: config.tenantId,
            requestId: req.id,
            url: req.url,
            titulo: page.titulo,
            conteudo: page.conteudo,
            statusCode: page.statusCode,
            mimeType: page.mimeType,
            tamanhoBytes: page.tamanhoBytes,
            hashConteudo: page.hashConteudo,
            metadata: { description: page.description },
          });

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
