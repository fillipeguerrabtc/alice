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

interface WiseAuthContext {
  tenantId: string;
}

interface RegisterWiseCardManagementRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  isWiseConfigured: () => boolean;
  getWiseAuthContext: (req: Request) => WiseAuthContext;
  parseWiseProfileIdQuery: (input: unknown) => SafeParseReturnType<unknown, ProfileIdQuery>;
  parseWiseCardTokenParam: (input: unknown) => SafeParseReturnType<unknown, CardTokenParam>;
  parseWiseGenericPayload: (input: unknown) => SafeParseReturnType<unknown, Record<string, unknown>>;
  listCards: (profileId: number) => Promise<unknown>;
  getCard: (profileId: number, cardToken: string) => Promise<unknown>;
  updateCardStatus: (profileId: number, cardToken: string, payload: Record<string, unknown>) => Promise<unknown>;
  resetCardPin: (profileId: number, cardToken: string) => Promise<unknown>;
  getCardPermissions: (profileId: number, cardToken: string) => Promise<unknown>;
  updateCardPermission: (profileId: number, cardToken: string, payload: Record<string, unknown>) => Promise<unknown>;
  updateCardPermissionsBulk: (profileId: number, payload: Record<string, unknown>) => Promise<unknown>;
  upsertWiseCards: (tenantId: string, cards: Array<Record<string, unknown>>) => Promise<void>;
}

export function registerWiseCardManagementRoutes(
  app: Express,
  deps: RegisterWiseCardManagementRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');
  const {
    isWiseConfigured,
    getWiseAuthContext,
    parseWiseProfileIdQuery,
    parseWiseCardTokenParam,
    parseWiseGenericPayload,
    listCards,
    getCard,
    updateCardStatus,
    resetCardPin,
    getCardPermissions,
    updateCardPermission,
    updateCardPermissionsBulk,
    upsertWiseCards,
  } = deps;

  app.get('/api/integrations/wise/cards', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const parsed = parseWiseProfileIdQuery(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'profileId inválido', details: parsed.error.format() });
    }
    try {
      const auth = getWiseAuthContext(req);
      const cardsPayload = await listCards(parsed.data.profileId);
      if (Array.isArray(cardsPayload)) {
        await upsertWiseCards(auth.tenantId, cardsPayload as Array<Record<string, unknown>>);
      }
      res.json({ cards: cardsPayload });
    } catch (error) {
      logger.error({ error }, 'Falha ao listar cartões Wise');
      res.status(500).json({ error: 'Falha ao listar cartões' });
    }
  });

  app.get('/api/integrations/wise/cards/:cardToken', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    const tokenParsed = parseWiseCardTokenParam(req.params);
    if (!profileParsed.success || !tokenParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), token: tokenParsed.error?.format() } });
    }
    try {
      const auth = getWiseAuthContext(req);
      const cardPayload = await getCard(profileParsed.data.profileId, tokenParsed.data.cardToken);
      const card = typeof cardPayload === 'object' && cardPayload !== null ? cardPayload as Record<string, unknown> : {};
      await upsertWiseCards(auth.tenantId, [card]);
      res.json({ card: cardPayload });
    } catch (error) {
      logger.error({ error }, 'Falha ao obter cartão Wise');
      res.status(500).json({ error: 'Falha ao obter cartão' });
    }
  });

  app.put('/api/integrations/wise/cards/:cardToken/status', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    const tokenParsed = parseWiseCardTokenParam(req.params);
    const bodyParsed = parseWiseGenericPayload(req.body);
    if (!profileParsed.success || !tokenParsed.success || !bodyParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), token: tokenParsed.error?.format(), body: bodyParsed.error?.format() } });
    }
    try {
      const auth = getWiseAuthContext(req);
      const cardPayload = await updateCardStatus(profileParsed.data.profileId, tokenParsed.data.cardToken, bodyParsed.data);
      const card = typeof cardPayload === 'object' && cardPayload !== null ? cardPayload as Record<string, unknown> : {};
      await upsertWiseCards(auth.tenantId, [card]);
      res.json({ card: cardPayload });
    } catch (error) {
      logger.error({ error }, 'Falha ao atualizar status do cartão Wise');
      res.status(500).json({ error: 'Falha ao atualizar status do cartão' });
    }
  });

  app.post('/api/integrations/wise/cards/:cardToken/pin/reset', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    const tokenParsed = parseWiseCardTokenParam(req.params);
    if (!profileParsed.success || !tokenParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), token: tokenParsed.error?.format() } });
    }
    try {
      const result = await resetCardPin(profileParsed.data.profileId, tokenParsed.data.cardToken);
      res.json({ result });
    } catch (error) {
      logger.error({ error }, 'Falha ao resetar PIN do cartão Wise');
      res.status(500).json({ error: 'Falha ao resetar PIN' });
    }
  });

  app.get('/api/integrations/wise/cards/:cardToken/permissions', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    const tokenParsed = parseWiseCardTokenParam(req.params);
    if (!profileParsed.success || !tokenParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), token: tokenParsed.error?.format() } });
    }
    try {
      const permissions = await getCardPermissions(profileParsed.data.profileId, tokenParsed.data.cardToken);
      res.json({ permissions });
    } catch (error) {
      logger.error({ error }, 'Falha ao obter permissões do cartão Wise');
      res.status(500).json({ error: 'Falha ao obter permissões do cartão' });
    }
  });

  app.put('/api/integrations/wise/cards/:cardToken/permissions', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    const tokenParsed = parseWiseCardTokenParam(req.params);
    const bodyParsed = parseWiseGenericPayload(req.body);
    if (!profileParsed.success || !tokenParsed.success || !bodyParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), token: tokenParsed.error?.format(), body: bodyParsed.error?.format() } });
    }
    try {
      const permissions = await updateCardPermission(profileParsed.data.profileId, tokenParsed.data.cardToken, bodyParsed.data);
      res.json({ permissions });
    } catch (error) {
      logger.error({ error }, 'Falha ao atualizar permissões do cartão Wise');
      res.status(500).json({ error: 'Falha ao atualizar permissões do cartão' });
    }
  });

  app.put('/api/integrations/wise/cards/permissions', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    const bodyParsed = parseWiseGenericPayload(req.body);
    if (!profileParsed.success || !bodyParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), body: bodyParsed.error?.format() } });
    }
    try {
      const result = await updateCardPermissionsBulk(profileParsed.data.profileId, bodyParsed.data);
      res.json({ result });
    } catch (error) {
      logger.error({ error }, 'Falha ao atualizar permissões em lote Wise');
      res.status(500).json({ error: 'Falha ao atualizar permissões em lote' });
    }
  });
}
