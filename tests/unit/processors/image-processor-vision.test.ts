/**
 * Testes unitários - Image Processor (Vision/OpenAI) - Alice Enterprise Platform
 *
 * Regra 6 (CLAUDE.md): Sem mocks/stubs. Testa apenas funções puras/contratos.
 *
 * Autor: Fillipe Guerra
 * Data: 16/01/2026
 */

import { describe, expect, it } from 'vitest';
import {
  extractOutputTextFromResponsesApi,
  type OpenAIResponsesApiResponse,
} from '../../../apps/rag-service/src/image-processor';

describe('Image Processor - parsing Responses API (sem mocks)', () => {
  it('deve extrair texto da saída do Responses API', () => {
    const payload: OpenAIResponsesApiResponse = {
      id: 'resp-1',
      model: 'gpt-4.1',
      output: [
        {
          content: [
            { type: 'output_text', text: '  ok  ' },
          ],
        },
      ],
    };
    expect(extractOutputTextFromResponsesApi(payload)).toBe('ok');
  });

  it('deve retornar null quando não há conteúdo', () => {
    const payload: OpenAIResponsesApiResponse = {
      id: 'resp-2',
      model: 'gpt-4.1',
      output: [{ content: [{}] }],
    };
    expect(extractOutputTextFromResponsesApi(payload)).toBeNull();
  });
});
