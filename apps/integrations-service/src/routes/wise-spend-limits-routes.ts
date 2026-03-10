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

interface RegisterWiseSpendLimitsRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  isWiseConfigured: () => boolean;
  parseWiseProfileIdQuery: (input: unknown) => SafeParseReturnType<unknown, ProfileIdQuery>;
  parseWiseCardTokenParam: (input: unknown) => SafeParseReturnType<unknown, CardTokenParam>;
  parseWiseGenericPayload: (input: unknown) => SafeParseReturnType<unknown, Record<string, unknown>>;
  getSpendLimits: (profileId: number) => Promise<unknown>;
  updateSpendLimits: (profileId: number, payload: Record<string, unknown>) => Promise<unknown>;
  getCardSpendLimits: (profileId: number, cardToken: string) => Promise<unknown>;
  updateCardSpendLimits: (profileId: number, cardToken: string, payload: Record<string, unknown>) => Promise<unknown>;
  deleteCardSpendLimits: (profileId: number, cardToken: string) => Promise<void>;
}

export function registerWiseSpendLimitsRoutes(
  app: Express,
  deps: RegisterWiseSpendLimitsRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');
  const {
    isWiseConfigured,
    parseWiseProfileIdQuery,
    parseWiseCardTokenParam,
    parseWiseGenericPayload,
    getSpendLimits,
    updateSpendLimits,
    getCardSpendLimits,
    updateCardSpendLimits,
    deleteCardSpendLimits,
  } = deps;

  app.get('/api/integrations/wise/spend-limits/profile', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    if (!profileParsed.success) {
      return res.status(400).json({ error: 'profileId inválido', details: profileParsed.error.format() });
    }
    try {
      const limits = await getSpendLimits(profileParsed.data.profileId);
      res.json({ limits });
    } catch (error) {
      logger.error({ error }, 'Falha ao obter spend limits Wise');
      res.status(500).json({ error: 'Falha ao obter spend limits' });
    }
  });

  app.patch('/api/integrations/wise/spend-limits/profile', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    const bodyParsed = parseWiseGenericPayload(req.body);
    if (!profileParsed.success || !bodyParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), body: bodyParsed.error?.format() } });
    }
    try {
      const limits = await updateSpendLimits(profileParsed.data.profileId, bodyParsed.data);
      res.json({ limits });
    } catch (error) {
      logger.error({ error }, 'Falha ao atualizar spend limits Wise');
      res.status(500).json({ error: 'Falha ao atualizar spend limits' });
    }
  });

  app.get('/api/integrations/wise/spend-limits/cards/:cardToken', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    const tokenParsed = parseWiseCardTokenParam(req.params);
    if (!profileParsed.success || !tokenParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), token: tokenParsed.error?.format() } });
    }
    try {
      const limits = await getCardSpendLimits(profileParsed.data.profileId, tokenParsed.data.cardToken);
      res.json({ limits });
    } catch (error) {
      logger.error({ error }, 'Falha ao obter spend limits do cartão');
      res.status(500).json({ error: 'Falha ao obter spend limits do cartão' });
    }
  });

  app.patch('/api/integrations/wise/spend-limits/cards/:cardToken', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
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
      const limits = await updateCardSpendLimits(profileParsed.data.profileId, tokenParsed.data.cardToken, bodyParsed.data);
      res.json({ limits });
    } catch (error) {
      logger.error({ error }, 'Falha ao atualizar spend limits do cartão');
      res.status(500).json({ error: 'Falha ao atualizar spend limits do cartão' });
    }
  });

  app.delete('/api/integrations/wise/spend-limits/cards/:cardToken', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    const tokenParsed = parseWiseCardTokenParam(req.params);
    if (!profileParsed.success || !tokenParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), token: tokenParsed.error?.format() } });
    }
    try {
      await deleteCardSpendLimits(profileParsed.data.profileId, tokenParsed.data.cardToken);
      res.json({ success: true });
    } catch (error) {
      logger.error({ error }, 'Falha ao remover spend limits do cartão');
      res.status(500).json({ error: 'Falha ao remover spend limits do cartão' });
    }
  });
}
