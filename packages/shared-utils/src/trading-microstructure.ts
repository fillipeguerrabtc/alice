export interface OrderBookSnapshot {
  asks: Array<[number, number]>;
  bids: Array<[number, number]>;
}

export interface TradeTick {
  ts: number;
  side: 'buy' | 'sell';
  size: number;
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

function topDepth(snapshot: OrderBookSnapshot, levels: number): number {
  const bidDepth = snapshot.bids.slice(0, levels).reduce((sum, [, size]) => sum + size, 0);
  const askDepth = snapshot.asks.slice(0, levels).reduce((sum, [, size]) => sum + size, 0);
  return bidDepth + askDepth;
}

export function computeOrderBookImbalance(snapshot: OrderBookSnapshot, levels = 5): number {
  const bidVolume = snapshot.bids.slice(0, levels).reduce((sum, [, size]) => sum + size, 0);
  const askVolume = snapshot.asks.slice(0, levels).reduce((sum, [, size]) => sum + size, 0);
  const total = bidVolume + askVolume;
  if (total <= 0) return 0;
  return (bidVolume - askVolume) / total;
}

export function computeMicroPrice(snapshot: OrderBookSnapshot): number {
  const bestBid = snapshot.bids[0];
  const bestAsk = snapshot.asks[0];
  if (!bestBid || !bestAsk) return 0;
  const [bidPrice, bidSize] = bestBid;
  const [askPrice, askSize] = bestAsk;
  const denom = bidSize + askSize;
  if (denom <= 0) return (bidPrice + askPrice) / 2;
  return ((askPrice * bidSize) + (bidPrice * askSize)) / denom;
}

export function computeSpreadBps(snapshot: OrderBookSnapshot): number {
  const bestBid = snapshot.bids[0];
  const bestAsk = snapshot.asks[0];
  if (!bestBid || !bestAsk) return 0;
  const mid = (bestBid[0] + bestAsk[0]) / 2;
  if (mid <= 0) return 0;
  return ((bestAsk[0] - bestBid[0]) / mid) * 10_000;
}

export function aggregateTradeFlow(ticks: TradeTick[], windowMs = 60_000): TradeFlowAggregate[] {
  if (ticks.length === 0) return [];
  const sorted = [...ticks].sort((a, b) => a.ts - b.ts);
  const start = sorted[0]?.ts ?? 0;
  const end = sorted[sorted.length - 1]?.ts ?? start;
  const output: TradeFlowAggregate[] = [];

  let windowStart = start;
  let windowEnd = start + windowMs;
  let cumulativeCvd = 0;

  while (windowStart <= end) {
    let buyVolume = 0;
    let sellVolume = 0;
    for (const tick of sorted) {
      if (tick.ts < windowStart || tick.ts >= windowEnd) continue;
      if (tick.side === 'buy') buyVolume += tick.size;
      else sellVolume += tick.size;
    }
    const deltaVolume = buyVolume - sellVolume;
    cumulativeCvd += deltaVolume;
    output.push({
      windowStart,
      windowEnd,
      buyVolume,
      sellVolume,
      deltaVolume,
      cvd: cumulativeCvd,
    });
    windowStart = windowEnd;
    windowEnd += windowMs;
  }

  return output;
}

export function computeMicrostructureFeatures(input: {
  currentOrderBook: OrderBookSnapshot;
  previousOrderBook?: OrderBookSnapshot;
  tradeFlow: TradeFlowAggregate[];
}): MicrostructureFeatures {
  const bidAskSpreadBps = computeSpreadBps(input.currentOrderBook);
  const previousSpreadBps = input.previousOrderBook ? computeSpreadBps(input.previousOrderBook) : bidAskSpreadBps;
  const spreadWideningBps = Math.max(0, bidAskSpreadBps - previousSpreadBps);
  const currentDepth = topDepth(input.currentOrderBook, 5);
  const previousDepth = input.previousOrderBook ? topDepth(input.previousOrderBook, 5) : currentDepth;
  const depthDropRatio = previousDepth > 0 ? Math.max(0, (previousDepth - currentDepth) / previousDepth) : 0;
  const latestFlow = input.tradeFlow[input.tradeFlow.length - 1];

  return {
    bidAskSpreadBps,
    spreadWideningBps,
    orderBookImbalance: computeOrderBookImbalance(input.currentOrderBook),
    depthDropRatio,
    microPrice: computeMicroPrice(input.currentOrderBook),
    aggressiveFlowDelta: latestFlow?.deltaVolume ?? 0,
    cvd: latestFlow?.cvd ?? 0,
  };
}
