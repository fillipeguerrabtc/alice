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
 * - Sincronização com Mixtral LLM para sinais de trading
 * 
 * Autor: Fillipe Guerra
 * Data: 17 de Dezembro de 2025
 */

import { createLogger } from '@alice/logger';
import { getDatabase, schema, eq, and, desc, sql } from '@alice/database';
import {
  type TradingSignal,
  type TradingOrder,
  type TradingPosition,
  type TradingRiskConfig,
  type TradingAuditLog,
  type InsertTradingSignal,
  type InsertTradingOrder,
  type InsertTradingPosition,
  type InsertTradingAuditLog,
} from '@alice/shared';
import * as kucoinClient from './kucoinClient.js';

const logger = createLogger('kucoin-service');

// ============================================================================
// TIPOS ESPECÍFICOS DO SERVIÇO
// ============================================================================

/** Contexto de autenticação do usuário */
export interface TradingAuthContext {
  tenantId: string;
  userId: string;
  sessionId?: string;
}

/** Parâmetros para criar um sinal de trading */
export interface CreateSignalParams {
  signalType: 'long' | 'short' | 'close_long' | 'close_short' | 'hold';
  symbol?: string;
  confidence: number;
  reasoning?: string;
  sourceModel?: string;
  metadata?: Record<string, unknown>;
}

/** Parâmetros para criar uma ordem */
export interface CreateOrderFromSignalParams {
  signalId: string;
  symbol?: string;
  side: 'buy' | 'sell';
  orderType: 'limit' | 'market';
  size: number;
  price?: number;
  leverage?: number;
  stopLoss?: number;
  takeProfit?: number;
}

/** Parâmetros para ordem manual */
export interface ManualOrderParams {
  symbol?: string;
  side: 'buy' | 'sell';
  orderType: 'limit' | 'market';
  size: number;
  price?: number;
  leverage?: number;
}

/** Resultado de operação de trading */
export interface TradingOperationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  auditLogId?: string;
}

// ============================================================================
// AUDITORIA (Regra 6 - Persistência real, compliance)
// ============================================================================

/**
 * Registra ação no audit log de trading
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
  
  const auditEntry: InsertTradingAuditLog = {
    tenantId: authContext.tenantId,
    userId: authContext.userId,
    action,
    entityType,
    entityId,
    details,
    previousState: previousState ?? null,
    newState: newState ?? null,
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
 */
export async function validateTradingAllowed(
  authContext: TradingAuthContext,
  orderSize: number,
  orderValue: number
): Promise<{ allowed: boolean; reason?: string }> {
  const config = await getRiskConfig(authContext);
  
  if (!config) {
    return { allowed: false, reason: 'Configuração de risco não encontrada. Configure antes de operar.' };
  }

  if (!config.tradingEnabled) {
    return { allowed: false, reason: 'Trading desabilitado para este tenant.' };
  }

  if (orderSize > Number(config.maxPositionSize)) {
    return { 
      allowed: false, 
      reason: `Tamanho da ordem (${orderSize}) excede limite máximo (${config.maxPositionSize}).` 
    };
  }

  if (orderValue > Number(config.maxOrderValue)) {
    return { 
      allowed: false, 
      reason: `Valor da ordem (${orderValue}) excede limite máximo (${config.maxOrderValue}).` 
    };
  }

  return { allowed: true };
}

// ============================================================================
// SINAIS DE TRADING (Gerados pelo Mixtral LLM)
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
    const signalData: InsertTradingSignal = {
      tenantId: authContext.tenantId,
      signalType: params.signalType,
      symbol: params.symbol ?? 'XBTUSDTM',
      confidence: params.confidence.toString(),
      reasoning: params.reasoning ?? null,
      sourceModel: params.sourceModel ?? 'mixtral-8x7b',
      metadata: params.metadata ?? {},
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
  limit: number = 10
): Promise<TradingSignal[]> {
  const db = getDatabase();
  
  const signals = await db
    .select()
    .from(schema.tradingSignals)
    .where(
      and(
        eq(schema.tradingSignals.tenantId, authContext.tenantId),
        eq(schema.tradingSignals.isActive, true)
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

    const [updated] = await db
      .update(schema.tradingSignals)
      .set({ isActive: false, atualizadoEm: new Date() })
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
    // Verificar se KuCoin está configurada
    if (!kucoinClient.isKucoinConfigured()) {
      return { success: false, error: 'API KuCoin não configurada.' };
    }

    const symbol = params.symbol ?? 'XBTUSDTM';

    // Validar símbolo
    if (!kucoinClient.isValidSymbol(symbol)) {
      return { success: false, error: `Símbolo inválido: ${symbol}. Use XBTUSDTM ou XBTUSDM.` };
    }

    // Obter preço atual para validação
    const ticker = await kucoinClient.getTicker(symbol);
    const currentPrice = parseFloat(ticker.price);
    
    // CORREÇÃO 17/12/2025: Para ordens limite, usar params.price na validação de risco
    // Bug: orderValue usava sempre currentPrice, permitindo ordens acima do limite
    // quando limit price > current price (ex: limit buy a $200k quando BTC está a $100k)
    const priceForValidation = params.price !== undefined ? params.price : currentPrice;
    const orderValue = params.size * priceForValidation;

    // Validar limites de risco
    const riskCheck = await validateTradingAllowed(authContext, params.size, orderValue);
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
    const kucoinOrder = await kucoinClient.createOrder({
      clientOid,
      symbol,
      side: params.side,
      type: params.orderType,
      size: params.size,
      price: params.price?.toString(),
      leverage: params.leverage,
    });

    // Salvar no banco
    // Bug fix: UUID não aceita string vazia, usar null se signalId não for um UUID válido
    const validSignalId = params.signalId && params.signalId.trim() !== '' ? params.signalId : null;
    
    const orderData: InsertTradingOrder = {
      tenantId: authContext.tenantId,
      signalId: validSignalId,
      kucoinOrderId: kucoinOrder.orderId,
      clientOid,
      symbol,
      side: params.side,
      orderType: params.orderType,
      status: 'pending',
      price: params.price?.toString() ?? currentPrice.toString(),
      size: params.size.toString(),
      leverage: params.leverage ?? 1,
      stopLoss: params.stopLoss?.toString() ?? null,
      takeProfit: params.takeProfit?.toString() ?? null,
      metadata: {
        kucoinResponse: kucoinOrder,
        isSandbox: kucoinClient.getKucoinSandboxStatus(),
      },
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
      { params, kucoinOrderId: kucoinOrder.orderId, clientOid },
      undefined,
      order as unknown as Record<string, unknown>
    );

    logger.info(
      { 
        orderId: order.id, 
        kucoinOrderId: kucoinOrder.orderId, 
        symbol, 
        side: params.side, 
        size: params.size 
      },
      'Ordem criada com sucesso'
    );

    return { success: true, data: order, auditLogId };
  } catch (error) {
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
  // Bug fix: UUID não aceita string vazia - passar string vazia que será
  // convertida para null em createOrderFromSignal
  return createOrderFromSignal(authContext, {
    signalId: '', // Convertido para null em createOrderFromSignal (validação de UUID)
    ...params,
  });
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
    if (existing.kucoinOrderId && kucoinClient.isKucoinConfigured()) {
      await kucoinClient.cancelOrder(existing.kucoinOrderId);
    }

    // Atualizar no banco
    const [updated] = await db
      .update(schema.tradingOrders)
      .set({ 
        status: 'cancelled', 
        atualizadoEm: new Date(),
        metadata: {
          ...existing.metadata,
          cancelledAt: new Date().toISOString(),
          cancelledBy: authContext.userId,
        },
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
  options?: { status?: string; limit?: number }
): Promise<TradingOrder[]> {
  const db = getDatabase();
  
  let query = db
    .select()
    .from(schema.tradingOrders)
    .where(eq(schema.tradingOrders.tenantId, authContext.tenantId));

  if (options?.status) {
    query = query.where(
      and(
        eq(schema.tradingOrders.tenantId, authContext.tenantId),
        eq(schema.tradingOrders.status, options.status as 'pending' | 'open' | 'filled' | 'cancelled' | 'rejected' | 'expired')
      )
    ) as typeof query;
  }

  const orders = await query
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
  
  if (!kucoinClient.isKucoinConfigured()) {
    logger.warn('KuCoin não configurada, sincronização ignorada');
    return { synced: 0, errors: 0 };
  }

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

      const kucoinOrder = await kucoinClient.getOrder(order.kucoinOrderId);
      
      // Mapear status da KuCoin para nosso schema
      // CORREÇÃO 17/12/2025: KuCoin Futures API retorna 'active' para ordens na order book, não 'open'
      // Referência: https://www.kucoin.com/docs/rest/futures-trading/orders/get-order-list
      let newStatus: 'pending' | 'open' | 'filled' | 'cancelled' | 'rejected' | 'expired' = 'pending';
      if (kucoinOrder.status === 'done') {
        if (kucoinOrder.filledSize === kucoinOrder.size) {
          // Ordem completamente preenchida
          newStatus = 'filled';
        } else if (kucoinOrder.cancelExist) {
          // CORREÇÃO 17/12/2025: Usar cancelExist para distinguir cancelamento explícito
          // cancelExist=true: cancelamento foi solicitado explicitamente
          newStatus = 'cancelled';
        } else {
          // CORREÇÃO 17/12/2025: cancelExist=false significa que a ordem expirou
          // por time-in-force (IOC, FOK) ou outra razão, não foi cancelamento explícito
          // Isso melhora a precisão de auditoria e relatórios de histórico de ordens
          newStatus = 'expired';
        }
      } else if (kucoinOrder.status === 'active') {
        // KuCoin retorna 'active' para ordens ativas na order book
        newStatus = 'open';
      }

      if (newStatus !== order.status) {
        await db
          .update(schema.tradingOrders)
          .set({
            status: newStatus,
            filledSize: kucoinOrder.filledSize?.toString(),
            // Bug fix: Campo correto é avgFilledPrice (não filledPrice) - conforme schema.ts linha 1521
            // Bug fix: Verificar filledSize > 0 antes de dividir para evitar Infinity/NaN
            avgFilledPrice: kucoinOrder.filledValue && kucoinOrder.filledSize && kucoinOrder.filledSize > 0
              ? (parseFloat(kucoinOrder.filledValue) / kucoinOrder.filledSize).toString()
              : null,
            atualizadoEm: new Date(),
            metadata: {
              ...order.metadata,
              lastSync: new Date().toISOString(),
              kucoinStatus: kucoinOrder.status,
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
export async function getMarketData(symbol: string = 'XBTUSDTM'): Promise<{
  ticker: kucoinClient.KucoinTicker;
  contract: kucoinClient.KucoinContract;
}> {
  const [ticker, contract] = await Promise.all([
    kucoinClient.getTicker(symbol),
    kucoinClient.getContractInfo(symbol),
  ]);

  return { ticker, contract };
}

/**
 * Obtém visão geral da conta na KuCoin
 */
export async function getAccountOverview(): Promise<kucoinClient.KucoinAccountOverview | null> {
  if (!kucoinClient.isKucoinConfigured()) {
    return null;
  }
  
  return kucoinClient.getAccountOverview();
}

/**
 * Obtém posições abertas na KuCoin
 */
export async function getKucoinPositions(): Promise<kucoinClient.KucoinPosition[]> {
  if (!kucoinClient.isKucoinConfigured()) {
    return [];
  }
  
  return kucoinClient.getAllPositions();
}

// ============================================================================
// STATUS DO SERVIÇO
// ============================================================================

/**
 * Obtém status completo do serviço de trading
 */
export async function getTradingServiceStatus(authContext: TradingAuthContext): Promise<{
  isConfigured: boolean;
  isSandbox: boolean;
  circuitBreaker: ReturnType<typeof kucoinClient.getKucoinCircuitBreakerStatus>;
  riskConfig: TradingRiskConfig | null;
  activeSignals: number;
  pendingOrders: number;
}> {
  const db = getDatabase();
  
  const [riskConfig, activeSignalsResult, pendingOrdersResult] = await Promise.all([
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
  ]);

  return {
    isConfigured: kucoinClient.isKucoinConfigured(),
    isSandbox: kucoinClient.getKucoinSandboxStatus(),
    circuitBreaker: kucoinClient.getKucoinCircuitBreakerStatus(),
    riskConfig,
    activeSignals: Number(activeSignalsResult[0]?.count ?? 0),
    pendingOrders: Number(pendingOrdersResult[0]?.count ?? 0),
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
  
  // Market Data
  getMarketData,
  getAccountOverview,
  getKucoinPositions,
  
  // Status
  getTradingServiceStatus,
};
