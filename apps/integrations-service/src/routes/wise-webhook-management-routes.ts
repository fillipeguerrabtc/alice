import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { requirePermission } from '@alice/shared-utils';
import type { SafeParseReturnType } from 'zod';

interface ProfileIdQuery {
  profileId: number;
}

interface WebhookIdParam {
  subscriptionId: string;
}

interface WiseAuthContext {
  tenantId: string;
}

interface WiseWebhookScope {
  profileId?: number;
  application: boolean;
}

interface RegisterWiseWebhookManagementRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  isWiseConfigured: () => boolean;
  getWiseAuthContext: (req: Request) => WiseAuthContext;
  parseWiseProfileIdQuery: (input: unknown) => SafeParseReturnType<unknown, ProfileIdQuery>;
  parseWiseWebhookIdParam: (input: unknown) => SafeParseReturnType<unknown, WebhookIdParam>;
  parseWiseGenericPayload: (input: unknown) => SafeParseReturnType<unknown, Record<string, unknown>>;
  listWebhooks: (scope: WiseWebhookScope) => Promise<unknown>;
  createWebhook: (scope: WiseWebhookScope, payload: Record<string, unknown>) => Promise<unknown>;
  deleteWebhook: (scope: WiseWebhookScope, subscriptionId: string) => Promise<void>;
  upsertWiseWebhookSubscriptions: (tenantId: string, subscriptions: Array<Record<string, unknown>>) => Promise<void>;
}

export function registerWiseWebhookManagementRoutes(
  app: Express,
  deps: RegisterWiseWebhookManagementRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');
  const {
    isWiseConfigured,
    getWiseAuthContext,
    parseWiseProfileIdQuery,
    parseWiseWebhookIdParam,
    parseWiseGenericPayload,
    listWebhooks,
    createWebhook,
    deleteWebhook,
    upsertWiseWebhookSubscriptions,
  } = deps;

  app.get('/api/integrations/wise/webhooks', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const application = String(req.query.application ?? '') === 'true';
    const profileParsed = parseWiseProfileIdQuery(req.query);
    let profileId: number | undefined;
    if (application) {
      profileId = undefined;
    } else if (profileParsed.success) {
      profileId = profileParsed.data.profileId;
    } else {
      return res.status(400).json({ error: 'profileId inválido', details: profileParsed.error?.format() });
    }
    try {
      const auth = getWiseAuthContext(req);
      const webhooks = await listWebhooks({ profileId, application });
      const items = Array.isArray((webhooks as Record<string, unknown>).content) ? (webhooks as Record<string, unknown>).content as Array<Record<string, unknown>> : [];
      await upsertWiseWebhookSubscriptions(auth.tenantId, items);
      res.json({ webhooks });
    } catch (error) {
      logger.error({ error }, 'Falha ao listar webhooks Wise');
      res.status(500).json({ error: 'Falha ao listar webhooks' });
    }
  });

  app.post('/api/integrations/wise/webhooks', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const application = String(req.query.application ?? '') === 'true';
    const profileParsed = parseWiseProfileIdQuery(req.query);
    const bodyParsed = parseWiseGenericPayload(req.body);
    let profileId: number | undefined;
    if (application) {
      profileId = undefined;
    } else if (profileParsed.success) {
      profileId = profileParsed.data.profileId;
    } else {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), body: bodyParsed.error?.format() } });
    }
    if (!bodyParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), body: bodyParsed.error?.format() } });
    }
    try {
      const auth = getWiseAuthContext(req);
      const webhook = await createWebhook({ profileId, application }, bodyParsed.data);
      await upsertWiseWebhookSubscriptions(auth.tenantId, [webhook as Record<string, unknown>]);
      res.json({ webhook });
    } catch (error) {
      logger.error({ error }, 'Falha ao criar webhook Wise');
      res.status(500).json({ error: 'Falha ao criar webhook' });
    }
  });

  app.delete('/api/integrations/wise/webhooks/:subscriptionId', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const application = String(req.query.application ?? '') === 'true';
    const profileParsed = parseWiseProfileIdQuery(req.query);
    const idParsed = parseWiseWebhookIdParam(req.params);
    let profileId: number | undefined;
    if (application) {
      profileId = undefined;
    } else if (profileParsed.success) {
      profileId = profileParsed.data.profileId;
    } else {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), id: idParsed.error?.format() } });
    }
    if (!idParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), id: idParsed.error?.format() } });
    }
    try {
      await deleteWebhook({ profileId, application }, idParsed.data.subscriptionId);
      res.status(204).send();
    } catch (error) {
      logger.error({ error }, 'Falha ao remover webhook Wise');
      res.status(500).json({ error: 'Falha ao remover webhook' });
    }
  });
}
