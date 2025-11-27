/**
 * Cliente RAG - Chat Service
 * 
 * Cliente HTTP para buscar contexto de documentos do RAG Service.
 * Implementa Circuit Breaker pattern (Regra 16 - Best Practices 2025).
 * Documentação em PT-BR (Regra 10 replit.md).
 * 
 * @module chat-service/rag-client
 */

import CircuitBreaker from 'opossum';
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
}).child({ service: 'chat-rag-client' });

const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL || 'http://localhost:3003';

/**
 * Fonte de documento retornada pelo RAG
 */
export interface RAGSource {
  documentId: string;
  titulo: string;
  similarity: number;
}

/**
 * Resposta do endpoint /api/rag/context
 */
export interface RAGContextResponse {
  context: string;
  sources: RAGSource[];
}

/**
 * Configuração de Circuit Breaker para RAG Service
 * Timeout menor que LLM pois é serviço interno
 */
const ragBreakerOptions = {
  timeout: 10000,
  errorThresholdPercentage: 50,
  resetTimeout: 15000,
  volumeThreshold: 3,
};

/**
 * Função interna para buscar contexto do RAG Service
 */
async function fetchContextInternal(
  query: string,
  namespaceId?: string,
  limit = 5,
  threshold = 0.7
): Promise<RAGContextResponse> {
  const response = await fetch(`${RAG_SERVICE_URL}/api/rag/context`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      namespaceId,
      limit,
      threshold,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`RAG Service erro: ${response.status} - ${errorText}`);
  }

  return response.json() as Promise<RAGContextResponse>;
}

const ragBreaker = new CircuitBreaker(fetchContextInternal, ragBreakerOptions);

ragBreaker.on('open', () => {
  logger.warn('Circuit breaker RAG Service: ABERTO - Serviço temporariamente indisponível');
});

ragBreaker.on('halfOpen', () => {
  logger.info('Circuit breaker RAG Service: HALF-OPEN - Testando reconexão');
});

ragBreaker.on('close', () => {
  logger.info('Circuit breaker RAG Service: FECHADO - Serviço funcionando normalmente');
});

ragBreaker.on('fallback', () => {
  logger.warn('Circuit breaker RAG Service: Usando fallback (sem contexto)');
});

/**
 * Busca contexto de documentos do RAG Service
 * 
 * Implementa fallback gracioso: se o RAG falhar, retorna null
 * e o chat continua sem contexto de documentos.
 * 
 * @param query - Texto da consulta do usuário
 * @param namespaceId - ID do namespace para filtrar documentos (opcional)
 * @param limit - Número máximo de chunks a retornar (padrão: 5)
 * @param threshold - Limiar de similaridade mínimo (padrão: 0.7)
 * @returns Contexto e fontes, ou null se falhar
 * 
 * @example
 * ```typescript
 * const ragResult = await buscarContextoRAG('Como funciona o produto X?', 'namespace-123');
 * if (ragResult) {
 *   const contextoPraLLM = ragResult.context;
 *   const fontes = ragResult.sources;
 * }
 * ```
 */
export async function buscarContextoRAG(
  query: string,
  namespaceId?: string,
  limit = 5,
  threshold = 0.7
): Promise<RAGContextResponse | null> {
  if (!query || query.trim().length === 0) {
    logger.debug('Query vazia - ignorando busca RAG');
    return null;
  }

  try {
    const startTime = Date.now();
    const result = await ragBreaker.fire(query, namespaceId, limit, threshold) as RAGContextResponse;
    const latency = Date.now() - startTime;

    if (result.sources.length > 0) {
      logger.info({ 
        chunksEncontrados: result.sources.length,
        namespaceId,
        latencyMs: latency,
      }, 'Contexto RAG obtido com sucesso');
    } else {
      logger.debug({ query: query.slice(0, 50), namespaceId }, 'Nenhum documento relevante encontrado');
    }

    return result;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Breaker is open')) {
      logger.warn('Circuit breaker RAG aberto - continuando sem contexto');
    } else {
      logger.warn({ error }, 'Falha ao buscar contexto RAG - continuando sem contexto');
    }
    return null;
  }
}

/**
 * Verifica se o RAG Service está disponível
 * 
 * @returns true se o serviço está acessível
 */
export async function verificarDisponibilidadeRAG(): Promise<boolean> {
  try {
    const response = await fetch(`${RAG_SERVICE_URL}/api/rag/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Obtém estatísticas do Circuit Breaker do RAG
 */
export function getRAGBreakerStats() {
  return {
    state: ragBreaker.opened ? 'open' : (ragBreaker.halfOpen ? 'half-open' : 'closed'),
    failures: ragBreaker.stats.failures,
    successes: ragBreaker.stats.successes,
    timeouts: ragBreaker.stats.timeouts,
    rejects: ragBreaker.stats.rejects,
  };
}

/**
 * Formata contexto RAG para injeção no system prompt do LLM
 * 
 * @param ragResult - Resultado da busca RAG
 * @returns String formatada para o system prompt
 */
export function formatarContextoParaLLM(ragResult: RAGContextResponse | null): string {
  if (!ragResult || !ragResult.context || ragResult.context.trim().length === 0) {
    return '';
  }

  return `\n\n[CONTEXTO DE DOCUMENTOS]\n${ragResult.context}\n[/CONTEXTO DE DOCUMENTOS]\n\nUse as informações do contexto acima para responder quando relevante. Cite as fontes quando apropriado.`;
}
