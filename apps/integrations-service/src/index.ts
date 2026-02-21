import express from 'express';
import type { Request, Response } from 'express';
import Stripe from 'stripe';
import cors from 'cors';
// helmet aplicado via createSecurityMiddleware de @alice/shared-utils
import compression from 'compression';
// rateLimit via createRateLimiter de @alice/shared-utils
// CircuitBreaker via createCircuitBreaker de @alice/shared-utils
// CORREÇÃO PR#107 (10/01/2026): Usar prefixo 'node:' para módulos Node.js built-in
// REF: https://nodejs.org/api/esm.html#node-imports
// REF: Best Practices Node.js ESM 2025 - evita conflitos com pacotes npm de mesmo nome
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { createLogger } from '@alice/logger';
import { 
  createCorrelationMiddleware, 
  createSecurityMiddleware,
  createRateLimiter,
  createErrorHandler,
  createNotFoundHandler,
  requirePermission, 
  extractAuthContext,
  generateInternalAuthHeaders,
  initFeatureFlags,
  createAlicePrometheus,
  initRbacPrometheusMetrics,
  instrumentCircuitBreaker,
  createCircuitBreaker,
  CIRCUIT_BREAKER_PRESETS,
  registerShutdownCallback,
  ShutdownPriority,
  setupSwaggerUI,
  INTEGRATIONS_SERVICE_TAGS,
  setPermissionResolver,
  PERMISSION_MAP,
  requestGpu,
  GpuServiceType,
  GpuRequestPriority,
  computeSemHash,
  cosineSimilarity,
  resolveAgentLlmModel,
  RATE_LIMIT_CONFIG,
  // CORREÇÃO PR#107 (10/01/2026): Middleware de sessão HTTP para autenticação
  createSessionAuthMiddleware,
  initializeSessionAuthCache,
  initializeRedisCache,
  getRedisClient,
  Gauge as PromGauge,
  Counter as PromCounter,
  Histogram as PromHistogram,
  Role,
} from '@alice/shared-utils';
import type { AuthContext } from '@alice/shared-utils';
import { integrationsServicePaths, integrationsServiceSchemas } from './openapi-specs.js';
import { loadConfig, integrationsServiceConfigSchema } from '@alice/config';
import { getDatabase, schema, closeDatabasePool, isPoolHealthy, createDrizzleFeatureFlagStorage, getPool, withTenantContext } from '@alice/database';
import { eq, desc, asc, sql, and, inArray, not, isNull, lte, lt, gte } from '@alice/database';
import {
  tradingIntervalEnum,
  TradingOperationTypeSchema,
  TradingProfileNewsConfigSchema,
  TradingEnsembleConfigSchema,
  TradingArbitrageConfigSchema,
  TradingArbitrageExchangeSchema,
} from '@alice/shared';
import type {
  TradingSignalMetadata,
  TradingIndicatorKey,
  TradingProfileConsensus,
  TradingProfileDataSources,
  TradingProfileModelConfig,
  TradingProfileNewsConfig,
  TradingCandleData,
  TradingOperationType,
  TradingRiskConfig,
  TradingOrderMetadata,
  TradingTechnique,
  TradingEnsembleConfig,
  TradingArbitrageConfig,
  TradingArbitrageExchange,
  TradingTechniqueScore,
  TradingOverallSignal,
  TradingEnsembleResult,
  IntegrationConfiguracao,
} from '@alice/shared';
import { z } from 'zod';
import { wiseService } from './wiseService.js';
import { isWiseConfigured, getSandboxStatus, getProfileIdSafe, getWiseCircuitBreakerStatus, validateWiseWebhook, initWiseMetrics } from './wiseClient.js';
import { initWiseSyncService } from './wiseSyncService.js';
import * as kucoinClient from './kucoinClient.js';
import * as kucoinSpotClient from './kucoinSpotClient.js';
import * as kucoinMarginClient from './kucoinMarginClient.js';
import * as kucoinAccountClient from './kucoinAccountClient.js';
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
import { extractValuesFromLLMResponse, validateAndPersist } from './llm-validation.js';
import type { ExtractedLLMValues } from './llm-validation.js';
import { jsonrepair } from 'jsonrepair';
import { callGatewayComplete, isGatewayConfigured, type GatewayCompleteResult } from './llm-gateway-client.js';
import { listTenantPortfolios } from './trading-v2/core/portfolio-api.js';
import { buildDecisionPacket } from './trading-v2/core/decision-packet.js';
import { buildCorrelationMatrix } from './trading-v2/engines/correlation-engine.js';
import { buildAllocations } from './trading-v2/engines/allocation-engine.js';
import { estimateCosts } from './trading-v2/engines/cost-model.js';
import { buildExecutionPlan } from './trading-v2/engines/execution-engine.js';
import { buildCompactPrompt } from './trading-v2/llm/compact-prompt.js';
import { enforceLlmGuardrails } from './trading-v2/llm/llm-guardrails.js';
import { saveDecisionSnapshot } from './trading-v2/storage/snapshot-store.js';

const logger = createLogger('integrations-service');
const config = loadConfig(integrationsServiceConfigSchema);

function parseEnvFloat(envValue: string | undefined, defaultValue: number, varName: string): number {
  const raw = (envValue ?? String(defaultValue)).trim().replace(',', '.');
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    const errorMsg = `${varName} inválido: "${raw}". Deve ser número entre 0 e 1.`;
    if (process.env.NODE_ENV === 'production') {
      logger.error({ varName, rawValue: raw, parsed }, errorMsg);
      throw new Error(errorMsg);
    }
    logger.warn({ varName, rawValue: raw, parsed, defaultValue }, `${errorMsg} Usando valor padrão.`);
    return defaultValue;
  }
  return parsed;
}

const TRADING_DATASET_MIN_QUALITY = parseEnvFloat(
  process.env.TRADING_DATASET_MIN_QUALITY,
  0.35,
  'TRADING_DATASET_MIN_QUALITY'
);
const RETURNS_FALLBACK_FACTORS = [1, 0.5, 0.25, 0.1] as const;
const TRADING_MODE = (process.env.TRADING_MODE ?? 'portfolio_auto') as 'portfolio_auto' | 'signal_auto' | 'lab';
const TRADING_LLM_PROMPT_MODE = (process.env.TRADING_LLM_PROMPT_MODE ?? 'compact') as 'compact' | 'verbose';

// ============================================================================
// GRAFANA API (Observability) - Integração enterprise
// ============================================================================

const grafanaBaseUrl = config.GRAFANA_URL ? config.GRAFANA_URL.replace(/\/+$/, '') : '';

function ensureGrafanaConfigured(): void {
  if (!grafanaBaseUrl) {
    throw new Error('Grafana não configurado (GRAFANA_URL ausente).');
  }
  if (!config.GRAFANA_API_KEY && !(config.GRAFANA_ADMIN_USER && config.GRAFANA_ADMIN_PASSWORD)) {
    throw new Error('Credenciais Grafana ausentes (GRAFANA_API_KEY ou GRAFANA_ADMIN_USER/PASSWORD).');
  }
}

function buildGrafanaHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.GRAFANA_API_KEY) {
    headers.Authorization = `Bearer ${config.GRAFANA_API_KEY}`;
    return headers;
  }
  const raw = `${config.GRAFANA_ADMIN_USER}:${config.GRAFANA_ADMIN_PASSWORD}`;
  headers.Authorization = `Basic ${Buffer.from(raw).toString('base64')}`;
  return headers;
}

async function executeGrafanaRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>
): Promise<T> {
  ensureGrafanaConfigured();
  const url = `${grafanaBaseUrl}${path}`;
  const response = await withTimeout(fetch(url, {
    method,
    headers: buildGrafanaHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  }), EXTERNAL_API_TIMEOUT_MS, 'Grafana');

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Grafana HTTP ${response.status}: ${errorText}`);
  }
  return response.json() as Promise<T>;
}

const GH_API_URL = config.GH_API_URL?.trim() || 'https://api.github.com';
const GH_REPO = config.GH_REPO?.trim();
const GH_PAT = config.GH_PAT?.trim();

// ============================================================================
// TRADING SINAIS LLM - TIPOS E CONSTANTES
// ============================================================================
type TradingSignalGenerationSource = 'on_demand' | 'scheduler' | 'chat';

type TradingMarketType = 'futures' | 'spot' | 'margin';
type TradingMarginMode = 'cross' | 'isolated';
type TradingIntervalValue = keyof typeof TRADING_INTERVAL_GRANULARITY;

type LLMMessage = { role: 'system' | 'user' | 'assistant'; content: string };
type LLMResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

const TRADING_INTERVAL_GRANULARITY = {
  '1m': 1, '3m': 3, '5m': 5, '15m': 15, '30m': 30,
  '1h': 60, '2h': 120, '4h': 240, '8h': 480, '12h': 720,
  '1d': 1440, '1w': 10080,
} as const;
const TRADING_INTERVALS = Object.keys(TRADING_INTERVAL_GRANULARITY) as TradingIntervalValue[];

// CORREÇÃO A2: Timeouts LLM configuráveis via env vars (sem hardcoded)
// Ref: Regra 6 - PROIBIDO valores hardcoded
const LLM_SIGNAL_TIMEOUT_MS = parseInt(process.env.LLM_SIGNAL_TIMEOUT_MS || '240000', 10);
const LLM_SIGNAL_TIMEOUT_ARBITRAGE_MS = parseInt(process.env.LLM_SIGNAL_TIMEOUT_ARBITRAGE_MS || '360000', 10);

// CORREÇÃO M4: maxAllowedDeviation configurável via env var
const LLM_VALIDATION_MAX_DEVIATION = parseFloat(process.env.LLM_VALIDATION_MAX_DEVIATION || '0.01');
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
] as const;
const TRADING_TECHNIQUE_ZOD = z.enum(TRADING_TECHNIQUE_KEYS);

type TradingProfileKind = 'analysis' | 'signal';

const DEFAULT_TRADING_NEWS_CONFIG: TradingNewsConfigResolved = {
  engines: [],
  categories: 'general',
  language: 'pt-BR',
  safesearch: '1',
  timeRange: 'last_24_hours',
  dateFrom: undefined,
  dateTo: undefined,
  queryTemplates: ['{symbol} {marketType} news {terms}'],
  extraTerms: [],
  maxResults: 5,
};

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
];

const DEFAULT_TRADING_ENSEMBLE_CONFIG: TradingEnsembleConfig = {
  mode: 'ensemble_top3',
  topN: 3,
};

type TradingNewsConfigResolved = {
  engines: string[];
  categories: string;
  language: string;
  safesearch: string;
  timeRange: 'last_hour' | 'last_24_hours' | 'custom' | 'day' | 'week' | 'month' | 'year';
  dateFrom?: string;
  dateTo?: string;
  queryTemplates: string[];
  extraTerms: string[];
  maxResults: number;
};

type WebSearchTimeRange = 'day' | 'week' | 'month' | 'year';

function parseListParam(input?: string | string[]): string[] {
  if (!input) return [];
  const rawList = Array.isArray(input) ? input : input.split(',');
  return rawList.map((item) => item.trim()).filter(Boolean);
}

function parseTimeframesParam(input?: string | string[]): TradingIntervalValue[] {
  const list = parseListParam(input);
  if (list.length === 0) return [];
  return list.map((value) => TRADING_INTERVAL_ZOD.parse(value));
}

function parseIndicatorsParam(input?: string | string[]): TradingIndicatorKey[] {
  const list = parseListParam(input);
  if (list.length === 0) return [];
  return list.map((value) => TRADING_INDICATOR_ZOD.parse(value)) as TradingIndicatorKey[];
}

function parseTechniquesParam(input?: string | string[]): TradingTechnique[] {
  const list = parseListParam(input);
  if (list.length === 0) return [];
  return list.map((value) => TRADING_TECHNIQUE_ZOD.parse(value)) as TradingTechnique[];
}

function normalizeTradingTechniques(raw?: TradingTechnique[] | null): TradingTechnique[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [...DEFAULT_TRADING_TECHNIQUES];
  }
  const parsed = raw.map((value) => TRADING_TECHNIQUE_ZOD.parse(value));
  const unique = Array.from(new Set(parsed));
  return unique.length > 0 ? unique : [...DEFAULT_TRADING_TECHNIQUES];
}

function normalizeTradingEnsembleConfig(raw?: TradingEnsembleConfig | null): TradingEnsembleConfig {
  const parsed = TradingEnsembleConfigSchema.safeParse(raw ?? DEFAULT_TRADING_ENSEMBLE_CONFIG);
  if (parsed.success) return parsed.data;
  return { ...DEFAULT_TRADING_ENSEMBLE_CONFIG };
}

class TradingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TradingConfigError';
  }
}

function normalizeTradingArbitrageConfig(raw?: TradingArbitrageConfig | null): TradingArbitrageConfig | undefined {
  if (!raw) return undefined;
  const parsed = TradingArbitrageConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new TradingConfigError('Configuração de arbitragem inválida');
  }
  const normalizedExchanges = Array.from(new Set(parsed.data.exchanges));
  const normalizedAssets = Array.from(
    new Set(parsed.data.intermediateAssets.map((asset) => asset.trim().toUpperCase()).filter(Boolean))
  );
  if (normalizedAssets.length > MAX_ARBITRAGE_INTERMEDIATE_ASSETS) {
    throw new TradingConfigError(`Máximo de ${MAX_ARBITRAGE_INTERMEDIATE_ASSETS} ativos intermediários permitido.`);
  }
  return {
    ...parsed.data,
    exchanges: normalizedExchanges,
    intermediateAssets: normalizedAssets,
  };
}

function resolveIntervalMinutes(interval: TradingIntervalValue): number {
  return TRADING_INTERVAL_GRANULARITY[interval];
}

function assertArbitrageConfigForTechniques(params: {
  techniques: TradingTechnique[];
  arbitrageConfig?: TradingArbitrageConfig;
  timeframes: TradingIntervalValue[];
  context: string;
}): void {
  if (!params.techniques.includes('arbitrage_triangular')) return;
  if (!params.arbitrageConfig) {
    throw new TradingConfigError(`Configuração de arbitragem obrigatória para ${params.context}`);
  }
  const maxMinutes = params.arbitrageConfig.maxIntervalMinutes;
  const invalidFrames = params.timeframes.filter((frame) => resolveIntervalMinutes(frame) > maxMinutes);
  if (invalidFrames.length > 0) {
    throw new TradingConfigError(`Arbitragem triangular exige timeframes <= ${maxMinutes} minutos. Ajuste: ${invalidFrames.join(', ')}`);
  }
}

function splitSymbolPair(symbol: string): { base: string; quote: string } {
  const parts = symbol.split('-').map((value) => value.trim()).filter(Boolean);
  if (parts.length !== 2) {
    throw new Error(`Símbolo inválido para arbitragem triangular: ${symbol}`);
  }
  return { base: parts[0], quote: parts[1] };
}

const ARBITRAGE_EXCHANGE_LABELS: Record<TradingArbitrageExchange, string> = {
  kucoin: 'KuCoin',
};

const MAX_ARBITRAGE_INTERMEDIATE_ASSETS = 30;

type KucoinTradingFeeCache = {
  spotPct?: number;
  marginPct?: number;
  futuresPct?: number;
  updatedAt: string;
};

type KucoinNetworkFeeCache = {
  feesByAsset: Record<string, number>;
  updatedAt: string;
};

function deriveIntermediateAssetsFromSymbols(symbols: string[]): string[] {
  const assets = new Set<string>();
  for (const symbol of symbols) {
    try {
      const { base, quote } = splitSymbolPair(symbol);
      assets.add(base.toUpperCase());
      assets.add(quote.toUpperCase());
    } catch {
      continue;
    }
  }
  return Array.from(assets).sort((a, b) => a.localeCompare(b));
}

async function loadKucoinIntegrationConfig(tenantId: string): Promise<schema.Integration | null> {
  const integration = await getDatabase().query.integrations.findFirst({
    where: and(
      eq(schema.integrations.tenantId, tenantId),
      eq(schema.integrations.tipo, 'kucoin')
    ),
  });
  return integration ?? null;
}

async function updateKucoinIntegrationConfig(
  tenantId: string,
  patch: Partial<IntegrationConfiguracao>
): Promise<void> {
  const current = await loadKucoinIntegrationConfig(tenantId);
  if (!current) return;
  const nextConfig = {
    ...(current.configuracao ?? {}),
    ...patch,
  } as IntegrationConfiguracao;
  await getDatabase()
    .update(schema.integrations)
    .set({ configuracao: nextConfig, atualizadoEm: new Date() })
    .where(eq(schema.integrations.id, current.id));
}

function coerceFeeRateToPct(rate?: string | number): number | null {
  if (rate === undefined || rate === null) return null;
  const parsed = Number(String(rate).trim());
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed * 100;
}

function resolveNetworkFeeFromChains(chains: kucoinSpotClient.KucoinCurrencyChain[] | undefined): number | null {
  if (!Array.isArray(chains) || chains.length === 0) return null;
  const eligible = chains.filter((chain) => chain.isWithdrawEnabled !== false);
  if (eligible.length === 0) return null;
  const fees = eligible
    .map((chain) => Number(String(chain.withdrawalMinFee ?? chain.withdrawFeeRate ?? '').trim()))
    .filter((fee) => Number.isFinite(fee) && fee > 0);
  if (fees.length === 0) return null;
  return Math.max(...fees);
}

async function resolveKucoinNetworkFeesByAsset(): Promise<Record<string, number>> {
  const currencies = await kucoinSpotClient.getCurrencies();
  const feesByAsset: Record<string, number> = {};
  for (const currency of currencies) {
    const asset = currency.currency?.toUpperCase();
    if (!asset) continue;
    const fee = resolveNetworkFeeFromChains(currency.chains);
    if (fee === null) continue;
    feesByAsset[asset] = fee;
  }
  return feesByAsset;
}

// CORREÇÃO CR4 (07/02/2026): Validação prévia de credentials antes de APIs autenticadas.
// Ref: https://www.kucoin.com/docs-new/api-3470148 (Get Actual Fee - Spot/Margin - REQUER auth)
// Ref: https://www.kucoin.com/docs-new/api-3470220 (Futures contract info - público, mas fees via contrato)

// CORREÇÃO A4: Mapeamento de erros amigáveis para o frontend
// Ref: Regra 13 - PT-BR primário, EN secundário
function mapTradingErrorToUserMessage(error: Error): { message: string; code: string } {
  const msg = error.message.toLowerCase();
  if (msg.includes('trading_scope_required') || msg.includes('lora') || msg.includes('namespace trading obrigatório'))
    return { message: 'Governança Trading: namespace/agente/LoRA ativo obrigatório. Revise a configuração de Training.', code: 'TRADING_SCOPE_REQUIRED' };
  if (msg.includes('timeout') || msg.includes('gpu') || msg.includes('temporariamente indisponível'))
    return { message: 'Serviço de IA temporariamente indisponível. Tente novamente em alguns segundos.', code: 'GPU_TIMEOUT' };
  if (msg.includes('símbolo inválido') || msg.includes('invalid symbol') || msg.includes('formato de símbolo'))
    return { message: 'Símbolo não suportado para este mercado.', code: 'INVALID_SYMBOL' };
  if (msg.includes('taxas') || msg.includes('fee') || msg.includes('trade fee'))
    return { message: 'Não foi possível obter taxas de trading. Verifique a configuração.', code: 'FEE_ERROR' };
  if (msg.includes('circuit breaker'))
    return { message: 'Serviço KuCoin temporariamente indisponível. Aguarde e tente novamente.', code: 'KUCOIN_UNAVAILABLE' };
  if (msg.includes('credenciais') || msg.includes('não configurad'))
    return { message: 'Credenciais de API não configuradas. Verifique a configuração no painel de administração.', code: 'CREDENTIALS_MISSING' };
  if (msg.includes('resposta do llm vazia') || msg.includes('json'))
    return { message: 'A IA não conseguiu gerar uma resposta válida. Tente novamente.', code: 'LLM_PARSE_ERROR' };
  return { message: 'Erro ao gerar sinal de trading. Tente novamente.', code: 'UNKNOWN' };
}

// CORREÇÃO A1: Cache Redis para trade fees - taxas raramente mudam (TTL 15 min)
const TRADE_FEE_CACHE_TTL_SECONDS = 900; // 15 minutos
const TRADE_FEE_CACHE_PREFIX = 'alice:trading:fee';

async function resolveKucoinTradeFeePct(params: {
  symbol: string;
  marketType: TradingMarketType;
}): Promise<number> {
  // CORREÇÃO C3: Validar formato do símbolo antes de qualquer chamada à API
  if (!kucoinService.validateSymbolFormatForMarket(params.symbol, params.marketType)) {
    throw new Error(
      `Formato de símbolo inválido para mercado ${params.marketType}: "${params.symbol}". ` +
      `Esperado: ${params.marketType === 'futures' ? 'XBTUSDTM (termina com M)' : 'BTC-USDT (base-quote com hífen)'}`
    );
  }

  // CORREÇÃO A1: Tentar cache Redis primeiro
  const cacheKey = `${TRADE_FEE_CACHE_PREFIX}:${params.marketType}:${params.symbol}`;
  const redisClient = getRedisClient();
  if (redisClient) {
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        const cachedValue = parseFloat(cached);
        if (Number.isFinite(cachedValue) && cachedValue > 0) {
          logger.debug({ symbol: params.symbol, marketType: params.marketType, feePct: cachedValue }, 'Trade fee obtida do cache Redis');
          return cachedValue;
        }
      }
    } catch (cacheErr) {
      logger.warn({ error: (cacheErr as Error).message }, 'Erro ao ler cache de trade fees - continuando com API');
    }
  }

  let resolved: number;

  if (params.marketType === 'futures') {
    if (!kucoinClient.isKucoinConfigured()) {
      throw new Error('Credenciais KuCoin (Futures) não configuradas. Configure KUCOIN_PRO_API_KEY nos GitHub Secrets.');
    }
    const contract = await kucoinClient.getContractInfo(params.symbol);
    const makerPct = coerceFeeRateToPct(contract.makerFeeRate);
    const takerPct = coerceFeeRateToPct(contract.takerFeeRate);
    resolved = Math.max(makerPct ?? 0, takerPct ?? 0);
    if (!Number.isFinite(resolved) || resolved <= 0) {
      throw new Error('Taxas de trade Futures inválidas para KuCoin.');
    }
  } else {
    // Spot e Margin compartilham o mesmo endpoint de taxas (GET /api/v1/trade-fees)
    // Ref: KuCoin docs - "Get Actual Fee - Spot/Margin" usa a mesma API key
    if (params.marketType === 'spot' && !kucoinSpotClient.isSpotConfigured()) {
      throw new Error('Credenciais KuCoin (Spot) não configuradas. Configure KUCOIN_PRO_API_KEY nos GitHub Secrets.');
    }
    if (params.marketType === 'margin' && !kucoinMarginClient.isMarginConfigured()) {
      throw new Error('Credenciais KuCoin (Margin) não configuradas. Configure KUCOIN_PRO_API_KEY nos GitHub Secrets.');
    }

    const fees = await kucoinSpotClient.getSpotTradeFees([params.symbol]);
    // CORREÇÃO C2: Fail-fast ao invés de fallback silencioso para fees[0]
    // Ref: Regra 6 - PROIBIDO fallbacks perigosos que podem retornar taxas de outro par
    const fee = fees.find((item) => item.symbol === params.symbol);
    if (!fee) {
      const availableSymbols = fees.map((f) => f.symbol).join(', ');
      throw new Error(
        `Taxas de trade ${params.marketType === 'margin' ? 'Margin' : 'Spot'} não encontradas para símbolo ${params.symbol}. ` +
        `Símbolos disponíveis na resposta: ${availableSymbols || 'nenhum'}`
      );
    }
    const makerPct = coerceFeeRateToPct(fee.makerFeeRate);
    const takerPct = coerceFeeRateToPct(fee.takerFeeRate);
    resolved = Math.max(makerPct ?? 0, takerPct ?? 0);
    if (!Number.isFinite(resolved) || resolved <= 0) {
      throw new Error(`Taxas de trade ${params.marketType === 'margin' ? 'Margin' : 'Spot'} inválidas para KuCoin.`);
    }
  }

  // CORREÇÃO A1: Salvar no cache Redis
  if (redisClient) {
    try {
      await redisClient.set(cacheKey, String(resolved), { EX: TRADE_FEE_CACHE_TTL_SECONDS });
      logger.debug({ symbol: params.symbol, marketType: params.marketType, feePct: resolved, ttl: TRADE_FEE_CACHE_TTL_SECONDS }, 'Trade fee salva no cache Redis');
    } catch (cacheErr) {
      logger.warn({ error: (cacheErr as Error).message }, 'Erro ao salvar trade fee no cache Redis');
    }
  }

  return resolved;
}

async function resolveArbitrageFeePctForExchanges(params: {
  exchanges: TradingArbitrageExchange[];
  symbol: string;
  marketType: TradingMarketType;
  tenantId: string;
}): Promise<{ feePctByExchange: Record<TradingArbitrageExchange, number>; effectiveFeePct: number }> {
  const feePctByExchange = {} as Record<TradingArbitrageExchange, number>;
  const uniqueExchanges = Array.from(new Set(params.exchanges));
  const cachedIntegration = await loadKucoinIntegrationConfig(params.tenantId);
  const cachedFees = (cachedIntegration?.configuracao as IntegrationConfiguracao | undefined)?.tradingFees as KucoinTradingFeeCache | undefined;

  for (const exchange of uniqueExchanges) {
    if (exchange === 'kucoin') {
      try {
        const feePct = await resolveKucoinTradeFeePct({ symbol: params.symbol, marketType: params.marketType });
        feePctByExchange[exchange] = feePct;
        const nextCache: KucoinTradingFeeCache = {
          ...(cachedFees ?? {}),
          updatedAt: new Date().toISOString(),
        };
        if (params.marketType === 'spot') nextCache.spotPct = feePct;
        if (params.marketType === 'margin') nextCache.marginPct = feePct;
        if (params.marketType === 'futures') nextCache.futuresPct = feePct;
        await updateKucoinIntegrationConfig(params.tenantId, { tradingFees: nextCache });
      } catch (error) {
        const cachedValue = params.marketType === 'futures'
          ? cachedFees?.futuresPct
          : params.marketType === 'margin'
            ? cachedFees?.marginPct
            : cachedFees?.spotPct;
        if (Number.isFinite(cachedValue ?? NaN) && (cachedValue ?? 0) > 0) {
          feePctByExchange[exchange] = cachedValue as number;
          logger.warn({ error, exchange, cachedValue }, 'Usando taxa de trade KuCoin em cache persistido.');
        } else {
          throw error;
        }
      }
    }
  }

  const effectiveFeePct = Math.max(...Object.values(feePctByExchange));
  if (!Number.isFinite(effectiveFeePct) || effectiveFeePct <= 0) {
    throw new Error('Taxa de arbitragem inválida para exchanges selecionadas.');
  }
  return { feePctByExchange, effectiveFeePct };
}

async function resolveNetworkFeesForTenant(tenantId: string): Promise<Record<string, number>> {
  const cachedIntegration = await loadKucoinIntegrationConfig(tenantId);
  const cachedNetwork = (cachedIntegration?.configuracao as IntegrationConfiguracao | undefined)?.networkFeesByAsset as KucoinNetworkFeeCache | undefined;
  try {
    const networkFeesByAsset = await resolveKucoinNetworkFeesByAsset();
    await updateKucoinIntegrationConfig(tenantId, {
      networkFeesByAsset: {
        feesByAsset: networkFeesByAsset,
        updatedAt: new Date().toISOString(),
      } satisfies KucoinNetworkFeeCache,
    });
    return networkFeesByAsset;
  } catch (error) {
    if (cachedNetwork?.feesByAsset && Object.keys(cachedNetwork.feesByAsset).length > 0) {
      logger.warn({ error }, 'Usando network fees de KuCoin em cache persistido.');
      return cachedNetwork.feesByAsset;
    }
    throw error;
  }
}

async function resolveDefaultSymbolForMarketType(params: {
  auth: { tenantId: string; userId: string };
  marketType: TradingMarketType;
}): Promise<string> {
  if (params.marketType === 'futures') {
    const contracts = await kucoinClient.getActiveContracts();
    const contract = contracts[0];
    if (!contract?.symbol) {
      throw new Error('Não foi possível determinar símbolo Futures padrão na KuCoin.');
    }
    return contract.symbol;
  }
  const symbols = await kucoinSpotClient.getSpotSymbols();
  const symbol = symbols[0]?.symbol;
  if (!symbol) {
    throw new Error('Não foi possível determinar símbolo Spot/Margin padrão na KuCoin.');
  }
  return symbol;
}

function normalizeTradingNewsConfig(raw?: TradingProfileNewsConfig | null): TradingNewsConfigResolved {
  const sanitizedEngines = Array.isArray(raw?.engines)
    ? raw.engines.map((engine) => engine.trim()).filter(Boolean)
    : [];
  const normalizedTemplates = Array.isArray(raw?.queryTemplates)
    ? raw.queryTemplates.map((template) => template.trim()).filter(Boolean)
    : [];
  const queryTemplates = normalizedTemplates.length > 0
    ? normalizedTemplates
    : DEFAULT_TRADING_NEWS_CONFIG.queryTemplates;
  const extraTerms = Array.isArray(raw?.extraTerms)
    ? raw.extraTerms.map((term) => term.trim()).filter(Boolean)
    : [];
  const timeRange = raw?.timeRange === 'last_hour'
    || raw?.timeRange === 'last_24_hours'
    || raw?.timeRange === 'custom'
    || raw?.timeRange === 'day'
    || raw?.timeRange === 'week'
    || raw?.timeRange === 'month'
    || raw?.timeRange === 'year'
    ? raw.timeRange
    : DEFAULT_TRADING_NEWS_CONFIG.timeRange;
  const dateFrom = timeRange === 'custom' ? normalizeDateString(raw?.dateFrom) : undefined;
  const dateTo = timeRange === 'custom' ? normalizeDateString(raw?.dateTo) : undefined;

  return {
    engines: sanitizedEngines,
    categories: raw?.categories?.trim() || DEFAULT_TRADING_NEWS_CONFIG.categories,
    language: raw?.language?.trim() || DEFAULT_TRADING_NEWS_CONFIG.language,
    safesearch: raw?.safesearch?.trim() || DEFAULT_TRADING_NEWS_CONFIG.safesearch,
    timeRange,
    dateFrom,
    dateTo,
    queryTemplates,
    extraTerms,
    maxResults: raw?.maxResults && raw.maxResults > 0 ? Math.min(raw.maxResults, 10) : DEFAULT_TRADING_NEWS_CONFIG.maxResults,
  };
}

function normalizeDateString(input?: string | null): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  if (!/^\d{4}-\d{2}-\d{2}(T[\d:.+-Z]+)?$/.test(trimmed)) return undefined;
  return trimmed;
}

function buildRelativeDateRange(timeRange: TradingNewsConfigResolved['timeRange']): { dateFrom?: string; dateTo?: string } {
  const now = new Date();
  if (timeRange === 'last_hour') {
    const from = new Date(now.getTime() - 60 * 60 * 1000);
    return { dateFrom: from.toISOString(), dateTo: now.toISOString() };
  }
  if (timeRange === 'last_24_hours') {
    const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return { dateFrom: from.toISOString(), dateTo: now.toISOString() };
  }
  return {};
}

function resolveTimeRangeParam(timeRange: TradingNewsConfigResolved['timeRange']): WebSearchTimeRange | undefined {
  if (timeRange === 'day' || timeRange === 'week' || timeRange === 'month' || timeRange === 'year') {
    return timeRange;
  }
  if (timeRange === 'last_24_hours') {
    return 'day';
  }
  return undefined;
}

function normalizeTradingProfile(row?: schema.TradingAnalysisProfile | null): {
  timeframes: TradingIntervalValue[];
  indicators: TradingIndicatorKey[];
  dataSources: TradingProfileDataSources;
  techniques: TradingTechnique[];
  ensembleConfig: TradingEnsembleConfig;
  arbitrageConfig?: TradingArbitrageConfig;
  modelConfig: TradingProfileModelConfig;
  consensus: TradingProfileConsensus;
  newsConfig: TradingNewsConfigResolved;
} {
  const timeframes = row?.timeframes?.length
    ? row.timeframes.map((value) => TRADING_INTERVAL_ZOD.parse(value))
    : (['5m'] as TradingIntervalValue[]);
  const indicators = Array.isArray(row?.indicators) && row?.indicators.length > 0
    ? row.indicators as TradingIndicatorKey[]
    : [...TRADING_INDICATOR_KEYS];
  const dataSourcesRaw = row?.dataSources ?? {};
  const dataSources: TradingProfileDataSources = {
    orderBook: Boolean(dataSourcesRaw?.orderBook),
    news: Boolean(dataSourcesRaw?.news),
    trainingData: Boolean(dataSourcesRaw?.trainingData),
  };
  const techniques = normalizeTradingTechniques(row?.techniques as TradingTechnique[] | null);
  const ensembleConfig = normalizeTradingEnsembleConfig(row?.ensembleConfig as TradingEnsembleConfig | null);
  const arbitrageConfig = normalizeTradingArbitrageConfig(row?.arbitrageConfig as TradingArbitrageConfig | null);
  const modelConfigRaw = row?.modelConfig ?? {};
  const modelConfig: TradingProfileModelConfig = {
    temperature: modelConfigRaw?.temperature ?? undefined,
    maxTokens: modelConfigRaw?.maxTokens ?? undefined,
  };
  const newsConfig = normalizeTradingNewsConfig(row?.newsConfig ?? null);
  const consensusRaw = row?.consensus as Partial<TradingProfileConsensus> | undefined;
  const consensus: TradingProfileConsensus = {
    rule: consensusRaw?.rule === 'majority' ? 'majority' : 'majority',
    minAgree: consensusRaw?.minAgree ?? undefined,
  };

  return {
    timeframes,
    indicators,
    dataSources,
    techniques,
    ensembleConfig,
    arbitrageConfig,
    modelConfig,
    consensus,
    newsConfig,
  };
}

type AnalysisMatrixEntry = {
  interval: TradingIntervalValue;
  analysis: technicalIndicators.TechnicalAnalysisResult;
  indicatorId: string;
  resolvedSymbol?: string;
};

function buildMajorityConsensus(
  matrix: AnalysisMatrixEntry[],
  consensusConfig?: TradingProfileConsensus
): {
  overallSignal: technicalIndicators.TechnicalAnalysisResult['overallSignal'];
  confidence: number;
  alignedTimeframes: TradingIntervalValue[];
  misalignedTimeframes: TradingIntervalValue[];
  agreementRatio: number;
  requiredAgree: number;
  totalTimeframes: number;
  isMajorityReached: boolean;
} {
  const total = matrix.length;
  const requiredAgree = consensusConfig?.minAgree ?? Math.floor(total / 2) + 1;
  const counts = new Map<technicalIndicators.TechnicalAnalysisResult['overallSignal'], number>();
  const signalsByFrame = new Map<TradingIntervalValue, technicalIndicators.TechnicalAnalysisResult['overallSignal']>();

  for (const entry of matrix) {
    const signal = entry.analysis.overallSignal;
    counts.set(signal, (counts.get(signal) ?? 0) + 1);
    signalsByFrame.set(entry.interval, signal);
  }

  let maxCount = 0;
  let winners: technicalIndicators.TechnicalAnalysisResult['overallSignal'][] = [];
  for (const [signal, count] of counts.entries()) {
    if (count > maxCount) {
      maxCount = count;
      winners = [signal];
    } else if (count === maxCount) {
      winners.push(signal);
    }
  }

  const isMajorityReached = maxCount >= requiredAgree && winners.length === 1;
  const consensusSignal = isMajorityReached ? winners[0] : 'neutral';

  const alignedTimeframes = Array.from(signalsByFrame.entries())
    .filter(([, signal]) => signal === consensusSignal)
    .map(([interval]) => interval);
  const misalignedTimeframes = Array.from(signalsByFrame.entries())
    .filter(([, signal]) => signal !== consensusSignal)
    .map(([interval]) => interval);

  const alignedEntries = matrix.filter((entry) => alignedTimeframes.includes(entry.interval));
  const confidence = alignedEntries.length > 0
    ? alignedEntries.reduce((sum, entry) => sum + entry.analysis.confidence, 0) / alignedEntries.length
    : 0;
  const agreementRatio = total > 0 ? maxCount / total : 0;

  return {
    overallSignal: consensusSignal,
    confidence: Math.round(confidence * 100) / 100,
    alignedTimeframes,
    misalignedTimeframes,
    agreementRatio: Math.round(agreementRatio * 100) / 100,
    requiredAgree,
    totalTimeframes: total,
    isMajorityReached,
  };
}

function aggregateTechniqueScores(matrix: AnalysisMatrixEntry[], techniques: TradingTechnique[]): TradingTechniqueScore[] {
  const perFrame = matrix.map((entry) => technicalIndicators.calculateTechniqueScores({
    analysis: entry.analysis,
    techniques,
  }));

  return techniques
    .filter((technique) => technique !== 'arbitrage_triangular')
    .map((technique) => {
      const scores = perFrame
        .map((list) => list.find((item) => item.technique === technique))
        .filter((item): item is TradingTechniqueScore => Boolean(item));
      if (scores.length === 0) {
        return { technique, signal: 'neutral', confidence: 0 };
      }
      const weightMap = new Map<TradingOverallSignal, number>();
      let confidenceSum = 0;
      for (const score of scores) {
        confidenceSum += score.confidence;
        weightMap.set(score.signal, (weightMap.get(score.signal) ?? 0) + score.confidence);
      }
      let bestSignal: TradingOverallSignal = 'neutral';
      let bestWeight = -1;
      for (const [signal, weight] of weightMap.entries()) {
        if (weight > bestWeight) {
          bestWeight = weight;
          bestSignal = signal;
        }
      }
      const avgConfidence = confidenceSum / scores.length;
      return {
        technique,
        signal: bestSignal,
        confidence: Math.round(avgConfidence * 100) / 100,
      };
    });
}

function buildEnsembleResult(
  scores: TradingTechniqueScore[],
  config: TradingEnsembleConfig
): TradingEnsembleResult {
  const sorted = [...scores].sort((a, b) => b.confidence - a.confidence);
  const topTechniques = sorted.slice(0, Math.max(1, config.topN));
  const weightMap = new Map<TradingOverallSignal, number>();
  let confidenceSum = 0;
  for (const score of topTechniques) {
    confidenceSum += score.confidence;
    weightMap.set(score.signal, (weightMap.get(score.signal) ?? 0) + score.confidence);
  }
  let bestSignal: TradingOverallSignal = 'neutral';
  let bestWeight = -1;
  for (const [signal, weight] of weightMap.entries()) {
    if (weight > bestWeight) {
      bestWeight = weight;
      bestSignal = signal;
    }
  }
  const avgConfidence = topTechniques.length > 0 ? confidenceSum / topTechniques.length : 0;
  return {
    overallSignal: bestSignal,
    confidence: Math.round(avgConfidence * 100) / 100,
    topTechniques,
  };
}

async function getOrderBookSnapshot(
  auth: { tenantId: string; userId: string },
  symbol: string,
  marketType?: TradingMarketType,
  marginMode?: TradingMarginMode,
  exchange: TradingArbitrageExchange = 'kucoin'
): Promise<{
  symbol: string;
  bestBid: number | null;
  bestAsk: number | null;
  spreadAbs: number | null;
  spreadPct: number | null;
  depth: number;
}> {
  if (exchange !== 'kucoin') {
    throw new Error(`Exchange não suportada para order book: ${exchange}`);
  }
  const resolvedSymbol = await kucoinService.resolveTradingSymbolStrict(auth, symbol, marketType, marginMode);
  const depth = 20;
  const orderbook = marketType === 'spot' || marketType === 'margin'
    ? await kucoinSpotClient.getSpotOrderBook(resolvedSymbol)
    : await kucoinClient.getOrderBook(resolvedSymbol, depth);

  const bestBid = orderbook?.bids?.[0]?.[0] ? Number(orderbook.bids[0][0]) : null;
  const bestAsk = orderbook?.asks?.[0]?.[0] ? Number(orderbook.asks[0][0]) : null;
  const spreadAbs = bestBid !== null && bestAsk !== null ? Math.abs(bestAsk - bestBid) : null;
  const spreadPct = spreadAbs !== null && bestAsk !== null && bestAsk !== 0
    ? Math.round((spreadAbs / bestAsk) * 10000) / 100
    : null;

  return {
    symbol: resolvedSymbol,
    bestBid,
    bestAsk,
    spreadAbs,
    spreadPct,
    depth,
  };
}

type ArbitrageLeg = {
  from: string;
  to: string;
  symbol: string;
  exchange: TradingArbitrageExchange;
  side: 'sell' | 'buy';
  rate: number;
  bestBid: number | null;
  bestAsk: number | null;
};

type NetworkFeeApplied = {
  asset: string;
  amount: number;
  fromExchange: TradingArbitrageExchange;
  toExchange: TradingArbitrageExchange;
};

type TriangularArbitrageResult = {
  intermediateAsset: string;
  startAsset: string;
  endAsset: string;
  edgePct: number;
  finalAmount: number;
  networkFeeTotal: number;
  networkFeesApplied: NetworkFeeApplied[];
  legs: ArbitrageLeg[];
};

async function getConversionRate(params: {
  auth: { tenantId: string; userId: string };
  from: string;
  to: string;
  marketType?: TradingMarketType;
  marginMode?: TradingMarginMode;
  exchange: TradingArbitrageExchange;
}): Promise<ArbitrageLeg | null> {
  const candidateDirect = `${params.from}-${params.to}`;
  const candidateInverse = `${params.to}-${params.from}`;

  const trySnapshot = async (symbol: string) => {
    try {
      return await getOrderBookSnapshot(params.auth, symbol, params.marketType, params.marginMode, params.exchange);
    } catch {
      return null;
    }
  };

  const direct = await trySnapshot(candidateDirect);
  if (direct?.bestBid && direct.bestAsk) {
    return {
      from: params.from,
      to: params.to,
      symbol: direct.symbol,
      exchange: params.exchange,
      side: 'sell',
      rate: direct.bestBid,
      bestBid: direct.bestBid,
      bestAsk: direct.bestAsk,
    };
  }

  const inverse = await trySnapshot(candidateInverse);
  if (inverse?.bestBid && inverse.bestAsk) {
    return {
      from: params.from,
      to: params.to,
      symbol: inverse.symbol,
      exchange: params.exchange,
      side: 'buy',
      rate: 1 / inverse.bestAsk,
      bestBid: inverse.bestBid,
      bestAsk: inverse.bestAsk,
    };
  }

  return null;
}

async function calculateTriangularArbitrage(params: {
  auth: { tenantId: string; userId: string };
  startAsset: string;
  quoteAsset: string;
  intermediateAssets: string[];
  marketType?: TradingMarketType;
  marginMode?: TradingMarginMode;
  feePct: number;
  exchanges: TradingArbitrageExchange[];
  feePctByExchange: Record<TradingArbitrageExchange, number>;
  networkFeesByAsset?: Record<string, number>;
  maxSlippagePct: number;
}): Promise<TriangularArbitrageResult[]> {
  const results: TriangularArbitrageResult[] = [];
  const feeMultiplier = 1 - params.feePct / 100;
  const slippageMultiplier = 1 - params.maxSlippagePct / 100;
  const exchanges = params.exchanges.length > 0 ? params.exchanges : (['kucoin'] as TradingArbitrageExchange[]);
  const networkFeesByAsset = params.networkFeesByAsset ?? {};
  const exchangeCombos: TradingArbitrageExchange[][] = [];
  for (const ex1 of exchanges) {
    for (const ex2 of exchanges) {
      for (const ex3 of exchanges) {
        exchangeCombos.push([ex1, ex2, ex3]);
      }
    }
  }

  for (const intermediate of params.intermediateAssets) {
    for (const combo of exchangeCombos) {
      const [exchange1, exchange2, exchange3] = combo;
      const leg1 = await getConversionRate({
        auth: params.auth,
        from: params.startAsset,
        to: intermediate,
        marketType: params.marketType,
        marginMode: params.marginMode,
        exchange: exchange1,
      });
      if (!leg1) continue;

      const leg2 = await getConversionRate({
        auth: params.auth,
        from: intermediate,
        to: params.quoteAsset,
        marketType: params.marketType,
        marginMode: params.marginMode,
        exchange: exchange2,
      });
      if (!leg2) continue;

      const leg3 = await getConversionRate({
        auth: params.auth,
        from: params.quoteAsset,
        to: params.startAsset,
        marketType: params.marketType,
        marginMode: params.marginMode,
        exchange: exchange3,
      });
      if (!leg3) continue;

      const startAmount = 1;
      let afterLeg1 = startAmount * leg1.rate * feeMultiplier * slippageMultiplier;
      const networkFeesApplied: NetworkFeeApplied[] = [];

      if (leg1.exchange !== leg2.exchange) {
        const fee = networkFeesByAsset[intermediate.toUpperCase()];
        if (!Number.isFinite(fee) || fee <= 0) {
          logger.warn({ intermediate, exchange1, exchange2 }, 'Network fee indisponível para transferência entre exchanges.');
          continue;
        }
        afterLeg1 = Math.max(afterLeg1 - fee, 0);
        networkFeesApplied.push({
          asset: intermediate.toUpperCase(),
          amount: fee,
          fromExchange: leg1.exchange,
          toExchange: leg2.exchange,
        });
      }

      let afterLeg2 = afterLeg1 * leg2.rate * feeMultiplier * slippageMultiplier;
      if (leg2.exchange !== leg3.exchange) {
        const fee = networkFeesByAsset[params.quoteAsset.toUpperCase()];
        if (!Number.isFinite(fee) || fee <= 0) {
          logger.warn({ quoteAsset: params.quoteAsset, exchange2, exchange3 }, 'Network fee indisponível para transferência entre exchanges.');
          continue;
        }
        afterLeg2 = Math.max(afterLeg2 - fee, 0);
        networkFeesApplied.push({
          asset: params.quoteAsset.toUpperCase(),
          amount: fee,
          fromExchange: leg2.exchange,
          toExchange: leg3.exchange,
        });
      }

      const finalAmount = afterLeg2 * leg3.rate * feeMultiplier * slippageMultiplier;
      const edgePct = ((finalAmount - startAmount) / startAmount) * 100;
      const networkFeeTotal = networkFeesApplied.reduce((sum, fee) => sum + fee.amount, 0);

      results.push({
        intermediateAsset: intermediate,
        startAsset: params.startAsset,
        endAsset: params.startAsset,
        edgePct: Math.round(edgePct * 100) / 100,
        finalAmount: Math.round(finalAmount * 1000000) / 1000000,
        networkFeeTotal: Math.round(networkFeeTotal * 1000000) / 1000000,
        networkFeesApplied,
        legs: [leg1, leg2, leg3],
      });
    }
  }

  if (results.length === 0) return [];
  const sorted = results.sort((a, b) => b.edgePct - a.edgePct);
  return sorted.slice(0, 3);
}

function buildNewsQuery(params: {
  symbol: string;
  marketType?: TradingMarketType;
  newsConfig: TradingNewsConfigResolved;
}): string {
  const marketType = params.marketType ?? 'futures';
  const terms = params.newsConfig.extraTerms.length > 0
    ? params.newsConfig.extraTerms.join(' ')
    : '';
  const dateFrom = params.newsConfig.dateFrom ?? '';
  const dateTo = params.newsConfig.dateTo ?? '';
  const rendered = params.newsConfig.queryTemplates.map((template) => template
    .replace('{symbol}', params.symbol)
    .replace('{marketType}', marketType)
    .replace('{terms}', terms)
    .replace('{dateFrom}', dateFrom)
    .replace('{dateTo}', dateTo)
    .trim()
    .replace(/\s+/g, ' ')
  );

  const joined = rendered.length > 1 ? rendered.join(' OR ') : rendered[0];
  return truncateText(joined, TRADING_LLM_MAX_NEWS_QUERY_CHARS);
}

async function fetchNewsSummary(
  auth: { tenantId: string; userId: string },
  symbol: string,
  marketType?: TradingMarketType,
  newsConfig?: TradingProfileNewsConfig
): Promise<{ query: string; results: Array<{ title: string; url: string; score?: number }> }> {
  const resolvedConfig = normalizeTradingNewsConfig(newsConfig ?? null);
  const relativeRange = buildRelativeDateRange(resolvedConfig.timeRange);
  const resolvedDateFrom = resolvedConfig.dateFrom ?? relativeRange.dateFrom;
  const resolvedDateTo = resolvedConfig.dateTo ?? relativeRange.dateTo;
  const query = buildNewsQuery({
    symbol,
    marketType,
    newsConfig: {
      ...resolvedConfig,
      dateFrom: resolvedDateFrom,
      dateTo: resolvedDateTo,
    },
  });
  const internalHeaders = generateInternalAuthHeaders({
    userId: auth.userId,
    tenantId: auth.tenantId,
    role: 'operator',
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${RAG_SERVICE_URL_FINAL}/api/rag/web-search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...internalHeaders,
      },
      body: JSON.stringify({
        query,
        limit: resolvedConfig.maxResults,
        engines: resolvedConfig.engines.length > 0 ? resolvedConfig.engines : undefined,
        categories: resolvedConfig.categories,
        language: resolvedConfig.language,
        safesearch: resolvedConfig.safesearch,
        timeRange: resolveTimeRangeParam(resolvedConfig.timeRange),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Falha ao buscar notícias: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as { results?: Array<{ title?: string; url?: string; score?: number }> };
    const results = (data.results ?? [])
      .filter((item) => item?.title && item?.url)
      .map((item) => ({ title: item.title as string, url: item.url as string, score: item.score }));

    logger.info({
      tenantId: auth.tenantId,
      symbol,
      marketType: marketType ?? 'futures',
      query,
      results: results.length,
    }, 'Notícias consultadas via SearXNG para análise de trading');

    return {
      query,
      results,
    };
  } catch (error) {
    logger.warn({
      tenantId: auth.tenantId,
      symbol,
      marketType: marketType ?? 'futures',
      query,
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    }, 'Falha ao buscar notícias via SearXNG - seguindo sem notícias');
    return { query, results: [] };
  } finally {
    clearTimeout(timeout);
  }
}

function truncateText(input: string, maxLength: number): string {
  if (input.length <= maxLength) return input;
  return `${input.slice(0, maxLength)}…`;
}

/** Resolve namespace Trading do tenant (obrigatório para training_data de trading). */
async function resolveTradingNamespaceId(tenantId: string): Promise<string | null> {
  const db = getDatabase();
  const ns = await db.query.namespaces.findFirst({
    where: and(
      eq(schema.namespaces.tenantId, tenantId),
      eq(schema.namespaces.slug, 'trading'),
      eq(schema.namespaces.ativo, true)
    ),
    columns: { id: true },
  });
  return ns?.id ?? null;
}

async function fetchTradingDatasetSummary(tenantId: string, namespaceId: string): Promise<{
  totalApproved: number;
  samples: Array<{ prompt: string; response: string; actionType: string; createdAt: string }>;
}> {
  const db = getDatabase();
  const [total] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.trainingData)
    .where(and(
      eq(schema.trainingData.tenantId, tenantId),
      eq(schema.trainingData.namespaceId, namespaceId),
      eq(schema.trainingData.status, 'approved'),
      inArray(schema.trainingData.sourceType, [...TRADING_SOURCE_TYPES])
    ));

  const samples = await db.query.trainingData.findMany({
    where: and(
      eq(schema.trainingData.tenantId, tenantId),
      eq(schema.trainingData.namespaceId, namespaceId),
      eq(schema.trainingData.status, 'approved'),
      inArray(schema.trainingData.sourceType, [...TRADING_SOURCE_TYPES])
    ),
    orderBy: [desc(schema.trainingData.criadoEm)],
    limit: 3,
  });

  return {
    totalApproved: Number(total?.count ?? 0),
    samples: samples.map((item) => {
      const msgs = (item.messages ?? []) as Array<{ role: string; content: string }>;
      const userMsg = msgs.find((m) => m.role === 'user');
      const assistantMsg = msgs.find((m) => m.role === 'assistant');
      const actionType = (item.sourceMetadata as Record<string, unknown>)?.actionType as string ?? 'unknown';
      return {
        prompt: truncateText(userMsg?.content ?? '', 400),
        response: truncateText(assistantMsg?.content ?? '', 400),
        actionType,
        createdAt: item.criadoEm?.toISOString?.() ?? new Date().toISOString(),
      };
    }),
  };
}

async function fetchRecentCandles(
  auth: { tenantId: string; userId: string },
  symbol: string,
  interval: TradingIntervalValue,
  marketType?: TradingMarketType,
  marginMode?: TradingMarginMode
): Promise<TradingCandleData[]> {
  const resolvedSymbol = await kucoinService.resolveTradingSymbolStrict(auth, symbol, marketType, marginMode);
  const granularity = resolveTradingIntervalGranularity(interval);
  if (!granularity) {
    throw new Error(`Intervalo inválido para candles: ${interval}`);
  }
  const now = Math.floor(Date.now() / 1000);
  const from = now - granularity * 200;
  const klinesRaw = marketType === 'spot' || marketType === 'margin'
    ? await kucoinSpotClient.getSpotKlines(resolvedSymbol, `${granularity}min`, from, now)
    : await kucoinClient.getKlines(resolvedSymbol, granularity, from, now);

  return klinesRaw.map((k) => ({
    timestamp: k.time,
    open: parseFloat(k.open),
    high: parseFloat(k.high),
    low: parseFloat(k.low),
    close: parseFloat(k.close),
    volume: parseFloat(k.volume),
  }));
}

function buildIndicatorSnapshot(analysis?: technicalIndicators.TechnicalAnalysisResult): Record<string, number> | undefined {
  if (!analysis) return undefined;
  const indicators: Record<string, number> = {};
  if (analysis.rsi?.value !== undefined) indicators.rsi = analysis.rsi.value;
  if (analysis.macd?.macd !== undefined) indicators.macd = analysis.macd.macd;
  if (analysis.macd?.signal !== undefined) indicators.macdSignal = analysis.macd.signal;
  if (analysis.bollinger?.percentB !== undefined) indicators.bollingerPercentB = analysis.bollinger.percentB;
  if (analysis.atr?.value !== undefined) indicators.atr = analysis.atr.value;
  if (analysis.stochastic?.k !== undefined) indicators.stochasticK = analysis.stochastic.k;
  if (analysis.adx?.adx !== undefined) indicators.adx = analysis.adx.adx;
  if (analysis.supportResistance?.pivot !== undefined) indicators.pivot = analysis.supportResistance.pivot;
  if (analysis.volume?.volumeRatio !== undefined) indicators.volumeRatio = analysis.volume.volumeRatio;
  return Object.keys(indicators).length > 0 ? indicators : undefined;
}

async function buildMarketContextFromSignal(params: {
  auth: { tenantId: string; userId: string };
  symbol: string;
  interval: TradingIntervalValue;
  marketType: TradingMarketType;
  marginMode?: TradingMarginMode;
  analysis?: technicalIndicators.TechnicalAnalysisResult;
}): Promise<schema.TradingDataset['marketContext']> {
  const { ticker, contract } = await kucoinService.getMarketData(params.auth, params.symbol, params.marketType, params.marginMode);
  const recentCandles = await fetchRecentCandles(params.auth, params.symbol, params.interval, params.marketType, params.marginMode);
  const latestPrice = parseFloat((ticker as { price: string }).price);
  const oldestClose = recentCandles[0]?.close ?? latestPrice;
  const changePercent = oldestClose !== 0 ? ((latestPrice - oldestClose) / oldestClose) * 100 : 0;
  const volumeSum = recentCandles.reduce((sum, candle) => sum + candle.volume, 0);

  return {
    symbol: params.symbol,
    timestamp: new Date().toISOString(),
    price: latestPrice,
    change24h: changePercent,
    volume24h: contract?.volumeOf24h ?? volumeSum,
    // Spot não possui funding/open interest - usar 0 como valor não aplicável
    fundingRate: contract?.fundingFeeRate ?? 0,
    openInterest: contract?.openInterest ? Number(contract.openInterest) : 0,
    recentCandles,
    indicators: buildIndicatorSnapshot(params.analysis),
  };
}

const TRADING_DATASET_SIMILARITY_THRESHOLD = 0.85;

async function generateTradingDatasetEmbedding(text: string): Promise<number[]> {
  const gpuResponse = await requestGpu({
    serviceType: GpuServiceType.EMBEDDINGS,
    endpoint: '/embed/text',
    method: 'POST',
    priority: GpuRequestPriority.MEDIUM,
    timeout: 30000,
    body: { texts: [text] },
  });

  if (!gpuResponse.success || !gpuResponse.data) {
    throw new Error(gpuResponse.error || 'Erro ao gerar embedding de trading');
  }

  const data = gpuResponse.data as { embedding?: number[]; embeddings?: number[][] };
  const embedding = data.embedding ?? data.embeddings?.[0];
  if (!embedding || embedding.length === 0) {
    throw new Error('Embedding de trading retornou vazio');
  }

  return embedding;
}

/** Source types de trading em training_data (tabela universal). */
const TRADING_SOURCE_TYPES = ['trading_signal', 'trading_order', 'trading_postmortem', 'trading_demo'] as const;

async function detectTradingDatasetDuplicate(params: {
  tenantId: string;
  semhash: string;
  embedding: number[];
}): Promise<{ isDuplicate: boolean; duplicateOfId?: string; similarityScore?: number }> {
  const db = getDatabase();
  const existingData = await db.query.trainingData.findMany({
    where: and(
      eq(schema.trainingData.tenantId, params.tenantId),
      inArray(schema.trainingData.status, ['pending', 'approved', 'used']),
      inArray(schema.trainingData.sourceType, [...TRADING_SOURCE_TYPES]),
      not(isNull(schema.trainingData.embedding))
    ),
  });

  let isDuplicate = false;
  let duplicateOfId: string | undefined;
  let highestSimilarity = 0;

  for (const existing of existingData) {
    if (existing.semhash === params.semhash) {
      isDuplicate = true;
      duplicateOfId = existing.id;
      highestSimilarity = 1.0;
      break;
    }
    if (existing.embedding) {
      const similarity = cosineSimilarity(params.embedding, existing.embedding);
      if (similarity > TRADING_DATASET_SIMILARITY_THRESHOLD && similarity > highestSimilarity) {
        isDuplicate = true;
        duplicateOfId = existing.id;
        highestSimilarity = similarity;
      }
    }
  }

  return {
    isDuplicate,
    duplicateOfId,
    similarityScore: highestSimilarity > 0 ? highestSimilarity : undefined,
  };
}

function computeTradingDatasetQualityScore(params: {
  confidence?: number | null;
  prompt: string;
  response: string;
}): number {
  const promptLength = params.prompt.trim().length;
  const responseLength = params.response.trim().length;
  if (promptLength < 80 || responseLength < 80) return 0.3;
  const lengthScore = Math.min(1, (promptLength + responseLength) / 1200);
  const confidenceScore = params.confidence ?? 0.6;
  return Math.min(1, 0.4 + lengthScore * 0.4 + confidenceScore * 0.2);
}

async function buildTradingDatasetSeedFromSignal(params: {
  authContext: { tenantId: string; userId: string };
  signal: schema.TradingSignal;
}): Promise<{
  marketContext: schema.TradingDataset['marketContext'];
  prompt: string;
  responsePayload: Record<string, unknown>;
  interval: TradingIntervalValue;
  analysis: technicalIndicators.TechnicalAnalysisResult | undefined;
}> {
  const metadata = (params.signal.metadata ?? {}) as Record<string, unknown>;
  const analysisMatrixRaw = Array.isArray(metadata.analysisMatrix) ? metadata.analysisMatrix : [];
  const matrix = analysisMatrixRaw
    .map((entry) => ({
      interval: TRADING_INTERVAL_ZOD.safeParse((entry as { interval?: string }).interval).success
        ? TRADING_INTERVAL_ZOD.parse((entry as { interval?: string }).interval)
        : '5m',
      analysis: (entry as { analysis?: technicalIndicators.TechnicalAnalysisResult }).analysis,
    }))
    .filter((entry): entry is { interval: TradingIntervalValue; analysis: technicalIndicators.TechnicalAnalysisResult } =>
      Boolean(entry.analysis)
    );

  const analysis = matrix[0]?.analysis;
  const interval = matrix[0]?.interval ?? '5m';

  const marketContext = await buildMarketContextFromSignal({
    auth: params.authContext,
    symbol: params.signal.symbol,
    interval,
    marketType: params.signal.marketType as TradingMarketType,
    marginMode: undefined,
    analysis,
  });

  const techniques = Array.isArray(metadata.techniques)
    ? (metadata.techniques as TradingTechnique[])
    : [];
  const techniqueScores = Array.isArray(metadata.techniqueScores)
    ? (metadata.techniqueScores as TradingTechniqueScore[])
    : [];
  const ensembleResult = (metadata.ensembleResult as TradingEnsembleResult | undefined) ?? {
    overallSignal: 'neutral',
    confidence: 0,
    topTechniques: [],
  };

  const prompt = matrix.length > 0
    ? buildMultiTimeframePrompt({
      matrix: matrix.map((entry) => ({
        interval: entry.interval,
        analysis: entry.analysis,
        indicatorId: '',
      })),
      consensus: buildMajorityConsensus(matrix.map((entry) => ({
        interval: entry.interval,
        analysis: entry.analysis,
        indicatorId: '',
      }))),
      indicators: Array.isArray(metadata.enabledIndicators) ? (metadata.enabledIndicators as TradingIndicatorKey[]) : [],
      dataSources: (metadata.dataSources as TradingProfileDataSources) ?? { orderBook: false, news: false, trainingData: false },
      orderBook: null,
      news: null,
      trainingData: null,
      techniques,
      techniqueScores,
      ensembleResult,
      arbitrageSnapshot: null,
      arbitrageSnapshots: [],
    })
    : (params.signal.metadata as TradingSignalMetadata)?.reasoning ?? 'Sinal gerado sem contexto detalhado.';

  const responsePayload = {
    actionType: params.signal.signalType,
    suggestedPrice: params.signal.suggestedPrice,
    suggestedStopLoss: params.signal.suggestedStopLoss,
    suggestedTakeProfit: params.signal.suggestedTakeProfit,
    suggestedSize: params.signal.suggestedSize,
    confidence: params.signal.confidence,
    reasoning: (params.signal.metadata as TradingSignalMetadata)?.reasoning ?? null,
  };

  return { marketContext, prompt, responsePayload, interval, analysis };
}

type TradingSignalDatasetCreationResult = {
  dataset: schema.TrainingData;
  created: boolean;
  status: schema.TrainingData['status'];
  qualityScore: number;
  duplicate: {
    isDuplicate: boolean;
    duplicateOfId?: string;
    similarityScore?: number;
  };
};

async function createTradingDatasetFromSignalSource(params: {
  authContext: { tenantId: string; userId: string };
  signal: schema.TradingSignal;
  reviewNotes?: string;
  namespaceId?: string;
}): Promise<TradingSignalDatasetCreationResult> {
  const db = getDatabase();

  const existing = await db.query.trainingData.findFirst({
    where: and(
      eq(schema.trainingData.tenantId, params.authContext.tenantId),
      eq(schema.trainingData.sourceType, 'trading_signal'),
      eq(schema.trainingData.sourceId, params.signal.id)
    ),
  });

  if (existing) {
    return {
      dataset: existing,
      created: false,
      status: existing.status,
      qualityScore: existing.qualityScore ?? 0,
      duplicate: {
        isDuplicate: existing.isDuplicate ?? false,
        duplicateOfId: existing.duplicateOfId ?? undefined,
        similarityScore: existing.similarityScore ?? undefined,
      },
    };
  }

  const namespaceId = params.namespaceId ?? await resolveTradingNamespaceId(params.authContext.tenantId);
  if (!namespaceId) {
    throw new Error('Namespace de destino não encontrado para o tenant');
  }

  const seed = await buildTradingDatasetSeedFromSignal({
    authContext: params.authContext,
    signal: params.signal,
  });

  const responsePayload = seed.responsePayload;
  const prompt = seed.prompt;
  const responseText = JSON.stringify(responsePayload);
  const semhash = computeSemHash(`${prompt}\n${responseText}`);
  const embedding = await generateTradingDatasetEmbedding(`${prompt}\n${responseText}`);
  const duplicateResult = await detectTradingDatasetDuplicate({
    tenantId: params.authContext.tenantId,
    semhash,
    embedding,
  });
  const qualityScore = computeTradingDatasetQualityScore({
    confidence: params.signal.confidence ?? undefined,
    prompt,
    response: responseText,
  });
  const autoRejectedByQuality = qualityScore < TRADING_DATASET_MIN_QUALITY;
  const status: 'pending' | 'rejected' = duplicateResult.isDuplicate || autoRejectedByQuality ? 'rejected' : 'pending';
  const reviewNotes = autoRejectedByQuality
    ? `Auto-rejeitado: qualidade ${qualityScore.toFixed(2)} abaixo do mínimo (${TRADING_DATASET_MIN_QUALITY}).`
    : params.reviewNotes ?? null;
  const signalMetadata = (params.signal.metadata ?? {}) as TradingSignalMetadata;
  const metadataNamespaceId = z.string().uuid().safeParse(signalMetadata.namespaceId).success
    ? signalMetadata.namespaceId
    : null;
  const metadataAgentId = z.string().uuid().safeParse(signalMetadata.agentId).success
    ? signalMetadata.agentId
    : null;

  const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
    { role: 'user', content: prompt },
    { role: 'assistant', content: responseText },
  ];

  const [created] = await db.insert(schema.trainingData).values({
    tenantId: params.authContext.tenantId,
    namespaceId,
    source: 'trading',
    sourceType: 'trading_signal',
    sourceId: params.signal.id,
    sourceMetadata: {
      interval: seed.interval,
      marketType: params.signal.marketType,
      namespaceId: metadataNamespaceId,
      agentId: metadataAgentId,
      actionType: params.signal.signalType,
      marketContext: seed.marketContext,
      signalId: params.signal.id,
      orderId: params.signal.executedOrderId ?? null,
    } as Record<string, unknown>,
    messages,
    qualityScore,
    status,
    reviewNotes,
    semhash,
    embedding,
    isDuplicate: duplicateResult.isDuplicate,
    duplicateOfId: duplicateResult.duplicateOfId ?? null,
    similarityScore: duplicateResult.similarityScore ?? null,
  }).returning();

  if (created) {
    await db
      .update(schema.tradingSignals)
      .set({ sentToTrainingAt: new Date() })
      .where(eq(schema.tradingSignals.id, params.signal.id));
  }

  const sourceTypeMetric = 'signal';
  tradingDatasetMetrics.createdTotal.labels(sourceTypeMetric, status).inc();
  tradingDatasetMetrics.qualityScore.observe(qualityScore);
  if (duplicateResult.isDuplicate) {
    tradingDatasetMetrics.duplicatesTotal.labels(sourceTypeMetric).inc();
    tradingDatasetMetrics.rejectedTotal.labels('duplicate', sourceTypeMetric).inc();
  }
  if (autoRejectedByQuality) {
    tradingDatasetMetrics.rejectedTotal.labels('quality', sourceTypeMetric).inc();
  }

  return {
    dataset: created,
    created: true,
    status,
    qualityScore,
    duplicate: {
      isDuplicate: duplicateResult.isDuplicate,
      duplicateOfId: duplicateResult.duplicateOfId ?? undefined,
      similarityScore: duplicateResult.similarityScore ?? undefined,
    },
  };
}

function resolveActionTypeFromOrder(order: schema.TradingOrder, signal?: schema.TradingSignal) {
  if (signal?.signalType) return signal.signalType;
  if ((order.metadata as TradingOrderMetadata | undefined)?.closePosition) {
    return 'exit';
  }
  return order.side === 'buy' ? 'entry_long' : 'entry_short';
}

function buildOrderExecutionPrompt(params: {
  marketContext: schema.TradingDataset['marketContext'];
  order: schema.TradingOrder;
  signal?: schema.TradingSignal;
}): string {
  const price = params.order.avgFilledPrice ?? params.order.price ?? params.marketContext.price;
  const base = [
    'Contexto de mercado:',
    `- Symbol: ${params.marketContext.symbol}`,
    `- Preço: ${params.marketContext.price}`,
    `- Variação 24h: ${params.marketContext.change24h.toFixed(2)}%`,
    `- Funding: ${params.marketContext.fundingRate}`,
    `- Open Interest: ${params.marketContext.openInterest}`,
    '',
    'Ordem executada:',
    `- Lado: ${params.order.side}`,
    `- Tipo: ${params.order.orderType}`,
    `- Tamanho: ${params.order.size}`,
    `- Preço médio: ${price}`,
    `- Alavancagem: ${params.order.leverage ?? 1}x`,
  ];

  if (params.signal?.confidence !== undefined) {
    base.push(`- Confiança do sinal: ${params.signal.confidence}`);
  }

  return `${base.join('\n')}\n\nExplique a decisão e o racional do trade executado.`;
}

async function createTradingDatasetFromOrder(params: {
  authContext: { tenantId: string; userId: string };
  order: schema.TradingOrder;
}): Promise<{ created?: schema.TrainingData; skipped?: string }> {
  const db = getDatabase();

  const existing = await db.query.trainingData.findFirst({
    where: and(
      eq(schema.trainingData.tenantId, params.authContext.tenantId),
      eq(schema.trainingData.sourceType, 'trading_order'),
      eq(schema.trainingData.sourceId, params.order.id)
    ),
  });
  if (existing) {
    return { skipped: 'training data já existe para a ordem' };
  }

  const namespaceId = await resolveTradingNamespaceId(params.authContext.tenantId);
  if (!namespaceId) {
    throw new Error('Namespace Trading não encontrado para o tenant');
  }

  const signalId = params.order.signalId ?? (params.order.metadata as TradingOrderMetadata | undefined)?.signalId;
  const signal = signalId
    ? await db.query.tradingSignals.findFirst({
      where: and(
        eq(schema.tradingSignals.id, signalId),
        eq(schema.tradingSignals.tenantId, params.authContext.tenantId)
      ),
    })
    : null;

  const marketContext = await buildMarketContextFromSignal({
    auth: params.authContext,
    symbol: params.order.symbol,
    interval: '5m',
    marketType: params.order.marketType as TradingMarketType,
    marginMode: undefined,
    analysis: undefined,
  });

  const prompt = buildOrderExecutionPrompt({ marketContext, order: params.order, signal: signal ?? undefined });
  const actionType = resolveActionTypeFromOrder(params.order, signal ?? undefined);
  const responsePayload = {
    actionType,
    executedPrice: params.order.avgFilledPrice ?? params.order.price ?? null,
    executedSize: params.order.filledSize ?? params.order.size,
    leverage: params.order.leverage ?? null,
    stopLoss: (params.order.metadata as TradingOrderMetadata | undefined)?.stopLoss ?? null,
    takeProfit: (params.order.metadata as TradingOrderMetadata | undefined)?.takeProfit ?? null,
    signalId: signal?.id ?? null,
  };

  const responseText = JSON.stringify(responsePayload);
  const semhash = computeSemHash(`${prompt}\n${responseText}`);
  const embedding = await generateTradingDatasetEmbedding(`${prompt}\n${responseText}`);
  const duplicateResult = await detectTradingDatasetDuplicate({
    tenantId: params.authContext.tenantId,
    semhash,
    embedding,
  });
  const qualityScore = computeTradingDatasetQualityScore({
    confidence: signal?.confidence ?? undefined,
    prompt,
    response: responseText,
  });
  const autoRejectedByQuality = qualityScore < TRADING_DATASET_MIN_QUALITY;
  const status = duplicateResult.isDuplicate || autoRejectedByQuality ? 'rejected' : 'pending';
  const reviewNotes = autoRejectedByQuality
    ? `Auto-rejeitado: qualidade ${qualityScore.toFixed(2)} abaixo do mínimo (${TRADING_DATASET_MIN_QUALITY}).`
    : null;

  const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
    { role: 'user', content: prompt },
    { role: 'assistant', content: responseText },
  ];

  const [created] = await db.insert(schema.trainingData).values({
    tenantId: params.authContext.tenantId,
    namespaceId,
    source: 'trading',
    sourceType: 'trading_order',
    sourceId: params.order.id,
    sourceMetadata: {
      orderId: params.order.id,
      signalId: signal?.id ?? null,
      actionType,
      marketContext,
    } as Record<string, unknown>,
    messages,
    qualityScore,
    status,
    reviewNotes,
    semhash,
    embedding,
    isDuplicate: duplicateResult.isDuplicate,
    duplicateOfId: duplicateResult.duplicateOfId ?? null,
    similarityScore: duplicateResult.similarityScore ?? null,
  }).returning();

  const sourceTypeMetric = 'order';
  tradingDatasetMetrics.createdTotal.labels(sourceTypeMetric, status).inc();
  tradingDatasetMetrics.qualityScore.observe(qualityScore);
  if (duplicateResult.isDuplicate) {
    tradingDatasetMetrics.duplicatesTotal.labels(sourceTypeMetric).inc();
    tradingDatasetMetrics.rejectedTotal.labels('duplicate', sourceTypeMetric).inc();
  }
  if (autoRejectedByQuality) {
    tradingDatasetMetrics.rejectedTotal.labels('quality', sourceTypeMetric).inc();
  }

  return { created };
}

const TRADING_LLM_MAX_CONTEXT_TOKENS = 6144;
const TRADING_LLM_MIN_COMPLETION_TOKENS = 128;
const TRADING_LLM_PROMPT_SAFETY_TOKENS = 128;
const TRADING_LLM_MESSAGE_OVERHEAD_TOKENS = 8;
const TRADING_LLM_TOKEN_HEADROOM_TOKENS = 256;
const TRADING_LLM_CHARS_PER_TOKEN = 2.2;
// Teto enterprise para tokens de completion em sinais de trading.
// O schema JSON do sinal tem ~15 campos obrigatórios + citedValues = ~200-500 tokens reais.
// 768 tokens dá margem generosa sem causar timeouts desnecessários
// (768 tokens a ~30 tok/s com awq_marlin = ~25s vs 2048 tokens a ~6 tok/s com awq = ~340s).
const TRADING_LLM_MAX_SIGNAL_COMPLETION_TOKENS = 768;
const TRADING_LLM_PROMPT_ESTIMATE_MULTIPLIER = 1.25;
const TRADING_LLM_TOKEN_REGEX_SAFETY_MULTIPLIER = 1.15;
const TRADING_LLM_TOKEN_REGEX_PATTERN = /[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu;
const TRADING_LLM_MAX_ANALYSIS_BLOCK_CHARS = 1200;
const TRADING_LLM_MAX_NEWS_ITEMS = 3;
const TRADING_LLM_MAX_TRAINING_SAMPLES = 3;
const TRADING_LLM_MAX_SOURCE_LINE_CHARS = 180;
const TRADING_LLM_MAX_NEWS_BLOCK_CHARS = 900;
const TRADING_LLM_MAX_NEWS_QUERY_CHARS = 200;

function estimateTokensFromText(value: string): number {
  if (!value) return 0;
  const normalized = value.trim();
  if (!normalized) return 0;
  const lengthEstimate = Math.ceil(normalized.length / TRADING_LLM_CHARS_PER_TOKEN);
  const regexMatches = normalized.match(TRADING_LLM_TOKEN_REGEX_PATTERN);
  const regexEstimate = regexMatches
    ? Math.ceil(regexMatches.length * TRADING_LLM_TOKEN_REGEX_SAFETY_MULTIPLIER)
    : 0;
  return Math.max(lengthEstimate, regexEstimate);
}

function buildMultiTimeframePrompt(params: {
  matrix: AnalysisMatrixEntry[];
  consensus: ReturnType<typeof buildMajorityConsensus>;
  indicators: TradingIndicatorKey[];
  dataSources: TradingProfileDataSources;
  orderBook: Awaited<ReturnType<typeof getOrderBookSnapshot>> | null;
  news: Awaited<ReturnType<typeof fetchNewsSummary>> | null;
  trainingData: Awaited<ReturnType<typeof fetchTradingDatasetSummary>> | null;
  techniques: TradingTechnique[];
  techniqueScores: TradingTechniqueScore[];
  ensembleResult: TradingEnsembleResult;
  arbitrageSnapshot: TriangularArbitrageResult | null;
  arbitrageSnapshots?: TriangularArbitrageResult[];
}): string {
  const blocks = params.matrix.map((entry) => {
    const analysisBlock = truncateText(
      technicalIndicators.formatAnalysisForLLM(entry.analysis),
      TRADING_LLM_MAX_ANALYSIS_BLOCK_CHARS
    );
    return `### TIMEFRAME ${entry.interval}\n${analysisBlock}`;
  });

  const sources: string[] = [];
  if (params.orderBook) {
    sources.push(`Order Book:
- Best Bid: ${params.orderBook.bestBid ?? 'N/A'}
- Best Ask: ${params.orderBook.bestAsk ?? 'N/A'}
- Spread: ${params.orderBook.spreadAbs ?? 'N/A'} (${params.orderBook.spreadPct ?? 'N/A'}%)`);
  }
  if (params.news) {
    const newsLines = params.news.results
      .slice(0, TRADING_LLM_MAX_NEWS_ITEMS)
      .map((item) => `- ${truncateText(item.title, TRADING_LLM_MAX_SOURCE_LINE_CHARS)} (${item.url})`)
      .join('\n');
    const newsBlock = `Notícias (SearXNG):
Consulta: ${params.news.query}
${newsLines || '- Nenhum resultado relevante'}`;
    sources.push(truncateText(newsBlock, TRADING_LLM_MAX_NEWS_BLOCK_CHARS));
  }
  if (params.trainingData) {
    const samples = params.trainingData.samples
      .slice(0, TRADING_LLM_MAX_TRAINING_SAMPLES)
      .map((sample) => {
        const prompt = truncateText(sample.prompt, TRADING_LLM_MAX_SOURCE_LINE_CHARS);
        const response = truncateText(sample.response, TRADING_LLM_MAX_SOURCE_LINE_CHARS);
        return `- ${sample.actionType}: ${prompt} → ${response}`;
      })
      .join('\n');
    sources.push(`Dataset aprovado:
Total: ${params.trainingData.totalApproved}
Exemplos:
${samples || '- Nenhum exemplo disponível'}`);
  }

  const techniqueLines = params.techniqueScores
    .sort((a, b) => b.confidence - a.confidence)
    .map((score) => `- ${score.technique}: ${score.signal} (conf ${score.confidence.toFixed(2)})${score.rationale ? ` - ${score.rationale}` : ''}`)
    .join('\n');

  const arbitrageList = params.arbitrageSnapshots?.length
    ? params.arbitrageSnapshots
    : (params.arbitrageSnapshot ? [params.arbitrageSnapshot] : []);
  const arbitrageBlock = arbitrageList.length > 0
    ? `### ARBITRAGEM TRIANGULAR (Top 3)
${arbitrageList.map((snapshot, index) => {
  const feesApplied = snapshot.networkFeesApplied?.length
    ? `\nNetwork fees aplicadas: ${snapshot.networkFeesApplied.map((fee) => `${fee.asset} ${fee.amount} (${fee.fromExchange}→${fee.toExchange})`).join(', ')}`
    : '';
  return `#${index + 1} Intermediário: ${snapshot.intermediateAsset}
Edge estimada: ${snapshot.edgePct.toFixed(2)}%
Rotas:
${snapshot.legs.map((leg) => `- ${leg.from} -> ${leg.to} via ${leg.symbol} (${leg.side}, rate ${leg.rate.toFixed(8)}, exchange ${leg.exchange})`).join('\n')}${feesApplied}`;
}).join('\n\n')}`
    : '';

  return `
## CONTEXTO MULTI-TIMEFRAME
Indicadores habilitados: ${params.indicators.join(', ')}
Técnicas selecionadas: ${params.techniques.join(', ')}
Ensemble: ${params.ensembleResult.overallSignal.toUpperCase()} (conf ${params.ensembleResult.confidence.toFixed(2)})
Timeframes disponíveis: ${params.matrix.map((entry) => entry.interval).join(', ')}

Ranking técnico (determinístico):
${techniqueLines || '- Nenhuma técnica disponível'}

Consenso (maioria simples):
- Sinal: ${params.consensus.overallSignal.toUpperCase()}
- Acordo: ${(params.consensus.agreementRatio * 100).toFixed(0)}%
- Timeframes alinhados: ${params.consensus.alignedTimeframes.join(', ') || 'Nenhum'}
- Timeframes divergentes: ${params.consensus.misalignedTimeframes.join(', ') || 'Nenhum'}

${blocks.join('\n\n')}

${sources.length > 0 ? `### FONTES EXTRAS\n${sources.join('\n\n')}` : ''}
${arbitrageBlock}
`.trim();
}

async function getOrCreateTradingProfile(tenantId: string, kind: TradingProfileKind): Promise<schema.TradingAnalysisProfile> {
  const db = getDatabase();
  const existing = await db.query.tradingAnalysisProfiles.findFirst({
    where: and(
      eq(schema.tradingAnalysisProfiles.tenantId, tenantId),
      eq(schema.tradingAnalysisProfiles.kind, kind)
    ),
  });
  if (existing) return existing;

  const [created] = await db
    .insert(schema.tradingAnalysisProfiles)
    .values({ tenantId, kind })
    .returning();
  if (!created) {
    throw new Error('Falha ao criar perfil de análise/sinal');
  }
  return created;
}

const TRADING_LLM_CITED_VALUES_SCHEMA = z.object({
  rsi: z.number().optional(),
  macdLine: z.number().optional(),
  macdSignal: z.number().optional(),
  macdHistogram: z.number().optional(),
  ema9: z.number().optional(),
  ema21: z.number().optional(),
  ema50: z.number().optional(),
  ema200: z.number().optional(),
  sma20: z.number().optional(),
  sma50: z.number().optional(),
  sma200: z.number().optional(),
  bollingerUpper: z.number().optional(),
  bollingerMiddle: z.number().optional(),
  bollingerLower: z.number().optional(),
  bollingerPercentB: z.number().optional(),
  atrValue: z.number().optional(),
  atrPercentage: z.number().optional(),
  stochasticK: z.number().optional(),
  stochasticD: z.number().optional(),
  adxValue: z.number().optional(),
  pivotPoint: z.number().optional(),
  resistance1: z.number().optional(),
  resistance2: z.number().optional(),
  resistance3: z.number().optional(),
  support1: z.number().optional(),
  support2: z.number().optional(),
  support3: z.number().optional(),
  volumeRatio: z.number().optional(),
  currentPrice: z.number().optional(),
}).partial().default({});

const TRADING_LLM_SIGNAL_SCHEMA = z.object({
  signalType: z.enum(['entry_long', 'entry_short', 'exit', 'adjust_sl', 'adjust_tp', 'hold', 'neutral']),
  operationType: TradingOperationTypeSchema,
  // CORREÇÃO: min(0) permite 0 para sinais neutros/hold (LLM retorna 0 quando não há duração estimada)
  expectedDurationMinutes: z.number().int().min(0).max(43200),
  confidence: z.number().min(0).max(1),
  // CORREÇÃO: min(1) ao invés de min(20) — sinais neutros podem ter resumo curto; fallback gera default
  tradeSummary: z.string().min(1),
  motivators: z.array(z.string().min(2)).min(1),
  invalidationReasons: z.array(z.string().min(2)).min(1),
  reasoning: z.string().min(10),
  timeframeUsed: TRADING_INTERVAL_ZOD.optional(),
  citedValues: TRADING_LLM_CITED_VALUES_SCHEMA,
  suggestedPrice: z.number().positive().optional(),
  suggestedStopLoss: z.number().positive().optional(),
  suggestedTakeProfit: z.number().positive().optional(),
  suggestedSize: z.number().positive().optional(),
  riskReward: z.number().positive().optional(),
  marketCondition: z.string().min(3).optional(),
  riskScore: z.number().min(0).max(100).optional(),
});

// CORREÇÃO CR1 (07/02/2026): Schema JSON com propriedades explícitas para citedValues.
// Schema JSON para constrained decoding via vLLM 0.12.0 structured_outputs.
// Backend: outlines (configurado via --guided-decoding-backend outlines no entrypoint.sh).
// outlines suporta schemas complexos com múltiplas propriedades opcionais sem
// problemas de compilação (diferente do xgrammar que falha com 2^N combinações).
// strict:true REMOVIDO - campo OpenAI-only, vLLM ignora silenciosamente.
// Ref: https://docs.vllm.ai/en/v0.12.0/features/structured_outputs/
const TRADING_LLM_SIGNAL_JSON_SCHEMA = {
  name: 'trading_llm_signal',
  schema: {
    type: 'object' as const,
    additionalProperties: false,
    required: [
      'signalType',
      'operationType',
      'expectedDurationMinutes',
      'confidence',
      'tradeSummary',
      'motivators',
      'invalidationReasons',
      'reasoning',
      'citedValues',
    ],
    properties: {
      signalType: {
        type: 'string' as const,
        enum: ['entry_long', 'entry_short', 'exit', 'adjust_sl', 'adjust_tp', 'hold', 'neutral'],
      },
      operationType: {
        type: 'string' as const,
        enum: ['scalping', 'swing', 'position', 'cash_and_carry', 'arbitrage', 'hedge', 'neutral'],
      },
      expectedDurationMinutes: { type: 'integer' as const },
      confidence: { type: 'number' as const },
      tradeSummary: { type: 'string' as const },
      motivators: { type: 'array' as const, items: { type: 'string' as const } },
      invalidationReasons: { type: 'array' as const, items: { type: 'string' as const } },
      reasoning: { type: 'string' as const },
      timeframeUsed: { type: 'string' as const },
      citedValues: {
        type: 'object' as const,
        additionalProperties: false,
        // Com backend outlines (--guided-decoding-backend outlines), additionalProperties:false
        // funciona corretamente mesmo com 29 propriedades opcionais. Validação via Zod pós-parse.
        properties: {
          rsi: { type: 'number' as const },
          macdLine: { type: 'number' as const },
          macdSignal: { type: 'number' as const },
          macdHistogram: { type: 'number' as const },
          ema9: { type: 'number' as const },
          ema21: { type: 'number' as const },
          ema50: { type: 'number' as const },
          ema200: { type: 'number' as const },
          sma20: { type: 'number' as const },
          sma50: { type: 'number' as const },
          sma200: { type: 'number' as const },
          bollingerUpper: { type: 'number' as const },
          bollingerMiddle: { type: 'number' as const },
          bollingerLower: { type: 'number' as const },
          bollingerPercentB: { type: 'number' as const },
          atrValue: { type: 'number' as const },
          atrPercentage: { type: 'number' as const },
          stochasticK: { type: 'number' as const },
          stochasticD: { type: 'number' as const },
          adxValue: { type: 'number' as const },
          pivotPoint: { type: 'number' as const },
          resistance1: { type: 'number' as const },
          resistance2: { type: 'number' as const },
          resistance3: { type: 'number' as const },
          support1: { type: 'number' as const },
          support2: { type: 'number' as const },
          support3: { type: 'number' as const },
          volumeRatio: { type: 'number' as const },
          currentPrice: { type: 'number' as const },
        },
      },
      suggestedPrice: { type: 'number' as const },
      suggestedStopLoss: { type: 'number' as const },
      suggestedTakeProfit: { type: 'number' as const },
      suggestedSize: { type: 'number' as const },
      riskReward: { type: 'number' as const },
      marketCondition: { type: 'string' as const },
      riskScore: { type: 'number' as const },
    },
  },
};

const TRADING_LLM_SIGNAL_PARTIAL_SCHEMA = z.object({
  signalType: z.enum(['entry_long', 'entry_short', 'exit', 'adjust_sl', 'adjust_tp', 'hold', 'neutral']).optional(),
  operationType: TradingOperationTypeSchema.optional(),
  // CORREÇÃO: min(0) permite 0 para sinais neutros/hold (LLM retorna 0 quando não há duração estimada)
  expectedDurationMinutes: z.number().int().min(0).max(43200).optional(),
  confidence: z.number().min(0).max(1).optional(),
  // CORREÇÃO: Aceita qualquer string (LLM pode retornar tradeSummary vazio para sinais neutros)
  tradeSummary: z.string().optional(),
  motivators: z.array(z.string().min(2)).optional(),
  invalidationReasons: z.array(z.string().min(2)).optional(),
  reasoning: z.string().min(5).optional(),
  timeframeUsed: TRADING_INTERVAL_ZOD.optional(),
  citedValues: TRADING_LLM_CITED_VALUES_SCHEMA,
  suggestedPrice: z.number().positive().nullable().optional(),
  suggestedStopLoss: z.number().positive().nullable().optional(),
  suggestedTakeProfit: z.number().positive().nullable().optional(),
  suggestedSize: z.number().positive().nullable().optional(),
  riskReward: z.number().positive().nullable().optional(),
  marketCondition: z.string().min(3).optional(),
  riskScore: z.number().min(0).max(100).nullable().optional(),
});

type TradingLlmSignal = z.infer<typeof TRADING_LLM_SIGNAL_SCHEMA>;
type TradingLlmSignalPartial = z.infer<typeof TRADING_LLM_SIGNAL_PARTIAL_SCHEMA>;

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

function classifyIntegrationError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes('timeout')) return 'timeout';
    if (message.includes('breaker')) return 'breaker_open';
    if (message.includes('429')) return 'rate_limit';
    if (message.includes('unauthorized') || message.includes('forbidden')) return 'auth';
    if (message.includes('not found')) return 'not_found';
    if (message.includes('http')) return 'http_error';
  }
  return 'error';
}

function updateIntegrationMetrics(integration: string, configured: boolean, operational: boolean): void {
  integrationsConfiguredGauge.set({ integration }, configured ? 1 : 0);
  integrationsOperationalGauge.set({ integration }, operational ? 1 : 0);
}

async function observeIntegrationCall<T>(params: {
  integration: string;
  operation: string;
  fn: () => Promise<T>;
}): Promise<T> {
  const start = process.hrtime.bigint();
  try {
    const result = await params.fn();
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    metrics.integrations.callDuration.observe(
      { integration: params.integration, operation: params.operation },
      durationSeconds
    );
    metrics.integrations.callsTotal.inc(
      { integration: params.integration, operation: params.operation, status: 'success' },
      1
    );
    return result;
  } catch (error) {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    metrics.integrations.callDuration.observe(
      { integration: params.integration, operation: params.operation },
      durationSeconds
    );
    metrics.integrations.callsTotal.inc(
      { integration: params.integration, operation: params.operation, status: 'error' },
      1
    );
    metrics.integrations.errorsTotal.inc(
      { integration: params.integration, operation: params.operation, error_type: classifyIntegrationError(error) },
      1
    );
    throw error;
  }
}

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

const TRADING_METRICS_INTERVAL_MS = Number(process.env.TRADING_METRICS_INTERVAL_MS ?? 60000);
const TRADING_PNL_WINDOW_HOURS = Number(process.env.TRADING_PNL_WINDOW_HOURS ?? 24);

function resolveTradingMetricsInterval(): number {
  if (!Number.isFinite(TRADING_METRICS_INTERVAL_MS) || TRADING_METRICS_INTERVAL_MS < 10000) {
    logger.warn({ TRADING_METRICS_INTERVAL_MS }, 'TRADING_METRICS_INTERVAL_MS inválido, usando 60000ms');
    return 60000;
  }
  return TRADING_METRICS_INTERVAL_MS;
}

function resolveTradingPnlWindowHours(): number {
  if (!Number.isFinite(TRADING_PNL_WINDOW_HOURS) || TRADING_PNL_WINDOW_HOURS <= 0) {
    logger.warn({ TRADING_PNL_WINDOW_HOURS }, 'TRADING_PNL_WINDOW_HOURS inválido, usando 24h');
    return 24;
  }
  return TRADING_PNL_WINDOW_HOURS;
}

let tradingMetricsInterval: NodeJS.Timeout | null = null;

async function refreshTradingMetrics(): Promise<void> {
  try {
    const db = getDatabase();
    const pnlWindowHours = resolveTradingPnlWindowHours();
    const since = new Date(Date.now() - pnlWindowHours * 60 * 60 * 1000);

    const [realizedPnl] = await db
      .select({ value: sql<number>`COALESCE(SUM(${schema.tradingPositions.realizedPnl}), 0)` })
      .from(schema.tradingPositions)
      .where(
        and(
          not(isNull(schema.tradingPositions.closedAt)),
          sql`${schema.tradingPositions.closedAt} >= ${since}`
        )
      );

    const [unrealizedPnl] = await db
      .select({ value: sql<number>`COALESCE(SUM(${schema.tradingPositions.unrealizedPnl}), 0)` })
      .from(schema.tradingPositions)
      .where(eq(schema.tradingPositions.status, 'open'));

    const [ordersActive] = await db
      .select({ value: sql<number>`count(*)` })
      .from(schema.tradingOrders)
      .where(inArray(schema.tradingOrders.status, ['pending', 'submitted', 'open']));

    tradingPnlRealizedUsd.set(Number(realizedPnl?.value ?? 0));
    tradingPnlUnrealizedUsd.set(Number(unrealizedPnl?.value ?? 0));
    tradingOrdersActive.set(Number(ordersActive?.value ?? 0));

    const symbols = await kucoinClient.getAllowedSymbols();
    for (const symbol of symbols) {
      const latest = await db.query.tradingTechnicalIndicators.findFirst({
        where: eq(schema.tradingTechnicalIndicators.symbol, symbol),
        orderBy: [desc(schema.tradingTechnicalIndicators.calculatedAt)],
      });

      if (!latest) {
        continue;
      }

      if (Number.isFinite(latest.rsiValue ?? NaN)) {
        tradingRsiGauge.set({ symbol }, Number(latest.rsiValue));
      }
      if (Number.isFinite(latest.bollingerUpper ?? NaN)) {
        tradingBollingerUpper.set({ symbol }, Number(latest.bollingerUpper));
      }
      if (Number.isFinite(latest.bollingerMiddle ?? NaN)) {
        tradingBollingerMiddle.set({ symbol }, Number(latest.bollingerMiddle));
      }
      if (Number.isFinite(latest.bollingerLower ?? NaN)) {
        tradingBollingerLower.set({ symbol }, Number(latest.bollingerLower));
      }
      if (Number.isFinite(latest.currentPrice ?? NaN)) {
        tradingPriceUsd.set({ symbol }, Number(latest.currentPrice));
      }
    }
  } catch (error) {
    logger.error({ error }, 'Falha ao atualizar métricas de trading');
  }
}

function startTradingMetricsScheduler(): void {
  void refreshTradingMetrics();
  const intervalMs = resolveTradingMetricsInterval();
  tradingMetricsInterval = setInterval(() => {
    void refreshTradingMetrics();
  }, intervalMs);
  logger.info({ intervalMs }, 'Scheduler de métricas de trading iniciado');
}

// ============================================================================
// SCHEDULER SINAIS LLM (runtime)
// ============================================================================
const SIGNAL_SCHEDULER_POLL_INTERVAL_MS = 30000;
let signalSchedulerInterval: NodeJS.Timeout | null = null;

async function runDueSignalSchedulers(): Promise<void> {
  const db = getDatabase();
  const now = new Date();

  const schedulers = await db
    .select()
    .from(schema.tradingSignalSchedulers)
    .where(
      and(
        eq(schema.tradingSignalSchedulers.enabled, true),
        lte(schema.tradingSignalSchedulers.nextRunAt, now)
      )
    );

  if (schedulers.length === 0) {
    return;
  }

  for (const scheduler of schedulers) {
    const locked = await db
      .update(schema.tradingSignalSchedulers)
      .set({
        lastRunAt: now,
        nextRunAt: new Date(now.getTime() + (scheduler.intervalMinutes ?? 15) * 60 * 1000),
        atualizadoEm: now,
        lastError: null,
      })
      .where(
        and(
          eq(schema.tradingSignalSchedulers.id, scheduler.id),
          lte(schema.tradingSignalSchedulers.nextRunAt, now)
        )
      )
      .returning();

    if (locked.length === 0) {
      continue;
    }

    const startTime = Date.now();
    try {
      const symbols = normalizeSignalSymbols((scheduler.symbols ?? []) as string[]);
      if (symbols.length === 0) {
        throw new Error('Scheduler sem símbolos configurados.');
      }

      const profileRow = await getOrCreateTradingProfile(scheduler.tenantId, 'signal');
      const profile = normalizeTradingProfile(profileRow);
      const techniques = (scheduler.techniques?.length
        ? scheduler.techniques
        : profile.techniques) as TradingTechnique[];
      const ensembleConfig = (scheduler.ensembleConfig ?? profile.ensembleConfig) as TradingEnsembleConfig;
      const arbitrageConfig = (scheduler.arbitrageConfig ?? profile.arbitrageConfig) as TradingArbitrageConfig | undefined;

      const maxSignals = Math.max(1, scheduler.maxSignalsPerRun ?? 1);
      const selectedSymbols = symbols.slice(0, maxSignals);
      let lastSignalId: string | null = null;
      const schedulerUserId = await resolveSchedulerUserId(scheduler.tenantId);

      for (const symbol of selectedSymbols) {
        const result = await generateTradingSignalFromLlm({
          tenantId: scheduler.tenantId,
          userId: schedulerUserId,
          symbol,
          interval: scheduler.interval || '5m',
          marketType: scheduler.marketType as TradingMarketType,
          marginMode: (scheduler.marginMode ?? undefined) as TradingMarginMode | undefined,
          source: 'scheduler',
          agentId: scheduler.agentId ?? undefined,
          schedulerId: scheduler.id,
          timeframes: profile.timeframes,
          indicators: profile.indicators,
          dataSources: profile.dataSources,
          techniques,
          ensembleConfig,
          arbitrageConfig,
          modelConfig: profile.modelConfig,
          consensus: profile.consensus,
        });
        lastSignalId = result.signal.id;
      }

      const durationMs = Date.now() - startTime;
      await db.update(schema.tradingSignalSchedulers)
        .set({
          lastSuccessAt: new Date(),
          lastDurationMs: durationMs,
          lastSignalId,
          lastError: null,
          atualizadoEm: new Date(),
        })
        .where(eq(schema.tradingSignalSchedulers.id, scheduler.id));
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      await db.update(schema.tradingSignalSchedulers)
        .set({
          lastError: errorMessage,
          lastDurationMs: durationMs,
          atualizadoEm: new Date(),
        })
        .where(eq(schema.tradingSignalSchedulers.id, scheduler.id));
      logger.error({ error: errorMessage, schedulerId: scheduler.id }, 'Falha ao executar scheduler de sinais');
    }
  }
}

function startTradingSignalScheduler(): void {
  void runDueSignalSchedulers().catch((error) => {
    logger.warn({ error }, 'Falha no scheduler de sinais (startup)');
  });
  signalSchedulerInterval = setInterval(() => {
    void runDueSignalSchedulers().catch((error) => {
      logger.warn({ error }, 'Falha no scheduler de sinais');
    });
  }, SIGNAL_SCHEDULER_POLL_INTERVAL_MS);
  logger.info({ intervalMs: SIGNAL_SCHEDULER_POLL_INTERVAL_MS }, 'Scheduler de sinais LLM iniciado');
}

// ============================================================================
// SCHEDULER ANÁLISE DETERMINÍSTICA (CPU)
// ============================================================================
const ANALYSIS_SCHEDULER_POLL_INTERVAL_MS = 30000;
let _analysisSchedulerInterval: NodeJS.Timeout | null = null;

async function runDueAnalysisSchedulers(): Promise<void> {
  const db = getDatabase();
  const now = new Date();

  const schedulers = await db
    .select()
    .from(schema.tradingAnalysisSchedulers)
    .where(
      and(
        eq(schema.tradingAnalysisSchedulers.enabled, true),
        lte(schema.tradingAnalysisSchedulers.nextRunAt, now)
      )
    );

  if (schedulers.length === 0) {
    return;
  }

  for (const scheduler of schedulers) {
    const locked = await db
      .update(schema.tradingAnalysisSchedulers)
      .set({
        lastRunAt: now,
        nextRunAt: new Date(now.getTime() + (scheduler.intervalMinutes ?? 15) * 60 * 1000),
        atualizadoEm: now,
        lastError: null,
      })
      .where(
        and(
          eq(schema.tradingAnalysisSchedulers.id, scheduler.id),
          lte(schema.tradingAnalysisSchedulers.nextRunAt, now)
        )
      )
      .returning();

    if (locked.length === 0) {
      continue;
    }

    const startTime = Date.now();
    try {
      const symbols = normalizeSignalSymbols((scheduler.symbols ?? []) as string[]);
      if (symbols.length === 0) {
        throw new Error('Scheduler de análise sem símbolos configurados.');
      }

      const profileRow = await getOrCreateTradingProfile(scheduler.tenantId, 'analysis');
      const profile = normalizeTradingProfile(profileRow);
      const techniques = (scheduler.techniques?.length
        ? scheduler.techniques
        : profile.techniques) as TradingTechnique[];
      const ensembleConfig = (scheduler.ensembleConfig ?? profile.ensembleConfig) as TradingEnsembleConfig;
      const arbitrageConfig = (scheduler.arbitrageConfig ?? profile.arbitrageConfig) as TradingArbitrageConfig | undefined;
      const timeframes: TradingIntervalValue[] = profile.timeframes?.length
        ? profile.timeframes
        : [TRADING_INTERVAL_ZOD.parse(scheduler.interval ?? '5m')];
      const enabledIndicators = profile.indicators?.length ? profile.indicators : undefined;

      assertArbitrageConfigForTechniques({
        techniques,
        arbitrageConfig,
        timeframes,
        context: 'scheduler de análise',
      });

      const maxSymbols = Math.max(1, scheduler.maxSymbolsPerRun ?? 1);
      const selectedSymbols = symbols.slice(0, maxSymbols);
      let lastIndicatorId: string | null = null;
      const schedulerUserId = await resolveSchedulerUserId(scheduler.tenantId);

      for (const symbol of selectedSymbols) {
        for (const timeframe of timeframes) {
          const result = await calculateAndPersistTechnicalAnalysis({
            tenantId: scheduler.tenantId,
            userId: schedulerUserId,
            symbol,
            interval: timeframe,
            marketType: scheduler.marketType as TradingMarketType,
            marginMode: (scheduler.marginMode ?? undefined) as TradingMarginMode | undefined,
            enabledIndicators,
            techniques,
            ensembleConfig,
          });
          lastIndicatorId = result.indicatorId;
        }
      }

      const durationMs = Date.now() - startTime;
      await db.update(schema.tradingAnalysisSchedulers)
        .set({
          lastSuccessAt: new Date(),
          lastDurationMs: durationMs,
          lastIndicatorId,
          lastError: null,
          atualizadoEm: new Date(),
        })
        .where(eq(schema.tradingAnalysisSchedulers.id, scheduler.id));
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      await db.update(schema.tradingAnalysisSchedulers)
        .set({
          lastError: errorMessage,
          lastDurationMs: durationMs,
          atualizadoEm: new Date(),
        })
        .where(eq(schema.tradingAnalysisSchedulers.id, scheduler.id));
      logger.error({ error: errorMessage, schedulerId: scheduler.id }, 'Falha ao executar scheduler de análise');
    }
  }
}

function startTradingAnalysisScheduler(): void {
  void runDueAnalysisSchedulers().catch((error) => {
    logger.warn({ error }, 'Falha no scheduler de análise (startup)');
  });
  _analysisSchedulerInterval = setInterval(() => {
    void runDueAnalysisSchedulers().catch((error) => {
      logger.warn({ error }, 'Falha no scheduler de análise');
    });
  }, ANALYSIS_SCHEDULER_POLL_INTERVAL_MS);
  logger.info({ intervalMs: ANALYSIS_SCHEDULER_POLL_INTERVAL_MS }, 'Scheduler de análise determinística iniciado');
}

// ============================================================================
// WS5: Métricas operacionais - KuCoin WebSocket
// ============================================================================
// Requisitos:
// - Não usar WS como fonte de verdade de dados de negócio (market data continua via REST)
// - Expor estado para observabilidade (degraded quando WS está down/reconnecting)
// - Sem alta cardinalidade (somente label channel=public|private)
type KucoinWsState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

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
async function resolveKucoinTenantIdForPrivateWs(): Promise<string | null> {
  const db = getDatabase();
  const integrations = await db
    .select()
    .from(schema.integrations)
    .where(
      and(
        eq(schema.integrations.tipo, 'kucoin'),
        eq(schema.integrations.ativo, true)
      )
    );

  if (integrations.length === 0) {
    logger.warn('Nenhuma integração KuCoin ativa encontrada para WS privado');
    return null;
  }

  if (integrations.length === 1) {
    return integrations[0]?.tenantId ?? null;
  }

  const apiKey = process.env.KUCOIN_PRO_API_KEY?.trim();
  if (apiKey) {
    const matched = integrations.find((integration) => integration.credenciais?.apiKey === apiKey);
    if (matched?.tenantId) {
      return matched.tenantId;
    }
  }

  logger.warn(
    { total: integrations.length },
    'Múltiplas integrações KuCoin ativas - tenant para WS privado não resolvido'
  );
  return null;
}

function mapKucoinWsStateToNumber(state: KucoinWsState): number {
  switch (state) {
    case 'disconnected':
      return 0;
    case 'connecting':
      return 0.25;
    case 'reconnecting':
      return 0.5;
    case 'connected':
      return 1;
    default:
      return 0;
  }
}

let kucoinWsMetricsWired = false;

function wireKucoinWebSocketMetrics(opts: {
  publicWs: { getState(): KucoinWsState; on(event: 'stateChange', cb: (s: KucoinWsState) => void): void; on(event: 'error', cb: (e: Error) => void): void };
  privateWs?: { getState(): KucoinWsState; on(event: 'stateChange', cb: (s: KucoinWsState) => void): void; on(event: 'error', cb: (e: Error) => void): void } | null;
  privateEnabled: boolean;
}): void {
  if (kucoinWsMetricsWired) return;
  kucoinWsMetricsWired = true;

  const apply = (channel: 'public' | 'private', state: KucoinWsState) => {
    kucoinWsStateGauge.set({ channel }, mapKucoinWsStateToNumber(state));
    kucoinWsConnectedGauge.set({ channel }, state === 'connected' ? 1 : 0);
    if (state === 'reconnecting') {
      kucoinWsReconnectsTotal.inc({ channel }, 1);
    }
  };

  // Public WS (sempre)
  apply('public', opts.publicWs.getState());
  opts.publicWs.on('stateChange', (s) => apply('public', s));
  opts.publicWs.on('error', () => kucoinWsErrorsTotal.inc({ channel: 'public' }, 1));

  // Private WS (quando credenciais existem)
  if (opts.privateEnabled && opts.privateWs) {
    apply('private', opts.privateWs.getState());
    opts.privateWs.on('stateChange', (s) => apply('private', s));
    opts.privateWs.on('error', () => kucoinWsErrorsTotal.inc({ channel: 'private' }, 1));
  } else {
    // Explicitar estado quando desabilitado (evita "No data")
    kucoinWsStateGauge.set({ channel: 'private' }, 0);
    kucoinWsConnectedGauge.set({ channel: 'private' }, 0);
  }
}

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
  description: 'Serviço de integrações: Stripe, Wise, ERPNext, Twilio, KuCoin Futures.',
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
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();
const isProduction = config.NODE_ENV === 'production';

// Transporter do Nodemailer para Gmail SMTP
// Usando tipo genérico pois nodemailer.Transporter tem tipagem complexa
let emailTransporter: nodemailer.Transporter | null = null;

if (GMAIL_USER && GMAIL_APP_PASSWORD) {
  emailTransporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // TLS (não SSL)
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_APP_PASSWORD,
    },
    // Configurações enterprise para alta disponibilidade
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    rateDelta: 1000,
    rateLimit: 10, // 10 emails por segundo (limite Gmail)
  });

  // Verificar conexão SMTP no startup
  // NOTA: verify() retorna Promise, usamos .then() para não bloquear startup
  emailTransporter.verify()
    .then(() => {
      logger.info({ user: GMAIL_USER }, 'Gmail SMTP conectado com sucesso');
    })
    .catch((error: unknown) => {
      logger.error({ error, user: GMAIL_USER }, 'Falha ao conectar Gmail SMTP');
      if (isProduction) {
        // Em produção, email é crítico para comprovantes
        logger.error('Gmail SMTP é obrigatório em produção (Regra 6 - fail-fast)');
        process.exit(1);
      }
    });
} else {
  if (isProduction) {
    logger.error('GMAIL_USER e GMAIL_APP_PASSWORD são obrigatórios em produção (Regra 6 - fail-fast)');
    process.exit(1);
  }
  logger.warn('Gmail SMTP não configurado - emails desabilitados em desenvolvimento');
}

let stripe: Stripe | null = null;
if (config.STRIPE_SECRET_KEY) {
  stripe = new Stripe(config.STRIPE_SECRET_KEY, {
    apiVersion: STRIPE_API_VERSION,
  });
  logger.info({ apiVersion: STRIPE_API_VERSION }, 'Cliente Stripe inicializado');
}

async function executeStripeCall<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  return observeIntegrationCall({
    integration: 'stripe',
    operation,
    fn,
  });
}

// Circuit Breaker para chamadas ao ERPNext (Best Practices 2025)
// Usa CIRCUIT_BREAKER_PRESETS centralizado (Regra 2 - Não Duplicar)

// RESILIÊNCIA: Timeout para chamadas externas (Best Practices 2025)
const EXTERNAL_API_TIMEOUT_MS = 8000;

const erpNextBreaker = createCircuitBreaker(async (options: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}) => {
  // RESILIÊNCIA: AbortController com timeout para evitar chamadas penduradas
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXTERNAL_API_TIMEOUT_MS);
  
  try {
    const response = await fetch(options.url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`ERPNext request failed: ${response.status}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}, {
  name: 'erpnext-main',
  ...CIRCUIT_BREAKER_PRESETS.erpnextAPI,
});

async function executeErpNextRequest<T>(operation: string, options: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}): Promise<T> {
  return observeIntegrationCall({
    integration: 'erpnext',
    operation,
    fn: async () => erpNextBreaker.fire(options) as Promise<T>,
  });
}

// Instrumentar circuit breaker com métricas Prometheus
// Type assertion necessária: Opossum CircuitBreaker tem tipos de eventos mais específicos
instrumentCircuitBreaker(metrics, 'erpnext', erpNextBreaker as unknown as Parameters<typeof instrumentCircuitBreaker>[2]);

type ErpNextAllowList = {
  allowAll: boolean;
  items: Set<string>;
};

function parseErpNextAllowList(raw?: string | null): ErpNextAllowList {
  const normalized = String(raw ?? '').trim();
  if (!normalized) {
    return { allowAll: false, items: new Set() };
  }
  if (normalized === '*') {
    return { allowAll: true, items: new Set() };
  }
  const items = normalized
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.toLowerCase());
  return { allowAll: false, items: new Set(items) };
}

const ERPNEXT_ALLOWED_DOCTYPES = parseErpNextAllowList(config.ERPNEXT_ALLOWED_DOCTYPES);
const ERPNEXT_ALLOWED_METHODS = parseErpNextAllowList(config.ERPNEXT_ALLOWED_METHODS);

function isErpNextAllowed(value: string, allowList: ErpNextAllowList): boolean {
  if (allowList.allowAll) return true;
  if (!value) return false;
  return allowList.items.has(value.toLowerCase());
}

function normalizeErpNextDoctype(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('DocType obrigatório');
  }
  if (!/^[a-zA-Z0-9_\-\s]+$/.test(trimmed)) {
    throw new Error('DocType inválido');
  }
  return trimmed;
}

function normalizeErpNextMethod(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Method obrigatório');
  }
  if (!/^[a-zA-Z0-9_.]+$/.test(trimmed)) {
    throw new Error('Method inválido');
  }
  return trimmed;
}

function buildErpNextHeaders(): Record<string, string> {
  return {
    'Authorization': `token ${config.ERPNEXT_API_KEY}:${config.ERPNEXT_API_SECRET}`,
    'Content-Type': 'application/json',
  };
}

// Sincronizar cliente/pedido com ERPNext (com Circuit Breaker)
// Fluxo correto ERPNext: Customer → Sales Order → Sales Invoice → Payment Entry com referência
async function syncToERPNext(
  type: 'customer' | 'sales_order' | 'sales_invoice' | 'payment' | 'payment_from_invoice', 
  data: Record<string, unknown>
) {
  if (!config.ERPNEXT_URL || !config.ERPNEXT_API_KEY || !config.ERPNEXT_API_SECRET) {
    logger.warn('ERPNext não configurado, sincronização ignorada');
    return null;
  }

  const doctypes: Record<string, string> = {
    customer: 'Customer',
    sales_order: 'Sales Order',
    sales_invoice: 'Sales Invoice',
    payment: 'Payment Entry',
    payment_from_invoice: 'Payment Entry', // Usado quando temos referência a invoice
  };

  try {
    // Para Payment Entry com referência a invoice, usar API especial do ERPNext
    if (type === 'payment_from_invoice' && data.against_invoice) {
      // Usar o método get_payment_entry para criar Payment Entry corretamente linkado
      const getPaymentResult = await executeErpNextRequest<{ message: Record<string, unknown> }>('payment_entry.get', {
        url: `${config.ERPNEXT_URL}/api/method/erpnext.accounts.doctype.payment_entry.payment_entry.get_payment_entry`,
        method: 'POST',
        headers: {
          'Authorization': `token ${config.ERPNEXT_API_KEY}:${config.ERPNEXT_API_SECRET}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          dt: 'Sales Invoice',
          dn: data.against_invoice,
          party_amount: data.paid_amount,
          payment_type: 'Receive',
        }),
      });

      // Salvar o Payment Entry gerado
      const paymentEntry = getPaymentResult.message;
      paymentEntry.reference_no = data.reference_no;
      paymentEntry.reference_date = data.reference_date;
      paymentEntry.mode_of_payment = data.mode_of_payment;
      
      // Adicionar campos custom se existirem
      if (data.custom_stripe_payment_intent_id) {
        paymentEntry.custom_stripe_payment_intent_id = data.custom_stripe_payment_intent_id;
      }
      if (data.custom_wise_transfer_id) {
        paymentEntry.custom_wise_transfer_id = data.custom_wise_transfer_id;
      }

      const result = await executeErpNextRequest<{ data: { name: string } }>('payment_entry.save', {
        url: `${config.ERPNEXT_URL}/api/resource/Payment%20Entry`,
        method: 'POST',
        headers: {
          'Authorization': `token ${config.ERPNEXT_API_KEY}:${config.ERPNEXT_API_SECRET}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(paymentEntry),
      });

      logger.info({ type: 'payment_from_invoice', erpnextId: result.data.name, invoice: data.against_invoice }, 'Payment Entry criado com referência a Invoice');
      return result.data;
    }

    const result = await executeErpNextRequest<{ data: { name: string } }>(`erpnext.${type}.create`, {
      url: `${config.ERPNEXT_URL}/api/resource/${doctypes[type]}`,
      method: 'POST',
      headers: {
        'Authorization': `token ${config.ERPNEXT_API_KEY}:${config.ERPNEXT_API_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    logger.info({ type, erpnextId: result.data.name }, 'Sincronizado com ERPNext');
    return result.data;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Breaker is open')) {
      logger.warn({ type }, 'Circuit breaker aberto - ERPNext temporariamente indisponível');
    } else {
      logger.error({ error, type }, 'Falha ao sincronizar com ERPNext');
    }
    return null;
  }
}

// Criar Sales Invoice a partir de Sales Order
async function createInvoiceFromOrder(salesOrderName: string): Promise<string | null> {
  if (!config.ERPNEXT_URL || !config.ERPNEXT_API_KEY || !config.ERPNEXT_API_SECRET) {
    return null;
  }

  try {
    // Usar API do ERPNext para criar Invoice a partir de Sales Order
    const result = await executeErpNextRequest<{ message: Record<string, unknown> }>('sales_order.make_invoice', {
      url: `${config.ERPNEXT_URL}/api/method/erpnext.selling.doctype.sales_order.sales_order.make_sales_invoice`,
      method: 'POST',
      headers: {
        'Authorization': `token ${config.ERPNEXT_API_KEY}:${config.ERPNEXT_API_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ source_name: salesOrderName }),
    });

    // Salvar a invoice gerada
    const invoice = result.message;
    const saveResult = await executeErpNextRequest<{ data: { name: string } }>('sales_invoice.create', {
      url: `${config.ERPNEXT_URL}/api/resource/Sales%20Invoice`,
      method: 'POST',
      headers: {
        'Authorization': `token ${config.ERPNEXT_API_KEY}:${config.ERPNEXT_API_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(invoice),
    });

    logger.info({ salesOrder: salesOrderName, invoice: saveResult.data.name }, 'Sales Invoice criada a partir de Sales Order');
    return saveResult.data.name;
  } catch (error) {
    logger.error({ error, salesOrder: salesOrderName }, 'Falha ao criar Sales Invoice a partir de Sales Order');
    return null;
  }
}

// Inicializar sistema de feature flags com storage PostgreSQL (Regra 16 - Enterprise)
const featureFlagStorage = createDrizzleFeatureFlagStorage();
initFeatureFlags(featureFlagStorage);
logger.info('Sistema de feature flags inicializado');

const corsOriginsEnv = process.env.CORS_ORIGINS;
if (!corsOriginsEnv && process.env.NODE_ENV === 'production') {
  logger.error('CORS_ORIGINS é obrigatório em produção (Regra 6 - fail-fast)');
  process.exit(1);
}
const CORS_ORIGINS = corsOriginsEnv
  ? corsOriginsEnv.split(',').map((origin) => origin.trim()).filter(Boolean)
  : [];

// SEGURANÇA: Helmet com CSP/HSTS enterprise (Express.js 2025 + OWASP 2023)
app.use(createSecurityMiddleware({
  contentSecurityPolicy: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV !== 'production',
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
    '/api/integrations/health', 
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
    '/api/integrations/health',
    '/api/integrations/stripe/webhook',
    '/api/integrations/wise/webhook',
    '/api/integrations/twilio/webhook',
    '/api/integrations/trading',
  ],
  serviceName: 'integrations-service',
}));

type IntegrationHealthStatus = {
  configured: boolean;
  operational: boolean;
  error?: string;
  details?: Record<string, unknown>;
};

function normalizeIntegrationError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Erro desconhecido';
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timeout`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function checkStripeHealth(): Promise<IntegrationHealthStatus> {
  if (!stripe) {
    return { configured: false, operational: false };
  }
  try {
    await withTimeout(stripe.accounts.retrieve(), EXTERNAL_API_TIMEOUT_MS, 'Stripe');
    return { configured: true, operational: true };
  } catch (error) {
    return { configured: true, operational: false, error: normalizeIntegrationError(error) };
  }
}

async function checkWiseHealth(): Promise<IntegrationHealthStatus> {
  if (!isWiseConfigured()) {
    return { configured: false, operational: false, details: { sandbox: getSandboxStatus() } };
  }
  try {
    await withTimeout(wiseService.getProfiles(), EXTERNAL_API_TIMEOUT_MS, 'Wise');
    return {
      configured: true,
      operational: true,
      details: {
        sandbox: getSandboxStatus(),
        profileId: getProfileIdSafe(),
      },
    };
  } catch (error) {
    return {
      configured: true,
      operational: false,
      error: normalizeIntegrationError(error),
      details: {
        sandbox: getSandboxStatus(),
        profileId: getProfileIdSafe(),
      },
    };
  }
}

async function checkErpnextHealth(): Promise<IntegrationHealthStatus> {
  if (!config.ERPNEXT_URL || !config.ERPNEXT_API_KEY || !config.ERPNEXT_API_SECRET) {
    return { configured: false, operational: false };
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXTERNAL_API_TIMEOUT_MS);
  try {
    const response = await fetch(`${config.ERPNEXT_URL}/api/method/frappe.auth.get_logged_user`, {
      headers: {
        'Authorization': `token ${config.ERPNEXT_API_KEY}:${config.ERPNEXT_API_SECRET}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`ERPNext HTTP ${response.status}`);
    }
    return { configured: true, operational: true };
  } catch (error) {
    return { configured: true, operational: false, error: normalizeIntegrationError(error) };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function checkTwilioHealth(): Promise<IntegrationHealthStatus> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_NUMBER) {
    return { configured: false, operational: false };
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXTERNAL_API_TIMEOUT_MS);
  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}.json`, {
      headers: {
        'Authorization': `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Twilio HTTP ${response.status}`);
    }
    return { configured: true, operational: true };
  } catch (error) {
    return { configured: true, operational: false, error: normalizeIntegrationError(error) };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function checkEmailHealth(): Promise<IntegrationHealthStatus> {
  if (!emailTransporter) {
    return { configured: false, operational: false };
  }
  try {
    await withTimeout(emailTransporter.verify(), EXTERNAL_API_TIMEOUT_MS, 'Gmail SMTP');
    return { configured: true, operational: true };
  } catch (error) {
    return { configured: true, operational: false, error: normalizeIntegrationError(error) };
  }
}

async function checkOpenAiVisionHealth(): Promise<IntegrationHealthStatus> {
  if (!OPENAI_API_KEY) {
    return { configured: false, operational: false };
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXTERNAL_API_TIMEOUT_MS);
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`OpenAI HTTP ${response.status}`);
    }
    return { configured: true, operational: true };
  } catch (error) {
    return { configured: true, operational: false, error: normalizeIntegrationError(error) };
  } finally {
    clearTimeout(timeoutId);
  }
}

function checkTradingHealth(): IntegrationHealthStatus {
  const configStatus = kucoinClient.getKucoinConfigStatus();
  const circuitBreaker = kucoinClient.getKucoinCircuitBreakerStatus();
  if (!configStatus.isConfigured) {
    return {
      configured: false,
      operational: false,
      details: { missingKeys: configStatus.missingKeys },
    };
  }
  const operational = circuitBreaker.state !== 'open';
  return {
    configured: true,
    operational,
    details: {
      missingKeys: configStatus.missingKeys,
      circuitBreaker,
    },
  };
}

async function collectIntegrationHealthStatuses(): Promise<Record<string, IntegrationHealthStatus>> {
  const [stripeHealth, wiseHealth, erpnextHealth, twilioHealth, emailHealth, openAiVisionHealth] = await Promise.all([
    checkStripeHealth(),
    checkWiseHealth(),
    checkErpnextHealth(),
    checkTwilioHealth(),
    checkEmailHealth(),
    checkOpenAiVisionHealth(),
  ]);
  const tradingHealth = checkTradingHealth();

  return {
    stripe: stripeHealth,
    wise: wiseHealth,
    erpnext: erpnextHealth,
    twilio: twilioHealth,
    email: emailHealth,
    openai_vision: openAiVisionHealth,
    trading: tradingHealth,
  };
}

async function refreshIntegrationHealthMetrics(): Promise<Record<string, IntegrationHealthStatus>> {
  const services = await collectIntegrationHealthStatuses();
  Object.entries(services).forEach(([integration, status]) => {
    updateIntegrationMetrics(integration, status.configured, status.operational);
  });
  return services;
}

app.get('/api/integrations/health', (_req: Request, res: Response) => {
  refreshIntegrationHealthMetrics()
    .then((services) => {
      const tradingHealth = services.trading;
      const wiseHealth = services.wise;
      res.json({ 
        status: 'ok', 
        service: 'integrations-service', 
        version: process.env.APP_VERSION ?? null,
        timestamp: new Date().toISOString(),
        services,
        integrations: {
          stripe: services.stripe.configured,
          wise: services.wise.configured,
          erpnext: services.erpnext.configured,
          twilio: services.twilio.configured,
          email: services.email.configured,
          openaiVision: services.openai_vision.configured,
          trading: services.trading.configured,
        },
        circuitBreakers: {
          erpnext: erpNextBreaker.opened ? 'open' : (erpNextBreaker.halfOpen ? 'half-open' : 'closed'),
          wise: wiseHealth.configured ? getWiseCircuitBreakerStatus() : null,
          trading: tradingHealth.details?.circuitBreaker ?? null,
        },
      });
    })
    .catch((error) => {
      logger.error({ error }, 'Falha ao calcular integrações/health');
      res.status(500).json({ error: 'Falha ao verificar integrações' });
    });
});

app.get('/api/integrations/stats', requirePermission('integrations:integrations:read'), async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) {
    logger.warn({ userId: req.user?.userId }, 'Tentativa de acesso a integrations/stats sem tenantId');
    return res.status(403).json({ error: 'Acesso negado: usuário não associado a um tenant' });
  }

  try {
    const db = getDatabase();

    const [stripeRevenueRow] = await db
      .select({
        total: sql<number>`coalesce(sum(((${schema.webhookEvents.payload} -> 'data' -> 'object' ->> 'amount_total')::numeric)), 0)`,
        currency: sql<string>`max((${schema.webhookEvents.payload} -> 'data' -> 'object' ->> 'currency'))`,
      })
      .from(schema.webhookEvents)
      .where(and(
        eq(schema.webhookEvents.source, 'stripe'),
        eq(schema.webhookEvents.eventType, 'checkout.session.completed'),
        eq(schema.webhookEvents.processed, true),
        eq(schema.webhookEvents.tenantId, tenantId)
      ));

    const [stripeTransactionsRow] = await db
      .select({ total: sql<number>`count(*)` })
      .from(schema.stripeErpnextMapping)
      .where(eq(schema.stripeErpnextMapping.tenantId, tenantId));

    const [wiseTotalRow] = await db
      .select({ total: sql<number>`count(*)` })
      .from(schema.wiseSyncLog)
      .where(eq(schema.wiseSyncLog.tenantId, tenantId));

    const [wiseCompletedRow] = await db
      .select({ total: sql<number>`count(*)` })
      .from(schema.wiseSyncLog)
      .where(and(
        eq(schema.wiseSyncLog.tenantId, tenantId),
        eq(schema.wiseSyncLog.status, 'synced')
      ));

    const [wisePendingRow] = await db
      .select({ total: sql<number>`coalesce(sum(${schema.wiseSyncLog.wiseAmount}), 0)` })
      .from(schema.wiseSyncLog)
      .where(and(
        eq(schema.wiseSyncLog.tenantId, tenantId),
        inArray(schema.wiseSyncLog.status, ['pending', 'retrying', 'manual_review'])
      ));

    const [erpnextCustomersRow] = await db
      .select({ total: sql<number>`count(distinct ${schema.stripeErpnextMapping.erpnextCustomer})` })
      .from(schema.stripeErpnextMapping)
      .where(and(
        eq(schema.stripeErpnextMapping.tenantId, tenantId),
        sql`${schema.stripeErpnextMapping.erpnextCustomer} is not null`
      ));

    const [erpnextOrdersRow] = await db
      .select({ total: sql<number>`count(distinct ${schema.stripeErpnextMapping.erpnextSalesOrder})` })
      .from(schema.stripeErpnextMapping)
      .where(and(
        eq(schema.stripeErpnextMapping.tenantId, tenantId),
        sql`${schema.stripeErpnextMapping.erpnextSalesOrder} is not null`
      ));

    const stripeCurrency = stripeRevenueRow?.currency ? stripeRevenueRow.currency.toUpperCase() : 'EUR';

    res.json({
      stripe: {
        totalRevenue: Number(stripeRevenueRow?.total ?? 0) / 100,
        transactions: Number(stripeTransactionsRow?.total ?? 0),
        currency: stripeCurrency,
      },
      wise: {
        totalTransfers: Number(wiseTotalRow?.total ?? 0),
        pendingAmount: Number(wisePendingRow?.total ?? 0),
        completedCount: Number(wiseCompletedRow?.total ?? 0),
      },
      erpnext: {
        customers: Number(erpnextCustomersRow?.total ?? 0),
        orders: Number(erpnextOrdersRow?.total ?? 0),
        synced: Boolean(config.ERPNEXT_URL) && !erpNextBreaker.opened,
      },
    });
  } catch (error) {
    logger.error({ error, tenantId }, 'Erro ao calcular integrations/stats');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ============================================================================
// KUBERNETES PROBES: /ready e /live (Regra 16 - Best Practices 2025)
// /live: Processo está vivo? Se não, Kubernetes reinicia o container
// /ready: Pronto para tráfego? Verifica conexão com PostgreSQL e circuit breakers
// ============================================================================

// Liveness probe - verificação simples que o processo responde
app.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({ 
    status: 'alive', 
    service: 'integrations-service',
    timestamp: new Date().toISOString(),
  });
});

// Readiness probe - verifica se PostgreSQL e integrações críticas estão acessíveis
app.get('/ready', async (_req: Request, res: Response) => {
  try {
    const dbHealthy = await isPoolHealthy();
    const erpnextReady = !erpNextBreaker.opened;
    
    // Para readiness, verificamos apenas PostgreSQL (obrigatório) e ERPNext (se configurado)
    const allReady = dbHealthy && (erpnextReady || !config.ERPNEXT_URL);
    
    if (allReady) {
      res.status(200).json({
        status: 'ready',
        service: 'integrations-service',
        timestamp: new Date().toISOString(),
        dependencies: {
          postgresql: 'ready',
          erpnext: config.ERPNEXT_URL ? (erpnextReady ? 'ready' : 'circuit_open') : 'not_configured',
        },
      });
    } else {
      res.status(503).json({
        status: 'not_ready',
        service: 'integrations-service',
        reason: !dbHealthy ? 'PostgreSQL não está acessível' : 'ERPNext circuit breaker aberto',
        timestamp: new Date().toISOString(),
        dependencies: {
          postgresql: dbHealthy ? 'ready' : 'not_ready',
          erpnext: config.ERPNEXT_URL ? (erpnextReady ? 'ready' : 'circuit_open') : 'not_configured',
        },
      });
    }
  } catch (error) {
    logger.error({ error }, 'Erro ao verificar readiness');
    res.status(503).json({
      status: 'not_ready',
      service: 'integrations-service',
      reason: 'Erro ao verificar dependências',
      timestamp: new Date().toISOString(),
    });
  }
});

app.get('/api/integrations', requirePermission('integrations:integrations:read'), async (req: Request, res: Response) => {
  // OWASP API3: Validação de query params
  const queryResult = integrationsQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: queryResult.error.format() });
  }
  const { tenantId } = queryResult.data;

  try {
    const db = getDatabase();

    const integrations = await db.query.integrations.findMany({
      where: tenantId ? eq(schema.integrations.tenantId, tenantId) : undefined,
      orderBy: [desc(schema.integrations.criadoEm)],
    });

    res.json({ integrations });
  } catch (error) {
    logger.error({ error }, 'Failed to fetch integrations');
    res.status(500).json({ error: 'Internal server error' });
  }
});

const createIntegrationSchema = z.object({
  tenantId: z.string().uuid().optional(),
  tipo: z.enum(['stripe', 'erpnext', 'twilio', 'whatsapp']),
  nome: z.string().min(1),
  configuracao: z.record(z.unknown()).optional(),
  credenciais: z.record(z.unknown()).optional(),
});

// OWASP API3 - Schemas Zod para Twilio webhooks e rotas
// Referência: https://www.twilio.com/docs/messaging/webhooks/message-webhooks
// Regex para formato Twilio: "whatsapp:+xxxxxxxxxxx" ou "+xxxxxxxxxxx"
const twilioPhoneRegex = /^(whatsapp:)?\+?[1-9]\d{9,14}$/;
// Regex para MessageSid webhook incoming: MM + 32 hex chars (MMS) ou SM + 32 (SMS)
const twilioIncomingSidRegex = /^(SM|MM)[0-9a-fA-F]{32}$/;
const twilioWebhookSchema = z.object({
  MessageSid: z.string().regex(twilioIncomingSidRegex), // SM/MM + 32 hex chars
  From: z.string().min(10).max(30).regex(twilioPhoneRegex), // whatsapp:+xxxxxxxxxxx ou +xxxxxxxxxxx
  To: z.string().min(10).max(30).regex(twilioPhoneRegex),
  Body: z.string().max(1600).default(''), // WhatsApp max message size
  NumMedia: z.string().regex(/^\d+$/).optional(),
  MediaUrl0: z.string().url().optional(),
  MediaContentType0: z.string().max(100).optional(),
});

// Twilio message status enum completo
// Docs: https://www.twilio.com/docs/messaging/guides/outbound-message-statuses
// Inclui todos os status: outbound, inbound e WhatsApp específicos
const twilioMessageStatuses = [
  // Outbound statuses
  'accepted', 'queued', 'sending', 'sent', 'delivered', 'undelivered', 'failed',
  // Inbound statuses
  'receiving', 'received',
  // Scheduled message statuses
  'scheduled', 'canceled',
  // WhatsApp specific statuses
  'read',
] as const;
// Regex para MessageSid: SM + 32 hex chars
const twilioSidRegex = /^SM[0-9a-fA-F]{32}$/;
const twilioStatusSchema = z.object({
  MessageSid: z.string().regex(twilioSidRegex), // SM + 32 hex chars
  MessageStatus: z.enum(twilioMessageStatuses),
  ErrorCode: z.string().max(10).optional(),
  ErrorMessage: z.string().max(500).optional(),
  To: z.string().min(10).max(30).regex(twilioPhoneRegex), // whatsapp:+xxxxxxxxxxx ou +xxxxxxxxxxx
});

const twilioSendSchema = z.object({
  to: z.string().min(10).max(30).regex(twilioPhoneRegex), // whatsapp:+xxxxxxxxxxx ou +xxxxxxxxxxx
  message: z.string().min(1).max(1600), // WhatsApp max message size
  conversationId: z.string().uuid().optional(),
  mediaUrl: z.string().url().optional(),
});

// ============================================================================
// OWASP API3 - Schemas Zod para validação de parâmetros de rota e query
// Previne NaN e injection via parâmetros não validados
// ============================================================================

// Schema para ID numérico positivo (Wise recipient/transfer IDs)
const numericIdParamSchema = z.object({
  id: z.string().regex(/^\d+$/, 'ID deve ser numérico').transform(Number).refine(n => n > 0, 'ID deve ser positivo'),
});

const balanceIdParamSchema = z.object({
  balanceId: z.string().regex(/^\d+$/, 'balanceId deve ser numérico').transform(Number).refine(n => n > 0, 'balanceId deve ser positivo'),
});

// Schema para ID string (batch groups usam UUID) - reservado para uso futuro
const _stringIdParamSchema = z.object({
  id: z.string().min(1).max(100),
});

// Schema para query params de paginação
const paginationQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/).transform(Number).refine(n => n >= 1 && n <= 100, 'limit deve ser entre 1 e 100').optional(),
  offset: z.string().regex(/^\d+$/).transform(Number).refine(n => n >= 0, 'offset deve ser >= 0').optional(),
});

// Schema para query params com tenantId opcional
const tenantQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
});

// Schema para query params de integrations
const integrationsQuerySchema = tenantQuerySchema;

// OWASP API3: Schemas para validação de query params Wise
// Previne injection e garante tipos corretos

// Schema para taxas de câmbio (source/target currencies)
const wiseRatesQuerySchema = z.object({
  source: z.string()
    .min(3, 'source deve ter 3 caracteres')
    .max(3, 'source deve ter 3 caracteres')
    .regex(/^[A-Z]{3}$/, 'source deve ser código de moeda válido (ex: USD, EUR, BRL)'),
  target: z.string()
    .min(3, 'target deve ter 3 caracteres')
    .max(3, 'target deve ter 3 caracteres')
    .regex(/^[A-Z]{3}$/, 'target deve ser código de moeda válido (ex: USD, EUR, BRL)'),
});

// Schema para filtro de destinatários por moeda (opcional)
const wiseRecipientsQuerySchema = z.object({
  currency: z.string()
    .min(3, 'currency deve ter 3 caracteres')
    .max(3, 'currency deve ter 3 caracteres')
    .regex(/^[A-Z]{3}$/, 'currency deve ser código de moeda válido')
    .optional(),
});

const wiseBalancesQuerySchema = z.object({
  types: z.string()
    .regex(/^[A-Z,]+$/, 'types deve conter apenas letras e vírgulas')
    .optional(),
});

const wiseBalanceCreateSchema = z.object({
  currency: z.string()
    .min(3, 'currency deve ter 3 caracteres')
    .max(3, 'currency deve ter 3 caracteres')
    .regex(/^[A-Z]{3}$/, 'currency deve ser código de moeda válido'),
  type: z.enum(['STANDARD', 'SAVINGS']),
  name: z.string().min(1).max(100).optional(),
}).superRefine((data, ctx) => {
  if (data.type === 'SAVINGS' && !data.name) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'name é obrigatório para saldo SAVINGS', path: ['name'] });
  }
});

const wiseBalanceStatementQuerySchema = z.object({
  currency: z.string()
    .min(3, 'currency deve ter 3 caracteres')
    .max(3, 'currency deve ter 3 caracteres')
    .regex(/^[A-Z]{3}$/, 'currency deve ser código de moeda válido'),
  intervalStart: z.string().min(10, 'intervalStart inválido'),
  intervalEnd: z.string().min(10, 'intervalEnd inválido'),
  type: z.enum(['COMPACT', 'FLAT']).optional(),
});

const wiseBalanceMovementSchema = z.object({
  quoteId: z.string().uuid().optional(),
  sourceBalanceId: z.coerce.number().int().positive().optional(),
  targetBalanceId: z.coerce.number().int().positive().optional(),
  amount: z.object({
    value: z.coerce.number().positive(),
    currency: z.string().min(3).max(3).regex(/^[A-Z]{3}$/),
  }).optional(),
}).superRefine((data, ctx) => {
  const hasQuote = Boolean(data.quoteId);
  const hasAmount = Boolean(data.amount);
  const hasBalances = Boolean(data.sourceBalanceId && data.targetBalanceId);
  if (!hasQuote && !hasAmount) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'quoteId ou amount é obrigatório', path: ['quoteId'] });
  }
  if (hasAmount && !hasBalances) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'sourceBalanceId e targetBalanceId são obrigatórios com amount', path: ['sourceBalanceId'] });
  }
});

const wiseCurrencyQuerySchema = z.object({
  currency: z.string()
    .min(3, 'currency deve ter 3 caracteres')
    .max(3, 'currency deve ter 3 caracteres')
    .regex(/^[A-Z]{3}$/, 'currency deve ser código de moeda válido'),
});

const wiseQuoteCreateSchema = z.object({
  sourceCurrency: z.string()
    .min(3, 'sourceCurrency deve ter 3 caracteres')
    .max(3, 'sourceCurrency deve ter 3 caracteres')
    .regex(/^[A-Z]{3}$/, 'sourceCurrency deve ser código de moeda válido'),
  targetCurrency: z.string()
    .min(3, 'targetCurrency deve ter 3 caracteres')
    .max(3, 'targetCurrency deve ter 3 caracteres')
    .regex(/^[A-Z]{3}$/, 'targetCurrency deve ser código de moeda válido'),
  sourceAmount: z.coerce.number().positive().optional(),
  targetAmount: z.coerce.number().positive().optional(),
  payOut: z.enum(['BANK_TRANSFER', 'BALANCE', 'SWIFT', 'SWIFT_OUR', 'INTERAC']).optional(),
  preferredPayIn: z.enum(['BANK_TRANSFER', 'BALANCE']).optional(),
  targetAccount: z.coerce.number().int().positive().optional(),
}).superRefine((data, ctx) => {
  if (!data.sourceAmount && !data.targetAmount) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'sourceAmount ou targetAmount é obrigatório', path: ['sourceAmount'] });
  }
  if (data.sourceAmount && data.targetAmount) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe apenas sourceAmount ou targetAmount', path: ['targetAmount'] });
  }
});

// Schema para requisitos de destinatário
const wiseRecipientRequirementsQuerySchema = z.object({
  sourceCurrency: z.string()
    .min(3, 'sourceCurrency deve ter 3 caracteres')
    .max(3, 'sourceCurrency deve ter 3 caracteres')
    .regex(/^[A-Z]{3}$/, 'sourceCurrency deve ser código de moeda válido'),
  targetCurrency: z.string()
    .min(3, 'targetCurrency deve ter 3 caracteres')
    .max(3, 'targetCurrency deve ter 3 caracteres')
    .regex(/^[A-Z]{3}$/, 'targetCurrency deve ser código de moeda válido'),
  sourceAmount: z.string()
    .regex(/^\d+(\.\d{1,2})?$/, 'sourceAmount deve ser número válido')
    .transform(Number)
    .refine(n => n > 0, 'sourceAmount deve ser positivo'),
});

const wiseProfileIdParamSchema = z.object({
  profileId: z.string().regex(/^\d+$/, 'profileId deve ser numérico').transform(Number).refine(n => n > 0, 'profileId deve ser positivo'),
});

const wiseCardTokenParamSchema = z.object({
  cardToken: z.string().min(16, 'cardToken inválido').max(128, 'cardToken inválido'),
});

const wiseDisputeIdParamSchema = z.object({
  disputeId: z.string().min(1).max(128),
});

const wiseKycReviewIdParamSchema = z.object({
  kycReviewId: z.string().min(1).max(128),
});

const wiseCardOrderIdParamSchema = z.object({
  cardOrderId: z.string().min(1).max(128),
});

const wiseTransactionIdParamSchema = z.object({
  transactionId: z.string().min(1).max(128),
});

const wiseWebhookIdParamSchema = z.object({
  subscriptionId: z.string().min(1).max(128),
});

const wiseGenericPayloadSchema = z.object({}).passthrough();

const wiseJosePayloadSchema = z.object({
  josePayload: z.string().min(20, 'josePayload inválido'),
});

const wiseFileUploadSchema = z.object({
  fileBase64: z.string().min(100, 'fileBase64 inválido'),
  fileName: z.string().min(1, 'fileName inválido').max(255),
  contentType: z.string().min(3, 'contentType inválido').max(100),
});

const wiseActivityQuerySchema = z.object({
  profileId: z.string().regex(/^\d+$/).transform(Number).optional(),
  monetaryResourceType: z.string().optional(),
  status: z.string().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  size: z.string().regex(/^\d+$/).transform(Number).optional(),
});

const wiseCardOrdersQuerySchema = z.object({
  pageNumber: z.string().regex(/^\d+$/).transform(Number).optional(),
  pageSize: z.string().regex(/^\d+$/).transform(Number).optional(),
});

const wiseSimulationActionSchema = z.object({
  action: z.string().min(1).max(100),
});

const wiseOAuthExchangeSchema = z.object({
  code: z.string().min(5, 'code inválido'),
  redirectUri: z.string().url('redirectUri inválido'),
});

const wiseOAuthRefreshSchema = z.object({
  refreshToken: z.string().min(10, 'refreshToken inválido'),
});

app.post('/api/integrations', requirePermission('integrations:integrations:write'), async (req: Request, res: Response) => {
  try {
    const body = createIntegrationSchema.parse(req.body);
    const db = getDatabase();

    const [integration] = await db.insert(schema.integrations).values({
      tenantId: body.tenantId,
      tipo: body.tipo,
      nome: body.nome,
      configuracao: body.configuracao || {},
      credenciais: body.credenciais || {},
      ativo: true,
    }).returning();

    logger.info({ integrationId: integration.id, tipo: body.tipo }, 'Integration created');
    res.json({ integration });
  } catch (error) {
    logger.error({ error }, 'Failed to create integration');
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/integrations/stripe/create-checkout', requirePermission('integrations:stripe:write'), async (req: Request, res: Response) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  const { priceId, userId, successUrl, cancelUrl } = req.body;

  try {
    const db = getDatabase();
    const user = await db.query.users.findFirst({
      where: eq(schema.users.id, userId),
    });

    let customerId = user?.stripeCustomerId;

    if (!customerId) {
      const customer = await executeStripeCall('customer.create', () => stripe.customers.create({
        email: user?.email || undefined,
        name: [user?.firstName, user?.lastName].filter(Boolean).join(' ') || undefined,
        metadata: { userId },
      }));
      customerId = customer.id;

      await db.update(schema.users)
        .set({ stripeCustomerId: customerId })
        .where(eq(schema.users.id, userId));
    }

    const session = await executeStripeCall('checkout.create', () => stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { userId },
    }));

    logger.info({ sessionId: session.id, userId }, 'Checkout session created');
    res.json({ sessionId: session.id, url: session.url });
  } catch (error) {
    logger.error({ error }, 'Failed to create checkout session');
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/integrations/stripe/create-portal', requirePermission('integrations:stripe:write'), async (req: Request, res: Response) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  const { userId, returnUrl } = req.body;

  try {
    const db = getDatabase();
    const user = await db.query.users.findFirst({
      where: eq(schema.users.id, userId),
    });

    const stripeCustomerId = user?.stripeCustomerId ?? undefined;
    if (!stripeCustomerId) {
      return res.status(400).json({ error: 'User has no Stripe customer' });
    }

    const session = await executeStripeCall('billing_portal.create', () => stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl,
    }));

    res.json({ url: session.url });
  } catch (error) {
    logger.error({ error }, 'Failed to create portal session');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Listar produtos do Stripe
app.get('/api/integrations/stripe/products', requirePermission('integrations:stripe:read'), async (_req: Request, res: Response) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  try {
    const products = await executeStripeCall('products.list', () => stripe.products.list({ active: true, limit: 100 }));
    const prices = await executeStripeCall('prices.list', () => stripe.prices.list({ active: true, limit: 100 }));

    const productsWithPrices = products.data.map(product => ({
      ...product,
      prices: prices.data.filter(price => price.product === product.id),
    }));

    res.json({ products: productsWithPrices });
  } catch (error) {
    logger.error({ error }, 'Failed to list products');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Criar PaymentIntent para pagamento único
app.post('/api/integrations/stripe/create-payment-intent', requirePermission('integrations:stripe:write'), async (req: Request, res: Response) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  const { amount, currency = 'eur', userId, description } = req.body;

  try {
    const db = getDatabase();
    let customerId: string | undefined;

    if (userId) {
      const user = await db.query.users.findFirst({
        where: eq(schema.users.id, userId),
      });

      if (user?.stripeCustomerId) {
        customerId = user.stripeCustomerId;
      } else if (user?.email) {
        const customer = await executeStripeCall('customer.create', () => stripe.customers.create({
          email: user.email ?? undefined,
          name: [user.firstName, user.lastName].filter(Boolean).join(' ') || undefined,
          metadata: { userId },
        }));
        customerId = customer.id;

        await db.update(schema.users)
          .set({ stripeCustomerId: customerId })
          .where(eq(schema.users.id, userId));
      }
    }

    const paymentIntent = await executeStripeCall('payment_intent.create', () => stripe.paymentIntents.create({
      amount,
      currency,
      customer: customerId,
      description,
      automatic_payment_methods: { enabled: true },
      metadata: { userId: userId || '' },
    }));

    logger.info({ paymentIntentId: paymentIntent.id, amount, currency }, 'PaymentIntent created');
    res.json({ clientSecret: paymentIntent.client_secret, paymentIntentId: paymentIntent.id });
  } catch (error) {
    logger.error({ error }, 'Failed to create PaymentIntent');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Validar secrets obrigatórios em produção (Regra 16 - Segurança Enterprise)
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// STRIPE: Fail-fast se produção sem webhook secret
if (!STRIPE_WEBHOOK_SECRET && IS_PRODUCTION && stripe) {
  logger.error('CRITICAL: STRIPE_WEBHOOK_SECRET é OBRIGATÓRIO em produção com Stripe ativo. Abortando.');
  process.exit(1);
}

// WISE: Webhooks usam assinatura RSA com chave pública oficial (docs Wise)

// Função auxiliar para verificar idempotência de webhooks
async function checkWebhookIdempotency(
  db: ReturnType<typeof getDatabase>,
  source: 'stripe' | 'wise' | 'twilio' | 'erpnext',
  eventId: string,
  eventType: string,
  payload: Record<string, unknown>
): Promise<{ isDuplicate: boolean; existingEvent?: typeof schema.webhookEvents.$inferSelect }> {
  // Verificar se evento já foi processado
  const existingEvent = await db.query.webhookEvents.findFirst({
    where: and(
      eq(schema.webhookEvents.source, source),
      eq(schema.webhookEvents.eventId, eventId)
    ),
  });

  if (existingEvent) {
    logger.info({ 
      source, 
      eventId, 
      processedAt: existingEvent.processedAt,
    }, 'Webhook duplicado detectado - ignorando (idempotência)');
    return { isDuplicate: true, existingEvent };
  }

  // Registrar evento para garantir idempotência
  await db.insert(schema.webhookEvents).values({
    source,
    eventId,
    eventType,
    payload,
    processed: false,
  });

  return { isDuplicate: false };
}

// Função auxiliar para marcar webhook como processado
async function markWebhookProcessed(
  db: ReturnType<typeof getDatabase>,
  source: 'stripe' | 'wise' | 'twilio' | 'erpnext',
  eventId: string,
  result: Record<string, unknown>,
  error?: string
): Promise<void> {
  await db.update(schema.webhookEvents)
    .set({
      processed: !error,
      processedAt: new Date(),
      result,
      error,
      retryCount: error ? sql`retry_count + 1` : undefined,
    })
    .where(and(
      eq(schema.webhookEvents.source, source),
      eq(schema.webhookEvents.eventId, eventId)
    ));
}

// Stripe Webhook - express.raw() já aplicado via app.use() ANTES de express.json() (linha 310)
// Isso garante que req.body seja Buffer para validação de assinatura Stripe
app.post('/api/integrations/stripe/webhook', async (req: Request, res: Response) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  const contentTypeHeader = req.headers['content-type'];
  const contentType = Array.isArray(contentTypeHeader)
    ? contentTypeHeader[0]?.toLowerCase()
    : contentTypeHeader?.toLowerCase();
  if (!contentType || !contentType.startsWith('application/json')) {
    logger.warn({ contentType }, 'Stripe webhook rejeitado: content-type inválido');
    return res.status(400).json({ error: 'Invalid content-type' });
  }

  const sig = req.headers['stripe-signature'] as string;

  if (!STRIPE_WEBHOOK_SECRET) {
    logger.error('Webhook recebido mas STRIPE_WEBHOOK_SECRET não configurado');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  // REGRA 6: Validação de Buffer após express.raw() aplicado diretamente na rota
  // Se express.raw() não foi aplicado corretamente, req.body será objeto (erro)
  if (!Buffer.isBuffer(req.body)) {
    logger.error('Stripe webhook rejeitado: body não é Buffer (express.raw() não aplicado corretamente)');
    return res.status(500).json({ error: 'Invalid body parser for webhook' });
  }

  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    const db = getDatabase();

    // IDEMPOTÊNCIA: Verificar se evento já foi processado
    const { isDuplicate } = await checkWebhookIdempotency(
      db,
      'stripe',
      event.id,
      event.type,
      event.data.object as unknown as Record<string, unknown>
    );

    if (isDuplicate) {
      return res.json({ received: true, duplicate: true });
    }

    let processingResult: Record<string, unknown> = {};
    let processingError: string | undefined;

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session;
          const userId = session.metadata?.userId;

          if (userId && session.subscription) {
            await db.update(schema.users)
              .set({ stripeSubscriptionId: session.subscription as string })
              .where(eq(schema.users.id, userId));

            logger.info({ userId, subscriptionId: session.subscription }, 'Subscription created');
            processingResult = { userId, subscriptionId: session.subscription };
          }

          // FLUXO ERPNEXT COMPLETO: Customer → Sales Order → Sales Invoice → Payment Entry
          // Step 1: Criar registro de mapeamento para rastreabilidade
          const [mapping] = await db.insert(schema.stripeErpnextMapping).values({
            stripeSessionId: session.id,
            stripeCustomerId: session.customer as string,
            stripePaymentIntentId: session.payment_intent as string || null,
            stripeSubscriptionId: session.subscription as string || null,
            flowStatus: 'pending',
          }).returning();

          // Step 2: Criar Sales Order quando checkout completa
          if (session.customer && session.amount_total) {
            const customer = await executeStripeCall('customer.retrieve', () => stripe.customers.retrieve(session.customer as string));
            if (customer && !customer.deleted) {
              const salesOrderResult = await syncToERPNext('sales_order', {
                customer: customer.email || customer.id,
                transaction_date: new Date().toISOString().split('T')[0],
                delivery_date: new Date().toISOString().split('T')[0],
                currency: (session.currency || 'EUR').toUpperCase(),
                items: [{
                  item_code: session.metadata?.productId || 'SUBSCRIPTION',
                  qty: 1,
                  rate: (session.amount_total || 0) / 100,
                }],
                custom_stripe_session_id: session.id,
                custom_stripe_customer_id: session.customer,
              });
              
              if (salesOrderResult?.name) {
                // Atualizar mapeamento com Sales Order
                await db.update(schema.stripeErpnextMapping)
                  .set({ 
                    erpnextSalesOrder: salesOrderResult.name,
                    erpnextCustomer: customer.email || customer.id,
                    flowStatus: 'order_created',
                    atualizadoEm: new Date(),
                  })
                  .where(eq(schema.stripeErpnextMapping.id, mapping.id));
              }
              
              // Step 3: Se pagamento já foi feito (status=paid), criar Invoice + Payment Entry
              if (session.payment_status === 'paid' && salesOrderResult?.name) {
                // Criar Invoice a partir do Sales Order
                const invoiceName = await createInvoiceFromOrder(salesOrderResult.name);
                
                if (invoiceName) {
                  // Atualizar mapeamento com Invoice
                  await db.update(schema.stripeErpnextMapping)
                    .set({ 
                      erpnextSalesInvoice: invoiceName,
                      flowStatus: 'invoice_created',
                      atualizadoEm: new Date(),
                    })
                    .where(eq(schema.stripeErpnextMapping.id, mapping.id));

                  // Criar Payment Entry com referência à Invoice
                  const paymentResult = await syncToERPNext('payment_from_invoice', {
                    against_invoice: invoiceName,
                    paid_amount: (session.amount_total || 0) / 100,
                    reference_no: session.payment_intent as string || session.id,
                    reference_date: new Date().toISOString().split('T')[0],
                    mode_of_payment: 'Stripe',
                    custom_stripe_session_id: session.id,
                    custom_stripe_payment_intent_id: session.payment_intent,
                  });
                  
                  // Atualizar mapeamento com Payment Entry
                  if (paymentResult?.name) {
                    await db.update(schema.stripeErpnextMapping)
                      .set({ 
                        erpnextPaymentEntry: paymentResult.name,
                        flowStatus: 'complete',
                        atualizadoEm: new Date(),
                      })
                      .where(eq(schema.stripeErpnextMapping.id, mapping.id));
                  }
                  
                  logger.info({ 
                    salesOrder: salesOrderResult.name, 
                    invoice: invoiceName,
                    sessionId: session.id 
                  }, 'Fluxo ERPNext completo: Sales Order → Invoice → Payment Entry');
                  
                  processingResult = { 
                    ...processingResult, 
                    salesOrder: salesOrderResult.name, 
                    invoice: invoiceName,
                    erpnextFlowComplete: true 
                  };
                }
              } else if (salesOrderResult?.name) {
                // Pagamento pendente - apenas Sales Order criado
                logger.info({ 
                  salesOrder: salesOrderResult.name, 
                  sessionId: session.id,
                  paymentStatus: session.payment_status 
                }, 'Sales Order criado - Invoice será criada quando pagamento confirmar');
                processingResult = { ...processingResult, salesOrder: salesOrderResult.name };
              }
            }
          }
          break;
        }

        case 'customer.subscription.deleted': {
          const subscription = event.data.object as Stripe.Subscription;
          const customerId = subscription.customer as string;

          const user = await db.query.users.findFirst({
            where: eq(schema.users.stripeCustomerId, customerId),
          });

          if (user) {
            await db.update(schema.users)
              .set({ stripeSubscriptionId: null })
              .where(eq(schema.users.id, user.id));

            logger.info({ userId: user.id }, 'Subscription cancelled');
            processingResult = { userId: user.id, action: 'subscription_cancelled' };
          }
          break;
        }

        case 'payment_intent.succeeded': {
          const paymentIntent = event.data.object as Stripe.PaymentIntent;
          
          // Completar fluxo ERPNext se pagamento foi feito após checkout
          // Usar tabela de mapeamento para encontrar o Sales Order correto
          
          if (paymentIntent.amount && paymentIntent.customer) {
            // Buscar mapeamento pelo payment_intent_id
            const mapping = await db.query.stripeErpnextMapping.findFirst({
              where: eq(schema.stripeErpnextMapping.stripePaymentIntentId, paymentIntent.id),
            });

            if (mapping && mapping.erpnextSalesOrder) {
              // Verificar se fluxo já está completo
              if (mapping.flowStatus === 'complete') {
                logger.info({ paymentIntentId: paymentIntent.id, mappingId: mapping.id }, 
                  'Fluxo ERPNext já completo - ignorando payment_intent.succeeded');
                processingResult = { 
                  paymentIntentId: paymentIntent.id, 
                  amount: paymentIntent.amount,
                  alreadyComplete: true 
                };
              } else if (mapping.flowStatus === 'order_created') {
                // Sales Order existe mas Invoice não - criar Invoice + Payment Entry
                try {
                  const invoiceName = await createInvoiceFromOrder(mapping.erpnextSalesOrder);
                  
                  if (invoiceName) {
                    // Atualizar mapeamento com Invoice
                    await db.update(schema.stripeErpnextMapping)
                      .set({ 
                        erpnextSalesInvoice: invoiceName,
                        flowStatus: 'invoice_created',
                        atualizadoEm: new Date(),
                      })
                      .where(eq(schema.stripeErpnextMapping.id, mapping.id));

                    // Criar Payment Entry com referência à Invoice
                    const paymentResult = await syncToERPNext('payment_from_invoice', {
                      against_invoice: invoiceName,
                      paid_amount: paymentIntent.amount / 100,
                      reference_no: paymentIntent.id,
                      reference_date: new Date().toISOString().split('T')[0],
                      mode_of_payment: 'Stripe',
                      custom_stripe_payment_intent_id: paymentIntent.id,
                    });
                    
                    // Atualizar mapeamento com Payment Entry
                    if (paymentResult?.name) {
                      await db.update(schema.stripeErpnextMapping)
                        .set({ 
                          erpnextPaymentEntry: paymentResult.name,
                          flowStatus: 'complete',
                          atualizadoEm: new Date(),
                        })
                        .where(eq(schema.stripeErpnextMapping.id, mapping.id));
                    }
                    
                    logger.info({ 
                      salesOrder: mapping.erpnextSalesOrder, 
                      invoice: invoiceName,
                      paymentIntentId: paymentIntent.id 
                    }, 'Fluxo ERPNext completado via payment_intent.succeeded');
                    
                    processingResult = { 
                      paymentIntentId: paymentIntent.id, 
                      amount: paymentIntent.amount,
                      salesOrder: mapping.erpnextSalesOrder,
                      invoice: invoiceName,
                      erpnextFlowComplete: true
                    };
                  }
                } catch (erpnextError) {
                  logger.error({ error: erpnextError, paymentIntentId: paymentIntent.id, mapping }, 
                    'Falha ao completar fluxo ERPNext via payment_intent.succeeded');
                  
                  processingResult = { 
                    paymentIntentId: paymentIntent.id, 
                    amount: paymentIntent.amount,
                    error: 'ERPNext flow failed',
                    salesOrder: mapping.erpnextSalesOrder
                  };
                }
              } else if (mapping.flowStatus === 'invoice_created' && mapping.erpnextSalesInvoice) {
                // Invoice existe mas Payment Entry não - criar apenas Payment Entry
                try {
                  const paymentResult = await syncToERPNext('payment_from_invoice', {
                    against_invoice: mapping.erpnextSalesInvoice,
                    paid_amount: paymentIntent.amount / 100,
                    reference_no: paymentIntent.id,
                    reference_date: new Date().toISOString().split('T')[0],
                    mode_of_payment: 'Stripe',
                    custom_stripe_payment_intent_id: paymentIntent.id,
                  });
                  
                  if (paymentResult?.name) {
                    await db.update(schema.stripeErpnextMapping)
                      .set({ 
                        erpnextPaymentEntry: paymentResult.name,
                        flowStatus: 'complete',
                        atualizadoEm: new Date(),
                      })
                      .where(eq(schema.stripeErpnextMapping.id, mapping.id));
                  }
                  
                  processingResult = { 
                    paymentIntentId: paymentIntent.id, 
                    amount: paymentIntent.amount,
                    invoice: mapping.erpnextSalesInvoice,
                    paymentCreated: true
                  };
                } catch (paymentError) {
                  logger.error({ error: paymentError, paymentIntentId: paymentIntent.id }, 
                    'Falha ao criar Payment Entry');
                }
              }
            } else {
              // Sem mapeamento encontrado - registrar apenas metadados
              logger.info({ paymentIntentId: paymentIntent.id }, 
                'Payment intent sem mapeamento - provavelmente processado por checkout.session.completed');
              processingResult = { 
                paymentIntentId: paymentIntent.id, 
                amount: paymentIntent.amount,
                note: 'No mapping found - may be handled by checkout.session.completed'
              };
            }
          }
          break;
        }

        case 'customer.created': {
          const customer = event.data.object as Stripe.Customer;
          
          // Sincronizar cliente com ERPNext
          await syncToERPNext('customer', {
            customer_name: customer.name || customer.email || customer.id,
            customer_type: 'Individual',
            customer_group: 'Individual',
            territory: 'Portugal',
            email_id: customer.email,
            custom_stripe_customer_id: customer.id,
          });
          processingResult = { customerId: customer.id };
          break;
        }
      }
    } catch (processingErr) {
      processingError = processingErr instanceof Error ? processingErr.message : String(processingErr);
      logger.error({ error: processingErr, eventId: event.id }, 'Erro ao processar webhook Stripe');
    }

    // Marcar webhook como processado (ou com erro)
    await markWebhookProcessed(db, 'stripe', event.id, processingResult, processingError);

    res.json({ received: true });
  } catch (error) {
    logger.error({ error }, 'Webhook error');
    res.status(400).json({ error: 'Webhook error' });
  }
});

app.get('/api/integrations/erpnext/test', requirePermission('integrations:erpnext:read'), async (_req: Request, res: Response) => {
  if (!config.ERPNEXT_URL) {
    return res.status(503).json({ error: 'ERPNext not configured' });
  }

  // RESILIÊNCIA: AbortController com timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXTERNAL_API_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.ERPNEXT_URL}/api/method/frappe.auth.get_logged_user`, {
      headers: {
        'Authorization': `token ${config.ERPNEXT_API_KEY}:${config.ERPNEXT_API_SECRET}`,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error('ERPNext connection failed');
    }

    const data = await response.json() as { message: string };
    res.json({ status: 'connected', user: data.message });
  } catch (error) {
    logger.error({ error }, 'ERPNext test failed');
    res.status(500).json({ error: 'ERPNext connection failed' });
  } finally {
    clearTimeout(timeoutId);
  }
});

app.get('/api/integrations/erpnext/customers', requirePermission('integrations:erpnext:read'), async (_req: Request, res: Response) => {
  if (!config.ERPNEXT_URL) {
    return res.status(503).json({ error: 'ERPNext not configured' });
  }

  // RESILIÊNCIA: AbortController com timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXTERNAL_API_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${config.ERPNEXT_URL}/api/resource/Customer?fields=["name","customer_name","customer_type","territory"]&limit_page_length=100`,
      {
        headers: {
          'Authorization': `token ${config.ERPNEXT_API_KEY}:${config.ERPNEXT_API_SECRET}`,
        },
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch customers');
    }

    const data = await response.json() as { data: unknown[] };
    res.json({ customers: data.data });
  } catch (error) {
    logger.error({ error }, 'Failed to fetch ERPNext customers');
    res.status(500).json({ error: 'Failed to fetch customers' });
  } finally {
    clearTimeout(timeoutId);
  }
});

app.get('/api/integrations/erpnext/items', requirePermission('integrations:erpnext:read'), async (_req: Request, res: Response) => {
  if (!config.ERPNEXT_URL) {
    return res.status(503).json({ error: 'ERPNext not configured' });
  }

  // RESILIÊNCIA: AbortController com timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXTERNAL_API_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${config.ERPNEXT_URL}/api/resource/Item?fields=["name","item_name","item_group","stock_uom","standard_rate"]&limit_page_length=100`,
      {
        headers: {
          'Authorization': `token ${config.ERPNEXT_API_KEY}:${config.ERPNEXT_API_SECRET}`,
        },
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch items');
    }

    const data = await response.json() as { data: unknown[] };
    res.json({ items: data.data });
  } catch (error) {
    logger.error({ error }, 'Failed to fetch ERPNext items');
    res.status(500).json({ error: 'Failed to fetch items' });
  } finally {
    clearTimeout(timeoutId);
  }
});

const erpNextCustomerCreateSchema = z.object({
  customerName: z.string().min(2),
  customerType: z.string().min(2),
  territory: z.string().min(2),
  email: z.string().email().optional(),
  phone: z.string().min(3).optional(),
  taxId: z.string().min(3).optional(),
});

app.post('/api/integrations/erpnext/customers', requirePermission('integrations:erpnext:write'), async (req: Request, res: Response) => {
  if (!config.ERPNEXT_URL) {
    return res.status(503).json({ error: 'ERPNext not configured' });
  }

  const parseResult = erpNextCustomerCreateSchema.safeParse(req.body);
  if (!parseResult.success) {
    logger.warn({ errors: parseResult.error.flatten() }, 'Input inválido em /api/integrations/erpnext/customers');
    return res.status(400).json({ error: 'Input inválido', details: parseResult.error.format() });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXTERNAL_API_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${config.ERPNEXT_URL}/api/resource/Customer`,
      {
        method: 'POST',
        headers: {
          'Authorization': `token ${config.ERPNEXT_API_KEY}:${config.ERPNEXT_API_SECRET}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          customer_name: parseResult.data.customerName,
          customer_type: parseResult.data.customerType,
          territory: parseResult.data.territory,
          email_id: parseResult.data.email,
          mobile_no: parseResult.data.phone,
          tax_id: parseResult.data.taxId,
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Failed to create customer: ${response.status} - ${errText}`);
    }

    const data = await response.json() as { data: unknown };
    res.json({ customer: data.data });
  } catch (error) {
    logger.error({ error }, 'Failed to create ERPNext customer');
    res.status(500).json({ error: 'Failed to create customer' });
  } finally {
    clearTimeout(timeoutId);
  }
});

app.get('/api/integrations/erpnext/invoices', requirePermission('integrations:erpnext:read'), async (req: Request, res: Response) => {
  if (!config.ERPNEXT_URL) {
    return res.status(503).json({ error: 'ERPNext not configured' });
  }

  const limit = Number(req.query.limit ?? 100);
  const safeLimit = Number.isFinite(limit) && limit > 0 && limit <= 200 ? limit : 100;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXTERNAL_API_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${config.ERPNEXT_URL}/api/resource/Sales%20Invoice?fields=["name","customer","grand_total","status","posting_date"]&limit_page_length=${safeLimit}`,
      {
        headers: {
          'Authorization': `token ${config.ERPNEXT_API_KEY}:${config.ERPNEXT_API_SECRET}`,
        },
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch invoices');
    }

    const data = await response.json() as { data: unknown[] };
    res.json({ invoices: data.data });
  } catch (error) {
    logger.error({ error }, 'Failed to fetch ERPNext invoices');
    res.status(500).json({ error: 'Failed to fetch invoices' });
  } finally {
    clearTimeout(timeoutId);
  }
});

app.get('/api/integrations/erpnext/customer-annual-billing', requirePermission('integrations:erpnext:read'), async (req: Request, res: Response) => {
  if (!config.ERPNEXT_URL) {
    return res.status(503).json({ error: 'ERPNext not configured' });
  }

  const customer = String(req.query.customer ?? '').trim();
  const yearParam = String(req.query.year ?? '').trim();
  const resolvedYear = yearParam ? Number(yearParam) : new Date().getFullYear();

  if (!customer) {
    return res.status(400).json({ error: 'Parâmetro customer é obrigatório' });
  }
  if (!Number.isFinite(resolvedYear) || resolvedYear < 2000 || resolvedYear > 2100) {
    return res.status(400).json({ error: 'Parâmetro year inválido' });
  }

  const startDate = `${resolvedYear}-01-01`;
  const endDate = `${resolvedYear}-12-31`;
  const fields = encodeURIComponent(JSON.stringify([
    'name',
    'customer',
    'grand_total',
    'base_grand_total',
    'currency',
    'base_currency',
    'posting_date',
    'docstatus',
  ]));
  const filters = encodeURIComponent(JSON.stringify([
    ['Sales Invoice', 'customer', '=', customer],
    ['Sales Invoice', 'docstatus', '=', 1],
    ['Sales Invoice', 'posting_date', '>=', startDate],
    ['Sales Invoice', 'posting_date', '<=', endDate],
  ]));

  const pageSize = 100;
  let offset = 0;
  let total = 0;
  let currency: string | null = null;
  let invoiceCount = 0;

  try {
    while (true) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), EXTERNAL_API_TIMEOUT_MS);
      const response = await fetch(
        `${config.ERPNEXT_URL}/api/resource/Sales%20Invoice?fields=${fields}&filters=${filters}&limit_start=${offset}&limit_page_length=${pageSize}`,
        {
          headers: {
            'Authorization': `token ${config.ERPNEXT_API_KEY}:${config.ERPNEXT_API_SECRET}`,
          },
          signal: controller.signal,
        }
      ).finally(() => clearTimeout(timeoutId));

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`Failed to fetch invoices: ${response.status} - ${errText}`);
      }

      const data = await response.json() as { data: Array<Record<string, unknown>> };
      const invoices = data.data ?? [];
      if (invoices.length === 0) {
        break;
      }

      for (const invoice of invoices) {
        const baseTotal = Number(invoice.base_grand_total);
        const grandTotal = Number(invoice.grand_total);
        const value = Number.isFinite(baseTotal) ? baseTotal : (Number.isFinite(grandTotal) ? grandTotal : 0);
        total += value;
        if (!currency) {
          currency = String(invoice.base_currency ?? invoice.currency ?? '').trim() || null;
        }
      }
      invoiceCount += invoices.length;
      offset += pageSize;
      if (invoices.length < pageSize) {
        break;
      }
    }

    res.json({
      customer,
      year: resolvedYear,
      total,
      currency: currency ?? 'BRL',
      invoiceCount,
    });
  } catch (error) {
    logger.error({ error, customer, year: resolvedYear }, 'Failed to calculate ERPNext annual billing');
    res.status(500).json({ error: 'Failed to calculate annual billing' });
  }
});

const erpNextInvoiceItemSchema = z.object({
  itemCode: z.string().min(2),
  qty: z.number().positive(),
  rate: z.number().positive(),
});

const erpNextInvoiceCreateSchema = z.object({
  customer: z.string().min(2),
  items: z.array(erpNextInvoiceItemSchema).min(1),
  dueDate: z.string().optional(),
});

app.post('/api/integrations/erpnext/invoices', requirePermission('integrations:erpnext:write'), async (req: Request, res: Response) => {
  if (!config.ERPNEXT_URL) {
    return res.status(503).json({ error: 'ERPNext not configured' });
  }

  const parseResult = erpNextInvoiceCreateSchema.safeParse(req.body);
  if (!parseResult.success) {
    logger.warn({ errors: parseResult.error.flatten() }, 'Input inválido em /api/integrations/erpnext/invoices');
    return res.status(400).json({ error: 'Input inválido', details: parseResult.error.format() });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXTERNAL_API_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${config.ERPNEXT_URL}/api/resource/Sales%20Invoice`,
      {
        method: 'POST',
        headers: {
          'Authorization': `token ${config.ERPNEXT_API_KEY}:${config.ERPNEXT_API_SECRET}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          customer: parseResult.data.customer,
          items: parseResult.data.items.map((item) => ({
            item_code: item.itemCode,
            qty: item.qty,
            rate: item.rate,
          })),
          due_date: parseResult.data.dueDate,
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Failed to create invoice: ${response.status} - ${errText}`);
    }

    const data = await response.json() as { data: unknown };
    res.json({ invoice: data.data });
  } catch (error) {
    logger.error({ error }, 'Failed to create ERPNext invoice');
    res.status(500).json({ error: 'Failed to create invoice' });
  } finally {
    clearTimeout(timeoutId);
  }
});

// ============================================================================
// ERPNext API Proxy (cobertura completa)
// ============================================================================

app.get('/api/integrations/erpnext/resource/:doctype', requirePermission('integrations:erpnext:read'), async (req: Request, res: Response) => {
  if (!config.ERPNEXT_URL || !config.ERPNEXT_API_KEY || !config.ERPNEXT_API_SECRET) {
    return res.status(503).json({ error: 'ERPNext not configured' });
  }

  try {
    const doctype = normalizeErpNextDoctype(req.params.doctype);
    if (!isErpNextAllowed(doctype, ERPNEXT_ALLOWED_DOCTYPES)) {
      return res.status(403).json({ error: 'DocType não permitido. Ajuste ERPNEXT_ALLOWED_DOCTYPES.' });
    }

    const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
    const fields = typeof req.query.fields === 'string' ? req.query.fields : undefined;
    const filters = typeof req.query.filters === 'string' ? req.query.filters : undefined;
    const limitStart = typeof req.query.limit_start === 'string' ? req.query.limit_start : undefined;
    const limitLength = typeof req.query.limit_page_length === 'string' ? req.query.limit_page_length : undefined;
    const orderBy = typeof req.query.order_by === 'string' ? req.query.order_by : undefined;

    const basePath = name
      ? `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`
      : `/api/resource/${encodeURIComponent(doctype)}`;

    const query = new URLSearchParams();
    if (fields) query.set('fields', fields);
    if (filters) query.set('filters', filters);
    if (limitStart) query.set('limit_start', limitStart);
    if (limitLength) query.set('limit_page_length', limitLength);
    if (orderBy) query.set('order_by', orderBy);

    const url = `${config.ERPNEXT_URL}${basePath}${query.toString() ? `?${query}` : ''}`;
    const result = await executeErpNextRequest<Record<string, unknown>>('erpnext.resource.read', {
      url,
      method: 'GET',
      headers: buildErpNextHeaders(),
    });

    res.json({ data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: message }, 'Falha ao consultar ERPNext resource');
    res.status(500).json({ error: message });
  }
});

app.post('/api/integrations/erpnext/resource/:doctype', requirePermission('integrations:erpnext:write'), async (req: Request, res: Response) => {
  if (!config.ERPNEXT_URL || !config.ERPNEXT_API_KEY || !config.ERPNEXT_API_SECRET) {
    return res.status(503).json({ error: 'ERPNext not configured' });
  }

  try {
    const doctype = normalizeErpNextDoctype(req.params.doctype);
    if (!isErpNextAllowed(doctype, ERPNEXT_ALLOWED_DOCTYPES)) {
      return res.status(403).json({ error: 'DocType não permitido. Ajuste ERPNEXT_ALLOWED_DOCTYPES.' });
    }

    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Payload inválido para criação' });
    }

    const url = `${config.ERPNEXT_URL}/api/resource/${encodeURIComponent(doctype)}`;
    const result = await executeErpNextRequest<Record<string, unknown>>('erpnext.resource.create', {
      url,
      method: 'POST',
      headers: buildErpNextHeaders(),
      body: JSON.stringify(req.body),
    });

    res.json({ data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: message }, 'Falha ao criar ERPNext resource');
    res.status(500).json({ error: message });
  }
});

app.put('/api/integrations/erpnext/resource/:doctype/:name', requirePermission('integrations:erpnext:write'), async (req: Request, res: Response) => {
  if (!config.ERPNEXT_URL || !config.ERPNEXT_API_KEY || !config.ERPNEXT_API_SECRET) {
    return res.status(503).json({ error: 'ERPNext not configured' });
  }

  try {
    const doctype = normalizeErpNextDoctype(req.params.doctype);
    if (!isErpNextAllowed(doctype, ERPNEXT_ALLOWED_DOCTYPES)) {
      return res.status(403).json({ error: 'DocType não permitido. Ajuste ERPNEXT_ALLOWED_DOCTYPES.' });
    }
    const name = req.params.name?.trim();
    if (!name) {
      return res.status(400).json({ error: 'Nome do registro obrigatório' });
    }
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Payload inválido para atualização' });
    }

    const url = `${config.ERPNEXT_URL}/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`;
    const result = await executeErpNextRequest<Record<string, unknown>>('erpnext.resource.update', {
      url,
      method: 'PUT',
      headers: buildErpNextHeaders(),
      body: JSON.stringify(req.body),
    });

    res.json({ data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: message }, 'Falha ao atualizar ERPNext resource');
    res.status(500).json({ error: message });
  }
});

app.delete('/api/integrations/erpnext/resource/:doctype/:name', requirePermission('integrations:erpnext:write'), async (req: Request, res: Response) => {
  if (!config.ERPNEXT_URL || !config.ERPNEXT_API_KEY || !config.ERPNEXT_API_SECRET) {
    return res.status(503).json({ error: 'ERPNext not configured' });
  }

  try {
    const doctype = normalizeErpNextDoctype(req.params.doctype);
    if (!isErpNextAllowed(doctype, ERPNEXT_ALLOWED_DOCTYPES)) {
      return res.status(403).json({ error: 'DocType não permitido. Ajuste ERPNEXT_ALLOWED_DOCTYPES.' });
    }
    const name = req.params.name?.trim();
    if (!name) {
      return res.status(400).json({ error: 'Nome do registro obrigatório' });
    }

    const url = `${config.ERPNEXT_URL}/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`;
    const result = await executeErpNextRequest<Record<string, unknown>>('erpnext.resource.delete', {
      url,
      method: 'DELETE',
      headers: buildErpNextHeaders(),
    });

    res.json({ data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: message }, 'Falha ao remover ERPNext resource');
    res.status(500).json({ error: message });
  }
});

app.post('/api/integrations/erpnext/method/:method', requirePermission('integrations:erpnext:write'), async (req: Request, res: Response) => {
  if (!config.ERPNEXT_URL || !config.ERPNEXT_API_KEY || !config.ERPNEXT_API_SECRET) {
    return res.status(503).json({ error: 'ERPNext not configured' });
  }

  try {
    const methodName = normalizeErpNextMethod(req.params.method);
    if (!isErpNextAllowed(methodName, ERPNEXT_ALLOWED_METHODS)) {
      return res.status(403).json({ error: 'Method não permitido. Ajuste ERPNEXT_ALLOWED_METHODS.' });
    }

    const url = `${config.ERPNEXT_URL}/api/method/${encodeURIComponent(methodName)}`;
    const result = await executeErpNextRequest<Record<string, unknown>>('erpnext.method.call', {
      url,
      method: 'POST',
      headers: buildErpNextHeaders(),
      body: JSON.stringify(req.body ?? {}),
    });

    res.json({ data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: message }, 'Falha ao executar método ERPNext');
    res.status(500).json({ error: message });
  }
});

// ============================================================================
// GRAFANA API (Dashboards) - Read/Write via Integrations Service
// ============================================================================

app.get('/api/integrations/grafana/health', requirePermission('integrations:grafana:read'), async (_req: Request, res: Response) => {
  try {
    const data = await executeGrafanaRequest<{ database?: string; version?: string }>('GET', '/api/health');
    res.json({ success: true, data });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Falha ao consultar health do Grafana');
    res.status(500).json({ error: errorMessage });
  }
});

app.get('/api/integrations/grafana/dashboards', requirePermission('integrations:grafana:read'), async (req: Request, res: Response) => {
  try {
    const querySchema = z.object({
      query: z.string().optional(),
      tag: z.string().optional(),
      folderId: z.coerce.number().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    });
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Query inválida', details: parsed.error.flatten() });
      return;
    }
    const params = new URLSearchParams();
    params.set('type', 'dash-db');
    if (parsed.data.query) params.set('query', parsed.data.query);
    if (parsed.data.tag) params.set('tag', parsed.data.tag);
    if (parsed.data.folderId !== undefined) params.set('folderIds', parsed.data.folderId.toString());
    if (parsed.data.limit !== undefined) params.set('limit', parsed.data.limit.toString());

    const data = await executeGrafanaRequest<Array<{ id: number; uid: string; title: string; url: string }>>(
      'GET',
      `/api/search?${params.toString()}`
    );
    res.json({ success: true, data });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Falha ao listar dashboards do Grafana');
    res.status(500).json({ error: errorMessage });
  }
});

app.get('/api/integrations/grafana/dashboards/:uid', requirePermission('integrations:grafana:read'), async (req: Request, res: Response) => {
  try {
    const uid = req.params.uid;
    if (!uid) {
      res.status(400).json({ error: 'UID inválido' });
      return;
    }
    const data = await executeGrafanaRequest<{ dashboard: Record<string, unknown> }>('GET', `/api/dashboards/uid/${uid}`);
    res.json({ success: true, data });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Falha ao obter dashboard do Grafana');
    res.status(500).json({ error: errorMessage });
  }
});

app.post('/api/integrations/grafana/dashboards', requirePermission('integrations:grafana:write'), async (req: Request, res: Response) => {
  try {
    const bodySchema = z.object({
      dashboard: z.record(z.unknown()),
      folderId: z.number().int().optional(),
      folderUid: z.string().optional(),
      message: z.string().optional(),
      overwrite: z.boolean().optional(),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
      return;
    }
    if (!parsed.data.dashboard || Object.keys(parsed.data.dashboard).length === 0) {
      res.status(400).json({ error: 'Dashboard inválido (vazio).' });
      return;
    }
    const payload = {
      dashboard: parsed.data.dashboard,
      folderId: parsed.data.folderId,
      folderUid: parsed.data.folderUid,
      message: parsed.data.message ?? 'Atualizado via Alice Chat',
      overwrite: parsed.data.overwrite ?? true,
    };
    const data = await executeGrafanaRequest<Record<string, unknown>>('POST', '/api/dashboards/db', payload);
    logger.info({ dashboard: (parsed.data.dashboard as { title?: string }).title ?? 'unknown' }, 'Dashboard Grafana atualizado');
    res.json({ success: true, data });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Falha ao atualizar dashboard do Grafana');
    res.status(500).json({ error: errorMessage });
  }
});

const githubDeploySchema = z.object({
  stack: z.enum(['infra', 'alice', 'observability', 'erpnext', 'backup', 'all']),
  version: z.string().min(2),
  rollback: z.boolean().optional(),
  rollbackVersion: z.string().optional(),
  dryRun: z.boolean().optional(),
  smartDeploy: z.boolean().optional(),
});

app.post('/api/integrations/github/deploy-stack', requirePermission('admin:alice_core:write'), async (req: Request, res: Response) => {
  if (!GH_PAT || !GH_REPO) {
    return res.status(503).json({ error: 'GitHub Actions not configured' });
  }

  const parseResult = githubDeploySchema.safeParse(req.body);
  if (!parseResult.success) {
    logger.warn({ errors: parseResult.error.flatten() }, 'Input inválido em /api/integrations/github/deploy-stack');
    return res.status(400).json({ error: 'Input inválido', details: parseResult.error.format() });
  }

  const payload = {
    ref: 'main',
    inputs: {
      stack: parseResult.data.stack,
      version: parseResult.data.version,
      rollback: parseResult.data.rollback ? 'true' : 'false',
      rollback_version: parseResult.data.rollbackVersion ?? '',
      dry_run: parseResult.data.dryRun ? 'true' : 'false',
      smart_deploy: parseResult.data.smartDeploy ? 'true' : 'false',
    },
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXTERNAL_API_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await fetch(
      `${GH_API_URL}/repos/${GH_REPO}/actions/workflows/deploy-stack-modular.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GH_PAT}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`GitHub Actions dispatch failed: ${response.status} - ${errText}`);
    }

    res.json({
      status: 'queued',
      workflow: 'deploy-stack-modular.yml',
      inputs: payload.inputs,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    logger.error({ error }, 'Falha ao disparar workflow deploy-stack-modular');
    res.status(500).json({
      error: 'Falha ao disparar workflow',
      durationMs: Date.now() - startedAt,
    });
  } finally {
    clearTimeout(timeoutId);
  }
});

// =============================================================================
// GMAIL SMTP API - Emails Transacionais (30/12/2025)
// =============================================================================
// Substituiu Resend. Usa Gmail SMTP com App Password.
// Ref: https://support.google.com/accounts/answer/185833
// =============================================================================

/**
 * Schema de validação para envio de email
 * Suporta envio para múltiplos destinatários
 */
const emailSchema = z.object({
  to: z.union([
    z.string().trim().email(),
    z.array(z.string().trim().email()).min(1).max(50), // Máximo 50 destinatários por envio
  ]),
  subject: z.string().min(1).max(200),
  html: z.string().min(1).max(100000), // Máximo 100KB de HTML
  text: z.string().optional(), // Versão texto plano (opcional, recomendado para acessibilidade)
  from: z.string().trim().email().optional(), // Se não informado, usa GMAIL_USER
  replyTo: z.string().trim().email().optional(),
  // Metadados para rastreamento
  metadata: z.object({
    type: z.enum(['receipt', 'invoice', 'promotion', 'notification', 'alert', 'other']).optional(),
    orderId: z.string().optional(),
    customerId: z.string().optional(),
    tenantId: z.string().uuid().optional(),
  }).optional(),
});

/**
 * POST /api/integrations/email/send
 * Envia email transacional via Gmail SMTP
 * 
 * Usado para:
 * - Comprovantes de vendas e pagamentos
 * - Faturas e recibos
 * - Notificações de pedidos
 * - Promoções e campanhas
 * - Alertas do sistema
 */
app.post('/api/integrations/email/send', requirePermission('integrations:email:write'), async (req: Request, res: Response) => {
  const parsed = emailSchema.safeParse(req.body);
  if (!parsed.success) {
    logger.warn({ errors: parsed.error.flatten() }, 'Payload inválido para email');
    return res.status(400).json({ error: 'Payload inválido', details: parsed.error.format() });
  }

  if (!emailTransporter) {
    logger.error('Gmail SMTP não configurado');
    return res.status(503).json({ error: 'Serviço de email não configurado' });
  }

  const { to, subject, html, text, from, replyTo, metadata } = parsed.data;
  const fromEmail = from ?? GMAIL_USER;

  try {
    const result = await observeIntegrationCall({
      integration: 'email',
      operation: 'send',
      fn: () => emailTransporter.sendMail({
        from: fromEmail,
        to: Array.isArray(to) ? to.join(', ') : to,
        subject,
        html,
        text: text ?? undefined,
        replyTo: replyTo ?? undefined,
      }),
    });

    logger.info({ 
      messageId: result.messageId,
      to: Array.isArray(to) ? to.length : 1,
      subject,
      from: fromEmail,
      type: metadata?.type ?? 'other',
      orderId: metadata?.orderId,
    }, 'Email enviado via Gmail SMTP');

    res.json({ 
      success: true, 
      messageId: result.messageId,
      accepted: result.accepted,
      rejected: result.rejected,
    });
  } catch (error) {
    logger.error({ error, to, subject }, 'Falha ao enviar email via Gmail SMTP');
    res.status(500).json({ error: 'Falha ao enviar email' });
  }
});

/**
 * GET /api/integrations/email/health
 * Verifica saúde do serviço de email
 */
app.get('/api/integrations/email/health', requirePermission('integrations:email:read'), async (_req: Request, res: Response) => {
  if (!emailTransporter) {
    return res.status(503).json({ 
      status: 'unavailable',
      configured: false,
      message: 'Gmail SMTP não configurado',
    });
  }

  try {
    await emailTransporter.verify();
    res.json({
      status: 'healthy',
      configured: true,
      smtp: {
        host: 'smtp.gmail.com',
        port: 587,
        user: GMAIL_USER,
      },
    });
  } catch (error) {
    logger.error({ error }, 'Gmail SMTP health check falhou');
    res.status(503).json({
      status: 'unhealthy',
      configured: true,
      error: 'Falha na conexão SMTP',
    });
  }
});

// ============================================================
// WISE API - Pagamentos Globais
// Documentação: https://docs.wise.com/api-docs/
// ============================================================

type WiseAuthContext = AuthContext & { tenantId: string };

function getWiseAuthContext(req: Request): WiseAuthContext {
  const auth = req.user as AuthContext | undefined;
  if (!auth?.tenantId) {
    throw new Error('Contexto de tenant não encontrado.');
  }
  return auth as WiseAuthContext;
}

async function upsertWiseProfiles(tenantId: string, profiles: Array<{ id: number; type?: string; details?: unknown }>): Promise<void> {
  if (!profiles.length) return;
  const db = getDatabase();
  const now = new Date();
  for (const profile of profiles) {
    await db.insert(schema.wiseProfiles).values({
      tenantId,
      wiseProfileId: profile.id,
      type: profile.type ?? null,
      details: (profile.details ?? {}) as Record<string, unknown>,
      data: profile as Record<string, unknown>,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [schema.wiseProfiles.tenantId, schema.wiseProfiles.wiseProfileId],
      set: {
        type: profile.type ?? null,
        details: (profile.details ?? {}) as Record<string, unknown>,
        data: profile as Record<string, unknown>,
        updatedAt: now,
      },
    });
  }
}

async function upsertWiseUsers(tenantId: string, users: Array<{ id: number; email?: string; name?: string; active?: boolean }>): Promise<void> {
  if (!users.length) return;
  const db = getDatabase();
  const now = new Date();
  for (const user of users) {
    await db.insert(schema.wiseUsers).values({
      tenantId,
      wiseUserId: user.id,
      email: user.email ?? null,
      name: user.name ?? null,
      active: user.active ?? true,
      data: user as Record<string, unknown>,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [schema.wiseUsers.tenantId, schema.wiseUsers.wiseUserId],
      set: {
        email: user.email ?? null,
        name: user.name ?? null,
        active: user.active ?? true,
        data: user as Record<string, unknown>,
        updatedAt: now,
      },
    });
  }
}

async function upsertWiseBalances(tenantId: string, balances: Array<{
  id: number;
  currency: string;
  type?: string;
  name?: string | null;
  amount?: unknown;
  reservedAmount?: unknown;
  totalWorth?: unknown;
}>): Promise<void> {
  if (!balances.length) return;
  const db = getDatabase();
  const now = new Date();
  for (const balance of balances) {
    await db.insert(schema.wiseBalances).values({
      tenantId,
      wiseBalanceId: balance.id,
      currency: balance.currency,
      type: balance.type ?? null,
      name: balance.name ?? null,
      amount: balance.amount as Record<string, unknown> | undefined,
      reservedAmount: balance.reservedAmount as Record<string, unknown> | undefined,
      totalWorth: balance.totalWorth as Record<string, unknown> | undefined,
      data: balance as Record<string, unknown>,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [schema.wiseBalances.tenantId, schema.wiseBalances.wiseBalanceId],
      set: {
        currency: balance.currency,
        type: balance.type ?? null,
        name: balance.name ?? null,
        amount: balance.amount as Record<string, unknown> | undefined,
        reservedAmount: balance.reservedAmount as Record<string, unknown> | undefined,
        totalWorth: balance.totalWorth as Record<string, unknown> | undefined,
        data: balance as Record<string, unknown>,
        updatedAt: now,
      },
    });
  }
}

async function upsertWiseRecipients(tenantId: string, recipients: Array<{
  id: number;
  currency?: string;
  type?: string;
  accountHolderName?: string;
  active?: boolean;
}>): Promise<void> {
  if (!recipients.length) return;
  const db = getDatabase();
  const now = new Date();
  for (const recipient of recipients) {
    await db.insert(schema.wiseRecipients).values({
      tenantId,
      wiseRecipientId: recipient.id,
      currency: recipient.currency ?? null,
      type: recipient.type ?? null,
      accountHolderName: recipient.accountHolderName ?? null,
      active: recipient.active ?? true,
      data: recipient as Record<string, unknown>,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [schema.wiseRecipients.tenantId, schema.wiseRecipients.wiseRecipientId],
      set: {
        currency: recipient.currency ?? null,
        type: recipient.type ?? null,
        accountHolderName: recipient.accountHolderName ?? null,
        active: recipient.active ?? true,
        data: recipient as Record<string, unknown>,
        updatedAt: now,
      },
    });
  }
}

async function upsertWiseQuotes(tenantId: string, quote: { id: string; sourceCurrency?: string; targetCurrency?: string; sourceAmount?: number; targetAmount?: number; rate?: number; fee?: number }): Promise<void> {
  const db = getDatabase();
  await db.insert(schema.wiseQuotes).values({
    tenantId,
    wiseQuoteId: quote.id,
    sourceCurrency: quote.sourceCurrency ?? null,
    targetCurrency: quote.targetCurrency ?? null,
    sourceAmount: quote.sourceAmount ?? null,
    targetAmount: quote.targetAmount ?? null,
    rate: quote.rate ?? null,
    fee: quote.fee ?? null,
    data: quote as Record<string, unknown>,
  }).onConflictDoUpdate({
    target: [schema.wiseQuotes.tenantId, schema.wiseQuotes.wiseQuoteId],
    set: {
      sourceCurrency: quote.sourceCurrency ?? null,
      targetCurrency: quote.targetCurrency ?? null,
      sourceAmount: quote.sourceAmount ?? null,
      targetAmount: quote.targetAmount ?? null,
      rate: quote.rate ?? null,
      fee: quote.fee ?? null,
      data: quote as Record<string, unknown>,
    },
  });
}

async function upsertWiseTransfers(tenantId: string, transfers: Array<{ id: number; status?: string; sourceCurrency?: string; targetCurrency?: string; sourceAmount?: number; targetAmount?: number; customerTransactionId?: string }>): Promise<void> {
  if (!transfers.length) return;
  const db = getDatabase();
  const now = new Date();
  for (const transfer of transfers) {
    await db.insert(schema.wiseTransfers).values({
      tenantId,
      wiseTransferId: transfer.id,
      status: transfer.status ?? null,
      sourceCurrency: transfer.sourceCurrency ?? null,
      targetCurrency: transfer.targetCurrency ?? null,
      sourceValue: transfer.sourceAmount ?? null,
      targetValue: transfer.targetAmount ?? null,
      customerTransactionId: transfer.customerTransactionId ?? null,
      data: transfer as Record<string, unknown>,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [schema.wiseTransfers.tenantId, schema.wiseTransfers.wiseTransferId],
      set: {
        status: transfer.status ?? null,
        sourceCurrency: transfer.sourceCurrency ?? null,
        targetCurrency: transfer.targetCurrency ?? null,
        sourceValue: transfer.sourceAmount ?? null,
        targetValue: transfer.targetAmount ?? null,
        customerTransactionId: transfer.customerTransactionId ?? null,
        data: transfer as Record<string, unknown>,
        updatedAt: now,
      },
    });
  }
}

async function upsertWiseCards(tenantId: string, cards: Array<{ token?: string; cardToken?: string; status?: string; type?: string }>): Promise<void> {
  if (!cards.length) return;
  const db = getDatabase();
  const now = new Date();
  for (const card of cards) {
    const cardToken = card.token ?? card.cardToken;
    if (!cardToken) continue;
    await db.insert(schema.wiseCards).values({
      tenantId,
      wiseCardToken: cardToken,
      status: card.status ?? null,
      type: card.type ?? null,
      data: card as Record<string, unknown>,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [schema.wiseCards.tenantId, schema.wiseCards.wiseCardToken],
      set: {
        status: card.status ?? null,
        type: card.type ?? null,
        data: card as Record<string, unknown>,
        updatedAt: now,
      },
    });
  }
}

async function upsertWiseCardOrders(tenantId: string, cardOrders: Array<{ id?: string; orderId?: string; status?: string; type?: string }>): Promise<void> {
  if (!cardOrders.length) return;
  const db = getDatabase();
  const now = new Date();
  for (const order of cardOrders) {
    const cardOrderId = order.id ?? order.orderId;
    if (!cardOrderId) continue;
    await db.insert(schema.wiseCardOrders).values({
      tenantId,
      wiseCardOrderId: cardOrderId,
      status: order.status ?? null,
      type: order.type ?? null,
      data: order as Record<string, unknown>,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [schema.wiseCardOrders.tenantId, schema.wiseCardOrders.wiseCardOrderId],
      set: {
        status: order.status ?? null,
        type: order.type ?? null,
        data: order as Record<string, unknown>,
        updatedAt: now,
      },
    });
  }
}

async function upsertWiseCardTransactions(tenantId: string, transactions: Array<{ id?: string; transactionId?: string; cardToken?: string; status?: string; amount?: unknown; occurredAt?: string }>): Promise<void> {
  if (!transactions.length) return;
  const db = getDatabase();
  for (const transaction of transactions) {
    const transactionId = transaction.id ?? transaction.transactionId;
    if (!transactionId) continue;
    await db.insert(schema.wiseCardTransactions).values({
      tenantId,
      wiseTransactionId: transactionId,
      wiseCardToken: transaction.cardToken ?? null,
      status: transaction.status ?? null,
      amount: transaction.amount as Record<string, unknown> | undefined,
      occurredAt: transaction.occurredAt ? new Date(transaction.occurredAt) : null,
      data: transaction as Record<string, unknown>,
    }).onConflictDoUpdate({
      target: [schema.wiseCardTransactions.tenantId, schema.wiseCardTransactions.wiseTransactionId],
      set: {
        wiseCardToken: transaction.cardToken ?? null,
        status: transaction.status ?? null,
        amount: transaction.amount as Record<string, unknown> | undefined,
        occurredAt: transaction.occurredAt ? new Date(transaction.occurredAt) : null,
        data: transaction as Record<string, unknown>,
      },
    });
  }
}

async function upsertWiseSpendControls(tenantId: string, rules: Array<{ id?: number; ruleId?: number; type?: string; operation?: string; description?: string; values?: unknown }>): Promise<void> {
  if (!rules.length) return;
  const db = getDatabase();
  for (const rule of rules) {
    const ruleId = rule.id ?? rule.ruleId;
    if (!ruleId) continue;
    await db.insert(schema.wiseSpendControls).values({
      tenantId,
      wiseRuleId: ruleId,
      type: rule.type ?? null,
      operation: rule.operation ?? null,
      description: rule.description ?? null,
      values: rule.values as Record<string, unknown> | undefined,
      data: rule as Record<string, unknown>,
    }).onConflictDoUpdate({
      target: [schema.wiseSpendControls.tenantId, schema.wiseSpendControls.wiseRuleId],
      set: {
        type: rule.type ?? null,
        operation: rule.operation ?? null,
        description: rule.description ?? null,
        values: rule.values as Record<string, unknown> | undefined,
        data: rule as Record<string, unknown>,
      },
    });
  }
}

async function upsertWiseDisputes(tenantId: string, disputes: Array<{ id?: string; disputeId?: string; status?: string }>): Promise<void> {
  if (!disputes.length) return;
  const db = getDatabase();
  const now = new Date();
  for (const dispute of disputes) {
    const disputeId = dispute.id ?? dispute.disputeId;
    if (!disputeId) continue;
    await db.insert(schema.wiseDisputes).values({
      tenantId,
      wiseDisputeId: disputeId,
      status: dispute.status ?? null,
      data: dispute as Record<string, unknown>,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [schema.wiseDisputes.tenantId, schema.wiseDisputes.wiseDisputeId],
      set: {
        status: dispute.status ?? null,
        data: dispute as Record<string, unknown>,
        updatedAt: now,
      },
    });
  }
}

async function upsertWiseActivities(tenantId: string, activities: Array<{ id?: string; resourceType?: string; status?: string; occurredAt?: string }>): Promise<void> {
  if (!activities.length) return;
  const db = getDatabase();
  for (const activity of activities) {
    await db.insert(schema.wiseActivities).values({
      tenantId,
      wiseActivityId: activity.id ?? null,
      resourceType: activity.resourceType ?? null,
      status: activity.status ?? null,
      occurredAt: activity.occurredAt ? new Date(activity.occurredAt) : null,
      data: activity as Record<string, unknown>,
    }).onConflictDoNothing();
  }
}

async function upsertWiseKycReviews(tenantId: string, reviews: Array<{ id?: string; kycReviewId?: string; status?: string; link?: string; requiredBy?: string }>): Promise<void> {
  if (!reviews.length) return;
  const db = getDatabase();
  const now = new Date();
  for (const review of reviews) {
    const reviewId = review.id ?? review.kycReviewId;
    if (!reviewId) continue;
    await db.insert(schema.wiseKycReviews).values({
      tenantId,
      wiseKycReviewId: reviewId,
      status: review.status ?? null,
      linkUrl: review.link ?? null,
      requiredBy: review.requiredBy ? new Date(review.requiredBy) : null,
      data: review as Record<string, unknown>,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [schema.wiseKycReviews.tenantId, schema.wiseKycReviews.wiseKycReviewId],
      set: {
        status: review.status ?? null,
        linkUrl: review.link ?? null,
        requiredBy: review.requiredBy ? new Date(review.requiredBy) : null,
        data: review as Record<string, unknown>,
        updatedAt: now,
      },
    });
  }
}

async function upsertWiseWebhookSubscriptions(tenantId: string, subscriptions: Array<{ id?: string; subscriptionId?: string; scopeDomain?: string; scopeId?: string; triggerOn?: string; delivery?: { url?: string; version?: string } }>): Promise<void> {
  if (!subscriptions.length) return;
  const db = getDatabase();
  for (const sub of subscriptions) {
    const subscriptionId = sub.id ?? sub.subscriptionId;
    if (!subscriptionId) continue;
    await db.insert(schema.wiseWebhookSubscriptions).values({
      tenantId,
      wiseSubscriptionId: subscriptionId,
      scopeDomain: sub.scopeDomain ?? null,
      scopeId: sub.scopeId ?? null,
      triggerOn: sub.triggerOn ?? null,
      deliveryUrl: sub.delivery?.url ?? null,
      deliveryVersion: sub.delivery?.version ?? null,
      data: sub as Record<string, unknown>,
    }).onConflictDoUpdate({
      target: [schema.wiseWebhookSubscriptions.tenantId, schema.wiseWebhookSubscriptions.wiseSubscriptionId],
      set: {
        scopeDomain: sub.scopeDomain ?? null,
        scopeId: sub.scopeId ?? null,
        triggerOn: sub.triggerOn ?? null,
        deliveryUrl: sub.delivery?.url ?? null,
        deliveryVersion: sub.delivery?.version ?? null,
        data: sub as Record<string, unknown>,
      },
    });
  }
}

async function insertWiseWebhookEvent(params: {
  tenantId?: string | null;
  deliveryId?: string;
  subscriptionId?: string;
  eventType?: string;
  schemaVersion?: string;
  sentAt?: string;
  signatureValid: boolean;
  payload: Record<string, unknown>;
}): Promise<void> {
  const db = getDatabase();
  await db.insert(schema.wiseWebhookEvents).values({
    tenantId: params.tenantId ?? null,
    deliveryId: params.deliveryId ?? null,
    subscriptionId: params.subscriptionId ?? null,
    eventType: params.eventType ?? null,
    schemaVersion: params.schemaVersion ?? null,
    sentAt: params.sentAt ? new Date(params.sentAt) : null,
    signatureValid: params.signatureValid,
    payload: params.payload,
  });
}

// Obter saldos multi-moeda
app.get('/api/integrations/wise/balances', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  try {
    const auth = getWiseAuthContext(req);
    const queryResult = wiseBalancesQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      logger.warn({ errors: queryResult.error.flatten() }, 'Input inválido em /api/integrations/wise/balances');
      return res.status(400).json({ error: 'Parâmetros inválidos', details: queryResult.error.format() });
    }

    const allowedTypes = ['STANDARD', 'SAVINGS'] as const;
    const rawTypes = queryResult.data.types
      ? queryResult.data.types.split(',').map((value) => value.trim()).filter(Boolean)
      : [...allowedTypes];
    const types = rawTypes.filter((type): type is (typeof allowedTypes)[number] => allowedTypes.includes(type as (typeof allowedTypes)[number]));
    if (types.length !== rawTypes.length) {
      return res.status(400).json({ error: 'Tipos inválidos. Use STANDARD e/ou SAVINGS.' });
    }

    const balances = await wiseService.getBalances(types);
    await upsertWiseBalances(auth.tenantId, balances);
    res.json({ balances, sandbox: wiseService.isSandboxMode() });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter saldos Wise');
    res.status(500).json({ error: 'Falha ao obter saldos' });
  }
});

// Criar saldo
app.post('/api/integrations/wise/balances', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  const parsed = wiseBalanceCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
  }

  try {
    const auth = getWiseAuthContext(req);
    const balance = await wiseService.createBalance(parsed.data);
    await upsertWiseBalances(auth.tenantId, [balance]);
    res.json({ balance });
  } catch (error) {
    logger.error({ error }, 'Falha ao criar saldo Wise');
    res.status(500).json({ error: 'Falha ao criar saldo' });
  }
});

// Remover saldo
app.delete('/api/integrations/wise/balances/:balanceId', requirePermission('integrations:wise:delete'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  const parsed = balanceIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ error: 'balanceId inválido', details: parsed.error.format() });
  }

  try {
    const auth = getWiseAuthContext(req);
    const balance = await wiseService.deleteBalance(parsed.data.balanceId);
    await getDatabase().delete(schema.wiseBalances).where(
      and(
        eq(schema.wiseBalances.tenantId, auth.tenantId),
        eq(schema.wiseBalances.wiseBalanceId, parsed.data.balanceId)
      )
    );
    res.json({ balance });
  } catch (error) {
    logger.error({ error }, 'Falha ao remover saldo Wise');
    res.status(500).json({ error: 'Falha ao remover saldo' });
  }
});

// Extrato de saldo
app.get('/api/integrations/wise/balances/:balanceId/statement', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  const balanceParsed = balanceIdParamSchema.safeParse(req.params);
  if (!balanceParsed.success) {
    return res.status(400).json({ error: 'balanceId inválido', details: balanceParsed.error.format() });
  }

  const queryParsed = wiseBalanceStatementQuerySchema.safeParse(req.query);
  if (!queryParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: queryParsed.error.format() });
  }

  try {
    const statement = await wiseService.getBalanceStatement({
      balanceId: balanceParsed.data.balanceId,
      currency: queryParsed.data.currency,
      intervalStart: queryParsed.data.intervalStart,
      intervalEnd: queryParsed.data.intervalEnd,
      type: queryParsed.data.type,
    });
    res.json({ statement });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter extrato Wise');
    res.status(500).json({ error: 'Falha ao obter extrato' });
  }
});

// Limite de depósito
app.get('/api/integrations/wise/balance-capacity', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  const queryParsed = wiseCurrencyQuerySchema.safeParse(req.query);
  if (!queryParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: queryParsed.error.format() });
  }

  try {
    const capacity = await wiseService.getBalanceCapacity(queryParsed.data.currency);
    res.json({ capacity });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter limite de depósito Wise');
    res.status(500).json({ error: 'Falha ao obter limite de depósito' });
  }
});

// Total de fundos
app.get('/api/integrations/wise/total-funds', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  const queryParsed = wiseCurrencyQuerySchema.safeParse(req.query);
  if (!queryParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: queryParsed.error.format() });
  }

  try {
    const total = await wiseService.getTotalFunds(queryParsed.data.currency);
    res.json({ total });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter total de fundos Wise');
    res.status(500).json({ error: 'Falha ao obter total de fundos' });
  }
});

// Obter taxas de câmbio
app.get('/api/integrations/wise/rates', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  // OWASP API3: Validação Zod obrigatória de query params
  const queryResult = wiseRatesQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    logger.warn({ errors: queryResult.error.flatten() }, 'Input inválido em /api/integrations/wise/rates');
    return res.status(400).json({ error: 'Parâmetros inválidos', details: queryResult.error.format() });
  }

  const { source, target } = queryResult.data;

  try {
    const rate = await wiseService.getExchangeRates(source, target);
    res.json({ rate });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter taxa de câmbio Wise');
    res.status(500).json({ error: 'Falha ao obter taxa de câmbio' });
  }
});

// Criar cotação
app.post('/api/integrations/wise/quotes', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  const parsed = wiseQuoteCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
  }

  try {
    const auth = getWiseAuthContext(req);
    const quote = await wiseService.createQuote({
      sourceCurrency: parsed.data.sourceCurrency,
      targetCurrency: parsed.data.targetCurrency,
      sourceAmount: parsed.data.sourceAmount,
      targetAmount: parsed.data.targetAmount,
      payOut: parsed.data.payOut,
      preferredPayIn: parsed.data.preferredPayIn,
      targetAccount: parsed.data.targetAccount,
    });
    await upsertWiseQuotes(auth.tenantId, quote);
    res.json({ quote });
  } catch (error) {
    logger.error({ error }, 'Falha ao criar cotação Wise');
    res.status(500).json({ error: 'Falha ao criar cotação' });
  }
});

// Criar cotação para conversão de saldo
app.post('/api/integrations/wise/balance-quotes', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  const parsed = wiseQuoteCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
  }

  try {
    const auth = getWiseAuthContext(req);
    const quote = await wiseService.createQuote({
      sourceCurrency: parsed.data.sourceCurrency,
      targetCurrency: parsed.data.targetCurrency,
      sourceAmount: parsed.data.sourceAmount,
      targetAmount: parsed.data.targetAmount,
      payOut: 'BALANCE',
      preferredPayIn: 'BALANCE',
    });
    await upsertWiseQuotes(auth.tenantId, quote);
    res.json({ quote });
  } catch (error) {
    logger.error({ error }, 'Falha ao criar cotação de conversão Wise');
    res.status(500).json({ error: 'Falha ao criar cotação de conversão' });
  }
});

// Executar conversão ou movimento de saldo
app.post('/api/integrations/wise/balance-movements', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  const parsed = wiseBalanceMovementSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
  }

  try {
    const movement = await wiseService.createBalanceMovement(parsed.data);
    res.json({ movement });
  } catch (error) {
    logger.error({ error }, 'Falha ao executar movimento de saldo Wise');
    res.status(500).json({ error: 'Falha ao executar movimento de saldo' });
  }
});

// Listar destinatários
app.get('/api/integrations/wise/recipients', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  // OWASP API3: Validação Zod de query params (currency é opcional)
  const queryResult = wiseRecipientsQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    logger.warn({ errors: queryResult.error.flatten() }, 'Input inválido em /api/integrations/wise/recipients');
    return res.status(400).json({ error: 'Parâmetros inválidos', details: queryResult.error.format() });
  }

  const { currency } = queryResult.data;

  try {
    const auth = getWiseAuthContext(req);
    const recipients = await wiseService.listRecipients(currency);
    await upsertWiseRecipients(auth.tenantId, recipients);
    res.json({ recipients });
  } catch (error) {
    logger.error({ error }, 'Falha ao listar destinatários Wise');
    res.status(500).json({ error: 'Falha ao listar destinatários' });
  }
});

// Criar destinatário
app.post('/api/integrations/wise/recipients', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  const { currency, type, accountHolderName, details } = req.body;

  try {
    const auth = getWiseAuthContext(req);
    const recipient = await wiseService.createRecipient({
      currency,
      type,
      accountHolderName,
      details,
    });
    await upsertWiseRecipients(auth.tenantId, [recipient]);
    res.json({ recipient });
  } catch (error) {
    logger.error({ error }, 'Falha ao criar destinatário Wise');
    res.status(500).json({ error: 'Falha ao criar destinatário' });
  }
});

// Obter destinatário por ID
app.get('/api/integrations/wise/recipients/:id', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  // OWASP API3: Validação de parâmetro de rota
  const paramResult = numericIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    return res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
  }

  try {
    const auth = getWiseAuthContext(req);
    const recipient = await wiseService.getRecipient(paramResult.data.id);
    await upsertWiseRecipients(auth.tenantId, [recipient]);
    res.json({ recipient });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter destinatário Wise');
    res.status(500).json({ error: 'Falha ao obter destinatário' });
  }
});

// Excluir destinatário
app.delete('/api/integrations/wise/recipients/:id', requirePermission('integrations:wise:delete'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  // OWASP API3: Validação de parâmetro de rota
  const paramResult = numericIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    return res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
  }

  try {
    const auth = getWiseAuthContext(req);
    await wiseService.deleteRecipient(paramResult.data.id);
    await getDatabase().delete(schema.wiseRecipients).where(
      and(
        eq(schema.wiseRecipients.tenantId, auth.tenantId),
        eq(schema.wiseRecipients.wiseRecipientId, paramResult.data.id)
      )
    );
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Falha ao excluir destinatário Wise');
    res.status(500).json({ error: 'Falha ao excluir destinatário' });
  }
});

// Listar transferências
app.get('/api/integrations/wise/transfers', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  // OWASP API3: Validação de query params de paginação
  const queryResult = paginationQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: queryResult.error.format() });
  }
  const limit = queryResult.data.limit ?? 20;
  const offset = queryResult.data.offset ?? 0;

  try {
    const auth = getWiseAuthContext(req);
    const transfers = await wiseService.listTransfers(limit, offset);
    await upsertWiseTransfers(auth.tenantId, transfers);
    res.json({ transfers });
  } catch (error) {
    logger.error({ error }, 'Falha ao listar transferências Wise');
    res.status(500).json({ error: 'Falha ao listar transferências' });
  }
});

// Criar transferência
app.post('/api/integrations/wise/transfers', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  const { targetAccount, quoteUuid, customerTransactionId, details } = req.body;

  try {
    const auth = getWiseAuthContext(req);
    const transfer = await wiseService.createTransfer({
      targetAccount,
      quoteUuid,
      customerTransactionId: customerTransactionId || `alice-${Date.now()}`,
      details: details || { reference: 'Pagamento Alice' },
    });

    await upsertWiseTransfers(auth.tenantId, [transfer]);
    logger.info({ transferId: transfer.id, targetAccount }, 'Transferência Wise criada');
    res.json({ transfer });
  } catch (error) {
    logger.error({ error }, 'Falha ao criar transferência Wise');
    res.status(500).json({ error: 'Falha ao criar transferência' });
  }
});

// Obter transferência por ID
app.get('/api/integrations/wise/transfers/:id', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  // OWASP API3: Validação de parâmetro de rota
  const paramResult = numericIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    return res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
  }

  try {
    const auth = getWiseAuthContext(req);
    const transfer = await wiseService.getTransfer(paramResult.data.id);
    await upsertWiseTransfers(auth.tenantId, [transfer]);
    res.json({ transfer });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter transferência Wise');
    res.status(500).json({ error: 'Falha ao obter transferência' });
  }
});

// Financiar transferência (sandbox)
app.post('/api/integrations/wise/transfers/:id/fund', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  // OWASP API3: Validação de parâmetro de rota
  const paramResult = numericIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    return res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
  }

  try {
    const auth = getWiseAuthContext(req);
    const result = await wiseService.fundTransfer(paramResult.data.id);
    await getDatabase().update(schema.wiseTransfers)
      .set({ updatedAt: new Date() })
      .where(and(
        eq(schema.wiseTransfers.tenantId, auth.tenantId),
        eq(schema.wiseTransfers.wiseTransferId, paramResult.data.id)
      ));
    res.json({ result });
  } catch (error) {
    logger.error({ error }, 'Falha ao financiar transferência Wise');
    res.status(500).json({ error: 'Falha ao financiar transferência' });
  }
});

// Cancelar transferência
app.post('/api/integrations/wise/transfers/:id/cancel', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  // OWASP API3: Validação de parâmetro de rota
  const paramResult = numericIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    return res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
  }

  try {
    const auth = getWiseAuthContext(req);
    const transfer = await wiseService.cancelTransfer(paramResult.data.id);
    await upsertWiseTransfers(auth.tenantId, [transfer]);
    res.json({ transfer });
  } catch (error) {
    logger.error({ error }, 'Falha ao cancelar transferência Wise');
    res.status(500).json({ error: 'Falha ao cancelar transferência' });
  }
});

// Listar batch groups (pagamentos em lote)
app.get('/api/integrations/wise/batch-groups', requirePermission('integrations:wise:read'), async (_req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  try {
    const batchGroups = await wiseService.listBatchGroups();
    res.json({ batchGroups });
  } catch (error) {
    logger.error({ error }, 'Falha ao listar batch groups Wise');
    res.status(500).json({ error: 'Falha ao listar batch groups' });
  }
});

// Criar batch group
app.post('/api/integrations/wise/batch-groups', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  const { name, sourceCurrency } = req.body;

  try {
    const batchGroup = await wiseService.createBatchGroup({ name, sourceCurrency });
    res.json({ batchGroup });
  } catch (error) {
    logger.error({ error }, 'Falha ao criar batch group Wise');
    res.status(500).json({ error: 'Falha ao criar batch group' });
  }
});

// Obter batch group por ID
// NOTA: Batch groups usam UUID, não ID numérico
const batchGroupIdParamSchema = z.object({
  id: z.string().min(1).max(100), // UUID ou ID string
});

app.get('/api/integrations/wise/batch-groups/:id', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  // OWASP API3: Validação de parâmetro de rota
  const paramResult = batchGroupIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    return res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
  }

  try {
    const batchGroup = await wiseService.getBatchGroup(paramResult.data.id);
    res.json({ batchGroup });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter batch group Wise');
    res.status(500).json({ error: 'Falha ao obter batch group' });
  }
});

// Completar batch group
app.post('/api/integrations/wise/batch-groups/:id/complete', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  // OWASP API3: Validação de parâmetro de rota
  const paramResult = batchGroupIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    return res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
  }

  const { version } = req.body;

  try {
    const batchGroup = await wiseService.completeBatchGroup(paramResult.data.id, version);
    res.json({ batchGroup });
  } catch (error) {
    logger.error({ error }, 'Falha ao completar batch group Wise');
    res.status(500).json({ error: 'Falha ao completar batch group' });
  }
});

// Webhook Wise - Receber notificações de transferências
// SEGURANÇA: Validar assinatura ANTES de responder (OWASP API4)
// Wise Webhook - express.raw() já aplicado via app.use() ANTES de express.json() (linha 311)
// Isso garante que req.body seja Buffer para validação de assinatura Wise
app.post('/api/integrations/wise/webhook', async (req: Request, res: Response) => {
  const contentTypeHeader = req.headers['content-type'];
  const contentType = Array.isArray(contentTypeHeader)
    ? contentTypeHeader[0]?.toLowerCase()
    : contentTypeHeader?.toLowerCase();
  if (!contentType || !contentType.startsWith('application/json')) {
    logger.warn({ contentType }, 'Webhook Wise: content-type inválido');
    return res.status(400).json({ error: 'Invalid content-type' });
  }

  // REGRA 6: Validação de Buffer após express.raw() aplicado diretamente na rota
  // Se express.raw() não foi aplicado corretamente, req.body será objeto (erro)
  if (!Buffer.isBuffer(req.body)) {
    logger.error('Webhook Wise: body não é Buffer (express.raw() não aplicado corretamente)');
    return res.status(500).json({ error: 'Invalid body parser for webhook' });
  }

  const signature = req.headers['x-signature-sha256'] as string;
  const isTestNotification = req.headers['x-test-notification'] === 'true';
  const deliveryId = req.headers['x-delivery-id'] as string;
  const payload = req.body.toString('utf8');

  // Verificar se é notificação de teste
  if (isTestNotification) {
    logger.info({ deliveryId }, 'Webhook Wise: Notificação de teste recebida');
    res.status(200).json({ received: true });
    return;
  }

  // CRÍTICO: Validar assinatura ANTES de responder (não depois!)
  const validation = validateWiseWebhook(signature, payload);
  if (!validation.valid) {
    logger.warn({ 
      deliveryId, 
      reason: validation.reason,
      signaturePresent: !!signature,
    }, 'Webhook Wise: Assinatura inválida - rejeitando');
    res.status(403).json({ error: 'Invalid signature' });
    return;
  }

  // Parse event early to get event_type for idempotency check
  let event: {
    event_type: string;
    data: {
      resource: {
        id: number;
        type: string;
        profile_id: number;
        state?: string;
        source_amount?: number;
        source_currency?: string;
        target_amount?: number;
        target_currency?: string;
        reference?: string;
      };
      current_state?: string;
      previous_state?: string;
      occurred_at: string;
    };
  };

  try {
    event = JSON.parse(payload);
  } catch (parseError) {
    logger.error({ error: parseError, deliveryId }, 'Webhook Wise: Falha ao parsear payload');
    res.status(400).json({ error: 'Invalid JSON payload' });
    return;
  }

  // IDEMPOTÊNCIA: Verificar se evento já foi processado usando deliveryId
  const db = getDatabase();
  const eventId = deliveryId || `wise-${event.data.resource.id}-${event.event_type}-${event.data.occurred_at}`;
  
  const { isDuplicate } = await checkWebhookIdempotency(
    db,
    'wise',
    eventId,
    event.event_type,
    event as unknown as Record<string, unknown>
  );

  if (isDuplicate) {
    res.status(200).json({ received: true, duplicate: true });
    return;
  }

  let webhookTenantId: string | null = null;
  if (Number.isFinite(event.data.resource.profile_id)) {
    const profileRecord = await db.query.wiseProfiles.findFirst({
      where: eq(schema.wiseProfiles.wiseProfileId, event.data.resource.profile_id),
      columns: { tenantId: true },
    });
    webhookTenantId = profileRecord?.tenantId ?? null;
  }

  await insertWiseWebhookEvent({
    tenantId: webhookTenantId,
    deliveryId,
    subscriptionId: typeof req.headers['x-subscription-id'] === 'string' ? req.headers['x-subscription-id'] : undefined,
    eventType: event.event_type,
    schemaVersion: typeof req.headers['x-schema-version'] === 'string' ? req.headers['x-schema-version'] : undefined,
    sentAt: event.data.occurred_at,
    signatureValid: true,
    payload: event as unknown as Record<string, unknown>,
  });

  // Assinatura válida e não duplicado - responder 200 e processar
  res.status(200).json({ received: true });

  // Processar webhook de forma assíncrona (após validação e resposta)
  let processingResult: Record<string, unknown> = {};
  let processingError: string | undefined;

  try {
    logger.info({ 
      eventType: event.event_type, 
      resourceId: event.data.resource.id,
      deliveryId,
    }, 'Webhook Wise recebido e validado');

    // Processar eventos de transferência
    if (event.event_type === 'transfers#state-change') {
      const transfer = event.data.resource;
      const newState = event.data.current_state;

      // Sincronizar com ERPNext quando transferência for concluída
      if (newState === 'outgoing_payment_sent' || newState === 'funds_converted') {
        await syncToERPNext('payment', {
          payment_type: 'Pay',
          party_type: 'Supplier',
          party: transfer.reference || `Wise-${transfer.id}`,
          paid_amount: transfer.source_amount,
          paid_to_account_currency: transfer.source_currency,
          received_amount: transfer.target_amount,
          reference_no: `WISE-${transfer.id}`,
          reference_date: event.data.occurred_at.split('T')[0],
          mode_of_payment: 'Wise Transfer',
          custom_wise_transfer_id: transfer.id.toString(),
          custom_wise_state: newState,
        });

        logger.info({ transferId: transfer.id, state: newState }, 'Transferência Wise sincronizada com ERPNext');
        processingResult = { transferId: transfer.id, state: newState, action: 'synced_to_erpnext' };
      }
    }

    // Processar eventos de depósito (credit balance)
    if (event.event_type === 'balances#credit') {
      const balance = event.data.resource;
      
      // Registrar recebimento no ERPNext
      await syncToERPNext('payment', {
        payment_type: 'Receive',
        party_type: 'Customer',
        party: `Wise-Balance-${balance.id}`,
        paid_amount: balance.source_amount,
        paid_from_account_currency: balance.source_currency,
        reference_no: `WISE-CREDIT-${balance.id}`,
        reference_date: event.data.occurred_at.split('T')[0],
        mode_of_payment: 'Wise Deposit',
        custom_wise_balance_id: balance.id.toString(),
      });

      logger.info({ balanceId: balance.id }, 'Depósito Wise sincronizado com ERPNext');
      processingResult = { balanceId: balance.id, action: 'credit_synced' };
    }

  } catch (error) {
    processingError = error instanceof Error ? error.message : String(error);
    logger.error({ error, deliveryId }, 'Falha ao processar webhook Wise');
  }

  // Marcar webhook como processado (ou com erro)
  await markWebhookProcessed(db, 'wise', eventId, processingResult, processingError);
});

// Obter requisitos de conta por moeda
app.get('/api/integrations/wise/recipient-requirements', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  // OWASP API3: Validação Zod obrigatória de query params
  const queryResult = wiseRecipientRequirementsQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    logger.warn({ errors: queryResult.error.flatten() }, 'Input inválido em /api/integrations/wise/recipient-requirements');
    return res.status(400).json({ error: 'Parâmetros inválidos', details: queryResult.error.format() });
  }

  const { sourceCurrency, targetCurrency, sourceAmount } = queryResult.data;

  try {
    const requirements = await wiseService.getRecipientRequirements(
      sourceCurrency,
      targetCurrency,
      sourceAmount
    );
    res.json({ requirements });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter requisitos de destinatário Wise');
    res.status(500).json({ error: 'Falha ao obter requisitos' });
  }
});

// Perfis Wise
app.get('/api/integrations/wise/profiles', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  try {
    const auth = getWiseAuthContext(req);
    const profiles = await wiseService.getProfiles();
    await upsertWiseProfiles(auth.tenantId, profiles);
    res.json({ profiles });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter perfis Wise');
    res.status(500).json({ error: 'Falha ao obter perfis' });
  }
});

app.get('/api/integrations/wise/profiles/:profileId', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  const parsed = wiseProfileIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ error: 'profileId inválido', details: parsed.error.format() });
  }
  try {
    const auth = getWiseAuthContext(req);
    const profile = await wiseService.getProfileById(parsed.data.profileId);
    await upsertWiseProfiles(auth.tenantId, [{ id: parsed.data.profileId, ...(profile as Record<string, unknown>) }]);
    res.json({ profile });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter perfil Wise');
    res.status(500).json({ error: 'Falha ao obter perfil' });
  }
});

// Usuários Wise
app.get('/api/integrations/wise/users/me', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  try {
    const auth = getWiseAuthContext(req);
    const user = await wiseService.getCurrentUser();
    const userId = typeof user.id === 'number' ? user.id : undefined;
    if (userId) {
      await upsertWiseUsers(auth.tenantId, [{ id: userId, ...(user as Record<string, unknown>) }]);
    }
    res.json({ user });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter usuário Wise');
    res.status(500).json({ error: 'Falha ao obter usuário Wise' });
  }
});

app.get('/api/integrations/wise/users/:id', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  const parsed = numericIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ error: 'ID inválido', details: parsed.error.format() });
  }
  try {
    const auth = getWiseAuthContext(req);
    const user = await wiseService.getUserById(parsed.data.id);
    await upsertWiseUsers(auth.tenantId, [{ id: parsed.data.id, ...(user as Record<string, unknown>) }]);
    res.json({ user });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter usuário Wise');
    res.status(500).json({ error: 'Falha ao obter usuário Wise' });
  }
});

// Atividades Wise
app.get('/api/integrations/wise/activities', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  const parsed = wiseActivityQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: parsed.error.format() });
  }
  try {
    const auth = getWiseAuthContext(req);
    const activities = await wiseService.listActivities(parsed.data);
    if (Array.isArray(activities)) {
      await upsertWiseActivities(auth.tenantId, activities as Array<Record<string, unknown>>);
    }
    res.json({ activities });
  } catch (error) {
    logger.error({ error }, 'Falha ao listar atividades Wise');
    res.status(500).json({ error: 'Falha ao listar atividades' });
  }
});

// Account details
app.get('/api/integrations/wise/account-details', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  const parsed = wiseProfileIdParamSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'profileId inválido', details: parsed.error.format() });
  }
  try {
    const details = await wiseService.getAccountDetails(parsed.data.profileId);
    res.json({ details });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter account details Wise');
    res.status(500).json({ error: 'Falha ao obter account details' });
  }
});

app.get('/api/integrations/wise/account-details/orders', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  const parsed = wiseProfileIdParamSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'profileId inválido', details: parsed.error.format() });
  }
  try {
    const orders = await wiseService.listAccountDetailsOrders(parsed.data.profileId);
    res.json({ orders });
  } catch (error) {
    logger.error({ error }, 'Falha ao listar account details orders');
    res.status(500).json({ error: 'Falha ao listar account details orders' });
  }
});

app.post('/api/integrations/wise/account-details/orders', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  const queryParsed = wiseProfileIdParamSchema.safeParse(req.query);
  if (!queryParsed.success) {
    return res.status(400).json({ error: 'profileId inválido', details: queryParsed.error.format() });
  }
  const bodyParsed = wiseGenericPayloadSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    return res.status(400).json({ error: 'Payload inválido', details: bodyParsed.error.format() });
  }
  try {
    const order = await wiseService.createAccountDetailsOrder(queryParsed.data.profileId, bodyParsed.data);
    res.json({ order });
  } catch (error) {
    logger.error({ error }, 'Falha ao criar account details order');
    res.status(500).json({ error: 'Falha ao criar account details order' });
  }
});

// Cartões Wise
app.get('/api/integrations/wise/cards', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  const parsed = wiseProfileIdParamSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'profileId inválido', details: parsed.error.format() });
  }
  try {
    const auth = getWiseAuthContext(req);
    const cards = await wiseService.listCards(parsed.data.profileId);
    if (Array.isArray(cards)) {
      await upsertWiseCards(auth.tenantId, cards as Array<Record<string, unknown>>);
    }
    res.json({ cards });
  } catch (error) {
    logger.error({ error }, 'Falha ao listar cartões Wise');
    res.status(500).json({ error: 'Falha ao listar cartões' });
  }
});

app.get('/api/integrations/wise/cards/:cardToken', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const tokenParsed = wiseCardTokenParamSchema.safeParse(req.params);
  if (!profileParsed.success || !tokenParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), token: tokenParsed.error?.format() } });
  }
  try {
    const auth = getWiseAuthContext(req);
    const card = await wiseService.getCard(profileParsed.data.profileId, tokenParsed.data.cardToken);
    await upsertWiseCards(auth.tenantId, [card as Record<string, unknown>]);
    res.json({ card });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter cartão Wise');
    res.status(500).json({ error: 'Falha ao obter cartão' });
  }
});

app.put('/api/integrations/wise/cards/:cardToken/status', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const tokenParsed = wiseCardTokenParamSchema.safeParse(req.params);
  const bodyParsed = wiseGenericPayloadSchema.safeParse(req.body);
  if (!profileParsed.success || !tokenParsed.success || !bodyParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), token: tokenParsed.error?.format(), body: bodyParsed.error?.format() } });
  }
  try {
    const auth = getWiseAuthContext(req);
    const card = await wiseService.updateCardStatus(profileParsed.data.profileId, tokenParsed.data.cardToken, bodyParsed.data);
    await upsertWiseCards(auth.tenantId, [card as Record<string, unknown>]);
    res.json({ card });
  } catch (error) {
    logger.error({ error }, 'Falha ao atualizar status do cartão Wise');
    res.status(500).json({ error: 'Falha ao atualizar status do cartão' });
  }
});

app.post('/api/integrations/wise/cards/:cardToken/pin/reset', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const tokenParsed = wiseCardTokenParamSchema.safeParse(req.params);
  if (!profileParsed.success || !tokenParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), token: tokenParsed.error?.format() } });
  }
  try {
    const result = await wiseService.resetCardPin(profileParsed.data.profileId, tokenParsed.data.cardToken);
    res.json({ result });
  } catch (error) {
    logger.error({ error }, 'Falha ao resetar PIN do cartão Wise');
    res.status(500).json({ error: 'Falha ao resetar PIN' });
  }
});

app.get('/api/integrations/wise/cards/:cardToken/permissions', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const tokenParsed = wiseCardTokenParamSchema.safeParse(req.params);
  if (!profileParsed.success || !tokenParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), token: tokenParsed.error?.format() } });
  }
  try {
    const permissions = await wiseService.getCardPermissions(profileParsed.data.profileId, tokenParsed.data.cardToken);
    res.json({ permissions });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter permissões do cartão Wise');
    res.status(500).json({ error: 'Falha ao obter permissões do cartão' });
  }
});

app.put('/api/integrations/wise/cards/:cardToken/permissions', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const tokenParsed = wiseCardTokenParamSchema.safeParse(req.params);
  const bodyParsed = wiseGenericPayloadSchema.safeParse(req.body);
  if (!profileParsed.success || !tokenParsed.success || !bodyParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), token: tokenParsed.error?.format(), body: bodyParsed.error?.format() } });
  }
  try {
    const permissions = await wiseService.updateCardPermission(profileParsed.data.profileId, tokenParsed.data.cardToken, bodyParsed.data);
    res.json({ permissions });
  } catch (error) {
    logger.error({ error }, 'Falha ao atualizar permissões do cartão Wise');
    res.status(500).json({ error: 'Falha ao atualizar permissões do cartão' });
  }
});

app.put('/api/integrations/wise/cards/permissions', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const bodyParsed = wiseGenericPayloadSchema.safeParse(req.body);
  if (!profileParsed.success || !bodyParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), body: bodyParsed.error?.format() } });
  }
  try {
    const result = await wiseService.updateCardPermissionsBulk(profileParsed.data.profileId, bodyParsed.data);
    res.json({ result });
  } catch (error) {
    logger.error({ error }, 'Falha ao atualizar permissões em lote Wise');
    res.status(500).json({ error: 'Falha ao atualizar permissões em lote' });
  }
});

app.get('/api/integrations/wise/cards/transactions/:transactionId', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const transactionParsed = wiseTransactionIdParamSchema.safeParse(req.params);
  if (!profileParsed.success || !transactionParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), transaction: transactionParsed.error?.format() } });
  }
  try {
    const auth = getWiseAuthContext(req);
    const transaction = await wiseService.getCardTransaction(profileParsed.data.profileId, transactionParsed.data.transactionId);
    await upsertWiseCardTransactions(auth.tenantId, [{
      id: transactionParsed.data.transactionId,
      ...(transaction as Record<string, unknown>),
    }]);
    res.json({ transaction });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter transação de cartão Wise');
    res.status(500).json({ error: 'Falha ao obter transação de cartão' });
  }
});

// Dados sensíveis de cartão (TwCard)
app.get('/api/integrations/wise/cards/secure/encryption-key', requirePermission('integrations:wise:read'), async (_req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  try {
    const key = await wiseService.getTwCardEncryptionKey();
    res.json({ key });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter chave de criptografia Wise');
    res.status(500).json({ error: 'Falha ao obter chave de criptografia' });
  }
});

app.post('/api/integrations/wise/cards/secure/details', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  const tokenParsed = wiseCardTokenParamSchema.safeParse(req.query);
  const bodyParsed = wiseGenericPayloadSchema.safeParse(req.body);
  if (!tokenParsed.success || !bodyParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { token: tokenParsed.error?.format(), body: bodyParsed.error?.format() } });
  }
  try {
    const details = await wiseService.getSensitiveCardDetails(tokenParsed.data.cardToken, bodyParsed.data);
    res.json({ details });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter detalhes sensíveis Wise');
    res.status(500).json({ error: 'Falha ao obter detalhes sensíveis' });
  }
});

app.post('/api/integrations/wise/cards/secure/pin', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  const tokenParsed = wiseCardTokenParamSchema.safeParse(req.query);
  const bodyParsed = wiseGenericPayloadSchema.safeParse(req.body);
  if (!tokenParsed.success || !bodyParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { token: tokenParsed.error?.format(), body: bodyParsed.error?.format() } });
  }
  try {
    const pin = await wiseService.getCardPin(tokenParsed.data.cardToken, bodyParsed.data);
    res.json({ pin });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter PIN Wise');
    res.status(500).json({ error: 'Falha ao obter PIN' });
  }
});

// Card Orders
app.get('/api/integrations/wise/card-orders', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const queryParsed = wiseCardOrdersQuerySchema.safeParse(req.query);
  if (!profileParsed.success || !queryParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), query: queryParsed.error?.format() } });
  }
  try {
    const auth = getWiseAuthContext(req);
    const pageNumber = queryParsed.data.pageNumber ?? 1;
    const pageSize = queryParsed.data.pageSize ?? 10;
    const orders = await wiseService.listCardOrders(profileParsed.data.profileId, pageNumber, pageSize);
    const items = Array.isArray((orders as Record<string, unknown>).content) ? (orders as Record<string, unknown>).content as Array<Record<string, unknown>> : [];
    await upsertWiseCardOrders(auth.tenantId, items);
    res.json({ orders });
  } catch (error) {
    logger.error({ error }, 'Falha ao listar card orders Wise');
    res.status(500).json({ error: 'Falha ao listar card orders' });
  }
});

app.post('/api/integrations/wise/card-orders', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const bodyParsed = wiseGenericPayloadSchema.safeParse(req.body);
  if (!profileParsed.success || !bodyParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), body: bodyParsed.error?.format() } });
  }
  try {
    const auth = getWiseAuthContext(req);
    const order = await wiseService.createCardOrder(profileParsed.data.profileId, bodyParsed.data);
    await upsertWiseCardOrders(auth.tenantId, [order as Record<string, unknown>]);
    res.json({ order });
  } catch (error) {
    logger.error({ error }, 'Falha ao criar card order Wise');
    res.status(500).json({ error: 'Falha ao criar card order' });
  }
});

app.get('/api/integrations/wise/card-orders/availability', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  if (!profileParsed.success) {
    return res.status(400).json({ error: 'profileId inválido', details: profileParsed.error.format() });
  }
  try {
    const availability = await wiseService.listCardOrderAvailability(profileParsed.data.profileId);
    res.json({ availability });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter disponibilidade de card order');
    res.status(500).json({ error: 'Falha ao obter disponibilidade' });
  }
});

app.get('/api/integrations/wise/card-orders/:cardOrderId', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const idParsed = wiseCardOrderIdParamSchema.safeParse(req.params);
  if (!profileParsed.success || !idParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), id: idParsed.error?.format() } });
  }
  try {
    const auth = getWiseAuthContext(req);
    const order = await wiseService.getCardOrder(profileParsed.data.profileId, idParsed.data.cardOrderId);
    await upsertWiseCardOrders(auth.tenantId, [order as Record<string, unknown>]);
    res.json({ order });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter card order Wise');
    res.status(500).json({ error: 'Falha ao obter card order' });
  }
});

app.get('/api/integrations/wise/card-orders/:cardOrderId/requirements', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const idParsed = wiseCardOrderIdParamSchema.safeParse(req.params);
  if (!profileParsed.success || !idParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), id: idParsed.error?.format() } });
  }
  try {
    const requirements = await wiseService.getCardOrderRequirements(profileParsed.data.profileId, idParsed.data.cardOrderId);
    res.json({ requirements });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter requisitos do card order');
    res.status(500).json({ error: 'Falha ao obter requisitos' });
  }
});

app.put('/api/integrations/wise/card-orders/:cardOrderId/status', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const idParsed = wiseCardOrderIdParamSchema.safeParse(req.params);
  const bodyParsed = wiseGenericPayloadSchema.safeParse(req.body);
  if (!profileParsed.success || !idParsed.success || !bodyParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), id: idParsed.error?.format(), body: bodyParsed.error?.format() } });
  }
  try {
    const auth = getWiseAuthContext(req);
    const order = await wiseService.updateCardOrderStatus(profileParsed.data.profileId, idParsed.data.cardOrderId, bodyParsed.data);
    await upsertWiseCardOrders(auth.tenantId, [order as Record<string, unknown>]);
    res.json({ order });
  } catch (error) {
    logger.error({ error }, 'Falha ao atualizar status do card order');
    res.status(500).json({ error: 'Falha ao atualizar status do card order' });
  }
});

app.post('/api/integrations/wise/card-orders/validate-address', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  const bodyParsed = wiseGenericPayloadSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    return res.status(400).json({ error: 'Payload inválido', details: bodyParsed.error.format() });
  }
  try {
    const result = await wiseService.validateCardOrderAddress(bodyParsed.data);
    res.json({ result });
  } catch (error) {
    logger.error({ error }, 'Falha ao validar endereço Wise');
    res.status(500).json({ error: 'Falha ao validar endereço' });
  }
});

app.post('/api/integrations/wise/card-orders/:cardOrderId/preset-pin', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  const idParsed = wiseCardOrderIdParamSchema.safeParse(req.params);
  const bodyParsed = wiseGenericPayloadSchema.safeParse(req.body);
  if (!idParsed.success || !bodyParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { id: idParsed.error?.format(), body: bodyParsed.error?.format() } });
  }
  try {
    const result = await wiseService.setCardOrderPin(idParsed.data.cardOrderId, bodyParsed.data);
    res.json({ result });
  } catch (error) {
    logger.error({ error }, 'Falha ao definir PIN do card order');
    res.status(500).json({ error: 'Falha ao definir PIN' });
  }
});

// Spend controls
app.get('/api/integrations/wise/spend-controls', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  if (!profileParsed.success) {
    return res.status(400).json({ error: 'profileId inválido', details: profileParsed.error.format() });
  }
  try {
    const auth = getWiseAuthContext(req);
    const rules = await wiseService.listSpendControls(profileParsed.data.profileId);
    if (Array.isArray(rules)) {
      await upsertWiseSpendControls(auth.tenantId, rules as Array<Record<string, unknown>>);
    }
    res.json({ rules });
  } catch (error) {
    logger.error({ error }, 'Falha ao listar spend controls Wise');
    res.status(500).json({ error: 'Falha ao listar spend controls' });
  }
});

app.post('/api/integrations/wise/spend-controls', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const bodyParsed = wiseGenericPayloadSchema.safeParse(req.body);
  if (!profileParsed.success || !bodyParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), body: bodyParsed.error?.format() } });
  }
  try {
    const auth = getWiseAuthContext(req);
    const rule = await wiseService.createSpendControl(profileParsed.data.profileId, bodyParsed.data);
    await upsertWiseSpendControls(auth.tenantId, [rule as Record<string, unknown>]);
    res.json({ rule });
  } catch (error) {
    logger.error({ error }, 'Falha ao criar spend control Wise');
    res.status(500).json({ error: 'Falha ao criar spend control' });
  }
});

app.delete('/api/integrations/wise/spend-controls/:ruleId', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const ruleParsed = numericIdParamSchema.safeParse(req.params);
  if (!profileParsed.success || !ruleParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), rule: ruleParsed.error?.format() } });
  }
  try {
    const auth = getWiseAuthContext(req);
    await wiseService.deleteSpendControl(profileParsed.data.profileId, ruleParsed.data.id);
    await getDatabase().delete(schema.wiseSpendControls).where(
      and(
        eq(schema.wiseSpendControls.tenantId, auth.tenantId),
        eq(schema.wiseSpendControls.wiseRuleId, ruleParsed.data.id)
      )
    );
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
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const ruleParsed = numericIdParamSchema.safeParse(req.params);
  const bodyParsed = wiseGenericPayloadSchema.safeParse(req.body);
  if (!profileParsed.success || !ruleParsed.success || !bodyParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), rule: ruleParsed.error?.format(), body: bodyParsed.error?.format() } });
  }
  try {
    const result = await wiseService.applySpendControl(profileParsed.data.profileId, ruleParsed.data.id, bodyParsed.data);
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
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const ruleParsed = numericIdParamSchema.safeParse(req.params);
  const bodyParsed = wiseGenericPayloadSchema.safeParse(req.body);
  if (!profileParsed.success || !ruleParsed.success || !bodyParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), rule: ruleParsed.error?.format(), body: bodyParsed.error?.format() } });
  }
  try {
    const result = await wiseService.unassignSpendControl(profileParsed.data.profileId, ruleParsed.data.id, bodyParsed.data);
    res.json({ result });
  } catch (error) {
    logger.error({ error }, 'Falha ao remover spend control do cartão');
    res.status(500).json({ error: 'Falha ao remover spend control do cartão' });
  }
});

// Spend limits
app.get('/api/integrations/wise/spend-limits/profile', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  if (!profileParsed.success) {
    return res.status(400).json({ error: 'profileId inválido', details: profileParsed.error.format() });
  }
  try {
    const limits = await wiseService.getSpendLimits(profileParsed.data.profileId);
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
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const bodyParsed = wiseGenericPayloadSchema.safeParse(req.body);
  if (!profileParsed.success || !bodyParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), body: bodyParsed.error?.format() } });
  }
  try {
    const limits = await wiseService.updateSpendLimits(profileParsed.data.profileId, bodyParsed.data);
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
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const tokenParsed = wiseCardTokenParamSchema.safeParse(req.params);
  if (!profileParsed.success || !tokenParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), token: tokenParsed.error?.format() } });
  }
  try {
    const limits = await wiseService.getCardSpendLimits(profileParsed.data.profileId, tokenParsed.data.cardToken);
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
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const tokenParsed = wiseCardTokenParamSchema.safeParse(req.params);
  const bodyParsed = wiseGenericPayloadSchema.safeParse(req.body);
  if (!profileParsed.success || !tokenParsed.success || !bodyParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), token: tokenParsed.error?.format(), body: bodyParsed.error?.format() } });
  }
  try {
    const limits = await wiseService.updateCardSpendLimits(profileParsed.data.profileId, tokenParsed.data.cardToken, bodyParsed.data);
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
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const tokenParsed = wiseCardTokenParamSchema.safeParse(req.params);
  if (!profileParsed.success || !tokenParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), token: tokenParsed.error?.format() } });
  }
  try {
    await wiseService.deleteCardSpendLimits(profileParsed.data.profileId, tokenParsed.data.cardToken);
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Falha ao remover spend limits do cartão');
    res.status(500).json({ error: 'Falha ao remover spend limits do cartão' });
  }
});

// Disputas
app.get('/api/integrations/wise/disputes/reasons', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  if (!profileParsed.success) {
    return res.status(400).json({ error: 'profileId inválido', details: profileParsed.error.format() });
  }
  try {
    const reasons = await wiseService.listDisputeReasons(profileParsed.data.profileId);
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
  const bodyParsed = wiseGenericPayloadSchema.safeParse(payload ?? {});
  if (!bodyParsed.success) {
    return res.status(400).json({ error: 'Payload inválido', details: bodyParsed.error.format() });
  }
  try {
    const result = await wiseService.getDisputeFlowStep(Number(profileId), String(scheme), String(reason), String(transactionId), bodyParsed.data);
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
  const bodyParsed = wiseGenericPayloadSchema.safeParse(payload ?? {});
  if (!bodyParsed.success) {
    return res.status(400).json({ error: 'Payload inválido', details: bodyParsed.error.format() });
  }
  try {
    const result = await wiseService.submitDisputeFlow(Number(profileId), String(scheme), String(reason), String(transactionId), bodyParsed.data);
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
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const bodyParsed = wiseFileUploadSchema.safeParse(req.body);
  if (!profileParsed.success || !bodyParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), body: bodyParsed.error?.format() } });
  }
  try {
    const buffer = Buffer.from(bodyParsed.data.fileBase64, 'base64');
    const formData = new FormData();
    formData.append('receipt', new Blob([buffer], { type: bodyParsed.data.contentType }), bodyParsed.data.fileName);
    const result = await wiseService.uploadDisputeFile(profileParsed.data.profileId, formData);
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
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  if (!profileParsed.success) {
    return res.status(400).json({ error: 'profileId inválido', details: profileParsed.error.format() });
  }
  try {
    const auth = getWiseAuthContext(req);
    const disputes = await wiseService.listDisputes(profileParsed.data.profileId, req.query.status as string | undefined);
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
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const idParsed = wiseDisputeIdParamSchema.safeParse(req.params);
  if (!profileParsed.success || !idParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), id: idParsed.error?.format() } });
  }
  try {
    const auth = getWiseAuthContext(req);
    const dispute = await wiseService.getDispute(profileParsed.data.profileId, idParsed.data.disputeId);
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
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const idParsed = wiseDisputeIdParamSchema.safeParse(req.params);
  const bodyParsed = wiseGenericPayloadSchema.safeParse(req.body);
  if (!profileParsed.success || !idParsed.success || !bodyParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), id: idParsed.error?.format(), body: bodyParsed.error?.format() } });
  }
  try {
    const auth = getWiseAuthContext(req);
    const dispute = await wiseService.updateDisputeStatus(profileParsed.data.profileId, idParsed.data.disputeId, bodyParsed.data);
    await upsertWiseDisputes(auth.tenantId, [dispute as Record<string, unknown>]);
    res.json({ dispute });
  } catch (error) {
    logger.error({ error }, 'Falha ao atualizar disputa Wise');
    res.status(500).json({ error: 'Falha ao atualizar disputa' });
  }
});

// Verificação e KYC
app.get('/api/integrations/wise/verification/required-evidences', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  if (!profileParsed.success) {
    return res.status(400).json({ error: 'profileId inválido', details: profileParsed.error.format() });
  }
  try {
    const evidences = await wiseService.getVerificationRequiredEvidences(profileParsed.data.profileId);
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
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const bodyParsed = wiseFileUploadSchema.safeParse(req.body);
  if (!profileParsed.success || !bodyParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), body: bodyParsed.error?.format() } });
  }
  try {
    const buffer = Buffer.from(bodyParsed.data.fileBase64, 'base64');
    const formData = new FormData();
    formData.append('document', new Blob([buffer], { type: bodyParsed.data.contentType }), bodyParsed.data.fileName);
    const result = await wiseService.uploadVerificationDocument(profileParsed.data.profileId, formData);
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
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const bodyParsed = wiseFileUploadSchema.safeParse(req.body);
  if (!profileParsed.success || !bodyParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), body: bodyParsed.error?.format() } });
  }
  try {
    const buffer = Buffer.from(bodyParsed.data.fileBase64, 'base64');
    const formData = new FormData();
    formData.append('document', new Blob([buffer], { type: bodyParsed.data.contentType }), bodyParsed.data.fileName);
    const result = await wiseService.uploadAdditionalEvidences(profileParsed.data.profileId, formData);
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
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  if (!profileParsed.success) {
    return res.status(400).json({ error: 'profileId inválido', details: profileParsed.error.format() });
  }
  try {
    const auth = getWiseAuthContext(req);
    const reviews = await wiseService.listKycReviews(profileParsed.data.profileId);
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
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const bodyParsed = wiseGenericPayloadSchema.safeParse(req.body);
  if (!profileParsed.success || !bodyParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), body: bodyParsed.error?.format() } });
  }
  try {
    const auth = getWiseAuthContext(req);
    const review = await wiseService.createKycReview(profileParsed.data.profileId, bodyParsed.data);
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
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const idParsed = wiseKycReviewIdParamSchema.safeParse(req.params);
  if (!profileParsed.success || !idParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), id: idParsed.error?.format() } });
  }
  try {
    const auth = getWiseAuthContext(req);
    const review = await wiseService.getKycReview(profileParsed.data.profileId, idParsed.data.kycReviewId);
    await upsertWiseKycReviews(auth.tenantId, [review as Record<string, unknown>]);
    res.json({ review });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter KYC review Wise');
    res.status(500).json({ error: 'Falha ao obter KYC review' });
  }
});

// SCA
app.post('/api/integrations/wise/one-time-token', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  if (!profileParsed.success) {
    return res.status(400).json({ error: 'profileId inválido', details: profileParsed.error.format() });
  }
  try {
    const result = await wiseService.getScaOneTimeToken(profileParsed.data.profileId);
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
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const bodyParsed = wiseJosePayloadSchema.safeParse(req.body);
  if (!profileParsed.success || !bodyParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), body: bodyParsed.error?.format() } });
  }
  try {
    const result = await wiseService.createScaSession(profileParsed.data.profileId, bodyParsed.data.josePayload);
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
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const bodyParsed = wiseJosePayloadSchema.safeParse(req.body);
  if (!profileParsed.success || !bodyParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), body: bodyParsed.error?.format() } });
  }
  try {
    const result = await wiseService.createPin(profileParsed.data.profileId, bodyParsed.data.josePayload);
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
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const bodyParsed = wiseJosePayloadSchema.safeParse(req.body);
  if (!profileParsed.success || !bodyParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), body: bodyParsed.error?.format() } });
  }
  try {
    const result = await wiseService.verifyPin(profileParsed.data.profileId, bodyParsed.data.josePayload);
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
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const bodyParsed = wiseJosePayloadSchema.safeParse(req.body);
  if (!profileParsed.success || !bodyParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), body: bodyParsed.error?.format() } });
  }
  try {
    const result = await wiseService.deletePin(profileParsed.data.profileId, bodyParsed.data.josePayload);
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
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const bodyParsed = wiseJosePayloadSchema.safeParse(req.body);
  if (!profileParsed.success || !bodyParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), body: bodyParsed.error?.format() } });
  }
  try {
    const result = await wiseService.createDeviceFingerprint(profileParsed.data.profileId, bodyParsed.data.josePayload);
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
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const bodyParsed = wiseJosePayloadSchema.safeParse(req.body);
  if (!profileParsed.success || !bodyParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), body: bodyParsed.error?.format() } });
  }
  try {
    const result = await wiseService.verifyDeviceFingerprint(profileParsed.data.profileId, bodyParsed.data.josePayload);
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
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const bodyParsed = wiseJosePayloadSchema.safeParse(req.body);
  if (!profileParsed.success || !bodyParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), body: bodyParsed.error?.format() } });
  }
  try {
    const result = await wiseService.deleteDeviceFingerprint(profileParsed.data.profileId, bodyParsed.data.josePayload);
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
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const bodyParsed = wiseJosePayloadSchema.safeParse(req.body);
  if (!profileParsed.success || !bodyParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), body: bodyParsed.error?.format() } });
  }
  try {
    const result = await wiseService.createFacemap(profileParsed.data.profileId, bodyParsed.data.josePayload);
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
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const bodyParsed = wiseJosePayloadSchema.safeParse(req.body);
  if (!profileParsed.success || !bodyParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), body: bodyParsed.error?.format() } });
  }
  try {
    const result = await wiseService.verifyFacemap(profileParsed.data.profileId, bodyParsed.data.josePayload);
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
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const bodyParsed = wiseJosePayloadSchema.safeParse(req.body);
  if (!profileParsed.success || !bodyParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), body: bodyParsed.error?.format() } });
  }
  try {
    const result = await wiseService.deleteFacemap(profileParsed.data.profileId, bodyParsed.data.josePayload);
    res.json({ result });
  } catch (error) {
    logger.error({ error }, 'Falha ao remover facemap Wise');
    res.status(500).json({ error: 'Falha ao remover facemap' });
  }
});

// Webhooks
app.get('/api/integrations/wise/webhooks', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  const application = String(req.query.application ?? '') === 'true';
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
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
    const webhooks = await wiseService.listWebhooks({ profileId, application });
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
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const bodyParsed = wiseGenericPayloadSchema.safeParse(req.body);
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
    const webhook = await wiseService.createWebhook({ profileId, application }, bodyParsed.data);
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
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.query);
  const idParsed = wiseWebhookIdParamSchema.safeParse(req.params);
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
    await wiseService.deleteWebhook({ profileId, application }, idParsed.data.subscriptionId);
    res.status(204).send();
  } catch (error) {
    logger.error({ error }, 'Falha ao remover webhook Wise');
    res.status(500).json({ error: 'Falha ao remover webhook' });
  }
});

// Simulações
app.post('/api/integrations/wise/simulation/transfers/:transferId/:action', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  const transferId = Number(req.params.transferId);
  const actionParsed = wiseSimulationActionSchema.safeParse(req.params);
  if (!Number.isFinite(transferId) || transferId <= 0 || !actionParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos' });
  }
  try {
    const result = await wiseService.simulateTransfer(transferId, actionParsed.data.action);
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
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.params);
  const bodyParsed = wiseGenericPayloadSchema.safeParse(req.body);
  if (!profileParsed.success || !bodyParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), body: bodyParsed.error?.format() } });
  }
  try {
    const result = await wiseService.simulateVerification(profileParsed.data.profileId, bodyParsed.data);
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
  const bodyParsed = wiseGenericPayloadSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    return res.status(400).json({ error: 'Payload inválido', details: bodyParsed.error.format() });
  }
  try {
    const result = await wiseService.simulateBalanceTopup(bodyParsed.data);
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
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.params);
  const cardParsed = wiseCardTokenParamSchema.safeParse(req.params);
  const actionParsed = wiseSimulationActionSchema.safeParse(req.params);
  const bodyParsed = wiseGenericPayloadSchema.safeParse(req.body);
  if (!profileParsed.success || !cardParsed.success || !actionParsed.success || !bodyParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos' });
  }
  try {
    const result = await wiseService.simulateCardTransaction(
      profileParsed.data.profileId,
      cardParsed.data.cardToken,
      actionParsed.data.action,
      bodyParsed.data
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
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.params);
  const cardParsed = wiseCardTokenParamSchema.safeParse(req.params);
  const bodyParsed = wiseGenericPayloadSchema.safeParse(req.body);
  if (!profileParsed.success || !cardParsed.success || !bodyParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos' });
  }
  try {
    const result = await wiseService.simulateCardAuthorisation(profileParsed.data.profileId, cardParsed.data.cardToken, bodyParsed.data);
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
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.params);
  const cardParsed = wiseCardTokenParamSchema.safeParse(req.params);
  const bodyParsed = wiseGenericPayloadSchema.safeParse(req.body);
  if (!profileParsed.success || !cardParsed.success || !bodyParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos' });
  }
  try {
    const result = await wiseService.simulateCardRefund(profileParsed.data.profileId, cardParsed.data.cardToken, bodyParsed.data);
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
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.params);
  const cardParsed = wiseCardTokenParamSchema.safeParse(req.params);
  const bodyParsed = wiseGenericPayloadSchema.safeParse(req.body);
  if (!profileParsed.success || !cardParsed.success || !bodyParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos' });
  }
  try {
    const result = await wiseService.simulateCardProduction(profileParsed.data.profileId, cardParsed.data.cardToken, bodyParsed.data);
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
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.params);
  const cardParsed = wiseCardTokenParamSchema.safeParse(req.params);
  if (!profileParsed.success || !cardParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos' });
  }
  const limit = req.query.limit ? Number(req.query.limit) : 10;
  try {
    const result = await wiseService.simulateCardRecentTransactions(profileParsed.data.profileId, cardParsed.data.cardToken, Number.isFinite(limit) ? limit : 10);
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
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.params);
  const reviewParsed = wiseKycReviewIdParamSchema.safeParse(req.params);
  if (!profileParsed.success || !reviewParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos' });
  }
  try {
    const result = await wiseService.simulateKycRequirements(profileParsed.data.profileId, reviewParsed.data.kycReviewId);
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
  const profileParsed = wiseProfileIdParamSchema.safeParse(req.params);
  const bodyParsed = wiseGenericPayloadSchema.safeParse(req.body);
  if (!profileParsed.success || !bodyParsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: { profile: profileParsed.error?.format(), body: bodyParsed.error?.format() } });
  }
  try {
    const result = await wiseService.simulateBankTransactionImport(profileParsed.data.profileId, bodyParsed.data);
    res.json({ result });
  } catch (error) {
    logger.error({ error }, 'Falha ao simular importação bancária Wise');
    res.status(500).json({ error: 'Falha ao simular importação bancária' });
  }
});

// OAuth
app.post('/api/integrations/wise/oauth/exchange-registration-code', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  const bodyParsed = wiseOAuthExchangeSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    return res.status(400).json({ error: 'Payload inválido', details: bodyParsed.error.format() });
  }
  try {
    const token = await wiseService.exchangeRegistrationCode(bodyParsed.data);
    res.json({ token });
  } catch (error) {
    logger.error({ error }, 'Falha ao trocar registration code Wise');
    res.status(500).json({ error: 'Falha ao trocar registration code' });
  }
});

app.post('/api/integrations/wise/oauth/exchange-authorization-code', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  const bodyParsed = wiseOAuthExchangeSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    return res.status(400).json({ error: 'Payload inválido', details: bodyParsed.error.format() });
  }
  try {
    const token = await wiseService.exchangeAuthorizationCode(bodyParsed.data);
    res.json({ token });
  } catch (error) {
    logger.error({ error }, 'Falha ao trocar authorization code Wise');
    res.status(500).json({ error: 'Falha ao trocar authorization code' });
  }
});

app.post('/api/integrations/wise/oauth/refresh-user-token', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }
  const bodyParsed = wiseOAuthRefreshSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    return res.status(400).json({ error: 'Payload inválido', details: bodyParsed.error.format() });
  }
  try {
    const token = await wiseService.refreshUserToken(bodyParsed.data.refreshToken);
    res.json({ token });
  } catch (error) {
    logger.error({ error }, 'Falha ao renovar token Wise');
    res.status(500).json({ error: 'Falha ao renovar token' });
  }
});

// Status do Wise (não requer configuração para retornar status)
app.get('/api/integrations/wise/status', (_req: Request, res: Response) => {
  const profileId = getProfileIdSafe();
  res.json({
    configured: isWiseConfigured(),
    sandbox: getSandboxStatus(),
    profileId: profileId ? '***' + profileId.slice(-4) : null,
  });
});

// ============================================================
// TWILIO/WHATSAPP API - Mensagens e Webhooks
// Documentação: https://www.twilio.com/docs/messaging/webhooks
// Integração com Conversation Orchestrator para Handover/Takeover
// ============================================================

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER;
// REGRA 6: Fail-fast em TODOS os ambientes - variável DEVE estar definida
const CHAT_SERVICE_URL = process.env.CHAT_SERVICE_URL;
if (!CHAT_SERVICE_URL) {
  throw new Error('CHAT_SERVICE_URL é obrigatório (Regra 6 - fail-fast)');
}
const CHAT_SERVICE_URL_FINAL = CHAT_SERVICE_URL;

// URL do Training Service para coleta de dados de treinamento
// REGRA 6: Fail-fast em TODOS os ambientes - variável DEVE estar definida
// Alice MULTIMODAL: coleta dados de WhatsApp (texto, imagens, áudio) para aprendizado
const TRAINING_SERVICE_URL = process.env.TRAINING_SERVICE_URL;
if (!TRAINING_SERVICE_URL) {
  throw new Error('TRAINING_SERVICE_URL é obrigatório (Regra 6 - fail-fast)');
}
const TRAINING_SERVICE_URL_FINAL = TRAINING_SERVICE_URL;

// URL do RAG Service para indexação de mídia multimodal do WhatsApp
// REGRA 6: Fail-fast em TODOS os ambientes - variável DEVE estar definida
// Permite indexar imagens/áudios recebidos via WhatsApp no RAG
const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL;
if (!RAG_SERVICE_URL) {
  throw new Error('RAG_SERVICE_URL é obrigatório (Regra 6 - fail-fast)');
}
const RAG_SERVICE_URL_FINAL = RAG_SERVICE_URL;

/**
 * Valida assinatura do webhook Twilio
 * Segue especificação oficial: https://www.twilio.com/docs/usage/security
 * 
 * Algoritmo Twilio:
 * 1. Pegar URL completa do webhook
 * 2. Ordenar parâmetros POST alfabeticamente por chave
 * 3. Concatenar: URL + key1 + value1 + key2 + value2...
 * 4. HMAC-SHA1 com auth token
 * 5. Comparar base64 com X-Twilio-Signature
 */
function validateTwilioSignature(
  signature: string,
  url: string,
  params: Record<string, string>
): { valid: boolean; reason?: string } {
  const isProduction = process.env.NODE_ENV === 'production';
  
  if (!TWILIO_AUTH_TOKEN) {
    if (isProduction) {
      logger.error('TWILIO_AUTH_TOKEN obrigatório em produção - webhook rejeitado');
      return { valid: false, reason: 'AUTH_TOKEN_MISSING' };
    }
    logger.warn('TWILIO_AUTH_TOKEN não configurado - validação ignorada em desenvolvimento');
    return { valid: true, reason: 'DEV_MODE_SKIP' };
  }

  if (!signature) {
    logger.warn('X-Twilio-Signature header ausente');
    return { valid: false, reason: 'SIGNATURE_MISSING' };
  }

  try {
    // Ordenar parâmetros alfabeticamente e concatenar
    const sortedParams = Object.keys(params)
      .sort()
      .reduce((acc, key) => acc + key + (params[key] || ''), '');
    
    const dataToSign = url + sortedParams;
    
    const expectedSignature = crypto
      .createHmac('sha1', TWILIO_AUTH_TOKEN)
      .update(new Uint8Array(Buffer.from(dataToSign, 'utf-8')))
      .digest('base64');

    // Usar timingSafeEqual para prevenir timing attacks
    const signatureBuffer = new Uint8Array(Buffer.from(signature));
    const expectedBuffer = new Uint8Array(Buffer.from(expectedSignature));
    
    if (signatureBuffer.length !== expectedBuffer.length) {
      return { valid: false, reason: 'SIGNATURE_LENGTH_MISMATCH' };
    }

    const isValid = crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
    return { valid: isValid, reason: isValid ? 'VALID' : 'SIGNATURE_MISMATCH' };
  } catch (error) {
    logger.error({ error }, 'Erro ao validar assinatura Twilio');
    return { valid: false, reason: 'VALIDATION_ERROR' };
  }
}

/**
 * Envia mensagem WhatsApp via Twilio
 */
async function sendWhatsAppMessage(to: string, body: string, mediaUrl?: string): Promise<{
  success: boolean;
  messageSid?: string;
  error?: string;
}> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_NUMBER) {
    logger.error('Twilio não configurado para envio de mensagens');
    return { success: false, error: 'Twilio não configurado' };
  }

  // RESILIÊNCIA: AbortController com timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXTERNAL_API_TIMEOUT_MS);

  try {
    const formData = new URLSearchParams();
    formData.append('From', `whatsapp:${TWILIO_WHATSAPP_NUMBER}`);
    formData.append('To', to.startsWith('whatsapp:') ? to : `whatsapp:${to}`);
    formData.append('Body', body);
    if (mediaUrl) {
      formData.append('MediaUrl', mediaUrl);
    }

    const response = await observeIntegrationCall({
      integration: 'twilio',
      operation: mediaUrl ? 'whatsapp_media' : 'whatsapp',
      fn: async () => {
        const result = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: formData.toString(),
            signal: controller.signal,
          }
        );

        if (!result.ok) {
          const errorData = await result.json() as { message?: string };
          throw new Error(errorData.message || `Twilio API error: ${result.status}`);
        }
        return result;
      },
    });

    const data = await response.json() as { sid: string };
    logger.info({ messageSid: data.sid, to }, 'Mensagem WhatsApp enviada com sucesso');
    return { success: true, messageSid: data.sid };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error, to }, 'Falha ao enviar mensagem WhatsApp');
    return { success: false, error: errorMessage };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Resultado do processamento de mensagem via Chat Service
 * Inclui suporte para escalação automática (handover)
 */
interface ChatMessageResult {
  response: string | null;
  escalated: boolean;
  humanMode: boolean;
  trigger?: string;
  error?: string;
}

/**
 * Processa mensagem via Chat Service (LLM + RAG)
 * Integrado com sistema de Handover/Takeover para escalação automática
 * 
 * O chat-service agora verifica shouldEscalate() e pode retornar:
 * - escalated: true → Conversa foi escalada para agente humano
 * - humanMode: true → Conversa já está em modo humano
 * - response: string → Resposta normal do LLM
 */
async function processMessageWithLLM(
  conversationId: string,
  message: string,
  tenantId?: string
): Promise<ChatMessageResult> {
  // RESILIÊNCIA: AbortController com timeout para chamada ao chat-service
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s para LLM processing

  try {
    const response = await fetch(`${CHAT_SERVICE_URL_FINAL}/api/chat/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(tenantId && { 'X-Tenant-Id': tenantId }),
      },
      body: JSON.stringify({
        conversationId,
        content: message,
        role: 'user',
        channel: 'whatsapp',
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Chat service error: ${response.status}`);
    }

    const data = await response.json() as {
      response?: string;
      escalated?: boolean;
      humanMode?: boolean;
      trigger?: string;
    };
    
    // Verificar se houve escalação automática
    if (data.escalated) {
      logger.info({
        conversationId,
        trigger: data.trigger,
        channel: 'whatsapp',
      }, 'Escalação automática detectada via WhatsApp');
      
      return {
        response: data.response || 'Um de nossos atendentes irá auxiliá-lo em breve. Por favor, aguarde.',
        escalated: true,
        humanMode: false,
        trigger: data.trigger,
      };
    }
    
    // Verificar se conversa está em modo humano
    if (data.humanMode) {
      logger.info({
        conversationId,
        channel: 'whatsapp',
      }, 'Conversa em modo humano - mensagem encaminhada para agente');
      
      return {
        response: null,
        escalated: false,
        humanMode: true,
      };
    }
    
    // Resposta normal do LLM
    return {
      response: data.response || '',
      escalated: false,
      humanMode: false,
    };
  } catch (error) {
    logger.error({ error, conversationId }, 'Falha ao processar mensagem com LLM');
    return {
      response: 'Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente.',
      escalated: false,
      humanMode: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Processa mídia recebida via WhatsApp e indexa no RAG
 * 
 * ARQUITETURA ENTERPRISE (17/12/2025):
 * - Imagens: OpenAI Vision (descrição textual, sem embeddings de imagem)
 * - Áudios: OpenAI ASR (gpt-4o-transcribe) + Qwen3-Embedding-0.6B embeddings (1024 dim → Qdrant)
 * - Vídeos: NÃO suportado (uploads `video/*` são rejeitados explicitamente)
 * 
 * @param mediaUrl - URL do Twilio para baixar a mídia
 * @param mediaContentType - MIME type da mídia
 * @param conversationId - ID da conversa para contexto
 * @param tenantId - ID do tenant para isolamento
 * @param userId - ID do usuário que enviou
 * @returns Promise com resultado do processamento
 */
async function processWhatsAppMediaForRAG(
  mediaUrl: string,
  mediaContentType: string,
  conversationId: string,
  tenantId: string,
  userId: string
): Promise<{ success: boolean; uploadId?: string; error?: string }> {
  // Determinar tipo de mídia
  // ATUALIZADO 23/12/2025: Apenas imagem e áudio são suportados (vídeo removido - muito pesado para GPU)
  // BUG FIX 23/12/2025: Validação defensiva explícita de tipos suportados ao invés de rejeitar tudo
  // Problema: Validação anterior rejeitava TODOS os tipos não-image/audio, incluindo edge cases futuros
  // Solução: Lista explícita de tipos suportados com mensagem de erro clara
  const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
  const SUPPORTED_AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/mp4'] as const;
  
  // BUG FIX 23/12/2025: Normalização robusta de content-type para suportar variações de case e espaços
  // WhatsApp pode enviar tipos com variações (ex: "Image/Jpeg", "audio/mpeg; codecs=mp3")
  // .toLowerCase() e .trim() garantem matching correto mesmo com variações
  // Extrair apenas o tipo base (antes de ;) para suportar parâmetros adicionais
  const normalizedContentType = mediaContentType.toLowerCase().trim().split(';')[0].trim();
  
  // BUG FIX 23/12/2025: Validação com type narrowing explícito para garantir type safety
  // includes() com type assertion garante que TypeScript entenda o tipo correto
  // Isso previne falsos negativos onde tipos legítimos são rejeitados por problemas de case/whitespace
  const isImage = SUPPORTED_IMAGE_TYPES.includes(normalizedContentType as typeof SUPPORTED_IMAGE_TYPES[number]);
  const isAudio = SUPPORTED_AUDIO_TYPES.includes(normalizedContentType as typeof SUPPORTED_AUDIO_TYPES[number]);
  
  // Validação defensiva: apenas tipos explicitamente suportados são aceitos
  if (!isImage && !isAudio) {
    logger.warn({
      mediaContentType: normalizedContentType,
      originalContentType: mediaContentType,
      conversationId,
      supportedTypes: {
        image: SUPPORTED_IMAGE_TYPES,
        audio: SUPPORTED_AUDIO_TYPES,
      },
    }, 'Tipo de mídia WhatsApp não suportado para RAG - apenas imagem e áudio são aceitos');
    return { 
      success: false, 
      error: `Tipo de mídia não suportado: ${mediaContentType}. Tipos suportados: imagens (${SUPPORTED_IMAGE_TYPES.join(', ')}) e áudio (${SUPPORTED_AUDIO_TYPES.join(', ')}).` 
    };
  }
  
  // RESILIÊNCIA: AbortController com timeout de 60s para download + upload
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);
  
  try {
    // Passo 1: Baixar mídia do Twilio (requer autenticação Basic)
    const twilioAuthHeader = Buffer.from(
      `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
    ).toString('base64');
    
    const mediaResponse = await fetch(mediaUrl, {
      headers: {
        'Authorization': `Basic ${twilioAuthHeader}`,
      },
      signal: controller.signal,
    });
    
    if (!mediaResponse.ok) {
      throw new Error(`Falha ao baixar mídia do Twilio: ${mediaResponse.status}`);
    }
    
    const mediaBuffer = Buffer.from(await mediaResponse.arrayBuffer());
    const mediaBase64 = mediaBuffer.toString('base64');
    
    // Determinar extensão do arquivo
    // ATUALIZADO 23/12/2025: Removido suporte a vídeo (muito pesado para GPU)
    // BUG FIX 23/12/2025: Usar normalizedContentType ao invés de mediaContentType para lookup
    // Problema: extensionMap tem chaves em lowercase, mas mediaContentType pode vir em mixed case (ex: Image/JPEG)
    // Se usar mediaContentType original, lookup falha e retorna 'bin' como fallback incorreto
    // Solução: Usar normalizedContentType (já convertido para lowercase) para lookup correto
    const extensionMap: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'audio/ogg': 'ogg',
      'audio/mpeg': 'mp3',
      'audio/mp4': 'm4a',
      'audio/wav': 'wav',
      'audio/webm': 'webm',
    };
    const extension = extensionMap[normalizedContentType] || 'bin';
    const mediaType = isImage ? 'image' : 'audio';
    
    // Gerar headers de autenticação interna
    // Role válidos: super_admin, admin, manager, operator, viewer, guest
    // 'operator' é apropriado para processamento automatizado de mídia
    const internalHeaders = generateInternalAuthHeaders({
      userId,
      tenantId,
      role: 'operator',
    });
    
    // Passo 2: Enviar para RAG Service via endpoint JSON (mais eficiente para base64)
    const ragResponse = await fetch(`${RAG_SERVICE_URL_FINAL}/api/media/upload/json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Signature': internalHeaders['x-internal-signature'],
        'X-Internal-Timestamp': internalHeaders['x-internal-timestamp'],
        'X-Tenant-Id': tenantId,
        'X-User-Id': userId,
      },
      body: JSON.stringify({
        // Bug fix: Campo deve ser 'file', não 'base64Data' (conforme jsonUploadSchema do RAG service)
        file: mediaBase64,
        filename: `whatsapp_${Date.now()}.${extension}`,
        mimeType: mediaContentType,
        description: `Mídia recebida via WhatsApp na conversa ${conversationId}`,
        conversationId,
      }),
      signal: controller.signal,
    });
    
    if (!ragResponse.ok) {
      const errorText = await ragResponse.text();
      throw new Error(`Falha ao enviar mídia para RAG: ${ragResponse.status} - ${errorText}`);
    }
    
    const ragData = await ragResponse.json() as { id?: string; uploadId?: string };
    const uploadId = ragData.id || ragData.uploadId;
    
    logger.info({
      uploadId,
      mediaType,
      conversationId,
      tenantId,
      sizeBytes: mediaBuffer.length,
    }, 'Mídia WhatsApp indexada no RAG com sucesso');
    
    return { success: true, uploadId };
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      mediaUrl,
      conversationId,
      tenantId,
    }, 'Erro ao processar mídia WhatsApp para RAG');
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Webhook principal para mensagens WhatsApp recebidas
 * Rota: POST /api/integrations/twilio/webhook/whatsapp
 */
app.post('/api/integrations/twilio/webhook/whatsapp', async (req: Request, res: Response) => {
  const twilioSignature = req.headers['x-twilio-signature'] as string;
  const webhookUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

  const contentTypeHeader = req.headers['content-type'];
  const contentType = Array.isArray(contentTypeHeader)
    ? contentTypeHeader[0]?.toLowerCase()
    : contentTypeHeader?.toLowerCase();
  if (!contentType || !contentType.startsWith('application/x-www-form-urlencoded')) {
    logger.warn({ contentType }, 'Webhook Twilio: content-type inválido');
    return res.status(400).send('Invalid content-type');
  }

  if (!TWILIO_AUTH_TOKEN) {
    logger.error('Webhook Twilio: TWILIO_AUTH_TOKEN não configurado');
    return res.status(500).send('Webhook secret not configured');
  }

  // SEGURANÇA: Validar que body é objeto (urlencoded produz objeto, não Buffer)
  // NOTA: express.urlencoded() sempre produz objeto Record<string, string>, nunca Buffer
  // DIFERENÇA COM STRIPE: Stripe usa express.raw() (Buffer), Twilio usa express.urlencoded() (objeto)
  // Se body for Buffer, significa que middleware incorreto foi aplicado (deveria ser urlencoded)
  if (Buffer.isBuffer(req.body)) {
    logger.error('Webhook Twilio: body é Buffer mas deveria ser objeto (middleware incorreto - use express.urlencoded(), não express.raw())');
    return res.status(500).send('Invalid middleware configuration');
  }
  // Validar que é objeto válido (não null, não primitivo)
  if (typeof req.body !== 'object' || req.body === null) {
    logger.error('Webhook Twilio: body inválido (deve ser objeto parseado por urlencoded)');
    return res.status(500).send('Invalid body format');
  }

  // CRÍTICO: Validar assinatura ANTES de responder
  const validation = validateTwilioSignature(
    twilioSignature,
    webhookUrl,
    req.body as Record<string, string>
  );

  if (!validation.valid) {
    logger.warn({ webhookUrl, reason: validation.reason }, 'Assinatura Twilio inválida - webhook rejeitado');
    res.status(403).send('Forbidden');
    return;
  }

  // Responder ao Twilio após validação bem-sucedida
  res.set('Content-Type', 'text/xml');
  res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');

  // Processar webhook de forma assíncrona (após resposta enviada)
  try {
    // OWASP API3 - Validação Zod (não rejeita por falha pois já respondemos 200)
    const parseResult = twilioWebhookSchema.safeParse(req.body);
    if (!parseResult.success) {
      logger.warn({ errors: parseResult.error.flatten() }, 'Payload Twilio inválido');
      return;
    }
    const {
      MessageSid,
      From,
      To,
      Body,
      NumMedia,
      MediaUrl0,
      MediaContentType0,
    } = parseResult.data;

    logger.info({
      messageSid: MessageSid,
      from: From,
      hasMedia: parseInt(NumMedia || '0') > 0,
    }, 'Webhook WhatsApp recebido');

    const db = getDatabase();

    // Normalizar número de telefone (remover 'whatsapp:')
    const phoneNumber = From.replace('whatsapp:', '');

    // Buscar ou criar usuário pelo telefone
    let user = await db.query.users.findFirst({
      where: eq(schema.users.telefone, phoneNumber),
    });

    if (!user) {
      // Criar usuário temporário para WhatsApp
      const [newUser] = await db.insert(schema.users).values({
        email: `whatsapp_${phoneNumber.replace(/\+/g, '')}@temp.alice.app`,
        telefone: phoneNumber,
        firstName: 'WhatsApp',
        lastName: `User ${phoneNumber.slice(-4)}`,
        authProvider: 'whatsapp',
        role: 'guest',
      }).returning();
      user = newUser;
      logger.info({ userId: user.id, phone: phoneNumber }, 'Novo usuário WhatsApp criado');
    }

    // Buscar ou criar conversa ativa para este usuário via WhatsApp
    let conversation = await db.query.conversations.findFirst({
      where: (c, { and, eq: e }) => and(
        e(c.userId, user.id),
        e(c.status, 'active'),
        e(c.metadata, sql`metadata->>'channel' = 'whatsapp'`)
      ),
      orderBy: [desc(schema.conversations.criadoEm)],
    });

    if (!conversation) {
      // Criar nova conversa para WhatsApp
      const [newConversation] = await db.insert(schema.conversations).values({
        userId: user.id,
        titulo: `WhatsApp - ${phoneNumber}`,
        status: 'active',
        metadata: {
          channel: 'whatsapp',
          phoneNumber,
          twilioFrom: From,
          twilioTo: To,
        },
      }).returning();
      conversation = newConversation;
      logger.info({ conversationId: conversation.id }, 'Nova conversa WhatsApp criada');
    }

    // Salvar mensagem do usuário
    await db.insert(schema.messages).values({
      conversationId: conversation.id,
      userId: user.id,
      isFromUser: true,
      conteudo: Body,
      tipo: parseInt(NumMedia || '0') > 0 ? 'mixed' : 'text',
      metadata: {
        twilioMessageSid: MessageSid,
        mediaUrl: MediaUrl0,
        mediaContentType: MediaContentType0,
        channel: 'whatsapp',
      },
    });

    // ARQUITETURA 100% GPU (15/12/2025): Processar mídia WhatsApp para RAG
    // Executa em background (fire-and-forget) para não bloquear a resposta ao usuário
    // Mídia será indexada com embeddings (imagem) ou transcrita + embeddings (áudio/vídeo)
    if (MediaUrl0 && MediaContentType0 && user.tenantId) {
      processWhatsAppMediaForRAG(
        MediaUrl0,
        MediaContentType0,
        conversation.id,
        user.tenantId,
        user.id
      ).catch(err => {
        logger.error({
          error: err instanceof Error ? err.message : String(err),
          mediaUrl: MediaUrl0,
          conversationId: conversation.id,
        }, 'Erro ao processar mídia WhatsApp para RAG (não crítico)');
      });
    }

    // Verificar estado de handover/takeover
    const conversationState = await db.query.conversationStates.findFirst({
      where: eq(schema.conversationStates.conversationId, conversation.id),
    });

    // Se a conversa está em modo humano, não responder automaticamente
    if (conversationState?.controlMode === 'human') {
      logger.info({
        conversationId: conversation.id,
        controlMode: 'human',
      }, 'Conversa em modo humano - mensagem salva sem resposta automática');

      // Notificar agente humano via chat-service WebSocket
      // RESILIÊNCIA: AbortController com timeout curto para notificação
      const notifyController = new AbortController();
      const notifyTimeoutId = setTimeout(() => notifyController.abort(), 5000);
      try {
        await fetch(`${CHAT_SERVICE_URL_FINAL}/api/chat/notify-agent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversationId: conversation.id,
            type: 'new_message',
            message: Body,
            from: phoneNumber,
          }),
          signal: notifyController.signal,
        });
      } catch (notifyError) {
        logger.warn({ error: notifyError }, 'Falha ao notificar agente humano');
      } finally {
        clearTimeout(notifyTimeoutId);
      }
      return;
    }

    // Processar mensagem com LLM via Chat Service
    // Inclui verificação automática de handover/escalação
    const chatResult = await processMessageWithLLM(
      conversation.id,
      Body,
      user.tenantId ?? undefined
    );

    // Se conversa está em modo humano, não enviar resposta automática
    if (chatResult.humanMode) {
      logger.info({
        conversationId: conversation.id,
        channel: 'whatsapp',
      }, 'Conversa em modo humano - aguardando resposta do agente');
      return;
    }

    // Se houve escalação automática, enviar mensagem de notificação
    if (chatResult.escalated) {
      logger.info({
        conversationId: conversation.id,
        trigger: chatResult.trigger,
        channel: 'whatsapp',
      }, 'Escalação automática processada via WhatsApp');
      
      // Salvar mensagem de escalação
      await db.insert(schema.messages).values({
        conversationId: conversation.id,
        isFromUser: false,
        conteudo: chatResult.response || 'Um de nossos atendentes irá auxiliá-lo em breve.',
        tipo: 'text',
        metadata: {
          channel: 'whatsapp',
          escalated: true,
          escalationTrigger: chatResult.trigger,
        },
      });
      
      // Enviar notificação de escalação via WhatsApp
      const escalationMessage = chatResult.response || 'Um de nossos atendentes irá auxiliá-lo em breve. Por favor, aguarde.';
      const sendResult = await sendWhatsAppMessage(From, escalationMessage);
      
      if (!sendResult.success) {
        logger.error({
          conversationId: conversation.id,
          error: sendResult.error,
        }, 'Falha ao enviar notificação de escalação WhatsApp');
      }
      
      return;
    }

    // Resposta normal do LLM
    if (chatResult.response) {
      // Salvar resposta do bot
      await db.insert(schema.messages).values({
        conversationId: conversation.id,
        isFromUser: false,
        conteudo: chatResult.response,
        tipo: 'text',
        metadata: {
          channel: 'whatsapp',
          generatedBy: 'llm',
        },
      });

      // Enviar resposta via WhatsApp
      const sendResult = await sendWhatsAppMessage(From, chatResult.response);

      if (!sendResult.success) {
        logger.error({
          conversationId: conversation.id,
          error: sendResult.error,
        }, 'Falha ao enviar resposta WhatsApp');
      }

      // GAP CRÍTICO #2: Coletar dados de treinamento para WhatsApp
      // Alice MULTIMODAL: coleta dados de texto, imagens, áudio, vídeo do WhatsApp para aprendizado
      // Rating inferido: se não houve escalação = positivo (5), se houve = negativo (1)
      // REGRA 6: Enterprise-grade - integração real com training-service (sem mocks)
      try {
        const rating = chatResult.escalated ? 1 : 5; // Inferir rating baseado em escalação
        
        // VALIDAÇÃO: Só coletar dados se houver resposta válida do LLM
        // Previne coleta de dados malformados (rating alto com resposta vazia)
        const hasValidResponse = chatResult.response && chatResult.response.trim().length > 0;
        
        // Coletar dados apenas se:
        // 1. Rating >= 4 (positivo) E houver resposta válida, OU
        // 2. Houve escalação (para aprendizado negativo) E houver resposta válida
        // 3. Conversa ainda não foi enviada para treinamento (evita duplicidade)
        if (!conversation.sentToTrainingAt && (rating >= 4 || chatResult.escalated) && hasValidResponse) {
          // conversations não possui objeto agent; usar namespaceId já persistido na conversa
          const namespaceId = conversation.namespaceId || undefined;
          const tenantId = user.tenantId;
          
          if (tenantId) {
            // Gerar headers de autenticação interna para training-service
            const internalHeaders = generateInternalAuthHeaders({
              userId: user.id,
              tenantId: tenantId,
              role: 'super_admin', // Service-to-service usa role privilegiado
            });
            
            // RESILIÊNCIA: AbortController com timeout para prevenir hang
            const trainingController = new AbortController();
            const trainingTimeoutId = setTimeout(() => trainingController.abort(), 10000); // 10s timeout
            
            try {
              // Chamar training-service para coletar dados
              const trainingResponse = await fetch(`${TRAINING_SERVICE_URL_FINAL}/api/training/data`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Internal-Signature': internalHeaders['x-internal-signature'],
                  'X-Internal-Timestamp': internalHeaders['x-internal-timestamp'],
                  'X-Internal-User-Id': user.id,
                  'X-Internal-Tenant-Id': tenantId,
                  'X-Internal-Role': 'super_admin',
                },
                body: JSON.stringify({
                  tenantId: tenantId,
                  namespaceId: namespaceId || undefined,
                  conversationId: conversation.id,
                  source: 'whatsapp', // Fonte: WhatsApp
                  messages: [
                    { role: 'user', content: Body },
                    { role: 'assistant', content: chatResult.response },
                  ],
                  rating: rating,
                }),
                signal: trainingController.signal,
              });
              
              if (!trainingResponse.ok) {
                const errorText = await trainingResponse.text();
                logger.error({ 
                  conversationId: conversation.id, 
                  status: trainingResponse.status,
                  error: errorText,
                }, 'Falha ao coletar dados de treinamento do WhatsApp');
              } else {
                const trainingData = await trainingResponse.json() as { trainingData?: { id: string }; isDuplicate?: boolean };
                logger.info({ 
                  conversationId: conversation.id, 
                  trainingDataId: trainingData.trainingData?.id,
                  isDuplicate: trainingData.isDuplicate,
                  rating: rating,
                  source: 'whatsapp',
                }, 'Dados de treinamento do WhatsApp coletados com sucesso');
                await getDatabase()
                  .update(schema.conversations)
                  .set({ sentToTrainingAt: new Date(), atualizadoEm: new Date() })
                  .where(eq(schema.conversations.id, conversation.id));
              }
            } finally {
              clearTimeout(trainingTimeoutId);
            }
          }
        }
      } catch (trainingError) {
        // Não falhar o webhook se coleta de treinamento falhar (não crítico)
        logger.error({ error: trainingError, conversationId: conversation.id }, 'Erro ao coletar dados de treinamento do WhatsApp (não crítico)');
      }
    }

  } catch (error) {
    logger.error({ error }, 'Erro ao processar webhook WhatsApp');
  }
});

/**
 * Webhook para status de mensagens Twilio
 * Rota: POST /api/integrations/twilio/webhook/status
 */
app.post('/api/integrations/twilio/webhook/status', async (req: Request, res: Response) => {
  const twilioSignature = req.headers['x-twilio-signature'] as string;
  const webhookUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

  const contentTypeHeader = req.headers['content-type'];
  const contentType = Array.isArray(contentTypeHeader)
    ? contentTypeHeader[0]?.toLowerCase()
    : contentTypeHeader?.toLowerCase();
  if (!contentType || !contentType.startsWith('application/x-www-form-urlencoded')) {
    logger.warn({ contentType }, 'Webhook Twilio status: content-type inválido');
    return res.status(400).send('Invalid content-type');
  }

  if (!TWILIO_AUTH_TOKEN) {
    logger.error('Webhook Twilio: TWILIO_AUTH_TOKEN não configurado');
    return res.status(500).send('Webhook secret not configured');
  }

  // SEGURANÇA: Validar que body é objeto (urlencoded produz objeto, não Buffer)
  // NOTA: express.urlencoded() sempre produz objeto Record<string, string>, nunca Buffer
  // Se alguém adicionar verificação Buffer.isBuffer() aqui, sempre falhará incorretamente
  if (Buffer.isBuffer(req.body) || typeof req.body !== 'object' || req.body === null) {
    logger.error('Webhook Twilio status: body inválido (deve ser objeto parseado por urlencoded, não Buffer)');
    return res.status(500).send('Invalid body format');
  }

  // CRÍTICO: Validar assinatura ANTES de responder
  const validation = validateTwilioSignature(
    twilioSignature,
    webhookUrl,
    req.body as Record<string, string>
  );

  if (!validation.valid) {
    logger.warn({ webhookUrl, reason: validation.reason }, 'Assinatura Twilio inválida - status webhook rejeitado');
    res.status(403).send('Forbidden');
    return;
  }

  // Responder ao Twilio após validação bem-sucedida
  res.set('Content-Type', 'text/xml');
  res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');

  try {
    // OWASP API3 - Validação Zod (não rejeita por falha pois já respondemos 200)
    const parseResult = twilioStatusSchema.safeParse(req.body);
    if (!parseResult.success) {
      logger.warn({ errors: parseResult.error.flatten() }, 'Payload status Twilio inválido');
      return;
    }
    const {
      MessageSid,
      MessageStatus,
      ErrorCode,
      ErrorMessage,
      To,
    } = parseResult.data;

    logger.info({
      messageSid: MessageSid,
      status: MessageStatus,
      errorCode: ErrorCode,
      to: To,
    }, 'Status de mensagem Twilio recebido');

    // Atualizar metadata da mensagem com status
    if (MessageStatus === 'failed' || MessageStatus === 'undelivered') {
      logger.error({
        messageSid: MessageSid,
        status: MessageStatus,
        errorCode: ErrorCode,
        errorMessage: ErrorMessage,
      }, 'Mensagem WhatsApp falhou na entrega');

      // Registrar falha em audit log se necessário
      const db = getDatabase();
      await db.insert(schema.auditLogs).values({
        acao: 'whatsapp_delivery_failed',
        recurso: 'message',
        detalhes: {
          messageSid: MessageSid,
          status: MessageStatus,
          errorCode: ErrorCode,
          errorMessage: ErrorMessage,
          to: To,
        },
      });
    }
  } catch (error) {
    logger.error({ error }, 'Erro ao processar webhook de status Twilio');
  }
});

/**
 * Enviar mensagem WhatsApp manualmente (para handover humano)
 * Rota: POST /api/integrations/twilio/send
 */
app.post('/api/integrations/twilio/send', requirePermission('integrations:twilio:write'), async (req: Request, res: Response) => {
  // OWASP API3 - Validação Zod obrigatória
  const parseResult = twilioSendSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Input inválido' });
  }
  const { to, message, conversationId, mediaUrl } = parseResult.data;

  try {
    const result = await sendWhatsAppMessage(to, message, mediaUrl);

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    // Se conversationId fornecido, salvar mensagem no histórico
    if (conversationId) {
      const db = getDatabase();
      const authContext = extractAuthContext(req);

      await db.insert(schema.messages).values({
        conversationId,
        userId: authContext?.userId,
        isFromUser: false,
        conteudo: message,
        tipo: mediaUrl ? 'mixed' : 'text',
        metadata: {
          channel: 'whatsapp',
          twilioMessageSid: result.messageSid,
          sentByAgent: true,
          mediaUrl,
        },
      });
    }

    res.json({ success: true, messageSid: result.messageSid });
  } catch (error) {
    logger.error({ error, to }, 'Falha ao enviar mensagem WhatsApp');
    res.status(500).json({ error: 'Falha ao enviar mensagem' });
  }
});

/**
 * Status da integração Twilio
 * Rota: GET /api/integrations/twilio/status
 */
app.get('/api/integrations/twilio/status', (_req: Request, res: Response) => {
  const configured = !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_WHATSAPP_NUMBER);
  res.json({
    configured,
    accountSid: TWILIO_ACCOUNT_SID ? '***' + TWILIO_ACCOUNT_SID.slice(-4) : null,
    whatsappNumber: TWILIO_WHATSAPP_NUMBER ? TWILIO_WHATSAPP_NUMBER.slice(-4) : null,
  });
});

// ============================================================================
// KuCoin Trading - Configurações e validações (definido ANTES do bootstrap)
// ============================================================================
const KUCOIN_REST_ORDERBOOK_DEPTHS = [20] as const;
const KUCOIN_WS_ORDERBOOK_DEPTHS = [5, 50] as const;

function parseTradingIntervalToMinutes(interval: string): number | null {
  const normalized = interval.trim().toLowerCase();
  const match = /^(\d+)(m|h|d|w)$/.exec(normalized);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = match[2];
  if (unit === 'm') return value;
  if (unit === 'h') return value * 60;
  if (unit === 'd') return value * 1440;
  if (unit === 'w') return value * 10080;
  return null;
}

function resolveKucoinRestOrderBookDepth(): 20 {
  const raw = process.env.KUCOIN_REST_ORDERBOOK_DEPTH;
  if (!raw) {
    throw new Error('KUCOIN_REST_ORDERBOOK_DEPTH não configurado');
  }
  const parsed = Number(raw);
  if (!KUCOIN_REST_ORDERBOOK_DEPTHS.includes(parsed as (typeof KUCOIN_REST_ORDERBOOK_DEPTHS)[number])) {
    throw new Error(`KUCOIN_REST_ORDERBOOK_DEPTH inválido: ${raw}. Use 20.`);
  }
  return parsed as 20;
}

function resolveTradingIntervals(): {
  intervals: string[];
  granularityMap: Record<string, number>;
  wsIntervalMap: Record<string, string>;
  defaultInterval: string;
  restOrderBookDepth: 20;
  restOrderBookDepths: number[];
  wsOrderBookDepth: 5 | 50;
  wsOrderBookDepths: number[];
} {
  const intervals = tradingIntervalEnum.enumValues;
  if (!intervals.length) {
    throw new Error('Enum de intervalos de trading vazio');
  }
  const granularityMap: Record<string, number> = {};
  const wsIntervalMap: Record<string, string> = {};
  for (const interval of intervals) {
    const minutes = parseTradingIntervalToMinutes(interval);
    if (!minutes) {
      throw new Error(`Intervalo de trading inválido no schema: ${interval}`);
    }
    granularityMap[interval] = minutes;
    wsIntervalMap[interval] = kucoinClient.granularityToInterval(minutes);
  }
  return {
    intervals: [...intervals],
    granularityMap,
    wsIntervalMap,
    defaultInterval: intervals[0]!,
    restOrderBookDepth: resolveKucoinRestOrderBookDepth(),
    restOrderBookDepths: [...KUCOIN_REST_ORDERBOOK_DEPTHS],
    wsOrderBookDepth: resolveKucoinWsOrderBookDepth(),
    wsOrderBookDepths: [...KUCOIN_WS_ORDERBOOK_DEPTHS],
  };
}

function getAllowedGranularitiesMinutes(): number[] {
  const minutes = tradingIntervalEnum.enumValues
    .map((interval) => parseTradingIntervalToMinutes(interval))
    .filter((value): value is number => value !== null);
  return minutes.sort((a, b) => a - b);
}

function resolveKucoinWsOrderBookDepth(): 5 | 50 {
  const raw = process.env.KUCOIN_WS_ORDERBOOK_DEPTH;
  if (!raw) {
    throw new Error('KUCOIN_WS_ORDERBOOK_DEPTH não configurado');
  }
  const parsed = Number(raw);
  if (!KUCOIN_WS_ORDERBOOK_DEPTHS.includes(parsed as (typeof KUCOIN_WS_ORDERBOOK_DEPTHS)[number])) {
    throw new Error(`KUCOIN_WS_ORDERBOOK_DEPTH inválido: ${raw}. Use 5 ou 50.`);
  }
  return parsed as 5 | 50;
}

function isValidKucoinWsInterval(interval: string): boolean {
  const normalized = interval.trim();
  const granularity = kucoinClient.intervalToGranularity(normalized);
  return kucoinClient.granularityToInterval(granularity) === normalized;
}

type SpotMarginMarketType = 'spot' | 'margin';
type SpotWsSubscriptionKey = `${SpotMarginMarketType}:${'cross' | 'isolated' | 'none'}`;
type SpotWsSubscriptionMeta = { marketType: SpotMarginMarketType; marginMode?: 'cross' | 'isolated' };
const spotWsTopicMarketTypes = new Map<string, Set<SpotWsSubscriptionKey>>();

function buildSpotWsSubscriptionKey(marketType: SpotMarginMarketType, marginMode?: 'cross' | 'isolated'): SpotWsSubscriptionKey {
  if (marketType === 'margin') {
    return `margin:${marginMode ?? 'cross'}`;
  }
  return 'spot:none';
}

function registerSpotWsMarketType(topic: string, marketType: SpotMarginMarketType, marginMode?: 'cross' | 'isolated'): void {
  const key = buildSpotWsSubscriptionKey(marketType, marginMode);
  const existing = spotWsTopicMarketTypes.get(topic);
  if (existing) {
    existing.add(key);
    return;
  }
  spotWsTopicMarketTypes.set(topic, new Set([key]));
}

function unregisterSpotWsMarketType(topic: string, marketType: SpotMarginMarketType, marginMode?: 'cross' | 'isolated'): boolean {
  const key = buildSpotWsSubscriptionKey(marketType, marginMode);
  const existing = spotWsTopicMarketTypes.get(topic);
  if (!existing) return false;
  existing.delete(key);
  if (existing.size === 0) {
    spotWsTopicMarketTypes.delete(topic);
    return true;
  }
  return false;
}

function getSpotMarketTypesForTopic(topic: string): SpotWsSubscriptionMeta[] {
  const existing = spotWsTopicMarketTypes.get(topic);
  if (!existing) return [];
  return Array.from(existing).map((key) => {
    const [marketType, marginMode] = key.split(':') as [SpotMarginMarketType, 'cross' | 'isolated' | 'none'];
    return marketType === 'margin' ? { marketType, marginMode: marginMode === 'none' ? 'cross' : marginMode } : { marketType };
  });
}

function resolveSpotSymbolFromTopic(topic: string): string | null {
  const parts = topic.split(':');
  if (parts.length < 2) return null;
  const symbolPart = parts[1] ?? '';
  const symbol = symbolPart.split('_')[0]?.trim();
  return symbol ? symbol.toUpperCase() : null;
}

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
    if (process.env.NODE_ENV === 'production') {
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
          if (process.env.NODE_ENV === 'production') {
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

function respondKucoinNotConfigured(res: Response): void {
  res.status(503).json({ error: 'API KuCoin não configurada' });
}

async function resolveTradingSymbolOrRespond(
  res: Response,
  authContext: { tenantId: string; userId: string },
  symbol?: string,
  options: { required?: boolean; marketType?: 'futures' | 'spot' | 'margin'; marginMode?: 'cross' | 'isolated' } = {}
): Promise<string | undefined> {
  if (options.required && !symbol) {
    res.status(400).json({ error: 'Símbolo é obrigatório para esta operação.' });
    return undefined;
  }

  try {
    return options.required
      ? await kucoinService.resolveTradingSymbolStrict(authContext, symbol, options.marketType, options.marginMode)
      : await kucoinService.resolveTradingSymbol(authContext, symbol, options.marketType, options.marginMode);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Símbolo inválido';
    res.status(400).json({ error: errorMessage });
    return undefined;
  }
}

function resolveMarketTypeParam(params: {
  marketType?: 'futures' | 'spot' | 'margin';
  type?: 'futures' | 'spot' | 'margin';
}): 'futures' | 'spot' | 'margin' | undefined {
  return params.marketType ?? params.type;
}

function resolveSymbolFromQuery(req: Request): string | undefined {
  const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.trim() : undefined;
  return symbol || undefined;
}

function resolveTradingIntervalGranularity(interval: string): number | null {
  const key = interval as TradingIntervalValue;
  if (key in TRADING_INTERVAL_GRANULARITY) {
    return TRADING_INTERVAL_GRANULARITY[key];
  }
  return null;
}

function normalizeSignalSymbols(rawSymbols: string[]): string[] {
  const normalized = rawSymbols
    .map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol) => symbol.length > 0);
  return Array.from(new Set(normalized));
}

function normalizeSymbolList(rawSymbols: string[], allowedSymbols: string[]): string[] {
  const normalized = rawSymbols
    .map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol) => symbol.length > 0);
  const unique = Array.from(new Set(normalized));
  if (allowedSymbols.length === 0) return unique;
  const allowedSet = new Set(allowedSymbols);
  return unique.filter((symbol) => allowedSet.has(symbol));
}

async function fetchTradingSymbolPreferences(
  tenantId: string,
  userId: string,
  marketType: 'futures' | 'spot' | 'margin',
  marginMode: 'cross' | 'isolated'
) {
  const db = getDatabase();
  const [row] = await db
    .select()
    .from(schema.tradingSymbolPreferences)
    .where(and(
      eq(schema.tradingSymbolPreferences.tenantId, tenantId),
      eq(schema.tradingSymbolPreferences.userId, userId),
      eq(schema.tradingSymbolPreferences.marketType, marketType),
      eq(schema.tradingSymbolPreferences.marginMode, marginMode)
    ))
    .limit(1);
  return row ?? null;
}

function stripJsonCodeFence(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith('```')) {
    return trimmed
      .replace(/^```[a-z]*\s*/i, '')
      .replace(/```$/, '')
      .trim();
  }
  return trimmed;
}

function stripListPrefix(line: string): { value: string; stripped: boolean } {
  const stripped = line.replace(/^(?:[-*•]\s+|\d+[).\]]\s+|\d+\s*-\s+)/, '');
  return { value: stripped, stripped: stripped !== line };
}

function sanitizeJsonCandidate(content: string): { json: string; repaired: boolean } {
  if (!content) return { json: content, repaired: false };
  let repaired = false;
  const withoutBom = content.replace(/^\uFEFF/, '');
  if (withoutBom !== content) repaired = true;

  const lines = withoutBom.split('\n').map((line) => {
    const trimmedStart = line.trimStart();
    if (!trimmedStart) return line;

    const stripped = stripListPrefix(trimmedStart);
    if (stripped.stripped) {
      repaired = true;
      const indent = line.slice(0, line.length - trimmedStart.length);
      return `${indent}${stripped.value}`;
    }

    if (/^json\s*[:{-]/i.test(trimmedStart)) {
      const next = trimmedStart.replace(/^json\s*[:]?/i, '').trimStart();
      if (next) {
        repaired = true;
        const indent = line.slice(0, line.length - trimmedStart.length);
        return `${indent}${next}`;
      }
    }

    return line;
  });

  return { json: lines.join('\n'), repaired };
}

function buildLlmResponseSnippet(content: string, limit = 220): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit)}…`;
}

function extractJsonObjectCandidate(content: string): string {
  const cleaned = stripJsonCodeFence(content).trim();
  if (!cleaned) return cleaned;

  let inString = false;
  let escaping = false;
  let started = false;
  let depth = 0;
  let output = '';

  for (let i = 0; i < cleaned.length; i += 1) {
    const char = cleaned[i];
    if (escaping) {
      if (started) output += char;
      escaping = false;
      continue;
    }
    if (char === '\\') {
      if (started) output += char;
      if (inString) escaping = true;
      continue;
    }
    if (char === '"') {
      if (started) output += char;
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === '{') {
        depth += 1;
        started = true;
        output += char;
        continue;
      }
      if (char === '}' && started) {
        depth -= 1;
        output += char;
        if (depth === 0) {
          return output.trim();
        }
        continue;
      }
    }
    if (started) {
      output += char;
    }
  }

  return output.trim() || cleaned;
}

const TRADING_LLM_SIGNAL_KEYS = new Set([
  'signalType',
  'operationType',
  'expectedDurationMinutes',
  'confidence',
  'tradeSummary',
  'motivators',
  'invalidationReasons',
  'reasoning',
  'timeframeUsed',
  'citedValues',
  'suggestedPrice',
  'suggestedStopLoss',
  'suggestedTakeProfit',
  'suggestedSize',
  'riskReward',
  'marketCondition',
  'riskScore',
]);

type NormalizeLlmJsonKeysOptions = {
  allowAnyKey?: boolean;
};

function shouldNormalizeLlmKey(key: string, allowAnyKey: boolean): boolean {
  return allowAnyKey || TRADING_LLM_SIGNAL_KEYS.has(key);
}

function coerceNumericField(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeLlmSignalPayload(payload: Record<string, unknown>): {
  normalized: Record<string, unknown>;
  citedValuesSource: 'llm_payload' | 'regex';
} {
  const normalized = { ...payload };
  let citedValuesSource: 'llm_payload' | 'regex' = 'regex';
  const numericKeys = [
    'expectedDurationMinutes',
    'confidence',
    'suggestedPrice',
    'suggestedStopLoss',
    'suggestedTakeProfit',
    'suggestedSize',
    'riskReward',
    'riskScore',
  ] as const;

  for (const key of numericKeys) {
    if (key in normalized) {
      const coerced = coerceNumericField(normalized[key]);
      if (coerced === undefined) {
        delete normalized[key];
      } else {
        normalized[key] = coerced;
      }
    }
  }

  // Normalizar confidence para escala 0-1 (LLM pode retornar 0-100 ou 0-10)
  if (typeof normalized.confidence === 'number' && normalized.confidence > 1) {
    normalized.confidence = normalized.confidence > 10
      ? normalized.confidence / 100  // Escala 0-100 → 0-1
      : normalized.confidence / 10;  // Escala 0-10 → 0-1
  }

  // riskReward deve ser > 0; se inválido, remover para Zod aceitar como undefined (optional)
  if (typeof normalized.riskReward === 'number' && normalized.riskReward <= 0) {
    delete normalized.riskReward;
  }

  if (typeof normalized.motivators === 'string') {
    normalized.motivators = [normalized.motivators].filter(Boolean);
  }
  if (typeof normalized.invalidationReasons === 'string') {
    normalized.invalidationReasons = [normalized.invalidationReasons].filter(Boolean);
  }

  if (normalized.citedValues && typeof normalized.citedValues === 'object' && !Array.isArray(normalized.citedValues)) {
    const citedValues = normalized.citedValues as Record<string, unknown>;
    const next: Record<string, number> = {};
    for (const [key, value] of Object.entries(citedValues)) {
      const coerced = coerceNumericField(value);
      if (coerced !== undefined) {
        next[key] = coerced;
      }
    }
    if (Object.keys(next).length > 0) {
      citedValuesSource = 'llm_payload';
      normalized.citedValues = next;
    } else {
      normalized.citedValues = {};
    }
  }

  const shouldFallbackToRegex = !normalized.citedValues
    || (typeof normalized.citedValues === 'object' && !Array.isArray(normalized.citedValues) && Object.keys(normalized.citedValues).length === 0);
  if (shouldFallbackToRegex) {
    const reasoning = typeof normalized.reasoning === 'string' ? normalized.reasoning : '';
    const extracted = extractValuesFromLLMResponse(reasoning);
    const extractedValues = Object.entries(extracted).reduce<Record<string, number>>((acc, [key, value]) => {
      if (value !== undefined) acc[key] = value;
      return acc;
    }, {});
    citedValuesSource = 'regex';
    normalized.citedValues = Object.keys(extractedValues).length > 0 ? extractedValues : {};
  }

  return { normalized, citedValuesSource };
}

function normalizeLlmJsonKeys(
  content: string,
  options: NormalizeLlmJsonKeysOptions = {}
): { json: string; repaired: boolean } {
  const allowAnyKey = options.allowAnyKey ?? false;
  const singleQuotedKeys = content.replace(/'([A-Za-z_][A-Za-z0-9_]*)'\s*:/g, '"$1":');
  const preprocessedContent = singleQuotedKeys.replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, ':"$1"');
  const source = preprocessedContent;
  let repaired = false;
  let inString = false;
  let escaping = false;
  let output = '';
  let i = 0;

  const isIdentifierStart = (char: string) => /[A-Za-z_]/.test(char);
  const isIdentifierChar = (char: string) => /[A-Za-z0-9_]/.test(char);
  const isWhitespace = (char: string) => /\s/.test(char);
  const listPrefixRegex = /^(?:[-*•]\s+|\d+[).\]]\s+|\d+\s*-\s+)/;

  while (i < source.length) {
    const char = source[i];
    if (escaping) {
      output += char;
      escaping = false;
      i += 1;
      continue;
    }
    if (char === '\\') {
      output += char;
      if (inString) escaping = true;
      i += 1;
      continue;
    }
    if (char === '"') {
      output += char;
      inString = !inString;
      i += 1;
      continue;
    }
    if (!inString && (char === '{' || char === ',')) {
      output += char;
      i += 1;
      while (i < source.length && isWhitespace(source[i])) {
        output += source[i];
        i += 1;
      }
      if (i >= source.length) break;

      const remaining = source.slice(i);
      const listPrefixMatch = remaining.match(listPrefixRegex);
      if (listPrefixMatch) {
        repaired = true;
        i += listPrefixMatch[0].length;
      }
      while (i < source.length && isWhitespace(source[i])) {
        output += source[i];
        i += 1;
      }
      if (i >= source.length) break;

      if (source[i] === "'") {
        const start = i + 1;
        let end = start;
        while (end < source.length && source[end] !== "'") {
          end += 1;
        }
        if (end < source.length) {
          const key = source.slice(start, end);
          let cursor = end + 1;
          while (cursor < source.length && isWhitespace(source[cursor])) cursor += 1;
        if (source[cursor] === ':' && shouldNormalizeLlmKey(key, allowAnyKey)) {
            output += `"${key}"`;
            output += source.slice(end + 1, cursor);
            output += ':';
            repaired = true;
            i = cursor + 1;
            continue;
          }
        }
        output += source[i];
        i += 1;
        continue;
      }

      if (isIdentifierStart(source[i])) {
        const start = i;
        let end = start + 1;
        while (end < source.length && isIdentifierChar(source[end])) {
          end += 1;
        }
        const key = source.slice(start, end);
        let cursor = end;
        while (cursor < source.length && isWhitespace(source[cursor])) cursor += 1;
        if (source[cursor] === ':' && shouldNormalizeLlmKey(key, allowAnyKey)) {
          output += `"${key}"`;
          output += source.slice(end, cursor);
          output += ':';
          repaired = true;
          i = cursor + 1;
          continue;
        }
      }
      // =======================================================================
      // CORREÇÃO 08/02/2026: char ('{' ou ',') JÁ foi emitido na linha acima
      // e i JÁ foi avançado. Sem este continue, o loop caía para
      // output += char; i += 1; que DUPLICAVA o caractere e PULAVA o próximo,
      // corrompendo JSON válido do LLM (ex: "{{" ao invés de "{").
      // =======================================================================
      continue;
    }

    output += char;
    i += 1;
  }

  return { json: output, repaired };
}

function escapeJsonString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

function quoteJsonString(value: string): string {
  return `"${escapeJsonString(value)}"`;
}

function coerceYamlLikeValue(value: string): string {
  const raw = value.trim().replace(/,+\s*$/, '');
  if (!raw) return '""';
  if (raw.startsWith('"') || raw.startsWith('[') || raw.startsWith('{')) {
    return raw;
  }
  if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) {
    return quoteJsonString(raw.slice(1, -1));
  }
  if (/^(true|false|null)$/i.test(raw)) {
    return raw.toLowerCase();
  }
  if (/^-?\d+(?:[.,]\d+)?$/.test(raw)) {
    return raw.replace(',', '.');
  }
  return quoteJsonString(raw);
}

function repairYamlLikeObject(content: string): { json: string; repaired: boolean } {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return { json: content, repaired: false };
  }

  const lines = trimmed.split(/\r?\n/);
  const props: string[] = [];
  let repaired = false;
  let insideObject = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('{')) {
      insideObject = true;
      continue;
    }
    if (line.startsWith('}')) {
      break;
    }
    if (!insideObject) continue;

    const prefixed = stripListPrefix(line);
    if (prefixed.stripped) repaired = true;
    let work = prefixed.value.replace(/,+\s*$/, '');
    if (work.startsWith('-')) {
      work = work.replace(/^-\s*/, '');
      repaired = true;
    }
    const singleQuotedKey = work.match(/^'([^']+)'\s*:/);
    if (singleQuotedKey && TRADING_LLM_SIGNAL_KEYS.has(singleQuotedKey[1])) {
      work = work.replace(/^'([^']+)'\s*:/, `"${singleQuotedKey[1]}":`);
      repaired = true;
    }
    const bareKey = work.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:/);
    if (bareKey && TRADING_LLM_SIGNAL_KEYS.has(bareKey[1])) {
      work = work.replace(/^([A-Za-z_][A-Za-z0-9_]*)\s*:/, `"${bareKey[1]}":`);
      repaired = true;
    }
    const valueMatch = work.match(/^"([A-Za-z_][A-Za-z0-9_]*)"\s*:\s*(.*)$/);
    if (valueMatch && TRADING_LLM_SIGNAL_KEYS.has(valueMatch[1])) {
      work = `"${valueMatch[1]}": ${coerceYamlLikeValue(valueMatch[2] ?? '')}`;
      repaired = true;
    }
    props.push(work);
  }

  if (!repaired || props.length === 0) {
    return { json: content, repaired: false };
  }

  const normalizedProps = props.map((item, index) => {
    const sanitized = item.replace(/,+\s*$/, '');
    return index < props.length - 1 ? `${sanitized},` : sanitized;
  });

  return {
    json: `{\n${normalizedProps.join('\n')}\n}`,
    repaired: true,
  };
}

function repairYamlLikeBlockWithoutBraces(content: string): { json: string; repaired: boolean } {
  const trimmed = content.trim();
  if (!trimmed || trimmed.startsWith('{') || trimmed.endsWith('}')) {
    return { json: content, repaired: false };
  }

  const lines = trimmed.split(/\r?\n/);
  const props: string[] = [];
  let repaired = false;
  let currentKey: string | null = null;
  let currentArray: string[] = [];

  const flushArray = () => {
    if (!currentKey) return;
    const items = currentArray.length > 0 ? currentArray.join(', ') : '';
    props.push(`"${currentKey}": [${items}]`);
    currentKey = null;
    currentArray = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('-')) {
      if (!currentKey) continue;
      const item = line.replace(/^-\s*/, '');
      currentArray.push(coerceYamlLikeValue(item));
      repaired = true;
      continue;
    }
    if (currentKey) {
      flushArray();
    }
    const prefixed = stripListPrefix(line);
    if (prefixed.stripped) repaired = true;
    const match = prefixed.value.match(/^['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?\s*:\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (!TRADING_LLM_SIGNAL_KEYS.has(key)) continue;
    const value = match[2] ?? '';
    if (!value.trim()) {
      currentKey = key;
      currentArray = [];
      repaired = true;
      continue;
    }
    props.push(`"${key}": ${coerceYamlLikeValue(value)}`);
    repaired = true;
  }

  if (currentKey) {
    flushArray();
  }

  if (!repaired || props.length === 0) {
    return { json: content, repaired: false };
  }

  return {
    json: `{\n${props.join(',\n')}\n}`,
    repaired: true,
  };
}

function repairYamlLikeFromRawText(content: string): { json: string; repaired: boolean } {
  const cleaned = sanitizeJsonCandidate(stripJsonCodeFence(content)).json;
  const lines = cleaned.split(/\r?\n/);
  const props: string[] = [];
  let repaired = false;
  let currentKey: string | null = null;
  let currentArray: string[] = [];

  const flushArray = () => {
    if (!currentKey) return;
    const items = currentArray.length > 0 ? currentArray.join(', ') : '';
    props.push(`"${currentKey}": [${items}]`);
    currentKey = null;
    currentArray = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line === '{' || line === '}' || line.startsWith('```')) continue;
    if (line.startsWith('-')) {
      if (!currentKey) continue;
      const item = line.replace(/^-\s*/, '');
      currentArray.push(coerceYamlLikeValue(item));
      repaired = true;
      continue;
    }
    if (currentKey) {
      flushArray();
    }
    const prefixed = stripListPrefix(line);
    if (prefixed.stripped) repaired = true;
    const match = prefixed.value.match(/^['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?\s*:\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (!TRADING_LLM_SIGNAL_KEYS.has(key)) continue;
    const value = match[2] ?? '';
    if (!value.trim()) {
      currentKey = key;
      currentArray = [];
      repaired = true;
      continue;
    }
    props.push(`"${key}": ${coerceYamlLikeValue(value)}`);
    repaired = true;
  }

  if (currentKey) {
    flushArray();
  }

  if (!repaired || props.length === 0) {
    return { json: content, repaired: false };
  }

  return {
    json: `{\n${props.join(',\n')}\n}`,
    repaired: true,
  };
}

function repairLlmJsonContent(content: string): { json: string; repaired: boolean } {
  let repaired = false;
  let inString = false;
  let escaping = false;
  let output = '';

  const peekNextNonWhitespace = (startIndex: number): string | null => {
    for (let i = startIndex; i < content.length; i += 1) {
      if (!/\s/.test(content[i])) return content[i];
    }
    return null;
  };

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    if (escaping) {
      output += char;
      escaping = false;
      continue;
    }
    if (char === '\\') {
      output += char;
      if (inString) escaping = true;
      continue;
    }
    if (char === '"') {
      if (inString) {
        const nextNonWhitespace = peekNextNonWhitespace(i + 1);
        const isTerminator = nextNonWhitespace === ',' || nextNonWhitespace === '}' || nextNonWhitespace === ']' || nextNonWhitespace === ':';
        if (!isTerminator) {
          output += '\\"';
          repaired = true;
          continue;
        }
        inString = false;
        output += char;
        continue;
      }
      inString = true;
      output += char;
      continue;
    }
    if (inString) {
      if (char === '\n' || char === '\r') {
        output += '\\n';
        repaired = true;
        continue;
      }
      if (char === '\t') {
        output += '\\t';
        repaired = true;
        continue;
      }
      const code = char.charCodeAt(0);
      if (code < 0x20) {
        output += `\\u${code.toString(16).padStart(4, '0')}`;
        repaired = true;
        continue;
      }
    }
    output += char;
  }

  if (inString) {
    output += '"';
    repaired = true;
  }

  // Reparo de leading commas em arrays: [, → [
  // Padrão comum em LLMs que geram "motivators": [, "item1", "item2"]
  const leadingCommaRegex = /\[\s*,/g;
  if (leadingCommaRegex.test(output)) {
    output = output.replace(/\[\s*,/g, '[');
    repaired = true;
  }

  const trailingCommaResult = removeTrailingCommasOutsideStrings(output);
  if (trailingCommaResult.removed) {
    repaired = true;
  }

  const commaRepair = insertMissingCommasInArrays(trailingCommaResult.json);
  if (commaRepair.inserted) {
    repaired = true;
  }

  const finalTrailingCommaResult = removeTrailingCommasOutsideStrings(commaRepair.json);
  if (finalTrailingCommaResult.removed) {
    repaired = true;
  }

  return { json: finalTrailingCommaResult.json, repaired };
}

function removeTrailingCommasOutsideStrings(content: string): { json: string; removed: boolean } {
  let inString = false;
  let escaping = false;
  let removed = false;
  let output = '';

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    if (escaping) {
      output += char;
      escaping = false;
      continue;
    }
    if (char === '\\') {
      output += char;
      if (inString) escaping = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      output += char;
      continue;
    }
    if (!inString && char === ',') {
      let j = i + 1;
      while (j < content.length && /\s/.test(content[j])) {
        j += 1;
      }
      const nextChar = content[j];
      if (nextChar === '}' || nextChar === ']') {
        removed = true;
        continue;
      }
    }
    output += char;
  }

  return { json: output, removed };
}

function insertMissingCommasInArrays(content: string): { json: string; inserted: boolean } {
  let inString = false;
  let escaping = false;
  let arrayDepth = 0;
  let inserted = false;
  let output = '';

  const peekNextNonWhitespace = (startIndex: number): string | null => {
    for (let i = startIndex; i < content.length; i += 1) {
      if (!/\s/.test(content[i])) return content[i];
    }
    return null;
  };

  const peekPrevNonWhitespace = (): string | null => {
    for (let i = output.length - 1; i >= 0; i -= 1) {
      if (!/\s/.test(output[i])) return output[i];
    }
    return null;
  };

  const shouldInsertComma = (nextChar: string | null): boolean => {
    if (!nextChar) return false;
    if (nextChar === ']' || nextChar === ',') return false;
    if (nextChar === ':') return false;
    const prevNonWs = peekPrevNonWhitespace();
    if (!prevNonWs || prevNonWs === '[' || prevNonWs === ',') return false;
    return nextChar === '"' || nextChar === '{' || nextChar === '[';
  };

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    if (escaping) {
      output += char;
      escaping = false;
      continue;
    }
    if (char === '\\') {
      output += char;
      if (inString) escaping = true;
      continue;
    }
    if (char === '"') {
      output += char;
      inString = !inString;
      if (!inString && arrayDepth > 0) {
        const nextChar = peekNextNonWhitespace(i + 1);
        if (shouldInsertComma(nextChar)) {
          output += ',';
          inserted = true;
        }
      }
      continue;
    }
    if (!inString) {
      if (char === '[') {
        arrayDepth += 1;
        output += char;
        continue;
      }
      if (char === ']') {
        arrayDepth = Math.max(0, arrayDepth - 1);
        output += char;
        if (arrayDepth > 0) {
          const nextChar = peekNextNonWhitespace(i + 1);
          if (shouldInsertComma(nextChar)) {
            output += ',';
            inserted = true;
          }
        }
        continue;
      }
      if (char === '}' && arrayDepth > 0) {
        output += char;
        const nextChar = peekNextNonWhitespace(i + 1);
        if (shouldInsertComma(nextChar)) {
          output += ',';
          inserted = true;
        }
        continue;
      }
    }
    output += char;
  }

  return { json: output, inserted };
}

/**
 * Tenta completar JSON truncado adicionando fechamentos faltantes (}, ]).
 * Útil quando o LLM gera JSON válido mas é cortado por max_tokens.
 * Retorna null se não conseguir determinar os fechamentos necessários.
 */
function tryCompleteJson(json: string): string | null {
  const trimmed = json.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;

  // Contar aberturas e fechamentos fora de strings
  let inString = false;
  let escaping = false;
  const stack: string[] = [];

  for (let i = 0; i < trimmed.length; i += 1) {
    const char = trimmed[i];
    if (escaping) {
      escaping = false;
      continue;
    }
    if (char === '\\' && inString) {
      escaping = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') stack.push('}');
    else if (char === '[') stack.push(']');
    else if (char === '}' || char === ']') {
      if (stack.length > 0 && stack[stack.length - 1] === char) {
        stack.pop();
      }
    }
  }

  // Se stack está vazio, JSON já está balanceado - não é truncamento
  if (stack.length === 0) return null;

  // Fechar string aberta se necessário
  let completed = trimmed;
  if (inString) {
    completed += '"';
  }

  // Remover trailing comma antes de fechar
  completed = completed.replace(/,\s*$/, '');

  // Adicionar fechamentos na ordem reversa
  while (stack.length > 0) {
    completed += stack.pop();
  }

  return completed;
}

function parseLlmSignalResponse(rawResponse: string): {
  data: TradingLlmSignalPartial;
  citedValuesSource: 'llm_payload' | 'regex';
  parseMethod: string;
} {
  // Log da resposta raw do LLM antes de qualquer tentativa de parse (primeiros 500 chars)
  const isDirectJson = rawResponse.trimStart().startsWith('{');
  logger.info({
    rawResponseLength: rawResponse.length,
    rawResponseSnippet: rawResponse.substring(0, 500),
    isDirectJson,
  }, 'Resposta raw do LLM recebida para parsing de sinal de trading');

  const candidate = extractJsonObjectCandidate(rawResponse);

  // FAST PATH: Se resposta começa com '{' (constrained decoding ativo),
  // tentar JSON.parse DIRETO no candidato ANTES de qualquer normalização/reparo.
  // Isso evita que normalizeLlmJsonKeys ou outros reparos corrompam JSON já válido.
  if (isDirectJson) {
    try {
      const directParsed = JSON.parse(candidate) as Record<string, unknown>;
      const { normalized: directNormPayload, citedValuesSource: directCvs } = normalizeLlmSignalPayload(directParsed);
      const directResult = TRADING_LLM_SIGNAL_PARTIAL_SCHEMA.safeParse(directNormPayload);
      if (directResult.success) {
        logger.info({ parseMethod: 'direct_json', citedValuesSource: directCvs }, 'Sinal de trading parseado via JSON.parse direto (sem normalização)');
        return { data: directResult.data, citedValuesSource: directCvs, parseMethod: 'direct_json' };
      }
      // JSON válido mas Zod rejeitou - log e cair para pipeline de reparo
      logger.warn({ zodError: directResult.error.message }, 'JSON.parse direto OK mas Zod rejeitou - tentando pipeline de reparo');
    } catch {
      // JSON.parse direto falhou - tentar completar JSON truncado antes de cair para pipeline pesado
      logger.info('JSON.parse direto falhou, tentando completar JSON truncado');
      const completed = tryCompleteJson(candidate);
      if (completed !== null) {
        try {
          const completedParsed = JSON.parse(completed) as Record<string, unknown>;
          const { normalized: completedNormPayload, citedValuesSource: completedCvs } = normalizeLlmSignalPayload(completedParsed);
          const completedResult = TRADING_LLM_SIGNAL_PARTIAL_SCHEMA.safeParse(completedNormPayload);
          if (completedResult.success) {
            logger.info({ parseMethod: 'completed_json', citedValuesSource: completedCvs }, 'Sinal de trading parseado via completamento de JSON truncado');
            return { data: completedResult.data, citedValuesSource: completedCvs, parseMethod: 'completed_json' };
          }
          logger.warn({ zodError: completedResult.error.message }, 'JSON completado válido mas Zod rejeitou');
        } catch {
          logger.info('JSON completado também falhou no parse, seguindo para pipeline de normalização');
        }
      }
    }
  }

  const sanitized = sanitizeJsonCandidate(candidate);
  if (sanitized.repaired) {
    logger.warn('Resposta LLM continha prefixos não JSON; sanitização aplicada.');
  }
  const normalized = normalizeLlmJsonKeys(sanitized.json);
  if (normalized.repaired) {
    logger.warn('Resposta LLM continha chaves sem aspas; normalização aplicada.');
  }
  try {
    const parsed = JSON.parse(normalized.json) as Record<string, unknown>;
    const { normalized: normalizedPayload, citedValuesSource } = normalizeLlmSignalPayload(parsed);
    const result = TRADING_LLM_SIGNAL_PARTIAL_SCHEMA.safeParse(normalizedPayload);
    if (!result.success) {
      throw new Error(`Resposta LLM inválida: ${result.error.message}`);
    }
    const parseMethod = sanitized.repaired || normalized.repaired ? 'sanitized' : 'normalized';
    logger.info({ parseMethod, citedValuesSource }, 'Sinal de trading parseado com sucesso');
    return { data: result.data, citedValuesSource, parseMethod };
  } catch (error) {
    const permissive = normalizeLlmJsonKeys(sanitized.json, { allowAnyKey: true });
    if (permissive.json !== normalized.json) {
      try {
        logger.warn({ error: error instanceof Error ? error.message : error }, 'Resposta LLM inválida; aplicando reparo de chaves JSON.');
        const parsed = JSON.parse(permissive.json) as Record<string, unknown>;
        const { normalized: normalizedPayload, citedValuesSource } = normalizeLlmSignalPayload(parsed);
        const result = TRADING_LLM_SIGNAL_PARTIAL_SCHEMA.safeParse(normalizedPayload);
        if (!result.success) {
          throw new Error(`Resposta LLM inválida após reparo: ${result.error.message}`);
        }
        logger.info({ parseMethod: 'permissive_keys', citedValuesSource }, 'Sinal de trading parseado com sucesso via reparo de chaves');
        return { data: result.data, citedValuesSource, parseMethod: 'permissive_keys' };
      } catch (permissiveError) {
        const message = permissiveError instanceof Error ? permissiveError.message : 'Erro desconhecido';
        logger.error({
          error: message,
          responseHash: computeSemHash(permissive.json),
          responseLength: permissive.json.length,
          candidateLength: sanitized.json.length,
        }, 'Resposta LLM inválida após reparo de chaves JSON (hash/len).');
      }
    }
    const baseJson = permissive.json !== normalized.json ? permissive.json : normalized.json;
    const blockRepair = repairYamlLikeBlockWithoutBraces(baseJson);
    if (blockRepair.repaired) {
      try {
        logger.warn({ error: error instanceof Error ? error.message : error }, 'Resposta LLM inválida; aplicando reparo YAML-like sem chaves.');
        const parsed = JSON.parse(blockRepair.json) as Record<string, unknown>;
        const { normalized: normalizedPayload, citedValuesSource } = normalizeLlmSignalPayload(parsed);
        const result = TRADING_LLM_SIGNAL_PARTIAL_SCHEMA.safeParse(normalizedPayload);
        if (!result.success) {
          throw new Error(`Resposta LLM inválida após reparo: ${result.error.message}`);
        }
        logger.info({ parseMethod: 'yaml_block_repair', citedValuesSource }, 'Sinal de trading parseado com sucesso via reparo YAML-like sem chaves');
        return { data: result.data, citedValuesSource, parseMethod: 'yaml_block_repair' };
      } catch (blockError) {
        const message = blockError instanceof Error ? blockError.message : 'Erro desconhecido';
        logger.error({
          error: message,
          responseHash: computeSemHash(blockRepair.json),
          responseLength: blockRepair.json.length,
          candidateLength: sanitized.json.length,
        }, 'Resposta LLM inválida após reparo YAML-like sem chaves (hash/len).');
      }
    }
    const yamlRepair = repairYamlLikeObject(baseJson);
    if (yamlRepair.repaired) {
      try {
        logger.warn({ error: error instanceof Error ? error.message : error }, 'Resposta LLM inválida; aplicando reparo YAML-like.');
        const parsed = JSON.parse(yamlRepair.json) as Record<string, unknown>;
        const { normalized: normalizedPayload, citedValuesSource } = normalizeLlmSignalPayload(parsed);
        const result = TRADING_LLM_SIGNAL_PARTIAL_SCHEMA.safeParse(normalizedPayload);
        if (!result.success) {
          throw new Error(`Resposta LLM inválida após reparo: ${result.error.message}`);
        }
        logger.info({ parseMethod: 'yaml_object_repair', citedValuesSource }, 'Sinal de trading parseado com sucesso via reparo YAML-like');
        return { data: result.data, citedValuesSource, parseMethod: 'yaml_object_repair' };
      } catch (yamlError) {
        const message = yamlError instanceof Error ? yamlError.message : 'Erro desconhecido';
        logger.error({
          error: message,
          responseHash: computeSemHash(yamlRepair.json),
          responseLength: yamlRepair.json.length,
          candidateLength: sanitized.json.length,
        }, 'Resposta LLM inválida após reparo YAML-like (hash/len).');
      }
    }
    const repair = repairLlmJsonContent(baseJson);
    if (repair.repaired) {
      try {
        logger.warn({ error: error instanceof Error ? error.message : error }, 'Resposta LLM inválida; aplicando reparo seguro do JSON.');
        const parsed = JSON.parse(repair.json) as Record<string, unknown>;
        const { normalized: normalizedPayload, citedValuesSource } = normalizeLlmSignalPayload(parsed);
        const result = TRADING_LLM_SIGNAL_PARTIAL_SCHEMA.safeParse(normalizedPayload);
        if (!result.success) {
          throw new Error(`Resposta LLM inválida após reparo: ${result.error.message}`);
        }
        logger.info({ parseMethod: 'json_content_repair', citedValuesSource }, 'Sinal de trading parseado com sucesso via reparo seguro de conteúdo JSON');
        return { data: result.data, citedValuesSource, parseMethod: 'json_content_repair' };
      } catch (repairError) {
        const message = repairError instanceof Error ? repairError.message : 'Erro desconhecido';
        if (message.startsWith('Resposta LLM inválida após reparo:')) {
          throw new Error(message);
        }
        logger.error({
          error: message,
          responseHash: computeSemHash(repair.json),
          responseLength: repair.json.length,
          candidateLength: candidate.length,
        }, 'Resposta LLM inválida após reparo seguro (hash/len).');
        throw new Error(`Resposta LLM inválida após reparo: ${message}`);
      }
    }
    const rawRepair = repairYamlLikeFromRawText(rawResponse);
    if (rawRepair.repaired) {
      try {
        logger.warn({ error: error instanceof Error ? error.message : error }, 'Resposta LLM inválida; aplicando extração de chaves do texto bruto.');
        const parsed = JSON.parse(rawRepair.json) as Record<string, unknown>;
        const { normalized: normalizedPayload, citedValuesSource } = normalizeLlmSignalPayload(parsed);
        const result = TRADING_LLM_SIGNAL_PARTIAL_SCHEMA.safeParse(normalizedPayload);
        if (!result.success) {
          throw new Error(`Resposta LLM inválida após reparo: ${result.error.message}`);
        }
        logger.info({ parseMethod: 'raw_text_extraction', citedValuesSource }, 'Sinal de trading parseado com sucesso via extração de chaves do texto bruto');
        return { data: result.data, citedValuesSource, parseMethod: 'raw_text_extraction' };
      }       catch (rawError) {
        const message = rawError instanceof Error ? rawError.message : 'Erro desconhecido';
        logger.error({
          error: message,
          responseHash: computeSemHash(rawRepair.json),
          responseLength: rawRepair.json.length,
          candidateLength: baseJson.length,
        }, 'Resposta LLM inválida após extração de chaves (hash/len).');
      }
    }
    // Estágio final: jsonrepair (biblioteca battle-tested, 5M+ downloads/semana)
    // Último recurso antes de desistir - tenta reparar JSON malformado automaticamente
    try {
      const repaired = jsonrepair(rawResponse);
      const parsed = JSON.parse(repaired) as Record<string, unknown>;
      const { normalized: normalizedPayload, citedValuesSource: cvSource } = normalizeLlmSignalPayload(parsed);
      const result = TRADING_LLM_SIGNAL_PARTIAL_SCHEMA.safeParse(normalizedPayload);
      if (result.success) {
        logger.warn({ parseMethod: 'jsonrepair', citedValuesSource: cvSource }, 'Resposta LLM reparada com sucesso via jsonrepair (último recurso).');
        return { data: result.data, citedValuesSource: cvSource, parseMethod: 'jsonrepair' };
      }
      logger.error({ zodError: result.error.message }, 'jsonrepair produziu JSON válido mas Zod rejeitou.');
    } catch (jsonrepairError) {
      const jrMessage = jsonrepairError instanceof Error ? jsonrepairError.message : 'Erro desconhecido';
      logger.error({ error: jrMessage }, 'jsonrepair também falhou ao reparar resposta LLM.');
    }
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    if (message.startsWith('Resposta LLM inválida:')) {
      throw new Error(message);
    }
    logger.error({
      error: message,
      responseHash: computeSemHash(sanitized.json),
      responseLength: sanitized.json.length,
      responseSnippet: buildLlmResponseSnippet(rawResponse),
    }, 'Resposta LLM inválida (hash/len).');
    throw new Error(`Resposta LLM inválida: ${message}`);
  }
}

function resolveSignalTypeFromAnalysis(analysis: technicalIndicators.TechnicalAnalysisResult): schema.TradingSignal['signalType'] {
  if (analysis.overallSignal === 'strong_buy' || analysis.overallSignal === 'buy') {
    return 'entry_long';
  }
  if (analysis.overallSignal === 'strong_sell' || analysis.overallSignal === 'sell') {
    return 'entry_short';
  }
  return 'hold';
}

function normalizeNullableNumber(value?: number | string | null): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeCitedValues(values?: Record<string, unknown>): ExtractedLLMValues | null {
  if (!values || typeof values !== 'object') return null;
  const normalized: ExtractedLLMValues = {};
  for (const [key, rawValue] of Object.entries(values)) {
    const numeric = normalizeNullableNumber(rawValue as number | string | null);
    if (numeric !== undefined) {
      (normalized as Record<string, number>)[key] = numeric;
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : null;
}

function buildLlmSignalFromPartial(params: {
  partial: TradingLlmSignalPartial;
  analysis: technicalIndicators.TechnicalAnalysisResult;
  tradePlan: ReturnType<typeof buildTradePlanFromAnalysis>;
}): TradingLlmSignal {
  const baseConfidence = typeof params.partial.confidence === 'number'
    ? params.partial.confidence
    : params.analysis.confidence;
  const confidence = Math.min(Math.max(baseConfidence, 0), 1);
  const motivators = Array.isArray(params.partial.motivators) && params.partial.motivators.length > 0
    ? params.partial.motivators
    : params.tradePlan.motivators;
  const invalidationReasons = Array.isArray(params.partial.invalidationReasons) && params.partial.invalidationReasons.length > 0
    ? params.partial.invalidationReasons
    : params.tradePlan.invalidationReasons;
  const reasoning = typeof params.partial.reasoning === 'string' && params.partial.reasoning.trim().length >= 10
    ? params.partial.reasoning
    : buildAnalysisMotivators(params.analysis).join('; ');
  let suggestedPrice = normalizeNullableNumber(params.partial.suggestedPrice) ?? params.tradePlan.entryPrice;

  // CORREÇÃO M5: Validar preço sugerido pelo LLM vs preço atual de mercado (threshold 5%)
  const currentPrice = params.analysis.currentPrice;
  if (suggestedPrice && currentPrice && currentPrice > 0) {
    const priceDeviation = Math.abs(suggestedPrice - currentPrice) / currentPrice;
    if (priceDeviation > 0.05) {
      logger.warn(
        { suggestedPrice, currentPrice, deviation: priceDeviation },
        'Preço sugerido pelo LLM desvia >5% do mercado - usando preço atual'
      );
      suggestedPrice = currentPrice;
    }
  }

  const suggestedStopLoss = normalizeNullableNumber(params.partial.suggestedStopLoss) ?? params.tradePlan.stopLoss ?? undefined;
  const suggestedTakeProfit = normalizeNullableNumber(params.partial.suggestedTakeProfit) ?? params.tradePlan.takeProfit ?? undefined;
  const riskReward = normalizeNullableNumber(params.partial.riskReward) ?? params.tradePlan.riskReward ?? undefined;
  const suggestedSize = normalizeNullableNumber(params.partial.suggestedSize);
  const riskScore = normalizeNullableNumber(params.partial.riskScore)
    ?? Math.round(confidence * 100);
  const citedValues = normalizeCitedValues(params.partial.citedValues as Record<string, unknown> | undefined);
  const resolvedCitedValues = citedValues ?? extractValuesFromLLMResponse(reasoning);
  const marketCondition = params.partial.marketCondition
    ?? (params.analysis.movingAverages?.trend ? `Tendência ${params.analysis.movingAverages.trend}` : undefined);

  const resolvedSignalType = params.partial.signalType ?? resolveSignalTypeFromAnalysis(params.analysis);
  const isNeutralOrHold = resolvedSignalType === 'neutral' || resolvedSignalType === 'hold';

  // CORREÇÃO: expectedDurationMinutes pode ser 0 para sinais neutros/hold
  // ?? não trata 0 como nullish (correto), mas precisamos garantir fallback para undefined
  const rawDuration = params.partial.expectedDurationMinutes;
  const resolvedDuration = rawDuration != null
    ? rawDuration
    : (isNeutralOrHold ? 0 : params.tradePlan.expectedDurationMinutes);

  // CORREÇÃO: tradeSummary pode ser vazio/curto para sinais neutros — gerar default descritivo
  const rawSummary = params.partial.tradeSummary;
  const resolvedSummary = (rawSummary && rawSummary.trim().length > 0)
    ? rawSummary
    : (params.tradePlan.tradeSummary || `Sinal ${resolvedSignalType} — sem operação recomendada no momento`);

  const draft: TradingLlmSignal = {
    signalType: resolvedSignalType,
    operationType: params.partial.operationType ?? params.tradePlan.operationType,
    expectedDurationMinutes: resolvedDuration,
    confidence,
    tradeSummary: resolvedSummary,
    motivators,
    invalidationReasons,
    reasoning,
    timeframeUsed: params.partial.timeframeUsed,
    citedValues: resolvedCitedValues,
    suggestedPrice,
    suggestedStopLoss,
    suggestedTakeProfit,
    suggestedSize,
    riskReward,
    marketCondition,
    riskScore,
  };

  const validated = TRADING_LLM_SIGNAL_SCHEMA.safeParse(draft);
  if (!validated.success) {
    throw new Error(`Resposta LLM inválida após normalização: ${validated.error.message}`);
  }
  return validated.data;
}

function formatDurationLabel(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return 'N/A';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  if (minutes < 10080) return `${Math.round(minutes / 1440)}d`;
  return `${Math.round(minutes / 10080)}w`;
}

function resolveMaxTokensForPrompt(params: {
  systemPrompt: string;
  analysisPrompt: string;
  requestedMaxTokens: number;
}) {
  const systemTokens = estimateTokensFromText(params.systemPrompt);
  const baseTokens = systemTokens + TRADING_LLM_MESSAGE_OVERHEAD_TOKENS;
  let analysisPrompt = params.analysisPrompt;
  let analysisTokens = estimateTokensFromText(analysisPrompt);
  let promptTokens = baseTokens + analysisTokens;
  let bufferedPromptTokens = Math.ceil(promptTokens * TRADING_LLM_PROMPT_ESTIMATE_MULTIPLIER);

  const maxPromptTokens = TRADING_LLM_MAX_CONTEXT_TOKENS
    - TRADING_LLM_PROMPT_SAFETY_TOKENS
    - TRADING_LLM_MIN_COMPLETION_TOKENS;
  const maxPromptTokensBuffered = Math.max(
    0,
    Math.floor(maxPromptTokens / TRADING_LLM_PROMPT_ESTIMATE_MULTIPLIER)
  );

  if (bufferedPromptTokens > maxPromptTokens) {
    const availableAnalysisTokens = Math.max(0, maxPromptTokensBuffered - baseTokens);
    const targetChars = Math.max(0, availableAnalysisTokens * TRADING_LLM_CHARS_PER_TOKEN);
    analysisPrompt = truncateText(analysisPrompt, targetChars);
    analysisTokens = estimateTokensFromText(analysisPrompt);
    promptTokens = baseTokens + analysisTokens;
    bufferedPromptTokens = Math.ceil(promptTokens * TRADING_LLM_PROMPT_ESTIMATE_MULTIPLIER);
  }

  const conservativePromptTokens = Math.ceil(bufferedPromptTokens * 1.1);
  const conservativeMaxCompletionTokens = Math.max(
    TRADING_LLM_MIN_COMPLETION_TOKENS,
    TRADING_LLM_MAX_CONTEXT_TOKENS
      - conservativePromptTokens
      - TRADING_LLM_PROMPT_SAFETY_TOKENS
      - TRADING_LLM_TOKEN_HEADROOM_TOKENS
  );
  const strictMaxCompletionTokens = Math.max(
    TRADING_LLM_MIN_COMPLETION_TOKENS,
    TRADING_LLM_MAX_CONTEXT_TOKENS
      - bufferedPromptTokens
      - TRADING_LLM_PROMPT_SAFETY_TOKENS
  );
  const maxCompletionTokens = Math.min(
    params.requestedMaxTokens,
    conservativeMaxCompletionTokens,
    strictMaxCompletionTokens,
    TRADING_LLM_MAX_SIGNAL_COMPLETION_TOKENS
  );

  return {
    analysisPrompt,
    promptTokens,
    maxCompletionTokens,
  };
}

function resolveOperationTypeFromInterval(params: {
  intervalMinutes: number | null;
  overallSignal: technicalIndicators.TechnicalAnalysisResult['overallSignal'];
}): TradingOperationType {
  if (params.overallSignal === 'neutral') return 'neutral';
  const minutes = params.intervalMinutes ?? 15;
  if (minutes <= 5) return 'scalping';
  if (minutes <= 30) return 'swing';
  return 'position';
}

function resolveExpectedDurationMinutes(intervalMinutes: number | null, timeframes: string[]): number {
  const baseMinutes = intervalMinutes ?? 15;
  const multiplier = Math.max(3, timeframes.length);
  return baseMinutes * multiplier;
}

function resolveStopLossTakeProfitFromAnalysis(params: {
  analysis: technicalIndicators.TechnicalAnalysisResult;
  direction: 'long' | 'short' | 'neutral';
  riskConfig: TradingRiskConfig | null;
}): { stopLoss: number | null; takeProfit: number | null } {
  if (params.direction === 'neutral') {
    return { stopLoss: null, takeProfit: null };
  }

  const entry = params.analysis.currentPrice;
  let stopLoss: number | null = null;
  let takeProfit: number | null = null;

  const levels = params.analysis.supportResistance;
  if (levels) {
    if (params.direction === 'long') {
      stopLoss = levels.support1 ?? levels.support2 ?? levels.support3 ?? null;
      takeProfit = levels.resistance1 ?? levels.resistance2 ?? levels.resistance3 ?? null;
    } else {
      stopLoss = levels.resistance1 ?? levels.resistance2 ?? levels.resistance3 ?? null;
      takeProfit = levels.support1 ?? levels.support2 ?? levels.support3 ?? null;
    }
  }

  if (params.riskConfig) {
    if (stopLoss === null && Number.isFinite(params.riskConfig.defaultStopLoss)) {
      const ratio = Number(params.riskConfig.defaultStopLoss);
      stopLoss = params.direction === 'long' ? entry * (1 - ratio) : entry * (1 + ratio);
    }
    if (takeProfit === null && Number.isFinite(params.riskConfig.defaultTakeProfit)) {
      const ratio = Number(params.riskConfig.defaultTakeProfit);
      takeProfit = params.direction === 'long' ? entry * (1 + ratio) : entry * (1 - ratio);
    }
  }

  if (Number.isFinite(stopLoss)) {
    if (params.direction === 'long' && (stopLoss as number) >= entry) stopLoss = null;
    if (params.direction === 'short' && (stopLoss as number) <= entry) stopLoss = null;
  }
  if (Number.isFinite(takeProfit)) {
    if (params.direction === 'long' && (takeProfit as number) <= entry) takeProfit = null;
    if (params.direction === 'short' && (takeProfit as number) >= entry) takeProfit = null;
  }

  return { stopLoss, takeProfit };
}

function buildAnalysisMotivators(analysis: technicalIndicators.TechnicalAnalysisResult): string[] {
  const motivators: string[] = [];
  if (analysis.rsi) {
    motivators.push(`RSI em ${analysis.rsi.value.toFixed(2)} indica ${analysis.rsi.interpretation}`);
  }
  if (analysis.macd) {
    if (analysis.macd.crossover !== 'none') {
      motivators.push(`MACD com ${analysis.macd.crossover.replace('_', ' ')} e histograma ${analysis.macd.histogram.toFixed(2)}`);
    } else {
      motivators.push(`MACD ${analysis.macd.interpretation} com histograma ${analysis.macd.histogram.toFixed(2)}`);
    }
  }
  if (analysis.movingAverages) {
    motivators.push(`Tendência ${analysis.movingAverages.trend} via médias móveis`);
  }
  if (analysis.adx) {
    motivators.push(`ADX ${analysis.adx.adx.toFixed(2)} indica força ${analysis.adx.trendStrength}`);
  }
  if (analysis.bollinger) {
    motivators.push(`Bollinger %B ${(analysis.bollinger.percentB * 100).toFixed(0)}% (${analysis.bollinger.interpretation})`);
  }
  if (analysis.volume) {
    motivators.push(`Volume ${analysis.volume.interpretation} (${analysis.volume.volumeRatio.toFixed(2)}x)`);
  }
  if (motivators.length === 0) {
    motivators.push(`Sinal ${analysis.overallSignal} com confiança ${(analysis.confidence * 100).toFixed(0)}%`);
  }
  return motivators;
}

function buildAnalysisInvalidationReasons(params: {
  analysis: technicalIndicators.TechnicalAnalysisResult;
  direction: 'long' | 'short' | 'neutral';
}): string[] {
  const reasons: string[] = [];
  const levels = params.analysis.supportResistance;
  if (levels) {
    if (params.direction === 'long' && levels.support1 !== undefined) {
      reasons.push(`Perda do suporte S1 (${levels.support1.toFixed(2)})`);
    }
    if (params.direction === 'short' && levels.resistance1 !== undefined) {
      reasons.push(`Rompimento da resistência R1 (${levels.resistance1.toFixed(2)})`);
    }
  }
  if (params.analysis.movingAverages?.trend === 'sideways') {
    reasons.push('Tendência lateral reduz vantagem direcional');
  }
  if (params.analysis.overallSignal === 'neutral') {
    reasons.push('Sinal neutro: aguardar confirmação adicional');
  }
  return reasons.length > 0 ? reasons : ['Condição de mercado sem confirmação suficiente'];
}

function buildTradePlanFromAnalysis(params: {
  analysis: technicalIndicators.TechnicalAnalysisResult;
  interval: string;
  timeframes: string[];
  marketType: TradingMarketType;
  marginMode?: TradingMarginMode;
  riskConfig: TradingRiskConfig | null;
}) {
  const intervalMinutes = parseTradingIntervalToMinutes(params.interval);
  const direction = params.analysis.overallSignal === 'sell' || params.analysis.overallSignal === 'strong_sell'
    ? 'short'
    : params.analysis.overallSignal === 'buy' || params.analysis.overallSignal === 'strong_buy'
      ? 'long'
      : 'neutral';
  const operationType = resolveOperationTypeFromInterval({
    intervalMinutes,
    overallSignal: params.analysis.overallSignal,
  });
  const expectedDurationMinutes = resolveExpectedDurationMinutes(intervalMinutes, params.timeframes);
  const expectedDurationLabel = formatDurationLabel(expectedDurationMinutes);
  const entryPrice = params.analysis.currentPrice;
  const { stopLoss, takeProfit } = resolveStopLossTakeProfitFromAnalysis({
    analysis: params.analysis,
    direction,
    riskConfig: params.riskConfig,
  });
  const riskReward = stopLoss && takeProfit
    ? Math.abs((takeProfit - entryPrice) / (entryPrice - stopLoss))
    : null;
  const motivators = buildAnalysisMotivators(params.analysis);
  const invalidationReasons = buildAnalysisInvalidationReasons({ analysis: params.analysis, direction });
  const summary = `Sinal ${params.analysis.overallSignal.toUpperCase()} com ${(params.analysis.confidence * 100).toFixed(0)}% de confiança.`
    + ` Operação ${operationType} estimada para ${expectedDurationLabel}.`;

  return {
    operationType,
    expectedDurationMinutes,
    expectedDurationLabel,
    entryPrice,
    stopLoss,
    takeProfit,
    riskReward,
    motivators,
    invalidationReasons,
    tradeSummary: summary,
    marketType: params.marketType,
    marginMode: params.marginMode ?? null,
    direction,
  };
}

async function getAgenticSettingsOrDefault(tenantId: string) {
  const db = getDatabase();
  const existing = await db.query.agenticSettings.findFirst({
    where: eq(schema.agenticSettings.tenantId, tenantId),
  });
  if (existing) return existing;

  const [created] = await db
    .insert(schema.agenticSettings)
    .values({
      tenantId,
      webEnabled: true,
      erpReadEnabled: true,
      erpWriteEnabled: true,
      tradingEnabled: true,
      paymentsEnabled: true,
      stackOpsEnabled: true,
      financialApprovalRequired: true,
    })
    .returning();

  if (!created) {
    throw new Error('Falha ao criar agentic_settings para o tenant.');
  }
  return created;
}

async function resolveTradingAgentContext(params: {
  tenantId: string;
  agentId?: string;
}) {
  const db = getDatabase();
  const agent = params.agentId
    ? await db.query.agents.findFirst({
        where: and(
          eq(schema.agents.id, params.agentId),
          eq(schema.agents.tenantId, params.tenantId),
          eq(schema.agents.status, 'active')
        ),
      })
    : null;

  let resolvedAgent = agent;
  let namespace: Awaited<ReturnType<typeof db.query.namespaces.findFirst>> | null = null;

  if (!resolvedAgent) {
    const tradingNamespace = await db.query.namespaces.findFirst({
      where: and(
        eq(schema.namespaces.tenantId, params.tenantId),
        eq(schema.namespaces.slug, 'trading'),
        eq(schema.namespaces.ativo, true)
      ),
    });
    if (!tradingNamespace) {
      throw new Error('Namespace Trading não encontrado para o tenant.');
    }
    namespace = tradingNamespace;
    resolvedAgent = await db.query.agents.findFirst({
      where: and(
        eq(schema.agents.tenantId, params.tenantId),
        eq(schema.agents.namespaceId, tradingNamespace.id),
        eq(schema.agents.status, 'active')
      ),
      orderBy: [desc(schema.agents.atualizadoEm)],
    });
  } else if (resolvedAgent.namespaceId) {
    namespace = (await db.query.namespaces.findFirst({
      where: and(
        eq(schema.namespaces.id, resolvedAgent.namespaceId),
        eq(schema.namespaces.tenantId, params.tenantId)
      ),
    })) ?? null;
  }

  if (!resolvedAgent) {
    throw new TradingConfigError('TRADING_SCOPE_REQUIRED: Agente Trading não encontrado ou inativo.');
  }

  if (!namespace || namespace.slug !== 'trading' || !namespace.ativo) {
    throw new TradingConfigError('TRADING_SCOPE_REQUIRED: Namespace Trading obrigatório e ativo para operações de Trading.');
  }

  const modelResolution = resolveAgentLlmModel(resolvedAgent.modeloBase || 'Qwen2.5-7B-Instruct-AWQ');
  if (!modelResolution.model) {
    throw new Error(`modeloBase '${resolvedAgent.modeloBase}' não suportado para LLM (Gate 2).`);
  }

  return {
    agent: resolvedAgent,
    namespace,
    llmConfig: {
      model: modelResolution.model,
      temperature: resolvedAgent.temperaturaModelo ?? undefined,
      maxTokens: resolvedAgent.maxTokens ?? undefined,
    },
  };
}

async function resolveSchedulerUserId(tenantId: string): Promise<string> {
  const db = getDatabase();
  const user = await db.query.users.findFirst({
    where: eq(schema.users.tenantId, tenantId),
    orderBy: [desc(schema.users.createdAt)],
  });
  if (!user?.id) {
    throw new Error('Nenhum usuário disponível para executar o scheduler.');
  }
  return user.id;
}

function buildTradingSignalSystemPrompt(params: {
  marketType: TradingMarketType;
  marginMode?: TradingMarginMode;
  agent: typeof schema.agents.$inferSelect;
  namespace: typeof schema.namespaces.$inferSelect | null;
  ragContext?: string;
}): string {
  const context = params.namespace?.contextoSistema?.trim();
  const instructions = params.agent.instrucoes?.trim();
  const personality = params.agent.personalidade?.trim();
  const ragContext = params.ragContext?.trim();

  // CORREÇÃO CR1 (07/02/2026): System prompt simplificado.
  // Instruções de formatação JSON REMOVIDAS - o constrained decoding (response_format)
  // garante formato JSON válido automaticamente. Prompts redundantes de formatação
  // desperdiçam tokens e podem confundir o modelo.
  return [
    'Você é o Agente Trading da Alice. Gere um sinal objetivo e auditável.',
    context ? `Contexto do namespace: ${context}` : null,
    instructions ? `Instruções do agente: ${instructions}` : null,
    personality ? `Personalidade: ${personality}` : null,
    // Contexto RAG: estratégias, learnings de post-mortems anteriores e conhecimento indexado
    ragContext ? `Conhecimento relevante do histórico de trading:\n${ragContext}` : null,
    `MarketType: ${params.marketType}`,
    params.marginMode ? `MarginMode: ${params.marginMode}` : null,
    'Use o ranking técnico determinístico e o ensemble fornecidos no prompt.',
    'Sinais DEVEM incluir preço de entrada e níveis de saída (TP/SL) quando aplicável.',
    'Para arbitragem, considere timeframes curtos e execução imediata.',
    'Preencha "citedValues" com os valores numéricos EXATOS citados na análise (use apenas números do prompt).',
    'Campos motivators e invalidationReasons DEVEM ter pelo menos 1 item cada.',
    'IMPORTANTE: O campo "confidence" DEVE ser um decimal entre 0.0 e 1.0 (ex: 0.75 para 75%). NÃO use escala 0-100 ou 0-10.',
    'O campo "riskReward" deve ser > 0 (ex: 2.5 para risco/retorno 1:2.5). Se não aplicável, omita o campo.',
    ragContext ? 'Considere os learnings e padrões do histórico acima na sua análise.' : null,
  ].filter(Boolean).join('\n');
}

// GET /api/integrations/trading/status - Status do serviço de trading
app.get('/api/integrations/trading/status', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    
    // BUG FIX 13/01/2026: Retornar isConfigured mesmo sem tenantId para mostrar status correto na UI
    // Trading pode estar configurado (secrets existem) mas usuário não tem tenant associado
    // UI precisa saber se KuCoin está configurado para mostrar mensagem correta
    const configStatus = kucoinClient.getKucoinConfigStatus();
    const circuitBreakerStatus = kucoinClient.getKucoinCircuitBreakerStatus();
    
    // Se não tem tenantId, retornar apenas status de configuração (sem dados do tenant)
    if (!authContext?.tenantId || !authContext?.userId) {
      res.json({
        success: true,
        data: {
          isConfigured: configStatus.isConfigured,
          missingKeys: configStatus.missingKeys,
          circuitBreaker: circuitBreakerStatus,
          riskConfig: null,
          activeSignals: 0,
          pendingOrders: 0,
          requiresTenant: true, // Flag para UI saber que precisa de tenant
        },
      });
      return;
    }

    const status = await kucoinService.getTradingServiceStatus({
      tenantId: authContext.tenantId,
      userId: authContext.userId,
    });

    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter status do trading');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/ws/status - Status do WebSocket KuCoin (public/private)
app.get('/api/integrations/trading/ws/status', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const configured = kucoinClient.isKucoinConfigured();
    if (!configured) {
      res.json({
        success: true,
        data: {
          configured: false,
          supportedMarkets: ['futures', 'spot', 'margin'],
          public: { state: 'disconnected' },
          private: { enabled: false, state: 'disconnected' },
          spot: { public: { state: 'disconnected' }, private: { enabled: false, state: 'disconnected' } },
        },
      });
      return;
    }

    const publicWs = getPublicWebSocketClient();
    const privateEnabled = isKucoinWebSocketConfigured();
    const privateWs = privateEnabled ? getPrivateWebSocketClient() : null;
    const spotPublicWs = getSpotPublicWebSocketClient();
    const spotPrivateEnabled = isSpotWebSocketConfigured();
    const spotPrivateWs = spotPrivateEnabled ? getSpotPrivateWebSocketClient() : null;

    const authContext = extractAuthContext(req);
    const allowedSymbols = await kucoinClient.getAllowedSymbols();
    const defaultSymbol = authContext?.tenantId && authContext?.userId
      ? await kucoinService.resolveTradingSymbol({ tenantId: authContext.tenantId, userId: authContext.userId })
      : await kucoinClient.getDefaultSymbol();

    res.json({
      success: true,
      data: {
        configured: true,
        allowedSymbols,
        defaultSymbol,
        supportedMarkets: ['futures', 'spot', 'margin'],
        public: { state: publicWs.getState() },
        private: { enabled: privateEnabled, state: privateWs?.getState() ?? 'disconnected' },
        spot: {
          public: { state: spotPublicWs.getState() },
          private: { enabled: spotPrivateEnabled, state: spotPrivateWs?.getState() ?? 'disconnected' },
        },
      },
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter status do WebSocket KuCoin');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/intervals - Intervalos suportados (REST + WS)
app.get('/api/integrations/trading/intervals', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  try {
    const intervals = resolveTradingIntervals();
    res.json({
      success: true,
      data: intervals,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao resolver intervalos de trading');
    res.status(500).json({ error: errorMessage });
  }
});

const wsSubscriptionSchema = z.object({
  channel: z.enum(['ticker', 'orderbook', 'klines', 'trades']),
  symbol: z.string().min(1).max(20),
  interval: z.string().max(10).optional(),
  depth: z.coerce.number().int().optional(),
  marketType: z.enum(['futures', 'spot', 'margin']),
  marginMode: z.enum(['cross', 'isolated']).optional(),
});

// POST /api/integrations/trading/ws/subscribe - Registrar subscription no WS KuCoin
app.post('/api/integrations/trading/ws/subscribe', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    const parsed = wsSubscriptionSchema.safeParse(req.body);
    if (!parsed.success) {
      kucoinWsSubscriptionsTotal.inc({ action: 'subscribe', channel: 'unknown', status: 'validation_error' }, 1);
      res.status(400).json({ error: 'Payload inválido', details: parsed.error.flatten() });
      return;
    }

    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }

    const { channel, symbol, interval, depth, marketType, marginMode } = parsed.data;

    if (channel === 'klines') {
      if (!interval) {
        kucoinWsSubscriptionsTotal.inc({ action: 'subscribe', channel, status: 'interval_required' }, 1);
        res.status(400).json({ error: 'Intervalo é obrigatório para klines' });
        return;
      }
      if (!isValidKucoinWsInterval(interval)) {
        kucoinWsSubscriptionsTotal.inc({ action: 'subscribe', channel, status: 'interval_invalid' }, 1);
        res.status(400).json({ error: `Intervalo WS inválido: ${interval}` });
        return;
      }
    }
    if (channel === 'orderbook' && depth !== undefined) {
      if (!KUCOIN_WS_ORDERBOOK_DEPTHS.includes(depth as (typeof KUCOIN_WS_ORDERBOOK_DEPTHS)[number])) {
        kucoinWsSubscriptionsTotal.inc({ action: 'subscribe', channel, status: 'depth_invalid' }, 1);
        res.status(400).json({ error: 'depth inválido. Valores permitidos: 5, 50.' });
        return;
      }
    }

    const tradingAuth = { tenantId: authContext.tenantId, userId: authContext.userId };
    const resolvedSymbol = await resolveTradingSymbolOrRespond(res, tradingAuth, symbol, { required: true, marketType, marginMode });
    if (!resolvedSymbol) return;

    const orderBookDepth = (depth ?? resolveKucoinWsOrderBookDepth()) as 5 | 50;

    if (marketType === 'futures') {
      const publicWs = getPublicWebSocketClient();
      if (!publicWs.isConnected()) {
        await publicWs.connect(false);
      }

      if (channel === 'ticker') {
        publicWs.subscribeTicker(resolvedSymbol);
      } else if (channel === 'orderbook') {
        publicWs.subscribeOrderBook(resolvedSymbol, orderBookDepth);
      } else if (channel === 'trades') {
        publicWs.subscribeTrades(resolvedSymbol);
      } else if (channel === 'klines' && interval) {
        publicWs.subscribeKlines(resolvedSymbol, interval);
      }

      kucoinWsSubscriptionsTotal.inc({ action: 'subscribe', channel, status: 'success' }, 1);

      res.json({
        success: true,
        data: {
          channel,
          symbol: resolvedSymbol,
          interval: channel === 'klines' ? interval : undefined,
          depth: channel === 'orderbook' ? orderBookDepth : undefined,
          marketType,
          marginMode,
          state: publicWs.getState(),
        },
      });
      return;
    }

    if (marketType === 'spot' || marketType === 'margin') {
      const publicWs = getSpotPublicWebSocketClient();
      if (!publicWs.isConnected()) {
        await publicWs.connect(false);
      }

      let topic = '';
      if (channel === 'ticker') {
        topic = publicWs.subscribeTicker(resolvedSymbol);
      } else if (channel === 'orderbook') {
        topic = publicWs.subscribeOrderBook(resolvedSymbol, orderBookDepth);
      } else if (channel === 'trades') {
        topic = publicWs.subscribeTrades(resolvedSymbol);
      } else if (channel === 'klines' && interval) {
        topic = publicWs.subscribeKlines(resolvedSymbol, interval);
      }

      if (topic) {
        registerSpotWsMarketType(topic, marketType, marginMode);
      }

      kucoinWsSubscriptionsTotal.inc({ action: 'subscribe', channel, status: 'success' }, 1);

      res.json({
        success: true,
        data: {
          channel,
          symbol: resolvedSymbol,
          interval: channel === 'klines' ? interval : undefined,
          depth: channel === 'orderbook' ? orderBookDepth : undefined,
          marketType,
          marginMode,
          state: publicWs.getState(),
          topic,
        },
      });
      return;
    }

    kucoinWsSubscriptionsTotal.inc({ action: 'subscribe', channel, status: 'unsupported_market' }, 1);
    res.json({
      success: true,
      data: {
        supported: false,
        message: 'MarketType não suportado no WebSocket.',
      },
    });
  } catch (error) {
    const failureChannel = typeof req.body?.channel === 'string' ? req.body.channel : 'unknown';
    kucoinWsSubscriptionsTotal.inc({ action: 'subscribe', channel: failureChannel, status: 'error' }, 1);
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao registrar subscription WS KuCoin');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/ws/unsubscribe - Cancelar subscription no WS KuCoin
app.post('/api/integrations/trading/ws/unsubscribe', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    const parsed = wsSubscriptionSchema.safeParse(req.body);
    if (!parsed.success) {
      kucoinWsSubscriptionsTotal.inc({ action: 'unsubscribe', channel: 'unknown', status: 'validation_error' }, 1);
      res.status(400).json({ error: 'Payload inválido', details: parsed.error.flatten() });
      return;
    }

    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }

    const { channel, symbol, interval, depth, marketType, marginMode } = parsed.data;

    if (channel === 'klines') {
      if (!interval) {
        kucoinWsSubscriptionsTotal.inc({ action: 'unsubscribe', channel, status: 'interval_required' }, 1);
        res.status(400).json({ error: 'Intervalo é obrigatório para klines' });
        return;
      }
      if (!isValidKucoinWsInterval(interval)) {
        kucoinWsSubscriptionsTotal.inc({ action: 'unsubscribe', channel, status: 'interval_invalid' }, 1);
        res.status(400).json({ error: `Intervalo WS inválido: ${interval}` });
        return;
      }
    }
    if (channel === 'orderbook' && depth !== undefined) {
      if (!KUCOIN_WS_ORDERBOOK_DEPTHS.includes(depth as (typeof KUCOIN_WS_ORDERBOOK_DEPTHS)[number])) {
        kucoinWsSubscriptionsTotal.inc({ action: 'unsubscribe', channel, status: 'depth_invalid' }, 1);
        res.status(400).json({ error: 'depth inválido. Valores permitidos: 5, 50.' });
        return;
      }
    }

    const tradingAuth = { tenantId: authContext.tenantId, userId: authContext.userId };
    const resolvedSymbol = await resolveTradingSymbolOrRespond(res, tradingAuth, symbol, { required: true, marketType, marginMode });
    if (!resolvedSymbol) return;

    const orderBookDepth = (depth ?? resolveKucoinWsOrderBookDepth()) as 5 | 50;

    if (marketType === 'futures') {
      const publicWs = getPublicWebSocketClient();
      if (!publicWs.isConnected()) {
        kucoinWsSubscriptionsTotal.inc({ action: 'unsubscribe', channel, status: 'ws_disconnected' }, 1);
        res.status(409).json({ error: 'WebSocket KuCoin não está conectado' });
        return;
      }

      if (channel === 'ticker') {
        publicWs.unsubscribeTicker(resolvedSymbol);
      } else if (channel === 'orderbook') {
        publicWs.unsubscribeOrderBook(resolvedSymbol, orderBookDepth);
      } else if (channel === 'trades') {
        publicWs.unsubscribeTrades(resolvedSymbol);
      } else if (channel === 'klines' && interval) {
        publicWs.unsubscribeKlines(resolvedSymbol, interval);
      }

      kucoinWsSubscriptionsTotal.inc({ action: 'unsubscribe', channel, status: 'success' }, 1);

      res.json({
        success: true,
        data: {
          channel,
          symbol: resolvedSymbol,
          interval: channel === 'klines' ? interval : undefined,
          depth: channel === 'orderbook' ? orderBookDepth : undefined,
          marketType,
          marginMode,
          state: publicWs.getState(),
        },
      });
      return;
    }

    if (marketType === 'spot' || marketType === 'margin') {
      const publicWs = getSpotPublicWebSocketClient();
      if (!publicWs.isConnected()) {
        kucoinWsSubscriptionsTotal.inc({ action: 'unsubscribe', channel, status: 'ws_disconnected' }, 1);
        res.status(409).json({ error: 'WebSocket KuCoin Spot/Margin não está conectado' });
        return;
      }

      let topic = '';
      if (channel === 'ticker') {
        topic = buildSpotMarketTopic({ channel, symbol: resolvedSymbol });
      } else if (channel === 'orderbook') {
        topic = buildSpotMarketTopic({ channel, symbol: resolvedSymbol, depth: orderBookDepth });
      } else if (channel === 'trades') {
        topic = buildSpotMarketTopic({ channel, symbol: resolvedSymbol });
      } else if (channel === 'klines' && interval) {
        topic = buildSpotMarketTopic({ channel, symbol: resolvedSymbol, interval });
      }

      if (topic) {
        const shouldUnsubscribe = unregisterSpotWsMarketType(topic, marketType, marginMode);
        if (shouldUnsubscribe) {
          publicWs.unsubscribe(topic);
        }
      }

      kucoinWsSubscriptionsTotal.inc({ action: 'unsubscribe', channel, status: 'success' }, 1);

      res.json({
        success: true,
        data: {
          channel,
          symbol: resolvedSymbol,
          interval: channel === 'klines' ? interval : undefined,
          depth: channel === 'orderbook' ? orderBookDepth : undefined,
          marketType,
          marginMode,
          state: publicWs.getState(),
          topic,
        },
      });
      return;
    }

    kucoinWsSubscriptionsTotal.inc({ action: 'unsubscribe', channel, status: 'unsupported_market' }, 1);
    res.json({
      success: true,
      data: {
        supported: false,
        message: 'MarketType não suportado no WebSocket.',
      },
    });
  } catch (error) {
    const failureChannel = typeof req.body?.channel === 'string' ? req.body.channel : 'unknown';
    kucoinWsSubscriptionsTotal.inc({ action: 'unsubscribe', channel: failureChannel, status: 'error' }, 1);
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar subscription WS KuCoin');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/symbols - Lista símbolos disponíveis na KuCoin
app.get('/api/integrations/trading/symbols', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }
    const tradingAuth = { tenantId: authContext.tenantId, userId: authContext.userId };
    const querySchema = z.object({
      marketType: z.enum(['futures', 'spot', 'margin']).optional(),
      marginMode: z.enum(['cross', 'isolated']).optional(),
    });
    const queryResult = querySchema.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
      return;
    }

    const { marketType, marginMode } = queryResult.data;
    if (marketType === 'spot' && !kucoinSpotClient.isSpotConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    if (marketType === 'margin' && !kucoinMarginClient.isMarginConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    if (!marketType || marketType === 'futures') {
      if (!kucoinClient.isKucoinConfigured()) {
        respondKucoinNotConfigured(res);
        return;
      }
    }
    const { symbols } = await kucoinService.getTradingSymbols(tradingAuth, marketType, marginMode);
    const sortedSymbols = [...symbols].sort((a, b) => a.localeCompare(b));
    const defaultSymbol = await kucoinService.resolveTradingSymbol(
      tradingAuth,
      undefined,
      marketType,
      marginMode
    );
    const topSymbols = await kucoinService.getTopSymbolsByMarket(tradingAuth, marketType, marginMode, 12);
    const preferences = await fetchTradingSymbolPreferences(
      authContext.tenantId,
      authContext.userId,
      marketType ?? 'futures',
      marketType === 'margin' ? marginMode ?? 'cross' : 'cross'
    );
    const favorites = normalizeSymbolList(preferences?.favorites ?? [], symbols);
    const featured = normalizeSymbolList(preferences?.featured ?? [], symbols);

    res.json({
      success: true,
      data: {
        symbols: sortedSymbols,
        defaultSymbol,
        favorites,
        featured,
        topSymbols,
      },
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao listar símbolos de trading');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/symbol-preferences - Favoritos/destaques por usuário
app.get('/api/integrations/trading/symbol-preferences', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    const querySchema = z.object({
      marketType: z.enum(['futures', 'spot', 'margin']).optional().default('futures'),
      marginMode: z.enum(['cross', 'isolated']).optional().default('cross'),
    });
    const parsedQuery = querySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      res.status(400).json({ error: 'Query inválida', details: parsedQuery.error.flatten() });
      return;
    }

    const { marketType, marginMode } = parsedQuery.data;
    const tradingAuth = { tenantId: authContext.tenantId, userId: authContext.userId };
    const { symbols } = await kucoinService.getTradingSymbols(tradingAuth, marketType, marginMode);
    const topSymbols = await kucoinService.getTopSymbolsByMarket(tradingAuth, marketType, marginMode, 12);
    const preferences = await fetchTradingSymbolPreferences(authContext.tenantId, authContext.userId, marketType, marginMode);
    const favorites = normalizeSymbolList(preferences?.favorites ?? [], symbols);
    const featured = normalizeSymbolList(preferences?.featured ?? [], symbols);

    res.json({
      success: true,
      data: {
        marketType,
        marginMode,
        favorites,
        featured,
        topSymbols,
      },
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao carregar preferências de símbolos');
    res.status(500).json({ error: errorMessage });
  }
});

// PUT /api/integrations/trading/symbol-preferences - Atualizar favoritos/destaques
app.put('/api/integrations/trading/symbol-preferences', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    const bodySchema = z.object({
      marketType: z.enum(['futures', 'spot', 'margin']).optional().default('futures'),
      marginMode: z.enum(['cross', 'isolated']).optional().default('cross'),
      favorites: z.array(z.string().min(1).max(20)).optional(),
      featured: z.array(z.string().min(1).max(20)).optional(),
    });
    const parsedBody = bodySchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({ error: 'Dados inválidos', details: parsedBody.error.flatten() });
      return;
    }

    const { marketType, marginMode, favorites: favoritesRaw, featured: featuredRaw } = parsedBody.data;
    const tradingAuth = { tenantId: authContext.tenantId, userId: authContext.userId };
    const { symbols } = await kucoinService.getTradingSymbols(tradingAuth, marketType, marginMode);
    const favorites = favoritesRaw ? normalizeSymbolList(favoritesRaw, symbols) : undefined;
    const featured = featuredRaw ? normalizeSymbolList(featuredRaw, symbols) : undefined;

    const db = getDatabase();
    const [existing] = await db
      .select()
      .from(schema.tradingSymbolPreferences)
      .where(and(
        eq(schema.tradingSymbolPreferences.tenantId, authContext.tenantId),
        eq(schema.tradingSymbolPreferences.userId, authContext.userId),
        eq(schema.tradingSymbolPreferences.marketType, marketType),
        eq(schema.tradingSymbolPreferences.marginMode, marginMode)
      ))
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(schema.tradingSymbolPreferences)
        .set({
          favorites: favorites ?? existing.favorites,
          featured: featured ?? existing.featured,
          atualizadoEm: new Date(),
        })
        .where(eq(schema.tradingSymbolPreferences.id, existing.id))
        .returning();
      res.json({ success: true, data: updated });
      return;
    }

    const [created] = await db
      .insert(schema.tradingSymbolPreferences)
      .values({
        tenantId: authContext.tenantId,
        userId: authContext.userId,
        marketType,
        marginMode,
        favorites: favorites ?? [],
        featured: featured ?? [],
      })
      .returning();

    res.json({ success: true, data: created });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao atualizar preferências de símbolos');
    res.status(500).json({ error: errorMessage });
  }
});

async function handleTradingMarketRequest(
  req: Request,
  res: Response,
  symbol: string | undefined,
  required = true
): Promise<void> {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }
    const tradingAuth = { tenantId: authContext.tenantId, userId: authContext.userId };
    
    const querySchema = z.object({
      marketType: z.enum(['futures', 'spot', 'margin']).optional(),
      type: z.enum(['futures', 'spot', 'margin']).optional(),
      marginMode: z.enum(['cross', 'isolated']).optional(),
    });
    const queryResult = querySchema.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
      return;
    }
    const marketType = resolveMarketTypeParam(queryResult.data);
    const marginMode = queryResult.data.marginMode;

    if (marketType === 'spot' && !kucoinSpotClient.isSpotConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    if (marketType === 'margin' && !kucoinMarginClient.isMarginConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    if (!marketType || marketType === 'futures') {
      if (!kucoinClient.isKucoinConfigured()) {
        respondKucoinNotConfigured(res);
        return;
      }
    }

    const resolvedSymbol = await resolveTradingSymbolOrRespond(
      res,
      tradingAuth,
      symbol,
      { required, marketType, marginMode }
    );
    if (!resolvedSymbol) return;

    const marketData = await kucoinService.getMarketData(tradingAuth, resolvedSymbol, marketType, marginMode);
    
    res.json({
      success: true,
      data: marketData,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter dados de mercado');
    res.status(500).json({ error: errorMessage });
  }
}

// GET /api/integrations/trading/market/:symbol - Dados de mercado
app.get('/api/integrations/trading/market/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  await handleTradingMarketRequest(req, res, req.params.symbol, true);
});

// GET /api/integrations/trading/market?symbol= - Compatibilidade com frontend legado
app.get('/api/integrations/trading/market', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  const symbol = resolveSymbolFromQuery(req);
  await handleTradingMarketRequest(req, res, symbol, false);
});

// GET /api/integrations/trading/account - Visão geral da conta KuCoin
app.get('/api/integrations/trading/account', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const querySchema = z.object({
      marketType: z.enum(['futures', 'spot', 'margin']).optional(),
      marginMode: z.enum(['cross', 'isolated']).optional(),
    });
    const queryResult = querySchema.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
      return;
    }
    const { marketType, marginMode } = queryResult.data;

    if (marketType === 'spot' && !kucoinSpotClient.isSpotConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    if (marketType === 'margin' && !kucoinMarginClient.isMarginConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    if (!marketType || marketType === 'futures') {
      if (!kucoinClient.isKucoinConfigured()) {
        respondKucoinNotConfigured(res);
        return;
      }
    }

    const account = await kucoinService.getAccountOverview(marketType, marginMode);
    
    res.json({
      success: true,
      data: account,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter dados da conta');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/positions - Posições abertas na KuCoin
app.get('/api/integrations/trading/positions', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const querySchema = z.object({
      marketType: z.enum(['futures', 'spot', 'margin']).optional(),
      marginMode: z.enum(['cross', 'isolated']).optional(),
    });
    const queryResult = querySchema.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
      return;
    }
    const { marketType, marginMode } = queryResult.data;

    if (marketType === 'spot' && !kucoinSpotClient.isSpotConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    if (marketType === 'margin' && !kucoinMarginClient.isMarginConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    if (!marketType || marketType === 'futures') {
      if (!kucoinClient.isKucoinConfigured()) {
        respondKucoinNotConfigured(res);
        return;
      }
    }

    if (marketType === 'spot' || marketType === 'margin') {
      res.json({
        success: true,
        data: [],
        marketType,
        marginMode,
        message: 'Posições são suportadas apenas para Futures. Use /account para saldos.',
      });
      return;
    }

    const positions = await kucoinService.getKucoinPositions(marketType, marginMode);
    
    res.json({
      success: true,
      data: positions,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter posições');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/positions/:symbol/close - Fechar posição (Futures)
app.post('/api/integrations/trading/positions/:symbol/close', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }
    const paramSchema = z.object({
      symbol: z.string().min(1),
    });
    const paramResult = paramSchema.safeParse(req.params);
    if (!paramResult.success) {
      res.status(400).json({ error: 'Símbolo inválido', details: paramResult.error.flatten() });
      return;
    }
    const querySchema = z.object({
      marketType: z.enum(['futures', 'spot', 'margin']).optional(),
    });
    const queryResult = querySchema.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
      return;
    }
    if (queryResult.data.marketType && queryResult.data.marketType !== 'futures') {
      res.status(400).json({ error: 'Fechamento de posição via API disponível apenas para Futures.' });
      return;
    }
    const result = await kucoinService.closePositions(
      { tenantId: authContext.tenantId, userId: authContext.userId },
      paramResult.data.symbol
    );
    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao fechar posição');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/positions/:symbol/stop - Ajustar SL/TP
app.post('/api/integrations/trading/positions/:symbol/stop', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }
    const paramSchema = z.object({
      symbol: z.string().min(1),
    });
    const paramResult = paramSchema.safeParse(req.params);
    if (!paramResult.success) {
      res.status(400).json({ error: 'Símbolo inválido', details: paramResult.error.flatten() });
      return;
    }
    const bodySchema = z.object({
      side: z.enum(['buy', 'sell']),
      size: z.number().positive(),
      stopLoss: z.number().positive().optional(),
      takeProfit: z.number().positive().optional(),
      orderType: z.enum(['limit', 'market']).optional(),
      price: z.number().positive().optional(),
      stopPriceType: z.enum(['TP', 'MP']).optional(),
      marketType: z.enum(['futures', 'spot', 'margin']).optional(),
      marginMode: z.enum(['cross', 'isolated']).optional(),
    });
    const bodyResult = bodySchema.safeParse(req.body ?? {});
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Dados inválidos', details: bodyResult.error.flatten() });
      return;
    }
    const result = await kucoinService.createStopOrder(
      { tenantId: authContext.tenantId, userId: authContext.userId },
      {
        symbol: paramResult.data.symbol,
        side: bodyResult.data.side,
        size: bodyResult.data.size,
        stopLoss: bodyResult.data.stopLoss,
        takeProfit: bodyResult.data.takeProfit,
        orderType: bodyResult.data.orderType,
        price: bodyResult.data.price,
        stopPriceType: bodyResult.data.stopPriceType,
        marketType: bodyResult.data.marketType,
        marginMode: bodyResult.data.marginMode,
      }
    );
    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao criar ordem stop');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/positions - Fechar posição (por símbolo ou todas)
app.delete('/api/integrations/trading/positions', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    const closeSchema = z.object({
      symbol: z.string().optional(),
      marketType: z.enum(['futures', 'spot', 'margin']).optional(),
      marginMode: z.enum(['cross', 'isolated']).optional(),
    }).strict();

    const parsed = closeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
      return;
    }

    const marketType = parsed.data.marketType ?? 'futures';
    if (marketType !== 'futures') {
      res.status(400).json({ error: 'Fechamento de posições é suportado apenas em Futures.' });
      return;
    }
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }

    const result = await kucoinService.closePositions(
      { tenantId: authContext.tenantId, userId: authContext.userId },
      parsed.data.symbol
    );

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao fechar posições');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/risk-config - Configuração de risco do tenant
app.get('/api/integrations/trading/risk-config', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    const config = await kucoinService.getRiskConfig({
      tenantId: authContext.tenantId,
      userId: authContext.userId,
    });

    res.json({
      success: true,
      data: config,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter configuração de risco');
    res.status(500).json({ error: errorMessage });
  }
});

// PUT /api/integrations/trading/risk-config - Atualizar configuração de risco
app.put('/api/integrations/trading/risk-config', requirePermission('integrations:trading:manage'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }
    const tradingAuth = { tenantId: authContext.tenantId, userId: authContext.userId };

    // CORREÇÃO 17/12/2025: Schema Zod alinhado com colunas reais do banco
    // Bug: maxDailyOrders e allowedSymbols não existiam no tradingRiskConfig
    // Removidos campos inexistentes que causariam erro no Drizzle ORM
    const configSchema = z.object({
      // Limites de risco (valores numéricos como string para precisão decimal)
      maxPositionSize: z.string().optional(),  // % do capital por posição
      maxDailyLoss: z.string().optional(),     // % perda diária máxima
      maxOrderValue: z.string().optional(),    // Valor máximo por ordem em USD
      maxLeverage: z.number().optional(),      // Alavancagem máxima
      maxOpenPositions: z.number().optional(), // Máximo de posições abertas
      // Configurações de execução
      defaultLeverage: z.number().optional(),
      defaultStopLoss: z.string().optional(),
      defaultTakeProfit: z.string().optional(),
      defaultSymbol: z.string().optional(),
      defaultMarketType: z.enum(['futures', 'spot', 'margin']).optional(),
      marginMode: z.enum(['cross', 'isolated']).optional(),
      // Controles
      tradingEnabled: z.boolean().optional(),
    });

    const validatedResult = configSchema.safeParse(req.body);
    if (!validatedResult.success) {
      res.status(400).json({ error: 'Dados inválidos', details: validatedResult.error.flatten() });
      return;
    }
    const validated = validatedResult.data;

    const defaultSymbolParam = validated.defaultSymbol;
    const resolvedDefaultSymbol = defaultSymbolParam
      ? await resolveTradingSymbolOrRespond(res, tradingAuth, defaultSymbolParam, {
          required: true,
          marketType: validated.defaultMarketType,
          marginMode: validated.marginMode,
        })
      : undefined;
    if (defaultSymbolParam && !resolvedDefaultSymbol) return;

    // CORREÇÃO 18/12/2025: Converter strings para numbers onde necessário
    // Schema Zod usa string para precisão decimal, mas DB usa number
    const configForDb = {
      maxPositionSize: validated.maxPositionSize ? Number(validated.maxPositionSize) : undefined,
      maxDailyLoss: validated.maxDailyLoss ? Number(validated.maxDailyLoss) : undefined,
      maxOrderValue: validated.maxOrderValue ? Number(validated.maxOrderValue) : undefined,
      maxLeverage: validated.maxLeverage,
      maxOpenPositions: validated.maxOpenPositions,
      defaultLeverage: validated.defaultLeverage,
      defaultSymbol: resolvedDefaultSymbol,
      defaultStopLoss: validated.defaultStopLoss ? Number(validated.defaultStopLoss) : undefined,
      defaultTakeProfit: validated.defaultTakeProfit ? Number(validated.defaultTakeProfit) : undefined,
      defaultMarketType: validated.defaultMarketType,
      marginMode: validated.marginMode,
      tradingEnabled: validated.tradingEnabled,
      autoExecuteSignals: false,
      minConfidenceToExecute: undefined,
    };

    const result = await kucoinService.upsertRiskConfig(tradingAuth, configForDb);

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao atualizar configuração de risco');
    res.status(500).json({ error: errorMessage });
  }
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
}): Promise<{
  signal: schema.TradingSignal;
  validationId: string;
  validationStatus: 'pending' | 'validated' | 'failed';
}> {
  const agenticSettings = await getAgenticSettingsOrDefault(params.tenantId);
  if (!agenticSettings.tradingEnabled) {
    logger.warn({ tenantId: params.tenantId }, 'Agentic Trading desabilitado - gerando sinal sem execução automática');
  }

  if (TRADING_MODE !== 'lab') {
    const db = getDatabase();
    const marketType = params.marketType ?? 'futures';
    const recentCandidates = await db.query.tradingUniverseCandidates.findMany({
      where: and(
        eq(schema.tradingUniverseCandidates.tenantId, params.tenantId),
        eq(schema.tradingUniverseCandidates.marketType, marketType),
      ),
      orderBy: [desc(schema.tradingUniverseCandidates.createdAt)],
      limit: 50,
    });
    const instrumentIds = Array.from(new Set(recentCandidates.map((candidate) => candidate.instrumentId)));
    const instruments = instrumentIds.length > 0
      ? await db.query.tradingInstruments.findMany({
        where: inArray(schema.tradingInstruments.id, instrumentIds),
      })
      : [];
    const instrumentById = new Map(instruments.map((instrument) => [instrument.id, instrument]));

    if (TRADING_MODE === 'portfolio_auto') {
      const portfolios = await listTenantPortfolios(params.tenantId);
      const selectedPortfolio = portfolios[0];
      const returnsByInstrument: Record<string, number[]> = {};
      const snapshotRows = instrumentIds.length > 0
        ? await db.query.tradingFactorSnapshotsV2.findMany({
          where: and(
            eq(schema.tradingFactorSnapshotsV2.tenantId, params.tenantId),
            inArray(schema.tradingFactorSnapshotsV2.instrumentId, instrumentIds),
          ),
          orderBy: [desc(schema.tradingFactorSnapshotsV2.candleTimestamp)],
          limit: 500,
        })
        : [];
      const snapshotsByInstrument = new Map<string, number[]>();
      for (const row of snapshotRows) {
        const current = snapshotsByInstrument.get(row.instrumentId) ?? [];
        if (current.length < 50) {
          current.push(Number(row.expectedReturn ?? 0));
          snapshotsByInstrument.set(row.instrumentId, current);
        }
      }
      const costsByInstrument = Object.fromEntries(
        recentCandidates.map((candidate) => [
          candidate.instrumentId,
          estimateCosts({
            feeBps: Number(process.env.TRADING_COST_BASELINE_FEE_BPS ?? 8),
            slippageBps: Number(process.env.TRADING_COST_BASELINE_SLIPPAGE_BPS ?? 12),
            spreadBps: Number(process.env.TRADING_COST_BASELINE_SPREAD_BPS ?? 5),
          }),
        ]),
      );
      recentCandidates.forEach((candidate) => {
        const edge = Number(candidate.expectedEdge ?? 0);
        returnsByInstrument[candidate.instrumentId] = snapshotsByInstrument.get(candidate.instrumentId)
          ?? RETURNS_FALLBACK_FACTORS.map((factor) => edge * factor);
      });
      const candidateInputs = recentCandidates
        .map((candidate) => {
          const instrument = instrumentById.get(candidate.instrumentId);
          if (!instrument) return null;
          return {
            instrumentId: candidate.instrumentId,
            symbol: instrument.symbol,
            marketType: candidate.marketType,
            side: candidate.side as 'long' | 'short' | 'neutral',
            expectedEdge: Number(candidate.expectedEdge ?? 0),
            confidenceRaw: Number(candidate.confidenceRaw ?? 0),
            confidenceCalibrated: candidate.confidenceCalibrated === null ? null : Number(candidate.confidenceCalibrated ?? 0),
            dsrScore: candidate.dsrScore === null ? null : Number(candidate.dsrScore ?? 0),
            pboScore: candidate.pboScore === null ? null : Number(candidate.pboScore ?? 1),
            riskFlags: Array.isArray(candidate.riskFlags) ? candidate.riskFlags.map(String) : [],
            timeframe: candidate.timeframe,
          };
        })
        .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);
      const correlations = buildCorrelationMatrix(returnsByInstrument);
      const decisions = buildAllocations({
        mode: 'signal_weighted',
        portfolioId: selectedPortfolio?.id ?? 'default',
        maxGrossExposure: Number(selectedPortfolio?.maxGrossExposure ?? 0.8),
        maxNetExposure: Number(selectedPortfolio?.maxNetExposure ?? 0.5),
        maxDrawdownLimit: Number(selectedPortfolio?.maxDrawdownLimit ?? 0.2),
        currentDrawdown: 0,
        candidates: candidateInputs,
        costs: costsByInstrument,
        volByInstrument: Object.fromEntries(recentCandidates.map((candidate) => [candidate.instrumentId, 0.02])),
        liquidityScoreByInstrument: Object.fromEntries(recentCandidates.map((candidate) => [candidate.instrumentId, 0.7])),
        constraints: {},
      });
      const executionPlan = buildExecutionPlan(decisions, Object.fromEntries(recentCandidates.map((candidate) => [candidate.instrumentId, 0.7])));
      const packet = buildDecisionPacket({
        portfolioId: selectedPortfolio?.id,
        decisions,
        costs: costsByInstrument,
        evidence: { correlations, candidates: recentCandidates.length, executionPlan },
      });
      await saveDecisionSnapshot(params.tenantId, packet as unknown as Record<string, unknown>);
      if (selectedPortfolio) {
        await db.insert(schema.tradingPortfolioRebalances).values({
          tenantId: params.tenantId,
          portfolioId: selectedPortfolio.id,
          asofTimestamp: new Date(),
          inputs: { candidates: recentCandidates.length, correlations },
          decisions: { decisions, executionPlan },
          status: 'succeeded',
        });
      }
      const promptData = buildCompactPrompt(packet);
      tradingPromptTokensEstimate.labels(TRADING_LLM_PROMPT_MODE).set(promptData.estimatedTokens);
      const guardrails = enforceLlmGuardrails({ estimatedTokens: promptData.estimatedTokens, promptMode: TRADING_LLM_PROMPT_MODE });
      logger.info({
        tradingMode: TRADING_MODE,
        promptMode: TRADING_LLM_PROMPT_MODE,
        promptChars: promptData.chars,
        estimatedTokens: promptData.estimatedTokens,
        guardrails,
        universeScanCount: recentCandidates.length,
      }, 'Pacote institucional de portfólio gerado');
      const firstDecision = decisions[0];
      const signalType: 'entry_long' | 'entry_short' | 'hold' = firstDecision?.side === 'buy' ? 'entry_long' : firstDecision?.side === 'sell' ? 'entry_short' : 'hold';
      const createResult = await kucoinService.createSignal(
        { tenantId: params.tenantId, userId: params.userId },
        {
          signalType,
          symbol: firstDecision?.symbol ?? params.symbol,
          marketType,
          marginMode: params.marginMode,
          confidence: 0.5,
          reasoning: firstDecision ? `Decision packet institucional (${decisions.length} decisões)` : 'No-trade: sem edge líquido após custos',
          metadata: {
            generationSource: params.source,
            decisionPacket: packet,
            noTrade: !firstDecision,
          },
        },
      );
      if (!createResult.success || !createResult.data) {
        throw new Error(createResult.error || 'Falha ao persistir sinal institucional de portfólio');
      }
      return { signal: createResult.data, validationId: crypto.randomUUID(), validationStatus: 'pending' };
    }

    const selected = recentCandidates.find((candidate) => (instrumentById.get(candidate.instrumentId)?.symbol ?? '') === params.symbol) ?? recentCandidates[0];
      const selectedInstrument = selected ? instrumentById.get(selected.instrumentId) : null;
      const selectedSymbol = selectedInstrument?.symbol ?? params.symbol;
      const selectedBySymbol = recentCandidates.find((candidate) => (instrumentById.get(candidate.instrumentId)?.symbol ?? '') === params.symbol) ?? selected;
    if (selectedBySymbol) {
      const edge = Number(selectedBySymbol.expectedEdge ?? 0);
      const cost = estimateCosts({
        feeBps: Number(process.env.TRADING_COST_BASELINE_FEE_BPS ?? 8),
        slippageBps: Number(process.env.TRADING_COST_BASELINE_SLIPPAGE_BPS ?? 12),
        spreadBps: Number(process.env.TRADING_COST_BASELINE_SPREAD_BPS ?? 5),
      });
      const net = edge - (cost.totalBps / 10_000);
      const approved = net > 0 && Number(selectedBySymbol.dsrScore ?? 0) >= 0 && Number(selectedBySymbol.pboScore ?? 1) <= 0.7;
      const signalType: 'entry_long' | 'entry_short' | 'hold' = approved
        ? (selectedBySymbol.side === 'short' ? 'entry_short' : selectedBySymbol.side === 'long' ? 'entry_long' : 'hold')
        : 'hold';
      const createResult = await kucoinService.createSignal(
        { tenantId: params.tenantId, userId: params.userId },
        {
          signalType,
          symbol: selectedSymbol,
          marketType: selectedBySymbol.marketType,
          marginMode: selectedBySymbol.marginMode ?? undefined,
          confidence: Number(selectedBySymbol.confidenceCalibrated ?? selectedBySymbol.confidenceRaw ?? 0),
          reasoning: approved ? 'Candidate aprovado por guardrails institucionais' : 'No-trade: guardrails de edge/custos/DSR/PBO',
          metadata: {
            generationSource: params.source,
            candidateId: selectedBySymbol.id,
            expectedEdgeNet: net,
            dsrScore: selectedBySymbol.dsrScore,
            pboScore: selectedBySymbol.pboScore,
          },
        },
      );
      if (!createResult.success || !createResult.data) {
        throw new Error(createResult.error || 'Falha ao persistir sinal institucional');
      }
      return { signal: createResult.data, validationId: crypto.randomUUID(), validationStatus: 'pending' };
    }
  }

  const agentContext = await resolveTradingAgentContext({
    tenantId: params.tenantId,
    agentId: params.agentId,
  });

  const profileRow = await getOrCreateTradingProfile(params.tenantId, 'signal');
  const profile = normalizeTradingProfile(profileRow);
  const timeframes = params.timeframes?.length ? params.timeframes : profile.timeframes;
  const indicators = params.indicators?.length ? params.indicators : profile.indicators;
  const dataSources = params.dataSources ?? profile.dataSources;
  const effectiveDataSources: TradingProfileDataSources = {
    ...dataSources,
    trainingData: true,
  };
  const consensusConfig = params.consensus ?? profile.consensus;
  const techniques = params.techniques?.length ? params.techniques : profile.techniques;
  const ensembleConfig = params.ensembleConfig ?? profile.ensembleConfig;
  const arbitrageConfig = params.arbitrageConfig ?? profile.arbitrageConfig;

  assertArbitrageConfigForTechniques({
    techniques,
    arbitrageConfig,
    timeframes,
    context: 'geração de sinais IA',
  });
  if (techniques.includes('arbitrage_triangular') && (params.marketType ?? 'futures') === 'futures') {
    throw new TradingConfigError('Arbitragem triangular não é suportada em mercado futures.');
  }

  const analysisMatrix = await Promise.all(
    timeframes.map(async (frame) => {
      const result = await calculateAndPersistTechnicalAnalysis({
        tenantId: params.tenantId,
        userId: params.userId,
        symbol: params.symbol,
        interval: frame,
        marketType: params.marketType,
        marginMode: params.marginMode,
        enabledIndicators: indicators,
        techniques,
        ensembleConfig,
      });
      return {
        interval: frame,
        analysis: result.analysis,
        indicatorId: result.indicatorId,
        resolvedSymbol: result.resolvedSymbol,
      };
    })
  );

  const consensus = buildMajorityConsensus(analysisMatrix, consensusConfig);
  const primaryAnalysis = analysisMatrix[0];
  let techniqueScores = aggregateTechniqueScores(analysisMatrix, techniques);
  let arbitrageSnapshot: TriangularArbitrageResult | null = null;
  let arbitrageSnapshots: TriangularArbitrageResult[] = [];

  if (techniques.includes('arbitrage_triangular') && arbitrageConfig) {
    const resolvedSymbol = primaryAnalysis.resolvedSymbol ?? params.symbol;
    const { base, quote } = splitSymbolPair(resolvedSymbol);
    const { feePctByExchange, effectiveFeePct } = await resolveArbitrageFeePctForExchanges({
      exchanges: arbitrageConfig.exchanges,
      symbol: resolvedSymbol,
      marketType: params.marketType ?? 'spot',
      tenantId: params.tenantId,
    });
    const networkFeesByAsset = arbitrageConfig.exchanges.length > 1
      ? await resolveNetworkFeesForTenant(params.tenantId)
      : undefined;
    arbitrageSnapshots = await calculateTriangularArbitrage({
      auth: { tenantId: params.tenantId, userId: params.userId },
      startAsset: base,
      quoteAsset: quote,
      intermediateAssets: arbitrageConfig.intermediateAssets,
      marketType: params.marketType,
      marginMode: params.marginMode,
      feePct: effectiveFeePct,
      exchanges: arbitrageConfig.exchanges,
      feePctByExchange,
      networkFeesByAsset,
      maxSlippagePct: arbitrageConfig.maxSlippagePct,
    });
    arbitrageSnapshot = arbitrageSnapshots[0] ?? null;
    if (arbitrageSnapshot) {
      const edgePct = arbitrageSnapshot.edgePct;
      const minEdge = arbitrageConfig.minEdgePct;
      const confidence = Math.min(edgePct / Math.max(minEdge, 0.01), 1);
      const signal: TradingOverallSignal = edgePct >= minEdge * 2
        ? 'strong_buy'
        : edgePct >= minEdge
          ? 'buy'
          : 'neutral';
      techniqueScores = techniqueScores.concat([{
        technique: 'arbitrage_triangular',
        signal,
        confidence: Math.round(confidence * 100) / 100,
        rationale: `Edge ${edgePct.toFixed(2)}% (mín ${minEdge.toFixed(2)}%)`,
      }]);
    } else {
      techniqueScores = techniqueScores.concat([{
        technique: 'arbitrage_triangular',
        signal: 'neutral',
        confidence: 0,
        rationale: 'Sem rota triangular válida com liquidez suficiente.',
      }]);
    }
  }

  const ensembleResult = buildEnsembleResult(techniqueScores, ensembleConfig);

  // Buscar contexto RAG relevante para enriquecer o prompt com estratégias e learnings
  // Consulta semântica no namespace do agente trading (documentos indexados no Qdrant)
  const ragContext = await queryTradingRAGContext({
    tenantId: params.tenantId,
    userId: params.userId,
    namespaceId: agentContext.agent.namespaceId ?? agentContext.namespace?.id,
    symbol: params.symbol,
    marketType: params.marketType ?? 'futures',
    additionalContext: consensus.overallSignal !== 'neutral'
      ? `Sinal ${consensus.overallSignal} com confiança ${(consensus.confidence * 100).toFixed(0)}%`
      : undefined,
  });

  const systemPrompt = buildTradingSignalSystemPrompt({
    marketType: params.marketType ?? 'futures',
    marginMode: params.marginMode,
    agent: agentContext.agent,
    namespace: agentContext.namespace,
    ragContext: ragContext?.context,
  });
  const orderBookSnapshot = effectiveDataSources.orderBook
    ? await getOrderBookSnapshot({ tenantId: params.tenantId, userId: params.userId }, params.symbol, params.marketType, params.marginMode)
    : null;
  const newsSummary = effectiveDataSources.news
    ? await fetchNewsSummary(
      { tenantId: params.tenantId, userId: params.userId },
      params.symbol,
      params.marketType,
      profile.newsConfig
    )
    : null;
  const tradingNamespaceId = agentContext.namespace?.id ?? agentContext.agent.namespaceId;
  if (!tradingNamespaceId) {
    throw new TradingConfigError('TRADING_SCOPE_REQUIRED: Namespace Trading não resolvido para busca de dataset.');
  }
  const trainingSummary = await fetchTradingDatasetSummary(params.tenantId, tradingNamespaceId);
  if (trainingSummary.totalApproved <= 0) {
    throw new TradingConfigError('TRADING_SCOPE_REQUIRED: Dataset aprovado de Trading é obrigatório para gerar sinais.');
  }
  const riskConfig = await kucoinService.getRiskConfig({ tenantId: params.tenantId, userId: params.userId });
  const tradePlan = buildTradePlanFromAnalysis({
    analysis: primaryAnalysis.analysis,
    interval: primaryAnalysis.interval,
    timeframes,
    marketType: params.marketType ?? 'futures',
    marginMode: params.marginMode,
    riskConfig,
  });
  let newsForPrompt = newsSummary;
  const requestedMaxTokens = params.modelConfig?.maxTokens ?? agentContext.llmConfig.maxTokens ?? 2048;

  const buildPromptWithNews = (news: typeof newsSummary) => buildMultiTimeframePrompt({
    matrix: analysisMatrix,
    consensus,
    indicators,
    dataSources: effectiveDataSources,
    orderBook: orderBookSnapshot,
    news,
    trainingData: trainingSummary,
    techniques,
    techniqueScores,
    ensembleResult,
    arbitrageSnapshot,
    arbitrageSnapshots,
  });

  let rawAnalysisPrompt = buildPromptWithNews(newsForPrompt);
  let tokenBudget = resolveMaxTokensForPrompt({
    systemPrompt,
    analysisPrompt: rawAnalysisPrompt,
    requestedMaxTokens,
  });

  if (tokenBudget.analysisPrompt !== rawAnalysisPrompt && newsSummary?.results?.length) {
    const originalCount = newsSummary.results.length;
    let chosenPrompt = rawAnalysisPrompt;
    let chosenBudget = tokenBudget;
    let chosenNewsCount = originalCount;

    for (let i = Math.min(originalCount, TRADING_LLM_MAX_NEWS_ITEMS); i >= 0; i -= 1) {
      const trimmedNews = i === 0 ? { ...newsSummary, results: [] } : { ...newsSummary, results: newsSummary.results.slice(0, i) };
      const candidatePrompt = buildPromptWithNews(trimmedNews);
      const candidateBudget = resolveMaxTokensForPrompt({
        systemPrompt,
        analysisPrompt: candidatePrompt,
        requestedMaxTokens,
      });

      chosenPrompt = candidatePrompt;
      chosenBudget = candidateBudget;
      chosenNewsCount = i;

      if (candidateBudget.analysisPrompt === candidatePrompt) {
        newsForPrompt = trimmedNews;
        break;
      }
    }

    rawAnalysisPrompt = chosenPrompt;
    tokenBudget = chosenBudget;
    if (chosenNewsCount !== originalCount) {
      logger.warn({
        tenantId: params.tenantId,
        symbol: params.symbol,
        originalNewsCount: originalCount,
        usedNewsCount: chosenNewsCount,
        promptTokens: chosenBudget.promptTokens,
      }, 'Notícias reduzidas para respeitar orçamento de tokens');
    }
  }

  const analysisPrompt = tokenBudget.analysisPrompt;

  if (analysisPrompt !== rawAnalysisPrompt) {
    logger.warn({
      tenantId: params.tenantId,
      symbol: params.symbol,
      requestedMaxTokens,
      promptTokens: tokenBudget.promptTokens,
      maxCompletionTokens: tokenBudget.maxCompletionTokens,
    }, 'Prompt de sinal LLM truncado para respeitar o limite de contexto.');
  }
  logger.info({
    tenantId: params.tenantId,
    symbol: params.symbol,
    promptTokens: tokenBudget.promptTokens,
    maxCompletionTokens: tokenBudget.maxCompletionTokens,
    analysisPromptChars: analysisPrompt.length,
    newsResults: newsSummary?.results?.length ?? 0,
  }, 'Orçamento de tokens calculado para sinal LLM');

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: analysisPrompt },
  ];

  // CORREÇÃO CR1 (07/02/2026): Aumentar timeouts para comportar structured JSON output do vLLM.
  // vLLM structured output leva ~58s por request. Com GPU_SERVICE_TIMEOUT de 120s no GPU Manager
  // e possível retry, o client precisa de margem: 240s (normal) / 360s (arbitragem triangular).
  // Logs produção mostravam "Timeout aguardando resultado GPU (120000ms)" com latência real de 58385ms.
  // CORREÇÃO A2: Timeouts configuráveis via env vars (LLM_SIGNAL_TIMEOUT_MS / LLM_SIGNAL_TIMEOUT_ARBITRAGE_MS)
  const llmTimeoutMs = techniques.includes('arbitrage_triangular') ? LLM_SIGNAL_TIMEOUT_ARBITRAGE_MS : LLM_SIGNAL_TIMEOUT_MS;
  // CORREÇÃO A3: Retry com backoff para falhas GPU (max 2 tentativas)
  const MAX_GPU_RETRIES = 2;
  const gpuRequestStartMs = Date.now();
  let gpuResponse: (Awaited<ReturnType<typeof requestGpu>> | GatewayCompleteResult) | null = null;
  let lastGpuError: Error | null = null;

  // Resolver modelo com adapter LoRA ativo (se disponível)
  // Se houver adapter treinado e ativo, usa-o ao invés do modelo base
  // Fallback automático para modelo base se adapter não disponível
  const resolvedModel = await resolveModelWithAdapter(agentContext.llmConfig.model, {
    tenantId: params.tenantId,
    namespaceId: agentContext.agent.namespaceId ?? agentContext.namespace?.id ?? undefined,
    agentId: agentContext.agent.id ?? undefined,
  });
  if (resolvedModel === agentContext.llmConfig.model) {
    throw new TradingConfigError('TRADING_SCOPE_REQUIRED: Adapter LoRA ativo obrigatório para Trading.');
  }

  for (let attempt = 1; attempt <= MAX_GPU_RETRIES; attempt++) {
    try {
      logger.info({
        symbol: params.symbol,
        marketType: params.marketType,
        timeoutMs: llmTimeoutMs,
        model: resolvedModel,
        baseModel: agentContext.llmConfig.model,
        usingLoraAdapter: resolvedModel !== agentContext.llmConfig.model,
        promptTokens: tokenBudget.promptTokens,
        maxCompletionTokens: tokenBudget.maxCompletionTokens,
        attempt,
        maxRetries: MAX_GPU_RETRIES,
        viaGateway: isGatewayConfigured(),
      }, 'Iniciando requisição GPU LLM para geração de sinal trading');

      if (isGatewayConfigured()) {
        gpuResponse = await callGatewayComplete({
          messages,
          config: {
            model: resolvedModel,
            temperature: params.modelConfig?.temperature ?? agentContext.llmConfig.temperature ?? 0.7,
            maxTokens: tokenBudget.maxCompletionTokens,
          },
          context: {
            route: '/trading',
            tenantId: params.tenantId,
            userId: params.userId,
            namespaceId: agentContext.agent.namespaceId ?? agentContext.namespace?.id ?? undefined,
            agentId: agentContext.agent.id ?? undefined,
          },
          extraBody: {
            response_format: {
              type: 'json_schema',
              json_schema: TRADING_LLM_SIGNAL_JSON_SCHEMA,
            },
          },
          requestOptions: { timeout: llmTimeoutMs, priority: 'high' },
        });
      } else {
        gpuResponse = await requestGpu({
          serviceType: GpuServiceType.LLM,
          endpoint: '/v1/chat/completions',
          method: 'POST',
          priority: GpuRequestPriority.HIGH,
          timeout: llmTimeoutMs,
          // CORREÇÃO CR1 (07/02/2026): Usar APENAS response_format (padrão OpenAI, suportado pelo vLLM).
          body: {
            model: resolvedModel,
            messages,
            response_format: {
              type: 'json_schema',
              json_schema: TRADING_LLM_SIGNAL_JSON_SCHEMA,
            },
            max_tokens: tokenBudget.maxCompletionTokens,
            temperature: params.modelConfig?.temperature ?? agentContext.llmConfig.temperature ?? 0.7,
            stream: false,
          },
        });
      }

      if (gpuResponse.success && gpuResponse.data) {
        break; // Sucesso, sair do loop de retry
      }
      lastGpuError = new Error(gpuResponse?.error || 'Falha na resposta do GPU Manager.');
    } catch (err) {
      lastGpuError = err instanceof Error ? err : new Error(String(err));
    }

    // Se não é a última tentativa, aguardar com backoff antes de retry
    if (attempt < MAX_GPU_RETRIES) {
      const backoffMs = attempt * 5000; // 5s, 10s
      logger.warn({ attempt, backoffMs, error: lastGpuError?.message }, 'Retry GPU após falha - aguardando backoff');
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  const gpuLatencyMs = Date.now() - gpuRequestStartMs;
  if (!gpuResponse?.success || !gpuResponse?.data) {
    logger.error({
      gpuLatencyMs,
      gpuError: lastGpuError?.message,
      symbol: params.symbol,
      marketType: params.marketType,
      retriesExhausted: MAX_GPU_RETRIES,
    }, 'Requisição GPU LLM falhou após todas as tentativas para geração de sinal trading');
    throw lastGpuError ?? new Error('Falha na resposta do GPU Manager após retries.');
  }

  const response = gpuResponse;
  logger.info({ gpuLatencyMs, symbol: params.symbol }, 'Requisição GPU LLM completada com sucesso');

  const responseData = response.data as LLMResponse;
  const llmContent = responseData.choices?.[0]?.message?.content?.trim() || '';
  if (!llmContent) {
    throw new Error('Resposta do LLM vazia ou inválida.');
  }

  const llmSignalPartialResult = parseLlmSignalResponse(llmContent);
  logger.info({
    parseMethod: llmSignalPartialResult.parseMethod,
    citedValuesSource: llmSignalPartialResult.citedValuesSource,
    symbol: params.symbol,
    marketType: params.marketType,
  }, 'Sinal de trading LLM parseado - método de parse utilizado');
  const llmSignal = buildLlmSignalFromPartial({
    partial: llmSignalPartialResult.data,
    analysis: primaryAnalysis.analysis,
    tradePlan,
  });
  const durationLabel = formatDurationLabel(llmSignal.expectedDurationMinutes);

  const createResult = await kucoinService.createSignal(
    { tenantId: params.tenantId, userId: params.userId },
    {
      signalType: llmSignal.signalType,
      symbol: primaryAnalysis.resolvedSymbol,
      marketType: params.marketType,
      marginMode: params.marginMode,
      confidence: llmSignal.confidence,
      reasoning: llmSignal.reasoning,
      sourceModel: agentContext.agent.modeloBase ?? 'Qwen2.5-7B-Instruct-AWQ',
      suggestedPrice: llmSignal.suggestedPrice,
      suggestedStopLoss: llmSignal.suggestedStopLoss,
      suggestedTakeProfit: llmSignal.suggestedTakeProfit,
      suggestedSize: llmSignal.suggestedSize,
      metadata: {
        confidence: llmSignal.confidence,
        reasoning: llmSignal.reasoning,
        marketCondition: llmSignal.marketCondition,
        riskScore: llmSignal.riskScore,
        modelVersion: agentContext.llmConfig.model,
        operationType: llmSignal.operationType,
        expectedDurationMinutes: llmSignal.expectedDurationMinutes,
        expectedDurationLabel: durationLabel,
        entryPrice: llmSignal.suggestedPrice,
        takeProfit: llmSignal.suggestedTakeProfit,
        stopLoss: llmSignal.suggestedStopLoss,
        riskReward: llmSignal.riskReward,
        techniques,
        ensemble: ensembleConfig,
        techniqueScores,
        ensembleResult,
        arbitrageSnapshot,
        arbitrageSnapshots,
        motivators: llmSignal.motivators,
        invalidationReasons: llmSignal.invalidationReasons,
        tradeSummary: llmSignal.tradeSummary,
        agentId: agentContext.agent.id,
        namespaceId: agentContext.agent.namespaceId ?? agentContext.namespace?.id,
        generationSource: params.source,
        schedulerId: params.schedulerId,
        validationStatus: 'pending',
        createdByUserId: params.userId,
        timeframes,
        enabledIndicators: indicators,
        dataSources: effectiveDataSources,
        news: newsSummary ?? undefined,
        consensus: {
          rule: consensusConfig.rule ?? 'majority',
          overallSignal: consensus.overallSignal,
          requiredAgree: consensus.requiredAgree,
          agreementRatio: consensus.agreementRatio,
          alignedTimeframes: consensus.alignedTimeframes,
          misalignedTimeframes: consensus.misalignedTimeframes,
          isMajorityReached: consensus.isMajorityReached,
        },
        analysisMatrix: analysisMatrix.map((entry) => ({
          interval: entry.interval,
          analysis: entry.analysis,
        })),
      },
    }
  );

  if (!createResult.success || !createResult.data) {
    throw new Error(createResult.error || 'Falha ao persistir sinal LLM.');
  }

  const requestedValidationTimeframe = llmSignal.timeframeUsed;
  const validationSnapshot = requestedValidationTimeframe
    ? (analysisMatrix.find((entry) => entry.interval === requestedValidationTimeframe) ?? primaryAnalysis)
    : (analysisMatrix.find((entry) => consensus.alignedTimeframes.includes(entry.interval)) ?? primaryAnalysis);
  const validation = await validateAndPersist({
    tenantId: params.tenantId,
    llmResponse: llmSignal.reasoning,
    citedValues: llmSignal.citedValues,
    indicatorSnapshot: validationSnapshot.analysis,
    indicatorSnapshotId: validationSnapshot.indicatorId,
    signalId: createResult.data.id,
    extractionSource: llmSignalPartialResult.citedValuesSource,
    timeframeUsed: requestedValidationTimeframe ?? validationSnapshot.interval,
    maxAllowedDeviation: LLM_VALIDATION_MAX_DEVIATION,
  });

  const validationStatus: TradingSignalMetadata['validationStatus'] = validation.actionTaken === 'approved'
    ? 'validated'
    : validation.actionTaken === 'rejected'
      ? 'failed'
      : 'pending';

  const db = getDatabase();
  const updatedMetadata: TradingSignalMetadata = {
    ...(createResult.data.metadata as Record<string, unknown>),
    validationStatus,
    validationId: validation.validationId,
    validationSummary: {
      reasonCode: validation.result.failureReason,
      failedFields: Object.keys(validation.result.discrepancies ?? {}),
      noValuesExtracted: validation.result.noValuesExtracted,
      accuracy: validation.result.overallAccuracy,
      extractionSource: validation.result.extractionSource,
      timeframeUsed: requestedValidationTimeframe ?? validationSnapshot.interval,
      allowedDeviationByField: validation.result.allowedDeviationByField,
      maxAllowedDeviationPercent: LLM_VALIDATION_MAX_DEVIATION,
      maxDeviationFound: validation.result.maxDeviationFound,
    },
  };

  const [updatedSignal] = await db
    .update(schema.tradingSignals)
    .set({ metadata: updatedMetadata })
    .where(eq(schema.tradingSignals.id, createResult.data.id))
    .returning();

  return {
    signal: (updatedSignal ?? createResult.data) as schema.TradingSignal,
    validationId: validation.validationId,
    validationStatus,
  };
}

function mapTradingSignalForApi(signal: schema.TradingSignal) {
  const metadata = (signal.metadata ?? {}) as Record<string, unknown>;
  return {
    ...signal,
    reasoning: typeof metadata.reasoning === 'string' ? metadata.reasoning : null,
    sourceModel: typeof metadata.modelVersion === 'string' ? metadata.modelVersion : null,
    metadata,
  };
}

function buildNotDeletedMetadataCondition(
  metadataColumn:
    | typeof schema.tradingSignals.metadata
    | typeof schema.tradingOrders.metadata
    | typeof schema.tradingTechnicalIndicators.metadata
) {
  return sql<boolean>`COALESCE((${metadataColumn} ->> 'isDeleted')::boolean, false) = false`;
}

function buildOwnerMetadataCondition(
  metadataColumn:
    | typeof schema.tradingSignals.metadata
    | typeof schema.tradingOrders.metadata
    | typeof schema.tradingTechnicalIndicators.metadata,
  userId: string
) {
  return sql<boolean>`(${metadataColumn} ->> 'createdByUserId') = ${userId}`;
}

function buildSoftDeleteMetadataUpdate(
  metadataColumn:
    | typeof schema.tradingSignals.metadata
    | typeof schema.tradingOrders.metadata
    | typeof schema.tradingTechnicalIndicators.metadata,
  deletedAt: string,
  deletedByUserId: string
) {
  return sql`
    jsonb_set(
      jsonb_set(
        jsonb_set(coalesce(${metadataColumn}, '{}'::jsonb), '{isDeleted}', 'true'::jsonb, true),
        '{deletedAt}', to_jsonb(${deletedAt}), true
      ),
      '{deletedByUserId}', to_jsonb(${deletedByUserId}), true
    )
  `;
}

function parseHistoryDateParam(value?: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

// GET /api/integrations/trading/signals - Lista sinais de trading ativos
app.get('/api/integrations/trading/signals', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }
    const tradingAuth = { tenantId: authContext.tenantId, userId: authContext.userId };
    const querySchema = z.object({
      limit: z.coerce.number().int().min(1).max(200).optional(),
      marketType: z.enum(['futures', 'spot', 'margin']).optional(),
      type: z.enum(['futures', 'spot', 'margin']).optional(),
    });
    const queryResult = querySchema.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
      return;
    }

    const limit = queryResult.data.limit ?? 10;
    const marketType = resolveMarketTypeParam(queryResult.data);
    const signals = await kucoinService.getActiveSignals(tradingAuth, limit, marketType);

    res.json({
      success: true,
      data: signals.map(mapTradingSignalForApi),
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter sinais');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/signals/history - Histórico de sinais (paginado)
app.get('/api/integrations/trading/signals/history', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }
    const tradingAuth = { tenantId: authContext.tenantId, userId: authContext.userId };
    const querySchema = z.object({
      limit: z.coerce.number().int().min(1).max(200).optional(),
      cursor: z.string().datetime().optional(),
      page: z.coerce.number().int().min(1).optional(),
      pageSize: z.coerce.number().int().min(1).max(200).optional(),
      orderDirection: z.enum(['asc', 'desc']).optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      symbol: z.string().optional(),
      marketType: z.enum(['futures', 'spot', 'margin']).optional(),
      signalType: z.enum(['entry_long', 'entry_short', 'exit', 'adjust_sl', 'adjust_tp', 'hold', 'neutral']).optional(),
      validationStatus: z.enum(['pending', 'validated', 'failed']).optional(),
      approvalStatus: z.enum(['pending', 'approved', 'rejected']).optional(),
      includeDeleted: z.coerce.boolean().optional(),
    });
    const queryResult = querySchema.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
      return;
    }

    const limit = queryResult.data.limit ?? 50;
    const cursorDate = queryResult.data.cursor ? new Date(queryResult.data.cursor) : null;
    const usePaging = queryResult.data.page !== undefined || queryResult.data.pageSize !== undefined;
    const page = queryResult.data.page ?? 1;
    const pageSize = queryResult.data.pageSize ?? limit;
    const orderDirection = queryResult.data.orderDirection ?? 'desc';
    const marketType = queryResult.data.marketType ?? undefined;
    const signalType = queryResult.data.signalType ?? undefined;
    const validationStatus = queryResult.data.validationStatus ?? undefined;
    const approvalStatus = queryResult.data.approvalStatus ?? undefined;
    const includeDeleted = queryResult.data.includeDeleted ?? false;
    const dateFrom = parseHistoryDateParam(queryResult.data.dateFrom);
    const dateTo = parseHistoryDateParam(queryResult.data.dateTo);
    if (queryResult.data.dateFrom && !dateFrom) {
      res.status(400).json({ error: 'Data inicial inválida.' });
      return;
    }
    if (queryResult.data.dateTo && !dateTo) {
      res.status(400).json({ error: 'Data final inválida.' });
      return;
    }

    const symbolParam = queryResult.data.symbol;
    const resolvedSymbol = symbolParam
      ? await resolveTradingSymbolOrRespond(res, tradingAuth, symbolParam, { required: true, marketType })
      : undefined;
    if (symbolParam && !resolvedSymbol) return;

    const conditions = [eq(schema.tradingSignals.tenantId, authContext.tenantId)];
    if (resolvedSymbol) conditions.push(eq(schema.tradingSignals.symbol, resolvedSymbol));
    if (marketType) conditions.push(eq(schema.tradingSignals.marketType, marketType));
    if (signalType) conditions.push(eq(schema.tradingSignals.signalType, signalType));
    if (dateFrom) conditions.push(gte(schema.tradingSignals.criadoEm, dateFrom));
    if (dateTo) conditions.push(lte(schema.tradingSignals.criadoEm, dateTo));
    if (!usePaging && cursorDate) conditions.push(lt(schema.tradingSignals.criadoEm, cursorDate));
    if (validationStatus) {
      conditions.push(sql`(${schema.tradingSignals.metadata} ->> 'validationStatus') = ${validationStatus}`);
    }
    if (approvalStatus) {
      conditions.push(sql`(${schema.tradingSignals.metadata} ->> 'approvalStatus') = ${approvalStatus}`);
    }
    if (!includeDeleted) {
      conditions.push(buildNotDeletedMetadataCondition(schema.tradingSignals.metadata));
    }

    const db = getDatabase();
    const orderByClause = orderDirection === 'asc'
      ? asc(schema.tradingSignals.criadoEm)
      : desc(schema.tradingSignals.criadoEm);

    if (usePaging) {
      const [totalRow] = await db
        .select({ total: sql<number>`count(*)` })
        .from(schema.tradingSignals)
        .where(and(...conditions));
      const total = Number(totalRow?.total ?? 0);
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const offset = Math.max(0, (page - 1) * pageSize);
      const history = await db
        .select()
        .from(schema.tradingSignals)
        .where(and(...conditions))
        .orderBy(orderByClause)
        .limit(pageSize)
        .offset(offset);

      res.json({
        success: true,
        data: history.map(mapTradingSignalForApi),
        page,
        pageSize,
        total,
        totalPages,
        orderDirection,
      });
      return;
    }

    const history = await db
      .select()
      .from(schema.tradingSignals)
      .where(and(...conditions))
      .orderBy(orderByClause)
      .limit(limit);

    const nextCursor = history.length > 0
      ? history[history.length - 1]?.criadoEm?.toISOString() ?? null
      : null;

    res.json({
      success: true,
      data: history.map(mapTradingSignalForApi),
      nextCursor,
      orderDirection,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter histórico de sinais');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/signals/history/stats - Estatísticas do histórico de sinais
app.get('/api/integrations/trading/signals/history/stats', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }
    const db = getDatabase();
    const notDeleted = buildNotDeletedMetadataCondition(schema.tradingSignals.metadata);

    const [stats] = await db
      .select({
        total: sql<number>`count(*)`,
        validated: sql<number>`count(*) filter (where coalesce(${schema.tradingSignals.metadata} ->> 'validationStatus', 'pending') = 'validated')`,
        failed: sql<number>`count(*) filter (where coalesce(${schema.tradingSignals.metadata} ->> 'validationStatus', 'pending') = 'failed')`,
        pendingValidation: sql<number>`count(*) filter (where coalesce(${schema.tradingSignals.metadata} ->> 'validationStatus', 'pending') = 'pending')`,
        approved: sql<number>`count(*) filter (where coalesce(${schema.tradingSignals.metadata} ->> 'approvalStatus', 'pending') = 'approved')`,
        rejected: sql<number>`count(*) filter (where coalesce(${schema.tradingSignals.metadata} ->> 'approvalStatus', 'pending') = 'rejected')`,
        pendingApproval: sql<number>`count(*) filter (where coalesce(${schema.tradingSignals.metadata} ->> 'approvalStatus', 'pending') = 'pending')`,
      })
      .from(schema.tradingSignals)
      .where(and(eq(schema.tradingSignals.tenantId, authContext.tenantId), notDeleted));

    res.json({
      success: true,
      data: {
        total: Number(stats?.total ?? 0),
        validation: {
          validated: Number(stats?.validated ?? 0),
          failed: Number(stats?.failed ?? 0),
          pending: Number(stats?.pendingValidation ?? 0),
        },
        approval: {
          approved: Number(stats?.approved ?? 0),
          rejected: Number(stats?.rejected ?? 0),
          pending: Number(stats?.pendingApproval ?? 0),
        },
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter estatísticas de sinais');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/signals/history/delete - Exclusão lógica de sinais
app.post('/api/integrations/trading/signals/history/delete', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }
    const bodySchema = z.object({
      ids: z.array(z.string().uuid()).optional(),
      all: z.boolean().optional(),
      scope: z.enum(['self', 'tenant']).optional(),
    });
    const bodyResult = bodySchema.safeParse(req.body ?? {});
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Dados inválidos', details: bodyResult.error.flatten() });
      return;
    }
    const { ids, all, scope } = bodyResult.data;
    if (!ids?.length && !all) {
      res.status(400).json({ error: 'Informe ids ou use all=true para excluir.' });
      return;
    }

    const isAdmin = await isAdminUser(authContext);
    const effectiveScope = scope === 'tenant' && isAdmin ? 'tenant' : 'self';
    if (scope === 'tenant' && !isAdmin) {
      res.status(403).json({ error: 'Apenas administradores podem excluir histórico de todo o tenant.' });
      return;
    }

    const conditions = [eq(schema.tradingSignals.tenantId, authContext.tenantId)];
    if (effectiveScope === 'self') {
      conditions.push(buildOwnerMetadataCondition(schema.tradingSignals.metadata, authContext.userId));
    }
    if (ids?.length) {
      conditions.push(inArray(schema.tradingSignals.id, ids));
    }

    const deletedAt = new Date().toISOString();
    const db = getDatabase();
    const updateResult = await db
      .update(schema.tradingSignals)
      .set({
        metadata: buildSoftDeleteMetadataUpdate(schema.tradingSignals.metadata, deletedAt, authContext.userId),
      })
      .where(and(...conditions));

    res.json({
      success: true,
      data: { deletedAt, scope: effectiveScope },
      updated: updateResult.rowCount ?? 0,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao excluir histórico de sinais');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/signals/history/purge - Exclusão definitiva (admin)
app.post('/api/integrations/trading/signals/history/purge', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }
    const tenantId = authContext.tenantId;
    const userId = authContext.userId;
    const isAdmin = await isAdminUser(authContext);
    if (!isAdmin) {
      res.status(403).json({ error: 'Apenas administradores podem excluir definitivamente o histórico.' });
      return;
    }
    const bodySchema = z.object({
      ids: z.array(z.string().uuid()).optional(),
      all: z.boolean().optional(),
      scope: z.enum(['self', 'tenant']).optional(),
    });
    const bodyResult = bodySchema.safeParse(req.body ?? {});
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Dados inválidos', details: bodyResult.error.flatten() });
      return;
    }
    const { ids, all, scope } = bodyResult.data;
    if (!ids?.length && !all) {
      res.status(400).json({ error: 'Informe ids ou use all=true para excluir.' });
      return;
    }

    const effectiveScope = scope ?? 'self';
    const baseConditions = [eq(schema.tradingSignals.tenantId, tenantId)];
    if (effectiveScope === 'self') {
      baseConditions.push(buildOwnerMetadataCondition(schema.tradingSignals.metadata, userId));
    }
    if (ids?.length) {
      baseConditions.push(inArray(schema.tradingSignals.id, ids));
    }

    const db = getDatabase();
    const signalIdsQuery = db
      .select({ id: schema.tradingSignals.id })
      .from(schema.tradingSignals)
      .where(and(...baseConditions));

    const result = await db.transaction(async (tx) => {
      await tx
        .update(schema.tradingSignalSchedulers)
        .set({ lastSignalId: null })
        .where(and(
          eq(schema.tradingSignalSchedulers.tenantId, tenantId),
          inArray(schema.tradingSignalSchedulers.lastSignalId, signalIdsQuery)
        ));

      await tx
        .update(schema.tradingOrders)
        .set({ signalId: null })
        .where(and(
          eq(schema.tradingOrders.tenantId, tenantId),
          inArray(schema.tradingOrders.signalId, signalIdsQuery)
        ));

      const validationDelete = await tx
        .delete(schema.tradingLlmValidations)
        .where(and(
          eq(schema.tradingLlmValidations.tenantId, tenantId),
          inArray(schema.tradingLlmValidations.signalId, signalIdsQuery)
        ));

      const deleteResult = await tx
        .delete(schema.tradingSignals)
        .where(and(...baseConditions));

      return {
        deletedSignals: deleteResult.rowCount ?? 0,
        deletedValidations: validationDelete.rowCount ?? 0,
      };
    });

    res.json({
      success: true,
      data: {
        scope: effectiveScope,
        deletedSignals: result.deletedSignals,
        deletedValidations: result.deletedValidations,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao excluir definitivamente histórico de sinais');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/signals - Criar sinal de trading (do LLM)
app.post('/api/integrations/trading/signals', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }
    const tradingAuth = { tenantId: authContext.tenantId, userId: authContext.userId };

    // CORREÇÃO 18/12/2025: signalType alinhado com enum do banco de dados
    const signalSchema = z.object({
      signalType: z.enum(['entry_long', 'entry_short', 'exit', 'adjust_sl', 'adjust_tp', 'hold', 'neutral']),
      symbol: z.string().optional(),
      marketType: z.enum(['futures', 'spot', 'margin']).optional(),
      marginMode: z.enum(['cross', 'isolated']).optional(),
      confidence: z.number().min(0).max(1),
      reasoning: z.string().optional(),
      sourceModel: z.string().optional(),
      suggestedPrice: z.number().positive().optional(),
      suggestedStopLoss: z.number().positive().optional(),
      suggestedTakeProfit: z.number().positive().optional(),
      suggestedSize: z.number().positive().optional(),
      metadata: z.record(z.unknown()).optional(),
    });

    const validatedResult = signalSchema.safeParse(req.body);
    if (!validatedResult.success) {
      res.status(400).json({ error: 'Dados inválidos', details: validatedResult.error.flatten() });
      return;
    }
    const validated = validatedResult.data;
    const symbolParam = validated.symbol;
    const marketType = validated.marketType;
    const marginMode = validated.marginMode;
    const resolvedSymbol = symbolParam
      ? await resolveTradingSymbolOrRespond(res, tradingAuth, symbolParam, { required: true, marketType, marginMode })
      : undefined;
    if (symbolParam && !resolvedSymbol) return;

    const metadata = {
      ...(validated.metadata ?? {}),
      createdByUserId: authContext.userId,
    };
    const result = await kucoinService.createSignal(
      tradingAuth,
      { ...validated, symbol: resolvedSymbol, marketType, marginMode, metadata }
    );

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.status(201).json({
      success: true,
      data: result.data,
      auditLogId: result.auditLogId,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao criar sinal');
    res.status(500).json({ error: errorMessage });
  }
});

// Schema para ID UUID de trading (sinais, ordens, etc.)
const tradingUuidParamSchema = z.object({
  id: z.string().uuid('ID deve ser UUID válido'),
});

const optionalReasonSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().max(500).optional());

// DELETE /api/integrations/trading/signals/:id - Desativar sinal
app.delete('/api/integrations/trading/signals/:id', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    // OWASP API3: Validação de parâmetro de rota
    const paramResult = tradingUuidParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
      return;
    }

    const { id } = paramResult.data;
    const result = await kucoinService.deactivateSignal(
      { tenantId: authContext.tenantId, userId: authContext.userId },
      id
    );

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao desativar sinal');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/signals/:id/approve - Aprovar sinal (cria ordem pendente ou marca para treinamento)
app.post('/api/integrations/trading/signals/:id/approve', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }
    const paramResult = tradingUuidParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
      return;
    }
    const bodySchema = z.object({
      reason: optionalReasonSchema,
      overrides: z.object({
        orderType: z.enum(['limit', 'market', 'stop_limit', 'stop_market', 'take_profit']).optional(),
        size: z.number().positive().optional(),
        price: z.number().positive().optional(),
        leverage: z.number().min(1).max(100).optional(),
        stopLoss: z.number().positive().optional(),
        takeProfit: z.number().positive().optional(),
      }).optional(),
    });
    const bodyResult = bodySchema.safeParse(req.body ?? {});
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Dados inválidos', details: bodyResult.error.flatten() });
      return;
    }

    // CORREÇÃO 11/02/2026: Sinais NEUTRAL e HOLD não geram ordens — servem apenas para treinamento
    // Verificar tipo do sinal ANTES de tentar criar ordem
    const db = getDatabase();
    const [signal] = await db
      .select()
      .from(schema.tradingSignals)
      .where(and(eq(schema.tradingSignals.id, paramResult.data.id), eq(schema.tradingSignals.tenantId, authContext.tenantId)))
      .limit(1);

    if (!signal) {
      res.status(404).json({ error: 'Sinal não encontrado.' });
      return;
    }

    // Sinais neutral/hold: aprovar apenas para treinamento (sem criar ordem)
    const trainingOnlyTypes = ['neutral', 'hold'];
    if (trainingOnlyTypes.includes(signal.signalType)) {
      const datasetResult = await createTradingDatasetFromSignalSource({
        authContext: { tenantId: authContext.tenantId, userId: authContext.userId },
        signal,
        reviewNotes: bodyResult.data.reason,
      });

      // Atualizar metadata do sinal com status de aprovação para treinamento
      const existingMetadata = (signal.metadata ?? {}) as Record<string, unknown>;
      const updatedMetadata = {
        ...existingMetadata,
        approvalStatus: 'approved',
        approvedAt: new Date().toISOString(),
        approvedBy: authContext.userId,
        approvalReason: bodyResult.data.reason ?? undefined,
        approvalType: 'training_only',
      };
      await db
        .update(schema.tradingSignals)
        .set({
          metadata: updatedMetadata as typeof signal.metadata,
          isActive: false,
        })
        .where(eq(schema.tradingSignals.id, signal.id));

      logger.info(
        {
          signalId: signal.id,
          signalType: signal.signalType,
          userId: authContext.userId,
          datasetId: datasetResult.dataset.id,
          datasetStatus: datasetResult.status,
          datasetCreated: datasetResult.created,
        },
        'Sinal neutral/hold aprovado para treinamento com dataset gerado (sem ordem criada)'
      );

      const datasetReviewMessage =
        datasetResult.status === 'pending'
          ? 'dataset enviado para revisão'
          : datasetResult.status === 'rejected'
            ? 'dataset rejeitado automaticamente por regras de qualidade/duplicidade'
            : `dataset com status ${datasetResult.status}`;

      res.status(200).json({
        success: true,
        data: {
          signalId: signal.id,
          signalType: signal.signalType,
          approvalType: 'training_only',
          dataset: {
            id: datasetResult.dataset.id,
            status: datasetResult.status,
            created: datasetResult.created,
            qualityScore: datasetResult.qualityScore,
            isDuplicate: datasetResult.duplicate.isDuplicate,
          },
          message: `Sinal ${signal.signalType.toUpperCase()} aprovado para treinamento e ${datasetReviewMessage}. Nenhuma ordem foi criada.`,
        },
      });
      return;
    }

    // Sinais de entrada/saída: criar ordem pendente normalmente
    const result = await kucoinService.createPendingOrderFromSignal(
      { tenantId: authContext.tenantId, userId: authContext.userId },
      paramResult.data.id,
      bodyResult.data.reason,
      bodyResult.data.overrides
    );

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.status(201).json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao aprovar sinal');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/signals/:id/reject - Rejeitar sinal
app.post('/api/integrations/trading/signals/:id/reject', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }
    const paramResult = tradingUuidParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
      return;
    }
    const bodySchema = z.object({
      reason: optionalReasonSchema,
    });
    const bodyResult = bodySchema.safeParse(req.body ?? {});
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Dados inválidos', details: bodyResult.error.flatten() });
      return;
    }

    const result = await kucoinService.rejectSignal(
      { tenantId: authContext.tenantId, userId: authContext.userId },
      paramResult.data.id,
      bodyResult.data.reason
    );

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao rejeitar sinal');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/orders - Lista ordens
app.get('/api/integrations/trading/orders', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }
    const querySchema = z.object({
      status: z.enum([
        'pending_review',
        'review_rejected',
        'pending',
        'submitted',
        'open',
        'filled',
        'cancelled',
        'rejected',
        'expired',
        'error',
      ]).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
      marketType: z.enum(['futures', 'spot', 'margin']).optional(),
    });
    const queryResult = querySchema.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
      return;
    }

    const status = queryResult.data.status;
    const limit = queryResult.data.limit ?? 50;
    const marketType = queryResult.data.marketType;

    const orders = await kucoinService.getOrders(
      { tenantId: authContext.tenantId, userId: authContext.userId },
      { status, limit, marketType }
    );

    res.json({
      success: true,
      data: orders,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter ordens');
    res.status(500).json({ error: errorMessage });
  }
});

// PATCH /api/integrations/trading/orders/:id/review - Atualizar ordem pendente
app.patch('/api/integrations/trading/orders/:id/review', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }
    const paramResult = tradingUuidParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
      return;
    }
    const updateSchema = z.object({
      price: z.number().positive().optional(),
      size: z.number().positive().optional(),
      leverage: z.number().min(1).max(100).optional(),
      orderType: z.enum(['limit', 'market', 'stop_limit', 'stop_market', 'take_profit']).optional(),
      stopLoss: z.number().positive().optional(),
      takeProfit: z.number().positive().optional(),
    });
    const parsed = updateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
      return;
    }

    const result = await kucoinService.updatePendingOrder(
      { tenantId: authContext.tenantId, userId: authContext.userId },
      paramResult.data.id,
      parsed.data
    );

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao atualizar ordem pendente');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/orders/:id/approve - Aprovar ordem pendente
app.post('/api/integrations/trading/orders/:id/approve', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }
    const paramResult = tradingUuidParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
      return;
    }

    const result = await kucoinService.approvePendingOrder(
      { tenantId: authContext.tenantId, userId: authContext.userId },
      paramResult.data.id
    );

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao aprovar ordem pendente');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/orders/:id/reject - Rejeitar ordem pendente
app.post('/api/integrations/trading/orders/:id/reject', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }
    const paramResult = tradingUuidParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
      return;
    }
    const bodySchema = z.object({
      reason: z.string().min(3).max(500).optional(),
    });
    const bodyResult = bodySchema.safeParse(req.body ?? {});
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Dados inválidos', details: bodyResult.error.flatten() });
      return;
    }

    const result = await kucoinService.rejectPendingOrder(
      { tenantId: authContext.tenantId, userId: authContext.userId },
      paramResult.data.id,
      bodyResult.data.reason
    );

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao rejeitar ordem pendente');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/orders - Criar ordem baseada em sinal
app.post('/api/integrations/trading/orders', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }
    const tradingAuth = { tenantId: authContext.tenantId, userId: authContext.userId };

    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }

    const baseOrderSchema = z.object({
      symbol: z.string().optional(),
      side: z.enum(['buy', 'sell']),
      orderType: z.enum(['limit', 'market']),
      size: z.number().positive().optional(),
      funds: z.number().positive().optional(),
      price: z.number().positive().optional(),
      leverage: z.number().min(1).max(100).optional(),
      marketType: z.enum(['futures', 'spot', 'margin']).optional(),
      marginMode: z.enum(['cross', 'isolated']).optional(),
    }).strict();

    const orderFromSignalSchema = baseOrderSchema
      .extend({ signalId: z.string().uuid() })
      .superRefine((data, ctx) => {
        if (data.orderType === 'limit' && data.price === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Preço é obrigatório para ordens do tipo "limit".',
            path: ['price'],
          });
        }
        const marketType = data.marketType ?? 'futures';
        if (marketType === 'futures' && (!data.size || !Number.isInteger(data.size))) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Quantidade deve ser inteira (contratos) para Futures.',
            path: ['size'],
          });
        }
        if (marketType !== 'futures' && data.orderType === 'market' && data.side === 'buy' && !data.size && !data.funds) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Informe size ou funds para ordens market de compra.',
            path: ['size'],
          });
        }
        if (marketType !== 'futures' && data.orderType === 'limit' && !data.size) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Quantidade é obrigatória para ordens limit em Spot/Margin.',
            path: ['size'],
          });
        }
        if (marketType !== 'futures' && data.orderType === 'market' && data.side !== 'buy' && !data.size) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Quantidade é obrigatória para ordens market de venda em Spot/Margin.',
            path: ['size'],
          });
        }
      });

    const manualOrderSchema = baseOrderSchema.superRefine((data, ctx) => {
      if (data.orderType === 'limit' && data.price === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Preço é obrigatório para ordens do tipo "limit".',
          path: ['price'],
        });
      }
      const marketType = data.marketType ?? 'futures';
      if (marketType === 'futures' && (!data.size || !Number.isInteger(data.size))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Quantidade deve ser inteira (contratos) para Futures.',
          path: ['size'],
        });
      }
      if (marketType !== 'futures' && data.orderType === 'market' && data.side === 'buy' && !data.size && !data.funds) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Informe size ou funds para ordens market de compra.',
          path: ['size'],
        });
      }
      if (marketType !== 'futures' && data.orderType === 'limit' && !data.size) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Quantidade é obrigatória para ordens limit em Spot/Margin.',
          path: ['size'],
        });
      }
      if (marketType !== 'futures' && data.orderType === 'market' && data.side !== 'buy' && !data.size) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Quantidade é obrigatória para ordens market de venda em Spot/Margin.',
          path: ['size'],
        });
      }
    });

    const parsed = z.union([orderFromSignalSchema, manualOrderSchema]).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
      return;
    }

    const symbolParam = parsed.data.symbol;
    const marketType = parsed.data.marketType;
    const marginMode = parsed.data.marginMode;
    const resolvedSymbol = symbolParam
      ? await resolveTradingSymbolOrRespond(res, tradingAuth, symbolParam, { required: true, marketType, marginMode })
      : undefined;
    if (symbolParam && !resolvedSymbol) return;

    const result =
      'signalId' in parsed.data
        ? await kucoinService.createOrderFromSignal(tradingAuth, { ...parsed.data, symbol: resolvedSymbol })
        : await kucoinService.createManualOrder(tradingAuth, { ...parsed.data, symbol: resolvedSymbol });

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.status(201).json({
      success: true,
      data: result.data,
      auditLogId: result.auditLogId,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao criar ordem');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/orders/:id - Cancelar ordem
app.delete('/api/integrations/trading/orders/:id', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }

    // OWASP API3: Validação de parâmetro de rota
    const paramResult = tradingUuidParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
      return;
    }

    const { id } = paramResult.data;
    const result = await kucoinService.cancelOrder(
      { tenantId: authContext.tenantId, userId: authContext.userId },
      id
    );

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar ordem');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/orders/sync - Sincronizar ordens com KuCoin
app.post('/api/integrations/trading/orders/sync', requirePermission('integrations:trading:manage'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }

    const result = await kucoinService.syncOrdersStatus({
      tenantId: authContext.tenantId,
      userId: authContext.userId,
    });

    if (result.filledOrders.length > 0) {
      for (const order of result.filledOrders) {
        try {
          await createTradingDatasetFromOrder({
            authContext: { tenantId: authContext.tenantId, userId: authContext.userId },
            order,
          });
        } catch (datasetError) {
          logger.warn({
            orderId: order.id,
            error: datasetError instanceof Error ? datasetError.message : String(datasetError),
          }, 'Falha ao gerar dataset de trading a partir de ordem executada');
        }
      }
    }

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao sincronizar ordens');
    res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// TRADING: STOP ORDERS (TP/SL) - KuCoin API 2025
// POST /api/v1/st-orders conforme documentação oficial
// Referência: https://www.kucoin.com/docs-new/rest/futures-trading/orders/add-take-profit-and-stop-loss-order
// ============================================================================

// POST /api/integrations/trading/stop-orders - Criar ordem stop (TP/SL)
app.post('/api/integrations/trading/stop-orders', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }
    const tradingAuth = { tenantId: authContext.tenantId, userId: authContext.userId };

    const stopOrderSchema = z.object({
      symbol: z.string().optional(),
      side: z.enum(['buy', 'sell']),
      size: z.number().positive(),
      stopLoss: z.number().positive().optional(),
      takeProfit: z.number().positive().optional(),
      leverage: z.number().int().min(1).max(100).optional(),
      orderType: z.enum(['limit', 'market']).optional(),
      price: z.number().positive().optional(),
      stopPriceType: z.enum(['TP', 'MP']).optional(),
      marketType: z.enum(['futures', 'spot', 'margin']).optional(),
      marginMode: z.enum(['cross', 'isolated']).optional(),
    })
      .refine((data) => data.stopLoss || data.takeProfit, {
        message: 'Pelo menos stopLoss ou takeProfit deve ser definido',
      })
      .superRefine((data, ctx) => {
        const marketType = data.marketType ?? 'futures';
        if (data.orderType === 'limit' && data.price === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Preço é obrigatório quando orderType="limit".',
            path: ['price'],
          });
        }
        if ((data.stopLoss !== undefined || data.takeProfit !== undefined) && !data.stopPriceType) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'stopPriceType é obrigatório quando stopLoss ou takeProfit são informados.',
            path: ['stopPriceType'],
          });
        }
        if (marketType === 'futures' && !Number.isInteger(data.size)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Quantidade deve ser inteira (contratos) para Futures.',
            path: ['size'],
          });
        }
      });

    const parsed = stopOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
      return;
    }

    const marketType = parsed.data.marketType;
    const marginMode = parsed.data.marginMode;
    if (marketType === 'spot' && !kucoinSpotClient.isSpotConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    if (marketType === 'margin' && !kucoinMarginClient.isMarginConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    if (!marketType || marketType === 'futures') {
      if (!kucoinClient.isKucoinConfigured()) {
        respondKucoinNotConfigured(res);
        return;
      }
    }

    const resolvedSymbol = parsed.data.symbol
      ? await resolveTradingSymbolOrRespond(res, tradingAuth, parsed.data.symbol, { required: true, marketType, marginMode })
      : await kucoinService.resolveTradingSymbol(tradingAuth, undefined, marketType, marginMode);
    if (!resolvedSymbol) return;

    const result = await kucoinService.createStopOrder(tradingAuth, { ...parsed.data, symbol: resolvedSymbol });

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.status(201).json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao criar ordem stop');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/signals/generate - Gerar sinal LLM on-demand
app.post('/api/integrations/trading/signals/generate', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    const generateSchema = z.object({
      symbol: z.string().optional(),
      interval: TRADING_INTERVAL_ZOD.optional(),
      timeframes: z.array(TRADING_INTERVAL_ZOD).min(1).optional(),
      indicators: z.array(TRADING_INDICATOR_ZOD).min(1).optional(),
      dataSources: z.object({
        orderBook: z.boolean().optional(),
        news: z.boolean().optional(),
        trainingData: z.boolean().optional(),
      }).optional(),
      techniques: z.array(TRADING_TECHNIQUE_ZOD).min(1).optional(),
      ensembleConfig: TradingEnsembleConfigSchema.optional(),
      arbitrageConfig: TradingArbitrageConfigSchema.optional().nullable(),
      modelConfig: z.object({
        temperature: z.number().min(0).max(2).optional(),
        maxTokens: z.number().min(256).max(4096).optional(),
      }).optional(),
      consensus: z.object({
        rule: z.literal('majority').optional(),
        minAgree: z.number().min(1).optional(),
      }).optional(),
      marketType: z.enum(['futures', 'spot', 'margin']).optional(),
      marginMode: z.enum(['cross', 'isolated']).optional(),
      agentId: z.string().uuid().optional(),
    });

    const parsed = generateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
      return;
    }

    const marketType = parsed.data.marketType;
    const marginMode = parsed.data.marginMode;

    if (marketType === 'spot' && !kucoinSpotClient.isSpotConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    if (marketType === 'margin' && !kucoinMarginClient.isMarginConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    if (!marketType || marketType === 'futures') {
      if (!kucoinClient.isKucoinConfigured()) {
        respondKucoinNotConfigured(res);
        return;
      }
    }

    const tradingAuth = { tenantId: authContext.tenantId, userId: authContext.userId };
    const resolvedSymbol = await resolveTradingSymbolOrRespond(res, tradingAuth, parsed.data.symbol, {
      required: false,
      marketType,
      marginMode,
    });
    if (!resolvedSymbol) return;
    const consensusOverride = parsed.data.consensus
      ? { rule: 'majority' as const, minAgree: parsed.data.consensus.minAgree }
      : undefined;

    const result = await generateTradingSignalFromLlm({
      tenantId: authContext.tenantId,
      userId: authContext.userId,
      symbol: resolvedSymbol,
      interval: parsed.data.interval ?? '5m',
      marketType,
      marginMode,
      source: 'on_demand',
      agentId: parsed.data.agentId,
      timeframes: parsed.data.timeframes,
      indicators: parsed.data.indicators as TradingIndicatorKey[] | undefined,
      dataSources: parsed.data.dataSources,
      techniques: parsed.data.techniques as TradingTechnique[] | undefined,
      ensembleConfig: parsed.data.ensembleConfig ?? undefined,
      arbitrageConfig: parsed.data.arbitrageConfig ?? undefined,
      modelConfig: parsed.data.modelConfig,
      consensus: consensusOverride,
    });

    res.status(201).json({
      success: true,
      data: mapTradingSignalForApi(result.signal),
      validationId: result.validationId,
      validationStatus: result.validationStatus,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    if (error instanceof TradingConfigError) {
      res.status(400).json({ error: error.message });
      return;
    }
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    // CORREÇÃO CR4 (07/02/2026): Logging detalhado para identificar etapa exata da falha.
    // Inclui stack trace e causa raiz aninhada para diagnóstico rápido.
    const errorStack = error instanceof Error ? error.stack : undefined;
    const errorCause = error instanceof Error && 'cause' in error ? (error.cause as { message?: string })?.message : undefined;
    logger.error({
      error: errorMessage,
      cause: errorCause,
      stack: errorStack,
    }, 'Erro ao gerar sinal LLM');
    // CORREÇÃO A4: Retornar mensagem amigável ao frontend (sem expor stack trace ou internals)
    const userError = mapTradingErrorToUserMessage(error instanceof Error ? error : new Error(errorMessage));
    res.status(500).json({ error: userError.message, code: userError.code });
  }
});

/** Mapeia training_data para formato de trading dataset (retrocompatível com frontend). */
function mapTrainingDataToTradingDatasetRow(row: typeof schema.trainingData.$inferSelect): Record<string, unknown> {
  const msgs = (row.messages ?? []) as Array<{ role: string; content: string }>;
  const userMsg = msgs.find((m) => m.role === 'user');
  const assistantMsg = msgs.find((m) => m.role === 'assistant');
  const meta = (row.sourceMetadata ?? {}) as Record<string, unknown>;
  const marketContext = meta.marketContext as Record<string, unknown> | undefined;
  const actionType = (meta.actionType as string) ?? 'signal';
  return {
    id: row.id,
    tenantId: row.tenantId,
    status: row.status,
    prompt: userMsg?.content ?? '',
    response: assistantMsg?.content ?? '',
    actionType,
    marketContext: marketContext ?? { symbol: 'N/A' },
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    qualityScore: row.qualityScore,
    reviewNotes: row.reviewNotes,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt,
    isDuplicate: row.isDuplicate ?? false,
    similarityScore: row.similarityScore,
    sourceMetadata: meta,
    criadoEm: row.criadoEm,
    usedInJobId: row.usedInJobId,
  };
}

// GET /api/integrations/trading/datasets/stats - Contagens por status (para cards de totais sem depender do filtro da listagem)
// Usa training_data com sourceType em TRADING_SOURCE_TYPES (tabela universal)
app.get('/api/integrations/trading/datasets/stats', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    const db = getDatabase();
    const rows = await db
      .select({
        status: schema.trainingData.status,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.trainingData)
      .where(and(
        eq(schema.trainingData.tenantId, authContext.tenantId),
        inArray(schema.trainingData.sourceType, [...TRADING_SOURCE_TYPES])
      ))
      .groupBy(schema.trainingData.status);

    const stats = { pending: 0, approved: 0, rejected: 0, used: 0 };
    for (const row of rows) {
      if (row.status && row.status in stats) {
        (stats as Record<string, number>)[row.status] = Number(row.count ?? 0);
      }
    }

    res.json({ success: true, ...stats });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter stats de datasets de trading');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/datasets - Lista datasets de trading (training_data com sourceType em TRADING_SOURCE_TYPES)
app.get('/api/integrations/trading/datasets', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    const querySchema = z.object({
      status: z.enum(['pending', 'approved', 'rejected', 'used']).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
      offset: z.coerce.number().int().min(0).optional(),
    });
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Query inválida', details: parsed.error.flatten() });
      return;
    }

    const limit = parsed.data.limit ?? 50;
    const offset = parsed.data.offset ?? 0;
    const whereClause = and(
      eq(schema.trainingData.tenantId, authContext.tenantId),
      inArray(schema.trainingData.sourceType, [...TRADING_SOURCE_TYPES]),
      parsed.data.status ? eq(schema.trainingData.status, parsed.data.status) : sql`1=1`
    );

    const db = getDatabase();
    const total = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.trainingData)
      .where(whereClause);

    const rows = await db.query.trainingData.findMany({
      where: whereClause,
      orderBy: [desc(schema.trainingData.criadoEm)],
      limit,
      offset,
    });

    res.json({
      success: true,
      data: rows.map(mapTrainingDataToTradingDatasetRow),
      total: Number(total[0]?.count ?? 0),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao listar datasets de trading');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/datasets/from-signal - Criar dataset a partir de sinal
app.post('/api/integrations/trading/datasets/from-signal', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    const bodySchema = z.object({
      signalId: z.string().uuid(),
      namespaceId: z.string().uuid(),
      reviewNotes: z.string().optional(),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
      return;
    }

    const db = getDatabase();
    const targetNamespace = await db.query.namespaces.findFirst({
      where: and(
        eq(schema.namespaces.id, parsed.data.namespaceId),
        eq(schema.namespaces.tenantId, authContext.tenantId),
        eq(schema.namespaces.ativo, true),
      ),
      columns: { id: true },
    });
    if (!targetNamespace) {
      res.status(403).json({ error: 'Namespace de destino não pertence ao tenant ou está inativo' });
      return;
    }

    const signal = await db.query.tradingSignals.findFirst({
      where: and(
        eq(schema.tradingSignals.id, parsed.data.signalId),
        eq(schema.tradingSignals.tenantId, authContext.tenantId)
      ),
    });
    if (!signal) {
      res.status(404).json({ error: 'Sinal não encontrado' });
      return;
    }

    const result = await createTradingDatasetFromSignalSource({
      authContext: { tenantId: authContext.tenantId, userId: authContext.userId },
      signal,
      namespaceId: targetNamespace.id,
      reviewNotes: parsed.data.reviewNotes,
    });

    res.json({
      success: true,
      data: result.dataset,
      meta: {
        created: result.created,
        status: result.status,
        qualityScore: result.qualityScore,
        duplicate: result.duplicate,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao criar dataset de trading');
    res.status(500).json({ error: errorMessage });
  }
});

// PATCH /api/integrations/trading/datasets/:id/review - Aprovar/rejeitar dataset (training_data)
app.patch('/api/integrations/trading/datasets/:id/review', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    const bodySchema = z.object({
      status: z.enum(['approved', 'rejected']),
      reviewNotes: z.string().optional(),
      namespaceId: z.string().uuid().optional().nullable(),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
      return;
    }

    const db = getDatabase();
    const existing = await db.query.trainingData.findFirst({
      where: and(
        eq(schema.trainingData.id, req.params.id),
        eq(schema.trainingData.tenantId, authContext.tenantId),
        inArray(schema.trainingData.sourceType, [...TRADING_SOURCE_TYPES])
      ),
      columns: { id: true, sourceMetadata: true },
    });
    if (!existing) {
      res.status(404).json({ error: 'Dataset não encontrado' });
      return;
    }

    let nextSourceMetadata = (existing.sourceMetadata as Record<string, unknown>) ?? {};
    if (parsed.data.namespaceId !== undefined) {
      if (parsed.data.namespaceId === null) {
        const { namespaceId: _n, ...rest } = nextSourceMetadata;
        nextSourceMetadata = rest;
      } else {
        const namespace = await db.query.namespaces.findFirst({
          where: and(
            eq(schema.namespaces.id, parsed.data.namespaceId),
            eq(schema.namespaces.tenantId, authContext.tenantId)
          ),
          columns: { id: true },
        });
        if (!namespace) {
          res.status(400).json({ error: 'Namespace inválido ou não pertence ao tenant' });
          return;
        }
        nextSourceMetadata = { ...nextSourceMetadata, namespaceId: parsed.data.namespaceId };
      }
    }

    const [updated] = await db.update(schema.trainingData)
      .set({
        status: parsed.data.status,
        reviewNotes: parsed.data.reviewNotes ?? null,
        reviewedBy: authContext.userId,
        reviewedAt: new Date(),
        sourceMetadata: nextSourceMetadata,
      })
      .where(and(
        eq(schema.trainingData.id, req.params.id),
        eq(schema.trainingData.tenantId, authContext.tenantId)
      ))
      .returning();

    if (!updated) {
      res.status(404).json({ error: 'Dataset não encontrado' });
      return;
    }

    res.json({ success: true, data: mapTrainingDataToTradingDatasetRow(updated) });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao revisar dataset de trading');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/signal-scheduler - Configuração do scheduler
app.get('/api/integrations/trading/signal-scheduler', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    const querySchema = z.object({
      marketType: z.enum(['futures', 'spot', 'margin']).optional(),
      type: z.enum(['futures', 'spot', 'margin']).optional(),
    });
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Query inválida', details: parsed.error.flatten() });
      return;
    }

    const marketType = resolveMarketTypeParam(parsed.data) ?? 'futures';
    const db = getDatabase();
    const whereClause = marketType
      ? and(
          eq(schema.tradingSignalSchedulers.tenantId, authContext.tenantId),
          eq(schema.tradingSignalSchedulers.marketType, marketType)
        )
      : eq(schema.tradingSignalSchedulers.tenantId, authContext.tenantId);

    const schedulers = await db
      .select()
      .from(schema.tradingSignalSchedulers)
      .where(whereClause)
      .orderBy(desc(schema.tradingSignalSchedulers.criadoEm));

    const data = schedulers.length > 0
      ? schedulers
      : [{
          tenantId: authContext.tenantId,
          marketType,
          marginMode: 'cross',
          intervalMinutes: 15,
          interval: '5m',
          symbols: [],
          maxSignalsPerRun: 1,
          techniques: DEFAULT_TRADING_TECHNIQUES,
          ensembleConfig: DEFAULT_TRADING_ENSEMBLE_CONFIG,
          arbitrageConfig: null,
          enabled: false,
          lastRunAt: null,
          nextRunAt: null,
          lastSuccessAt: null,
          lastSignalId: null,
          lastDurationMs: null,
          lastError: null,
        }];

    res.json({ success: true, data });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar scheduler de sinais');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/news-presets - Presets de notícias (SearXNG)
app.get('/api/integrations/trading/news-presets', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    const presets = await getDatabase().query.tradingNewsPresets.findMany({
      where: eq(schema.tradingNewsPresets.tenantId, authContext.tenantId),
      orderBy: [desc(schema.tradingNewsPresets.isDefault), asc(schema.tradingNewsPresets.name)],
    });

    res.json({ success: true, data: presets });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao listar presets de notícias');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/news-presets - Criar preset de notícias (SearXNG)
app.post('/api/integrations/trading/news-presets', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    const bodySchema = z.object({
      name: z.string().min(2).max(120),
      description: z.string().max(500).optional().nullable(),
      config: TradingProfileNewsConfigSchema,
      isDefault: z.boolean().optional(),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
      return;
    }

    const name = parsed.data.name.trim();
    if (!name) {
      res.status(400).json({ error: 'Nome do preset é obrigatório' });
      return;
    }

    const existing = await getDatabase().query.tradingNewsPresets.findFirst({
      where: and(
        eq(schema.tradingNewsPresets.tenantId, authContext.tenantId),
        eq(schema.tradingNewsPresets.name, name)
      ),
    });
    if (existing) {
      res.status(409).json({ error: 'Já existe um preset com esse nome' });
      return;
    }

    const normalizedConfig = normalizeTradingNewsConfig(parsed.data.config);
    const createdRows = await getDatabase()
      .insert(schema.tradingNewsPresets)
      .values({
        tenantId: authContext.tenantId,
        name,
        description: parsed.data.description?.trim() || null,
        config: normalizedConfig,
        isDefault: parsed.data.isDefault ?? false,
        createdBy: authContext.userId,
      })
      .returning();
    const created = createdRows[0];

    if (created?.isDefault) {
      await getDatabase()
        .update(schema.tradingNewsPresets)
        .set({ isDefault: false, atualizadoEm: new Date() })
        .where(and(
          eq(schema.tradingNewsPresets.tenantId, authContext.tenantId),
          not(eq(schema.tradingNewsPresets.id, created.id))
        ));
    }

    res.status(201).json({ success: true, data: created });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao criar preset de notícias');
    res.status(500).json({ error: errorMessage });
  }
});

// PUT /api/integrations/trading/news-presets/:id - Atualizar preset de notícias (SearXNG)
app.put('/api/integrations/trading/news-presets/:id', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    const bodySchema = z.object({
      name: z.string().min(2).max(120).optional(),
      description: z.string().max(500).optional().nullable(),
      config: TradingProfileNewsConfigSchema.optional(),
      isDefault: z.boolean().optional(),
    }).refine((data) => Object.keys(data).length > 0, {
      message: 'Nenhuma alteração enviada',
    });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
      return;
    }

    const preset = await getDatabase().query.tradingNewsPresets.findFirst({
      where: and(
        eq(schema.tradingNewsPresets.id, req.params.id),
        eq(schema.tradingNewsPresets.tenantId, authContext.tenantId)
      ),
    });
    if (!preset) {
      res.status(404).json({ error: 'Preset não encontrado' });
      return;
    }

    let name: string | undefined;
    if (parsed.data.name !== undefined) {
      name = parsed.data.name.trim();
      if (!name) {
        res.status(400).json({ error: 'Nome do preset é obrigatório' });
        return;
      }
      if (name !== preset.name) {
        const existing = await getDatabase().query.tradingNewsPresets.findFirst({
          where: and(
            eq(schema.tradingNewsPresets.tenantId, authContext.tenantId),
            eq(schema.tradingNewsPresets.name, name),
            not(eq(schema.tradingNewsPresets.id, preset.id))
          ),
        });
        if (existing) {
          res.status(409).json({ error: 'Já existe um preset com esse nome' });
          return;
        }
      }
    }

    const updatePayload: Partial<typeof schema.tradingNewsPresets.$inferInsert> = {
      atualizadoEm: new Date(),
    };
    if (name !== undefined) {
      updatePayload.name = name;
    }
    if (parsed.data.description !== undefined) {
      updatePayload.description = parsed.data.description?.trim() || null;
    }
    if (parsed.data.config !== undefined) {
      updatePayload.config = normalizeTradingNewsConfig(parsed.data.config);
    }
    if (parsed.data.isDefault !== undefined) {
      updatePayload.isDefault = parsed.data.isDefault;
    }

    const updatedRows = await getDatabase()
      .update(schema.tradingNewsPresets)
      .set(updatePayload)
      .where(eq(schema.tradingNewsPresets.id, preset.id))
      .returning();
    const updated = updatedRows[0];
    if (!updated) {
      const refreshed = await getDatabase().query.tradingNewsPresets.findFirst({
        where: and(
          eq(schema.tradingNewsPresets.id, preset.id),
          eq(schema.tradingNewsPresets.tenantId, authContext.tenantId)
        ),
      });
      if (!refreshed) {
        res.status(404).json({ error: 'Preset não encontrado' });
        return;
      }
      res.status(409).json({ error: 'Preset não pôde ser atualizado (conflito de concorrência)' });
      return;
    }

    if (updated?.isDefault) {
      await getDatabase()
        .update(schema.tradingNewsPresets)
        .set({ isDefault: false, atualizadoEm: new Date() })
        .where(and(
          eq(schema.tradingNewsPresets.tenantId, authContext.tenantId),
          not(eq(schema.tradingNewsPresets.id, updated.id))
        ));
    }

    res.json({ success: true, data: updated });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao atualizar preset de notícias');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/news-presets/:id - Remover preset de notícias (SearXNG)
app.delete('/api/integrations/trading/news-presets/:id', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    const preset = await getDatabase().query.tradingNewsPresets.findFirst({
      where: and(
        eq(schema.tradingNewsPresets.id, req.params.id),
        eq(schema.tradingNewsPresets.tenantId, authContext.tenantId)
      ),
    });
    if (!preset) {
      res.status(404).json({ error: 'Preset não encontrado' });
      return;
    }

    await getDatabase()
      .delete(schema.tradingNewsPresets)
      .where(eq(schema.tradingNewsPresets.id, preset.id));

    res.json({ success: true });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao remover preset de notícias');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/news-presets/apply - Aplicar preset em perfil
app.post('/api/integrations/trading/news-presets/apply', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    const bodySchema = z.object({
      presetId: z.string().uuid(),
      kind: z.enum(['analysis', 'signal']),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
      return;
    }

    const preset = await getDatabase().query.tradingNewsPresets.findFirst({
      where: and(
        eq(schema.tradingNewsPresets.id, parsed.data.presetId),
        eq(schema.tradingNewsPresets.tenantId, authContext.tenantId)
      ),
    });
    if (!preset) {
      res.status(404).json({ error: 'Preset não encontrado' });
      return;
    }

    const profileRow = await getOrCreateTradingProfile(authContext.tenantId, parsed.data.kind);
    const updated = await getDatabase()
      .update(schema.tradingAnalysisProfiles)
      .set({
        newsConfig: preset.config,
        atualizadoEm: new Date(),
      })
      .where(eq(schema.tradingAnalysisProfiles.id, profileRow.id))
      .returning();

    const updatedRow = updated[0] ?? profileRow;
    const profile = normalizeTradingProfile(updatedRow);

    res.json({
      success: true,
      data: {
        preset,
        profile: {
          id: updatedRow.id,
          kind: updatedRow.kind,
          name: updatedRow.name,
          timeframes: profile.timeframes,
          indicators: profile.indicators,
          dataSources: profile.dataSources,
          modelConfig: profile.modelConfig,
          newsConfig: profile.newsConfig,
          consensus: profile.consensus,
        },
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao aplicar preset de notícias');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/analysis-profile - Perfil multi-timeframe
app.get('/api/integrations/trading/analysis-profile', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    const querySchema = z.object({
      kind: z.enum(['analysis', 'signal']).optional().default('analysis'),
    });
    const parsedQuery = querySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      res.status(400).json({ error: 'Query inválida', details: parsedQuery.error.flatten() });
      return;
    }

    const profileRow = await getOrCreateTradingProfile(authContext.tenantId, parsedQuery.data.kind);
    const profile = normalizeTradingProfile(profileRow);

    res.json({
      success: true,
      data: {
        id: profileRow.id,
        kind: profileRow.kind,
        name: profileRow.name,
        timeframes: profile.timeframes,
        indicators: profile.indicators,
        dataSources: profile.dataSources,
        techniques: profile.techniques,
        ensembleConfig: profile.ensembleConfig,
        arbitrageConfig: profile.arbitrageConfig,
        modelConfig: profile.modelConfig,
        newsConfig: profile.newsConfig,
        consensus: profile.consensus,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter perfil de análise/sinal');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/arbitrage/catalog - Catálogo de arbitragem (exchanges, ativos e taxas)
app.get('/api/integrations/trading/arbitrage/catalog', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    const querySchema = z.object({
      marketType: z.enum(['spot', 'margin', 'futures']).optional().default('spot'),
      symbol: z.string().min(1).optional(),
      exchanges: z.string().optional(),
    });
    const parsedQuery = querySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      res.status(400).json({ error: 'Query inválida', details: parsedQuery.error.flatten() });
      return;
    }

    const marketType = parsedQuery.data.marketType;
    if (marketType === 'futures') {
      res.status(400).json({ error: 'Arbitragem triangular não suporta mercado Futures.' });
      return;
    }

    const requestedExchanges = parseListParam(parsedQuery.data.exchanges);
    const parsedExchanges = requestedExchanges.length > 0
      ? requestedExchanges.map((value) => TradingArbitrageExchangeSchema.parse(value))
      : (['kucoin'] as TradingArbitrageExchange[]);

    const spotSymbols = await kucoinSpotClient.getSpotSymbols();
    const symbolList = spotSymbols.map((item) => item.symbol).filter(Boolean);
    const resolvedSymbol = parsedQuery.data.symbol
      ? parsedQuery.data.symbol.trim().toUpperCase()
      : (symbolList[0] ?? '');
    if (!resolvedSymbol) {
      res.status(500).json({ error: 'Não foi possível determinar um símbolo para calcular taxa de trade.' });
      return;
    }

    const intermediateAssets = deriveIntermediateAssetsFromSymbols(symbolList);

    const { feePctByExchange, effectiveFeePct } = await resolveArbitrageFeePctForExchanges({
      exchanges: parsedExchanges,
      symbol: resolvedSymbol,
      marketType,
      tenantId: authContext.tenantId,
    });

    const networkFeesByAsset = await resolveNetworkFeesForTenant(authContext.tenantId);

    res.json({
      success: true,
      data: {
        exchanges: parsedExchanges.map((exchange) => ({
          id: exchange,
          label: ARBITRAGE_EXCHANGE_LABELS[exchange] ?? exchange,
        })),
        intermediateAssets,
        feePctByExchange,
        effectiveFeePct,
        networkFeesByAsset,
        updatedAt: new Date().toISOString(),
        sources: {
          feePct: 'kucoin_api',
          networkFees: 'kucoin_api',
        },
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter catálogo de arbitragem');
    res.status(500).json({ error: errorMessage });
  }
});

// PUT /api/integrations/trading/analysis-profile - Atualizar perfil multi-timeframe
app.put('/api/integrations/trading/analysis-profile', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    const bodySchema = z.object({
      kind: z.enum(['analysis', 'signal']).optional().default('analysis'),
      marketType: z.enum(['spot', 'margin', 'futures']).optional(),
      symbol: z.string().min(3).optional(),
      name: z.string().min(1).max(100).optional(),
      timeframes: z.array(TRADING_INTERVAL_ZOD).min(1).optional(),
      indicators: z.array(TRADING_INDICATOR_ZOD).min(1).optional(),
      dataSources: z.object({
        orderBook: z.boolean().optional(),
        news: z.boolean().optional(),
        trainingData: z.boolean().optional(),
      }).optional(),
      techniques: z.array(TRADING_TECHNIQUE_ZOD).min(1).optional(),
      ensembleConfig: TradingEnsembleConfigSchema.optional(),
      arbitrageConfig: TradingArbitrageConfigSchema.optional().nullable(),
      newsConfig: z.object({
        engines: z.array(z.string().min(1)).optional(),
        categories: z.string().min(1).optional(),
        language: z.string().min(2).optional(),
        safesearch: z.string().min(1).optional(),
        timeRange: z.enum(['last_hour', 'last_24_hours', 'custom', 'day', 'week', 'month', 'year']).optional(),
        dateFrom: z.string().min(10).optional(),
        dateTo: z.string().min(10).optional(),
        queryTemplates: z.array(z.string().min(3)).optional(),
        extraTerms: z.array(z.string().min(1)).optional(),
        maxResults: z.number().int().min(1).max(10).optional(),
      }).optional(),
      modelConfig: z.object({
        temperature: z.number().min(0).max(2).optional(),
        maxTokens: z.number().min(256).max(4096).optional(),
      }).optional(),
      consensus: z.object({
        rule: z.literal('majority').optional(),
        minAgree: z.number().min(1).optional().nullable(),
      }).optional(),
    });
    const parsedBody = bodySchema.safeParse(req.body);
    if (!parsedBody.success) {
      logger.warn({ zodErrors: parsedBody.error.flatten(), bodyKeys: Object.keys(req.body ?? {}) }, 'Validação Zod falhou no perfil de análise/sinal');
      res.status(400).json({ error: 'Dados inválidos', details: parsedBody.error.flatten() });
      return;
    }

    const profileRow = await getOrCreateTradingProfile(authContext.tenantId, parsedBody.data.kind);
    const consensusUpdate = parsedBody.data.consensus
      ? { rule: 'majority' as const, minAgree: parsedBody.data.consensus.minAgree ?? undefined }
      : undefined;
    const resolvedTimeframes = (parsedBody.data.timeframes ?? profileRow.timeframes) as TradingIntervalValue[];
    const resolvedTechniques = normalizeTradingTechniques(parsedBody.data.techniques ?? (profileRow.techniques as TradingTechnique[] | null));
    const resolvedEnsemble = normalizeTradingEnsembleConfig(parsedBody.data.ensembleConfig ?? (profileRow.ensembleConfig as TradingEnsembleConfig | null));
    const resolvedArbitrage = normalizeTradingArbitrageConfig(
      parsedBody.data.arbitrageConfig ?? (profileRow.arbitrageConfig as TradingArbitrageConfig | null)
    );
    const marketTypeForFees = parsedBody.data.marketType ?? 'spot';
    assertArbitrageConfigForTechniques({
      techniques: resolvedTechniques,
      arbitrageConfig: resolvedArbitrage,
      timeframes: resolvedTimeframes,
      context: 'perfil de análise/sinal',
    });
    if (resolvedTechniques.includes('arbitrage_triangular') && resolvedArbitrage && marketTypeForFees === 'futures') {
      res.status(400).json({ error: 'Arbitragem triangular não é suportada em mercado futures.' });
      return;
    }

    let arbitrageConfigToPersist = resolvedArbitrage;
    if (resolvedArbitrage) {
      const feeSymbol = parsedBody.data.symbol
        ? parsedBody.data.symbol.trim().toUpperCase()
        : await resolveDefaultSymbolForMarketType({
          auth: { tenantId: authContext.tenantId, userId: authContext.userId },
          marketType: marketTypeForFees,
        });
      const { effectiveFeePct } = await resolveArbitrageFeePctForExchanges({
        exchanges: resolvedArbitrage.exchanges,
        symbol: feeSymbol,
        marketType: marketTypeForFees,
        tenantId: authContext.tenantId,
      });
      arbitrageConfigToPersist = {
        ...resolvedArbitrage,
        feePct: effectiveFeePct,
      };
    }

    const updated = await getDatabase()
      .update(schema.tradingAnalysisProfiles)
      .set({
        name: parsedBody.data.name ?? profileRow.name,
        timeframes: resolvedTimeframes,
        indicators: parsedBody.data.indicators ?? profileRow.indicators,
        dataSources: parsedBody.data.dataSources ?? profileRow.dataSources,
        techniques: resolvedTechniques,
        ensembleConfig: resolvedEnsemble,
        arbitrageConfig: arbitrageConfigToPersist ?? null,
        modelConfig: parsedBody.data.modelConfig ?? profileRow.modelConfig,
        newsConfig: parsedBody.data.newsConfig ?? profileRow.newsConfig,
        consensus: consensusUpdate ?? profileRow.consensus,
        atualizadoEm: new Date(),
      })
      .where(eq(schema.tradingAnalysisProfiles.id, profileRow.id))
      .returning();

    const updatedRow = updated[0] ?? profileRow;
    const profile = normalizeTradingProfile(updatedRow);

    res.json({
      success: true,
      data: {
        id: updatedRow.id,
        kind: updatedRow.kind,
        name: updatedRow.name,
        timeframes: profile.timeframes,
        indicators: profile.indicators,
        dataSources: profile.dataSources,
        techniques: profile.techniques,
        ensembleConfig: profile.ensembleConfig,
        arbitrageConfig: profile.arbitrageConfig,
        modelConfig: profile.modelConfig,
        newsConfig: profile.newsConfig,
        consensus: profile.consensus,
      },
    });
  } catch (error) {
    if (error instanceof TradingConfigError) {
      res.status(400).json({ error: error.message });
      return;
    }
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao atualizar perfil de análise/sinal');
    res.status(500).json({ error: errorMessage });
  }
});

// PUT /api/integrations/trading/signal-scheduler - Atualizar configuração
app.put('/api/integrations/trading/signal-scheduler', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    const schedulerSchema = z.object({
      marketType: z.enum(['futures', 'spot', 'margin']),
      marginMode: z.enum(['cross', 'isolated']).optional(),
      intervalMinutes: z.number().int().min(1).max(1440),
      interval: TRADING_INTERVAL_ZOD,
      symbols: z.array(z.string().min(2).max(30)).max(50).optional(),
      enabled: z.boolean(),
      maxSignalsPerRun: z.number().int().min(1).max(20).optional(),
      agentId: z.string().uuid().optional(),
      techniques: z.array(TRADING_TECHNIQUE_ZOD).min(1).optional(),
      ensembleConfig: TradingEnsembleConfigSchema.optional(),
      arbitrageConfig: TradingArbitrageConfigSchema.optional().nullable(),
    });

    const parsed = schedulerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
      return;
    }

    const normalizedSymbols = normalizeSignalSymbols(parsed.data.symbols ?? []);
    if (parsed.data.enabled && normalizedSymbols.length === 0) {
      res.status(400).json({ error: 'Informe ao menos um símbolo para habilitar o scheduler.' });
      return;
    }

    if (parsed.data.marketType === 'spot' && !kucoinSpotClient.isSpotConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    if (parsed.data.marketType === 'margin' && !kucoinMarginClient.isMarginConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    if (parsed.data.marketType === 'futures' && !kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }

    const resolvedTechniques = parsed.data.techniques ?? [];
    if (resolvedTechniques.includes('arbitrage_triangular') && parsed.data.marketType === 'futures') {
      res.status(400).json({ error: 'Arbitragem triangular não é suportada em mercado futures.' });
      return;
    }
    if (resolvedTechniques.includes('arbitrage_triangular') && !parsed.data.arbitrageConfig) {
      res.status(400).json({ error: 'Configuração de arbitragem é obrigatória quando a técnica está habilitada.' });
      return;
    }
    if (resolvedTechniques.length > 0) {
      assertArbitrageConfigForTechniques({
        techniques: resolvedTechniques,
        arbitrageConfig: parsed.data.arbitrageConfig ?? undefined,
        timeframes: [parsed.data.interval],
        context: 'scheduler de sinais',
      });
    }

    const tradingAuth = { tenantId: authContext.tenantId, userId: authContext.userId };
    for (const symbol of normalizedSymbols) {
      await kucoinService.resolveTradingSymbolStrict(
        tradingAuth,
        symbol,
        parsed.data.marketType,
        parsed.data.marginMode
      );
    }

    let namespaceId: string | null = null;
    if (parsed.data.agentId) {
      const agent = await getDatabase().query.agents.findFirst({
        where: and(
          eq(schema.agents.id, parsed.data.agentId),
          eq(schema.agents.tenantId, authContext.tenantId),
          eq(schema.agents.status, 'active')
        ),
      });
      if (!agent) {
        res.status(400).json({ error: 'Agente informado não encontrado ou inativo.' });
        return;
      }
      namespaceId = agent.namespaceId ?? null;
    }

    const now = new Date();
    const nextRunAt = parsed.data.enabled
      ? new Date(now.getTime() + parsed.data.intervalMinutes * 60 * 1000)
      : null;
    const techniques = parsed.data.techniques ?? null;
    const ensembleConfig = parsed.data.ensembleConfig ?? null;
    const arbitrageConfig = parsed.data.arbitrageConfig ?? null;

    const db = getDatabase();
    const [saved] = await db
      .insert(schema.tradingSignalSchedulers)
      .values({
        tenantId: authContext.tenantId,
        agentId: parsed.data.agentId ?? null,
        namespaceId,
        marketType: parsed.data.marketType,
        marginMode: parsed.data.marginMode ?? null,
        intervalMinutes: parsed.data.intervalMinutes,
        interval: parsed.data.interval,
        symbols: normalizedSymbols,
        enabled: parsed.data.enabled,
        maxSignalsPerRun: parsed.data.maxSignalsPerRun ?? 1,
        techniques,
        ensembleConfig,
        arbitrageConfig,
        nextRunAt,
        atualizadoEm: now,
      })
      .onConflictDoUpdate({
        target: [schema.tradingSignalSchedulers.tenantId, schema.tradingSignalSchedulers.marketType],
        set: {
          agentId: parsed.data.agentId ?? null,
          namespaceId,
          marginMode: parsed.data.marginMode ?? null,
          intervalMinutes: parsed.data.intervalMinutes,
          interval: parsed.data.interval,
          symbols: normalizedSymbols,
          enabled: parsed.data.enabled,
          maxSignalsPerRun: parsed.data.maxSignalsPerRun ?? 1,
          techniques,
          ensembleConfig,
          arbitrageConfig,
          nextRunAt,
          atualizadoEm: now,
        },
      })
      .returning();

    res.json({ success: true, data: saved });
  } catch (error) {
    if (error instanceof TradingConfigError) {
      res.status(400).json({ error: error.message });
      return;
    }
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao atualizar scheduler de sinais');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/analysis-scheduler - Configuração do scheduler da análise
app.get('/api/integrations/trading/analysis-scheduler', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    const querySchema = z.object({
      marketType: z.enum(['futures', 'spot', 'margin']).optional(),
      type: z.enum(['futures', 'spot', 'margin']).optional(),
    });
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Query inválida', details: parsed.error.flatten() });
      return;
    }

    const marketType = resolveMarketTypeParam(parsed.data) ?? 'futures';
    const db = getDatabase();
    const whereClause = marketType
      ? and(
          eq(schema.tradingAnalysisSchedulers.tenantId, authContext.tenantId),
          eq(schema.tradingAnalysisSchedulers.marketType, marketType)
        )
      : eq(schema.tradingAnalysisSchedulers.tenantId, authContext.tenantId);

    const schedulers = await db
      .select()
      .from(schema.tradingAnalysisSchedulers)
      .where(whereClause)
      .orderBy(desc(schema.tradingAnalysisSchedulers.criadoEm));

    const data = schedulers.length > 0
      ? schedulers
      : [{
          tenantId: authContext.tenantId,
          marketType,
          marginMode: 'cross',
          intervalMinutes: 15,
          interval: '5m',
          symbols: [],
          maxSymbolsPerRun: 1,
          techniques: DEFAULT_TRADING_TECHNIQUES,
          ensembleConfig: DEFAULT_TRADING_ENSEMBLE_CONFIG,
          arbitrageConfig: null,
          enabled: false,
          lastRunAt: null,
          nextRunAt: null,
          lastSuccessAt: null,
          lastIndicatorId: null,
          lastDurationMs: null,
          lastError: null,
        }];

    res.json({ success: true, data });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar scheduler de análise');
    res.status(500).json({ error: errorMessage });
  }
});

// PUT /api/integrations/trading/analysis-scheduler - Atualizar configuração
app.put('/api/integrations/trading/analysis-scheduler', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    const schedulerSchema = z.object({
      marketType: z.enum(['futures', 'spot', 'margin']),
      marginMode: z.enum(['cross', 'isolated']).optional(),
      intervalMinutes: z.number().int().min(1).max(1440),
      interval: TRADING_INTERVAL_ZOD,
      symbols: z.array(z.string().min(2).max(30)).max(50).optional(),
      enabled: z.boolean(),
      maxSymbolsPerRun: z.number().int().min(1).max(50).optional(),
      techniques: z.array(TRADING_TECHNIQUE_ZOD).min(1).optional(),
      ensembleConfig: TradingEnsembleConfigSchema.optional(),
      arbitrageConfig: TradingArbitrageConfigSchema.optional().nullable(),
    });

    const parsed = schedulerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
      return;
    }

    const normalizedSymbols = normalizeSignalSymbols(parsed.data.symbols ?? []);
    if (parsed.data.enabled && normalizedSymbols.length === 0) {
      res.status(400).json({ error: 'Informe ao menos um símbolo para habilitar o scheduler.' });
      return;
    }

    if (parsed.data.marketType === 'spot' && !kucoinSpotClient.isSpotConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    if (parsed.data.marketType === 'margin' && !kucoinMarginClient.isMarginConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    if (parsed.data.marketType === 'futures' && !kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }

    const resolvedTechniques = parsed.data.techniques ?? [];
    if (resolvedTechniques.includes('arbitrage_triangular') && parsed.data.marketType === 'futures') {
      res.status(400).json({ error: 'Arbitragem triangular não é suportada em mercado futures.' });
      return;
    }
    if (resolvedTechniques.includes('arbitrage_triangular') && !parsed.data.arbitrageConfig) {
      res.status(400).json({ error: 'Configuração de arbitragem é obrigatória quando a técnica está habilitada.' });
      return;
    }
    if (resolvedTechniques.length > 0) {
      assertArbitrageConfigForTechniques({
        techniques: resolvedTechniques,
        arbitrageConfig: parsed.data.arbitrageConfig ?? undefined,
        timeframes: [parsed.data.interval],
        context: 'scheduler de análise',
      });
    }

    const tradingAuth = { tenantId: authContext.tenantId, userId: authContext.userId };
    for (const symbol of normalizedSymbols) {
      await kucoinService.resolveTradingSymbolStrict(
        tradingAuth,
        symbol,
        parsed.data.marketType,
        parsed.data.marginMode
      );
    }

    const now = new Date();
    const nextRunAt = parsed.data.enabled
      ? new Date(now.getTime() + parsed.data.intervalMinutes * 60 * 1000)
      : null;
    const techniques = parsed.data.techniques ?? null;
    const ensembleConfig = parsed.data.ensembleConfig ?? null;
    const arbitrageConfig = parsed.data.arbitrageConfig ?? null;

    const db = getDatabase();
    const [saved] = await db
      .insert(schema.tradingAnalysisSchedulers)
      .values({
        tenantId: authContext.tenantId,
        marketType: parsed.data.marketType,
        marginMode: parsed.data.marginMode ?? null,
        intervalMinutes: parsed.data.intervalMinutes,
        interval: parsed.data.interval,
        symbols: normalizedSymbols,
        enabled: parsed.data.enabled,
        maxSymbolsPerRun: parsed.data.maxSymbolsPerRun ?? 1,
        techniques,
        ensembleConfig,
        arbitrageConfig,
        nextRunAt,
        atualizadoEm: now,
      })
      .onConflictDoUpdate({
        target: [schema.tradingAnalysisSchedulers.tenantId, schema.tradingAnalysisSchedulers.marketType],
        set: {
          marginMode: parsed.data.marginMode ?? null,
          intervalMinutes: parsed.data.intervalMinutes,
          interval: parsed.data.interval,
          symbols: normalizedSymbols,
          enabled: parsed.data.enabled,
          maxSymbolsPerRun: parsed.data.maxSymbolsPerRun ?? 1,
          techniques,
          ensembleConfig,
          arbitrageConfig,
          nextRunAt,
          atualizadoEm: now,
        },
      })
      .returning();

    res.json({ success: true, data: saved });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao atualizar scheduler de análise');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/stop-orders - Listar ordens stop abertas
app.get('/api/integrations/trading/stop-orders', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }
    const tradingAuth = { tenantId: authContext.tenantId, userId: authContext.userId };

    const querySchema = z.object({
      symbol: z.string().optional(),
      marketType: z.enum(['futures', 'spot', 'margin']).optional(),
      marginMode: z.enum(['cross', 'isolated']).optional(),
    });
    const queryResult = querySchema.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
      return;
    }

    const { symbol: symbolParam, marketType, marginMode } = queryResult.data;
    if (marketType === 'spot' && !kucoinSpotClient.isSpotConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    if (marketType === 'margin' && !kucoinMarginClient.isMarginConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    if (!marketType || marketType === 'futures') {
      if (!kucoinClient.isKucoinConfigured()) {
        respondKucoinNotConfigured(res);
        return;
      }
    }

    const resolvedSymbol = symbolParam
      ? await resolveTradingSymbolOrRespond(res, tradingAuth, symbolParam, { required: true, marketType, marginMode })
      : await kucoinService.resolveTradingSymbol(tradingAuth, undefined, marketType, marginMode);
    if (!resolvedSymbol) return;

    const result = await kucoinService.getOpenStopOrders(tradingAuth, resolvedSymbol, marketType, marginMode);

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao listar ordens stop');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/stop-orders/:id - Cancelar ordem stop
app.delete('/api/integrations/trading/stop-orders/:id', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    const orderIdSchema = z.object({ id: z.string().min(1) });
    const paramResult = orderIdSchema.safeParse(req.params);
    if (!paramResult.success) {
      res.status(400).json({ error: 'ID de ordem inválido' });
      return;
    }

    const querySchema = z.object({
      marketType: z.enum(['futures', 'spot', 'margin']).optional(),
      marginMode: z.enum(['cross', 'isolated']).optional(),
    });
    const queryResult = querySchema.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
      return;
    }
    const { marketType, marginMode } = queryResult.data;
    if (marketType === 'spot' && !kucoinSpotClient.isSpotConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    if (marketType === 'margin' && !kucoinMarginClient.isMarginConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    if (!marketType || marketType === 'futures') {
      if (!kucoinClient.isKucoinConfigured()) {
        respondKucoinNotConfigured(res);
        return;
      }
    }

    const result = await kucoinService.cancelStopOrder(
      { tenantId: authContext.tenantId, userId: authContext.userId },
      paramResult.data.id,
      marketType,
      marginMode
    );

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar ordem stop');
    res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// TRADING: DADOS DE MERCADO ADICIONAIS (17/12/2025)
// Klines, Order Book, Funding Rate, Mark Price, Trade History
// ============================================================================

async function handleTradingKlinesRequest(
  req: Request,
  res: Response,
  symbol: string | undefined,
  required = true
): Promise<void> {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }
    const tradingAuth = { tenantId: authContext.tenantId, userId: authContext.userId };

    const defaultInterval = tradingIntervalEnum.enumValues[0];
    const defaultGranularity = defaultInterval ? parseTradingIntervalToMinutes(defaultInterval) : null;
    const allowedGranularities = getAllowedGranularitiesMinutes();
    if (!defaultGranularity) {
      throw new Error('Intervalo padrão inválido para klines');
    }

    const querySchema = z.object({
      granularity: z.coerce.number().int().optional(),
      from: z.coerce.number().int().optional(),
      to: z.coerce.number().int().optional(),
      marketType: z.enum(['futures', 'spot', 'margin']).optional(),
      type: z.enum(['futures', 'spot', 'margin']).optional(),
      marginMode: z.enum(['cross', 'isolated']).optional(),
    }).superRefine((data, ctx) => {
      const granularity = data.granularity ?? defaultGranularity;
      if (!allowedGranularities.includes(granularity)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `granularity inválido. Valores permitidos (minutos): ${allowedGranularities.join(', ')}`,
          path: ['granularity'],
        });
      }
      if (data.from !== undefined && data.to !== undefined && data.from > data.to) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: '"from" deve ser <= "to".',
          path: ['from'],
        });
      }
      if (data.from !== undefined && data.to !== undefined) {
        const intervalMs = granularity * 60 * 1000;
        const points = Math.floor((data.to - data.from) / intervalMs) + 1;
        if (points > 500) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Intervalo excede o limite de 500 klines por requisição. Divida o período.',
            path: ['from'],
          });
        }
      }
    });

    const queryResult = querySchema.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
      return;
    }

    const granularity = queryResult.data.granularity ?? defaultGranularity;
    const from = queryResult.data.from;
    const to = queryResult.data.to;
    const marketType = resolveMarketTypeParam(queryResult.data);
    const marginMode = queryResult.data.marginMode;

    if (marketType === 'spot' && !kucoinSpotClient.isSpotConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    if (marketType === 'margin' && !kucoinMarginClient.isMarginConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    if (!marketType || marketType === 'futures') {
      if (!kucoinClient.isKucoinConfigured()) {
        respondKucoinNotConfigured(res);
        return;
      }
    }

    const resolvedSymbol = await resolveTradingSymbolOrRespond(res, tradingAuth, symbol, { required, marketType, marginMode });
    if (!resolvedSymbol) return;

    const klines = marketType === 'spot' || marketType === 'margin'
      ? await kucoinSpotClient.getSpotKlines(
          resolvedSymbol,
          `${granularity}min`,
          from ? Math.floor(from / 1000) : undefined,
          to ? Math.floor(to / 1000) : undefined
        )
      : await kucoinClient.getKlines(resolvedSymbol, granularity, from, to);

    res.json({
      success: true,
      data: klines,
      symbol: resolvedSymbol,
      granularity,
      interval: kucoinClient.granularityToInterval(granularity),
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter klines');
    res.status(500).json({ error: errorMessage });
  }
}

// GET /api/integrations/trading/klines/:symbol - Dados de candles
app.get('/api/integrations/trading/klines/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  await handleTradingKlinesRequest(req, res, req.params.symbol, true);
});

// GET /api/integrations/trading/klines?symbol= - Compatibilidade com frontend legado
app.get('/api/integrations/trading/klines', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  const symbol = resolveSymbolFromQuery(req);
  await handleTradingKlinesRequest(req, res, symbol, false);
});

async function handleTradingOrderBookRequest(
  req: Request,
  res: Response,
  symbol: string | undefined,
  required = true
): Promise<void> {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }
    const tradingAuth = { tenantId: authContext.tenantId, userId: authContext.userId };

    const defaultDepth = resolveKucoinRestOrderBookDepth();
    const querySchema = z.object({
      depth: z.coerce.number().int().optional(),
      marketType: z.enum(['futures', 'spot', 'margin']).optional(),
      type: z.enum(['futures', 'spot', 'margin']).optional(),
      marginMode: z.enum(['cross', 'isolated']).optional(),
    }).superRefine((data, ctx) => {
      const depth = data.depth ?? defaultDepth;
      if (!KUCOIN_REST_ORDERBOOK_DEPTHS.includes(depth as (typeof KUCOIN_REST_ORDERBOOK_DEPTHS)[number])) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'depth inválido. Valores permitidos: 20.',
          path: ['depth'],
        });
      }
    });

    const queryResult = querySchema.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
      return;
    }

    const depth = (queryResult.data.depth ?? defaultDepth) as 20;
    const marketType = resolveMarketTypeParam(queryResult.data);
    const marginMode = queryResult.data.marginMode;

    if (marketType === 'spot' && !kucoinSpotClient.isSpotConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    if (marketType === 'margin' && !kucoinMarginClient.isMarginConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    if (!marketType || marketType === 'futures') {
      if (!kucoinClient.isKucoinConfigured()) {
        respondKucoinNotConfigured(res);
        return;
      }
    }

    const resolvedSymbol = await resolveTradingSymbolOrRespond(res, tradingAuth, symbol, { required, marketType, marginMode });
    if (!resolvedSymbol) return;

    const orderbook = marketType === 'spot' || marketType === 'margin'
      ? await kucoinSpotClient.getSpotOrderBook(resolvedSymbol)
      : await kucoinClient.getOrderBook(resolvedSymbol, depth);

    res.json({
      success: true,
      data: orderbook,
      symbol: resolvedSymbol,
      depth,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter order book');
    res.status(500).json({ error: errorMessage });
  }
}

// GET /api/integrations/trading/orderbook/:symbol - Order Book
app.get('/api/integrations/trading/orderbook/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  await handleTradingOrderBookRequest(req, res, req.params.symbol, true);
});

// GET /api/integrations/trading/orderbook?symbol= - Compatibilidade com frontend legado
app.get('/api/integrations/trading/orderbook', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  const symbol = resolveSymbolFromQuery(req);
  await handleTradingOrderBookRequest(req, res, symbol, false);
});

// GET /api/integrations/trading/funding-rate/:symbol - Funding Rate
app.get('/api/integrations/trading/funding-rate/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }
    const tradingAuth = { tenantId: authContext.tenantId, userId: authContext.userId };

    const { symbol } = req.params;

    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }

    const resolvedSymbol = await resolveTradingSymbolOrRespond(res, tradingAuth, symbol, { required: true });
    if (!resolvedSymbol) return;

    const fundingRate = await kucoinClient.getCurrentFundingRate(resolvedSymbol);

    res.json({
      success: true,
      data: fundingRate,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter funding rate');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/mark-price/:symbol - Mark Price
app.get('/api/integrations/trading/mark-price/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }
    const tradingAuth = { tenantId: authContext.tenantId, userId: authContext.userId };

    const { symbol } = req.params;

    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }

    const resolvedSymbol = await resolveTradingSymbolOrRespond(res, tradingAuth, symbol, { required: true });
    if (!resolvedSymbol) return;

    const markPrice = await kucoinClient.getMarkPrice(resolvedSymbol);

    res.json({
      success: true,
      data: markPrice,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter mark price');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/trades/:symbol - Histórico de Trades (Futures + Spot + Margin)
app.get('/api/integrations/trading/trades/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }
    const tradingAuth = { tenantId: authContext.tenantId, userId: authContext.userId };

    const { symbol } = req.params;
    const marketType = (req.query.marketType as string) || 'futures';

    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }

    const resolvedSymbol = await resolveTradingSymbolOrRespond(res, tradingAuth, symbol, { required: true });
    if (!resolvedSymbol) return;

    const trades = marketType === 'spot' || marketType === 'margin'
      ? await kucoinSpotClient.getSpotTrades(resolvedSymbol)
      : await kucoinClient.getTradeHistory(resolvedSymbol);

    res.json({
      success: true,
      data: trades,
      symbol: resolvedSymbol,
      marketType,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter histórico de trades');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/orders/history - Histórico de Ordens
app.get('/api/integrations/trading/orders/history', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }
    const querySchema = z.object({
      symbol: z.string().optional(),
      marketType: z.enum(['futures', 'spot', 'margin']).optional(),
      status: z.enum(['pending_review', 'review_rejected', 'pending', 'submitted', 'open', 'filled', 'cancelled', 'rejected', 'expired', 'error']).optional(),
      side: z.enum(['buy', 'sell']).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
      cursor: z.string().datetime().optional(),
    });
    const queryResult = querySchema.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
      return;
    }

    const symbolParam = queryResult.data.symbol;
    const resolvedSymbol = symbolParam
      ? await resolveTradingSymbolOrRespond(res, { tenantId: authContext.tenantId, userId: authContext.userId }, symbolParam, { required: true })
      : undefined;
    if (symbolParam && !resolvedSymbol) return;

    const limit = queryResult.data.limit ?? 50;
    const cursorDate = queryResult.data.cursor ? new Date(queryResult.data.cursor) : null;
    const marketType = queryResult.data.marketType ?? undefined;
    const status = queryResult.data.status ?? undefined;
    const side = queryResult.data.side ?? undefined;

    const conditions = [eq(schema.tradingOrders.tenantId, authContext.tenantId)];
    if (resolvedSymbol) conditions.push(eq(schema.tradingOrders.symbol, resolvedSymbol));
    if (marketType) conditions.push(eq(schema.tradingOrders.marketType, marketType));
    if (status) conditions.push(eq(schema.tradingOrders.status, status));
    if (side) conditions.push(eq(schema.tradingOrders.side, side));
    if (cursorDate) conditions.push(lt(schema.tradingOrders.criadoEm, cursorDate));
    conditions.push(buildNotDeletedMetadataCondition(schema.tradingOrders.metadata));

    const db = getDatabase();
    const history = await db
      .select()
      .from(schema.tradingOrders)
      .where(and(...conditions))
      .orderBy(desc(schema.tradingOrders.criadoEm))
      .limit(limit);

    const nextCursor = history.length > 0
      ? history[history.length - 1]?.criadoEm?.toISOString() ?? null
      : null;

    res.json({
      success: true,
      data: history,
      nextCursor,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter histórico de ordens');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/orders/history/delete - Exclusão lógica de ordens
app.post('/api/integrations/trading/orders/history/delete', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }
    const bodySchema = z.object({
      ids: z.array(z.string().uuid()).optional(),
      all: z.boolean().optional(),
      scope: z.enum(['self', 'tenant']).optional(),
    });
    const bodyResult = bodySchema.safeParse(req.body ?? {});
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Dados inválidos', details: bodyResult.error.flatten() });
      return;
    }
    const { ids, all, scope } = bodyResult.data;
    if (!ids?.length && !all) {
      res.status(400).json({ error: 'Informe ids ou use all=true para excluir.' });
      return;
    }

    const isAdmin = await isAdminUser(authContext);
    const effectiveScope = scope === 'tenant' && isAdmin ? 'tenant' : 'self';
    if (scope === 'tenant' && !isAdmin) {
      res.status(403).json({ error: 'Apenas administradores podem excluir histórico de todo o tenant.' });
      return;
    }

    const conditions = [eq(schema.tradingOrders.tenantId, authContext.tenantId)];
    if (effectiveScope === 'self') {
      conditions.push(buildOwnerMetadataCondition(schema.tradingOrders.metadata, authContext.userId));
    }
    if (ids?.length) {
      conditions.push(inArray(schema.tradingOrders.id, ids));
    }

    const deletedAt = new Date().toISOString();
    const db = getDatabase();
    const updateResult = await db
      .update(schema.tradingOrders)
      .set({
        metadata: buildSoftDeleteMetadataUpdate(schema.tradingOrders.metadata, deletedAt, authContext.userId),
      })
      .where(and(...conditions));

    res.json({
      success: true,
      data: { deletedAt, scope: effectiveScope },
      updated: updateResult.rowCount ?? 0,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao excluir histórico de ordens');
    res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// TRADING CONTROL ENDPOINTS (Handover/Takeover - 17/12/2025)
// Endpoints para gerenciar controle entre Alice (IA) e operador manual
// Regra 6 - SEM MOCKS: Persistência real em PostgreSQL
// ============================================================================

// GET /api/integrations/trading/control-history - Histórico de handover/takeover
app.get('/api/integrations/trading/control-history', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    const querySchema = z.object({
      limit: z.coerce.number().int().min(1).max(200).optional(),
    });
    const queryResult = querySchema.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
      return;
    }

    const limit = queryResult.data.limit ?? 50;
    const db = getDatabase();

    // Buscar histórico de controle ordenado por data descendente
    const history = await db
      .select()
      .from(schema.tradingControlHistory)
      .where(eq(schema.tradingControlHistory.tenantId, authContext.tenantId))
      .orderBy(desc(schema.tradingControlHistory.criadoEm))
      .limit(limit);

    // Mapear para formato esperado pelo frontend
    const formattedHistory = history.map(entry => ({
      id: entry.id,
      previousMode: entry.previousMode,
      newMode: entry.newMode,
      changedBy: entry.changedBy,
      reason: entry.reason,
      source: (entry.metadata as Record<string, unknown>)?.source || 'unknown',
      createdAt: entry.criadoEm?.toISOString() || new Date().toISOString(),
    }));

    res.json({
      success: true,
      data: formattedHistory,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter histórico de controle de trading');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/control - Mudar modo de controle (handover/takeover)
app.post('/api/integrations/trading/control', requirePermission('integrations:trading:manage'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    // Validar body da requisição
    const controlSchema = z.object({
      mode: z.enum(['alice', 'manual']).optional(),
      action: z.enum(['takeover', 'handback']).optional(),
      reason: z.string().max(500).optional(),
      source: z.string().max(50).optional(),
    }).superRefine((data, ctx) => {
      if (!data.mode && !data.action) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'mode ou action é obrigatório',
          path: ['mode'],
        });
        return;
      }
      if (data.mode && data.action) {
        const expectedMode = data.action === 'takeover' ? 'manual' : 'alice';
        if (data.mode !== expectedMode) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `mode e action conflitantes. Para action=${data.action}, mode deve ser ${expectedMode}.`,
            path: ['action'],
          });
        }
      }
    });

    const parsed = controlSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Dados inválidos',
        details: parsed.error.errors,
      });
      return;
    }

    const requestedMode = parsed.data.mode
      ?? (parsed.data.action === 'takeover' ? 'manual' : 'alice');
    if (requestedMode === 'alice') {
      res.status(400).json({ error: 'Auto-execução de sinais está desativada para este tenant.' });
      return;
    }
    const action = parsed.data.action ?? 'takeover';
    const { reason, source } = parsed.data;
    const db = getDatabase();

    // Buscar configuração atual de risco para determinar modo anterior
    const [currentConfig] = await db
      .select()
      .from(schema.tradingRiskConfig)
      .where(eq(schema.tradingRiskConfig.tenantId, authContext.tenantId))
      .limit(1);

    if (!currentConfig) {
      res.status(404).json({ error: 'Configuração de trading não encontrada para este tenant' });
      return;
    }

    // Determinar modo anterior
    const previousMode = currentConfig.autoExecuteSignals ? 'alice' : 'manual';

    // Se já está no modo solicitado, retornar sem alteração
    if (previousMode === requestedMode) {
      res.json({
        success: true,
        data: {
          previousMode,
          newMode: requestedMode,
          action,
          message: `Trading já está em modo ${requestedMode}`,
          changed: false,
        },
      });
      return;
    }

    // Atualizar configuração de risco para refletir novo modo
    await db
      .update(schema.tradingRiskConfig)
      .set({
        autoExecuteSignals: false,
        atualizadoEm: new Date(),
      })
      .where(eq(schema.tradingRiskConfig.tenantId, authContext.tenantId));

    // Registrar mudança no histórico
    const [historyEntry] = await db
      .insert(schema.tradingControlHistory)
      .values({
        tenantId: authContext.tenantId,
        previousMode,
        newMode: requestedMode,
        changedBy: authContext.userId,
        reason: reason || 'Takeover manual solicitado',
        metadata: {
          source: source || 'api',
          timestamp: new Date().toISOString(),
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
        },
      })
      .returning();

    logger.info({
      tenantId: authContext.tenantId,
      userId: authContext.userId,
      previousMode,
      newMode: requestedMode,
      reason,
      historyId: historyEntry?.id,
    }, 'Modo de controle de trading alterado');

    try {
      const publisher = getPublisher();
      if (publisher.isPublisherConnected()) {
        await publisher.publishControlChange({
          action,
          tenantId: authContext.tenantId,
          userId: authContext.userId,
          previousMode,
          newMode: requestedMode,
          reason,
        });
      } else {
        logger.warn('Redis publisher não conectado - broadcast de controle não enviado');
      }
    } catch (broadcastError) {
      logger.warn(
        { error: broadcastError instanceof Error ? broadcastError.message : 'Erro desconhecido' },
        'Falha ao publicar broadcast de controle'
      );
    }

    res.json({
      success: true,
      data: {
        previousMode,
        newMode: requestedMode,
        action,
        message: 'Controle manual assumido com sucesso',
        changed: true,
        historyId: historyEntry?.id,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao alterar modo de controle de trading');
    res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// TRADING: ANÁLISE TÉCNICA ENTERPRISE (21/12/2025)
// Indicadores técnicos calculados por CÓDIGO (determinísticos)
// Elimina alucinações do LLM ao fornecer dados reais calculados
// ============================================================================

async function calculateAndPersistTechnicalAnalysis(params: {
  tenantId: string;
  userId: string;
  symbol: string;
  interval: string;
  marketType?: TradingMarketType;
  marginMode?: TradingMarginMode;
  enabledIndicators?: TradingIndicatorKey[];
  techniques?: TradingTechnique[];
  ensembleConfig?: TradingEnsembleConfig;
}): Promise<{
  analysis: technicalIndicators.TechnicalAnalysisResult;
  indicatorId: string;
  resolvedSymbol: string;
  techniqueScores: TradingTechniqueScore[];
  ensembleResult: TradingEnsembleResult;
}> {
  const { tenantId, userId, symbol, interval, marketType, marginMode, enabledIndicators } = params;
  const tradingAuth = { tenantId, userId };

  const granularity = resolveTradingIntervalGranularity(interval);
  if (!granularity) {
    throw new Error(`Intervalo inválido: ${interval}. Use: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 8h, 12h, 1d, 1w`);
  }

  const resolvedSymbol = await kucoinService.resolveTradingSymbolStrict(tradingAuth, symbol, marketType, marginMode);
  const resolvedMarketType = marketType ?? 'futures';

  const now = Date.now();
  const from = now - (granularity * 60 * 1000 * 250);
  const klinesRaw = resolvedMarketType === 'spot' || resolvedMarketType === 'margin'
    ? await kucoinSpotClient.getSpotKlines(resolvedSymbol, `${granularity}min`, Math.floor(from / 1000), Math.floor(now / 1000))
    : await kucoinClient.getKlines(resolvedSymbol, granularity, from, now);

  if (klinesRaw.length < 200) {
    throw new Error(`Dados insuficientes: ${klinesRaw.length} candles. Mínimo: 200`);
  }

  const candles: technicalIndicators.CandleData[] = klinesRaw.map(k => ({
    timestamp: k.time,
    open: parseFloat(k.open),
    high: parseFloat(k.high),
    low: parseFloat(k.low),
    close: parseFloat(k.close),
    volume: parseFloat(k.volume),
  }));

  const analysis = technicalIndicators.calculateFullAnalysis(candles, resolvedSymbol, interval, enabledIndicators);
  const techniques = params.techniques?.length ? params.techniques : [...DEFAULT_TRADING_TECHNIQUES];
  const ensembleConfig = params.ensembleConfig ?? { ...DEFAULT_TRADING_ENSEMBLE_CONFIG };
  const techniqueScores = technicalIndicators.calculateTechniqueScores({ analysis, techniques });
  const ensembleResult = buildEnsembleResult(techniqueScores, ensembleConfig);

  const validatedInterval = interval as TradingIntervalValue;
  const db = getDatabase();
  const [savedIndicator] = await db
    .insert(schema.tradingTechnicalIndicators)
    .values({
      tenantId,
      symbol: resolvedSymbol,
      interval: validatedInterval,
      candleTimestamp: new Date(candles[candles.length - 1].timestamp),
      currentPrice: analysis.currentPrice,
      // RSI
      rsiValue: analysis.rsi?.value,
      rsiInterpretation: analysis.rsi?.interpretation,
      rsiPeriod: analysis.rsi?.period ?? 14,

      // MACD
      macdLine: analysis.macd?.macd,
      macdSignal: analysis.macd?.signal,
      macdHistogram: analysis.macd?.histogram,
      macdInterpretation: analysis.macd?.interpretation as 'bullish' | 'bearish' | 'sideways' | undefined,
      macdCrossover: analysis.macd?.crossover,

      // EMAs
      ema9: analysis.movingAverages?.ema9,
      ema21: analysis.movingAverages?.ema21,
      ema50: analysis.movingAverages?.ema50,
      ema200: analysis.movingAverages?.ema200,

      // SMAs
      sma20: analysis.movingAverages?.sma20,
      sma50: analysis.movingAverages?.sma50,
      sma200: analysis.movingAverages?.sma200,
      maTrend: analysis.movingAverages?.trend,

      // Bollinger
      bollingerUpper: analysis.bollinger?.upper,
      bollingerMiddle: analysis.bollinger?.middle,
      bollingerLower: analysis.bollinger?.lower,
      bollingerWidth: analysis.bollinger?.width,
      bollingerPercentB: analysis.bollinger?.percentB,
      bollingerInterpretation: analysis.bollinger?.interpretation,

      // ATR
      atrValue: analysis.atr?.value,
      atrPercentage: analysis.atr?.percentage,
      atrVolatility: analysis.atr?.volatility,

      // Stochastic
      stochasticK: analysis.stochastic?.k,
      stochasticD: analysis.stochastic?.d,
      stochasticInterpretation: analysis.stochastic?.interpretation,

      // ADX
      adxValue: analysis.adx?.adx,
      adxPlusDI: analysis.adx?.plusDI,
      adxMinusDI: analysis.adx?.minusDI,
      adxTrendStrength: analysis.adx?.trendStrength,

      // Suporte/Resistência
      pivotPoint: analysis.supportResistance?.pivot,
      resistance1: analysis.supportResistance?.resistance1,
      resistance2: analysis.supportResistance?.resistance2,
      resistance3: analysis.supportResistance?.resistance3,
      support1: analysis.supportResistance?.support1,
      support2: analysis.supportResistance?.support2,
      support3: analysis.supportResistance?.support3,

      // Volume
      currentVolume: analysis.volume?.currentVolume,
      averageVolume: analysis.volume?.averageVolume,
      volumeRatio: analysis.volume?.volumeRatio,
      obv: analysis.volume?.obv,
      volumeInterpretation: analysis.volume?.interpretation,

      // Sinal geral
      overallSignal: analysis.overallSignal,
      signalConfidence: analysis.confidence,

      metadata: {
        calculationDurationMs: Date.now() - analysis.timestamp,
        candleCount: candles.length,
        lastCandleTime: new Date(candles[candles.length - 1].timestamp).toISOString(),
        createdByUserId: userId,
        techniques,
        ensembleConfig,
        techniqueScores,
        ensembleResult,
      },
    })
    .returning({ id: schema.tradingTechnicalIndicators.id });

  return {
    analysis,
    indicatorId: savedIndicator?.id ?? '',
    resolvedSymbol,
    techniqueScores,
    ensembleResult,
  };
}

// GET /api/integrations/trading/analysis/history - Histórico de análises
app.get('/api/integrations/trading/analysis/history', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }
    const tradingAuth = { tenantId: authContext.tenantId, userId: authContext.userId };

    const querySchema = z.object({
      symbol: z.string().optional(),
      interval: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
      cursor: z.string().datetime().optional(),
      page: z.coerce.number().int().min(1).optional(),
      pageSize: z.coerce.number().int().min(1).max(200).optional(),
      orderDirection: z.enum(['asc', 'desc']).optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      overallSignal: z.enum(['strong_buy', 'buy', 'neutral', 'sell', 'strong_sell']).optional(),
      technique: z.string().optional(),
      includeDeleted: z.coerce.boolean().optional(),
      marketType: z.enum(['futures', 'spot', 'margin']).optional(),
      type: z.enum(['futures', 'spot', 'margin']).optional(),
      marginMode: z.enum(['cross', 'isolated']).optional(),
    });
    const queryResult = querySchema.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
      return;
    }

    const marketType = resolveMarketTypeParam(queryResult.data);
    const marginMode = queryResult.data.marginMode;
    const symbolParam = queryResult.data.symbol;
    const resolvedSymbol = symbolParam
      ? await resolveTradingSymbolOrRespond(res, tradingAuth, symbolParam, { required: true, marketType, marginMode })
      : await kucoinService.resolveTradingSymbol(tradingAuth, undefined, marketType, marginMode);
    if (!resolvedSymbol) return;
    const intervalParam = queryResult.data.interval || '5m';
    const limit = queryResult.data.limit ?? 50;
    const cursorParam = queryResult.data.cursor;
    const cursorDate = cursorParam ? new Date(cursorParam) : null;
    const usePaging = queryResult.data.page !== undefined || queryResult.data.pageSize !== undefined;
    const page = queryResult.data.page ?? 1;
    const pageSize = queryResult.data.pageSize ?? limit;
    const orderDirection = queryResult.data.orderDirection ?? 'desc';
    const dateFrom = parseHistoryDateParam(queryResult.data.dateFrom);
    const dateTo = parseHistoryDateParam(queryResult.data.dateTo);
    if (queryResult.data.dateFrom && !dateFrom) {
      res.status(400).json({ error: 'Data inicial inválida.' });
      return;
    }
    if (queryResult.data.dateTo && !dateTo) {
      res.status(400).json({ error: 'Data final inválida.' });
      return;
    }
    const overallSignal = queryResult.data.overallSignal ?? undefined;
    const technique = queryResult.data.technique?.trim();
    const includeDeleted = queryResult.data.includeDeleted ?? false;

    // BUG FIX 21/12/2025: Validação e type narrowing para TypeScript
    const validIntervals = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '12h', '1d', '1w'] as const;
    type ValidInterval = typeof validIntervals[number];
    
    if (!validIntervals.includes(intervalParam as ValidInterval)) {
      res.status(400).json({ error: `Intervalo inválido: ${intervalParam}. Use: ${validIntervals.join(', ')}` });
      return;
    }
    const interval = intervalParam as ValidInterval;

    const db = getDatabase();
    // BUG FIX 21/12/2025: interval agora é usado na query (antes era ignorado)
    const conditions = [
      eq(schema.tradingTechnicalIndicators.tenantId, authContext.tenantId),
      eq(schema.tradingTechnicalIndicators.symbol, resolvedSymbol),
      eq(schema.tradingTechnicalIndicators.interval, interval),
    ];
    if (!includeDeleted) {
      conditions.push(buildNotDeletedMetadataCondition(schema.tradingTechnicalIndicators.metadata));
    }
    if (overallSignal) {
      conditions.push(eq(schema.tradingTechnicalIndicators.overallSignal, overallSignal));
    }
    if (technique) {
      conditions.push(sql`(${schema.tradingTechnicalIndicators.metadata} -> 'techniques') ? ${technique}`);
    }
    if (dateFrom) conditions.push(gte(schema.tradingTechnicalIndicators.calculatedAt, dateFrom));
    if (dateTo) conditions.push(lte(schema.tradingTechnicalIndicators.calculatedAt, dateTo));
    if (!usePaging && cursorDate && !Number.isNaN(cursorDate.getTime())) {
      conditions.push(lt(schema.tradingTechnicalIndicators.calculatedAt, cursorDate));
    }

    const history = await db
      .select()
      .from(schema.tradingTechnicalIndicators)
      .where(and(...conditions))
      .orderBy(orderDirection === 'asc'
        ? asc(schema.tradingTechnicalIndicators.calculatedAt)
        : desc(schema.tradingTechnicalIndicators.calculatedAt))
      .limit(usePaging ? pageSize : limit)
      .offset(usePaging ? Math.max(0, (page - 1) * pageSize) : 0);

    if (usePaging) {
      const [totalRow] = await db
        .select({ total: sql<number>`count(*)` })
        .from(schema.tradingTechnicalIndicators)
        .where(and(...conditions));
      const total = Number(totalRow?.total ?? 0);
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      res.json({
        success: true,
        data: history,
        count: history.length,
        symbol: resolvedSymbol,
        page,
        pageSize,
        total,
        totalPages,
        orderDirection,
      });
      return;
    }

    res.json({
      success: true,
      data: history,
      count: history.length,
      symbol: resolvedSymbol,
      nextCursor: history.length > 0
        ? history[history.length - 1]?.calculatedAt?.toISOString() ?? null
        : null,
      orderDirection,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter histórico de análises');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/analysis/:symbol - Análise técnica completa
app.get('/api/integrations/trading/analysis/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }
    const tenantId = authContext.tenantId;
    const userId = authContext.userId;
    const { symbol } = req.params;
    if (symbol === 'history') {
      res.status(404).json({ error: 'Rota inválida' });
      return;
    }
    const querySchema = z.object({
      interval: z.string().optional(),
      timeframes: z.union([z.string(), z.array(z.string())]).optional(),
      indicators: z.union([z.string(), z.array(z.string())]).optional(),
      techniques: z.union([z.string(), z.array(z.string())]).optional(),
      orderBook: z.union([z.string(), z.boolean()]).optional(),
      news: z.union([z.string(), z.boolean()]).optional(),
      trainingData: z.union([z.string(), z.boolean()]).optional(),
      marketType: z.enum(['futures', 'spot', 'margin']).optional(),
      type: z.enum(['futures', 'spot', 'margin']).optional(),
      marginMode: z.enum(['cross', 'isolated']).optional(),
    });

    const parsedQuery = querySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      res.status(400).json({ error: 'Query inválida', details: parsedQuery.error.flatten() });
      return;
    }

    const marketType = resolveMarketTypeParam(parsedQuery.data);
    const marginMode = parsedQuery.data.marginMode;
    const profileRow = await getOrCreateTradingProfile(tenantId, 'analysis');
    const profile = normalizeTradingProfile(profileRow);
    const requestedTimeframes = parseTimeframesParam(parsedQuery.data.timeframes);
    const requestedIndicators = parseIndicatorsParam(parsedQuery.data.indicators);
    const requestedTechniques = parseTechniquesParam(parsedQuery.data.techniques);
    const timeframes = parsedQuery.data.interval
      ? [TRADING_INTERVAL_ZOD.parse(parsedQuery.data.interval)]
      : (requestedTimeframes.length > 0 ? requestedTimeframes : profile.timeframes);
    const indicators = requestedIndicators.length > 0 ? requestedIndicators : profile.indicators;
    const techniques = requestedTechniques.length > 0 ? requestedTechniques : profile.techniques;
    const ensembleConfig = profile.ensembleConfig;
    const arbitrageConfig = profile.arbitrageConfig;
    const dataSources: TradingProfileDataSources = {
      orderBook: typeof parsedQuery.data.orderBook === 'boolean'
        ? parsedQuery.data.orderBook
        : parsedQuery.data.orderBook === 'true'
          ? true
          : profile.dataSources.orderBook,
      news: typeof parsedQuery.data.news === 'boolean'
        ? parsedQuery.data.news
        : parsedQuery.data.news === 'true'
          ? true
          : profile.dataSources.news,
      trainingData: typeof parsedQuery.data.trainingData === 'boolean'
        ? parsedQuery.data.trainingData
        : parsedQuery.data.trainingData === 'true'
          ? true
          : profile.dataSources.trainingData,
    };
    const effectiveDataSources: TradingProfileDataSources = {
      ...dataSources,
      trainingData: true,
    };

    if (marketType === 'spot' && !kucoinSpotClient.isSpotConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    if (marketType === 'margin' && !kucoinMarginClient.isMarginConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    if (!marketType || marketType === 'futures') {
      if (!kucoinClient.isKucoinConfigured()) {
        respondKucoinNotConfigured(res);
        return;
      }
    }

    assertArbitrageConfigForTechniques({
      techniques,
      arbitrageConfig,
      timeframes,
      context: 'análise determinística',
    });
    if (techniques.includes('arbitrage_triangular') && (marketType ?? 'futures') === 'futures') {
      res.status(400).json({ error: 'Arbitragem triangular não é suportada em mercado futures.' });
      return;
    }

    const analysisResults = await Promise.all(
      timeframes.map(async (frame) => {
        const result = await calculateAndPersistTechnicalAnalysis({
          tenantId,
          userId,
          symbol,
          interval: frame,
          marketType,
          marginMode,
          enabledIndicators: indicators,
          techniques,
          ensembleConfig,
        });
        return {
          interval: frame,
          analysis: result.analysis,
          indicatorId: result.indicatorId,
          resolvedSymbol: result.resolvedSymbol,
          techniqueScores: result.techniqueScores,
          ensembleResult: result.ensembleResult,
        };
      })
    );

    const primaryResult = analysisResults[0];
    const consensus = buildMajorityConsensus(analysisResults, profile.consensus);
    let techniqueScores = aggregateTechniqueScores(analysisResults, techniques);
    let arbitrageSnapshot: TriangularArbitrageResult | null = null;
    let arbitrageSnapshots: TriangularArbitrageResult[] = [];
    if (techniques.includes('arbitrage_triangular') && arbitrageConfig) {
      const resolvedSymbol = primaryResult.resolvedSymbol ?? symbol;
      const { base, quote } = splitSymbolPair(resolvedSymbol);
      const { feePctByExchange, effectiveFeePct } = await resolveArbitrageFeePctForExchanges({
        exchanges: arbitrageConfig.exchanges,
        symbol: resolvedSymbol,
        marketType: marketType ?? 'spot',
        tenantId,
      });
      const networkFeesByAsset = arbitrageConfig.exchanges.length > 1
        ? await resolveNetworkFeesForTenant(tenantId)
        : undefined;
      arbitrageSnapshots = await calculateTriangularArbitrage({
        auth: { tenantId, userId },
        startAsset: base,
        quoteAsset: quote,
        intermediateAssets: arbitrageConfig.intermediateAssets,
        marketType,
        marginMode,
        feePct: effectiveFeePct,
        exchanges: arbitrageConfig.exchanges,
        feePctByExchange,
        networkFeesByAsset,
        maxSlippagePct: arbitrageConfig.maxSlippagePct,
      });
      arbitrageSnapshot = arbitrageSnapshots[0] ?? null;
      if (arbitrageSnapshot) {
        const edgePct = arbitrageSnapshot.edgePct;
        const minEdge = arbitrageConfig.minEdgePct;
        const confidence = Math.min(edgePct / Math.max(minEdge, 0.01), 1);
        const signal: TradingOverallSignal = edgePct >= minEdge * 2
          ? 'strong_buy'
          : edgePct >= minEdge
            ? 'buy'
            : 'neutral';
        techniqueScores = techniqueScores.concat([{
          technique: 'arbitrage_triangular',
          signal,
          confidence: Math.round(confidence * 100) / 100,
          rationale: `Edge ${edgePct.toFixed(2)}% (mín ${minEdge.toFixed(2)}%)`,
        }]);
      } else {
        techniqueScores = techniqueScores.concat([{
          technique: 'arbitrage_triangular',
          signal: 'neutral',
          confidence: 0,
          rationale: 'Sem rota triangular válida com liquidez suficiente.',
        }]);
      }
    }
    const ensembleResult = buildEnsembleResult(techniqueScores, ensembleConfig);
    const orderBook = effectiveDataSources.orderBook
      ? await getOrderBookSnapshot({ tenantId, userId }, symbol, marketType, marginMode)
      : null;
    const news = effectiveDataSources.news
      ? await fetchNewsSummary(
        { tenantId, userId },
        symbol,
        marketType,
        profile.newsConfig
      )
      : null;
    const tradingNamespaceId = await resolveTradingNamespaceId(tenantId);
    if (!tradingNamespaceId) {
      throw new TradingConfigError('TRADING_SCOPE_REQUIRED: Namespace Trading obrigatório e ativo para análises.');
    }
    const trainingData = await fetchTradingDatasetSummary(tenantId, tradingNamespaceId);
    if (trainingData.totalApproved <= 0) {
      throw new TradingConfigError('TRADING_SCOPE_REQUIRED: Dataset aprovado de Trading é obrigatório para análises.');
    }
    const riskConfig = await kucoinService.getRiskConfig({ tenantId, userId });
    const tradePlan = buildTradePlanFromAnalysis({
      analysis: primaryResult.analysis,
      interval: primaryResult.interval,
      timeframes,
      marketType: marketType ?? 'futures',
      marginMode,
      riskConfig,
    });

    logger.info({
      tenantId,
      symbol: primaryResult.resolvedSymbol,
      interval: primaryResult.interval,
      overallSignal: consensus.overallSignal,
      confidence: consensus.confidence,
      indicatorId: primaryResult.indicatorId,
    }, 'Análise técnica calculada e persistida');

    res.json({
      success: true,
      data: primaryResult.analysis,
      indicatorId: primaryResult.indicatorId,
      llmPrompt: technicalIndicators.formatAnalysisForLLM(primaryResult.analysis),
      matrix: analysisResults.map((item) => ({
        interval: item.interval,
        analysis: item.analysis,
        indicatorId: item.indicatorId,
      })),
      consensus,
      techniqueScores,
      ensembleResult,
      arbitrageSnapshot,
      arbitrageSnapshots,
      profile: {
        kind: profileRow.kind,
        timeframes,
        indicators,
        dataSources: effectiveDataSources,
        newsConfig: profile.newsConfig,
        techniques,
        ensembleConfig,
        arbitrageConfig,
      },
      tradePlan,
      sources: {
        orderBook,
        news,
        trainingData,
      },
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao calcular análise técnica');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/analysis/history/delete - Exclusão lógica de análises
app.post('/api/integrations/trading/analysis/history/delete', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }
    const bodySchema = z.object({
      ids: z.array(z.string().uuid()).optional(),
      all: z.boolean().optional(),
      scope: z.enum(['self', 'tenant']).optional(),
    });
    const bodyResult = bodySchema.safeParse(req.body ?? {});
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Dados inválidos', details: bodyResult.error.flatten() });
      return;
    }
    const { ids, all, scope } = bodyResult.data;
    if (!ids?.length && !all) {
      res.status(400).json({ error: 'Informe ids ou use all=true para excluir.' });
      return;
    }

    const isAdmin = await isAdminUser(authContext);
    const effectiveScope = scope === 'tenant' && isAdmin ? 'tenant' : 'self';
    if (scope === 'tenant' && !isAdmin) {
      res.status(403).json({ error: 'Apenas administradores podem excluir histórico de todo o tenant.' });
      return;
    }

    const conditions = [eq(schema.tradingTechnicalIndicators.tenantId, authContext.tenantId)];
    if (effectiveScope === 'self') {
      conditions.push(buildOwnerMetadataCondition(schema.tradingTechnicalIndicators.metadata, authContext.userId));
    }
    if (ids?.length) {
      conditions.push(inArray(schema.tradingTechnicalIndicators.id, ids));
    }

    const deletedAt = new Date().toISOString();
    const db = getDatabase();
    const updateResult = await db
      .update(schema.tradingTechnicalIndicators)
      .set({
        metadata: buildSoftDeleteMetadataUpdate(schema.tradingTechnicalIndicators.metadata, deletedAt, authContext.userId),
      })
      .where(and(...conditions));

    res.json({
      success: true,
      data: { deletedAt, scope: effectiveScope },
      updated: updateResult.rowCount ?? 0,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao excluir histórico de análises');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/analysis/history/purge - Exclusão definitiva (admin)
app.post('/api/integrations/trading/analysis/history/purge', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }
    const tenantId = authContext.tenantId;
    const userId = authContext.userId;
    const isAdmin = await isAdminUser(authContext);
    if (!isAdmin) {
      res.status(403).json({ error: 'Apenas administradores podem excluir definitivamente o histórico.' });
      return;
    }
    const bodySchema = z.object({
      ids: z.array(z.string().uuid()).optional(),
      all: z.boolean().optional(),
      scope: z.enum(['self', 'tenant']).optional(),
    });
    const bodyResult = bodySchema.safeParse(req.body ?? {});
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Dados inválidos', details: bodyResult.error.flatten() });
      return;
    }
    const { ids, all, scope } = bodyResult.data;
    if (!ids?.length && !all) {
      res.status(400).json({ error: 'Informe ids ou use all=true para excluir.' });
      return;
    }

    const effectiveScope = scope ?? 'self';
    const baseConditions = [eq(schema.tradingTechnicalIndicators.tenantId, tenantId)];
    if (effectiveScope === 'self') {
      baseConditions.push(buildOwnerMetadataCondition(schema.tradingTechnicalIndicators.metadata, userId));
    }
    if (ids?.length) {
      baseConditions.push(inArray(schema.tradingTechnicalIndicators.id, ids));
    }

    const db = getDatabase();
    const indicatorIdsQuery = db
      .select({ id: schema.tradingTechnicalIndicators.id })
      .from(schema.tradingTechnicalIndicators)
      .where(and(...baseConditions));

    const result = await db.transaction(async (tx) => {
      await tx
        .update(schema.tradingAnalysisSchedulers)
        .set({ lastIndicatorId: null })
        .where(and(
          eq(schema.tradingAnalysisSchedulers.tenantId, tenantId),
          inArray(schema.tradingAnalysisSchedulers.lastIndicatorId, indicatorIdsQuery)
        ));

      const validationDelete = await tx
        .delete(schema.tradingLlmValidations)
        .where(and(
          eq(schema.tradingLlmValidations.tenantId, tenantId),
          inArray(schema.tradingLlmValidations.indicatorSnapshotId, indicatorIdsQuery)
        ));

      const deleteResult = await tx
        .delete(schema.tradingTechnicalIndicators)
        .where(and(...baseConditions));

      return {
        deletedIndicators: deleteResult.rowCount ?? 0,
        deletedValidations: validationDelete.rowCount ?? 0,
      };
    });

    res.json({
      success: true,
      data: {
        scope: effectiveScope,
        deletedIndicators: result.deletedIndicators,
        deletedValidations: result.deletedValidations,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao excluir definitivamente histórico de análises');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/validations - Histórico de validações LLM
app.get('/api/integrations/trading/validations', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const passedOnly = req.query.passedOnly === 'true';

    const db = getDatabase();
    
    const conditions = [eq(schema.tradingLlmValidations.tenantId, authContext.tenantId)];
    if (passedOnly) {
      conditions.push(eq(schema.tradingLlmValidations.validationPassed, true));
    }

    const validations = await db
      .select()
      .from(schema.tradingLlmValidations)
      .where(and(...conditions))
      .orderBy(desc(schema.tradingLlmValidations.validatedAt))
      .limit(limit);

    // MELHORIA M1 (07/02/2026): Agregação SQL ao invés de fetch all + contagem em memória.
    // Antes: SELECT * sem limit → contagem em JS (O(n) memória). Agora: COUNT/SUM no PostgreSQL (O(1) memória).
    const statsResult = await db
      .select({
        total: sql<number>`count(*)::int`,
        passed: sql<number>`sum(case when ${schema.tradingLlmValidations.validationPassed} = true then 1 else 0 end)::int`,
      })
      .from(schema.tradingLlmValidations)
      .where(eq(schema.tradingLlmValidations.tenantId, authContext.tenantId));

    const totalValidations = statsResult[0]?.total ?? 0;
    const passedValidations = statsResult[0]?.passed ?? 0;
    const accuracyRate = totalValidations > 0 ? (passedValidations / totalValidations) * 100 : 0;

    res.json({
      success: true,
      data: validations,
      stats: {
        total: totalValidations,
        passed: passedValidations,
        failed: totalValidations - passedValidations,
        accuracyRate: Math.round(accuracyRate * 100) / 100,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter validações LLM');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/validations/diagnostics - Diagnóstico detalhado das validações LLM
// CORREÇÃO CR2 (07/02/2026): Queries envolvidas em withTenantContext() para RLS funcionar
// via PgBouncer (transaction pooling). Sem withTenantContext, current_setting('app.current_tenant_id')
// não é definido e RLS bloqueia acesso à tabela trading_llm_validations.
app.get('/api/integrations/trading/validations/diagnostics', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    const dateFromRaw = req.query.dateFrom as string | undefined;
    const dateToRaw = req.query.dateTo as string | undefined;
    const dateFrom = parseHistoryDateParam(dateFromRaw);
    const dateTo = parseHistoryDateParam(dateToRaw);
    if (dateFromRaw && !dateFrom) {
      res.status(400).json({ error: 'Data inicial inválida.' });
      return;
    }
    if (dateToRaw && !dateTo) {
      res.status(400).json({ error: 'Data final inválida.' });
      return;
    }
    const topLimit = Math.min(Number.parseInt(req.query.topLimit as string, 10) || 10, 50);

    const result = await withTenantContext(authContext.tenantId, authContext.role === 'super_admin', async (tx) => {
      const conditions: ReturnType<typeof sql>[] = [
        sql`v.tenant_id = ${authContext.tenantId}`,
      ];
      if (dateFrom) {
        conditions.push(sql`v.validated_at >= ${dateFrom}`);
      }
      if (dateTo) {
        conditions.push(sql`v.validated_at <= ${dateTo}`);
      }

      const whereClause = conditions.length
        ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
        : sql``;

      const totalsResult = await tx.execute(sql`
        SELECT
          count(*)::int AS total,
          sum(case when v.validation_passed then 1 else 0 end)::int AS passed,
          sum(case when not v.validation_passed then 1 else 0 end)::int AS failed,
          sum(case when coalesce(
            v.no_values_extracted,
            (
              SELECT count(*) = 0
              FROM jsonb_object_keys(COALESCE(v.llm_cited_values, '{}'::jsonb))
            )
          ) then 1 else 0 end)::int AS no_values,
          avg((
            SELECT count(*)
            FROM jsonb_object_keys(COALESCE(v.discrepancies, '{}'::jsonb))
          ))::float AS avg_discrepancy_fields,
          min(v.max_allowed_deviation)::float AS min_allowed_deviation,
          max(v.max_allowed_deviation)::float AS max_allowed_deviation
        FROM trading_llm_validations v
        ${whereClause}
      `);
      const totalsRow = (totalsResult as { rows?: Array<Record<string, unknown>> }).rows?.[0] ?? {};

      const actionResult = await tx.execute(sql`
        SELECT
          coalesce(v.action_taken::text, 'unknown') AS action,
          count(*)::int AS total
        FROM trading_llm_validations v
        ${whereClause}
        GROUP BY v.action_taken
        ORDER BY total DESC
      `);

      const failureReasonResult = await tx.execute(sql`
        SELECT
          coalesce(v.failure_reason::text, 'unknown') AS reason,
          count(*)::int AS total
        FROM trading_llm_validations v
        ${whereClause}
        GROUP BY v.failure_reason
        ORDER BY total DESC
      `);

      const extractionResult = await tx.execute(sql`
        SELECT
          coalesce(v.extraction_source::text, 'unknown') AS source,
          count(*)::int AS total
        FROM trading_llm_validations v
        ${whereClause}
        GROUP BY v.extraction_source
        ORDER BY total DESC
      `);

      const intervalResult = await tx.execute(sql`
        SELECT
          coalesce(ti.interval::text, 'N/A') AS interval,
          count(*)::int AS total,
          sum(case when v.validation_passed then 1 else 0 end)::int AS passed,
          sum(case when not v.validation_passed then 1 else 0 end)::int AS failed,
          sum(case when coalesce(
            v.no_values_extracted,
            (
              SELECT count(*) = 0
              FROM jsonb_object_keys(COALESCE(v.llm_cited_values, '{}'::jsonb))
            )
          ) then 1 else 0 end)::int AS no_values
        FROM trading_llm_validations v
        LEFT JOIN trading_technical_indicators ti ON ti.id = v.indicator_snapshot_id
        ${whereClause}
        GROUP BY ti.interval
        ORDER BY total DESC
      `);

      const symbolResult = await tx.execute(sql`
        SELECT
          coalesce(ti.symbol, 'N/A') AS symbol,
          count(*)::int AS total,
          sum(case when v.validation_passed then 1 else 0 end)::int AS passed,
          sum(case when not v.validation_passed then 1 else 0 end)::int AS failed
        FROM trading_llm_validations v
        LEFT JOIN trading_technical_indicators ti ON ti.id = v.indicator_snapshot_id
        ${whereClause}
        GROUP BY ti.symbol
        ORDER BY total DESC
        LIMIT ${topLimit}
      `);

      const discrepancyConditions = [
        ...conditions,
        sql`v.discrepancies is not null`,
      ];
      const discrepancyWhere = sql`WHERE ${sql.join(discrepancyConditions, sql` AND `)}`;

      const discrepancyResult = await tx.execute(sql`
        SELECT
          d.key AS field,
          count(*)::int AS occurrences,
          avg((d.value->>'diff')::float)::float AS avg_diff,
          max((d.value->>'diff')::float)::float AS max_diff
        FROM trading_llm_validations v
        CROSS JOIN LATERAL jsonb_each(v.discrepancies) AS d(key, value)
        ${discrepancyWhere}
        GROUP BY d.key
        ORDER BY occurrences DESC
        LIMIT ${topLimit}
      `);

      return {
        totalsRow,
        actionRows: (actionResult as { rows?: Array<Record<string, unknown>> }).rows ?? [],
        failureReasonRows: (failureReasonResult as { rows?: Array<Record<string, unknown>> }).rows ?? [],
        extractionRows: (extractionResult as { rows?: Array<Record<string, unknown>> }).rows ?? [],
        intervalRows: (intervalResult as { rows?: Array<Record<string, unknown>> }).rows ?? [],
        symbolRows: (symbolResult as { rows?: Array<Record<string, unknown>> }).rows ?? [],
        discrepancyRows: (discrepancyResult as { rows?: Array<Record<string, unknown>> }).rows ?? [],
      };
    });

    res.json({
      success: true,
      meta: {
        tenantId: authContext.tenantId,
        dateFrom: dateFrom ? dateFrom.toISOString() : null,
        dateTo: dateTo ? dateTo.toISOString() : null,
        topLimit,
      },
      totals: result.totalsRow,
      breakdown: {
        byAction: result.actionRows,
        byFailureReason: result.failureReasonRows,
        byExtractionSource: result.extractionRows,
        byInterval: result.intervalRows,
        bySymbol: result.symbolRows,
        topDiscrepancies: result.discrepancyRows,
      },
    });
  } catch (error) {
    // CORREÇÃO CR2 (07/02/2026): Error logging completo com detalhes PostgreSQL.
    // Drizzle encapsula erros PostgreSQL em error.cause - capturar ambos níveis.
    // Exemplo: Drizzle error.message = "Failed query: SELECT..." mas o erro REAL
    // do PostgreSQL (ex: "invalid input value for enum") está em error.cause.
    const drizzleError = error as { message?: string; cause?: { code?: string; detail?: string; hint?: string; constraint?: string; message?: string } };
    const pgCause = drizzleError.cause;
    logger.error({
      message: drizzleError.message ?? 'Erro desconhecido',
      // Detalhes do erro PostgreSQL real (extraídos de error.cause)
      pgCode: pgCause?.code,
      pgMessage: pgCause?.message,
      pgDetail: pgCause?.detail,
      pgHint: pgCause?.hint,
      pgConstraint: pgCause?.constraint,
    }, 'Erro ao obter diagnóstico de validações LLM');
    const errorMessage = pgCause?.message ?? drizzleError.message ?? 'Erro desconhecido';
    res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// ROTAS KUCOIN DIRETAS - Futures, Spot, Margin (FASE 5 - KuCoin Features Completas)
// Expõe endpoints dos clients KuCoin diretamente via Express routes
// para que o frontend possa acessar todas as funcionalidades disponíveis.
// Ref: Plano KuCoin Features Completas, CLAUDE.md Regra 6 (Enterprise-grade)
// ============================================================================

// --- FUTURES: Ticker, Orders, Positions, Margin Mode, Position Mode, Leverage ---

// GET /api/integrations/trading/futures/ticker/:symbol - Ticker Futures em tempo real
app.get('/api/integrations/trading/futures/ticker/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    if (!symbol) {
      res.status(400).json({ error: 'Símbolo obrigatório' });
      return;
    }
    const ticker = await kucoinClient.getTicker(symbol);
    res.json({ success: true, data: ticker });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter ticker Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/futures/orders/all - Cancelar todas ordens Futures
app.delete('/api/integrations/trading/futures/orders/all', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const symbol = req.query.symbol as string | undefined;
    const result = await kucoinClient.cancelAllOrders(symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar todas ordens Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/orders/open - Ordens abertas Futures
app.get('/api/integrations/trading/futures/orders/open', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const symbol = req.query.symbol as string | undefined;
    const result = await kucoinClient.getOpenOrders(symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter ordens abertas Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/orders/:orderId - Detalhes de ordem Futures por ID
app.get('/api/integrations/trading/futures/orders/:orderId', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const { orderId } = req.params;
    if (!orderId) {
      res.status(400).json({ error: 'orderId obrigatório' });
      return;
    }
    const order = await kucoinClient.getOrder(orderId);
    res.json({ success: true, data: order });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter ordem Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/orders/by-client-oid/:clientOid - Ordem Futures por clientOid
app.get('/api/integrations/trading/futures/orders/by-client-oid/:clientOid', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const { clientOid } = req.params;
    if (!clientOid) {
      res.status(400).json({ error: 'clientOid obrigatório' });
      return;
    }
    const order = await kucoinClient.getOrderByClientOid(clientOid);
    res.json({ success: true, data: order });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter ordem Futures por clientOid');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/positions/:symbol - Posição Futures por símbolo
app.get('/api/integrations/trading/futures/positions/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const { symbol } = req.params;
    if (!symbol) {
      res.status(400).json({ error: 'Símbolo obrigatório' });
      return;
    }
    const position = await kucoinClient.getPosition(symbol);
    res.json({ success: true, data: position });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter posição Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/margin-mode/:symbol - Modo de margem Futures
app.get('/api/integrations/trading/futures/margin-mode/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const { symbol } = req.params;
    if (!symbol) {
      res.status(400).json({ error: 'Símbolo obrigatório' });
      return;
    }
    const result = await kucoinClient.getMarginMode(symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter margin mode Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/futures/margin-mode - Alterar modo de margem Futures
app.post('/api/integrations/trading/futures/margin-mode', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const bodySchema = z.object({
      symbol: z.string().min(1),
      marginMode: z.enum(['ISOLATED', 'CROSS']),
    });
    const bodyResult = bodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Parâmetros inválidos', details: bodyResult.error.flatten() });
      return;
    }
    const { symbol, marginMode } = bodyResult.data;
    const result = await kucoinClient.changeMarginMode(symbol, marginMode);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao alterar margin mode Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/position-mode - Modo de posição Futures
app.get('/api/integrations/trading/futures/position-mode', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const result = await kucoinClient.getPositionMode();
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter position mode Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/futures/position-mode - Alterar modo de posição Futures
app.post('/api/integrations/trading/futures/position-mode', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const bodySchema = z.object({
      positionMode: z.enum(['ONE_WAY', 'HEDGE']),
    });
    const bodyResult = bodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Parâmetros inválidos', details: bodyResult.error.flatten() });
      return;
    }
    const { positionMode } = bodyResult.data;
    const result = await kucoinClient.changePositionMode(positionMode);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao alterar position mode Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/leverage/:symbol - Alavancagem cross Futures
app.get('/api/integrations/trading/futures/leverage/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const { symbol } = req.params;
    if (!symbol) {
      res.status(400).json({ error: 'Símbolo obrigatório' });
      return;
    }
    const result = await kucoinClient.getCrossUserLeverage(symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter alavancagem Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/futures/leverage - Alterar alavancagem cross Futures
app.post('/api/integrations/trading/futures/leverage', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const bodySchema = z.object({
      symbol: z.string().min(1),
      leverage: z.string().min(1),
    });
    const bodyResult = bodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Parâmetros inválidos', details: bodyResult.error.flatten() });
      return;
    }
    const { symbol, leverage } = bodyResult.data;
    const result = await kucoinClient.changeCrossUserLeverage(symbol, leverage);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao alterar alavancagem Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// --- FUTURES: Position History, Isolated Margin, Max Open, Risk Limits (FASE 2) ---

// GET /api/integrations/trading/futures/positions/history - Histórico de posições fechadas
app.get('/api/integrations/trading/futures/positions/history', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const symbol = req.query.symbol as string | undefined;
    const result = await kucoinClient.getPositionsHistory(symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter histórico de posições');
    res.status(500).json({ error: errorMessage });
  }
});

// Alias legado para frontend antigo - mantém compatibilidade sem quebrar histórico de posições
app.get('/api/integrations/trading/positions/history', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const symbol = req.query.symbol as string | undefined;
    const result = await kucoinClient.getPositionsHistory(symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter histórico de posições (alias legado)');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/positions/max-open - Tamanho máximo de abertura
app.get('/api/integrations/trading/futures/positions/max-open', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const querySchema = z.object({
      symbol: z.string().min(1),
      price: z.string().min(1),
      leverage: z.coerce.number().min(1),
    });
    const queryResult = querySchema.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({ error: 'Parâmetros inválidos (symbol, price, leverage obrigatórios)', details: queryResult.error.flatten() });
      return;
    }
    const { symbol, price, leverage } = queryResult.data;
    const result = await kucoinClient.getMaxOpenSize(symbol, price, leverage);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter max open size');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/futures/positions/margin/add - Adicionar margem isolada
app.post('/api/integrations/trading/futures/positions/margin/add', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const bodySchema = z.object({
      symbol: z.string().min(1),
      margin: z.number().positive(),
      bizNo: z.string().min(1),
    });
    const bodyResult = bodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Parâmetros inválidos', details: bodyResult.error.flatten() });
      return;
    }
    const { symbol, margin, bizNo } = bodyResult.data;
    const result = await kucoinClient.addIsolatedMargin(symbol, margin, bizNo);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao adicionar margem isolada');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/futures/positions/margin/remove - Remover margem isolada
app.post('/api/integrations/trading/futures/positions/margin/remove', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const bodySchema = z.object({
      symbol: z.string().min(1),
      withdrawAmount: z.string().min(1),
    });
    const bodyResult = bodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Parâmetros inválidos', details: bodyResult.error.flatten() });
      return;
    }
    const { symbol, withdrawAmount } = bodyResult.data;
    const result = await kucoinClient.removeIsolatedMargin(symbol, withdrawAmount);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao remover margem isolada');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/positions/margin/max-withdraw - Max margem retirável
app.get('/api/integrations/trading/futures/positions/margin/max-withdraw', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const symbol = req.query.symbol as string;
    if (!symbol) {
      res.status(400).json({ error: 'symbol obrigatório' });
      return;
    }
    const result = await kucoinClient.getMaxWithdrawMargin(symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter max withdraw margin');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/futures/margin-mode/batch - Batch alterar margin mode
app.post('/api/integrations/trading/futures/margin-mode/batch', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const bodySchema = z.object({
      symbolModes: z.array(z.object({
        symbol: z.string().min(1),
        marginMode: z.enum(['ISOLATED', 'CROSS']),
      })).min(1),
    });
    const bodyResult = bodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Parâmetros inválidos', details: bodyResult.error.flatten() });
      return;
    }
    const result = await kucoinClient.batchChangeMarginMode(bodyResult.data.symbolModes);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao alterar margin mode em batch');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/risk-limits/:symbol - Risk limits por símbolo
app.get('/api/integrations/trading/futures/risk-limits/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    if (!symbol) {
      res.status(400).json({ error: 'symbol obrigatório' });
      return;
    }
    const marginType = (req.query.marginType as string) || 'cross';
    const result = marginType === 'isolated'
      ? await kucoinClient.getIsolatedMarginRiskLimit(symbol)
      : await kucoinClient.getCrossMarginRiskLimit(symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter risk limits');
    res.status(500).json({ error: errorMessage });
  }
});

// --- FUTURES: Batch Orders, Order Test, Cancel by ClientOid, Cancel All Stop Orders (FASE 1) ---

// POST /api/integrations/trading/futures/orders/batch - Batch de ordens Futures (até 20)
app.post('/api/integrations/trading/futures/orders/batch', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const bodySchema = z.object({
      orders: z.array(z.object({
        clientOid: z.string().min(1),
        symbol: z.string().min(1),
        side: z.enum(['buy', 'sell']),
        type: z.enum(['limit', 'market']),
        leverage: z.string().min(1),
        price: z.string().optional(),
        size: z.number().optional(),
        qty: z.number().optional(),
        valueQty: z.number().optional(),
        timeInForce: z.enum(['GTC', 'IOC', 'FOK', 'RPI']).optional(),
        postOnly: z.boolean().optional(),
        hidden: z.boolean().optional(),
        iceberg: z.boolean().optional(),
        visibleSize: z.string().optional(),
        remark: z.string().optional(),
        stop: z.enum(['down', 'up']).optional(),
        stopPriceType: z.enum(['TP', 'IP', 'MP']).optional(),
        stopPrice: z.string().optional(),
        reduceOnly: z.boolean().optional(),
        closeOrder: z.boolean().optional(),
        forceHold: z.boolean().optional(),
        marginMode: z.enum(['ISOLATED', 'CROSS']).optional(),
        stp: z.enum(['CN', 'CO', 'CB', 'DC']).optional(),
      })).min(1).max(20),
    });
    const bodyResult = bodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Parâmetros inválidos', details: bodyResult.error.flatten() });
      return;
    }
    const ordersWithNumericLeverage = bodyResult.data.orders.map((o) => ({
      ...o,
      leverage: Number(o.leverage),
      qty: o.qty != null ? String(o.qty) : undefined,
      valueQty: o.valueQty != null ? String(o.valueQty) : undefined,
    }));
    const result = await kucoinClient.batchCreateOrders(ordersWithNumericLeverage as unknown as kucoinClient.CreateOrderParams[]);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao criar batch de ordens Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/futures/orders/test - Ordem de teste Futures (dry run)
app.post('/api/integrations/trading/futures/orders/test', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const bodySchema = z.object({
      clientOid: z.string().min(1),
      symbol: z.string().min(1),
      side: z.enum(['buy', 'sell']),
      type: z.enum(['limit', 'market']),
      leverage: z.string().min(1),
      price: z.string().optional(),
      size: z.number().optional(),
      qty: z.number().optional(),
      valueQty: z.number().optional(),
      timeInForce: z.enum(['GTC', 'IOC', 'FOK', 'RPI']).optional(),
      postOnly: z.boolean().optional(),
      hidden: z.boolean().optional(),
      iceberg: z.boolean().optional(),
      visibleSize: z.string().optional(),
      remark: z.string().optional(),
      stop: z.enum(['down', 'up']).optional(),
      stopPriceType: z.enum(['TP', 'IP', 'MP']).optional(),
      stopPrice: z.string().optional(),
      reduceOnly: z.boolean().optional(),
      closeOrder: z.boolean().optional(),
      forceHold: z.boolean().optional(),
      marginMode: z.enum(['ISOLATED', 'CROSS']).optional(),
      stp: z.enum(['CN', 'CO', 'CB', 'DC']).optional(),
    });
    const bodyResult = bodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Parâmetros inválidos', details: bodyResult.error.flatten() });
      return;
    }
    const testOrderParams = {
      ...bodyResult.data,
      leverage: Number(bodyResult.data.leverage),
      qty: bodyResult.data.qty != null ? String(bodyResult.data.qty) : undefined,
      valueQty: bodyResult.data.valueQty != null ? String(bodyResult.data.valueQty) : undefined,
    };
    const result = await kucoinClient.createOrderTest(testOrderParams as unknown as kucoinClient.CreateOrderParams);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao criar ordem de teste Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/futures/orders/by-client-oid/:clientOid - Cancelar ordem Futures por clientOid
app.delete('/api/integrations/trading/futures/orders/by-client-oid/:clientOid', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const { clientOid } = req.params;
    const symbol = req.query.symbol as string;
    if (!clientOid || !symbol) {
      res.status(400).json({ error: 'clientOid e symbol obrigatórios' });
      return;
    }
    const result = await kucoinClient.cancelOrderByClientOid(clientOid, symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar ordem Futures por clientOid');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/futures/stop-orders/all - Cancelar todas stop orders Futures
app.delete('/api/integrations/trading/futures/stop-orders/all', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const symbol = req.query.symbol as string | undefined;
    const result = await kucoinClient.cancelAllStopOrders(symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar todas stop orders Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// FUTURES: Market Data Avançado, Ordens Avançadas, Posições, Funding Fees
// Cobertura 100% KuCoin Futures API
// ============================================================================

// GET /api/integrations/trading/futures/tickers - Todos os tickers Futures
app.get('/api/integrations/trading/futures/tickers', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  try {
    const tickers = await kucoinClient.getAllFuturesTickers();
    res.json({ success: true, data: tickers });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter todos os tickers Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/orderbook/full/:symbol - Order book completo Futures (Level 2)
app.get('/api/integrations/trading/futures/orderbook/full/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    if (!symbol) {
      res.status(400).json({ error: 'Símbolo obrigatório' });
      return;
    }
    const orderbook = await kucoinClient.getFullFuturesOrderBook(symbol);
    res.json({ success: true, data: orderbook });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter order book completo Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/index/spot/:symbol - Índice de preço spot
app.get('/api/integrations/trading/futures/index/spot/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    if (!symbol) {
      res.status(400).json({ error: 'Símbolo obrigatório' });
      return;
    }
    const startAt = req.query.startAt ? Number(req.query.startAt) : undefined;
    const endAt = req.query.endAt ? Number(req.query.endAt) : undefined;
    const maxCount = req.query.maxCount ? Number(req.query.maxCount) : undefined;
    const result = await kucoinClient.getSpotIndexPrice(symbol, { startAt, endAt, maxCount });
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter índice de preço spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/index/interest/:symbol - Índice de taxa de juros
app.get('/api/integrations/trading/futures/index/interest/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    if (!symbol) {
      res.status(400).json({ error: 'Símbolo obrigatório' });
      return;
    }
    const startAt = req.query.startAt ? Number(req.query.startAt) : undefined;
    const endAt = req.query.endAt ? Number(req.query.endAt) : undefined;
    const maxCount = req.query.maxCount ? Number(req.query.maxCount) : undefined;
    const result = await kucoinClient.getInterestRateIndex(symbol, { startAt, endAt, maxCount });
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter índice de taxa de juros');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/index/premium/:symbol - Índice premium
app.get('/api/integrations/trading/futures/index/premium/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    if (!symbol) {
      res.status(400).json({ error: 'Símbolo obrigatório' });
      return;
    }
    const startAt = req.query.startAt ? Number(req.query.startAt) : undefined;
    const endAt = req.query.endAt ? Number(req.query.endAt) : undefined;
    const maxCount = req.query.maxCount ? Number(req.query.maxCount) : undefined;
    const result = await kucoinClient.getPremiumIndex(symbol, { startAt, endAt, maxCount });
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter índice premium');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/stats/24hr - Estatísticas 24h Futures
app.get('/api/integrations/trading/futures/stats/24hr', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  try {
    const stats = await kucoinClient.get24hrStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter estatísticas 24h Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/server-time - Hora do servidor Futures
app.get('/api/integrations/trading/futures/server-time', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  try {
    const time = await kucoinClient.getFuturesServerTime();
    res.json({ success: true, data: { timestamp: time } });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter hora do servidor Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/service-status - Status do serviço Futures
app.get('/api/integrations/trading/futures/service-status', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  try {
    const status = await kucoinClient.getFuturesServiceStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter status do serviço Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/futures/orders/batch-cancel - Cancelar múltiplas ordens por IDs
app.delete('/api/integrations/trading/futures/orders/batch-cancel', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const orderIdsRaw = req.query.orderIds as string | undefined;
    if (!orderIdsRaw) {
      res.status(400).json({ error: 'orderIds obrigatório (separados por vírgula)' });
      return;
    }
    const orderIds = orderIdsRaw.split(',').map(id => id.trim()).filter(Boolean);
    const result = await kucoinClient.batchCancelOrders(orderIds);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar ordens em batch Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/orders/recent-closed - Ordens recentes fechadas Futures
app.get('/api/integrations/trading/futures/orders/recent-closed', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const symbol = req.query.symbol as string | undefined;
    const result = await kucoinClient.getRecentClosedOrders(symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter ordens recentes fechadas Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/orders/open-value/:symbol - Valor de ordens abertas Futures
app.get('/api/integrations/trading/futures/orders/open-value/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const { symbol } = req.params;
    if (!symbol) {
      res.status(400).json({ error: 'Símbolo obrigatório' });
      return;
    }
    const result = await kucoinClient.getOpenOrderValue(symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter valor de ordens abertas Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/fills - Fills/trades Futures
app.get('/api/integrations/trading/futures/fills', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const params = {
      symbol: req.query.symbol as string | undefined,
      orderId: req.query.orderId as string | undefined,
      side: req.query.side as 'buy' | 'sell' | undefined,
      type: req.query.type as 'limit' | 'market' | undefined,
      startAt: req.query.startAt ? Number(req.query.startAt) : undefined,
      endAt: req.query.endAt ? Number(req.query.endAt) : undefined,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
      currentPage: req.query.currentPage ? Number(req.query.currentPage) : undefined,
    };
    const result = await kucoinClient.getFills(params);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter fills Futures');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/positions/cross-margin-requirement/:symbol - Requisito margem cross
app.get('/api/integrations/trading/futures/positions/cross-margin-requirement/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const { symbol } = req.params;
    if (!symbol) {
      res.status(400).json({ error: 'Símbolo obrigatório' });
      return;
    }
    const result = await kucoinClient.getCrossMarginRequirement(symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter requisito de margem cross');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/futures/risk-limits/isolated - Modificar risk limit isolado
app.post('/api/integrations/trading/futures/risk-limits/isolated', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const { symbol, level } = req.body as { symbol?: string; level?: number };
    if (!symbol || level === undefined) {
      res.status(400).json({ error: 'symbol e level obrigatórios' });
      return;
    }
    const result = await kucoinClient.modifyIsolatedMarginRiskLimit(symbol, level);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao modificar risk limit isolado');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/funding/public/:symbol - Histórico público de funding
app.get('/api/integrations/trading/futures/funding/public/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    if (!symbol) {
      res.status(400).json({ error: 'Símbolo obrigatório' });
      return;
    }
    const from = req.query.from ? Number(req.query.from) : Date.now() - 7 * 24 * 60 * 60 * 1000;
    const to = req.query.to ? Number(req.query.to) : Date.now();
    const result = await kucoinClient.getPublicFundingHistory(symbol, from, to);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter histórico público de funding');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/futures/funding/private/:symbol - Histórico privado de funding
app.get('/api/integrations/trading/futures/funding/private/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const { symbol } = req.params;
    if (!symbol) {
      res.status(400).json({ error: 'Símbolo obrigatório' });
      return;
    }
    const startAt = req.query.startAt ? Number(req.query.startAt) : undefined;
    const endAt = req.query.endAt ? Number(req.query.endAt) : undefined;
    const maxCount = req.query.maxCount ? Number(req.query.maxCount) : undefined;
    const result = await kucoinClient.getPrivateFundingHistory(symbol, { startAt, endAt, maxCount });
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter histórico privado de funding');
    res.status(500).json({ error: errorMessage });
  }
});

// --- SPOT: Ticker, Accounts, Orders, Stop Orders ---

// GET /api/integrations/trading/spot/ticker/:symbol - Ticker Spot
app.get('/api/integrations/trading/spot/ticker/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    if (!symbol) {
      res.status(400).json({ error: 'Símbolo obrigatório' });
      return;
    }
    const ticker = await kucoinSpotClient.getSpotTicker(symbol);
    res.json({ success: true, data: ticker });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter ticker Spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/tickers - Todos os tickers Spot
app.get('/api/integrations/trading/spot/tickers', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  try {
    const tickers = await kucoinSpotClient.getSpotAllTickers();
    res.json({ success: true, data: tickers });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter todos tickers Spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/trades/:symbol - Trades recentes Spot
app.get('/api/integrations/trading/spot/trades/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    if (!symbol) {
      res.status(400).json({ error: 'Símbolo obrigatório' });
      return;
    }
    const trades = await kucoinSpotClient.getSpotTrades(symbol);
    res.json({ success: true, data: trades });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter trades Spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/accounts - Contas Spot
app.get('/api/integrations/trading/spot/accounts', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinSpotClient.isSpotConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const type = (req.query.type as 'trade' | 'main' | 'margin' | 'isolated') || 'trade';
    const accounts = await kucoinSpotClient.getSpotAccounts(type);
    res.json({ success: true, data: accounts });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter contas Spot');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/spot/orders - Criar ordem Spot
app.post('/api/integrations/trading/spot/orders', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinSpotClient.isSpotConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const bodySchema = z.object({
      clientOid: z.string().min(1),
      symbol: z.string().min(1),
      side: z.enum(['buy', 'sell']),
      type: z.enum(['limit', 'market']),
      price: z.string().optional(),
      size: z.string().optional(),
      funds: z.string().optional(),
      timeInForce: z.enum(['GTC', 'GTT', 'IOC', 'FOK']).optional(),
      cancelAfter: z.number().optional(),
      postOnly: z.boolean().optional(),
      hidden: z.boolean().optional(),
      iceberg: z.boolean().optional(),
      visibleSize: z.string().optional(),
      remark: z.string().optional(),
      stp: z.enum(['CN', 'CO', 'CB', 'DC']).optional(),
    });
    const bodyResult = bodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Parâmetros inválidos', details: bodyResult.error.flatten() });
      return;
    }
    const result = await kucoinSpotClient.createSpotOrder(bodyResult.data);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao criar ordem Spot');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/spot/orders/:orderId - Cancelar ordem Spot por ID
app.delete('/api/integrations/trading/spot/orders/:orderId', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinSpotClient.isSpotConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const { orderId } = req.params;
    if (!orderId) {
      res.status(400).json({ error: 'orderId obrigatório' });
      return;
    }
    const result = await kucoinSpotClient.cancelSpotOrder(orderId);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar ordem Spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/orders/:orderId - Detalhes de ordem Spot
app.get('/api/integrations/trading/spot/orders/:orderId', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinSpotClient.isSpotConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const { orderId } = req.params;
    if (!orderId) {
      res.status(400).json({ error: 'orderId obrigatório' });
      return;
    }
    const order = await kucoinSpotClient.getSpotOrder(orderId);
    res.json({ success: true, data: order });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter ordem Spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/orders/open - Ordens abertas Spot
app.get('/api/integrations/trading/spot/orders/open', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinSpotClient.isSpotConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const symbol = req.query.symbol as string | undefined;
    const orders = await kucoinSpotClient.getOpenSpotOrders(symbol);
    res.json({ success: true, data: orders });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter ordens abertas Spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/orders/closed - Ordens fechadas Spot
app.get('/api/integrations/trading/spot/orders/closed', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinSpotClient.isSpotConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const symbol = req.query.symbol as string | undefined;
    const orders = await kucoinSpotClient.getClosedSpotOrders(symbol);
    res.json({ success: true, data: orders });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter ordens fechadas Spot');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/spot/stop-orders - Criar stop order Spot
app.post('/api/integrations/trading/spot/stop-orders', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinSpotClient.isSpotConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const bodySchema = z.object({
      clientOid: z.string().min(1),
      symbol: z.string().min(1),
      side: z.enum(['buy', 'sell']),
      type: z.enum(['limit', 'market']),
      stopPrice: z.string().min(1),
      price: z.string().optional(),
      size: z.string().optional(),
      funds: z.string().optional(),
      timeInForce: z.enum(['GTC', 'GTT', 'IOC', 'FOK']).optional(),
      cancelAfter: z.number().optional(),
      remark: z.string().optional(),
      stp: z.enum(['CN', 'CO', 'CB', 'DC']).optional(),
      tradeType: z.enum(['TRADE', 'MARGIN_TRADE', 'MARGIN_ISOLATED_TRADE']).optional(),
    });
    const bodyResult = bodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Parâmetros inválidos', details: bodyResult.error.flatten() });
      return;
    }
    const result = await kucoinSpotClient.createSpotStopOrder(bodyResult.data);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao criar stop order Spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/stop-orders - Listar stop orders Spot
app.get('/api/integrations/trading/spot/stop-orders', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinSpotClient.isSpotConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const symbol = req.query.symbol as string | undefined;
    const orders = await kucoinSpotClient.getSpotStopOrders(symbol);
    res.json({ success: true, data: orders });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter stop orders Spot');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/spot/stop-orders/:orderId - Cancelar stop order Spot
app.delete('/api/integrations/trading/spot/stop-orders/:orderId', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinSpotClient.isSpotConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const { orderId } = req.params;
    if (!orderId) {
      res.status(400).json({ error: 'orderId obrigatório' });
      return;
    }
    const result = await kucoinSpotClient.cancelSpotStopOrder(orderId);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar stop order Spot');
    res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// FASE 3 - Spot OCO Orders
// ============================================================================

const createSpotOcoOrderSchema = z.object({
  clientOid: z.string().min(1),
  symbol: z.string().min(1),
  side: z.enum(['buy', 'sell']),
  price: z.string().min(1),
  size: z.string().min(1),
  stopPrice: z.string().min(1),
  limitPrice: z.string().min(1),
  tradeType: z.literal('TRADE').optional(),
  remark: z.string().optional(),
});

// Criar OCO order Spot
app.post('/api/integrations/trading/spot/oco-orders', requirePermission('integrations:trading:write'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const params = createSpotOcoOrderSchema.parse(req.body);
    const result = await kucoinSpotClient.createSpotOcoOrder(params);
    res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Parâmetros inválidos', details: error.errors });
      return;
    }
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao criar OCO order Spot');
    res.status(500).json({ error: errorMessage });
  }
});

// Cancelar OCO order Spot por orderId
app.delete('/api/integrations/trading/spot/oco-orders/:orderId', requirePermission('integrations:trading:write'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { orderId } = req.params;
    const result = await kucoinSpotClient.cancelSpotOcoOrder(orderId);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar OCO order Spot');
    res.status(500).json({ error: errorMessage });
  }
});

// Cancelar OCO order Spot por clientOid
app.delete('/api/integrations/trading/spot/oco-orders/by-client-oid/:clientOid', requirePermission('integrations:trading:write'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { clientOid } = req.params;
    const result = await kucoinSpotClient.cancelSpotOcoOrderByClientOid(clientOid);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar OCO order Spot por clientOid');
    res.status(500).json({ error: errorMessage });
  }
});

// Cancelar todas OCO orders Spot
app.delete('/api/integrations/trading/spot/oco-orders/all', requirePermission('integrations:trading:write'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const symbol = req.query.symbol as string | undefined;
    const orderIds = req.query.orderIds as string | undefined;
    const result = await kucoinSpotClient.cancelAllSpotOcoOrders(symbol, orderIds);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar todas OCO orders Spot');
    res.status(500).json({ error: errorMessage });
  }
});

// Obter OCO order Spot por orderId
app.get('/api/integrations/trading/spot/oco-orders/:orderId', requirePermission('integrations:trading:read'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { orderId } = req.params;
    const result = await kucoinSpotClient.getSpotOcoOrder(orderId);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter OCO order Spot');
    res.status(500).json({ error: errorMessage });
  }
});

// Obter OCO order Spot por clientOid
app.get('/api/integrations/trading/spot/oco-orders/by-client-oid/:clientOid', requirePermission('integrations:trading:read'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { clientOid } = req.params;
    const result = await kucoinSpotClient.getSpotOcoOrderByClientOid(clientOid);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter OCO order Spot por clientOid');
    res.status(500).json({ error: errorMessage });
  }
});

// Listar OCO orders Spot
app.get('/api/integrations/trading/spot/oco-orders', requirePermission('integrations:trading:read'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const params = {
      symbol: req.query.symbol as string | undefined,
      orderIds: req.query.orderIds as string | undefined,
      startAt: req.query.startAt ? Number(req.query.startAt) : undefined,
      endAt: req.query.endAt ? Number(req.query.endAt) : undefined,
      currentPage: req.query.currentPage ? Number(req.query.currentPage) : undefined,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
    };
    const result = await kucoinSpotClient.getSpotOcoOrders(params);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao listar OCO orders Spot');
    res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// FASE 3 - Spot Batch Orders, Cancel by ClientOid, Cancel All, Modify
// ============================================================================

const batchSpotOrderSchema = z.object({
  orderList: z.array(z.object({
    clientOid: z.string().min(1),
    side: z.enum(['buy', 'sell']),
    symbol: z.string().min(1),
    type: z.enum(['limit', 'market']),
    price: z.string().optional(),
    size: z.string().optional(),
    funds: z.string().optional(),
    timeInForce: z.enum(['GTC', 'IOC', 'FOK']).optional(),
    remark: z.string().optional(),
  })).min(1).max(5),
});

const modifySpotOrderSchema = z.object({
  symbol: z.string().min(1),
  orderId: z.string().optional(),
  clientOid: z.string().optional(),
  newPrice: z.string().optional(),
  newSize: z.string().optional(),
});

// Batch create spot orders
app.post('/api/integrations/trading/spot/orders/batch', requirePermission('integrations:trading:write'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { orderList } = batchSpotOrderSchema.parse(req.body);
    const result = await kucoinSpotClient.batchCreateSpotOrders(orderList);
    res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Parâmetros inválidos', details: error.errors });
      return;
    }
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao criar batch spot orders');
    res.status(500).json({ error: errorMessage });
  }
});

// Cancelar spot order por clientOid
app.delete('/api/integrations/trading/spot/orders/by-client-oid/:clientOid', requirePermission('integrations:trading:write'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { clientOid } = req.params;
    const symbol = req.query.symbol as string;
    if (!symbol) {
      res.status(400).json({ error: 'Query param symbol é obrigatório' });
      return;
    }
    const result = await kucoinSpotClient.cancelSpotOrderByClientOid(clientOid, symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar spot order por clientOid');
    res.status(500).json({ error: errorMessage });
  }
});

// Cancelar todas spot orders
app.delete('/api/integrations/trading/spot/orders/all', requirePermission('integrations:trading:write'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const symbol = req.query.symbol as string | undefined;
    const result = await kucoinSpotClient.cancelAllSpotOrders(symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar todas spot orders');
    res.status(500).json({ error: errorMessage });
  }
});

// Cancelar todas stop orders Spot
app.delete('/api/integrations/trading/spot/stop-orders/all', requirePermission('integrations:trading:write'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const symbol = req.query.symbol as string | undefined;
    const result = await kucoinSpotClient.cancelAllSpotStopOrders(symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar todas stop orders Spot');
    res.status(500).json({ error: errorMessage });
  }
});

// Modificar ordem Spot
app.post('/api/integrations/trading/spot/orders/modify', requirePermission('integrations:trading:write'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const params = modifySpotOrderSchema.parse(req.body);
    const result = await kucoinSpotClient.modifySpotOrder(params);
    res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Parâmetros inválidos', details: error.errors });
      return;
    }
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao modificar spot order');
    res.status(500).json({ error: errorMessage });
  }
});

// --- SPOT: Market Data Avançado + Ordens Avançadas (cobertura 100%) ---

// GET /api/integrations/trading/spot/announcements - Anúncios de novos pares Spot
app.get('/api/integrations/trading/spot/announcements', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  try {
    const data = await kucoinSpotClient.getSpotAnnouncements();
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar anúncios spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/currency/:currency - Detalhes de uma moeda Spot
app.get('/api/integrations/trading/spot/currency/:currency', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const { currency } = req.params;
    const data = await kucoinSpotClient.getSpotCurrency(currency);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar moeda spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/symbol/:symbol - Detalhes de um par Spot
app.get('/api/integrations/trading/spot/symbol/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const data = await kucoinSpotClient.getSpotSymbol(symbol);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar símbolo spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/orderbook/full/:symbol - Order book completo Spot (L3)
app.get('/api/integrations/trading/spot/orderbook/full/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const data = await kucoinSpotClient.getFullSpotOrderBook(symbol);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar orderbook completo spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/orderbook/call-auction/:symbol - Order book leilão Spot
app.get('/api/integrations/trading/spot/orderbook/call-auction/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const data = await kucoinSpotClient.getCallAuctionOrderBook(symbol);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar orderbook leilão spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/call-auction/:symbol - Informações de leilão Spot
app.get('/api/integrations/trading/spot/call-auction/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const data = await kucoinSpotClient.getCallAuctionInfo(symbol);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar info leilão spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/fiat-price - Preço fiat de moedas
app.get('/api/integrations/trading/spot/fiat-price', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const base = req.query.base as string | undefined;
    const currencies = req.query.currencies as string | undefined;
    const data = await kucoinSpotClient.getFiatPrice({ base, currencies });
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar preço fiat');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/stats/:symbol - Estatísticas 24h Spot
app.get('/api/integrations/trading/spot/stats/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const data = await kucoinSpotClient.getSpot24hrStats(symbol);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar stats 24h spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/markets - Lista de mercados Spot
app.get('/api/integrations/trading/spot/markets', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  try {
    const data = await kucoinSpotClient.getSpotMarketList();
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar mercados spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/server-time - Hora do servidor Spot
app.get('/api/integrations/trading/spot/server-time', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  try {
    const data = await kucoinSpotClient.getSpotServerTime();
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar hora servidor spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/service-status - Status do serviço Spot
app.get('/api/integrations/trading/spot/service-status', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  try {
    const data = await kucoinSpotClient.getSpotServiceStatus();
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar status serviço spot');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/spot/orders/sync - Criar ordem Spot síncrona
app.post('/api/integrations/trading/spot/orders/sync', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const result = await kucoinSpotClient.createSpotOrderSync(req.body);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao criar spot order sync');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/spot/orders/test - Criar ordem Spot teste
app.post('/api/integrations/trading/spot/orders/test', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const result = await kucoinSpotClient.createSpotOrderTest(req.body);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao criar spot order teste');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/spot/orders/batch/sync - Criar batch ordens Spot síncronas
app.post('/api/integrations/trading/spot/orders/batch/sync', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { orderList } = req.body;
    const result = await kucoinSpotClient.batchCreateSpotOrdersSync(orderList);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao criar batch spot orders sync');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/spot/orders/:orderId/sync - Cancelar ordem Spot síncrona
app.delete('/api/integrations/trading/spot/orders/:orderId/sync', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { orderId } = req.params;
    const symbol = req.query.symbol as string;
    if (!symbol) { res.status(400).json({ error: 'symbol é obrigatório' }); return; }
    const result = await kucoinSpotClient.cancelSpotOrderSync(orderId, symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar spot order sync');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/spot/orders/by-client-oid/:clientOid/sync - Cancelar ordem Spot por clientOid síncrona
app.delete('/api/integrations/trading/spot/orders/by-client-oid/:clientOid/sync', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { clientOid } = req.params;
    const symbol = req.query.symbol as string;
    if (!symbol) { res.status(400).json({ error: 'symbol é obrigatório' }); return; }
    const result = await kucoinSpotClient.cancelSpotOrderByClientOidSync(clientOid, symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar spot order por clientOid sync');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/spot/orders/:orderId/partial - Cancelar parcialmente ordem Spot
app.delete('/api/integrations/trading/spot/orders/:orderId/partial', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { orderId } = req.params;
    const { cancelSize, symbol } = req.body;
    const result = await kucoinSpotClient.cancelPartialSpotOrder(orderId, cancelSize, symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar parcialmente spot order');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/spot/orders/by-symbol/:symbol - Cancelar ordens Spot por símbolo
app.delete('/api/integrations/trading/spot/orders/by-symbol/:symbol', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { symbol } = req.params;
    const result = await kucoinSpotClient.cancelSpotOrdersBySymbol(symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar spot orders por símbolo');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/orders/by-client-oid/:clientOid/detail - Detalhes ordem Spot por clientOid
app.get('/api/integrations/trading/spot/orders/by-client-oid/:clientOid/detail', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { clientOid } = req.params;
    const symbol = req.query.symbol as string;
    if (!symbol) { res.status(400).json({ error: 'symbol é obrigatório' }); return; }
    const result = await kucoinSpotClient.getSpotOrderByClientOid(clientOid, symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar spot order por clientOid');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/orders/symbols-with-open - Símbolos com ordens abertas
app.get('/api/integrations/trading/spot/orders/symbols-with-open', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const data = await kucoinSpotClient.getSymbolsWithOpenOrder();
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar símbolos com ordens abertas');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/orders/open/paged - Ordens abertas Spot paginadas
app.get('/api/integrations/trading/spot/orders/open/paged', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const symbol = req.query.symbol as string;
    if (!symbol) { res.status(400).json({ error: 'symbol é obrigatório' }); return; }
    const currentPage = req.query.currentPage ? Number(req.query.currentPage) : undefined;
    const pageSize = req.query.pageSize ? Number(req.query.pageSize) : undefined;
    const data = await kucoinSpotClient.getOpenSpotOrdersByPage({ symbol, currentPage, pageSize });
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar ordens abertas paginadas');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/fills - Histórico de trades Spot
app.get('/api/integrations/trading/spot/fills', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const symbol = req.query.symbol as string;
    if (!symbol) { res.status(400).json({ error: 'symbol é obrigatório' }); return; }
    const data = await kucoinSpotClient.getSpotTradeHistory({
      symbol,
      orderId: req.query.orderId as string | undefined,
      side: req.query.side as 'buy' | 'sell' | undefined,
      type: req.query.type as 'limit' | 'market' | undefined,
      startAt: req.query.startAt ? Number(req.query.startAt) : undefined,
      endAt: req.query.endAt ? Number(req.query.endAt) : undefined,
    });
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar fills spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/dcp - Obter configuração DCP (Disconnect Cancel Protection)
app.get('/api/integrations/trading/spot/dcp', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const data = await kucoinSpotClient.getSpotDCP();
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar DCP spot');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/spot/dcp - Configurar DCP (Disconnect Cancel Protection)
app.post('/api/integrations/trading/spot/dcp', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { timeout, symbols } = req.body;
    const data = await kucoinSpotClient.setSpotDCP(timeout, symbols);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao configurar DCP spot');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/spot/stop-orders/by-client-oid/:clientOid - Cancelar stop order Spot por clientOid
app.delete('/api/integrations/trading/spot/stop-orders/by-client-oid/:clientOid', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { clientOid } = req.params;
    const symbol = req.query.symbol as string | undefined;
    const result = await kucoinSpotClient.cancelSpotStopOrderByClientOid(clientOid, symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar stop order spot por clientOid');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/stop-orders/:orderId/detail - Detalhes stop order Spot por ID
app.get('/api/integrations/trading/spot/stop-orders/:orderId/detail', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { orderId } = req.params;
    const data = await kucoinSpotClient.getSpotStopOrderById(orderId);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar detalhes stop order spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/stop-orders/by-client-oid/:clientOid - Detalhes stop order Spot por clientOid
app.get('/api/integrations/trading/spot/stop-orders/by-client-oid/:clientOid', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { clientOid } = req.params;
    const data = await kucoinSpotClient.getSpotStopOrderByClientOid(clientOid);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar stop order spot por clientOid');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/spot/oco-orders/:orderId/detail - Detalhes OCO Spot com sub-orders
app.get('/api/integrations/trading/spot/oco-orders/:orderId/detail', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { orderId } = req.params;
    const data = await kucoinSpotClient.getSpotOcoOrderDetail(orderId);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar detalhes OCO spot');
    res.status(500).json({ error: errorMessage });
  }
});

// --- MARGIN: Symbols, Accounts, Orders, Stop Orders ---

// GET /api/integrations/trading/margin/symbols/cross - Símbolos margin cross
app.get('/api/integrations/trading/margin/symbols/cross', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const symbol = req.query.symbol as string | undefined;
    const symbols = await kucoinMarginClient.getCrossMarginSymbols(symbol);
    res.json({ success: true, data: symbols });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter símbolos margin cross');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/margin/symbols/isolated - Símbolos margin isolated
app.get('/api/integrations/trading/margin/symbols/isolated', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  try {
    const symbols = await kucoinMarginClient.getIsolatedMarginSymbols();
    res.json({ success: true, data: symbols });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter símbolos margin isolated');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/margin/account/cross - Conta margin cross
app.get('/api/integrations/trading/margin/account/cross', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinMarginClient.isMarginConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const quoteCurrency = req.query.quoteCurrency as string | undefined;
    const account = await kucoinMarginClient.getCrossMarginAccount(quoteCurrency);
    res.json({ success: true, data: account });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter conta margin cross');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/margin/account/isolated - Conta margin isolated
app.get('/api/integrations/trading/margin/account/isolated', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinMarginClient.isMarginConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const symbol = req.query.symbol as string | undefined;
    const quoteCurrency = req.query.quoteCurrency as string | undefined;
    const account = await kucoinMarginClient.getIsolatedMarginAccount(symbol, quoteCurrency);
    res.json({ success: true, data: account });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter conta margin isolated');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/margin/orders - Criar ordem Margin
app.post('/api/integrations/trading/margin/orders', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinMarginClient.isMarginConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const bodySchema = z.object({
      clientOid: z.string().min(1),
      symbol: z.string().min(1),
      side: z.enum(['buy', 'sell']),
      type: z.enum(['limit', 'market']),
      price: z.string().optional(),
      size: z.string().optional(),
      funds: z.string().optional(),
      timeInForce: z.enum(['GTC', 'GTT', 'IOC', 'FOK']).optional(),
      cancelAfter: z.number().optional(),
      postOnly: z.boolean().optional(),
      hidden: z.boolean().optional(),
      iceberg: z.boolean().optional(),
      visibleSize: z.string().optional(),
      remark: z.string().optional(),
      stp: z.enum(['CN', 'CO', 'CB', 'DC']).optional(),
      isIsolated: z.boolean().optional(),
      autoBorrow: z.boolean().optional(),
      autoRepay: z.boolean().optional(),
    });
    const bodyResult = bodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Parâmetros inválidos', details: bodyResult.error.flatten() });
      return;
    }
    const result = await kucoinMarginClient.createMarginOrder(bodyResult.data);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao criar ordem Margin');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/margin/orders/:orderId - Cancelar ordem Margin
app.delete('/api/integrations/trading/margin/orders/:orderId', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinMarginClient.isMarginConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const { orderId } = req.params;
    if (!orderId) {
      res.status(400).json({ error: 'orderId obrigatório' });
      return;
    }
    const result = await kucoinMarginClient.cancelMarginOrder(orderId);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar ordem Margin');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/margin/orders/:orderId - Detalhes de ordem Margin
app.get('/api/integrations/trading/margin/orders/:orderId', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinMarginClient.isMarginConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const { orderId } = req.params;
    if (!orderId) {
      res.status(400).json({ error: 'orderId obrigatório' });
      return;
    }
    const order = await kucoinMarginClient.getMarginOrder(orderId);
    res.json({ success: true, data: order });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter ordem Margin');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/margin/orders/open - Ordens abertas Margin
app.get('/api/integrations/trading/margin/orders/open', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  try {
    if (!kucoinMarginClient.isMarginConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const orders = await kucoinMarginClient.getOpenMarginOrders();
    res.json({ success: true, data: orders });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter ordens abertas Margin');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/margin/orders/closed - Ordens fechadas Margin
app.get('/api/integrations/trading/margin/orders/closed', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  try {
    if (!kucoinMarginClient.isMarginConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const orders = await kucoinMarginClient.getClosedMarginOrders();
    res.json({ success: true, data: orders });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter ordens fechadas Margin');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/margin/stop-orders - Criar stop order Margin
app.post('/api/integrations/trading/margin/stop-orders', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinMarginClient.isMarginConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const bodySchema = z.object({
      clientOid: z.string().min(1),
      symbol: z.string().min(1),
      side: z.enum(['buy', 'sell']),
      type: z.enum(['limit', 'market']),
      stopPrice: z.string().min(1),
      price: z.string().optional(),
      size: z.string().optional(),
      funds: z.string().optional(),
      timeInForce: z.enum(['GTC', 'GTT', 'IOC', 'FOK']).optional(),
      cancelAfter: z.number().optional(),
      remark: z.string().optional(),
      stp: z.enum(['CN', 'CO', 'CB', 'DC']).optional(),
      isIsolated: z.boolean().optional(),
      tradeType: z.enum(['MARGIN_TRADE', 'MARGIN_ISOLATED_TRADE']).optional(),
    });
    const bodyResult = bodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Parâmetros inválidos', details: bodyResult.error.flatten() });
      return;
    }
    const result = await kucoinMarginClient.createMarginStopOrder(bodyResult.data);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao criar stop order Margin');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/margin/stop-orders - Listar stop orders Margin
app.get('/api/integrations/trading/margin/stop-orders', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  try {
    if (!kucoinMarginClient.isMarginConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const orders = await kucoinMarginClient.getMarginStopOrders();
    res.json({ success: true, data: orders });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter stop orders Margin');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/margin/stop-orders/:orderId - Cancelar stop order Margin
app.delete('/api/integrations/trading/margin/stop-orders/:orderId', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    if (!kucoinMarginClient.isMarginConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }
    const { orderId } = req.params;
    if (!orderId) {
      res.status(400).json({ error: 'orderId obrigatório' });
      return;
    }
    const result = await kucoinMarginClient.cancelMarginStopOrder(orderId);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar stop order Margin');
    res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// FASE 4 - Margin OCO Orders
// ============================================================================

const createMarginOcoOrderSchema = z.object({
  clientOid: z.string().min(1),
  symbol: z.string().min(1),
  side: z.enum(['buy', 'sell']),
  price: z.string().min(1),
  size: z.string().min(1),
  stopPrice: z.string().min(1),
  limitPrice: z.string().min(1),
  tradeType: z.enum(['MARGIN_TRADE', 'MARGIN_ISOLATED_TRADE']).optional(),
  remark: z.string().optional(),
});

// Criar OCO order Margin
app.post('/api/integrations/trading/margin/oco-orders', requirePermission('integrations:trading:write'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const params = createMarginOcoOrderSchema.parse(req.body);
    const result = await kucoinMarginClient.createMarginOcoOrder(params);
    res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Parâmetros inválidos', details: error.errors });
      return;
    }
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao criar OCO order Margin');
    res.status(500).json({ error: errorMessage });
  }
});

// Cancelar OCO order Margin por orderId
app.delete('/api/integrations/trading/margin/oco-orders/:orderId', requirePermission('integrations:trading:write'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { orderId } = req.params;
    const result = await kucoinMarginClient.cancelMarginOcoOrder(orderId);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar OCO order Margin');
    res.status(500).json({ error: errorMessage });
  }
});

// Cancelar OCO order Margin por clientOid
app.delete('/api/integrations/trading/margin/oco-orders/by-client-oid/:clientOid', requirePermission('integrations:trading:write'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { clientOid } = req.params;
    const result = await kucoinMarginClient.cancelMarginOcoOrderByClientOid(clientOid);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar OCO order Margin por clientOid');
    res.status(500).json({ error: errorMessage });
  }
});

// Cancelar todas OCO orders Margin
app.delete('/api/integrations/trading/margin/oco-orders/all', requirePermission('integrations:trading:write'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const symbol = req.query.symbol as string | undefined;
    const orderIds = req.query.orderIds as string | undefined;
    const result = await kucoinMarginClient.cancelAllMarginOcoOrders(symbol, orderIds);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar todas OCO orders Margin');
    res.status(500).json({ error: errorMessage });
  }
});

// Obter OCO order Margin por orderId
app.get('/api/integrations/trading/margin/oco-orders/:orderId', requirePermission('integrations:trading:read'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { orderId } = req.params;
    const result = await kucoinMarginClient.getMarginOcoOrder(orderId);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter OCO order Margin');
    res.status(500).json({ error: errorMessage });
  }
});

// Obter OCO order Margin por clientOid
app.get('/api/integrations/trading/margin/oco-orders/by-client-oid/:clientOid', requirePermission('integrations:trading:read'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { clientOid } = req.params;
    const result = await kucoinMarginClient.getMarginOcoOrderByClientOid(clientOid);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter OCO order Margin por clientOid');
    res.status(500).json({ error: errorMessage });
  }
});

// Listar OCO orders Margin
app.get('/api/integrations/trading/margin/oco-orders', requirePermission('integrations:trading:read'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const params = {
      symbol: req.query.symbol as string | undefined,
      orderIds: req.query.orderIds as string | undefined,
      startAt: req.query.startAt ? Number(req.query.startAt) : undefined,
      endAt: req.query.endAt ? Number(req.query.endAt) : undefined,
      currentPage: req.query.currentPage ? Number(req.query.currentPage) : undefined,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
    };
    const result = await kucoinMarginClient.getMarginOcoOrders(params);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao listar OCO orders Margin');
    res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// FASE 4 - Margin Debit (Borrow/Repay/Interest)
// ============================================================================

const borrowMarginSchema = z.object({
  currency: z.string().min(1),
  size: z.string().min(1),
  timeInForce: z.enum(['IOC', 'FOK']),
  isIsolated: z.boolean().optional(),
  symbol: z.string().optional(),
  isHf: z.boolean().optional(),
});

const repayMarginSchema = z.object({
  currency: z.string().min(1),
  size: z.string().min(1),
  isIsolated: z.boolean().optional(),
  symbol: z.string().optional(),
  isHf: z.boolean().optional(),
});

// Emprestar (borrow) moeda Margin
app.post('/api/integrations/trading/margin/borrow', requirePermission('integrations:trading:write'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const params = borrowMarginSchema.parse(req.body);
    const result = await kucoinMarginClient.borrowMargin(params);
    res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Parâmetros inválidos', details: error.errors });
      return;
    }
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao realizar borrow Margin');
    res.status(500).json({ error: errorMessage });
  }
});

// Pagar (repay) empréstimo Margin
app.post('/api/integrations/trading/margin/repay', requirePermission('integrations:trading:write'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const params = repayMarginSchema.parse(req.body);
    const result = await kucoinMarginClient.repayMargin(params);
    res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Parâmetros inválidos', details: error.errors });
      return;
    }
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao realizar repay Margin');
    res.status(500).json({ error: errorMessage });
  }
});

// Histórico de borrows
app.get('/api/integrations/trading/margin/borrow', requirePermission('integrations:trading:read'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const params = {
      currency: req.query.currency as string | undefined,
      isIsolated: req.query.isIsolated === 'true' ? true : req.query.isIsolated === 'false' ? false : undefined,
      symbol: req.query.symbol as string | undefined,
      orderNo: req.query.orderNo as string | undefined,
      startTime: req.query.startTime ? Number(req.query.startTime) : undefined,
      endTime: req.query.endTime ? Number(req.query.endTime) : undefined,
      currentPage: req.query.currentPage ? Number(req.query.currentPage) : undefined,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
    };
    const result = await kucoinMarginClient.getBorrowHistory(params);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter histórico de borrows');
    res.status(500).json({ error: errorMessage });
  }
});

// Histórico de repays
app.get('/api/integrations/trading/margin/repay', requirePermission('integrations:trading:read'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const params = {
      currency: req.query.currency as string | undefined,
      isIsolated: req.query.isIsolated === 'true' ? true : req.query.isIsolated === 'false' ? false : undefined,
      symbol: req.query.symbol as string | undefined,
      orderNo: req.query.orderNo as string | undefined,
      startTime: req.query.startTime ? Number(req.query.startTime) : undefined,
      endTime: req.query.endTime ? Number(req.query.endTime) : undefined,
      currentPage: req.query.currentPage ? Number(req.query.currentPage) : undefined,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
    };
    const result = await kucoinMarginClient.getRepayHistory(params);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter histórico de repays');
    res.status(500).json({ error: errorMessage });
  }
});

// Histórico de juros
app.get('/api/integrations/trading/margin/interest', requirePermission('integrations:trading:read'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const params = {
      currency: req.query.currency as string | undefined,
      isIsolated: req.query.isIsolated === 'true' ? true : req.query.isIsolated === 'false' ? false : undefined,
      symbol: req.query.symbol as string | undefined,
      startTime: req.query.startTime ? Number(req.query.startTime) : undefined,
      endTime: req.query.endTime ? Number(req.query.endTime) : undefined,
      currentPage: req.query.currentPage ? Number(req.query.currentPage) : undefined,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
    };
    const result = await kucoinMarginClient.getInterestHistory(params);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter histórico de juros');
    res.status(500).json({ error: errorMessage });
  }
});

// Obter taxas de juros de empréstimo
app.get('/api/integrations/trading/margin/lending-rates', requirePermission('integrations:trading:read'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const currency = req.query.currency as string | undefined;
    const result = await kucoinMarginClient.getLendingRates(currency);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter taxas de juros');
    res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// FASE 4 - Cancelar Margin Order por ClientOid + Modificar Leverage
// ============================================================================

// Cancelar Margin Order por clientOid
app.delete('/api/integrations/trading/margin/orders/by-client-oid/:clientOid', requirePermission('integrations:trading:write'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { clientOid } = req.params;
    const result = await kucoinMarginClient.cancelMarginOrderByClientOid(clientOid);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar Margin order por clientOid');
    res.status(500).json({ error: errorMessage });
  }
});

// Modificar leverage Cross Margin
app.post('/api/integrations/trading/margin/leverage', requirePermission('integrations:trading:write'), async (req, res) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const leverageSchema = z.object({ leverage: z.number().int().min(1).max(10) });
    const { leverage } = leverageSchema.parse(req.body);
    const result = await kucoinMarginClient.updateCrossMarginLeverage(leverage);
    res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Parâmetros inválidos', details: error.errors });
      return;
    }
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao modificar leverage Margin');
    res.status(500).json({ error: errorMessage });
  }
});

// --- MARGIN: Market Data Avançado + Ordens Avançadas (cobertura 100%) ---

// GET /api/integrations/trading/margin/etf-info - Info ETF Margin
app.get('/api/integrations/trading/margin/etf-info', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const currency = req.query.currency as string | undefined;
    const data = await kucoinMarginClient.getMarginETFInfo(currency);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar ETF info margin');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/margin/mark-price/:symbol - Mark price de um símbolo
app.get('/api/integrations/trading/margin/mark-price/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const data = await kucoinMarginClient.getMarkPriceDetail(symbol);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar mark price margin');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/margin/config - Configuração geral Margin
app.get('/api/integrations/trading/margin/config', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  try {
    const data = await kucoinMarginClient.getMarginConfig();
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar config margin');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/margin/mark-prices - Lista de mark prices
app.get('/api/integrations/trading/margin/mark-prices', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  try {
    const data = await kucoinMarginClient.getMarkPriceList();
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar mark prices margin');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/margin/collateral-ratio - Collateral ratio
app.get('/api/integrations/trading/margin/collateral-ratio', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  try {
    const data = await kucoinMarginClient.getMarginCollateralRatio();
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar collateral ratio margin');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/margin/currencies - Moedas disponíveis para margin
app.get('/api/integrations/trading/margin/currencies', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const type = req.query.type as string | undefined;
    const data = await kucoinMarginClient.getMarginAvailableInventory(type);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar moedas margin');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/margin/orders/test - Criar ordem Margin teste
app.post('/api/integrations/trading/margin/orders/test', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const result = await kucoinMarginClient.createMarginOrderTest(req.body);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao criar margin order teste');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/margin/orders/by-symbol/:symbol - Cancelar todas ordens por símbolo
app.delete('/api/integrations/trading/margin/orders/by-symbol/:symbol', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { symbol } = req.params;
    const tradeType = req.query.tradeType as string | undefined;
    const result = await kucoinMarginClient.cancelAllMarginOrdersBySymbol(symbol, tradeType);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar margin orders por símbolo');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/margin/orders/symbols-with-open - Símbolos com ordens abertas
app.get('/api/integrations/trading/margin/orders/symbols-with-open', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const tradeType = req.query.tradeType as string | undefined;
    const data = await kucoinMarginClient.getMarginSymbolsWithOpenOrder(tradeType);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar símbolos com ordens abertas margin');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/margin/fills - Histórico de fills Margin
app.get('/api/integrations/trading/margin/fills', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const params: Record<string, string | undefined> = {
      symbol: req.query.symbol as string | undefined,
      orderId: req.query.orderId as string | undefined,
      side: req.query.side as string | undefined,
      type: req.query.type as string | undefined,
      tradeType: req.query.tradeType as string | undefined,
      startAt: req.query.startAt as string | undefined,
      endAt: req.query.endAt as string | undefined,
    };
    const cleanParams = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
    const data = await kucoinMarginClient.getMarginTradeHistory(cleanParams as Record<string, string>);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar fills margin');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/margin/orders/by-client-oid/:clientOid - Ordem Margin por clientOid
app.get('/api/integrations/trading/margin/orders/by-client-oid/:clientOid', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { clientOid } = req.params;
    const symbol = req.query.symbol as string;
    if (!symbol) {
      res.status(400).json({ error: 'Parâmetro symbol é obrigatório' });
      return;
    }
    const data = await kucoinMarginClient.getMarginOrderByClientOid(clientOid, symbol);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar margin order por clientOid');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/margin/stop-orders/by-client-oid/:clientOid - Cancelar stop order por clientOid
app.delete('/api/integrations/trading/margin/stop-orders/by-client-oid/:clientOid', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { clientOid } = req.params;
    const symbol = req.query.symbol as string | undefined;
    const result = await kucoinMarginClient.cancelMarginStopOrderByClientOid(clientOid, symbol);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar stop order margin por clientOid');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/margin/stop-orders/all - Cancelar todas stop orders Margin
app.delete('/api/integrations/trading/margin/stop-orders/all', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const params: Record<string, string | undefined> = {
      symbol: req.query.symbol as string | undefined,
      tradeType: req.query.tradeType as string | undefined,
    };
    const cleanParams = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
    const result = await kucoinMarginClient.cancelAllMarginStopOrders(cleanParams as Record<string, string>);
    res.json({ success: true, data: result });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar todas stop orders margin');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/margin/stop-orders/:orderId/detail - Detalhes stop order por ID
app.get('/api/integrations/trading/margin/stop-orders/:orderId/detail', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { orderId } = req.params;
    const data = await kucoinMarginClient.getMarginStopOrderById(orderId);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar stop order margin por ID');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/margin/stop-orders/by-client-oid/:clientOid - Detalhes stop order por clientOid
app.get('/api/integrations/trading/margin/stop-orders/by-client-oid/:clientOid', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinClient.isKucoinConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { clientOid } = req.params;
    const symbol = req.query.symbol as string | undefined;
    const data = await kucoinMarginClient.getMarginStopOrderByClientOid(clientOid, symbol);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar stop order margin por clientOid');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/margin/risk-limit - Risk limit para moedas margin
app.get('/api/integrations/trading/margin/risk-limit', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const isIsolated = req.query.isIsolated === 'true';
    const symbol = req.query.symbol as string | undefined;
    const data = await kucoinMarginClient.getMarginRiskLimit(isIsolated, symbol);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar risk limit margin');
    res.status(500).json({ error: errorMessage });
  }
});

// --- ACCOUNT MANAGEMENT: Funding, Sub-Accounts, Deposits, Withdrawals, Transfers, Fees ---

// GET /api/integrations/trading/account/summary - Resumo da conta
app.get('/api/integrations/trading/account/summary', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  if (!kucoinAccountClient.isAccountConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const data = await kucoinAccountClient.getAccountSummaryInfo();
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar resumo da conta');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/account/apikey - Info da API key
app.get('/api/integrations/trading/account/apikey', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  if (!kucoinAccountClient.isAccountConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const data = await kucoinAccountClient.getApikeyInfo();
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar info da API key');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/account/type/spot - Tipo de conta Spot
app.get('/api/integrations/trading/account/type/spot', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  if (!kucoinAccountClient.isAccountConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const data = await kucoinAccountClient.getAccountTypeSpot();
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar tipo de conta spot');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/account/detail/:accountId - Detalhe de conta
app.get('/api/integrations/trading/account/detail/:accountId', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinAccountClient.isAccountConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { accountId } = req.params;
    const data = await kucoinAccountClient.getAccountDetailSpot(accountId);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar detalhe de conta');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/account/ledgers/spot-margin - Ledger Spot/Margin
app.get('/api/integrations/trading/account/ledgers/spot-margin', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinAccountClient.isAccountConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const params: Record<string, string | undefined> = {
      currency: req.query.currency as string | undefined,
      direction: req.query.direction as string | undefined,
      bizType: req.query.bizType as string | undefined,
      startAt: req.query.startAt as string | undefined,
      endAt: req.query.endAt as string | undefined,
      currentPage: req.query.currentPage as string | undefined,
      pageSize: req.query.pageSize as string | undefined,
    };
    const cleanParams = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
    const data = await kucoinAccountClient.getAccountLedgersSpotMargin(cleanParams as Record<string, string>);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar ledger spot/margin');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/account/ledgers/trade-hf - Ledger Trade HF
app.get('/api/integrations/trading/account/ledgers/trade-hf', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinAccountClient.isAccountConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const params: Record<string, string | undefined> = {
      currency: req.query.currency as string | undefined,
      direction: req.query.direction as string | undefined,
      bizType: req.query.bizType as string | undefined,
      lastId: req.query.lastId as string | undefined,
      limit: req.query.limit as string | undefined,
      startAt: req.query.startAt as string | undefined,
      endAt: req.query.endAt as string | undefined,
    };
    const cleanParams = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
    const data = await kucoinAccountClient.getAccountLedgersTradeHf(cleanParams as Record<string, string>);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar ledger trade HF');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/account/ledgers/margin-hf - Ledger Margin HF
app.get('/api/integrations/trading/account/ledgers/margin-hf', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinAccountClient.isAccountConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const params: Record<string, string | undefined> = {
      currency: req.query.currency as string | undefined,
      direction: req.query.direction as string | undefined,
      bizType: req.query.bizType as string | undefined,
      lastId: req.query.lastId as string | undefined,
      limit: req.query.limit as string | undefined,
      startAt: req.query.startAt as string | undefined,
      endAt: req.query.endAt as string | undefined,
    };
    const cleanParams = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
    const data = await kucoinAccountClient.getAccountLedgersMarginHf(cleanParams as Record<string, string>);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar ledger margin HF');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/account/ledgers/futures - Ledger Futures
app.get('/api/integrations/trading/account/ledgers/futures', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinAccountClient.isAccountConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const params: Record<string, string | undefined> = {
      currency: req.query.currency as string | undefined,
      type: req.query.type as string | undefined,
      offset: req.query.offset as string | undefined,
      forward: req.query.forward as string | undefined,
      maxCount: req.query.maxCount as string | undefined,
      startAt: req.query.startAt as string | undefined,
      endAt: req.query.endAt as string | undefined,
    };
    const cleanParams = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
    const data = await kucoinAccountClient.getAccountLedgersFutures(cleanParams as Record<string, string>);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar ledger futures');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/account/sub-accounts - Criar sub-conta
app.post('/api/integrations/trading/account/sub-accounts', requirePermission('integrations:trading:manage'), async (req: Request, res: Response) => {
  if (!kucoinAccountClient.isAccountConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const data = await kucoinAccountClient.addSubAccount(req.body);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao criar sub-conta');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/account/sub-accounts/:subUserId/margin - Habilitar margin
app.post('/api/integrations/trading/account/sub-accounts/:subUserId/margin', requirePermission('integrations:trading:manage'), async (req: Request, res: Response) => {
  if (!kucoinAccountClient.isAccountConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { subUserId } = req.params;
    const data = await kucoinAccountClient.addSubAccountMarginPermission(subUserId);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao habilitar margin para sub-conta');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/account/sub-accounts/:subUserId/futures - Habilitar futures
app.post('/api/integrations/trading/account/sub-accounts/:subUserId/futures', requirePermission('integrations:trading:manage'), async (req: Request, res: Response) => {
  if (!kucoinAccountClient.isAccountConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { subUserId } = req.params;
    const data = await kucoinAccountClient.addSubAccountFuturesPermission(subUserId);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao habilitar futures para sub-conta');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/account/sub-accounts - Listar sub-contas
app.get('/api/integrations/trading/account/sub-accounts', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinAccountClient.isAccountConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const params: Record<string, string | undefined> = {
      currentPage: req.query.currentPage as string | undefined,
      pageSize: req.query.pageSize as string | undefined,
    };
    const cleanParams = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
    const data = await kucoinAccountClient.getSubAccountListSummary(cleanParams as Record<string, string>);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao listar sub-contas');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/account/sub-accounts/:subUserId/balance - Balance de sub-conta
app.get('/api/integrations/trading/account/sub-accounts/:subUserId/balance', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinAccountClient.isAccountConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { subUserId } = req.params;
    const data = await kucoinAccountClient.getSubAccountDetailBalance(subUserId);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar balance de sub-conta');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/account/sub-accounts/balances/spot - Balances Spot de sub-contas
app.get('/api/integrations/trading/account/sub-accounts/balances/spot', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinAccountClient.isAccountConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const params: Record<string, string | undefined> = {
      currentPage: req.query.currentPage as string | undefined,
      pageSize: req.query.pageSize as string | undefined,
    };
    const cleanParams = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
    const data = await kucoinAccountClient.getSubAccountListSpotBalance(cleanParams as Record<string, string>);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar balances spot de sub-contas');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/account/sub-accounts/balances/futures - Balances Futures de sub-contas
app.get('/api/integrations/trading/account/sub-accounts/balances/futures', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinAccountClient.isAccountConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const params: Record<string, string | undefined> = {
      currency: req.query.currency as string | undefined,
    };
    const cleanParams = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
    const data = await kucoinAccountClient.getSubAccountListFuturesBalance(cleanParams as Record<string, string>);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar balances futures de sub-contas');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/account/deposit/address - Criar endereço de depósito
app.post('/api/integrations/trading/account/deposit/address', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  if (!kucoinAccountClient.isAccountConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { currency, chain } = req.body;
    if (!currency) {
      res.status(400).json({ error: 'Parâmetro currency é obrigatório' });
      return;
    }
    const data = await kucoinAccountClient.addDepositAddress(currency, chain);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao criar endereço de depósito');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/account/deposit/address - Obter endereço de depósito
app.get('/api/integrations/trading/account/deposit/address', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinAccountClient.isAccountConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const currency = req.query.currency as string;
    const chain = req.query.chain as string | undefined;
    if (!currency) {
      res.status(400).json({ error: 'Parâmetro currency é obrigatório' });
      return;
    }
    const data = await kucoinAccountClient.getDepositAddress(currency, chain);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar endereço de depósito');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/account/deposits - Histórico de depósitos
app.get('/api/integrations/trading/account/deposits', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinAccountClient.isAccountConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const params: Record<string, string | undefined> = {
      currency: req.query.currency as string | undefined,
      status: req.query.status as string | undefined,
      startAt: req.query.startAt as string | undefined,
      endAt: req.query.endAt as string | undefined,
      currentPage: req.query.currentPage as string | undefined,
      pageSize: req.query.pageSize as string | undefined,
    };
    const cleanParams = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
    const data = await kucoinAccountClient.getDepositHistory(cleanParams as Record<string, string>);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar histórico de depósitos');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/account/withdrawal/quotas - Limites de withdrawal
app.get('/api/integrations/trading/account/withdrawal/quotas', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinAccountClient.isAccountConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const currency = req.query.currency as string;
    const chain = req.query.chain as string | undefined;
    if (!currency) {
      res.status(400).json({ error: 'Parâmetro currency é obrigatório' });
      return;
    }
    const data = await kucoinAccountClient.getWithdrawalQuotas(currency, chain);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar limites de withdrawal');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/account/withdraw - Executar withdrawal
app.post('/api/integrations/trading/account/withdraw', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  if (!kucoinAccountClient.isAccountConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const data = await kucoinAccountClient.withdraw(req.body);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao executar withdrawal');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/account/withdrawals/:id - Cancelar withdrawal
app.delete('/api/integrations/trading/account/withdrawals/:id', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  if (!kucoinAccountClient.isAccountConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { id } = req.params;
    await kucoinAccountClient.cancelWithdrawal(id);
    res.json({ success: true, data: { cancelledId: id } });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar withdrawal');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/account/withdrawals - Histórico de withdrawals
app.get('/api/integrations/trading/account/withdrawals', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinAccountClient.isAccountConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const params: Record<string, string | undefined> = {
      currency: req.query.currency as string | undefined,
      status: req.query.status as string | undefined,
      startAt: req.query.startAt as string | undefined,
      endAt: req.query.endAt as string | undefined,
      currentPage: req.query.currentPage as string | undefined,
      pageSize: req.query.pageSize as string | undefined,
    };
    const cleanParams = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
    const data = await kucoinAccountClient.getWithdrawalHistory(cleanParams as Record<string, string>);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar histórico de withdrawals');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/account/withdrawals/:id - Withdrawal por ID
app.get('/api/integrations/trading/account/withdrawals/:id', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinAccountClient.isAccountConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const { id } = req.params;
    const data = await kucoinAccountClient.getWithdrawalById(id);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar withdrawal por ID');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/account/transfer/quotas - Limites de transferência
app.get('/api/integrations/trading/account/transfer/quotas', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinAccountClient.isAccountConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const currency = req.query.currency as string;
    const type = req.query.type as string;
    if (!currency || !type) {
      res.status(400).json({ error: 'Parâmetros currency e type são obrigatórios' });
      return;
    }
    const data = await kucoinAccountClient.getTransferQuotas(currency, type);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar limites de transferência');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/account/transfer - Flex transfer
app.post('/api/integrations/trading/account/transfer', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  if (!kucoinAccountClient.isAccountConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const data = await kucoinAccountClient.flexTransfer(req.body);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao executar flex transfer');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/account/fees/basic - Fee básica Spot/Margin
app.get('/api/integrations/trading/account/fees/basic', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinAccountClient.isAccountConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const currencyType = req.query.currencyType as string | undefined;
    const data = await kucoinAccountClient.getBasicFeeSpotMargin(currencyType);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar fee básica');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/account/fees/futures - Fee Futures
app.get('/api/integrations/trading/account/fees/futures', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  if (!kucoinAccountClient.isAccountConfigured()) { respondKucoinNotConfigured(res); return; }
  try {
    const symbol = req.query.symbol as string;
    if (!symbol) {
      res.status(400).json({ error: 'Parâmetro symbol é obrigatório' });
      return;
    }
    const data = await kucoinAccountClient.getActualFeeFutures(symbol);
    res.json({ success: true, data });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar fee futures');
    res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// DEMO TRADING - Rotas REST
// ============================================================================

import {
  getOrCreateBalance as getDemoBalance,
  getAllBalances as getDemoBalances,
  addFunds as addDemoFunds,
  getFundHistory as getDemoFundHistory,
  createDemoOrder,
  closeDemoPosition,
  updateDemoPositionRisk,
  addToDemoPosition,
  getOpenPositions as getDemoOpenPositions,
  getAllPositions as getDemoAllPositions,
  getOrders as getDemoOrders,
  cancelDemoOrder,
  startDemoScheduler,
  stopDemoScheduler,
  DemoTradingBusinessError,
} from './demo-trading-engine.js';
import {
  getQueueStats as getPostMortemQueueStats,
  retryDlqJob as retryPostMortemDlqJob,
  startPostMortemWorker,
  stopPostMortemWorker,
} from './postmortem-worker.js';
import { getSnapshotsByRefs } from './snapshot-store.js';
import { createDatasetFromPostMortem, createDatasetsFromPostMortemsBatch } from './dataset-generator.js';
import { resolveModelWithAdapter } from './lora-adapter-resolver.js';
import { queryTradingRAGContext } from './trading-rag-client.js';

function mapDemoTradingError(error: unknown): { status: 400 | 404 | 422 | 500; error: string; code?: string } {
  if (error instanceof DemoTradingBusinessError) {
    return {
      status: error.statusCode,
      error: error.message,
      code: error.code,
    };
  }

  const message = error instanceof Error ? error.message : 'Erro desconhecido';
  if (message.includes('Saldo insuficiente')) {
    return { status: 422, error: message, code: 'INSUFFICIENT_BALANCE' };
  }
  if (message.includes('não encontrada') || message.includes('não encontrado')) {
    return { status: 404, error: message, code: 'NOT_FOUND' };
  }
  if (message.includes('deve ser') || message.includes('invál') || message.includes('obrigatório')) {
    return { status: 422, error: message, code: 'INVALID_INPUT' };
  }

  return { status: 500, error: message };
}

const demoTradingRequestErrorsTotal = new PromCounter({
  name: 'alice_demo_trading_request_errors_total',
  help: 'Total de erros em rotas demo trading por status/código',
  labelNames: ['route', 'status', 'code'] as const,
});

const demoTradingRequestDurationMs = new PromHistogram({
  name: 'alice_demo_trading_request_duration_ms',
  help: 'Latência de rotas demo trading (ms)',
  labelNames: ['route', 'status_class'] as const,
  buckets: [25, 50, 100, 250, 500, 1000, 2000, 5000],
});

function recordDemoTradingError(route: string, mapped: { status: 400 | 404 | 422 | 500; code?: string }): void {
  demoTradingRequestErrorsTotal.inc({
    route,
    status: String(mapped.status),
    code: mapped.code ?? 'UNKNOWN',
  });
}

function recordDemoTradingLatency(route: string, startedAt: number, status: number): void {
  const elapsedMs = Math.max(0, Date.now() - startedAt);
  const statusClass = status >= 500 ? '5xx' : status >= 400 ? '4xx' : '2xx';
  demoTradingRequestDurationMs.observe({ route, status_class: statusClass }, elapsedMs);
}

// GET /api/integrations/demo-trading/balance - Buscar balance demo
app.get('/api/integrations/demo-trading/balance', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) { res.status(403).json({ error: 'Tenant não identificado' }); return; }
    const balance = await getDemoBalance(tenantId);
    res.json({ success: true, data: balance });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar balance demo');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/demo-trading/balances - Listar todos os saldos demo por ativo
app.get('/api/integrations/demo-trading/balances', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) { res.status(403).json({ error: 'Tenant não identificado' }); return; }
    const balances = await getDemoBalances(tenantId);
    res.json({ success: true, data: balances });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar saldos demo');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/demo-trading/funds - Adicionar fundos demo
app.post('/api/integrations/demo-trading/funds', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const { amount, currency, note } = req.body as { amount: number; currency?: string; note?: string };
    if (!amount || amount <= 0) {
      res.status(400).json({ error: 'amount deve ser um número positivo' });
      return;
    }
    const tenantId = req.tenantId;
    if (!tenantId) { res.status(403).json({ error: 'Tenant não identificado' }); return; }
    const result = await addDemoFunds({ tenantId, amount, currency, note });
    res.json({ success: true, data: result });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao adicionar fundos demo');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/demo-trading/funds/history - Histórico de fundos
app.get('/api/integrations/demo-trading/funds/history', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) { res.status(403).json({ error: 'Tenant não identificado' }); return; }
    const history = await getDemoFundHistory(tenantId);
    res.json({ success: true, data: history });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar histórico de fundos demo');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/demo-trading/orders - Criar ordem demo
app.post('/api/integrations/demo-trading/orders', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  const startedAt = Date.now();
  try {
    const { symbol, marketType, side, orderType, size, price, leverage, stopLoss, takeProfit } = req.body as {
      symbol: string;
      marketType: 'spot' | 'futures' | 'margin';
      side: 'buy' | 'sell';
      orderType: 'market' | 'limit' | 'stop';
      size: number;
      price?: number;
      leverage?: number;
      stopLoss?: number;
      takeProfit?: number;
    };

    if (!symbol || !marketType || !side || !orderType || !size || size <= 0) {
      res.status(400).json({ error: 'Campos obrigatórios: symbol, marketType, side, orderType, size (positivo)' });
      return;
    }

    const tenantId = req.tenantId;
    if (!tenantId) { res.status(403).json({ error: 'Tenant não identificado' }); return; }

    const result = await createDemoOrder({
      tenantId,
      symbol,
      marketType,
      side,
      orderType,
      size,
      price,
      leverage,
      stopLoss,
      takeProfit,
    });

    recordDemoTradingLatency('/api/integrations/demo-trading/orders', startedAt, 201);
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    const mapped = mapDemoTradingError(error);
    recordDemoTradingError('/api/integrations/demo-trading/orders', mapped);
    recordDemoTradingLatency('/api/integrations/demo-trading/orders', startedAt, mapped.status);
    if (mapped.status >= 500) {
      logger.error({ error: mapped.error }, 'Erro ao criar ordem demo');
    } else {
      logger.warn({ error: mapped.error, code: mapped.code }, 'Validação de ordem demo rejeitada');
    }
    res.status(mapped.status).json({ error: mapped.error, code: mapped.code });
  }
});

// POST /api/integrations/demo-trading/orders/from-signal - Criar ordem demo a partir de sinal IA
app.post('/api/integrations/demo-trading/orders/from-signal', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  const startedAt = Date.now();
  try {
    const { signalId, symbol, marketType, side, size, leverage, stopLoss, takeProfit, entryType, price } = req.body as {
      signalId: string;
      symbol: string;
      marketType: 'spot' | 'futures' | 'margin';
      side: 'buy' | 'sell';
      size: number;
      leverage?: number;
      stopLoss?: number;
      takeProfit?: number;
      entryType?: 'market' | 'limit';
      price?: number;
    };

    if (!signalId || !symbol || !marketType || !side || !size || size <= 0) {
      res.status(400).json({ error: 'Campos obrigatórios: signalId, symbol, marketType, side, size (positivo)' });
      return;
    }

    const tenantId = req.tenantId;
    if (!tenantId) { res.status(403).json({ error: 'Tenant não identificado' }); return; }

    const result = await createDemoOrder({
      tenantId,
      symbol,
      marketType,
      side,
      orderType: entryType ?? 'market',
      size,
      price,
      leverage,
      stopLoss,
      takeProfit,
      signalId,
    });

    logger.info({ signalId, orderId: result.orderId, positionId: result.positionId }, 'Ordem demo criada a partir de sinal IA');

    recordDemoTradingLatency('/api/integrations/demo-trading/orders/from-signal', startedAt, 201);
    res.status(201).json({ success: true, data: { ...result, fromSignalId: signalId } });
  } catch (error) {
    const mapped = mapDemoTradingError(error);
    recordDemoTradingError('/api/integrations/demo-trading/orders/from-signal', mapped);
    recordDemoTradingLatency('/api/integrations/demo-trading/orders/from-signal', startedAt, mapped.status);
    if (mapped.status >= 500) {
      logger.error({ error: mapped.error }, 'Erro ao criar ordem demo a partir de sinal');
    } else {
      logger.warn({ error: mapped.error, code: mapped.code }, 'Ordem demo por sinal rejeitada por validação');
    }
    res.status(mapped.status).json({ error: mapped.error, code: mapped.code });
  }
});

// GET /api/integrations/demo-trading/orders - Listar ordens demo
app.get('/api/integrations/demo-trading/orders', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const tenantId = req.tenantId;
    if (!tenantId) { res.status(403).json({ error: 'Tenant não identificado' }); return; }
    const orders = await getDemoOrders(tenantId, limit);
    res.json({ success: true, data: orders });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao listar ordens demo');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/demo-trading/orders/:id - Cancelar ordem demo
app.delete('/api/integrations/demo-trading/orders/:id', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  const startedAt = Date.now();
  try {
    const tenantId = req.tenantId;
    if (!tenantId) { res.status(403).json({ error: 'Tenant não identificado' }); return; }
    const orderId = req.params.id;
    if (!orderId) { res.status(400).json({ error: 'ID da ordem é obrigatório' }); return; }
    const success = await cancelDemoOrder(tenantId, orderId);
    if (!success) {
      recordDemoTradingLatency('/api/integrations/demo-trading/orders/:id', startedAt, 404);
      res.status(404).json({ error: 'Ordem não encontrada ou não pode ser cancelada' });
      return;
    }
    recordDemoTradingLatency('/api/integrations/demo-trading/orders/:id', startedAt, 200);
    res.json({ success: true });
  } catch (error) {
    const mapped = mapDemoTradingError(error);
    recordDemoTradingError('/api/integrations/demo-trading/orders/:id', mapped);
    recordDemoTradingLatency('/api/integrations/demo-trading/orders/:id', startedAt, mapped.status);
    if (mapped.status >= 500) {
      logger.error({ error: mapped.error }, 'Erro ao cancelar ordem demo');
    } else {
      logger.warn({ error: mapped.error, code: mapped.code }, 'Cancelamento de ordem demo rejeitado por validação');
    }
    res.status(mapped.status).json({ error: mapped.error, code: mapped.code });
  }
});

// GET /api/integrations/demo-trading/positions - Listar posições demo
app.get('/api/integrations/demo-trading/positions', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) { res.status(403).json({ error: 'Tenant não identificado' }); return; }
    const status = req.query.status as string;
    const limit = parseInt(req.query.limit as string) || 50;
    let positions;
    if (status === 'open') {
      positions = await getDemoOpenPositions(tenantId);
    } else {
      positions = await getDemoAllPositions(tenantId, limit);
    }
    res.json({ success: true, data: positions });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao listar posições demo');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/demo-trading/positions/:id/close - Fechar posição demo
app.post('/api/integrations/demo-trading/positions/:id/close', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  const startedAt = Date.now();
  try {
    const tenantId = req.tenantId;
    if (!tenantId) { res.status(403).json({ error: 'Tenant não identificado' }); return; }
    const positionId = req.params.id;
    if (!positionId) { res.status(400).json({ error: 'ID da posição é obrigatório' }); return; }
    const closeSchema = z.object({
      size: z.number().positive().optional(),
    });
    const closeParsed = closeSchema.safeParse(req.body ?? {});
    if (!closeParsed.success) {
      res.status(400).json({ error: 'Dados inválidos para fechamento', details: closeParsed.error.flatten() });
      return;
    }

    const result = await closeDemoPosition({
      tenantId,
      positionId,
      reason: 'manual',
      size: closeParsed.data.size,
    });
    recordDemoTradingLatency('/api/integrations/demo-trading/positions/:id/close', startedAt, 200);
    res.json({ success: true, data: result });
  } catch (error) {
    const mapped = mapDemoTradingError(error);
    recordDemoTradingError('/api/integrations/demo-trading/positions/:id/close', mapped);
    recordDemoTradingLatency('/api/integrations/demo-trading/positions/:id/close', startedAt, mapped.status);
    if (mapped.status >= 500) {
      logger.error({ error: mapped.error }, 'Erro ao fechar posição demo');
    } else {
      logger.warn({ error: mapped.error, code: mapped.code }, 'Fechamento de posição demo rejeitado por validação');
    }
    res.status(mapped.status).json({ error: mapped.error, code: mapped.code });
  }
});

// PATCH /api/integrations/demo-trading/positions/:id - Atualizar SL/TP de posição demo
app.patch('/api/integrations/demo-trading/positions/:id', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  const startedAt = Date.now();
  try {
    const tenantId = req.tenantId;
    if (!tenantId) { res.status(403).json({ error: 'Tenant não identificado' }); return; }
    const positionId = req.params.id;
    if (!positionId) { res.status(400).json({ error: 'ID da posição é obrigatório' }); return; }

    const bodySchema = z.object({
      stopLoss: z.number().positive().nullable().optional(),
      takeProfit: z.number().positive().nullable().optional(),
    }).refine((data) => data.stopLoss !== undefined || data.takeProfit !== undefined, {
      message: 'Informe stopLoss e/ou takeProfit para atualizar.',
    });

    const parsed = bodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
      return;
    }

    const updated = await updateDemoPositionRisk({
      tenantId,
      positionId,
      stopLoss: parsed.data.stopLoss,
      takeProfit: parsed.data.takeProfit,
    });

    recordDemoTradingLatency('/api/integrations/demo-trading/positions/:id', startedAt, 200);
    res.json({ success: true, data: updated });
  } catch (error) {
    const mapped = mapDemoTradingError(error);
    recordDemoTradingError('/api/integrations/demo-trading/positions/:id', mapped);
    recordDemoTradingLatency('/api/integrations/demo-trading/positions/:id', startedAt, mapped.status);
    if (mapped.status >= 500) {
      logger.error({ error: mapped.error }, 'Erro ao atualizar SL/TP da posição demo');
    } else {
      logger.warn({ error: mapped.error, code: mapped.code }, 'Atualização de SL/TP demo rejeitada por validação');
    }
    res.status(mapped.status).json({ error: mapped.error, code: mapped.code });
  }
});

// POST /api/integrations/demo-trading/positions/:id/add - Adicionar tamanho a posição demo
app.post('/api/integrations/demo-trading/positions/:id/add', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  const startedAt = Date.now();
  try {
    const tenantId = req.tenantId;
    if (!tenantId) { res.status(403).json({ error: 'Tenant não identificado' }); return; }
    const positionId = req.params.id;
    if (!positionId) { res.status(400).json({ error: 'ID da posição é obrigatório' }); return; }

    const bodySchema = z.object({
      size: z.number().positive(),
      price: z.number().positive().optional(),
      stopLoss: z.number().positive().nullable().optional(),
      takeProfit: z.number().positive().nullable().optional(),
    });
    const parsed = bodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
      return;
    }

    const result = await addToDemoPosition({
      tenantId,
      positionId,
      size: parsed.data.size,
      price: parsed.data.price,
      stopLoss: parsed.data.stopLoss,
      takeProfit: parsed.data.takeProfit,
    });

    recordDemoTradingLatency('/api/integrations/demo-trading/positions/:id/add', startedAt, 200);
    res.json({ success: true, data: result });
  } catch (error) {
    const mapped = mapDemoTradingError(error);
    recordDemoTradingError('/api/integrations/demo-trading/positions/:id/add', mapped);
    recordDemoTradingLatency('/api/integrations/demo-trading/positions/:id/add', startedAt, mapped.status);
    if (mapped.status >= 500) {
      logger.error({ error: mapped.error }, 'Erro ao adicionar tamanho à posição demo');
    } else {
      logger.warn({ error: mapped.error, code: mapped.code }, 'Scale-in demo rejeitado por validação');
    }
    res.status(mapped.status).json({ error: mapped.error, code: mapped.code });
  }
});

// ============================================================================
// POST-MORTEM - Rotas REST
// ============================================================================

// GET /api/integrations/postmortem/:positionId - Buscar post-mortem de uma posição
app.get('/api/integrations/postmortem/:positionId', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) { res.status(403).json({ error: 'Tenant não identificado' }); return; }
    const positionId = req.params.positionId;
    if (!positionId) { res.status(400).json({ error: 'ID da posição é obrigatório' }); return; }
    const db = getDatabase();
    const [postmortem] = await db
      .select()
      .from(schema.tradingPostmortems)
      .where(and(
        eq(schema.tradingPostmortems.positionId, positionId),
        eq(schema.tradingPostmortems.tenantId, tenantId),
      ))
      .limit(1);

    if (!postmortem) {
      res.status(404).json({ error: 'Post-mortem não encontrado para esta posição' });
      return;
    }
    res.json({ success: true, data: postmortem });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar post-mortem');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/postmortem - Listar post-mortems do tenant
app.get('/api/integrations/postmortem', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) { res.status(403).json({ error: 'Tenant não identificado' }); return; }
    const db = getDatabase();
    const limit = parseInt(req.query.limit as string) || 50;
    const isDemo = req.query.isDemo === 'true' ? true : req.query.isDemo === 'false' ? false : undefined;

    // Construir condição WHERE com isDemo na query SQL (não pós-filtro)
    const whereCondition = isDemo !== undefined
      ? and(eq(schema.tradingPostmortems.tenantId, tenantId), eq(schema.tradingPostmortems.isDemo, isDemo))
      : eq(schema.tradingPostmortems.tenantId, tenantId);

    const postmortems = await db
      .select()
      .from(schema.tradingPostmortems)
      .where(whereCondition)
      .orderBy(desc(schema.tradingPostmortems.createdAt))
      .limit(limit);

    res.json({ success: true, data: postmortems });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao listar post-mortems');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/postmortem/queue/stats - Estatísticas da fila de post-mortem
app.get('/api/integrations/postmortem/queue/stats', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  try {
    const stats = await getPostMortemQueueStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar estatísticas da fila');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/postmortem/queue/retry/:jobId - Retry job da DLQ
app.post('/api/integrations/postmortem/queue/retry/:jobId', requirePermission('integrations:trading:manage'), async (req: Request, res: Response) => {
  try {
    const success = await retryPostMortemDlqJob(req.params.jobId);
    if (!success) {
      res.status(404).json({ error: 'Job não encontrado na DLQ' });
      return;
    }
    res.json({ success: true, message: 'Job reenfileirado com sucesso' });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao reenfileirar job');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/postmortem/snapshots/:positionId - Buscar snapshots de uma posição
app.get('/api/integrations/postmortem/snapshots/:positionId', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) { res.status(403).json({ error: 'Tenant não identificado' }); return; }
    const positionId = req.params.positionId;
    if (!positionId) { res.status(400).json({ error: 'ID da posição é obrigatório' }); return; }
    const snapshots = await getSnapshotsByRefs({
      tenantId,
      refKey: 'positionId',
      refValue: positionId,
    });
    res.json({ success: true, data: snapshots });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao buscar snapshots');
    res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// TRAINING DATASETS — Envio single/batch de post-mortems para Training
// ============================================================================

// POST /api/integrations/postmortem/send-to-training - Enviar post-mortem individual para Training
app.post('/api/integrations/postmortem/send-to-training', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const bodySchema = z.object({
      postmortemId: z.string().uuid(),
      namespaceId: z.string().uuid(),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
      return;
    }

    const tenantId = req.tenantId;
    if (!tenantId) { res.status(403).json({ error: 'Tenant não identificado' }); return; }

    const db = getDatabase();
    const targetNamespace = await db.query.namespaces.findFirst({
      where: and(
        eq(schema.namespaces.id, parsed.data.namespaceId),
        eq(schema.namespaces.tenantId, tenantId),
        eq(schema.namespaces.ativo, true)
      ),
      columns: { id: true },
    });
    if (!targetNamespace) {
      res.status(403).json({ error: 'Namespace de destino não pertence ao tenant ou está inativo' });
      return;
    }

    const datasetId = await createDatasetFromPostMortem(parsed.data.postmortemId, tenantId, targetNamespace.id);
    if (!datasetId) {
      res.status(422).json({
        error: 'Não foi possível criar dataset — post-mortem não encontrado, incompleto ou já processado',
      });
      return;
    }

    res.json({
      success: true,
      data: { datasetId, postmortemId: parsed.data.postmortemId, namespaceId: targetNamespace.id },
      message: 'Dataset criado com status pending para aprovação',
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao enviar post-mortem para training');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/postmortem/send-to-training/batch - Enviar múltiplos post-mortems para Training
app.post('/api/integrations/postmortem/send-to-training/batch', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const bodySchema = z.object({
      postmortemIds: z.array(z.string().uuid()).min(1),
      namespaceId: z.string().uuid().optional(),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
      return;
    }

    if (parsed.data.postmortemIds.length > 100) {
      res.status(400).json({ error: 'Máximo de 100 post-mortems por batch' });
      return;
    }

    const tenantId = req.tenantId;
    if (!tenantId) { res.status(403).json({ error: 'Tenant não identificado' }); return; }
    let targetNamespaceId: string | undefined;
    if (parsed.data.namespaceId) {
      const db = getDatabase();
      const namespace = await db.query.namespaces.findFirst({
        where: and(
          eq(schema.namespaces.id, parsed.data.namespaceId),
          eq(schema.namespaces.tenantId, tenantId),
          eq(schema.namespaces.ativo, true)
        ),
        columns: { id: true },
      });
      if (!namespace) {
        res.status(403).json({ error: 'Namespace de destino não pertence ao tenant ou está inativo' });
        return;
      }
      targetNamespaceId = namespace.id;
    }

    const results = await createDatasetsFromPostMortemsBatch(parsed.data.postmortemIds, tenantId, targetNamespaceId);

    const created = Object.values(results).filter(Boolean).length;
    const failed = parsed.data.postmortemIds.length - created;

    res.json({
      success: true,
      data: {
        results,
        summary: { total: parsed.data.postmortemIds.length, created, failed },
      },
      message: `${created} datasets criados com status pending para aprovação`,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao enviar batch de post-mortems para training');
    res.status(500).json({ error: errorMessage });
  }
});

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

type IntegrationSeed = {
  tipo: 'kucoin' | 'erpnext';
  nome: string;
  configuracao: IntegrationConfiguracao;
  credenciais: Record<string, unknown>;
};

function buildIntegrationSeeds(): IntegrationSeed[] {
  const seeds: IntegrationSeed[] = [];
  const kucoinStatus = kucoinClient.getKucoinConfigStatus();
  if (kucoinStatus.isConfigured) {
    const baseUrl = process.env.KUCOIN_PRO_BASE_URL?.trim();
    const configuracao: IntegrationConfiguracao = {};
    if (baseUrl) {
      configuracao.baseUrl = baseUrl;
    }
    seeds.push({
      tipo: 'kucoin',
      nome: 'KuCoin Futures',
      configuracao,
      credenciais: {
        apiKey: process.env.KUCOIN_PRO_API_KEY?.trim(),
        apiSecret: process.env.KUCOIN_PRO_API_SECRET?.trim(),
        passphrase: process.env.KUCOIN_PRO_API_PASSPHRASE?.trim(),
      },
    });
  } else {
    logger.warn({ missing: kucoinStatus.missingKeys }, 'KuCoin não configurado - bootstrap ignorado');
  }

  if (config.ERPNEXT_URL && config.ERPNEXT_API_KEY && config.ERPNEXT_API_SECRET) {
    seeds.push({
      tipo: 'erpnext',
      nome: 'ERPNext',
      configuracao: {
        baseUrl: config.ERPNEXT_URL,
      },
      credenciais: {
        apiKey: config.ERPNEXT_API_KEY,
        apiSecret: config.ERPNEXT_API_SECRET,
      },
    });
  } else {
    logger.warn('ERPNext não configurado - bootstrap ignorado');
  }

  return seeds;
}

async function ensureIntegrationSeeded(params: {
  tenantId: string;
  seed: IntegrationSeed;
}): Promise<boolean> {
  const db = getDatabase();
  const existing = await db.query.integrations.findFirst({
    where: and(
      eq(schema.integrations.tenantId, params.tenantId),
      eq(schema.integrations.tipo, params.seed.tipo)
    ),
  });

  if (existing) {
    return false;
  }

  const [created] = await db.insert(schema.integrations).values({
    tenantId: params.tenantId,
    tipo: params.seed.tipo,
    nome: params.seed.nome,
    configuracao: params.seed.configuracao,
    credenciais: params.seed.credenciais,
    ativo: true,
  }).returning();

  if (!created) {
    throw new Error(`Falha ao criar integração ${params.seed.tipo} para o tenant ${params.tenantId}`);
  }

  logger.info({ tenantId: params.tenantId, tipo: params.seed.tipo }, 'Integração bootstrap criada');
  return true;
}

async function bootstrapIntegrationsForTenants(): Promise<void> {
  const db = getDatabase();
  const tenants = await db.query.tenants.findMany({
    columns: {
      id: true,
      nome: true,
    },
  });

  if (tenants.length === 0) {
    logger.warn('Nenhum tenant encontrado para bootstrap de integrações');
    return;
  }

  const seeds = buildIntegrationSeeds();
  if (seeds.length === 0) {
    logger.warn('Nenhuma integração configurada para bootstrap');
    return;
  }

  for (const tenant of tenants) {
    for (const seed of seeds) {
      try {
        await ensureIntegrationSeeded({ tenantId: tenant.id, seed });
      } catch (error) {
        logger.error(
          { error, tenantId: tenant.id, tipo: seed.tipo },
          'Falha ao bootstrapar integração'
        );
      }
    }
  }
}

// =============================================================================
// INICIALIZAÇÃO: Redis Cache + Session Auth Cache
// =============================================================================
// CORREÇÃO PR#107 (10/01/2026): Inicializar caches antes de processar requisições
// Redis cache é usado para performance de sessões HTTP (evita queries repetitivas)
// =============================================================================
async function initializeCaches(): Promise<void> {
  // initializeRedisCache() usa REDIS_URL do ambiente automaticamente.
  // - Em produção: fail-fast se Redis indisponível (Regra 6)
  // - Em dev/test: Redis pode estar ausente; session-auth cache fica desabilitado (sem in-memory)
  const redisConnected = await initializeRedisCache();
  logger.info({ redisConnected }, 'Redis cache inicializado');

  await initializeSessionAuthCache();
  logger.info('Session auth cache inicializado');
}

// Inicializar caches e depois iniciar servidor
initializeCaches().then(() => {
  try {
    const db = getDatabase();
    initWiseSyncService(db);
    logger.info('WiseSyncService inicializado com sucesso');
  } catch (error) {
    logger.warn({ error }, 'WiseSyncService não inicializado (database não disponível)');
  }
  bootstrapIntegrationsForTenants().catch((error) => {
    logger.error({ error }, 'Falha no bootstrap de integrações');
  });

  const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info({ port: PORT }, 'Integrations service started');
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

  // SEGURANÇA: Timeouts para prevenir conexões pendentes (Node.js 20 LTS Best Practices)
  server.timeout = 180000; // 180s para requisições longas (LLM/Trading)
  server.keepAliveTimeout = 65000; // 65s (maior que ALB timeout padrão de 60s)
  server.headersTimeout = 66000; // Ligeiramente maior que keepAliveTimeout

  // ============================================================================
  // GRACEFUL SHUTDOWN (Enterprise-Grade - Regra 16 CLAUDE.md)
  // ShutdownManager centralizado elimina duplicação de listeners (Regra 6)
  // Ordem: HTTP server → Database pool (coordenado pelo ShutdownManager)
  // ============================================================================

  registerShutdownCallback(
    'integrations-http-server',
    async () => {
      logger.info('Encerrando HTTP server...');
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) {
            logger.error({ error: err }, 'Erro ao fechar HTTP server');
            reject(err);
          } else {
            logger.info('HTTP server encerrado com sucesso');
            resolve();
          }
        });
      });
    },
    { priority: ShutdownPriority.HTTP_SERVER }
  );

  registerShutdownCallback(
    'integrations-database-pool',
    async () => {
      logger.info('Encerrando pool de conexões database...');
      await closeDatabasePool();
      logger.info('Pool de conexões encerrado com sucesso');
    },
    { priority: ShutdownPriority.DATABASE }
  );

  registerShutdownCallback(
    'integrations-trading-metrics',
    async () => {
      if (tradingMetricsInterval) {
        clearInterval(tradingMetricsInterval);
        tradingMetricsInterval = null;
      }
    },
    { priority: ShutdownPriority.BACKGROUND_JOBS }
  );

  registerShutdownCallback(
    'integrations-trading-signal-scheduler',
    async () => {
      if (signalSchedulerInterval) {
        clearInterval(signalSchedulerInterval);
        signalSchedulerInterval = null;
      }
    },
    { priority: ShutdownPriority.BACKGROUND_JOBS }
  );

  registerShutdownCallback(
    'integrations-health-metrics',
    async () => {
      clearInterval(integrationHealthInterval);
    },
    { priority: ShutdownPriority.BACKGROUND_JOBS }
  );

  registerShutdownCallback(
    'integrations-demo-scheduler',
    async () => {
      stopDemoScheduler();
    },
    { priority: ShutdownPriority.BACKGROUND_JOBS }
  );

  registerShutdownCallback(
    'integrations-postmortem-worker',
    async () => {
      stopPostMortemWorker();
    },
    { priority: ShutdownPriority.BACKGROUND_JOBS }
  );

  registerShutdownCallback(
    'integrations-kucoin-websocket',
    async () => {
      // WS5: garante shutdown limpo dos clientes WS (evita sockets pendurados)
      closeKucoinWebSocketClients();
      closeSpotWebSocketClients();
    },
    { priority: ShutdownPriority.EXTERNAL_CONNECTIONS }
  );

  registerShutdownCallback(
    'integrations-trading-broadcast',
    async () => {
      await closeBroadcast();
    },
    { priority: ShutdownPriority.EXTERNAL_CONNECTIONS }
  );
}).catch((error: unknown) => {
  logger.error({ error }, 'Erro fatal ao inicializar serviço');
  process.exit(1);
});
