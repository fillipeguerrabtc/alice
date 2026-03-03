import { describe, expect, it } from 'vitest';
import { getExchangeAdapter, normalizeSymbol, normalizeVenue } from '../../apps/integrations-service/src/trading/core/market-adapters';

describe('trading market adapters', () => {
  it('normalizes symbol and venue consistently', () => {
    expect(normalizeSymbol(' btc/usdt ')).toBe('BTC-USDT');
    expect(normalizeVenue(' KuCoin ')).toBe('kucoin');
  });

  it('returns kucoin adapter for kucoin venue', () => {
    const adapter = getExchangeAdapter('kucoin');
    expect(adapter.venue).toBe('kucoin');
    expect(typeof adapter.getCandles).toBe('function');
    expect(typeof adapter.getOrderBook).toBe('function');
    expect(typeof adapter.getTrades).toBe('function');
    expect(typeof adapter.getFees).toBe('function');
  });

  it('throws for unsupported venues', () => {
    expect(() => getExchangeAdapter('unknown')).toThrow('Exchange adapter não suportado');
  });
});
