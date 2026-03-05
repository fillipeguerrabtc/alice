/**
 * Serviço de Trading KuCoin Futures - Alice Enterprise Platform
 * 
 * Implementação enterprise-grade para trading de BTC perpetuals.
 * Integra com OMS (Order Management System) e EMS (Execution Management System).
 * 
 * Funcionalidades:
 * - Criação e gerenciamento de ordens
 * - Rastreamento de posições
 * - Auditoria completa de todas as operações
 * - Gestão de risco por tenant
 * - Sincronização com LLM para sinais de trading (modelo agnóstico)
 * 
 * Autor: Fillipe Guerra
 * Data: 17 de Dezembro de 2025
 */

import { createLogger } from '@alice/logger';
import { getDatabase, schema, eq, and, desc, sql } from '@alice/database';
import { appendImmutableAuditEventWithExecutor, getRedisClient } from '@alice/shared-utils';
// CORREÇÃO 19/12/2025: Remover tipos não utilizados (no-unused-vars)
// TradingPosition, TradingAuditLog, InsertTradingPosition removidos
import {
  type TradingSignal,
  type TradingOrder,
  type TradingOrderMetadata,
  type TradingRiskConfig,
  type InsertTradingSignal,
  type InsertTradingOrder,
  type InsertTradingAuditLog,
} from '@alice/shared';
import * as kucoinClient from './kucoinClient.js';
import * as kucoinSpotClient from './kucoinSpotClient.js';
import * as kucoinMarginClient from './kucoinMarginClient.js';
import { captureEntrySnapshot, captureExitSnapshot, getSnapshotsByRefs } from './snapshot-store.js';
import { enqueuePostMortem } from './postmortem-worker.js';

const logger = createLogger('kucoin-service');

type HighRiskAuditMetricObserver = (eventType: string, result: 'success' | 'error') => void;
let observeHighRiskAuditMetric: HighRiskAuditMetricObserver = () => {};

export function setHighRiskAuditMetricObserver(observer: HighRiskAuditMetricObserver): void {
  observeHighRiskAuditMetric = observer;
}

type TradingRiskGateMetricObserver = (reasonCode: string, decision: 'allow' | 'block') => void;
let observeTradingRiskGateMetric: TradingRiskGateMetricObserver = () => {};

export function setTradingRiskGateMetricObserver(observer: TradingRiskGateMetricObserver): void {
  observeTradingRiskGateMetric = observer;
}

type TradingRealOrderAttemptMetricObserver = (
  status: 'success' | 'blocked' | 'error',
  marketType: string
) => void;
let observeTradingRealOrderAttemptMetric: TradingRealOrderAttemptMetricObserver = () => {};

export function setTradingRealOrderAttemptMetricObserver(observer: TradingRealOrderAttemptMetricObserver): void {
  observeTradingRealOrderAttemptMetric = observer;
}

// Símbolo default é resolvido dinamicamente via API KuCoin (sem hardcoded).

// ============================================================================
// TIPOS ESPECÍFICOS DO SERVIÇO
// ============================================================================

/** Contexto de autenticação do usuário */
export interface TradingAuthContext {
  tenantId: string;
  userId: string;
  sessionId?: string;
}

type TradingMarketType = 'futures' | 'spot' | 'margin';
type TradingMarginMode = 'cross' | 'isolated';

/** Parâmetros para criar um sinal de trading */
export interface CreateSignalParams {
  /** Tipo do sinal - mapeado para enum do banco (entry_long, entry_short, exit, hold, neutral) */
  signalType: 'entry_long' | 'entry_short' | 'exit' | 'adjust_sl' | 'adjust_tp' | 'hold' | 'neutral';
  symbol?: string;
  marketType?: TradingMarketType;
  marginMode?: TradingMarginMode;
  confidence: number;
  reasoning?: string;
  sourceModel?: string;
  suggestedPrice?: number;
  suggestedStopLoss?: number;
  suggestedTakeProfit?: number;
  suggestedSize?: number;
  metadata?: Record<string, unknown>;
}

/** Parâmetros para criar uma ordem */
export interface CreateOrderFromSignalParams {
  signalId?: string;
  symbol?: string;
  side: 'buy' | 'sell';
  orderType: 'limit' | 'market';
  size?: number;
  price?: number;
  leverage?: number;
  marketType?: TradingMarketType;
  marginMode?: TradingMarginMode;
  funds?: number;
  reduceOnly?: boolean;
}

/** Parâmetros para ordem manual */
export interface ManualOrderParams {
  symbol?: string;
  side: 'buy' | 'sell';
  orderType: 'limit' | 'market';
  size?: number;
  price?: number;
  leverage?: number;
  marketType?: TradingMarketType;
  marginMode?: TradingMarginMode;
  funds?: number;
}

/** Resultado de operação de trading */
export interface TradingOperationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  auditLogId?: string;
}

// ============================================================================
// SÍMBOLOS (dinâmicos via KuCoin API)
// ============================================================================

function normalizeSymbolInput(input: string): string {
  return input.trim().toUpperCase();
}

function normalizeSymbolKey(input: string): string {
  return normalizeSymbolInput(input).replace(/[^A-Z0-9]/g, '');
}

// ============================================================================
// MAPEAMENTO DE SÍMBOLOS CROSS-MARKET (CR3 - 07/02/2026)
// Converte símbolos entre formatos de mercado KuCoin:
//   Futures: XBTUSDTM, ETHUSDTM (perpetual contract)
//   Spot/Margin: BTC-USDT, ETH-USDT (trading pair)
// Ref: https://www.kucoin.com/docs-new/api-3470220 (Futures symbols)
// Ref: https://www.kucoin.com/docs-new/api-3470148 (Spot symbols)
// ============================================================================

/** Aliases conhecidos da KuCoin - mapeamento base currency */
const KUCOIN_SYMBOL_ALIASES: Record<string, string> = {
  XBT: 'BTC',  // KuCoin Futures usa XBT para Bitcoin
  BTC: 'XBT',  // Reverso para conversão Spot→Futures
};

/**
 * Tenta mapear um símbolo de um mercado para outro.
 * Retorna o símbolo mapeado ou null se não conseguir.
 * 
 * Exemplos:
 *   mapSymbolBetweenMarkets('XBTUSDTM', 'futures', 'spot') → 'BTC-USDT'
 *   mapSymbolBetweenMarkets('BTC-USDT', 'spot', 'futures') → 'XBTUSDTM'
 *   mapSymbolBetweenMarkets('ETH-USDT', 'spot', 'futures') → 'ETHUSDTM'
 */
function mapSymbolBetweenMarkets(
  symbol: string,
  fromMarket: TradingMarketType,
  toMarket: TradingMarketType
): string | null {
  if (fromMarket === toMarket) return symbol;
  const trimmed = symbol.trim().toUpperCase();

  if (fromMarket === 'futures' && (toMarket === 'spot' || toMarket === 'margin')) {
    // Futures → Spot/Margin: XBTUSDTM → BTC-USDT
    // Formato Futures KuCoin: <BASE><QUOTE>M (ex: XBTUSDTM, ETHUSDTM)
    const futuresMatch = trimmed.match(/^([A-Z]+)(USDT|USD|USDCM?)M$/);
    if (!futuresMatch) return null;
    let base = futuresMatch[1];
    let quote = futuresMatch[2];
    // Resolver aliases (XBT → BTC)
    if (KUCOIN_SYMBOL_ALIASES[base]) {
      base = KUCOIN_SYMBOL_ALIASES[base];
    }
    // Remover sufixo C de USDCM se necessário
    if (quote === 'USDCM') quote = 'USDC';
    return `${base}-${quote}`;
  }

  if ((fromMarket === 'spot' || fromMarket === 'margin') && toMarket === 'futures') {
    // Spot/Margin → Futures: BTC-USDT → XBTUSDTM
    // Formato Spot KuCoin: <BASE>-<QUOTE> (ex: BTC-USDT, ETH-USDT)
    const spotMatch = trimmed.match(/^([A-Z0-9]+)-([A-Z]+)$/);
    if (!spotMatch) return null;
    let base = spotMatch[1];
    const quote = spotMatch[2];
    // Resolver aliases reverso (BTC → XBT para Futures)
    if (base === 'BTC') base = 'XBT';
    return `${base}${quote}M`;
  }

  // Spot ↔ Margin: mesmo formato (BTC-USDT)
  return symbol;
}

async function resolveMarketType(
  authContext: TradingAuthContext,
  marketType?: TradingMarketType
): Promise<TradingMarketType> {
  if (marketType) return marketType;
  const config = await getRiskConfig(authContext);
  return (config?.defaultMarketType as TradingMarketType | undefined) ?? 'futures';
}

async function resolveMarginMode(
  authContext: TradingAuthContext,
  marginMode?: TradingMarginMode
): Promise<TradingMarginMode> {
  if (marginMode) return marginMode;
  const config = await getRiskConfig(authContext);
  return (config?.marginMode as TradingMarginMode | undefined) ?? 'cross';
}

// CORREÇÃO CR6 (07/02/2026): Cache Redis de símbolos com TTL 5min para reduzir chamadas à API KuCoin.
// Cada mercado/modo tem chave separada. Cache é best-effort: se Redis indisponível, busca da API diretamente.
const SYMBOLS_CACHE_TTL_SECONDS = 300; // 5 minutos

function buildSymbolsCacheKey(marketType: TradingMarketType, marginMode: TradingMarginMode): string {
  if (marketType === 'margin') {
    return `alice:trading:symbols:${marketType}:${marginMode}`;
  }
  return `alice:trading:symbols:${marketType}`;
}

async function getAllowedSymbolsByMarketType(
  authContext: TradingAuthContext,
  marketType: TradingMarketType,
  marginMode: TradingMarginMode
): Promise<string[]> {
  const cacheKey = buildSymbolsCacheKey(marketType, marginMode);
  const redis = getRedisClient();

  // Tentar ler do cache Redis
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const symbols = JSON.parse(cached) as string[];
        if (Array.isArray(symbols) && symbols.length > 0) {
          logger.debug({ marketType, marginMode, count: symbols.length }, 'Símbolos retornados do cache Redis');
          return symbols;
        }
      }
    } catch (err) {
      logger.warn({ err, cacheKey }, 'Erro ao ler cache de símbolos Redis (continuando com API)');
    }
  }

  // Buscar da API KuCoin
  let symbols: string[];
  if (marketType === 'spot') {
    const spotSymbols = await kucoinSpotClient.getSpotSymbols();
    symbols = spotSymbols.map((item) => item.symbol).filter((symbol): symbol is string => Boolean(symbol));
  } else if (marketType === 'margin') {
    const marginSymbols = marginMode === 'isolated'
      ? await kucoinMarginClient.getIsolatedMarginSymbols()
      : await kucoinMarginClient.getCrossMarginSymbols();
    symbols = marginSymbols.map((item) => item.symbol).filter((symbol): symbol is string => Boolean(symbol));
  } else {
    symbols = await kucoinClient.getAllowedSymbols();
  }

  // Salvar no cache Redis (best-effort)
  if (redis && symbols.length > 0) {
    try {
      await redis.set(cacheKey, JSON.stringify(symbols), { EX: SYMBOLS_CACHE_TTL_SECONDS });
      logger.debug({ marketType, marginMode, count: symbols.length }, 'Símbolos salvos no cache Redis');
    } catch (err) {
      logger.warn({ err, cacheKey }, 'Erro ao salvar cache de símbolos Redis');
    }
  }

  return symbols;
}

function parseKucoinVolume(value?: string | number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
}

function resolveNormalizedSymbolInList(input: string, allowed: string[]): string | null {
  const raw = normalizeSymbolInput(input);
  if (allowed.includes(raw)) return raw;
  const normalizedInput = normalizeSymbolKey(raw);
  const match = allowed.find((symbol) => normalizeSymbolKey(symbol) === normalizedInput);
  return match ?? null;
}

// ============================================================================
// VALIDAÇÃO DE FORMATO DE SÍMBOLO POR MERCADO
// ============================================================================

/**
 * Valida se o formato do símbolo é compatível com o mercado especificado.
 *
 * Formatos conforme documentação oficial KuCoin 2025:
 * - Futures: XBTUSDTM, ETHUSDTM (termina com 'M' - Marca de contrato perpétuo)
 *   Ref: https://www.kucoin.com/docs-new/api-3470220
 * - Spot/Margin: BTC-USDT, ETH-USDT (base-quote separados por hífen)
 *   Ref: https://www.kucoin.com/docs-new/api-3470148
 *
 * @returns true se formato válido para o mercado, false caso contrário
 */
export function validateSymbolFormatForMarket(symbol: string, marketType: TradingMarketType): boolean {
  if (marketType === 'futures') {
    // Futures: símbolo termina com 'M' (ex: XBTUSDTM, ETHUSDTM, SOLUSDTM)
    return /^[A-Z0-9]+M$/.test(symbol);
  }
  // Spot/Margin: símbolo contém hífen separando base e quote (ex: BTC-USDT, ETH-BTC)
  return /^[A-Z0-9]+-[A-Z0-9]+$/.test(symbol);
}

async function resolveDefaultSymbolByMarket(
  authContext: TradingAuthContext,
  marketType: TradingMarketType,
  marginMode: TradingMarginMode
): Promise<string> {
  if (marketType === 'futures') {
    return kucoinClient.getDefaultSymbol();
  }
  const allowed = await getAllowedSymbolsByMarketType(authContext, marketType, marginMode);
  if (allowed.length === 0) {
    throw new Error('KuCoin não retornou símbolos ativos para o mercado selecionado.');
  }
  return allowed[0];
}

export async function getTradingSymbols(
  authContext: TradingAuthContext,
  marketType?: TradingMarketType,
  marginMode?: TradingMarginMode
): Promise<{ symbols: string[]; contracts?: kucoinClient.KucoinContract[] }> {
  const resolvedMarket = await resolveMarketType(authContext, marketType);
  const resolvedMargin = await resolveMarginMode(authContext, marginMode);

  if (resolvedMarket === 'futures') {
    const contracts = await kucoinClient.getActiveContracts();
    const symbols = contracts
      .map((contract) => contract.symbol?.trim())
      .filter((symbol): symbol is string => Boolean(symbol));

    const uniqueSymbols = Array.from(new Set(symbols));
    if (uniqueSymbols.length === 0) {
      throw new Error('KuCoin não retornou símbolos ativos (contracts/active vazio).');
    }
    return { symbols: uniqueSymbols, contracts };
  }

  const allowed = await getAllowedSymbolsByMarketType(authContext, resolvedMarket, resolvedMargin);
  if (allowed.length === 0) {
    throw new Error('KuCoin não retornou símbolos ativos para o mercado selecionado.');
  }
  return { symbols: Array.from(new Set(allowed)) };
}

export async function getTopSymbolsByMarket(
  authContext: TradingAuthContext,
  marketType?: TradingMarketType,
  marginMode?: TradingMarginMode,
  limit: number = 8
): Promise<string[]> {
  const resolvedMarket = await resolveMarketType(authContext, marketType);
  const resolvedMargin = await resolveMarginMode(authContext, marginMode);
  const { symbols, contracts } = await getTradingSymbols(authContext, resolvedMarket, resolvedMargin);
  if (symbols.length === 0) return [];

  if (resolvedMarket === 'futures' && contracts) {
    return contracts
      .filter((contract) => contract.symbol && symbols.includes(contract.symbol))
      .sort((a, b) => (b.turnoverOf24h ?? 0) - (a.turnoverOf24h ?? 0))
      .map((contract) => contract.symbol)
      .slice(0, limit);
  }

  const tickers = await kucoinSpotClient.getSpotAllTickers();
  const allowedSet = new Set(symbols);
  return tickers
    .filter((ticker) => ticker.symbol && allowedSet.has(ticker.symbol))
    .sort((a, b) => {
      const volumeA = parseKucoinVolume(a.volValue ?? a.vol);
      const volumeB = parseKucoinVolume(b.volValue ?? b.vol);
      return volumeB - volumeA;
    })
    .map((ticker) => ticker.symbol)
    .slice(0, limit);
}

export async function resolveTradingSymbol(
  authContext: TradingAuthContext,
  input?: string,
  marketType?: TradingMarketType,
  marginMode?: TradingMarginMode
): Promise<string> {
  if (marketType || marginMode) {
    const resolvedMarket = await resolveMarketType(authContext, marketType);
    const resolvedMargin = await resolveMarginMode(authContext, marginMode);
    if (input) {
      const allowed = await getAllowedSymbolsByMarketType(authContext, resolvedMarket, resolvedMargin);
      const resolved = resolveNormalizedSymbolInList(input, allowed);
      if (resolved) return resolved;
    }

    const config = await getRiskConfig(authContext);
    if (config?.defaultSymbol) {
      const allowed = await getAllowedSymbolsByMarketType(authContext, resolvedMarket, resolvedMargin);
      const normalizedDefault = resolveNormalizedSymbolInList(config.defaultSymbol, allowed);
      if (normalizedDefault) return normalizedDefault;

      // CORREÇÃO CR3 (07/02/2026): Tentar mapear símbolo cross-market antes de usar fallback.
      // Ex: defaultSymbol é XBTUSDTM (Futures) mas mercado selecionado é Spot → mapeia para BTC-USDT
      const configMarketType = (config.defaultMarketType as TradingMarketType) ?? 'futures';
      const mapped = mapSymbolBetweenMarkets(config.defaultSymbol, configMarketType, resolvedMarket);
      if (mapped) {
        const mappedResolved = resolveNormalizedSymbolInList(mapped, allowed);
        if (mappedResolved) {
          logger.info(
            { tenantId: authContext.tenantId, defaultSymbol: config.defaultSymbol, mappedSymbol: mappedResolved, fromMarket: configMarketType, toMarket: resolvedMarket },
            'Símbolo default mapeado cross-market com sucesso'
          );
          return mappedResolved;
        }
      }
      logger.warn(
        { tenantId: authContext.tenantId, defaultSymbol: config.defaultSymbol, marketType: resolvedMarket, marginMode: resolvedMargin },
        'Símbolo default configurado no tenant não é válido para o mercado selecionado (mesmo após tentativa de mapeamento cross-market)'
      );
    }

    const fallback = await resolveDefaultSymbolByMarket(authContext, resolvedMarket, resolvedMargin);
    if (config) {
      await getDatabase()
        .update(schema.tradingRiskConfig)
        .set({ defaultSymbol: fallback, atualizadoEm: new Date() })
        .where(eq(schema.tradingRiskConfig.tenantId, authContext.tenantId));

      await logTradingAction(
        authContext,
        'UPDATE_DEFAULT_SYMBOL',
        'risk_config',
        config.id,
        { defaultSymbol: fallback },
        config as unknown as Record<string, unknown>,
        { ...config, defaultSymbol: fallback } as unknown as Record<string, unknown>
      );
    }

    return fallback;
  }

  const resolved = await resolveNormalizedSymbol(input);
  if (resolved) return resolved;

  const config = await getRiskConfig(authContext);
  if (config?.defaultSymbol) {
    const normalizedDefault = await resolveNormalizedSymbol(config.defaultSymbol);
    if (normalizedDefault) return normalizedDefault;
    logger.warn(
      { tenantId: authContext.tenantId, defaultSymbol: config.defaultSymbol },
      'Símbolo default configurado no tenant não é válido na KuCoin'
    );
  }

  const fallback = await kucoinClient.getDefaultSymbol();

  if (config) {
    await getDatabase()
      .update(schema.tradingRiskConfig)
      .set({ defaultSymbol: fallback, atualizadoEm: new Date() })
      .where(eq(schema.tradingRiskConfig.tenantId, authContext.tenantId));

    await logTradingAction(
      authContext,
      'UPDATE_DEFAULT_SYMBOL',
      'risk_config',
      config.id,
      { defaultSymbol: fallback },
      config as unknown as Record<string, unknown>,
      { ...config, defaultSymbol: fallback } as unknown as Record<string, unknown>
    );
  }

  return fallback;
}

export async function resolveTradingSymbolStrict(
  authContext: TradingAuthContext,
  input?: string,
  marketType?: TradingMarketType,
  marginMode?: TradingMarginMode
): Promise<string> {
  if (marketType || marginMode) {
    if (!input) {
      return resolveTradingSymbol(authContext, input, marketType, marginMode);
    }
    const resolvedMarket = await resolveMarketType(authContext, marketType);
    const resolvedMargin = await resolveMarginMode(authContext, marginMode);
    const allowed = await getAllowedSymbolsByMarketType(authContext, resolvedMarket, resolvedMargin);
    const resolved = resolveNormalizedSymbolInList(input, allowed);
    if (!resolved) {
      throw new Error(`Símbolo inválido: ${input}. Valores permitidos: ${allowed.join(', ')}`);
    }
    return resolved;
  }
  if (input) {
    const resolved = await resolveNormalizedSymbol(input);
    if (!resolved) {
      const allowed = await kucoinClient.getAllowedSymbols();
      throw new Error(`Símbolo inválido: ${input}. Valores permitidos: ${allowed.join(', ')}`);
    }
    return resolved;
  }

  return resolveTradingSymbol(authContext);
}
async function resolveNormalizedSymbol(input?: string): Promise<string | null> {
  if (!input) return null;
  const raw = normalizeSymbolInput(input);
  const allowed = await kucoinClient.getAllowedSymbols();

  if (allowed.includes(raw)) return raw;

  const normalizedInput = normalizeSymbolKey(raw);
  const match = allowed.find((symbol) => normalizeSymbolKey(symbol) === normalizedInput);
  return match ?? null;
}

// ============================================================================
// AUDITORIA (Regra 6 - Persistência real, compliance)
// ============================================================================

/**
 * Registra ação no audit log de trading
 * CORREÇÃO 18/12/2025: Campo 'details' não existe no schema - usar newState
 */
async function logTradingAction(
  authContext: TradingAuthContext,
  action: string,
  entityType: string,
  entityId: string,
  details: Record<string, unknown>,
  previousState?: Record<string, unknown>,
  newState?: Record<string, unknown>
): Promise<string> {
  const db = getDatabase();
  const normalizedAction = action.toLowerCase();
  const isHighRiskAction = normalizedAction.includes('approve')
    || normalizedAction.includes('reject')
    || normalizedAction.includes('risk')
    || normalizedAction.includes('override');

  try {
    const [result] = await db.transaction(async (tx) => {
      // CORRECAO: Mesclar details com newState ja que schema nao tem campo details
      const mergedNewState = newState ? { ...newState, _details: details } : details;

      const auditEntry: InsertTradingAuditLog = {
        tenantId: authContext.tenantId,
        userId: authContext.userId,
        action,
        entityType,
        entityId,
        previousState: previousState ?? null,
        newState: mergedNewState,
        ipAddress: null, // Sera preenchido pelo middleware
        userAgent: null, // Sera preenchido pelo middleware
      };

      const inserted = await tx
        .insert(schema.tradingAuditLog)
        .values(auditEntry)
        .returning({ id: schema.tradingAuditLog.id });

      await appendImmutableAuditEventWithExecutor({
        executor: tx,
        input: {
          tenantId: authContext.tenantId,
          actorUserId: authContext.userId,
          sourceService: 'integrations-service',
          stream: 'trading_operations',
          streamKey: `${entityType}:${entityId}`,
          eventType: action,
          resourceType: entityType,
          resourceId: entityId,
          requestId: authContext.sessionId ?? null,
          ipAddress: null,
          userAgent: null,
          payload: {
            details,
            previousState: previousState ?? null,
            newState: newState ?? null,
          },
        },
      });

      return inserted;
    });

    if (isHighRiskAction) {
      observeHighRiskAuditMetric(normalizedAction, 'success');
    }

    logger.info(
      { auditLogId: result.id, action, entityType, entityId },
      'Acao de trading registrada no audit log'
    );

    return result.id;
  } catch (error) {
    if (isHighRiskAction) {
      observeHighRiskAuditMetric(normalizedAction, 'error');
    }
    throw error;
  }
}

export async function recordTradingAuditEvent(params: {
  authContext: TradingAuthContext;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
  previousState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
}): Promise<{ auditLogId: string }> {
  const auditLogId = await logTradingAction(
    params.authContext,
    params.action,
    params.entityType,
    params.entityId,
    params.details,
    params.previousState,
    params.newState
  );
  return { auditLogId };
}

// ============================================================================
// GESTÃO DE RISCO
// ============================================================================

/**
 * Obtém configuração de risco do tenant
 */
export async function getRiskConfig(
  authContext: TradingAuthContext
): Promise<TradingRiskConfig | null> {
  const db = getDatabase();
  
  const [config] = await db
    .select()
    .from(schema.tradingRiskConfig)
    .where(eq(schema.tradingRiskConfig.tenantId, authContext.tenantId))
    .limit(1);

  return config ?? null;
}

/**
 * Cria ou atualiza configuração de risco
 */
export async function upsertRiskConfig(
  authContext: TradingAuthContext,
  config: Partial<Omit<TradingRiskConfig, 'id' | 'tenantId' | 'criadoEm' | 'atualizadoEm'>>
): Promise<TradingOperationResult<TradingRiskConfig>> {
  const db = getDatabase();
  
  try {
    const existingConfig = await getRiskConfig(authContext);
    
    if (existingConfig) {
      // Atualizar
      const [updated] = await db
        .update(schema.tradingRiskConfig)
        .set({
          ...config,
          atualizadoEm: new Date(),
        })
        .where(eq(schema.tradingRiskConfig.tenantId, authContext.tenantId))
        .returning();

      await logTradingAction(
        authContext,
        'UPDATE_RISK_CONFIG',
        'risk_config',
        updated.id,
        { changes: config },
        existingConfig as unknown as Record<string, unknown>,
        updated as unknown as Record<string, unknown>
      );

      return { success: true, data: updated };
    } else {
      // Criar
      const [created] = await db
        .insert(schema.tradingRiskConfig)
        .values({
          tenantId: authContext.tenantId,
          ...config,
        })
        .returning();

      await logTradingAction(
        authContext,
        'CREATE_RISK_CONFIG',
        'risk_config',
        created.id,
        { config },
        undefined,
        created as unknown as Record<string, unknown>
      );

      return { success: true, data: created };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao atualizar configuração de risco');
    return { success: false, error: errorMessage };
  }
}

/**
 * Verifica se trading está habilitado e dentro dos limites de risco
 * 
 * CORREÇÃO 17/12/2025: Adicionada validação defensiva contra NaN
 * Bug: Se orderSize ou orderValue forem NaN, comparações como `NaN > X` retornam false
 * Isso permitia bypass silencioso da validação de risco
 */
export async function validateTradingAllowed(
  authContext: TradingAuthContext,
  orderSize: number,
  orderValue: number
): Promise<{ allowed: boolean; reason?: string; reasonCode: string; decision: 'allow' | 'block' }> {
  const block = (reasonCode: string, reason: string) => {
    observeTradingRiskGateMetric(reasonCode, 'block');
    return { allowed: false as const, reason, reasonCode, decision: 'block' as const };
  };

  // CORREÇÃO 17/12/2025: Validação defensiva contra NaN/Infinity
  // Garante que valores inválidos não passem silenciosamente pela validação
  if (!Number.isFinite(orderSize) || orderSize <= 0) {
    return block('invalid_order_size', `Tamanho da ordem inválido: ${orderSize}. Deve ser um número positivo.`);
  }
  
  if (!Number.isFinite(orderValue) || orderValue <= 0) {
    return block('invalid_order_value', `Valor da ordem inválido: ${orderValue}. Deve ser um número positivo.`);
  }

  const config = await getRiskConfig(authContext);
  
  if (!config) {
    return block('risk_config_missing', 'Configuração de risco não encontrada. Configure antes de operar.');
  }

  if (!config.tradingEnabled) {
    return block('trading_disabled', 'Trading desabilitado para este tenant.');
  }

  // Validar maxPositionSize com proteção contra NaN
  const maxPositionSize = Number(config.maxPositionSize);
  if (!Number.isFinite(maxPositionSize)) {
    return block(
      'invalid_max_position_size_config',
      `Configuração maxPositionSize inválida: ${config.maxPositionSize}. Contate administrador.`
    );
  }
  
  if (orderSize > maxPositionSize) {
    return block(
      'max_position_size_exceeded',
      `Tamanho da ordem (${orderSize}) excede limite máximo (${maxPositionSize}).`
    );
  }

  // Validar maxOrderValue com proteção contra NaN
  const maxOrderValue = Number(config.maxOrderValue);
  if (!Number.isFinite(maxOrderValue)) {
    return block(
      'invalid_max_order_value_config',
      `Configuração maxOrderValue inválida: ${config.maxOrderValue}. Contate administrador.`
    );
  }
  
  if (orderValue > maxOrderValue) {
    return block(
      'max_order_value_exceeded',
      `Valor da ordem (${orderValue.toFixed(2)} USD) excede limite máximo (${maxOrderValue.toFixed(2)} USD).`
    );
  }

  observeTradingRiskGateMetric('allowed', 'allow');
  return { allowed: true, reasonCode: 'allowed', decision: 'allow' };
}

// ============================================================================
// SINAIS DE TRADING (Gerados pelo LLM - modelo agnóstico)
// ============================================================================

/**
 * Cria um novo sinal de trading
 */
export async function createSignal(
  authContext: TradingAuthContext,
  params: CreateSignalParams
): Promise<TradingOperationResult<TradingSignal>> {
  const db = getDatabase();
  
  try {
    const resolvedMarketType = await resolveMarketType(authContext, params.marketType);
    const resolvedMarginMode = await resolveMarginMode(authContext, params.marginMode);
    const symbol = await resolveTradingSymbolStrict(authContext, params.symbol, resolvedMarketType, resolvedMarginMode);

    // CORREÇÃO 18/12/2025: reasoning e sourceModel não existem como colunas
    // Esses campos vão no metadata (JSONB com TradingSignalMetadataSchema)
    const signalData: InsertTradingSignal = {
      tenantId: authContext.tenantId,
      signalType: params.signalType,
      marketType: resolvedMarketType,
      symbol,
      suggestedPrice: params.suggestedPrice,
      suggestedStopLoss: params.suggestedStopLoss,
      suggestedTakeProfit: params.suggestedTakeProfit,
      suggestedSize: params.suggestedSize,
      confidence: params.confidence,
      metadata: {
        ...params.metadata,
        reasoning: params.reasoning,
        ...(params.sourceModel ? { modelVersion: params.sourceModel } : {}),
      },
      isActive: true,
    };

    const [signal] = await db
      .insert(schema.tradingSignals)
      .values(signalData)
      .returning();

    const auditLogId = await logTradingAction(
      authContext,
      'CREATE_SIGNAL',
      'signal',
      signal.id,
      { params },
      undefined,
      signal as unknown as Record<string, unknown>
    );

    logger.info(
      { signalId: signal.id, signalType: params.signalType, confidence: params.confidence },
      'Sinal de trading criado'
    );

    return { success: true, data: signal, auditLogId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage, params }, 'Erro ao criar sinal de trading');
    return { success: false, error: errorMessage };
  }
}

/**
 * Lista sinais de trading ativos
 */
export async function getActiveSignals(
  authContext: TradingAuthContext,
  limit: number = 10,
  marketType?: TradingMarketType
): Promise<TradingSignal[]> {
  const db = getDatabase();
  
  const signals = await db
    .select()
    .from(schema.tradingSignals)
    .where(
      and(
        eq(schema.tradingSignals.tenantId, authContext.tenantId),
        eq(schema.tradingSignals.isActive, true),
        marketType ? eq(schema.tradingSignals.marketType, marketType) : undefined
      )
    )
    .orderBy(desc(schema.tradingSignals.criadoEm))
    .limit(limit);

  return signals;
}

/**
 * Desativa um sinal de trading
 */
export async function deactivateSignal(
  authContext: TradingAuthContext,
  signalId: string
): Promise<TradingOperationResult<TradingSignal>> {
  const db = getDatabase();
  
  try {
    const [existing] = await db
      .select()
      .from(schema.tradingSignals)
      .where(
        and(
          eq(schema.tradingSignals.id, signalId),
          eq(schema.tradingSignals.tenantId, authContext.tenantId)
        )
      )
      .limit(1);

    if (!existing) {
      return { success: false, error: 'Sinal não encontrado.' };
    }

    // CORREÇÃO 18/12/2025: tradingSignals não tem atualizadoEm - remover
    const [updated] = await db
      .update(schema.tradingSignals)
      .set({ isActive: false })
      .where(eq(schema.tradingSignals.id, signalId))
      .returning();

    await logTradingAction(
      authContext,
      'DEACTIVATE_SIGNAL',
      'signal',
      signalId,
      {},
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>
    );

    return { success: true, data: updated };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage, signalId }, 'Erro ao desativar sinal');
    return { success: false, error: errorMessage };
  }
}

// ============================================================================
// APROVAÇÃO MANUAL DE SINAIS/ORDENS (PENDING_REVIEW)
// ============================================================================

type PendingOrderUpdateInput = {
  price?: number;
  size?: number;
  leverage?: number;
  orderType?: 'limit' | 'market' | 'stop_limit' | 'stop_market' | 'take_profit';
  stopLoss?: number;
  takeProfit?: number;
};

function clampSuggestedSize(raw?: number): number | null {
  if (!Number.isFinite(raw) || raw === undefined || raw === null) return null;
  if (raw <= 0) return null;
  return raw > 1 ? 1 : raw;
}

function resolveStopLossTakeProfit(params: {
  side: 'buy' | 'sell';
  currentPrice: number;
  signalStopLoss?: number;
  signalTakeProfit?: number;
  defaultStopLoss?: number;
  defaultTakeProfit?: number;
}): { stopLoss?: number; takeProfit?: number } {
  const stopLoss = Number.isFinite(params.signalStopLoss) ? params.signalStopLoss : undefined;
  const takeProfit = Number.isFinite(params.signalTakeProfit) ? params.signalTakeProfit : undefined;
  if (stopLoss !== undefined || takeProfit !== undefined) {
    return { stopLoss, takeProfit };
  }
  if (!Number.isFinite(params.defaultStopLoss) && !Number.isFinite(params.defaultTakeProfit)) {
    return {};
  }
  const isLong = params.side === 'buy';
  const resolvedStopLoss = Number.isFinite(params.defaultStopLoss)
    ? params.currentPrice * (isLong ? 1 - params.defaultStopLoss! : 1 + params.defaultStopLoss!)
    : undefined;
  const resolvedTakeProfit = Number.isFinite(params.defaultTakeProfit)
    ? params.currentPrice * (isLong ? 1 + params.defaultTakeProfit! : 1 - params.defaultTakeProfit!)
    : undefined;
  return { stopLoss: resolvedStopLoss, takeProfit: resolvedTakeProfit };
}

function resolveHybridOrderSize(params: {
  maxPositionSize: number;
  maxOrderValue: number;
  currentPrice: number;
  contractMultiplier?: number;
  suggestedSize?: number | null;
  marketType: TradingMarketType;
}): { size: number; sizeRule: string } {
  const maxPositionSize = Number(params.maxPositionSize);
  const maxOrderValue = Number(params.maxOrderValue);
  const currentPrice = Number(params.currentPrice);
  if (!Number.isFinite(maxPositionSize) || maxPositionSize <= 0) {
    throw new Error('Configuração maxPositionSize inválida.');
  }
  if (!Number.isFinite(maxOrderValue) || maxOrderValue <= 0) {
    throw new Error('Configuração maxOrderValue inválida.');
  }
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    throw new Error('Preço atual inválido para cálculo de tamanho.');
  }

  const multiplier = params.marketType === 'futures'
    ? Number(params.contractMultiplier ?? 1)
    : 1;
  if (params.marketType === 'futures' && (!Number.isFinite(multiplier) || multiplier <= 0)) {
    throw new Error('Multiplicador do contrato inválido.');
  }
  const maxSizeByValue = maxOrderValue / (currentPrice * multiplier);
  const maxAllowed = Math.min(maxPositionSize, maxSizeByValue);
  if (!Number.isFinite(maxAllowed) || maxAllowed <= 0) {
    throw new Error('Tamanho máximo calculado inválido.');
  }

  const suggested = clampSuggestedSize(params.suggestedSize ?? undefined);
  const rawSize = suggested ? maxAllowed * suggested : maxAllowed;
  const size = params.marketType === 'futures'
    ? Math.max(1, Math.floor(rawSize))
    : rawSize;
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error('Tamanho calculado inválido.');
  }
  return { size, sizeRule: 'hybrid:min(maxPositionSize,maxOrderValue/currentPrice)' };
}

async function getMarketSnapshot(params: {
  authContext: TradingAuthContext;
  symbol: string;
  marketType: TradingMarketType;
  marginMode: TradingMarginMode;
}): Promise<{
  currentPrice: number;
  contractMultiplier?: number;
}> {
  if (params.marketType === 'futures') {
    const [ticker, contract] = await Promise.all([
      kucoinClient.getTicker(params.symbol),
      kucoinClient.getContractInfo(params.symbol),
    ]);
    const currentPrice = parseFloat(ticker.price);
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
      throw new Error(`Preço de mercado inválido recebido da KuCoin: "${ticker.price}".`);
    }
    return {
      currentPrice,
      contractMultiplier: contract?.multiplier ?? undefined,
    };
  }
  const spotTicker = await kucoinSpotClient.getSpotTicker(params.symbol);
  const currentPrice = parseFloat(spotTicker.price);
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    throw new Error(`Preço de mercado inválido recebido da KuCoin: "${spotTicker.price}".`);
  }
  return { currentPrice };
}

async function resolveBaseCurrency(params: {
  symbol: string;
  marketType: TradingMarketType;
  marginMode: TradingMarginMode;
}): Promise<string> {
  if (params.marketType === 'spot') {
    const symbols = await kucoinSpotClient.getSpotSymbols();
    const info = symbols.find((item) => item.symbol === params.symbol);
    if (!info?.baseCurrency) {
      throw new Error(`Não foi possível resolver moeda base do símbolo ${params.symbol}.`);
    }
    return info.baseCurrency;
  }
  if (params.marketType === 'margin') {
    const symbols = params.marginMode === 'isolated'
      ? await kucoinMarginClient.getIsolatedMarginSymbols()
      : await kucoinMarginClient.getCrossMarginSymbols();
    const info = symbols.find((item) => item.symbol === params.symbol);
    if (!info?.baseCurrency) {
      throw new Error(`Não foi possível resolver moeda base do símbolo ${params.symbol}.`);
    }
    return info.baseCurrency;
  }
  throw new Error('Moeda base não aplicável para Futures.');
}

async function resolveExitSize(params: {
  symbol: string;
  marketType: TradingMarketType;
  marginMode: TradingMarginMode;
}): Promise<number> {
  if (params.marketType === 'spot') {
    const baseCurrency = await resolveBaseCurrency(params);
    const accounts = await kucoinSpotClient.getSpotAccounts('trade');
    const account = accounts.find((entry) => entry.currency === baseCurrency);
    const available = Number(account?.available ?? 0);
    if (!Number.isFinite(available) || available <= 0) {
      throw new Error(`Saldo disponível insuficiente para ${baseCurrency}.`);
    }
    return available;
  }
  if (params.marketType === 'margin') {
    if (params.marginMode === 'isolated') {
      const account = await kucoinMarginClient.getIsolatedMarginAccount();
      const asset = account.assets.find((entry) => entry.symbol === params.symbol);
      const available = Number(asset?.baseAsset.available ?? 0);
      if (!Number.isFinite(available) || available <= 0) {
        throw new Error(`Saldo disponível insuficiente para ${params.symbol} (isolated).`);
      }
      return available;
    }
    const baseCurrency = await resolveBaseCurrency(params);
    const account = await kucoinMarginClient.getCrossMarginAccount();
    const entry = account.accounts.find((item) => item.currency === baseCurrency);
    const available = Number(entry?.available ?? 0);
    if (!Number.isFinite(available) || available <= 0) {
      throw new Error(`Saldo disponível insuficiente para ${baseCurrency} (cross).`);
    }
    return available;
  }
  throw new Error('Tamanho de saída não aplicável para Futures.');
}

type SignalApprovalOverrides = PendingOrderUpdateInput;

export async function createPendingOrderFromSignal(
  authContext: TradingAuthContext,
  signalId: string,
  reason?: string,
  overrides?: SignalApprovalOverrides
): Promise<TradingOperationResult<TradingOrder>> {
  const db = getDatabase();
  try {
    const [signal] = await db
      .select()
      .from(schema.tradingSignals)
      .where(and(eq(schema.tradingSignals.id, signalId), eq(schema.tradingSignals.tenantId, authContext.tenantId)))
      .limit(1);

    if (!signal) {
      return { success: false, error: 'Sinal não encontrado.' };
    }
    if (!signal.isActive) {
      return { success: false, error: 'Sinal não está mais ativo.' };
    }

    const riskConfig = await getRiskConfig(authContext);
    if (!riskConfig?.tradingEnabled) {
      return { success: false, error: 'Trading não está habilitado para este tenant.' };
    }

    const marketType = (signal.marketType as TradingMarketType | undefined) ?? riskConfig.defaultMarketType ?? 'futures';
    const marginMode = (riskConfig.marginMode as TradingMarginMode | undefined) ?? 'cross';
    const symbol = await resolveTradingSymbolStrict(authContext, signal.symbol, marketType, marginMode);

    const { currentPrice, contractMultiplier } = await getMarketSnapshot({
      authContext,
      symbol,
      marketType,
      marginMode,
    });

    let side: 'buy' | 'sell';
    let orderType: TradingOrder['orderType'] = overrides?.orderType ?? (signal.suggestedPrice ? 'limit' : 'market');
    let closePosition = false;

    let exitSize: number | null = null;
    if (signal.signalType === 'entry_long') {
      side = 'buy';
    } else if (signal.signalType === 'entry_short') {
      side = 'sell';
    } else if (signal.signalType === 'exit') {
      closePosition = true;
      if (marketType === 'futures') {
        const positions = await kucoinClient.getAllPositions();
        const position = positions.find((item) => item.symbol === symbol && Number.isFinite(item.currentQty) && item.currentQty !== 0);
        if (!position) {
          return { success: false, error: 'Nenhuma posição aberta encontrada para este símbolo.' };
        }
        side = position.currentQty > 0 ? 'sell' : 'buy';
        exitSize = Math.abs(position.currentQty);
        if (!Number.isInteger(exitSize)) {
          return { success: false, error: 'Quantidade inválida para fechamento em Futures (contratos inteiros obrigatórios).' };
        }
      } else {
        side = 'sell';
        exitSize = await resolveExitSize({ symbol, marketType, marginMode });
      }
      orderType = 'market';
    } else if (signal.signalType === 'adjust_sl' || signal.signalType === 'adjust_tp') {
      closePosition = true;
      if (marketType !== 'futures') {
        return { success: false, error: 'Ajuste de SL/TP disponível apenas para Futures.' };
      }
      const positions = await kucoinClient.getAllPositions();
      const position = positions.find((item) => item.symbol === symbol && Number.isFinite(item.currentQty) && item.currentQty !== 0);
      if (!position) {
        return { success: false, error: 'Nenhuma posição aberta encontrada para ajuste de SL/TP.' };
      }
      side = position.currentQty > 0 ? 'sell' : 'buy';
      exitSize = Math.abs(position.currentQty);
      orderType = signal.signalType === 'adjust_tp' ? 'take_profit' : 'stop_market';
    } else {
      return { success: false, error: 'Sinal não gera ordem executável.' };
    }

    const suggestedSize = clampSuggestedSize(signal.suggestedSize ?? undefined);
    const computedSize = exitSize !== null
      ? { size: exitSize, sizeRule: 'exit:position_size' }
      : resolveHybridOrderSize({
          maxPositionSize: riskConfig.maxPositionSize ?? 0,
          maxOrderValue: riskConfig.maxOrderValue ?? 0,
          currentPrice,
          contractMultiplier,
          suggestedSize,
          marketType,
        });
    const overrideSize = Number.isFinite(overrides?.size) ? Number(overrides?.size) : null;
    if (overrideSize !== null && overrideSize <= 0) {
      return { success: false, error: 'Quantidade inválida.' };
    }
    if (overrideSize !== null && exitSize !== null && overrideSize > computedSize.size) {
      return { success: false, error: 'Quantidade de saída acima da posição disponível.' };
    }
    const size = overrideSize ?? computedSize.size;
    if (marketType === 'futures' && !Number.isInteger(size)) {
      return { success: false, error: 'Quantidade deve ser inteira para Futures.' };
    }

    const leverage = Number(overrides?.leverage ?? riskConfig.defaultLeverage ?? 1);
    const { stopLoss, takeProfit } = resolveStopLossTakeProfit({
      side,
      currentPrice,
      signalStopLoss: overrides?.stopLoss ?? signal.suggestedStopLoss ?? undefined,
      signalTakeProfit: overrides?.takeProfit ?? signal.suggestedTakeProfit ?? undefined,
      defaultStopLoss: riskConfig.defaultStopLoss ?? undefined,
      defaultTakeProfit: riskConfig.defaultTakeProfit ?? undefined,
    });
    if ((orderType === 'stop_limit' || orderType === 'stop_market') && !stopLoss) {
      return { success: false, error: 'Stop Loss obrigatório para ordem stop.' };
    }
    if (orderType === 'take_profit' && !takeProfit) {
      return { success: false, error: 'Take Profit obrigatório para ordem take profit.' };
    }

    const price = orderType === 'market' || orderType === 'stop_market' || orderType === 'take_profit'
      ? null
      : (overrides?.price ?? signal.suggestedPrice ?? currentPrice);

    let pendingOrderRiskGateDecision: 'allow' | 'block' = 'allow';
    let pendingOrderRiskGateReason: string | null = null;

    if (!closePosition) {
      const multiplier = marketType === 'futures' ? Number(contractMultiplier ?? 1) : 1;
      const orderValue = marketType === 'futures'
        ? size * multiplier * (price ?? currentPrice)
        : size * (price ?? currentPrice);
      const riskCheck = await validateTradingAllowed(authContext, size, orderValue);
      pendingOrderRiskGateDecision = riskCheck.decision;
      pendingOrderRiskGateReason = riskCheck.allowed ? null : (riskCheck.reason ?? riskCheck.reasonCode);
      if (!riskCheck.allowed) {
        return { success: false, error: riskCheck.reason };
      }
    }

    const orderData: InsertTradingOrder = {
      tenantId: authContext.tenantId,
      signalId: signal.id,
      marketType,
      symbol,
      side,
      orderType,
      status: 'pending_review',
      price,
      size,
      leverage: Number.isFinite(leverage) && leverage > 0 ? leverage : 1,
      metadata: {
        signalId: signal.id,
        closePosition,
        stopLoss,
        takeProfit,
        createdByUserId: authContext.userId,
        review: {
          source: 'signal',
          reason,
          sizeRule: computedSize.sizeRule,
          suggestedSize: suggestedSize ?? undefined,
        },
      },
      riskGateDecision: pendingOrderRiskGateDecision,
      riskGateReason: pendingOrderRiskGateReason,
    };

    const [order] = await db.insert(schema.tradingOrders).values(orderData).returning();

    await db
      .update(schema.tradingSignals)
      .set({
        isActive: false,
        metadata: {
          ...(signal.metadata as Record<string, unknown>),
          approvalStatus: 'approved',
          approvalReason: reason ?? undefined,
        },
      })
      .where(eq(schema.tradingSignals.id, signal.id));

    await logTradingAction(
      authContext,
      'APPROVE_SIGNAL',
      'signal',
      signal.id,
      { reason, orderId: order.id },
      signal as unknown as Record<string, unknown>,
      order as unknown as Record<string, unknown>
    );

    return { success: true, data: order };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage, signalId }, 'Erro ao aprovar sinal (criar ordem pendente)');
    return { success: false, error: errorMessage };
  }
}

export async function rejectSignal(
  authContext: TradingAuthContext,
  signalId: string,
  reason?: string
): Promise<TradingOperationResult<TradingSignal>> {
  const db = getDatabase();
  try {
    const [existing] = await db
      .select()
      .from(schema.tradingSignals)
      .where(and(eq(schema.tradingSignals.id, signalId), eq(schema.tradingSignals.tenantId, authContext.tenantId)))
      .limit(1);

    if (!existing) {
      return { success: false, error: 'Sinal não encontrado.' };
    }

    const [updated] = await db
      .update(schema.tradingSignals)
      .set({
        isActive: false,
        metadata: {
          ...(existing.metadata as Record<string, unknown>),
          approvalStatus: 'rejected',
          approvalReason: reason ?? undefined,
        },
      })
      .where(eq(schema.tradingSignals.id, signalId))
      .returning();

    await logTradingAction(
      authContext,
      'REJECT_SIGNAL',
      'signal',
      signalId,
      { reason },
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>
    );

    return { success: true, data: updated };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage, signalId }, 'Erro ao rejeitar sinal');
    return { success: false, error: errorMessage };
  }
}

export async function updatePendingOrder(
  authContext: TradingAuthContext,
  orderId: string,
  updates: PendingOrderUpdateInput
): Promise<TradingOperationResult<TradingOrder>> {
  const db = getDatabase();
  try {
    const [order] = await db
      .select()
      .from(schema.tradingOrders)
      .where(and(eq(schema.tradingOrders.id, orderId), eq(schema.tradingOrders.tenantId, authContext.tenantId)))
      .limit(1);

    if (!order) {
      return { success: false, error: 'Ordem não encontrada.' };
    }
    if (order.status !== 'pending_review') {
      return { success: false, error: 'A ordem não está em revisão.' };
    }

    const riskConfig = await getRiskConfig(authContext);
    if (!riskConfig?.tradingEnabled) {
      return { success: false, error: 'Trading não está habilitado para este tenant.' };
    }

    const marketType = order.marketType as TradingMarketType;
    const marginMode = (riskConfig.marginMode as TradingMarginMode | undefined) ?? 'cross';
    const symbol = await resolveTradingSymbolStrict(authContext, order.symbol, marketType, marginMode);
    const { currentPrice, contractMultiplier } = await getMarketSnapshot({
      authContext,
      symbol,
      marketType,
      marginMode,
    });

    const orderType = updates.orderType ?? order.orderType;
    const priceForValidation = orderType === 'market'
      ? currentPrice
      : (updates.price ?? order.price ?? currentPrice);
    const sizeValue = updates.size ?? order.size;
    if (marketType === 'futures' && !Number.isInteger(sizeValue)) {
      return { success: false, error: 'Quantidade deve ser inteira (contratos) para Futures.' };
    }

    const multiplier = marketType === 'futures'
      ? Number(contractMultiplier ?? 1)
      : 1;
    const orderValue = marketType === 'futures'
      ? sizeValue * multiplier * priceForValidation
      : sizeValue * priceForValidation;

    const riskCheck = await validateTradingAllowed(authContext, sizeValue, orderValue);
    if (!riskCheck.allowed) {
      await db
        .update(schema.tradingOrders)
        .set({
          riskGateDecision: riskCheck.decision,
          riskGateReason: riskCheck.reason ?? riskCheck.reasonCode,
          atualizadoEm: new Date(),
        })
        .where(eq(schema.tradingOrders.id, order.id));
      return { success: false, error: riskCheck.reason };
    }

    const metadata = (order.metadata ?? {}) as TradingOrderMetadata;
    const nextMetadata: TradingOrderMetadata = {
      ...metadata,
      stopLoss: updates.stopLoss ?? metadata.stopLoss,
      takeProfit: updates.takeProfit ?? metadata.takeProfit,
    };

    const [updated] = await db
      .update(schema.tradingOrders)
      .set({
        price: orderType === 'market' ? null : (updates.price ?? order.price),
        size: sizeValue,
        leverage: updates.leverage ?? order.leverage,
        orderType,
        metadata: nextMetadata,
        riskGateDecision: riskCheck.decision,
        riskGateReason: null,
        atualizadoEm: new Date(),
      })
      .where(eq(schema.tradingOrders.id, order.id))
      .returning();

    await logTradingAction(
      authContext,
      'UPDATE_REVIEW_ORDER',
      'order',
      order.id,
      { updates },
      order as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>
    );

    return { success: true, data: updated };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage, orderId }, 'Erro ao atualizar ordem pendente');
    return { success: false, error: errorMessage };
  }
}

export async function approvePendingOrder(
  authContext: TradingAuthContext,
  orderId: string
): Promise<TradingOperationResult<TradingOrder>> {
  const db = getDatabase();
  try {
    const [order] = await db
      .select()
      .from(schema.tradingOrders)
      .where(and(eq(schema.tradingOrders.id, orderId), eq(schema.tradingOrders.tenantId, authContext.tenantId)))
      .limit(1);

    if (!order) {
      return { success: false, error: 'Ordem não encontrada.' };
    }
    if (order.status !== 'pending_review') {
      return { success: false, error: 'A ordem não está em revisão.' };
    }

    const riskConfig = await getRiskConfig(authContext);
    if (!riskConfig?.tradingEnabled) {
      return { success: false, error: 'Trading não está habilitado para este tenant.' };
    }

    const marketType = order.marketType as TradingMarketType;
    const marginMode = (riskConfig.marginMode as TradingMarginMode | undefined) ?? 'cross';
    const symbol = await resolveTradingSymbolStrict(authContext, order.symbol, marketType, marginMode);

    const metadata = (order.metadata ?? {}) as TradingOrderMetadata;
    const orderType = order.orderType;
    const isStopOrder = orderType === 'stop_market' || orderType === 'stop_limit' || orderType === 'take_profit';

    let kucoinOrderId = '';
    let clientOid = '';

    if (isStopOrder) {
      const stopResult = await createStopOrder(authContext, {
        symbol,
        side: order.side,
        size: order.size,
        stopLoss: metadata.stopLoss,
        takeProfit: metadata.takeProfit,
        leverage: order.leverage ?? undefined,
        orderType: orderType === 'stop_limit' ? 'limit' : 'market',
        price: order.price ?? undefined,
        marketType,
        marginMode,
      });
      if (!stopResult.success || !stopResult.data) {
        return { success: false, error: stopResult.error ?? 'Falha ao criar stop order.' };
      }
      kucoinOrderId = stopResult.data.orderId;
      clientOid = stopResult.data.clientOid;
    } else {
      const multiplier = marketType === 'futures'
        ? (await kucoinClient.getContractInfo(symbol)).multiplier
        : 1;
      const priceForValidation = order.orderType === 'market'
        ? (await getMarketSnapshot({ authContext, symbol, marketType, marginMode })).currentPrice
        : (order.price ?? 0);
      const orderValue = marketType === 'futures'
        ? order.size * multiplier * priceForValidation
        : order.size * priceForValidation;
      const riskCheck = await validateTradingAllowed(authContext, order.size, orderValue);
      if (!riskCheck.allowed) {
        await db
          .update(schema.tradingOrders)
          .set({
            riskGateDecision: riskCheck.decision,
            riskGateReason: riskCheck.reason ?? riskCheck.reasonCode,
            atualizadoEm: new Date(),
          })
          .where(eq(schema.tradingOrders.id, order.id));
        observeTradingRealOrderAttemptMetric('blocked', marketType);
        return { success: false, error: riskCheck.reason };
      }
      clientOid = kucoinClient.generateClientOid();
      if (marketType === 'futures') {
        const kucoinOrder = await kucoinClient.createOrder({
          clientOid,
          symbol,
          side: order.side,
          type: order.orderType as 'limit' | 'market',
          size: order.size,
          price: order.price?.toString(),
          leverage: order.leverage ?? undefined,
          reduceOnly: metadata.closePosition ?? false,
        });
        kucoinOrderId = kucoinOrder.orderId;
      } else if (marketType === 'spot') {
        const kucoinOrder = await kucoinSpotClient.createSpotOrder({
          clientOid,
          symbol,
          side: order.side,
          type: order.orderType as 'limit' | 'market',
          price: order.price?.toString(),
          size: order.size.toString(),
        });
        kucoinOrderId = kucoinOrder.orderId;
      } else {
        const isIsolated = marginMode === 'isolated';
        const kucoinOrder = await kucoinMarginClient.createMarginOrder({
          clientOid,
          symbol,
          side: order.side,
          type: order.orderType as 'limit' | 'market',
          price: order.price?.toString(),
          size: order.size.toString(),
          isIsolated,
        });
        kucoinOrderId = kucoinOrder.orderId;
      }
    }

    const [updated] = await db
      .update(schema.tradingOrders)
      .set({
        status: 'submitted',
        kucoinOrderId: kucoinOrderId,
        clientOid,
        submittedAt: new Date(),
        metadata: {
          ...metadata,
          kucoinOrderId,
          kucoinClientOid: clientOid,
        },
        riskGateDecision: 'allow',
        riskGateReason: null,
        atualizadoEm: new Date(),
      })
      .where(eq(schema.tradingOrders.id, order.id))
      .returning();

    if (order.signalId) {
      await db
        .update(schema.tradingSignals)
        .set({
          executedAt: new Date(),
          executedOrderId: order.id,
        })
        .where(eq(schema.tradingSignals.id, order.signalId));
    }

    await logTradingAction(
      authContext,
      'APPROVE_REVIEW_ORDER',
      'order',
      order.id,
      { kucoinOrderId },
      order as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>
    );

    observeTradingRealOrderAttemptMetric('success', marketType);

    return { success: true, data: updated };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    observeTradingRealOrderAttemptMetric('error', 'unknown');
    logger.error({ error: errorMessage, orderId }, 'Erro ao aprovar ordem pendente');
    return { success: false, error: errorMessage };
  }
}

export async function rejectPendingOrder(
  authContext: TradingAuthContext,
  orderId: string,
  reason?: string
): Promise<TradingOperationResult<TradingOrder>> {
  const db = getDatabase();
  try {
    const [order] = await db
      .select()
      .from(schema.tradingOrders)
      .where(and(eq(schema.tradingOrders.id, orderId), eq(schema.tradingOrders.tenantId, authContext.tenantId)))
      .limit(1);

    if (!order) {
      return { success: false, error: 'Ordem não encontrada.' };
    }
    if (order.status !== 'pending_review') {
      return { success: false, error: 'A ordem não está em revisão.' };
    }

    const metadata = (order.metadata ?? {}) as TradingOrderMetadata;
    const [updated] = await db
      .update(schema.tradingOrders)
      .set({
        status: 'review_rejected',
        metadata: {
          ...metadata,
          review: {
            ...(metadata.review ?? {}),
            reason,
          },
        },
        atualizadoEm: new Date(),
      })
      .where(eq(schema.tradingOrders.id, order.id))
      .returning();

    await logTradingAction(
      authContext,
      'REJECT_REVIEW_ORDER',
      'order',
      order.id,
      { reason },
      order as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>
    );

    return { success: true, data: updated };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage, orderId }, 'Erro ao rejeitar ordem pendente');
    return { success: false, error: errorMessage };
  }
}

// ============================================================================
// ORDENS (OMS - Order Management System)
// ============================================================================

/**
 * Cria uma ordem baseada em um sinal
 */
export async function createOrderFromSignal(
  authContext: TradingAuthContext,
  params: CreateOrderFromSignalParams
): Promise<TradingOperationResult<TradingOrder>> {
  const db = getDatabase();
  
  try {
    const marketType = await resolveMarketType(authContext, params.marketType);
    const marginMode = await resolveMarginMode(authContext, params.marginMode);

    // Verificar se KuCoin está configurada
    if (marketType === 'futures' && !kucoinClient.isKucoinConfigured()) {
      return { success: false, error: 'API KuCoin (Futures) não configurada.' };
    }
    if (marketType === 'spot' && !kucoinSpotClient.isSpotConfigured()) {
      return { success: false, error: 'API KuCoin (Spot) não configurada.' };
    }
    if (marketType === 'margin' && !kucoinMarginClient.isMarginConfigured()) {
      return { success: false, error: 'API KuCoin (Margin) não configurada.' };
    }

    const symbol = await resolveTradingSymbol(authContext, params.symbol, marketType, marginMode);

    let currentPrice = 0;
    let rawPrice = '';
    let contractInfo: kucoinClient.KucoinContract | null = null;

    if (marketType === 'futures') {
      // Validar símbolo
      if (!(await kucoinClient.isValidSymbol(symbol))) {
        const allowed = await kucoinClient.getAllowedSymbols();
        return {
          success: false,
          error: `Símbolo inválido: ${symbol}. Valores permitidos: ${allowed.join(', ')}.`,
        };
      }

      // Obter preço atual e informações do contrato para validação
      const [ticker, contract] = await Promise.all([
        kucoinClient.getTicker(symbol),
        kucoinClient.getContractInfo(symbol),
      ]);
      rawPrice = ticker.price;
      currentPrice = parseFloat(ticker.price);
      contractInfo = contract;
    } else {
      const spotTicker = await kucoinSpotClient.getSpotTicker(symbol);
      rawPrice = spotTicker.price;
      currentPrice = parseFloat(spotTicker.price);
    }
    
    // CORREÇÃO 17/12/2025: Validar que currentPrice é um número válido
    // Bug CRÍTICO: Se ticker.price for inválido (vazio, não-numérico), parseFloat retorna NaN
    // NaN propaga para orderValue, e comparação `NaN > X` sempre retorna false
    // Isso faz a validação de risco passar silenciosamente (bypass completo!)
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
      return { 
        success: false, 
        error: `Preço de mercado inválido recebido da API KuCoin: "${rawPrice}". Tente novamente.` 
      };
    }
    
    let orderValue = 0;
    let orderSizeForRisk = 0;
    const priceForValidation = params.price !== undefined ? params.price : currentPrice;
    const sizeValue = params.size;
    const fundsValue = params.funds;
    const hasSize = Number.isFinite(sizeValue) && (sizeValue ?? 0) > 0;
    const hasFunds = Number.isFinite(fundsValue) && (fundsValue ?? 0) > 0;
    const isMarketBuy = params.orderType === 'market' && params.side === 'buy';

    if (marketType === 'futures') {
      if (!contractInfo) {
        return { success: false, error: 'Contrato não encontrado para validação.' };
      }
      // CORREÇÃO 17/12/2025: Validar que multiplier do contrato é válido
      if (!Number.isFinite(contractInfo.multiplier) || contractInfo.multiplier <= 0) {
        return { 
          success: false, 
          error: `Multiplicador do contrato inválido para ${symbol}: ${contractInfo.multiplier}. Contate suporte.` 
        };
      }
      if (!hasSize || !Number.isInteger(sizeValue)) {
        return { success: false, error: `Quantidade inválida para Futures: ${sizeValue}. Deve ser um número inteiro.` };
      }
      // CORREÇÃO 17/12/2025: Usar multiplier do contrato no cálculo de orderValue
      orderValue = (sizeValue as number) * contractInfo.multiplier * priceForValidation;
      orderSizeForRisk = sizeValue as number;
    } else {
      if (isMarketBuy && !hasSize && !hasFunds) {
        return { success: false, error: 'Informe size ou funds para ordem a mercado de compra.' };
      }
      if (!isMarketBuy && !hasSize) {
        return { success: false, error: `Quantidade inválida para ${marketType}: ${sizeValue}.` };
      }
      orderValue = hasSize
        ? (sizeValue as number) * priceForValidation
        : (fundsValue as number);
      orderSizeForRisk = hasSize
        ? (sizeValue as number)
        : (fundsValue as number) / priceForValidation;
    }
    
    // CORREÇÃO 17/12/2025: Validar que orderValue é um número válido
    // Proteção adicional contra NaN/Infinity propagados de params.size ou params.price
    if (!Number.isFinite(orderValue) || orderValue <= 0) {
      return { 
        success: false, 
        error: `Valor da ordem calculado é inválido (${orderValue}). Verifique size=${params.size}, price=${priceForValidation}.` 
      };
    }

    const sizeForOrder = orderSizeForRisk;

    // Validar limites de risco
    const riskCheck = await validateTradingAllowed(authContext, orderSizeForRisk, orderValue);
    if (!riskCheck.allowed) {
      observeTradingRealOrderAttemptMetric('blocked', marketType);
      return { success: false, error: riskCheck.reason };
    }

    // CORREÇÃO 17/12/2025: Validar price obrigatório para ordens limite
    // Bug: KuCoin retornava erro críptico quando limit order sem price
    if (params.orderType === 'limit' && (params.price === undefined || params.price === null)) {
      return { 
        success: false, 
        error: 'Preço é obrigatório para ordens do tipo "limit". Use orderType: "market" para ordens a mercado.' 
      };
    }

    // Gerar clientOid único
    const clientOid = kucoinClient.generateClientOid();

    // Criar ordem na KuCoin
    let kucoinOrderId: string;
    try {
      if (marketType === 'futures') {
        const kucoinOrder = await kucoinClient.createOrder({
          clientOid,
          symbol,
          side: params.side,
          type: params.orderType,
          size: sizeForOrder,
          price: params.price?.toString(),
          leverage: params.leverage,
          reduceOnly: params.reduceOnly,
        });
        kucoinOrderId = kucoinOrder.orderId;
      } else if (marketType === 'spot') {
        const kucoinOrder = await kucoinSpotClient.createSpotOrder({
          clientOid,
          symbol,
          side: params.side,
          type: params.orderType,
          price: params.price?.toString(),
          size: hasSize ? String(params.size) : undefined,
          funds: hasFunds ? params.funds?.toString() : undefined,
        });
        kucoinOrderId = kucoinOrder.orderId;
      } else {
        const isIsolated = marginMode === 'isolated';
        const kucoinOrder = await kucoinMarginClient.createMarginOrder({
          clientOid,
          symbol,
          side: params.side,
          type: params.orderType,
          price: params.price?.toString(),
          size: hasSize ? String(params.size) : undefined,
          funds: hasFunds ? params.funds?.toString() : undefined,
          isIsolated,
        });
        kucoinOrderId = kucoinOrder.orderId;
      }
    } catch (err) {
      if (marketType === 'futures' && kucoinClient.isKucoinTransientError(err)) {
        try {
          const existingOrder = await kucoinClient.getOrderByClientOid(clientOid);
          kucoinOrderId = existingOrder.id;
          logger.warn(
            { clientOid, kucoinOrderId, symbol, side: params.side },
            'KuCoin createOrder falhou, mas ordem foi confirmada via clientOid (idempotência)'
          );
        } catch {
          throw err;
        }
      } else {
        throw err;
      }
    }

    // Salvar no banco
    // UUID não aceita string vazia → usar null quando signalId não foi informado
    const validSignalId = params.signalId?.trim() ? params.signalId : null;
    
    // CORREÇÃO 18/12/2025: Campos são real() (number), não string
    // Schema tradingOrders: price, size, stopPrice são real() - remover .toString()
    // stopLoss/takeProfit não existem no schema - usar metadata para armazenar
    const orderData: InsertTradingOrder = {
      tenantId: authContext.tenantId,
      signalId: validSignalId,
      marketType,
      kucoinOrderId: kucoinOrderId,
      clientOid,
      symbol,
      side: params.side,
      orderType: params.orderType,
      status: 'pending',
      price: params.price ?? currentPrice,
      size: sizeForOrder,
      leverage: params.leverage ?? 1,
      // CORREÇÃO 18/12/2025: stopLoss/takeProfit não existem em TradingOrderMetadata
      // Esses valores são gerenciados via stop orders separadas na KuCoin API
      metadata: {
        createdByUserId: authContext.userId,
        source: validSignalId ? 'signal' : 'manual',
      },
      riskGateDecision: riskCheck.decision,
      riskGateReason: null,
    };

    const [order] = await db
      .insert(schema.tradingOrders)
      .values(orderData)
      .returning();

    const auditLogId = await logTradingAction(
      authContext,
      'CREATE_ORDER',
      'order',
      order.id,
      { params, kucoinOrderId, clientOid },
      undefined,
      order as unknown as Record<string, unknown>
    );

    logger.info(
      { 
        orderId: order.id, 
        kucoinOrderId, 
        symbol, 
        side: params.side, 
        size: params.size 
      },
      'Ordem criada com sucesso'
    );

    observeTradingRealOrderAttemptMetric('success', marketType);

    return { success: true, data: order, auditLogId };
  } catch (error) {
    // Falhas KuCoin (429/timeout/breaker open) devem ser mapeadas na borda HTTP (integrations-service).
    // Não retornar 400 genérico para falhas transitórias/upstream.
    if (kucoinClient.isKucoinRequestError(error)) {
      throw error;
    }
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    observeTradingRealOrderAttemptMetric('error', params.marketType ?? 'unknown');
    logger.error({ error: errorMessage, params }, 'Erro ao criar ordem');
    
    // Registrar falha no audit log
    await logTradingAction(
      authContext,
      'CREATE_ORDER_FAILED',
      'order',
      'N/A',
      { params, error: errorMessage }
    );

    return { success: false, error: errorMessage };
  }
}

/**
 * Cria uma ordem manual (sem sinal associado)
 */
export async function createManualOrder(
  authContext: TradingAuthContext,
  params: ManualOrderParams
): Promise<TradingOperationResult<TradingOrder>> {
  return createOrderFromSignal(authContext, {
    ...params,
  });
}

// ============================================================================
// STOP ORDERS (TP/SL) - KuCoin API 2025
// POST /api/v1/st-orders conforme documentação oficial
// Referência: https://www.kucoin.com/docs-new/rest/futures-trading/orders/add-take-profit-and-stop-loss-order
// ============================================================================

/** Parâmetros para criar ordem stop (TP/SL) */
export interface CreateStopOrderParams {
  symbol?: string;
  side: 'buy' | 'sell';
  size: number;
  stopLoss?: number;        // Preço de stop loss (triggerStopDownPrice)
  takeProfit?: number;      // Preço de take profit (triggerStopUpPrice)
  leverage?: number;
  orderType?: 'limit' | 'market';
  price?: number;           // Preço limite (se orderType = limit)
  stopPriceType?: 'TP' | 'MP'; // Tipo de preço para trigger
  marketType?: TradingMarketType;
  marginMode?: TradingMarginMode;
}

/**
 * Cria ordem stop (Take Profit / Stop Loss) - KuCoin API 2025
 * Usa endpoint POST /api/v1/st-orders conforme documentação oficial
 * 
 * @param authContext - Contexto de autenticação
 * @param params - Parâmetros da ordem stop
 * @returns Resultado da operação
 */
export async function createStopOrder(
  authContext: TradingAuthContext,
  params: CreateStopOrderParams
): Promise<TradingOperationResult<{ orderId: string; clientOid: string }>> {
  const db = getDatabase();
  
  // Validar que pelo menos um trigger está definido
  if (!params.stopLoss && !params.takeProfit) {
    return { 
      success: false, 
      error: 'Pelo menos stopLoss ou takeProfit deve ser definido.' 
    };
  }

  try {
    const marketType = await resolveMarketType(authContext, params.marketType);
    const marginMode = await resolveMarginMode(authContext, params.marginMode);
    const symbol = await resolveTradingSymbol(authContext, params.symbol, marketType, marginMode);
    
    // Verificar configuração de risco
    const [riskConfig] = await db
      .select()
      .from(schema.tradingRiskConfig)
      .where(eq(schema.tradingRiskConfig.tenantId, authContext.tenantId))
      .limit(1);

    // CORREÇÃO AUDITORIA 17/12/2025: Campo correto é tradingEnabled (não enabled)
    // Bug: enabled não existe no schema tradingRiskConfig, causava false positivo
    if (!riskConfig?.tradingEnabled) {
      return { success: false, error: 'Trading não está habilitado para este tenant.' };
    }

    // Verificar se KuCoin está configurada
    if (marketType === 'futures' && !kucoinClient.isKucoinConfigured()) {
      return { success: false, error: 'API KuCoin (Futures) não configurada.' };
    }
    if (marketType === 'spot' && !kucoinSpotClient.isSpotConfigured()) {
      return { success: false, error: 'API KuCoin (Spot) não configurada.' };
    }
    if (marketType === 'margin' && !kucoinMarginClient.isMarginConfigured()) {
      return { success: false, error: 'API KuCoin (Margin) não configurada.' };
    }

    const clientOid = kucoinClient.generateClientOid();

    // Criar ordem stop na KuCoin
    let kucoinStopOrderId: string;
    try {
      if (marketType === 'futures') {
        const kucoinResponse = await kucoinClient.createStopOrder({
          clientOid,
          symbol,
          side: params.side,
          type: params.orderType || 'market',
          leverage: params.leverage || riskConfig.defaultLeverage || 1,
          size: params.size,
          price: params.price?.toString(),
          triggerStopUpPrice: params.takeProfit?.toString(),
          triggerStopDownPrice: params.stopLoss?.toString(),
          stopPriceType: params.stopPriceType ?? 'TP',
          reduceOnly: true,
        });
        kucoinStopOrderId = kucoinResponse.orderId;
      } else if (marketType === 'spot') {
        const stopPrice = params.stopLoss ?? params.takeProfit;
        if (!stopPrice) {
          return { success: false, error: 'stopLoss ou takeProfit é obrigatório para Spot.' };
        }
        const kucoinResponse = await kucoinSpotClient.createSpotStopOrder({
          clientOid,
          symbol,
          side: params.side,
          type: params.orderType || 'market',
          stopPrice: stopPrice.toString(),
          price: params.price?.toString(),
          size: params.size.toString(),
        });
        kucoinStopOrderId = kucoinResponse.orderId;
      } else {
        const stopPrice = params.stopLoss ?? params.takeProfit;
        if (!stopPrice) {
          return { success: false, error: 'stopLoss ou takeProfit é obrigatório para Margin.' };
        }
        const kucoinResponse = await kucoinMarginClient.createMarginStopOrder({
          clientOid,
          symbol,
          side: params.side,
          type: params.orderType || 'market',
          stopPrice: stopPrice.toString(),
          price: params.price?.toString(),
          size: params.size.toString(),
          isIsolated: marginMode === 'isolated',
        });
        kucoinStopOrderId = kucoinResponse.orderId;
      }
    } catch (err) {
      if (marketType === 'futures' && kucoinClient.isKucoinTransientError(err)) {
        try {
          const openStops = await kucoinClient.getOpenStopOrders(symbol);
          const matched = openStops.items.find((o) => o.clientOid === clientOid);
          if (!matched) throw err;
          kucoinStopOrderId = matched.id;
          logger.warn(
            { clientOid, kucoinStopOrderId, symbol, side: params.side },
            'KuCoin createStopOrder falhou, mas stop order foi confirmada via clientOid (idempotência)'
          );
        } catch {
          throw err;
        }
      } else {
        throw err;
      }
    }

    // Registrar no audit log
    await logTradingAction(
      authContext,
      'CREATE_STOP_ORDER',
      'stop_order',
      kucoinStopOrderId,
      {
        clientOid,
        symbol,
        side: params.side,
        size: params.size,
        stopLoss: params.stopLoss,
        takeProfit: params.takeProfit,
        leverage: params.leverage,
        kucoinOrderId: kucoinStopOrderId,
      }
    );

    logger.info({
      orderId: kucoinStopOrderId,
      clientOid,
      symbol,
      stopLoss: params.stopLoss,
      takeProfit: params.takeProfit,
    }, 'Ordem stop (TP/SL) criada com sucesso');

    return {
      success: true,
      data: {
        orderId: kucoinStopOrderId,
        clientOid,
      },
    };
  } catch (error) {
    // Falhas KuCoin (429/timeout/breaker open) devem ser mapeadas na borda HTTP (integrations-service).
    if (kucoinClient.isKucoinRequestError(error)) {
      throw error;
    }
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage, params }, 'Erro ao criar ordem stop');
    return { success: false, error: errorMessage };
  }
}

/**
 * Cancela uma ordem stop
 */
export async function cancelStopOrder(
  authContext: TradingAuthContext,
  orderId: string,
  marketType?: TradingMarketType,
  marginMode?: TradingMarginMode
): Promise<TradingOperationResult<{ cancelledOrderIds: string[] }>> {
  try {
    const resolvedMarket = await resolveMarketType(authContext, marketType);
    const resolvedMargin = await resolveMarginMode(authContext, marginMode);

    if (resolvedMarket === 'spot') {
      if (!kucoinSpotClient.isSpotConfigured()) {
        return { success: false, error: 'API KuCoin (Spot) não configurada.' };
      }
      const result = await kucoinSpotClient.cancelSpotStopOrder(orderId);
      await logTradingAction(
        authContext,
        'CANCEL_STOP_ORDER',
        'stop_order',
        orderId,
        { cancelledOrderIds: result.cancelledOrderIds, marketType: resolvedMarket }
      );
      logger.info({ orderId }, 'Stop order Spot cancelada');
      return { success: true, data: result };
    }

    if (resolvedMarket === 'margin') {
      if (!kucoinMarginClient.isMarginConfigured()) {
        return { success: false, error: 'API KuCoin (Margin) não configurada.' };
      }
      const result = await kucoinMarginClient.cancelMarginStopOrder(orderId);
      await logTradingAction(
        authContext,
        'CANCEL_STOP_ORDER',
        'stop_order',
        orderId,
        { cancelledOrderIds: result.cancelledOrderIds, marketType: resolvedMarket, marginMode: resolvedMargin }
      );
      logger.info({ orderId }, 'Stop order Margin cancelada');
      return { success: true, data: result };
    }

    if (!kucoinClient.isKucoinConfigured()) {
      return { success: false, error: 'API KuCoin (Futures) não configurada.' };
    }

    const result = await kucoinClient.cancelStopOrder(orderId);

    await logTradingAction(
      authContext,
      'CANCEL_STOP_ORDER',
      'stop_order',
      orderId,
      { cancelledOrderIds: result.cancelledOrderIds, marketType: 'futures' }
    );

    logger.info({ orderId }, 'Ordem stop cancelada');

    return { success: true, data: result };
  } catch (error) {
    if (kucoinClient.isKucoinRequestError(error)) {
      throw error;
    }
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage, orderId }, 'Erro ao cancelar ordem stop');
    return { success: false, error: errorMessage };
  }
}

/**
 * Lista ordens stop abertas
 */
export async function getOpenStopOrders(
  authContext: TradingAuthContext,
  symbol?: string,
  marketType?: TradingMarketType,
  marginMode?: TradingMarginMode
): Promise<TradingOperationResult<kucoinClient.KucoinOrder[] | kucoinSpotClient.SpotOrder[] | kucoinMarginClient.MarginOrder[]>> {
  try {
    const resolvedMarket = await resolveMarketType(authContext, marketType);
    const resolvedMargin = await resolveMarginMode(authContext, marginMode);
    const resolvedSymbol = await resolveTradingSymbol(authContext, symbol, resolvedMarket, resolvedMargin);

    if (resolvedMarket === 'spot') {
      if (!kucoinSpotClient.isSpotConfigured()) {
        return { success: false, error: 'API KuCoin (Spot) não configurada.' };
      }
      const result = await kucoinSpotClient.getSpotStopOrders(resolvedSymbol);
      return { success: true, data: result };
    }

    if (resolvedMarket === 'margin') {
      if (!kucoinMarginClient.isMarginConfigured()) {
        return { success: false, error: 'API KuCoin (Margin) não configurada.' };
      }
      const result = await kucoinMarginClient.getMarginStopOrders();
      return { success: true, data: result };
    }

    if (!kucoinClient.isKucoinConfigured()) {
      return { success: false, error: 'API KuCoin (Futures) não configurada.' };
    }

    const result = await kucoinClient.getOpenStopOrders(resolvedSymbol);
    return { success: true, data: result.items };
  } catch (error) {
    if (kucoinClient.isKucoinRequestError(error)) {
      throw error;
    }
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao listar ordens stop');
    return { success: false, error: errorMessage };
  }
}

/**
 * Cancela uma ordem
 */
export async function cancelOrder(
  authContext: TradingAuthContext,
  orderId: string
): Promise<TradingOperationResult<TradingOrder>> {
  const db = getDatabase();
  
  try {
    // Buscar ordem
    const [existing] = await db
      .select()
      .from(schema.tradingOrders)
      .where(
        and(
          eq(schema.tradingOrders.id, orderId),
          eq(schema.tradingOrders.tenantId, authContext.tenantId)
        )
      )
      .limit(1);

    if (!existing) {
      return { success: false, error: 'Ordem não encontrada.' };
    }

    if (existing.status === 'cancelled' || existing.status === 'filled') {
      return { success: false, error: `Ordem já está ${existing.status}.` };
    }

    // Cancelar na KuCoin
    if (existing.kucoinOrderId) {
      if (existing.marketType === 'spot') {
        if (kucoinSpotClient.isSpotConfigured()) {
          await kucoinSpotClient.cancelSpotOrder(existing.kucoinOrderId);
        }
      } else if (existing.marketType === 'margin') {
        if (kucoinMarginClient.isMarginConfigured()) {
          await kucoinMarginClient.cancelMarginOrder(existing.kucoinOrderId);
        }
      } else if (kucoinClient.isKucoinConfigured()) {
        await kucoinClient.cancelOrder(existing.kucoinOrderId);
      }
    }

    // CORREÇÃO 18/12/2025: cancelledAt é campo direto da tabela, não metadata
    const [updated] = await db
      .update(schema.tradingOrders)
      .set({ 
        status: 'cancelled', 
        cancelledAt: new Date(),
        atualizadoEm: new Date(),
      })
      .where(eq(schema.tradingOrders.id, orderId))
      .returning();

    await logTradingAction(
      authContext,
      'CANCEL_ORDER',
      'order',
      orderId,
      { kucoinOrderId: existing.kucoinOrderId },
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>
    );

    logger.info({ orderId, kucoinOrderId: existing.kucoinOrderId }, 'Ordem cancelada');

    return { success: true, data: updated };
  } catch (error) {
    if (kucoinClient.isKucoinRequestError(error)) {
      throw error;
    }
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage, orderId }, 'Erro ao cancelar ordem');
    return { success: false, error: errorMessage };
  }
}

/**
 * Lista ordens do tenant
 */
export async function getOrders(
  authContext: TradingAuthContext,
  options?: { status?: string; limit?: number; marketType?: TradingMarketType }
): Promise<TradingOrder[]> {
  const db = getDatabase();
  
  // CORREÇÃO 18/12/2025: Drizzle não permite encadear .where() múltiplas vezes
  // Construir condição completa de uma vez usando and()
  const baseCondition = eq(schema.tradingOrders.tenantId, authContext.tenantId);
  const conditions = [baseCondition];
  if (options?.status) {
    conditions.push(
      eq(schema.tradingOrders.status, options.status as 'pending' | 'open' | 'filled' | 'cancelled' | 'rejected' | 'expired')
    );
  }
  if (options?.marketType) {
    conditions.push(eq(schema.tradingOrders.marketType, options.marketType));
  }

  const orders = await db
    .select()
    .from(schema.tradingOrders)
    .where(and(...conditions))
    .orderBy(desc(schema.tradingOrders.criadoEm))
    .limit(options?.limit ?? 50);

  return orders;
}

/**
 * Sincroniza status das ordens com a KuCoin
 */
export async function syncOrdersStatus(
  authContext: TradingAuthContext
): Promise<{ synced: number; errors: number; filledOrders: schema.TradingOrder[] }> {
  const db = getDatabase();
  let synced = 0;
  let errors = 0;
  const filledOrders: schema.TradingOrder[] = [];
  
  // Buscar ordens pendentes ou abertas
  const pendingOrders = await db
    .select()
    .from(schema.tradingOrders)
    .where(
      and(
        eq(schema.tradingOrders.tenantId, authContext.tenantId),
        sql`${schema.tradingOrders.status} IN ('pending', 'open')`
      )
    );

  for (const order of pendingOrders) {
    try {
      if (!order.kucoinOrderId) continue;
      let newStatus: 'pending' | 'open' | 'filled' | 'cancelled' | 'rejected' | 'expired' = 'pending';
      let filledSize: number | null = null;
      let avgFilledPrice: number | null = null;

      if (order.marketType === 'spot') {
        if (!kucoinSpotClient.isSpotConfigured()) {
          continue;
        }
        const kucoinOrder = await kucoinSpotClient.getSpotOrder(order.kucoinOrderId);
        const totalSize = Number(kucoinOrder.size || 0);
        const executedSize = Number(kucoinOrder.dealSize || 0);

        if (kucoinOrder.isActive) {
          newStatus = 'open';
        } else if (kucoinOrder.cancelExist) {
          newStatus = 'cancelled';
        } else if (totalSize > 0 && executedSize >= totalSize) {
          newStatus = 'filled';
        } else {
          newStatus = 'expired';
        }

        filledSize = Number.isFinite(executedSize) ? executedSize : null;
        const filledValue = Number(kucoinOrder.dealFunds || 0);
        avgFilledPrice = filledSize && filledSize > 0 && Number.isFinite(filledValue) && filledValue > 0
          ? filledValue / filledSize
          : null;
      } else if (order.marketType === 'margin') {
        if (!kucoinMarginClient.isMarginConfigured()) {
          continue;
        }
        const kucoinOrder = await kucoinMarginClient.getMarginOrder(order.kucoinOrderId);
        const totalSize = Number(kucoinOrder.size || 0);
        const executedSize = Number(kucoinOrder.dealSize || 0);

        if (kucoinOrder.isActive) {
          newStatus = 'open';
        } else if (kucoinOrder.cancelExist) {
          newStatus = 'cancelled';
        } else if (totalSize > 0 && executedSize >= totalSize) {
          newStatus = 'filled';
        } else {
          newStatus = 'expired';
        }

        filledSize = Number.isFinite(executedSize) ? executedSize : null;
        const filledValue = Number(kucoinOrder.dealFunds || 0);
        avgFilledPrice = filledSize && filledSize > 0 && Number.isFinite(filledValue) && filledValue > 0
          ? filledValue / filledSize
          : null;
      } else {
        if (!kucoinClient.isKucoinConfigured()) {
          continue;
        }
        const kucoinOrder = await kucoinClient.getOrder(order.kucoinOrderId);
        
        // Mapear status da KuCoin para nosso schema
        if (kucoinOrder.status === 'done') {
          if (kucoinOrder.filledSize === kucoinOrder.size) {
            newStatus = 'filled';
          } else if (kucoinOrder.cancelExist) {
            newStatus = 'cancelled';
          } else {
            newStatus = 'expired';
          }
        } else if (kucoinOrder.status === 'active') {
          newStatus = 'open';
        } else if (kucoinOrder.status === 'canceled') {
          newStatus = 'cancelled';
        } else if (kucoinOrder.status === 'fail') {
          newStatus = 'rejected';
        }

        filledSize = kucoinOrder.filledSize ?? null;
        avgFilledPrice = (() => {
          if (!kucoinOrder.filledValue || !kucoinOrder.filledSize || kucoinOrder.filledSize <= 0) {
            return null;
          }
          const parsedValue = parseFloat(kucoinOrder.filledValue);
          if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
            return null;
          }
          return parsedValue / kucoinOrder.filledSize;
        })();
      }

      if (newStatus !== order.status) {
        // CORREÇÃO 18/12/2025: filledSize e avgFilledPrice são real() (number), não string
        // Campos de metadata devem seguir TradingOrderMetadataSchema
        const [updated] = await db
          .update(schema.tradingOrders)
          .set({
            status: newStatus,
            filledSize,
            avgFilledPrice,
            atualizadoEm: new Date(),
            filledAt: newStatus === 'filled' ? new Date() : order.filledAt,
            metadata: {
              ...order.metadata,
              responseTime: Date.now(), // Usar campo válido do schema
            },
          })
          .where(eq(schema.tradingOrders.id, order.id))
          .returning();

        if (updated && newStatus === 'filled') {
          filledOrders.push(updated);

          // ================================================================
          // ENTRY SNAPSHOT: Se ordem preenchida NÃO é fechamento de posição,
          // capturar snapshot de entrada. Best-effort.
          // ================================================================
          const orderMeta = (order.metadata ?? {}) as TradingOrderMetadata;
          if (!orderMeta.closePosition) {
            try {
              const marketType = (order.marketType as TradingMarketType) ?? 'futures';
              const entrySnapshotResult = await captureEntrySnapshot({
                tenantId: order.tenantId,
                symbol: order.symbol,
                marketType,
                positionId: order.id,
              });
              const entrySnapshotId = entrySnapshotResult.id;
              // Persistir entrySnapshotId no metadata da ordem para uso posterior no post-mortem
              // IMPORTANTE: usar updated.metadata (que já contém responseTime do primeiro update),
              // NÃO order.metadata (original do fetch, sem responseTime)
              await db
                .update(schema.tradingOrders)
                .set({
                  metadata: {
                    ...(updated.metadata ?? {}),
                    entrySnapshotId,
                  } as TradingOrderMetadata,
                })
                .where(eq(schema.tradingOrders.id, order.id));
              logger.info(
                { orderId: order.id, symbol: order.symbol, snapshotId: entrySnapshotId },
                'Entry snapshot capturado e vinculado à ordem real'
              );
            } catch (snapError) {
              logger.warn(
                { err: snapError, orderId: order.id, symbol: order.symbol },
                'Falha ao capturar entry snapshot (best-effort)'
              );
            }
          }
        }

        synced++;
        logger.debug({ orderId: order.id, oldStatus: order.status, newStatus }, 'Ordem sincronizada');
      }
    } catch (error) {
      errors++;
      logger.error({ orderId: order.id, error }, 'Erro ao sincronizar ordem');
    }
  }

  logger.info({ synced, errors, total: pendingOrders.length }, 'Sincronização de ordens concluída');
  return { synced, errors, filledOrders };
}

// ============================================================================
// MARKET DATA
// ============================================================================

/**
 * Obtém dados de mercado (preço atual, volume, etc.)
 */
export async function getMarketData(
  authContext: TradingAuthContext,
  symbol?: string,
  marketType?: TradingMarketType,
  marginMode?: TradingMarginMode
): Promise<{
  ticker: kucoinClient.KucoinTicker | kucoinSpotClient.SpotTicker;
  contract?: kucoinClient.KucoinContract | null;
}> {
  const resolvedMarket = await resolveMarketType(authContext, marketType);
  const resolvedSymbol = await resolveTradingSymbol(authContext, symbol, resolvedMarket, marginMode);

  if (resolvedMarket === 'futures') {
    const [ticker, contract] = await Promise.all([
      kucoinClient.getTicker(resolvedSymbol),
      kucoinClient.getContractInfo(resolvedSymbol),
    ]);
    return { ticker, contract };
  }

  const spotTicker = await kucoinSpotClient.getSpotTicker(resolvedSymbol);
  return { ticker: spotTicker, contract: null };
}

/**
 * Obtém visão geral da conta na KuCoin
 */
export async function getAccountOverview(
  marketType?: TradingMarketType,
  marginMode?: TradingMarginMode
): Promise<
  | kucoinClient.KucoinAccountOverview
  | kucoinSpotClient.SpotAccount[]
  | kucoinMarginClient.MarginCrossAccount
  | kucoinMarginClient.MarginIsolatedAccount
  | null
> {
  const resolvedMarket = marketType ?? 'futures';
  const resolvedMargin = marginMode ?? 'cross';

  if (resolvedMarket === 'spot') {
    if (!kucoinSpotClient.isSpotConfigured()) {
      return null;
    }
    return kucoinSpotClient.getSpotAccounts('trade');
  }

  if (resolvedMarket === 'margin') {
    if (!kucoinMarginClient.isMarginConfigured()) {
      return null;
    }
    if (resolvedMargin === 'isolated') {
      return kucoinMarginClient.getIsolatedMarginAccount();
    }
    return kucoinMarginClient.getCrossMarginAccount();
  }

  if (!kucoinClient.isKucoinConfigured()) {
    return null;
  }
  
  return kucoinClient.getAccountOverview();
}

/**
 * Obtém posições abertas na KuCoin
 */
export async function getKucoinPositions(
  marketType?: TradingMarketType,
  marginMode?: TradingMarginMode
): Promise<
  | kucoinClient.KucoinPosition[]
  | kucoinSpotClient.SpotAccount[]
  | kucoinMarginClient.MarginCrossAccount
  | kucoinMarginClient.MarginIsolatedAccount
> {
  const resolvedMarket = marketType ?? 'futures';
  const resolvedMargin = marginMode ?? 'cross';

  if (resolvedMarket === 'spot') {
    if (!kucoinSpotClient.isSpotConfigured()) {
      return [];
    }
    return kucoinSpotClient.getSpotAccounts('trade');
  }

  if (resolvedMarket === 'margin') {
    if (!kucoinMarginClient.isMarginConfigured()) {
      throw new Error('API KuCoin (Margin) não configurada.');
    }
    if (resolvedMargin === 'isolated') {
      return kucoinMarginClient.getIsolatedMarginAccount();
    }
    return kucoinMarginClient.getCrossMarginAccount();
  }

  if (!kucoinClient.isKucoinConfigured()) {
    return [];
  }

  return kucoinClient.getAllPositions();
}

// ============================================================================
// FECHAMENTO DE POSIÇÕES (P0)
// ============================================================================

/**
 * Fecha posição(ões) abertas na KuCoin (Futures).
 * Se symbol não for informado, fecha todas as posições abertas.
 * Regra 6: operação real, com auditoria e persistência.
 */
export async function closePositions(
  authContext: TradingAuthContext,
  symbol?: string
): Promise<TradingOperationResult<{
  closedCount: number;
  kucoinOrderIds: string[];
  orders: TradingOrder[];
}>> {
  const db = getDatabase();

  try {
    if (!kucoinClient.isKucoinConfigured()) {
      return { success: false, error: 'API KuCoin não configurada.' };
    }

    const resolvedSymbol = symbol
      ? await resolveTradingSymbolStrict(authContext, symbol)
      : null;

    const positions = await kucoinClient.getAllPositions();
    const activePositions = positions.filter((position) => {
      if (!Number.isFinite(position.currentQty) || position.currentQty === 0) {
        return false;
      }
      if (resolvedSymbol) {
        return position.symbol === resolvedSymbol;
      }
      return true;
    });

    if (activePositions.length === 0) {
      return { success: true, data: { closedCount: 0, kucoinOrderIds: [], orders: [] } };
    }

    const ordersPlan = activePositions.map((position) => {
      const rawSize = Math.abs(position.currentQty);
      if (!Number.isFinite(rawSize) || rawSize <= 0 || !Number.isInteger(rawSize)) {
        throw new Error(
          `Quantidade inválida para fechamento da posição ${position.symbol}: ${position.currentQty}. ` +
          'A KuCoin Futures exige size inteiro (contratos).'
        );
      }

      const side: 'buy' | 'sell' = position.currentQty > 0 ? 'sell' : 'buy';
      const leverage = Number.isFinite(position.realLeverage) && position.realLeverage > 0
        ? Math.round(position.realLeverage)
        : 1;

      return {
        position,
        side,
        size: rawSize,
        leverage,
      };
    });

    const createdOrders: TradingOrder[] = [];
    const kucoinOrderIds: string[] = [];

    for (const orderPlan of ordersPlan) {
      const clientOid = kucoinClient.generateClientOid();
      const kucoinOrder = await kucoinClient.createOrder({
        clientOid,
        symbol: orderPlan.position.symbol,
        side: orderPlan.side,
        type: 'market',
        size: orderPlan.size,
        reduceOnly: true,
      });

      const orderData: InsertTradingOrder = {
        tenantId: authContext.tenantId,
        signalId: null,
        marketType: 'futures',
        symbol: orderPlan.position.symbol,
        side: orderPlan.side,
        orderType: 'market',
        status: 'pending',
        price: Number.isFinite(orderPlan.position.markPrice) && orderPlan.position.markPrice > 0
          ? orderPlan.position.markPrice
          : null,
        size: orderPlan.size,
        leverage: orderPlan.leverage,
        kucoinOrderId: kucoinOrder.orderId,
        clientOid,
        metadata: {
          closePosition: true,
        },
      };

      const [order] = await db.insert(schema.tradingOrders).values(orderData).returning();
      createdOrders.push(order);
      kucoinOrderIds.push(kucoinOrder.orderId);

      await logTradingAction(
        authContext,
        'CLOSE_POSITION',
        'order',
        order.id,
        { symbol: orderPlan.position.symbol, kucoinOrderId: kucoinOrder.orderId },
        undefined,
        order as unknown as Record<string, unknown>
      );
    }

    // ====================================================================
    // POST-MORTEM AUTOMÁTICO: Capturar exit snapshot + enfileirar post-mortem
    // para cada posição fechada. Best-effort: falha não bloqueia o fluxo.
    // ====================================================================
    for (let i = 0; i < ordersPlan.length; i++) {
      const orderPlan = ordersPlan[i];
      const closedOrder = createdOrders[i];
      if (!closedOrder) continue;

      try {
        const positionData = orderPlan.position;
        const exitSnapshot = await captureExitSnapshot({
          tenantId: authContext.tenantId,
          symbol: positionData.symbol,
          marketType: 'futures',
          positionId: closedOrder.id,
        });

        // Dados da posição real da KuCoin para o post-mortem
        const entryPrice = positionData.avgEntryPrice ?? positionData.markPrice;
        const exitPrice = positionData.markPrice;
        const side = positionData.currentQty > 0 ? 'long' : 'short';
        const leverage = Number.isFinite(positionData.realLeverage) && positionData.realLeverage > 0
          ? positionData.realLeverage
          : 1;
        const pnl = positionData.unrealisedPnl ?? 0;
        const _pnlPct = entryPrice > 0
          ? ((exitPrice - entryPrice) / entryPrice) * 100 * (side === 'long' ? 1 : -1)
          : 0;

        // Buscar entrySnapshotId: procura no metadata da ordem de abertura mais recente
        // para este símbolo, ou via snapshot store refs como fallback
        let entrySnapshotId: string | undefined;
        try {
          // Buscar ordem de abertura (não-closePosition) mais recente com entrySnapshotId no metadata
          const [openingOrder] = await db
            .select()
            .from(schema.tradingOrders)
            .where(
              and(
                eq(schema.tradingOrders.tenantId, authContext.tenantId),
                eq(schema.tradingOrders.symbol, positionData.symbol),
                eq(schema.tradingOrders.status, 'filled'),
                sql`${schema.tradingOrders.metadata}->>'entrySnapshotId' IS NOT NULL`,
                sql`${schema.tradingOrders.metadata}->>'closePosition' IS NULL`
              )
            )
            .orderBy(desc(schema.tradingOrders.criadoEm))
            .limit(1);

          if (openingOrder) {
            const meta = (openingOrder.metadata ?? {}) as Record<string, unknown>;
            if (typeof meta.entrySnapshotId === 'string') {
              entrySnapshotId = meta.entrySnapshotId;
            }
          }

          // Fallback: buscar entry snapshot via refs no snapshot store
          if (!entrySnapshotId) {
            const entrySnapshots = await getSnapshotsByRefs({
              tenantId: authContext.tenantId,
              refKey: 'symbol',
              refValue: positionData.symbol,
            });
            // Pegar o mais recente do tipo market_entry
            const entrySnap = entrySnapshots
              .filter(s => s.kind === 'market_entry')
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
            if (entrySnap) {
              entrySnapshotId = entrySnap.id;
            }
          }

          if (entrySnapshotId) {
            logger.info({ symbol: positionData.symbol, entrySnapshotId }, 'Entry snapshot recuperado para post-mortem real');
          }
        } catch (snapLookupError) {
          logger.warn(
            { err: snapLookupError, symbol: positionData.symbol },
            'Falha ao buscar entry snapshot para post-mortem real (best-effort)'
          );
        }

        await enqueuePostMortem({
          positionData: {
            id: closedOrder.id,
            tenantId: authContext.tenantId,
            isDemo: false,
            symbol: positionData.symbol,
            marketType: 'futures',
            side,
            leverage,
            entryPrice,
            exitPrice,
            size: Math.abs(Number(positionData.currentQty ?? 0)),
            realizedPnl: pnl,
            totalFees: 0, // KuCoin não fornece fees acumuladas por posição diretamente
            openedAt: positionData.openingTimestamp > 0
              ? new Date(positionData.openingTimestamp)
              : new Date(),
            closedAt: new Date(),
            entrySnapshotId,
            exitSnapshotId: exitSnapshot.id,
          },
          userId: authContext.userId,
        });

        logger.info(
          { orderId: closedOrder.id, symbol: positionData.symbol, pnl },
          'Post-mortem enfileirado para posição real fechada'
        );
      } catch (pmError) {
        // Best-effort: não bloquear fechamento de posição se post-mortem falhar
        logger.warn(
          { err: pmError, orderId: closedOrder.id, symbol: orderPlan.position.symbol },
          'Falha ao enfileirar post-mortem para posição real (best-effort)'
        );
      }
    }

    return {
      success: true,
      data: {
        closedCount: createdOrders.length,
        kucoinOrderIds,
        orders: createdOrders,
      },
    };
  } catch (error) {
    if (kucoinClient.isKucoinRequestError(error)) {
      throw error;
    }
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage, symbol }, 'Erro ao fechar posições');
    return { success: false, error: errorMessage };
  }
}

// ============================================================================
// STATUS DO SERVIÇO
// ============================================================================

/**
 * Obtém status completo do serviço de trading
 */
export async function getTradingServiceStatus(authContext: TradingAuthContext): Promise<{
  isConfigured: boolean;
  missingKeys: string[];
  circuitBreaker: ReturnType<typeof kucoinClient.getKucoinCircuitBreakerStatus>;
  riskConfig: TradingRiskConfig | null;
  activeSignals: number;
  pendingOrders: number;
  defaultSymbol: string;
}> {
  const db = getDatabase();
  const configStatus = kucoinClient.getKucoinConfigStatus();
  
  const [riskConfig, activeSignalsResult, pendingOrdersResult, defaultSymbol] = await Promise.all([
    getRiskConfig(authContext),
    db
      .select({ count: sql<number>`count(*)` })
      .from(schema.tradingSignals)
      .where(
        and(
          eq(schema.tradingSignals.tenantId, authContext.tenantId),
          eq(schema.tradingSignals.isActive, true)
        )
      ),
    db
      .select({ count: sql<number>`count(*)` })
      .from(schema.tradingOrders)
      .where(
        and(
          eq(schema.tradingOrders.tenantId, authContext.tenantId),
          sql`${schema.tradingOrders.status} IN ('pending', 'open')`
        )
      ),
    resolveTradingSymbol(authContext),
  ]);

  return {
    isConfigured: configStatus.isConfigured,
    missingKeys: configStatus.missingKeys,
    circuitBreaker: kucoinClient.getKucoinCircuitBreakerStatus(),
    riskConfig,
    activeSignals: Number(activeSignalsResult[0]?.count ?? 0),
    pendingOrders: Number(pendingOrdersResult[0]?.count ?? 0),
    defaultSymbol,
  };
}

export default {
  // Risco
  getRiskConfig,
  upsertRiskConfig,
  validateTradingAllowed,
  setTradingRiskGateMetricObserver,
  setTradingRealOrderAttemptMetricObserver,
  
  // Sinais
  createSignal,
  getActiveSignals,
  deactivateSignal,
  
  // Ordens
  createOrderFromSignal,
  createManualOrder,
  cancelOrder,
  getOrders,
  syncOrdersStatus,
  
  // Stop Orders (TP/SL) - KuCoin API 2025
  // CORREÇÃO AUDITORIA 17/12/2025: Funções estavam definidas mas não exportadas
  createStopOrder,
  cancelStopOrder,
  getOpenStopOrders,
  
  // Market Data
  getMarketData,
  getTradingSymbols,
  getAccountOverview,
  getKucoinPositions,
  closePositions,
  
  // Status
  getTradingServiceStatus,
};
