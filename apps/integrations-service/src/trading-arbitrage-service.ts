import type { TradingArbitrageExchange } from '@alice/shared';

type TradingAuth = { tenantId: string; userId: string };
type TradingMarketType = 'futures' | 'spot' | 'margin';
type TradingMarginMode = 'cross' | 'isolated';
type OrderBookLevel = Array<string | number>;
type GenericOrderBook = {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
};

export type ArbitrageLeg = {
  from: string;
  to: string;
  symbol: string;
  exchange: TradingArbitrageExchange;
  side: 'sell' | 'buy';
  rate: number;
  bestBid: number | null;
  bestAsk: number | null;
};

export type NetworkFeeApplied = {
  asset: string;
  amount: number;
  fromExchange: TradingArbitrageExchange;
  toExchange: TradingArbitrageExchange;
};

export type TriangularArbitrageResult = {
  intermediateAsset: string;
  startAsset: string;
  endAsset: string;
  edgePct: number;
  finalAmount: number;
  networkFeeTotal: number;
  networkFeesApplied: NetworkFeeApplied[];
  legs: ArbitrageLeg[];
};

type TradingArbitrageLogger = {
  warn: (...args: unknown[]) => void;
};

export function createTradingArbitrageService(deps: {
  logger: TradingArbitrageLogger;
  resolveTradingSymbolStrict: (
    auth: TradingAuth,
    symbol: string,
    marketType?: TradingMarketType,
    marginMode?: TradingMarginMode
  ) => Promise<string>;
  getSpotOrderBook: (symbol: string) => Promise<GenericOrderBook>;
  getOrderBook: (symbol: string, depth: 20 | 100) => Promise<GenericOrderBook>;
}) {
  async function getOrderBookSnapshot(
    auth: TradingAuth,
    symbol: string,
    marketType?: TradingMarketType,
    marginMode?: TradingMarginMode,
    exchange: TradingArbitrageExchange = 'kucoin'
  ): Promise<{
    symbol: string;
    bestBid: number | null;
    bestAsk: number | null;
    spreadAbs: number | null;
    spreadPct: number | null;
    depth: number;
  }> {
    if (exchange !== 'kucoin') {
      throw new Error(`Exchange não suportada para order book: ${exchange}`);
    }
    const resolvedSymbol = await deps.resolveTradingSymbolStrict(auth, symbol, marketType, marginMode);
    const depth = 20 as const;
    const orderbook = marketType === 'spot' || marketType === 'margin'
      ? await deps.getSpotOrderBook(resolvedSymbol)
      : await deps.getOrderBook(resolvedSymbol, depth);

    const bestBid = orderbook?.bids?.[0]?.[0] ? Number(orderbook.bids[0][0]) : null;
    const bestAsk = orderbook?.asks?.[0]?.[0] ? Number(orderbook.asks[0][0]) : null;
    const spreadAbs = bestBid !== null && bestAsk !== null ? Math.abs(bestAsk - bestBid) : null;
    const spreadPct = spreadAbs !== null && bestAsk !== null && bestAsk !== 0
      ? Math.round((spreadAbs / bestAsk) * 10000) / 100
      : null;

    return {
      symbol: resolvedSymbol,
      bestBid,
      bestAsk,
      spreadAbs,
      spreadPct,
      depth,
    };
  }

  async function getConversionRate(params: {
    auth: TradingAuth;
    from: string;
    to: string;
    marketType?: TradingMarketType;
    marginMode?: TradingMarginMode;
    exchange: TradingArbitrageExchange;
  }): Promise<ArbitrageLeg | null> {
    const candidateDirect = `${params.from}-${params.to}`;
    const candidateInverse = `${params.to}-${params.from}`;

    const trySnapshot = async (symbol: string) => {
      try {
        return await getOrderBookSnapshot(params.auth, symbol, params.marketType, params.marginMode, params.exchange);
      } catch {
        return null;
      }
    };

    const direct = await trySnapshot(candidateDirect);
    if (direct && direct.bestBid !== null && direct.bestBid > 0) {
      return {
        from: params.from,
        to: params.to,
        symbol: direct.symbol,
        exchange: params.exchange,
        side: 'sell',
        rate: direct.bestBid,
        bestBid: direct.bestBid,
        bestAsk: direct.bestAsk,
      };
    }

    const inverse = await trySnapshot(candidateInverse);
    if (inverse && inverse.bestAsk !== null && inverse.bestAsk > 0) {
      return {
        from: params.from,
        to: params.to,
        symbol: inverse.symbol,
        exchange: params.exchange,
        side: 'buy',
        rate: 1 / inverse.bestAsk,
        bestBid: inverse.bestBid,
        bestAsk: inverse.bestAsk,
      };
    }

    return null;
  }

  async function calculateTriangularArbitrage(params: {
    auth: TradingAuth;
    marketType?: TradingMarketType;
    marginMode?: TradingMarginMode;
    startAsset: string;
    quoteAsset: string;
    intermediateAssets: string[];
    exchanges: TradingArbitrageExchange[];
    feePct: number;
    feePctByExchange?: Record<TradingArbitrageExchange, number>;
    maxSlippagePct: number;
    networkFeesByAsset?: Record<string, number>;
  }): Promise<TriangularArbitrageResult[]> {
    const results: TriangularArbitrageResult[] = [];
    const defaultFeeMultiplier = 1 - params.feePct / 100;
    const resolveFeeMultiplier = (exchange: TradingArbitrageExchange) => {
      const feePct = params.feePctByExchange?.[exchange];
      return typeof feePct === 'number' && Number.isFinite(feePct)
        ? 1 - feePct / 100
        : defaultFeeMultiplier;
    };
    const slippageMultiplier = 1 - params.maxSlippagePct / 100;
    const exchanges = params.exchanges.length > 0 ? params.exchanges : (['kucoin'] as TradingArbitrageExchange[]);
    const networkFeesByAsset = params.networkFeesByAsset ?? {};
    const exchangeCombos: TradingArbitrageExchange[][] = [];
    for (const ex1 of exchanges) {
      for (const ex2 of exchanges) {
        for (const ex3 of exchanges) {
          exchangeCombos.push([ex1, ex2, ex3]);
        }
      }
    }

    for (const intermediate of params.intermediateAssets) {
      for (const combo of exchangeCombos) {
        const [exchange1, exchange2, exchange3] = combo;
        const leg1 = await getConversionRate({
          auth: params.auth,
          from: params.startAsset,
          to: intermediate,
          marketType: params.marketType,
          marginMode: params.marginMode,
          exchange: exchange1,
        });
        if (!leg1) continue;

        const leg2 = await getConversionRate({
          auth: params.auth,
          from: intermediate,
          to: params.quoteAsset,
          marketType: params.marketType,
          marginMode: params.marginMode,
          exchange: exchange2,
        });
        if (!leg2) continue;

        const leg3 = await getConversionRate({
          auth: params.auth,
          from: params.quoteAsset,
          to: params.startAsset,
          marketType: params.marketType,
          marginMode: params.marginMode,
          exchange: exchange3,
        });
        if (!leg3) continue;

        const startAmount = 1;
        const leg1FeeMultiplier = resolveFeeMultiplier(leg1.exchange);
        const leg2FeeMultiplier = resolveFeeMultiplier(leg2.exchange);
        const leg3FeeMultiplier = resolveFeeMultiplier(leg3.exchange);
        let afterLeg1 = startAmount * leg1.rate * leg1FeeMultiplier * slippageMultiplier;
        const networkFeesApplied: NetworkFeeApplied[] = [];

        if (leg1.exchange !== leg2.exchange) {
          const fee = networkFeesByAsset[intermediate.toUpperCase()];
          if (!Number.isFinite(fee) || fee <= 0) {
            deps.logger.warn({ intermediate, exchange1, exchange2 }, 'Network fee indisponível para transferência entre exchanges.');
            continue;
          }
          afterLeg1 = Math.max(afterLeg1 - fee, 0);
          networkFeesApplied.push({
            asset: intermediate.toUpperCase(),
            amount: fee,
            fromExchange: leg1.exchange,
            toExchange: leg2.exchange,
          });
        }

        let afterLeg2 = afterLeg1 * leg2.rate * leg2FeeMultiplier * slippageMultiplier;
        if (leg2.exchange !== leg3.exchange) {
          const fee = networkFeesByAsset[params.quoteAsset.toUpperCase()];
          if (!Number.isFinite(fee) || fee <= 0) {
            deps.logger.warn({ quoteAsset: params.quoteAsset, exchange2, exchange3 }, 'Network fee indisponível para transferência entre exchanges.');
            continue;
          }
          afterLeg2 = Math.max(afterLeg2 - fee, 0);
          networkFeesApplied.push({
            asset: params.quoteAsset.toUpperCase(),
            amount: fee,
            fromExchange: leg2.exchange,
            toExchange: leg3.exchange,
          });
        }

        const finalAmount = afterLeg2 * leg3.rate * leg3FeeMultiplier * slippageMultiplier;
        const edgePct = ((finalAmount - startAmount) / startAmount) * 100;
        const networkFeeTotal = networkFeesApplied.reduce((sum, fee) => sum + fee.amount, 0);

        results.push({
          intermediateAsset: intermediate,
          startAsset: params.startAsset,
          endAsset: params.startAsset,
          edgePct: Math.round(edgePct * 100) / 100,
          finalAmount: Math.round(finalAmount * 1000000) / 1000000,
          networkFeeTotal: Math.round(networkFeeTotal * 1000000) / 1000000,
          networkFeesApplied,
          legs: [leg1, leg2, leg3],
        });
      }
    }

    if (results.length === 0) return [];
    const sorted = results.sort((a, b) => b.edgePct - a.edgePct);
    return sorted.slice(0, 3);
  }

  return {
    getOrderBookSnapshot,
    calculateTriangularArbitrage,
  };
}
