import express from 'express';
import type { Request } from 'express';
import Stripe from 'stripe';
import cors from 'cors';
// helmet aplicado via createSecurityMiddleware de @alice/shared-utils
import compression from 'compression';
// rateLimit via createRateLimiter de @alice/shared-utils
// CircuitBreaker via createCircuitBreaker de @alice/shared-utils
// CORREÇÃO PR#107 (10/01/2026): Usar prefixo 'node:' para módulos Node.js built-in
// REF: https://nodejs.org/api/esm.html#node-imports
// REF: Best Practices Node.js ESM 2025 - evita conflitos com pacotes npm de mesmo nome
import { createLogger } from '@alice/logger';
import { 
  createCorrelationMiddleware, 
  createSecurityMiddleware,
  createRateLimiter,
  createErrorHandler,
  createNotFoundHandler,
  generateInternalAuthHeaders,
  initFeatureFlags,
  createAlicePrometheus,
  initRbacPrometheusMetrics,
  setupSwaggerUI,
  INTEGRATIONS_SERVICE_TAGS,
  setPermissionResolver,
  PERMISSION_MAP,
  computeSemHash,
  RATE_LIMIT_CONFIG,
  // CORREÇÃO PR#107 (10/01/2026): Middleware de sessão HTTP para autenticação
  createSessionAuthMiddleware,
  Gauge as PromGauge,
  Counter as PromCounter,
  Histogram as PromHistogram,
  Role,
  verifyImmutableAuditChain,
} from '@alice/shared-utils';
import type { AuthContext, ReasoningMode } from '@alice/shared-utils';
import { integrationsServicePaths, integrationsServiceSchemas } from './openapi-specs.js';
import {
  getServiceUrl,
  integrationsServiceConfigSchema,
  loadConfig,
  readNumberEnv,
  readOptionalStringEnv,
  resolveCorsOrigins,
} from '@alice/config';
import { getDatabase, schema, closeDatabasePool, isPoolHealthy, createDrizzleFeatureFlagStorage, getPool } from '@alice/database';
import { eq, sql, and, inArray } from '@alice/database';
import type {
  TradingIndicatorKey,
  TradingProfileConsensus,
  TradingProfileDataSources,
  TradingProfileModelConfig,
  TradingTechnique,
  TradingEnsembleConfig,
  TradingArbitrageConfig,
  TradingArbitrageExchange,
} from '@alice/shared';
import { z } from 'zod';
import { wiseService } from './wiseService.js';
import { isWiseConfigured, getSandboxStatus, getProfileIdSafe, getWiseCircuitBreakerStatus, validateWiseWebhook, initWiseMetrics } from './wiseClient.js';
import * as kucoinClient from './kucoinClient.js';
import * as kucoinSpotClient from './kucoinSpotClient.js';
import * as kucoinMarginClient from './kucoinMarginClient.js';
import * as kucoinService from './kucoinService.js';
import {
  closeWebSocketClients as closeKucoinWebSocketClients,
  getPrivateWebSocketClient,
  getPublicWebSocketClient,
  initializeWebSocketClients as initializeKucoinWebSocketClients,
  isWebSocketConfigured as isKucoinWebSocketConfigured,
  buildSpotMarketTopic,
  closeSpotWebSocketClients,
  getSpotPrivateWebSocketClient,
  getSpotPublicWebSocketClient,
  initializeSpotWebSocketClients,
  isSpotWebSocketConfigured,
} from './kucoinUnifiedWebSocket.js';
import { initializeBroadcast, getPublisher, closeBroadcast } from './tradingBroadcast.js';
import {
  normalizeTickerData,
  normalizeOrderBookData,
  normalizeKlineData,
  normalizeTradeData,
  normalizeSpotTickerData,
  normalizeSpotOrderBookData,
  normalizeSpotKlineData,
  normalizeSpotTradeData,
} from './tradingTypes.js';
import { sendKucoinErrorResponse } from './kucoin-error-mapper.js';
import * as technicalIndicators from './technical-indicators.js';
import { extractValuesFromLLMResponse } from './llm-validation.js';
import { createLlmSignalResponseParser } from './trading-llm-signal-parser.js';
import {
  startDemoScheduler,
  stopDemoScheduler,
} from './demo-trading-engine.js';
import {
  startPostMortemWorker,
  stopPostMortemWorker,
} from './postmortem-worker.js';
import { queryTradingRAGContext } from './trading-rag-client.js';
import {
  INTEGRATIONS_IMMUTABLE_AUDIT_CHECK_INTERVAL_MS,
  INTEGRATIONS_IMMUTABLE_AUDIT_EVENTS_PER_STREAM_LIMIT,
  INTEGRATIONS_IMMUTABLE_AUDIT_STREAMS_PER_CHECK,
  TRADING_DATASET_MIN_QUALITY,
  TRADING_LLM_PROMPT_MODE,
  TRADING_METRICS_INTERVAL_MS,
  TRADING_MODE,
  TRADING_OPERATION_INTENTS,
  TRADING_PNL_WINDOW_HOURS,
} from './runtime-config.js';
import { createGrafanaClient } from './external/grafana-client.js';
import { createGitHubActionsClient } from './external/github-actions-client.js';
import { createTradingLlmSignalNormalizerService } from './trading-llm-signal-normalizer-service.js';
import {
  buildSendWhatsAppMessage,
  buildValidateTwilioSignature,
} from './twilio-channel-service.js';
import {
  buildProcessMessageWithLLM,
  buildProcessWhatsAppMediaForRAG,
} from './twilio-chat-media-service.js';
import {
  createExecuteStripeCall,
  withTimeout,
} from './integration-external-call-service.js';
import { createIntegrationCallObserverService } from './integration-call-observer-service.js';
import { createIntegrationStartupOrchestrator } from './integration-startup-service.js';
import {
  getSpotMarketTypesForTopic,
  isValidKucoinWsInterval,
  KUCOIN_WS_ORDERBOOK_DEPTHS,
  registerSpotWsMarketType,
  resolveKucoinRestOrderBookDepth,
  resolveKucoinWsOrderBookDepth,
  resolveSpotSymbolFromTopic,
  resolveTradingIntervals,
  unregisterSpotWsMarketType,
} from './kucoin-ws-config-service.js';
import { createKucoinWsMetricsWiring } from './kucoin-ws-metrics-service.js';
import { createResolveKucoinTenantIdForPrivateWs } from './kucoin-private-ws-tenant-service.js';
import { createTradingMarketDataHandlers } from './trading-market-data-handlers.js';
import { createTradingRequestResolver } from './trading-request-resolver-service.js';
import { createTradingSymbolCatalogService } from './trading-symbol-catalog-service.js';
import { createKucoinTradingFeeService } from './kucoin-trading-fee-service.js';
import { createTradingMarketContextService } from './trading-market-context-service.js';
import { createTradingNewsService } from './trading-news-service.js';
import { createTradingSignalSupportService } from './trading-signal-support-service.js';
import {
  aggregateTechniqueScores,
  buildEnsembleResult,
  buildMajorityConsensus,
} from './trading-analysis-consensus-service.js';
import {
  buildTradePlanFromAnalysis,
  formatDurationLabel,
} from './trading-signal-plan-service.js';
import {
  createTradingLlmPromptService,
} from './trading-llm-prompt-service.js';
import { createTradingSignalAnalysisOrchestrationService } from './trading-signal-analysis-orchestration-service.js';
import { createTradingSignalContextService } from './trading-signal-context-service.js';
import { createTradingScopeProfileService } from './trading-scope-profile-service.js';
import { createTradingArbitrageService } from './trading-arbitrage-service.js';
import { createTradingDatasetCoreService } from './trading-dataset-core-service.js';
import { createTradingDatasetSeedService } from './trading-dataset-seed-service.js';
import { createTradingDatasetNamespaceService } from './trading-dataset-namespace-service.js';
import { createTradingDatasetOrchestrationService } from './trading-dataset-orchestration-service.js';
import { createTradingSignalPromotionService } from './trading-signal-promotion-service.js';
import { createTradingLegacyInstitutionalSignalService } from './trading-legacy-institutional-signal-service.js';
import { createTradingLlmExecutionService } from './trading-llm-execution-service.js';
import { createTradingLlmSignalGenerationService } from './trading-llm-signal-generation-service.js';
import { createTradingLlmSignalPostProcessingService } from './trading-llm-signal-post-processing-service.js';
import { createTradingLlmSignalPersistenceService } from './trading-llm-signal-persistence-service.js';
import { createTradingLlmValidationFinalizeService } from './trading-llm-validation-finalize-service.js';
import { createTradingTechnicalAnalysisService } from './trading-technical-analysis-service.js';
import { createTradingSchedulerRuntimeService } from './trading-scheduler-runtime-service.js';
import { createTradingMetricsRuntimeService } from './trading-metrics-runtime-service.js';
import { createIntegrationsImmutableAuditRuntimeService } from './integrations-immutable-audit-runtime-service.js';
import {
  createTradingProfileConfigService,
  TradingConfigError,
} from './trading-profile-config-service.js';
import { createTradingAgentContextService } from './trading-agent-context-service.js';
import {
  initializeGmailTransporter,
  initializeStripeClient,
} from './integrations-bootstrap-service.js';
import { createIntegrationHealthRefresher } from './integration-health-service.js';
import {
  checkWebhookIdempotency,
  markWebhookProcessed,
} from './webhook-idempotency-service.js';
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
import { registerDemoTradingRoutes } from './routes/demo-trading-routes.js';
import { registerEmailRoutes } from './routes/email-routes.js';
import { registerGrafanaAndGithubRoutes } from './routes/grafana-github-routes.js';
import { registerHealthProbeRoutes } from './routes/health-probe-routes.js';
import { registerIntegrationCoreRoutes } from './routes/integration-core-routes.js';
import { registerIntegrationRegistryRoutes } from './routes/integration-registry-routes.js';
import { registerPostMortemRoutes } from './routes/postmortem-routes.js';
import { registerStripeRoutes } from './routes/stripe-routes.js';
import { registerTradingAccountManagementRoutes } from './routes/trading-account-management-routes.js';
import { registerTradingAnalysisRoutes } from './routes/trading-analysis-routes.js';
import { registerTradingAnalysisHistoryRoutes } from './routes/trading-analysis-history-routes.js';
import { registerTradingAutomationRoutes } from './routes/trading-automation-routes.js';
import { registerTradingControlRoutes } from './routes/trading-control-routes.js';
import { registerTradingDatasetRoutes } from './routes/trading-dataset-routes.js';
import { registerTradingFuturesRoutes } from './routes/trading-futures-routes.js';
import { registerTradingMarginRoutes } from './routes/trading-margin-routes.js';
import { registerTradingMarketDataRoutes } from './routes/trading-market-data-routes.js';
import { registerTradingSignalActionRoutes } from './routes/trading-signal-action-routes.js';
import { registerTradingMarketRiskRoutes } from './routes/trading-market-risk-routes.js';
import { registerTradingOrderGovernanceRoutes } from './routes/trading-order-governance-routes.js';
import { registerTradingSignalPromotionRoutes } from './routes/trading-signal-promotion-routes.js';
import { registerTradingSchedulerNewsRoutes } from './routes/trading-scheduler-news-routes.js';
import { registerTradingSpotRoutes } from './routes/trading-spot-routes.js';
import { registerTradingStopOrderRoutes } from './routes/trading-stop-order-routes.js';
import { registerTradingSignalHistoryRoutes } from './routes/trading-signal-history-routes.js';
import { registerTradingValidationRoutes } from './routes/trading-validation-routes.js';
import { registerTradingSignalGenerationRoutes } from './routes/trading-signal-generation-routes.js';
import { registerTradingSymbolRoutes } from './routes/trading-symbol-routes.js';
import { registerTradingWebsocketRoutes } from './routes/trading-websocket-routes.js';
import { registerTwilioOperationalRoutes } from './routes/twilio-operational-routes.js';
import { registerTwilioWebhookRoutes } from './routes/twilio-webhook-routes.js';
import { registerWiseAccountDetailsRoutes } from './routes/wise-account-details-routes.js';
import { registerWiseBalanceAndQuotesRoutes } from './routes/wise-balance-and-quotes-routes.js';
import { registerWiseCardManagementRoutes } from './routes/wise-card-management-routes.js';
import { registerWiseCardOrdersRoutes } from './routes/wise-card-orders-routes.js';
import { registerWiseCardSecureRoutes } from './routes/wise-card-secure-routes.js';
import { registerWiseDisputesRoutes } from './routes/wise-disputes-routes.js';
import { registerWiseOAuthRoutes } from './routes/wise-oauth-routes.js';
import { registerWiseRecipientsTransfersRoutes } from './routes/wise-recipients-transfers-routes.js';
import { registerWiseReferenceRoutes } from './routes/wise-reference-routes.js';
import { registerWiseScaRoutes } from './routes/wise-sca-routes.js';
import { registerWiseSimulationRoutes } from './routes/wise-simulation-routes.js';
import { registerWiseSpendControlsRoutes } from './routes/wise-spend-controls-routes.js';
import { registerWiseSpendLimitsRoutes } from './routes/wise-spend-limits-routes.js';
import { registerWiseVerificationKycRoutes } from './routes/wise-verification-kyc-routes.js';
import { registerWiseWebhookManagementRoutes } from './routes/wise-webhook-management-routes.js';
import { registerWiseWebhookRoutes } from './routes/wise-webhook-routes.js';
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
import { createKucoinAccountClientAdapter } from './kucoin-account-client-adapter.js';
import {
  registerIntegrationsShutdownCallbacks,
  startIntegrationsServer,
} from './integrations-lifecycle.js';

const logger = createLogger('integrations-service');
const config = loadConfig(integrationsServiceConfigSchema);

// ============================================================================
// TRADING SINAIS LLM - TIPOS E CONSTANTES
// ============================================================================
type TradingSignalGenerationSource = 'on_demand' | 'scheduler' | 'chat' | 'auto';

type TradingMarketType = 'futures' | 'spot' | 'margin';
type TradingMarginMode = 'cross' | 'isolated';
type TradingIntervalValue = keyof typeof TRADING_INTERVAL_GRANULARITY;

const TRADING_INTERVAL_GRANULARITY = {
  '1m': 1, '3m': 3, '5m': 5, '15m': 15, '30m': 30,
  '1h': 60, '2h': 120, '4h': 240, '8h': 480, '12h': 720,
  '1d': 1440, '1w': 10080,
} as const;
const TRADING_INTERVALS = Object.keys(TRADING_INTERVAL_GRANULARITY) as TradingIntervalValue[];

const {
  respondKucoinNotConfigured,
  resolveTradingSymbolOrRespond,
  resolveMarketTypeParam,
  resolveSymbolFromQuery,
  resolveTradingIntervalGranularity,
} = createTradingRequestResolver({
  tradingIntervalGranularity: TRADING_INTERVAL_GRANULARITY,
});

const {
  normalizeSignalSymbols,
  selectSymbolFromUniverseCandidates,
  normalizeSymbolList,
  resolveConnectedTradingVenues,
  loadTradingAutoAssetsForVenue,
  fetchTradingSymbolPreferences,
} = createTradingSymbolCatalogService(logger);

const {
  resolveArbitrageFeePctForExchanges,
  resolveNetworkFeesForTenant,
} = createKucoinTradingFeeService(logger);

const {
  buildMarketContextFromSignal,
} = createTradingMarketContextService({
  resolveTradingIntervalGranularity,
});

const {
  normalizeTradingNewsConfig,
  fetchNewsSummary,
} = createTradingNewsService({
  logger,
  generateInternalAuthHeaders,
  resolveRagServiceUrl: () => RAG_SERVICE_URL_FINAL,
});

const {
  splitSymbolPair,
  deriveIntermediateAssetsFromSymbols,
  mapTradingErrorToUserMessage,
  resolveDefaultSymbolForMarketType,
} = createTradingSignalSupportService();

const {
  getOrderBookSnapshot,
  calculateTriangularArbitrage,
} = createTradingArbitrageService({
  logger,
  resolveTradingSymbolStrict: (auth, symbol, marketType, marginMode) =>
    kucoinService.resolveTradingSymbolStrict(auth, symbol, marketType, marginMode),
  getSpotOrderBook: (symbol) => kucoinSpotClient.getSpotOrderBook(symbol),
  getOrderBook: (symbol, depth) => kucoinClient.getOrderBook(symbol, depth),
});

// CORREÇÃO A2: Timeouts LLM configuráveis via env vars (sem hardcoded)
// Ref: Regra 6 - PROIBIDO valores hardcoded
const LLM_SIGNAL_TIMEOUT_MS = readNumberEnv('LLM_SIGNAL_TIMEOUT_MS', { defaultValue: 240000, integer: true, min: 1 });
const LLM_SIGNAL_TIMEOUT_ARBITRAGE_MS = readNumberEnv('LLM_SIGNAL_TIMEOUT_ARBITRAGE_MS', { defaultValue: 360000, integer: true, min: 1 });

// CORREÇÃO M4: maxAllowedDeviation configurável via env var
const LLM_VALIDATION_MAX_DEVIATION = readNumberEnv('LLM_VALIDATION_MAX_DEVIATION', {
  defaultValue: 0.01,
  min: 0,
  max: 1,
});
const { requestTradingSignalCompletion } = createTradingLlmExecutionService({
  logger,
  llmSignalTimeoutMs: LLM_SIGNAL_TIMEOUT_MS,
  llmSignalTimeoutArbitrageMs: LLM_SIGNAL_TIMEOUT_ARBITRAGE_MS,
  createTradingScopeRequiredError: (message) => new TradingConfigError(message),
});
const TRADING_INTERVAL_VALUES = TRADING_INTERVALS as [TradingIntervalValue, ...TradingIntervalValue[]];
const TRADING_INTERVAL_ZOD = z.enum(TRADING_INTERVAL_VALUES);
const TRADING_INDICATOR_KEYS = [
  'rsi',
  'macd',
  'moving_averages',
  'bollinger',
  'atr',
  'stochastic',
  'adx',
  'support_resistance',
  'volume',
] as const;
const TRADING_INDICATOR_ZOD = z.enum(TRADING_INDICATOR_KEYS);
const TRADING_TECHNIQUE_KEYS = [
  'scalping',
  'day_trade',
  'swing',
  'position',
  'trend',
  'mean_reversion',
  'breakout',
  'range',
  'momentum',
  'arbitrage_triangular',
  'cash_and_carry',
  'basis_trade',
  'funding_arbitrage',
  'grid_trading',
  'market_making',
] as const;
const TRADING_TECHNIQUE_ZOD = z.enum(TRADING_TECHNIQUE_KEYS);

const DEFAULT_TRADING_TECHNIQUES: TradingTechnique[] = [
  'scalping',
  'day_trade',
  'swing',
  'position',
  'trend',
  'mean_reversion',
  'breakout',
  'range',
  'momentum',
  'cash_and_carry',
  'basis_trade',
  'funding_arbitrage',
  'grid_trading',
  'market_making',
];

const DEFAULT_TRADING_ENSEMBLE_CONFIG: TradingEnsembleConfig = {
  mode: 'ensemble_top3',
  topN: 3,
};

const ARBITRAGE_EXCHANGE_LABELS: Record<TradingArbitrageExchange, string> = {
  kucoin: 'KuCoin',
};

const MAX_ARBITRAGE_INTERMEDIATE_ASSETS = 30;

const { calculateAndPersistTechnicalAnalysis } = createTradingTechnicalAnalysisService({
  resolveTradingIntervalGranularity,
  resolveTradingSymbolStrict: (auth, symbol, marketType, marginMode) =>
    kucoinService.resolveTradingSymbolStrict(auth, symbol, marketType, marginMode),
  getSpotKlines: (symbol, granularityLabel, fromSeconds, toSeconds) =>
    kucoinSpotClient.getSpotKlines(symbol, granularityLabel, fromSeconds, toSeconds),
  getFuturesKlines: (symbol, granularity, from, to) =>
    kucoinClient.getKlines(symbol, granularity, from, to),
  buildEnsembleResult: (techniqueScores, ensembleConfig) =>
    buildEnsembleResult(techniqueScores, ensembleConfig),
  defaultTradingTechniques: DEFAULT_TRADING_TECHNIQUES,
  defaultTradingEnsembleConfig: DEFAULT_TRADING_ENSEMBLE_CONFIG,
});

// CORREÇÃO CR4 (07/02/2026): Validação prévia de credentials antes de APIs autenticadas.
// Ref: https://www.kucoin.com/docs-new/api-3470148 (Get Actual Fee - Spot/Margin - REQUER auth)
// Ref: https://www.kucoin.com/docs-new/api-3470220 (Futures contract info - público, mas fees via contrato)

const {
  parseListParam,
  parseTimeframesParam,
  parseIndicatorsParam,
  parseTechniquesParam,
  normalizeTradingTechniques,
  normalizeTradingEnsembleConfig,
  normalizeTradingArbitrageConfig,
  assertArbitrageConfigForTechniques,
  normalizeTradingProfile,
} = createTradingProfileConfigService({
  tradingIntervalZod: TRADING_INTERVAL_ZOD,
  tradingIndicatorZod: TRADING_INDICATOR_ZOD,
  tradingTechniqueZod: TRADING_TECHNIQUE_ZOD,
  tradingIndicatorKeys: TRADING_INDICATOR_KEYS,
  tradingIntervalGranularity: TRADING_INTERVAL_GRANULARITY,
  defaultTradingTechniques: DEFAULT_TRADING_TECHNIQUES,
  defaultTradingEnsembleConfig: DEFAULT_TRADING_ENSEMBLE_CONFIG,
  maxArbitrageIntermediateAssets: MAX_ARBITRAGE_INTERMEDIATE_ASSETS,
  normalizeTradingNewsConfig,
});

const {
  getAgenticSettingsOrDefault,
  resolveTradingAgentContext,
  resolveSchedulerUserId,
  buildTradingSignalSystemPrompt,
} = createTradingAgentContextService({
  TradingConfigErrorCtor: TradingConfigError,
});

function truncateText(input: string, maxLength: number): string {
  if (input.length <= maxLength) return input;
  return `${input.slice(0, maxLength)}…`;
}

const {
  buildMultiTimeframePrompt,
  buildTradingSignalPromptBudget,
} = createTradingLlmPromptService({
  truncateText,
  formatAnalysisForLlm: (analysis) =>
    technicalIndicators.formatAnalysisForLLM(analysis as technicalIndicators.TechnicalAnalysisResult),
});

/** Source types de trading em training_data (tabela universal). */
const TRADING_SOURCE_TYPES = ['trading_signal', 'trading_order', 'trading_postmortem', 'trading_demo'] as const;

const {
  resolveTradingNamespaceId,
  fetchTradingDatasetSummary,
  getOrCreateTradingProfile,
  validateTenantNamespace,
} = createTradingScopeProfileService({
  truncateText,
  tradingSourceTypes: TRADING_SOURCE_TYPES,
});

const {
  generateTradingDatasetEmbedding,
  detectTradingDatasetDuplicate,
  computeTradingDatasetQualityScore,
  resolveActionTypeFromOrder,
  buildOrderExecutionPrompt,
} = createTradingDatasetCoreService({
  tradingSourceTypes: TRADING_SOURCE_TYPES,
  similarityThreshold: 0.85,
});
const { buildTradingDatasetSeedFromSignal } = createTradingDatasetSeedService({
  resolveTradingIntervalFromUnknown: (value) => {
    const parsed = TRADING_INTERVAL_ZOD.safeParse(value);
    return parsed.success ? parsed.data : null;
  },
  buildMarketContextFromSignal: (params) => buildMarketContextFromSignal(params),
  buildMultiTimeframePrompt: (params) => buildMultiTimeframePrompt(params),
  buildMajorityConsensus: (matrix) => buildMajorityConsensus(matrix),
});

const { resolveDatasetNamespace } = createTradingDatasetNamespaceService({
  resolveTradingNamespaceId,
  validateTenantNamespace,
  namespaceInferenceConfidence: 0.95,
});

let tradingDatasetOrchestrationService: ReturnType<typeof createTradingDatasetOrchestrationService> | null = null;
const tradingSignalPromotionService = createTradingSignalPromotionService();

async function createTradingDatasetFromSignalSource(params: {
  authContext: { tenantId: string; userId: string };
  signal: schema.TradingSignal;
  reviewNotes?: string;
  namespaceId?: string;
}) {
  if (!tradingDatasetOrchestrationService) {
    throw new Error('Trading dataset orchestration service não inicializado.');
  }
  const result = await tradingDatasetOrchestrationService.createTradingDatasetFromSignalSource(params);
  await tradingSignalPromotionService.registerDatasetCandidate({
    authContext: params.authContext,
    signal: params.signal,
    datasetCandidateId: result.dataset.id,
    reason: params.reviewNotes ?? 'signal routed to training dataset curation',
  });
  return result;
}

async function createTradingDatasetFromOrder(params: {
  authContext: { tenantId: string; userId: string };
  order: schema.TradingOrder;
}) {
  if (!tradingDatasetOrchestrationService) {
    throw new Error('Trading dataset orchestration service não inicializado.');
  }
  return tradingDatasetOrchestrationService.createTradingDatasetFromOrder(params);
}

const app = express();
setPermissionResolver(async (auth: AuthContext) => {
  const db = getDatabase();
  const baseRoleRows = await db.query.userRoles.findMany({
    where: eq(schema.userRoles.userId, auth.userId),
    columns: { role: true },
  });
  let baseRoles = baseRoleRows.map((row) => row.role as Role).filter(Boolean);
  if (baseRoles.length === 0) {
    const fallbackUser = await db.query.users.findFirst({
      where: eq(schema.users.id, auth.userId),
      columns: { role: true },
    });
    if (fallbackUser?.role) {
      baseRoles = [fallbackUser.role as Role];
    }
  }

  const customRoleRows = await db.query.userCustomRoles.findMany({
    where: eq(schema.userCustomRoles.userId, auth.userId),
    with: {
      customRole: {
        columns: { id: true, ativo: true, tenantId: true },
      },
    },
  });
  let customRoleIds = customRoleRows
    .filter((row) => row.customRole?.ativo)
    .filter((row) => !auth.tenantId || row.customRole?.tenantId === auth.tenantId)
    .map((row) => row.customRoleId);
  if (customRoleIds.length === 0) {
    const fallbackUser = await db.query.users.findFirst({
      where: eq(schema.users.id, auth.userId),
      columns: { customRoleId: true },
    });
    const fallbackCustomRoleId = fallbackUser?.customRoleId ?? undefined;
    if (fallbackCustomRoleId) {
      const activeRole = await db.query.customRoles.findFirst({
        where: and(
          eq(schema.customRoles.id, fallbackCustomRoleId),
          eq(schema.customRoles.ativo, true),
          auth.tenantId ? eq(schema.customRoles.tenantId, auth.tenantId) : sql`1=1`
        ),
        columns: { id: true },
      });
      if (activeRole) {
        customRoleIds = [fallbackCustomRoleId];
      }
    }
  }

  const isAdminRole = baseRoles.some((role) => role === 'admin' || role === 'super_admin');
  const rolePermissions = isAdminRole
    ? await db.query.permissions.findMany({ columns: { codigo: true } })
    : baseRoles.length > 0
      ? await db.query.rolePermissions.findMany({
        where: inArray(schema.rolePermissions.role, baseRoles),
        with: { permission: true },
      })
      : [];
  const customRolePermissions = customRoleIds.length > 0
    ? await db.query.customRolePermissions.findMany({
      where: inArray(schema.customRolePermissions.customRoleId, customRoleIds),
      with: { permission: true },
    })
    : [];
  const dbPermissions = rolePermissions
    .map((rp) => ('codigo' in rp ? rp.codigo : (rp as { permission?: { codigo?: string | null } }).permission?.codigo))
    .filter((code): code is string => Boolean(code));
  const customPermissions = customRolePermissions
    .map((rp) => (rp as { permission?: { codigo?: string | null } }).permission?.codigo)
    .filter((code): code is string => Boolean(code));
  const basePermissions = Object.entries(PERMISSION_MAP)
    .filter(([, roles]) => roles.some((role) => baseRoles.includes(role as Role)))
    .map(([code]) => code);
  const resolved = new Set<string>([...dbPermissions, ...customPermissions, ...basePermissions]);
  if (isAdminRole) {
    resolved.add('admin:alice_core:write');
  }
  return Array.from(resolved);
});

async function isAdminUser(authContext?: { userId?: string | null }): Promise<boolean> {
  const userId = authContext?.userId ?? null;
  if (!userId) return false;
  const db = getDatabase();
  const baseRoleRows = await db.query.userRoles.findMany({
    where: eq(schema.userRoles.userId, userId),
    columns: { role: true },
  });
  const baseRoles = baseRoleRows.map((row) => row.role as Role).filter(Boolean);
  if (baseRoles.some((role) => role === 'admin' || role === 'super_admin')) {
    return true;
  }
  const fallbackUser = await db.query.users.findFirst({
    where: eq(schema.users.id, userId),
    columns: { role: true },
  });
  return fallbackUser?.role === 'admin' || fallbackUser?.role === 'super_admin';
}

// ============================================================================
// PROMETHEUS: Instrumentação de métricas (Regra 16 - Observability Enterprise)
// ============================================================================
const { metrics, metricsRouter, httpMetricsMiddleware } = createAlicePrometheus({
  serviceName: 'integrations-service',
  collectDefaultMetrics: true,
});

const integrationsConfiguredGauge = new PromGauge({
  name: 'alice_integrations_configured',
  help: 'Integrações configuradas (1=sim, 0=não)',
  labelNames: ['integration'] as const,
  registers: [metrics.registry],
});

const integrationsOperationalGauge = new PromGauge({
  name: 'alice_integrations_operational',
  help: 'Integrações operacionais (1=ok, 0=indisponível)',
  labelNames: ['integration'] as const,
  registers: [metrics.registry],
});

const tradingDatasetMetrics = {
  createdTotal: new PromCounter({
    name: 'alice_trading_dataset_created_total',
    help: 'Total de datasets de trading criados',
    labelNames: ['source_type', 'status'] as const,
    registers: [metrics.registry],
  }),
  rejectedTotal: new PromCounter({
    name: 'alice_trading_dataset_rejected_total',
    help: 'Total de datasets de trading rejeitados automaticamente',
    labelNames: ['reason', 'source_type'] as const,
    registers: [metrics.registry],
  }),
  duplicatesTotal: new PromCounter({
    name: 'alice_trading_dataset_duplicates_total',
    help: 'Total de datasets de trading detectados como duplicados',
    labelNames: ['source_type'] as const,
    registers: [metrics.registry],
  }),
  qualityScore: new PromHistogram({
    name: 'alice_trading_dataset_quality_score',
    help: 'Distribuição do score de qualidade dos datasets de trading',
    buckets: [0, 0.25, 0.5, 0.75, 0.9, 0.95, 1],
    registers: [metrics.registry],
  }),
};

tradingDatasetOrchestrationService = createTradingDatasetOrchestrationService({
  tradingDatasetMinQuality: TRADING_DATASET_MIN_QUALITY,
  computeSemHash,
  buildTradingDatasetSeedFromSignal,
  buildMarketContextFromSignal: (params) => buildMarketContextFromSignal(params),
  generateTradingDatasetEmbedding,
  detectTradingDatasetDuplicate,
  computeTradingDatasetQualityScore,
  resolveActionTypeFromOrder,
  buildOrderExecutionPrompt,
  resolveDatasetNamespace,
  recordDatasetMetrics: (params) => {
    tradingDatasetMetrics.createdTotal.labels(params.sourceType, params.status).inc();
    tradingDatasetMetrics.qualityScore.observe(params.qualityScore);
    if (params.isDuplicate) {
      tradingDatasetMetrics.duplicatesTotal.labels(params.sourceType).inc();
      tradingDatasetMetrics.rejectedTotal.labels('duplicate', params.sourceType).inc();
    }
    if (params.autoRejectedByQuality) {
      tradingDatasetMetrics.rejectedTotal.labels('quality', params.sourceType).inc();
    }
  },
});

const tradingAutoRunErrorsTotal = new PromCounter({
  name: 'alice_trading_auto_run_errors_total',
  help: 'Total de erros em auto runs de trading',
  labelNames: ['run_type', 'stage'] as const,
  registers: [metrics.registry],
});

const immutableAuditIntegrityChecksTotal = new PromCounter({
  name: 'alice_integrations_immutable_audit_integrity_checks_total',
  help: 'Total de verificacoes periodicas de integridade do ledger imutavel no integrations-service',
  labelNames: ['result'] as const,
  registers: [metrics.registry],
});

const immutableAuditIntegrityStatusGauge = new PromGauge({
  name: 'alice_integrations_immutable_audit_integrity_status',
  help: 'Status da ultima verificacao de integridade do ledger imutavel (1=ok,0=erro)',
  registers: [metrics.registry],
});

const immutableAuditIntegrityBrokenStreamsGauge = new PromGauge({
  name: 'alice_integrations_immutable_audit_integrity_broken_streams',
  help: 'Quantidade de streams com integridade quebrada na ultima verificacao',
  registers: [metrics.registry],
});

const immutableAuditIntegrityCheckedStreamsGauge = new PromGauge({
  name: 'alice_integrations_immutable_audit_integrity_checked_streams',
  help: 'Quantidade de streams avaliadas na ultima verificacao',
  registers: [metrics.registry],
});

const immutableAuditIntegrityLastCheckTimestampSecondsGauge = new PromGauge({
  name: 'alice_integrations_immutable_audit_integrity_last_check_timestamp_seconds',
  help: 'Timestamp unix em segundos da ultima verificacao de integridade do ledger imutavel',
  registers: [metrics.registry],
});

const highRiskAuditEventsTotal = new PromCounter({
  name: 'alice_high_risk_audit_events_total',
  help: 'Total de eventos de auditoria de alto risco registrados',
  labelNames: ['service', 'event_type', 'result'] as const,
  registers: [metrics.registry],
});

const tradingRiskGateBlockTotal = new PromCounter({
  name: 'alice_trading_risk_gate_block_total',
  help: 'Total de bloqueios aplicados pelo risk gate de trading',
  labelNames: ['reason'] as const,
  registers: [metrics.registry],
});

const tradingRealOrderAttemptTotal = new PromCounter({
  name: 'alice_trading_real_order_attempt_total',
  help: 'Total de tentativas de execucao de ordem real',
  labelNames: ['status', 'market_type'] as const,
  registers: [metrics.registry],
});

kucoinService.setHighRiskAuditMetricObserver((eventType, result) => {
  highRiskAuditEventsTotal.inc({
    service: 'integrations-service',
    event_type: eventType,
    result,
  });
});

kucoinService.setTradingRiskGateMetricObserver((reasonCode, decision) => {
  if (decision === 'block') {
    tradingRiskGateBlockTotal.inc({ reason: reasonCode });
  }
});

kucoinService.setTradingRealOrderAttemptMetricObserver((status, marketType) => {
  tradingRealOrderAttemptTotal.inc({
    status,
    market_type: marketType,
  });
});

const {
  updateIntegrationMetrics,
  observeIntegrationCall,
} = createIntegrationCallObserverService({
  integrationsConfiguredGauge,
  integrationsOperationalGauge,
  integrationsMetrics: metrics.integrations,
});

const tradingPnlRealizedUsd = new PromGauge({
  name: 'alice_trading_pnl_realized_usd',
  help: 'PnL realizado (USD) nas últimas 24h',
  registers: [metrics.registry],
});

const tradingPnlUnrealizedUsd = new PromGauge({
  name: 'alice_trading_pnl_unrealized_usd',
  help: 'PnL não realizado (USD) das posições abertas',
  registers: [metrics.registry],
});

const tradingOrdersActive = new PromGauge({
  name: 'alice_trading_orders_active',
  help: 'Total de ordens ativas (pending/submitted/open)',
  registers: [metrics.registry],
});

const tradingRsiGauge = new PromGauge({
  name: 'alice_trading_rsi',
  help: 'RSI mais recente por símbolo',
  labelNames: ['symbol'] as const,
  registers: [metrics.registry],
});

const tradingBollingerUpper = new PromGauge({
  name: 'alice_trading_bollinger_upper',
  help: 'Bollinger Upper Band por símbolo',
  labelNames: ['symbol'] as const,
  registers: [metrics.registry],
});

const tradingBollingerMiddle = new PromGauge({
  name: 'alice_trading_bollinger_middle',
  help: 'Bollinger Middle Band por símbolo',
  labelNames: ['symbol'] as const,
  registers: [metrics.registry],
});

const tradingBollingerLower = new PromGauge({
  name: 'alice_trading_bollinger_lower',
  help: 'Bollinger Lower Band por símbolo',
  labelNames: ['symbol'] as const,
  registers: [metrics.registry],
});

const tradingPriceUsd = new PromGauge({
  name: 'alice_trading_price_usd',
  help: 'Preço atual (USD) por símbolo',
  labelNames: ['symbol'] as const,
  registers: [metrics.registry],
});

const tradingPromptTokensEstimate = new PromGauge({
  name: 'trading_prompt_tokens_estimate',
  help: 'Estimativa de tokens para prompt de sanity-check do trading institucional',
  labelNames: ['prompt_mode'] as const,
  registers: [metrics.registry],
});

const { generateLegacyInstitutionalSignal } = createTradingLegacyInstitutionalSignalService({
  logger,
  tradingMode: TRADING_MODE,
  tradingPromptMode: TRADING_LLM_PROMPT_MODE,
  tradingOperationIntents: TRADING_OPERATION_INTENTS,
  setPromptTokensEstimate: (promptMode, estimatedTokens) =>
    tradingPromptTokensEstimate.labels(promptMode).set(estimatedTokens),
  createSignal: (authContext, payload) => kucoinService.createSignal(authContext, payload),
});

const {
  startTradingMetricsScheduler,
  stopTradingMetricsScheduler,
} = createTradingMetricsRuntimeService({
  logger,
  tradingMetricsIntervalMs: TRADING_METRICS_INTERVAL_MS,
  tradingPnlWindowHours: TRADING_PNL_WINDOW_HOURS,
  getAllowedSymbols: () => kucoinClient.getAllowedSymbols(),
  tradingPnlRealizedUsd,
  tradingPnlUnrealizedUsd,
  tradingOrdersActive,
  tradingRsiGauge,
  tradingBollingerUpper,
  tradingBollingerMiddle,
  tradingBollingerLower,
  tradingPriceUsd,
});

const {
  integrationsImmutableAuditIntegrityState,
  runIntegrationsImmutableAuditIntegrityCheck,
  startIntegrationsImmutableAuditIntegrityScheduler,
  stopIntegrationsImmutableAuditIntegrityScheduler,
} = createIntegrationsImmutableAuditRuntimeService({
  logger,
  immutableAuditCheckIntervalMs: INTEGRATIONS_IMMUTABLE_AUDIT_CHECK_INTERVAL_MS,
  immutableAuditStreamsPerCheck: INTEGRATIONS_IMMUTABLE_AUDIT_STREAMS_PER_CHECK,
  immutableAuditEventsPerStreamLimit: INTEGRATIONS_IMMUTABLE_AUDIT_EVENTS_PER_STREAM_LIMIT,
  verifyImmutableAuditChain,
  immutableAuditIntegrityChecksTotal,
  immutableAuditIntegrityStatusGauge,
  immutableAuditIntegrityBrokenStreamsGauge,
  immutableAuditIntegrityCheckedStreamsGauge,
  immutableAuditIntegrityLastCheckTimestampSecondsGauge,
});

const {
  startTradingSignalScheduler,
  stopTradingSignalScheduler,
  startTradingAnalysisScheduler,
  stopTradingAnalysisScheduler,
} = createTradingSchedulerRuntimeService({
  logger,
  normalizeSignalSymbols,
  getOrCreateTradingProfile,
  normalizeTradingProfile,
  resolveSchedulerUserId,
  generateTradingSignalFromLlm,
  calculateAndPersistTechnicalAnalysis,
  assertArbitrageConfigForTechniques,
  parseTradingInterval: (interval) => TRADING_INTERVAL_ZOD.parse(interval),
  signalSchedulerPollIntervalMs: 30000,
  analysisSchedulerPollIntervalMs: 30000,
});

// ============================================================================
// WS5: Métricas operacionais - KuCoin WebSocket
// ============================================================================
// Requisitos:
// - Não usar WS como fonte de verdade de dados de negócio (market data continua via REST)
// - Expor estado para observabilidade (degraded quando WS está down/reconnecting)
// - Sem alta cardinalidade (somente label channel=public|private)

const kucoinWsStateGauge = new PromGauge({
  name: 'alice_kucoin_ws_state',
  help: 'Estado do KuCoin WebSocket (0=disconnected, 0.25=connecting, 0.5=reconnecting, 1=connected)',
  labelNames: ['channel'] as const,
  registers: [metrics.registry],
});

const kucoinWsConnectedGauge = new PromGauge({
  name: 'alice_kucoin_ws_connected',
  help: 'KuCoin WebSocket conectado (1=connected, 0=not connected)',
  labelNames: ['channel'] as const,
  registers: [metrics.registry],
});

const kucoinWsReconnectsTotal = new PromCounter({
  name: 'alice_kucoin_ws_reconnects_total',
  help: 'Total de reconexões do KuCoin WebSocket',
  labelNames: ['channel'] as const,
  registers: [metrics.registry],
});

const kucoinWsErrorsTotal = new PromCounter({
  name: 'alice_kucoin_ws_errors_total',
  help: 'Total de erros emitidos pelo KuCoin WebSocket',
  labelNames: ['channel'] as const,
  registers: [metrics.registry],
});

const kucoinWsSubscriptionsTotal = new PromCounter({
  name: 'alice_kucoin_ws_subscriptions_total',
  help: 'Total de subscriptions KuCoin WS (subscribe/unsubscribe)',
  labelNames: ['action', 'channel', 'status'] as const,
  registers: [metrics.registry],
});

// Tenant alvo para eventos privados de KuCoin via WS (ordens/posição/balance).
// Resolução dinâmica via banco para evitar hardcoded e manter multi-tenancy auditável.
const resolveKucoinTenantIdForPrivateWs = createResolveKucoinTenantIdForPrivateWs(logger);

const wireKucoinWebSocketMetrics = createKucoinWsMetricsWiring({
  kucoinWsStateGauge,
  kucoinWsConnectedGauge,
  kucoinWsReconnectsTotal,
  kucoinWsErrorsTotal,
});

// Inicializar métricas RBAC (Regra 16 - Observability Enterprise)
initRbacPrometheusMetrics(metrics.rbac);
logger.info('Métricas RBAC Prometheus inicializadas no integrations-service');

// Endpoint /metrics para Prometheus scraper (antes de outros middlewares)
app.use(metricsRouter);

// ============================================================================
// OPENAPI/SWAGGER: Documentação da API (OWASP API9)
// ============================================================================
setupSwaggerUI(app, {
  serviceName: 'integrations-service',
  version: '1.0.0',
  description: 'Serviço de integrações: Stripe, Wise, Twilio, KuCoin Futures.',
  port: config.PORT ?? 3005,
  tags: INTEGRATIONS_SERVICE_TAGS,
  paths: integrationsServicePaths,
  schemas: integrationsServiceSchemas,
});
logger.info('Swagger UI configurado em /api/docs');

// Middleware para coletar métricas HTTP automaticamente
app.use(httpMetricsMiddleware);

// SEGURANÇA: Desabilitar X-Powered-By header (Express.js 2025 + OWASP API8)
app.disable('x-powered-by');

// SEGURANÇA: Trust proxy = 1 para confiar apenas no primeiro proxy (Traefik)
// Evita bypass de rate limiting (express-rate-limit 2025 best practice)
app.set('trust proxy', 1);

// STRIPE API VERSION: Versão estável atual (Novembro 2025)
// Referência: https://docs.stripe.com/changelog
const STRIPE_API_VERSION = '2024-12-18.acacia' as Stripe.LatestApiVersion;

// =============================================================================
// GMAIL SMTP - Emails Transacionais (30/12/2025)
// =============================================================================
// Usa Gmail SMTP com App Password para enviar:
// - Comprovantes de vendas e pagamentos
// - Notificações de pedidos e entregas
// - Promoções e campanhas de marketing
// - Alertas e notificações do sistema
//
// Ref: https://support.google.com/accounts/answer/185833
// Documentação PT-BR (Regra 10 CLAUDE.md)
// =============================================================================
const GMAIL_USER = readOptionalStringEnv('GMAIL_USER') ?? undefined;
const GMAIL_APP_PASSWORD = readOptionalStringEnv('GMAIL_APP_PASSWORD') ?? undefined;
const OPENAI_API_KEY = readOptionalStringEnv('OPENAI_API_KEY') ?? undefined;
const isProduction = config.NODE_ENV === 'production';
const TWILIO_ACCOUNT_SID = readOptionalStringEnv('TWILIO_ACCOUNT_SID') ?? undefined;
const TWILIO_AUTH_TOKEN = readOptionalStringEnv('TWILIO_AUTH_TOKEN') ?? undefined;
const TWILIO_WHATSAPP_NUMBER = readOptionalStringEnv('TWILIO_WHATSAPP_NUMBER') ?? undefined;
const TRADING_LEGACY_INSTITUTIONAL_FLOW_ENABLED = readOptionalStringEnv('TRADING_LEGACY_INSTITUTIONAL_FLOW') === 'true';
const STRIPE_WEBHOOK_SECRET = readOptionalStringEnv('STRIPE_WEBHOOK_SECRET') ?? undefined;

const emailTransporter = initializeGmailTransporter({
  gmailUser: GMAIL_USER,
  gmailAppPassword: GMAIL_APP_PASSWORD,
  isProduction,
  logger,
  onCriticalFailure: (error) => {
    logger.error({ error: error.message }, 'Falha crítica de bootstrap do Gmail SMTP');
    process.exit(1);
  },
});

const stripe = initializeStripeClient({
  stripeSecretKey: config.STRIPE_SECRET_KEY,
  stripeApiVersion: STRIPE_API_VERSION,
  logger,
});

const executeStripeCall = createExecuteStripeCall(observeIntegrationCall);

// Configuração de timeout para chamadas externas (Best Practices 2025)

// RESILIÊNCIA: Timeout para chamadas externas (Best Practices 2025)
const EXTERNAL_API_TIMEOUT_MS = readNumberEnv('EXTERNAL_API_TIMEOUT_MS', {
  defaultValue: 8000,
  integer: true,
  min: 1000,
});

// Inicializar sistema de feature flags com storage PostgreSQL (Regra 16 - Enterprise)
const featureFlagStorage = createDrizzleFeatureFlagStorage();
initFeatureFlags(featureFlagStorage);
logger.info('Sistema de feature flags inicializado');

const CORS_ORIGINS = resolveCorsOrigins({
  requiredInProduction: true,
  developmentFallback: [],
});

// SEGURANÇA: Helmet com CSP/HSTS enterprise (Express.js 2025 + OWASP 2023)
app.use(createSecurityMiddleware({
  contentSecurityPolicy: isProduction,
  isDevelopment: !isProduction,
}));

// OBSERVABILITY: Correlation ID middleware para rastreamento distribuído (Node.js 20 LTS 2025)
// Propaga correlation IDs entre microsserviços e injeta nos logs automaticamente
app.use(createCorrelationMiddleware({ serviceName: 'integrations-service' }));

// PERFORMANCE: Compression para reduzir tamanho de respostas (Express.js 2025)
app.use(compression());

// NOTA: Helmet já aplicado via createSecurityMiddleware() acima

app.use(cors({
  origin: CORS_ORIGINS.length > 0 ? CORS_ORIGINS : false,
  credentials: CORS_ORIGINS.length > 0,
}));

// REGRA 6: express.raw() DEVE ser registrado ANTES de express.json() global
// Em Express, app.use() middleware executa na ordem de registro, não na ordem da rota
// Se express.json() for registrado antes, ele converte body em objeto para TODAS as rotas
// incluindo webhooks, quebrando validação de assinatura que requer Buffer
// IMPORTANTE: Registrar body parsers específicos ANTES do parser global
app.use('/api/integrations/stripe/webhook', express.raw({ type: 'application/json' }));
app.use('/api/integrations/wise/webhook', express.raw({ type: 'application/json' }));
app.use('/api/integrations/twilio/webhook', express.urlencoded({ extended: false }));
// SEGURANÇA: express.json() APÓS os parsers específicos (OWASP API4)
app.use(express.json({ limit: '10mb' }));

// =============================================================================
// MIDDLEWARE: Autenticação via Cookie de Sessão PostgreSQL
// =============================================================================
// CORREÇÃO PR#107 (10/01/2026): Requisições HTTP precisam de validação de sessão
// PROBLEMA: alice-integrations não tinha middleware para processar cookie de sessão
//           do alice-auth, causando 401 em todas as requisições autenticadas.
// SOLUÇÃO: Middleware compartilhado de @alice/shared-utils
// REF: CLAUDE.md Regra 7 (Diagnóstico de causa raiz)
// =============================================================================
app.use(createSessionAuthMiddleware({
  pool: getPool(),
  publicPaths: [
    '/live', 
    '/ready', 
    '/metrics',
    // Webhooks usam validação própria de assinatura (não precisam de sessão)
    '/api/integrations/stripe/webhook',
    '/api/integrations/wise/webhook',
    '/api/integrations/twilio/webhook',
  ],
}));

// SEGURANÇA: Rate limiting multi-tenant (express-rate-limit 2025)
const rateLimitWindowMs = RATE_LIMIT_CONFIG.windowMs;
const apiRateLimitMax = RATE_LIMIT_CONFIG.limits.api;
const tradingRateLimitMax = RATE_LIMIT_CONFIG.limits.trading;

// Trading usa WS para dados real-time + REST para carga inicial e operações — limite dedicado
app.use('/api/integrations/trading', createRateLimiter({
  windowMs: rateLimitWindowMs,
  max: tradingRateLimitMax,
  serviceName: 'integrations-service',
}));

app.use(createRateLimiter({
  windowMs: rateLimitWindowMs,
  max: apiRateLimitMax,
  skipRoutes: [
    '/api/integrations/stripe/webhook',
    '/api/integrations/wise/webhook',
    '/api/integrations/twilio/webhook',
    '/api/integrations/trading',
  ],
  serviceName: 'integrations-service',
}));

const grafanaClient = createGrafanaClient({
  config,
  withTimeout,
  timeoutMs: EXTERNAL_API_TIMEOUT_MS,
});

const githubActionsClient = createGitHubActionsClient({
  config,
  withTimeout,
  timeoutMs: EXTERNAL_API_TIMEOUT_MS,
});
const { refreshIntegrationHealthMetrics } = createIntegrationHealthRefresher({
  stripe,
  wiseServiceGetProfiles: () => wiseService.getProfiles(),
  isWiseConfigured,
  getSandboxStatus,
  getProfileIdSafe,
  twilioAccountSid: TWILIO_ACCOUNT_SID,
  twilioAuthToken: TWILIO_AUTH_TOKEN,
  twilioWhatsappNumber: TWILIO_WHATSAPP_NUMBER,
  emailTransporter,
  openAiApiKey: OPENAI_API_KEY,
  externalApiTimeoutMs: EXTERNAL_API_TIMEOUT_MS,
  withTimeout,
  getKucoinConfigStatus: () => kucoinClient.getKucoinConfigStatus(),
  getKucoinCircuitBreakerStatus: () => kucoinClient.getKucoinCircuitBreakerStatus(),
  updateIntegrationMetrics,
});


registerIntegrationCoreRoutes(app, {
  logger,
  refreshIntegrationHealthMetrics,
  integrationsImmutableAuditIntegrityState,
  runIntegrationsImmutableAuditIntegrityCheck,
  getWiseCircuitBreakerStatus,
});


registerIntegrationRegistryRoutes(app, {
  logger,
});


registerHealthProbeRoutes(app, {
  logger,
  isPoolHealthy,
});

// ============================================================================
// OWASP API3 - Schemas Zod para validação de parâmetros de rota e query
// Previne NaN e injection via parâmetros não validados
// ============================================================================

// Validar secrets obrigatórios em produção (Regra 16 - Segurança Enterprise)
// STRIPE: Fail-fast se produção sem webhook secret
if (!STRIPE_WEBHOOK_SECRET && isProduction && stripe) {
  logger.error('CRITICAL: STRIPE_WEBHOOK_SECRET é OBRIGATÓRIO em produção com Stripe ativo. Abortando.');
  process.exit(1);
}

// WISE: Webhooks usam assinatura RSA com chave pública oficial (docs Wise)
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


registerStripeRoutes(app, {
  logger,
  stripe,
  executeStripeCall,
  stripeWebhookSecret: STRIPE_WEBHOOK_SECRET,
  checkWebhookIdempotency: checkWebhookIdempotencyWithLogger,
  markWebhookProcessed,
});

// ============================================================================
// GRAFANA API (Dashboards) - Read/Write via Integrations Service
// ============================================================================


registerGrafanaAndGithubRoutes(app, {
  logger,
  grafanaClient,
  githubActionsClient,
});

// =============================================================================
// GMAIL SMTP API - Emails Transacionais (30/12/2025)
// =============================================================================
// Substituiu Resend. Usa Gmail SMTP com App Password.
// Ref: https://support.google.com/accounts/answer/185833
// =============================================================================


registerEmailRoutes(app, {
  logger,
  emailTransporter,
  gmailUser: GMAIL_USER,
  observeIntegrationCall,
});

// ============================================================
// WISE API - Pagamentos Globais
// Documentação: https://docs.wise.com/api-docs/
// ============================================================

const getWiseAuthContext = (req: Request) => getWiseAuthContextFromRequest(req.user as AuthContext | undefined);

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
  getBalanceStatement: (params) => wiseService.getBalanceStatement(params),
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

// ============================================================
// TWILIO/WHATSAPP API - Mensagens e Webhooks
// Documentação: https://www.twilio.com/docs/messaging/webhooks
// Integração com Conversation Orchestrator para Handover/Takeover
// ============================================================

// REGRA 6: Fail-fast em TODOS os ambientes - variável DEVE estar definida
const CHAT_SERVICE_URL_FINAL = getServiceUrl('chat');

// URL do Training Service para coleta de dados de treinamento
// REGRA 6: Fail-fast em TODOS os ambientes - variável DEVE estar definida
// Alice MULTIMODAL: coleta dados de WhatsApp (texto, imagens, áudio) para aprendizado
const TRAINING_SERVICE_URL_FINAL = getServiceUrl('training');

// URL do RAG Service para indexação de mídia multimodal do WhatsApp
// REGRA 6: Fail-fast em TODOS os ambientes - variável DEVE estar definida
// Permite indexar imagens/áudios recebidos via WhatsApp no RAG
const RAG_SERVICE_URL_FINAL = getServiceUrl('rag');

const validateTwilioSignature = buildValidateTwilioSignature({
  logger,
  twilioAuthToken: TWILIO_AUTH_TOKEN,
  isProduction,
});

const sendWhatsAppMessage = buildSendWhatsAppMessage({
  logger,
  twilioAccountSid: TWILIO_ACCOUNT_SID,
  twilioAuthToken: TWILIO_AUTH_TOKEN,
  twilioWhatsappNumber: TWILIO_WHATSAPP_NUMBER,
  externalApiTimeoutMs: EXTERNAL_API_TIMEOUT_MS,
  observeIntegrationCall,
});
const processMessageWithLLM = buildProcessMessageWithLLM({
  chatServiceUrl: CHAT_SERVICE_URL_FINAL,
  logger,
  generateInternalAuthHeaders,
});

const processWhatsAppMediaForRAG = buildProcessWhatsAppMediaForRAG({
  ragServiceUrl: RAG_SERVICE_URL_FINAL,
  twilioAccountSid: TWILIO_ACCOUNT_SID,
  twilioAuthToken: TWILIO_AUTH_TOKEN,
  logger,
  generateInternalAuthHeaders,
});


registerTwilioWebhookRoutes(app, {
  logger,
  twilioAuthToken: TWILIO_AUTH_TOKEN,
  chatServiceUrl: CHAT_SERVICE_URL_FINAL,
  trainingServiceUrl: TRAINING_SERVICE_URL_FINAL,
  validateTwilioSignature,
  generateInternalAuthHeaders,
  processMessageWithLLM,
  sendWhatsAppMessage,
  processWhatsAppMediaForRAG,
});


registerTwilioOperationalRoutes(app, {
  logger,
  twilioAccountSid: TWILIO_ACCOUNT_SID,
  twilioAuthToken: TWILIO_AUTH_TOKEN,
  twilioWhatsappNumber: TWILIO_WHATSAPP_NUMBER,
  sendWhatsAppMessage,
});

// ============================================================================
// KuCoin Trading - Configurações e validações (definido ANTES do bootstrap)
// ============================================================================

// ============================================================================
// TRADING: KuCoin Futures BTC Perpetuals
// Sistema enterprise-grade para trading automatizado (modelo LLM é agnóstico).
// ============================================================================

// Inicializar métricas do circuit breaker KuCoin
kucoinClient.initKucoinMetrics(metrics);
kucoinSpotClient.initKucoinSpotMetrics(metrics);
kucoinMarginClient.initKucoinMarginMetrics(metrics);
initWiseMetrics(metrics);

// ============================================================================
// WS5: KuCoin WebSocket (REST + WS) - readiness operacional
// ============================================================================
// Objetivo:
// - Garantir conectividade WS (public + private quando credenciais existirem)
// - Expor estado da conexão para a UI/observabilidade
// - Sem depender de in-memory para dados de negócio (market data continua via REST)
//
// NOTA: conexão WS pode falhar por motivos transitórios (rede/upstream).
// A estratégia é:
// - Inicializar em background (não bloquear startup do serviço)
// - Reconnect automático é responsabilidade do cliente (kucoinUnifiedWebSocket.ts)
// - Expor status para o dashboard/UI e logs estruturados
// ============================================================================
if (kucoinClient.isKucoinConfigured()) {
  let wsOrderBookDepth: 5 | 50;
  try {
    wsOrderBookDepth = resolveKucoinWsOrderBookDepth();
    resolveKucoinRestOrderBookDepth();
  } catch (error) {
    logger.fatal(
      { error: error instanceof Error ? error.message : String(error) },
      'Configuração inválida do KuCoin (orderbook depth REST/WS)'
    );
    if (isProduction) {
      process.exit(1);
    }
    throw error;
  }

  Promise.allSettled([
    initializeKucoinWebSocketClients(),
    initializeSpotWebSocketClients(),
  ])
    .then(async (results) => {
      const [futuresResult, spotResult] = results;
      if (futuresResult.status === 'rejected') {
        logger.error({ error: futuresResult.reason }, 'Falha ao iniciar WS KuCoin Futures');
      }
      if (spotResult.status === 'rejected') {
        logger.error({ error: spotResult.reason }, 'Falha ao iniciar WS KuCoin Spot/Margin');
      }
      initializeBroadcast()
        .then(async (status) => {
          if (!status.publisher) {
            logger.warn('Broadcast de trading iniciado sem publisher (Redis indisponível)');
          }
          const publisher = getPublisher();
          const publicWs = getPublicWebSocketClient();
          const privateWs = isKucoinWebSocketConfigured() ? getPrivateWebSocketClient() : null;
          const spotPublicWs = getSpotPublicWebSocketClient();
          const spotPrivateWs = isSpotWebSocketConfigured() ? getSpotPrivateWebSocketClient() : null;
          const privateTenantId = await resolveKucoinTenantIdForPrivateWs();

          publicWs.on('ticker', (data) => {
            const normalized = normalizeTickerData(data);
            void publisher.publishTicker(data.symbol, normalized, 'futures').catch((error) => {
              logger.error({ error }, 'Falha ao publicar ticker de trading');
            });
          });

          publicWs.on('orderbook', (data, symbol) => {
            const normalized = normalizeOrderBookData(data);
            void publisher.publishOrderBook(data.symbol || symbol, normalized, 'futures').catch((error) => {
              logger.error({ error }, 'Falha ao publicar orderbook de trading');
            });
          });

          publicWs.on('kline', (data) => {
            const normalized = normalizeKlineData(data);
            void publisher.publishKlines(data.symbol, normalized, 'futures').catch((error) => {
              logger.error({ error }, 'Falha ao publicar kline de trading');
            });
          });

          publicWs.on('trade', (data) => {
            const normalized = normalizeTradeData(data);
            void publisher.publishTrades(data.symbol, normalized, 'futures').catch((error) => {
              logger.error({ error }, 'Falha ao publicar trades de trading');
            });
          });

          spotPublicWs.on('ticker', (data, topic) => {
            const subscriptions = getSpotMarketTypesForTopic(topic);
            if (subscriptions.length === 0) return;
            const normalized = normalizeSpotTickerData(data);
            subscriptions.forEach((subscription) => {
              void publisher.publishTicker(data.symbol, normalized, subscription.marketType, subscription.marginMode).catch((error) => {
                logger.error({ error }, 'Falha ao publicar ticker Spot/Margin');
              });
            });
          });

          spotPublicWs.on('orderbook', (data, topic) => {
            const subscriptions = getSpotMarketTypesForTopic(topic);
            if (subscriptions.length === 0) return;
            const normalized = normalizeSpotOrderBookData(data);
            const symbol = data.symbol ?? resolveSpotSymbolFromTopic(topic);
            if (!symbol) return;
            subscriptions.forEach((subscription) => {
              void publisher.publishOrderBook(symbol, normalized, subscription.marketType, subscription.marginMode).catch((error) => {
                logger.error({ error }, 'Falha ao publicar orderbook Spot/Margin');
              });
            });
          });

          spotPublicWs.on('kline', (data, topic) => {
            const subscriptions = getSpotMarketTypesForTopic(topic);
            if (subscriptions.length === 0) return;
            const normalized = normalizeSpotKlineData(data);
            const symbol = data.symbol ?? resolveSpotSymbolFromTopic(topic);
            if (!symbol) return;
            subscriptions.forEach((subscription) => {
              void publisher.publishKlines(symbol, normalized, subscription.marketType, subscription.marginMode).catch((error) => {
                logger.error({ error }, 'Falha ao publicar kline Spot/Margin');
              });
            });
          });

          spotPublicWs.on('trade', (data, topic) => {
            const subscriptions = getSpotMarketTypesForTopic(topic);
            if (subscriptions.length === 0) return;
            const normalized = normalizeSpotTradeData(data);
            const symbol = data.symbol ?? resolveSpotSymbolFromTopic(topic);
            if (!symbol) return;
            subscriptions.forEach((subscription) => {
              void publisher.publishTrades(symbol, normalized, subscription.marketType, subscription.marginMode).catch((error) => {
                logger.error({ error }, 'Falha ao publicar trades Spot/Margin');
              });
            });
          });

          if (privateWs) {
            if (!privateTenantId) {
              logger.warn('Tenant KuCoin não resolvido - eventos privados não serão publicados');
            } else {
              privateWs.on('order', (data) => {
                void publisher.publishOrderUpdate(privateTenantId, data).catch((error) => {
                  logger.error({ error }, 'Falha ao publicar ordens de trading');
                });
              });
              privateWs.on('position', (data) => {
                void publisher.publishPositionUpdate(privateTenantId, data).catch((error) => {
                  logger.error({ error }, 'Falha ao publicar posições de trading');
                });
              });
              privateWs.on('balance', (data) => {
                void publisher.publishBalanceUpdate(privateTenantId, data).catch((error) => {
                  logger.error({ error }, 'Falha ao publicar balance de trading');
                });
              });
            }
          }

          if (spotPrivateWs) {
            spotPrivateWs.on('marginPosition', (data, topic) => {
              const symbol = data.symbol ?? resolveSpotSymbolFromTopic(topic);
              logger.info({ symbol, topic }, 'Update de posição margin recebido (WS)');
            });
          }
        })
        .catch((error) => {
          logger.error({ error }, 'Falha ao inicializar broadcast de trading');
          if (isProduction) {
            process.exit(1);
          }
        });

      // Subscrições mínimas (reduz custo/cardi nalidade): default symbol
      const symbol = await kucoinClient.getDefaultSymbol();
      const publicWs = getPublicWebSocketClient();
      publicWs.subscribeTicker(symbol);
      publicWs.subscribeOrderBook(symbol, wsOrderBookDepth);

      if (isKucoinWebSocketConfigured()) {
        // Canais privados úteis para auditoria/operacional (ordens/posição/wallet)
        const privateWs = getPrivateWebSocketClient();
        privateWs.subscribeOrders();
        privateWs.subscribePosition(symbol);
        privateWs.subscribeBalance();
      }

      // WS5: wiring de métricas operacionais (state/connected/reconnect/errors)
      wireKucoinWebSocketMetrics({
        publicWs,
        privateWs: isKucoinWebSocketConfigured() ? getPrivateWebSocketClient() : null,
        privateEnabled: isKucoinWebSocketConfigured(),
      });

      logger.info({ symbol, privateEnabled: isKucoinWebSocketConfigured() }, 'KuCoin WebSocket inicializado (public + private)');
    })
    .catch((error: unknown) => {
      // Não derrubar o serviço inteiro por instabilidade transitória do upstream.
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Falha ao inicializar KuCoin WebSocket (trading seguirá via REST; WS pode ficar degraded)'
      );
    });
}

const parseLlmSignalResponse = createLlmSignalResponseParser({
  logger,
  computeSemHash,
  extractValuesFromLLMResponse,
});

const {
  buildLlmSignalFromPartial,
} = createTradingLlmSignalNormalizerService({
  logger,
  extractValuesFromLLMResponse,
});

const {
  applyDeterministicSignalOverride,
} = createTradingLlmSignalPostProcessingService();

const {
  persistTradingLlmSignal,
} = createTradingLlmSignalPersistenceService({
  createSignal: (authContext, payload) => kucoinService.createSignal(authContext, payload),
});

const {
  finalizeTradingSignalValidation,
} = createTradingLlmValidationFinalizeService();

const {
  buildTradingSignalAnalysisContext,
} = createTradingSignalAnalysisOrchestrationService({
  calculateAndPersistTechnicalAnalysis,
  buildMajorityConsensus,
  aggregateTechniqueScores,
  buildEnsembleResult,
  splitSymbolPair,
  resolveArbitrageFeePctForExchanges,
  resolveNetworkFeesForTenant,
  calculateTriangularArbitrage,
});

const {
  buildTradingSignalOperationalContext,
} = createTradingSignalContextService({
  TradingConfigErrorCtor: TradingConfigError,
  queryTradingRagContext: (contextParams) => queryTradingRAGContext(contextParams),
  getOrderBookSnapshot: (auth, symbol, marketType, marginMode) =>
    getOrderBookSnapshot(auth, symbol, marketType, marginMode),
  fetchNewsSummary: (auth, symbol, marketType, newsConfig) =>
    fetchNewsSummary(auth, symbol, marketType, newsConfig),
  fetchTradingDatasetSummary: (tenantId, namespaceId) => fetchTradingDatasetSummary(tenantId, namespaceId),
  getRiskConfig: (authContext) => kucoinService.getRiskConfig(authContext),
  buildTradePlanFromAnalysis,
});

const {
  generateTradingSignalFromLlm: generateTradingSignalFromLlmCore,
} = createTradingLlmSignalGenerationService({
  logger,
  TradingConfigErrorCtor: TradingConfigError,
  isLegacyInstitutionalFlowEnabled: () => TRADING_MODE !== 'lab' && TRADING_LEGACY_INSTITUTIONAL_FLOW_ENABLED,
  maxValidationDeviation: LLM_VALIDATION_MAX_DEVIATION,
  getAgenticSettingsOrDefault,
  generateLegacyInstitutionalSignal,
  resolveTradingAgentContext,
  getOrCreateTradingProfile,
  normalizeTradingProfile,
  assertArbitrageConfigForTechniques,
  buildTradingSignalAnalysisContext,
  buildTradingSignalOperationalContext,
  buildTradingSignalSystemPrompt,
  buildTradingSignalPromptBudget,
  requestTradingSignalCompletion,
  parseLlmSignalResponse,
  buildLlmSignalFromPartial,
  applyDeterministicSignalOverride,
  formatDurationLabel,
  persistTradingLlmSignal,
  finalizeTradingSignalValidation,
});

registerTradingWebsocketRoutes(app, {
  logger,
  getKucoinConfigStatus: () => kucoinClient.getKucoinConfigStatus(),
  getKucoinCircuitBreakerStatus: () => kucoinClient.getKucoinCircuitBreakerStatus(),
  isKucoinConfigured: () => kucoinClient.isKucoinConfigured(),
  getTradingServiceStatus: (authContext) => kucoinService.getTradingServiceStatus(authContext),
  getAllowedSymbols: () => kucoinClient.getAllowedSymbols(),
  resolveTradingSymbolForStatus: (authContext) => {
    if (authContext) {
      return kucoinService.resolveTradingSymbol(authContext);
    }
    return kucoinClient.getDefaultSymbol();
  },
  getPublicWebSocketClient,
  isKucoinWebSocketConfigured,
  getPrivateWebSocketClient,
  getSpotPublicWebSocketClient,
  isSpotWebSocketConfigured,
  getSpotPrivateWebSocketClient,
  resolveTradingIntervals,
  kucoinWsSubscriptionsTotal,
  resolveTradingSymbolOrRespond,
  resolveKucoinWsOrderBookDepth,
  isValidKucoinWsInterval,
  kucoinWsOrderBookDepths: KUCOIN_WS_ORDERBOOK_DEPTHS,
  registerSpotWsMarketType,
  unregisterSpotWsMarketType,
  buildSpotMarketTopic,
  respondKucoinNotConfigured,
  sendKucoinErrorResponse,
});

registerTradingSymbolRoutes(app, {
  logger,
  isSpotConfigured: () => kucoinSpotClient.isSpotConfigured(),
  isMarginConfigured: () => kucoinMarginClient.isMarginConfigured(),
  isKucoinConfigured: () => kucoinClient.isKucoinConfigured(),
  getTradingSymbols: (authContext, marketType, marginMode) => kucoinService.getTradingSymbols(authContext, marketType, marginMode),
  resolveTradingSymbol: (authContext, symbol, marketType, marginMode) => kucoinService.resolveTradingSymbol(authContext, symbol, marketType, marginMode),
  getTopSymbolsByMarket: (authContext, marketType, marginMode, limit) => kucoinService.getTopSymbolsByMarket(authContext, marketType, marginMode, limit),
  fetchTradingSymbolPreferences,
  normalizeSymbolList,
  upsertTradingSymbolPreferences: async (params) => {
    const db = getDatabase();
    const [existing] = await db
      .select()
      .from(schema.tradingSymbolPreferences)
      .where(and(
        eq(schema.tradingSymbolPreferences.tenantId, params.tenantId),
        eq(schema.tradingSymbolPreferences.userId, params.userId),
        eq(schema.tradingSymbolPreferences.marketType, params.marketType),
        eq(schema.tradingSymbolPreferences.marginMode, params.marginMode)
      ))
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(schema.tradingSymbolPreferences)
        .set({
          favorites: params.favorites ?? existing.favorites,
          featured: params.featured ?? existing.featured,
          atualizadoEm: new Date(),
        })
        .where(eq(schema.tradingSymbolPreferences.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await db
      .insert(schema.tradingSymbolPreferences)
      .values({
        tenantId: params.tenantId,
        userId: params.userId,
        marketType: params.marketType,
        marginMode: params.marginMode,
        favorites: params.favorites ?? [],
        featured: params.featured ?? [],
      })
      .returning();

    return created;
  },
  respondKucoinNotConfigured,
  sendKucoinErrorResponse,
});

registerTradingMarketRiskRoutes(app, {
  logger,
  isSpotConfigured: () => kucoinSpotClient.isSpotConfigured(),
  isMarginConfigured: () => kucoinMarginClient.isMarginConfigured(),
  isKucoinConfigured: () => kucoinClient.isKucoinConfigured(),
  respondKucoinNotConfigured,
  sendKucoinErrorResponse,
  resolveMarketTypeParam,
  resolveSymbolFromQuery,
  resolveTradingSymbolOrRespond,
  getMarketData: (authContext, symbol, marketType, marginMode) => kucoinService.getMarketData(authContext, symbol, marketType, marginMode),
  getAccountOverview: (marketType, marginMode) => kucoinService.getAccountOverview(marketType, marginMode),
  getKucoinPositions: (marketType, marginMode) => kucoinService.getKucoinPositions(marketType, marginMode),
  closePositions: (authContext, symbol) => kucoinService.closePositions(authContext, symbol),
  createStopOrder: (authContext, payload) => kucoinService.createStopOrder(authContext, payload),
  getRiskConfig: (authContext) => kucoinService.getRiskConfig(authContext),
  upsertRiskConfig: (authContext, payload) => kucoinService.upsertRiskConfig(authContext, payload),
});

registerTradingAutomationRoutes(app, {
  logger,
  trainingServiceUrl: TRAINING_SERVICE_URL_FINAL,
  tradingTechniqueKeys: TRADING_TECHNIQUE_KEYS,
  tradingAutoRunErrorsTotal,
  sendKucoinErrorResponse,
  resolveConnectedTradingVenues,
  loadTradingAutoAssetsForVenue,
});

registerTradingSignalHistoryRoutes(app, {
  logger,
  sendKucoinErrorResponse,
  isAdminUser: (authContext) => isAdminUser(authContext),
  resolveMarketTypeParam,
  resolveTradingSymbolOrRespond,
  getActiveSignals: (authContext, limit, marketType) => kucoinService.getActiveSignals(authContext, limit, marketType),
});

registerTradingSignalActionRoutes(app, {
  logger,
  sendKucoinErrorResponse,
  resolveTradingSymbolOrRespond,
  createSignal: (authContext, params) => kucoinService.createSignal(authContext, params),
  deactivateSignal: (authContext, signalId) => kucoinService.deactivateSignal(authContext, signalId),
  createPendingOrderFromSignal: (authContext, signalId, reason, overrides) =>
    kucoinService.createPendingOrderFromSignal(authContext, signalId, reason, overrides),
  rejectSignal: (authContext, signalId, reason) => kucoinService.rejectSignal(authContext, signalId, reason),
  recordTradingAuditEvent: (params) => kucoinService.recordTradingAuditEvent(params),
  createTradingDatasetFromSignalSource: (params) => createTradingDatasetFromSignalSource(params),
});

registerTradingOrderGovernanceRoutes(app, {
  logger,
  sendKucoinErrorResponse,
  respondKucoinNotConfigured,
  isKucoinConfigured: () => kucoinClient.isKucoinConfigured(),
  isSpotConfigured: () => kucoinSpotClient.isSpotConfigured(),
  isMarginConfigured: () => kucoinMarginClient.isMarginConfigured(),
  resolveTradingSymbolOrRespond,
  resolveTradingSymbol: (authContext, symbol, marketType, marginMode) =>
    kucoinService.resolveTradingSymbol(authContext, symbol, marketType, marginMode),
  getOrders: (authContext, params) => kucoinService.getOrders(authContext, params),
  updatePendingOrder: (authContext, orderId, payload) => kucoinService.updatePendingOrder(authContext, orderId, payload),
  approvePendingOrder: (authContext, orderId) => kucoinService.approvePendingOrder(authContext, orderId),
  rejectPendingOrder: (authContext, orderId, reason) => kucoinService.rejectPendingOrder(authContext, orderId, reason),
  createOrderFromSignal: (authContext, payload) => kucoinService.createOrderFromSignal(authContext, payload),
  createManualOrder: (authContext, payload) => kucoinService.createManualOrder(authContext, payload),
  cancelOrder: (authContext, orderId) => kucoinService.cancelOrder(authContext, orderId),
  syncOrdersStatus: (authContext) => kucoinService.syncOrdersStatus(authContext),
  createTradingDatasetFromOrder: (params) => createTradingDatasetFromOrder(params),
  createStopOrder: (authContext, payload) => kucoinService.createStopOrder(authContext, payload),
  isAdminUser: (authContext) => isAdminUser(authContext),
});

registerTradingSignalGenerationRoutes(app, {
  logger,
  tradingIntervalZod: TRADING_INTERVAL_ZOD,
  tradingIndicatorZod: TRADING_INDICATOR_ZOD,
  tradingTechniqueZod: TRADING_TECHNIQUE_ZOD,
  sendKucoinErrorResponse,
  respondKucoinNotConfigured,
  isKucoinConfigured: () => kucoinClient.isKucoinConfigured(),
  isSpotConfigured: () => kucoinSpotClient.isSpotConfigured(),
  isMarginConfigured: () => kucoinMarginClient.isMarginConfigured(),
  selectSymbolFromUniverseCandidates,
  resolveTradingSymbolOrRespond,
  generateTradingSignalFromLlm,
  isTradingConfigError: (error) => error instanceof TradingConfigError,
  mapTradingErrorToUserMessage,
});

registerTradingDatasetRoutes(app, {
  logger,
  tradingSourceTypes: TRADING_SOURCE_TYPES,
  createTradingDatasetFromSignalSource: (params) => createTradingDatasetFromSignalSource(params),
});

registerTradingSignalPromotionRoutes(app, {
  logger,
  sendKucoinErrorResponse,
  getSignalPromotionPath: (params) => tradingSignalPromotionService.getSignalPromotionPath(params),
  findSignalById: (params) => tradingSignalPromotionService.findSignalById(params),
  promoteSignalRealEligibility: (params) => tradingSignalPromotionService.promoteSignalRealEligibility(params),
});

registerTradingSchedulerNewsRoutes(app, {
  logger,
  defaultTradingTechniques: DEFAULT_TRADING_TECHNIQUES,
  defaultTradingEnsembleConfig: DEFAULT_TRADING_ENSEMBLE_CONFIG,
  resolveMarketTypeParam,
  normalizeTradingNewsConfig,
  normalizeSignalSymbols,
  assertArbitrageConfigForTechniques,
  getOrCreateTradingProfile,
  normalizeTradingProfile,
  resolveTradingSymbolStrict: (authContext, symbol, marketType, marginMode) =>
    kucoinService.resolveTradingSymbolStrict(authContext, symbol, marketType, marginMode),
  respondKucoinNotConfigured,
  isKucoinConfigured: () => kucoinClient.isKucoinConfigured(),
  isSpotConfigured: () => kucoinSpotClient.isSpotConfigured(),
  isMarginConfigured: () => kucoinMarginClient.isMarginConfigured(),
  isTradingConfigError: (error) => error instanceof TradingConfigError,
});

registerTradingFuturesRoutes(app, {
  logger,
  respondKucoinNotConfigured,
  sendKucoinErrorResponse,
});

registerTradingSpotRoutes(app, {
  logger,
  respondKucoinNotConfigured,
  sendKucoinErrorResponse,
});

registerTradingMarginRoutes(app, {
  logger,
  respondKucoinNotConfigured,
  sendKucoinErrorResponse,
});

registerTradingControlRoutes(app, { logger });

registerTradingStopOrderRoutes(app, {
  logger,
  isKucoinConfigured: () => kucoinClient.isKucoinConfigured(),
  isSpotConfigured: () => kucoinSpotClient.isSpotConfigured(),
  isMarginConfigured: () => kucoinMarginClient.isMarginConfigured(),
  respondKucoinNotConfigured,
  sendKucoinErrorResponse,
  resolveTradingSymbolOrRespond,
  getOpenStopOrders: (authContext, symbol, marketType, marginMode) =>
    kucoinService.getOpenStopOrders(authContext, symbol, marketType, marginMode),
  cancelStopOrder: (authContext, orderId, marketType, marginMode) =>
    kucoinService.cancelStopOrder(authContext, orderId, marketType, marginMode),
  resolveTradingSymbol: (authContext, symbol, marketType, marginMode) =>
    kucoinService.resolveTradingSymbol(authContext, symbol, marketType, marginMode),
});

const {
  handleTradingKlinesRequest,
  handleTradingOrderBookRequest,
} = createTradingMarketDataHandlers({
  logger,
  resolveMarketTypeParam,
  respondKucoinNotConfigured,
  sendKucoinErrorResponse,
  resolveTradingSymbolOrRespond,
});

registerTradingMarketDataRoutes(app, {
  logger,
  handleTradingKlinesRequest,
  handleTradingOrderBookRequest,
  resolveSymbolFromQuery,
  isKucoinConfigured: () => kucoinClient.isKucoinConfigured(),
  respondKucoinNotConfigured,
  sendKucoinErrorResponse,
  resolveTradingSymbolOrRespond,
  getCurrentFundingRate: (symbol) => kucoinClient.getCurrentFundingRate(symbol),
  getMarkPrice: (symbol) => kucoinClient.getMarkPrice(symbol),
  getTradeHistory: (symbol) => kucoinClient.getTradeHistory(symbol),
  getSpotTrades: (symbol) => kucoinSpotClient.getSpotTrades(symbol),
});

registerTradingValidationRoutes(app, { logger });

registerTradingAnalysisHistoryRoutes(app, {
  logger,
  isAdminUser: (authContext) => isAdminUser(authContext),
  resolveMarketTypeParam,
  resolveTradingSymbolOrRespond,
  resolveTradingSymbol: (authContext, symbol, marketType, marginMode) =>
    kucoinService.resolveTradingSymbol(authContext, symbol, marketType, marginMode),
});

registerTradingAnalysisRoutes(app, {
  logger,
  tradingIntervalZod: TRADING_INTERVAL_ZOD,
  tradingIndicatorZod: TRADING_INDICATOR_ZOD,
  tradingTechniqueZod: TRADING_TECHNIQUE_ZOD,
  getOrCreateTradingProfile,
  normalizeTradingProfile,
  normalizeTradingTechniques,
  normalizeTradingEnsembleConfig,
  normalizeTradingArbitrageConfig,
  assertArbitrageConfigForTechniques,
  resolveDefaultSymbolForMarketType,
  resolveArbitrageFeePctForExchanges,
  deriveIntermediateAssetsFromSymbols,
  resolveNetworkFeesForTenant,
  listSpotSymbols: () => kucoinSpotClient.getSpotSymbols(),
  parseListParam,
  parseTimeframesParam,
  parseIndicatorsParam,
  parseTechniquesParam,
  resolveMarketTypeParam,
  isKucoinConfigured: () => kucoinClient.isKucoinConfigured(),
  isSpotConfigured: () => kucoinSpotClient.isSpotConfigured(),
  isMarginConfigured: () => kucoinMarginClient.isMarginConfigured(),
  respondKucoinNotConfigured,
  sendKucoinErrorResponse,
  calculateAndPersistTechnicalAnalysis,
  buildMajorityConsensus,
  aggregateTechniqueScores,
  buildEnsembleResult,
  splitSymbolPair,
  calculateTriangularArbitrage,
  getOrderBookSnapshot,
  fetchNewsSummary,
  resolveTradingNamespaceId,
  fetchTradingDatasetSummary,
  getRiskConfig: (authContext) => kucoinService.getRiskConfig(authContext),
  buildTradePlanFromAnalysis,
  formatAnalysisForLlm: (analysis) => technicalIndicators.formatAnalysisForLLM(analysis),
  isTradingConfigError: (error) => error instanceof TradingConfigError,
  tradingConfigErrorMessage: 'Erro de configuração de trading',
  arbitrageExchangeLabels: ARBITRAGE_EXCHANGE_LABELS,
});

// GET /api/integrations/trading/signals - Lista sinais de trading ativos
/**
 * Gera sinal IA usando Agente Trading + LoRA + RAG do namespace Trading.
 * Fluxo: resolveTradingAgentContext → Agente Trading (namespace slug=trading ou agentId);
 * queryTradingRAGContext → documentos do namespace; resolveModelWithAdapter → LoRA por tenant/namespace/agent.
 */
async function generateTradingSignalFromLlm(params: {
  tenantId: string;
  userId: string;
  symbol: string;
  interval: string;
  marketType?: TradingMarketType;
  marginMode?: TradingMarginMode;
  source: TradingSignalGenerationSource;
  agentId?: string;
  schedulerId?: string;
  timeframes?: TradingIntervalValue[];
  indicators?: TradingIndicatorKey[];
  dataSources?: TradingProfileDataSources;
  modelConfig?: TradingProfileModelConfig;
  consensus?: TradingProfileConsensus;
  techniques?: TradingTechnique[];
  ensembleConfig?: TradingEnsembleConfig;
  arbitrageConfig?: TradingArbitrageConfig;
  reasoningMode?: ReasoningMode;
}): Promise<{
  signal: schema.TradingSignal;
  validationId: string;
  validationStatus: 'pending' | 'validated' | 'failed';
}> {
  return generateTradingSignalFromLlmCore(params);
}

// ============================================================================
// ROTAS KUCOIN DIRETAS - Futures, Spot, Margin (FASE 5 - KuCoin Features Completas)
// Expõe endpoints dos clients KuCoin diretamente via Express routes
// para que o frontend possa acessar todas as funcionalidades disponíveis.
// Ref: Plano KuCoin Features Completas, CLAUDE.md Regra 6 (Enterprise-grade)
// ============================================================================

// --- ACCOUNT MANAGEMENT: Funding, Sub-Accounts, Deposits, Withdrawals, Transfers, Fees ---
registerTradingAccountManagementRoutes(app, {
  logger,
  accountClient: createKucoinAccountClientAdapter(),
  respondKucoinNotConfigured,
  sendKucoinErrorResponse,
});

// ============================================================================
// DEMO TRADING - Rotas REST
// ============================================================================

registerDemoTradingRoutes(app, {
  logger,
  findSignalById: (params) => tradingSignalPromotionService.findSignalById(params),
  assertSignalDemoEligibility: (params) => tradingSignalPromotionService.assertSignalDemoEligibility(params),
  registerSignalDemoHandoff: (params) => tradingSignalPromotionService.registerSignalDemoHandoff(params),
});

// ============================================================================
// POST-MORTEM - Rotas REST
// ============================================================================

registerPostMortemRoutes(app, { logger });

// ============================================================================
// MIDDLEWARE: Not Found + Error Handler (Express.js 2025)
// ============================================================================

// Not Found handler (antes do error handler)
app.use(createNotFoundHandler({ serviceName: 'integrations-service' }));

// Error handler global (OWASP 2023 + Express.js 2025)
app.use(createErrorHandler({ 
  serviceName: 'integrations-service', 
  logger,
  includeStackInDev: true,
}));

const PORT = config.PORT || 3005;
const INTEGRATION_HEALTH_REFRESH_MS = 120000;
const {
  bootstrapIntegrationsForTenants,
  initializeCaches,
} = createIntegrationStartupOrchestrator(logger);

// Inicializar caches e depois iniciar servidor
initializeCaches().then(() => {
  bootstrapIntegrationsForTenants().catch((error) => {
    logger.error({ error }, 'Falha no bootstrap de integrações');
  });

  const server = startIntegrationsServer({
    app,
    port: PORT,
    logger,
  });

  // Validação de credenciais KuCoin no startup (Regra 6 - fail-fast com log claro)
  // KuCoin usa API unificada: mesma chave para Futures + Spot + Margin
  // Ref: https://www.kucoin.com/docs-new/authentication
  const kucoinConfigStatus = kucoinClient.getKucoinConfigStatus();
  if (!kucoinConfigStatus.isConfigured) {
    logger.warn(
      { missingKeys: kucoinConfigStatus.missingKeys },
      'Credenciais KuCoin NÃO configuradas - endpoints públicos (symbols, klines, orderbook) funcionam, mas endpoints autenticados (ordens, posições, taxas, conta) falharão para TODOS os 3 mercados (Futures, Spot, Margin). Configure os GitHub Secrets: KUCOIN_PRO_API_KEY, KUCOIN_PRO_API_SECRET, KUCOIN_PRO_API_PASSPHRASE'
    );
  } else {
    logger.info('Credenciais KuCoin configuradas - Futures, Spot e Margin disponíveis');
  }

  startTradingMetricsScheduler();
  startIntegrationsImmutableAuditIntegrityScheduler();
  startTradingSignalScheduler();
  startTradingAnalysisScheduler();

  // Demo Trading + Post-Mortem workers
  startDemoScheduler(5_000);
  startPostMortemWorker();
  refreshIntegrationHealthMetrics().catch((error) => {
    logger.warn({ error }, 'Falha ao atualizar métricas de integrações no startup');
  });
  const integrationHealthInterval = setInterval(() => {
    refreshIntegrationHealthMetrics().catch((error) => {
      logger.warn({ error }, 'Falha ao atualizar métricas de integrações');
    });
  }, INTEGRATION_HEALTH_REFRESH_MS);

  registerIntegrationsShutdownCallbacks({
    logger,
    server,
    closeDatabasePool,
    stopTradingMetricsScheduler,
    stopIntegrationsImmutableAuditIntegrityScheduler,
    stopTradingSignalScheduler,
    stopTradingAnalysisScheduler,
    stopDemoScheduler,
    stopPostMortemWorker,
    closeKucoinWebSocketClients,
    closeSpotWebSocketClients,
    closeBroadcast,
    clearIntegrationHealthInterval: () => {
      clearInterval(integrationHealthInterval);
    },
  });
}).catch((error: unknown) => {
  logger.error({ error }, 'Erro fatal ao inicializar serviço');
  process.exit(1);
});
