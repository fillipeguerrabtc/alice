/**
 * Trading Market Data Collector - Alice Enterprise Platform
 * 
 * Serviço de coleta automática de dados de mercado para treinamento LoRA.
 * Coleta candles, funding rates e open interest da KuCoin Futures.
 * 
 * Funcionalidades:
 * - Coleta periódica via cron job
 * - Deduplicação automática
 * - Persistência em PostgreSQL
 * - Métricas Prometheus para monitoramento
 * 
 * Autor: Fillipe Guerra
 * Data: 17 de Dezembro de 2025
 */

import { createLogger } from '@alice/logger';
import { getDatabase, schema, eq, and, desc, sql } from '@alice/database';
import type { InsertTradingMarketData, TradingCandleData } from '@alice/shared';

const logger = createLogger('market-data-collector');

// ============================================================================
// CONFIGURAÇÃO
// ============================================================================

// URL base da API KuCoin Futures
const KUCOIN_FUTURES_API = process.env.KUCOIN_FUTURES_BASE_URL || 'https://api-futures.kucoin.com';

// Símbolo padrão (BTC/USDT Perpetual)
const DEFAULT_SYMBOL = 'XBTUSDTM';

// Intervalos de candles suportados
const CANDLE_INTERVALS = {
  '1min': 1,
  '5min': 5,
  '15min': 15,
  '1hour': 60,
  '4hour': 240,
  '1day': 1440,
} as const;

type CandleInterval = keyof typeof CANDLE_INTERVALS;

// ============================================================================
// TIPOS
// ============================================================================

interface KucoinCandle {
  time: number;        // Timestamp em segundos
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  turnover: string;
}

interface KucoinFundingRate {
  symbol: string;
  granularity: number;
  timePoint: number;
  value: number;
  predictedValue: number;
}

interface CollectionResult {
  inserted: number;
  duplicates: number;
  errors: number;
}

// ============================================================================
// FUNÇÕES DE COLETA (KuCoin API pública - sem autenticação)
// ============================================================================

/**
 * Coleta candles históricos da KuCoin
 * GET /api/v1/kline/query
 */
async function fetchCandles(
  symbol: string,
  granularity: number,
  from: number,
  to: number
): Promise<KucoinCandle[]> {
  const url = `${KUCOIN_FUTURES_API}/api/v1/kline/query?symbol=${symbol}&granularity=${granularity}&from=${from}&to=${to}`;
  
  try {
    const response = await fetch(url);
    const data = await response.json() as { code: string; data: number[][] };
    
    if (data.code !== '200000' || !data.data) {
      logger.warn({ code: data.code, symbol, granularity }, 'Erro ao buscar candles');
      return [];
    }

    // KuCoin retorna array de arrays: [time, open, high, low, close, volume, turnover]
    return data.data.map((candle: number[]) => ({
      time: candle[0],
      open: candle[1].toString(),
      high: candle[2].toString(),
      low: candle[3].toString(),
      close: candle[4].toString(),
      volume: candle[5].toString(),
      turnover: candle[6]?.toString() || '0',
    }));
  } catch (error) {
    logger.error({ error, symbol, granularity }, 'Erro na requisição de candles');
    return [];
  }
}

/**
 * Coleta taxa de funding atual
 * GET /api/v1/funding-rate/{symbol}/current
 */
async function fetchFundingRate(symbol: string): Promise<KucoinFundingRate | null> {
  const url = `${KUCOIN_FUTURES_API}/api/v1/funding-rate/${symbol}/current`;
  
  try {
    const response = await fetch(url);
    const data = await response.json() as { code: string; data: KucoinFundingRate };
    
    if (data.code !== '200000' || !data.data) {
      logger.warn({ code: data.code, symbol }, 'Erro ao buscar funding rate');
      return null;
    }

    return data.data;
  } catch (error) {
    logger.error({ error, symbol }, 'Erro na requisição de funding rate');
    return null;
  }
}

/**
 * Coleta open interest atual
 * GET /api/v1/contracts/active
 */
async function fetchOpenInterest(symbol: string): Promise<number | null> {
  const url = `${KUCOIN_FUTURES_API}/api/v1/contracts/${symbol}`;
  
  try {
    const response = await fetch(url);
    const data = await response.json() as { code: string; data: { openInterest: string } };
    
    if (data.code !== '200000' || !data.data) {
      return null;
    }

    return parseFloat(data.data.openInterest);
  } catch (error) {
    logger.error({ error, symbol }, 'Erro na requisição de open interest');
    return null;
  }
}

// ============================================================================
// FUNÇÕES DE PERSISTÊNCIA
// ============================================================================

/**
 * Salva candles no banco de dados
 */
async function saveCandles(
  candles: KucoinCandle[],
  symbol: string,
  intervalMinutes: number
): Promise<CollectionResult> {
  const db = getDatabase();
  const result: CollectionResult = { inserted: 0, duplicates: 0, errors: 0 };

  // Mapear intervalo para tipo enum
  const dataTypeMap: Record<number, 'candle_1m' | 'candle_5m' | 'candle_15m' | 'candle_1h' | 'candle_4h' | 'candle_1d'> = {
    1: 'candle_1m',
    5: 'candle_5m',
    15: 'candle_15m',
    60: 'candle_1h',
    240: 'candle_4h',
    1440: 'candle_1d',
  };

  const dataType = dataTypeMap[intervalMinutes];
  if (!dataType) {
    logger.error({ intervalMinutes }, 'Intervalo não suportado');
    return result;
  }

  for (const candle of candles) {
    try {
      const candleData: TradingCandleData = {
        open: parseFloat(candle.open),
        high: parseFloat(candle.high),
        low: parseFloat(candle.low),
        close: parseFloat(candle.close),
        volume: parseFloat(candle.volume),
        turnover: parseFloat(candle.turnover),
      };

      const marketData: InsertTradingMarketData = {
        symbol,
        dataType,
        timestamp: new Date(candle.time * 1000),
        data: candleData,
        source: 'kucoin',
      };

      // Usar ON CONFLICT para evitar duplicatas
      await db
        .insert(schema.tradingMarketData)
        .values(marketData)
        .onConflictDoNothing();

      result.inserted++;
    } catch (error) {
      // Verifica se é erro de duplicata
      if ((error as Error).message?.includes('duplicate')) {
        result.duplicates++;
      } else {
        result.errors++;
        logger.error({ error, candle }, 'Erro ao salvar candle');
      }
    }
  }

  return result;
}

/**
 * Salva funding rate no banco de dados
 */
async function saveFundingRate(
  fundingRate: KucoinFundingRate,
  symbol: string
): Promise<boolean> {
  const db = getDatabase();

  try {
    const marketData: InsertTradingMarketData = {
      symbol,
      dataType: 'funding_rate',
      timestamp: new Date(fundingRate.timePoint),
      data: {
        value: fundingRate.value,
        predictedValue: fundingRate.predictedValue,
        granularity: fundingRate.granularity,
      },
      source: 'kucoin',
    };

    await db
      .insert(schema.tradingMarketData)
      .values(marketData)
      .onConflictDoNothing();

    return true;
  } catch (error) {
    logger.error({ error, fundingRate }, 'Erro ao salvar funding rate');
    return false;
  }
}

/**
 * Salva open interest no banco de dados
 */
async function saveOpenInterest(
  openInterest: number,
  symbol: string
): Promise<boolean> {
  const db = getDatabase();

  try {
    const marketData: InsertTradingMarketData = {
      symbol,
      dataType: 'open_interest',
      timestamp: new Date(),
      data: { value: openInterest },
      source: 'kucoin',
    };

    await db
      .insert(schema.tradingMarketData)
      .values(marketData)
      .onConflictDoNothing();

    return true;
  } catch (error) {
    logger.error({ error, openInterest }, 'Erro ao salvar open interest');
    return false;
  }
}

// ============================================================================
// JOBS DE COLETA
// ============================================================================

/**
 * Coleta candles de um intervalo específico
 */
export async function collectCandles(
  symbol: string = DEFAULT_SYMBOL,
  interval: CandleInterval = '1hour',
  hoursBack: number = 24
): Promise<CollectionResult> {
  const granularity = CANDLE_INTERVALS[interval];
  const now = Math.floor(Date.now() / 1000);
  const from = now - (hoursBack * 3600);

  logger.info({ symbol, interval, hoursBack }, 'Iniciando coleta de candles');

  const candles = await fetchCandles(symbol, granularity, from, now);
  
  if (candles.length === 0) {
    logger.warn({ symbol, interval }, 'Nenhum candle retornado');
    return { inserted: 0, duplicates: 0, errors: 0 };
  }

  const result = await saveCandles(candles, symbol, granularity);
  
  logger.info(
    { symbol, interval, ...result, total: candles.length },
    'Coleta de candles concluída'
  );

  return result;
}

/**
 * Coleta todos os dados de mercado para um símbolo
 */
export async function collectAllMarketData(
  symbol: string = DEFAULT_SYMBOL
): Promise<{
  candles: Record<string, CollectionResult>;
  fundingRate: boolean;
  openInterest: boolean;
}> {
  logger.info({ symbol }, 'Iniciando coleta completa de market data');

  const results = {
    candles: {} as Record<string, CollectionResult>,
    fundingRate: false,
    openInterest: false,
  };

  // Coletar candles de diferentes intervalos
  const intervals: CandleInterval[] = ['1min', '5min', '15min', '1hour', '4hour'];
  const hoursBackMap: Record<CandleInterval, number> = {
    '1min': 2,      // 2 horas de 1min candles
    '5min': 6,      // 6 horas de 5min candles
    '15min': 12,    // 12 horas de 15min candles
    '1hour': 24,    // 24 horas de 1h candles
    '4hour': 96,    // 4 dias de 4h candles
    '1day': 720,    // 30 dias de 1d candles (não coletado no job regular)
  };

  for (const interval of intervals) {
    results.candles[interval] = await collectCandles(
      symbol,
      interval,
      hoursBackMap[interval]
    );
    // Pequeno delay para não sobrecarregar a API
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Coletar funding rate
  const fundingRate = await fetchFundingRate(symbol);
  if (fundingRate) {
    results.fundingRate = await saveFundingRate(fundingRate, symbol);
  }

  // Coletar open interest
  const openInterest = await fetchOpenInterest(symbol);
  if (openInterest !== null) {
    results.openInterest = await saveOpenInterest(openInterest, symbol);
  }

  logger.info({ symbol, results }, 'Coleta completa de market data concluída');

  return results;
}

/**
 * Obtém estatísticas do banco de dados de market data
 */
export async function getMarketDataStats(symbol: string = DEFAULT_SYMBOL): Promise<{
  totalRecords: number;
  byType: Record<string, number>;
  oldestRecord: Date | null;
  newestRecord: Date | null;
}> {
  const db = getDatabase();

  // Total de registros
  const [totalResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.tradingMarketData)
    .where(eq(schema.tradingMarketData.symbol, symbol));

  // Contagem por tipo
  const typeResults = await db
    .select({
      dataType: schema.tradingMarketData.dataType,
      count: sql<number>`count(*)`,
    })
    .from(schema.tradingMarketData)
    .where(eq(schema.tradingMarketData.symbol, symbol))
    .groupBy(schema.tradingMarketData.dataType);

  const byType: Record<string, number> = {};
  for (const row of typeResults) {
    byType[row.dataType] = Number(row.count);
  }

  // Registro mais antigo
  const [oldestResult] = await db
    .select({ timestamp: schema.tradingMarketData.timestamp })
    .from(schema.tradingMarketData)
    .where(eq(schema.tradingMarketData.symbol, symbol))
    .orderBy(schema.tradingMarketData.timestamp)
    .limit(1);

  // Registro mais recente
  const [newestResult] = await db
    .select({ timestamp: schema.tradingMarketData.timestamp })
    .from(schema.tradingMarketData)
    .where(eq(schema.tradingMarketData.symbol, symbol))
    .orderBy(desc(schema.tradingMarketData.timestamp))
    .limit(1);

  return {
    totalRecords: Number(totalResult?.count ?? 0),
    byType,
    oldestRecord: oldestResult?.timestamp ?? null,
    newestRecord: newestResult?.timestamp ?? null,
  };
}

export default {
  collectCandles,
  collectAllMarketData,
  getMarketDataStats,
};
