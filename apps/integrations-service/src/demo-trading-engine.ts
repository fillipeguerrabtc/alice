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

/** Fator de manutenção margin para liquidação (5%) */
const MAINTENANCE_MARGIN_RATE = 0.05;

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
function calculateFee(size: number, price: number): number {
  return (size * price * SIMULATED_FEE_BPS) / 10_000;
}

/**
 * Calcula preço de liquidação para futures
 */
function calculateLiquidationPrice(params: {
  entryPrice: number;
  side: DemoOrderSide;
  leverage: number;
}): number {
  const { entryPrice, side, leverage } = params;
  if (leverage <= 1) return 0; // Sem liquidação para spot/leverage 1

  if (side === 'buy') {
    // Long: preço cai até margem de manutenção
    return entryPrice * (1 - (1 / leverage) + MAINTENANCE_MARGIN_RATE);
  }
  // Short: preço sobe até margem de manutenção
  return entryPrice * (1 + (1 / leverage) - MAINTENANCE_MARGIN_RATE);
}

/**
 * Busca preço atual do mercado KuCoin
 */
async function getCurrentPrice(symbol: string): Promise<number> {
  try {
    const ticker = await kucoinClient.getTicker(symbol);
    const price = Number(ticker.price);
    if (isNaN(price) || price <= 0) {
      throw new Error(`Preço inválido para ${symbol}: ${ticker.price}`);
    }
    return price;
  } catch (error) {
    logger.error({ error, symbol }, 'Falha ao buscar preço atual');
    throw error;
  }
}

/**
 * Cria e executa uma ordem demo
 */
export async function createDemoOrder(params: CreateDemoOrderParams): Promise<DemoOrderResult> {
  const db = getDatabase();

  // Validação defensiva: size DEVE ser positivo (defesa em profundidade - endpoint já valida)
  if (!Number.isFinite(params.size) || params.size <= 0) {
    throw new Error(`size inválido: ${params.size}. Deve ser um número positivo.`);
  }

  // Sanitizar leverage: NaN, null, undefined, 0 ou negativo → default 1
  const rawLeverage = params.leverage ?? 1;
  const leverage = Number.isFinite(rawLeverage) && rawLeverage >= 1 ? rawLeverage : 1;

  // Buscar/criar balance (garante que a linha exista para o UPDATE atômico abaixo)
  const balance = await getOrCreateBalance(params.tenantId);

  // Buscar preço atual
  const marketPrice = await getCurrentPrice(params.symbol);

  let fillPrice: number;
  let orderStatus: DemoOrderStatus;

  if (params.orderType === 'market') {
    // Market order: execução imediata com slippage
    fillPrice = applySlippage(marketPrice, params.side);
    orderStatus = 'filled';
  } else if (params.orderType === 'limit') {
    // Limit order: só executa se preço favorável
    if (!params.price) throw new Error('Preço obrigatório para ordem limit');
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
    if (!params.price) throw new Error('Preço obrigatório para ordem stop');
    fillPrice = params.price;
    orderStatus = 'open';
  }

  // Calcular custos
  const fee = orderStatus === 'filled' ? calculateFee(params.size, fillPrice) : 0;
  const notionalValue = params.size * fillPrice;
  const requiredMargin = notionalValue / leverage;

  // Verificar balance E debitar atomicamente numa única operação SQL.
  // Evita race condition onde duas requests concorrentes leem o mesmo saldo,
  // ambas passam a verificação, e o last-write-wins perde uma dedução.
  const estimatedFee = orderStatus === 'filled' ? fee : calculateFee(params.size, fillPrice);

  if (orderStatus === 'open') {
    // Ordem pendente: congelar margem + fee estimado imediatamente
    const totalToFreeze = requiredMargin + estimatedFee;
    const [balanceUpdated] = await db
      .update(schema.demoBalances)
      .set({
        available: sql`${schema.demoBalances.available}::numeric - ${String(totalToFreeze)}::numeric`,
        frozen: sql`${schema.demoBalances.frozen}::numeric + ${String(totalToFreeze)}::numeric`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(schema.demoBalances.id, balance.id),
        sql`${schema.demoBalances.available}::numeric >= ${String(totalToFreeze)}::numeric`,
      ))
      .returning({ id: schema.demoBalances.id });

    if (!balanceUpdated) {
      throw new Error(
        `Saldo insuficiente. Requerido: ${totalToFreeze.toFixed(2)} USDT (margem + fee estimado)`
      );
    }
  } else {
    // Ordem filled: debitar margem + fee do available, congelar margem como garantia da posição
    const totalRequired = requiredMargin + fee;
    const [balanceUpdated] = await db
      .update(schema.demoBalances)
      .set({
        available: sql`${schema.demoBalances.available}::numeric - ${String(totalRequired)}::numeric`,
        frozen: sql`${schema.demoBalances.frozen}::numeric + ${String(requiredMargin)}::numeric`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(schema.demoBalances.id, balance.id),
        sql`${schema.demoBalances.available}::numeric >= ${String(totalRequired)}::numeric`,
      ))
      .returning({ id: schema.demoBalances.id });

    if (!balanceUpdated) {
      throw new Error(
        `Saldo insuficiente. Requerido: ${totalRequired.toFixed(2)} USDT (margem + fee)`
      );
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
        stopLoss: params.stopLoss ?? null,
        takeProfit: params.takeProfit ?? null,
      },
    })
    .returning();

  let positionId: string | undefined;

  // Se ordem foi preenchida, criar/atualizar posição
  // NOTA: balance já foi debitado atomicamente acima (available -= margin+fee, frozen += margin)
  if (orderStatus === 'filled') {
    // Criar posição
    const positionSide = params.side === 'buy' ? 'long' : 'short';
    const liquidationPrice = calculateLiquidationPrice({
      entryPrice: fillPrice,
      side: params.side,
      leverage,
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
        stopLoss: params.stopLoss ? String(params.stopLoss) : null,
        takeProfit: params.takeProfit ? String(params.takeProfit) : null,
        liquidationPrice: liquidationPrice > 0 ? String(liquidationPrice) : null,
        marginAmount: String(requiredMargin),
        // Persistir entry fee na posição — acumulado com exit fee no close para totalFees correto
        totalFees: String(fee),
        status: 'open',
        metadata: { orderId: order.id },
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
      // Persistir entrySnapshotId na posição para que o post-mortem e dataset generator possam usar
      await db
        .update(schema.demoPositions)
        .set({ entrySnapshotId: entrySnapshot.id })
        .where(eq(schema.demoPositions.id, position.id));
      logger.info({ positionId: position.id, entrySnapshotId: entrySnapshot.id }, 'Entry snapshot capturado e vinculado à posição demo');
    } catch (snapshotError) {
      logger.warn({ error: snapshotError, positionId: position.id }, 'Falha ao capturar snapshot de entrada (não bloqueante)');
    }

    // Associar posição à ordem via metadata
    await db
      .update(schema.demoOrders)
      .set({ metadata: { ...((order.metadata ?? {}) as Record<string, unknown>), positionId: position.id } })
      .where(eq(schema.demoOrders.id, order.id));

    logger.info({
      orderId: order.id,
      positionId: position.id,
      symbol: params.symbol,
      side: positionSide,
      fillPrice,
      size: params.size,
      leverage,
      fee,
    }, 'Ordem demo executada e posição aberta');

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
}): Promise<{
  realizedPnl: number;
  fee: number;
  exitPrice: number;
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
    throw new Error('Posição não encontrada ou já fechada');
  }

  // Buscar preço atual
  const currentPrice = await getCurrentPrice(position.symbol);
  const exitPrice = applySlippage(currentPrice, position.side === 'long' ? 'sell' : 'buy');
  const fee = calculateFee(Number(position.size), exitPrice);

  // Calcular PnL
  const entryPrice = Number(position.entryPrice);
  const size = Number(position.size);
  const leverage = position.leverage ?? 1;

  // PnL = diferença de preço × tamanho da posição - fees
  // Leverage afeta apenas margem necessária, NÃO amplifica PnL real
  let realizedPnl: number;
  if (position.side === 'long') {
    realizedPnl = (exitPrice - entryPrice) * size - fee;
  } else {
    realizedPnl = (entryPrice - exitPrice) * size - fee;
  }

  const closedAt = new Date();

  // Atualizar posição
  await db
    .update(schema.demoPositions)
    .set({
      exitPrice: String(exitPrice),
      realizedPnl: String(realizedPnl),
      totalFees: String(fee + Number(position.totalFees ?? '0')),
      status: params.reason === 'liquidation' ? 'liquidated' : 'closed',
      closedAt,
    })
    .where(eq(schema.demoPositions.id, position.id));

  // Devolver margem + PnL ao balance
  // UPDATE atômico: aritmética SQL evita race condition em read-modify-write concorrente
  const margin = Number(position.marginAmount ?? '0');
  const creditAmount = margin + realizedPnl; // margem devolvida + PnL (pode ser negativo)

  await db
    .update(schema.demoBalances)
    .set({
      available: sql`${schema.demoBalances.available}::numeric + ${String(creditAmount)}::numeric`,
      frozen: sql`GREATEST(0, ${schema.demoBalances.frozen}::numeric - ${String(margin)}::numeric)`,
      updatedAt: new Date(),
    })
    .where(and(
      eq(schema.demoBalances.tenantId, params.tenantId),
      eq(schema.demoBalances.currency, 'USDT'),
    ));

  // Registrar no histórico de fundos
  await db.insert(schema.demoFundHistory).values({
    tenantId: params.tenantId,
    amount: String(Math.abs(realizedPnl)),
    currency: 'USDT',
    reason: `${realizedPnl >= 0 ? 'pnl_credit' : 'pnl_debit'} - PnL de ${position.symbol} ${position.side}: ${realizedPnl.toFixed(2)} USDT`,
  });

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
      size,
      leverage,
      stopLoss: position.stopLoss ? Number(position.stopLoss) : undefined,
      takeProfit: position.takeProfit ? Number(position.takeProfit) : undefined,
      realizedPnl,
      // Usar total acumulado (entry fee + exit fee), não apenas exit fee
      totalFees: fee + Number(position.totalFees ?? '0'),
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
    realizedPnl: realizedPnl.toFixed(2),
    fee: fee.toFixed(4),
    reason: params.reason ?? 'manual',
  }, 'Posição demo fechada');

  demoPositionsClosedTotal.inc({
    market_type: position.marketType,
    profit: realizedPnl > 0 ? 'true' : 'false',
  });

  return { realizedPnl, fee, exitPrice };
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

  // Devolver margem + fee estimado congelados ao saldo disponível
  // UPDATE atômico: aritmética SQL evita race condition em read-modify-write concorrente
  const leverage = order.leverage ?? 1;
  const frozenMargin = Number(order.size) * Number(order.price) / leverage;
  const frozenFee = calculateFee(Number(order.size), Number(order.price));
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

  // Buscar todas as posições abertas
  const openPositions = await db
    .select()
    .from(schema.demoPositions)
    .where(eq(schema.demoPositions.status, 'open'));

  for (const position of openPositions) {
    try {
      const currentPrice = await getCurrentPrice(position.symbol);

      // Verificar Stop Loss
      if (position.stopLoss) {
        const sl = Number(position.stopLoss);
        if (
          (position.side === 'long' && currentPrice <= sl) ||
          (position.side === 'short' && currentPrice >= sl)
        ) {
          await closeDemoPosition({
            tenantId: position.tenantId,
            positionId: position.id,
            reason: 'stop_loss',
          });
          continue;
        }
      }

      // Verificar Take Profit
      if (position.takeProfit) {
        const tp = Number(position.takeProfit);
        if (
          (position.side === 'long' && currentPrice >= tp) ||
          (position.side === 'short' && currentPrice <= tp)
        ) {
          await closeDemoPosition({
            tenantId: position.tenantId,
            positionId: position.id,
            reason: 'take_profit',
          });
          continue;
        }
      }

      // Verificar Liquidação (futures)
      if (position.liquidationPrice && position.marketType === 'futures') {
        const liq = Number(position.liquidationPrice);
        if (
          (position.side === 'long' && currentPrice <= liq) ||
          (position.side === 'short' && currentPrice >= liq)
        ) {
          await closeDemoPosition({
            tenantId: position.tenantId,
            positionId: position.id,
            reason: 'liquidation',
          });
          continue;
        }
      }
    } catch (error) {
      logger.warn({ error, positionId: position.id, symbol: position.symbol }, 'Erro ao verificar posição demo');
    }
  }

  // Buscar ordens limit/stop pendentes
  const openOrders = await db
    .select()
    .from(schema.demoOrders)
    .where(eq(schema.demoOrders.status, 'open'));

  for (const order of openOrders) {
    try {
      const currentPrice = await getCurrentPrice(order.symbol);
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
        const fillPrice = applySlippage(targetPrice, order.side as DemoOrderSide);
        const fee = calculateFee(Number(order.size), fillPrice);

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

        // Criar posição
        const positionSide = order.side === 'buy' ? 'long' : 'short';
        const leverage = order.leverage ?? 1;
        const requiredMargin = Number(order.size) * fillPrice / leverage;
        const liquidationPrice = calculateLiquidationPrice({
          entryPrice: fillPrice,
          side: order.side as DemoOrderSide,
          leverage,
        });

        // Atualizar balance: margem + fee estimado foram congelados na criação (createDemoOrder).
        // Agora substituir estimativas pelo custo real (margem real fica frozen, fee real é debitado).
        // UPDATE atômico: aritmética SQL evita race condition em read-modify-write concorrente.
        const orderBalance = await getOrCreateBalance(order.tenantId);
        const estMargin = Number(order.size) * targetPrice / leverage;
        const estFee = calculateFee(Number(order.size), targetPrice);
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
        const orderStopLoss = orderMeta.stopLoss as number | null ?? null;
        const orderTakeProfit = orderMeta.takeProfit as number | null ?? null;

        const [position] = await db
          .insert(schema.demoPositions)
          .values({
            tenantId: order.tenantId,
            symbol: order.symbol,
            marketType: order.marketType,
            side: positionSide,
            entryPrice: String(fillPrice),
            size: order.size ?? '0',
            leverage,
            stopLoss: orderStopLoss ? String(orderStopLoss) : null,
            takeProfit: orderTakeProfit ? String(orderTakeProfit) : null,
            liquidationPrice: liquidationPrice > 0 ? String(liquidationPrice) : null,
            marginAmount: String(requiredMargin),
            // Persistir entry fee na posição — acumulado com exit fee no close para totalFees correto
            totalFees: String(fee),
            status: 'open',
            metadata: { orderId: order.id },
          })
          .returning();

        // Associar posição à ordem via metadata
        await db
          .update(schema.demoOrders)
          .set({ metadata: { ...orderMeta, positionId: position.id } })
          .where(eq(schema.demoOrders.id, order.id));

        // Capturar snapshot de entrada e armazenar ID na posição para uso no post-mortem
        try {
          const entrySnapshot = await captureEntrySnapshot({
            tenantId: order.tenantId,
            symbol: order.symbol,
            marketType: order.marketType as 'spot' | 'futures' | 'margin',
            positionId: position.id,
          });
          // Persistir entrySnapshotId na posição para que o post-mortem e dataset generator possam usar
          await db
            .update(schema.demoPositions)
            .set({ entrySnapshotId: entrySnapshot.id })
            .where(eq(schema.demoPositions.id, position.id));
          logger.info({ positionId: position.id, entrySnapshotId: entrySnapshot.id }, 'Entry snapshot capturado e vinculado à posição demo (scheduled fill)');
        } catch (snapshotError) {
          logger.warn({ error: snapshotError, positionId: position.id }, 'Falha ao capturar snapshot de entrada (scheduled fill)');
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
