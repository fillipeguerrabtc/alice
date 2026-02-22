import type { KucoinKline, KucoinOrderBook, KucoinTrade } from '../../kucoinClient.js';

function asNumber(value: string | number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface TradeFlowAggregate {
  windowStart: number;
  windowEnd: number;
  buyVolume: number;
  sellVolume: number;
  deltaVolume: number;
  cvd: number;
}

export interface MicrostructureFeatures {
  bidAskSpreadBps: number;
  spreadWideningBps: number;
  orderBookImbalance: number;
  depthDropRatio: number;
  microPrice: number;
  aggressiveFlowDelta: number;
  cvd: number;
}

export function computeOrderBookImbalance(orderBook: KucoinOrderBook, levels = 5): number {
  const bids = orderBook.bids.slice(0, levels);
  const asks = orderBook.asks.slice(0, levels);
  const bidVolume = bids.reduce((sum, [, size]) => sum + asNumber(size), 0);
  const askVolume = asks.reduce((sum, [, size]) => sum + asNumber(size), 0);
  const total = bidVolume + askVolume;
  if (total <= 0) return 0;
  return (bidVolume - askVolume) / total;
}

export function computeMicroPrice(orderBook: KucoinOrderBook): number {
  const bestBid = orderBook.bids[0];
  const bestAsk = orderBook.asks[0];
  if (!bestBid || !bestAsk) return 0;

  const bidPrice = asNumber(bestBid[0]);
  const askPrice = asNumber(bestAsk[0]);
  const bidSize = asNumber(bestBid[1]);
  const askSize = asNumber(bestAsk[1]);

  const denom = bidSize + askSize;
  if (denom <= 0) return (bidPrice + askPrice) / 2;
  return ((askPrice * bidSize) + (bidPrice * askSize)) / denom;
}

export function computeSpreadBps(orderBook: KucoinOrderBook): number {
  const bestBid = orderBook.bids[0];
  const bestAsk = orderBook.asks[0];
  if (!bestBid || !bestAsk) return 0;
  const bidPrice = asNumber(bestBid[0]);
  const askPrice = asNumber(bestAsk[0]);
  const mid = (bidPrice + askPrice) / 2;
  if (mid <= 0) return 0;
  return ((askPrice - bidPrice) / mid) * 10_000;
}

export function aggregateTradeFlow(trades: KucoinTrade[], windowMs = 60_000): TradeFlowAggregate[] {
  if (trades.length === 0) return [];
  const sorted = [...trades].sort((a, b) => a.ts - b.ts);
  const start = sorted[0]?.ts ?? 0;
  const end = sorted[sorted.length - 1]?.ts ?? start;
  const windows: TradeFlowAggregate[] = [];

  let currentStart = start;
  let currentEnd = start + windowMs;
  let cumulativeCvd = 0;

  while (currentStart <= end) {
    let buyVolume = 0;
    let sellVolume = 0;
    for (const trade of sorted) {
      if (trade.ts < currentStart || trade.ts >= currentEnd) continue;
      const size = asNumber(trade.size);
      if (trade.side === 'buy') {
        buyVolume += size;
      } else {
        sellVolume += size;
      }
    }
    const deltaVolume = buyVolume - sellVolume;
    cumulativeCvd += deltaVolume;
    windows.push({
      windowStart: currentStart,
      windowEnd: currentEnd,
      buyVolume,
      sellVolume,
      deltaVolume,
      cvd: cumulativeCvd,
    });
    currentStart = currentEnd;
    currentEnd += windowMs;
  }

  return windows;
}

function depthTopN(orderBook: KucoinOrderBook, levels: number): number {
  const bidDepth = orderBook.bids.slice(0, levels).reduce((sum, [, size]) => sum + asNumber(size), 0);
  const askDepth = orderBook.asks.slice(0, levels).reduce((sum, [, size]) => sum + asNumber(size), 0);
  return bidDepth + askDepth;
}

export function computeMicrostructureFeatures(input: {
  currentOrderBook: KucoinOrderBook;
  previousOrderBook?: KucoinOrderBook;
  recentTrades: KucoinTrade[];
  recentCandles: KucoinKline[];
}): MicrostructureFeatures {
  const bidAskSpreadBps = computeSpreadBps(input.currentOrderBook);
  const previousSpreadBps = input.previousOrderBook ? computeSpreadBps(input.previousOrderBook) : bidAskSpreadBps;
  const spreadWideningBps = Math.max(0, bidAskSpreadBps - previousSpreadBps);

  const currentDepth = depthTopN(input.currentOrderBook, 5);
  const previousDepth = input.previousOrderBook ? depthTopN(input.previousOrderBook, 5) : currentDepth;
  const depthDropRatio = previousDepth > 0 ? Math.max(0, (previousDepth - currentDepth) / previousDepth) : 0;

  const tradeAgg = aggregateTradeFlow(input.recentTrades);
  const lastAgg = tradeAgg[tradeAgg.length - 1];
  const aggressiveFlowDelta = lastAgg?.deltaVolume ?? 0;
  const cvd = lastAgg?.cvd ?? 0;

  return {
    bidAskSpreadBps,
    spreadWideningBps,
    orderBookImbalance: computeOrderBookImbalance(input.currentOrderBook),
    depthDropRatio,
    microPrice: computeMicroPrice(input.currentOrderBook),
    aggressiveFlowDelta,
    cvd,
  };
}
