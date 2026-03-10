import type { Express, Response } from 'express';
import type { Request } from 'express';
import { createLogger } from '@alice/logger';
import { requirePermission } from '@alice/shared-utils';
import { z } from 'zod';
import * as kucoinClient from '../kucoinClient.js';

interface RegisterTradingFuturesRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  respondKucoinNotConfigured: (res: Response) => void;
  sendKucoinErrorResponse: (res: Response, error: unknown) => boolean;
}

export function registerTradingFuturesRoutes(app: Express, deps: RegisterTradingFuturesRoutesDeps): void {
const logger = deps.logger ?? createLogger('integrations-service');
const { respondKucoinNotConfigured, sendKucoinErrorResponse } = deps;
// --- FUTURES: Ticker, Orders, Positions, Margin Mode, Position Mode, Leverage ---

// GET /api/integrations/trading/futures/ticker/:symbol - Ticker Futures em tempo real
app.get('/api/integrations/trading/futures/ticker/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    if (!symbol) {
      res.status(400).json({ error: 'Símbolo obrigatório' });
      return;
    }
    const ticker = await kucoinClient.getTicker(symbol);
    res.json({ success: true, data: ticker });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter ticker Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/futures/orders/all - Cancelar todas ordens Futures
app.delete('/api/integrations/trading/futures/orders/all', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const symbol = req.query.symbol as string | undefined;
    const result = await kucoinClient.cancelAllOrders(symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar todas ordens Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/orders/open - Ordens abertas Futures
app.get('/api/integrations/trading/futures/orders/open', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const symbol = req.query.symbol as string | undefined;
    const result = await kucoinClient.getOpenOrders(symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter ordens abertas Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/orders/:orderId - Detalhes de ordem Futures por ID
app.get('/api/integrations/trading/futures/orders/:orderId', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const { orderId } = req.params;
    if (!orderId) {
      res.status(400).json({ error: 'orderId obrigatório' });
      return;
    }
    const order = await kucoinClient.getOrder(orderId);
    res.json({ success: true, data: order });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter ordem Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/orders/by-client-oid/:clientOid - Ordem Futures por clientOid
app.get('/api/integrations/trading/futures/orders/by-client-oid/:clientOid', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const { clientOid } = req.params;
    if (!clientOid) {
      res.status(400).json({ error: 'clientOid obrigatório' });
      return;
    }
    const order = await kucoinClient.getOrderByClientOid(clientOid);
    res.json({ success: true, data: order });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter ordem Futures por clientOid');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/positions/:symbol - Posição Futures por símbolo
app.get('/api/integrations/trading/futures/positions/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const { symbol } = req.params;
    if (!symbol) {
      res.status(400).json({ error: 'Símbolo obrigatório' });
      return;
    }
    const position = await kucoinClient.getPosition(symbol);
    res.json({ success: true, data: position });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter posição Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/margin-mode/:symbol - Modo de margem Futures
app.get('/api/integrations/trading/futures/margin-mode/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const { symbol } = req.params;
    if (!symbol) {
      res.status(400).json({ error: 'Símbolo obrigatório' });
      return;
    }
    const result = await kucoinClient.getMarginMode(symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter margin mode Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/futures/margin-mode - Alterar modo de margem Futures
app.post('/api/integrations/trading/futures/margin-mode', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const bodySchema = z.object({
      symbol: z.string().min(1),
      marginMode: z.enum(['ISOLATED', 'CROSS']),
    });
    const bodyResult = bodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Parâmetros inválidos', details: bodyResult.error.flatten() });
      return;
    }
    const { symbol, marginMode } = bodyResult.data;
    const result = await kucoinClient.changeMarginMode(symbol, marginMode);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao alterar margin mode Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/position-mode - Modo de posição Futures
app.get('/api/integrations/trading/futures/position-mode', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const result = await kucoinClient.getPositionMode();
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter position mode Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/futures/position-mode - Alterar modo de posição Futures
app.post('/api/integrations/trading/futures/position-mode', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const bodySchema = z.object({
      positionMode: z.enum(['ONE_WAY', 'HEDGE']),
    });
    const bodyResult = bodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Parâmetros inválidos', details: bodyResult.error.flatten() });
      return;
    }
    const { positionMode } = bodyResult.data;
    const result = await kucoinClient.changePositionMode(positionMode);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao alterar position mode Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/leverage/:symbol - Alavancagem cross Futures
app.get('/api/integrations/trading/futures/leverage/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const { symbol } = req.params;
    if (!symbol) {
      res.status(400).json({ error: 'Símbolo obrigatório' });
      return;
    }
    const result = await kucoinClient.getCrossUserLeverage(symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter alavancagem Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/futures/leverage - Alterar alavancagem cross Futures
app.post('/api/integrations/trading/futures/leverage', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const bodySchema = z.object({
      symbol: z.string().min(1),
      leverage: z.string().min(1),
    });
    const bodyResult = bodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Parâmetros inválidos', details: bodyResult.error.flatten() });
      return;
    }
    const { symbol, leverage } = bodyResult.data;
    const result = await kucoinClient.changeCrossUserLeverage(symbol, leverage);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao alterar alavancagem Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// --- FUTURES: Position History, Isolated Margin, Max Open, Risk Limits (FASE 2) ---

// GET /api/integrations/trading/futures/positions/history - Histórico de posições fechadas
app.get('/api/integrations/trading/futures/positions/history', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const symbol = req.query.symbol as string | undefined;
    const result = await kucoinClient.getPositionsHistory(symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter histórico de posições');
    res.status(500).json({ error: errorMessage });
  }
});

// Alias legado para frontend antigo - mantém compatibilidade sem quebrar histórico de posições
app.get('/api/integrations/trading/positions/history', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const symbol = req.query.symbol as string | undefined;
    const result = await kucoinClient.getPositionsHistory(symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter histórico de posições (alias legado)');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/positions/max-open - Tamanho máximo de abertura
app.get('/api/integrations/trading/futures/positions/max-open', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const querySchema = z.object({
      symbol: z.string().min(1),
      price: z.string().min(1),
      leverage: z.coerce.number().min(1),
    });
    const queryResult = querySchema.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({ error: 'Parâmetros inválidos (symbol, price, leverage obrigatórios)', details: queryResult.error.flatten() });
      return;
    }
    const { symbol, price, leverage } = queryResult.data;
    const result = await kucoinClient.getMaxOpenSize(symbol, price, leverage);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter max open size');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/futures/positions/margin/add - Adicionar margem isolada
app.post('/api/integrations/trading/futures/positions/margin/add', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const bodySchema = z.object({
      symbol: z.string().min(1),
      margin: z.number().positive(),
      bizNo: z.string().min(1),
    });
    const bodyResult = bodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Parâmetros inválidos', details: bodyResult.error.flatten() });
      return;
    }
    const { symbol, margin, bizNo } = bodyResult.data;
    const result = await kucoinClient.addIsolatedMargin(symbol, margin, bizNo);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao adicionar margem isolada');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/futures/positions/margin/remove - Remover margem isolada
app.post('/api/integrations/trading/futures/positions/margin/remove', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const bodySchema = z.object({
      symbol: z.string().min(1),
      withdrawAmount: z.string().min(1),
    });
    const bodyResult = bodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Parâmetros inválidos', details: bodyResult.error.flatten() });
      return;
    }
    const { symbol, withdrawAmount } = bodyResult.data;
    const result = await kucoinClient.removeIsolatedMargin(symbol, withdrawAmount);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao remover margem isolada');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/positions/margin/max-withdraw - Max margem retirável
app.get('/api/integrations/trading/futures/positions/margin/max-withdraw', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const symbol = req.query.symbol as string;
    if (!symbol) {
      res.status(400).json({ error: 'symbol obrigatório' });
      return;
    }
    const result = await kucoinClient.getMaxWithdrawMargin(symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter max withdraw margin');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/futures/margin-mode/batch - Batch alterar margin mode
app.post('/api/integrations/trading/futures/margin-mode/batch', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const bodySchema = z.object({
      symbolModes: z.array(z.object({
        symbol: z.string().min(1),
        marginMode: z.enum(['ISOLATED', 'CROSS']),
      })).min(1),
    });
    const bodyResult = bodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Parâmetros inválidos', details: bodyResult.error.flatten() });
      return;
    }
    const result = await kucoinClient.batchChangeMarginMode(bodyResult.data.symbolModes);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao alterar margin mode em batch');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/risk-limits/:symbol - Risk limits por símbolo
app.get('/api/integrations/trading/futures/risk-limits/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    if (!symbol) {
      res.status(400).json({ error: 'symbol obrigatório' });
      return;
    }
    const marginType = (req.query.marginType as string) || 'cross';
    const result = marginType === 'isolated'
      ? await kucoinClient.getIsolatedMarginRiskLimit(symbol)
      : await kucoinClient.getCrossMarginRiskLimit(symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter risk limits');
    res.status(500).json({ error: errorMessage });
  }
});

// --- FUTURES: Batch Orders, Order Test, Cancel by ClientOid, Cancel All Stop Orders (FASE 1) ---

// POST /api/integrations/trading/futures/orders/batch - Batch de ordens Futures (até 20)
app.post('/api/integrations/trading/futures/orders/batch', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const bodySchema = z.object({
      orders: z.array(z.object({
        clientOid: z.string().min(1),
        symbol: z.string().min(1),
        side: z.enum(['buy', 'sell']),
        type: z.enum(['limit', 'market']),
        leverage: z.string().min(1),
        price: z.string().optional(),
        size: z.number().optional(),
        qty: z.number().optional(),
        valueQty: z.number().optional(),
        timeInForce: z.enum(['GTC', 'IOC', 'FOK', 'RPI']).optional(),
        postOnly: z.boolean().optional(),
        hidden: z.boolean().optional(),
        iceberg: z.boolean().optional(),
        visibleSize: z.string().optional(),
        remark: z.string().optional(),
        stop: z.enum(['down', 'up']).optional(),
        stopPriceType: z.enum(['TP', 'IP', 'MP']).optional(),
        stopPrice: z.string().optional(),
        reduceOnly: z.boolean().optional(),
        closeOrder: z.boolean().optional(),
        forceHold: z.boolean().optional(),
        marginMode: z.enum(['ISOLATED', 'CROSS']).optional(),
        stp: z.enum(['CN', 'CO', 'CB', 'DC']).optional(),
      })).min(1).max(20),
    });
    const bodyResult = bodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Parâmetros inválidos', details: bodyResult.error.flatten() });
      return;
    }
    const ordersWithNumericLeverage = bodyResult.data.orders.map((o) => ({
      ...o,
      leverage: Number(o.leverage),
      qty: o.qty != null ? String(o.qty) : undefined,
      valueQty: o.valueQty != null ? String(o.valueQty) : undefined,
    }));
    const result = await kucoinClient.batchCreateOrders(ordersWithNumericLeverage as unknown as kucoinClient.CreateOrderParams[]);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao criar batch de ordens Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/futures/orders/test - Ordem de teste Futures (dry run)
app.post('/api/integrations/trading/futures/orders/test', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const bodySchema = z.object({
      clientOid: z.string().min(1),
      symbol: z.string().min(1),
      side: z.enum(['buy', 'sell']),
      type: z.enum(['limit', 'market']),
      leverage: z.string().min(1),
      price: z.string().optional(),
      size: z.number().optional(),
      qty: z.number().optional(),
      valueQty: z.number().optional(),
      timeInForce: z.enum(['GTC', 'IOC', 'FOK', 'RPI']).optional(),
      postOnly: z.boolean().optional(),
      hidden: z.boolean().optional(),
      iceberg: z.boolean().optional(),
      visibleSize: z.string().optional(),
      remark: z.string().optional(),
      stop: z.enum(['down', 'up']).optional(),
      stopPriceType: z.enum(['TP', 'IP', 'MP']).optional(),
      stopPrice: z.string().optional(),
      reduceOnly: z.boolean().optional(),
      closeOrder: z.boolean().optional(),
      forceHold: z.boolean().optional(),
      marginMode: z.enum(['ISOLATED', 'CROSS']).optional(),
      stp: z.enum(['CN', 'CO', 'CB', 'DC']).optional(),
    });
    const bodyResult = bodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Parâmetros inválidos', details: bodyResult.error.flatten() });
      return;
    }
    const testOrderParams = {
      ...bodyResult.data,
      leverage: Number(bodyResult.data.leverage),
      qty: bodyResult.data.qty != null ? String(bodyResult.data.qty) : undefined,
      valueQty: bodyResult.data.valueQty != null ? String(bodyResult.data.valueQty) : undefined,
    };
    const result = await kucoinClient.createOrderTest(testOrderParams as unknown as kucoinClient.CreateOrderParams);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao criar ordem de teste Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/futures/orders/by-client-oid/:clientOid - Cancelar ordem Futures por clientOid
app.delete('/api/integrations/trading/futures/orders/by-client-oid/:clientOid', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const { clientOid } = req.params;
    const symbol = req.query.symbol as string;
    if (!clientOid || !symbol) {
      res.status(400).json({ error: 'clientOid e symbol obrigatórios' });
      return;
    }
    const result = await kucoinClient.cancelOrderByClientOid(clientOid, symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar ordem Futures por clientOid');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/futures/stop-orders/all - Cancelar todas stop orders Futures
app.delete('/api/integrations/trading/futures/stop-orders/all', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const symbol = req.query.symbol as string | undefined;
    const result = await kucoinClient.cancelAllStopOrders(symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar todas stop orders Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// FUTURES: Market Data Avançado, Ordens Avançadas, Posições, Funding Fees
// Cobertura 100% KuCoin Futures API
// ============================================================================

// GET /api/integrations/trading/futures/tickers - Todos os tickers Futures
app.get('/api/integrations/trading/futures/tickers', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  try {
    const tickers = await kucoinClient.getAllFuturesTickers();
    res.json({ success: true, data: tickers });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter todos os tickers Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/orderbook/full/:symbol - Order book completo Futures (Level 2)
app.get('/api/integrations/trading/futures/orderbook/full/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    if (!symbol) {
      res.status(400).json({ error: 'Símbolo obrigatório' });
      return;
    }
    const orderbook = await kucoinClient.getFullFuturesOrderBook(symbol);
    res.json({ success: true, data: orderbook });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter order book completo Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/index/spot/:symbol - Índice de preço spot
app.get('/api/integrations/trading/futures/index/spot/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    if (!symbol) {
      res.status(400).json({ error: 'Símbolo obrigatório' });
      return;
    }
    const startAt = req.query.startAt ? Number(req.query.startAt) : undefined;
    const endAt = req.query.endAt ? Number(req.query.endAt) : undefined;
    const maxCount = req.query.maxCount ? Number(req.query.maxCount) : undefined;
    const result = await kucoinClient.getSpotIndexPrice(symbol, { startAt, endAt, maxCount });
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter índice de preço spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/index/interest/:symbol - Índice de taxa de juros
app.get('/api/integrations/trading/futures/index/interest/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    if (!symbol) {
      res.status(400).json({ error: 'Símbolo obrigatório' });
      return;
    }
    const startAt = req.query.startAt ? Number(req.query.startAt) : undefined;
    const endAt = req.query.endAt ? Number(req.query.endAt) : undefined;
    const maxCount = req.query.maxCount ? Number(req.query.maxCount) : undefined;
    const result = await kucoinClient.getInterestRateIndex(symbol, { startAt, endAt, maxCount });
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter índice de taxa de juros');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/index/premium/:symbol - Índice premium
app.get('/api/integrations/trading/futures/index/premium/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    if (!symbol) {
      res.status(400).json({ error: 'Símbolo obrigatório' });
      return;
    }
    const startAt = req.query.startAt ? Number(req.query.startAt) : undefined;
    const endAt = req.query.endAt ? Number(req.query.endAt) : undefined;
    const maxCount = req.query.maxCount ? Number(req.query.maxCount) : undefined;
    const result = await kucoinClient.getPremiumIndex(symbol, { startAt, endAt, maxCount });
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter índice premium');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/stats/24hr - Estatísticas 24h Futures
app.get('/api/integrations/trading/futures/stats/24hr', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  try {
    const stats = await kucoinClient.get24hrStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter estatísticas 24h Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/server-time - Hora do servidor Futures
app.get('/api/integrations/trading/futures/server-time', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  try {
    const time = await kucoinClient.getFuturesServerTime();
    res.json({ success: true, data: { timestamp: time } });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter hora do servidor Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/service-status - Status do serviço Futures
app.get('/api/integrations/trading/futures/service-status', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  try {
    const status = await kucoinClient.getFuturesServiceStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter status do serviço Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/futures/orders/batch-cancel - Cancelar múltiplas ordens por IDs
app.delete('/api/integrations/trading/futures/orders/batch-cancel', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const orderIdsRaw = req.query.orderIds as string | undefined;
    if (!orderIdsRaw) {
      res.status(400).json({ error: 'orderIds obrigatório (separados por vírgula)' });
      return;
    }
    const orderIds = orderIdsRaw.split(',').map(id => id.trim()).filter(Boolean);
    const result = await kucoinClient.batchCancelOrders(orderIds);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar ordens em batch Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/orders/recent-closed - Ordens recentes fechadas Futures
app.get('/api/integrations/trading/futures/orders/recent-closed', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const symbol = req.query.symbol as string | undefined;
    const result = await kucoinClient.getRecentClosedOrders(symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter ordens recentes fechadas Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/orders/open-value/:symbol - Valor de ordens abertas Futures
app.get('/api/integrations/trading/futures/orders/open-value/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const { symbol } = req.params;
    if (!symbol) {
      res.status(400).json({ error: 'Símbolo obrigatório' });
      return;
    }
    const result = await kucoinClient.getOpenOrderValue(symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter valor de ordens abertas Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/fills - Fills/trades Futures
app.get('/api/integrations/trading/futures/fills', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const params = {
      symbol: req.query.symbol as string | undefined,
      orderId: req.query.orderId as string | undefined,
      side: req.query.side as 'buy' | 'sell' | undefined,
      type: req.query.type as 'limit' | 'market' | undefined,
      startAt: req.query.startAt ? Number(req.query.startAt) : undefined,
      endAt: req.query.endAt ? Number(req.query.endAt) : undefined,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
      currentPage: req.query.currentPage ? Number(req.query.currentPage) : undefined,
    };
    const result = await kucoinClient.getFills(params);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter fills Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/positions/cross-margin-requirement/:symbol - Requisito margem cross
app.get('/api/integrations/trading/futures/positions/cross-margin-requirement/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const { symbol } = req.params;
    if (!symbol) {
      res.status(400).json({ error: 'Símbolo obrigatório' });
      return;
    }
    const result = await kucoinClient.getCrossMarginRequirement(symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter requisito de margem cross');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/futures/risk-limits/isolated - Modificar risk limit isolado
app.post('/api/integrations/trading/futures/risk-limits/isolated', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const { symbol, level } = req.body as { symbol?: string; level?: number };
    if (!symbol || level === undefined) {
      res.status(400).json({ error: 'symbol e level obrigatórios' });
      return;
    }
    const result = await kucoinClient.modifyIsolatedMarginRiskLimit(symbol, level);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao modificar risk limit isolado');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/funding/public/:symbol - Histórico público de funding
app.get('/api/integrations/trading/futures/funding/public/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    if (!symbol) {
      res.status(400).json({ error: 'Símbolo obrigatório' });
      return;
    }
    const from = req.query.from ? Number(req.query.from) : Date.now() - 7 * 24 * 60 * 60 * 1000;
    const to = req.query.to ? Number(req.query.to) : Date.now();
    const result = await kucoinClient.getPublicFundingHistory(symbol, from, to);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter histórico público de funding');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/funding/private/:symbol - Histórico privado de funding
app.get('/api/integrations/trading/futures/funding/private/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const { symbol } = req.params;
    if (!symbol) {
      res.status(400).json({ error: 'Símbolo obrigatório' });
      return;
    }
    const startAt = req.query.startAt ? Number(req.query.startAt) : undefined;
    const endAt = req.query.endAt ? Number(req.query.endAt) : undefined;
    const maxCount = req.query.maxCount ? Number(req.query.maxCount) : undefined;
    const result = await kucoinClient.getPrivateFundingHistory(symbol, { startAt, endAt, maxCount });
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter histórico privado de funding');
    res.status(500).json({ error: errorMessage });
  }
});
}
