import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { requirePermission } from '@alice/shared-utils';
import { z } from 'zod';
import * as kucoinClient from '../kucoinClient.js';
import * as kucoinMarginClient from '../kucoinMarginClient.js';

interface RegisterTradingMarginRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  respondKucoinNotConfigured: (res: Response) => void;
  sendKucoinErrorResponse: (res: Response, error: unknown) => boolean;
}

export function registerTradingMarginRoutes(app: Express, deps: RegisterTradingMarginRoutesDeps): void {
const logger = deps.logger ?? createLogger('integrations-service');
const { respondKucoinNotConfigured, sendKucoinErrorResponse } = deps;
// GET /api/integrations/trading/margin/symbols/cross - Símbolos margin cross
app.get('/api/integrations/trading/margin/symbols/cross', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const symbol = req.query.symbol as string | undefined;
    const symbols = await kucoinMarginClient.getCrossMarginSymbols(symbol);
    res.json({ success: true, data: symbols });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter símbolos margin cross');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/margin/symbols/isolated - Símbolos margin isolated
app.get('/api/integrations/trading/margin/symbols/isolated', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  try {
    const symbols = await kucoinMarginClient.getIsolatedMarginSymbols();
    res.json({ success: true, data: symbols });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter símbolos margin isolated');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/margin/account/cross - Conta margin cross
app.get('/api/integrations/trading/margin/account/cross', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinMarginClient.isMarginConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const quoteCurrency = req.query.quoteCurrency as string | undefined;
    const account = await kucoinMarginClient.getCrossMarginAccount(quoteCurrency);
    res.json({ success: true, data: account });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter conta margin cross');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/margin/account/isolated - Conta margin isolated
app.get('/api/integrations/trading/margin/account/isolated', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinMarginClient.isMarginConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const symbol = req.query.symbol as string | undefined;
    const quoteCurrency = req.query.quoteCurrency as string | undefined;
    const account = await kucoinMarginClient.getIsolatedMarginAccount(symbol, quoteCurrency);
    res.json({ success: true, data: account });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter conta margin isolated');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/margin/orders - Criar ordem Margin
app.post('/api/integrations/trading/margin/orders', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinMarginClient.isMarginConfigured()) {
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
      isIsolated: z.boolean().optional(),
      autoBorrow: z.boolean().optional(),
      autoRepay: z.boolean().optional(),
    });
    const bodyResult = bodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Parâmetros inválidos', details: bodyResult.error.flatten() });
      return;
    }
    const result = await kucoinMarginClient.createMarginOrder(bodyResult.data);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao criar ordem Margin');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/margin/orders/:orderId - Cancelar ordem Margin
app.delete('/api/integrations/trading/margin/orders/:orderId', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinMarginClient.isMarginConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const { orderId } = req.params;
    if (!orderId) {
      res.status(400).json({ error: 'orderId obrigatório' });
      return;
    }
    const result = await kucoinMarginClient.cancelMarginOrder(orderId);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar ordem Margin');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/margin/orders/:orderId - Detalhes de ordem Margin
app.get('/api/integrations/trading/margin/orders/:orderId', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinMarginClient.isMarginConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const { orderId } = req.params;
    if (!orderId) {
      res.status(400).json({ error: 'orderId obrigatório' });
      return;
    }
    const order = await kucoinMarginClient.getMarginOrder(orderId);
    res.json({ success: true, data: order });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter ordem Margin');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/margin/orders/open - Ordens abertas Margin
app.get('/api/integrations/trading/margin/orders/open', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  try {
    if (!kucoinMarginClient.isMarginConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const orders = await kucoinMarginClient.getOpenMarginOrders();
    res.json({ success: true, data: orders });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter ordens abertas Margin');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/margin/orders/closed - Ordens fechadas Margin
app.get('/api/integrations/trading/margin/orders/closed', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  try {
    if (!kucoinMarginClient.isMarginConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const orders = await kucoinMarginClient.getClosedMarginOrders();
    res.json({ success: true, data: orders });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter ordens fechadas Margin');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/margin/stop-orders - Criar stop order Margin
app.post('/api/integrations/trading/margin/stop-orders', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinMarginClient.isMarginConfigured()) {
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
      isIsolated: z.boolean().optional(),
      tradeType: z.enum(['MARGIN_TRADE', 'MARGIN_ISOLATED_TRADE']).optional(),
    });
    const bodyResult = bodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Parâmetros inválidos', details: bodyResult.error.flatten() });
      return;
    }
    const result = await kucoinMarginClient.createMarginStopOrder(bodyResult.data);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao criar stop order Margin');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/margin/stop-orders - Listar stop orders Margin
app.get('/api/integrations/trading/margin/stop-orders', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  try {
    if (!kucoinMarginClient.isMarginConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const orders = await kucoinMarginClient.getMarginStopOrders();
    res.json({ success: true, data: orders });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter stop orders Margin');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/margin/stop-orders/:orderId - Cancelar stop order Margin
app.delete('/api/integrations/trading/margin/stop-orders/:orderId', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinMarginClient.isMarginConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const { orderId } = req.params;
    if (!orderId) {
      res.status(400).json({ error: 'orderId obrigatório' });
      return;
    }
    const result = await kucoinMarginClient.cancelMarginStopOrder(orderId);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar stop order Margin');
    res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// FASE 4 - Margin OCO Orders
// ============================================================================

const createMarginOcoOrderSchema = z.object({
  clientOid: z.string().min(1),
  symbol: z.string().min(1),
  side: z.enum(['buy', 'sell']),
  price: z.string().min(1),
  size: z.string().min(1),
  stopPrice: z.string().min(1),
  limitPrice: z.string().min(1),
  tradeType: z.enum(['MARGIN_TRADE', 'MARGIN_ISOLATED_TRADE']).optional(),
  remark: z.string().optional(),
});

// Criar OCO order Margin
app.post('/api/integrations/trading/margin/oco-orders', requirePermission('integrations:trading:write'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const params = createMarginOcoOrderSchema.parse(req.body);
    const result = await kucoinMarginClient.createMarginOcoOrder(params);
    res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Parâmetros inválidos', details: error.errors });
      return;
    }
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao criar OCO order Margin');
    res.status(500).json({ error: errorMessage });
  }
});

// Cancelar OCO order Margin por orderId
app.delete('/api/integrations/trading/margin/oco-orders/:orderId', requirePermission('integrations:trading:write'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { orderId } = req.params;
    const result = await kucoinMarginClient.cancelMarginOcoOrder(orderId);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar OCO order Margin');
    res.status(500).json({ error: errorMessage });
  }
});

// Cancelar OCO order Margin por clientOid
app.delete('/api/integrations/trading/margin/oco-orders/by-client-oid/:clientOid', requirePermission('integrations:trading:write'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { clientOid } = req.params;
    const result = await kucoinMarginClient.cancelMarginOcoOrderByClientOid(clientOid);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar OCO order Margin por clientOid');
    res.status(500).json({ error: errorMessage });
  }
});

// Cancelar todas OCO orders Margin
app.delete('/api/integrations/trading/margin/oco-orders/all', requirePermission('integrations:trading:write'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const symbol = req.query.symbol as string | undefined;
    const orderIds = req.query.orderIds as string | undefined;
    const result = await kucoinMarginClient.cancelAllMarginOcoOrders(symbol, orderIds);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar todas OCO orders Margin');
    res.status(500).json({ error: errorMessage });
  }
});

// Obter OCO order Margin por orderId
app.get('/api/integrations/trading/margin/oco-orders/:orderId', requirePermission('integrations:trading:read'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { orderId } = req.params;
    const result = await kucoinMarginClient.getMarginOcoOrder(orderId);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter OCO order Margin');
    res.status(500).json({ error: errorMessage });
  }
});

// Obter OCO order Margin por clientOid
app.get('/api/integrations/trading/margin/oco-orders/by-client-oid/:clientOid', requirePermission('integrations:trading:read'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { clientOid } = req.params;
    const result = await kucoinMarginClient.getMarginOcoOrderByClientOid(clientOid);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter OCO order Margin por clientOid');
    res.status(500).json({ error: errorMessage });
  }
});

// Listar OCO orders Margin
app.get('/api/integrations/trading/margin/oco-orders', requirePermission('integrations:trading:read'), async (req, res) => {
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
    const result = await kucoinMarginClient.getMarginOcoOrders(params);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao listar OCO orders Margin');
    res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// FASE 4 - Margin Debit (Borrow/Repay/Interest)
// ============================================================================

const borrowMarginSchema = z.object({
  currency: z.string().min(1),
  size: z.string().min(1),
  timeInForce: z.enum(['IOC', 'FOK']),
  isIsolated: z.boolean().optional(),
  symbol: z.string().optional(),
  isHf: z.boolean().optional(),
});

const repayMarginSchema = z.object({
  currency: z.string().min(1),
  size: z.string().min(1),
  isIsolated: z.boolean().optional(),
  symbol: z.string().optional(),
  isHf: z.boolean().optional(),
});

// Emprestar (borrow) moeda Margin
app.post('/api/integrations/trading/margin/borrow', requirePermission('integrations:trading:write'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const params = borrowMarginSchema.parse(req.body);
    const result = await kucoinMarginClient.borrowMargin(params);
    res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Parâmetros inválidos', details: error.errors });
      return;
    }
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao realizar borrow Margin');
    res.status(500).json({ error: errorMessage });
  }
});

// Pagar (repay) empréstimo Margin
app.post('/api/integrations/trading/margin/repay', requirePermission('integrations:trading:write'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const params = repayMarginSchema.parse(req.body);
    const result = await kucoinMarginClient.repayMargin(params);
    res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Parâmetros inválidos', details: error.errors });
      return;
    }
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao realizar repay Margin');
    res.status(500).json({ error: errorMessage });
  }
});

// Histórico de borrows
app.get('/api/integrations/trading/margin/borrow', requirePermission('integrations:trading:read'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const params = {
      currency: req.query.currency as string | undefined,
      isIsolated: req.query.isIsolated === 'true' ? true : req.query.isIsolated === 'false' ? false : undefined,
      symbol: req.query.symbol as string | undefined,
      orderNo: req.query.orderNo as string | undefined,
      startTime: req.query.startTime ? Number(req.query.startTime) : undefined,
      endTime: req.query.endTime ? Number(req.query.endTime) : undefined,
      currentPage: req.query.currentPage ? Number(req.query.currentPage) : undefined,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
    };
    const result = await kucoinMarginClient.getBorrowHistory(params);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter histórico de borrows');
    res.status(500).json({ error: errorMessage });
  }
});

// Histórico de repays
app.get('/api/integrations/trading/margin/repay', requirePermission('integrations:trading:read'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const params = {
      currency: req.query.currency as string | undefined,
      isIsolated: req.query.isIsolated === 'true' ? true : req.query.isIsolated === 'false' ? false : undefined,
      symbol: req.query.symbol as string | undefined,
      orderNo: req.query.orderNo as string | undefined,
      startTime: req.query.startTime ? Number(req.query.startTime) : undefined,
      endTime: req.query.endTime ? Number(req.query.endTime) : undefined,
      currentPage: req.query.currentPage ? Number(req.query.currentPage) : undefined,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
    };
    const result = await kucoinMarginClient.getRepayHistory(params);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter histórico de repays');
    res.status(500).json({ error: errorMessage });
  }
});

// Histórico de juros
app.get('/api/integrations/trading/margin/interest', requirePermission('integrations:trading:read'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const params = {
      currency: req.query.currency as string | undefined,
      isIsolated: req.query.isIsolated === 'true' ? true : req.query.isIsolated === 'false' ? false : undefined,
      symbol: req.query.symbol as string | undefined,
      startTime: req.query.startTime ? Number(req.query.startTime) : undefined,
      endTime: req.query.endTime ? Number(req.query.endTime) : undefined,
      currentPage: req.query.currentPage ? Number(req.query.currentPage) : undefined,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
    };
    const result = await kucoinMarginClient.getInterestHistory(params);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter histórico de juros');
    res.status(500).json({ error: errorMessage });
  }
});

// Obter taxas de juros de empréstimo
app.get('/api/integrations/trading/margin/lending-rates', requirePermission('integrations:trading:read'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const currency = req.query.currency as string | undefined;
    const result = await kucoinMarginClient.getLendingRates(currency);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter taxas de juros');
    res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// FASE 4 - Cancelar Margin Order por ClientOid + Modificar Leverage
// ============================================================================

// Cancelar Margin Order por clientOid
app.delete('/api/integrations/trading/margin/orders/by-client-oid/:clientOid', requirePermission('integrations:trading:write'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { clientOid } = req.params;
    const result = await kucoinMarginClient.cancelMarginOrderByClientOid(clientOid);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar Margin order por clientOid');
    res.status(500).json({ error: errorMessage });
  }
});

// Modificar leverage Cross Margin
app.post('/api/integrations/trading/margin/leverage', requirePermission('integrations:trading:write'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const leverageSchema = z.object({ leverage: z.number().int().min(1).max(10) });
    const { leverage } = leverageSchema.parse(req.body);
    const result = await kucoinMarginClient.updateCrossMarginLeverage(leverage);
    res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Parâmetros inválidos', details: error.errors });
      return;
    }
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao modificar leverage Margin');
    res.status(500).json({ error: errorMessage });
  }
});

// --- MARGIN: Market Data Avançado + Ordens Avançadas (cobertura 100%) ---

// GET /api/integrations/trading/margin/etf-info - Info ETF Margin
app.get('/api/integrations/trading/margin/etf-info', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const currency = req.query.currency as string | undefined;
    const data = await kucoinMarginClient.getMarginETFInfo(currency);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar ETF info margin');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/margin/mark-price/:symbol - Mark price de um símbolo
app.get('/api/integrations/trading/margin/mark-price/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const data = await kucoinMarginClient.getMarkPriceDetail(symbol);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar mark price margin');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/margin/config - Configuração geral Margin
app.get('/api/integrations/trading/margin/config', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  try {
    const data = await kucoinMarginClient.getMarginConfig();
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar config margin');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/margin/mark-prices - Lista de mark prices
app.get('/api/integrations/trading/margin/mark-prices', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  try {
    const data = await kucoinMarginClient.getMarkPriceList();
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar mark prices margin');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/margin/collateral-ratio - Collateral ratio
app.get('/api/integrations/trading/margin/collateral-ratio', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  try {
    const data = await kucoinMarginClient.getMarginCollateralRatio();
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar collateral ratio margin');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/margin/currencies - Moedas disponíveis para margin
app.get('/api/integrations/trading/margin/currencies', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const type = req.query.type as string | undefined;
    const data = await kucoinMarginClient.getMarginAvailableInventory(type);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar moedas margin');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/margin/orders/test - Criar ordem Margin teste
app.post('/api/integrations/trading/margin/orders/test', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const result = await kucoinMarginClient.createMarginOrderTest(req.body);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao criar margin order teste');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/margin/orders/by-symbol/:symbol - Cancelar todas ordens por símbolo
app.delete('/api/integrations/trading/margin/orders/by-symbol/:symbol', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { symbol } = req.params;
    const tradeType = req.query.tradeType as string | undefined;
    const result = await kucoinMarginClient.cancelAllMarginOrdersBySymbol(symbol, tradeType);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar margin orders por símbolo');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/margin/orders/symbols-with-open - Símbolos com ordens abertas
app.get('/api/integrations/trading/margin/orders/symbols-with-open', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const tradeType = req.query.tradeType as string | undefined;
    const data = await kucoinMarginClient.getMarginSymbolsWithOpenOrder(tradeType);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar símbolos com ordens abertas margin');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/margin/fills - Histórico de fills Margin
app.get('/api/integrations/trading/margin/fills', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const params: Record<string, string | undefined> = {
      symbol: req.query.symbol as string | undefined,
      orderId: req.query.orderId as string | undefined,
      side: req.query.side as string | undefined,
      type: req.query.type as string | undefined,
      tradeType: req.query.tradeType as string | undefined,
      startAt: req.query.startAt as string | undefined,
      endAt: req.query.endAt as string | undefined,
    };
    const cleanParams = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
    const data = await kucoinMarginClient.getMarginTradeHistory(cleanParams as Record<string, string>);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar fills margin');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/margin/orders/by-client-oid/:clientOid - Ordem Margin por clientOid
app.get('/api/integrations/trading/margin/orders/by-client-oid/:clientOid', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { clientOid } = req.params;
    const symbol = req.query.symbol as string;
    if (!symbol) {
      res.status(400).json({ error: 'Parâmetro symbol é obrigatório' });
      return;
    }
    const data = await kucoinMarginClient.getMarginOrderByClientOid(clientOid, symbol);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar margin order por clientOid');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/margin/stop-orders/by-client-oid/:clientOid - Cancelar stop order por clientOid
app.delete('/api/integrations/trading/margin/stop-orders/by-client-oid/:clientOid', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { clientOid } = req.params;
    const symbol = req.query.symbol as string | undefined;
    const result = await kucoinMarginClient.cancelMarginStopOrderByClientOid(clientOid, symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar stop order margin por clientOid');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/margin/stop-orders/all - Cancelar todas stop orders Margin
app.delete('/api/integrations/trading/margin/stop-orders/all', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const params: Record<string, string | undefined> = {
      symbol: req.query.symbol as string | undefined,
      tradeType: req.query.tradeType as string | undefined,
    };
    const cleanParams = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
    const result = await kucoinMarginClient.cancelAllMarginStopOrders(cleanParams as Record<string, string>);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar todas stop orders margin');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/margin/stop-orders/:orderId/detail - Detalhes stop order por ID
app.get('/api/integrations/trading/margin/stop-orders/:orderId/detail', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { orderId } = req.params;
    const data = await kucoinMarginClient.getMarginStopOrderById(orderId);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar stop order margin por ID');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/margin/stop-orders/by-client-oid/:clientOid - Detalhes stop order por clientOid
app.get('/api/integrations/trading/margin/stop-orders/by-client-oid/:clientOid', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { clientOid } = req.params;
    const symbol = req.query.symbol as string | undefined;
    const data = await kucoinMarginClient.getMarginStopOrderByClientOid(clientOid, symbol);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar stop order margin por clientOid');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/margin/risk-limit - Risk limit para moedas margin
app.get('/api/integrations/trading/margin/risk-limit', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const isIsolated = req.query.isIsolated === 'true';
    const symbol = req.query.symbol as string | undefined;
    const data = await kucoinMarginClient.getMarginRiskLimit(isIsolated, symbol);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar risk limit margin');
    res.status(500).json({ error: errorMessage });
  }
});

}
