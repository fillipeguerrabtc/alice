/**
 * SSOT de modelos LLM e contrato de reasoning mode.
 *
 * Centraliza catálogo de famílias de modelo para evitar duplicação entre serviços.
 * Mantém compatibilidade de leitura para valores históricos legados.
 *
 * Autor: Fillipe Guerra
 * Data: 11 de Marco de 2026
 */

import { REASONING_MODE_VALUES, type ReasoningMode } from '@alice/config';
import { createLogger } from '@alice/logger';

const logger = createLogger('llm-models');

export { REASONING_MODE_VALUES };
export type { ReasoningMode } from '@alice/config';

export interface LlmModelCatalogEntry {
  publicModelName: string;
  servingModelId: string;
  trainingBaseModelId: string;
  reasoningDefault: ReasoningMode;
}

export type SupportedLlmModelFamily = 'qwen3_8b';

export const LLM_MODEL_CATALOG: Record<SupportedLlmModelFamily, LlmModelCatalogEntry> = {
  qwen3_8b: {
    publicModelName: 'Qwen3-8B',
    servingModelId: 'Qwen/Qwen3-8B-AWQ',
    trainingBaseModelId: 'Qwen/Qwen3-8B',
    reasoningDefault: 'auto',
  },
};

export const PRIMARY_LLM_MODEL_FAMILY: SupportedLlmModelFamily = 'qwen3_8b';
export const PRIMARY_LLM_MODEL_CATALOG_ENTRY = LLM_MODEL_CATALOG[PRIMARY_LLM_MODEL_FAMILY];

export const DEFAULT_PUBLIC_LLM_MODEL_NAME = PRIMARY_LLM_MODEL_CATALOG_ENTRY.publicModelName;
export const DEFAULT_LLM_SERVING_MODEL_ID = PRIMARY_LLM_MODEL_CATALOG_ENTRY.servingModelId;
export const DEFAULT_LLM_TRAINING_BASE_MODEL_ID = PRIMARY_LLM_MODEL_CATALOG_ENTRY.trainingBaseModelId;
export const DEFAULT_REASONING_MODE: ReasoningMode = PRIMARY_LLM_MODEL_CATALOG_ENTRY.reasoningDefault;
export const DEFAULT_EMBEDDINGS_MODEL_ID = 'Qwen/Qwen3-Embedding-0.6B';

export const ALLOWED_AGENT_LLM_MODEL_NAMES = [
  DEFAULT_PUBLIC_LLM_MODEL_NAME,
  // Compatibilidade histórica: mantido para leitura/escrita legada.
  'Qwen2.5-7B-Instruct-AWQ',
] as const;

export const LEGACY_AGENT_LLM_MODEL_NAMES = [
  'Mistral-7B-Instruct',
  'Mistral-7B-Instruct-AWQ',
  'Qwen2.5-VL-7B',
  'Qwen2.5-VL-7B-AWQ',
  'Qwen2.5-VL-7B-Instruct-AWQ',
  'Mixtral-8x7B',
] as const;

type ModelAliasTarget = {
  family: SupportedLlmModelFamily;
  isLegacyAlias: boolean;
};

const MODEL_NAME_ALIASES: Record<string, ModelAliasTarget> = {
  // Nomes canônicos/aliases Qwen3
  [DEFAULT_PUBLIC_LLM_MODEL_NAME]: { family: PRIMARY_LLM_MODEL_FAMILY, isLegacyAlias: false },
  'Qwen3-8B-AWQ': { family: PRIMARY_LLM_MODEL_FAMILY, isLegacyAlias: false },
  [DEFAULT_LLM_SERVING_MODEL_ID]: { family: PRIMARY_LLM_MODEL_FAMILY, isLegacyAlias: false },

  // Compatibilidade de leitura Qwen2.5 -> resolve para família Qwen3.
  'Qwen2.5-7B-Instruct-AWQ': { family: PRIMARY_LLM_MODEL_FAMILY, isLegacyAlias: true },
  'Qwen/Qwen2.5-7B-Instruct-AWQ': { family: PRIMARY_LLM_MODEL_FAMILY, isLegacyAlias: true },
};

const REASONING_MODE_SET = new Set<string>(REASONING_MODE_VALUES as readonly string[]);
const REASONING_COMPLEXITY_KEYWORDS = [
  'analise',
  'analisar',
  'estrategia',
  'strategy',
  'portfolio',
  'risco',
  'risk',
  'backtest',
  'compare',
  'comparar',
  'justifique',
  'justificar',
  'trade',
  'trading',
] as const;

export type EffectiveReasoningMode = Exclude<ReasoningMode, 'auto'>;

export interface ReasoningModeResolution {
  requestedMode: ReasoningMode;
  effectiveMode: EffectiveReasoningMode;
  source: 'manual' | 'heuristic';
  heuristicScore: number;
  reasonResolution: string;
}

export interface ReasoningHeuristicSignals {
  longMessage: boolean;
  multiTurnContext: boolean;
  highTokenBudget: boolean;
  structuredOutput: boolean;
  complexityKeyword: boolean;
}

export interface ResolvedReasoningRequest {
  requestedReasoningMode: ReasoningMode;
  resolvedReasoningMode: EffectiveReasoningMode;
  reasonResolution: string;
  source: 'manual' | 'heuristic';
  heuristicScore: number;
  heuristicSignals: ReasoningHeuristicSignals;
  runtimeExtraBody: {
    chat_template_kwargs: {
      enable_thinking: boolean;
    };
  };
  gatewayMetadataExtraBody: {
    alice_requested_reasoning_mode: ReasoningMode;
    alice_resolved_reasoning_mode: EffectiveReasoningMode;
    alice_reason_resolution: string;
    alice_reasoning_source: 'manual' | 'heuristic';
    alice_reasoning_heuristic_score: number;
  };
}

export interface ResolvedAgentLlmModel {
  model: string | null;
  isLegacy: boolean;
  publicModelName: string | null;
  servingModelId: string | null;
  trainingBaseModelId: string | null;
  reasoningDefault: ReasoningMode | null;
}

function isLegacyModelName(modelName: string): boolean {
  return (LEGACY_AGENT_LLM_MODEL_NAMES as readonly string[]).includes(modelName);
}

export function resolveAgentLlmModel(modelName: string): ResolvedAgentLlmModel {
  const normalized = modelName.trim();
  const aliasTarget = MODEL_NAME_ALIASES[normalized];

  if (aliasTarget) {
    const catalogEntry = LLM_MODEL_CATALOG[aliasTarget.family];
    if (aliasTarget.isLegacyAlias) {
      logger.info(
        {
          modelName: normalized,
          migratedTo: catalogEntry.servingModelId,
        },
        'Modelo legado resolvido via compatibilidade de leitura'
      );
    }

    return {
      model: catalogEntry.servingModelId,
      isLegacy: aliasTarget.isLegacyAlias,
      publicModelName: catalogEntry.publicModelName,
      servingModelId: catalogEntry.servingModelId,
      trainingBaseModelId: catalogEntry.trainingBaseModelId,
      reasoningDefault: catalogEntry.reasoningDefault,
    };
  }

  const isLegacy = isLegacyModelName(normalized);
  logger.warn({ modelName: normalized, isLegacy }, 'Modelo LLM do agente não suportado');
  return {
    model: null,
    isLegacy,
    publicModelName: null,
    servingModelId: null,
    trainingBaseModelId: null,
    reasoningDefault: null,
  };
}

export function resolveServingModelIdFromConfig(modelName: string | null | undefined): string {
  const normalized = typeof modelName === 'string' ? modelName.trim() : '';
  if (!normalized) {
    return DEFAULT_LLM_SERVING_MODEL_ID;
  }

  const resolved = resolveAgentLlmModel(normalized);
  if (resolved.servingModelId) {
    return resolved.servingModelId;
  }

  // Compatibilidade: se vier ID completo do provedor, respeita valor configurado.
  if (normalized.includes('/')) {
    return normalized;
  }

  logger.warn(
    {
      configuredModel: normalized,
      fallbackModel: DEFAULT_LLM_SERVING_MODEL_ID,
    },
    'Modelo configurado inválido; aplicando fallback para SSOT Qwen3'
  );
  return DEFAULT_LLM_SERVING_MODEL_ID;
}

export function resolveReasoningMode(mode: string | null | undefined): ReasoningMode {
  const normalized = typeof mode === 'string' ? mode.trim().toLowerCase() : '';
  if (normalized.length === 0) {
    return DEFAULT_REASONING_MODE;
  }

  if (REASONING_MODE_SET.has(normalized)) {
    return normalized as ReasoningMode;
  }

  logger.warn({ mode }, 'reasoningMode inválido; aplicando default auto');
  return DEFAULT_REASONING_MODE;
}

export function resolveReasoningModeWithHeuristic(params: {
  requestedMode?: string | null;
  userMessage?: string;
  messageCount?: number;
  maxTokens?: number;
  requiresStructuredOutput?: boolean;
}): ReasoningModeResolution {
  const requestedMode = resolveReasoningMode(params.requestedMode);
  if (requestedMode !== 'auto') {
    return {
      requestedMode,
      effectiveMode: requestedMode,
      source: 'manual',
      heuristicScore: 0,
      reasonResolution: 'manual_override',
    };
  }

  const message = (params.userMessage ?? '').toLowerCase();
  const heuristicSignals: ReasoningHeuristicSignals = {
    longMessage: message.length >= 400,
    multiTurnContext: (params.messageCount ?? 0) >= 6,
    highTokenBudget: (params.maxTokens ?? 0) >= 1000,
    structuredOutput: params.requiresStructuredOutput === true,
    complexityKeyword: REASONING_COMPLEXITY_KEYWORDS.some((keyword) => message.includes(keyword)),
  };
  const baseScore = [
    heuristicSignals.longMessage,
    heuristicSignals.multiTurnContext,
    heuristicSignals.highTokenBudget,
    heuristicSignals.structuredOutput,
    heuristicSignals.complexityKeyword,
  ].reduce<number>((acc, signal) => acc + (signal ? 1 : 0), 0);

  const effectiveMode: EffectiveReasoningMode = baseScore >= 2 ? 'thinking' : 'non_thinking';
  const reasonResolution = effectiveMode === 'thinking'
    ? 'auto_high_complexity'
    : 'auto_low_complexity';
  return {
    requestedMode,
    effectiveMode,
    source: 'heuristic',
    heuristicScore: baseScore,
    reasonResolution,
  };
}

export function resolveReasoningRequest(params: {
  requestedMode?: string | null;
  userMessage?: string;
  messageCount?: number;
  maxTokens?: number;
  requiresStructuredOutput?: boolean;
}): ResolvedReasoningRequest {
  const resolved = resolveReasoningModeWithHeuristic(params);
  const message = (params.userMessage ?? '').toLowerCase();
  const heuristicSignals: ReasoningHeuristicSignals = {
    longMessage: message.length >= 400,
    multiTurnContext: (params.messageCount ?? 0) >= 6,
    highTokenBudget: (params.maxTokens ?? 0) >= 1000,
    structuredOutput: params.requiresStructuredOutput === true,
    complexityKeyword: REASONING_COMPLEXITY_KEYWORDS.some((keyword) => message.includes(keyword)),
  };
  const enableThinking = resolved.effectiveMode === 'thinking';
  return {
    requestedReasoningMode: resolved.requestedMode,
    resolvedReasoningMode: resolved.effectiveMode,
    reasonResolution: resolved.reasonResolution,
    source: resolved.source,
    heuristicScore: resolved.heuristicScore,
    heuristicSignals,
    runtimeExtraBody: {
      chat_template_kwargs: {
        enable_thinking: enableThinking,
      },
    },
    gatewayMetadataExtraBody: {
      alice_requested_reasoning_mode: resolved.requestedMode,
      alice_resolved_reasoning_mode: resolved.effectiveMode,
      alice_reason_resolution: resolved.reasonResolution,
      alice_reasoning_source: resolved.source,
      alice_reasoning_heuristic_score: resolved.heuristicScore,
    },
  };
}
