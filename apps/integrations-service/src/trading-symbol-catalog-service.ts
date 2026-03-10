import { and, desc, eq, gte, inArray } from '@alice/database';
import { getDatabase, schema } from '@alice/database';
import * as kucoinClient from './kucoinClient.js';
import * as kucoinSpotClient from './kucoinSpotClient.js';
import * as kucoinMarginClient from './kucoinMarginClient.js';
import * as kucoinService from './kucoinService.js';

type TradingCatalogLogger = {
  warn: (...args: unknown[]) => void;
};

type TradingMarketType = 'futures' | 'spot' | 'margin';

export type UniverseSymbolSelection = {
  symbol: string;
  source: 'requested' | 'universe_candidates' | 'default_symbol';
  symbolsEvaluated: number;
  candidatesEvaluated: number;
};

export type TradingAutoSignalAssetSelection = {
  venue: string;
  symbol: string;
  marketType: TradingMarketType;
  marginMode?: 'cross' | 'isolated';
};

function scoreUniverseCandidate(candidate: {
  expectedEdge: unknown;
  confidenceCalibrated: unknown;
  confidenceRaw: unknown;
  dsrScore: unknown;
  pboScore: unknown;
  side: unknown;
}): number {
  const edge = Number(candidate.expectedEdge ?? 0);
  const confidence = Number(candidate.confidenceCalibrated ?? candidate.confidenceRaw ?? 0);
  const dsr = Number(candidate.dsrScore ?? 0);
  const pbo = Number(candidate.pboScore ?? 1);
  const side = String(candidate.side ?? '').toLowerCase();
  const directionBias = side === 'long' || side === 'short' ? 35 : -50;
  return (edge * 10000) + (confidence * 120) + (dsr * 25) - (pbo * 35) + directionBias;
}

export function createTradingSymbolCatalogService(logger: TradingCatalogLogger) {
  function normalizeSignalSymbols(rawSymbols: string[]): string[] {
    const normalized = rawSymbols
      .map((symbol) => symbol.trim().toUpperCase())
      .filter((symbol) => symbol.length > 0);
    return Array.from(new Set(normalized));
  }

  async function selectSymbolFromUniverseCandidates(params: {
    tenantId: string;
    marketType: TradingMarketType;
    maxAssets: number;
  }): Promise<UniverseSymbolSelection | null> {
    const db = getDatabase();
    const lookback = new Date(Date.now() - (24 * 60 * 60 * 1000));
    const recentCandidates = await db.query.tradingUniverseCandidates.findMany({
      where: and(
        eq(schema.tradingUniverseCandidates.tenantId, params.tenantId),
        eq(schema.tradingUniverseCandidates.marketType, params.marketType),
        gte(schema.tradingUniverseCandidates.createdAt, lookback),
      ),
      orderBy: [desc(schema.tradingUniverseCandidates.createdAt)],
      limit: 1000,
    });
    if (recentCandidates.length === 0) {
      return null;
    }

    const instrumentIds = Array.from(new Set(recentCandidates.map((item) => item.instrumentId)));
    const instruments = instrumentIds.length > 0
      ? await db.query.tradingInstruments.findMany({
        where: inArray(schema.tradingInstruments.id, instrumentIds),
      })
      : [];
    const instrumentById = new Map(instruments.map((item) => [item.id, item.symbol]));

    const bestBySymbol = new Map<string, { score: number; side: string }>();
    for (const candidate of recentCandidates) {
      const symbol = instrumentById.get(candidate.instrumentId);
      if (!symbol) continue;
      const score = scoreUniverseCandidate(candidate);
      const side = String(candidate.side ?? '').toLowerCase();
      const current = bestBySymbol.get(symbol);
      if (!current || score > current.score) {
        bestBySymbol.set(symbol, { score, side });
      }
    }

    const ranked = Array.from(bestBySymbol.entries())
      .map(([symbol, payload]) => ({ symbol, ...payload }))
      .sort((a, b) => b.score - a.score);
    if (ranked.length === 0) {
      return null;
    }

    const cappedAssets = Math.max(1, Math.min(params.maxAssets, ranked.length));
    const limited = ranked.slice(0, cappedAssets);
    const directional = limited.find((entry) => (entry.side === 'long' || entry.side === 'short') && entry.score > 0);
    const selected = directional ?? limited[0];
    if (!selected) return null;

    return {
      symbol: selected.symbol,
      source: 'universe_candidates',
      symbolsEvaluated: limited.length,
      candidatesEvaluated: recentCandidates.length,
    };
  }

  function normalizeSymbolList(rawSymbols: string[], allowedSymbols: string[]): string[] {
    const normalized = rawSymbols
      .map((symbol) => symbol.trim().toUpperCase())
      .filter((symbol) => symbol.length > 0);
    const unique = Array.from(new Set(normalized));
    if (allowedSymbols.length === 0) return unique;
    const allowedSet = new Set(allowedSymbols);
    return unique.filter((symbol) => allowedSet.has(symbol));
  }

  async function resolveConnectedTradingVenues(tenantId: string): Promise<string[]> {
    const db = getDatabase();
    const rows = await db.query.tradingExchanges.findMany({
      where: and(
        eq(schema.tradingExchanges.tenantId, tenantId),
        eq(schema.tradingExchanges.apiConnected, true),
      ),
      columns: { venue: true },
    });
    const fromDb = rows
      .map((row) => row.venue.trim().toLowerCase())
      .filter((venue) => venue.length > 0);
    if (fromDb.length > 0) {
      return Array.from(new Set(fromDb));
    }

    const fallbackVenues: string[] = [];
    if (kucoinClient.isKucoinConfigured() || kucoinSpotClient.isSpotConfigured() || kucoinMarginClient.isMarginConfigured()) {
      fallbackVenues.push('kucoin');
    }
    return Array.from(new Set(fallbackVenues));
  }

  async function loadTradingAutoAssetsForVenue(params: {
    venue: string;
    tradingAuth: { tenantId: string; userId: string };
  }): Promise<TradingAutoSignalAssetSelection[]> {
    const venue = params.venue.trim().toLowerCase();
    if (venue !== 'kucoin') {
      logger.warn({ venue }, 'Venue sem adaptador de catálogo de ativos auto-signals');
      return [];
    }

    const assets: TradingAutoSignalAssetSelection[] = [];
    const futuresConfigured = kucoinClient.isKucoinConfigured();
    const spotConfigured = kucoinSpotClient.isSpotConfigured();
    const marginConfigured = kucoinMarginClient.isMarginConfigured();

    if (futuresConfigured) {
      const futures = await kucoinService.getTradingSymbols(params.tradingAuth, 'futures');
      for (const symbol of futures.symbols) {
        assets.push({
          venue: 'kucoin',
          symbol,
          marketType: 'futures',
        });
      }
    }

    if (spotConfigured) {
      const spot = await kucoinService.getTradingSymbols(params.tradingAuth, 'spot');
      for (const symbol of spot.symbols) {
        assets.push({
          venue: 'kucoin',
          symbol,
          marketType: 'spot',
        });
      }
    }

    if (marginConfigured) {
      const [crossMargin, isolatedMargin] = await Promise.all([
        kucoinService.getTradingSymbols(params.tradingAuth, 'margin', 'cross'),
        kucoinService.getTradingSymbols(params.tradingAuth, 'margin', 'isolated'),
      ]);
      for (const symbol of crossMargin.symbols) {
        assets.push({
          venue: 'kucoin',
          symbol,
          marketType: 'margin',
          marginMode: 'cross',
        });
      }
      for (const symbol of isolatedMargin.symbols) {
        assets.push({
          venue: 'kucoin',
          symbol,
          marketType: 'margin',
          marginMode: 'isolated',
        });
      }
    }

    return assets;
  }

  async function fetchTradingSymbolPreferences(
    tenantId: string,
    userId: string,
    marketType: TradingMarketType,
    marginMode: 'cross' | 'isolated'
  ) {
    const db = getDatabase();
    const [row] = await db
      .select()
      .from(schema.tradingSymbolPreferences)
      .where(and(
        eq(schema.tradingSymbolPreferences.tenantId, tenantId),
        eq(schema.tradingSymbolPreferences.userId, userId),
        eq(schema.tradingSymbolPreferences.marketType, marketType),
        eq(schema.tradingSymbolPreferences.marginMode, marginMode)
      ))
      .limit(1);
    return row ?? null;
  }

  return {
    normalizeSignalSymbols,
    selectSymbolFromUniverseCandidates,
    normalizeSymbolList,
    resolveConnectedTradingVenues,
    loadTradingAutoAssetsForVenue,
    fetchTradingSymbolPreferences,
  };
}
