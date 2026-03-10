import { tradingIntervalEnum } from '@alice/shared';
import * as kucoinClient from './kucoinClient.js';

export const KUCOIN_REST_ORDERBOOK_DEPTHS = [20] as const;
export const KUCOIN_WS_ORDERBOOK_DEPTHS = [5, 50] as const;

export function parseTradingIntervalToMinutes(interval: string): number | null {
  const normalized = interval.trim().toLowerCase();
  const match = /^(\d+)(m|h|d|w)$/.exec(normalized);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = match[2];
  if (unit === 'm') return value;
  if (unit === 'h') return value * 60;
  if (unit === 'd') return value * 1440;
  if (unit === 'w') return value * 10080;
  return null;
}

export function resolveKucoinRestOrderBookDepth(): 20 {
  const raw = process.env.KUCOIN_REST_ORDERBOOK_DEPTH;
  if (!raw) {
    throw new Error('KUCOIN_REST_ORDERBOOK_DEPTH não configurado');
  }
  const parsed = Number(raw);
  if (!KUCOIN_REST_ORDERBOOK_DEPTHS.includes(parsed as (typeof KUCOIN_REST_ORDERBOOK_DEPTHS)[number])) {
    throw new Error(`KUCOIN_REST_ORDERBOOK_DEPTH inválido: ${raw}. Use 20.`);
  }
  return parsed as 20;
}

export function resolveKucoinWsOrderBookDepth(): 5 | 50 {
  const raw = process.env.KUCOIN_WS_ORDERBOOK_DEPTH;
  if (!raw) {
    throw new Error('KUCOIN_WS_ORDERBOOK_DEPTH não configurado');
  }
  const parsed = Number(raw);
  if (!KUCOIN_WS_ORDERBOOK_DEPTHS.includes(parsed as (typeof KUCOIN_WS_ORDERBOOK_DEPTHS)[number])) {
    throw new Error(`KUCOIN_WS_ORDERBOOK_DEPTH inválido: ${raw}. Use 5 ou 50.`);
  }
  return parsed as 5 | 50;
}

export function resolveTradingIntervals(): {
  intervals: string[];
  granularityMap: Record<string, number>;
  wsIntervalMap: Record<string, string>;
  defaultInterval: string;
  restOrderBookDepth: 20;
  restOrderBookDepths: number[];
  wsOrderBookDepth: 5 | 50;
  wsOrderBookDepths: number[];
} {
  const intervals = tradingIntervalEnum.enumValues;
  if (!intervals.length) {
    throw new Error('Enum de intervalos de trading vazio');
  }
  const granularityMap: Record<string, number> = {};
  const wsIntervalMap: Record<string, string> = {};
  for (const interval of intervals) {
    const minutes = parseTradingIntervalToMinutes(interval);
    if (!minutes) {
      throw new Error(`Intervalo de trading inválido no schema: ${interval}`);
    }
    granularityMap[interval] = minutes;
    wsIntervalMap[interval] = kucoinClient.granularityToInterval(minutes);
  }
  return {
    intervals: [...intervals],
    granularityMap,
    wsIntervalMap,
    defaultInterval: intervals[0]!,
    restOrderBookDepth: resolveKucoinRestOrderBookDepth(),
    restOrderBookDepths: [...KUCOIN_REST_ORDERBOOK_DEPTHS],
    wsOrderBookDepth: resolveKucoinWsOrderBookDepth(),
    wsOrderBookDepths: [...KUCOIN_WS_ORDERBOOK_DEPTHS],
  };
}

export function getAllowedGranularitiesMinutes(): number[] {
  const minutes = tradingIntervalEnum.enumValues
    .map((interval) => parseTradingIntervalToMinutes(interval))
    .filter((value): value is number => value !== null);
  return minutes.sort((a, b) => a - b);
}

export function isValidKucoinWsInterval(interval: string): boolean {
  const normalized = interval.trim();
  const granularity = kucoinClient.intervalToGranularity(normalized);
  return kucoinClient.granularityToInterval(granularity) === normalized;
}

type SpotMarginMarketType = 'spot' | 'margin';
type SpotWsSubscriptionKey = `${SpotMarginMarketType}:${'cross' | 'isolated' | 'none'}`;
export type SpotWsSubscriptionMeta = { marketType: SpotMarginMarketType; marginMode?: 'cross' | 'isolated' };
const spotWsTopicMarketTypes = new Map<string, Set<SpotWsSubscriptionKey>>();

function buildSpotWsSubscriptionKey(marketType: SpotMarginMarketType, marginMode?: 'cross' | 'isolated'): SpotWsSubscriptionKey {
  if (marketType === 'margin') {
    return `margin:${marginMode ?? 'cross'}`;
  }
  return 'spot:none';
}

export function registerSpotWsMarketType(topic: string, marketType: SpotMarginMarketType, marginMode?: 'cross' | 'isolated'): void {
  const key = buildSpotWsSubscriptionKey(marketType, marginMode);
  const existing = spotWsTopicMarketTypes.get(topic);
  if (existing) {
    existing.add(key);
    return;
  }
  spotWsTopicMarketTypes.set(topic, new Set([key]));
}

export function unregisterSpotWsMarketType(topic: string, marketType: SpotMarginMarketType, marginMode?: 'cross' | 'isolated'): boolean {
  const key = buildSpotWsSubscriptionKey(marketType, marginMode);
  const existing = spotWsTopicMarketTypes.get(topic);
  if (!existing) return false;
  existing.delete(key);
  if (existing.size === 0) {
    spotWsTopicMarketTypes.delete(topic);
    return true;
  }
  return false;
}

export function getSpotMarketTypesForTopic(topic: string): SpotWsSubscriptionMeta[] {
  const existing = spotWsTopicMarketTypes.get(topic);
  if (!existing) return [];
  return Array.from(existing).map((key) => {
    const [marketType, marginMode] = key.split(':') as [SpotMarginMarketType, 'cross' | 'isolated' | 'none'];
    return marketType === 'margin' ? { marketType, marginMode: marginMode === 'none' ? 'cross' : marginMode } : { marketType };
  });
}

export function resolveSpotSymbolFromTopic(topic: string): string | null {
  const parts = topic.split(':');
  if (parts.length < 2) return null;
  const symbolPart = parts[1] ?? '';
  const symbol = symbolPart.split('_')[0]?.trim();
  return symbol ? symbol.toUpperCase() : null;
}
