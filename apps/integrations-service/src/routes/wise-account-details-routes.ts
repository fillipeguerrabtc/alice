import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { requirePermission } from '@alice/shared-utils';
import type { SafeParseReturnType } from 'zod';

interface ProfileIdQuery {
  profileId: number;
}

interface RegisterWiseAccountDetailsRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  isWiseConfigured: () => boolean;
  parseWiseProfileIdQuery: (input: unknown) => SafeParseReturnType<unknown, ProfileIdQuery>;
  parseWiseGenericPayload: (input: unknown) => SafeParseReturnType<unknown, Record<string, unknown>>;
  getAccountDetails: (profileId: number) => Promise<unknown>;
  listAccountDetailsOrders: (profileId: number) => Promise<unknown>;
  createAccountDetailsOrder: (profileId: number, payload: Record<string, unknown>) => Promise<unknown>;
}

export function registerWiseAccountDetailsRoutes(
  app: Express,
  deps: RegisterWiseAccountDetailsRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');
  const {
    isWiseConfigured,
    parseWiseProfileIdQuery,
    parseWiseGenericPayload,
    getAccountDetails,
    listAccountDetailsOrders,
    createAccountDetailsOrder,
  } = deps;

  app.get('/api/integrations/wise/account-details', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const parsed = parseWiseProfileIdQuery(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'profileId inválido', details: parsed.error.format() });
    }
    try {
      const details = await getAccountDetails(parsed.data.profileId);
      res.json({ details });
    } catch (error) {
      logger.error({ error }, 'Falha ao obter account details Wise');
      res.status(500).json({ error: 'Falha ao obter account details' });
    }
  });

  app.get('/api/integrations/wise/account-details/orders', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const parsed = parseWiseProfileIdQuery(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'profileId inválido', details: parsed.error.format() });
    }
    try {
      const orders = await listAccountDetailsOrders(parsed.data.profileId);
      res.json({ orders });
    } catch (error) {
      logger.error({ error }, 'Falha ao listar account details orders');
      res.status(500).json({ error: 'Falha ao listar account details orders' });
    }
  });

  app.post('/api/integrations/wise/account-details/orders', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const queryParsed = parseWiseProfileIdQuery(req.query);
    if (!queryParsed.success) {
      return res.status(400).json({ error: 'profileId inválido', details: queryParsed.error.format() });
    }
    const bodyParsed = parseWiseGenericPayload(req.body);
    if (!bodyParsed.success) {
      return res.status(400).json({ error: 'Payload inválido', details: bodyParsed.error.format() });
    }
    try {
      const order = await createAccountDetailsOrder(queryParsed.data.profileId, bodyParsed.data);
      res.json({ order });
    } catch (error) {
      logger.error({ error }, 'Falha ao criar account details order');
      res.status(500).json({ error: 'Falha ao criar account details order' });
    }
  });
}
