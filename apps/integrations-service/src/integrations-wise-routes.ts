import type { Express, Request } from 'express';
import { and, eq, getDatabase, schema } from '@alice/database';
import { createLogger } from '@alice/logger';
import { requirePermission, type AuthContext } from '@alice/shared-utils';
import { z } from 'zod';
import { wiseService } from './wiseService.js';
import {
  getProfileIdSafe,
  getSandboxStatus,
  isWiseConfigured,
  validateWiseWebhook,
} from './wiseClient.js';
import { getWiseAuthContextFromRequest } from './wise-auth-context-service.js';
import {
  insertWiseWebhookEvent,
  upsertWiseActivities,
  upsertWiseBalances,
  upsertWiseCardOrders,
  upsertWiseCardTransactions,
  upsertWiseCards,
  upsertWiseDisputes,
  upsertWiseKycReviews,
  upsertWiseProfiles,
  upsertWiseQuotes,
  upsertWiseRecipients,
  upsertWiseSpendControls,
  upsertWiseTransfers,
  upsertWiseUsers,
  upsertWiseWebhookSubscriptions,
} from './wise-storage-service.js';
import {
  checkWebhookIdempotency,
  markWebhookProcessed,
} from './webhook-idempotency-service.js';
import { registerWiseBalanceAndQuotesRoutes } from './routes/wise-balance-and-quotes-routes.js';
import { registerWiseRecipientsTransfersRoutes } from './routes/wise-recipients-transfers-routes.js';
import { registerWiseWebhookRoutes } from './routes/wise-webhook-routes.js';
import { registerWiseReferenceRoutes } from './routes/wise-reference-routes.js';
import { registerWiseAccountDetailsRoutes } from './routes/wise-account-details-routes.js';
import { registerWiseCardManagementRoutes } from './routes/wise-card-management-routes.js';
import { registerWiseCardSecureRoutes } from './routes/wise-card-secure-routes.js';
import { registerWiseCardOrdersRoutes } from './routes/wise-card-orders-routes.js';
import { registerWiseSpendControlsRoutes } from './routes/wise-spend-controls-routes.js';
import { registerWiseSpendLimitsRoutes } from './routes/wise-spend-limits-routes.js';
import { registerWiseDisputesRoutes } from './routes/wise-disputes-routes.js';
import { registerWiseVerificationKycRoutes } from './routes/wise-verification-kyc-routes.js';
import { registerWiseScaRoutes } from './routes/wise-sca-routes.js';
import { registerWiseWebhookManagementRoutes } from './routes/wise-webhook-management-routes.js';
import { registerWiseSimulationRoutes } from './routes/wise-simulation-routes.js';
import { registerWiseOAuthRoutes } from './routes/wise-oauth-routes.js';
import {
  batchGroupIdParamSchema,
  balanceIdParamSchema,
  numericIdParamSchema,
  paginationQuerySchema,
  wiseActivityQuerySchema,
  wiseBalanceCreateSchema,
  wiseBalanceMovementSchema,
  wiseBalancesQuerySchema,
  wiseBalanceStatementQuerySchema,
  wiseCardOrderIdParamSchema,
  wiseCardOrdersQuerySchema,
  wiseCardTokenParamSchema,
  wiseCurrencyQuerySchema,
  wiseDisputeIdParamSchema,
  wiseFileUploadSchema,
  wiseGenericPayloadSchema,
  wiseJosePayloadSchema,
  wiseKycReviewIdParamSchema,
  wiseProfileIdParamSchema,
  wiseQuoteCreateSchema,
  wiseRatesQuerySchema,
  wiseRecipientRequirementsQuerySchema,
  wiseRecipientsQuerySchema,
  wiseSimulationActionSchema,
  wiseTransactionIdParamSchema,
  wiseWebhookIdParamSchema,
} from './wise-route-schemas.js';
import { requireDelegatedAgentExecution } from './delegated-execution.js';

const agenticWiseTransferSchema = z.object({
  sourceCurrency: z.string()
    .min(3, 'sourceCurrency deve ter 3 caracteres')
    .max(3, 'sourceCurrency deve ter 3 caracteres')
    .regex(/^[A-Z]{3}$/, 'sourceCurrency deve ser código de moeda válido'),
  targetCurrency: z.string()
    .min(3, 'targetCurrency deve ter 3 caracteres')
    .max(3, 'targetCurrency deve ter 3 caracteres')
    .regex(/^[A-Z]{3}$/, 'targetCurrency deve ser código de moeda válido'),
  sourceAmount: z.coerce.number().positive('sourceAmount deve ser positivo'),
  recipientId: z.coerce.number().int().positive('recipientId deve ser positivo'),
  reference: z.string().trim().min(1).max(140).optional(),
});

const agenticWiseExchangeSchema = z.object({
  sourceCurrency: z.string()
    .min(3, 'sourceCurrency deve ter 3 caracteres')
    .max(3, 'sourceCurrency deve ter 3 caracteres')
    .regex(/^[A-Z]{3}$/, 'sourceCurrency deve ser código de moeda válido'),
  targetCurrency: z.string()
    .min(3, 'targetCurrency deve ter 3 caracteres')
    .max(3, 'targetCurrency deve ter 3 caracteres')
    .regex(/^[A-Z]{3}$/, 'targetCurrency deve ser código de moeda válido'),
  sourceAmount: z.coerce.number().positive('sourceAmount deve ser positivo'),
});

export function registerWiseRoutes(
  app: Express,
  params: { logger: ReturnType<typeof createLogger> },
): void {
  const { logger } = params;
  const getWiseAuthContext = (req: Request) => getWiseAuthContextFromRequest(req.user as AuthContext | undefined);

  const checkWebhookIdempotencyWithLogger = (
    db: ReturnType<typeof getDatabase>,
    source: 'stripe' | 'wise' | 'twilio',
    eventId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ) => checkWebhookIdempotency(
    db,
    logger,
    source,
    eventId,
    eventType,
    payload,
  );

  registerWiseBalanceAndQuotesRoutes(app, {
    logger,
    isWiseConfigured,
    getWiseAuthContext,
    parseWiseBalancesQuery: (input) => wiseBalancesQuerySchema.safeParse(input),
    parseWiseBalanceCreate: (input) => wiseBalanceCreateSchema.safeParse(input),
    parseBalanceIdParam: (input) => balanceIdParamSchema.safeParse(input),
    parseWiseBalanceStatementQuery: (input) => wiseBalanceStatementQuerySchema.safeParse(input),
    parseWiseCurrencyQuery: (input) => wiseCurrencyQuerySchema.safeParse(input),
    parseWiseRatesQuery: (input) => wiseRatesQuerySchema.safeParse(input),
    parseWiseQuoteCreate: (input) => wiseQuoteCreateSchema.safeParse(input),
    parseWiseBalanceMovement: (input) => wiseBalanceMovementSchema.safeParse(input),
    getBalances: (types) => wiseService.getBalances(types),
    createBalance: (payload) => wiseService.createBalance(payload as Parameters<typeof wiseService.createBalance>[0]),
    deleteBalance: (balanceId) => wiseService.deleteBalance(balanceId),
    deleteWiseBalanceRecord: async (tenantId, balanceId) => {
      await getDatabase().delete(schema.wiseBalances).where(
        and(
          eq(schema.wiseBalances.tenantId, tenantId),
          eq(schema.wiseBalances.wiseBalanceId, balanceId),
        ),
      );
    },
    getBalanceStatement: (payload) => wiseService.getBalanceStatement(payload),
    getBalanceCapacity: (currency) => wiseService.getBalanceCapacity(currency),
    getTotalFunds: (currency) => wiseService.getTotalFunds(currency),
    getExchangeRates: (source, target) => wiseService.getExchangeRates(source, target),
    createQuote: (payload) => wiseService.createQuote(payload as Parameters<typeof wiseService.createQuote>[0]),
    createBalanceMovement: (payload) => wiseService.createBalanceMovement(payload as Parameters<typeof wiseService.createBalanceMovement>[0]),
    upsertWiseBalances: async (tenantId, balances) => upsertWiseBalances(tenantId, balances as Parameters<typeof upsertWiseBalances>[1]),
    upsertWiseQuotes: async (tenantId, quote) => upsertWiseQuotes(tenantId, quote as Parameters<typeof upsertWiseQuotes>[1]),
    isSandboxMode: () => wiseService.isSandboxMode(),
  });

  registerWiseRecipientsTransfersRoutes(app, {
    logger,
    isWiseConfigured,
    getWiseAuthContext,
    parseWiseRecipientsQuery: (input) => wiseRecipientsQuerySchema.safeParse(input),
    parseNumericIdParam: (input) => numericIdParamSchema.safeParse(input),
    parsePaginationQuery: (input) => paginationQuerySchema.safeParse(input),
    parseBatchGroupIdParam: (input) => batchGroupIdParamSchema.safeParse(input),
    listRecipients: (currency) => wiseService.listRecipients(currency),
    createRecipient: (payload) => wiseService.createRecipient(payload as Parameters<typeof wiseService.createRecipient>[0]),
    getRecipient: (id) => wiseService.getRecipient(id),
    deleteRecipient: (id) => wiseService.deleteRecipient(id),
    deleteRecipientRecord: async (tenantId, recipientId) => {
      await getDatabase().delete(schema.wiseRecipients).where(
        and(
          eq(schema.wiseRecipients.tenantId, tenantId),
          eq(schema.wiseRecipients.wiseRecipientId, recipientId),
        ),
      );
    },
    upsertWiseRecipients: async (tenantId, recipients) => upsertWiseRecipients(tenantId, recipients as Parameters<typeof upsertWiseRecipients>[1]),
    listTransfers: (limit, offset) => wiseService.listTransfers(limit, offset),
    createTransfer: (payload) => wiseService.createTransfer(payload as Parameters<typeof wiseService.createTransfer>[0]),
    getTransfer: (id) => wiseService.getTransfer(id),
    fundTransfer: (id) => wiseService.fundTransfer(id),
    touchTransferRecord: async (tenantId, transferId) => {
      await getDatabase().update(schema.wiseTransfers)
        .set({ updatedAt: new Date() })
        .where(and(
          eq(schema.wiseTransfers.tenantId, tenantId),
          eq(schema.wiseTransfers.wiseTransferId, transferId),
        ));
    },
    cancelTransfer: (id) => wiseService.cancelTransfer(id),
    upsertWiseTransfers: async (tenantId, transfers) => upsertWiseTransfers(tenantId, transfers as Parameters<typeof upsertWiseTransfers>[1]),
    listBatchGroups: () => wiseService.listBatchGroups(),
    createBatchGroup: (payload) => wiseService.createBatchGroup(payload as Parameters<typeof wiseService.createBatchGroup>[0]),
    getBatchGroup: (id) => wiseService.getBatchGroup(id),
    completeBatchGroup: (id, version) => wiseService.completeBatchGroup(id, version as Parameters<typeof wiseService.completeBatchGroup>[1]),
  });

  app.post(
    '/api/integrations/agentic/payments/wise-transfer',
    requirePermission('integrations:wise:write'),
    requireDelegatedAgentExecution({
      actionKey: 'payments.wise.transfer.create',
      logger,
      payloadResolver: (req) => req.body,
    }),
    async (req, res) => {
      if (!isWiseConfigured()) {
        return res.status(503).json({ error: 'Wise não configurado' });
      }

      const parsed = agenticWiseTransferSchema.safeParse(req.body);
      if (!parsed.success) {
        logger.warn({ errors: parsed.error.flatten() }, 'Input inválido em /api/integrations/agentic/payments/wise-transfer');
        return res.status(400).json({ error: 'Dados inválidos', details: parsed.error.format() });
      }

      try {
        const auth = getWiseAuthContext(req);
        const quote = await wiseService.createQuote({
          sourceCurrency: parsed.data.sourceCurrency,
          targetCurrency: parsed.data.targetCurrency,
          sourceAmount: parsed.data.sourceAmount,
          targetAccount: parsed.data.recipientId,
          preferredPayIn: 'BALANCE',
        });

        await upsertWiseQuotes(auth.tenantId, quote as Parameters<typeof upsertWiseQuotes>[1]);

        const customerTransactionId = `alice-agentic-${Date.now()}-${parsed.data.recipientId}`;
        const transfer = await wiseService.createTransfer({
          targetAccount: parsed.data.recipientId,
          quoteUuid: quote.id,
          customerTransactionId,
          details: {
            reference: parsed.data.reference?.trim() || 'Pagamento Alice',
          },
        });

        await upsertWiseTransfers(auth.tenantId, [transfer] as Parameters<typeof upsertWiseTransfers>[1]);

        const transferId = typeof transfer === 'object' && transfer !== null && 'id' in transfer
          ? Number((transfer as { id?: unknown }).id)
          : null;
        const fundingResult = transferId ? await wiseService.fundTransfer(transferId) : null;
        const hydratedTransfer = transferId ? await wiseService.getTransfer(transferId) : transfer;

        if (transferId) {
          await upsertWiseTransfers(auth.tenantId, [hydratedTransfer] as Parameters<typeof upsertWiseTransfers>[1]);
        }

        logger.info(
          {
            recipientId: parsed.data.recipientId,
            transferId,
            sourceCurrency: parsed.data.sourceCurrency,
            targetCurrency: parsed.data.targetCurrency,
            sourceAmount: parsed.data.sourceAmount,
          },
          'Transferência agentic Wise executada com token delegado',
        );

        res.json({
          success: true,
          quote,
          transfer: hydratedTransfer,
          funding: fundingResult,
        });
      } catch (error) {
        logger.error({ error }, 'Falha ao executar transferência agentic Wise');
        res.status(500).json({ error: 'Falha ao executar transferência Wise' });
      }
    },
  );

  app.post(
    '/api/integrations/agentic/payments/wise-exchange',
    requirePermission('integrations:wise:write'),
    requireDelegatedAgentExecution({
      actionKey: 'payments.wise.exchange.create',
      logger,
      payloadResolver: (req) => req.body,
    }),
    async (req, res) => {
      if (!isWiseConfigured()) {
        return res.status(503).json({ error: 'Wise não configurado' });
      }

      const parsed = agenticWiseExchangeSchema.safeParse(req.body);
      if (!parsed.success) {
        logger.warn({ errors: parsed.error.flatten() }, 'Input inválido em /api/integrations/agentic/payments/wise-exchange');
        return res.status(400).json({ error: 'Dados inválidos', details: parsed.error.format() });
      }

      try {
        const auth = getWiseAuthContext(req);
        const quote = await wiseService.createQuote({
          sourceCurrency: parsed.data.sourceCurrency,
          targetCurrency: parsed.data.targetCurrency,
          sourceAmount: parsed.data.sourceAmount,
          preferredPayIn: 'BALANCE',
          payOut: 'BALANCE',
        });

        await upsertWiseQuotes(auth.tenantId, quote as Parameters<typeof upsertWiseQuotes>[1]);

        const movement = await wiseService.createBalanceMovement({
          quoteId: quote.id,
        });

        logger.info(
          {
            sourceCurrency: parsed.data.sourceCurrency,
            targetCurrency: parsed.data.targetCurrency,
            sourceAmount: parsed.data.sourceAmount,
          },
          'Câmbio agentic Wise executado com token delegado',
        );

        res.json({
          success: true,
          quote,
          movement,
        });
      } catch (error) {
        logger.error({ error }, 'Falha ao executar câmbio agentic Wise');
        res.status(500).json({ error: 'Falha ao executar câmbio Wise' });
      }
    },
  );

  registerWiseWebhookRoutes(app, {
    logger,
    validateWiseWebhook,
    checkWebhookIdempotency: checkWebhookIdempotencyWithLogger,
    markWebhookProcessed,
    insertWiseWebhookEvent,
  });

  registerWiseReferenceRoutes(app, {
    logger,
    isWiseConfigured,
    getWiseAuthContext,
    parseWiseRecipientRequirementsQuery: (input) => wiseRecipientRequirementsQuerySchema.safeParse(input),
    parseWiseProfileIdParam: (input) => wiseProfileIdParamSchema.safeParse(input),
    parseNumericIdParam: (input) => numericIdParamSchema.safeParse(input),
    parseWiseActivityQuery: (input) => wiseActivityQuerySchema.safeParse(input),
    getRecipientRequirements: (sourceCurrency, targetCurrency, sourceAmount) => wiseService.getRecipientRequirements(sourceCurrency, targetCurrency, sourceAmount),
    getProfiles: () => wiseService.getProfiles(),
    getProfileById: (profileId) => wiseService.getProfileById(profileId),
    getCurrentUser: () => wiseService.getCurrentUser(),
    getUserById: (id) => wiseService.getUserById(id),
    listActivities: (query) => wiseService.listActivities(query),
    upsertWiseProfiles,
    upsertWiseUsers,
    upsertWiseActivities,
  });

  registerWiseAccountDetailsRoutes(app, {
    logger,
    isWiseConfigured,
    parseWiseProfileIdQuery: (input) => wiseProfileIdParamSchema.safeParse(input),
    parseWiseGenericPayload: (input) => wiseGenericPayloadSchema.safeParse(input),
    getAccountDetails: (profileId) => wiseService.getAccountDetails(profileId),
    listAccountDetailsOrders: (profileId) => wiseService.listAccountDetailsOrders(profileId),
    createAccountDetailsOrder: (profileId, payload) => wiseService.createAccountDetailsOrder(profileId, payload),
  });

  registerWiseCardManagementRoutes(app, {
    logger,
    isWiseConfigured,
    getWiseAuthContext,
    parseWiseProfileIdQuery: (input) => wiseProfileIdParamSchema.safeParse(input),
    parseWiseCardTokenParam: (input) => wiseCardTokenParamSchema.safeParse(input),
    parseWiseGenericPayload: (input) => wiseGenericPayloadSchema.safeParse(input),
    listCards: (profileId) => wiseService.listCards(profileId),
    getCard: (profileId, cardToken) => wiseService.getCard(profileId, cardToken),
    updateCardStatus: (profileId, cardToken, payload) => wiseService.updateCardStatus(profileId, cardToken, payload),
    resetCardPin: (profileId, cardToken) => wiseService.resetCardPin(profileId, cardToken),
    getCardPermissions: (profileId, cardToken) => wiseService.getCardPermissions(profileId, cardToken),
    updateCardPermission: (profileId, cardToken, payload) => wiseService.updateCardPermission(profileId, cardToken, payload),
    updateCardPermissionsBulk: (profileId, payload) => wiseService.updateCardPermissionsBulk(profileId, payload),
    upsertWiseCards,
  });

  registerWiseCardSecureRoutes(app, {
    logger,
    isWiseConfigured,
    getWiseAuthContext,
    parseWiseProfileIdQuery: (input) => wiseProfileIdParamSchema.safeParse(input),
    parseWiseCardTokenQuery: (input) => wiseCardTokenParamSchema.safeParse(input),
    parseWiseTransactionIdParam: (input) => wiseTransactionIdParamSchema.safeParse(input),
    parseWiseGenericPayload: (input) => wiseGenericPayloadSchema.safeParse(input),
    getCardTransaction: (profileId, transactionId) => wiseService.getCardTransaction(profileId, transactionId),
    getTwCardEncryptionKey: () => wiseService.getTwCardEncryptionKey(),
    getSensitiveCardDetails: (cardToken, payload) => wiseService.getSensitiveCardDetails(cardToken, payload),
    getCardPin: (cardToken, payload) => wiseService.getCardPin(cardToken, payload),
    upsertWiseCardTransactions,
  });

  registerWiseCardOrdersRoutes(app, {
    logger,
    isWiseConfigured,
    getWiseAuthContext,
    parseWiseProfileIdQuery: (input) => wiseProfileIdParamSchema.safeParse(input),
    parseWiseCardOrdersQuery: (input) => wiseCardOrdersQuerySchema.safeParse(input),
    parseWiseCardOrderIdParam: (input) => wiseCardOrderIdParamSchema.safeParse(input),
    parseWiseGenericPayload: (input) => wiseGenericPayloadSchema.safeParse(input),
    listCardOrders: (profileId, pageNumber, pageSize) => wiseService.listCardOrders(profileId, pageNumber, pageSize),
    createCardOrder: (profileId, payload) => wiseService.createCardOrder(profileId, payload),
    listCardOrderAvailability: (profileId) => wiseService.listCardOrderAvailability(profileId),
    getCardOrder: (profileId, cardOrderId) => wiseService.getCardOrder(profileId, cardOrderId),
    getCardOrderRequirements: (profileId, cardOrderId) => wiseService.getCardOrderRequirements(profileId, cardOrderId),
    updateCardOrderStatus: (profileId, cardOrderId, payload) => wiseService.updateCardOrderStatus(profileId, cardOrderId, payload),
    validateCardOrderAddress: (payload) => wiseService.validateCardOrderAddress(payload),
    setCardOrderPin: (cardOrderId, payload) => wiseService.setCardOrderPin(cardOrderId, payload),
    upsertWiseCardOrders,
  });

  registerWiseSpendControlsRoutes(app, {
    logger,
    isWiseConfigured,
    getWiseAuthContext,
    parseWiseProfileIdQuery: (input) => wiseProfileIdParamSchema.safeParse(input),
    parseRuleIdParam: (input) => numericIdParamSchema.safeParse(input),
    parseWiseGenericPayload: (input) => wiseGenericPayloadSchema.safeParse(input),
    listSpendControls: (profileId) => wiseService.listSpendControls(profileId),
    createSpendControl: (profileId, payload) => wiseService.createSpendControl(profileId, payload),
    deleteSpendControl: (profileId, ruleId) => wiseService.deleteSpendControl(profileId, ruleId),
    applySpendControl: (profileId, ruleId, payload) => wiseService.applySpendControl(profileId, ruleId, payload),
    unassignSpendControl: (profileId, ruleId, payload) => wiseService.unassignSpendControl(profileId, ruleId, payload),
    upsertWiseSpendControls,
    deleteSpendControlRecord: async (tenantId, ruleId) => {
      await getDatabase().delete(schema.wiseSpendControls).where(
        and(
          eq(schema.wiseSpendControls.tenantId, tenantId),
          eq(schema.wiseSpendControls.wiseRuleId, ruleId),
        ),
      );
    },
  });

  registerWiseSpendLimitsRoutes(app, {
    logger,
    isWiseConfigured,
    parseWiseProfileIdQuery: (input) => wiseProfileIdParamSchema.safeParse(input),
    parseWiseCardTokenParam: (input) => wiseCardTokenParamSchema.safeParse(input),
    parseWiseGenericPayload: (input) => wiseGenericPayloadSchema.safeParse(input),
    getSpendLimits: (profileId) => wiseService.getSpendLimits(profileId),
    updateSpendLimits: (profileId, payload) => wiseService.updateSpendLimits(profileId, payload),
    getCardSpendLimits: (profileId, cardToken) => wiseService.getCardSpendLimits(profileId, cardToken),
    updateCardSpendLimits: (profileId, cardToken, payload) => wiseService.updateCardSpendLimits(profileId, cardToken, payload),
    deleteCardSpendLimits: (profileId, cardToken) => wiseService.deleteCardSpendLimits(profileId, cardToken),
  });

  registerWiseDisputesRoutes(app, {
    logger,
    isWiseConfigured,
    getWiseAuthContext,
    parseWiseProfileIdQuery: (input) => wiseProfileIdParamSchema.safeParse(input),
    parseWiseDisputeIdParam: (input) => wiseDisputeIdParamSchema.safeParse(input),
    parseWiseGenericPayload: (input) => wiseGenericPayloadSchema.safeParse(input),
    parseWiseFileUpload: (input) => wiseFileUploadSchema.safeParse(input),
    listDisputeReasons: (profileId) => wiseService.listDisputeReasons(profileId),
    getDisputeFlowStep: (profileId, scheme, reason, transactionId, payload) => wiseService.getDisputeFlowStep(profileId, scheme, reason, transactionId, payload),
    submitDisputeFlow: (profileId, scheme, reason, transactionId, payload) => wiseService.submitDisputeFlow(profileId, scheme, reason, transactionId, payload),
    uploadDisputeFile: (profileId, formData) => wiseService.uploadDisputeFile(profileId, formData),
    listDisputes: (profileId, status) => wiseService.listDisputes(profileId, status),
    getDispute: (profileId, disputeId) => wiseService.getDispute(profileId, disputeId),
    updateDisputeStatus: (profileId, disputeId, payload) => wiseService.updateDisputeStatus(profileId, disputeId, payload),
    upsertWiseDisputes,
  });

  registerWiseVerificationKycRoutes(app, {
    logger,
    isWiseConfigured,
    getWiseAuthContext,
    parseWiseProfileIdQuery: (input) => wiseProfileIdParamSchema.safeParse(input),
    parseWiseKycReviewIdParam: (input) => wiseKycReviewIdParamSchema.safeParse(input),
    parseWiseFileUpload: (input) => wiseFileUploadSchema.safeParse(input),
    parseWiseGenericPayload: (input) => wiseGenericPayloadSchema.safeParse(input),
    getVerificationRequiredEvidences: (profileId) => wiseService.getVerificationRequiredEvidences(profileId),
    uploadVerificationDocument: (profileId, formData) => wiseService.uploadVerificationDocument(profileId, formData),
    uploadAdditionalEvidences: (profileId, formData) => wiseService.uploadAdditionalEvidences(profileId, formData),
    listKycReviews: (profileId) => wiseService.listKycReviews(profileId),
    createKycReview: (profileId, payload) => wiseService.createKycReview(profileId, payload),
    getKycReview: (profileId, kycReviewId) => wiseService.getKycReview(profileId, kycReviewId),
    upsertWiseKycReviews,
  });

  registerWiseScaRoutes(app, {
    logger,
    isWiseConfigured,
    parseWiseProfileIdQuery: (input) => wiseProfileIdParamSchema.safeParse(input),
    parseWiseJosePayload: (input) => wiseJosePayloadSchema.safeParse(input),
    getScaOneTimeToken: (profileId) => wiseService.getScaOneTimeToken(profileId),
    createScaSession: (profileId, josePayload) => wiseService.createScaSession(profileId, josePayload),
    createPin: (profileId, josePayload) => wiseService.createPin(profileId, josePayload),
    verifyPin: (profileId, josePayload) => wiseService.verifyPin(profileId, josePayload),
    deletePin: (profileId, josePayload) => wiseService.deletePin(profileId, josePayload),
    createDeviceFingerprint: (profileId, josePayload) => wiseService.createDeviceFingerprint(profileId, josePayload),
    verifyDeviceFingerprint: (profileId, josePayload) => wiseService.verifyDeviceFingerprint(profileId, josePayload),
    deleteDeviceFingerprint: (profileId, josePayload) => wiseService.deleteDeviceFingerprint(profileId, josePayload),
    createFacemap: (profileId, josePayload) => wiseService.createFacemap(profileId, josePayload),
    verifyFacemap: (profileId, josePayload) => wiseService.verifyFacemap(profileId, josePayload),
    deleteFacemap: (profileId, josePayload) => wiseService.deleteFacemap(profileId, josePayload),
  });

  registerWiseWebhookManagementRoutes(app, {
    logger,
    isWiseConfigured,
    getWiseAuthContext,
    parseWiseProfileIdQuery: (input) => wiseProfileIdParamSchema.safeParse(input),
    parseWiseWebhookIdParam: (input) => wiseWebhookIdParamSchema.safeParse(input),
    parseWiseGenericPayload: (input) => wiseGenericPayloadSchema.safeParse(input),
    listWebhooks: (scope) => wiseService.listWebhooks(scope),
    createWebhook: (scope, payload) => wiseService.createWebhook(scope, payload),
    deleteWebhook: (scope, subscriptionId) => wiseService.deleteWebhook(scope, subscriptionId),
    upsertWiseWebhookSubscriptions,
  });

  registerWiseSimulationRoutes(app, {
    logger,
    isWiseConfigured,
    parseWiseProfileIdParam: (input) => wiseProfileIdParamSchema.safeParse(input),
    parseWiseCardTokenParam: (input) => wiseCardTokenParamSchema.safeParse(input),
    parseWiseKycReviewIdParam: (input) => wiseKycReviewIdParamSchema.safeParse(input),
    parseWiseSimulationActionParam: (input) => wiseSimulationActionSchema.safeParse(input),
    parseWiseGenericPayload: (input) => wiseGenericPayloadSchema.safeParse(input),
    simulateTransfer: (transferId, action) => wiseService.simulateTransfer(transferId, action),
    simulateVerification: (profileId, payload) => wiseService.simulateVerification(profileId, payload),
    simulateBalanceTopup: (payload) => wiseService.simulateBalanceTopup(payload),
    simulateCardTransaction: (profileId, cardToken, action, payload) => wiseService.simulateCardTransaction(profileId, cardToken, action, payload),
    simulateCardAuthorisation: (profileId, cardToken, payload) => wiseService.simulateCardAuthorisation(profileId, cardToken, payload),
    simulateCardRefund: (profileId, cardToken, payload) => wiseService.simulateCardRefund(profileId, cardToken, payload),
    simulateCardProduction: (profileId, cardToken, payload) => wiseService.simulateCardProduction(profileId, cardToken, payload),
    simulateCardRecentTransactions: (profileId, cardToken, limit) => wiseService.simulateCardRecentTransactions(profileId, cardToken, limit),
    simulateKycRequirements: (profileId, kycReviewId) => wiseService.simulateKycRequirements(profileId, kycReviewId),
    simulateBankTransactionImport: (profileId, payload) => wiseService.simulateBankTransactionImport(profileId, payload),
  });

  registerWiseOAuthRoutes(app, {
    logger,
    isWiseConfigured,
    getSandboxStatus,
    getProfileIdSafe,
    exchangeRegistrationCode: (params) => wiseService.exchangeRegistrationCode(params),
    exchangeAuthorizationCode: (params) => wiseService.exchangeAuthorizationCode(params),
    refreshUserToken: (refreshToken) => wiseService.refreshUserToken(refreshToken),
  });
}
