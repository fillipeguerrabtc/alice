import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { requirePermission } from '@alice/shared-utils';

interface KucoinAccountClientLike {
  isAccountConfigured: () => boolean;
  getAccountSummaryInfo: () => Promise<unknown>;
  getApikeyInfo: () => Promise<unknown>;
  getAccountTypeSpot: () => Promise<unknown>;
  getAccountDetailSpot: (accountId: string) => Promise<unknown>;
  getAccountLedgersSpotMargin: (params: Record<string, string>) => Promise<unknown>;
  getAccountLedgersTradeHf: (params: Record<string, string>) => Promise<unknown>;
  getAccountLedgersMarginHf: (params: Record<string, string>) => Promise<unknown>;
  getAccountLedgersFutures: (params: Record<string, string>) => Promise<unknown>;
  addSubAccount: (payload: unknown) => Promise<unknown>;
  addSubAccountMarginPermission: (subUserId: string) => Promise<unknown>;
  addSubAccountFuturesPermission: (subUserId: string) => Promise<unknown>;
  getSubAccountListSummary: (params: Record<string, string>) => Promise<unknown>;
  getSubAccountDetailBalance: (subUserId: string) => Promise<unknown>;
  getSubAccountListSpotBalance: (params: Record<string, string>) => Promise<unknown>;
  getSubAccountListFuturesBalance: (params: Record<string, string>) => Promise<unknown>;
  addDepositAddress: (currency: string, chain?: string) => Promise<unknown>;
  getDepositAddress: (currency: string, chain?: string) => Promise<unknown>;
  getDepositHistory: (params: Record<string, string>) => Promise<unknown>;
  getWithdrawalQuotas: (currency: string, chain?: string) => Promise<unknown>;
  withdraw: (payload: unknown) => Promise<unknown>;
  cancelWithdrawal: (id: string) => Promise<unknown>;
  getWithdrawalHistory: (params: Record<string, string>) => Promise<unknown>;
  getWithdrawalById: (id: string) => Promise<unknown>;
  getTransferQuotas: (currency: string, type: string) => Promise<unknown>;
  flexTransfer: (payload: unknown) => Promise<unknown>;
  getBasicFeeSpotMargin: (currencyType?: string) => Promise<unknown>;
  getActualFeeFutures: (symbol: string) => Promise<unknown>;
}

interface RegisterTradingAccountManagementRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  accountClient: KucoinAccountClientLike;
  respondKucoinNotConfigured: (res: Response) => void;
  sendKucoinErrorResponse: (res: Response, error: unknown) => boolean;
}

function cleanQueryParams(params: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined),
  ) as Record<string, string>;
}

function ensureAccountConfigured(
  res: Response,
  deps: RegisterTradingAccountManagementRoutesDeps,
): boolean {
  if (!deps.accountClient.isAccountConfigured()) {
    deps.respondKucoinNotConfigured(res);
    return false;
  }
  return true;
}

export function registerTradingAccountManagementRoutes(
  app: Express,
  deps: RegisterTradingAccountManagementRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');

  app.get('/api/integrations/trading/account/summary', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
    if (!ensureAccountConfigured(res, deps)) return;
    try {
      const data = await deps.accountClient.getAccountSummaryInfo();
      res.json({ success: true, data });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao buscar resumo da conta');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/integrations/trading/account/apikey', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
    if (!ensureAccountConfigured(res, deps)) return;
    try {
      const data = await deps.accountClient.getApikeyInfo();
      res.json({ success: true, data });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao buscar info da API key');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/integrations/trading/account/type/spot', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
    if (!ensureAccountConfigured(res, deps)) return;
    try {
      const data = await deps.accountClient.getAccountTypeSpot();
      res.json({ success: true, data });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao buscar tipo de conta spot');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/integrations/trading/account/detail/:accountId', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    if (!ensureAccountConfigured(res, deps)) return;
    try {
      const { accountId } = req.params;
      const data = await deps.accountClient.getAccountDetailSpot(accountId);
      res.json({ success: true, data });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao buscar detalhe de conta');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/integrations/trading/account/ledgers/spot-margin', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    if (!ensureAccountConfigured(res, deps)) return;
    try {
      const params = cleanQueryParams({
        currency: req.query.currency as string | undefined,
        direction: req.query.direction as string | undefined,
        bizType: req.query.bizType as string | undefined,
        startAt: req.query.startAt as string | undefined,
        endAt: req.query.endAt as string | undefined,
        currentPage: req.query.currentPage as string | undefined,
        pageSize: req.query.pageSize as string | undefined,
      });
      const data = await deps.accountClient.getAccountLedgersSpotMargin(params);
      res.json({ success: true, data });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao buscar ledger spot/margin');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/integrations/trading/account/ledgers/trade-hf', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    if (!ensureAccountConfigured(res, deps)) return;
    try {
      const params = cleanQueryParams({
        currency: req.query.currency as string | undefined,
        direction: req.query.direction as string | undefined,
        bizType: req.query.bizType as string | undefined,
        lastId: req.query.lastId as string | undefined,
        limit: req.query.limit as string | undefined,
        startAt: req.query.startAt as string | undefined,
        endAt: req.query.endAt as string | undefined,
      });
      const data = await deps.accountClient.getAccountLedgersTradeHf(params);
      res.json({ success: true, data });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao buscar ledger trade HF');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/integrations/trading/account/ledgers/margin-hf', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    if (!ensureAccountConfigured(res, deps)) return;
    try {
      const params = cleanQueryParams({
        currency: req.query.currency as string | undefined,
        direction: req.query.direction as string | undefined,
        bizType: req.query.bizType as string | undefined,
        lastId: req.query.lastId as string | undefined,
        limit: req.query.limit as string | undefined,
        startAt: req.query.startAt as string | undefined,
        endAt: req.query.endAt as string | undefined,
      });
      const data = await deps.accountClient.getAccountLedgersMarginHf(params);
      res.json({ success: true, data });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao buscar ledger margin HF');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/integrations/trading/account/ledgers/futures', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    if (!ensureAccountConfigured(res, deps)) return;
    try {
      const params = cleanQueryParams({
        currency: req.query.currency as string | undefined,
        type: req.query.type as string | undefined,
        offset: req.query.offset as string | undefined,
        forward: req.query.forward as string | undefined,
        maxCount: req.query.maxCount as string | undefined,
        startAt: req.query.startAt as string | undefined,
        endAt: req.query.endAt as string | undefined,
      });
      const data = await deps.accountClient.getAccountLedgersFutures(params);
      res.json({ success: true, data });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao buscar ledger futures');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.post('/api/integrations/trading/account/sub-accounts', requirePermission('integrations:trading:manage'), async (req: Request, res: Response) => {
    if (!ensureAccountConfigured(res, deps)) return;
    try {
      const data = await deps.accountClient.addSubAccount(req.body);
      res.json({ success: true, data });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao criar sub-conta');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.post('/api/integrations/trading/account/sub-accounts/:subUserId/margin', requirePermission('integrations:trading:manage'), async (req: Request, res: Response) => {
    if (!ensureAccountConfigured(res, deps)) return;
    try {
      const { subUserId } = req.params;
      const data = await deps.accountClient.addSubAccountMarginPermission(subUserId);
      res.json({ success: true, data });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao habilitar margin para sub-conta');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.post('/api/integrations/trading/account/sub-accounts/:subUserId/futures', requirePermission('integrations:trading:manage'), async (req: Request, res: Response) => {
    if (!ensureAccountConfigured(res, deps)) return;
    try {
      const { subUserId } = req.params;
      const data = await deps.accountClient.addSubAccountFuturesPermission(subUserId);
      res.json({ success: true, data });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao habilitar futures para sub-conta');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/integrations/trading/account/sub-accounts', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    if (!ensureAccountConfigured(res, deps)) return;
    try {
      const params = cleanQueryParams({
        currentPage: req.query.currentPage as string | undefined,
        pageSize: req.query.pageSize as string | undefined,
      });
      const data = await deps.accountClient.getSubAccountListSummary(params);
      res.json({ success: true, data });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao listar sub-contas');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/integrations/trading/account/sub-accounts/:subUserId/balance', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    if (!ensureAccountConfigured(res, deps)) return;
    try {
      const { subUserId } = req.params;
      const data = await deps.accountClient.getSubAccountDetailBalance(subUserId);
      res.json({ success: true, data });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao buscar balance de sub-conta');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/integrations/trading/account/sub-accounts/balances/spot', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    if (!ensureAccountConfigured(res, deps)) return;
    try {
      const params = cleanQueryParams({
        currentPage: req.query.currentPage as string | undefined,
        pageSize: req.query.pageSize as string | undefined,
      });
      const data = await deps.accountClient.getSubAccountListSpotBalance(params);
      res.json({ success: true, data });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao buscar balances spot de sub-contas');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/integrations/trading/account/sub-accounts/balances/futures', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    if (!ensureAccountConfigured(res, deps)) return;
    try {
      const params = cleanQueryParams({
        currency: req.query.currency as string | undefined,
      });
      const data = await deps.accountClient.getSubAccountListFuturesBalance(params);
      res.json({ success: true, data });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao buscar balances futures de sub-contas');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.post('/api/integrations/trading/account/deposit/address', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    if (!ensureAccountConfigured(res, deps)) return;
    try {
      const { currency, chain } = req.body as { currency?: string; chain?: string };
      if (!currency) {
        res.status(400).json({ error: 'Parâmetro currency é obrigatório' });
        return;
      }
      const data = await deps.accountClient.addDepositAddress(currency, chain);
      res.json({ success: true, data });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao criar endereço de depósito');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/integrations/trading/account/deposit/address', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    if (!ensureAccountConfigured(res, deps)) return;
    try {
      const currency = req.query.currency as string;
      const chain = req.query.chain as string | undefined;
      if (!currency) {
        res.status(400).json({ error: 'Parâmetro currency é obrigatório' });
        return;
      }
      const data = await deps.accountClient.getDepositAddress(currency, chain);
      res.json({ success: true, data });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao buscar endereço de depósito');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/integrations/trading/account/deposits', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    if (!ensureAccountConfigured(res, deps)) return;
    try {
      const params = cleanQueryParams({
        currency: req.query.currency as string | undefined,
        status: req.query.status as string | undefined,
        startAt: req.query.startAt as string | undefined,
        endAt: req.query.endAt as string | undefined,
        currentPage: req.query.currentPage as string | undefined,
        pageSize: req.query.pageSize as string | undefined,
      });
      const data = await deps.accountClient.getDepositHistory(params);
      res.json({ success: true, data });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao buscar histórico de depósitos');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/integrations/trading/account/withdrawal/quotas', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    if (!ensureAccountConfigured(res, deps)) return;
    try {
      const currency = req.query.currency as string;
      const chain = req.query.chain as string | undefined;
      if (!currency) {
        res.status(400).json({ error: 'Parâmetro currency é obrigatório' });
        return;
      }
      const data = await deps.accountClient.getWithdrawalQuotas(currency, chain);
      res.json({ success: true, data });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao buscar limites de withdrawal');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.post('/api/integrations/trading/account/withdraw', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    if (!ensureAccountConfigured(res, deps)) return;
    try {
      const data = await deps.accountClient.withdraw(req.body);
      res.json({ success: true, data });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao executar withdrawal');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.delete('/api/integrations/trading/account/withdrawals/:id', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    if (!ensureAccountConfigured(res, deps)) return;
    try {
      const { id } = req.params;
      await deps.accountClient.cancelWithdrawal(id);
      res.json({ success: true, data: { cancelledId: id } });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao cancelar withdrawal');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/integrations/trading/account/withdrawals', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    if (!ensureAccountConfigured(res, deps)) return;
    try {
      const params = cleanQueryParams({
        currency: req.query.currency as string | undefined,
        status: req.query.status as string | undefined,
        startAt: req.query.startAt as string | undefined,
        endAt: req.query.endAt as string | undefined,
        currentPage: req.query.currentPage as string | undefined,
        pageSize: req.query.pageSize as string | undefined,
      });
      const data = await deps.accountClient.getWithdrawalHistory(params);
      res.json({ success: true, data });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao buscar histórico de withdrawals');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/integrations/trading/account/withdrawals/:id', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    if (!ensureAccountConfigured(res, deps)) return;
    try {
      const { id } = req.params;
      const data = await deps.accountClient.getWithdrawalById(id);
      res.json({ success: true, data });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao buscar withdrawal por ID');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/integrations/trading/account/transfer/quotas', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    if (!ensureAccountConfigured(res, deps)) return;
    try {
      const currency = req.query.currency as string;
      const type = req.query.type as string;
      if (!currency || !type) {
        res.status(400).json({ error: 'Parâmetros currency e type são obrigatórios' });
        return;
      }
      const data = await deps.accountClient.getTransferQuotas(currency, type);
      res.json({ success: true, data });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao buscar limites de transferência');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.post('/api/integrations/trading/account/transfer', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    if (!ensureAccountConfigured(res, deps)) return;
    try {
      const data = await deps.accountClient.flexTransfer(req.body);
      res.json({ success: true, data });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao executar flex transfer');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/integrations/trading/account/fees/basic', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    if (!ensureAccountConfigured(res, deps)) return;
    try {
      const currencyType = req.query.currencyType as string | undefined;
      const data = await deps.accountClient.getBasicFeeSpotMargin(currencyType);
      res.json({ success: true, data });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao buscar fee básica');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/integrations/trading/account/fees/futures', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    if (!ensureAccountConfigured(res, deps)) return;
    try {
      const symbol = req.query.symbol as string;
      if (!symbol) {
        res.status(400).json({ error: 'Parâmetro symbol é obrigatório' });
        return;
      }
      const data = await deps.accountClient.getActualFeeFutures(symbol);
      res.json({ success: true, data });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao buscar fee futures');
      res.status(500).json({ error: errorMessage });
    }
  });
}
