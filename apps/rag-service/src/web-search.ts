import { createCircuitBreaker, CIRCUIT_BREAKER_PRESETS, instrumentCircuitBreaker } from '@alice/shared-utils';
import type { AliceMetrics } from '@alice/shared-utils';
import { Logger } from 'pino';
import { sanitizeWebSnippet } from './web-sanitize.js';

export interface WebSearchResult {
  title: string;
  url: string;
  description: string;
  snippet?: string;
}

export interface WebImageSearchResult {
  title: string;
  imageUrl: string;
  sourceUrl?: string;
  thumbnailUrl?: string;
}

export interface WebSearchOptions {
  engines?: string[];
  categories?: string;
  safesearch?: string;
  language?: string;
  timeRange?: 'day' | 'week' | 'month' | 'year';
}

interface SearxngResultItem {
  title?: string;
  url?: string;
  content?: string;
  snippet?: string;
  img_src?: string;
  thumbnail_src?: string;
  image?: string;
}

interface SearxngResponse {
  results?: SearxngResultItem[];
}

export interface WebSearchClient {
  isEnabled: () => boolean;
  search: (query: string, count?: number, options?: WebSearchOptions) => Promise<WebSearchResult[]>;
  searchImages: (query: string, count?: number, options?: WebSearchOptions) => Promise<WebImageSearchResult[]>;
  breakerState: () => {
    state: 'open' | 'half-open' | 'closed';
    stats: {
      failures: number;
      successes: number;
      timeouts: number;
    };
  };
}

interface CreateClientParams {
  baseUrl: string;
  apiKey?: string;
  logger: Logger;
  metrics: AliceMetrics;
  defaultCount?: number;
  timeoutMs?: number;
}

function isValidHttpUrl(value: string | undefined): value is string {
  if (!value || typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function createWebSearchClient({
  baseUrl,
  apiKey,
  logger,
  metrics,
  defaultCount = 5,
  timeoutMs = 8000,
}: CreateClientParams): WebSearchClient {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const hasApiKey = Boolean(apiKey && apiKey.trim().length > 0);
  let warnedMissingApiKey = false;

  const logMissingApiKeyIfNeeded = () => {
    if (hasApiKey || warnedMissingApiKey) return;
    warnedMissingApiKey = true;
    logger.warn('SEARXNG_SECRET_KEY não configurada - busca web seguirá sem autenticação');
  };

  const buildHeaders = () => {
    const baseHeaders: Record<string, string> = {
      Accept: 'application/json',
      'X-Forwarded-For': '127.0.0.1',
      'X-Real-IP': '127.0.0.1',
      'X-Forwarded-Proto': 'http',
      'X-Forwarded-Host': 'alice-searxng:8080',
      'X-Forwarded-Port': '8080',
      'User-Agent': 'Alice-Internal/1.0',
    };
    if (!hasApiKey) {
      return baseHeaders;
    }
    return {
      ...baseHeaders,
      Authorization: `Bearer ${apiKey}`,
      'X-API-KEY': apiKey as string,
    };
  };

  async function webSearchInternal(
    query: string,
    count: number = defaultCount,
    options: WebSearchOptions = {}
  ): Promise<WebSearchResult[]> {
    const normalizedCount = count ?? defaultCount;
    logMissingApiKeyIfNeeded();

    const enginesParam = options.engines && options.engines.length > 0
      ? options.engines.join(',')
      : undefined;

    const params = new URLSearchParams({
      q: query,
      format: 'json',
      language: options.language ?? 'pt-BR',
      safesearch: options.safesearch ?? '1',
      categories: options.categories ?? 'general',
      results: normalizedCount.toString(),
    });
    if (options.timeRange) {
      params.set('time_range', options.timeRange);
    }
    if (enginesParam) {
      params.set('engines', enginesParam);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // URL normalizada para garantir /search correto
      const response = await fetch(`${normalizedBaseUrl}search?${params.toString()}`, {
        method: 'GET',
        headers: buildHeaders(),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(`Falha na busca web (SearXNG): ${response.status} - ${errorText}`);
        (error as Error & { status?: number }).status = response.status;
        throw error;
      }

      const data = (await response.json()) as SearxngResponse;
      const results = data.results || [];

      return results
        .filter((r) => Boolean(r.url))
        .slice(0, normalizedCount)
        .map((r) => {
          const rawDescription = r.content || r.snippet || '';
          const rawSnippet = r.snippet || r.content || '';
          return {
            title: r.title || 'Sem título',
            url: r.url as string,
            description: sanitizeWebSnippet(rawDescription),
            snippet: sanitizeWebSnippet(rawSnippet),
          };
        });
    } finally {
      clearTimeout(timeout);
    }
  }

  async function webImageSearchInternal(
    query: string,
    count: number = defaultCount,
    options: WebSearchOptions = {}
  ): Promise<WebImageSearchResult[]> {
    const normalizedCount = count ?? defaultCount;
    logMissingApiKeyIfNeeded();

    const enginesParam = options.engines && options.engines.length > 0
      ? options.engines.join(',')
      : undefined;

    const params = new URLSearchParams({
      q: query,
      format: 'json',
      language: options.language ?? 'pt-BR',
      safesearch: options.safesearch ?? '1',
      categories: options.categories ?? 'images',
      results: normalizedCount.toString(),
    });
    if (enginesParam) {
      params.set('engines', enginesParam);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${normalizedBaseUrl}search?${params.toString()}`, {
        method: 'GET',
        headers: buildHeaders(),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(`Falha na busca web (SearXNG imagens): ${response.status} - ${errorText}`);
        (error as Error & { status?: number }).status = response.status;
        throw error;
      }

      const data = (await response.json()) as SearxngResponse;
      const results = data.results || [];
      const normalized: WebImageSearchResult[] = [];

      for (const item of results) {
        const imageUrlCandidate = item.img_src || item.image || item.thumbnail_src;
        if (!isValidHttpUrl(imageUrlCandidate)) {
          continue;
        }
        const title = item.title || 'Imagem';
        const sourceUrl = isValidHttpUrl(item.url) ? item.url : undefined;
        const thumbnailUrl = isValidHttpUrl(item.thumbnail_src) ? item.thumbnail_src : undefined;
        normalized.push({
          title,
          imageUrl: imageUrlCandidate,
          sourceUrl,
          thumbnailUrl,
        });
      }

      return normalized.slice(0, normalizedCount);
    } finally {
      clearTimeout(timeout);
    }
  }

  const breaker = createCircuitBreaker(webSearchInternal, {
    name: 'searxng-web-search',
    ...CIRCUIT_BREAKER_PRESETS.webSearch,
  });

  const imageBreaker = createCircuitBreaker(webImageSearchInternal, {
    name: 'searxng-web-image-search',
    ...CIRCUIT_BREAKER_PRESETS.webSearch,
  });

  instrumentCircuitBreaker(metrics, 'searxng-web-search', breaker as unknown);
  instrumentCircuitBreaker(metrics, 'searxng-web-image-search', imageBreaker as unknown);

  return {
    isEnabled: () => isValidHttpUrl(normalizedBaseUrl),
    async search(query: string, count?: number, options?: WebSearchOptions): Promise<WebSearchResult[]> {
      logMissingApiKeyIfNeeded();
      try {
        const normalizedCount = count ?? defaultCount;
        return (await breaker.fire(query, normalizedCount, options ?? {})) as WebSearchResult[];
      } catch (error) {
        if (error instanceof Error && error.message.includes('Breaker is open')) {
          logger.warn('Circuit breaker aberto - Busca web temporariamente indisponível');
          return [];
        }
        logger.error(
          {
            err: error instanceof Error ? error : undefined,
            errorMessage: error instanceof Error ? error.message : String(error),
            query,
          },
          'Erro na busca web (SearXNG)'
        );
        return [];
      }
    },
    async searchImages(query: string, count?: number, options?: WebSearchOptions): Promise<WebImageSearchResult[]> {
      logMissingApiKeyIfNeeded();
      try {
        const normalizedCount = count ?? defaultCount;
        return (await imageBreaker.fire(query, normalizedCount, options ?? {})) as WebImageSearchResult[];
      } catch (error) {
        if (error instanceof Error && error.message.includes('Breaker is open')) {
          logger.warn('Circuit breaker aberto - Busca de imagens web temporariamente indisponível');
          return [];
        }
        logger.error(
          {
            err: error instanceof Error ? error : undefined,
            errorMessage: error instanceof Error ? error.message : String(error),
            query,
          },
          'Erro na busca de imagens web (SearXNG)'
        );
        return [];
      }
    },
    breakerState: () => ({
      state: breaker.opened ? 'open' : breaker.halfOpen ? 'half-open' : 'closed',
      stats: {
        failures: breaker.stats.failures,
        successes: breaker.stats.successes,
        timeouts: breaker.stats.timeouts,
      },
    }),
  };
}
