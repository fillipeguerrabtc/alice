import { and, eq, getDatabase, schema } from '@alice/database';
import { createLogger } from '@alice/logger';
import * as kucoinClient from '../../kucoinClient.js';
import type { InstrumentConstraint, TradingMarketType, TradingMarginMode } from './types.js';

const logger = createLogger('trading-market-adapters');

export interface ExchangeFees {
  makerFeeBps: number;
  takerFeeBps: number;
}

export interface ExchangeFunding {
  fundingRateBps: number;
  timestamp: number;
}

export interface ExchangeBorrowRates {
  borrowRateBps: number;
  periodHours: number;
}

export interface ExchangeWithdrawCosts {
  withdrawCostBps: number;
}

export interface ExchangeAdapter {
  venue: string;
  getCandles(input: {
    symbol: string;
    marketType: TradingMarketType;
    granularity: number | string;
    from?: number;
    to?: number;
  }): Promise<kucoinClient.KucoinKline[]>;
  getOrderBook(input: {
    symbol: string;
    marketType: TradingMarketType;
    depth: 20 | 100;
  }): Promise<kucoinClient.KucoinOrderBook>;
  getTrades(input: {
    symbol: string;
    marketType: TradingMarketType;
  }): Promise<kucoinClient.KucoinTrade[]>;
  getFees(input: {
    symbol: string;
    marketType: TradingMarketType;
  }): Promise<ExchangeFees>;
  getFunding?(input: {
    symbol: string;
    from: number;
    to: number;
  }): Promise<ExchangeFunding | null>;
  getBorrowRates?(input: {
    symbol: string;
    marginMode: TradingMarginMode;
  }): Promise<ExchangeBorrowRates | null>;
  getWithdrawCosts?(input: {
    symbol: string;
  }): Promise<ExchangeWithdrawCosts | null>;
}

function toRestMarketType(marketType: TradingMarketType): kucoinClient.RestMarketType {
  if (marketType === 'spot' || marketType === 'margin') return marketType;
  return 'futures';
}

export const kucoinAdapter: ExchangeAdapter = {
  venue: 'kucoin',
  async getCandles(input) {
    return kucoinClient.getKlinesMultiMarket(
      input.symbol,
      input.granularity,
      toRestMarketType(input.marketType),
      input.from,
      input.to,
    );
  },
  async getOrderBook(input) {
    return kucoinClient.getOrderBookMultiMarket(
      input.symbol,
      input.depth,
      toRestMarketType(input.marketType),
    );
  },
  async getTrades(input) {
    return kucoinClient.getTradeHistoryMultiMarket(
      input.symbol,
      toRestMarketType(input.marketType),
    );
  },
  async getFees(input) {
    if (input.marketType === 'futures') {
      const contracts = await kucoinClient.getActiveContracts();
      const contract = contracts.find((item) => item.symbol === input.symbol);
      if (contract) {
        return {
          makerFeeBps: Number(contract.makerFeeRate) * 10_000,
          takerFeeBps: Number(contract.takerFeeRate) * 10_000,
        };
      }
    }
    return {
      makerFeeBps: 10,
      takerFeeBps: 10,
    };
  },
  async getFunding(input) {
    const history = await kucoinClient.getPublicFundingHistory(input.symbol, input.from, input.to);
    if (history.length === 0) return null;
    const latest = history[history.length - 1];
    if (!latest) return null;
    return {
      fundingRateBps: Number(latest.fundingRate) * 10_000,
      timestamp: latest.timePoint,
    };
  },
  async getBorrowRates(input) {
    const requirement = await kucoinClient.getCrossMarginRequirement(input.symbol);
    return {
      borrowRateBps: Number(requirement.totalMargin) * 10_000,
      periodHours: input.marginMode === 'isolated' ? 8 : 24,
    };
  },
  async getWithdrawCosts(input) {
    const withdraw = await kucoinClient.getMaxWithdrawMargin(input.symbol);
    return {
      withdrawCostBps: Number(withdraw.maxWithdrawMargin) > 0 ? 1 : 0,
    };
  },
};

export function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace('/', '-');
}

export function normalizeVenue(venue: string): string {
  return venue.trim().toLowerCase();
}

export function getExchangeAdapter(venue: string): ExchangeAdapter {
  const normalizedVenue = normalizeVenue(venue);
  if (normalizedVenue === 'kucoin') {
    return kucoinAdapter;
  }
  throw new Error(`Exchange adapter não suportado: ${venue}`);
}

export async function resolveMarketConstraints(
  tenantId: string,
  userId: string,
  instrumentId: string,
  marketType: TradingMarketType,
  marginMode?: TradingMarginMode,
): Promise<InstrumentConstraint> {
  const db = getDatabase();
  const instrument = await db.query.tradingInstruments.findFirst({
    where: and(
      eq(schema.tradingInstruments.id, instrumentId),
      eq(schema.tradingInstruments.tenantId, tenantId),
    ),
  });

  if (!instrument) {
    logger.warn({ tenantId, userId, instrumentId, marketType, marginMode }, 'Instrumento não encontrado para constraints');
    return {
      instrumentId,
      venue: 'unknown',
      symbol: instrumentId,
      marketType,
      marginMode,
      status: 'unknown',
    };
  }

  return {
    instrumentId,
    venue: instrument.venue,
    symbol: instrument.symbol,
    marketType,
    marginMode,
    minNotional: instrument.minNotional ? Number(instrument.minNotional) : undefined,
    tickSize: instrument.tickSize ? Number(instrument.tickSize) : undefined,
    lotSize: instrument.lotSize ? Number(instrument.lotSize) : undefined,
    status: 'ok',
  };
}

export async function getConnectedExchangesCount(tenantId: string): Promise<number> {
  const db = getDatabase();
  const exchanges = await db.query.tradingExchanges.findMany({
    where: and(
      eq(schema.tradingExchanges.tenantId, tenantId),
      eq(schema.tradingExchanges.apiConnected, true),
    ),
  });
  return exchanges.length;
}

export async function estimateFundingBorrowCosts(input: {
  venue: string;
  symbol: string;
  marketType: TradingMarketType;
  marginMode?: TradingMarginMode;
}): Promise<{ status: 'ok' | 'unavailable'; fundingBorrowBps?: number }> {
  const adapter = getExchangeAdapter(input.venue);
  const costs: number[] = [];

  if (adapter.getFunding && input.marketType === 'futures') {
    const to = Date.now();
    const from = to - (8 * 60 * 60 * 1000);
    const funding = await adapter.getFunding({ symbol: input.symbol, from, to });
    if (funding) {
      costs.push(Math.max(0, funding.fundingRateBps));
    }
  }

  if (adapter.getBorrowRates && input.marketType === 'margin') {
    const marginMode = input.marginMode ?? 'cross';
    const borrow = await adapter.getBorrowRates({ symbol: input.symbol, marginMode });
    if (borrow) {
      costs.push(Math.max(0, borrow.borrowRateBps));
    }
  }

  if (costs.length === 0) {
    return { status: 'unavailable' };
  }

  const fundingBorrowBps = costs.reduce((sum, value) => sum + value, 0);
  return { status: 'ok', fundingBorrowBps };
}
