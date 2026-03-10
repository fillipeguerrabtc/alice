import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { requirePermission } from '@alice/shared-utils';
import type { SafeParseReturnType } from 'zod';

interface ProfileIdQuery {
  profileId: number;
}

interface DisputeIdParam {
  disputeId: string;
}

interface WiseFileUploadPayload {
  fileName: string;
  fileBase64: string;
  contentType: string;
}

interface WiseAuthContext {
  tenantId: string;
}

interface RegisterWiseDisputesRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  isWiseConfigured: () => boolean;
  getWiseAuthContext: (req: Request) => WiseAuthContext;
  parseWiseProfileIdQuery: (input: unknown) => SafeParseReturnType<unknown, ProfileIdQuery>;
  parseWiseDisputeIdParam: (input: unknown) => SafeParseReturnType<unknown, DisputeIdParam>;
  parseWiseGenericPayload: (input: unknown) => SafeParseReturnType<unknown, Record<string, unknown>>;
  parseWiseFileUpload: (input: unknown) => SafeParseReturnType<unknown, WiseFileUploadPayload>;
  listDisputeReasons: (profileId: number) => Promise<unknown>;
  getDisputeFlowStep: (
    profileId: number,
    scheme: string,
    reason: string,
    transactionId: string,
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  submitDisputeFlow: (
    profileId: number,
    scheme: string,
    reason: string,
    transactionId: string,
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  uploadDisputeFile: (profileId: number, formData: FormData) => Promise<unknown>;
  listDisputes: (profileId: number, status?: string) => Promise<unknown>;
  getDispute: (profileId: number, disputeId: string) => Promise<unknown>;
  updateDisputeStatus: (profileId: number, disputeId: string, payload: Record<string, unknown>) => Promise<unknown>;
  upsertWiseDisputes: (tenantId: string, disputes: Array<Record<string, unknown>>) => Promise<void>;
}

export function registerWiseDisputesRoutes(
  app: Express,
  deps: RegisterWiseDisputesRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');
  const {
    isWiseConfigured,
    getWiseAuthContext,
    parseWiseProfileIdQuery,
    parseWiseDisputeIdParam,
    parseWiseGenericPayload,
    parseWiseFileUpload,
    listDisputeReasons,
    getDisputeFlowStep,
    submitDisputeFlow,
    uploadDisputeFile,
    listDisputes,
    getDispute,
    updateDisputeStatus,
    upsertWiseDisputes,
  } = deps;

  app.get('/api/integrations/wise/disputes/reasons', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    if (!profileParsed.success) {
      return res.status(400).json({ error: 'profileId inválido', details: profileParsed.error.format() });
    }
    try {
      const reasons = await listDisputeReasons(profileParsed.data.profileId);
      res.json({ reasons });
    } catch (error) {
      logger.error({ error }, 'Falha ao listar razões de disputa Wise');
      res.status(500).json({ error: 'Falha ao listar razões de disputa' });
    }
  });

  app.post('/api/integrations/wise/disputes/flow/step', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const { profileId, scheme, reason, transactionId, payload } = req.body as Record<string, unknown>;
    if (!profileId || !scheme || !reason || !transactionId) {
      return res.status(400).json({ error: 'profileId, scheme, reason e transactionId são obrigatórios' });
    }
    const bodyParsed = parseWiseGenericPayload(payload ?? {});
    if (!bodyParsed.success) {
      return res.status(400).json({ error: 'Payload inválido', details: bodyParsed.error.format() });
    }
    try {
      const result = await getDisputeFlowStep(Number(profileId), String(scheme), String(reason), String(transactionId), bodyParsed.data);
      res.json({ result });
    } catch (error) {
      logger.error({ error }, 'Falha ao obter step de disputa Wise');
      res.status(500).json({ error: 'Falha ao obter step de disputa' });
    }
  });

  app.post('/api/integrations/wise/disputes/flow/submit', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const { profileId, scheme, reason, transactionId, payload } = req.body as Record<string, unknown>;
    if (!profileId || !scheme || !reason || !transactionId) {
      return res.status(400).json({ error: 'profileId, scheme, reason e transactionId são obrigatórios' });
    }
    const bodyParsed = parseWiseGenericPayload(payload ?? {});
    if (!bodyParsed.success) {
      return res.status(400).json({ error: 'Payload inválido', details: bodyParsed.error.format() });
    }
    try {
      const result = await submitDisputeFlow(Number(profileId), String(scheme), String(reason), String(transactionId), bodyParsed.data);
      res.json({ result });
    } catch (error) {
      logger.error({ error }, 'Falha ao enviar disputa Wise');
      res.status(500).json({ error: 'Falha ao enviar disputa' });
    }
  });

  app.post('/api/integrations/wise/disputes/upload', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    const bodyParsed = parseWiseFileUpload(req.body);
    if (!profileParsed.success || !bodyParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), body: bodyParsed.error?.format() } });
    }
    try {
      const buffer = Buffer.from(bodyParsed.data.fileBase64, 'base64');
      const formData = new FormData();
      formData.append('receipt', new Blob([buffer], { type: bodyParsed.data.contentType }), bodyParsed.data.fileName);
      const result = await uploadDisputeFile(profileParsed.data.profileId, formData);
      res.json({ result });
    } catch (error) {
      logger.error({ error }, 'Falha ao enviar arquivo de disputa Wise');
      res.status(500).json({ error: 'Falha ao enviar arquivo' });
    }
  });

  app.get('/api/integrations/wise/disputes', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    if (!profileParsed.success) {
      return res.status(400).json({ error: 'profileId inválido', details: profileParsed.error.format() });
    }
    try {
      const auth = getWiseAuthContext(req);
      const disputes = await listDisputes(profileParsed.data.profileId, req.query.status as string | undefined);
      if (Array.isArray((disputes as Record<string, unknown>).content)) {
        await upsertWiseDisputes(auth.tenantId, (disputes as Record<string, unknown>).content as Array<Record<string, unknown>>);
      }
      res.json({ disputes });
    } catch (error) {
      logger.error({ error }, 'Falha ao listar disputas Wise');
      res.status(500).json({ error: 'Falha ao listar disputas' });
    }
  });

  app.get('/api/integrations/wise/disputes/:disputeId', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    const idParsed = parseWiseDisputeIdParam(req.params);
    if (!profileParsed.success || !idParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), id: idParsed.error?.format() } });
    }
    try {
      const auth = getWiseAuthContext(req);
      const dispute = await getDispute(profileParsed.data.profileId, idParsed.data.disputeId);
      await upsertWiseDisputes(auth.tenantId, [dispute as Record<string, unknown>]);
      res.json({ dispute });
    } catch (error) {
      logger.error({ error }, 'Falha ao obter disputa Wise');
      res.status(500).json({ error: 'Falha ao obter disputa' });
    }
  });

  app.put('/api/integrations/wise/disputes/:disputeId/status', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    const idParsed = parseWiseDisputeIdParam(req.params);
    const bodyParsed = parseWiseGenericPayload(req.body);
    if (!profileParsed.success || !idParsed.success || !bodyParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), id: idParsed.error?.format(), body: bodyParsed.error?.format() } });
    }
    try {
      const auth = getWiseAuthContext(req);
      const dispute = await updateDisputeStatus(profileParsed.data.profileId, idParsed.data.disputeId, bodyParsed.data);
      await upsertWiseDisputes(auth.tenantId, [dispute as Record<string, unknown>]);
      res.json({ dispute });
    } catch (error) {
      logger.error({ error }, 'Falha ao atualizar disputa Wise');
      res.status(500).json({ error: 'Falha ao atualizar disputa' });
    }
  });
}
