import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { requirePermission } from '@alice/shared-utils';
import { z } from 'zod';
import * as kucoinClient from '../kucoinClient.js';
import * as kucoinSpotClient from '../kucoinSpotClient.js';

interface RegisterTradingSpotRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  respondKucoinNotConfigured: (res: Response) => void;
  sendKucoinErrorResponse: (res: Response, error: unknown) => boolean;
}

export function registerTradingSpotRoutes(app: Express, deps: RegisterTradingSpotRoutesDeps): void {
const logger = deps.logger ?? createLogger('integrations-service');
const { respondKucoinNotConfigured, sendKucoinErrorResponse } = deps;
// --- SPOT: Ticker, Accounts, Orders, Stop Orders ---

// GET /api/integrations/trading/spot/ticker/:symbol - Ticker Spot
app.get('/api/integrations/trading/spot/ticker/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    if (!symbol) {
      res.status(400).json({ error: 'Símbolo obrigatório' });
      return;
    }
    const ticker = await kucoinSpotClient.getSpotTicker(symbol);
    res.json({ success: true, data: ticker });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter ticker Spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/tickers - Todos os tickers Spot
app.get('/api/integrations/trading/spot/tickers', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  try {
    const tickers = await kucoinSpotClient.getSpotAllTickers();
    res.json({ success: true, data: tickers });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter todos tickers Spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/trades/:symbol - Trades recentes Spot
app.get('/api/integrations/trading/spot/trades/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    if (!symbol) {
      res.status(400).json({ error: 'Símbolo obrigatório' });
      return;
    }
    const trades = await kucoinSpotClient.getSpotTrades(symbol);
    res.json({ success: true, data: trades });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter trades Spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/accounts - Contas Spot
app.get('/api/integrations/trading/spot/accounts', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinSpotClient.isSpotConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const type = (req.query.type as 'trade' | 'main' | 'margin' | 'isolated') || 'trade';
    const accounts = await kucoinSpotClient.getSpotAccounts(type);
    res.json({ success: true, data: accounts });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter contas Spot');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/spot/orders - Criar ordem Spot
app.post('/api/integrations/trading/spot/orders', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinSpotClient.isSpotConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const bodySchema = z.object({
      clientOid: z.string().min(1),
      symbol: z.string().min(1),
      side: z.enum(['buy', 'sell']),
      type: z.enum(['limit', 'market']),
      price: z.string().optional(),
      size: z.string().optional(),
      funds: z.string().optional(),
      timeInForce: z.enum(['GTC', 'GTT', 'IOC', 'FOK']).optional(),
      cancelAfter: z.number().optional(),
      postOnly: z.boolean().optional(),
      hidden: z.boolean().optional(),
      iceberg: z.boolean().optional(),
      visibleSize: z.string().optional(),
      remark: z.string().optional(),
      stp: z.enum(['CN', 'CO', 'CB', 'DC']).optional(),
    });
    const bodyResult = bodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Parâmetros inválidos', details: bodyResult.error.flatten() });
      return;
    }
    const result = await kucoinSpotClient.createSpotOrder(bodyResult.data);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao criar ordem Spot');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/spot/orders/:orderId - Cancelar ordem Spot por ID
app.delete('/api/integrations/trading/spot/orders/:orderId', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinSpotClient.isSpotConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const { orderId } = req.params;
    if (!orderId) {
      res.status(400).json({ error: 'orderId obrigatório' });
      return;
    }
    const result = await kucoinSpotClient.cancelSpotOrder(orderId);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar ordem Spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/orders/:orderId - Detalhes de ordem Spot
app.get('/api/integrations/trading/spot/orders/:orderId', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinSpotClient.isSpotConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const { orderId } = req.params;
    if (!orderId) {
      res.status(400).json({ error: 'orderId obrigatório' });
      return;
    }
    const order = await kucoinSpotClient.getSpotOrder(orderId);
    res.json({ success: true, data: order });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter ordem Spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/orders/open - Ordens abertas Spot
app.get('/api/integrations/trading/spot/orders/open', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinSpotClient.isSpotConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const symbol = req.query.symbol as string | undefined;
    const orders = await kucoinSpotClient.getOpenSpotOrders(symbol);
    res.json({ success: true, data: orders });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter ordens abertas Spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/orders/closed - Ordens fechadas Spot
app.get('/api/integrations/trading/spot/orders/closed', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinSpotClient.isSpotConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const symbol = req.query.symbol as string | undefined;
    const orders = await kucoinSpotClient.getClosedSpotOrders(symbol);
    res.json({ success: true, data: orders });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter ordens fechadas Spot');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/spot/stop-orders - Criar stop order Spot
app.post('/api/integrations/trading/spot/stop-orders', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinSpotClient.isSpotConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const bodySchema = z.object({
      clientOid: z.string().min(1),
      symbol: z.string().min(1),
      side: z.enum(['buy', 'sell']),
      type: z.enum(['limit', 'market']),
      stopPrice: z.string().min(1),
      price: z.string().optional(),
      size: z.string().optional(),
      funds: z.string().optional(),
      timeInForce: z.enum(['GTC', 'GTT', 'IOC', 'FOK']).optional(),
      cancelAfter: z.number().optional(),
      remark: z.string().optional(),
      stp: z.enum(['CN', 'CO', 'CB', 'DC']).optional(),
      tradeType: z.enum(['TRADE', 'MARGIN_TRADE', 'MARGIN_ISOLATED_TRADE']).optional(),
    });
    const bodyResult = bodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Parâmetros inválidos', details: bodyResult.error.flatten() });
      return;
    }
    const result = await kucoinSpotClient.createSpotStopOrder(bodyResult.data);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao criar stop order Spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/stop-orders - Listar stop orders Spot
app.get('/api/integrations/trading/spot/stop-orders', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinSpotClient.isSpotConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const symbol = req.query.symbol as string | undefined;
    const orders = await kucoinSpotClient.getSpotStopOrders(symbol);
    res.json({ success: true, data: orders });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter stop orders Spot');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/spot/stop-orders/:orderId - Cancelar stop order Spot
app.delete('/api/integrations/trading/spot/stop-orders/:orderId', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinSpotClient.isSpotConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const { orderId } = req.params;
    if (!orderId) {
      res.status(400).json({ error: 'orderId obrigatório' });
      return;
    }
    const result = await kucoinSpotClient.cancelSpotStopOrder(orderId);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar stop order Spot');
    res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// FASE 3 - Spot OCO Orders
// ============================================================================

const createSpotOcoOrderSchema = z.object({
  clientOid: z.string().min(1),
  symbol: z.string().min(1),
  side: z.enum(['buy', 'sell']),
  price: z.string().min(1),
  size: z.string().min(1),
  stopPrice: z.string().min(1),
  limitPrice: z.string().min(1),
  tradeType: z.literal('TRADE').optional(),
  remark: z.string().optional(),
});

// Criar OCO order Spot
app.post('/api/integrations/trading/spot/oco-orders', requirePermission('integrations:trading:write'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const params = createSpotOcoOrderSchema.parse(req.body);
    const result = await kucoinSpotClient.createSpotOcoOrder(params);
    res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Parâmetros inválidos', details: error.errors });
      return;
    }
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao criar OCO order Spot');
    res.status(500).json({ error: errorMessage });
  }
});

// Cancelar OCO order Spot por orderId
app.delete('/api/integrations/trading/spot/oco-orders/:orderId', requirePermission('integrations:trading:write'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { orderId } = req.params;
    const result = await kucoinSpotClient.cancelSpotOcoOrder(orderId);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar OCO order Spot');
    res.status(500).json({ error: errorMessage });
  }
});

// Cancelar OCO order Spot por clientOid
app.delete('/api/integrations/trading/spot/oco-orders/by-client-oid/:clientOid', requirePermission('integrations:trading:write'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { clientOid } = req.params;
    const result = await kucoinSpotClient.cancelSpotOcoOrderByClientOid(clientOid);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar OCO order Spot por clientOid');
    res.status(500).json({ error: errorMessage });
  }
});

// Cancelar todas OCO orders Spot
app.delete('/api/integrations/trading/spot/oco-orders/all', requirePermission('integrations:trading:write'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const symbol = req.query.symbol as string | undefined;
    const orderIds = req.query.orderIds as string | undefined;
    const result = await kucoinSpotClient.cancelAllSpotOcoOrders(symbol, orderIds);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar todas OCO orders Spot');
    res.status(500).json({ error: errorMessage });
  }
});

// Obter OCO order Spot por orderId
app.get('/api/integrations/trading/spot/oco-orders/:orderId', requirePermission('integrations:trading:read'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { orderId } = req.params;
    const result = await kucoinSpotClient.getSpotOcoOrder(orderId);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter OCO order Spot');
    res.status(500).json({ error: errorMessage });
  }
});

// Obter OCO order Spot por clientOid
app.get('/api/integrations/trading/spot/oco-orders/by-client-oid/:clientOid', requirePermission('integrations:trading:read'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { clientOid } = req.params;
    const result = await kucoinSpotClient.getSpotOcoOrderByClientOid(clientOid);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter OCO order Spot por clientOid');
    res.status(500).json({ error: errorMessage });
  }
});

// Listar OCO orders Spot
app.get('/api/integrations/trading/spot/oco-orders', requirePermission('integrations:trading:read'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const params = {
      symbol: req.query.symbol as string | undefined,
      orderIds: req.query.orderIds as string | undefined,
      startAt: req.query.startAt ? Number(req.query.startAt) : undefined,
      endAt: req.query.endAt ? Number(req.query.endAt) : undefined,
      currentPage: req.query.currentPage ? Number(req.query.currentPage) : undefined,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
    };
    const result = await kucoinSpotClient.getSpotOcoOrders(params);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao listar OCO orders Spot');
    res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// FASE 3 - Spot Batch Orders, Cancel by ClientOid, Cancel All, Modify
// ============================================================================

const batchSpotOrderSchema = z.object({
  orderList: z.array(z.object({
    clientOid: z.string().min(1),
    side: z.enum(['buy', 'sell']),
    symbol: z.string().min(1),
    type: z.enum(['limit', 'market']),
    price: z.string().optional(),
    size: z.string().optional(),
    funds: z.string().optional(),
    timeInForce: z.enum(['GTC', 'IOC', 'FOK']).optional(),
    remark: z.string().optional(),
  })).min(1).max(5),
});

const modifySpotOrderSchema = z.object({
  symbol: z.string().min(1),
  orderId: z.string().optional(),
  clientOid: z.string().optional(),
  newPrice: z.string().optional(),
  newSize: z.string().optional(),
});

// Batch create spot orders
app.post('/api/integrations/trading/spot/orders/batch', requirePermission('integrations:trading:write'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { orderList } = batchSpotOrderSchema.parse(req.body);
    const result = await kucoinSpotClient.batchCreateSpotOrders(orderList);
    res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Parâmetros inválidos', details: error.errors });
      return;
    }
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao criar batch spot orders');
    res.status(500).json({ error: errorMessage });
  }
});

// Cancelar spot order por clientOid
app.delete('/api/integrations/trading/spot/orders/by-client-oid/:clientOid', requirePermission('integrations:trading:write'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { clientOid } = req.params;
    const symbol = req.query.symbol as string;
    if (!symbol) {
      res.status(400).json({ error: 'Query param symbol é obrigatório' });
      return;
    }
    const result = await kucoinSpotClient.cancelSpotOrderByClientOid(clientOid, symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar spot order por clientOid');
    res.status(500).json({ error: errorMessage });
  }
});

// Cancelar todas spot orders
app.delete('/api/integrations/trading/spot/orders/all', requirePermission('integrations:trading:write'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const symbol = req.query.symbol as string | undefined;
    const result = await kucoinSpotClient.cancelAllSpotOrders(symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar todas spot orders');
    res.status(500).json({ error: errorMessage });
  }
});

// Cancelar todas stop orders Spot
app.delete('/api/integrations/trading/spot/stop-orders/all', requirePermission('integrations:trading:write'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const symbol = req.query.symbol as string | undefined;
    const result = await kucoinSpotClient.cancelAllSpotStopOrders(symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar todas stop orders Spot');
    res.status(500).json({ error: errorMessage });
  }
});

// Modificar ordem Spot
app.post('/api/integrations/trading/spot/orders/modify', requirePermission('integrations:trading:write'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const params = modifySpotOrderSchema.parse(req.body);
    const result = await kucoinSpotClient.modifySpotOrder(params);
    res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Parâmetros inválidos', details: error.errors });
      return;
    }
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao modificar spot order');
    res.status(500).json({ error: errorMessage });
  }
});

// --- SPOT: Market Data Avançado + Ordens Avançadas (cobertura 100%) ---

// GET /api/integrations/trading/spot/announcements - Anúncios de novos pares Spot
app.get('/api/integrations/trading/spot/announcements', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  try {
    const data = await kucoinSpotClient.getSpotAnnouncements();
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar anúncios spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/currency/:currency - Detalhes de uma moeda Spot
app.get('/api/integrations/trading/spot/currency/:currency', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const { currency } = req.params;
    const data = await kucoinSpotClient.getSpotCurrency(currency);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar moeda spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/symbol/:symbol - Detalhes de um par Spot
app.get('/api/integrations/trading/spot/symbol/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const data = await kucoinSpotClient.getSpotSymbol(symbol);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar símbolo spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/orderbook/full/:symbol - Order book completo Spot (L3)
app.get('/api/integrations/trading/spot/orderbook/full/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const data = await kucoinSpotClient.getFullSpotOrderBook(symbol);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar orderbook completo spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/orderbook/call-auction/:symbol - Order book leilão Spot
app.get('/api/integrations/trading/spot/orderbook/call-auction/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const data = await kucoinSpotClient.getCallAuctionOrderBook(symbol);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar orderbook leilão spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/call-auction/:symbol - Informações de leilão Spot
app.get('/api/integrations/trading/spot/call-auction/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const data = await kucoinSpotClient.getCallAuctionInfo(symbol);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar info leilão spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/fiat-price - Preço fiat de moedas
app.get('/api/integrations/trading/spot/fiat-price', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const base = req.query.base as string | undefined;
    const currencies = req.query.currencies as string | undefined;
    const data = await kucoinSpotClient.getFiatPrice({ base, currencies });
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar preço fiat');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/stats/:symbol - Estatísticas 24h Spot
app.get('/api/integrations/trading/spot/stats/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const data = await kucoinSpotClient.getSpot24hrStats(symbol);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar stats 24h spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/markets - Lista de mercados Spot
app.get('/api/integrations/trading/spot/markets', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  try {
    const data = await kucoinSpotClient.getSpotMarketList();
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar mercados spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/server-time - Hora do servidor Spot
app.get('/api/integrations/trading/spot/server-time', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  try {
    const data = await kucoinSpotClient.getSpotServerTime();
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar hora servidor spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/service-status - Status do serviço Spot
app.get('/api/integrations/trading/spot/service-status', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  try {
    const data = await kucoinSpotClient.getSpotServiceStatus();
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar status serviço spot');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/spot/orders/sync - Criar ordem Spot síncrona
app.post('/api/integrations/trading/spot/orders/sync', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const result = await kucoinSpotClient.createSpotOrderSync(req.body);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao criar spot order sync');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/spot/orders/test - Criar ordem Spot teste
app.post('/api/integrations/trading/spot/orders/test', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const result = await kucoinSpotClient.createSpotOrderTest(req.body);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao criar spot order teste');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/spot/orders/batch/sync - Criar batch ordens Spot síncronas
app.post('/api/integrations/trading/spot/orders/batch/sync', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { orderList } = req.body;
    const result = await kucoinSpotClient.batchCreateSpotOrdersSync(orderList);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao criar batch spot orders sync');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/spot/orders/:orderId/sync - Cancelar ordem Spot síncrona
app.delete('/api/integrations/trading/spot/orders/:orderId/sync', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { orderId } = req.params;
    const symbol = req.query.symbol as string;
    if (!symbol) { res.status(400).json({ error: 'symbol é obrigatório' }); return; }
    const result = await kucoinSpotClient.cancelSpotOrderSync(orderId, symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar spot order sync');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/spot/orders/by-client-oid/:clientOid/sync - Cancelar ordem Spot por clientOid síncrona
app.delete('/api/integrations/trading/spot/orders/by-client-oid/:clientOid/sync', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { clientOid } = req.params;
    const symbol = req.query.symbol as string;
    if (!symbol) { res.status(400).json({ error: 'symbol é obrigatório' }); return; }
    const result = await kucoinSpotClient.cancelSpotOrderByClientOidSync(clientOid, symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar spot order por clientOid sync');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/spot/orders/:orderId/partial - Cancelar parcialmente ordem Spot
app.delete('/api/integrations/trading/spot/orders/:orderId/partial', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { orderId } = req.params;
    const { cancelSize, symbol } = req.body;
    const result = await kucoinSpotClient.cancelPartialSpotOrder(orderId, cancelSize, symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar parcialmente spot order');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/spot/orders/by-symbol/:symbol - Cancelar ordens Spot por símbolo
app.delete('/api/integrations/trading/spot/orders/by-symbol/:symbol', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { symbol } = req.params;
    const result = await kucoinSpotClient.cancelSpotOrdersBySymbol(symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar spot orders por símbolo');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/orders/by-client-oid/:clientOid/detail - Detalhes ordem Spot por clientOid
app.get('/api/integrations/trading/spot/orders/by-client-oid/:clientOid/detail', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { clientOid } = req.params;
    const symbol = req.query.symbol as string;
    if (!symbol) { res.status(400).json({ error: 'symbol é obrigatório' }); return; }
    const result = await kucoinSpotClient.getSpotOrderByClientOid(clientOid, symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar spot order por clientOid');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/orders/symbols-with-open - Símbolos com ordens abertas
app.get('/api/integrations/trading/spot/orders/symbols-with-open', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const data = await kucoinSpotClient.getSymbolsWithOpenOrder();
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar símbolos com ordens abertas');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/orders/open/paged - Ordens abertas Spot paginadas
app.get('/api/integrations/trading/spot/orders/open/paged', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const symbol = req.query.symbol as string;
    if (!symbol) { res.status(400).json({ error: 'symbol é obrigatório' }); return; }
    const currentPage = req.query.currentPage ? Number(req.query.currentPage) : undefined;
    const pageSize = req.query.pageSize ? Number(req.query.pageSize) : undefined;
    const data = await kucoinSpotClient.getOpenSpotOrdersByPage({ symbol, currentPage, pageSize });
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar ordens abertas paginadas');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/fills - Histórico de trades Spot
app.get('/api/integrations/trading/spot/fills', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const symbol = req.query.symbol as string;
    if (!symbol) { res.status(400).json({ error: 'symbol é obrigatório' }); return; }
    const data = await kucoinSpotClient.getSpotTradeHistory({
      symbol,
      orderId: req.query.orderId as string | undefined,
      side: req.query.side as 'buy' | 'sell' | undefined,
      type: req.query.type as 'limit' | 'market' | undefined,
      startAt: req.query.startAt ? Number(req.query.startAt) : undefined,
      endAt: req.query.endAt ? Number(req.query.endAt) : undefined,
    });
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar fills spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/dcp - Obter configuração DCP (Disconnect Cancel Protection)
app.get('/api/integrations/trading/spot/dcp', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const data = await kucoinSpotClient.getSpotDCP();
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar DCP spot');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/spot/dcp - Configurar DCP (Disconnect Cancel Protection)
app.post('/api/integrations/trading/spot/dcp', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { timeout, symbols } = req.body;
    const data = await kucoinSpotClient.setSpotDCP(timeout, symbols);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao configurar DCP spot');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/spot/stop-orders/by-client-oid/:clientOid - Cancelar stop order Spot por clientOid
app.delete('/api/integrations/trading/spot/stop-orders/by-client-oid/:clientOid', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { clientOid } = req.params;
    const symbol = req.query.symbol as string | undefined;
    const result = await kucoinSpotClient.cancelSpotStopOrderByClientOid(clientOid, symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar stop order spot por clientOid');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/stop-orders/:orderId/detail - Detalhes stop order Spot por ID
app.get('/api/integrations/trading/spot/stop-orders/:orderId/detail', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { orderId } = req.params;
    const data = await kucoinSpotClient.getSpotStopOrderById(orderId);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar detalhes stop order spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/stop-orders/by-client-oid/:clientOid - Detalhes stop order Spot por clientOid
app.get('/api/integrations/trading/spot/stop-orders/by-client-oid/:clientOid', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { clientOid } = req.params;
    const data = await kucoinSpotClient.getSpotStopOrderByClientOid(clientOid);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar stop order spot por clientOid');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/oco-orders/:orderId/detail - Detalhes OCO Spot com sub-orders
app.get('/api/integrations/trading/spot/oco-orders/:orderId/detail', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { orderId } = req.params;
    const data = await kucoinSpotClient.getSpotOcoOrderDetail(orderId);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar detalhes OCO spot');
    res.status(500).json({ error: errorMessage });
  }
});

// --- MARGIN: Symbols, Accounts, Orders, Stop Orders ---

}
