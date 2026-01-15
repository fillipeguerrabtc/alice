/**
 * Cliente Qdrant - Alice Enterprise Platform
 * 
 * Cliente enterprise-grade para banco vetorial Qdrant.
 * Usado para embeddings de texto com Qwen3-Embedding-0.6B (1024 dimensões).
 * 
 * Arquitetura (17/12/2025):
 * - Texto: Qdrant (1024 dim) - Qwen3-Embedding-0.6B
 * - Imagem: pgvector (1024 dim) - OpenCLIP ViT-H/14
 * 
 * Funcionalidades:
 * - Autenticação via API Key
 * - Circuit breaker para resiliência
 * - Criação de coleções com HNSW index
 * - Upsert e busca de vetores
 * - Multi-tenancy via payloads
 * 
 * Autor: Fillipe Guerra
 * Data: 17 de Dezembro de 2025
 * Documentação: https://qdrant.tech/documentation/
 */

import { createCircuitBreaker, CIRCUIT_BREAKER_PRESETS } from './circuit-breaker.js';
import { createLogger } from '@alice/logger';

const logger = createLogger('qdrant-client');

// ============================================================================
// CONFIGURAÇÃO (via variáveis de ambiente - Regra 6: sem hardcoded)
// ============================================================================

const QDRANT_URL = process.env.QDRANT_URL || 'http://alice-qdrant:6333';
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;

// Dimensão dos embeddings de texto (Qwen3-Embedding-0.6B - 1024 dim nativos)
export const TEXT_EMBEDDING_DIM = 1024;

// Nome da coleção de texto (unificada para Trading + RAG)
export const TEXT_COLLECTION_NAME = 'text_embeddings';

// Aliases para compatibilidade (Trading usa mesma coleção)
export const TRADING_EMBEDDING_DIM = TEXT_EMBEDDING_DIM;
export const TRADING_COLLECTION_NAME = TEXT_COLLECTION_NAME;

// ============================================================================
// TIPOS (TypeScript strict - Regra 8)
// ============================================================================

/** Ponto (vetor) no Qdrant */
export interface QdrantPoint {
  id: string | number;
  vector: number[];
  payload?: Record<string, unknown>;
}

/** Resultado de busca */
export interface QdrantSearchResult {
  id: string | number;
  score: number;
  payload?: Record<string, unknown>;
  vector?: number[];
}

/** Configuração de coleção */
export interface QdrantCollectionConfig {
  name: string;
  vectorSize: number;
  distance?: 'Cosine' | 'Euclid' | 'Dot';
  onDiskPayload?: boolean;
  hnswConfig?: {
    m?: number;
    efConstruct?: number;
    fullScanThreshold?: number;
  };
}

/** Resposta genérica da API Qdrant */
interface QdrantApiResponse<T> {
  status?: string;
  result?: T;
  time?: number;
}

/** Status da coleção */
export interface QdrantCollectionInfo {
  status: string;
  vectors_count: number;
  points_count: number;
  indexed_vectors_count: number;
  segments_count: number;
  config?: {
    params?: {
      vectors?: {
        size: number;
      };
    };
  };
}

// ============================================================================
// CIRCUIT BREAKER
// ============================================================================

// Função wrapper para circuit breaker
async function executeQdrantRequest<T>(fetchFn: () => Promise<T>): Promise<T> {
  return fetchFn();
}

// Circuit breaker seguindo padrão enterprise
const qdrantCircuitBreaker = createCircuitBreaker(executeQdrantRequest, {
  name: 'qdrant-trading',
  ...CIRCUIT_BREAKER_PRESETS.qdrantTrading,
});

// ============================================================================
// VERIFICAÇÃO DE CONFIGURAÇÃO
// ============================================================================

/**
 * Verifica se Qdrant está configurado
 */
export function isQdrantConfigured(): boolean {
  return Boolean(QDRANT_URL && QDRANT_API_KEY);
}

/**
 * Retorna URL do Qdrant
 */
export function getQdrantUrl(): string {
  return QDRANT_URL;
}

/**
 * Retorna status do circuit breaker
 */
export function getQdrantCircuitBreakerStatus(): {
  state: string;
  failures: number;
  successes: number;
} {
  const stats = qdrantCircuitBreaker.stats;
  return {
    state: qdrantCircuitBreaker.opened ? 'OPEN' : qdrantCircuitBreaker.halfOpen ? 'HALF_OPEN' : 'CLOSED',
    failures: stats.failures,
    successes: stats.successes,
  };
}

// ============================================================================
// CLIENTE HTTP
// ============================================================================

/**
 * Headers padrão para requisições
 */
function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  
  if (QDRANT_API_KEY) {
    headers['api-key'] = QDRANT_API_KEY;
  }
  
  return headers;
}

/**
 * Executa requisição HTTP para API Qdrant
 */
async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
  endpoint: string,
  body?: unknown
): Promise<T> {
  const url = `${QDRANT_URL}${endpoint}`;
  const headers = getHeaders();

  logger.debug({ method, endpoint }, 'Executando requisição Qdrant');

  const fetchFn = async (): Promise<T> => {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error(
        { status: response.status, statusText: response.statusText, body: errorBody },
        'Erro na requisição Qdrant'
      );
      throw new Error(`Qdrant API error: ${response.status} - ${errorBody}`);
    }

    return response.json() as Promise<T>;
  };

  // Type assertion seguro: fetchFn retorna Promise<T>, circuit breaker apenas executa
  return qdrantCircuitBreaker.fire(fetchFn) as Promise<T>;
}

// ============================================================================
// OPERAÇÕES DE COLEÇÃO
// ============================================================================

/**
 * Verifica se coleção existe
 */
export async function collectionExists(collectionName: string): Promise<boolean> {
  try {
    await request<QdrantApiResponse<QdrantCollectionInfo>>(
      'GET',
      `/collections/${collectionName}`
    );
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('404')) {
      return false;
    }
    throw error;
  }
}

/**
 * Cria uma nova coleção
 */
export async function createCollection(config: QdrantCollectionConfig): Promise<void> {
  const body = {
    vectors: {
      size: config.vectorSize,
      distance: config.distance || 'Cosine',
      on_disk: true, // Otimização para coleções grandes
    },
    on_disk_payload: config.onDiskPayload ?? true,
    hnsw_config: config.hnswConfig || {
      m: 16,              // Número de conexões (default: 16)
      ef_construct: 200,  // Qualidade da construção do índice
      full_scan_threshold: 10000, // Threshold para scan linear
    },
    // Otimizações para embeddings de texto (Qwen3-Embedding-0.6B, 1024 dim)
    optimizers_config: {
      memmap_threshold: 20000,        // Usar mmap para coleções grandes
      indexing_threshold: 20000,      // Threshold para indexação
      flush_interval_sec: 5,          // Intervalo de flush
      max_segment_size: 200000,       // Tamanho máximo de segmento
    },
  };

  await request<QdrantApiResponse<boolean>>(
    'PUT',
    `/collections/${config.name}`,
    body
  );

  logger.info(
    { collection: config.name, vectorSize: config.vectorSize },
    'Coleção Qdrant criada'
  );
}

/**
 * Obtém informações da coleção
 */
export async function getCollectionInfo(collectionName: string): Promise<QdrantCollectionInfo> {
  const response = await request<QdrantApiResponse<QdrantCollectionInfo>>(
    'GET',
    `/collections/${collectionName}`
  );
  return response.result!;
}

/**
 * Deleta uma coleção
 */
export async function deleteCollection(collectionName: string): Promise<void> {
  await request<QdrantApiResponse<boolean>>(
    'DELETE',
    `/collections/${collectionName}`
  );
  logger.info({ collection: collectionName }, 'Coleção Qdrant deletada');
}

// ============================================================================
// OPERAÇÕES DE PONTOS (VETORES)
// ============================================================================

/**
 * Insere ou atualiza pontos (vetores)
 */
export async function upsertPoints(
  collectionName: string,
  points: QdrantPoint[]
): Promise<void> {
  if (points.length === 0) {
    return;
  }

  const body = {
    points: points.map(p => ({
      id: p.id,
      vector: p.vector,
      payload: p.payload || {},
    })),
  };

  await request<QdrantApiResponse<{ status: string }>>(
    'PUT',
    `/collections/${collectionName}/points`,
    body
  );

  logger.debug(
    { collection: collectionName, count: points.length },
    'Pontos inseridos no Qdrant'
  );
}

/**
 * Busca pontos por similaridade
 */
export async function searchPoints(
  collectionName: string,
  vector: number[],
  options?: {
    limit?: number;
    scoreThreshold?: number;
    filter?: Record<string, unknown>;
    withPayload?: boolean;
    withVector?: boolean;
  }
): Promise<QdrantSearchResult[]> {
  const body = {
    vector,
    limit: options?.limit ?? 10,
    score_threshold: options?.scoreThreshold,
    filter: options?.filter,
    with_payload: options?.withPayload ?? true,
    with_vector: options?.withVector ?? false,
  };

  const response = await request<QdrantApiResponse<QdrantSearchResult[]>>(
    'POST',
    `/collections/${collectionName}/points/search`,
    body
  );

  return response.result || [];
}

/**
 * Obtém pontos por IDs
 */
export async function getPoints(
  collectionName: string,
  ids: (string | number)[],
  withPayload: boolean = true,
  withVector: boolean = false
): Promise<QdrantPoint[]> {
  const body = {
    ids,
    with_payload: withPayload,
    with_vector: withVector,
  };

  const response = await request<QdrantApiResponse<QdrantPoint[]>>(
    'POST',
    `/collections/${collectionName}/points`,
    body
  );

  return response.result || [];
}

/**
 * Deleta pontos por IDs
 */
export async function deletePoints(
  collectionName: string,
  ids: (string | number)[]
): Promise<void> {
  const body = {
    points: ids,
  };

  await request<QdrantApiResponse<{ status: string }>>(
    'POST',
    `/collections/${collectionName}/points/delete`,
    body
  );

  logger.debug(
    { collection: collectionName, count: ids.length },
    'Pontos deletados do Qdrant'
  );
}

/**
 * Deleta pontos por filtro
 */
export async function deletePointsByFilter(
  collectionName: string,
  filter: Record<string, unknown>
): Promise<void> {
  const body = {
    filter,
  };

  await request<QdrantApiResponse<{ status: string }>>(
    'POST',
    `/collections/${collectionName}/points/delete`,
    body
  );

  logger.debug(
    { collection: collectionName },
    'Pontos deletados por filtro no Qdrant'
  );
}

// ============================================================================
// INICIALIZAÇÃO DA COLEÇÃO DE TRADING
// ============================================================================

/**
 * Inicializa a coleção de texto se não existir
 * Cria com configuração otimizada para 1024 dimensões (Qwen3-Embedding-0.6B)
 */
export async function initTextCollection(): Promise<void> {
  if (!isQdrantConfigured()) {
    logger.warn('Qdrant não configurado - coleção de texto não será criada');
    return;
  }

  const exists = await collectionExists(TEXT_COLLECTION_NAME);
  
  if (!exists) {
    await createCollection({
      name: TEXT_COLLECTION_NAME,
      vectorSize: TEXT_EMBEDDING_DIM,
      distance: 'Cosine',
      onDiskPayload: true,
      hnswConfig: {
        m: 16,
        efConstruct: 200,
        fullScanThreshold: 10000,
      },
    });
    
    logger.info(
      { collection: TEXT_COLLECTION_NAME, dim: TEXT_EMBEDDING_DIM },
      'Coleção de texto criada no Qdrant'
    );
  } else {
    // Fail-fast enterprise: se a coleção existir com dimensão incorreta, o sistema NÃO deve operar silenciosamente.
    // A migração de dimensão exige reindex/re-embed dos vetores.
    const info = await getCollectionInfo(TEXT_COLLECTION_NAME);
    const existingSize = info.config?.params?.vectors?.size;
    if (typeof existingSize === 'number' && existingSize !== TEXT_EMBEDDING_DIM) {
      throw new Error(
        `Coleção Qdrant '${TEXT_COLLECTION_NAME}' com dimensão inválida: ${existingSize}. ` +
          `Esperado: ${TEXT_EMBEDDING_DIM}. Execute migração/reindex dos embeddings antes do deploy.`
      );
    }
    logger.info(
      { collection: TEXT_COLLECTION_NAME },
      'Coleção de texto já existe no Qdrant'
    );
  }
}

// Alias para compatibilidade
export const initTradingCollection = initTextCollection;

// ============================================================================
// OPERAÇÕES ESPECÍFICAS DE TRADING
// ============================================================================

/**
 * Insere embedding de sinal de trading
 */
export async function upsertTradingSignalEmbedding(
  signalId: string,
  embedding: number[],
  metadata: {
    tenantId: string;
    signalType: string;
    symbol: string;
    confidence: number;
    timestamp: string;
    [key: string]: unknown;
  }
): Promise<void> {
  await upsertPoints(TRADING_COLLECTION_NAME, [{
    id: signalId,
    vector: embedding,
    payload: {
      ...metadata,
      type: 'signal',
    },
  }]);
}

/**
 * Insere embedding de dados de mercado
 */
export async function upsertMarketDataEmbedding(
  dataId: string,
  embedding: number[],
  metadata: {
    tenantId: string;
    symbol: string;
    dataType: string;
    timestamp: string;
    [key: string]: unknown;
  }
): Promise<void> {
  await upsertPoints(TRADING_COLLECTION_NAME, [{
    id: dataId,
    vector: embedding,
    payload: {
      ...metadata,
      type: 'market_data',
    },
  }]);
}

/**
 * Busca sinais de trading similares
 */
export async function searchSimilarTradingSignals(
  embedding: number[],
  tenantId: string,
  options?: {
    limit?: number;
    scoreThreshold?: number;
    signalType?: string;
    symbol?: string;
  }
): Promise<QdrantSearchResult[]> {
  const filter: Record<string, unknown> = {
    must: [
      { key: 'tenantId', match: { value: tenantId } },
      { key: 'type', match: { value: 'signal' } },
    ],
  };

  if (options?.signalType) {
    (filter.must as Array<unknown>).push({
      key: 'signalType',
      match: { value: options.signalType },
    });
  }

  if (options?.symbol) {
    (filter.must as Array<unknown>).push({
      key: 'symbol',
      match: { value: options.symbol },
    });
  }

  return searchPoints(TRADING_COLLECTION_NAME, embedding, {
    limit: options?.limit ?? 10,
    scoreThreshold: options?.scoreThreshold ?? 0.7,
    filter,
    withPayload: true,
  });
}

/**
 * Busca dados de mercado similares
 */
export async function searchSimilarMarketData(
  embedding: number[],
  tenantId: string,
  options?: {
    limit?: number;
    scoreThreshold?: number;
    dataType?: string;
    symbol?: string;
  }
): Promise<QdrantSearchResult[]> {
  const filter: Record<string, unknown> = {
    must: [
      { key: 'tenantId', match: { value: tenantId } },
      { key: 'type', match: { value: 'market_data' } },
    ],
  };

  if (options?.dataType) {
    (filter.must as Array<unknown>).push({
      key: 'dataType',
      match: { value: options.dataType },
    });
  }

  if (options?.symbol) {
    (filter.must as Array<unknown>).push({
      key: 'symbol',
      match: { value: options.symbol },
    });
  }

  return searchPoints(TRADING_COLLECTION_NAME, embedding, {
    limit: options?.limit ?? 10,
    scoreThreshold: options?.scoreThreshold ?? 0.7,
    filter,
    withPayload: true,
  });
}

// ============================================================================
// HEALTH CHECK
// ============================================================================

/**
 * Verifica saúde do Qdrant
 */
export async function healthCheck(): Promise<{
  healthy: boolean;
  collections?: number;
  error?: string;
}> {
  try {
    const response = await request<{ result: { collections: Array<unknown> } }>(
      'GET',
      '/collections'
    );
    
    return {
      healthy: true,
      collections: response.result?.collections?.length ?? 0,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      healthy: false,
      error: errorMessage,
    };
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  // Config
  isQdrantConfigured,
  getQdrantUrl,
  getQdrantCircuitBreakerStatus,
  TEXT_EMBEDDING_DIM,
  TEXT_COLLECTION_NAME,
  TRADING_EMBEDDING_DIM, // Alias
  TRADING_COLLECTION_NAME, // Alias
  
  // Coleções
  collectionExists,
  createCollection,
  getCollectionInfo,
  deleteCollection,
  initTextCollection,
  initTradingCollection, // Alias
  
  // Pontos
  upsertPoints,
  searchPoints,
  getPoints,
  deletePoints,
  deletePointsByFilter,
  
  // Trading
  upsertTradingSignalEmbedding,
  upsertMarketDataEmbedding,
  searchSimilarTradingSignals,
  searchSimilarMarketData,
  
  // Health
  healthCheck,
};
