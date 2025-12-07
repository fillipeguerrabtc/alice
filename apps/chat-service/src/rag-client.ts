/**
 * Cliente RAG - Chat Service
 * 
 * Cliente HTTP para buscar contexto de documentos do RAG Service.
 * Implementa Circuit Breaker pattern (Regra 16 - Best Practices 2025).
 * Documentação em PT-BR (Regra 10 CLAUDE.md).
 * 
 * @module chat-service/rag-client
 */

import { createCircuitBreaker, CIRCUIT_BREAKER_PRESETS } from '@alice/shared-utils';
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
}).child({ service: 'chat-rag-client' });

// REGRA 6: Sem fallbacks localhost em produção - variável DEVE estar definida
const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL;
if (!RAG_SERVICE_URL && process.env.NODE_ENV === 'production') {
  throw new Error('RAG_SERVICE_URL é obrigatório em produção');
}
// Fallback apenas para desenvolvimento
const RAG_SERVICE_URL_FINAL = RAG_SERVICE_URL || 'http://localhost:3003';

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

// Circuit Breaker usa CIRCUIT_BREAKER_PRESETS centralizado (Regra 2 - Não Duplicar)

/**
 * Função interna para buscar contexto do RAG Service
 */
async function fetchContextInternal(
  query: string,
  namespaceId?: string,
  limit = 5,
  threshold = 0.7
): Promise<RAGContextResponse> {
    const response = await fetch(`${RAG_SERVICE_URL_FINAL}/api/rag/context`, {
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

const ragBreaker = createCircuitBreaker(fetchContextInternal, {
  name: 'rag-service',
  ...CIRCUIT_BREAKER_PRESETS.ragService,
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
    const response = await fetch(`${RAG_SERVICE_URL_FINAL}/api/rag/health`, {
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

// ============================================================================
// UPLOAD MULTIMODAL (FASE 9 - Integração Chat + RAG Multimodal)
// ============================================================================

/**
 * Resultado do upload de mídia para RAG Service
 */
export interface MediaUploadResult {
  uploadId: string;
  mediaType: 'image' | 'audio' | 'video';
  fileUrl: string;
  thumbnailUrl?: string;
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  transcription?: string;
  extractedMetadata?: Record<string, unknown>;
}

/**
 * Faz upload de mídia para RAG Service
 * 
 * @param file - Arquivo em base64
 * @param filename - Nome original do arquivo
 * @param mimeType - Tipo MIME do arquivo
 * @param tenantId - ID do tenant
 * @param messageId - ID da mensagem associada (opcional)
 * @param conversationId - ID da conversa associada (opcional)
 * @returns Resultado do upload ou null se falhar
 */
export async function uploadMediaToRAG(
  file: string,
  filename: string,
  mimeType: string,
  tenantId: string,
  messageId?: string,
  conversationId?: string,
): Promise<MediaUploadResult | null> {
  try {
    const startTime = Date.now();
    
    // Usar endpoint JSON dedicado para uploads base64
    const response = await fetch(`${RAG_SERVICE_URL_FINAL}/api/media/upload/json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': tenantId,
      },
      body: JSON.stringify({
        file, // base64
        filename,
        mimeType,
        messageId,
        conversationId,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ 
        status: response.status, 
        error: errorText,
        filename,
        mimeType,
      }, 'Erro no upload de mídia para RAG');
      return null;
    }

    const result = await response.json() as MediaUploadResult;
    const latency = Date.now() - startTime;
    
    logger.info({
      uploadId: result.uploadId,
      mediaType: result.mediaType,
      processingStatus: result.processingStatus,
      latencyMs: latency,
    }, 'Upload de mídia enviado para RAG Service');

    return result;
  } catch (error) {
    logger.error({ error, filename, mimeType }, 'Falha ao enviar mídia para RAG Service');
    return null;
  }
}

/**
 * Busca status de processamento de mídia
 * 
 * @param uploadId - ID do upload
 * @param tenantId - ID do tenant
 * @returns Status atualizado ou null se falhar
 */
export async function getMediaStatus(
  uploadId: string,
  tenantId: string,
): Promise<MediaUploadResult | null> {
  try {
    const response = await fetch(`${RAG_SERVICE_URL_FINAL}/api/media/${uploadId}`, {
      method: 'GET',
      headers: {
        'X-Tenant-Id': tenantId,
      },
    });

    if (!response.ok) {
      return null;
    }

    return response.json() as Promise<MediaUploadResult>;
  } catch (error) {
    logger.error({ error, uploadId }, 'Falha ao buscar status de mídia');
    return null;
  }
}
