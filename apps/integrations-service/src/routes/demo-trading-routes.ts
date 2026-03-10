import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { requirePermission } from '@alice/shared-utils';
import { Counter as PromCounter, Histogram as PromHistogram } from 'prom-client';
import { z } from 'zod';
import {
  addFunds as addDemoFunds,
  addToDemoPosition,
  cancelDemoOrder,
  closeDemoPosition,
  createDemoOrder,
  DemoTradingBusinessError,
  getAllBalances as getDemoBalances,
  getAllPositions as getDemoAllPositions,
  getFundHistory as getDemoFundHistory,
  getOpenPositions as getDemoOpenPositions,
  getOrCreateBalance as getDemoBalance,
  getOrders as getDemoOrders,
  updateDemoPositionRisk,
} from '../demo-trading-engine.js';

interface RegisterDemoTradingRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
}

function mapDemoTradingError(error: unknown): { status: 400 | 404 | 422 | 500; error: string; code?: string } {
  if (error instanceof DemoTradingBusinessError) {
    return {
      status: error.statusCode,
      error: error.message,
      code: error.code,
    };
  }

  const message = error instanceof Error ? error.message : 'Erro desconhecido';
  if (message.includes('Saldo insuficiente')) {
    return { status: 422, error: message, code: 'INSUFFICIENT_BALANCE' };
  }
  if (message.includes('não encontrada') || message.includes('não encontrado')) {
    return { status: 404, error: message, code: 'NOT_FOUND' };
  }
  if (message.includes('deve ser') || message.includes('invál') || message.includes('obrigatório')) {
    return { status: 422, error: message, code: 'INVALID_INPUT' };
  }

  return { status: 500, error: message };
}

const demoTradingRequestErrorsTotal = new PromCounter({
  name: 'alice_demo_trading_request_errors_total',
  help: 'Total de erros em rotas demo trading por status/código',
  labelNames: ['route', 'status', 'code'] as const,
});

const demoTradingRequestDurationMs = new PromHistogram({
  name: 'alice_demo_trading_request_duration_ms',
  help: 'Latência de rotas demo trading (ms)',
  labelNames: ['route', 'status_class'] as const,
  buckets: [25, 50, 100, 250, 500, 1000, 2000, 5000],
});

function recordDemoTradingError(route: string, mapped: { status: 400 | 404 | 422 | 500; code?: string }): void {
  demoTradingRequestErrorsTotal.inc({
    route,
    status: String(mapped.status),
    code: mapped.code ?? 'UNKNOWN',
  });
}

function recordDemoTradingLatency(route: string, startedAt: number, status: number): void {
  const elapsedMs = Math.max(0, Date.now() - startedAt);
  const statusClass = status >= 500 ? '5xx' : status >= 400 ? '4xx' : '2xx';
  demoTradingRequestDurationMs.observe({ route, status_class: statusClass }, elapsedMs);
}

export function registerDemoTradingRoutes(
  app: Express,
  deps: RegisterDemoTradingRoutesDeps = {},
): void {
  const logger = deps.logger ?? createLogger('integrations-service');

  // GET /api/integrations/demo-trading/balance - Buscar balance demo
  app.get('/api/integrations/demo-trading/balance', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) { res.status(403).json({ error: 'Tenant não identificado' }); return; }
      const balance = await getDemoBalance(tenantId);
      res.json({ success: true, data: balance });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao buscar balance demo');
      res.status(500).json({ error: errorMessage });
    }
  });

  // GET /api/integrations/demo-trading/balances - Listar todos os saldos demo por ativo
  app.get('/api/integrations/demo-trading/balances', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) { res.status(403).json({ error: 'Tenant não identificado' }); return; }
      const balances = await getDemoBalances(tenantId);
      res.json({ success: true, data: balances });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao buscar saldos demo');
      res.status(500).json({ error: errorMessage });
    }
  });

  // POST /api/integrations/demo-trading/funds - Adicionar fundos demo
  app.post('/api/integrations/demo-trading/funds', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    try {
      const { amount, currency, note } = req.body as { amount: number; currency?: string; note?: string };
      if (!amount || amount <= 0) {
        res.status(400).json({ error: 'amount deve ser um número positivo' });
        return;
      }
      const tenantId = req.tenantId;
      if (!tenantId) { res.status(403).json({ error: 'Tenant não identificado' }); return; }
      const result = await addDemoFunds({ tenantId, amount, currency, note });
      res.json({ success: true, data: result });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao adicionar fundos demo');
      res.status(500).json({ error: errorMessage });
    }
  });

  // GET /api/integrations/demo-trading/funds/history - Histórico de fundos
  app.get('/api/integrations/demo-trading/funds/history', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) { res.status(403).json({ error: 'Tenant não identificado' }); return; }
      const history = await getDemoFundHistory(tenantId);
      res.json({ success: true, data: history });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao buscar histórico de fundos demo');
      res.status(500).json({ error: errorMessage });
    }
  });

  // POST /api/integrations/demo-trading/orders - Criar ordem demo
  app.post('/api/integrations/demo-trading/orders', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    const startedAt = Date.now();
    try {
      const { symbol, marketType, side, orderType, size, price, leverage, stopLoss, takeProfit } = req.body as {
        symbol: string;
        marketType: 'spot' | 'futures' | 'margin';
        side: 'buy' | 'sell';
        orderType: 'market' | 'limit' | 'stop';
        size: number;
        price?: number;
        leverage?: number;
        stopLoss?: number;
        takeProfit?: number;
      };

      if (!symbol || !marketType || !side || !orderType || !size || size <= 0) {
        res.status(400).json({ error: 'Campos obrigatórios: symbol, marketType, side, orderType, size (positivo)' });
        return;
      }

      const tenantId = req.tenantId;
      if (!tenantId) { res.status(403).json({ error: 'Tenant não identificado' }); return; }

      const result = await createDemoOrder({
        tenantId,
        symbol,
        marketType,
        side,
        orderType,
        size,
        price,
        leverage,
        stopLoss,
        takeProfit,
      });

      recordDemoTradingLatency('/api/integrations/demo-trading/orders', startedAt, 201);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      const mapped = mapDemoTradingError(error);
      recordDemoTradingError('/api/integrations/demo-trading/orders', mapped);
      recordDemoTradingLatency('/api/integrations/demo-trading/orders', startedAt, mapped.status);
      if (mapped.status >= 500) {
        logger.error({ error: mapped.error }, 'Erro ao criar ordem demo');
      } else {
        logger.warn({ error: mapped.error, code: mapped.code }, 'Validação de ordem demo rejeitada');
      }
      res.status(mapped.status).json({ error: mapped.error, code: mapped.code });
    }
  });

  // POST /api/integrations/demo-trading/orders/from-signal - Criar ordem demo a partir de sinal IA
  app.post('/api/integrations/demo-trading/orders/from-signal', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    const startedAt = Date.now();
    try {
      const { signalId, symbol, marketType, side, size, leverage, stopLoss, takeProfit, entryType, price } = req.body as {
        signalId: string;
        symbol: string;
        marketType: 'spot' | 'futures' | 'margin';
        side: 'buy' | 'sell';
        size: number;
        leverage?: number;
        stopLoss?: number;
        takeProfit?: number;
        entryType?: 'market' | 'limit';
        price?: number;
      };

      if (!signalId || !symbol || !marketType || !side || !size || size <= 0) {
        res.status(400).json({ error: 'Campos obrigatórios: signalId, symbol, marketType, side, size (positivo)' });
        return;
      }

      const tenantId = req.tenantId;
      if (!tenantId) { res.status(403).json({ error: 'Tenant não identificado' }); return; }

      const result = await createDemoOrder({
        tenantId,
        symbol,
        marketType,
        side,
        orderType: entryType ?? 'market',
        size,
        price,
        leverage,
        stopLoss,
        takeProfit,
        signalId,
      });

      logger.info({ signalId, orderId: result.orderId, positionId: result.positionId }, 'Ordem demo criada a partir de sinal IA');

      recordDemoTradingLatency('/api/integrations/demo-trading/orders/from-signal', startedAt, 201);
      res.status(201).json({ success: true, data: { ...result, fromSignalId: signalId } });
    } catch (error) {
      const mapped = mapDemoTradingError(error);
      recordDemoTradingError('/api/integrations/demo-trading/orders/from-signal', mapped);
      recordDemoTradingLatency('/api/integrations/demo-trading/orders/from-signal', startedAt, mapped.status);
      if (mapped.status >= 500) {
        logger.error({ error: mapped.error }, 'Erro ao criar ordem demo a partir de sinal');
      } else {
        logger.warn({ error: mapped.error, code: mapped.code }, 'Ordem demo por sinal rejeitada por validação');
      }
      res.status(mapped.status).json({ error: mapped.error, code: mapped.code });
    }
  });

  // GET /api/integrations/demo-trading/orders - Listar ordens demo
  app.get('/api/integrations/demo-trading/orders', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const tenantId = req.tenantId;
      if (!tenantId) { res.status(403).json({ error: 'Tenant não identificado' }); return; }
      const orders = await getDemoOrders(tenantId, limit);
      res.json({ success: true, data: orders });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao listar ordens demo');
      res.status(500).json({ error: errorMessage });
    }
  });

  // DELETE /api/integrations/demo-trading/orders/:id - Cancelar ordem demo
  app.delete('/api/integrations/demo-trading/orders/:id', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    const startedAt = Date.now();
    try {
      const tenantId = req.tenantId;
      if (!tenantId) { res.status(403).json({ error: 'Tenant não identificado' }); return; }
      const orderId = req.params.id;
      if (!orderId) { res.status(400).json({ error: 'ID da ordem é obrigatório' }); return; }
      const success = await cancelDemoOrder(tenantId, orderId);
      if (!success) {
        recordDemoTradingLatency('/api/integrations/demo-trading/orders/:id', startedAt, 404);
        res.status(404).json({ error: 'Ordem não encontrada ou não pode ser cancelada' });
        return;
      }
      recordDemoTradingLatency('/api/integrations/demo-trading/orders/:id', startedAt, 200);
      res.json({ success: true });
    } catch (error) {
      const mapped = mapDemoTradingError(error);
      recordDemoTradingError('/api/integrations/demo-trading/orders/:id', mapped);
      recordDemoTradingLatency('/api/integrations/demo-trading/orders/:id', startedAt, mapped.status);
      if (mapped.status >= 500) {
        logger.error({ error: mapped.error }, 'Erro ao cancelar ordem demo');
      } else {
        logger.warn({ error: mapped.error, code: mapped.code }, 'Cancelamento de ordem demo rejeitado por validação');
      }
      res.status(mapped.status).json({ error: mapped.error, code: mapped.code });
    }
  });

  // GET /api/integrations/demo-trading/positions - Listar posições demo
  app.get('/api/integrations/demo-trading/positions', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) { res.status(403).json({ error: 'Tenant não identificado' }); return; }
      const status = req.query.status as string;
      const limit = parseInt(req.query.limit as string) || 50;
      let positions;
      if (status === 'open') {
        positions = await getDemoOpenPositions(tenantId);
      } else {
        positions = await getDemoAllPositions(tenantId, limit);
      }
      res.json({ success: true, data: positions });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao listar posições demo');
      res.status(500).json({ error: errorMessage });
    }
  });

  // POST /api/integrations/demo-trading/positions/:id/close - Fechar posição demo
  app.post('/api/integrations/demo-trading/positions/:id/close', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    const startedAt = Date.now();
    try {
      const tenantId = req.tenantId;
      if (!tenantId) { res.status(403).json({ error: 'Tenant não identificado' }); return; }
      const positionId = req.params.id;
      if (!positionId) { res.status(400).json({ error: 'ID da posição é obrigatório' }); return; }
      const closeSchema = z.object({
        size: z.number().positive().optional(),
      });
      const closeParsed = closeSchema.safeParse(req.body ?? {});
      if (!closeParsed.success) {
        res.status(400).json({ error: 'Dados inválidos para fechamento', details: closeParsed.error.flatten() });
        return;
      }

      const result = await closeDemoPosition({
        tenantId,
        positionId,
        reason: 'manual',
        size: closeParsed.data.size,
      });
      recordDemoTradingLatency('/api/integrations/demo-trading/positions/:id/close', startedAt, 200);
      res.json({ success: true, data: result });
    } catch (error) {
      const mapped = mapDemoTradingError(error);
      recordDemoTradingError('/api/integrations/demo-trading/positions/:id/close', mapped);
      recordDemoTradingLatency('/api/integrations/demo-trading/positions/:id/close', startedAt, mapped.status);
      if (mapped.status >= 500) {
        logger.error({ error: mapped.error }, 'Erro ao fechar posição demo');
      } else {
        logger.warn({ error: mapped.error, code: mapped.code }, 'Fechamento de posição demo rejeitado por validação');
      }
      res.status(mapped.status).json({ error: mapped.error, code: mapped.code });
    }
  });

  // PATCH /api/integrations/demo-trading/positions/:id - Atualizar SL/TP de posição demo
  app.patch('/api/integrations/demo-trading/positions/:id', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    const startedAt = Date.now();
    try {
      const tenantId = req.tenantId;
      if (!tenantId) { res.status(403).json({ error: 'Tenant não identificado' }); return; }
      const positionId = req.params.id;
      if (!positionId) { res.status(400).json({ error: 'ID da posição é obrigatório' }); return; }

      const bodySchema = z.object({
        stopLoss: z.number().positive().nullable().optional(),
        takeProfit: z.number().positive().nullable().optional(),
      }).refine((data) => data.stopLoss !== undefined || data.takeProfit !== undefined, {
        message: 'Informe stopLoss e/ou takeProfit para atualizar.',
      });

      const parsed = bodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
        return;
      }

      const updated = await updateDemoPositionRisk({
        tenantId,
        positionId,
        stopLoss: parsed.data.stopLoss,
        takeProfit: parsed.data.takeProfit,
      });

      recordDemoTradingLatency('/api/integrations/demo-trading/positions/:id', startedAt, 200);
      res.json({ success: true, data: updated });
    } catch (error) {
      const mapped = mapDemoTradingError(error);
      recordDemoTradingError('/api/integrations/demo-trading/positions/:id', mapped);
      recordDemoTradingLatency('/api/integrations/demo-trading/positions/:id', startedAt, mapped.status);
      if (mapped.status >= 500) {
        logger.error({ error: mapped.error }, 'Erro ao atualizar SL/TP da posição demo');
      } else {
        logger.warn({ error: mapped.error, code: mapped.code }, 'Atualização de SL/TP demo rejeitada por validação');
      }
      res.status(mapped.status).json({ error: mapped.error, code: mapped.code });
    }
  });

  // POST /api/integrations/demo-trading/positions/:id/add - Adicionar tamanho a posição demo
  app.post('/api/integrations/demo-trading/positions/:id/add', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    const startedAt = Date.now();
    try {
      const tenantId = req.tenantId;
      if (!tenantId) { res.status(403).json({ error: 'Tenant não identificado' }); return; }
      const positionId = req.params.id;
      if (!positionId) { res.status(400).json({ error: 'ID da posição é obrigatório' }); return; }

      const bodySchema = z.object({
        size: z.number().positive(),
        price: z.number().positive().optional(),
        stopLoss: z.number().positive().nullable().optional(),
        takeProfit: z.number().positive().nullable().optional(),
      });
      const parsed = bodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
        return;
      }

      const result = await addToDemoPosition({
        tenantId,
        positionId,
        size: parsed.data.size,
        price: parsed.data.price,
        stopLoss: parsed.data.stopLoss,
        takeProfit: parsed.data.takeProfit,
      });

      recordDemoTradingLatency('/api/integrations/demo-trading/positions/:id/add', startedAt, 200);
      res.json({ success: true, data: result });
    } catch (error) {
      const mapped = mapDemoTradingError(error);
      recordDemoTradingError('/api/integrations/demo-trading/positions/:id/add', mapped);
      recordDemoTradingLatency('/api/integrations/demo-trading/positions/:id/add', startedAt, mapped.status);
      if (mapped.status >= 500) {
        logger.error({ error: mapped.error }, 'Erro ao adicionar tamanho à posição demo');
      } else {
        logger.warn({ error: mapped.error, code: mapped.code }, 'Scale-in demo rejeitado por validação');
      }
      res.status(mapped.status).json({ error: mapped.error, code: mapped.code });
    }
  });
}
