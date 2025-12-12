import { createCircuitBreaker, CIRCUIT_BREAKER_PRESETS, instrumentCircuitBreaker } from '@alice/shared-utils';
import { AlicePrometheus } from '@alice/shared-utils';
import { Logger } from 'pino';

export interface WebSearchResult {
  title: string;
  url: string;
  description: string;
  snippet?: string;
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
  search: (query: string, count?: number) => Promise<WebSearchResult[]>;
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
  metrics: AlicePrometheus;
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
  async function webSearchInternal(query: string, count: number = defaultCount): Promise<WebSearchResult[]> {
    const normalizedCount = count ?? defaultCount;
    if (!apiKey) {
      logger.warn('SEARXNG_SECRET_KEY não configurada - busca web desabilitada');
      return [];
    }

    const params = new URLSearchParams({
      q: query,
      format: 'json',
      language: 'pt-BR',
      safesearch: '1',
      categories: 'general',
      results: normalizedCount.toString(),
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // baseUrl já vem normalizado com uma barra final; evitar dupla barra
      const response = await fetch(`${baseUrl}search?${params.toString()}`, {
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

  instrumentCircuitBreaker(metrics, 'searxng-web-search', breaker as any);

  return {
    isEnabled: () => Boolean(apiKey),
    async search(query: string, count?: number): Promise<WebSearchResult[]> {
      if (!apiKey) return [];
      try {
        const normalizedCount = count ?? defaultCount;
        return (await breaker.fire(query, normalizedCount)) as WebSearchResult[];
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
