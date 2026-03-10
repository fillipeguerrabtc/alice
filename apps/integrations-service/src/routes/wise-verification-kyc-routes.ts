import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { requirePermission } from '@alice/shared-utils';
import type { SafeParseReturnType } from 'zod';

interface ProfileIdQuery {
  profileId: number;
}

interface KycReviewIdParam {
  kycReviewId: string;
}

interface WiseFileUploadPayload {
  fileName: string;
  fileBase64: string;
  contentType: string;
}

interface WiseAuthContext {
  tenantId: string;
}

interface RegisterWiseVerificationKycRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  isWiseConfigured: () => boolean;
  getWiseAuthContext: (req: Request) => WiseAuthContext;
  parseWiseProfileIdQuery: (input: unknown) => SafeParseReturnType<unknown, ProfileIdQuery>;
  parseWiseKycReviewIdParam: (input: unknown) => SafeParseReturnType<unknown, KycReviewIdParam>;
  parseWiseFileUpload: (input: unknown) => SafeParseReturnType<unknown, WiseFileUploadPayload>;
  parseWiseGenericPayload: (input: unknown) => SafeParseReturnType<unknown, Record<string, unknown>>;
  getVerificationRequiredEvidences: (profileId: number) => Promise<unknown>;
  uploadVerificationDocument: (profileId: number, formData: FormData) => Promise<unknown>;
  uploadAdditionalEvidences: (profileId: number, formData: FormData) => Promise<unknown>;
  listKycReviews: (profileId: number) => Promise<unknown>;
  createKycReview: (profileId: number, payload: Record<string, unknown>) => Promise<unknown>;
  getKycReview: (profileId: number, kycReviewId: string) => Promise<unknown>;
  upsertWiseKycReviews: (tenantId: string, reviews: Array<Record<string, unknown>>) => Promise<void>;
}

export function registerWiseVerificationKycRoutes(
  app: Express,
  deps: RegisterWiseVerificationKycRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');
  const {
    isWiseConfigured,
    getWiseAuthContext,
    parseWiseProfileIdQuery,
    parseWiseKycReviewIdParam,
    parseWiseFileUpload,
    parseWiseGenericPayload,
    getVerificationRequiredEvidences,
    uploadVerificationDocument,
    uploadAdditionalEvidences,
    listKycReviews,
    createKycReview,
    getKycReview,
    upsertWiseKycReviews,
  } = deps;

  app.get('/api/integrations/wise/verification/required-evidences', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    if (!profileParsed.success) {
      return res.status(400).json({ error: 'profileId inválido', details: profileParsed.error.format() });
    }
    try {
      const evidences = await getVerificationRequiredEvidences(profileParsed.data.profileId);
      res.json({ evidences });
    } catch (error) {
      logger.error({ error }, 'Falha ao obter evidências Wise');
      res.status(500).json({ error: 'Falha ao obter evidências' });
    }
  });

  app.post('/api/integrations/wise/verification/upload-document', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
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
      formData.append('document', new Blob([buffer], { type: bodyParsed.data.contentType }), bodyParsed.data.fileName);
      const result = await uploadVerificationDocument(profileParsed.data.profileId, formData);
      res.json({ result });
    } catch (error) {
      logger.error({ error }, 'Falha ao enviar documento Wise');
      res.status(500).json({ error: 'Falha ao enviar documento' });
    }
  });

  app.post('/api/integrations/wise/verification/upload-evidences', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
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
      formData.append('document', new Blob([buffer], { type: bodyParsed.data.contentType }), bodyParsed.data.fileName);
      const result = await uploadAdditionalEvidences(profileParsed.data.profileId, formData);
      res.json({ result });
    } catch (error) {
      logger.error({ error }, 'Falha ao enviar evidências Wise');
      res.status(500).json({ error: 'Falha ao enviar evidências' });
    }
  });

  app.get('/api/integrations/wise/kyc-reviews', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    if (!profileParsed.success) {
      return res.status(400).json({ error: 'profileId inválido', details: profileParsed.error.format() });
    }
    try {
      const auth = getWiseAuthContext(req);
      const reviews = await listKycReviews(profileParsed.data.profileId);
      const items = Array.isArray((reviews as Record<string, unknown>).content) ? (reviews as Record<string, unknown>).content as Array<Record<string, unknown>> : [];
      await upsertWiseKycReviews(auth.tenantId, items);
      res.json({ reviews });
    } catch (error) {
      logger.error({ error }, 'Falha ao listar KYC reviews Wise');
      res.status(500).json({ error: 'Falha ao listar KYC reviews' });
    }
  });

  app.post('/api/integrations/wise/kyc-reviews', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
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
      const review = await createKycReview(profileParsed.data.profileId, bodyParsed.data);
      await upsertWiseKycReviews(auth.tenantId, [review as Record<string, unknown>]);
      res.json({ review });
    } catch (error) {
      logger.error({ error }, 'Falha ao criar KYC review Wise');
      res.status(500).json({ error: 'Falha ao criar KYC review' });
    }
  });

  app.get('/api/integrations/wise/kyc-reviews/:kycReviewId', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdQuery(req.query);
    const idParsed = parseWiseKycReviewIdParam(req.params);
    if (!profileParsed.success || !idParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), id: idParsed.error?.format() } });
    }
    try {
      const auth = getWiseAuthContext(req);
      const review = await getKycReview(profileParsed.data.profileId, idParsed.data.kycReviewId);
      await upsertWiseKycReviews(auth.tenantId, [review as Record<string, unknown>]);
      res.json({ review });
    } catch (error) {
      logger.error({ error }, 'Falha ao obter KYC review Wise');
      res.status(500).json({ error: 'Falha ao obter KYC review' });
    }
  });
}
