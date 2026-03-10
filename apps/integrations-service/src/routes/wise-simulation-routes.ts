import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { requirePermission } from '@alice/shared-utils';
import type { SafeParseReturnType } from 'zod';

interface ProfileIdParam {
  profileId: number;
}

interface CardTokenParam {
  cardToken: string;
}

interface KycReviewIdParam {
  kycReviewId: string;
}

interface SimulationActionParam {
  action: string;
}

interface RegisterWiseSimulationRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  isWiseConfigured: () => boolean;
  parseWiseProfileIdParam: (input: unknown) => SafeParseReturnType<unknown, ProfileIdParam>;
  parseWiseCardTokenParam: (input: unknown) => SafeParseReturnType<unknown, CardTokenParam>;
  parseWiseKycReviewIdParam: (input: unknown) => SafeParseReturnType<unknown, KycReviewIdParam>;
  parseWiseSimulationActionParam: (input: unknown) => SafeParseReturnType<unknown, SimulationActionParam>;
  parseWiseGenericPayload: (input: unknown) => SafeParseReturnType<unknown, Record<string, unknown>>;
  simulateTransfer: (transferId: number, action: string) => Promise<unknown>;
  simulateVerification: (profileId: number, payload: Record<string, unknown>) => Promise<unknown>;
  simulateBalanceTopup: (payload: Record<string, unknown>) => Promise<unknown>;
  simulateCardTransaction: (
    profileId: number,
    cardToken: string,
    action: string,
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  simulateCardAuthorisation: (profileId: number, cardToken: string, payload: Record<string, unknown>) => Promise<unknown>;
  simulateCardRefund: (profileId: number, cardToken: string, payload: Record<string, unknown>) => Promise<unknown>;
  simulateCardProduction: (profileId: number, cardToken: string, payload: Record<string, unknown>) => Promise<unknown>;
  simulateCardRecentTransactions: (profileId: number, cardToken: string, limit: number) => Promise<unknown>;
  simulateKycRequirements: (profileId: number, kycReviewId: string) => Promise<unknown>;
  simulateBankTransactionImport: (profileId: number, payload: Record<string, unknown>) => Promise<unknown>;
}

export function registerWiseSimulationRoutes(
  app: Express,
  deps: RegisterWiseSimulationRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');
  const {
    isWiseConfigured,
    parseWiseProfileIdParam,
    parseWiseCardTokenParam,
    parseWiseKycReviewIdParam,
    parseWiseSimulationActionParam,
    parseWiseGenericPayload,
    simulateTransfer,
    simulateVerification,
    simulateBalanceTopup,
    simulateCardTransaction,
    simulateCardAuthorisation,
    simulateCardRefund,
    simulateCardProduction,
    simulateCardRecentTransactions,
    simulateKycRequirements,
    simulateBankTransactionImport,
  } = deps;

  app.post('/api/integrations/wise/simulation/transfers/:transferId/:action', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const transferId = Number(req.params.transferId);
    const actionParsed = parseWiseSimulationActionParam(req.params);
    if (!Number.isFinite(transferId) || transferId <= 0 || !actionParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos' });
    }
    try {
      const result = await simulateTransfer(transferId, actionParsed.data.action);
      res.json({ result });
    } catch (error) {
      logger.error({ error }, 'Falha ao simular transferência Wise');
      res.status(500).json({ error: 'Falha ao simular transferência' });
    }
  });

  app.post('/api/integrations/wise/simulation/profiles/:profileId/verifications', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdParam(req.params);
    const bodyParsed = parseWiseGenericPayload(req.body);
    if (!profileParsed.success || !bodyParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), body: bodyParsed.error?.format() } });
    }
    try {
      const result = await simulateVerification(profileParsed.data.profileId, bodyParsed.data);
      res.json({ result });
    } catch (error) {
      logger.error({ error }, 'Falha ao simular verificação Wise');
      res.status(500).json({ error: 'Falha ao simular verificação' });
    }
  });

  app.post('/api/integrations/wise/simulation/balance/topup', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const bodyParsed = parseWiseGenericPayload(req.body);
    if (!bodyParsed.success) {
      return res.status(400).json({ error: 'Payload inválido', details: bodyParsed.error.format() });
    }
    try {
      const result = await simulateBalanceTopup(bodyParsed.data);
      res.json({ result });
    } catch (error) {
      logger.error({ error }, 'Falha ao simular topup Wise');
      res.status(500).json({ error: 'Falha ao simular topup' });
    }
  });

  app.post('/api/integrations/wise/simulation/spend/profiles/:profileId/cards/:cardToken/transactions/:action', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdParam(req.params);
    const cardParsed = parseWiseCardTokenParam(req.params);
    const actionParsed = parseWiseSimulationActionParam(req.params);
    const bodyParsed = parseWiseGenericPayload(req.body);
    if (!profileParsed.success || !cardParsed.success || !actionParsed.success || !bodyParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos' });
    }
    try {
      const result = await simulateCardTransaction(
        profileParsed.data.profileId,
        cardParsed.data.cardToken,
        actionParsed.data.action,
        bodyParsed.data,
      );
      res.json({ result });
    } catch (error) {
      logger.error({ error }, 'Falha ao simular transação de cartão Wise');
      res.status(500).json({ error: 'Falha ao simular transação' });
    }
  });

  app.post('/api/integrations/wise/simulation/spend/profiles/:profileId/cards/:cardToken/transactions/authorisation', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdParam(req.params);
    const cardParsed = parseWiseCardTokenParam(req.params);
    const bodyParsed = parseWiseGenericPayload(req.body);
    if (!profileParsed.success || !cardParsed.success || !bodyParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos' });
    }
    try {
      const result = await simulateCardAuthorisation(profileParsed.data.profileId, cardParsed.data.cardToken, bodyParsed.data);
      res.json({ result });
    } catch (error) {
      logger.error({ error }, 'Falha ao simular autorização Wise');
      res.status(500).json({ error: 'Falha ao simular autorização' });
    }
  });

  app.post('/api/integrations/wise/simulation/spend/profiles/:profileId/cards/:cardToken/transactions/refund', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdParam(req.params);
    const cardParsed = parseWiseCardTokenParam(req.params);
    const bodyParsed = parseWiseGenericPayload(req.body);
    if (!profileParsed.success || !cardParsed.success || !bodyParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos' });
    }
    try {
      const result = await simulateCardRefund(profileParsed.data.profileId, cardParsed.data.cardToken, bodyParsed.data);
      res.json({ result });
    } catch (error) {
      logger.error({ error }, 'Falha ao simular reembolso Wise');
      res.status(500).json({ error: 'Falha ao simular reembolso' });
    }
  });

  app.post('/api/integrations/wise/simulation/spend/profiles/:profileId/cards/:cardToken/production', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdParam(req.params);
    const cardParsed = parseWiseCardTokenParam(req.params);
    const bodyParsed = parseWiseGenericPayload(req.body);
    if (!profileParsed.success || !cardParsed.success || !bodyParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos' });
    }
    try {
      const result = await simulateCardProduction(profileParsed.data.profileId, cardParsed.data.cardToken, bodyParsed.data);
      res.json({ result });
    } catch (error) {
      logger.error({ error }, 'Falha ao simular produção de cartão Wise');
      res.status(500).json({ error: 'Falha ao simular produção' });
    }
  });

  app.get('/api/integrations/wise/simulation/spend/profiles/:profileId/cards/:cardToken/transactions', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdParam(req.params);
    const cardParsed = parseWiseCardTokenParam(req.params);
    if (!profileParsed.success || !cardParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos' });
    }
    const limit = req.query.limit ? Number(req.query.limit) : 10;
    try {
      const result = await simulateCardRecentTransactions(profileParsed.data.profileId, cardParsed.data.cardToken, Number.isFinite(limit) ? limit : 10);
      res.json({ result });
    } catch (error) {
      logger.error({ error }, 'Falha ao listar transações simuladas Wise');
      res.status(500).json({ error: 'Falha ao listar transações simuladas' });
    }
  });

  app.get('/api/integrations/wise/simulation/profiles/:profileId/kyc-reviews/:kycReviewId/requirements', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdParam(req.params);
    const reviewParsed = parseWiseKycReviewIdParam(req.params);
    if (!profileParsed.success || !reviewParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos' });
    }
    try {
      const result = await simulateKycRequirements(profileParsed.data.profileId, reviewParsed.data.kycReviewId);
      res.json({ result });
    } catch (error) {
      logger.error({ error }, 'Falha ao simular requisitos KYC Wise');
      res.status(500).json({ error: 'Falha ao simular requisitos KYC' });
    }
  });

  app.post('/api/integrations/wise/simulation/profiles/:profileId/bank-transactions/import', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
    if (!isWiseConfigured()) {
      return res.status(503).json({ error: 'Wise não configurado' });
    }
    const profileParsed = parseWiseProfileIdParam(req.params);
    const bodyParsed = parseWiseGenericPayload(req.body);
    if (!profileParsed.success || !bodyParsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), body: bodyParsed.error?.format() } });
    }
    try {
      const result = await simulateBankTransactionImport(profileParsed.data.profileId, bodyParsed.data);
      res.json({ result });
    } catch (error) {
      logger.error({ error }, 'Falha ao simular importação bancária Wise');
      res.status(500).json({ error: 'Falha ao simular importação bancária' });
    }
  });
}
