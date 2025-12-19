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
// CORREÇÃO 19/12/2025: Remover 'and' não utilizado (no-unused-vars)
import { getDatabase, schema, eq, desc, sql } from '@alice/database';
import type { InsertTradingMarketData, TradingCandleData } from '@alice/shared';

const logger = createLogger('market-data-collector');

// ============================================================================
// CONFIGURAÇÃO
// ============================================================================

// URL base da API KuCoin Futures
const KUCOIN_FUTURES_API = process.env.KUCOIN_FUTURES_BASE_URL || 'https://api-futures.kucoin.com';

// Símbolo padrão (BTC/USDT Perpetual)
const DEFAULT_SYMBOL = 'XBTUSDTM';

// Intervalos de candles suportados pela KuCoin Futures API
// Granularidade em minutos - mínimo 1 minuto (API não suporta 30 segundos)
// Para scalping: 1min, 3min, 5min são essenciais
const CANDLE_INTERVALS = {
  '1min': 1,      // SCALPING - menor intervalo disponível
  '3min': 3,      // SCALPING - curto prazo
  '5min': 5,      // SCALPING/SWING
  '15min': 15,
  '30min': 30,
  '1hour': 60,
  '2hour': 120,
  '4hour': 240,
  '6hour': 360,
  '8hour': 480,
  '12hour': 720,
  '1day': 1440,
  '1week': 10080,
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

// RESILIÊNCIA: Timeout para chamadas à API externa (Best Practices 2025)
// Evita que o serviço trave se a API KuCoin não responder
const KUCOIN_API_TIMEOUT_MS = 15000; // 15 segundos

/**
 * Coleta candles históricos da KuCoin
 * GET /api/v1/kline/query
 * 
 * CORREÇÃO AUDITORIA 17/12/2025: Adicionado timeout via AbortSignal
 * Bug: fetch() sem timeout podia travar o serviço indefinidamente
 */
async function fetchCandles(
  symbol: string,
  granularity: number,
  from: number,
  to: number
): Promise<KucoinCandle[]> {
  const url = `${KUCOIN_FUTURES_API}/api/v1/kline/query?symbol=${symbol}&granularity=${granularity}&from=${from}&to=${to}`;
  
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(KUCOIN_API_TIMEOUT_MS),
    });
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
    // Distinguir timeout de outros erros para melhor diagnóstico
    const errorMessage = error instanceof Error && error.name === 'TimeoutError'
      ? 'Timeout ao buscar candles da KuCoin'
      : 'Erro na requisição de candles';
    logger.error({ error, symbol, granularity }, errorMessage);
    return [];
  }
}

/**
 * Coleta taxa de funding atual
 * GET /api/v1/funding-rate/{symbol}/current
 * 
 * CORREÇÃO AUDITORIA 17/12/2025: Adicionado timeout via AbortSignal
 */
async function fetchFundingRate(symbol: string): Promise<KucoinFundingRate | null> {
  const url = `${KUCOIN_FUTURES_API}/api/v1/funding-rate/${symbol}/current`;
  
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(KUCOIN_API_TIMEOUT_MS),
    });
    const data = await response.json() as { code: string; data: KucoinFundingRate };
    
    if (data.code !== '200000' || !data.data) {
      logger.warn({ code: data.code, symbol }, 'Erro ao buscar funding rate');
      return null;
    }

    return data.data;
  } catch (error) {
    const errorMessage = error instanceof Error && error.name === 'TimeoutError'
      ? 'Timeout ao buscar funding rate da KuCoin'
      : 'Erro na requisição de funding rate';
    logger.error({ error, symbol }, errorMessage);
    return null;
  }
}

/**
 * Coleta open interest atual
 * GET /api/v1/contracts/active
 * 
 * CORREÇÃO AUDITORIA 17/12/2025: Adicionado timeout via AbortSignal
 */
async function fetchOpenInterest(symbol: string): Promise<number | null> {
  const url = `${KUCOIN_FUTURES_API}/api/v1/contracts/${symbol}`;
  
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(KUCOIN_API_TIMEOUT_MS),
    });
    const data = await response.json() as { code: string; data: { openInterest: string } };
    
    if (data.code !== '200000' || !data.data) {
      return null;
    }

    return parseFloat(data.data.openInterest);
  } catch (error) {
    const errorMessage = error instanceof Error && error.name === 'TimeoutError'
      ? 'Timeout ao buscar open interest da KuCoin'
      : 'Erro na requisição de open interest';
    logger.error({ error, symbol }, errorMessage);
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
  // Todos os intervalos suportados pela API KuCoin Futures
  type CandleDataType = 'candle_1m' | 'candle_3m' | 'candle_5m' | 'candle_15m' | 'candle_30m' | 
    'candle_1h' | 'candle_2h' | 'candle_4h' | 'candle_6h' | 'candle_8h' | 'candle_12h' | 
    'candle_1d' | 'candle_1w';
  
  const dataTypeMap: Record<number, CandleDataType> = {
    1: 'candle_1m',      // SCALPING
    3: 'candle_3m',      // SCALPING
    5: 'candle_5m',      // SCALPING/SWING
    15: 'candle_15m',
    30: 'candle_30m',
    60: 'candle_1h',
    120: 'candle_2h',
    240: 'candle_4h',
    360: 'candle_6h',
    480: 'candle_8h',
    720: 'candle_12h',
    1440: 'candle_1d',
    10080: 'candle_1w',
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

      // Bug fix: Usar RETURNING para verificar se registro foi realmente inserido
      // onConflictDoNothing() não lança erro em duplicatas, apenas retorna vazio
      const insertResult = await db
        .insert(schema.tradingMarketData)
        .values(marketData)
        .onConflictDoNothing()
        .returning({ id: schema.tradingMarketData.id });

      // Se retornou registro, foi inserido; se vazio, foi duplicata
      if (insertResult.length > 0) {
        result.inserted++;
      } else {
        result.duplicates++;
      }
    } catch (error) {
      result.errors++;
      logger.error({ error, candle }, 'Erro ao salvar candle');
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
  // SCALPING: 1min, 3min, 5min são essenciais para operações rápidas
  // SWING: 15min, 30min, 1hour para médio prazo
  // POSITION: 4hour, 1day para análise de tendência
  const intervals: CandleInterval[] = [
    '1min',   // SCALPING - essencial
    '3min',   // SCALPING - essencial
    '5min',   // SCALPING/SWING
    '15min',
    '30min',
    '1hour',
    '4hour',
  ];
  
  // Quantidade de horas de histórico a coletar por intervalo
  // Intervalos menores = menos histórico (mais frequente)
  // Intervalos maiores = mais histórico (menos frequente)
  const hoursBackMap: Record<CandleInterval, number> = {
    '1min': 1,      // 1 hora de 1min candles (60 candles) - SCALPING
    '3min': 2,      // 2 horas de 3min candles (40 candles) - SCALPING
    '5min': 4,      // 4 horas de 5min candles (48 candles)
    '15min': 8,     // 8 horas de 15min candles (32 candles)
    '30min': 12,    // 12 horas de 30min candles (24 candles)
    '1hour': 24,    // 24 horas de 1h candles
    '2hour': 48,    // 2 dias de 2h candles
    '4hour': 96,    // 4 dias de 4h candles
    '6hour': 144,   // 6 dias de 6h candles
    '8hour': 192,   // 8 dias de 8h candles
    '12hour': 360,  // 15 dias de 12h candles
    '1day': 720,    // 30 dias de 1d candles
    '1week': 2160,  // ~3 meses de weekly candles
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
 * Coleta dados de alta frequência para SCALPING
 * Foco em candles de 1min, 3min e 5min com histórico curto
 * Ideal para rodar a cada 1-5 minutos via scheduler
 */
export async function collectScalpingData(
  symbol: string = DEFAULT_SYMBOL
): Promise<{
  candles: Record<string, CollectionResult>;
  ticker: boolean;
}> {
  logger.info({ symbol }, 'Iniciando coleta de dados de scalping');

  const results = {
    candles: {} as Record<string, CollectionResult>,
    ticker: false,
  };

  // Intervalos essenciais para scalping
  const scalpingIntervals: CandleInterval[] = ['1min', '3min', '5min'];
  const scalpingHoursBack: Record<string, number> = {
    '1min': 0.5,    // 30 minutos de candles de 1min (30 candles)
    '3min': 1,      // 1 hora de candles de 3min (20 candles)
    '5min': 2,      // 2 horas de candles de 5min (24 candles)
  };

  for (const interval of scalpingIntervals) {
    results.candles[interval] = await collectCandles(
      symbol,
      interval,
      scalpingHoursBack[interval]
    );
    // Delay mínimo para scalping (200ms)
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // Coletar ticker atual para preço em tempo real
  // CORREÇÃO AUDITORIA 17/12/2025: Adicionado timeout via AbortSignal
  try {
    const tickerUrl = `${KUCOIN_FUTURES_API}/api/v1/ticker?symbol=${symbol}`;
    const response = await fetch(tickerUrl, {
      signal: AbortSignal.timeout(KUCOIN_API_TIMEOUT_MS),
    });
    const data = await response.json() as { 
      code: string; 
      data: { 
        price: string; 
        bestBidPrice: string; 
        bestAskPrice: string;
        size: number;
        ts: number;
      } 
    };

    if (data.code === '200000' && data.data) {
      const db = getDatabase();
      await db
        .insert(schema.tradingMarketData)
        .values({
          symbol,
          dataType: 'ticker',
          timestamp: new Date(data.data.ts),
          data: {
            price: parseFloat(data.data.price),
            bestBid: parseFloat(data.data.bestBidPrice),
            bestAsk: parseFloat(data.data.bestAskPrice),
            size: data.data.size,
          },
          source: 'kucoin',
        })
        .onConflictDoNothing();
      
      results.ticker = true;
    }
  } catch (error) {
    logger.error({ error, symbol }, 'Erro ao coletar ticker para scalping');
  }

  logger.info({ symbol, results }, 'Coleta de dados de scalping concluída');

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
  collectScalpingData,  // Alta frequência para scalping
  getMarketDataStats,
};
