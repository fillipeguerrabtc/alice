/**
 * Snapshot Store - Armazena snapshots de mercado para post-mortem e datasets
 * 
 * Cada snapshot captura o estado do mercado em um momento específico:
 * - market_entry: Estado do mercado no momento da entrada
 * - market_exit: Estado do mercado no momento da saída
 * - candles: Candles históricos no momento da captura
 * - orderbook_top: Top N níveis do order book
 * - news: Notícias relevantes no período
 * - evidence_pack: Pacote consolidado de evidências para post-mortem
 * 
 * Arquitetura: JSONB nativo com compressão TOAST automática do PostgreSQL
 * 
 * @author Fillipe Guerra
 * @since 09/02/2026
 */

import { createLogger } from '@alice/logger';
import { getDatabase, schema } from '@alice/database';
import { eq, and, sql } from '@alice/database';
import * as kucoinClient from './kucoinClient.js';
import * as kucoinSpotClient from './kucoinSpotClient.js';

const logger = createLogger('snapshot-store');

// ============================================================================
// Tipos
// ============================================================================

/** Tipos de snapshot suportados */
export type SnapshotKind = 'market_entry' | 'market_exit' | 'candles' | 'orderbook_top' | 'news' | 'evidence_pack';

/** Dados de ticker capturados no snapshot */
interface TickerData {
  symbol: string;
  price: number;
  bestBid: number;
  bestAsk: number;
  volume24h: number;
  change24h: number;
  timestamp: string;
}

/** Dados de orderbook top */
interface OrderBookTopData {
  symbol: string;
  bids: Array<{ price: number; size: number }>;
  asks: Array<{ price: number; size: number }>;
  timestamp: string;
}

/** Dados de candles */
interface CandleData {
  symbol: string;
  interval: string;
  candles: Array<{
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  capturedAt: string;
}

/** Resultado de captura de snapshot */
export interface SnapshotResult {
  id: string;
  kind: SnapshotKind;
  createdAt: Date;
}

/** Evidence Pack para post-mortem */
export interface EvidencePack {
  entrySnapshotId: string;
  exitSnapshotId: string;
  candlesSnapshotId?: string;
  orderbookSnapshotId?: string;
  indicators: Record<string, unknown>;
  capturedAt: string;
}

// ============================================================================
// Funções de Captura
// ============================================================================

/**
 * Salva um snapshot no banco de dados
 */
export async function saveSnapshot(params: {
  tenantId: string;
  kind: SnapshotKind;
  data: Record<string, unknown>;
  refs?: Record<string, unknown>;
}): Promise<SnapshotResult> {
  const { tenantId, kind, data, refs } = params;
  const db = getDatabase();

  const [snapshot] = await db
    .insert(schema.tradingSnapshots)
    .values({
      tenantId,
      kind,
      data,
      refs: refs ?? {},
    })
    .returning({ id: schema.tradingSnapshots.id, kind: schema.tradingSnapshots.kind, createdAt: schema.tradingSnapshots.createdAt });

  logger.info({ snapshotId: snapshot.id, kind, tenantId }, `Snapshot ${kind} salvo com sucesso`);

  return {
    id: snapshot.id,
    kind: snapshot.kind as SnapshotKind,
    createdAt: snapshot.createdAt!,
  };
}

/**
 * Busca um snapshot por ID
 */
export async function getSnapshot(id: string): Promise<typeof schema.tradingSnapshots.$inferSelect | null> {
  const db = getDatabase();
  const [snapshot] = await db
    .select()
    .from(schema.tradingSnapshots)
    .where(eq(schema.tradingSnapshots.id, id))
    .limit(1);

  return snapshot ?? null;
}

/**
 * Busca snapshots por referências (ex: positionId)
 */
export async function getSnapshotsByRefs(params: {
  tenantId: string;
  refKey: string;
  refValue: string;
}): Promise<Array<typeof schema.tradingSnapshots.$inferSelect>> {
  const { tenantId, refKey, refValue } = params;
  const db = getDatabase();

  const snapshots = await db
    .select()
    .from(schema.tradingSnapshots)
    .where(
      and(
        eq(schema.tradingSnapshots.tenantId, tenantId),
        sql`${schema.tradingSnapshots.refs}->>${refKey} = ${refValue}`
      )
    );

  return snapshots;
}

/**
 * Captura snapshot de entrada: ticker + orderbook top + candles recentes
 * Chamado quando uma posição é aberta (demo ou real)
 */
export async function captureEntrySnapshot(params: {
  tenantId: string;
  symbol: string;
  marketType: 'spot' | 'futures' | 'margin';
  positionId: string;
}): Promise<SnapshotResult> {
  const { tenantId, symbol, marketType, positionId } = params;

  logger.info({ symbol, marketType, positionId }, 'Capturando snapshot de entrada');

  let tickerData: TickerData | null = null;
  let orderbookData: OrderBookTopData | null = null;
  let candlesData: CandleData | null = null;

  try {
    // Captura ticker atual
    if (marketType === 'futures') {
      const ticker = await kucoinClient.getTicker(symbol);
      if (ticker) {
        tickerData = {
          symbol,
          price: parseFloat(String(ticker.price ?? '0')),
          bestBid: parseFloat(String(ticker.bestBidPrice ?? '0')),
          bestAsk: parseFloat(String(ticker.bestAskPrice ?? '0')),
          volume24h: ticker.size ?? 0,
          change24h: 0, // KuCoin Futures ticker não fornece change rate diretamente
          timestamp: new Date().toISOString(),
        };
      }
    } else {
      const ticker = await kucoinSpotClient.getSpotTicker(symbol);
      if (ticker) {
        tickerData = {
          symbol,
          price: parseFloat(String(ticker.price ?? '0')),
          bestBid: parseFloat(String(ticker.bestBid ?? '0')),
          bestAsk: parseFloat(String(ticker.bestAsk ?? '0')),
          volume24h: parseFloat(String(ticker.size ?? '0')),
          change24h: 0, // Calculado separadamente se necessário
          timestamp: new Date().toISOString(),
        };
      }
    }
  } catch (error) {
    logger.warn({ error, symbol }, 'Falha ao capturar ticker para snapshot de entrada');
  }

  try {
    // Captura orderbook top 5
    if (marketType === 'futures') {
      const ob = await kucoinClient.getOrderBook(symbol, 20);
      if (ob) {
        orderbookData = {
          symbol,
          bids: (ob.bids ?? []).slice(0, 5).map((b: [string, number]) => ({ price: Number(b[0]), size: b[1] })),
          asks: (ob.asks ?? []).slice(0, 5).map((a: [string, number]) => ({ price: Number(a[0]), size: a[1] })),
          timestamp: new Date().toISOString(),
        };
      }
    }
  } catch (error) {
    logger.warn({ error, symbol }, 'Falha ao capturar orderbook para snapshot de entrada');
  }

  try {
    // Captura últimas 50 candles de 5m
    if (marketType === 'futures') {
      const now = Math.floor(Date.now() / 1000);
      const from = now - (50 * 5 * 60); // 50 candles de 5m
      const klines = await kucoinClient.getKlines(symbol, 5, from, now);
      if (klines && klines.length > 0) {
        candlesData = {
          symbol,
          interval: '5m',
          candles: klines.map((k) => ({
            timestamp: k.time,
            open: Number(k.open),
            high: Number(k.high),
            low: Number(k.low),
            close: Number(k.close),
            volume: Number(k.volume),
          })),
          capturedAt: new Date().toISOString(),
        };
      }
    }
  } catch (error) {
    logger.warn({ error, symbol }, 'Falha ao capturar candles para snapshot de entrada');
  }

  const snapshotData: Record<string, unknown> = {
    ticker: tickerData,
    orderbook: orderbookData,
    candles: candlesData,
    marketType,
    capturedAt: new Date().toISOString(),
  };

  return saveSnapshot({
    tenantId,
    kind: 'market_entry',
    data: snapshotData,
    refs: { positionId, symbol, marketType },
  });
}

/**
 * Captura snapshot de saída: ticker + orderbook top no momento do fechamento
 * Chamado quando uma posição é fechada (demo ou real)
 */
export async function captureExitSnapshot(params: {
  tenantId: string;
  symbol: string;
  marketType: 'spot' | 'futures' | 'margin';
  positionId: string;
}): Promise<SnapshotResult> {
  const { tenantId, symbol, marketType, positionId } = params;

  logger.info({ symbol, marketType, positionId }, 'Capturando snapshot de saída');

  let tickerData: TickerData | null = null;

  try {
    if (marketType === 'futures') {
      const ticker = await kucoinClient.getTicker(symbol);
      if (ticker) {
        tickerData = {
          symbol,
          price: parseFloat(String(ticker.price ?? '0')),
          bestBid: parseFloat(String(ticker.bestBidPrice ?? '0')),
          bestAsk: parseFloat(String(ticker.bestAskPrice ?? '0')),
          volume24h: ticker.size ?? 0,
          change24h: 0,
          timestamp: new Date().toISOString(),
        };
      }
    } else {
      const ticker = await kucoinSpotClient.getSpotTicker(symbol);
      if (ticker) {
        tickerData = {
          symbol,
          price: parseFloat(String(ticker.price ?? '0')),
          bestBid: parseFloat(String(ticker.bestBid ?? '0')),
          bestAsk: parseFloat(String(ticker.bestAsk ?? '0')),
          volume24h: parseFloat(String(ticker.size ?? '0')),
          change24h: 0,
          timestamp: new Date().toISOString(),
        };
      }
    }
  } catch (error) {
    logger.warn({ error, symbol }, 'Falha ao capturar ticker para snapshot de saída');
  }

  const snapshotData: Record<string, unknown> = {
    ticker: tickerData,
    marketType,
    capturedAt: new Date().toISOString(),
  };

  return saveSnapshot({
    tenantId,
    kind: 'market_exit',
    data: snapshotData,
    refs: { positionId, symbol, marketType },
  });
}

/**
 * Salva Evidence Pack consolidado como snapshot
 */
export async function saveEvidencePack(params: {
  tenantId: string;
  positionId: string;
  evidencePack: EvidencePack;
}): Promise<SnapshotResult> {
  const { tenantId, positionId, evidencePack } = params;

  return saveSnapshot({
    tenantId,
    kind: 'evidence_pack',
    data: evidencePack as unknown as Record<string, unknown>,
    refs: { positionId },
  });
}
