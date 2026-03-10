import type { TradingProfileNewsConfig } from '@alice/shared';
import type { AuthContext, InternalAuthHeaders } from '@alice/shared-utils';

type TradingNewsLogger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
};

type TradingNewsAuth = { tenantId: string; userId: string };
type TradingMarketType = 'futures' | 'spot' | 'margin';
type WebSearchTimeRange = 'day' | 'week' | 'month' | 'year';

export type TradingNewsConfigResolved = {
  engines: string[];
  categories: string;
  language: string;
  safesearch: string;
  timeRange: 'last_hour' | 'last_24_hours' | 'custom' | 'day' | 'week' | 'month' | 'year';
  dateFrom?: string;
  dateTo?: string;
  queryTemplates: string[];
  extraTerms: string[];
  maxResults: number;
};

const DEFAULT_TRADING_NEWS_CONFIG: TradingNewsConfigResolved = {
  engines: [],
  categories: 'general',
  language: 'pt-BR',
  safesearch: '1',
  timeRange: 'last_24_hours',
  dateFrom: undefined,
  dateTo: undefined,
  queryTemplates: ['{symbol} {marketType} news {terms}'],
  extraTerms: [],
  maxResults: 5,
};

function truncateText(input: string, maxLength: number): string {
  if (input.length <= maxLength) return input;
  return `${input.slice(0, maxLength)}…`;
}

function normalizeDateString(input?: string | null): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  if (!/^\d{4}-\d{2}-\d{2}(T[\d:.+-Z]+)?$/.test(trimmed)) return undefined;
  return trimmed;
}

function buildRelativeDateRange(timeRange: TradingNewsConfigResolved['timeRange']): { dateFrom?: string; dateTo?: string } {
  const now = new Date();
  if (timeRange === 'last_hour') {
    const from = new Date(now.getTime() - 60 * 60 * 1000);
    return { dateFrom: from.toISOString(), dateTo: now.toISOString() };
  }
  if (timeRange === 'last_24_hours') {
    const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return { dateFrom: from.toISOString(), dateTo: now.toISOString() };
  }
  return {};
}

function resolveTimeRangeParam(timeRange: TradingNewsConfigResolved['timeRange']): WebSearchTimeRange | undefined {
  if (timeRange === 'day' || timeRange === 'week' || timeRange === 'month' || timeRange === 'year') {
    return timeRange;
  }
  if (timeRange === 'last_24_hours') {
    return 'day';
  }
  return undefined;
}

export function createTradingNewsService(deps: {
  logger: TradingNewsLogger;
  generateInternalAuthHeaders: (params: AuthContext) => InternalAuthHeaders;
  resolveRagServiceUrl: () => string;
  maxNewsQueryChars?: number;
}) {
  const maxNewsQueryChars = deps.maxNewsQueryChars ?? 200;

  function normalizeTradingNewsConfig(raw?: TradingProfileNewsConfig | null): TradingNewsConfigResolved {
    const sanitizedEngines = Array.isArray(raw?.engines)
      ? raw.engines.map((engine) => engine.trim()).filter(Boolean)
      : [];
    const normalizedTemplates = Array.isArray(raw?.queryTemplates)
      ? raw.queryTemplates.map((template) => template.trim()).filter(Boolean)
      : [];
    const queryTemplates = normalizedTemplates.length > 0
      ? normalizedTemplates
      : DEFAULT_TRADING_NEWS_CONFIG.queryTemplates;
    const extraTerms = Array.isArray(raw?.extraTerms)
      ? raw.extraTerms.map((term) => term.trim()).filter(Boolean)
      : [];
    const timeRange = raw?.timeRange === 'last_hour'
      || raw?.timeRange === 'last_24_hours'
      || raw?.timeRange === 'custom'
      || raw?.timeRange === 'day'
      || raw?.timeRange === 'week'
      || raw?.timeRange === 'month'
      || raw?.timeRange === 'year'
      ? raw.timeRange
      : DEFAULT_TRADING_NEWS_CONFIG.timeRange;
    const dateFrom = timeRange === 'custom' ? normalizeDateString(raw?.dateFrom) : undefined;
    const dateTo = timeRange === 'custom' ? normalizeDateString(raw?.dateTo) : undefined;

    return {
      engines: sanitizedEngines,
      categories: raw?.categories?.trim() || DEFAULT_TRADING_NEWS_CONFIG.categories,
      language: raw?.language?.trim() || DEFAULT_TRADING_NEWS_CONFIG.language,
      safesearch: raw?.safesearch?.trim() || DEFAULT_TRADING_NEWS_CONFIG.safesearch,
      timeRange,
      dateFrom,
      dateTo,
      queryTemplates,
      extraTerms,
      maxResults: raw?.maxResults && raw.maxResults > 0 ? Math.min(raw.maxResults, 10) : DEFAULT_TRADING_NEWS_CONFIG.maxResults,
    };
  }

  function buildNewsQuery(params: {
    symbol: string;
    marketType?: TradingMarketType;
    newsConfig: TradingNewsConfigResolved;
  }): string {
    const marketType = params.marketType ?? 'futures';
    const terms = params.newsConfig.extraTerms.length > 0
      ? params.newsConfig.extraTerms.join(' ')
      : '';
    const dateFrom = params.newsConfig.dateFrom ?? '';
    const dateTo = params.newsConfig.dateTo ?? '';
    const rendered = params.newsConfig.queryTemplates.map((template) => template
      .replace('{symbol}', params.symbol)
      .replace('{marketType}', marketType)
      .replace('{terms}', terms)
      .replace('{dateFrom}', dateFrom)
      .replace('{dateTo}', dateTo)
      .trim()
      .replace(/\s+/g, ' ')
    );

    const joined = rendered.length > 1 ? rendered.join(' OR ') : rendered[0];
    return truncateText(joined, maxNewsQueryChars);
  }

  async function fetchNewsSummary(
    auth: TradingNewsAuth,
    symbol: string,
    marketType?: TradingMarketType,
    newsConfig?: TradingProfileNewsConfig
  ): Promise<{ query: string; results: Array<{ title: string; url: string; score?: number }> }> {
    const resolvedConfig = normalizeTradingNewsConfig(newsConfig ?? null);
    const relativeRange = buildRelativeDateRange(resolvedConfig.timeRange);
    const resolvedDateFrom = resolvedConfig.dateFrom ?? relativeRange.dateFrom;
    const resolvedDateTo = resolvedConfig.dateTo ?? relativeRange.dateTo;
    const query = buildNewsQuery({
      symbol,
      marketType,
      newsConfig: {
        ...resolvedConfig,
        dateFrom: resolvedDateFrom,
        dateTo: resolvedDateTo,
      },
    });
    const internalHeaders = deps.generateInternalAuthHeaders({
      userId: auth.userId,
      tenantId: auth.tenantId,
      role: 'operator',
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(`${deps.resolveRagServiceUrl()}/api/rag/web-search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...internalHeaders,
        },
        body: JSON.stringify({
          query,
          limit: resolvedConfig.maxResults,
          engines: resolvedConfig.engines.length > 0 ? resolvedConfig.engines : undefined,
          categories: resolvedConfig.categories,
          language: resolvedConfig.language,
          safesearch: resolvedConfig.safesearch,
          timeRange: resolveTimeRangeParam(resolvedConfig.timeRange),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Falha ao buscar notícias: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as { results?: Array<{ title?: string; url?: string; score?: number }> };
      const results = (data.results ?? [])
        .filter((item) => item?.title && item?.url)
        .map((item) => ({ title: item.title as string, url: item.url as string, score: item.score }));

      deps.logger.info({
        tenantId: auth.tenantId,
        symbol,
        marketType: marketType ?? 'futures',
        query,
        results: results.length,
      }, 'Notícias consultadas via SearXNG para análise de trading');

      return {
        query,
        results,
      };
    } catch (error) {
      deps.logger.warn({
        tenantId: auth.tenantId,
        symbol,
        marketType: marketType ?? 'futures',
        query,
        error: error instanceof Error ? error.message : 'Erro desconhecido',
      }, 'Falha ao buscar notícias via SearXNG - seguindo sem notícias');
      return { query, results: [] };
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    normalizeTradingNewsConfig,
    fetchNewsSummary,
  };
}
