import { describe, expect, it } from 'vitest';
import {
  tradingOperationIntentEnum,
  tradingStrategyRegistry,
  tradingUniverseCandidates,
  tradingBacktestRuns,
  tradingSignalCalibration,
  tradingPortfolios,
  tradingExchanges,
  tradingOrderbookSnapshots,
  tradingTradeTicksAgg,
} from '../../packages/shared/src/schema';

describe('trading operation intent schema', () => {
  it('exposes all required operation intents', () => {
    expect(tradingOperationIntentEnum.enumValues).toEqual([
      'scalping',
      'intraday',
      'swing',
      'positional',
      'arbitrage_internal',
      'arbitrage_cross_exchange',
      'cash_and_carry',
      'market_neutral',
      'volatility_breakout',
    ]);
  });

  it('adds operation intent columns to trading v2 tables', () => {
    expect(tradingStrategyRegistry.operationIntent).toBeDefined();
    expect(tradingUniverseCandidates.operationIntent).toBeDefined();
    expect(tradingBacktestRuns.operationIntent).toBeDefined();
    expect(tradingSignalCalibration.operationIntent).toBeDefined();
    expect(tradingPortfolios.allowedOperationIntents).toBeDefined();
    expect(tradingPortfolios.policy).toBeDefined();
  });

  it('defines trading exchanges registry for multi-venue readiness', () => {
    expect(tradingExchanges.tenantId).toBeDefined();
    expect(tradingExchanges.venue).toBeDefined();
    expect(tradingExchanges.apiConnected).toBeDefined();
    expect(tradingExchanges.supportsSpot).toBeDefined();
    expect(tradingExchanges.supportsFutures).toBeDefined();
    expect(tradingExchanges.supportsMargin).toBeDefined();
    expect(tradingExchanges.feeModelVersion).toBeDefined();
  });

  it('defines microstructure persistence tables', () => {
    expect(tradingOrderbookSnapshots.topLevels).toBeDefined();
    expect(tradingOrderbookSnapshots.orderBookImbalance).toBeDefined();
    expect(tradingTradeTicksAgg.buyVolume).toBeDefined();
    expect(tradingTradeTicksAgg.cvd).toBeDefined();
  });
});
