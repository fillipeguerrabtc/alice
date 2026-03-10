import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { requirePermission } from '@alice/shared-utils';
import type { SafeParseReturnType } from 'zod';

interface RecipientRequirementsQuery {
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount: number;
}

interface ProfileIdParam {
  profileId: number;
}

interface NumericIdParam {
  id: number;
}

interface WiseActivityQuery {
  profileId?: number;
  monetaryResourceType?: string;
  status?: string;
  since?: string;
  until?: string;
  size?: number;
}

interface WiseAuthContext {
  tenantId: string;
}

interface RegisterWiseReferenceRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  isWiseConfigured: () => boolean;
  getWiseAuthContext: (req: Request) => WiseAuthContext;
  parseWiseRecipientRequirementsQuery: (input: unknown) => SafeParseReturnType<unknown, RecipientRequirementsQuery>;
  parseWiseProfileIdParam: (input: unknown) => SafeParseReturnType<unknown, ProfileIdParam>;
  parseNumericIdParam: (input: unknown) => SafeParseReturnType<unknown, NumericIdParam>;
  parseWiseActivityQuery: (input: unknown) => SafeParseReturnType<unknown, WiseActivityQuery>;
  getRecipientRequirements: (sourceCurrency: string, targetCurrency: string, sourceAmount: number) => Promise<unknown>;
  getProfiles: () => Promise<unknown>;
  getProfileById: (profileId: number) => Promise<unknown>;
  getCurrentUser: () => Promise<unknown>;
  getUserById: (id: number) => Promise<unknown>;
  listActivities: (query: WiseActivityQuery) => Promise<unknown>;
  upsertWiseProfiles: (tenantId: string, profiles: Array<{ id: number } & Record<string, unknown>>) => Promise<void>;
  upsertWiseUsers: (tenantId: string, users: Array<{ id: number } & Record<string, unknown>>) => Promise<void>;
  upsertWiseActivities: (tenantId: string, activities: Array<Record<string, unknown>>) => Promise<void>;
}

export function registerWiseReferenceRoutes(
  app: Express,
  deps: RegisterWiseReferenceRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');
  const {
    isWiseConfigured,
    getWiseAuthContext,
    parseWiseRecipientRequirementsQuery,
    parseWiseProfileIdParam,
    parseNumericIdParam,
    parseWiseActivityQuery,
    getRecipientRequirements,
    getProfiles,
    getProfileById,
    getCurrentUser,
    getUserById,
    listActivities,
    upsertWiseProfiles,
    upsertWiseUsers,
    upsertWiseActivities,
  } = deps;

  app.get('/api/integrations/wise/recipient-requirements', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }

    const queryResult = parseWiseRecipientRequirementsQuery(req.query);
    if (!queryResult.success) {
      logger.warn({ errors: queryResult.error.flatten() }, 'Input inválido em /api/integrations/wise/recipient-requirements');
      return res.status(400).json({ error: 'Parâmetros inválidos', details: queryResult.error.format() });
    }

    const { sourceCurrency, targetCurrency, sourceAmount } = queryResult.data;

    try {
      const requirements = await getRecipientRequirements(sourceCurrency, targetCurrency, sourceAmount);
      res.json({ requirements });
    } catch (error) {
      logger.error({ error }, 'Falha ao obter requisitos de destinatário Wise');
      res.status(500).json({ error: 'Falha ao obter requisitos' });
    }
  });

  app.get('/api/integrations/wise/profiles', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    try {
      const auth = getWiseAuthContext(req);
      const profilesPayload = await getProfiles();
      const profiles = Array.isArray(profilesPayload)
        ? profilesPayload.filter((profile): profile is { id: number } & Record<string, unknown> =>
          typeof profile === 'object'
          && profile !== null
          && typeof (profile as { id?: unknown }).id === 'number')
        : [];
      await upsertWiseProfiles(auth.tenantId, profiles);
      res.json({ profiles: profilesPayload });
    } catch (error) {
      logger.error({ error }, 'Falha ao obter perfis Wise');
      res.status(500).json({ error: 'Falha ao obter perfis' });
    }
  });

  app.get('/api/integrations/wise/profiles/:profileId', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const parsed = parseWiseProfileIdParam(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: 'profileId inválido', details: parsed.error.format() });
    }
    try {
      const auth = getWiseAuthContext(req);
      const profilePayload = await getProfileById(parsed.data.profileId);
      const profileRecord = typeof profilePayload === 'object' && profilePayload !== null
        ? profilePayload as Record<string, unknown>
        : {};
      await upsertWiseProfiles(auth.tenantId, [{ id: parsed.data.profileId, ...profileRecord }]);
      res.json({ profile: profilePayload });
    } catch (error) {
      logger.error({ error }, 'Falha ao obter perfil Wise');
      res.status(500).json({ error: 'Falha ao obter perfil' });
    }
  });

  app.get('/api/integrations/wise/users/me', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    try {
      const auth = getWiseAuthContext(req);
      const userPayload = await getCurrentUser();
      const userRecord = typeof userPayload === 'object' && userPayload !== null
        ? userPayload as Record<string, unknown>
        : {};
      const userId = typeof userRecord.id === 'number' ? userRecord.id : undefined;
      if (userId) {
        await upsertWiseUsers(auth.tenantId, [{ id: userId, ...userRecord }]);
      }
      res.json({ user: userPayload });
    } catch (error) {
      logger.error({ error }, 'Falha ao obter usuário Wise');
      res.status(500).json({ error: 'Falha ao obter usuário Wise' });
    }
  });

  app.get('/api/integrations/wise/users/:id', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const parsed = parseNumericIdParam(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: 'ID inválido', details: parsed.error.format() });
    }
    try {
      const auth = getWiseAuthContext(req);
      const userPayload = await getUserById(parsed.data.id);
      const userRecord = typeof userPayload === 'object' && userPayload !== null
        ? userPayload as Record<string, unknown>
        : {};
      await upsertWiseUsers(auth.tenantId, [{ id: parsed.data.id, ...userRecord }]);
      res.json({ user: userPayload });
    } catch (error) {
      logger.error({ error }, 'Falha ao obter usuário Wise');
      res.status(500).json({ error: 'Falha ao obter usuário Wise' });
    }
  });

  app.get('/api/integrations/wise/activities', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const parsed = parseWiseActivityQuery(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: parsed.error.format() });
    }
    try {
      const auth = getWiseAuthContext(req);
      const activities = await listActivities(parsed.data);
      if (Array.isArray(activities)) {
        await upsertWiseActivities(auth.tenantId, activities as Array<Record<string, unknown>>);
      }
      res.json({ activities });
    } catch (error) {
      logger.error({ error }, 'Falha ao listar atividades Wise');
      res.status(500).json({ error: 'Falha ao listar atividades' });
    }
  });
}
