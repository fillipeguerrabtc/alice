/**
 * OpenAI Embeddings - Alice Enterprise Platform
 *
 * Geração de embeddings via OpenAI para conteúdo de imagem (descrições).
 * Documentação em PT-BR (Regra 10 CLAUDE.md).
 */

import { createLogger } from '@alice/logger';
import { createCircuitBreaker, CIRCUIT_BREAKER_PRESETS } from '@alice/shared-utils';

const logger = createLogger('openai-embeddings');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY && process.env.NODE_ENV === 'production') {
  logger.error('OPENAI_API_KEY é obrigatório em produção (embeddings de imagem via OpenAI)');
  process.exit(1);
}

const OPENAI_IMAGE_EMBEDDING_MODEL = process.env.OPENAI_IMAGE_EMBEDDING_MODEL || 'text-embedding-3-small';
const OPENAI_EMBEDDING_TIMEOUT_MS = (() => {
  const raw = process.env.OPENAI_EMBEDDING_TIMEOUT_MS;
  if (!raw) return 30000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('OPENAI_EMBEDDING_TIMEOUT_MS inválido - precisa ser número > 0');
  }
  return parsed;
})();

type OpenAIEmbeddingResponse = {
  data?: Array<{ embedding?: number[] }>;
  model?: string;
};

async function callOpenAiEmbeddings(text: string): Promise<{ embedding: number[]; model: string }> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY não configurada - embeddings via OpenAI são obrigatórios');
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_IMAGE_EMBEDDING_MODEL,
      input: text,
    }),
    signal: AbortSignal.timeout(OPENAI_EMBEDDING_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`OpenAI Embeddings error: ${response.status} - ${errText}`);
  }

  const payload = (await response.json()) as OpenAIEmbeddingResponse;
  const embedding = payload?.data?.[0]?.embedding;
  if (!embedding || embedding.length === 0) {
    throw new Error('Resposta inválida da OpenAI Embeddings API (embedding ausente)');
  }

  return {
    embedding,
    model: payload.model || OPENAI_IMAGE_EMBEDDING_MODEL,
  };
}

const openAiEmbeddingsBreaker = createCircuitBreaker(callOpenAiEmbeddings, {
  name: 'openai-embeddings-image',
  ...CIRCUIT_BREAKER_PRESETS.default,
});

export async function generateOpenAiImageEmbedding(text: string): Promise<{ embedding: number[]; model: string }> {
  return openAiEmbeddingsBreaker.fire(text) as Promise<{ embedding: number[]; model: string }>;
}

export function getOpenAiImageEmbeddingModel(): string {
  return OPENAI_IMAGE_EMBEDDING_MODEL;
}

export function getOpenAiImageEmbeddingCircuitBreakerStatus() {
  return {
    failures: openAiEmbeddingsBreaker.status?.stats?.failures ?? 0,
    successes: openAiEmbeddingsBreaker.status?.stats?.successes ?? 0,
    rejects: openAiEmbeddingsBreaker.status?.stats?.rejects ?? 0,
    fires: openAiEmbeddingsBreaker.status?.stats?.fires ?? 0,
  };
}
