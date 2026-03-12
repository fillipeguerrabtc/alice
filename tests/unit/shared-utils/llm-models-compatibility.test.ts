import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LLM_SERVING_MODEL_ID,
  DEFAULT_REASONING_MODE,
  resolveAgentLlmModel,
  resolveReasoningMode,
  resolveServingModelIdFromConfig,
} from '../../../packages/shared-utils/src/llm-models';

describe('llm-models legacy compatibility', () => {
  it('resolve aliases legados Qwen2.5 para família Qwen3 com marcação de legado', () => {
    const resolved = resolveAgentLlmModel('Qwen2.5-7B-Instruct-AWQ');

    expect(resolved.isLegacy).toBe(true);
    expect(resolved.servingModelId).toBe('Qwen/Qwen3-8B-AWQ');
    expect(resolved.trainingBaseModelId).toBe('Qwen/Qwen3-8B');
    expect(resolved.publicModelName).toBe('Qwen3-8B');
  });

  it('mantém compatibilidade de leitura para ID legado completo do provedor', () => {
    const resolvedModelId = resolveServingModelIdFromConfig('Qwen/Qwen2.5-7B-Instruct-AWQ');
    expect(resolvedModelId).toBe(DEFAULT_LLM_SERVING_MODEL_ID);
  });

  it('aplica default auto quando reasoningMode informado for inválido', () => {
    expect(resolveReasoningMode('modo-invalido')).toBe(DEFAULT_REASONING_MODE);
    expect(resolveReasoningMode(null)).toBe('auto');
  });
});
