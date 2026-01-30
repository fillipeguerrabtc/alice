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
// CORREÇÃO 19/12/2025: Remover tipos não utilizados (no-unused-vars)
// TradingPosition, TradingAuditLog, InsertTradingPosition removidos
import {
  type TradingSignal,
  type TradingOrder,
  type TradingRiskConfig,
  type InsertTradingSignal,
  type InsertTradingOrder,
  type InsertTradingAuditLog,
} from '@alice/shared';
import * as kucoinClient from './kucoinClient.js';
import * as kucoinSpotClient from './kucoinSpotClient.js';
import * as kucoinMarginClient from './kucoinMarginClient.js';

const logger = createLogger('kucoin-service');

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

async function getAllowedSymbolsByMarketType(
  authContext: TradingAuthContext,
  marketType: TradingMarketType,
  marginMode: TradingMarginMode
): Promise<string[]> {
  if (marketType === 'spot') {
    const symbols = await kucoinSpotClient.getSpotSymbols();
    return symbols.map((item) => item.symbol).filter((symbol): symbol is string => Boolean(symbol));
  }
  if (marketType === 'margin') {
    const symbols = marginMode === 'isolated'
      ? await kucoinMarginClient.getIsolatedMarginSymbols()
      : await kucoinMarginClient.getCrossMarginSymbols();
    return symbols.map((item) => item.symbol).filter((symbol): symbol is string => Boolean(symbol));
  }
  return kucoinClient.getAllowedSymbols();
}

function resolveNormalizedSymbolInList(input: string, allowed: string[]): string | null {
  const raw = normalizeSymbolInput(input);
  if (allowed.includes(raw)) return raw;
  const normalizedInput = normalizeSymbolKey(raw);
  const match = allowed.find((symbol) => normalizeSymbolKey(symbol) === normalizedInput);
  return match ?? null;
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
      logger.warn(
        { tenantId: authContext.tenantId, defaultSymbol: config.defaultSymbol },
        'Símbolo default configurado no tenant não é válido na KuCoin'
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
  
  // CORREÇÃO: Mesclar details com newState já que schema não tem campo details
  const mergedNewState = newState ? { ...newState, _details: details } : details;
  
  const auditEntry: InsertTradingAuditLog = {
    tenantId: authContext.tenantId,
    userId: authContext.userId,
    action,
    entityType,
    entityId,
    previousState: previousState ?? null,
    newState: mergedNewState,
    ipAddress: null, // Será preenchido pelo middleware
    userAgent: null, // Será preenchido pelo middleware
  };

  const [result] = await db
    .insert(schema.tradingAuditLog)
    .values(auditEntry)
    .returning({ id: schema.tradingAuditLog.id });

  logger.info(
    { auditLogId: result.id, action, entityType, entityId },
    'Ação de trading registrada no audit log'
  );

  return result.id;
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
): Promise<{ allowed: boolean; reason?: string }> {
  // CORREÇÃO 17/12/2025: Validação defensiva contra NaN/Infinity
  // Garante que valores inválidos não passem silenciosamente pela validação
  if (!Number.isFinite(orderSize) || orderSize <= 0) {
    return { 
      allowed: false, 
      reason: `Tamanho da ordem inválido: ${orderSize}. Deve ser um número positivo.` 
    };
  }
  
  if (!Number.isFinite(orderValue) || orderValue <= 0) {
    return { 
      allowed: false, 
      reason: `Valor da ordem inválido: ${orderValue}. Deve ser um número positivo.` 
    };
  }

  const config = await getRiskConfig(authContext);
  
  if (!config) {
    return { allowed: false, reason: 'Configuração de risco não encontrada. Configure antes de operar.' };
  }

  if (!config.tradingEnabled) {
    return { allowed: false, reason: 'Trading desabilitado para este tenant.' };
  }

  // Validar maxPositionSize com proteção contra NaN
  const maxPositionSize = Number(config.maxPositionSize);
  if (!Number.isFinite(maxPositionSize)) {
    return { 
      allowed: false, 
      reason: `Configuração maxPositionSize inválida: ${config.maxPositionSize}. Contate administrador.` 
    };
  }
  
  if (orderSize > maxPositionSize) {
    return { 
      allowed: false, 
      reason: `Tamanho da ordem (${orderSize}) excede limite máximo (${maxPositionSize}).` 
    };
  }

  // Validar maxOrderValue com proteção contra NaN
  const maxOrderValue = Number(config.maxOrderValue);
  if (!Number.isFinite(maxOrderValue)) {
    return { 
      allowed: false, 
      reason: `Configuração maxOrderValue inválida: ${config.maxOrderValue}. Contate administrador.` 
    };
  }
  
  if (orderValue > maxOrderValue) {
    return { 
      allowed: false, 
      reason: `Valor da ordem (${orderValue.toFixed(2)} USD) excede limite máximo (${maxOrderValue.toFixed(2)} USD).` 
    };
  }

  return { allowed: true };
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
      metadata: {},
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

    return { success: true, data: order, auditLogId };
  } catch (error) {
    // Falhas KuCoin (429/timeout/breaker open) devem ser mapeadas na borda HTTP (integrations-service).
    // Não retornar 400 genérico para falhas transitórias/upstream.
    if (kucoinClient.isKucoinRequestError(error)) {
      throw error;
    }
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
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
): Promise<{ synced: number; errors: number }> {
  const db = getDatabase();
  let synced = 0;
  let errors = 0;
  
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
        await db
          .update(schema.tradingOrders)
          .set({
            status: newStatus,
            filledSize,
            avgFilledPrice,
            atualizadoEm: new Date(),
            metadata: {
              ...order.metadata,
              responseTime: Date.now(), // Usar campo válido do schema
            },
          })
          .where(eq(schema.tradingOrders.id, order.id));

        synced++;
        logger.debug({ orderId: order.id, oldStatus: order.status, newStatus }, 'Ordem sincronizada');
      }
    } catch (error) {
      errors++;
      logger.error({ orderId: order.id, error }, 'Erro ao sincronizar ordem');
    }
  }

  logger.info({ synced, errors, total: pendingOrders.length }, 'Sincronização de ordens concluída');
  return { synced, errors };
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
