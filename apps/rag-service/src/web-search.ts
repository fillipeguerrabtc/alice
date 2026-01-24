import { createCircuitBreaker, CIRCUIT_BREAKER_PRESETS, instrumentCircuitBreaker } from '@alice/shared-utils';
import type { AliceMetrics } from '@alice/shared-utils';
import { Logger } from 'pino';

export interface WebSearchResult {
  title: string;
  url: string;
  description: string;
  snippet?: string;
}

export interface WebSearchOptions {
  engines?: string[];
  categories?: string;
  safesearch?: string;
  language?: string;
}

interface SearxngResultItem {
  title?: string;
  url?: string;
  content?: string;
  snippet?: string;
}

interface SearxngResponse {
  results?: SearxngResultItem[];
}

export interface WebSearchClient {
  isEnabled: () => boolean;
  search: (query: string, count?: number, options?: WebSearchOptions) => Promise<WebSearchResult[]>;
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

export function createWebSearchClient({
  baseUrl,
  apiKey,
  logger,
  metrics,
  defaultCount = 5,
  timeoutMs = 8000,
}: CreateClientParams): WebSearchClient {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

  async function webSearchInternal(
    query: string,
    count: number = defaultCount,
    options: WebSearchOptions = {}
  ): Promise<WebSearchResult[]> {
    const normalizedCount = count ?? defaultCount;
    if (!apiKey) {
      logger.warn('SEARXNG_SECRET_KEY não configurada - busca web desabilitada');
      return [];
    }

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
    if (enginesParam) {
      params.set('engines', enginesParam);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // URL normalizada para garantir /search correto
      const response = await fetch(`${normalizedBaseUrl}search?${params.toString()}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'X-API-KEY': apiKey,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Falha na busca web (SearXNG): ${response.status} - ${errorText}`);
      }

      const data = (await response.json()) as SearxngResponse;
      const results = data.results || [];

      return results
        .filter((r) => Boolean(r.url))
        .slice(0, normalizedCount)
        .map((r) => ({
          title: r.title || 'Sem título',
          url: r.url as string,
          description: r.content || r.snippet || '',
          snippet: r.snippet || r.content || '',
        }));
    } finally {
      clearTimeout(timeout);
    }
  }

  const breaker = createCircuitBreaker(webSearchInternal, {
    name: 'searxng-web-search',
    ...CIRCUIT_BREAKER_PRESETS.webSearch,
  });

  instrumentCircuitBreaker(metrics, 'searxng-web-search', breaker as unknown);

  return {
    isEnabled: () => Boolean(apiKey),
    async search(query: string, count?: number, options?: WebSearchOptions): Promise<WebSearchResult[]> {
      if (!apiKey) return [];
      try {
        const normalizedCount = count ?? defaultCount;
        return (await breaker.fire(query, normalizedCount, options ?? {})) as WebSearchResult[];
      } catch (error) {
        if (error instanceof Error && error.message.includes('Breaker is open')) {
          logger.warn('Circuit breaker aberto - Busca web temporariamente indisponível');
          return [];
        }
        logger.error({ error, query }, 'Erro na busca web (SearXNG)');
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
