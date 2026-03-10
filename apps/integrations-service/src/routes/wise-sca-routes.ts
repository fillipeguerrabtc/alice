import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { requirePermission } from '@alice/shared-utils';
import type { SafeParseReturnType } from 'zod';

interface ProfileIdQuery {
  profileId: number;
}

interface JosePayloadBody {
  josePayload: string;
}

interface RegisterWiseScaRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  isWiseConfigured: () => boolean;
  parseWiseProfileIdQuery: (input: unknown) => SafeParseReturnType<unknown, ProfileIdQuery>;
  parseWiseJosePayload: (input: unknown) => SafeParseReturnType<unknown, JosePayloadBody>;
  getScaOneTimeToken: (profileId: number) => Promise<unknown>;
  createScaSession: (profileId: number, josePayload: string) => Promise<unknown>;
  createPin: (profileId: number, josePayload: string) => Promise<unknown>;
  verifyPin: (profileId: number, josePayload: string) => Promise<unknown>;
  deletePin: (profileId: number, josePayload: string) => Promise<unknown>;
  createDeviceFingerprint: (profileId: number, josePayload: string) => Promise<unknown>;
  verifyDeviceFingerprint: (profileId: number, josePayload: string) => Promise<unknown>;
  deleteDeviceFingerprint: (profileId: number, josePayload: string) => Promise<unknown>;
  createFacemap: (profileId: number, josePayload: string) => Promise<unknown>;
  verifyFacemap: (profileId: number, josePayload: string) => Promise<unknown>;
  deleteFacemap: (profileId: number, josePayload: string) => Promise<unknown>;
}

export function registerWiseScaRoutes(
  app: Express,
  deps: RegisterWiseScaRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');
  const {
    isWiseConfigured,
    parseWiseProfileIdQuery,
    parseWiseJosePayload,
    getScaOneTimeToken,
    createScaSession,
    createPin,
    verifyPin,
    deletePin,
    createDeviceFingerprint,
    verifyDeviceFingerprint,
    deleteDeviceFingerprint,
    createFacemap,
    verifyFacemap,
    deleteFacemap,
  } = deps;

  app.post('/api/integrations/wise/one-time-token', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    if (!profileParsed.success) {
      return res.status(400).json({ error: 'profileId inválido', details: profileParsed.error.format() });
    }
    try {
      const result = await getScaOneTimeToken(profileParsed.data.profileId);
      res.json({ result });
    } catch (error) {
      logger.error({ error }, 'Falha ao obter one-time token Wise');
      res.status(500).json({ error: 'Falha ao obter one-time token' });
    }
  });

  app.post('/api/integrations/wise/sca/sessions', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    const bodyParsed = parseWiseJosePayload(req.body);
    if (!profileParsed.success || !bodyParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), body: bodyParsed.error?.format() } });
    }
    try {
      const result = await createScaSession(profileParsed.data.profileId, bodyParsed.data.josePayload);
      res.json({ result });
    } catch (error) {
      logger.error({ error }, 'Falha ao criar sessão SCA Wise');
      res.status(500).json({ error: 'Falha ao criar sessão SCA' });
    }
  });

  app.post('/api/integrations/wise/sca/pin', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    const bodyParsed = parseWiseJosePayload(req.body);
    if (!profileParsed.success || !bodyParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), body: bodyParsed.error?.format() } });
    }
    try {
      const result = await createPin(profileParsed.data.profileId, bodyParsed.data.josePayload);
      res.json({ result });
    } catch (error) {
      logger.error({ error }, 'Falha ao criar PIN Wise');
      res.status(500).json({ error: 'Falha ao criar PIN' });
    }
  });

  app.post('/api/integrations/wise/sca/pin/verify', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    const bodyParsed = parseWiseJosePayload(req.body);
    if (!profileParsed.success || !bodyParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), body: bodyParsed.error?.format() } });
    }
    try {
      const result = await verifyPin(profileParsed.data.profileId, bodyParsed.data.josePayload);
      res.json({ result });
    } catch (error) {
      logger.error({ error }, 'Falha ao verificar PIN Wise');
      res.status(500).json({ error: 'Falha ao verificar PIN' });
    }
  });

  app.delete('/api/integrations/wise/sca/pin', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    const bodyParsed = parseWiseJosePayload(req.body);
    if (!profileParsed.success || !bodyParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), body: bodyParsed.error?.format() } });
    }
    try {
      const result = await deletePin(profileParsed.data.profileId, bodyParsed.data.josePayload);
      res.json({ result });
    } catch (error) {
      logger.error({ error }, 'Falha ao remover PIN Wise');
      res.status(500).json({ error: 'Falha ao remover PIN' });
    }
  });

  app.post('/api/integrations/wise/sca/device-fingerprint', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    const bodyParsed = parseWiseJosePayload(req.body);
    if (!profileParsed.success || !bodyParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), body: bodyParsed.error?.format() } });
    }
    try {
      const result = await createDeviceFingerprint(profileParsed.data.profileId, bodyParsed.data.josePayload);
      res.json({ result });
    } catch (error) {
      logger.error({ error }, 'Falha ao criar device fingerprint Wise');
      res.status(500).json({ error: 'Falha ao criar device fingerprint' });
    }
  });

  app.post('/api/integrations/wise/sca/device-fingerprint/verify', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    const bodyParsed = parseWiseJosePayload(req.body);
    if (!profileParsed.success || !bodyParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), body: bodyParsed.error?.format() } });
    }
    try {
      const result = await verifyDeviceFingerprint(profileParsed.data.profileId, bodyParsed.data.josePayload);
      res.json({ result });
    } catch (error) {
      logger.error({ error }, 'Falha ao verificar device fingerprint Wise');
      res.status(500).json({ error: 'Falha ao verificar device fingerprint' });
    }
  });

  app.delete('/api/integrations/wise/sca/device-fingerprint', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    const bodyParsed = parseWiseJosePayload(req.body);
    if (!profileParsed.success || !bodyParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), body: bodyParsed.error?.format() } });
    }
    try {
      const result = await deleteDeviceFingerprint(profileParsed.data.profileId, bodyParsed.data.josePayload);
      res.json({ result });
    } catch (error) {
      logger.error({ error }, 'Falha ao remover device fingerprint Wise');
      res.status(500).json({ error: 'Falha ao remover device fingerprint' });
    }
  });

  app.post('/api/integrations/wise/sca/facemap', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    const bodyParsed = parseWiseJosePayload(req.body);
    if (!profileParsed.success || !bodyParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), body: bodyParsed.error?.format() } });
    }
    try {
      const result = await createFacemap(profileParsed.data.profileId, bodyParsed.data.josePayload);
      res.json({ result });
    } catch (error) {
      logger.error({ error }, 'Falha ao criar facemap Wise');
      res.status(500).json({ error: 'Falha ao criar facemap' });
    }
  });

  app.post('/api/integrations/wise/sca/facemap/verify', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    const bodyParsed = parseWiseJosePayload(req.body);
    if (!profileParsed.success || !bodyParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), body: bodyParsed.error?.format() } });
    }
    try {
      const result = await verifyFacemap(profileParsed.data.profileId, bodyParsed.data.josePayload);
      res.json({ result });
    } catch (error) {
      logger.error({ error }, 'Falha ao verificar facemap Wise');
      res.status(500).json({ error: 'Falha ao verificar facemap' });
    }
  });

  app.delete('/api/integrations/wise/sca/facemap', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    const bodyParsed = parseWiseJosePayload(req.body);
    if (!profileParsed.success || !bodyParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), body: bodyParsed.error?.format() } });
    }
    try {
      const result = await deleteFacemap(profileParsed.data.profileId, bodyParsed.data.josePayload);
      res.json({ result });
    } catch (error) {
      logger.error({ error }, 'Falha ao remover facemap Wise');
      res.status(500).json({ error: 'Falha ao remover facemap' });
    }
  });
}
