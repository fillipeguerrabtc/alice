import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { requirePermission } from '@alice/shared-utils';
import type { SafeParseReturnType } from 'zod';

interface ProfileIdQuery {
  profileId: number;
}

interface CardTokenParam {
  cardToken: string;
}

interface TransactionIdParam {
  transactionId: string;
}

interface WiseAuthContext {
  tenantId: string;
}

interface RegisterWiseCardSecureRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  isWiseConfigured: () => boolean;
  getWiseAuthContext: (req: Request) => WiseAuthContext;
  parseWiseProfileIdQuery: (input: unknown) => SafeParseReturnType<unknown, ProfileIdQuery>;
  parseWiseCardTokenQuery: (input: unknown) => SafeParseReturnType<unknown, CardTokenParam>;
  parseWiseTransactionIdParam: (input: unknown) => SafeParseReturnType<unknown, TransactionIdParam>;
  parseWiseGenericPayload: (input: unknown) => SafeParseReturnType<unknown, Record<string, unknown>>;
  getCardTransaction: (profileId: number, transactionId: string) => Promise<unknown>;
  getTwCardEncryptionKey: () => Promise<unknown>;
  getSensitiveCardDetails: (cardToken: string, payload: Record<string, unknown>) => Promise<unknown>;
  getCardPin: (cardToken: string, payload: Record<string, unknown>) => Promise<unknown>;
  upsertWiseCardTransactions: (tenantId: string, transactions: Array<{ id: string } & Record<string, unknown>>) => Promise<void>;
}

export function registerWiseCardSecureRoutes(
  app: Express,
  deps: RegisterWiseCardSecureRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');
  const {
    isWiseConfigured,
    getWiseAuthContext,
    parseWiseProfileIdQuery,
    parseWiseCardTokenQuery,
    parseWiseTransactionIdParam,
    parseWiseGenericPayload,
    getCardTransaction,
    getTwCardEncryptionKey,
    getSensitiveCardDetails,
    getCardPin,
    upsertWiseCardTransactions,
  } = deps;

  app.get('/api/integrations/wise/cards/transactions/:transactionId', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    const transactionParsed = parseWiseTransactionIdParam(req.params);
    if (!profileParsed.success || !transactionParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), transaction: transactionParsed.error?.format() } });
    }
    try {
      const auth = getWiseAuthContext(req);
      const transactionPayload = await getCardTransaction(profileParsed.data.profileId, transactionParsed.data.transactionId);
      const transaction = typeof transactionPayload === 'object' && transactionPayload !== null
        ? transactionPayload as Record<string, unknown>
        : {};
      await upsertWiseCardTransactions(auth.tenantId, [{ id: transactionParsed.data.transactionId, ...transaction }]);
      res.json({ transaction: transactionPayload });
    } catch (error) {
      logger.error({ error }, 'Falha ao obter transação de cartão Wise');
      res.status(500).json({ error: 'Falha ao obter transação de cartão' });
    }
  });

  app.get('/api/integrations/wise/cards/secure/encryption-key', requirePermission('integrations:wise:read'), async (_req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    try {
      const key = await getTwCardEncryptionKey();
      res.json({ key });
    } catch (error) {
      logger.error({ error }, 'Falha ao obter chave de criptografia Wise');
      res.status(500).json({ error: 'Falha ao obter chave de criptografia' });
    }
  });

  app.post('/api/integrations/wise/cards/secure/details', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const tokenParsed = parseWiseCardTokenQuery(req.query);
    const bodyParsed = parseWiseGenericPayload(req.body);
    if (!tokenParsed.success || !bodyParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { token: tokenParsed.error?.format(), body: bodyParsed.error?.format() } });
    }
    try {
      const details = await getSensitiveCardDetails(tokenParsed.data.cardToken, bodyParsed.data);
      res.json({ details });
    } catch (error) {
      logger.error({ error }, 'Falha ao obter detalhes sensíveis Wise');
      res.status(500).json({ error: 'Falha ao obter detalhes sensíveis' });
    }
  });

  app.post('/api/integrations/wise/cards/secure/pin', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const tokenParsed = parseWiseCardTokenQuery(req.query);
    const bodyParsed = parseWiseGenericPayload(req.body);
    if (!tokenParsed.success || !bodyParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { token: tokenParsed.error?.format(), body: bodyParsed.error?.format() } });
    }
    try {
      const pin = await getCardPin(tokenParsed.data.cardToken, bodyParsed.data);
      res.json({ pin });
    } catch (error) {
      logger.error({ error }, 'Falha ao obter PIN Wise');
      res.status(500).json({ error: 'Falha ao obter PIN' });
    }
  });
}
