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
  Gauge as PromGauge,
  Counter as PromCounter,
  Histogram as PromHistogram,
  Role,
} from '@alice/shared-utils';
import type { AuthContext } from '@alice/shared-utils';
import { integrationsServicePaths, integrationsServiceSchemas } from './openapi-specs.js';
import { loadConfig, integrationsServiceConfigSchema } from '@alice/config';
import { getDatabase, schema, closeDatabasePool, isPoolHealthy, createDrizzleFeatureFlagStorage, getPool } from '@alice/database';
import { eq, desc, asc, sql, and, inArray, not, isNull, lte, lt } from '@alice/database';
import {
  tradingIntervalEnum,
  TradingOperationTypeSchema,
  TradingProfileNewsConfigSchema,
  TradingEnsembleConfigSchema,
  TradingArbitrageConfigSchema,
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
  TradingTechniqueScore,
  TradingOverallSignal,
  TradingEnsembleResult,
} from '@alice/shared';
import { z } from 'zod';
import { wiseService } from './wiseService.js';
import { isWiseConfigured, getSandboxStatus, getProfileIdSafe, getWiseCircuitBreakerStatus, validateWiseWebhook, initWiseMetrics } from './wiseClient.js';
import { initWiseSyncService } from './wiseSyncService.js';
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
} from './kucoinWebSocket.js';
import { initializeBroadcast, getPublisher, closeBroadcast } from './tradingBroadcast.js';
import {
  normalizeTickerData,
  normalizeOrderBookData,
  normalizeKlineData,
  normalizeTradeData,
} from './tradingTypes.js';
import { sendKucoinErrorResponse } from './kucoin-error-mapper.js';
import * as technicalIndicators from './technical-indicators.js';
import { validateAndPersist } from './llm-validation.js';

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

function normalizeTradingArbitrageConfig(raw?: TradingArbitrageConfig | null): TradingArbitrageConfig | undefined {
  if (!raw) return undefined;
  const parsed = TradingArbitrageConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error('Configuração de arbitragem inválida');
  }
  return parsed.data;
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
    throw new Error(`Configuração de arbitragem obrigatória para ${params.context}`);
  }
  const maxMinutes = params.arbitrageConfig.maxIntervalMinutes;
  const invalidFrames = params.timeframes.filter((frame) => resolveIntervalMinutes(frame) > maxMinutes);
  if (invalidFrames.length > 0) {
    throw new Error(`Arbitragem triangular exige timeframes <= ${maxMinutes} minutos. Ajuste: ${invalidFrames.join(', ')}`);
  }
}

function splitSymbolPair(symbol: string): { base: string; quote: string } {
  const parts = symbol.split('-').map((value) => value.trim()).filter(Boolean);
  if (parts.length !== 2) {
    throw new Error(`Símbolo inválido para arbitragem triangular: ${symbol}`);
  }
  return { base: parts[0], quote: parts[1] };
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
    temperature: modelConfigRaw?.temperature,
    maxTokens: modelConfigRaw?.maxTokens,
  };
  const newsConfig = normalizeTradingNewsConfig(row?.newsConfig ?? null);
  const consensusRaw = row?.consensus as Partial<TradingProfileConsensus> | undefined;
  const consensus: TradingProfileConsensus = {
    rule: consensusRaw?.rule === 'majority' ? 'majority' : 'majority',
    minAgree: consensusRaw?.minAgree,
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
  marginMode?: TradingMarginMode
): Promise<{
  symbol: string;
  bestBid: number | null;
  bestAsk: number | null;
  spreadAbs: number | null;
  spreadPct: number | null;
  depth: number;
}> {
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
  side: 'sell' | 'buy';
  rate: number;
  bestBid: number | null;
  bestAsk: number | null;
};

type TriangularArbitrageResult = {
  intermediateAsset: string;
  startAsset: string;
  endAsset: string;
  edgePct: number;
  finalAmount: number;
  legs: ArbitrageLeg[];
};

async function getConversionRate(params: {
  auth: { tenantId: string; userId: string };
  from: string;
  to: string;
  marketType?: TradingMarketType;
  marginMode?: TradingMarginMode;
}): Promise<ArbitrageLeg | null> {
  const candidateDirect = `${params.from}-${params.to}`;
  const candidateInverse = `${params.to}-${params.from}`;

  const trySnapshot = async (symbol: string) => {
    try {
      return await getOrderBookSnapshot(params.auth, symbol, params.marketType, params.marginMode);
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
  maxSlippagePct: number;
}): Promise<TriangularArbitrageResult | null> {
  let best: TriangularArbitrageResult | null = null;
  const feeMultiplier = 1 - params.feePct / 100;
  const slippageMultiplier = 1 - params.maxSlippagePct / 100;

  for (const intermediate of params.intermediateAssets) {
    const leg1 = await getConversionRate({
      auth: params.auth,
      from: params.startAsset,
      to: intermediate,
      marketType: params.marketType,
      marginMode: params.marginMode,
    });
    if (!leg1) continue;

    const leg2 = await getConversionRate({
      auth: params.auth,
      from: intermediate,
      to: params.quoteAsset,
      marketType: params.marketType,
      marginMode: params.marginMode,
    });
    if (!leg2) continue;

    const leg3 = await getConversionRate({
      auth: params.auth,
      from: params.quoteAsset,
      to: params.startAsset,
      marketType: params.marketType,
      marginMode: params.marginMode,
    });
    if (!leg3) continue;

    const startAmount = 1;
    const afterLeg1 = startAmount * leg1.rate * feeMultiplier * slippageMultiplier;
    const afterLeg2 = afterLeg1 * leg2.rate * feeMultiplier * slippageMultiplier;
    const finalAmount = afterLeg2 * leg3.rate * feeMultiplier * slippageMultiplier;
    const edgePct = ((finalAmount - startAmount) / startAmount) * 100;

    if (!best || edgePct > best.edgePct) {
      best = {
        intermediateAsset: intermediate,
        startAsset: params.startAsset,
        endAsset: params.startAsset,
        edgePct: Math.round(edgePct * 100) / 100,
        finalAmount: Math.round(finalAmount * 1000000) / 1000000,
        legs: [leg1, leg2, leg3],
      };
    }
  }

  return best;
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
  const timeout = setTimeout(() => controller.abort(), 10000);
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
  clearTimeout(timeout);

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
}

function truncateText(input: string, maxLength: number): string {
  if (input.length <= maxLength) return input;
  return `${input.slice(0, maxLength)}…`;
}

async function fetchTradingDatasetSummary(tenantId: string): Promise<{
  totalApproved: number;
  samples: Array<{ prompt: string; response: string; actionType: string; createdAt: string }>;
}> {
  const db = getDatabase();
  const [total] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.tradingDataset)
    .where(and(
      eq(schema.tradingDataset.tenantId, tenantId),
      eq(schema.tradingDataset.status, 'approved')
    ));

  const samples = await db.query.tradingDataset.findMany({
    where: and(
      eq(schema.tradingDataset.tenantId, tenantId),
      eq(schema.tradingDataset.status, 'approved')
    ),
    orderBy: [desc(schema.tradingDataset.criadoEm)],
    limit: 3,
  });

  return {
    totalApproved: Number(total?.count ?? 0),
    samples: samples.map((item) => ({
      prompt: truncateText(item.prompt, 400),
      response: truncateText(item.response, 400),
      actionType: item.actionType,
      createdAt: item.criadoEm?.toISOString?.() ?? new Date().toISOString(),
    })),
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

async function detectTradingDatasetDuplicate(params: {
  tenantId: string;
  semhash: string;
  embedding: number[];
}): Promise<{ isDuplicate: boolean; duplicateOfId?: string; similarityScore?: number }> {
  const db = getDatabase();
  const existingData = await db.query.tradingDataset.findMany({
    where: and(
      eq(schema.tradingDataset.tenantId, params.tenantId),
      inArray(schema.tradingDataset.status, ['pending', 'approved', 'used']),
      not(isNull(schema.tradingDataset.embedding))
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
}): Promise<{ created?: schema.TradingDataset; skipped?: string }> {
  const db = getDatabase();

  const existing = await db.query.tradingDataset.findFirst({
    where: and(
      eq(schema.tradingDataset.tenantId, params.authContext.tenantId),
      eq(schema.tradingDataset.orderId, params.order.id)
    ),
  });
  if (existing) {
    return { skipped: 'dataset já existe para a ordem' };
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

  const [created] = await db.insert(schema.tradingDataset).values({
    tenantId: params.authContext.tenantId,
    marketContext,
    prompt,
    response: responseText,
    actionType,
    status,
    reviewNotes,
    signalId: signal?.id ?? null,
    orderId: params.order.id,
    sourceType: 'order',
    sourceId: params.order.id,
    sourceMetadata: {
      orderId: params.order.id,
      signalId: signal?.id ?? null,
    },
    qualityScore,
    embedding,
    semhash,
    isDuplicate: duplicateResult.isDuplicate,
    duplicateOfId: duplicateResult.duplicateOfId ?? null,
    similarityScore: duplicateResult.similarityScore ?? null,
    criadoEm: new Date(),
    atualizadoEm: new Date(),
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

const TRADING_LLM_MAX_CONTEXT_TOKENS = 4096;
const TRADING_LLM_MIN_COMPLETION_TOKENS = 128;
const TRADING_LLM_PROMPT_SAFETY_TOKENS = 128;
const TRADING_LLM_MESSAGE_OVERHEAD_TOKENS = 8;
const TRADING_LLM_TOKEN_HEADROOM_TOKENS = 256;
const TRADING_LLM_CHARS_PER_TOKEN = 2.2;
const TRADING_LLM_PROMPT_ESTIMATE_MULTIPLIER = 1.25;
const TRADING_LLM_TOKEN_REGEX_SAFETY_MULTIPLIER = 1.15;
const TRADING_LLM_TOKEN_REGEX_PATTERN = /[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu;
const TRADING_LLM_MAX_ANALYSIS_BLOCK_CHARS = 1200;
const TRADING_LLM_MAX_NEWS_ITEMS = 5;
const TRADING_LLM_MAX_TRAINING_SAMPLES = 3;
const TRADING_LLM_MAX_SOURCE_LINE_CHARS = 220;
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
    sources.push(`Notícias (SearXNG):
Consulta: ${params.news.query}
${newsLines || '- Nenhum resultado relevante'}`);
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

  const arbitrageBlock = params.arbitrageSnapshot
    ? `### ARBITRAGEM TRIANGULAR (KuCoin)
Intermediário: ${params.arbitrageSnapshot.intermediateAsset}
Edge estimada: ${params.arbitrageSnapshot.edgePct.toFixed(2)}%
Rotas:
${params.arbitrageSnapshot.legs.map((leg) => `- ${leg.from} -> ${leg.to} via ${leg.symbol} (${leg.side}, rate ${leg.rate.toFixed(8)})`).join('\n')}`
    : '';

  return `
## CONTEXTO MULTI-TIMEFRAME
Indicadores habilitados: ${params.indicators.join(', ')}
Técnicas selecionadas: ${params.techniques.join(', ')}
Ensemble: ${params.ensembleResult.overallSignal.toUpperCase()} (conf ${params.ensembleResult.confidence.toFixed(2)})

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

const TRADING_LLM_SIGNAL_SCHEMA = z.object({
  signalType: z.enum(['entry_long', 'entry_short', 'exit', 'adjust_sl', 'adjust_tp', 'hold', 'neutral']),
  operationType: TradingOperationTypeSchema,
  expectedDurationMinutes: z.number().int().min(1).max(43200),
  confidence: z.number().min(0).max(1),
  tradeSummary: z.string().min(20),
  motivators: z.array(z.string().min(2)).min(1),
  invalidationReasons: z.array(z.string().min(2)).min(1),
  reasoning: z.string().min(10),
  suggestedPrice: z.number().positive().optional(),
  suggestedStopLoss: z.number().positive().optional(),
  suggestedTakeProfit: z.number().positive().optional(),
  suggestedSize: z.number().positive().optional(),
  riskReward: z.number().positive().optional(),
  marketCondition: z.string().min(3).optional(),
  riskScore: z.number().min(0).max(100).optional(),
});

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

// Trading tem polling de alta frequência + WS, precisa limite específico
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
const WISE_WEBHOOK_SECRET = process.env.WISE_WEBHOOK_SECRET;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// STRIPE: Fail-fast se produção sem webhook secret
if (!STRIPE_WEBHOOK_SECRET && IS_PRODUCTION && stripe) {
  logger.error('CRITICAL: STRIPE_WEBHOOK_SECRET é OBRIGATÓRIO em produção com Stripe ativo. Abortando.');
  process.exit(1);
}

// WISE: Warning se produção sem webhook secret (webhooks desabilitados, API funciona)
// CORREÇÃO 23/12/2025: WISE_WEBHOOK_SECRET só é gerado após primeiro deploy
// O serviço deve funcionar sem webhook secret - apenas webhooks ficam desabilitados
if (!WISE_WEBHOOK_SECRET && IS_PRODUCTION && isWiseConfigured()) {
  logger.warn('WISE_WEBHOOK_SECRET não configurado - webhooks Wise desabilitados. Configure após primeiro deploy se necessário.');
}

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

// Obter saldos multi-moeda
app.get('/api/integrations/wise/balances', requirePermission('integrations:wise:read'), async (_req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  try {
    const account = await wiseService.getBalances();
    res.json({ balances: account.balances, sandbox: wiseService.isSandboxMode() });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter saldos Wise');
    res.status(500).json({ error: 'Falha ao obter saldos' });
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

  const { sourceCurrency, targetCurrency, sourceAmount, targetAmount } = req.body;

  try {
    const quote = await wiseService.createQuote({
      sourceCurrency,
      targetCurrency,
      sourceAmount,
      targetAmount,
    });
    res.json({ quote });
  } catch (error) {
    logger.error({ error }, 'Falha ao criar cotação Wise');
    res.status(500).json({ error: 'Falha ao criar cotação' });
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
    const recipients = await wiseService.listRecipients(currency);
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
    const recipient = await wiseService.createRecipient({
      currency,
      type,
      accountHolderName,
      details,
    });
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
    const recipient = await wiseService.getRecipient(paramResult.data.id);
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
    await wiseService.deleteRecipient(paramResult.data.id);
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
    const transfers = await wiseService.listTransfers(limit, offset);
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
    const transfer = await wiseService.createTransfer({
      targetAccount,
      quoteUuid,
      customerTransactionId: customerTransactionId || `alice-${Date.now()}`,
      details: details || { reference: 'Pagamento Alice' },
    });

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
    const transfer = await wiseService.getTransfer(paramResult.data.id);
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
    const result = await wiseService.fundTransfer(paramResult.data.id);
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
    const transfer = await wiseService.cancelTransfer(paramResult.data.id);
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
  const webhookSecret = WISE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    logger.error({ deliveryId }, 'Webhook Wise: WISE_WEBHOOK_SECRET não configurado');
    res.status(500).json({ error: 'Webhook secret not configured' });
    return;
  }

  const validation = validateWiseWebhook(signature, payload, webhookSecret);
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
        if ((rating >= 4 || chatResult.escalated) && hasValidResponse) {
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
const KUCOIN_REST_ORDERBOOK_DEPTHS = [20, 100] as const;
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

function resolveKucoinRestOrderBookDepth(): 20 | 100 {
  const raw = process.env.KUCOIN_REST_ORDERBOOK_DEPTH;
  if (!raw) {
    throw new Error('KUCOIN_REST_ORDERBOOK_DEPTH não configurado');
  }
  const parsed = Number(raw);
  if (!KUCOIN_REST_ORDERBOOK_DEPTHS.includes(parsed as (typeof KUCOIN_REST_ORDERBOOK_DEPTHS)[number])) {
    throw new Error(`KUCOIN_REST_ORDERBOOK_DEPTH inválido: ${raw}. Use 20 ou 100.`);
  }
  return parsed as 20 | 100;
}

function resolveTradingIntervals(): {
  intervals: string[];
  granularityMap: Record<string, number>;
  wsIntervalMap: Record<string, string>;
  defaultInterval: string;
  restOrderBookDepth: 20 | 100;
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
// - Reconnect automático é responsabilidade do cliente (kucoinWebSocket.ts)
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

  initializeKucoinWebSocketClients()
    .then(async () => {
      initializeBroadcast()
        .then(async (status) => {
          if (!status.publisher) {
            logger.warn('Broadcast de trading iniciado sem publisher (Redis indisponível)');
          }
          const publisher = getPublisher();
          const publicWs = getPublicWebSocketClient();
          const privateWs = isKucoinWebSocketConfigured() ? getPrivateWebSocketClient() : null;
          const privateTenantId = await resolveKucoinTenantIdForPrivateWs();

          publicWs.on('ticker', (data) => {
            const normalized = normalizeTickerData(data);
            void publisher.publishTicker(data.symbol, normalized).catch((error) => {
              logger.error({ error }, 'Falha ao publicar ticker de trading');
            });
          });

          publicWs.on('orderbook', (data, symbol) => {
            const normalized = normalizeOrderBookData(data);
            void publisher.publishOrderBook(data.symbol || symbol, normalized).catch((error) => {
              logger.error({ error }, 'Falha ao publicar orderbook de trading');
            });
          });

          publicWs.on('kline', (data) => {
            const normalized = normalizeKlineData(data);
            void publisher.publishKlines(data.symbol, normalized).catch((error) => {
              logger.error({ error }, 'Falha ao publicar kline de trading');
            });
          });

          publicWs.on('trade', (data) => {
            const normalized = normalizeTradeData(data);
            void publisher.publishTrades(data.symbol, normalized).catch((error) => {
              logger.error({ error }, 'Falha ao publicar trades de trading');
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

function parseLlmSignalResponse(rawResponse: string) {
  const candidate = extractJsonObjectCandidate(rawResponse);
  try {
    const parsed = JSON.parse(candidate) as unknown;
    const result = TRADING_LLM_SIGNAL_SCHEMA.safeParse(parsed);
    if (!result.success) {
      throw new Error(`Resposta LLM inválida: ${result.error.message}`);
    }
    return result.data;
  } catch (error) {
    const repair = repairLlmJsonContent(candidate);
    if (repair.repaired) {
      try {
        logger.warn({ error: error instanceof Error ? error.message : error }, 'Resposta LLM inválida; aplicando reparo seguro do JSON.');
        const parsed = JSON.parse(repair.json) as unknown;
        const result = TRADING_LLM_SIGNAL_SCHEMA.safeParse(parsed);
        if (!result.success) {
          throw new Error(`Resposta LLM inválida após reparo: ${result.error.message}`);
        }
        return result.data;
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
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    if (message.startsWith('Resposta LLM inválida:')) {
      throw new Error(message);
    }
    logger.error({
      error: message,
      responseHash: computeSemHash(candidate),
      responseLength: candidate.length,
    }, 'Resposta LLM inválida (hash/len).');
    throw new Error(`Resposta LLM inválida: ${message}`);
  }
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
    strictMaxCompletionTokens
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
        eq(schema.agents.namespaceId, tradingNamespace.id),
        eq(schema.agents.status, 'active')
      ),
      orderBy: [desc(schema.agents.atualizadoEm)],
    });
  } else if (resolvedAgent.namespaceId) {
    namespace = (await db.query.namespaces.findFirst({
      where: eq(schema.namespaces.id, resolvedAgent.namespaceId),
    })) ?? null;
  }

  if (!resolvedAgent) {
    throw new Error('Agente Trading não encontrado ou inativo.');
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
}): string {
  const context = params.namespace?.contextoSistema?.trim();
  const instructions = params.agent.instrucoes?.trim();
  const personality = params.agent.personalidade?.trim();

  return [
    'Você é o Agente Trading da Alice. Gere um sinal objetivo e auditável.',
    context ? `Contexto do namespace: ${context}` : null,
    instructions ? `Instruções do agente: ${instructions}` : null,
    personality ? `Personalidade: ${personality}` : null,
    `MarketType: ${params.marketType}`,
    params.marginMode ? `MarginMode: ${params.marginMode}` : null,
    'Use o ranking técnico determinístico e o ensemble fornecidos no prompt.',
    'Sinais DEVEM incluir preço de entrada e níveis de saída (TP/SL) quando aplicável.',
    'Para arbitragem, considere timeframes curtos e execução imediata.',
    'Responda SOMENTE com JSON válido (sem texto extra).',
    'Use aspas duplas para TODAS as chaves e strings.',
    'Não use aspas duplas dentro dos valores; se precisar citar algo, use aspas simples ou escape com \\".',
    'Não use vírgulas finais (trailing commas).',
    'Evite quebras de linha dentro de strings: use \\n quando necessário.',
    'Retorne o JSON em UMA única linha, sem markdown.',
    'Schema:',
    '{',
    '  "signalType": "entry_long|entry_short|exit|adjust_sl|adjust_tp|hold|neutral",',
    '  "operationType": "scalping|swing|position|cash_and_carry|arbitrage|hedge|neutral",',
    '  "expectedDurationMinutes": number (min 1),',
    '  "confidence": 0.0-1.0,',
    '  "tradeSummary": "Resumo executivo do trade",',
    '  "motivators": ["driver 1", "driver 2"],',
    '  "invalidationReasons": ["condição 1", "condição 2"],',
    '  "reasoning": "Texto com valores citados exatamente",',
    '  "suggestedPrice": number (opcional),',
    '  "suggestedStopLoss": number (opcional),',
    '  "suggestedTakeProfit": number (opcional),',
    '  "suggestedSize": number (opcional),',
    '  "riskReward": number (opcional),',
    '  "marketCondition": "descrição curta" (opcional),',
    '  "riskScore": 0-100 (opcional)',
    '}',
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
          supportedMarkets: ['futures'],
          public: { state: 'disconnected' },
          private: { enabled: false, state: 'disconnected' },
        },
      });
      return;
    }

    const publicWs = getPublicWebSocketClient();
    const privateEnabled = isKucoinWebSocketConfigured();
    const privateWs = privateEnabled ? getPrivateWebSocketClient() : null;

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
        supportedMarkets: ['futures'],
        public: { state: publicWs.getState() },
        private: { enabled: privateEnabled, state: privateWs?.getState() ?? 'disconnected' },
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
    if (marketType !== 'futures') {
      kucoinWsSubscriptionsTotal.inc({ action: 'subscribe', channel, status: 'unsupported_market' }, 1);
      res.json({
        success: true,
        data: {
          supported: false,
          message: 'WebSocket KuCoin está disponível apenas para Futures; usando REST como fallback.',
        },
      });
      return;
    }

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

    const publicWs = getPublicWebSocketClient();
    if (!publicWs.isConnected()) {
      await publicWs.connect(false);
    }

    const orderBookDepth = (depth ?? resolveKucoinWsOrderBookDepth()) as 5 | 50;
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
    if (marketType !== 'futures') {
      kucoinWsSubscriptionsTotal.inc({ action: 'unsubscribe', channel, status: 'unsupported_market' }, 1);
      res.json({
        success: true,
        data: {
          supported: false,
          message: 'WebSocket KuCoin está disponível apenas para Futures; cancelamento ignorado.',
        },
      });
      return;
    }

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

    const publicWs = getPublicWebSocketClient();
    if (!publicWs.isConnected()) {
      kucoinWsSubscriptionsTotal.inc({ action: 'unsubscribe', channel, status: 'ws_disconnected' }, 1);
      res.status(409).json({ error: 'WebSocket KuCoin não está conectado' });
      return;
    }

    const orderBookDepth = (depth ?? resolveKucoinWsOrderBookDepth()) as 5 | 50;
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

  const agentContext = await resolveTradingAgentContext({
    tenantId: params.tenantId,
    agentId: params.agentId,
  });

  const profileRow = await getOrCreateTradingProfile(params.tenantId, 'signal');
  const profile = normalizeTradingProfile(profileRow);
  const timeframes = params.timeframes?.length ? params.timeframes : profile.timeframes;
  const indicators = params.indicators?.length ? params.indicators : profile.indicators;
  const dataSources = params.dataSources ?? profile.dataSources;
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
    throw new Error('Arbitragem triangular não é suportada em mercado futures.');
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

  if (techniques.includes('arbitrage_triangular') && arbitrageConfig) {
    const resolvedSymbol = primaryAnalysis.resolvedSymbol ?? params.symbol;
    const { base, quote } = splitSymbolPair(resolvedSymbol);
    arbitrageSnapshot = await calculateTriangularArbitrage({
      auth: { tenantId: params.tenantId, userId: params.userId },
      startAsset: base,
      quoteAsset: quote,
      intermediateAssets: arbitrageConfig.intermediateAssets,
      marketType: params.marketType,
      marginMode: params.marginMode,
      feePct: arbitrageConfig.feePct,
      maxSlippagePct: arbitrageConfig.maxSlippagePct,
    });
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

  const systemPrompt = buildTradingSignalSystemPrompt({
    marketType: params.marketType ?? 'futures',
    marginMode: params.marginMode,
    agent: agentContext.agent,
    namespace: agentContext.namespace,
  });
  const orderBookSnapshot = dataSources.orderBook
    ? await getOrderBookSnapshot({ tenantId: params.tenantId, userId: params.userId }, params.symbol, params.marketType, params.marginMode)
    : null;
  const newsSummary = dataSources.news
    ? await fetchNewsSummary(
      { tenantId: params.tenantId, userId: params.userId },
      params.symbol,
      params.marketType,
      profile.newsConfig
    )
    : null;
  const trainingSummary = dataSources.trainingData
    ? await fetchTradingDatasetSummary(params.tenantId)
    : null;
  const rawAnalysisPrompt = buildMultiTimeframePrompt({
    matrix: analysisMatrix,
    consensus,
    indicators,
    dataSources,
    orderBook: orderBookSnapshot,
    news: newsSummary,
    trainingData: trainingSummary,
    techniques,
    techniqueScores,
    ensembleResult,
    arbitrageSnapshot,
  });

  const requestedMaxTokens = params.modelConfig?.maxTokens ?? agentContext.llmConfig.maxTokens ?? 2048;
  const tokenBudget = resolveMaxTokensForPrompt({
    systemPrompt,
    analysisPrompt: rawAnalysisPrompt,
    requestedMaxTokens,
  });
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

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: analysisPrompt },
  ];

  const gpuResponse = await requestGpu({
    serviceType: GpuServiceType.LLM,
    endpoint: '/v1/chat/completions',
    method: 'POST',
    priority: GpuRequestPriority.HIGH,
    body: {
      model: agentContext.llmConfig.model,
      messages,
      response_format: { type: 'json_object' },
      max_tokens: tokenBudget.maxCompletionTokens,
      temperature: params.modelConfig?.temperature ?? agentContext.llmConfig.temperature ?? 0.7,
      stream: false,
    },
  });

  if (!gpuResponse.success || !gpuResponse.data) {
    throw new Error(gpuResponse.error || 'Falha na resposta do GPU Manager.');
  }

  const responseData = gpuResponse.data as LLMResponse;
  const llmContent = responseData.choices?.[0]?.message?.content?.trim() || '';
  if (!llmContent) {
    throw new Error('Resposta do LLM vazia ou inválida.');
  }

  const llmSignal = parseLlmSignalResponse(llmContent);
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
        dataSources,
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

  const validationSnapshot = analysisMatrix.find((entry) => consensus.alignedTimeframes.includes(entry.interval)) ?? primaryAnalysis;
  const validation = await validateAndPersist({
    tenantId: params.tenantId,
    llmResponse: llmSignal.reasoning,
    indicatorSnapshot: validationSnapshot.analysis,
    indicatorSnapshotId: validationSnapshot.indicatorId,
    signalId: createResult.data.id,
    maxAllowedDeviation: 0.01,
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
      symbol: z.string().optional(),
      marketType: z.enum(['futures', 'spot', 'margin']).optional(),
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
    const marketType = queryResult.data.marketType ?? undefined;
    const validationStatus = queryResult.data.validationStatus ?? undefined;
    const approvalStatus = queryResult.data.approvalStatus ?? undefined;
    const includeDeleted = queryResult.data.includeDeleted ?? false;

    const symbolParam = queryResult.data.symbol;
    const resolvedSymbol = symbolParam
      ? await resolveTradingSymbolOrRespond(res, tradingAuth, symbolParam, { required: true, marketType })
      : undefined;
    if (symbolParam && !resolvedSymbol) return;

    const conditions = [eq(schema.tradingSignals.tenantId, authContext.tenantId)];
    if (resolvedSymbol) conditions.push(eq(schema.tradingSignals.symbol, resolvedSymbol));
    if (marketType) conditions.push(eq(schema.tradingSignals.marketType, marketType));
    if (cursorDate) conditions.push(lt(schema.tradingSignals.criadoEm, cursorDate));
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
    const history = await db
      .select()
      .from(schema.tradingSignals)
      .where(and(...conditions))
      .orderBy(desc(schema.tradingSignals.criadoEm))
      .limit(limit);

    const nextCursor = history.length > 0
      ? history[history.length - 1]?.criadoEm?.toISOString() ?? null
      : null;

    res.json({
      success: true,
      data: history.map(mapTradingSignalForApi),
      nextCursor,
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

// POST /api/integrations/trading/signals/:id/approve - Aprovar sinal (cria ordem pendente)
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
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao gerar sinal LLM');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/datasets - Lista datasets de trading
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
      eq(schema.tradingDataset.tenantId, authContext.tenantId),
      parsed.data.status ? eq(schema.tradingDataset.status, parsed.data.status) : sql`1=1`
    );

    const db = getDatabase();
    const total = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.tradingDataset)
      .where(whereClause);

    const rows = await db.query.tradingDataset.findMany({
      where: whereClause,
      orderBy: [desc(schema.tradingDataset.criadoEm)],
      limit,
      offset,
    });

    res.json({
      success: true,
      data: rows,
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
      reviewNotes: z.string().optional(),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
      return;
    }

    const db = getDatabase();
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

    const seed = await buildTradingDatasetSeedFromSignal({
      authContext: { tenantId: authContext.tenantId, userId: authContext.userId },
      signal,
    });

    const responsePayload = seed.responsePayload;
    const prompt = seed.prompt;
    const responseText = JSON.stringify(responsePayload);
    const semhash = computeSemHash(`${prompt}\n${responseText}`);
    const embedding = await generateTradingDatasetEmbedding(`${prompt}\n${responseText}`);
    const duplicateResult = await detectTradingDatasetDuplicate({
      tenantId: authContext.tenantId,
      semhash,
      embedding,
    });
    const qualityScore = computeTradingDatasetQualityScore({
      confidence: signal.confidence ?? undefined,
      prompt,
      response: responseText,
    });
    const autoRejectedByQuality = qualityScore < TRADING_DATASET_MIN_QUALITY;
    const status = duplicateResult.isDuplicate || autoRejectedByQuality ? 'rejected' : 'pending';
    const reviewNotes = autoRejectedByQuality
      ? `Auto-rejeitado: qualidade ${qualityScore.toFixed(2)} abaixo do mínimo (${TRADING_DATASET_MIN_QUALITY}).`
      : parsed.data.reviewNotes ?? null;

    const [created] = await db.insert(schema.tradingDataset).values({
      tenantId: authContext.tenantId,
      marketContext: seed.marketContext,
      prompt,
      response: responseText,
      actionType: signal.signalType,
      status,
      reviewNotes,
      signalId: signal.id,
      orderId: signal.executedOrderId ?? null,
      sourceType: 'signal',
      sourceId: signal.id,
      sourceMetadata: {
        interval: seed.interval,
        marketType: signal.marketType,
      },
      qualityScore,
      embedding,
      semhash,
      isDuplicate: duplicateResult.isDuplicate,
      duplicateOfId: duplicateResult.duplicateOfId ?? null,
      similarityScore: duplicateResult.similarityScore ?? null,
      criadoEm: new Date(),
      atualizadoEm: new Date(),
    }).returning();

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

    res.json({ success: true, data: created });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao criar dataset de trading');
    res.status(500).json({ error: errorMessage });
  }
});

// PATCH /api/integrations/trading/datasets/:id/review - Aprovar/rejeitar dataset
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
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
      return;
    }

    const db = getDatabase();
    const [updated] = await db.update(schema.tradingDataset)
      .set({
        status: parsed.data.status,
        reviewNotes: parsed.data.reviewNotes ?? null,
        reviewedBy: authContext.userId,
        reviewedAt: new Date(),
        atualizadoEm: new Date(),
      })
      .where(and(
        eq(schema.tradingDataset.id, req.params.id),
        eq(schema.tradingDataset.tenantId, authContext.tenantId)
      ))
      .returning();

    if (!updated) {
      res.status(404).json({ error: 'Dataset não encontrado' });
      return;
    }

    res.json({ success: true, data: updated });
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
        minAgree: z.number().min(1).optional(),
      }).optional(),
    });
    const parsedBody = bodySchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({ error: 'Dados inválidos', details: parsedBody.error.flatten() });
      return;
    }

    const profileRow = await getOrCreateTradingProfile(authContext.tenantId, parsedBody.data.kind);
    const consensusUpdate = parsedBody.data.consensus
      ? { rule: 'majority' as const, minAgree: parsedBody.data.consensus.minAgree }
      : undefined;
    const resolvedTimeframes = (parsedBody.data.timeframes ?? profileRow.timeframes) as TradingIntervalValue[];
    const resolvedTechniques = normalizeTradingTechniques(parsedBody.data.techniques ?? (profileRow.techniques as TradingTechnique[] | null));
    const resolvedEnsemble = normalizeTradingEnsembleConfig(parsedBody.data.ensembleConfig ?? (profileRow.ensembleConfig as TradingEnsembleConfig | null));
    const resolvedArbitrage = normalizeTradingArbitrageConfig(
      parsedBody.data.arbitrageConfig ?? (profileRow.arbitrageConfig as TradingArbitrageConfig | null)
    );
    assertArbitrageConfigForTechniques({
      techniques: resolvedTechniques,
      arbitrageConfig: resolvedArbitrage,
      timeframes: resolvedTimeframes,
      context: 'perfil de análise/sinal',
    });

    const updated = await getDatabase()
      .update(schema.tradingAnalysisProfiles)
      .set({
        name: parsedBody.data.name ?? profileRow.name,
        timeframes: resolvedTimeframes,
        indicators: parsedBody.data.indicators ?? profileRow.indicators,
        dataSources: parsedBody.data.dataSources ?? profileRow.dataSources,
        techniques: resolvedTechniques,
        ensembleConfig: resolvedEnsemble,
        arbitrageConfig: resolvedArbitrage ?? null,
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
          message: 'depth inválido. Valores permitidos: 20, 100.',
          path: ['depth'],
        });
      }
    });

    const queryResult = querySchema.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
      return;
    }

    const depth = (queryResult.data.depth ?? defaultDepth) as 20 | 100;
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

// GET /api/integrations/trading/trades/:symbol - Histórico de Trades
app.get('/api/integrations/trading/trades/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
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

    const trades = await kucoinClient.getTradeHistory(resolvedSymbol);

    res.json({
      success: true,
      data: trades,
      symbol: resolvedSymbol,
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
    if (techniques.includes('arbitrage_triangular') && arbitrageConfig) {
      const resolvedSymbol = primaryResult.resolvedSymbol ?? symbol;
      const { base, quote } = splitSymbolPair(resolvedSymbol);
      arbitrageSnapshot = await calculateTriangularArbitrage({
        auth: { tenantId, userId },
        startAsset: base,
        quoteAsset: quote,
        intermediateAssets: arbitrageConfig.intermediateAssets,
        marketType,
        marginMode,
        feePct: arbitrageConfig.feePct,
        maxSlippagePct: arbitrageConfig.maxSlippagePct,
      });
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
    const orderBook = dataSources.orderBook
      ? await getOrderBookSnapshot({ tenantId, userId }, symbol, marketType, marginMode)
      : null;
    const news = dataSources.news
      ? await fetchNewsSummary(
        { tenantId, userId },
        symbol,
        marketType,
        profile.newsConfig
      )
      : null;
    const trainingData = dataSources.trainingData
      ? await fetchTradingDatasetSummary(tenantId)
      : null;
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
      profile: {
        kind: profileRow.kind,
        timeframes,
        indicators,
        dataSources,
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

// GET /api/integrations/trading/analysis/history - Histórico de análises
app.get('/api/integrations/trading/analysis/history', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }
    const tradingAuth = { tenantId: authContext.tenantId, userId: authContext.userId };

    const symbolParam = req.query.symbol as string | undefined;
    const resolvedSymbol = symbolParam
      ? await resolveTradingSymbolOrRespond(res, tradingAuth, symbolParam, { required: true })
      : await kucoinService.resolveTradingSymbol(tradingAuth);
    if (!resolvedSymbol) return;
    const intervalParam = req.query.interval as string || '5m';
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const cursorParam = req.query.cursor as string | undefined;
    const cursorDate = cursorParam ? new Date(cursorParam) : null;

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
      buildNotDeletedMetadataCondition(schema.tradingTechnicalIndicators.metadata),
    ];
    if (cursorDate && !Number.isNaN(cursorDate.getTime())) {
      conditions.push(lt(schema.tradingTechnicalIndicators.calculatedAt, cursorDate));
    }

    const history = await db
      .select()
      .from(schema.tradingTechnicalIndicators)
      .where(and(...conditions))
      .orderBy(desc(schema.tradingTechnicalIndicators.calculatedAt))
      .limit(limit);

    res.json({
      success: true,
      data: history,
      count: history.length,
      symbol: resolvedSymbol,
      nextCursor: history.length > 0
        ? history[history.length - 1]?.calculatedAt?.toISOString() ?? null
        : null,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter histórico de análises');
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

    // Calcular estatísticas
    const allValidations = await db
      .select()
      .from(schema.tradingLlmValidations)
      .where(eq(schema.tradingLlmValidations.tenantId, authContext.tenantId));

    const totalValidations = allValidations.length;
    const passedValidations = allValidations.filter(v => v.validationPassed).length;
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

  const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info({ port: PORT }, 'Integrations service started');
  });

  startTradingMetricsScheduler();
  startTradingSignalScheduler();
  startTradingAnalysisScheduler();
  refreshIntegrationHealthMetrics().catch((error) => {
    logger.warn({ error }, 'Falha ao atualizar métricas de integrações no startup');
  });
  const integrationHealthInterval = setInterval(() => {
    refreshIntegrationHealthMetrics().catch((error) => {
      logger.warn({ error }, 'Falha ao atualizar métricas de integrações');
    });
  }, INTEGRATION_HEALTH_REFRESH_MS);

  // SEGURANÇA: Timeouts para prevenir conexões pendentes (Node.js 20 LTS Best Practices)
  server.timeout = 30000; // 30s timeout para requisições
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
    'integrations-kucoin-websocket',
    async () => {
      // WS5: garante shutdown limpo dos clientes WS (evita sockets pendurados)
      closeKucoinWebSocketClients();
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
