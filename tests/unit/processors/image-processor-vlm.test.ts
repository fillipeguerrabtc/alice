/**
 * Testes unitários - Image Processor (VLM) - Alice Enterprise Platform
 *
 * Regra 6 (CLAUDE.md): Sem mocks/stubs. Testa apenas funções puras/contratos.
 *
 * Autor: Fillipe Guerra
 * Data: 15/01/2026
 */

import { describe, expect, it } from 'vitest';
import {
  extractAssistantTextFromOpenAIChatCompletion,
  type OpenAIChatCompletionResponse,
} from '../../../apps/rag-service/src/image-processor';

describe('Image Processor - VLM parsing (sem mocks)', () => {
  it('deve extrair texto do primeiro choice', () => {
    const payload: OpenAIChatCompletionResponse = {
      id: 'cmpl-1',
      model: 'vlm-model',
      choices: [{ message: { role: 'assistant', content: '  ok  ' } }],
    };
    expect(extractAssistantTextFromOpenAIChatCompletion(payload)).toBe('ok');
  });

  it('deve retornar null quando não há conteúdo', () => {
    const payload: OpenAIChatCompletionResponse = {
      id: 'cmpl-2',
      model: 'vlm-model',
      choices: [{}],
    };
    expect(extractAssistantTextFromOpenAIChatCompletion(payload)).toBeNull();
  });
});

