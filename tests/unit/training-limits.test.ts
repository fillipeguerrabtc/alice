/**
 * Testes Unitários - Training Limits (Plano 11/02/2026)
 *
 * Testes para funções de limites e boas práticas de treinamento:
 * - sliceConversationIntoWindows (janelas disjuntas)
 * - selectTrainingChunks (seleção de chunks)
 * - validateEmbeddingDimension e EMBEDDING_DIMENSIONS (SSOT)
 * - resolveScope com suggestedNewNamespace (mock DB)
 *
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 * Regra 9: Validação contínua
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sliceConversationIntoWindows } from '../../apps/chat-service/src/training-utils';
import {
  selectTrainingChunks,
  type TrainingChunk,
} from '../../apps/rag-service/src/training-chunk-selection';
import {
  validateEmbeddingDimension,
  EMBEDDING_DIMENSIONS,
} from '@alice/database';

// Mock do database para resolveScope (sempre chama enforceTenantConsistency → getDatabase)
// Quando namespaceId e agentId são null, o DB não é consultado; porém getDatabase() é chamado
const mockQuery = {
  conversations: { findFirst: vi.fn().mockResolvedValue(null) },
  documents: { findFirst: vi.fn().mockResolvedValue(null) },
  tradingSignals: { findFirst: vi.fn().mockResolvedValue(null) },
  tradingOrders: { findFirst: vi.fn().mockResolvedValue(null) },
  namespaces: { findFirst: vi.fn().mockResolvedValue(null) },
  agents: { findFirst: vi.fn().mockResolvedValue(null) },
};
vi.mock('@alice/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alice/database')>();
  return {
    ...actual,
    getDatabase: vi.fn(() => ({ query: mockQuery })),
  };
});

// Import após mock para garantir que resolveScope use o mock
const { resolveScope } = await import('../../apps/training-service/src/scope-resolver');

// ============================================================================
// sliceConversationIntoWindows
// ============================================================================

describe('sliceConversationIntoWindows', () => {
  it('deve retornar uma única janela quando messages.length <= sliceSize', () => {
    const msgs = [1, 2, 3, 4, 5];
    const result = sliceConversationIntoWindows(msgs, 10);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      slice: [1, 2, 3, 4, 5],
      startIndex: 0,
      endIndex: 4,
    });
  });

  it('deve retornar uma única janela quando messages.length === sliceSize', () => {
    const msgs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = sliceConversationIntoWindows(msgs, 10);
    expect(result).toHaveLength(1);
    expect(result[0].slice).toHaveLength(10);
    expect(result[0].endIndex).toBe(9);
  });

  it('deve fatiar em janelas disjuntas quando messages.length > sliceSize', () => {
    const msgs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const result = sliceConversationIntoWindows(msgs, 5);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      slice: [1, 2, 3, 4, 5],
      startIndex: 0,
      endIndex: 4,
    });
    expect(result[1]).toEqual({
      slice: [6, 7, 8, 9, 10],
      startIndex: 5,
      endIndex: 9,
    });
    expect(result[2]).toEqual({
      slice: [11, 12],
      startIndex: 10,
      endIndex: 11,
    });
  });

  it('deve gerar janelas sem overlap (disjuntas)', () => {
    const msgs = Array.from({ length: 25 }, (_, i) => i);
    const result = sliceConversationIntoWindows(msgs, 10);
    const allIndices = new Set<number>();
    for (const w of result) {
      for (let i = w.startIndex; i <= w.endIndex; i++) {
        expect(allIndices.has(i)).toBe(false);
        allIndices.add(i);
      }
    }
    expect(allIndices.size).toBe(25);
  });

  it('deve lidar com array vazio', () => {
    const result = sliceConversationIntoWindows([], 10);
    expect(result).toHaveLength(1);
    expect(result[0].slice).toEqual([]);
    expect(result[0].startIndex).toBe(0);
    expect(result[0].endIndex).toBe(-1);
  });
});

// ============================================================================
// selectTrainingChunks
// ============================================================================

describe('selectTrainingChunks', () => {
  function makeChunk(id: string, conteudo: string, posicao: number): TrainingChunk {
    return { id, conteudo, posicao };
  }

  it('deve retornar todos os chunks quando eligible.length <= maxSamples', () => {
    const chunks = [
      makeChunk('1', 'Conteúdo com mais de 180 caracteres. '.repeat(7), 0),
      makeChunk('2', 'Outro chunk válido. '.repeat(10), 1),
    ];
    const result = selectTrainingChunks(chunks, { maxSamples: 50, minChars: 180 });
    expect(result).toHaveLength(2);
  });

  it('deve filtrar chunks com menos de minChars', () => {
    const chunks = [
      makeChunk('1', 'Curto', 0),
      makeChunk('2', 'Conteúdo com mais de 180 caracteres. '.repeat(7), 1),
    ];
    const result = selectTrainingChunks(chunks, { maxSamples: 50, minChars: 180 });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2');
  });

  it('deve respeitar maxSamples quando há muitos chunks elegíveis', () => {
    const chunks = Array.from({ length: 100 }, (_, i) =>
      makeChunk(
        String(i),
        `Chunk ${i} com conteúdo longo suficiente. `.repeat(6),
        i
      )
    );
    const result = selectTrainingChunks(chunks, { maxSamples: 20, minChars: 50 });
    expect(result.length).toBeLessThanOrEqual(20);
  });

  it('deve usar default maxSamples 50 quando não informado', () => {
    const chunks = Array.from({ length: 30 }, (_, i) =>
      makeChunk(String(i), 'x'.repeat(200), i)
    );
    const result = selectTrainingChunks(chunks, { minChars: 180 });
    expect(result.length).toBeLessThanOrEqual(50);
  });

  it('deve retornar array vazio quando nenhum chunk tem minChars', () => {
    const chunks = [
      makeChunk('1', 'Curto', 0),
      makeChunk('2', 'Também curto', 1),
    ];
    const result = selectTrainingChunks(chunks, { minChars: 180 });
    expect(result).toEqual([]);
  });
});

// ============================================================================
// validateEmbeddingDimension e EMBEDDING_DIMENSIONS (SSOT)
// ============================================================================

describe('validateEmbeddingDimension e EMBEDDING_DIMENSIONS', () => {
  it('EMBEDDING_DIMENSIONS.TEXT deve ser 1024 (SSOT)', () => {
    expect(EMBEDDING_DIMENSIONS.TEXT).toBe(1024);
  });

  it('deve aceitar embedding com dimensão correta', () => {
    const embedding = Array.from({ length: 1024 }, () => 0.1);
    expect(() => validateEmbeddingDimension(embedding)).not.toThrow();
  });

  it('deve lançar erro para embedding com dimensão incorreta', () => {
    const embedding = Array.from({ length: 512 }, () => 0.1);
    expect(() => validateEmbeddingDimension(embedding)).toThrow(
      /dimensão incorreta.*512.*1024/
    );
  });

  it('deve lançar erro para embedding vazio', () => {
    expect(() => validateEmbeddingDimension([])).toThrow(/vazio ou nulo/);
    expect(() => validateEmbeddingDimension(null as unknown as number[])).toThrow(
      /vazio ou nulo/
    );
    expect(() => validateEmbeddingDimension(undefined as unknown as number[])).toThrow(
      /vazio ou nulo/
    );
  });

  it('deve lançar erro para embedding com NaN', () => {
    const embedding = Array.from({ length: 1024 }, () => 0.1);
    embedding[5] = NaN;
    expect(() => validateEmbeddingDimension(embedding)).toThrow(/valor inválido/);
  });

  it('deve lançar erro para embedding com Inf', () => {
    const embedding = Array.from({ length: 1024 }, () => 0.1);
    embedding[5] = Infinity;
    expect(() => validateEmbeddingDimension(embedding)).toThrow(/valor inválido/);
  });
});

// ============================================================================
// resolveScope - suggestedNewNamespace
// ============================================================================

describe('resolveScope - suggestedNewNamespace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve retornar suggestedNewNamespace quando não há namespace e há texto com termos de trading', async () => {
    const result = await resolveScope({
      tenantId: 'test-tenant',
      messagesText: 'btc trading futures stop loss take profit',
      sourceType: 'chat',
    });
    expect(result.needsHumanReview).toBe(true);
    expect(result.suggestedNewNamespace).toBeDefined();
    expect(result.suggestedNewNamespace?.name).toBe('trading-geral');
    expect(result.suggestedNewNamespace?.theme).toContain('Trading');
  });

  it('deve retornar suggestedNewNamespace com domínio general para texto genérico', async () => {
    const result = await resolveScope({
      tenantId: 'test-tenant',
      messagesText: 'Como funciona o sistema? Preciso de ajuda geral.',
      sourceType: 'chat',
    });
    expect(result.suggestedNewNamespace).toBeDefined();
    expect(result.suggestedNewNamespace?.name).toBe('geral');
    expect(result.suggestedNewNamespace?.theme).toContain('geral');
  });

  it('deve retornar suggestedNewNamespace com domínio general para texto sem termos de trading', async () => {
    const result = await resolveScope({
      tenantId: 'test-tenant',
      messagesText: 'Documentação técnica sobre APIs REST e GraphQL.',
      sourceType: 'chat',
    });
    expect(result.suggestedNewNamespace).toBeDefined();
    expect(result.suggestedNewNamespace?.name).toBe('geral');
    expect(result.suggestedNewNamespace?.theme).toContain('geral');
  });
});
