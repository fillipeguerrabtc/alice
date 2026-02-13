/**
 * Demo Trading Engine - Execução simulada com dados de mercado reais
 * 
 * Funcionalidades:
 * - Balances infinitos auditáveis (add funds com histórico)
 * - Ordens market/limit/stop com slippage e fees simulados
 * - Posições spot/futures/margin com PnL em tempo real
 * - Auto-close via SL/TP/liquidação
 * - Hook automático de post-mortem no fechamento de posição
 * - Snapshot de mercado na abertura e fechamento
 * 
 * NUNCA chama trading real - total isolamento
 * 
 * @author Fillipe Guerra
 * @since 09/02/2026
 */

import { createLogger } from '@alice/logger';
import {
  Counter as PromCounter,
  Gauge as PromGauge,
} from '@alice/shared-utils';
import { getDatabase, schema } from '@alice/database';
import { eq, and, desc, sql } from '@alice/database';
import * as kucoinClient from './kucoinClient.js';
import * as kucoinSpotClient from './kucoinSpotClient.js';
import { captureEntrySnapshot, captureExitSnapshot } from './snapshot-store.js';
import { enqueuePostMortem } from './postmortem-worker.js';
import type { PostMortemPositionData } from './postmortem-engine.js';

const logger = createLogger('demo-trading-engine');

// ============================================================================
// Métricas Prometheus
// ============================================================================

const demoOrdersTotal = new PromCounter({
  name: 'alice_demo_orders_total',
  help: 'Total de ordens demo criadas',
  labelNames: ['market_type', 'order_type', 'side'] as const,
});

const demoPositionsClosedTotal = new PromCounter({
  name: 'alice_demo_positions_closed_total',
  help: 'Total de posições demo fechadas',
  labelNames: ['market_type', 'profit'] as const,
});

const demoOpenPositions = new PromGauge({
  name: 'alice_demo_open_positions',
  help: 'Número de posições demo abertas',
});

// ============================================================================
// Constantes
// ============================================================================

/** Saldo inicial default (USDT) */
const DEFAULT_INITIAL_BALANCE = 100_000;

/** Slippage simulado em basis points (3 bps = 0.03%) */
const SIMULATED_SLIPPAGE_BPS = 3;

/** Fee simulado em basis points (4 bps = 0.04%) - simula taker fee KuCoin */
const SIMULATED_FEE_BPS = 4;

/** Fator de manutenção default (KuCoin level 1 costuma iniciar em 0.4%) */
const DEFAULT_MAINTENANCE_MARGIN_RATE = 0.004;
/** Taxa de liquidação default (KuCoin Futures ~0.06%) */
const DEFAULT_LIQUIDATION_FEE_RATE = 0.0006;

const KNOWN_QUOTE_CURRENCIES = ['USDT', 'USDC', 'BTC', 'ETH', 'EUR', 'USD', 'BRL'] as const;

// ============================================================================
// Tipos
// ============================================================================

export type DemoOrderSide = 'buy' | 'sell';
export type DemoOrderType = 'market' | 'limit' | 'stop';
export type DemoOrderStatus = 'open' | 'filled' | 'cancelled' | 'expired';
export type DemoPositionStatus = 'open' | 'closed' | 'liquidated';
export type DemoMarketType = 'spot' | 'futures' | 'margin';

export interface CreateDemoOrderParams {
  tenantId: string;
  symbol: string;
  marketType: DemoMarketType;
  side: DemoOrderSide;
  orderType: DemoOrderType;
  size: number;
  price?: number;        // Obrigatório para limit/stop
  leverage?: number;     // Para futures/margin (default 1)
  stopLoss?: number;
  takeProfit?: number;
  signalId?: string;     // ID do sinal IA que originou a ordem (rastreabilidade)
}

export interface DemoOrderResult {
  orderId: string;
  status: DemoOrderStatus;
  fillPrice?: number;
  fillSize?: number;
  fee?: number;
  positionId?: string;
}

type DemoAssetPair = {
  baseCurrency: string;
  quoteCurrency: string;
};

export class DemoTradingBusinessError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'INVALID_INPUT'
      | 'INSUFFICIENT_BALANCE'
      | 'NOT_FOUND'
      | 'INVALID_PROTECTIVE_LEVEL'
      | 'SPOT_NOT_CONFIGURED'
      | 'PRICE_UNAVAILABLE',
    public readonly statusCode: 400 | 404 | 422 = 400,
  ) {
    super(message);
    this.name = 'DemoTradingBusinessError';
  }
}

// ============================================================================
// Balance Management
// ============================================================================

/**
 * Inicializa ou busca balance de um tenant
 */
export async function getOrCreateBalance(tenantId: string, currency = 'USDT'): Promise<{
  id: string;
  available: string;
  frozen: string;
}> {
  const db = getDatabase();

  // Buscar balance existente
  const [existing] = await db
    .select()
    .from(schema.demoBalances)
    .where(and(
      eq(schema.demoBalances.tenantId, tenantId),
      eq(schema.demoBalances.currency, currency),
    ))
    .limit(1);

  if (existing) {
    return { id: existing.id, available: existing.available, frozen: existing.frozen };
  }

  // Criar balance inicial
  const [created] = await db
    .insert(schema.demoBalances)
    .values({
      tenantId,
      currency,
      available: String(DEFAULT_INITIAL_BALANCE),
      frozen: '0',
    })
    .returning();

  // Registrar no histórico de fundos
  await db.insert(schema.demoFundHistory).values({
    tenantId,
    amount: String(DEFAULT_INITIAL_BALANCE),
    currency,
    reason: 'initial_deposit - Depósito inicial demo',
  });

  logger.info({ tenantId, currency, amount: DEFAULT_INITIAL_BALANCE }, 'Balance demo inicializado');
  return { id: created.id, available: created.available, frozen: created.frozen };
}

/**
 * Adiciona fundos à conta demo (auditado)
 */
export async function addFunds(params: {
  tenantId: string;
  amount: number;
  currency?: string;
  note?: string;
}): Promise<{ available: string }> {
  const db = getDatabase();
  const currency = params.currency ?? 'USDT';

  // Garantir que balance existe antes de fazer UPDATE atômico
  const balance = await getOrCreateBalance(params.tenantId, currency);

  // UPDATE atômico com RETURNING: aritmética SQL evita race condition e captura novo saldo
  const [updated] = await db
    .update(schema.demoBalances)
    .set({
      available: sql`${schema.demoBalances.available}::numeric + ${String(params.amount)}::numeric`,
      updatedAt: new Date(),
    })
    .where(eq(schema.demoBalances.id, balance.id))
    .returning({ available: schema.demoBalances.available });

  const newAvailable = updated?.available ?? '0';

  // Registrar no histórico
  await db.insert(schema.demoFundHistory).values({
    tenantId: params.tenantId,
    amount: String(params.amount),
    currency,
    reason: `add_funds - ${params.note ?? 'Adição de fundos demo'}`,
  });

  logger.info({
    tenantId: params.tenantId,
    amount: params.amount,
    currency,
    newAvailable,
  }, 'Fundos adicionados à conta demo');

  return { available: String(newAvailable) };
}

/**
 * Busca histórico de fundos
 */
export async function getFundHistory(tenantId: string): Promise<Array<typeof schema.demoFundHistory.$inferSelect>> {
  const db = getDatabase();
  return db
    .select()
    .from(schema.demoFundHistory)
    .where(eq(schema.demoFundHistory.tenantId, tenantId))
    .orderBy(desc(schema.demoFundHistory.createdAt));
}

// ============================================================================
// Execução de Ordens
// ============================================================================

/**
 * Aplica slippage simulado ao preço
 */
function applySlippage(price: number, side: DemoOrderSide): number {
  const slippageFactor = SIMULATED_SLIPPAGE_BPS / 10_000;
  // Compra: preço sobe ligeiramente; Venda: preço desce ligeiramente
  return side === 'buy'
    ? price * (1 + slippageFactor)
    : price * (1 - slippageFactor);
}

/**
 * Calcula fee simulado
 */
function calculateFee(size: number, price: number, contractMultiplier = 1): number {
  const notional = size * price * contractMultiplier;
  return (notional * SIMULATED_FEE_BPS) / 10_000;
}

/**
 * Calcula preço de liquidação para futures COM ISOLATED MARGIN
 * 
 * Fórmula Isolated Margin:
 * LiqPrice = (PositionValue - PositionMargin) / Denominator
 * 
 * Esta função é mantida para referência mas NÃO é mais usada.
 * O sistema agora usa Cross Margin (calculateLiquidationPriceCrossMargin).
 */
function calculateLiquidationPriceIsolated(params: {
  entryPrice: number;
  side: DemoOrderSide;
  positionSize: number;
  contractMultiplier: number;
  positionMargin: number;
  maintenanceMarginRate: number;
  liquidationFeeRate: number;
}): number {
  const {
    entryPrice,
    side,
    positionSize,
    contractMultiplier,
    positionMargin,
    maintenanceMarginRate,
    liquidationFeeRate,
  } = params;
  if (positionSize <= 0 || contractMultiplier <= 0 || positionMargin <= 0 || entryPrice <= 0) {
    return 0;
  }
  const openingValue = positionSize * contractMultiplier * entryPrice;
  const sideFactor = side === 'buy' ? 1 : -1;
  const denominator = positionSize * contractMultiplier * (
    1 - sideFactor * maintenanceMarginRate - sideFactor * liquidationFeeRate
  );
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  const liquidationPrice = (openingValue - positionMargin) / denominator;
  if (!Number.isFinite(liquidationPrice) || liquidationPrice <= 0) {
    return 0;
  }
  return liquidationPrice;
}

/**
 * Calcula preço de liquidação para futures COM CROSS MARGIN
 * 
 * Fórmula Cross Margin (conforme KuCoin):
 * LiqPrice = (PositionValue - AccountBalance + TotalMaintenanceMargin) / Denominator
 * 
 * Onde:
 * - AccountBalance = available + frozen + unrealizedPnl (TODAS posições)
 * - TotalMaintenanceMargin = soma MMR de TODAS as posições
 * 
 * REF: https://www.kucoin.com/support/360015102119-Cross-Margin-Mode
 * 
 * @author Fillipe Guerra
 * @since 13/02/2026
 */
function calculateLiquidationPriceCrossMargin(params: {
  entryPrice: number;
  side: DemoOrderSide;
  positionSize: number;
  contractMultiplier: number;
  totalAccountBalance: number; // ✅ Saldo TOTAL (cross)
  totalMaintenanceMargin: number; // ✅ MMR TOTAL (cross)
  maintenanceMarginRate: number;
  liquidationFeeRate: number;
}): number {
  const {
    entryPrice,
    side,
    positionSize,
    contractMultiplier,
    totalAccountBalance,
    totalMaintenanceMargin,
    maintenanceMarginRate,
    liquidationFeeRate,
  } = params;

  if (positionSize <= 0 || contractMultiplier <= 0 || totalAccountBalance <= 0 || entryPrice <= 0) {
    return 0;
  }

  const openingValue = positionSize * contractMultiplier * entryPrice;
  const sideFactor = side === 'buy' ? 1 : -1;
  
  const denominator = positionSize * contractMultiplier * (
    1 - sideFactor * maintenanceMarginRate - sideFactor * liquidationFeeRate
  );

  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-10) {
    return 0;
  }

  // ✅ FÓRMULA CROSS MARGIN
  const liquidationPrice = (openingValue - totalAccountBalance + totalMaintenanceMargin) / denominator;

  if (!Number.isFinite(liquidationPrice) || liquidationPrice <= 0) {
    return 0;
  }

  return liquidationPrice;
}

function calculateFuturesNotional(size: number, price: number, contractMultiplier: number): number {
  return size * price * contractMultiplier;
}

async function getFuturesPricingContext(symbol: string): Promise<{
  contractMultiplier: number;
  maintenanceMarginRate: number;
  liquidationFeeRate: number;
}> {
  const contractInfo = await kucoinClient.getContractInfo(symbol);
  return {
    contractMultiplier: Number(contractInfo.multiplier || 1),
    maintenanceMarginRate: Number(contractInfo.maintainMargin || DEFAULT_MAINTENANCE_MARGIN_RATE),
    liquidationFeeRate: DEFAULT_LIQUIDATION_FEE_RATE,
  };
}

/**
 * Calcula maintenance margin TOTAL de todas as posições (cross margin)
 * 
 * @author Fillipe Guerra
 * @since 13/02/2026
 */
function calculateTotalMaintenanceMargin(positions: Array<typeof schema.demoPositions.$inferSelect>): number {
  let total = 0;
  
  for (const position of positions) {
    const size = Number(position.size);
    const entryPrice = Number(position.entryPrice);
    const multiplier = (position.metadata as { contractMultiplier?: number })?.contractMultiplier ?? 1;
    const mmr = (position.metadata as { maintenanceMarginRate?: number })?.maintenanceMarginRate ?? DEFAULT_MAINTENANCE_MARGIN_RATE;
    
    const notional = size * entryPrice * multiplier;
    total += notional * mmr;
  }
  
  return total;
}

/**
 * Calcula PnL não-realizado de TODAS as posições (cross margin)
 * 
 * @author Fillipe Guerra
 * @since 13/02/2026
 */
async function calculateTotalUnrealizedPnl(params: {
  tenantId: string;
  positions: Array<typeof schema.demoPositions.$inferSelect>;
}): Promise<{ totalPnl: number; positionPnls: Map<string, number> }> {
  const positionPnls = new Map<string, number>();
  let totalPnl = 0;

  for (const position of params.positions) {
    const currentPrice = await getCurrentPrice(position.symbol, position.marketType as DemoMarketType);
    const entryPrice = Number(position.entryPrice);
    const size = Number(position.size);
    const multiplier = (position.metadata as { contractMultiplier?: number })?.contractMultiplier ?? 1;
    
    const direction = position.side === 'long' ? 1 : -1;
    const pnl = (currentPrice - entryPrice) * size * multiplier * direction;
    
    positionPnls.set(position.id, pnl);
    totalPnl += pnl;
  }

  return { totalPnl, positionPnls };
}

function validateProtectiveLevels(params: {
  side: DemoOrderSide;
  entryPrice: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  context: 'order_create' | 'scheduler_fill' | 'position_update';
}): { stopLoss: number | null; takeProfit: number | null } {
  const { side, entryPrice, context } = params;
  let stopLoss = params.stopLoss ?? null;
  let takeProfit = params.takeProfit ?? null;

  if (stopLoss !== null && !Number.isFinite(stopLoss)) {
    stopLoss = null;
  }
  if (takeProfit !== null && !Number.isFinite(takeProfit)) {
    takeProfit = null;
  }

  if (side === 'buy') {
    if (stopLoss !== null && stopLoss >= entryPrice) {
      if (context === 'order_create' || context === 'position_update') {
        throw new DemoTradingBusinessError(
          `Stop Loss (${stopLoss}) deve ser menor que o preço de entrada (${entryPrice}) para LONG.`,
          'INVALID_PROTECTIVE_LEVEL',
          422
        );
      }
      logger.warn({ stopLoss, entryPrice }, 'Stop Loss inválido em fill agendado - removendo proteção');
      stopLoss = null;
    }
    if (takeProfit !== null && takeProfit <= entryPrice) {
      if (context === 'order_create' || context === 'position_update') {
        throw new DemoTradingBusinessError(
          `Take Profit (${takeProfit}) deve ser maior que o preço de entrada (${entryPrice}) para LONG.`,
          'INVALID_PROTECTIVE_LEVEL',
          422
        );
      }
      logger.warn({ takeProfit, entryPrice }, 'Take Profit inválido em fill agendado - removendo proteção');
      takeProfit = null;
    }
  } else {
    if (stopLoss !== null && stopLoss <= entryPrice) {
      if (context === 'order_create' || context === 'position_update') {
        throw new DemoTradingBusinessError(
          `Stop Loss (${stopLoss}) deve ser maior que o preço de entrada (${entryPrice}) para SHORT.`,
          'INVALID_PROTECTIVE_LEVEL',
          422
        );
      }
      logger.warn({ stopLoss, entryPrice }, 'Stop Loss inválido em fill agendado - removendo proteção');
      stopLoss = null;
    }
    if (takeProfit !== null && takeProfit >= entryPrice) {
      if (context === 'order_create' || context === 'position_update') {
        throw new DemoTradingBusinessError(
          `Take Profit (${takeProfit}) deve ser menor que o preço de entrada (${entryPrice}) para SHORT.`,
          'INVALID_PROTECTIVE_LEVEL',
          422
        );
      }
      logger.warn({ takeProfit, entryPrice }, 'Take Profit inválido em fill agendado - removendo proteção');
      takeProfit = null;
    }
  }

  return { stopLoss, takeProfit };
}

function resolveAssetPair(symbol: string): DemoAssetPair {
  const normalized = symbol.trim().toUpperCase();
  const withoutFuturesSuffix = normalized.endsWith('M') ? normalized.slice(0, -1) : normalized;

  if (withoutFuturesSuffix.includes('-')) {
    const [baseRaw, quoteRaw] = withoutFuturesSuffix.split('-');
    const base = baseRaw?.trim();
    const quote = quoteRaw?.trim();
    if (base && quote) {
      return { baseCurrency: base, quoteCurrency: quote };
    }
  }

  for (const quote of KNOWN_QUOTE_CURRENCIES) {
    if (withoutFuturesSuffix.endsWith(quote) && withoutFuturesSuffix.length > quote.length) {
      return {
        baseCurrency: withoutFuturesSuffix.slice(0, withoutFuturesSuffix.length - quote.length),
        quoteCurrency: quote,
      };
    }
  }

  return { baseCurrency: withoutFuturesSuffix, quoteCurrency: 'USDT' };
}

/**
 * Busca preço atual do mercado KuCoin
 */
function normalizeSpotSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  if (normalized.includes('-')) {
    return normalized;
  }

  const withoutFuturesSuffix = normalized.endsWith('M') ? normalized.slice(0, -1) : normalized;
  for (const quote of KNOWN_QUOTE_CURRENCIES) {
    if (withoutFuturesSuffix.endsWith(quote) && withoutFuturesSuffix.length > quote.length) {
      const base = withoutFuturesSuffix.slice(0, withoutFuturesSuffix.length - quote.length);
      return `${base}-${quote}`;
    }
  }
  return withoutFuturesSuffix;
}

async function getCurrentPrice(symbol: string, marketType: DemoMarketType): Promise<number> {
  try {
    const price = await (async () => {
      if (marketType === 'futures') {
        const ticker = await kucoinClient.getTicker(symbol);
        return Number(ticker.price);
      }

      if (!kucoinSpotClient.isSpotConfigured()) {
        throw new DemoTradingBusinessError(
          'KuCoin Spot não está configurado para operar Spot/Margin no Demo.',
          'SPOT_NOT_CONFIGURED',
          422
        );
      }

      const spotSymbol = normalizeSpotSymbol(symbol);
      const ticker = await kucoinSpotClient.getSpotTicker(spotSymbol);
      return Number(ticker.price);
    })();

    if (isNaN(price) || price <= 0) {
      throw new DemoTradingBusinessError(
        `Preço inválido para ${symbol}.`,
        'PRICE_UNAVAILABLE',
        422
      );
    }
    return price;
  } catch (error) {
    logger.error({ error, symbol, marketType }, 'Falha ao buscar preço atual');
    throw error;
  }
}

/**
 * Cria e executa uma ordem demo
 */
export async function createDemoOrder(params: CreateDemoOrderParams): Promise<DemoOrderResult> {
  // Validação defensiva: size DEVE ser positivo (defesa em profundidade - endpoint já valida)
  if (!Number.isFinite(params.size) || params.size <= 0) {
    throw new DemoTradingBusinessError(
      `size inválido: ${params.size}. Deve ser um número positivo.`,
      'INVALID_INPUT',
      422,
    );
  }

  const rawLeverage = params.leverage;
  if (rawLeverage !== undefined && (!Number.isFinite(rawLeverage) || rawLeverage <= 0)) {
    throw new DemoTradingBusinessError(
      `Alavancagem inválida: ${rawLeverage}.`,
      'INVALID_INPUT',
      422,
    );
  }
  const leverage = rawLeverage ?? 1;

  if (params.marketType === 'spot' && leverage !== 1) {
    throw new DemoTradingBusinessError(
      'Spot demo não permite alavancagem diferente de 1x.',
      'INVALID_INPUT',
      422,
    );
  }
  if (params.marketType === 'futures' && leverage > 125) {
    throw new DemoTradingBusinessError(
      'Alavancagem máxima para futures demo é 125x.',
      'INVALID_INPUT',
      422,
    );
  }
  if (params.marketType === 'margin' && leverage > 10) {
    throw new DemoTradingBusinessError(
      'Alavancagem máxima para margin demo é 10x.',
      'INVALID_INPUT',
      422,
    );
  }

  const db = getDatabase();

  const assetPair = resolveAssetPair(params.symbol);
  const quoteBalance = await getOrCreateBalance(params.tenantId, assetPair.quoteCurrency);
  const baseBalance = await getOrCreateBalance(params.tenantId, assetPair.baseCurrency);
  const futuresContext = params.marketType === 'futures'
    ? await getFuturesPricingContext(params.symbol)
    : null;
  const futuresContractMultiplier = futuresContext?.contractMultiplier ?? 1;

  // Buscar preço atual
  const marketPrice = await getCurrentPrice(params.symbol, params.marketType);

  let fillPrice: number;
  let orderStatus: DemoOrderStatus;

  if (params.orderType === 'market') {
    // Market order: execução imediata com slippage
    fillPrice = applySlippage(marketPrice, params.side);
    orderStatus = 'filled';
  } else if (params.orderType === 'limit') {
    // Limit order: só executa se preço favorável
    if (!params.price) {
      throw new DemoTradingBusinessError(
        'Preço obrigatório para ordem limit.',
        'INVALID_INPUT',
        422,
      );
    }
    if (params.side === 'buy' && params.price >= marketPrice) {
      fillPrice = applySlippage(params.price, params.side);
      orderStatus = 'filled';
    } else if (params.side === 'sell' && params.price <= marketPrice) {
      fillPrice = applySlippage(params.price, params.side);
      orderStatus = 'filled';
    } else {
      // Ordem pendente - simplificado: salvar como open
      fillPrice = params.price;
      orderStatus = 'open';
    }
  } else {
    // Stop order: salvar como open (será processada pelo scheduler)
    if (!params.price) {
      throw new DemoTradingBusinessError(
        'Preço obrigatório para ordem stop.',
        'INVALID_INPUT',
        422,
      );
    }
    fillPrice = params.price;
    orderStatus = 'open';
  }

  const validationEntryPrice = orderStatus === 'filled' ? fillPrice : (params.price ?? fillPrice);
  const validatedProtectiveLevels = validateProtectiveLevels({
    side: params.side,
    entryPrice: validationEntryPrice,
    stopLoss: params.stopLoss ?? null,
    takeProfit: params.takeProfit ?? null,
    context: 'order_create',
  });

  // Calcular custos
  const fee = orderStatus === 'filled'
    ? calculateFee(params.size, fillPrice, params.marketType === 'futures' ? futuresContractMultiplier : 1)
    : 0;
  const notionalValue = params.marketType === 'futures'
    ? calculateFuturesNotional(params.size, fillPrice, futuresContractMultiplier)
    : (params.size * fillPrice);
  const requiredMargin = notionalValue / leverage;

  // Verificar balance E debitar atomicamente numa única operação SQL.
  // Evita race condition onde duas requests concorrentes leem o mesmo saldo,
  // ambas passam a verificação, e o last-write-wins perde uma dedução.
  const estimatedFee = orderStatus === 'filled'
    ? fee
    : calculateFee(params.size, fillPrice, params.marketType === 'futures' ? futuresContractMultiplier : 1);

  if (params.marketType === 'futures') {
    // ✅ CROSS MARGIN: Apenas verificar e debitar FEE (margem é compartilhada, não congelada por posição)
    const balance = await getOrCreateBalance(params.tenantId, assetPair.quoteCurrency);
    const available = Number(balance.available);
    
    if (orderStatus === 'open') {
      // Ordem pendente: apenas congelar fee estimado
      if (available < estimatedFee) {
        throw new DemoTradingBusinessError(
          `Saldo insuficiente. Disponível: ${available.toFixed(2)} ${assetPair.quoteCurrency}, necessário (fee): ${estimatedFee.toFixed(2)}`,
          'INSUFFICIENT_BALANCE',
          422
        );
      }
      await db
        .update(schema.demoBalances)
        .set({
          available: sql`${schema.demoBalances.available}::numeric - ${String(estimatedFee)}::numeric`,
          frozen: sql`${schema.demoBalances.frozen}::numeric + ${String(estimatedFee)}::numeric`,
          updatedAt: new Date(),
        })
        .where(eq(schema.demoBalances.id, balance.id));
    } else {
      // Ordem filled: debitar APENAS fee (não congelar margem)
      if (available < fee) {
        throw new DemoTradingBusinessError(
          `Saldo insuficiente. Disponível: ${available.toFixed(2)} ${assetPair.quoteCurrency}, necessário (fee): ${fee.toFixed(2)}`,
          'INSUFFICIENT_BALANCE',
          422
        );
      }
      await db
        .update(schema.demoBalances)
        .set({
          available: sql`${schema.demoBalances.available}::numeric - ${String(fee)}::numeric`,
          updatedAt: new Date(),
        })
        .where(eq(schema.demoBalances.id, balance.id));
    }
  } else {
    if (orderStatus === 'open') {
      if (params.side === 'buy') {
        const quoteToFreeze = notionalValue + estimatedFee;
        const [quoteUpdated] = await db
          .update(schema.demoBalances)
          .set({
            available: sql`${schema.demoBalances.available}::numeric - ${String(quoteToFreeze)}::numeric`,
            frozen: sql`${schema.demoBalances.frozen}::numeric + ${String(quoteToFreeze)}::numeric`,
            updatedAt: new Date(),
          })
          .where(and(
            eq(schema.demoBalances.id, quoteBalance.id),
            sql`${schema.demoBalances.available}::numeric >= ${String(quoteToFreeze)}::numeric`,
          ))
          .returning({ id: schema.demoBalances.id });

        if (!quoteUpdated) {
          throw new DemoTradingBusinessError(
            `Saldo insuficiente de ${assetPair.quoteCurrency} para ordem pendente de compra.`,
            'INSUFFICIENT_BALANCE',
            422,
          );
        }
      } else {
        const [baseUpdated] = await db
          .update(schema.demoBalances)
          .set({
            available: sql`${schema.demoBalances.available}::numeric - ${String(params.size)}::numeric`,
            frozen: sql`${schema.demoBalances.frozen}::numeric + ${String(params.size)}::numeric`,
            updatedAt: new Date(),
          })
          .where(and(
            eq(schema.demoBalances.id, baseBalance.id),
            sql`${schema.demoBalances.available}::numeric >= ${String(params.size)}::numeric`,
          ))
          .returning({ id: schema.demoBalances.id });

        if (!baseUpdated) {
          throw new DemoTradingBusinessError(
            `Saldo insuficiente de ${assetPair.baseCurrency} para ordem pendente de venda.`,
            'INSUFFICIENT_BALANCE',
            422,
          );
        }
      }
    } else if (params.side === 'buy') {
      const quoteRequired = notionalValue + fee;
      const [quoteUpdated] = await db
        .update(schema.demoBalances)
        .set({
          available: sql`${schema.demoBalances.available}::numeric - ${String(quoteRequired)}::numeric`,
          updatedAt: new Date(),
        })
        .where(and(
          eq(schema.demoBalances.id, quoteBalance.id),
          sql`${schema.demoBalances.available}::numeric >= ${String(quoteRequired)}::numeric`,
        ))
        .returning({ id: schema.demoBalances.id });

      if (!quoteUpdated) {
        throw new DemoTradingBusinessError(
          `Saldo insuficiente de ${assetPair.quoteCurrency} para compra.`,
          'INSUFFICIENT_BALANCE',
          422,
        );
      }

      await db
        .update(schema.demoBalances)
        .set({
          available: sql`${schema.demoBalances.available}::numeric + ${String(params.size)}::numeric`,
          updatedAt: new Date(),
        })
        .where(eq(schema.demoBalances.id, baseBalance.id));
    } else {
      const [baseUpdated] = await db
        .update(schema.demoBalances)
        .set({
          available: sql`${schema.demoBalances.available}::numeric - ${String(params.size)}::numeric`,
          updatedAt: new Date(),
        })
        .where(and(
          eq(schema.demoBalances.id, baseBalance.id),
          sql`${schema.demoBalances.available}::numeric >= ${String(params.size)}::numeric`,
        ))
        .returning({ id: schema.demoBalances.id });

      if (!baseUpdated) {
        throw new DemoTradingBusinessError(
          `Saldo insuficiente de ${assetPair.baseCurrency} para venda.`,
          'INSUFFICIENT_BALANCE',
          422,
        );
      }

      const quoteCredit = Math.max(0, notionalValue - fee);
      await db
        .update(schema.demoBalances)
        .set({
          available: sql`${schema.demoBalances.available}::numeric + ${String(quoteCredit)}::numeric`,
          updatedAt: new Date(),
        })
        .where(eq(schema.demoBalances.id, quoteBalance.id));
    }
  }

  // Criar registro da ordem
  const [order] = await db
    .insert(schema.demoOrders)
    .values({
      tenantId: params.tenantId,
      symbol: params.symbol,
      marketType: params.marketType,
      side: params.side,
      orderType: params.orderType,
      size: String(params.size),
      price: String(params.price ?? marketPrice),
      leverage,
      filledSize: orderStatus === 'filled' ? String(params.size) : '0',
      avgFilledPrice: orderStatus === 'filled' ? String(fillPrice) : null,
      fees: String(fee),
      signalId: params.signalId ?? null,
      status: orderStatus,
      filledAt: orderStatus === 'filled' ? new Date() : null,
      metadata: {
        stopLoss: validatedProtectiveLevels.stopLoss,
        takeProfit: validatedProtectiveLevels.takeProfit,
      },
    })
    .returning();

  let positionId: string | undefined;

  // Se ordem foi preenchida em futures, criar/atualizar posição
  // NOTA: balance já foi debitado atomicamente acima (available -= margin+fee, frozen += margin)
  if (orderStatus === 'filled' && params.marketType === 'futures') {
    // Consolidar por símbolo+lado quando já existe posição futures aberta
    const positionSide = params.side === 'buy' ? 'long' : 'short';
    const [existingPosition] = await db
      .select()
      .from(schema.demoPositions)
      .where(and(
        eq(schema.demoPositions.tenantId, params.tenantId),
        eq(schema.demoPositions.symbol, params.symbol),
        eq(schema.demoPositions.marketType, 'futures'),
        eq(schema.demoPositions.side, positionSide),
        eq(schema.demoPositions.status, 'open'),
      ))
      .orderBy(desc(schema.demoPositions.openedAt))
      .limit(1);

    if (existingPosition) {
      const currentSize = Number(existingPosition.size);
      const currentEntry = Number(existingPosition.entryPrice);
      const nextSize = currentSize + params.size;
      const weightedEntry = ((currentEntry * currentSize) + (fillPrice * params.size)) / nextSize;
      const currentMargin = Number(existingPosition.marginAmount ?? '0');
      const nextMargin = currentMargin + requiredMargin;
      const currentFees = Number(existingPosition.totalFees ?? '0');
      const nextFees = currentFees + fee;
      const nextStopLoss = validatedProtectiveLevels.stopLoss ?? (existingPosition.stopLoss ? Number(existingPosition.stopLoss) : null);
      const nextTakeProfit = validatedProtectiveLevels.takeProfit ?? (existingPosition.takeProfit ? Number(existingPosition.takeProfit) : null);
      const validatedRisk = validateProtectiveLevels({
        side: params.side,
        entryPrice: weightedEntry,
        stopLoss: nextStopLoss,
        takeProfit: nextTakeProfit,
        context: 'position_update',
      });
      
      // ✅ CROSS MARGIN: Buscar TODAS posições abertas para calcular maintenance margin TOTAL
      const allOpenPositions = await db
        .select()
        .from(schema.demoPositions)
        .where(and(
          eq(schema.demoPositions.tenantId, params.tenantId),
          eq(schema.demoPositions.status, 'open'),
        ));

      // ✅ Calcular maintenance margin TOTAL (incluindo posição atualizada)
      let totalMaintenanceMargin = 0;
      for (const pos of allOpenPositions) {
        if (pos.id === existingPosition.id) {
          // Usar valores atualizados para a posição sendo modificada
          const notional = nextSize * weightedEntry * futuresContractMultiplier;
          totalMaintenanceMargin += notional * (futuresContext?.maintenanceMarginRate ?? DEFAULT_MAINTENANCE_MARGIN_RATE);
        } else {
          const posSize = Number(pos.size);
          const posEntry = Number(pos.entryPrice);
          const posMultiplier = (pos.metadata as { contractMultiplier?: number })?.contractMultiplier ?? 1;
          const posMmr = (pos.metadata as { maintenanceMarginRate?: number })?.maintenanceMarginRate ?? DEFAULT_MAINTENANCE_MARGIN_RATE;
          const posNotional = posSize * posEntry * posMultiplier;
          totalMaintenanceMargin += posNotional * posMmr;
        }
      }

      // ✅ Saldo TOTAL da conta (cross margin)
      const balance = await getOrCreateBalance(params.tenantId, assetPair.quoteCurrency);
      const totalAccountBalance = Number(balance.available) + Number(balance.frozen);

      const liquidationPrice = calculateLiquidationPriceCrossMargin({
        entryPrice: weightedEntry,
        side: params.side,
        positionSize: nextSize,
        contractMultiplier: futuresContractMultiplier,
        totalAccountBalance,
        totalMaintenanceMargin,
        maintenanceMarginRate: futuresContext?.maintenanceMarginRate ?? DEFAULT_MAINTENANCE_MARGIN_RATE,
        liquidationFeeRate: futuresContext?.liquidationFeeRate ?? DEFAULT_LIQUIDATION_FEE_RATE,
      });
      const [updatedPosition] = await db
        .update(schema.demoPositions)
        .set({
          size: String(nextSize),
          entryPrice: String(weightedEntry),
          marginAmount: String(nextMargin),
          totalFees: String(nextFees),
          leverage: existingPosition.leverage ?? leverage,
          stopLoss: validatedRisk.stopLoss !== null ? String(validatedRisk.stopLoss) : null,
          takeProfit: validatedRisk.takeProfit !== null ? String(validatedRisk.takeProfit) : null,
          liquidationPrice: liquidationPrice > 0 ? String(liquidationPrice) : null,
          metadata: {
            ...((existingPosition.metadata ?? {}) as Record<string, unknown>),
            lastOrderId: order.id,
            contractMultiplier: futuresContractMultiplier,
            maintenanceMarginRate: futuresContext?.maintenanceMarginRate ?? DEFAULT_MAINTENANCE_MARGIN_RATE,
            liquidationFeeRate: futuresContext?.liquidationFeeRate ?? DEFAULT_LIQUIDATION_FEE_RATE,
            marginMode: 'cross', // ✅ Flag de cross margin
          },
        })
        .where(eq(schema.demoPositions.id, existingPosition.id))
        .returning();
      positionId = updatedPosition?.id ?? existingPosition.id;
      logger.info({
        positionId,
        orderId: order.id,
        symbol: params.symbol,
        side: positionSide,
        addedSize: params.size,
        newSize: nextSize,
        weightedEntry,
      }, 'Ordem demo consolidada em posição futures aberta');
    } else {
      // ✅ CROSS MARGIN: Buscar TODAS posições abertas para calcular maintenance margin TOTAL
      const allOpenPositions = await db
        .select()
        .from(schema.demoPositions)
        .where(and(
          eq(schema.demoPositions.tenantId, params.tenantId),
          eq(schema.demoPositions.status, 'open'),
        ));

      // Calcular MMR total de posições existentes
      const existingTotalMaintenanceMargin = calculateTotalMaintenanceMargin(allOpenPositions);
      
      // Adicionar MMR da nova posição
      const newNotional = params.size * fillPrice * futuresContractMultiplier;
      const totalMaintenanceMargin = existingTotalMaintenanceMargin + (newNotional * (futuresContext?.maintenanceMarginRate ?? DEFAULT_MAINTENANCE_MARGIN_RATE));

      // ✅ Saldo TOTAL da conta (cross margin)
      const balance = await getOrCreateBalance(params.tenantId, assetPair.quoteCurrency);
      const totalAccountBalance = Number(balance.available) + Number(balance.frozen);

      const liquidationPrice = calculateLiquidationPriceCrossMargin({
        entryPrice: fillPrice,
        side: params.side,
        positionSize: params.size,
        contractMultiplier: futuresContractMultiplier,
        totalAccountBalance,
        totalMaintenanceMargin,
        maintenanceMarginRate: futuresContext?.maintenanceMarginRate ?? DEFAULT_MAINTENANCE_MARGIN_RATE,
        liquidationFeeRate: futuresContext?.liquidationFeeRate ?? DEFAULT_LIQUIDATION_FEE_RATE,
      });

      const [position] = await db
        .insert(schema.demoPositions)
        .values({
          tenantId: params.tenantId,
          symbol: params.symbol,
          marketType: params.marketType,
          side: positionSide,
          entryPrice: String(fillPrice),
          size: String(params.size),
          leverage,
          stopLoss: validatedProtectiveLevels.stopLoss !== null ? String(validatedProtectiveLevels.stopLoss) : null,
          takeProfit: validatedProtectiveLevels.takeProfit !== null ? String(validatedProtectiveLevels.takeProfit) : null,
          liquidationPrice: liquidationPrice > 0 ? String(liquidationPrice) : null,
          marginAmount: String(requiredMargin),
          totalFees: String(fee),
          status: 'open',
          metadata: {
            orderId: order.id,
            contractMultiplier: futuresContractMultiplier,
            maintenanceMarginRate: futuresContext?.maintenanceMarginRate ?? DEFAULT_MAINTENANCE_MARGIN_RATE,
            liquidationFeeRate: futuresContext?.liquidationFeeRate ?? DEFAULT_LIQUIDATION_FEE_RATE,
            marginMode: 'cross', // ✅ Flag de cross margin
          },
        })
        .returning();

      positionId = position.id;

      // Capturar snapshot de entrada e armazenar ID na posição para uso no post-mortem
      try {
        const entrySnapshot = await captureEntrySnapshot({
          tenantId: params.tenantId,
          symbol: params.symbol,
          marketType: params.marketType,
          positionId: position.id,
        });
        await db
          .update(schema.demoPositions)
          .set({ entrySnapshotId: entrySnapshot.id })
          .where(eq(schema.demoPositions.id, position.id));
        logger.info({ positionId: position.id, entrySnapshotId: entrySnapshot.id }, 'Entry snapshot capturado e vinculado à posição demo');
      } catch (snapshotError) {
        logger.warn({ error: snapshotError, positionId: position.id }, 'Falha ao capturar snapshot de entrada (não bloqueante)');
      }
    }

    // Associar posição à ordem via metadata
    await db
      .update(schema.demoOrders)
      .set({ metadata: { ...((order.metadata ?? {}) as Record<string, unknown>), positionId } })
      .where(eq(schema.demoOrders.id, order.id));

    logger.info({
      orderId: order.id,
      positionId,
      symbol: params.symbol,
      side: positionSide,
      fillPrice,
      size: params.size,
      leverage,
      fee,
      marginMode: 'cross',
    }, 'Ordem demo executada e posição aberta COM CROSS MARGIN');
  }

  if (orderStatus === 'filled') {
    demoOrdersTotal.inc({
      market_type: params.marketType,
      order_type: params.orderType,
      side: params.side,
    });
  }

  return {
    orderId: order.id,
    status: orderStatus,
    fillPrice: orderStatus === 'filled' ? fillPrice : undefined,
    fillSize: orderStatus === 'filled' ? params.size : undefined,
    fee: orderStatus === 'filled' ? fee : undefined,
    positionId,
  };
}

// ============================================================================
// Fechamento de Posição
// ============================================================================

/**
 * Fecha uma posição demo e enfileira post-mortem
 */
export async function closeDemoPosition(params: {
  tenantId: string;
  positionId: string;
  reason?: string;
  size?: number;
}): Promise<{
  realizedPnl: number;
  fee: number;
  exitPrice: number;
  closedSize: number;
  remainingSize: number;
  isPartial: boolean;
}> {
  const db = getDatabase();

  // Buscar posição
  const [position] = await db
    .select()
    .from(schema.demoPositions)
    .where(and(
      eq(schema.demoPositions.id, params.positionId),
      eq(schema.demoPositions.tenantId, params.tenantId),
      eq(schema.demoPositions.status, 'open'),
    ))
    .limit(1);

  if (!position) {
    throw new DemoTradingBusinessError('Posição não encontrada ou já fechada', 'NOT_FOUND', 404);
  }

  // Buscar preço atual
  const currentPrice = await getCurrentPrice(position.symbol, position.marketType as DemoMarketType);
  const exitPrice = applySlippage(currentPrice, position.side === 'long' ? 'sell' : 'buy');
  const positionSize = Number(position.size);
  const closeSize = params.size !== undefined ? Number(params.size) : positionSize;
  if (!Number.isFinite(closeSize) || closeSize <= 0) {
    throw new DemoTradingBusinessError('Quantidade de fechamento inválida.', 'INVALID_INPUT', 422);
  }
  if (closeSize > positionSize) {
    throw new DemoTradingBusinessError(
      `Quantidade de fechamento (${closeSize}) maior que o tamanho da posição (${positionSize}).`,
      'INVALID_INPUT',
      422
    );
  }

  const remainingSize = positionSize - closeSize;
  const isPartial = remainingSize > 0;
  const futuresContext = position.marketType === 'futures' ? await getFuturesPricingContext(position.symbol) : null;
  const contractMultiplier = futuresContext?.contractMultiplier ?? 1;
  const fee = calculateFee(closeSize, exitPrice, position.marketType === 'futures' ? contractMultiplier : 1);

  // Calcular PnL
  const entryPrice = Number(position.entryPrice);
  const size = closeSize;
  const leverage = position.leverage ?? 1;

  // PnL = diferença de preço × tamanho nocional - fees
  let realizedPnl: number;
  const pnlMultiplier = position.marketType === 'futures' ? contractMultiplier : 1;
  if (position.side === 'long') {
    realizedPnl = (exitPrice - entryPrice) * size * pnlMultiplier - fee;
  } else {
    realizedPnl = (entryPrice - exitPrice) * size * pnlMultiplier - fee;
  }

  const closedAt = new Date();
  const previousTotalFees = Number(position.totalFees ?? '0');
  const nextTotalFees = previousTotalFees + fee;
  const previousRealized = Number(position.realizedPnl ?? '0');
  const nextRealized = previousRealized + realizedPnl;

  const currentMargin = Number(position.marginAmount ?? '0');
  const marginToRelease = positionSize > 0 ? (currentMargin * (closeSize / positionSize)) : 0;
  const remainingMargin = Math.max(0, currentMargin - marginToRelease);

  if (isPartial) {
    let remainingLiquidation = 0;
    if (position.marketType === 'futures') {
      // ✅ CROSS MARGIN: Buscar TODAS posições abertas para recalcular maintenance margin
      const allOpenPositions = await db
        .select()
        .from(schema.demoPositions)
        .where(and(
          eq(schema.demoPositions.tenantId, params.tenantId),
          eq(schema.demoPositions.status, 'open'),
        ));

      // Calcular MMR total (incluindo posição parcialmente fechada com tamanho atualizado)
      let totalMaintenanceMargin = 0;
      for (const pos of allOpenPositions) {
        if (pos.id === position.id) {
          // Usar tamanho reduzido para a posição sendo parcialmente fechada
          const notional = remainingSize * entryPrice * contractMultiplier;
          totalMaintenanceMargin += notional * (futuresContext?.maintenanceMarginRate ?? DEFAULT_MAINTENANCE_MARGIN_RATE);
        } else {
          const posSize = Number(pos.size);
          const posEntry = Number(pos.entryPrice);
          const posMultiplier = (pos.metadata as { contractMultiplier?: number })?.contractMultiplier ?? 1;
          const posMmr = (pos.metadata as { maintenanceMarginRate?: number })?.maintenanceMarginRate ?? DEFAULT_MAINTENANCE_MARGIN_RATE;
          const posNotional = posSize * posEntry * posMultiplier;
          totalMaintenanceMargin += posNotional * posMmr;
        }
      }

      // ✅ Saldo TOTAL da conta (cross margin) - APÓS creditar PnL
      const quoteCurrency = resolveAssetPair(position.symbol).quoteCurrency;
      const [balance] = await db
        .select()
        .from(schema.demoBalances)
        .where(and(
          eq(schema.demoBalances.tenantId, params.tenantId),
          eq(schema.demoBalances.currency, quoteCurrency),
        ))
        .limit(1);

      if (balance) {
        // Simular saldo após close parcial (creditar PnL)
        const totalAccountBalance = Number(balance.available) + Number(balance.frozen) + realizedPnl;

        remainingLiquidation = calculateLiquidationPriceCrossMargin({
          entryPrice,
          side: position.side === 'long' ? 'buy' : 'sell',
          positionSize: remainingSize,
          contractMultiplier,
          totalAccountBalance,
          totalMaintenanceMargin,
          maintenanceMarginRate: futuresContext?.maintenanceMarginRate ?? DEFAULT_MAINTENANCE_MARGIN_RATE,
          liquidationFeeRate: futuresContext?.liquidationFeeRate ?? DEFAULT_LIQUIDATION_FEE_RATE,
        });
      }
    }

    await db
      .update(schema.demoPositions)
      .set({
        size: String(remainingSize),
        marginAmount: String(remainingMargin),
        realizedPnl: String(nextRealized),
        totalFees: String(nextTotalFees),
        liquidationPrice: remainingLiquidation > 0 ? String(remainingLiquidation) : null,
        metadata: {
          ...((position.metadata ?? {}) as Record<string, unknown>),
          lastCloseReason: params.reason ?? 'manual_partial',
          contractMultiplier,
          marginMode: 'cross', // ✅ Flag de cross margin
        },
      })
      .where(eq(schema.demoPositions.id, position.id));
  } else {
    await db
      .update(schema.demoPositions)
      .set({
        exitPrice: String(exitPrice),
        realizedPnl: String(nextRealized),
        totalFees: String(nextTotalFees),
        status: params.reason === 'liquidation' ? 'liquidated' : 'closed',
        closedAt,
        metadata: {
          ...((position.metadata ?? {}) as Record<string, unknown>),
          closeReason: params.reason ?? 'manual',
          contractMultiplier,
        },
      })
      .where(eq(schema.demoPositions.id, position.id));
  }

  // ✅ CROSS MARGIN: Creditar PnL ao balance (margem não é congelada por posição)
  // UPDATE atômico: aritmética SQL evita race condition em read-modify-write concorrente
  const creditAmount = realizedPnl; // PnL (pode ser negativo) - margem NÃO é devolvida pois não foi congelada

  const quoteCurrency = resolveAssetPair(position.symbol).quoteCurrency;
  await db
    .update(schema.demoBalances)
    .set({
      available: sql`${schema.demoBalances.available}::numeric + ${String(creditAmount)}::numeric`,
      updatedAt: new Date(),
    })
    .where(and(
      eq(schema.demoBalances.tenantId, params.tenantId),
      eq(schema.demoBalances.currency, quoteCurrency),
    ));

  // Registrar no histórico de fundos
  await db.insert(schema.demoFundHistory).values({
    tenantId: params.tenantId,
    amount: String(Math.abs(realizedPnl)),
    currency: quoteCurrency,
    reason: `${isPartial ? 'partial_close' : (realizedPnl >= 0 ? 'pnl_credit' : 'pnl_debit')} - PnL de ${position.symbol} ${position.side}: ${realizedPnl.toFixed(2)} ${quoteCurrency}`,
  });

  if (isPartial) {
    logger.info({
      positionId: position.id,
      symbol: position.symbol,
      side: position.side,
      closedSize: closeSize,
      remainingSize,
      exitPrice,
      realizedPnl: realizedPnl.toFixed(2),
      fee: fee.toFixed(4),
      reason: params.reason ?? 'manual_partial',
      marginMode: 'cross',
    }, 'Posição demo parcialmente fechada COM CROSS MARGIN');

    return { realizedPnl, fee, exitPrice, closedSize: closeSize, remainingSize, isPartial: true };
  }

  // Capturar snapshot de saída
  let exitSnapshotId: string | undefined;
  try {
    const snapshot = await captureExitSnapshot({
      tenantId: params.tenantId,
      symbol: position.symbol,
      marketType: position.marketType as 'spot' | 'futures' | 'margin',
      positionId: position.id,
    });
    exitSnapshotId = snapshot.id;
  } catch (snapshotError) {
    logger.warn({ error: snapshotError, positionId: position.id }, 'Falha ao capturar snapshot de saída (não bloqueante)');
  }

  // Enfileirar post-mortem automático
  try {
    const postMortemPosition: PostMortemPositionData = {
      id: position.id,
      tenantId: params.tenantId,
      isDemo: true,
      symbol: position.symbol,
      marketType: position.marketType as 'spot' | 'futures' | 'margin',
      side: position.side as 'long' | 'short',
      entryPrice,
      exitPrice,
      size: positionSize,
      leverage,
      stopLoss: position.stopLoss ? Number(position.stopLoss) : undefined,
      takeProfit: position.takeProfit ? Number(position.takeProfit) : undefined,
      realizedPnl: nextRealized,
      // Usar total acumulado (entry fee + exit fee), não apenas exit fee
      totalFees: nextTotalFees,
      openedAt: position.openedAt,
      closedAt,
      entrySnapshotId: position.entrySnapshotId ?? undefined,
      exitSnapshotId,
    };

    await enqueuePostMortem({ positionData: postMortemPosition });
    logger.info({ positionId: position.id }, 'Post-mortem enfileirado para posição demo');
  } catch (pmError) {
    logger.warn({ error: pmError, positionId: position.id }, 'Falha ao enfileirar post-mortem (não bloqueante)');
  }

  logger.info({
    positionId: position.id,
    symbol: position.symbol,
    side: position.side,
    entryPrice,
    exitPrice,
    realizedPnl: nextRealized.toFixed(2),
    fee: fee.toFixed(4),
    reason: params.reason ?? 'manual',
  }, 'Posição demo fechada');

  demoPositionsClosedTotal.inc({
    market_type: position.marketType,
    profit: nextRealized > 0 ? 'true' : 'false',
  });

  return { realizedPnl, fee, exitPrice, closedSize: closeSize, remainingSize: 0, isPartial: false };
}

// ============================================================================
// Consultas
// ============================================================================

/**
 * Busca posições demo abertas de um tenant
 */
export async function getOpenPositions(tenantId: string): Promise<Array<typeof schema.demoPositions.$inferSelect>> {
  const db = getDatabase();
  const positions = await db
    .select()
    .from(schema.demoPositions)
    .where(and(
      eq(schema.demoPositions.tenantId, tenantId),
      eq(schema.demoPositions.status, 'open'),
    ))
    .orderBy(desc(schema.demoPositions.openedAt));

  // Atualizar gauge de posições abertas
  demoOpenPositions.set(positions.length);
  return positions;
}

/**
 * Busca todas as posições (incluindo fechadas)
 */
export async function getAllPositions(tenantId: string, limit = 50): Promise<Array<typeof schema.demoPositions.$inferSelect>> {
  const db = getDatabase();
  return db
    .select()
    .from(schema.demoPositions)
    .where(eq(schema.demoPositions.tenantId, tenantId))
    .orderBy(desc(schema.demoPositions.openedAt))
    .limit(limit);
}

/**
 * Lista todos os saldos demo de um tenant.
 */
export async function getAllBalances(tenantId: string): Promise<Array<typeof schema.demoBalances.$inferSelect>> {
  const db = getDatabase();
  const balances = await db
    .select()
    .from(schema.demoBalances)
    .where(eq(schema.demoBalances.tenantId, tenantId))
    .orderBy(desc(schema.demoBalances.updatedAt));

  if (balances.length === 0) {
    await getOrCreateBalance(tenantId, 'USDT');
    return db
      .select()
      .from(schema.demoBalances)
      .where(eq(schema.demoBalances.tenantId, tenantId))
      .orderBy(desc(schema.demoBalances.updatedAt));
  }

  return balances;
}

/**
 * Atualiza SL/TP de uma posição aberta.
 */
export async function updateDemoPositionRisk(params: {
  tenantId: string;
  positionId: string;
  stopLoss?: number | null;
  takeProfit?: number | null;
}): Promise<typeof schema.demoPositions.$inferSelect> {
  const db = getDatabase();

  const [position] = await db
    .select()
    .from(schema.demoPositions)
    .where(and(
      eq(schema.demoPositions.id, params.positionId),
      eq(schema.demoPositions.tenantId, params.tenantId),
      eq(schema.demoPositions.status, 'open'),
    ))
    .limit(1);

  if (!position) {
    throw new DemoTradingBusinessError('Posição não encontrada ou já fechada', 'NOT_FOUND', 404);
  }

  const hasStopLossField = Object.prototype.hasOwnProperty.call(params, 'stopLoss');
  const hasTakeProfitField = Object.prototype.hasOwnProperty.call(params, 'takeProfit');
  const currentStopLoss = position.stopLoss ? Number(position.stopLoss) : null;
  const currentTakeProfit = position.takeProfit ? Number(position.takeProfit) : null;
  const requestedStopLoss = hasStopLossField ? (params.stopLoss ?? null) : currentStopLoss;
  const requestedTakeProfit = hasTakeProfitField ? (params.takeProfit ?? null) : currentTakeProfit;

  const validated = validateProtectiveLevels({
    side: position.side === 'long' ? 'buy' : 'sell',
    entryPrice: Number(position.entryPrice),
    stopLoss: requestedStopLoss,
    takeProfit: requestedTakeProfit,
    context: 'position_update',
  });

  const [updated] = await db
    .update(schema.demoPositions)
    .set({
      stopLoss: validated.stopLoss !== null ? String(validated.stopLoss) : null,
      takeProfit: validated.takeProfit !== null ? String(validated.takeProfit) : null,
    })
    .where(eq(schema.demoPositions.id, position.id))
    .returning();

  if (!updated) {
    throw new Error('Falha ao atualizar SL/TP da posição');
  }

  logger.info({
    positionId: position.id,
    stopLoss: updated.stopLoss,
    takeProfit: updated.takeProfit,
  }, 'Proteções da posição demo atualizadas');

  return updated;
}

/**
 * Adiciona tamanho a uma posição aberta (escala in).
 */
export async function addToDemoPosition(params: {
  tenantId: string;
  positionId: string;
  size: number;
  price?: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
}): Promise<{
  position: typeof schema.demoPositions.$inferSelect;
  fillPrice: number;
  fee: number;
}> {
  const db = getDatabase();
  if (!Number.isFinite(params.size) || params.size <= 0) {
    throw new DemoTradingBusinessError('Quantidade para adicionar à posição é inválida.', 'INVALID_INPUT', 422);
  }

  const [position] = await db
    .select()
    .from(schema.demoPositions)
    .where(and(
      eq(schema.demoPositions.id, params.positionId),
      eq(schema.demoPositions.tenantId, params.tenantId),
      eq(schema.demoPositions.status, 'open'),
    ))
    .limit(1);

  if (!position) {
    throw new DemoTradingBusinessError('Posição não encontrada ou já fechada', 'NOT_FOUND', 404);
  }
  if (position.marketType !== 'futures') {
    throw new DemoTradingBusinessError('Adicionar tamanho à posição é suportado apenas para Futures demo.', 'INVALID_INPUT', 422);
  }

  const futuresContext = await getFuturesPricingContext(position.symbol);
  const contractMultiplier = futuresContext.contractMultiplier;
  const fillReference = params.price ?? await getCurrentPrice(position.symbol, position.marketType as DemoMarketType);
  const sideForExecution: DemoOrderSide = position.side === 'long' ? 'buy' : 'sell';
  const fillPrice = applySlippage(fillReference, sideForExecution);
  const fee = calculateFee(params.size, fillPrice, contractMultiplier);
  const leverage = position.leverage ?? 1;
  const addNotional = calculateFuturesNotional(params.size, fillPrice, contractMultiplier);
  const addMargin = addNotional / leverage;
  const totalRequired = addMargin + fee;

  const assetPair = resolveAssetPair(position.symbol);
  const quoteCurrency = assetPair.quoteCurrency;
  const balance = await getOrCreateBalance(params.tenantId, quoteCurrency);
  const [balanceUpdated] = await db
    .update(schema.demoBalances)
    .set({
      available: sql`${schema.demoBalances.available}::numeric - ${String(totalRequired)}::numeric`,
      frozen: sql`${schema.demoBalances.frozen}::numeric + ${String(addMargin)}::numeric`,
      updatedAt: new Date(),
    })
    .where(and(
      eq(schema.demoBalances.id, balance.id),
      sql`${schema.demoBalances.available}::numeric >= ${String(totalRequired)}::numeric`,
    ))
    .returning({ id: schema.demoBalances.id });

  if (!balanceUpdated) {
    throw new DemoTradingBusinessError(
      `Saldo insuficiente para adicionar posição. Requerido: ${totalRequired.toFixed(2)} ${quoteCurrency}.`,
      'INSUFFICIENT_BALANCE',
      422
    );
  }

  const currentSize = Number(position.size);
  const currentEntry = Number(position.entryPrice);
  const nextSize = currentSize + params.size;
  const weightedEntry = ((currentEntry * currentSize) + (fillPrice * params.size)) / nextSize;
  const currentMargin = Number(position.marginAmount ?? '0');
  const nextMargin = currentMargin + addMargin;
  const currentFees = Number(position.totalFees ?? '0');
  const nextFees = currentFees + fee;
  const nextStopLoss = params.stopLoss ?? (position.stopLoss ? Number(position.stopLoss) : null);
  const nextTakeProfit = params.takeProfit ?? (position.takeProfit ? Number(position.takeProfit) : null);

  const validated = validateProtectiveLevels({
    side: sideForExecution,
    entryPrice: weightedEntry,
    stopLoss: nextStopLoss,
    takeProfit: nextTakeProfit,
    context: 'position_update',
  });

  const nextLiquidation = calculateLiquidationPrice({
    entryPrice: weightedEntry,
    side: sideForExecution,
    positionSize: nextSize,
    contractMultiplier,
    positionMargin: nextMargin,
    maintenanceMarginRate: futuresContext.maintenanceMarginRate,
    liquidationFeeRate: futuresContext.liquidationFeeRate,
  });

  const [updatedPosition] = await db
    .update(schema.demoPositions)
    .set({
      size: String(nextSize),
      entryPrice: String(weightedEntry),
      marginAmount: String(nextMargin),
      totalFees: String(nextFees),
      stopLoss: validated.stopLoss !== null ? String(validated.stopLoss) : null,
      takeProfit: validated.takeProfit !== null ? String(validated.takeProfit) : null,
      liquidationPrice: nextLiquidation > 0 ? String(nextLiquidation) : null,
      metadata: {
        ...((position.metadata ?? {}) as Record<string, unknown>),
        contractMultiplier,
        maintenanceMarginRate: futuresContext.maintenanceMarginRate,
        liquidationFeeRate: futuresContext.liquidationFeeRate,
      },
    })
    .where(eq(schema.demoPositions.id, position.id))
    .returning();

  if (!updatedPosition) {
    throw new Error('Falha ao adicionar tamanho à posição');
  }

  await db.insert(schema.demoOrders).values({
    tenantId: params.tenantId,
    symbol: position.symbol,
    marketType: position.marketType,
    side: sideForExecution,
    orderType: 'market',
    size: String(params.size),
    price: String(fillReference),
    leverage,
    filledSize: String(params.size),
    avgFilledPrice: String(fillPrice),
    fees: String(fee),
    status: 'filled',
    filledAt: new Date(),
    metadata: {
      positionId: position.id,
      addToPosition: true,
    },
  });

  logger.info({
    positionId: position.id,
    addedSize: params.size,
    newSize: nextSize,
    weightedEntry,
    fee,
  }, 'Tamanho adicionado à posição demo');

  return { position: updatedPosition, fillPrice, fee };
}

/**
 * Busca ordens demo de um tenant
 */
export async function getOrders(tenantId: string, limit = 50): Promise<Array<typeof schema.demoOrders.$inferSelect>> {
  const db = getDatabase();
  return db
    .select()
    .from(schema.demoOrders)
    .where(eq(schema.demoOrders.tenantId, tenantId))
    .orderBy(desc(schema.demoOrders.createdAt))
    .limit(limit);
}

/**
 * Cancela uma ordem demo pendente e devolve a margem congelada ao saldo disponível
 */
export async function cancelDemoOrder(tenantId: string, orderId: string): Promise<boolean> {
  const db = getDatabase();

  // Buscar ordem antes de cancelar para saber margem congelada
  const [order] = await db
    .select()
    .from(schema.demoOrders)
    .where(and(
      eq(schema.demoOrders.id, orderId),
      eq(schema.demoOrders.tenantId, tenantId),
      eq(schema.demoOrders.status, 'open'),
    ))
    .limit(1);

  if (!order) return false;

  // Cancelar ordem
  const result = await db
    .update(schema.demoOrders)
    .set({ status: 'cancelled' })
    .where(and(
      eq(schema.demoOrders.id, orderId),
      eq(schema.demoOrders.tenantId, tenantId),
      eq(schema.demoOrders.status, 'open'),
    ))
    .returning();

  if (result.length === 0) return false;

  if (order.marketType === 'futures') {
    // Devolver margem + fee estimado congelados ao saldo disponível
    const leverage = order.leverage ?? 1;
    const futuresContext = await getFuturesPricingContext(order.symbol);
    const frozenNotional = calculateFuturesNotional(Number(order.size), Number(order.price), futuresContext.contractMultiplier);
    const frozenMargin = frozenNotional / leverage;
    const frozenFee = calculateFee(Number(order.size), Number(order.price), futuresContext.contractMultiplier);
    const totalFrozen = frozenMargin + frozenFee;

    await db
      .update(schema.demoBalances)
      .set({
        available: sql`${schema.demoBalances.available}::numeric + ${String(totalFrozen)}::numeric`,
        frozen: sql`GREATEST(0, ${schema.demoBalances.frozen}::numeric - ${String(totalFrozen)}::numeric)`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(schema.demoBalances.tenantId, tenantId),
        eq(schema.demoBalances.currency, 'USDT'),
      ));
  } else {
    const pair = resolveAssetPair(order.symbol);
    if (order.side === 'buy') {
      const totalFrozen = (Number(order.size) * Number(order.price)) + calculateFee(Number(order.size), Number(order.price));
      await db
        .update(schema.demoBalances)
        .set({
          available: sql`${schema.demoBalances.available}::numeric + ${String(totalFrozen)}::numeric`,
          frozen: sql`GREATEST(0, ${schema.demoBalances.frozen}::numeric - ${String(totalFrozen)}::numeric)`,
          updatedAt: new Date(),
        })
        .where(and(
          eq(schema.demoBalances.tenantId, tenantId),
          eq(schema.demoBalances.currency, pair.quoteCurrency),
        ));
    } else {
      await db
        .update(schema.demoBalances)
        .set({
          available: sql`${schema.demoBalances.available}::numeric + ${String(order.size)}::numeric`,
          frozen: sql`GREATEST(0, ${schema.demoBalances.frozen}::numeric - ${String(order.size)}::numeric)`,
          updatedAt: new Date(),
        })
        .where(and(
          eq(schema.demoBalances.tenantId, tenantId),
          eq(schema.demoBalances.currency, pair.baseCurrency),
        ));
    }
  }

  return true;
}

// ============================================================================
// Scheduler para ordens pendentes e auto-close
// ============================================================================

/**
 * Processa ordens limit/stop pendentes verificando se o preço atingiu
 * Também verifica SL/TP/liquidação de posições abertas
 * 
 * Chamado periodicamente (ex: a cada 5 segundos)
 */
export async function processOpenOrdersAndPositions(): Promise<void> {
  const db = getDatabase();

  // ✅ VERIFICAÇÃO CROSS MARGIN por tenant
  const tenants = await db
    .selectDistinct({ tenantId: schema.demoPositions.tenantId })
    .from(schema.demoPositions)
    .where(eq(schema.demoPositions.status, 'open'));

  for (const { tenantId } of tenants) {
    try {
      const openPositions = await db
        .select()
        .from(schema.demoPositions)
        .where(and(
          eq(schema.demoPositions.tenantId, tenantId),
          eq(schema.demoPositions.status, 'open'),
        ));

      if (openPositions.length === 0) continue;

      // ✅ PnL TOTAL não-realizado
      const { totalPnl, positionPnls } = await calculateTotalUnrealizedPnl({
        tenantId,
        positions: openPositions,
      });

      // ✅ Maintenance margin TOTAL
      const totalMaintenanceMargin = calculateTotalMaintenanceMargin(openPositions);

      // ✅ Saldo total da conta
      const quoteCurrency = resolveAssetPair(openPositions[0]?.symbol ?? 'XBTUSDTM').quoteCurrency;
      const [balance] = await db
        .select()
        .from(schema.demoBalances)
        .where(and(
          eq(schema.demoBalances.tenantId, tenantId),
          eq(schema.demoBalances.currency, quoteCurrency),
        ))
        .limit(1);

      if (!balance) {
        logger.warn({ tenantId }, 'Balance não encontrado para tenant com posições abertas');
        continue;
      }

      const totalAccountBalance = Number(balance.available) + Number(balance.frozen);
      const accountEquity = totalAccountBalance + totalPnl;

      logger.debug({
        tenantId,
        totalAccountBalance,
        totalPnl,
        accountEquity,
        totalMaintenanceMargin,
        openPositionsCount: openPositions.length,
      }, 'Cross margin check');

      // ✅ LIQUIDAÇÃO CROSS MARGIN: equity < maintenance → liquida TUDO
      if (accountEquity < totalMaintenanceMargin) {
        logger.warn({
          tenantId,
          accountEquity,
          totalMaintenanceMargin,
          deficit: totalMaintenanceMargin - accountEquity,
        }, 'LIQUIDAÇÃO CROSS MARGIN - fechando TODAS as posições');

        for (const position of openPositions) {
          try {
            await closeDemoPosition({
              tenantId,
              positionId: position.id,
              reason: 'liquidation - Cross margin: account equity below total maintenance margin',
            });
          } catch (error) {
            logger.error({ error, positionId: position.id }, 'Erro ao liquidar posição cross margin');
          }
        }
        continue; // Pular verificação de SL/TP se liquidou tudo
      }

      // ✅ Verificar SL/TP individualmente (apenas se NÃO liquidado)
      for (const position of openPositions) {
        try {
          const currentPrice = await getCurrentPrice(position.symbol, position.marketType as DemoMarketType);
          const stopLoss = position.stopLoss ? Number(position.stopLoss) : null;
          const takeProfit = position.takeProfit ? Number(position.takeProfit) : null;

          let shouldClose = false;
          let reason = '';

          if (stopLoss !== null) {
            if (position.side === 'long' && currentPrice <= stopLoss) {
              shouldClose = true;
              reason = 'stop_loss';
            } else if (position.side === 'short' && currentPrice >= stopLoss) {
              shouldClose = true;
              reason = 'stop_loss';
            }
          }

          if (!shouldClose && takeProfit !== null) {
            if (position.side === 'long' && currentPrice >= takeProfit) {
              shouldClose = true;
              reason = 'take_profit';
            } else if (position.side === 'short' && currentPrice <= takeProfit) {
              shouldClose = true;
              reason = 'take_profit';
            }
          }

          if (shouldClose) {
            await closeDemoPosition({
              tenantId,
              positionId: position.id,
              reason,
            });
          }
        } catch (error) {
          logger.warn({ error, positionId: position.id, symbol: position.symbol }, 'Erro ao verificar SL/TP de posição demo');
        }
      }
    } catch (error) {
      logger.error({ error, tenantId }, 'Erro ao processar cross margin do tenant');
    }
  }

  // ✅ Processar ordens limit/stop pendentes (lógica inalterada)
  const openOrders = await db
    .select()
    .from(schema.demoOrders)
    .where(eq(schema.demoOrders.status, 'open'));

  for (const order of openOrders) {
    try {
      const currentPrice = await getCurrentPrice(order.symbol, order.marketType as DemoMarketType);
      const targetPrice = Number(order.price);

      let shouldFill = false;

      if (order.orderType === 'limit') {
        if (order.side === 'buy' && currentPrice <= targetPrice) shouldFill = true;
        if (order.side === 'sell' && currentPrice >= targetPrice) shouldFill = true;
      } else if (order.orderType === 'stop') {
        if (order.side === 'buy' && currentPrice >= targetPrice) shouldFill = true;
        if (order.side === 'sell' && currentPrice <= targetPrice) shouldFill = true;
      }

      if (shouldFill) {
        const futuresContext = order.marketType === 'futures'
          ? await getFuturesPricingContext(order.symbol)
          : null;
        const contractMultiplier = futuresContext?.contractMultiplier ?? 1;
        const fillPrice = applySlippage(targetPrice, order.side as DemoOrderSide);
        const fee = calculateFee(Number(order.size), fillPrice, order.marketType === 'futures' ? contractMultiplier : 1);

        // Atualizar ordem — OBRIGATÓRIO filtrar por status='open' para evitar race condition
        // com cancelDemoOrder (TOCTOU: entre o SELECT e este UPDATE, o usuário pode cancelar).
        // Se 0 linhas afetadas, a ordem foi cancelada e o balance já foi restaurado — pular.
        const fillResult = await db
          .update(schema.demoOrders)
          .set({
            status: 'filled',
            avgFilledPrice: String(fillPrice),
            filledSize: order.size,
            fees: String(fee),
            filledAt: new Date(),
          })
          .where(and(
            eq(schema.demoOrders.id, order.id),
            eq(schema.demoOrders.status, 'open'),
          ))
          .returning({ id: schema.demoOrders.id });

        if (fillResult.length === 0) {
          logger.info({ orderId: order.id }, 'Ordem já cancelada entre SELECT e fill — pulando');
          continue;
        }

        if (order.marketType !== 'futures') {
          const pair = resolveAssetPair(order.symbol);
          const quoteBalance = await getOrCreateBalance(order.tenantId, pair.quoteCurrency);
          const baseBalance = await getOrCreateBalance(order.tenantId, pair.baseCurrency);
          const estFee = calculateFee(Number(order.size), targetPrice);
          const estNotional = Number(order.size) * targetPrice;
          const realNotional = Number(order.size) * fillPrice;

          if (order.side === 'buy') {
            const estimatedFrozen = estNotional + estFee;
            const realCost = realNotional + fee;
            const availableDelta = estimatedFrozen - realCost;

            if (availableDelta < 0) {
              const needed = Math.abs(availableDelta);
              const [quoteAdjusted] = await db
                .update(schema.demoBalances)
                .set({
                  available: sql`${schema.demoBalances.available}::numeric + ${String(availableDelta)}::numeric`,
                  frozen: sql`GREATEST(0, ${schema.demoBalances.frozen}::numeric - ${String(estimatedFrozen)}::numeric)`,
                  updatedAt: new Date(),
                })
                .where(and(
                  eq(schema.demoBalances.id, quoteBalance.id),
                  sql`${schema.demoBalances.available}::numeric >= ${String(needed)}::numeric`,
                ))
                .returning({ id: schema.demoBalances.id });

              if (!quoteAdjusted) {
                await db
                  .update(schema.demoOrders)
                  .set({ status: 'cancelled' })
                  .where(and(eq(schema.demoOrders.id, order.id), eq(schema.demoOrders.status, 'filled')));

                await db
                  .update(schema.demoBalances)
                  .set({
                    available: sql`${schema.demoBalances.available}::numeric + ${String(estimatedFrozen)}::numeric`,
                    frozen: sql`GREATEST(0, ${schema.demoBalances.frozen}::numeric - ${String(estimatedFrozen)}::numeric)`,
                    updatedAt: new Date(),
                  })
                  .where(eq(schema.demoBalances.id, quoteBalance.id));
                logger.warn({ orderId: order.id }, 'Ordem spot/margin cancelada por saldo insuficiente no ajuste de fill');
                continue;
              }
            } else {
              await db
                .update(schema.demoBalances)
                .set({
                  available: sql`${schema.demoBalances.available}::numeric + ${String(availableDelta)}::numeric`,
                  frozen: sql`GREATEST(0, ${schema.demoBalances.frozen}::numeric - ${String(estimatedFrozen)}::numeric)`,
                  updatedAt: new Date(),
                })
                .where(eq(schema.demoBalances.id, quoteBalance.id));
            }

            await db
              .update(schema.demoBalances)
              .set({
                available: sql`${schema.demoBalances.available}::numeric + ${String(order.size)}::numeric`,
                updatedAt: new Date(),
              })
              .where(eq(schema.demoBalances.id, baseBalance.id));
          } else {
            await db
              .update(schema.demoBalances)
              .set({
                frozen: sql`GREATEST(0, ${schema.demoBalances.frozen}::numeric - ${String(order.size)}::numeric)`,
                updatedAt: new Date(),
              })
              .where(eq(schema.demoBalances.id, baseBalance.id));

            const quoteCredit = Math.max(0, realNotional - fee);
            await db
              .update(schema.demoBalances)
              .set({
                available: sql`${schema.demoBalances.available}::numeric + ${String(quoteCredit)}::numeric`,
                updatedAt: new Date(),
              })
              .where(eq(schema.demoBalances.id, quoteBalance.id));
          }

          logger.info({
            orderId: order.id,
            symbol: order.symbol,
            side: order.side,
            fillPrice,
            marketType: order.marketType,
          }, 'Ordem demo spot/margin preenchida pelo scheduler');
          continue;
        }

        // Criar posição
        const positionSide = order.side === 'buy' ? 'long' : 'short';
        const leverage = order.leverage ?? 1;
        const requiredMargin = calculateFuturesNotional(Number(order.size), fillPrice, contractMultiplier) / leverage;
        const liquidationPrice = calculateLiquidationPrice({
          entryPrice: fillPrice,
          side: order.side as DemoOrderSide,
          positionSize: Number(order.size),
          contractMultiplier,
          positionMargin: requiredMargin,
          maintenanceMarginRate: futuresContext?.maintenanceMarginRate ?? DEFAULT_MAINTENANCE_MARGIN_RATE,
          liquidationFeeRate: futuresContext?.liquidationFeeRate ?? DEFAULT_LIQUIDATION_FEE_RATE,
        });

        // Atualizar balance: margem + fee estimado foram congelados na criação (createDemoOrder).
        // Agora substituir estimativas pelo custo real (margem real fica frozen, fee real é debitado).
        // UPDATE atômico: aritmética SQL evita race condition em read-modify-write concorrente.
        const orderBalance = await getOrCreateBalance(order.tenantId);
        const estMargin = calculateFuturesNotional(Number(order.size), targetPrice, contractMultiplier) / leverage;
        const estFee = calculateFee(Number(order.size), targetPrice, contractMultiplier);
        const totalEstimated = estMargin + estFee;
        const totalReal = requiredMargin + fee;
        // adjustment = custo real - custo estimado (positivo = precisa mais de available)
        const adjustment = totalReal - totalEstimated;

        if (adjustment > 0) {
          // Custo real > estimado: precisa debitar mais do available.
          // UPDATE atômico com WHERE available >= adjustment para verificar + debitar numa operação.
          const [adjustResult] = await db
            .update(schema.demoBalances)
            .set({
              available: sql`${schema.demoBalances.available}::numeric - ${String(adjustment)}::numeric`,
              frozen: sql`GREATEST(0, ${schema.demoBalances.frozen}::numeric - ${String(totalEstimated)}::numeric + ${String(requiredMargin)}::numeric)`,
              updatedAt: new Date(),
            })
            .where(and(
              eq(schema.demoBalances.id, orderBalance.id),
              sql`${schema.demoBalances.available}::numeric >= ${String(adjustment)}::numeric`,
            ))
            .returning({ id: schema.demoBalances.id });

          if (!adjustResult) {
            // Saldo insuficiente para fill: reverter ordem para cancelled e devolver tudo que foi congelado.
            // IMPORTANTE: a ordem já foi atualizada para 'filled' na linha 838-851 acima,
            // portanto o WHERE deve usar status='filled' (não 'open') para fazer match.
            logger.warn({
              orderId: order.id,
              adjustment: adjustment.toFixed(4),
            }, 'Saldo insuficiente para fill de ordem pendente - revertendo para cancelled');

            const cancelResult = await db
              .update(schema.demoOrders)
              .set({ status: 'cancelled' })
              .where(and(
                eq(schema.demoOrders.id, order.id),
                eq(schema.demoOrders.status, 'filled'),
              ))
              .returning({ id: schema.demoOrders.id });

            if (cancelResult.length === 0) {
              // Situação anômala: ordem não estava nem 'open' nem 'filled'. Log para investigação.
              logger.error({ orderId: order.id }, 'Falha ao reverter ordem filled→cancelled por saldo insuficiente — ordem em estado inconsistente');
              continue;
            }

            // Devolver tudo que foi congelado (margem + fee estimado) — aritmética SQL atômica
            await db
              .update(schema.demoBalances)
              .set({
                available: sql`${schema.demoBalances.available}::numeric + ${String(totalEstimated)}::numeric`,
                frozen: sql`GREATEST(0, ${schema.demoBalances.frozen}::numeric - ${String(totalEstimated)}::numeric)`,
                updatedAt: new Date(),
              })
              .where(eq(schema.demoBalances.id, orderBalance.id));
            continue;
          }
        } else {
          // Custo real <= estimado: available recebe crédito (adjustment negativo ou zero).
          // Sempre bem-sucedido (não precisa de check), mas usa aritmética SQL atômica igualmente.
          await db
            .update(schema.demoBalances)
            .set({
              available: sql`${schema.demoBalances.available}::numeric - ${String(adjustment)}::numeric`,
              frozen: sql`GREATEST(0, ${schema.demoBalances.frozen}::numeric - ${String(totalEstimated)}::numeric + ${String(requiredMargin)}::numeric)`,
              updatedAt: new Date(),
            })
            .where(eq(schema.demoBalances.id, orderBalance.id));
        }

        // Obter stopLoss/takeProfit de metadata da ordem
        const orderMeta = (order.metadata ?? {}) as Record<string, unknown>;
        const rawStopLoss = Number(orderMeta.stopLoss ?? NaN);
        const rawTakeProfit = Number(orderMeta.takeProfit ?? NaN);
        const validatedProtectiveLevels = validateProtectiveLevels({
          side: order.side as DemoOrderSide,
          entryPrice: fillPrice,
          stopLoss: Number.isFinite(rawStopLoss) ? rawStopLoss : null,
          takeProfit: Number.isFinite(rawTakeProfit) ? rawTakeProfit : null,
          context: 'scheduler_fill',
        });

        const [existingPosition] = await db
          .select()
          .from(schema.demoPositions)
          .where(and(
            eq(schema.demoPositions.tenantId, order.tenantId),
            eq(schema.demoPositions.symbol, order.symbol),
            eq(schema.demoPositions.marketType, 'futures'),
            eq(schema.demoPositions.side, positionSide),
            eq(schema.demoPositions.status, 'open'),
          ))
          .orderBy(desc(schema.demoPositions.openedAt))
          .limit(1);

        let position: typeof schema.demoPositions.$inferSelect;
        if (existingPosition) {
          const currentSize = Number(existingPosition.size);
          const filledSize = Number(order.size ?? '0');
          const nextSize = currentSize + filledSize;
          const weightedEntry = ((Number(existingPosition.entryPrice) * currentSize) + (fillPrice * filledSize)) / nextSize;
          const currentMargin = Number(existingPosition.marginAmount ?? '0');
          const nextMargin = currentMargin + requiredMargin;
          const currentFees = Number(existingPosition.totalFees ?? '0');
          const nextFees = currentFees + fee;
          const nextStopLoss = validatedProtectiveLevels.stopLoss ?? (existingPosition.stopLoss ? Number(existingPosition.stopLoss) : null);
          const nextTakeProfit = validatedProtectiveLevels.takeProfit ?? (existingPosition.takeProfit ? Number(existingPosition.takeProfit) : null);
          const validatedRisk = validateProtectiveLevels({
            side: order.side as DemoOrderSide,
            entryPrice: weightedEntry,
            stopLoss: nextStopLoss,
            takeProfit: nextTakeProfit,
            context: 'position_update',
          });
          const nextLiquidation = calculateLiquidationPrice({
            entryPrice: weightedEntry,
            side: order.side as DemoOrderSide,
            positionSize: nextSize,
            contractMultiplier,
            positionMargin: nextMargin,
            maintenanceMarginRate: futuresContext?.maintenanceMarginRate ?? DEFAULT_MAINTENANCE_MARGIN_RATE,
            liquidationFeeRate: futuresContext?.liquidationFeeRate ?? DEFAULT_LIQUIDATION_FEE_RATE,
          });
          const [updatedPosition] = await db
            .update(schema.demoPositions)
            .set({
              size: String(nextSize),
              entryPrice: String(weightedEntry),
              marginAmount: String(nextMargin),
              totalFees: String(nextFees),
              stopLoss: validatedRisk.stopLoss !== null ? String(validatedRisk.stopLoss) : null,
              takeProfit: validatedRisk.takeProfit !== null ? String(validatedRisk.takeProfit) : null,
              liquidationPrice: nextLiquidation > 0 ? String(nextLiquidation) : null,
              metadata: {
                ...((existingPosition.metadata ?? {}) as Record<string, unknown>),
                lastOrderId: order.id,
                contractMultiplier,
                maintenanceMarginRate: futuresContext?.maintenanceMarginRate ?? DEFAULT_MAINTENANCE_MARGIN_RATE,
                liquidationFeeRate: futuresContext?.liquidationFeeRate ?? DEFAULT_LIQUIDATION_FEE_RATE,
              },
            })
            .where(eq(schema.demoPositions.id, existingPosition.id))
            .returning();
          position = updatedPosition ?? existingPosition;
        } else {
          const [createdPosition] = await db
            .insert(schema.demoPositions)
            .values({
              tenantId: order.tenantId,
              symbol: order.symbol,
              marketType: order.marketType,
              side: positionSide,
              entryPrice: String(fillPrice),
              size: order.size ?? '0',
              leverage,
              stopLoss: validatedProtectiveLevels.stopLoss !== null ? String(validatedProtectiveLevels.stopLoss) : null,
              takeProfit: validatedProtectiveLevels.takeProfit !== null ? String(validatedProtectiveLevels.takeProfit) : null,
              liquidationPrice: liquidationPrice > 0 ? String(liquidationPrice) : null,
              marginAmount: String(requiredMargin),
              totalFees: String(fee),
              status: 'open',
              metadata: {
                orderId: order.id,
                contractMultiplier,
                maintenanceMarginRate: futuresContext?.maintenanceMarginRate ?? DEFAULT_MAINTENANCE_MARGIN_RATE,
                liquidationFeeRate: futuresContext?.liquidationFeeRate ?? DEFAULT_LIQUIDATION_FEE_RATE,
              },
            })
            .returning();
          position = createdPosition;
        }

        // Associar posição à ordem via metadata
        await db
          .update(schema.demoOrders)
          .set({ metadata: { ...orderMeta, positionId: position.id } })
          .where(eq(schema.demoOrders.id, order.id));

        if (!existingPosition) {
          // Capturar snapshot somente na criação da posição
          try {
            const entrySnapshot = await captureEntrySnapshot({
              tenantId: order.tenantId,
              symbol: order.symbol,
              marketType: order.marketType as 'spot' | 'futures' | 'margin',
              positionId: position.id,
            });
            await db
              .update(schema.demoPositions)
              .set({ entrySnapshotId: entrySnapshot.id })
              .where(eq(schema.demoPositions.id, position.id));
            logger.info({ positionId: position.id, entrySnapshotId: entrySnapshot.id }, 'Entry snapshot capturado e vinculado à posição demo (scheduled fill)');
          } catch (snapshotError) {
            logger.warn({ error: snapshotError, positionId: position.id }, 'Falha ao capturar snapshot de entrada (scheduled fill)');
          }
        }

        logger.info({
          orderId: order.id,
          positionId: position.id,
          symbol: order.symbol,
          side: positionSide,
          fillPrice,
        }, 'Ordem demo pendente preenchida pelo scheduler');
      }
    } catch (error) {
      logger.warn({ error, orderId: order.id, symbol: order.symbol }, 'Erro ao processar ordem demo pendente');
    }
  }
}

// ============================================================================
// Scheduler
// ============================================================================

let schedulerTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Inicia o scheduler de ordens/posições demo
 */
export function startDemoScheduler(intervalMs = 5_000): void {
  if (schedulerTimer) {
    logger.warn('Demo scheduler já está rodando');
    return;
  }

  schedulerTimer = setInterval(() => {
    void processOpenOrdersAndPositions();
  }, intervalMs);

  logger.info({ intervalMs }, 'Demo trading scheduler iniciado');
}

/**
 * Para o scheduler
 */
export function stopDemoScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
  logger.info('Demo trading scheduler parado');
}
