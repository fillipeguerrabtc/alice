import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { requirePermission } from '@alice/shared-utils';
import type { SafeParseReturnType } from 'zod';

interface ProfileIdQuery {
  profileId: number;
}

interface CardOrdersQuery {
  pageNumber?: number;
  pageSize?: number;
}

interface CardOrderIdParam {
  cardOrderId: string;
}

interface WiseAuthContext {
  tenantId: string;
}

interface RegisterWiseCardOrdersRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  isWiseConfigured: () => boolean;
  getWiseAuthContext: (req: Request) => WiseAuthContext;
  parseWiseProfileIdQuery: (input: unknown) => SafeParseReturnType<unknown, ProfileIdQuery>;
  parseWiseCardOrdersQuery: (input: unknown) => SafeParseReturnType<unknown, CardOrdersQuery>;
  parseWiseCardOrderIdParam: (input: unknown) => SafeParseReturnType<unknown, CardOrderIdParam>;
  parseWiseGenericPayload: (input: unknown) => SafeParseReturnType<unknown, Record<string, unknown>>;
  listCardOrders: (profileId: number, pageNumber: number, pageSize: number) => Promise<unknown>;
  createCardOrder: (profileId: number, payload: Record<string, unknown>) => Promise<unknown>;
  listCardOrderAvailability: (profileId: number) => Promise<unknown>;
  getCardOrder: (profileId: number, cardOrderId: string) => Promise<unknown>;
  getCardOrderRequirements: (profileId: number, cardOrderId: string) => Promise<unknown>;
  updateCardOrderStatus: (profileId: number, cardOrderId: string, payload: Record<string, unknown>) => Promise<unknown>;
  validateCardOrderAddress: (payload: Record<string, unknown>) => Promise<unknown>;
  setCardOrderPin: (cardOrderId: string, payload: Record<string, unknown>) => Promise<unknown>;
  upsertWiseCardOrders: (tenantId: string, orders: Array<Record<string, unknown>>) => Promise<void>;
}

export function registerWiseCardOrdersRoutes(
  app: Express,
  deps: RegisterWiseCardOrdersRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');
  const {
    isWiseConfigured,
    getWiseAuthContext,
    parseWiseProfileIdQuery,
    parseWiseCardOrdersQuery,
    parseWiseCardOrderIdParam,
    parseWiseGenericPayload,
    listCardOrders,
    createCardOrder,
    listCardOrderAvailability,
    getCardOrder,
    getCardOrderRequirements,
    updateCardOrderStatus,
    validateCardOrderAddress,
    setCardOrderPin,
    upsertWiseCardOrders,
  } = deps;

  app.get('/api/integrations/wise/card-orders', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    const queryParsed = parseWiseCardOrdersQuery(req.query);
    if (!profileParsed.success || !queryParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), query: queryParsed.error?.format() } });
    }
    try {
      const auth = getWiseAuthContext(req);
      const pageNumber = queryParsed.data.pageNumber ?? 1;
      const pageSize = queryParsed.data.pageSize ?? 10;
      const ordersPayload = await listCardOrders(profileParsed.data.profileId, pageNumber, pageSize);
      const ordersRecord = typeof ordersPayload === 'object' && ordersPayload !== null
        ? ordersPayload as Record<string, unknown>
        : {};
      const items = Array.isArray(ordersRecord.content)
        ? ordersRecord.content as Array<Record<string, unknown>>
        : [];
      await upsertWiseCardOrders(auth.tenantId, items);
      res.json({ orders: ordersPayload });
    } catch (error) {
      logger.error({ error }, 'Falha ao listar card orders Wise');
      res.status(500).json({ error: 'Falha ao listar card orders' });
    }
  });

  app.post('/api/integrations/wise/card-orders', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    const bodyParsed = parseWiseGenericPayload(req.body);
    if (!profileParsed.success || !bodyParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), body: bodyParsed.error?.format() } });
    }
    try {
      const auth = getWiseAuthContext(req);
      const orderPayload = await createCardOrder(profileParsed.data.profileId, bodyParsed.data);
      const order = typeof orderPayload === 'object' && orderPayload !== null
        ? orderPayload as Record<string, unknown>
        : {};
      await upsertWiseCardOrders(auth.tenantId, [order]);
      res.json({ order: orderPayload });
    } catch (error) {
      logger.error({ error }, 'Falha ao criar card order Wise');
      res.status(500).json({ error: 'Falha ao criar card order' });
    }
  });

  app.get('/api/integrations/wise/card-orders/availability', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    if (!profileParsed.success) {
      return res.status(400).json({ error: 'profileId inválido', details: profileParsed.error.format() });
    }
    try {
      const availability = await listCardOrderAvailability(profileParsed.data.profileId);
      res.json({ availability });
    } catch (error) {
      logger.error({ error }, 'Falha ao obter disponibilidade de card order');
      res.status(500).json({ error: 'Falha ao obter disponibilidade' });
    }
  });

  app.get('/api/integrations/wise/card-orders/:cardOrderId', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    const idParsed = parseWiseCardOrderIdParam(req.params);
    if (!profileParsed.success || !idParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), id: idParsed.error?.format() } });
    }
    try {
      const auth = getWiseAuthContext(req);
      const orderPayload = await getCardOrder(profileParsed.data.profileId, idParsed.data.cardOrderId);
      const order = typeof orderPayload === 'object' && orderPayload !== null
        ? orderPayload as Record<string, unknown>
        : {};
      await upsertWiseCardOrders(auth.tenantId, [order]);
      res.json({ order: orderPayload });
    } catch (error) {
      logger.error({ error }, 'Falha ao obter card order Wise');
      res.status(500).json({ error: 'Falha ao obter card order' });
    }
  });

  app.get('/api/integrations/wise/card-orders/:cardOrderId/requirements', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    const idParsed = parseWiseCardOrderIdParam(req.params);
    if (!profileParsed.success || !idParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), id: idParsed.error?.format() } });
    }
    try {
      const requirements = await getCardOrderRequirements(profileParsed.data.profileId, idParsed.data.cardOrderId);
      res.json({ requirements });
    } catch (error) {
      logger.error({ error }, 'Falha ao obter requisitos do card order');
      res.status(500).json({ error: 'Falha ao obter requisitos' });
    }
  });

  app.put('/api/integrations/wise/card-orders/:cardOrderId/status', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    const idParsed = parseWiseCardOrderIdParam(req.params);
    const bodyParsed = parseWiseGenericPayload(req.body);
    if (!profileParsed.success || !idParsed.success || !bodyParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), id: idParsed.error?.format(), body: bodyParsed.error?.format() } });
    }
    try {
      const auth = getWiseAuthContext(req);
      const orderPayload = await updateCardOrderStatus(profileParsed.data.profileId, idParsed.data.cardOrderId, bodyParsed.data);
      const order = typeof orderPayload === 'object' && orderPayload !== null
        ? orderPayload as Record<string, unknown>
        : {};
      await upsertWiseCardOrders(auth.tenantId, [order]);
      res.json({ order: orderPayload });
    } catch (error) {
      logger.error({ error }, 'Falha ao atualizar status do card order');
      res.status(500).json({ error: 'Falha ao atualizar status do card order' });
    }
  });

  app.post('/api/integrations/wise/card-orders/validate-address', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const bodyParsed = parseWiseGenericPayload(req.body);
    if (!bodyParsed.success) {
      return res.status(400).json({ error: 'Payload inválido', details: bodyParsed.error.format() });
    }
    try {
      const result = await validateCardOrderAddress(bodyParsed.data);
      res.json({ result });
    } catch (error) {
      logger.error({ error }, 'Falha ao validar endereço Wise');
      res.status(500).json({ error: 'Falha ao validar endereço' });
    }
  });

  app.post('/api/integrations/wise/card-orders/:cardOrderId/preset-pin', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const idParsed = parseWiseCardOrderIdParam(req.params);
    const bodyParsed = parseWiseGenericPayload(req.body);
    if (!idParsed.success || !bodyParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { id: idParsed.error?.format(), body: bodyParsed.error?.format() } });
    }
    try {
      const result = await setCardOrderPin(idParsed.data.cardOrderId, bodyParsed.data);
      res.json({ result });
    } catch (error) {
      logger.error({ error }, 'Falha ao definir PIN do card order');
      res.status(500).json({ error: 'Falha ao definir PIN' });
    }
  });
}
