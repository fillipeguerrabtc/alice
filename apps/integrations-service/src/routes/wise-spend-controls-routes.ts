import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { requirePermission } from '@alice/shared-utils';
import type { SafeParseReturnType } from 'zod';

interface ProfileIdQuery {
  profileId: number;
}

interface RuleIdParam {
  id: number;
}

interface WiseAuthContext {
  tenantId: string;
}

interface RegisterWiseSpendControlsRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  isWiseConfigured: () => boolean;
  getWiseAuthContext: (req: Request) => WiseAuthContext;
  parseWiseProfileIdQuery: (input: unknown) => SafeParseReturnType<unknown, ProfileIdQuery>;
  parseRuleIdParam: (input: unknown) => SafeParseReturnType<unknown, RuleIdParam>;
  parseWiseGenericPayload: (input: unknown) => SafeParseReturnType<unknown, Record<string, unknown>>;
  listSpendControls: (profileId: number) => Promise<unknown>;
  createSpendControl: (profileId: number, payload: Record<string, unknown>) => Promise<unknown>;
  deleteSpendControl: (profileId: number, ruleId: number) => Promise<void>;
  applySpendControl: (profileId: number, ruleId: number, payload: Record<string, unknown>) => Promise<unknown>;
  unassignSpendControl: (profileId: number, ruleId: number, payload: Record<string, unknown>) => Promise<unknown>;
  upsertWiseSpendControls: (tenantId: string, rules: Array<Record<string, unknown>>) => Promise<void>;
  deleteSpendControlRecord: (tenantId: string, ruleId: number) => Promise<void>;
}

export function registerWiseSpendControlsRoutes(
  app: Express,
  deps: RegisterWiseSpendControlsRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');
  const {
    isWiseConfigured,
    getWiseAuthContext,
    parseWiseProfileIdQuery,
    parseRuleIdParam,
    parseWiseGenericPayload,
    listSpendControls,
    createSpendControl,
    deleteSpendControl,
    applySpendControl,
    unassignSpendControl,
    upsertWiseSpendControls,
    deleteSpendControlRecord,
  } = deps;

  app.get('/api/integrations/wise/spend-controls', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    if (!profileParsed.success) {
      return res.status(400).json({ error: 'profileId inválido', details: profileParsed.error.format() });
    }
    try {
      const auth = getWiseAuthContext(req);
      const rulesPayload = await listSpendControls(profileParsed.data.profileId);
      if (Array.isArray(rulesPayload)) {
        await upsertWiseSpendControls(auth.tenantId, rulesPayload as Array<Record<string, unknown>>);
      }
      res.json({ rules: rulesPayload });
    } catch (error) {
      logger.error({ error }, 'Falha ao listar spend controls Wise');
      res.status(500).json({ error: 'Falha ao listar spend controls' });
    }
  });

  app.post('/api/integrations/wise/spend-controls', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
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
      const rulePayload = await createSpendControl(profileParsed.data.profileId, bodyParsed.data);
      const rule = typeof rulePayload === 'object' && rulePayload !== null
        ? rulePayload as Record<string, unknown>
        : {};
      await upsertWiseSpendControls(auth.tenantId, [rule]);
      res.json({ rule: rulePayload });
    } catch (error) {
      logger.error({ error }, 'Falha ao criar spend control Wise');
      res.status(500).json({ error: 'Falha ao criar spend control' });
    }
  });

  app.delete('/api/integrations/wise/spend-controls/:ruleId', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    const ruleParsed = parseRuleIdParam(req.params);
    if (!profileParsed.success || !ruleParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), rule: ruleParsed.error?.format() } });
    }
    try {
      const auth = getWiseAuthContext(req);
      await deleteSpendControl(profileParsed.data.profileId, ruleParsed.data.id);
      await deleteSpendControlRecord(auth.tenantId, ruleParsed.data.id);
      res.json({ success: true });
    } catch (error) {
      logger.error({ error }, 'Falha ao remover spend control Wise');
      res.status(500).json({ error: 'Falha ao remover spend control' });
    }
  });

  app.post('/api/integrations/wise/spend-controls/:ruleId/assign', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    const ruleParsed = parseRuleIdParam(req.params);
    const bodyParsed = parseWiseGenericPayload(req.body);
    if (!profileParsed.success || !ruleParsed.success || !bodyParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), rule: ruleParsed.error?.format(), body: bodyParsed.error?.format() } });
    }
    try {
      const result = await applySpendControl(profileParsed.data.profileId, ruleParsed.data.id, bodyParsed.data);
      res.json({ result });
    } catch (error) {
      logger.error({ error }, 'Falha ao aplicar spend control Wise');
      res.status(500).json({ error: 'Falha ao aplicar spend control' });
    }
  });

  app.post('/api/integrations/wise/spend-controls/:ruleId/unassign', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    const ruleParsed = parseRuleIdParam(req.params);
    const bodyParsed = parseWiseGenericPayload(req.body);
    if (!profileParsed.success || !ruleParsed.success || !bodyParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), rule: ruleParsed.error?.format(), body: bodyParsed.error?.format() } });
    }
    try {
      const result = await unassignSpendControl(profileParsed.data.profileId, ruleParsed.data.id, bodyParsed.data);
      res.json({ result });
    } catch (error) {
      logger.error({ error }, 'Falha ao remover spend control do cartão');
      res.status(500).json({ error: 'Falha ao remover spend control do cartão' });
    }
  });
}
