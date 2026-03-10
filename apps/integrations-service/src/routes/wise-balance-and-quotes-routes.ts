import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { requirePermission } from '@alice/shared-utils';
import type { SafeParseReturnType } from 'zod';

interface WiseAuthContext {
  tenantId: string;
}

interface WiseBalancesQuery {
  types?: string;
}

interface BalanceIdParam {
  balanceId: number;
}

interface WiseBalanceStatementQuery {
  currency: string;
  intervalStart: string;
  intervalEnd: string;
  type?: 'COMPACT' | 'FLAT';
}

interface WiseCurrencyQuery {
  currency: string;
}

interface WiseRatesQuery {
  source: string;
  target: string;
}

interface WiseQuoteCreatePayload {
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount?: number;
  targetAmount?: number;
  payOut?: string | null;
  preferredPayIn?: string | null;
  targetAccount?: number;
}

interface RegisterWiseBalanceAndQuotesRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  isWiseConfigured: () => boolean;
  getWiseAuthContext: (req: Request) => WiseAuthContext;
  parseWiseBalancesQuery: (input: unknown) => SafeParseReturnType<unknown, WiseBalancesQuery>;
  parseWiseBalanceCreate: (input: unknown) => SafeParseReturnType<unknown, unknown>;
  parseBalanceIdParam: (input: unknown) => SafeParseReturnType<unknown, BalanceIdParam>;
  parseWiseBalanceStatementQuery: (input: unknown) => SafeParseReturnType<unknown, WiseBalanceStatementQuery>;
  parseWiseCurrencyQuery: (input: unknown) => SafeParseReturnType<unknown, WiseCurrencyQuery>;
  parseWiseRatesQuery: (input: unknown) => SafeParseReturnType<unknown, WiseRatesQuery>;
  parseWiseQuoteCreate: (input: unknown) => SafeParseReturnType<unknown, WiseQuoteCreatePayload>;
  parseWiseBalanceMovement: (input: unknown) => SafeParseReturnType<unknown, unknown>;
  getBalances: (types: Array<'STANDARD' | 'SAVINGS'>) => Promise<Array<unknown>>;
  createBalance: (payload: unknown) => Promise<unknown>;
  deleteBalance: (balanceId: number) => Promise<unknown>;
  deleteWiseBalanceRecord: (tenantId: string, balanceId: number) => Promise<void>;
  getBalanceStatement: (params: {
    balanceId: number;
    currency: string;
    intervalStart: string;
    intervalEnd: string;
    type?: 'COMPACT' | 'FLAT';
  }) => Promise<unknown>;
  getBalanceCapacity: (currency: string) => Promise<unknown>;
  getTotalFunds: (currency: string) => Promise<unknown>;
  getExchangeRates: (source: string, target: string) => Promise<unknown>;
  createQuote: (payload: WiseQuoteCreatePayload) => Promise<unknown>;
  createBalanceMovement: (payload: unknown) => Promise<unknown>;
  upsertWiseBalances: (tenantId: string, balances: Array<unknown>) => Promise<void>;
  upsertWiseQuotes: (tenantId: string, quote: unknown) => Promise<void>;
  isSandboxMode: () => boolean;
}

export function registerWiseBalanceAndQuotesRoutes(
  app: Express,
  deps: RegisterWiseBalanceAndQuotesRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');
  const {
    isWiseConfigured,
    getWiseAuthContext,
    parseWiseBalancesQuery,
    parseWiseBalanceCreate,
    parseBalanceIdParam,
    parseWiseBalanceStatementQuery,
    parseWiseCurrencyQuery,
    parseWiseRatesQuery,
    parseWiseQuoteCreate,
    parseWiseBalanceMovement,
    getBalances,
    createBalance,
    deleteBalance,
    deleteWiseBalanceRecord,
    getBalanceStatement,
    getBalanceCapacity,
    getTotalFunds,
    getExchangeRates,
    createQuote,
    createBalanceMovement,
    upsertWiseBalances,
    upsertWiseQuotes,
    isSandboxMode,
  } = deps;

  app.get('/api/integrations/wise/balances', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    try {
      const auth = getWiseAuthContext(req);
      const queryResult = parseWiseBalancesQuery(req.query);
      if (!queryResult.success) {
        logger.warn({ errors: queryResult.error.flatten() }, 'Input inválido em /api/integrations/wise/balances');
        return res.status(400).json({ error: 'Parâmetros inválidos', details: queryResult.error.format() });
      }

      const allowedTypes = ['STANDARD', 'SAVINGS'] as const;
      const rawTypes = queryResult.data.types
        ? queryResult.data.types.split(',').map((value) => value.trim()).filter(Boolean)
        : [...allowedTypes];
      const types = rawTypes.filter((type): type is (typeof allowedTypes)[number] => allowedTypes.includes(type as (typeof allowedTypes)[number]));
      if (types.length !== rawTypes.length) {
        return res.status(400).json({ error: 'Tipos inválidos. Use STANDARD e/ou SAVINGS.' });
      }

      const balances = await getBalances(types);
      await upsertWiseBalances(auth.tenantId, balances);
      res.json({ balances, sandbox: isSandboxMode() });
    } catch (error) {
      logger.error({ error }, 'Falha ao obter saldos Wise');
      res.status(500).json({ error: 'Falha ao obter saldos' });
    }
  });

  app.post('/api/integrations/wise/balances', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const parsed = parseWiseBalanceCreate(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
    }
    try {
      const auth = getWiseAuthContext(req);
      const balance = await createBalance(parsed.data);
      await upsertWiseBalances(auth.tenantId, [balance]);
      res.json({ balance });
    } catch (error) {
      logger.error({ error }, 'Falha ao criar saldo Wise');
      res.status(500).json({ error: 'Falha ao criar saldo' });
    }
  });

  app.delete('/api/integrations/wise/balances/:balanceId', requirePermission('integrations:wise:delete'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const parsed = parseBalanceIdParam(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: 'balanceId inválido', details: parsed.error.format() });
    }
    try {
      const auth = getWiseAuthContext(req);
      const balance = await deleteBalance(parsed.data.balanceId);
      await deleteWiseBalanceRecord(auth.tenantId, parsed.data.balanceId);
      res.json({ balance });
    } catch (error) {
      logger.error({ error }, 'Falha ao remover saldo Wise');
      res.status(500).json({ error: 'Falha ao remover saldo' });
    }
  });

  app.get('/api/integrations/wise/balances/:balanceId/statement', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const balanceParsed = parseBalanceIdParam(req.params);
    if (!balanceParsed.success) {
      return res.status(400).json({ error: 'balanceId inválido', details: balanceParsed.error.format() });
    }
    const queryParsed = parseWiseBalanceStatementQuery(req.query);
    if (!queryParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: queryParsed.error.format() });
    }
    try {
      const statement = await getBalanceStatement({
        balanceId: balanceParsed.data.balanceId,
        currency: queryParsed.data.currency,
        intervalStart: queryParsed.data.intervalStart,
        intervalEnd: queryParsed.data.intervalEnd,
        type: queryParsed.data.type,
      });
      res.json({ statement });
    } catch (error) {
      logger.error({ error }, 'Falha ao obter extrato Wise');
      res.status(500).json({ error: 'Falha ao obter extrato' });
    }
  });

  app.get('/api/integrations/wise/balance-capacity', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const queryParsed = parseWiseCurrencyQuery(req.query);
    if (!queryParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: queryParsed.error.format() });
    }
    try {
      const capacity = await getBalanceCapacity(queryParsed.data.currency);
      res.json({ capacity });
    } catch (error) {
      logger.error({ error }, 'Falha ao obter limite de depósito Wise');
      res.status(500).json({ error: 'Falha ao obter limite de depósito' });
    }
  });

  app.get('/api/integrations/wise/total-funds', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const queryParsed = parseWiseCurrencyQuery(req.query);
    if (!queryParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: queryParsed.error.format() });
    }
    try {
      const total = await getTotalFunds(queryParsed.data.currency);
      res.json({ total });
    } catch (error) {
      logger.error({ error }, 'Falha ao obter total de fundos Wise');
      res.status(500).json({ error: 'Falha ao obter total de fundos' });
    }
  });

  app.get('/api/integrations/wise/rates', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const queryResult = parseWiseRatesQuery(req.query);
    if (!queryResult.success) {
      logger.warn({ errors: queryResult.error.flatten() }, 'Input inválido em /api/integrations/wise/rates');
      return res.status(400).json({ error: 'Parâmetros inválidos', details: queryResult.error.format() });
    }
    const { source, target } = queryResult.data;
    try {
      const rate = await getExchangeRates(source, target);
      res.json({ rate });
    } catch (error) {
      logger.error({ error }, 'Falha ao obter taxa de câmbio Wise');
      res.status(500).json({ error: 'Falha ao obter taxa de câmbio' });
    }
  });

  app.post('/api/integrations/wise/quotes', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const parsed = parseWiseQuoteCreate(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
    }
    try {
      const auth = getWiseAuthContext(req);
      const quote = await createQuote({
        sourceCurrency: parsed.data.sourceCurrency,
        targetCurrency: parsed.data.targetCurrency,
        sourceAmount: parsed.data.sourceAmount,
        targetAmount: parsed.data.targetAmount,
        payOut: parsed.data.payOut,
        preferredPayIn: parsed.data.preferredPayIn,
        targetAccount: parsed.data.targetAccount,
      });
      await upsertWiseQuotes(auth.tenantId, quote);
      res.json({ quote });
    } catch (error) {
      logger.error({ error }, 'Falha ao criar cotação Wise');
      res.status(500).json({ error: 'Falha ao criar cotação' });
    }
  });

  app.post('/api/integrations/wise/balance-quotes', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const parsed = parseWiseQuoteCreate(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
    }
    try {
      const auth = getWiseAuthContext(req);
      const quote = await createQuote({
        sourceCurrency: parsed.data.sourceCurrency,
        targetCurrency: parsed.data.targetCurrency,
        sourceAmount: parsed.data.sourceAmount,
        targetAmount: parsed.data.targetAmount,
        payOut: 'BALANCE',
        preferredPayIn: 'BALANCE',
      });
      await upsertWiseQuotes(auth.tenantId, quote);
      res.json({ quote });
    } catch (error) {
      logger.error({ error }, 'Falha ao criar cotação de conversão Wise');
      res.status(500).json({ error: 'Falha ao criar cotação de conversão' });
    }
  });

  app.post('/api/integrations/wise/balance-movements', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const parsed = parseWiseBalanceMovement(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
    }
    try {
      const movement = await createBalanceMovement(parsed.data);
      res.json({ movement });
    } catch (error) {
      logger.error({ error }, 'Falha ao executar movimento de saldo Wise');
      res.status(500).json({ error: 'Falha ao executar movimento de saldo' });
    }
  });
}
