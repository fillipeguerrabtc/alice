/**
 * Mapeamento de modelos LLM (Agentes -> GPU Runtime)
 *
 * Centraliza SSOT de nomes de modelos para evitar duplicação entre serviços.
 * Regra 2: Não duplicar
 * Regra 11: Seguir docs oficiais 2025
 *
 * Autor: Fillipe Guerra
 * Data: 30 de Janeiro de 2026
 */

import { createLogger } from '@alice/logger';

const logger = createLogger('llm-models');

export const ALLOWED_AGENT_LLM_MODEL_NAMES = [
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

const AGENT_LLM_MODEL_MAP: Record<string, string> = {
  // Texto (produção): Qwen2.5 7B Instruct (AWQ)
  'Qwen2.5-7B-Instruct-AWQ': 'Qwen/Qwen2.5-7B-Instruct-AWQ',
};

export function resolveAgentLlmModel(modelName: string): {
  model: string | null;
  isLegacy: boolean;
} {
  const normalized = modelName.trim();
  const mapped = AGENT_LLM_MODEL_MAP[normalized];
  if (mapped) {
    return { model: mapped, isLegacy: false };
  }

  const isLegacy = (LEGACY_AGENT_LLM_MODEL_NAMES as readonly string[]).includes(normalized);
  logger.warn({ modelName: normalized, isLegacy }, 'Modelo LLM do agente não suportado');
  return { model: null, isLegacy };
}
