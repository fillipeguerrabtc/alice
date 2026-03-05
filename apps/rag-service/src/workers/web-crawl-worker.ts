import crypto from 'crypto';
import pLimit from 'p-limit';
import { createLogger } from '@alice/logger';
import type { Database } from '@alice/database';
import { eq, and, asc, sql, schema } from '@alice/database';
import * as cheerio from 'cheerio';
import { assertSafeOutboundUrl } from '../url-security.js';

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
const MAX_REDIRECTS = 5;

// Tipo WebCrawlRequest inferido do schema Drizzle (Regra 2 CLAUDE.md - NÃO DUPLICAR)
type WebCrawlRequest = typeof schema.webCrawlRequests.$inferSelect;

export function startWebCrawlWorker(db: Database, config: WebCrawlWorkerConfig) {
  const limit = pLimit(config.concurrency);
  // Nota: crawl é feito via HTTP direto; SearXNG não é usado como proxy aqui.

  async function fetchAndMarkNextRequest(): Promise<WebCrawlRequest | null> {
    let selected: WebCrawlRequest | null = null;

    await db.transaction(async (tx) => {
      // Busca request pendente mais antigo com lock pessimista (SKIP LOCKED para evitar race condition)
      const rows = await tx
        .select()
        .from(schema.webCrawlRequests)
        .where(
          and(
            eq(schema.webCrawlRequests.tenantId, config.tenantId),
            eq(schema.webCrawlRequests.status, 'pending'),
            sql`(${schema.webCrawlRequests.agendadoPara} IS NULL OR ${schema.webCrawlRequests.agendadoPara} <= NOW())`
          )
        )
        .orderBy(
          asc(schema.webCrawlRequests.prioridade),
          sql`${schema.webCrawlRequests.agendadoPara} NULLS FIRST`,
          asc(schema.webCrawlRequests.criadoEm)
        )
        .limit(1)
        .for('update', { skipLocked: true });

      const row = rows[0] as WebCrawlRequest | undefined;
      if (!row) {
        selected = null;
        return;
      }

      await tx
        .update(schema.webCrawlRequests)
        .set({
          status: 'running',
          iniciadoEm: sql`NOW()`,
        })
        .where(eq(schema.webCrawlRequests.id, row.id));

      selected = {
        ...row,
        status: 'running' as const,
        iniciadoEm: new Date(),
      };
    });

    return selected;
  }

  async function updateRequestStatus(
    id: string,
    status: 'pending' | 'running' | 'completed' | 'failed',
    erro?: string | null
  ) {
    const setData: Record<string, unknown> = {
      status,
      erro: erro ?? null,
    };

    if (status === 'running') {
      setData.iniciadoEm = sql`NOW()`;
    } else if (status === 'completed' || status === 'failed') {
      setData.finalizadoEm = sql`NOW()`;
    } else if (status === 'pending') {
      // Para retries: limpa timestamps de execução
      setData.iniciadoEm = null;
      setData.finalizadoEm = null;
    }

    await db
      .update(schema.webCrawlRequests)
      .set(setData)
      .where(eq(schema.webCrawlRequests.id, id));
  }

  function normalizeHtml(html: string) {
    try {
      const $ = cheerio.load(html);
      const title = ($('title').first().text() || '').trim();
      const desc = ($('meta[name="description"]').attr('content') || '').trim();
      const text = $('body').text().replace(/\s+/g, ' ').trim();
      return {
        title: title || 'Sem título',
        description: desc || text.slice(0, 400),
        content: text.slice(0, 10000),
      };
    } catch (error) {
      logger.warn({ error }, 'Falha ao parsear HTML com cheerio; usando fallback bruto');
      const truncated = html.slice(0, 10000);
      return {
        title: 'Sem título',
        description: truncated.slice(0, 400),
        content: truncated,
      };
    }
  }

  async function fetchPage(url: string, bytesMax: number, timeoutMs: number, redirectDepth = 0) {
    if (redirectDepth > MAX_REDIRECTS) {
      throw new Error('Limite de redirects excedido no crawl');
    }

    const currentUrl = await assertSafeOutboundUrl(url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(currentUrl.toString(), {
        method: 'GET',
        headers: { 'User-Agent': DEFAULT_USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
        redirect: 'manual',
        signal: controller.signal,
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) {
          throw new Error('Redirect sem header Location no crawl');
        }
        const nextUrl = new URL(location, currentUrl);
        return fetchPage(nextUrl.toString(), bytesMax, timeoutMs, redirectDepth + 1);
      }

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
        resolvedUrl: currentUrl.toString(),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function processLoop() {
    try {
      const req = await fetchAndMarkNextRequest();
      if (!req) return;

      await limit(async () => {
        try {
          // Crawl direto da URL solicitada (não mandar URL como query de busca)
          const page = await fetchPage(req.url, req.bytesMax, req.timeoutMs);
          await db.insert(schema.webCrawlResults).values({
            tenantId: config.tenantId,
            requestId: req.id,
            url: page.resolvedUrl,
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
