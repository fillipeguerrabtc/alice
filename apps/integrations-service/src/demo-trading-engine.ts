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
import { eq, and, desc } from '@alice/database';
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

  const balance = await getOrCreateBalance(params.tenantId, currency);
  const newAvailable = Number(balance.available) + params.amount;

  await db
    .update(schema.demoBalances)
    .set({
      available: String(newAvailable),
      updatedAt: new Date(),
    })
    .where(eq(schema.demoBalances.id, balance.id));

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
  const leverage = params.leverage ?? 1;

  // Buscar/criar balance
  const balance = await getOrCreateBalance(params.tenantId);
  const availableBalance = Number(balance.available);

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

  // Verificar balance suficiente (margem + fee se aplica a AMBOS buy e sell)
  if (orderStatus === 'filled') {
    if (requiredMargin + fee > availableBalance) {
      throw new Error(
        `Saldo insuficiente. Requerido: ${(requiredMargin + fee).toFixed(2)} USDT, Disponível: ${availableBalance.toFixed(2)} USDT`
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
  if (orderStatus === 'filled') {
    // Atualizar balance (debitar margem + fee para AMBOS buy e sell)
    const newAvailable = availableBalance - requiredMargin - fee;
    const currentFrozen = Number(balance.frozen);
    await db
      .update(schema.demoBalances)
      .set({
        available: String(newAvailable),
        frozen: String(currentFrozen + requiredMargin),
        updatedAt: new Date(),
      })
      .where(eq(schema.demoBalances.id, balance.id));

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
        status: 'open',
        metadata: { orderId: order.id },
      })
      .returning();

    positionId = position.id;

    // Capturar snapshot de entrada
    try {
      await captureEntrySnapshot({
        tenantId: params.tenantId,
        symbol: params.symbol,
        marketType: params.marketType,
        positionId: position.id,
      });
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

  let realizedPnl: number;
  if (position.side === 'long') {
    realizedPnl = (exitPrice - entryPrice) * size * leverage - fee;
  } else {
    realizedPnl = (entryPrice - exitPrice) * size * leverage - fee;
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
  const balance = await getOrCreateBalance(params.tenantId);
  const currentAvailable = Number(balance.available);
  const currentFrozen = Number(balance.frozen);
  const margin = Number(position.marginAmount ?? '0');

  const newAvailable = currentAvailable + margin + realizedPnl;
  const newFrozen = Math.max(0, currentFrozen - margin);

  await db
    .update(schema.demoBalances)
    .set({
      available: String(newAvailable),
      frozen: String(newFrozen),
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
      totalFees: fee,
      openedAt: position.openedAt,
      closedAt,
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
 * Cancela uma ordem demo pendente
 */
export async function cancelDemoOrder(tenantId: string, orderId: string): Promise<boolean> {
  const db = getDatabase();
  
  const result = await db
    .update(schema.demoOrders)
    .set({ status: 'cancelled' })
    .where(and(
      eq(schema.demoOrders.id, orderId),
      eq(schema.demoOrders.tenantId, tenantId),
      eq(schema.demoOrders.status, 'open'),
    ))
    .returning();

  return result.length > 0;
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

        // Atualizar ordem
        await db
          .update(schema.demoOrders)
          .set({
            status: 'filled',
            avgFilledPrice: String(fillPrice),
            filledSize: order.size,
            fees: String(fee),
            filledAt: new Date(),
          })
          .where(eq(schema.demoOrders.id, order.id));

        // Criar posição
        const positionSide = order.side === 'buy' ? 'long' : 'short';
        const leverage = order.leverage ?? 1;
        const requiredMargin = Number(order.size) * fillPrice / leverage;
        const liquidationPrice = calculateLiquidationPrice({
          entryPrice: fillPrice,
          side: order.side as DemoOrderSide,
          leverage,
        });

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
            status: 'open',
            metadata: { orderId: order.id },
          })
          .returning();

        // Associar posição à ordem via metadata
        await db
          .update(schema.demoOrders)
          .set({ metadata: { ...orderMeta, positionId: position.id } })
          .where(eq(schema.demoOrders.id, order.id));

        // Capturar snapshot de entrada
        try {
          await captureEntrySnapshot({
            tenantId: order.tenantId,
            symbol: order.symbol,
            marketType: order.marketType as 'spot' | 'futures' | 'margin',
            positionId: position.id,
          });
        } catch (snapshotError) {
          logger.warn({ error: snapshotError }, 'Falha ao capturar snapshot de entrada (scheduled fill)');
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
