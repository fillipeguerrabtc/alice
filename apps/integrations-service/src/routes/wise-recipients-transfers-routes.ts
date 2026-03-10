import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { requirePermission } from '@alice/shared-utils';
import type { SafeParseReturnType } from 'zod';

interface WiseAuthContext {
  tenantId: string;
}

interface NumericIdParam {
  id: number;
}

interface BatchGroupIdParam {
  id: string;
}

interface RecipientsQuery {
  currency?: string;
}

interface PaginationQuery {
  limit?: number;
  offset?: number;
}

interface RegisterWiseRecipientsTransfersRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  isWiseConfigured: () => boolean;
  getWiseAuthContext: (req: Request) => WiseAuthContext;
  parseWiseRecipientsQuery: (input: unknown) => SafeParseReturnType<unknown, RecipientsQuery>;
  parseNumericIdParam: (input: unknown) => SafeParseReturnType<unknown, NumericIdParam>;
  parsePaginationQuery: (input: unknown) => SafeParseReturnType<unknown, PaginationQuery>;
  parseBatchGroupIdParam: (input: unknown) => SafeParseReturnType<unknown, BatchGroupIdParam>;
  listRecipients: (currency?: string) => Promise<Array<unknown>>;
  createRecipient: (payload: {
    currency: unknown;
    type: unknown;
    accountHolderName: unknown;
    details: unknown;
  }) => Promise<unknown>;
  getRecipient: (id: number) => Promise<unknown>;
  deleteRecipient: (id: number) => Promise<void>;
  deleteRecipientRecord: (tenantId: string, recipientId: number) => Promise<void>;
  upsertWiseRecipients: (tenantId: string, recipients: Array<unknown>) => Promise<void>;
  listTransfers: (limit: number, offset: number) => Promise<Array<unknown>>;
  createTransfer: (payload: {
    targetAccount: unknown;
    quoteUuid: unknown;
    customerTransactionId: string;
    details: unknown;
  }) => Promise<unknown>;
  getTransfer: (id: number) => Promise<unknown>;
  fundTransfer: (id: number) => Promise<unknown>;
  touchTransferRecord: (tenantId: string, transferId: number) => Promise<void>;
  cancelTransfer: (id: number) => Promise<unknown>;
  upsertWiseTransfers: (tenantId: string, transfers: Array<unknown>) => Promise<void>;
  listBatchGroups: () => Promise<unknown>;
  createBatchGroup: (payload: { name: unknown; sourceCurrency: unknown }) => Promise<unknown>;
  getBatchGroup: (id: string) => Promise<unknown>;
  completeBatchGroup: (id: string, version: unknown) => Promise<unknown>;
}

export function registerWiseRecipientsTransfersRoutes(
  app: Express,
  deps: RegisterWiseRecipientsTransfersRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');
  const {
    isWiseConfigured,
    getWiseAuthContext,
    parseWiseRecipientsQuery,
    parseNumericIdParam,
    parsePaginationQuery,
    parseBatchGroupIdParam,
    listRecipients,
    createRecipient,
    getRecipient,
    deleteRecipient,
    deleteRecipientRecord,
    upsertWiseRecipients,
    listTransfers,
    createTransfer,
    getTransfer,
    fundTransfer,
    touchTransferRecord,
    cancelTransfer,
    upsertWiseTransfers,
    listBatchGroups,
    createBatchGroup,
    getBatchGroup,
    completeBatchGroup,
  } = deps;

  app.get('/api/integrations/wise/recipients', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }

    const queryResult = parseWiseRecipientsQuery(req.query);
    if (!queryResult.success) {
      logger.warn({ errors: queryResult.error.flatten() }, 'Input inválido em /api/integrations/wise/recipients');
      return res.status(400).json({ error: 'Parâmetros inválidos', details: queryResult.error.format() });
    }

    const { currency } = queryResult.data;
    try {
      const auth = getWiseAuthContext(req);
      const recipients = await listRecipients(currency);
      await upsertWiseRecipients(auth.tenantId, recipients);
      res.json({ recipients });
    } catch (error) {
      logger.error({ error }, 'Falha ao listar destinatários Wise');
      res.status(500).json({ error: 'Falha ao listar destinatários' });
    }
  });

  app.post('/api/integrations/wise/recipients', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }

    const { currency, type, accountHolderName, details } = req.body as Record<string, unknown>;
    try {
      const auth = getWiseAuthContext(req);
      const recipient = await createRecipient({
        currency,
        type,
        accountHolderName,
        details,
      });
      await upsertWiseRecipients(auth.tenantId, [recipient]);
      res.json({ recipient });
    } catch (error) {
      logger.error({ error }, 'Falha ao criar destinatário Wise');
      res.status(500).json({ error: 'Falha ao criar destinatário' });
    }
  });

  app.get('/api/integrations/wise/recipients/:id', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }

    const paramResult = parseNumericIdParam(req.params);
    if (!paramResult.success) {
      return res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
    }

    try {
      const auth = getWiseAuthContext(req);
      const recipient = await getRecipient(paramResult.data.id);
      await upsertWiseRecipients(auth.tenantId, [recipient]);
      res.json({ recipient });
    } catch (error) {
      logger.error({ error }, 'Falha ao obter destinatário Wise');
      res.status(500).json({ error: 'Falha ao obter destinatário' });
    }
  });

  app.delete('/api/integrations/wise/recipients/:id', requirePermission('integrations:wise:delete'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }

    const paramResult = parseNumericIdParam(req.params);
    if (!paramResult.success) {
      return res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
    }

    try {
      const auth = getWiseAuthContext(req);
      await deleteRecipient(paramResult.data.id);
      await deleteRecipientRecord(auth.tenantId, paramResult.data.id);
      res.json({ success: true });
    } catch (error) {
      logger.error({ error }, 'Falha ao excluir destinatário Wise');
      res.status(500).json({ error: 'Falha ao excluir destinatário' });
    }
  });

  app.get('/api/integrations/wise/transfers', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }

    const queryResult = parsePaginationQuery(req.query);
    if (!queryResult.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: queryResult.error.format() });
    }
    const limit = queryResult.data.limit ?? 20;
    const offset = queryResult.data.offset ?? 0;

    try {
      const auth = getWiseAuthContext(req);
      const transfers = await listTransfers(limit, offset);
      await upsertWiseTransfers(auth.tenantId, transfers);
      res.json({ transfers });
    } catch (error) {
      logger.error({ error }, 'Falha ao listar transferências Wise');
      res.status(500).json({ error: 'Falha ao listar transferências' });
    }
  });

  app.post('/api/integrations/wise/transfers', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }

    const { targetAccount, quoteUuid, customerTransactionId, details } = req.body as Record<string, unknown>;
    try {
      const auth = getWiseAuthContext(req);
      const transfer = await createTransfer({
        targetAccount,
        quoteUuid,
        customerTransactionId: typeof customerTransactionId === 'string' && customerTransactionId.trim().length > 0
          ? customerTransactionId
          : `alice-${Date.now()}`,
        details: details ?? { reference: 'Pagamento Alice' },
      });

      await upsertWiseTransfers(auth.tenantId, [transfer]);
      const transferId = typeof transfer === 'object' && transfer !== null && 'id' in transfer
        ? (transfer as { id: unknown }).id
        : undefined;
      logger.info({ transferId, targetAccount }, 'Transferência Wise criada');
      res.json({ transfer });
    } catch (error) {
      logger.error({ error }, 'Falha ao criar transferência Wise');
      res.status(500).json({ error: 'Falha ao criar transferência' });
    }
  });

  app.get('/api/integrations/wise/transfers/:id', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }

    const paramResult = parseNumericIdParam(req.params);
    if (!paramResult.success) {
      return res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
    }

    try {
      const auth = getWiseAuthContext(req);
      const transfer = await getTransfer(paramResult.data.id);
      await upsertWiseTransfers(auth.tenantId, [transfer]);
      res.json({ transfer });
    } catch (error) {
      logger.error({ error }, 'Falha ao obter transferência Wise');
      res.status(500).json({ error: 'Falha ao obter transferência' });
    }
  });

  app.post('/api/integrations/wise/transfers/:id/fund', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }

    const paramResult = parseNumericIdParam(req.params);
    if (!paramResult.success) {
      return res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
    }

    try {
      const auth = getWiseAuthContext(req);
      const result = await fundTransfer(paramResult.data.id);
      await touchTransferRecord(auth.tenantId, paramResult.data.id);
      res.json({ result });
    } catch (error) {
      logger.error({ error }, 'Falha ao financiar transferência Wise');
      res.status(500).json({ error: 'Falha ao financiar transferência' });
    }
  });

  app.post('/api/integrations/wise/transfers/:id/cancel', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }

    const paramResult = parseNumericIdParam(req.params);
    if (!paramResult.success) {
      return res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
    }

    try {
      const auth = getWiseAuthContext(req);
      const transfer = await cancelTransfer(paramResult.data.id);
      await upsertWiseTransfers(auth.tenantId, [transfer]);
      res.json({ transfer });
    } catch (error) {
      logger.error({ error }, 'Falha ao cancelar transferência Wise');
      res.status(500).json({ error: 'Falha ao cancelar transferência' });
    }
  });

  app.get('/api/integrations/wise/batch-groups', requirePermission('integrations:wise:read'), async (_req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }

    try {
      const batchGroups = await listBatchGroups();
      res.json({ batchGroups });
    } catch (error) {
      logger.error({ error }, 'Falha ao listar batch groups Wise');
      res.status(500).json({ error: 'Falha ao listar batch groups' });
    }
  });

  app.post('/api/integrations/wise/batch-groups', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }

    const { name, sourceCurrency } = req.body as Record<string, unknown>;
    try {
      const batchGroup = await createBatchGroup({ name, sourceCurrency });
      res.json({ batchGroup });
    } catch (error) {
      logger.error({ error }, 'Falha ao criar batch group Wise');
      res.status(500).json({ error: 'Falha ao criar batch group' });
    }
  });

  app.get('/api/integrations/wise/batch-groups/:id', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }

    const paramResult = parseBatchGroupIdParam(req.params);
    if (!paramResult.success) {
      return res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
    }

    try {
      const batchGroup = await getBatchGroup(paramResult.data.id);
      res.json({ batchGroup });
    } catch (error) {
      logger.error({ error }, 'Falha ao obter batch group Wise');
      res.status(500).json({ error: 'Falha ao obter batch group' });
    }
  });

  app.post('/api/integrations/wise/batch-groups/:id/complete', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }

    const paramResult = parseBatchGroupIdParam(req.params);
    if (!paramResult.success) {
      return res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
    }

    const { version } = req.body as Record<string, unknown>;
    try {
      const batchGroup = await completeBatchGroup(paramResult.data.id, version);
      res.json({ batchGroup });
    } catch (error) {
      logger.error({ error }, 'Falha ao completar batch group Wise');
      res.status(500).json({ error: 'Falha ao completar batch group' });
    }
  });
}
