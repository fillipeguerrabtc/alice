import { createLogger } from '@alice/logger';
import type { InstrumentConstraint, TradingMarketType, TradingMarginMode } from './types.js';

const logger = createLogger('trading-v2-market-adapters');

export function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace('/', '-');
}

export function normalizeVenue(venue: string): string {
  return venue.trim().toLowerCase();
}

export async function resolveMarketConstraints(
  tenantId: string,
  userId: string,
  instrumentId: string,
  marketType: TradingMarketType,
  marginMode?: TradingMarginMode,
): Promise<InstrumentConstraint> {
  logger.info({ tenantId, userId, instrumentId, marketType, marginMode }, 'Resolvendo constraints de mercado');
  return {
    instrumentId,
    venue: 'kucoin',
    symbol: instrumentId,
    marketType,
    marginMode,
    status: 'unknown',
  };
}

export async function estimateFundingBorrowCosts(): Promise<{ status: 'ok' | 'unavailable'; fundingBorrowBps?: number }> {
  return { status: 'unavailable' };
}
