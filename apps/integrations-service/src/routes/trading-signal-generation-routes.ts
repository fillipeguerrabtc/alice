import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { z } from 'zod';
import { extractAuthContext, REASONING_MODE_VALUES, requirePermission } from '@alice/shared-utils';
import type { Role } from '@alice/shared-utils';
import { TradingArbitrageConfigSchema, TradingEnsembleConfigSchema, type TradingIndicatorKey, type TradingTechnique } from '@alice/shared';
import type { schema } from '@alice/database';
import type {
  TradingArbitrageConfig,
  TradingEnsembleConfig,
  TradingProfileConsensus,
  TradingProfileDataSources,
  TradingProfileModelConfig,
} from '@alice/shared';

type TradingMarketType = 'futures' | 'spot' | 'margin';
type TradingMarginMode = 'cross' | 'isolated';
type TradingIntervalValue =
  | '1m'
  | '3m'
  | '5m'
  | '15m'
  | '30m'
  | '1h'
  | '2h'
  | '4h'
  | '8h'
  | '12h'
  | '1d'
  | '1w';
type ReasoningMode = (typeof REASONING_MODE_VALUES)[number];

interface TradingAuthContext {
  tenantId: string;
  userId: string;
  role: Role;
}

type UniverseSymbolSelection = {
  symbol: string;
  source: 'universe_candidates' | 'default_symbol' | 'requested';
  symbolsEvaluated: number;
  candidatesEvaluated: number;
};

interface RegisterTradingSignalGenerationRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  tradingIntervalZod: z.ZodType<TradingIntervalValue>;
  tradingIndicatorZod: z.ZodType<string>;
  tradingTechniqueZod: z.ZodType<string>;
  sendKucoinErrorResponse: (res: Response, error: unknown) => boolean;
  respondKucoinNotConfigured: (res: Response) => void;
  isKucoinConfigured: () => boolean;
  isSpotConfigured: () => boolean;
  isMarginConfigured: () => boolean;
  selectSymbolFromUniverseCandidates: (params: {
    tenantId: string;
    marketType: TradingMarketType;
    maxAssets: number;
  }) => Promise<UniverseSymbolSelection | null>;
  resolveTradingSymbolOrRespond: (
    res: Response,
    authContext: TradingAuthContext,
    symbol?: string,
    options?: { required?: boolean; marketType?: TradingMarketType; marginMode?: TradingMarginMode },
  ) => Promise<string | undefined>;
  generateTradingSignalFromLlm: (params: {
    tenantId: string;
    userId: string;
    symbol: string;
    interval: string;
    marketType?: TradingMarketType;
    marginMode?: TradingMarginMode;
    source: 'on_demand' | 'scheduler' | 'chat' | 'auto';
    agentId?: string;
    timeframes?: TradingIntervalValue[];
    indicators?: TradingIndicatorKey[];
    dataSources?: TradingProfileDataSources;
    techniques?: TradingTechnique[];
    ensembleConfig?: TradingEnsembleConfig;
    arbitrageConfig?: TradingArbitrageConfig;
    modelConfig?: TradingProfileModelConfig;
    consensus?: TradingProfileConsensus;
    reasoningMode?: ReasoningMode;
  }) => Promise<{
    signal: schema.TradingSignal;
    validationId: string;
    validationStatus: 'pending' | 'validated' | 'failed';
  }>;
  isTradingConfigError: (error: unknown) => boolean;
  mapTradingErrorToUserMessage: (error: Error) => { message: string; code: string };
}

type SignalGenerationStateCategory = 'signal_generated' | 'no_trade' | 'blocked' | 'failed';

type SignalGenerationClassification = {
  stateCategory: SignalGenerationStateCategory;
  reasonCode: string | null;
  reasonHuman: string;
};

function mapTradingSignalForApi(signal: schema.TradingSignal) {
  const metadata = (signal.metadata ?? {}) as Record<string, unknown>;
  return {
    ...signal,
    reasoning: typeof metadata.reasoning === 'string' ? metadata.reasoning : null,
    sourceModel: typeof metadata.modelVersion === 'string' ? metadata.modelVersion : null,
    metadata,
  };
}

function resolveSignalGenerationReasonHuman(reasonCode: string | null): string {
  if (!reasonCode) {
    return 'Sinal gerado com critérios elegíveis para execução.';
  }
  const reasonTextByCode: Record<string, string> = {
    UNVALIDATED: 'Candidato ainda sem validação estatística mínima (DSR/PBO).',
    LIQUIDITY_CONSTRAINT: 'Sem liquidez mínima: spread alargado ou profundidade insuficiente.',
    GUARDRAIL_BLOCKED: 'Guardrails bloquearam o trade por risco fora da política.',
    NO_CANDIDATES: 'Nenhum candidato elegível foi encontrado para o escopo atual.',
    NO_EDGE: 'Edge líquido insuficiente para execução segura.',
    TRADING_SCOPE_REQUIRED: 'Escopo de Trading obrigatório não configurado para este fluxo.',
    CONFIG_BLOCKED: 'Configuração obrigatória bloqueou a geração de sinal.',
    UNEXPECTED_ERROR: 'Falha inesperada durante a geração de sinal.',
  };
  return reasonTextByCode[reasonCode] ?? 'Reason code sem descrição operacional cadastrada.';
}

function resolveSignalGenerationClassification(params: {
  signalType: schema.TradingSignal['signalType'];
  noTradeReasonCode: string | null;
}): SignalGenerationClassification {
  const noTradeLike = params.signalType === 'hold'
    || params.signalType === 'neutral'
    || Boolean(params.noTradeReasonCode);

  if (noTradeLike) {
    return {
      stateCategory: 'no_trade',
      reasonCode: params.noTradeReasonCode ?? 'NO_EDGE',
      reasonHuman: resolveSignalGenerationReasonHuman(params.noTradeReasonCode ?? 'NO_EDGE'),
    };
  }

  return {
    stateCategory: 'signal_generated',
    reasonCode: null,
    reasonHuman: resolveSignalGenerationReasonHuman(null),
  };
}

function getTradingAuthContext(req: Request): TradingAuthContext | null {
  const authContext = extractAuthContext(req);
  if (!authContext?.tenantId || !authContext?.userId || !authContext.role) {
    return null;
  }
  return { tenantId: authContext.tenantId, userId: authContext.userId, role: authContext.role };
}

const REASONING_OVERRIDE_ALLOWED_ROLES = new Set<Role>(['admin', 'super_admin']);

function canOverrideReasoningMode(role: Role): boolean {
  return REASONING_OVERRIDE_ALLOWED_ROLES.has(role);
}

export function registerTradingSignalGenerationRoutes(
  app: Express,
  deps: RegisterTradingSignalGenerationRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');
  const reasoningModeZod = z.enum(REASONING_MODE_VALUES);

  const generateSchema = z.object({
    symbol: z.string().optional(),
    interval: deps.tradingIntervalZod.optional(),
    timeframes: z.array(deps.tradingIntervalZod).min(1).optional(),
    indicators: z.array(deps.tradingIndicatorZod).min(1).optional(),
    dataSources: z.object({
      orderBook: z.boolean().optional(),
      news: z.boolean().optional(),
      trainingData: z.boolean().optional(),
    }).optional(),
    techniques: z.array(deps.tradingTechniqueZod).min(1).optional(),
    ensembleConfig: TradingEnsembleConfigSchema.optional(),
    arbitrageConfig: TradingArbitrageConfigSchema.optional().nullable(),
    modelConfig: z.object({
      temperature: z.number().min(0).max(2).optional(),
      maxTokens: z.number().min(256).max(4096).optional(),
    }).optional(),
    reasoningMode: reasoningModeZod.optional(),
    scanUniverse: z.boolean().optional(),
    maxAssets: z.number().int().min(1).max(200).optional(),
    consensus: z.object({
      rule: z.literal('majority').optional(),
      minAgree: z.number().min(1).optional(),
    }).optional(),
    marketType: z.enum(['futures', 'spot', 'margin']).optional(),
    marginMode: z.enum(['cross', 'isolated']).optional(),
    agentId: z.string().uuid().optional(),
  });

  app.post('/api/integrations/trading/signals/generate', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    let authContext: TradingAuthContext | null = null;
    try {
      authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const parsed = generateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
        return;
      }
      if (
        parsed.data.reasoningMode
        && parsed.data.reasoningMode !== 'auto'
        && !canOverrideReasoningMode(authContext.role)
      ) {
        res.status(403).json({ error: 'Apenas admin/superadmin podem definir reasoningMode manual.' });
        return;
      }

      const marketType = parsed.data.marketType;
      const marginMode = parsed.data.marginMode;

      if (marketType === 'spot' && !deps.isSpotConfigured()) {
        deps.respondKucoinNotConfigured(res);
        return;
      }
      if (marketType === 'margin' && !deps.isMarginConfigured()) {
        deps.respondKucoinNotConfigured(res);
        return;
      }
      if ((!marketType || marketType === 'futures') && !deps.isKucoinConfigured()) {
        deps.respondKucoinNotConfigured(res);
        return;
      }

      const shouldScanUniverse = Boolean((parsed.data.scanUniverse ?? !parsed.data.symbol) && !parsed.data.symbol);
      const maxAssets = parsed.data.maxAssets ?? 50;
      let universeSelection: UniverseSymbolSelection | null = null;
      let symbolHint = parsed.data.symbol;

      if (shouldScanUniverse) {
        universeSelection = await deps.selectSymbolFromUniverseCandidates({
          tenantId: authContext.tenantId,
          marketType: marketType ?? 'futures',
          maxAssets,
        });
        if (universeSelection?.symbol) {
          symbolHint = universeSelection.symbol;
        }
      }

      const resolvedSymbol = await deps.resolveTradingSymbolOrRespond(res, authContext, symbolHint, {
        required: false,
        marketType,
        marginMode,
      });
      if (!resolvedSymbol) return;

      if (!universeSelection && !parsed.data.symbol) {
        universeSelection = {
          symbol: resolvedSymbol,
          source: 'default_symbol',
          symbolsEvaluated: 1,
          candidatesEvaluated: 0,
        };
      }

      const consensusOverride = parsed.data.consensus
        ? { rule: 'majority' as const, minAgree: parsed.data.consensus.minAgree }
        : undefined;

      const result = await deps.generateTradingSignalFromLlm({
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
        reasoningMode: parsed.data.reasoningMode,
      });
      const mappedSignal = mapTradingSignalForApi(result.signal);
      const metadata = (mappedSignal.metadata ?? {}) as Record<string, unknown>;
      const noTradeReasonCode = typeof metadata.noTradeReasonCode === 'string' ? metadata.noTradeReasonCode : null;
      const generationClassification = resolveSignalGenerationClassification({
        signalType: mappedSignal.signalType,
        noTradeReasonCode,
      });
      logger.info({
        event: 'trading.signal.generation.result',
        classification: generationClassification.stateCategory,
        tenantId: authContext.tenantId,
        userId: authContext.userId,
        symbol: mappedSignal.symbol,
        marketType: mappedSignal.marketType,
        signalType: mappedSignal.signalType,
        validationStatus: result.validationStatus,
        reasonCode: generationClassification.reasonCode,
        reasonHuman: generationClassification.reasonHuman,
      }, 'Geração de sinal classificada');

      res.status(201).json({
        success: true,
        data: mappedSignal,
        validationId: result.validationId,
        validationStatus: result.validationStatus,
        universeSelection,
        signalGeneration: generationClassification,
      });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      if (deps.isTradingConfigError(error)) {
        const statusCode = error instanceof Error && error.message.includes('TRADING_SCOPE_REQUIRED') ? 412 : 400;
        const errorMessage = error instanceof Error ? error.message : 'Configuração de trading inválida';
        const reasonCode = errorMessage.toUpperCase().includes('TRADING_SCOPE_REQUIRED')
          ? 'TRADING_SCOPE_REQUIRED'
          : 'CONFIG_BLOCKED';
        logger.warn({
          event: 'trading.signal.generation.result',
          classification: 'blocked',
          tenantId: authContext?.tenantId,
          userId: authContext?.userId,
          statusCode,
          reasonCode,
          reasonHuman: resolveSignalGenerationReasonHuman(reasonCode),
          error: errorMessage,
        }, 'Geração de sinal bloqueada por guardrail/configuração');
        res.status(statusCode).json({
          error: errorMessage,
          signalGeneration: {
            stateCategory: 'blocked',
            reasonCode,
            reasonHuman: resolveSignalGenerationReasonHuman(reasonCode),
          },
        });
        return;
      }
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      const errorStack = error instanceof Error ? error.stack : undefined;
      const errorCause = error instanceof Error && 'cause' in error ? (error.cause as { message?: string })?.message : undefined;
      logger.error({
        event: 'trading.signal.generation.result',
        classification: 'failed',
        reasonCode: 'UNEXPECTED_ERROR',
        error: errorMessage,
        cause: errorCause,
        stack: errorStack,
      }, 'Erro ao gerar sinal LLM');
      const userError = deps.mapTradingErrorToUserMessage(error instanceof Error ? error : new Error(errorMessage));
      res.status(500).json({
        error: userError.message,
        code: userError.code,
        signalGeneration: {
          stateCategory: 'failed',
          reasonCode: userError.code || 'UNEXPECTED_ERROR',
          reasonHuman: userError.message || resolveSignalGenerationReasonHuman('UNEXPECTED_ERROR'),
        },
      });
    }
  });
}
