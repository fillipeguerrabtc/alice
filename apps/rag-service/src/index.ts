/**
 * RAG Service - Alice Enterprise Platform
 * 
 * Serviço de Retrieval-Augmented Generation com busca vetorial enterprise.
 * Implementa Circuit Breaker pattern (Regra 16 - Best Practices 2025).
 * 
 * ARQUITETURA ENTERPRISE (25/12/2025):
 * - Texto: Qwen3-Embedding-0.6B (1024 dim) → Qdrant via GPU Manager Service
 * - Imagem: OpenAI Vision → descrição textual → embedding da descrição (1024 dim) → Qdrant
 * 
 * Autor: Fillipe Guerra
 * Data: 25 de Dezembro de 2025
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import cors from 'cors';
// helmet aplicado via createSecurityMiddleware de @alice/shared-utils
import compression from 'compression';
import {
  getNodeEnv,
  getOptionalServiceUrl,
  getServiceUrl,
  loadConfig,
  ragServiceConfigSchema,
  readOptionalStringEnv,
  resolveCorsOrigins,
} from '@alice/config';
// rateLimit via createRateLimiter de @alice/shared-utils
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
// CircuitBreaker via createCircuitBreaker de @alice/shared-utils
import { getDatabase, getPool, schema, closeDatabasePool, isPoolHealthy, createDrizzleFeatureFlagStorage, validateEmbeddingDimension, EMBEDDING_DIMENSIONS, withTenantContext } from '@alice/database';
import { getSystemConfig } from '@alice/database/system-config';
import { eq, sql, desc, and, asc } from '@alice/database';
import { z } from 'zod';
import { Counter as PromCounter, Histogram as PromHistogram } from 'prom-client';
import {
  requirePermission,
  requireAuth,
  requireSameTenant,
  createSecurityMiddleware,
  createRateLimiter,
  createErrorHandler,
  createNotFoundHandler,
  createCorrelationMiddleware,
  initFeatureFlags,
  createAlicePrometheus,
  initRbacPrometheusMetrics,
  instrumentCircuitBreaker,
  createCircuitBreaker,
  CIRCUIT_BREAKER_PRESETS,
  registerShutdownCallback,
  ShutdownPriority,
  type CacheAdapter,
  setupSwaggerUI,
  RAG_SERVICE_TAGS,
  requestGpu,
  GpuServiceType,
  GpuRequestPriority,
  generateInternalAuthHeaders,
  Role,
  getCorrelationId,
  isRedisAvailable,
} from '@alice/shared-utils';
import type { AuthContext } from '@alice/shared-utils';
import { ragServicePaths, ragServiceSchemas } from './openapi-specs.js';
import { createLogger } from '@alice/logger';

// Constante para verificar ambiente de produção
// BUG FIX 23/12/2025: Definir isProduction IMEDIATAMENTE após imports (TypeScript requer imports primeiro)
// Módulos importados de @alice/shared-utils verificam process.env.NODE_ENV diretamente (não isProduction local),
// então é seguro definir isProduction após imports. Esta constante é usada apenas neste módulo.
// IMPORTANTE: Se algum módulo importado precisar de isProduction durante import, isso causaria undefined.
// Verificado: todos os módulos importados usam process.env.NODE_ENV diretamente, não isProduction local.
const isProduction = getNodeEnv() === 'production';
import { getStorageService } from './storage.js';
import { getImageProcessor } from './image-processor.js';
import { startEmbeddingWorker, getEmbeddingWorkerStatus } from './workers/embedding-worker.js';
import {
  startDocumentProcessingWorker,
  getDocumentProcessingWorkerStatus,
} from './workers/document-processing-worker.js';
import {
  enqueueDocumentProcessingJob,
  getDocumentProcessingJobIdForDocument,
  setDocumentProcessingQueueMetricObserver,
} from './document-processing-queue.js';
import { getAudioProcessor } from './audio-processor.js';
import { getDocumentProcessor } from './document-processor.js';
import { createWebSearchClient, WebSearchOptions } from './web-search.js';
import { startLearningWorker } from './workers/learning-worker.js';
import { startWebCrawlWorker } from './workers/web-crawl-worker.js';
import { selectTrainingChunks } from './training-chunk-selection.js';
import { registerRagDocumentRoutes } from './rag-document-routes.js';
import { registerRagRetrievalRoutes } from './rag-retrieval-routes.js';
import { registerRagLearningRoutes } from './rag-learning-routes.js';
import { registerRagEmbeddingRoutes } from './rag-embedding-routes.js';
import { startRagBootstrap } from './rag-bootstrap.js';
// Cliente Qdrant para busca de texto (1024 dim - Qwen3-Embedding-0.6B)
// CORREÇÃO 17/12/2025: Adicionado upsertPoints para inserir documentos no Qdrant
// Bug: Busca usava Qdrant mas inserção era apenas PostgreSQL - resultados sempre vazios
import {
  searchPoints,
  upsertPoints,
  isQdrantConfigured,
  healthCheck as qdrantHealthCheck,
  getQdrantCircuitBreakerStatus,
  TEXT_COLLECTION_NAME,
  TEXT_EMBEDDING_DIM,
  type QdrantSearchResult,
  createSessionAuthMiddleware,
} from '@alice/shared-utils';

interface MulterRequest extends Request {
  file?: Express.Multer.File;
}

type AuthUser = Partial<Pick<AuthContext, 'userId' | 'role' | 'tenantId' | 'customRoleId'>>;

function getAuthUser(req: Request): AuthUser {
  const typed = req as Request & { user?: AuthContext };
  const user = typed.user;
  if (!user) return {};
  return {
    userId: user.userId,
    role: user.role,
    tenantId: user.tenantId,
    customRoleId: user.customRoleId ?? undefined,
  };
}

function getRequestCorrelationId(req: Request): string {
  const header = req.headers['x-correlation-id'];
  if (typeof header === 'string' && header.trim().length > 0) {
    return header.trim();
  }
  const contextCorrelationId = getCorrelationId();
  if (contextCorrelationId !== 'no-context') {
    return contextCorrelationId;
  }
  return crypto.randomUUID();
}

const getTenantIdFromRequest = (req: Request): string | undefined => req.tenantId;

type TrainingChunk = { id: string; conteudo: string; posicao: number };

type TrainingChunkSelectionOptions = {
  maxSamples?: number;
  minChars?: number;
};

const TRAINING_SERVICE_REQUEST_TIMEOUT_MS = 15_000;

async function postTrainingDataWithAuthFallback(params: {
  tenantId: string;
  payload: Record<string, unknown>;
  userId?: string;
  role?: string;
  customRoleId?: string;
  context?: Record<string, unknown>;
}): Promise<globalThis.Response> {
  if (!TRAINING_SERVICE_URL) {
    throw new Error('TRAINING_SERVICE_URL ausente');
  }

  const primaryRole = (params.role as Role | undefined) ?? 'operator';
  const baseAuth = {
    userId: params.userId ?? 'system',
    tenantId: params.tenantId,
  };

  const sendRequest = async (headers: Record<string, string>): Promise<globalThis.Response> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TRAINING_SERVICE_REQUEST_TIMEOUT_MS);
    try {
      return await fetch(`${TRAINING_SERVICE_URL}/api/training/data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(params.payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const primaryHeaders: Record<string, string> = { ...generateInternalAuthHeaders({
    ...baseAuth,
    role: primaryRole,
    customRoleId: params.customRoleId,
  }) };

  const primaryResponse = await sendRequest(primaryHeaders);
  if (
    (primaryResponse.status === 401 || primaryResponse.status === 403) &&
    primaryRole !== 'admin' &&
    primaryRole !== 'super_admin'
  ) {
    logger.warn(
      {
        status: primaryResponse.status,
        tenantId: params.tenantId,
        role: primaryRole,
        context: params.context,
      },
      'Training service rejeitou auth do caller; fallback para role admin interno'
    );
    const fallbackHeaders: Record<string, string> = { ...generateInternalAuthHeaders({
      ...baseAuth,
      role: 'admin',
    }) };
    return sendRequest(fallbackHeaders);
  }

  return primaryResponse;
}

async function collectTrainingFromDocumentChunks(params: {
  tenantId: string;
  namespaceId: string;
  agentId?: string;
  domain?: string;
  documentId: string;
  titulo: string;
  chunks: TrainingChunk[];
  userId?: string;
  role?: string;
  customRoleId?: string;
  force?: boolean;
  selection?: TrainingChunkSelectionOptions;
  profile?: {
    version?: number;
    tags?: string[];
  };
}): Promise<{
  attempted: number;
  sent: number;
  failed: number;
  selectedChunkIds: string[];
  errors: Array<{ chunkId: string; status?: number; error: string }>;
}> {
  if (!params.force && !TRAINING_DOC_AUTO_COLLECT) {
    return { attempted: 0, sent: 0, failed: 0, selectedChunkIds: [], errors: [] };
  }
  const fromDb = await getSystemConfig('TRAINING_DOC_MAX_SAMPLES');
  const defaultMaxSamples = fromDb ? (parseInt(fromDb, 10) || 50) : TRAINING_DOC_MAX_SAMPLES;
  const selection = {
    ...params.selection,
    maxSamples: params.selection?.maxSamples ?? defaultMaxSamples,
    minChars: params.selection?.minChars ?? TRAINING_DOC_MIN_CHARS,
  };
  if (!TRAINING_SERVICE_URL) {
    logger.warn({ documentId: params.documentId }, 'TRAINING_SERVICE_URL ausente - coleta de documentos para treinamento desabilitada');
    return { attempted: 0, sent: 0, failed: 0, selectedChunkIds: [], errors: [] };
  }

  const selected = selectTrainingChunks(params.chunks, selection);
  if (selected.length === 0) {
    return { attempted: 0, sent: 0, failed: 0, selectedChunkIds: [], errors: [] };
  }

  let sent = 0;
  let failed = 0;
  const errors: Array<{ chunkId: string; status?: number; error: string }> = [];
  for (const chunk of selected) {
    const payload = {
      tenantId: params.tenantId,
      namespaceId: params.namespaceId,
      agentId: params.agentId,
      domain: params.domain,
      source: 'document-ingest',
      sourceType: 'rag_document',
      sourceId: params.documentId,
      sourceMetadata: {
        documentId: params.documentId,
        chunkId: chunk.id,
        posicao: chunk.posicao,
        titulo: params.titulo,
        profileVersion: params.profile?.version ?? null,
        profileTags: params.profile?.tags ?? [],
      },
      messages: [
        {
          role: 'system',
          content: 'Você é Alice, especialista em Trading e Finanças. Responda com precisão e linguagem profissional.',
        },
        {
          role: 'user',
          content: `Explique o trecho a seguir do material "${params.titulo}".`,
        },
        {
          role: 'assistant',
          content: chunk.conteudo,
        },
      ],
    };

    try {
      const response = await postTrainingDataWithAuthFallback({
        tenantId: params.tenantId,
        payload,
        userId: params.userId,
        role: params.role,
        customRoleId: params.customRoleId,
        context: {
          documentId: params.documentId,
          chunkId: chunk.id,
          sourceType: 'rag_document',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        failed += 1;
        errors.push({
          chunkId: chunk.id,
          status: response.status,
          error: errorText || `HTTP ${response.status}`,
        });
        logger.warn({
          documentId: params.documentId,
          chunkId: chunk.id,
          status: response.status,
          error: errorText,
        }, 'Falha ao enviar chunk para treinamento');
      } else {
        sent += 1;
      }
    } catch (error) {
      failed += 1;
      errors.push({
        chunkId: chunk.id,
        error: error instanceof Error ? error.message : String(error),
      });
      logger.warn({
        documentId: params.documentId,
        chunkId: chunk.id,
        error: error instanceof Error ? error.message : String(error),
      }, 'Erro ao enviar chunk para treinamento');
    }
  }

  return {
    attempted: selected.length,
    sent,
    failed,
    selectedChunkIds: selected.map((chunk) => chunk.id),
    errors,
  };
}

/**
 * Promove mídia (imagem/áudio) para training_data.
 * Plano RAG Multimodal Enterprise Fase 4 - 11/02/2026
 * Usa llmDescription (imagens) ou transcription (áudio) como conteúdo.
 */
async function collectTrainingFromMediaUpload(params: {
  tenantId: string;
  namespaceId: string;
  mediaUploadId: string;
  mediaType: 'image' | 'audio';
  originalFilename: string;
  content: string;
  userId?: string;
  role?: string;
  customRoleId?: string;
}): Promise<{ sent: boolean; trainingDataId?: string; status?: number; error?: string }> {
  if (!TRAINING_SERVICE_URL) {
    logger.warn({ mediaUploadId: params.mediaUploadId }, 'TRAINING_SERVICE_URL ausente - promoção de mídia para treinamento desabilitada');
    return { sent: false, error: 'TRAINING_SERVICE_URL ausente' };
  }
  if (!params.content || params.content.trim().length < 50) {
    logger.warn({ mediaUploadId: params.mediaUploadId }, 'Conteúdo insuficiente para treinamento (mín 50 caracteres)');
    return { sent: false, error: 'Conteúdo insuficiente para treinamento' };
  }

  const promptPrefix = params.mediaType === 'image'
    ? 'Descrição visual extraída'
    : 'Transcrição de áudio extraída';

  const payload = {
    tenantId: params.tenantId,
    namespaceId: params.namespaceId,
    source: 'media-promotion',
    sourceType: 'rag_media' as const,
    sourceId: params.mediaUploadId,
    sourceMetadata: {
      mediaUploadId: params.mediaUploadId,
      mediaType: params.mediaType,
      originalFilename: params.originalFilename,
    },
    messages: [
      {
        role: 'system' as const,
        content: 'Você é Alice, especialista em Trading e Finanças. Use o conteúdo a seguir como conhecimento para respostas precisas.',
      },
      {
        role: 'user' as const,
        content: `${promptPrefix} de "${params.originalFilename}". Considere este conteúdo no seu conhecimento.`,
      },
      {
        role: 'assistant' as const,
        content: params.content.trim().slice(0, 8000),
      },
    ],
  };

  try {
    const response = await postTrainingDataWithAuthFallback({
      tenantId: params.tenantId,
      payload,
      userId: params.userId,
      role: params.role,
      customRoleId: params.customRoleId,
      context: {
        mediaUploadId: params.mediaUploadId,
        sourceType: 'rag_media',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn({
        mediaUploadId: params.mediaUploadId,
        status: response.status,
        error: errorText,
      }, 'Falha ao enviar mídia para treinamento');
      return { sent: false, status: response.status, error: errorText || `HTTP ${response.status}` };
    }

    const result = (await response.json()) as { trainingData?: { id?: string } };
    return {
      sent: true,
      trainingDataId: result.trainingData?.id,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({
      mediaUploadId: params.mediaUploadId,
      error: message,
    }, 'Erro ao enviar mídia para treinamento');
    return { sent: false, error: message };
  }
}

// ============================================================================
// MULTIMODAL - Tipos de mídia suportados (Fase 9)
// ============================================================================

// ATUALIZADO 23/12/2025: Removido suporte a vídeo (muito pesado para GPU)
// Plataforma suporta apenas: texto, áudio e imagem
const SUPPORTED_MEDIA_TYPES = {
  image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  audio: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/mp4'],
  // Documentos suportados pelo document-processor.ts (Regra 10 - Documentação PT-BR)
  // PDF, Word (DOCX/DOC), Excel (XLSX/XLS), Texto puro (TXT/MD/CSV)
  document: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
    'application/msword', // DOC
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // XLSX
    'application/vnd.ms-excel', // XLS
    'text/plain',
    'text/markdown',
    'text/csv',
  ],
} as const;

const ALL_SUPPORTED_MIMES = [
  ...SUPPORTED_MEDIA_TYPES.image,
  ...SUPPORTED_MEDIA_TYPES.audio,
  ...SUPPORTED_MEDIA_TYPES.document,
];

type MediaType = 'image' | 'audio' | 'document';

// Limites de arquivo por tipo (Enterprise, consistente com /api/media/health e frontend)
// NOTA: multer limits.fileSize deve usar o MAIOR limite (documento) e a validação fina por tipo
// é feita no handler, pois o limite do multer é global por upload.
const FILE_SIZE_LIMITS_BYTES: Record<MediaType, number> = {
  image: 10 * 1024 * 1024,    // 10MB
  audio: 25 * 1024 * 1024,    // 25MB
  document: 50 * 1024 * 1024, // 50MB
} as const;

// BUG FIX 23/12/2025: Type assertions seguras - includes() retorna boolean, type assertion apenas para TypeScript
// A validação real é feita pelo includes(), não pela type assertion
// Se mimeType não estiver na lista, includes() retorna false e a função retorna null
function detectMediaType(mimeType: string): MediaType | null {
  // BUG FIX 23/12/2025: Normalização robusta de mimeType para suportar variações de case e espaços
  // MIME types podem vir com variações (ex: "Image/Jpeg", "audio/mpeg; codecs=mp3")
  // .toLowerCase() e .trim() garantem matching correto mesmo com variações
  // Extrair apenas o tipo base (antes de ;) para suportar parâmetros adicionais
  // Consistente com normalização em integrations-service e chat-service para evitar rejeição de tipos legítimos
  const normalizedMimeType = mimeType.toLowerCase().trim().split(';')[0].trim();
  
  // Verificar cada tipo suportado explicitamente
  if (SUPPORTED_MEDIA_TYPES.image.includes(normalizedMimeType as typeof SUPPORTED_MEDIA_TYPES.image[number])) {
    return 'image';
  }
  if (SUPPORTED_MEDIA_TYPES.audio.includes(normalizedMimeType as typeof SUPPORTED_MEDIA_TYPES.audio[number])) {
    return 'audio';
  }
  if (SUPPORTED_MEDIA_TYPES.document.includes(normalizedMimeType as typeof SUPPORTED_MEDIA_TYPES.document[number])) {
    return 'document';
  }
  
  // Tipo não suportado - retornar null para fail-fast
  return null;
}

// ============================================================================
// VALIDAÇÃO DE SEGURANÇA DE UPLOADS (Regra 16 - Segurança Enterprise)
// ============================================================================

// Magic bytes para validação de conteúdo real
// Suporta múltiplos padrões por MIME type (ex: MP3 com/sem ID3 tag)
const MAGIC_BYTES: Record<string, { bytes: number[]; offset?: number }[]> = {
  // Imagens
  'image/jpeg': [{ bytes: [0xFF, 0xD8, 0xFF] }],
  'image/png': [{ bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] }],
  'image/gif': [{ bytes: [0x47, 0x49, 0x46, 0x38] }], // GIF87a ou GIF89a
  'image/webp': [{ bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 }], // RIFF
  // Documentos
  'application/pdf': [{ bytes: [0x25, 0x50, 0x44, 0x46] }], // %PDF
  // Microsoft Office Open XML (DOCX, XLSX) - são arquivos ZIP
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    { bytes: [0x50, 0x4B, 0x03, 0x04] }, // PK ZIP header
  ],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [
    { bytes: [0x50, 0x4B, 0x03, 0x04] }, // PK ZIP header
  ],
  // Microsoft Office Legacy (DOC, XLS) - OLE Compound Document
  'application/msword': [
    { bytes: [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1] }, // OLE header
  ],
  'application/vnd.ms-excel': [
    { bytes: [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1] }, // OLE header
  ],
  // Áudio
  // MP3: Pode começar com ID3 tag (ID3v2) ou sync word (0xFF 0xFB/0xFF 0xFA)
  'audio/mpeg': [
    { bytes: [0x49, 0x44, 0x33] }, // ID3 tag (maioria dos MP3s)
    { bytes: [0xFF, 0xFB] }, // MPEG Audio Layer 3 sync
    { bytes: [0xFF, 0xFA] }, // MPEG Audio Layer 3 sync (variante)
  ],
  // MP4/M4A: ftyp box (vários tipos)
  'audio/mp4': [
    { bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 }, // "ftyp" at offset 4
  ],
};

// MIME types de documentos que não têm magic bytes consistentes (texto puro)
// Estes são validados por heurísticas de texto UTF-8 em vez de magic bytes
const TEXT_BASED_MIMES = [
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
];

// Whitelist de MIME types permitidos para upload de documentos RAG
// Inclui todos os formatos suportados pelo document-processor.ts
const DOCUMENT_UPLOAD_WHITELIST = [
  // Texto puro
  'text/plain',
  'text/markdown',
  'text/csv',
  // PDF
  'application/pdf',
  // Microsoft Word
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
  'application/msword', // DOC
  // Microsoft Excel
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // XLSX
  'application/vnd.ms-excel', // XLS
  // Formatos estruturados (mantidos para compatibilidade)
  'application/json',
  'application/xml',
  'text/xml',
  'text/html',
];

const DOCUMENT_MIME_BY_EXTENSION: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
};

// Magic bytes de formatos binários conhecidos que NÃO devem ser aceitos como documentos de texto
// CRÍTICO: Inclui todos os formatos que podem ser usados para bypass de segurança
const BINARY_FORMAT_SIGNATURES: { name: string; bytes: number[]; offset?: number }[] = [
  // Imagens
  { name: 'JPEG', bytes: [0xFF, 0xD8, 0xFF] },
  { name: 'PNG', bytes: [0x89, 0x50, 0x4E, 0x47] },
  { name: 'GIF', bytes: [0x47, 0x49, 0x46, 0x38] },
  { name: 'WebP', bytes: [0x52, 0x49, 0x46, 0x46] },
  { name: 'BMP', bytes: [0x42, 0x4D] },
  { name: 'ICO', bytes: [0x00, 0x00, 0x01, 0x00] },
  { name: 'TIFF-LE', bytes: [0x49, 0x49, 0x2A, 0x00] },
  { name: 'TIFF-BE', bytes: [0x4D, 0x4D, 0x00, 0x2A] },
  // Documentos (PDF NÃO deve ser aceito como text/csv etc)
  { name: 'PDF', bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  // Arquivos compactados
  { name: 'ZIP', bytes: [0x50, 0x4B, 0x03, 0x04] },
  { name: 'ZIP-empty', bytes: [0x50, 0x4B, 0x05, 0x06] },
  { name: 'RAR', bytes: [0x52, 0x61, 0x72, 0x21] },
  { name: 'GZIP', bytes: [0x1F, 0x8B] },
  { name: '7Z', bytes: [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C] },
  { name: 'TAR', bytes: [0x75, 0x73, 0x74, 0x61, 0x72], offset: 257 }, // "ustar"
  // Executáveis
  { name: 'EXE/DLL', bytes: [0x4D, 0x5A] },
  { name: 'ELF', bytes: [0x7F, 0x45, 0x4C, 0x46] },
  { name: 'Mach-O-32', bytes: [0xFE, 0xED, 0xFA, 0xCE] },
  { name: 'Mach-O-64', bytes: [0xFE, 0xED, 0xFA, 0xCF] },
  // Áudio/Vídeo
  { name: 'MP3-ID3', bytes: [0x49, 0x44, 0x33] },
  { name: 'MP3-SYNC', bytes: [0xFF, 0xFB] },
  { name: 'MP3-SYNC2', bytes: [0xFF, 0xFA] },
  { name: 'MP4/M4A', bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 },
  { name: 'OGG', bytes: [0x4F, 0x67, 0x67, 0x53] },
  { name: 'FLAC', bytes: [0x66, 0x4C, 0x61, 0x43] },
  { name: 'WAV', bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF (também cobre WebP e outros)
  // Outros binários
  { name: 'WASM', bytes: [0x00, 0x61, 0x73, 0x6D] },
  { name: 'CLASS', bytes: [0xCA, 0xFE, 0xBA, 0xBE] },
  { name: 'SQLite', bytes: [0x53, 0x51, 0x4C, 0x69, 0x74, 0x65] }, // SQLite
];

/**
 * Detecta se buffer é um formato binário conhecido (não documento)
 */
function detectBinaryFormat(buffer: Buffer): string | null {
  for (const sig of BINARY_FORMAT_SIGNATURES) {
    const offset = sig.offset || 0;
    if (buffer.length < offset + sig.bytes.length) continue;
    
    let matches = true;
    for (let i = 0; i < sig.bytes.length; i++) {
      if (buffer[offset + i] !== sig.bytes[i]) {
        matches = false;
        break;
      }
    }
    
    if (matches) return sig.name;
  }
  return null;
}

/**
 * Valida upload de documento para RAG
 * Mais rigoroso que upload de mídia - verifica se texto é realmente texto
 */
function validateDocumentUpload(file: Express.Multer.File): { valid: boolean; error?: string } {
  // 1. Sanitizar nome
  file.originalname = sanitizeFilename(file.originalname);
  
  // 2. Tamanho mínimo
  if (file.buffer.length < 8) {
    return { valid: false, error: 'Arquivo muito pequeno ou corrompido' };
  }

  if (file.mimetype === 'application/octet-stream') {
    const extension = path.extname(file.originalname || '').toLowerCase();
    const inferredMime = extension ? DOCUMENT_MIME_BY_EXTENSION[extension] : undefined;
    if (inferredMime) {
      file.mimetype = inferredMime;
    }
  }
  
  // 3. MIME type na whitelist
  if (!DOCUMENT_UPLOAD_WHITELIST.includes(file.mimetype)) {
    return { 
      valid: false, 
      error: `Tipo de arquivo não permitido: ${file.mimetype}. Permitidos: ${DOCUMENT_UPLOAD_WHITELIST.join(', ')}` 
    };
  }
  
  // 4. Para PDFs, validar magic bytes
  if (file.mimetype === 'application/pdf') {
    if (!validateMagicBytes(file.buffer, file.mimetype)) {
      return { valid: false, error: 'Arquivo PDF corrompido ou inválido' };
    }
    return { valid: true };
  }
  
  // 5. Para tipos texto, verificar que não é formato binário disfarçado
  if (file.mimetype.startsWith('text/') || file.mimetype === 'application/json' || file.mimetype === 'application/xml') {
    // CRÍTICO: Detectar formatos binários conhecidos (JPEG, PNG, GIF, PDF, etc)
    const detectedBinary = detectBinaryFormat(file.buffer);
    if (detectedBinary) {
      return { 
        valid: false, 
        error: `Arquivo detectado como ${detectedBinary}, não é documento de texto válido` 
      };
    }
    
    // Verificar se é UTF-8 válido usando TextDecoder com fatal=true
    // Isso aceita texto multilíngue (chinês, japonês, português acentuado)
    // mas rejeita binários que produzem sequências UTF-8 inválidas
    try {
      const decoder = new TextDecoder('utf-8', { fatal: true });
      decoder.decode(file.buffer);
    } catch {
      // Tentar Latin-1 como fallback (alguns documentos antigos)
      try {
        const latin1Decoder = new TextDecoder('iso-8859-1', { fatal: false });
        const decoded = latin1Decoder.decode(file.buffer);
        // Verificar se tem muitos caracteres de controle (exceto whitespace)
        let controlCount = 0;
        for (let i = 0; i < Math.min(decoded.length, 1024); i++) {
          const code = decoded.charCodeAt(i);
          // Caracteres de controle: 0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F (exceto tab, newline, carriage return)
          if (code < 0x09 || (code > 0x0D && code < 0x20)) {
            controlCount++;
          }
        }
        // Mais de 5% de caracteres de controle indica binário
        if (controlCount / Math.min(decoded.length, 1024) > 0.05) {
          return { valid: false, error: 'Arquivo contém muitos caracteres de controle - parece binário' };
        }
      } catch {
        return { valid: false, error: 'Arquivo não é texto válido (encoding inválido)' };
      }
    }
    
    // Verificação final: null bytes são inaceitáveis em texto
    for (let i = 0; i < Math.min(file.buffer.length, 4096); i++) {
      if (file.buffer[i] === 0x00) {
        return { valid: false, error: 'Arquivo contém bytes nulos - não é texto válido' };
      }
    }
  }
  
  return { valid: true };
}

/**
 * Calcula o tamanho do header ID3v2 em MP3
 * ID3v2 usa syncsafe integers (7 bits por byte)
 */
function getID3v2Size(buffer: Buffer): number {
  // ID3v2 header: "ID3" + 2 bytes version + 1 byte flags + 4 bytes size (syncsafe)
  if (buffer.length < 10) return 0;
  if (buffer[0] !== 0x49 || buffer[1] !== 0x44 || buffer[2] !== 0x33) return 0;
  
  // Syncsafe integer: each byte only uses 7 bits
  const size = ((buffer[6] & 0x7F) << 21) |
               ((buffer[7] & 0x7F) << 14) |
               ((buffer[8] & 0x7F) << 7) |
               (buffer[9] & 0x7F);
  
  return 10 + size; // Header (10 bytes) + tag size
}

/**
 * Valida magic bytes do arquivo para confirmar MIME type real
 * Previne ataques de upload de arquivos maliciosos disfarçados
 * Suporta múltiplos padrões por MIME type (ex: MP3 com ID3 ou sync word)
 */
function validateMagicBytes(buffer: Buffer, declaredMime: string): boolean {
  // Documentos de texto não têm magic bytes consistentes
  if (TEXT_BASED_MIMES.includes(declaredMime)) {
    return true;
  }
  
  // Tratamento especial para MP3: pular ID3 tag e verificar sync word
  if (declaredMime === 'audio/mpeg') {
    let offset = 0;
    
    // Pular ID3v2 tag se presente
    if (buffer.length >= 10 && buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
      // Calcular tamanho do ID3v2 (syncsafe integer)
      const id3Size = getID3v2Size(buffer);
      if (id3Size > 0 && id3Size < buffer.length) {
        offset = id3Size;
      }
    }
    
    // Buscar sync word MPEG após ID3 (se houver)
    // Procurar em todo o buffer após o ID3 (alguns MP3s têm ID3 muito grande)
    const maxSearchLength = Math.min(buffer.length - 2, 1024 * 1024); // Max 1MB de busca
    for (let i = offset; i < maxSearchLength; i++) {
      // Sync word: 0xFF seguido de byte com bits 5-7 = 111
      if (buffer[i] === 0xFF && (buffer[i + 1] & 0xE0) === 0xE0) {
        // Verificar que não é falso positivo
        // Layer válido (não 00) e version válida (não 01)
        const version = (buffer[i + 1] >> 3) & 0x03;
        const layer = (buffer[i + 1] >> 1) & 0x03;
        if (version !== 1 && layer !== 0) {
          return true;
        }
      }
    }
    
    // CRÍTICO: NÃO aceitar apenas por ter ID3 tag
    // Requer sync word válido para confirmar que é realmente MP3
    return false;
  }
  
  const magicPatterns = MAGIC_BYTES[declaredMime];
  
  // Se não temos magic bytes configurados, aceitar
  if (!magicPatterns || magicPatterns.length === 0) {
    return true;
  }
  
  // Testar cada padrão possível - basta um corresponder
  for (const pattern of magicPatterns) {
    const offset = pattern.offset || 0;
    const expectedBytes = pattern.bytes;
    
    if (buffer.length < offset + expectedBytes.length) {
      continue; // Tentar próximo padrão
    }
    
    let matches = true;
    for (let i = 0; i < expectedBytes.length; i++) {
      if (buffer[offset + i] !== expectedBytes[i]) {
        matches = false;
        break;
      }
    }
    
    if (matches) {
      return true;
    }
  }
  
  return false;
}

/**
 * Sanitiza nome de arquivo para prevenir path traversal e caracteres maliciosos
 */
function sanitizeFilename(filename: string): string {
  // Remover path components
  const basename = path.basename(filename);
  
  // Substituir caracteres perigosos
  const sanitized = basename
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_') // Caracteres proibidos
    .replace(/\.{2,}/g, '.') // Múltiplos pontos
    .replace(/^\.+/, '') // Pontos no início
    .trim();
  
  // Limitar tamanho
  const maxLength = 255;
  if (sanitized.length > maxLength) {
    const ext = path.extname(sanitized);
    const name = path.basename(sanitized, ext);
    return name.slice(0, maxLength - ext.length - 1) + ext;
  }
  
  // Fallback se vazio
  return sanitized || `file_${Date.now()}`;
}

/**
 * Valida upload de arquivo com múltiplas camadas de segurança
 */
function validateUpload(file: Express.Multer.File): { valid: boolean; error?: string } {
  // 1. Validar MIME type na whitelist
  if (!ALL_SUPPORTED_MIMES.includes(file.mimetype as typeof ALL_SUPPORTED_MIMES[number])) {
    return { valid: false, error: `Tipo de arquivo não suportado: ${file.mimetype}` };
  }
  
  // 2. Validar magic bytes (conteúdo real vs declarado)
  if (!validateMagicBytes(file.buffer, file.mimetype)) {
    return { 
      valid: false, 
      error: 'Conteúdo do arquivo não corresponde ao tipo declarado. Possível arquivo malicioso.' 
    };
  }
  
  // 3. Verificar tamanho mínimo (arquivos vazios/corrompidos)
  if (file.buffer.length < 8) {
    return { valid: false, error: 'Arquivo muito pequeno ou corrompido' };
  }
  
  // 4. Sanitizar nome do arquivo
  file.originalname = sanitizeFilename(file.originalname);
  
  return { valid: true };
}

// Logger centralizado: JSON em produção, pino-pretty em desenvolvimento
const logger = createLogger('rag-service');
const ragRuntimeConfig = loadConfig(ragServiceConfigSchema);

const PORT = ragRuntimeConfig.PORT;
const _DATABASE_URL = ragRuntimeConfig.DATABASE_URL;
const CORS_ORIGINS = resolveCorsOrigins({
  requiredInProduction: true,
  developmentFallback: [],
});
const OPENAI_API_KEY = readOptionalStringEnv('OPENAI_API_KEY') ?? undefined;
if (isProduction && !OPENAI_API_KEY) {
  logger.error('OPENAI_API_KEY é obrigatório em produção para processamento multimodal (imagem/áudio)');
  process.exit(1);
}

// ==============================================================================
// ARQUITETURA MULTIMODAL ENTERPRISE - Gate 2 (LLM separado + Vision OpenAI)
// ==============================================================================
// GPU Manager Service (Hetzner GEX44):
// - Text embeddings: Qwen3-Embedding-0.6B INT8 (1024 dim) → Qdrant
// - Transcrição de áudio: OpenAI ASR (gpt-4o-transcribe)
// - LLM (texto): Qwen2.5 7B Instruct (AWQ)
// - Treinamento: gpu-trainer
// Vision (análise/geração de imagens): OpenAI Responses/Images API (sem GPU)
// ==============================================================================
//
// ARQUITETURA DE STORAGE:
// - Texto (1024 dim): Qdrant (HNSW)
// - Imagem: OpenAI Vision (descrição textual, sem embeddings de imagem)
//
// GPU MANAGER SERVICE (Hetzner GEX44) é usado para:
// - chat-service: inferência LLM (texto)
// - rag-service: embeddings de texto + processamento multimodal (sem GPU para imagens)
// - training-service: fine-tuning (gpu-trainer sob demanda via profile)

function normalizeBaseUrl(raw?: string): string {
  const base = (raw && raw.trim()) || 'http://alice-searxng:8080/';
  // Remove barras finais duplicadas e garante uma barra única no final.
  const trimmed = base.replace(/\/+$/, '');
  return `${trimmed}/`;
}

const SEARXNG_URL = normalizeBaseUrl(readOptionalStringEnv('SEARXNG_URL') ?? undefined);
const SEARXNG_SECRET_KEY = readOptionalStringEnv('SEARXNG_SECRET_KEY') ?? undefined;

// ============================================================================
// VALIDAÇÃO DE VARIÁVEIS DE AMBIENTE - CORREÇÃO AUDITORIA 17/12/2025
// Bug: Number() sem validação de NaN causava:
// - setInterval(fn, NaN) → delay 0 → loop infinito (DoS)
// - Worker concurrency NaN → comportamento indefinido
// ============================================================================
function parseEnvInt(envValue: string | undefined, defaultValue: number, varName: string): number {
  const raw = envValue ?? String(defaultValue);
  const trimmed = raw.trim();
  
  // Regra 6: Rejeitar valores parciais - só dígitos são aceitos
  if (!/^\d+$/.test(trimmed)) {
    const errorMsg = `${varName} inválido: "${raw}". Deve ser número inteiro positivo.`;
    if (isProduction) {
      logger.error({ varName, rawValue: raw }, errorMsg);
      throw new Error(errorMsg);
    }
    logger.warn({ varName, rawValue: raw, defaultValue }, `${errorMsg} Usando valor padrão.`);
    return defaultValue;
  }
  
  const parsed = parseInt(trimmed, 10);
  
  if (!Number.isFinite(parsed) || parsed <= 0) {
    const errorMsg = `${varName} inválido: "${raw}". Deve ser número inteiro positivo.`;
    if (isProduction) {
      logger.error({ varName, rawValue: raw, parsed }, errorMsg);
      throw new Error(errorMsg);
    }
    logger.warn({ varName, rawValue: raw, parsed, defaultValue }, `${errorMsg} Usando valor padrão.`);
    return defaultValue;
  }
  
  return parsed;
}

function parseEnvBool(envValue: string | undefined, defaultValue: boolean, varName: string): boolean {
  if (envValue === undefined) return defaultValue;
  const normalized = envValue.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  const errorMsg = `${varName} inválido: "${envValue}". Deve ser 'true' ou 'false'.`;
  if (isProduction) {
    logger.error({ varName, rawValue: envValue }, errorMsg);
    throw new Error(errorMsg);
  }
  logger.warn({ varName, rawValue: envValue, defaultValue }, `${errorMsg} Usando valor padrão.`);
  return defaultValue;
}

function parseEnvFloat(envValue: string | undefined, defaultValue: number, varName: string): number {
  const raw = (envValue ?? String(defaultValue)).trim().replace(',', '.');
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    const errorMsg = `${varName} inválido: "${raw}". Deve ser número entre 0 e 1.`;
    if (isProduction) {
      logger.error({ varName, rawValue: raw, parsed }, errorMsg);
      throw new Error(errorMsg);
    }
    logger.warn({ varName, rawValue: raw, parsed, defaultValue }, `${errorMsg} Usando valor padrão.`);
    return defaultValue;
  }
  return parsed;
}

// Workers (defaults seguros e configuráveis) - CORREÇÃO AUDITORIA 17/12/2025
const WORKER_POLL_MS = parseEnvInt(
  readOptionalStringEnv('WORKER_POLL_MS') ?? undefined,
  3000,
  'WORKER_POLL_MS'
);
const WORKER_CONCURRENCY = parseEnvInt(
  readOptionalStringEnv('WORKER_CONCURRENCY') ?? undefined,
  2,
  'WORKER_CONCURRENCY'
);
const WORKER_MAX_ATTEMPTS = parseEnvInt(
  readOptionalStringEnv('WORKER_MAX_ATTEMPTS') ?? undefined,
  3,
  'WORKER_MAX_ATTEMPTS'
);
const WEB_CRAWL_REQUIRE_ALLOWLIST = parseEnvBool(
  readOptionalStringEnv('WEB_CRAWL_REQUIRE_ALLOWLIST') ?? undefined,
  isProduction,
  'WEB_CRAWL_REQUIRE_ALLOWLIST'
);
const WEB_CRAWL_ALLOWED_DOMAINS = (readOptionalStringEnv('WEB_CRAWL_ALLOWED_DOMAINS') ?? '')
  .split(',')
  .map((domain) => domain.trim().toLowerCase())
  .filter(Boolean);
const WEB_CRAWL_USER_AGENT = readOptionalStringEnv('WEB_CRAWL_USER_AGENT') ?? undefined;
if (WEB_CRAWL_REQUIRE_ALLOWLIST && WEB_CRAWL_ALLOWED_DOMAINS.length === 0) {
  const errorMsg = 'WEB_CRAWL_ALLOWED_DOMAINS e obrigatorio quando WEB_CRAWL_REQUIRE_ALLOWLIST=true.';
  logger.error({ requireAllowlist: WEB_CRAWL_REQUIRE_ALLOWLIST }, errorMsg);
  throw new Error(errorMsg);
}
const DOC_PROCESS_MAX_ATTEMPTS = parseEnvInt(
  readOptionalStringEnv('DOC_PROCESS_MAX_ATTEMPTS') ?? undefined,
  3,
  'DOC_PROCESS_MAX_ATTEMPTS'
);
const DOC_CHUNK_SIZE_CHARS = parseEnvInt(
  readOptionalStringEnv('DOC_CHUNK_SIZE_CHARS') ?? undefined,
  1000,
  'DOC_CHUNK_SIZE_CHARS'
);
const DOC_CHUNK_OVERLAP_CHARS_RAW = parseEnvInt(
  readOptionalStringEnv('DOC_CHUNK_OVERLAP_CHARS') ?? undefined,
  200,
  'DOC_CHUNK_OVERLAP_CHARS'
);
const DOC_CHUNK_MAX_CHUNKS = parseEnvInt(
  readOptionalStringEnv('DOC_CHUNK_MAX_CHUNKS') ?? undefined,
  200,
  'DOC_CHUNK_MAX_CHUNKS'
);
const DOCUMENT_PROCESSING_RECONCILER_INTERVAL_MS = 30_000;
const DOCUMENT_PROCESSING_RECONCILER_STALE_MS = 2 * 60_000;
const DOCUMENT_PROCESSING_RECONCILER_BATCH_SIZE = 50;
const DOC_CHUNK_OVERLAP_CHARS = Math.min(
  DOC_CHUNK_OVERLAP_CHARS_RAW,
  Math.max(1, DOC_CHUNK_SIZE_CHARS - 1)
);
if (DOC_CHUNK_OVERLAP_CHARS_RAW >= DOC_CHUNK_SIZE_CHARS) {
  logger.warn(
    {
      DOC_CHUNK_OVERLAP_CHARS: DOC_CHUNK_OVERLAP_CHARS_RAW,
      DOC_CHUNK_SIZE_CHARS,
      adjustedOverlap: DOC_CHUNK_OVERLAP_CHARS,
    },
    'DOC_CHUNK_OVERLAP_CHARS ajustado para manter overlap menor que chunk size'
  );
}

const TRAINING_SERVICE_URL = getOptionalServiceUrl('training');
const TRAINING_DOC_AUTO_COLLECT = parseEnvBool(
  readOptionalStringEnv('TRAINING_DOC_AUTO_COLLECT') ?? undefined,
  false,
  'TRAINING_DOC_AUTO_COLLECT'
);
const TRAINING_DOC_MAX_SAMPLES = parseEnvInt(
  readOptionalStringEnv('TRAINING_DOC_MAX_SAMPLES') ?? undefined,
  50,
  'TRAINING_DOC_MAX_SAMPLES'
);
const TRAINING_DOC_MIN_CHARS = parseEnvInt(
  readOptionalStringEnv('TRAINING_DOC_MIN_CHARS') ?? undefined,
  180,
  'TRAINING_DOC_MIN_CHARS'
);

const RAG_ADAPTIVE_K_ENABLED = parseEnvBool(
  readOptionalStringEnv('RAG_ADAPTIVE_K_ENABLED') ?? undefined,
  false,
  'RAG_ADAPTIVE_K_ENABLED'
);
const RAG_ADAPTIVE_K_MIN_RESULTS = parseEnvInt(
  readOptionalStringEnv('RAG_ADAPTIVE_K_MIN_RESULTS') ?? undefined,
  2,
  'RAG_ADAPTIVE_K_MIN_RESULTS'
);
const RAG_ADAPTIVE_K_MIN_THRESHOLD = parseEnvFloat(
  readOptionalStringEnv('RAG_ADAPTIVE_K_MIN_THRESHOLD') ?? undefined,
  0.55,
  'RAG_ADAPTIVE_K_MIN_THRESHOLD'
);
const RAG_ADAPTIVE_K_FALLBACK_DELTA = parseEnvFloat(
  readOptionalStringEnv('RAG_ADAPTIVE_K_FALLBACK_DELTA') ?? undefined,
  0.1,
  'RAG_ADAPTIVE_K_FALLBACK_DELTA'
);
const RAG_ADAPTIVE_K_SHORT_QUERY = parseEnvInt(
  readOptionalStringEnv('RAG_ADAPTIVE_K_SHORT_QUERY') ?? undefined,
  200,
  'RAG_ADAPTIVE_K_SHORT_QUERY'
);
const RAG_ADAPTIVE_K_MEDIUM_QUERY = parseEnvInt(
  readOptionalStringEnv('RAG_ADAPTIVE_K_MEDIUM_QUERY') ?? undefined,
  600,
  'RAG_ADAPTIVE_K_MEDIUM_QUERY'
);

// Usar package @alice/database centralizado (node-postgres para produção Hetzner)
const db = getDatabase();

// Inicializar sistema de feature flags com storage PostgreSQL (Regra 16 - Enterprise)
const featureFlagStorage = createDrizzleFeatureFlagStorage();
initFeatureFlags(featureFlagStorage);
logger.info('Sistema de feature flags inicializado');

const app = express();

// ============================================================================
// PROMETHEUS: Instrumentação de métricas (Regra 16 - Observability Enterprise)
// ============================================================================
const { metrics, metricsRouter, httpMetricsMiddleware } = createAlicePrometheus({
  serviceName: 'rag-service',
  collectDefaultMetrics: true,
});

const ragIngestionJobTotal = new PromCounter({
  name: 'alice_rag_ingestion_job_total',
  help: 'Total de jobs de ingestao de documentos RAG processados',
  labelNames: ['status'] as const,
  registers: [metrics.registry],
});

const ragIngestionLatency = new PromHistogram({
  name: 'alice_rag_ingestion_latency_seconds',
  help: 'Latencia de processamento de jobs de ingestao RAG',
  labelNames: ['status'] as const,
  buckets: [0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600],
  registers: [metrics.registry],
});

const ragIngestionDedupedTotal = new PromCounter({
  name: 'alice_rag_ingestion_deduped_total',
  help: 'Total de deduplicacoes de jobs de ingestao RAG por documentId',
  registers: [metrics.registry],
});

// Inicializar métricas RBAC (Regra 16 - Observability Enterprise)
initRbacPrometheusMetrics(metrics.rbac);
logger.info('Métricas RBAC Prometheus inicializadas no rag-service');

setDocumentProcessingQueueMetricObserver((event) => {
  if (event === 'deduped') {
    ragIngestionDedupedTotal.inc();
    return;
  }
  if (event === 'enqueued') {
    ragIngestionJobTotal.inc({ status: 'queued' });
  }
});

// Endpoint /metrics para Prometheus scraper (antes de outros middlewares)
app.use(metricsRouter);

// ============================================================================
// OPENAPI/SWAGGER: Documentação da API (OWASP API9)
// ============================================================================
setupSwaggerUI(app, {
  serviceName: 'rag-service',
  version: '1.0.0',
  description: 'Serviço RAG com busca semântica, embeddings multimodais e pgvector.',
  port: Number(PORT),
  tags: RAG_SERVICE_TAGS,
  paths: ragServicePaths,
  schemas: ragServiceSchemas,
});
logger.info('Swagger UI configurado em /api/docs');

// Middleware para coletar métricas HTTP automaticamente
app.use(httpMetricsMiddleware);

// SEGURANÇA: Desabilitar X-Powered-By header (Express.js 2025 + OWASP API8)
app.disable('x-powered-by');

// SEGURANÇA: Trust proxy = 1 para confiar apenas no primeiro proxy (Traefik)
// Evita bypass de rate limiting (express-rate-limit 2025 best practice)
app.set('trust proxy', 1);

// Upload para documentos RAG (texto)
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// Upload para mídia multimodal (imagem, áudio, documento) - vídeo NÃO suportado
const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { 
    // Limite global do multer deve ser o maior limite permitido (documentos).
    // A validação por tipo (10/25/50MB) é aplicada no handler após detectar mediaType.
    fileSize: FILE_SIZE_LIMITS_BYTES.document,
  },
  fileFilter: (_req, file, cb) => {
    if (ALL_SUPPORTED_MIMES.includes(file.mimetype as typeof ALL_SUPPORTED_MIMES[number])) {
      cb(null, true);
    } else {
      cb(new Error(`Tipo de arquivo não suportado: ${file.mimetype}`));
    }
  },
});

// ============================================================================
// CIRCUIT BREAKER - Text Embeddings GPU (ARQUITETURA ENTERPRISE - 17/12/2025)
// Usa serviço GPU embeddings via GPU Manager Service (Qwen3-Embedding-0.6B, 1024 dim → Qdrant)
// Usa CIRCUIT_BREAKER_PRESETS centralizado (Regra 2 - Não Duplicar)
// ============================================================================

/** GPU Manager Service gerencia embeddings GPU (Hetzner GEX44) */
// GPU Manager Service - Gerenciamento centralizado de requisições GPU (25/12/2025)
const GPU_MANAGER_URL = getServiceUrl('gpuManager');

/** SSOT validation (Plano 11/02/2026): TEXT_EMBEDDING_DIM (embeddings-gpu) = EMBEDDING_DIMENSIONS.TEXT */
async function validateEmbeddingDimensionsSSOT(): Promise<void> {
  const secret = readOptionalStringEnv('INTERNAL_API_SECRET');
  if (!secret) return;
  const maxAttempts = 3;
  const delayMs = 2000;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${GPU_MANAGER_URL}/api/gpu/embeddings/health`, {
        signal: controller.signal,
        headers: { 'X-Internal-Api-Secret': secret, Accept: 'application/json' },
      });
      clearTimeout(t);
      if (!res.ok) {
        if (attempt < maxAttempts) {
          logger.warn({ attempt, status: res.status }, 'Embeddings health unreachable - retrying');
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        logger.warn({ status: res.status }, 'Embeddings health unreachable após retries - continuando');
        return;
      }
      const data = (await res.json()) as { text_dimensions?: number };
      const dim = data.text_dimensions;
      if (typeof dim !== 'number') {
        logger.warn({ data }, 'Embeddings health não retornou text_dimensions');
        return;
      }
      if (dim !== EMBEDDING_DIMENSIONS.TEXT) {
        logger.error(
          { text_dimensions: dim, expected: EMBEDDING_DIMENSIONS.TEXT },
          'SSOT INCONSISTENTE: embeddings-gpu retorna dimensão diferente de @alice/database'
        );
        process.exit(1);
      }
      logger.info({ text_dimensions: dim }, 'SSOT validado: embeddings-gpu = EMBEDDING_DIMENSIONS.TEXT');
      return;
    } catch (err) {
      if (attempt < maxAttempts) {
        logger.warn({ attempt, err: err instanceof Error ? err.message : String(err) }, 'Embeddings health unreachable - retrying');
        await new Promise((r) => setTimeout(r, delayMs));
      } else {
        logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Embeddings health unreachable após retries - continuando');
      }
    }
  }
}

interface TextEmbeddingResponse {
  embedding: number[];
  model: string;
  dimension: number;
  processing_time_ms: number;
}

async function generateEmbeddingInternal(text: string): Promise<number[]> {
  // ARQUITETURA ENTERPRISE (Gate 2): Qwen3-Embedding-0.6B via GPU Manager Service (1024 dim)
  // GPU é OBRIGATÓRIO - embeddings armazenados em Qdrant
  
  try {
    const startNs = process.hrtime.bigint();
    // Enfileirar requisição no GPU Manager com prioridade MEDIUM (embeddings RAG)
    const gpuResponse = await requestGpu({
      serviceType: GpuServiceType.EMBEDDINGS,
      endpoint: '/embed/text',
      method: 'POST',
      priority: GpuRequestPriority.MEDIUM,
      timeout: 30000, // 30s timeout
      body: {
        texts: [text],
      },
    });

    if (!gpuResponse.success || !gpuResponse.data) {
      throw new Error(gpuResponse.error || 'Erro ao gerar embedding de texto');
    }

    const data = gpuResponse.data as Partial<TextEmbeddingResponse> & {
      embedding?: number[];
      embeddings?: number[][];
      dimensions?: number;
    };
    const resultEmbedding = data.embedding ?? data.embeddings?.[0];
    
    if (!resultEmbedding || resultEmbedding.length === 0) {
      throw new Error('Serviço GPU de embeddings retornou resultado vazio');
    }
    
    // Validar dimensão (SSOT) - Enterprise-Grade
    // Lança erro se dimensão estiver incorreta (não apenas warning)
    validateEmbeddingDimension(resultEmbedding, EMBEDDING_DIMENSIONS.TEXT, 'TEXT');

    // Observabilidade: latência de embeddings (modelo-agnóstico)
    metrics.rag.embeddingDuration.observe(
      { model: data.model || 'unknown' },
      Number(process.hrtime.bigint() - startNs) / 1e9
    );
    
    return resultEmbedding;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Erro desconhecido ao gerar embedding: ${String(error)}`);
  }
}

const gpuManagerEmbeddingsBreaker = createCircuitBreaker(generateEmbeddingInternal, {
  name: 'text-embeddings-local',
  ...CIRCUIT_BREAKER_PRESETS.textEmbeddings,
});

// Instrumentar circuit breaker com métricas Prometheus
// Type assertion necessária: Opossum CircuitBreaker tem tipos de eventos mais específicos
instrumentCircuitBreaker(metrics, 'gpu-manager-embeddings', gpuManagerEmbeddingsBreaker as unknown as Parameters<typeof instrumentCircuitBreaker>[2]);

async function generateEmbedding(text: string): Promise<number[]> {
  try {
    return await gpuManagerEmbeddingsBreaker.fire(text) as number[];
  } catch (error) {
    if (error instanceof Error && error.message.includes('Breaker is open')) {
      logger.warn('Circuit breaker aberto - Embeddings temporariamente indisponível');
      throw new Error('Serviço de embeddings temporariamente indisponível. Tente novamente em alguns segundos.');
    }
    throw error;
  }
}

// ============================================================================
// BUSCA QDRANT - Embeddings de texto (1024 dim - Qwen3-Embedding-0.6B)
// ARQUITETURA ENTERPRISE (17/12/2025):
// - Texto: Qdrant (1024 dim) - usa esta função
// - Imagem: pgvector (1024 dim) - usa queries SQL diretas
// ============================================================================

interface QdrantDocumentResult {
  id: string;
  documentId: string;
  conteudo: string;
  posicao?: number;
  metadata?: Record<string, unknown>;
  criadoEm?: string;
  similarity: number;
  document?: {
    id: string;
    titulo: string | null;
    nomeArquivo: string | null;
    namespaceId: string | null;
  } | null;
}

// ============================================================================
// RAG Cache Distribuído (Redis) - Enterprise (WS2/WS3)
// ============================================================================
// Objetivo:
// - Reduzir custo/latência para queries repetidas (mesma query+parâmetros) dentro de uma janela curta
// - Medir cache hit/miss com métricas Prometheus (modelo-agnóstico)
//
// Regra 6:
// - Em produção: cache distribuído (Redis) é obrigatório quando habilitado.
// - Em dev/test: cache é DESABILITADO se não houver Redis (sem in-memory).
// ============================================================================

const RAG_QUERY_CACHE_TTL_MS = 60_000; // 60s (trade-off: frescor vs performance)

type RagSearchResponse = { results: QdrantDocumentResult[] };
type RagContextResponse = {
  context: string;
  sources: Array<{
    documentId: string;
    titulo: string | null;
    similarity: number;
  }>;
};

let ragSearchCache: CacheAdapter<RagSearchResponse> | null = null;
let ragContextCache: CacheAdapter<RagContextResponse> | null = null;

function normalizeRagQuery(query: string): string {
  return query.replace(/\s+/g, ' ').trim();
}

function buildRagCacheKey(params: {
  endpoint: 'search' | 'context';
  tenantId: string;
  query: string;
  namespaceId?: string;
  limit: number;
  threshold: number;
}): string {
  const normalized = normalizeRagQuery(params.query);
  const ns = params.namespaceId || 'all';

  // Hash para evitar chaves gigantes e garantir determinismo.
  const digest = crypto
    .createHash('sha256')
    .update(`${params.endpoint}|${params.tenantId}|${ns}|${params.limit}|${params.threshold}|${normalized}`, 'utf8')
    .digest('hex');

  // Prefixo por tenant permite invalidação por prefixo (tenant-scoped).
  return `${params.tenantId}:${params.endpoint}:${ns}:${digest}`;
}

async function invalidateRagCachesForTenant(tenantId: string): Promise<void> {
  // Best-effort: invalidação não pode quebrar fluxo principal.
  try {
    await Promise.all([
      ragSearchCache?.deleteByPrefix(`${tenantId}:`) ?? Promise.resolve(0),
      ragContextCache?.deleteByPrefix(`${tenantId}:`) ?? Promise.resolve(0),
    ]);
  } catch (error) {
    logger.warn({ error, tenantId }, 'Falha ao invalidar cache RAG (não crítico)');
  }
}

/**
 * Busca documentos similares via Qdrant (1024 dim)
 * 
 * ARQUITETURA ENTERPRISE (Gate 2):
 * - Embeddings de texto com Qwen3-Embedding-0.6B (1024 dim)
 * - Armazenamento e busca vetorial via Qdrant (HNSW)
 * - Multi-tenancy via filtro de payload (tenantId)
 * 
 * @param queryEmbedding - Embedding da query (1024 dim)
 * @param tenantId - ID do tenant para isolamento
 * @param options - Opções de busca (limit, threshold, namespaceId)
 * @returns Array de documentos similares com score
 */
async function searchDocumentsInQdrant(
  queryEmbedding: number[],
  tenantId: string,
  options: {
    limit?: number;
    threshold?: number;
    namespaceId?: string;
    queryText?: string;
  } = {}
): Promise<QdrantDocumentResult[]> {
  const { limit = 10, threshold = 0.7, namespaceId, queryText } = options;
  const effectiveParams = (() => {
    if (!RAG_ADAPTIVE_K_ENABLED || !queryText) {
      return { limit, threshold };
    }
    const normalizedLength = queryText.trim().length;
    let adaptiveLimit = limit;
    if (normalizedLength <= RAG_ADAPTIVE_K_SHORT_QUERY) {
      adaptiveLimit = Math.max(1, Math.round(limit * 0.6));
    } else if (normalizedLength <= RAG_ADAPTIVE_K_MEDIUM_QUERY) {
      adaptiveLimit = Math.max(1, Math.round(limit * 0.8));
    }
    return { limit: adaptiveLimit, threshold };
  })();

  if (!isQdrantConfigured()) {
    logger.warn('Qdrant não configurado - busca de texto indisponível');
    return [];
  }

  // Construir filtro Qdrant (multi-tenancy + namespace opcional + tipos RAG multimodal)
  // Plano RAG Multimodal Enterprise (11/02/2026): incluir document_chunk, media_image e media_audio
  // Ref: https://qdrant.tech/documentation/concepts/filtering/ - Match Any (v1.1.0+)
  const mustConditions: Array<{ key: string; match: { value?: string; any?: string[] } }> = [
    { key: 'tenantId', match: { value: tenantId } },
    { key: 'type', match: { any: ['document_chunk', 'media_image', 'media_audio'] } },
  ];

  if (namespaceId) {
    mustConditions.push({ key: 'namespaceId', match: { value: namespaceId } });
  }

  const filter = { must: mustConditions };

  try {
    const results = await searchPoints(TEXT_COLLECTION_NAME, queryEmbedding, {
      limit: effectiveParams.limit * 2, // Buscar mais para compensar filtro por threshold
      scoreThreshold: effectiveParams.threshold,
      filter,
      withPayload: true,
    });
    let mappedResults = results;
    if (RAG_ADAPTIVE_K_ENABLED && queryText) {
      const shouldFallback = mappedResults.length < RAG_ADAPTIVE_K_MIN_RESULTS
        && effectiveParams.threshold > RAG_ADAPTIVE_K_MIN_THRESHOLD;
      if (shouldFallback) {
        const fallbackThreshold = Math.max(
          RAG_ADAPTIVE_K_MIN_THRESHOLD,
          effectiveParams.threshold - RAG_ADAPTIVE_K_FALLBACK_DELTA
        );
        const fallbackResults = await searchPoints(TEXT_COLLECTION_NAME, queryEmbedding, {
          limit: effectiveParams.limit * 2,
          scoreThreshold: fallbackThreshold,
          filter,
          withPayload: true,
        });
        if (fallbackResults.length > mappedResults.length) {
          mappedResults = fallbackResults;
        }
      }
    }

    // Mapear resultados Qdrant para formato esperado pelo RAG
    // Plano RAG Multimodal Enterprise (11/02/2026): document_chunk, media_image e media_audio
    return mappedResults
      .slice(0, effectiveParams.limit)
      .map((result: QdrantSearchResult): QdrantDocumentResult => {
        const payload = result.payload || {};
        const type = payload.type as string | undefined;

        // Document chunks: documentId, conteudo, document (nested)
        // media_image: mediaUploadId, visionDescription
        // media_audio: mediaUploadId, transcription
        const documentId = String(
          payload.documentId ?? payload.mediaUploadId ?? ''
        );
        const conteudo = String(
          payload.conteudo ?? payload.visionDescription ?? payload.transcription ?? ''
        );

        return {
          id: String(result.id),
          documentId,
          conteudo,
          posicao: type === 'document_chunk' && typeof payload.posicao === 'number'
            ? payload.posicao
            : undefined,
          metadata: ((): Record<string, unknown> | undefined => {
            const base = typeof payload.metadata === 'object'
              ? payload.metadata as Record<string, unknown>
              : {};
            if (type === 'media_image' || type === 'media_audio') {
              return {
                ...base,
                ragSourceType: type,
                mediaType: payload.mediaType ?? (type === 'media_image' ? 'image' : 'audio'),
              };
            }
            return Object.keys(base).length > 0 ? base : undefined;
          })(),
          criadoEm: typeof payload.criadoEm === 'string' ? payload.criadoEm : undefined,
          similarity: Math.round(result.score * 10000) / 10000,
          document: payload.document_id ? {
            id: String(payload.document_id),
            titulo: payload.document_titulo ? String(payload.document_titulo) : null,
            nomeArquivo: payload.document_nomeArquivo ? String(payload.document_nomeArquivo) : null,
            namespaceId: payload.document_namespaceId ? String(payload.document_namespaceId) : null,
          } : null,
        };
      });
  } catch (error) {
    logger.error({ error, tenantId, namespaceId }, 'Erro na busca Qdrant');
    throw error;
  }
}

/**
 * Busca documentos similares para contexto agentic via Qdrant
 * Versão simplificada para uso no endpoint /api/rag/agentic
 */
async function searchDocumentsForContext(
  queryEmbedding: number[],
  tenantId: string,
  options: {
    limit?: number;
    threshold?: number;
    namespaceId?: string;
  } = {}
): Promise<Array<{ documentId: string; titulo?: string; conteudo: string; similarity: number }>> {
  const results = await searchDocumentsInQdrant(queryEmbedding, tenantId, options);
  
  return results.map(r => ({
    documentId: r.documentId,
    titulo: r.document?.titulo || undefined,
    conteudo: r.conteudo,
    similarity: r.similarity,
  }));
}

// ============================================================================
// AGENTIC RAG - Web Search Integration (Regra 16 - Best Practices 2025)
// ============================================================================

const webSearchClient = createWebSearchClient({
  baseUrl: SEARXNG_URL,
  apiKey: SEARXNG_SECRET_KEY,
  logger,
  metrics,
});

const webSearch = (query: string, count?: number, options?: WebSearchOptions) =>
  webSearchClient.search(query, count, options);

// ============================================================================
// WORKERS (background)
// - Embedding worker: inicia sempre que Redis estiver disponível
// - Learning/Web Crawl workers: opcionais e tenant-scoped via WORKER_TENANT_ID
// ============================================================================

const WORKER_TENANT_ID = readOptionalStringEnv('WORKER_TENANT_ID') ?? undefined;
let documentProcessingReconcilerTimer: NodeJS.Timeout | null = null;

function startTenantScopedWorkers(workerTenantId: string): void {
  startLearningWorker(db, {
    tenantId: workerTenantId,
    concurrency: WORKER_CONCURRENCY,
    pollIntervalMs: WORKER_POLL_MS,
    maxAttempts: WORKER_MAX_ATTEMPTS,
  });

  startWebCrawlWorker(db, {
    tenantId: workerTenantId,
    concurrency: WORKER_CONCURRENCY,
    pollIntervalMs: WORKER_POLL_MS,
    maxAttempts: WORKER_MAX_ATTEMPTS,
    searxngUrl: SEARXNG_URL,
    searxngKey: SEARXNG_SECRET_KEY,
    userAgent: WEB_CRAWL_USER_AGENT,
    allowedDomains: WEB_CRAWL_ALLOWED_DOMAINS,
    requireAllowlist: WEB_CRAWL_REQUIRE_ALLOWLIST,
  });

  logger.info({
    tenantId: workerTenantId,
    concurrency: WORKER_CONCURRENCY,
    pollIntervalMs: WORKER_POLL_MS,
    maxAttempts: WORKER_MAX_ATTEMPTS,
    webCrawlRequireAllowlist: WEB_CRAWL_REQUIRE_ALLOWLIST,
    webCrawlAllowlistSize: WEB_CRAWL_ALLOWED_DOMAINS.length,
  }, 'Workers tenant-scoped iniciados (learning + web-crawl)');
}

function startEmbeddingWorkerWhenRedisReady(redisConnected: boolean): void {
  if (!redisConnected) {
    logger.warn('Embedding worker não iniciado: Redis indisponível');
    return;
  }

  startEmbeddingWorker({ metrics });
  void getEmbeddingWorkerStatus()
    .then((status) => {
      logger.info({
        running: status.running,
        queueSize: status.queueSize,
        currentConcurrent: status.currentConcurrent,
        processedCount: status.processedCount,
      }, 'Embedding worker iniciado e status inicial coletado');
    })
    .catch((error) => {
      logger.warn({ error }, 'Falha ao coletar status inicial do embedding worker');
    });
}

function startDocumentProcessingWorkerWhenRedisReady(redisConnected: boolean): void {
  if (!redisConnected) {
    logger.warn('Document processing worker nao iniciado: Redis indisponivel');
    return;
  }

  startDocumentProcessingWorker({
    db,
    maxAttempts: DOC_PROCESS_MAX_ATTEMPTS,
    chunkSizeChars: DOC_CHUNK_SIZE_CHARS,
    overlapChars: DOC_CHUNK_OVERLAP_CHARS,
    maxChunks: DOC_CHUNK_MAX_CHUNKS,
    invalidateRagCacheForTenant: invalidateRagCachesForTenant,
    onJobFinished: ({ status, durationSeconds }) => {
      ragIngestionJobTotal.inc({ status });
      ragIngestionLatency.observe({ status }, durationSeconds);
    },
  });

  void getDocumentProcessingWorkerStatus()
    .then((status) => {
      logger.info({
        running: status.running,
        queueSize: status.queueSize,
        processedCount: status.processedCount,
        failedCount: status.failedCount,
        maxAttempts: DOC_PROCESS_MAX_ATTEMPTS,
        chunkSizeChars: DOC_CHUNK_SIZE_CHARS,
        overlapChars: DOC_CHUNK_OVERLAP_CHARS,
        maxChunks: DOC_CHUNK_MAX_CHUNKS,
      }, 'Document processing worker iniciado e status inicial coletado');
    })
    .catch((error) => {
      logger.warn({ error }, 'Falha ao coletar status inicial do document processing worker');
    });
}

async function reconcileStaleDocumentProcessingDocuments(): Promise<void> {
  if (!isRedisAvailable()) {
    return;
  }

  const staleCutoff = new Date(Date.now() - DOCUMENT_PROCESSING_RECONCILER_STALE_MS);
  const staleDocuments = await db
    .select({
      documentId: schema.documents.id,
      namespaceId: schema.documents.namespaceId,
      tenantId: schema.namespaces.tenantId,
      updatedAt: schema.documents.atualizadoEm,
    })
    .from(schema.documents)
    .leftJoin(schema.namespaces, eq(schema.documents.namespaceId, schema.namespaces.id))
    .where(and(
      eq(schema.documents.processado, false),
      sql`${schema.documents.atualizadoEm} < ${staleCutoff}`,
      sql`(${schema.documents.metadata}->>'processingStatus' = 'pending' OR ${schema.documents.metadata}->>'processingStatus' = 'processing')`
    ))
    .orderBy(asc(schema.documents.atualizadoEm))
    .limit(DOCUMENT_PROCESSING_RECONCILER_BATCH_SIZE);

  if (staleDocuments.length === 0) {
    return;
  }

  logger.info({
    staleDocuments: staleDocuments.length,
    staleCutoff: staleCutoff.toISOString(),
  }, 'Reconciler de documentos identificou itens pendentes/stale');

  for (const staleDocument of staleDocuments) {
    const correlationId = crypto.randomUUID();
    const { documentId, namespaceId, tenantId, updatedAt } = staleDocument;

    if (!documentId || !namespaceId || !tenantId) {
      logger.warn({
        documentId,
        namespaceId,
        tenantId,
        updatedAt,
        correlationId,
      }, 'Reconciler ignorou documento sem namespace/tenant valido');
      continue;
    }

    try {
      const indexedJobId = await getDocumentProcessingJobIdForDocument(documentId);
      if (indexedJobId) {
        continue;
      }

      const jobId = await enqueueDocumentProcessingJob({
        jobId: crypto.randomUUID(),
        tenantId,
        documentId,
        namespaceId,
        priority: 5,
        correlationId,
        attempts: 0,
      }, { force: true });

      logger.info({
        documentId,
        tenantId,
        namespaceId,
        correlationId,
        jobId,
      }, 'Reconciler reenfileirou documento stale sem job ativo');
    } catch (error) {
      logger.error({
        error,
        documentId,
        tenantId,
        namespaceId,
        correlationId,
      }, 'Falha ao reenfileirar documento stale no reconciler');
    }
  }
}

function stopDocumentProcessingReconciler(): void {
  if (documentProcessingReconcilerTimer) {
    clearInterval(documentProcessingReconcilerTimer);
    documentProcessingReconcilerTimer = null;
    logger.info('Reconciler de documentos parado');
  }
}

function startDocumentProcessingReconcilerWhenRedisReady(redisConnected: boolean): void {
  if (!redisConnected) {
    logger.warn('Reconciler de documentos nao iniciado: Redis indisponivel');
    return;
  }
  if (documentProcessingReconcilerTimer) {
    return;
  }

  documentProcessingReconcilerTimer = setInterval(() => {
    void reconcileStaleDocumentProcessingDocuments().catch((error) => {
      logger.error({ error }, 'Falha no ciclo do reconciler de documentos');
    });
  }, DOCUMENT_PROCESSING_RECONCILER_INTERVAL_MS);

  logger.info({
    intervalMs: DOCUMENT_PROCESSING_RECONCILER_INTERVAL_MS,
    staleThresholdMs: DOCUMENT_PROCESSING_RECONCILER_STALE_MS,
    batchSize: DOCUMENT_PROCESSING_RECONCILER_BATCH_SIZE,
  }, 'Reconciler de documentos iniciado');

  void reconcileStaleDocumentProcessingDocuments().catch((error) => {
    logger.error({ error }, 'Falha no bootstrap do reconciler de documentos');
  });
}

// ============================================================================
// QUERY CLASSIFIER - Decidir entre RAG interno vs Web Search
// ============================================================================

type QueryType = 'internal' | 'web' | 'hybrid';

interface ClassificationResult {
  type: QueryType;
  confidence: number;
  reason: string;
  webMode?: 'web' | 'deepweb';
}

const WEB_SEARCH_KEYWORDS = [
  'noticias', 'news', 'atualidades', 'hoje', 'ontem', 'recente',
  'preco', 'cotacao', 'valor atual', 'quanto custa',
  'tempo', 'clima', 'previsao',
  'resultado', 'placar', 'jogo',
  'lancamento', 'novo', 'ultima versao',
  'como fazer', 'tutorial', 'passo a passo',
  'onde encontrar', 'onde comprar', 'onde fica',
  'quem e', 'biografia', 'historia de',
  'btc', 'bitcoin', 'bitcoi', 'eth', 'ethereum',
  'crypto', 'criptomoeda', 'criptomoedas', 'cripto',
  'price', 'quote', 'market cap', 'capitalizacao de mercado', 'mercado crypto',
];

const DEEP_WEB_KEYWORDS = [
  'deep web', 'deepweb', 'dark web', 'darkweb', '.onion', 'onion',
];

const INTERNAL_KEYWORDS = [
  'nosso', 'nossa', 'empresa', 'produto',
  'politica', 'procedimento', 'processo interno',
  'manual', 'documentacao interna', 'wiki',
  'funcionario', 'equipe', 'time',
  'projeto', 'sistema interno', 'ferramenta interna',
  'alice', 'plataforma',
];

function classifyQuery(query: string): ClassificationResult {
  const normalizedQuery = query.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const isDeepWebQuery = DEEP_WEB_KEYWORDS.some((keyword) => normalizedQuery.includes(keyword));

  const webScore = WEB_SEARCH_KEYWORDS.reduce((score, keyword) => {
    return normalizedQuery.includes(keyword) ? score + 1 : score;
  }, 0);

  const internalScore = INTERNAL_KEYWORDS.reduce((score, keyword) => {
    return normalizedQuery.includes(keyword) ? score + 1 : score;
  }, 0);

  const hasCurrentTimeReference = /(?:hoje|agora|atualmente|202\d)/i.test(normalizedQuery);
  const hasPriceOrMarketSignal = /(?:\bcotacao\b|\bpreco\b|\bprice\b|\bquote\b|\bmarket cap\b|\bvalor atual\b|\bquanto custa\b)/i.test(normalizedQuery);
  const hasCryptoSignal = /(?:\bbtc\b|\bbitcoin\b|\bbitcoi\b|\beth\b|\bethereum\b|\bcrypto\b|\bcriptomoeda\b|\bcriptomoedas\b|\bcripto\b)/i.test(normalizedQuery);

  if (isDeepWebQuery) {
    return {
      type: 'web',
      confidence: 0.9,
      reason: 'Query explicitamente solicita deep web (.onion)',
      webMode: 'deepweb',
    };
  }

  if (internalScore > 0 && webScore === 0 && !hasPriceOrMarketSignal && !hasCryptoSignal) {
    return {
      type: 'internal',
      confidence: 0.9,
      reason: 'Query contem referencias a documentos internos',
    };
  }

  if (hasPriceOrMarketSignal || hasCryptoSignal) {
    if (internalScore > 0) {
      return {
        type: 'hybrid',
        confidence: 0.82,
        reason: 'Query de mercado/preco com contexto interno complementar',
      };
    }
    return {
      type: 'web',
      confidence: 0.9,
      reason: 'Query de cotacao/preco/mercado requer dados atualizados da web',
    };
  }

  if (webScore > 0 && internalScore === 0 && hasCurrentTimeReference) {
    return {
      type: 'web',
      confidence: 0.85,
      reason: 'Query requer informacoes atualizadas da web',
    };
  }

  if (webScore > 0 || hasCurrentTimeReference) {
    return {
      type: 'hybrid',
      confidence: 0.7,
      reason: 'Query pode se beneficiar de ambas as fontes',
    };
  }

  return {
    type: 'internal',
    confidence: 0.6,
    reason: 'Consulta padrao para base de conhecimento interna',
  };
}

// SEGURANÇA: Helmet com CSP/HSTS enterprise (Express.js 2025 + OWASP 2023)
app.use(createSecurityMiddleware({
  contentSecurityPolicy: isProduction,
  isDevelopment: !isProduction,
}));

// OBSERVABILITY: Correlation ID middleware para rastreamento distribuído (Node.js 20 LTS 2025)
// Propaga correlation IDs entre microsserviços e injeta nos logs automaticamente
app.use(createCorrelationMiddleware({ serviceName: 'rag-service' }));

// PERFORMANCE: Compression para reduzir tamanho de respostas (Express.js 2025)
app.use(compression());

// NOTA: Helmet já aplicado via createSecurityMiddleware() acima

app.use(cors({
  origin: CORS_ORIGINS.length > 0 ? CORS_ORIGINS : false,
  credentials: CORS_ORIGINS.length > 0,
}));

// SEGURANÇA: Rate limiting multi-tenant (express-rate-limit 2025)
app.use(createRateLimiter({
  windowMs: 60 * 1000,
  max: 50,
  skipRoutes: ['/api/rag/health', '/api/rag/stats'],
  serviceName: 'rag-service',
}));

// SEGURANÇA: Limites de payload para prevenir DoS (OWASP API4)
app.use(express.json({ limit: '10mb' }));

// =============================================================================
// MIDDLEWARE: Autenticação via Cookie de Sessão PostgreSQL
// =============================================================================
// CORREÇÃO PR#107 (10/01/2026): Requisições HTTP precisam de validação de sessão
// REF: CLAUDE.md Regra 7 (Diagnóstico de causa raiz)
// =============================================================================
app.use(createSessionAuthMiddleware({
  pool: getPool(),
  publicPaths: ['/api/rag/health', '/live', '/ready', '/metrics'],
}));

function isRawTextLikeDocumentMime(mimeType: string): boolean {
  return mimeType.startsWith('text/')
    || mimeType === 'application/json'
    || mimeType === 'application/xml'
    || mimeType === 'text/xml'
    || mimeType === 'text/html';
}

async function extractTextFromUploadedDocument(file: Express.Multer.File): Promise<string> {
  if (isRawTextLikeDocumentMime(file.mimetype)) {
    return file.buffer.toString('utf-8');
  }

  const documentProcessor = getDocumentProcessor();
  const result = await documentProcessor.processDocument(
    file.buffer,
    file.mimetype,
    {
      extractMetadata: false,
      generateEmbeddings: false,
    }
  );
  return result.fullText;
}

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

app.get('/api/rag/health', async (_req: Request, res: Response) => {
  const circuitState = gpuManagerEmbeddingsBreaker.opened ? 'open' : (gpuManagerEmbeddingsBreaker.halfOpen ? 'half-open' : 'closed');
  const qdrantStatus = getQdrantCircuitBreakerStatus();
  const redisAvailable = isRedisAvailable();
  let documentProcessingWorker = {
    running: false,
    processedCount: 0,
    failedCount: 0,
    queueSize: 0,
  };

  // Verificar saúde do Qdrant (assíncrono)
  let qdrantHealthy = false;
  if (isQdrantConfigured()) {
    try {
      const qdrantHealth = await qdrantHealthCheck();
      qdrantHealthy = qdrantHealth.healthy;
    } catch {
      qdrantHealthy = false;
    }
  }

  try {
    documentProcessingWorker = await getDocumentProcessingWorkerStatus();
  } catch (error) {
    logger.warn({ error }, 'Falha ao coletar status do document processing worker no health');
  }

  res.json({
    status: 'ok',
    service: 'rag-service',
    timestamp: new Date().toISOString(),
    architecture: {
      text: 'Qwen3-Embedding-0.6B (1024 dim) → Qdrant',
      image: 'OpenAI Vision (descrição) - sem embeddings de imagem',
    },
    embeddingsProvider: {
      text: 'gpu-manager-service',
    },
    qdrant: {
      configured: isQdrantConfigured(),
      healthy: qdrantHealthy,
      collections: {
        text: TEXT_COLLECTION_NAME,
      },
      dimensions: {
        text: TEXT_EMBEDDING_DIM,
      },
      circuitBreaker: qdrantStatus,
    },
    circuitBreaker: {
      state: circuitState,
      stats: {
        failures: gpuManagerEmbeddingsBreaker.stats.failures,
        successes: gpuManagerEmbeddingsBreaker.stats.successes,
        timeouts: gpuManagerEmbeddingsBreaker.stats.timeouts,
      },
    },
    webSearch: {
      enabled: webSearchClient.isEnabled(),
      searxngUrl: SEARXNG_URL,
    },
    redis: {
      available: redisAvailable,
    },
    documentProcessingWorker,
  });
});

app.get('/api/rag/workers/document-processing', requireAuth(), requirePermission('rag:documents:read'), requireSameTenant(getTenantIdFromRequest), async (_req: Request, res: Response) => {
  try {
    const workerStatus = await getDocumentProcessingWorkerStatus();
    return res.json({
      redisAvailable: isRedisAvailable(),
      workerStatus,
    });
  } catch (error) {
    logger.error({ error }, 'Falha ao consultar status do worker de processamento de documentos');
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ============================================================================
// KUBERNETES PROBES: /ready e /live (Regra 16 - Best Practices 2025)
// /live: Processo está vivo? Se não, Kubernetes reinicia o container
// /ready: Pronto para tráfego? Verifica conexão com PostgreSQL e circuit breaker
// ============================================================================

// Liveness probe - verificação simples que o processo responde
app.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({ 
    status: 'alive', 
    service: 'rag-service',
    timestamp: new Date().toISOString(),
  });
});

// Readiness probe - verifica se PostgreSQL e embeddings estão acessíveis
app.get('/ready', async (_req: Request, res: Response) => {
  try {
    const dbHealthy = await isPoolHealthy();
    const embeddingsReady = !gpuManagerEmbeddingsBreaker.opened;
    
    const allReady = dbHealthy && embeddingsReady;
    
    if (allReady) {
      res.status(200).json({
        status: 'ready',
        service: 'rag-service',
        timestamp: new Date().toISOString(),
        dependencies: {
          postgresql: 'ready',
          embeddings: embeddingsReady ? 'ready' : 'circuit_open',
        },
      });
    } else {
      res.status(503).json({
        status: 'not_ready',
        service: 'rag-service',
        reason: !dbHealthy ? 'PostgreSQL não está acessível' : 'Embeddings circuit breaker aberto',
        timestamp: new Date().toISOString(),
        dependencies: {
          postgresql: dbHealthy ? 'ready' : 'not_ready',
          embeddings: embeddingsReady ? 'ready' : 'circuit_open',
        },
      });
    }
  } catch (error) {
    logger.error({ error }, 'Erro ao verificar readiness');
    res.status(503).json({
      status: 'not_ready',
      service: 'rag-service',
      reason: 'Erro ao verificar dependências',
      timestamp: new Date().toISOString(),
    });
  }
});

registerRagDocumentRoutes({
  app,
  db,
  logger,
  parseDocumentProcessingMetadata,
  invalidateRagCachesForTenant,
});

const promoteDocumentToTrainingSchema = z.object({
  maxSamples: z.number().int().min(3).max(100).optional(),
  minChars: z.number().int().min(80).max(4000).optional(),
  scope: z.object({
    namespaceId: z.string().uuid().optional(),
    agentId: z.string().uuid().optional(),
    domain: z.string().min(1).max(120).optional(),
  }).optional(),
  profile: z.object({
    version: z.number().int().min(1).optional(),
    tags: z.array(z.string()).max(20).optional(),
  }).optional(),
});

app.post('/api/rag/documents/:id/send-to-training', requireAuth(), requirePermission('training:training_data:write'), requireSameTenant(getTenantIdFromRequest), async (req: Request, res: Response) => {
  const idValidation = z.object({ id: z.string().uuid('ID inválido') }).safeParse(req.params);
  if (!idValidation.success) {
    return res.status(400).json({ error: 'ID inválido', details: idValidation.error.format() });
  }

  const correlationId = getRequestCorrelationId(req);
  const bodyValidation = promoteDocumentToTrainingSchema.safeParse(req.body ?? {});
  if (!bodyValidation.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: bodyValidation.error.format() });
  }

  const tenantId = req.tenantId;
  if (!tenantId) {
    return res.status(401).json({ error: 'Tenant não identificado' });
  }

  try {
    const documentId = idValidation.data.id;
    const document = await db.query.documents.findFirst({
      where: eq(schema.documents.id, documentId),
      with: { namespace: true },
    });

    if (!document || document.namespace?.tenantId !== tenantId) {
      return res.status(404).json({ error: 'Documento não encontrado para este tenant' });
    }
    if (document.sentToTrainingAt) {
      return res.status(409).json({
        error: 'Documento já enviado para treinamento',
        sentToTrainingAt: document.sentToTrainingAt,
      });
    }
    if (!document.namespaceId) {
      return res.status(422).json({ error: 'Documento sem namespace não pode ser promovido para treinamento' });
    }
    if (!document.processado) {
      return res.status(422).json({ error: 'Documento ainda não foi processado para RAG' });
    }

    const targetNamespaceId = bodyValidation.data.scope?.namespaceId ?? document.namespaceId;

    if (bodyValidation.data.scope?.namespaceId) {
      const targetNamespace = await findNamespaceByIdInTenant(tenantId, bodyValidation.data.scope.namespaceId);
      if (!targetNamespace) {
        return res.status(403).json({ error: 'Namespace de destino não pertence ao tenant' });
      }
    }
    if (bodyValidation.data.scope?.agentId) {
      const targetAgent = await findAgentByIdInTenant(tenantId, bodyValidation.data.scope.agentId);
      if (!targetAgent) {
        return res.status(403).json({ error: 'Agente de destino não pertence ao tenant' });
      }
      if (targetAgent.namespaceId !== targetNamespaceId) {
        return res.status(403).json({ error: 'Agente informado não pertence ao namespace de destino' });
      }
    }

    const chunks = await db.query.documentChunks.findMany({
      where: eq(schema.documentChunks.documentId, documentId),
      orderBy: [asc(schema.documentChunks.posicao)],
    });

    if (chunks.length === 0) {
      return res.status(422).json({ error: 'Documento não possui chunks disponíveis para promoção' });
    }

    const user = getAuthUser(req);
    const result = await collectTrainingFromDocumentChunks({
      tenantId,
      namespaceId: targetNamespaceId,
      agentId: bodyValidation.data.scope?.agentId,
      domain: bodyValidation.data.scope?.domain,
      documentId: document.id,
      titulo: document.titulo,
      chunks: chunks.map((chunk) => ({ id: chunk.id, conteudo: chunk.conteudo, posicao: chunk.posicao })),
      userId: user.userId,
      role: user.role,
      customRoleId: user.customRoleId,
      force: true,
      selection: {
        maxSamples: bodyValidation.data.maxSamples,
        minChars: bodyValidation.data.minChars,
      },
      profile: bodyValidation.data.profile,
    });

    if (result.attempted === 0) {
      return res.status(422).json({
        error: 'Nenhum chunk elegível para treinamento após critérios de qualidade',
      });
    }

    if (result.sent === 0) {
      const firstFailure = result.errors[0];
      const firstFailureMessage = firstFailure
        ? `${firstFailure.status ?? 'network'} - ${firstFailure.error.slice(0, 240)}`
        : 'sem detalhes';
      return res.status(502).json({
        error: `Falha ao enviar chunks para o Training Service (${firstFailureMessage})`,
        data: result,
        failures: result.errors.slice(0, 5),
      });
    }

    await db
      .update(schema.documents)
      .set({ sentToTrainingAt: new Date(), atualizadoEm: new Date() })
      .where(eq(schema.documents.id, document.id));

    logger.info({
      tenantId,
      documentId: document.id,
      attempted: result.attempted,
      sent: result.sent,
      failed: result.failed,
      selectedChunkIds: result.selectedChunkIds,
      correlationId,
    }, 'Documento promovido para treinamento com seleção de chunks relevantes');

    return res.json({
      success: true,
      data: {
        documentId: document.id,
        attempted: result.attempted,
        sent: result.sent,
        failed: result.failed,
      },
      message: `${result.sent} dataset(s) gerado(s) para aprovação na página Training`,
    });
  } catch (error) {
    logger.error({ error, documentId: req.params.id, tenantId, correlationId }, 'Falha ao promover documento para treinamento');
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

const createDocumentSchema = z.object({
  namespaceId: z.string().uuid(),
  titulo: z.string().min(1),
  conteudo: z.string().min(1),
  tipo: z.string().optional(),
  fonte: z.string().optional(),
  urlOrigem: z.string().url().optional(),
});

const updateDocumentSchema = z.object({
  namespaceId: z.string().uuid().optional(),
  titulo: z.string().min(1).optional(),
  conteudo: z.string().min(1).optional(),
  tipo: z.string().optional(),
  fonte: z.string().optional(),
  urlOrigem: z.string().url().optional(),
}).refine(
  (data) => Object.values(data).some((value) => value !== undefined),
  { message: 'Nenhum campo fornecido para atualização' }
);

async function findNamespaceByIdInTenant(tenantId: string, namespaceId: string) {
  return withTenantContext(tenantId, false, (tenantDb) =>
    tenantDb.query.namespaces.findFirst({
      where: eq(schema.namespaces.id, namespaceId),
    })
  );
}

async function findAgentByIdInTenant(tenantId: string, agentId: string) {
  return withTenantContext(tenantId, false, (tenantDb) =>
    tenantDb.query.agents.findFirst({
      where: eq(schema.agents.id, agentId),
    })
  );
}

async function assertNamespaceOwnership(namespaceId: string | undefined, tenantId: string): Promise<void> {
  if (!namespaceId) return;
  const namespace = await findNamespaceByIdInTenant(tenantId, namespaceId);
  if (!namespace) {
    throw new Error('Namespace inválido ou não pertence ao tenant');
  }
}

function parseDocumentProcessingMetadata(metadata: unknown): {
  processingStatus: 'pending' | 'processing' | 'failed' | 'completed';
  processingError: string | null;
  processedAt: string | null;
  chunksCount: number | null;
} {
  const base = toDocumentMetadataObject(metadata);

  const statusFromMetadata = typeof base.processingStatus === 'string'
    ? base.processingStatus
    : undefined;
  const validStatuses = new Set(['pending', 'processing', 'failed', 'completed']);
  const normalizedStatus = validStatuses.has(statusFromMetadata || '')
    ? statusFromMetadata as 'pending' | 'processing' | 'failed' | 'completed'
    : 'pending';

  return {
    processingStatus: normalizedStatus,
    processingError: typeof base.processingError === 'string' ? base.processingError : null,
    processedAt: typeof base.processedAt === 'string' ? base.processedAt : null,
    chunksCount: typeof base.chunksCount === 'number' && Number.isFinite(base.chunksCount)
      ? base.chunksCount
      : null,
  };
}

function toDocumentMetadataObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

function normalizeProcessingQueueError(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const sanitized = rawMessage.replace(/\s+/g, ' ').trim();
  return sanitized.length > 0
    ? sanitized.slice(0, 500)
    : 'Falha ao enfileirar processamento do documento';
}

async function markDocumentQueueFailure(params: {
  documentId: string;
  correlationId: string;
  details: string;
}): Promise<void> {
  const current = await db.query.documents.findFirst({
    where: eq(schema.documents.id, params.documentId),
    columns: { id: true, metadata: true },
  });

  if (!current) {
    return;
  }

  await db.update(schema.documents)
    .set({
      processado: false,
      metadata: {
        ...toDocumentMetadataObject(current.metadata),
        processingStatus: 'failed',
        processingError: params.details,
        correlationId: params.correlationId,
        enqueueFailedAt: new Date().toISOString(),
      },
      atualizadoEm: new Date(),
    })
    .where(eq(schema.documents.id, current.id));
}

app.post('/api/rag/documents', requireAuth(), requirePermission('rag:documents:write'), requireSameTenant(getTenantIdFromRequest), async (req: Request, res: Response) => {
  // SEGURANÇA: Usar req.tenantId populado pelo middleware (RLS Enterprise)
  const tenantId = req.tenantId;
  
  if (!tenantId) {
    return res.status(401).json({ error: 'Tenant não identificado' });
  }

  try {
    const bodyResult = createDocumentSchema.safeParse(req.body);
    if (!bodyResult.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: bodyResult.error.format() });
    }
    const body = bodyResult.data;
    await assertNamespaceOwnership(body.namespaceId, tenantId);

    const hashConteudo = hashContent(body.conteudo);
    
    // MULTI-TENANCY: Verificar duplicação via namespace (documents não tem tenantId direto)
    // Buscar documentos com mesmo hash e verificar se pertencem ao tenant
    const existingDocs = await db.query.documents.findMany({
      with: { namespace: true },
      where: eq(schema.documents.hashConteudo, hashConteudo),
    });
    
    const existing = existingDocs.find(doc => doc.namespace?.tenantId === tenantId);

    if (existing) {
      return res.status(409).json({ 
        error: 'Documento duplicado', 
        existingId: existing.id,
      });
    }

    const correlationId = getRequestCorrelationId(req);
    const [document] = await db.insert(schema.documents).values({
      namespaceId: body.namespaceId,
      titulo: body.titulo,
      conteudo: body.conteudo,
      tipo: body.tipo,
      fonte: body.fonte,
      urlOrigem: body.urlOrigem,
      hashConteudo,
      metadata: {
        sourceType: 'api_create',
        processingStatus: 'pending',
        correlationId,
        createdAt: new Date().toISOString(),
      },
      processado: false,
    }).returning();

    let jobId: string;
    try {
      jobId = await enqueueDocumentProcessingJob({
        jobId: crypto.randomUUID(),
        tenantId,
        documentId: document.id,
        namespaceId: body.namespaceId,
        priority: 5,
        correlationId,
        attempts: 0,
      });
    } catch (enqueueError) {
      const details = normalizeProcessingQueueError(enqueueError);
      try {
        await markDocumentQueueFailure({
          documentId: document.id,
          correlationId,
          details,
        });
      } catch (markFailureError) {
        logger.error({
          error: markFailureError,
          documentId: document.id,
          tenantId,
          correlationId,
        }, 'Falha ao persistir status failed apos erro de enqueue (create)');
      }
      logger.error({
        error: enqueueError,
        documentId: document.id,
        tenantId,
        namespaceId: body.namespaceId,
        correlationId,
      }, 'Falha ao enfileirar processamento de documento criado via API');
      return res.status(503).json({
        documentId: document.id,
        error: 'Falha ao enfileirar processamento',
        details,
      });
    }

    logger.info({
      documentId: document.id,
      tenantId,
      namespaceId: body.namespaceId ?? null,
      correlationId,
      jobId,
    }, 'Documento criado e enfileirado para processamento assíncrono');

    res.status(202).json({
      documentId: document.id,
      jobId,
    });
  } catch (error) {
    logger.error({ error, tenantId, correlationId: getRequestCorrelationId(req) }, 'Falha ao criar documento');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.patch('/api/rag/documents/:id', requireAuth(), requirePermission('rag:documents:write'), requireSameTenant(getTenantIdFromRequest), async (req: Request, res: Response) => {
  const paramsResult = uuidParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID inválido', details: paramsResult.error.format() });
  }
  const { id } = paramsResult.data;
  const tenantId = req.tenantId;
  if (!tenantId) {
    return res.status(401).json({ error: 'Tenant obrigatório' });
  }

  try {
    const body = updateDocumentSchema.parse(req.body);

    const existing = await db.query.documents.findFirst({
      where: eq(schema.documents.id, id),
      with: { namespace: true },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Documento não encontrado' });
    }

    const user = getAuthUser(req);
    const isSuperAdmin = user.role === 'super_admin';

    if (existing.namespace) {
      if (existing.namespace.tenantId !== tenantId) {
        return res.status(403).json({ error: 'Acesso negado: documento não pertence ao tenant' });
      }
    } else if (!existing.namespaceId) {
      if (!isSuperAdmin) {
        return res.status(403).json({ error: 'Documento sem namespace não pode ser atualizado por este usuário' });
      }
      if (!body.namespaceId) {
        return res.status(400).json({
          error: 'Documento sem namespace. Informe namespaceId para atualizar.',
        });
      }
    } else if (body.namespaceId && body.namespaceId !== existing.namespaceId && !isSuperAdmin) {
      return res.status(403).json({ error: 'Acesso negado: não é permitido alterar o namespace do documento' });
    }

    const resolvedNamespaceId = body.namespaceId ?? existing.namespaceId ?? undefined;
    await assertNamespaceOwnership(resolvedNamespaceId, tenantId);

    const conteudo = body.conteudo ?? existing.conteudo ?? '';
    if (!conteudo || conteudo.trim().length === 0) {
      return res.status(400).json({ error: 'Conteúdo do documento é obrigatório' });
    }

    const correlationId = getRequestCorrelationId(req);
    const titulo = body.titulo ?? existing.titulo;
    const tipo = body.tipo ?? existing.tipo ?? undefined;
    const fonte = body.fonte ?? existing.fonte ?? undefined;
    const urlOrigem = body.urlOrigem ?? existing.urlOrigem ?? undefined;
    const hashConteudo = hashContent(conteudo);
    const metadataBase = toDocumentMetadataObject(existing.metadata);
    const processingRequestedAt = new Date().toISOString();

    if (!resolvedNamespaceId) {
      return res.status(422).json({ error: 'Documento sem namespace nao pode ser processado' });
    }

    await db.update(schema.documents)
      .set({
        namespaceId: resolvedNamespaceId,
        titulo,
        conteudo,
        tipo,
        fonte,
        urlOrigem,
        hashConteudo,
        processado: false,
        metadata: {
          ...metadataBase,
          processingStatus: 'pending',
          processingError: null,
          processingRequestedAt,
          correlationId,
        },
        atualizadoEm: new Date(),
      })
      .where(eq(schema.documents.id, id));

    let jobId: string;
    try {
      jobId = await enqueueDocumentProcessingJob({
        jobId: crypto.randomUUID(),
        tenantId,
        documentId: id,
        namespaceId: resolvedNamespaceId,
        priority: 5,
        correlationId,
        attempts: 0,
      }, { force: true });
    } catch (enqueueError) {
      const details = normalizeProcessingQueueError(enqueueError);
      try {
        await markDocumentQueueFailure({
          documentId: id,
          correlationId,
          details,
        });
      } catch (markFailureError) {
        logger.error({
          error: markFailureError,
          documentId: id,
          tenantId,
          correlationId,
        }, 'Falha ao persistir status failed apos erro de enqueue (patch)');
      }
      logger.error({
        error: enqueueError,
        documentId: id,
        tenantId,
        namespaceId: resolvedNamespaceId,
        correlationId,
      }, 'Falha ao enfileirar processamento de documento atualizado');
      return res.status(503).json({
        documentId: id,
        error: 'Falha ao enfileirar processamento',
        details,
      });
    }

    return res.status(202).json({
      documentId: id,
      jobId,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro interno do servidor';
    logger.error({ error, documentId: id, tenantId, correlationId: getRequestCorrelationId(req) }, 'Falha ao atualizar documento');
    res.status(500).json({ error: errorMessage });
  }
});

app.post('/api/rag/documents/upload', requireAuth(), requirePermission('rag:documents:upload'), requireSameTenant(getTenantIdFromRequest), upload.single('file'), async (req: MulterRequest, res: Response) => {
  // SEGURANÇA: Usar req.tenantId populado pelo middleware (RLS Enterprise)
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  }
  if (!req.tenantId) {
    return res.status(401).json({ error: 'Tenant não identificado' });
  }

  // Validação de segurança enterprise unificada (Regra 16)
  const validation = validateDocumentUpload(req.file);
  if (!validation.valid) {
    logger.warn({ 
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      error: validation.error,
      correlationId: getRequestCorrelationId(req),
    }, 'Upload de documento rejeitado por validação de segurança');
    return res.status(400).json({ error: validation.error });
  }

  try {
    const content = (await extractTextFromUploadedDocument(req.file)).trim();
    if (!content) {
      return res.status(400).json({ error: 'Não foi possível extrair texto útil do documento enviado' });
    }
    const titulo = req.body.titulo || req.file.originalname;
    const namespaceId = req.body.namespaceId;
    if (!namespaceId) {
      return res.status(400).json({ error: 'Namespace obrigatório' });
    }
    await assertNamespaceOwnership(namespaceId, req.tenantId);

    const hashConteudo = hashContent(content);
    const correlationId = getRequestCorrelationId(req);
    const user = getAuthUser(req);

    // MULTI-TENANCY: Documento associado ao tenant via namespaceId
    // namespaceId deve pertencer ao tenant do usuário (validado pelo backend)
    // Gate 2: Embeddings de TEXTO são SSOT no Qdrant (PostgreSQL mantém apenas conteúdo/metadados).
    const [document] = await db.insert(schema.documents).values({
      namespaceId,
      titulo,
      conteudo: content,
      tipo: req.file.mimetype,
      hashConteudo,
      metadata: {
        sourceType: 'ui_upload',
        originalFilename: req.file.originalname,
        mimeType: req.file.mimetype,
        fileSize: req.file.size,
        uploadedAt: new Date().toISOString(),
        uploadedByUserId: user.userId ?? null,
        correlationId,
        processingStatus: 'pending',
      },
      processado: false,
    }).returning();

    let jobId: string;
    try {
      jobId = await enqueueDocumentProcessingJob({
        jobId: crypto.randomUUID(),
        tenantId: req.tenantId,
        documentId: document.id,
        namespaceId,
        priority: 5,
        correlationId,
        attempts: 0,
      });
    } catch (enqueueError) {
      const details = normalizeProcessingQueueError(enqueueError);
      try {
        await markDocumentQueueFailure({
          documentId: document.id,
          correlationId,
          details,
        });
      } catch (markFailureError) {
        logger.error({
          error: markFailureError,
          documentId: document.id,
          tenantId: req.tenantId,
          correlationId,
        }, 'Falha ao persistir status failed apos erro de enqueue (upload)');
      }
      logger.error({
        error: enqueueError,
        documentId: document.id,
        tenantId: req.tenantId,
        namespaceId,
        filename: req.file?.originalname,
        correlationId,
      }, 'Falha ao enfileirar processamento de documento enviado por upload');
      return res.status(503).json({
        documentId: document.id,
        error: 'Falha ao enfileirar processamento',
        details,
      });
    }

    logger.info({
      documentId: document.id,
      tenantId: req.tenantId,
      namespaceId,
      filename: req.file?.originalname,
      correlationId,
      jobId,
    }, 'Arquivo enviado e enfileirado para processamento assíncrono');

    res.status(202).json({
      documentId: document.id,
      jobId,
      status: 'queued',
    });
  } catch (error) {
    logger.error({ error, tenantId: req.tenantId, correlationId: getRequestCorrelationId(req) }, 'Falha ao enviar documento');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

const searchSchema = z.object({
  query: z.string().min(1),
  namespaceId: z.string().uuid().optional(),
  limit: z.coerce.number().min(1).max(20).default(5),
  threshold: z.coerce.number().min(0).max(1).default(0.7),
});

app.post('/api/rag/search', requireAuth(), requirePermission('rag:documents:read'), requireSameTenant(getTenantIdFromRequest), async (req: Request, res: Response) => {
  // SEGURANÇA: Usar req.tenantId populado pelo middleware (RLS Enterprise)
  // CORREÇÃO 18/12/2025: Validar que tenantId existe após middleware
  const tenantId = req.tenantId;
  if (!tenantId) {
    return res.status(401).json({ error: 'Tenant não identificado' });
  }
  
  try {
    const body = searchSchema.parse(req.body);
    const startNs = process.hrtime.bigint();

    // Cache distribuído (Redis) - evita recalcular embeddings/busca para queries repetidas
    const searchCacheKey = buildRagCacheKey({
      endpoint: 'search',
      tenantId,
      query: body.query,
      namespaceId: body.namespaceId,
      limit: body.limit,
      threshold: body.threshold,
    });

    if (ragSearchCache) {
      const cached = await ragSearchCache.get(searchCacheKey);
      if (cached) {
        metrics.rag.cacheHitsTotal.inc({ endpoint: 'search' });
        metrics.rag.queriesTotal.inc({ tenant_id: tenantId, result: 'success' });
        return res.json(cached);
      }
      metrics.rag.cacheMissesTotal.inc({ endpoint: 'search' });
    }

    // ============================================================================
    // BUSCA VETORIAL VIA QDRANT (Enterprise-Grade - 17/12/2025)
    // ============================================================================
    // Gate 2: Embeddings de texto com Qwen3-Embedding-0.6B (1024 dim) → Qdrant
    // PERFORMANCE: Índice HNSW otimizado (dim=1024)
    // MULTI-TENANCY: Filtro via payload (tenantId) no Qdrant
    // ============================================================================

    // Verificar se Qdrant está configurado
    if (!isQdrantConfigured()) {
      logger.error('Qdrant não configurado - busca de texto indisponível');
      return res.status(503).json({ 
        error: 'Serviço de busca indisponível',
        details: 'Qdrant não configurado. Verifique QDRANT_URL e QDRANT_API_KEY.',
      });
    }

    // Gerar embedding da query (1024 dim via Qwen3-Embedding-0.6B)
    const queryEmbedding = await generateEmbedding(body.query);
    
    // Buscar documentos similares via Qdrant
    const results = await searchDocumentsInQdrant(queryEmbedding, tenantId, {
      limit: body.limit,
      threshold: body.threshold,
      namespaceId: body.namespaceId,
      queryText: body.query,
    });

    logger.info({ query: body.query, results: results.length, storage: 'qdrant' }, 'Busca concluída via Qdrant');
    // Observabilidade RAG: latência e relevância média (modelo-agnóstico)
    metrics.rag.searchDuration.observe({ tenant_id: tenantId }, Number(process.hrtime.bigint() - startNs) / 1e9);
    metrics.rag.effectiveK.observe({ endpoint: 'search' }, results.length);
    if (results.length > 0) {
      const avg = results.reduce((acc, r) => acc + r.similarity, 0) / results.length;
      metrics.rag.relevanceScore.set({ tenant_id: tenantId }, avg);
    }
    metrics.rag.queriesTotal.inc({ tenant_id: tenantId, result: 'success' });

    const response: RagSearchResponse = { results };
    if (ragSearchCache) {
      await ragSearchCache.set(searchCacheKey, response, RAG_QUERY_CACHE_TTL_MS);
    }

    res.json(response);
  } catch (error) {
    logger.error({ error }, 'Falha na busca');
    const tenantId = req.tenantId;
    if (tenantId) {
      metrics.rag.queriesTotal.inc({ tenant_id: tenantId, result: 'error' });
    }
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.post('/api/rag/context', requireAuth(), requirePermission('rag:documents:read'), requireSameTenant(getTenantIdFromRequest), async (req: Request, res: Response) => {
  // SEGURANÇA ENTERPRISE (17/12/2025): Multi-tenancy obrigatório
  // - requirePermission: Verifica se usuário tem permissão para leitura
  // - requireSameTenant: Valida tenant_id do request (RLS enterprise)
  // - Sem fallback para 'default' (OWASP API1 - Broken Object Level Authorization)
  // CORREÇÃO 18/12/2025: Validar que tenantId existe após middleware
  const tenantId = req.tenantId;
  if (!tenantId) {
    return res.status(401).json({ error: 'Tenant não identificado' });
  }

  try {
    const body = searchSchema.parse(req.body);
    const startNs = process.hrtime.bigint();

    // Cache distribuído (Redis) - evita recalcular embeddings/busca para queries repetidas
    const contextCacheKey = buildRagCacheKey({
      endpoint: 'context',
      tenantId,
      query: body.query,
      namespaceId: body.namespaceId,
      limit: body.limit,
      threshold: body.threshold,
    });

    if (ragContextCache) {
      const cached = await ragContextCache.get(contextCacheKey);
      if (cached) {
        metrics.rag.cacheHitsTotal.inc({ endpoint: 'context' });
        metrics.rag.queriesTotal.inc({ tenant_id: tenantId, result: 'success' });
        return res.json(cached);
      }
      metrics.rag.cacheMissesTotal.inc({ endpoint: 'context' });
    }

    // ============================================================================
    // BUSCA VETORIAL VIA QDRANT (Enterprise-Grade - 17/12/2025)
    // ============================================================================
    // Gate 2: Embeddings de texto com Qwen3-Embedding-0.6B (1024 dim) → Qdrant
    // PERFORMANCE: Índice HNSW otimizado (dim=1024)
    // SEGURANÇA: tenantId validado pelo middleware (sem fallback para 'default')
    // ============================================================================

    // Verificar se Qdrant está configurado
    if (!isQdrantConfigured()) {
      logger.error('Qdrant não configurado - contexto indisponível');
      return res.status(503).json({ 
        error: 'Serviço de contexto indisponível',
        details: 'Qdrant não configurado. Verifique QDRANT_URL e QDRANT_API_KEY.',
      });
    }

    // Gerar embedding da query (1024 dim via Qwen3-Embedding-0.6B)
    const queryEmbedding = await generateEmbedding(body.query);
    
    // Buscar documentos similares via Qdrant (tenantId validado pelo middleware)
    const results = await searchDocumentsInQdrant(queryEmbedding, tenantId, {
      limit: body.limit,
      threshold: body.threshold,
      namespaceId: body.namespaceId,
      queryText: body.query,
    });

    // Construir contexto formatado
    const context = results
      .map(r => `[Fonte: ${r.document?.titulo || 'Desconhecido'}]\n${r.conteudo}`)
      .join('\n\n---\n\n');
    
    const response: RagContextResponse = {
      context,
      sources: results.map(r => ({
        documentId: r.documentId,
        titulo: r.document?.titulo || null,
        similarity: r.similarity,
      })),
    };

    if (ragContextCache) {
      await ragContextCache.set(contextCacheKey, response, RAG_QUERY_CACHE_TTL_MS);
    }

    res.json(response);

    // Observabilidade RAG: latência e relevância média (modelo-agnóstico)
    metrics.rag.searchDuration.observe({ tenant_id: tenantId }, Number(process.hrtime.bigint() - startNs) / 1e9);
    metrics.rag.effectiveK.observe({ endpoint: 'context' }, results.length);
    if (results.length > 0) {
      const avg = results.reduce((acc, r) => acc + r.similarity, 0) / results.length;
      metrics.rag.relevanceScore.set({ tenant_id: tenantId }, avg);
    }
    metrics.rag.queriesTotal.inc({ tenant_id: tenantId, result: 'success' });
  } catch (error) {
    logger.error({ error }, 'Falha ao gerar contexto');
    const tenantId = req.tenantId;
    if (tenantId) {
      metrics.rag.queriesTotal.inc({ tenant_id: tenantId, result: 'error' });
    }
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// OWASP API3 - Schema para validação de parâmetros de rota (UUID)
const uuidParamSchema = z.object({
  id: z.string().uuid('ID deve ser um UUID válido'),
});

registerRagRetrievalRoutes({
  app,
  logger,
  webSearchClient,
  webSearch,
  classifyQuery,
  isQdrantConfigured,
  generateEmbedding,
  searchDocumentsForContext,
  gpuManagerEmbeddingsBreaker,
  webSearchKeywordCount: WEB_SEARCH_KEYWORDS.length,
  internalKeywordCount: INTERNAL_KEYWORDS.length,
});

// ============================================================================
// LEARNING ORCHESTRATOR - Fila priorizada com RLS
// ============================================================================

registerRagLearningRoutes({
  app,
  logger,
  metrics,
});

// ============================================================================
// MULTIMODAL UPLOAD - Fase 9
// ============================================================================

const mediaUploadSchema = z.object({
  conversationId: z.string().uuid().optional(),
  messageId: z.string().uuid().optional(),
  description: z.string().optional(),
  namespaceId: z.string().uuid().optional(),
});

app.post('/api/media/upload', requireAuth(), requireSameTenant(getTenantIdFromRequest), mediaUpload.single('file'), async (req: MulterRequest, res: Response) => {
  // SEGURANÇA: Usar req.tenantId e req.user populados pelo middleware
  const tenantId = req.tenantId;
  const userId = req.user?.userId;
  const startTime = Date.now();

  if (!tenantId) {
    return res.status(401).json({ error: 'Autenticação necessária' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  }

  // Validação de segurança enterprise (Regra 16)
  const validation = validateUpload(req.file);
  if (!validation.valid) {
    logger.warn({ 
      tenantId, 
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      error: validation.error,
    }, 'Upload rejeitado por validação de segurança');
    return res.status(400).json({ error: validation.error });
  }

  try {
    const body = mediaUploadSchema.safeParse(req.body);
    const metadata = body.success ? body.data : {};

    if (metadata.namespaceId) {
      await assertNamespaceOwnership(metadata.namespaceId, tenantId);
    }

    const mediaType = detectMediaType(req.file.mimetype);
    if (!mediaType) {
      return res.status(400).json({ 
        error: 'Tipo de mídia não suportado',
        mimeType: req.file.mimetype,
        supportedTypes: ALL_SUPPORTED_MIMES,
      });
    }

    // Enforce limite por tipo (Enterprise): multer limit é global, então validamos aqui por mediaType.
    const maxSize = FILE_SIZE_LIMITS_BYTES[mediaType];
    if (!maxSize) {
      // Impossível em runtime (MediaType é fechado), mas mantém fail-fast defensivo.
      logger.error({ tenantId, mediaType }, 'mediaType inválido para FILE_SIZE_LIMITS_BYTES');
      return res.status(400).json({ error: 'Tipo de mídia inválido' });
    }
    if (req.file.size > maxSize) {
      return res.status(400).json({
        error: 'Arquivo muito grande',
        mediaType,
        maxSizeMb: Math.round(maxSize / 1024 / 1024),
        receivedSizeMb: Math.round(req.file.size / 1024 / 1024),
      });
    }

    // Gerar hash único para o arquivo
    const fileHash = crypto.createHash('sha256').update(new Uint8Array(req.file.buffer)).digest('hex');
    
    // Verificar duplicatas no mesmo tenant
    const existingMedia = await db.query.mediaUploads.findFirst({
      where: and(
        eq(schema.mediaUploads.tenantId, tenantId),
        sql`extracted_metadata->>'fileHash' = ${fileHash}`
      ),
    });

    if (existingMedia) {
      logger.info({ 
        tenantId, 
        existingId: existingMedia.id,
        filename: req.file.originalname,
      }, 'Upload duplicado detectado');
      
      return res.status(200).json({ 
        upload: existingMedia,
        duplicate: true,
        message: 'Arquivo já foi enviado anteriormente',
      });
    }

    // Salvar arquivo no storage
    const storageService = getStorageService();
    const storedFile = await storageService.saveFile(req.file.buffer, {
      tenantId,
      mediaType,
      originalFilename: req.file.originalname,
      mimeType: req.file.mimetype,
    });

    // Criar registro de upload (status: pending)
    const [mediaUploadRecord] = await db.insert(schema.mediaUploads).values({
      tenantId,
      userId: userId || null,
      conversationId: metadata.conversationId || null,
      messageId: metadata.messageId || null,
      namespaceId: metadata.namespaceId || null,
      mediaType,
      originalFilename: req.file.originalname,
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
      filePath: storedFile.filePath,
      fileUrl: storedFile.fileUrl,
      processingStatus: 'pending',
      extractedMetadata: {
        fileHash,
        uploadedAt: new Date().toISOString(),
        description: metadata.description,
      },
    }).returning();

    logger.info({ 
      uploadId: mediaUploadRecord.id,
      tenantId,
      mediaType,
      filename: req.file.originalname,
      fileSize: req.file.size,
      filePath: storedFile.filePath,
      processingTimeMs: Date.now() - startTime,
    }, 'Upload de mídia salvo e registrado');

    // Processar mídia de forma assíncrona (não bloqueia a resposta)
    const processMediaAsync = async () => {
      try {
        if (mediaType === 'image') {
          // Processar imagem com OpenAI Vision (sem GPU para imagens)
          const imageProcessor = getImageProcessor();
          const result = await imageProcessor.processImage(
            req.file!.buffer,
            req.file!.mimetype
          );

          // Se thumbnail foi gerado, salvar no storage
          let thumbnailPath: string | null = null;
          let thumbnailUrl: string | null = null;

          if (result.thumbnailBuffer) {
            const storageService = getStorageService();
            const thumbStored = await storageService.saveFile(result.thumbnailBuffer, {
              tenantId,
              mediaType: 'image', // Usar 'image' para thumbnails (tipo válido do enum)
              originalFilename: `thumb_${req.file!.originalname}`,
              mimeType: result.thumbnailMimeType || 'image/jpeg',
            });
            thumbnailPath = thumbStored.filePath;
            thumbnailUrl = thumbStored.fileUrl;
          }

          const visionDescription = result.visionDescription?.trim() || null;
          const visionModel = result.visionModel ?? null;

          // Gate 2: Embedding da descrição textual (OpenAI Vision) → Qdrant
          // Simetria enterprise: documento texto + transcrição áudio + descrição imagem → mesmo espaço vetorial
          if (visionDescription && visionDescription.length > 0 && isQdrantConfigured()) {
            const descriptionEmbedding = await generateEmbedding(visionDescription.slice(0, 8000));
            validateEmbeddingDimension(descriptionEmbedding, EMBEDDING_DIMENSIONS.TEXT, 'TEXT');
            await upsertPoints(TEXT_COLLECTION_NAME, [{
              id: mediaUploadRecord.id,
              vector: descriptionEmbedding,
              payload: {
                type: 'media_image',
                mediaUploadId: mediaUploadRecord.id,
                mediaType: 'image',
                tenantId: req.tenantId,
                ...(mediaUploadRecord.namespaceId ? { namespaceId: mediaUploadRecord.namespaceId } : {}),
                visionDescription: visionDescription.slice(0, 10000),
                embeddingModel: visionModel ?? 'OpenAI-Vision',
                criadoEm: new Date().toISOString(),
              },
            }]);
            logger.debug({ uploadId: mediaUploadRecord.id }, 'Embedding de descrição de imagem inserido no Qdrant');
          }

          // Atualizar registro com thumbnail, descrição e metadata
          await db.update(schema.mediaUploads)
            .set({
              processingStatus: 'completed',
              extractedMetadata: {
                ...mediaUploadRecord.extractedMetadata as object,
                ...result.metadata,
                visionDescription,
                visionModel,
                hasThumbnail: !!thumbnailPath,
                thumbnailPath, // Armazenar em metadata (não há coluna no schema)
                thumbnailUrl,  // Armazenar em metadata (não há coluna no schema)
                processingTimeMs: result.processingTimeMs,
              },
              llmDescription: visionDescription,
            })
            .where(eq(schema.mediaUploads.id, mediaUploadRecord.id));

          logger.info({
            uploadId: mediaUploadRecord.id,
            visionModel,
            hasThumbnail: !!thumbnailPath,
          }, 'Imagem processada com sucesso');

        } else if (mediaType === 'audio') {
          // Processar áudio com ASR OpenAI
          const audioProcessor = getAudioProcessor();
          const result = await audioProcessor.processAudio(
            req.file!.buffer,
            req.file!.mimetype
          );

          // Validar dimensão de texto antes de salvar (Enterprise-Grade - Regra 6)
          if (result.embedding.length > 0) {
            validateEmbeddingDimension(result.embedding, EMBEDDING_DIMENSIONS.TEXT, 'TEXT');
          }
          
          // Gate 2: Embeddings de texto são SSOT no Qdrant (PostgreSQL mantém apenas transcrição/metadados)
          if (result.embedding.length > 0 && isQdrantConfigured()) {
            const qdrantPointId = mediaUploadRecord.id;
            await upsertPoints(TEXT_COLLECTION_NAME, [{
              id: qdrantPointId,
              vector: result.embedding,
              payload: {
                type: 'media_audio',
                mediaUploadId: mediaUploadRecord.id,
                mediaType: 'audio',
                tenantId: req.tenantId,
                ...(mediaUploadRecord.namespaceId ? { namespaceId: mediaUploadRecord.namespaceId } : {}),
                transcription: result.transcription.slice(0, 10000), // Limitar para payload
                transcriptionLanguage: result.transcriptionLanguage,
                embeddingModel: result.embeddingModel,
                criadoEm: new Date().toISOString(),
              },
            }]);
            logger.debug({ uploadId: mediaUploadRecord.id }, 'Embedding de áudio inserido no Qdrant');
          }
          
          // Atualizar registro com transcrição e metadata (SEM embedding - vai para Qdrant)
          await db.update(schema.mediaUploads)
            .set({
              processingStatus: 'completed',
              transcription: result.transcription,
              transcriptionLanguage: result.transcriptionLanguage,
              transcriptionConfidence: result.transcriptionConfidence,
              // textEmbedding OMITIDO - texto vai para Qdrant (SSOT)
              extractedMetadata: {
                ...mediaUploadRecord.extractedMetadata as object,
                ...result.metadata,
                embeddingModel: result.embeddingModel,
                processingTimeMs: result.processingTimeMs,
                // CORREÇÃO 17/12/2025: qdrantPointId só é definido se Qdrant está configurado
                // (condição deve coincidir com a do upsert para evitar referência a ponto inexistente)
                qdrantPointId: result.embedding.length > 0 && isQdrantConfigured() ? mediaUploadRecord.id : null,
              },
            })
            .where(eq(schema.mediaUploads.id, mediaUploadRecord.id));

          logger.info({
            uploadId: mediaUploadRecord.id,
            transcriptionLength: result.transcription.length,
            language: result.transcriptionLanguage,
            embeddingDim: result.embedding.length,
            qdrantConfigured: isQdrantConfigured(),
          }, 'Áudio processado com sucesso');
        // REMOVIDO 23/12/2025: Processamento de vídeo desabilitado (muito pesado para GPU)
        // Plataforma suporta apenas: texto, áudio e imagem
        } else if (mediaType === 'document') {
          // Processar documento: extrai texto e gera embeddings
          const documentProcessor = getDocumentProcessor();
          
          // Prontidão REAL: document depende de embeddings GPU (GPU Manager Service)
          // Evita falso-positivo de "ready" quando a dependência está indisponível.
          if (!(await documentProcessor.isReadyAsync())) {
            throw new Error(
              'Document Processor não está pronto. Verifique conectividade com GPU Manager Service.'
            );
          }
          
          const result = await documentProcessor.processDocument(
            req.file!.buffer,
            req.file!.mimetype,
            { extractMetadata: true, generateEmbeddings: true }
          );

          // IMPORTANTE: no document-processor, `combinedEmbedding` é a MÉDIA dos embeddings de TEXTO
          // (Qwen3-Embedding-0.6B GPU, 1024 dim → Qdrant). Portanto, a validação correta aqui é `TEXT`.
          // (Enterprise-Grade - Regra 6)
          // 
          // Regra 6: Validar que combinedEmbedding não está vazio antes de persistir.
          // Se estiver vazio, persistir como NULL (não como array vazio).
          if (result.combinedEmbedding.length > 0) {
            validateEmbeddingDimension(result.combinedEmbedding, EMBEDDING_DIMENSIONS.TEXT, 'TEXT');
          } else {
            // Regra 6 (Fail-fast): isso não é um estado válido para "sucesso" quando generateEmbeddings=true.
            // Rejeitar para que o upload seja marcado como failed e não gere dados inconsistentes.
            throw new Error('combinedEmbedding vazio recebido do document-processor (estado inválido)');
          }
          
          // Atualizar registro com embedding combinado e texto extraído
          // Regra 6: Sempre persistir NULL se combinedEmbedding estiver vazio (não array vazio)
          await db.update(schema.mediaUploads)
            .set({
              processingStatus: 'completed',
              transcription: result.fullText.slice(0, 65000), // Limitar tamanho para o banco
              textEmbedding: result.combinedEmbedding.length > 0 ? result.combinedEmbedding : null,
              extractedMetadata: {
                ...mediaUploadRecord.extractedMetadata as object,
                ...result.metadata,
                embeddingModel: result.embeddingModel,
                chunksCount: result.chunks.length,
                processingTimeMs: result.processingTimeMs,
              },
            })
            .where(eq(schema.mediaUploads.id, mediaUploadRecord.id));

          logger.info({
            uploadId: mediaUploadRecord.id,
            format: result.metadata.format,
            pageCount: result.metadata.pageCount,
            wordCount: result.metadata.wordCount,
            chunksCount: result.chunks.length,
            embeddingDim: result.combinedEmbedding.length,
          }, 'Documento processado com sucesso');
        } else {
          // Tipo de mídia não suportado
          logger.warn({ uploadId: mediaUploadRecord.id, mediaType }, 'Tipo de mídia não suportado para processamento');
          
          await db.update(schema.mediaUploads)
            .set({ 
              processingStatus: 'failed',
              extractedMetadata: {
                ...mediaUploadRecord.extractedMetadata as object,
                processingError: `Tipo de mídia não suportado: ${mediaType}`,
              },
            })
            .where(eq(schema.mediaUploads.id, mediaUploadRecord.id));
        }
      } catch (error) {
        logger.error({ error, uploadId: mediaUploadRecord.id }, 'Erro ao processar mídia');
        
        // Marcar como falha
        await db.update(schema.mediaUploads)
          .set({ 
            processingStatus: 'failed',
            extractedMetadata: {
              ...mediaUploadRecord.extractedMetadata as object,
              processingError: String(error),
            },
          })
          .where(eq(schema.mediaUploads.id, mediaUploadRecord.id));
      }
    };

    // Iniciar processamento assíncrono (fire and forget)
    processMediaAsync().catch(err => {
      logger.error({ error: err }, 'Erro no processamento assíncrono');
    });

    // Determinar mensagem e features baseado no tipo de mídia
    const processingInfo: Record<string, { message: string; features: string[] }> = {
      image: {
        message: 'Upload recebido. Processamento OpenAI iniciado.',
        features: ['OpenAI Vision (descrição)', 'thumbnail'],
      },
      audio: {
        message: 'Upload recebido. Transcrição OpenAI iniciada.',
        features: ['OpenAI ASR (gpt-4o-transcribe)', 'Qwen3-Embedding-0.6B (1024 dim GPU → Qdrant)', 'metadata extraction'],
      },
      // REMOVIDO 23/12/2025: video desabilitado (muito pesado para GPU)
      document: {
        message: 'Upload recebido. Processamento pendente.',
        features: ['Text extraction (pendente)', 'Qwen3-Embedding-0.6B (1024 dim GPU → Qdrant) (pendente)'],
      },
    };

    const info = processingInfo[mediaType] || { 
      message: 'Upload recebido.', 
      features: [] 
    };

    res.status(201).json({ 
      upload: mediaUploadRecord,
      message: info.message,
      processing: {
        status: 'started',
        type: mediaType,
        features: info.features,
      },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    if (errMsg.includes('Namespace inválido')) {
      return res.status(403).json({ error: errMsg });
    }
    logger.error({
      error,
      tenantId,
      filename: req.file?.originalname,
    }, 'Falha no upload de mídia');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ============================================================================
// UPLOAD VIA JSON (base64) - Para integração WebSocket
// ============================================================================

const jsonUploadSchema = z.object({
  file: z.string().min(1), // base64
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  conversationId: z.string().uuid().optional(),
  messageId: z.string().uuid().optional(),
  description: z.string().optional(),
  namespaceId: z.string().uuid().optional(),
});

// ============================================================================
// OWASP API3 - Schemas Zod para validação de query params
// Previne type coercion issues e input tampering
// ============================================================================

// Schema para query params de paginação com filtros de mídia
// Plano RAG Multimodal Enterprise Fase 2: namespaceId para isolamento RAG/treinamento
const mediaUploadsQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/).transform(Number).refine(n => n >= 1 && n <= 100, 'limit deve ser entre 1 e 100').optional(),
  offset: z.string().regex(/^\d+$/).transform(Number).refine(n => n >= 0, 'offset deve ser >= 0').optional(),
  // ATUALIZADO 23/12/2025: Removido 'video' (muito pesado para GPU)
  mediaType: z.enum(['image', 'audio', 'document']).optional(),
  conversationId: z.string().uuid().optional(),
  namespaceId: z.string().uuid().optional(),
});

app.post('/api/media/upload/json', requireAuth(), requireSameTenant(getTenantIdFromRequest), async (req: Request, res: Response) => {
  // SEGURANÇA: Usar req.tenantId e req.user populados pelo middleware
  const tenantId = req.tenantId;
  const userId = req.user?.userId;
  const startTime = Date.now();

  if (!tenantId) {
    return res.status(401).json({ error: 'Autenticação necessária' });
  }

  try {
    const body = jsonUploadSchema.parse(req.body);

    if (body.namespaceId) {
      await assertNamespaceOwnership(body.namespaceId, tenantId);
    }

    // Decodificar base64 para Buffer
    const fileBuffer = Buffer.from(body.file, 'base64');
    const fileSize = fileBuffer.length;
    
    // BUG FIX 23/12/2025: Detectar tipo de mídia ANTES de validar tamanho
    // Limites são diferentes por tipo: 10MB para imagens, 25MB para áudio
    // Limite hardcoded de 100MB (vídeo) foi removido após remoção de suporte a vídeo
    const mediaType = detectMediaType(body.mimeType);
    if (!mediaType) {
      return res.status(400).json({ 
        error: 'Tipo de mídia não suportado',
        mimeType: body.mimeType,
        supportedTypes: ALL_SUPPORTED_MIMES,
      });
    }
    
    // Limites por tipo de mídia (consistente com /api/media/upload e /api/media/health)
    const maxSize = FILE_SIZE_LIMITS_BYTES[mediaType];
    if (fileSize > maxSize) {
      const maxSizeMb = maxSize / (1024 * 1024);
      return res.status(400).json({ 
        error: 'Arquivo muito grande',
        maxSizeMb: Math.round(maxSizeMb),
        receivedSizeMb: Math.round(fileSize / 1024 / 1024),
        mediaType,
      });
    }

    // Gerar hash para deduplicação
    const fileHash = crypto.createHash('sha256').update(new Uint8Array(fileBuffer)).digest('hex');
    
    // Verificar duplicatas
    const existingMedia = await db.query.mediaUploads.findFirst({
      where: and(
        eq(schema.mediaUploads.tenantId, tenantId),
        sql`extracted_metadata->>'fileHash' = ${fileHash}`
      ),
    });

    if (existingMedia) {
      return res.status(200).json({ 
        uploadId: existingMedia.id,
        mediaType: existingMedia.mediaType,
        fileUrl: existingMedia.fileUrl,
        processingStatus: existingMedia.processingStatus,
        duplicate: true,
        message: 'Arquivo já foi enviado anteriormente',
      });
    }

    // Salvar no storage
    const storageService = getStorageService();
    const storedFile = await storageService.saveFile(fileBuffer, {
      tenantId,
      mediaType,
      originalFilename: body.filename,
      mimeType: body.mimeType,
    });

    // Criar registro
    const [mediaUploadRecord] = await db.insert(schema.mediaUploads).values({
      tenantId,
      userId: userId || null,
      conversationId: body.conversationId || null,
      messageId: body.messageId || null,
      namespaceId: body.namespaceId || null,
      mediaType,
      originalFilename: body.filename,
      mimeType: body.mimeType,
      fileSize,
      filePath: storedFile.filePath,
      fileUrl: storedFile.fileUrl,
      processingStatus: 'pending',
      extractedMetadata: {
        fileHash,
        uploadedAt: new Date().toISOString(),
        description: body.description,
        uploadMethod: 'json',
      },
    }).returning();

    logger.info({ 
      uploadId: mediaUploadRecord.id,
      tenantId,
      mediaType,
      filename: body.filename,
      fileSize,
      uploadMethod: 'json',
      processingTimeMs: Date.now() - startTime,
    }, 'Upload JSON de mídia salvo');

    // Processar assíncrono (ALINHADO com endpoint FormData - CORREÇÃO 17/12/2025)
    // ARQUITETURA ENTERPRISE:
    // - Texto: Qwen3-Embedding-0.6B (1024 dim) → Qdrant
    // - Imagem: OpenAI Vision (descrição) - sem embeddings de imagem
    const processMediaAsync = async () => {
      try {
        if (mediaType === 'image') {
          const imageProcessor = getImageProcessor();
          const result = await imageProcessor.processImage(fileBuffer, body.mimeType);

          let thumbnailPath: string | null = null;
          let thumbnailUrl: string | null = null;

          if (result.thumbnailBuffer) {
            const thumbStored = await storageService.saveFile(result.thumbnailBuffer, {
              tenantId,
              mediaType: 'image',
              originalFilename: `thumb_${body.filename}`,
              mimeType: result.thumbnailMimeType || 'image/jpeg',
            });
            thumbnailPath = thumbStored.filePath;
            thumbnailUrl = thumbStored.fileUrl;
          }

          const visionDescription = result.visionDescription?.trim() || null;
          const visionModel = result.visionModel ?? null;

          // Gate 2: Embedding da descrição textual (OpenAI Vision) → Qdrant
          // Simetria enterprise: documento texto + transcrição áudio + descrição imagem → mesmo espaço vetorial
          if (visionDescription && visionDescription.length > 0 && isQdrantConfigured()) {
            const descriptionEmbedding = await generateEmbedding(visionDescription.slice(0, 8000));
            validateEmbeddingDimension(descriptionEmbedding, EMBEDDING_DIMENSIONS.TEXT, 'TEXT');
            await upsertPoints(TEXT_COLLECTION_NAME, [{
              id: mediaUploadRecord.id,
              vector: descriptionEmbedding,
              payload: {
                type: 'media_image',
                mediaUploadId: mediaUploadRecord.id,
                mediaType: 'image',
                tenantId: tenantId,
                ...(mediaUploadRecord.namespaceId ? { namespaceId: mediaUploadRecord.namespaceId } : {}),
                visionDescription: visionDescription.slice(0, 10000),
                embeddingModel: visionModel ?? 'OpenAI-Vision',
                criadoEm: new Date().toISOString(),
              },
            }]);
            logger.debug({ uploadId: mediaUploadRecord.id }, 'Embedding de descrição de imagem inserido no Qdrant (JSON upload)');
          }

          await db.update(schema.mediaUploads)
            .set({
              processingStatus: 'completed',
              extractedMetadata: {
                ...mediaUploadRecord.extractedMetadata as object,
                ...result.metadata,
                visionDescription,
                visionModel,
                hasThumbnail: !!thumbnailPath,
                thumbnailPath,
                thumbnailUrl,
                processingTimeMs: result.processingTimeMs,
              },
              llmDescription: visionDescription,
            })
            .where(eq(schema.mediaUploads.id, mediaUploadRecord.id));

          logger.info({
            uploadId: mediaUploadRecord.id,
            visionModel,
            hasThumbnail: !!thumbnailPath,
          }, 'Imagem processada com sucesso (JSON upload)');

        } else if (mediaType === 'audio') {
          const audioProcessor = getAudioProcessor();
          const result = await audioProcessor.processAudio(fileBuffer, body.mimeType);

          // Validar dimensão de texto antes de salvar (Enterprise-Grade - Regra 6)
          if (result.embedding.length > 0) {
            validateEmbeddingDimension(result.embedding, EMBEDDING_DIMENSIONS.TEXT, 'TEXT');
          }
          
          // Gate 2: Embeddings de texto são SSOT no Qdrant (PostgreSQL mantém apenas transcrição/metadados)
          if (result.embedding.length > 0 && isQdrantConfigured()) {
            const qdrantPointId = mediaUploadRecord.id;
            await upsertPoints(TEXT_COLLECTION_NAME, [{
              id: qdrantPointId,
              vector: result.embedding,
              payload: {
                type: 'media_audio',
                mediaUploadId: mediaUploadRecord.id,
                mediaType: 'audio',
                tenantId: tenantId,
                ...(mediaUploadRecord.namespaceId ? { namespaceId: mediaUploadRecord.namespaceId } : {}),
                transcription: result.transcription.slice(0, 10000), // Limitar para payload
                transcriptionLanguage: result.transcriptionLanguage,
                embeddingModel: result.embeddingModel,
                criadoEm: new Date().toISOString(),
              },
            }]);
            logger.debug({ uploadId: mediaUploadRecord.id }, 'Embedding de áudio inserido no Qdrant (JSON upload)');
          }
          
          // Atualizar registro com transcrição e metadata (SEM embedding - vai para Qdrant)
          await db.update(schema.mediaUploads)
            .set({
              processingStatus: 'completed',
              transcription: result.transcription,
              transcriptionLanguage: result.transcriptionLanguage,
              transcriptionConfidence: result.transcriptionConfidence,
              // textEmbedding OMITIDO - texto vai para Qdrant (SSOT)
              extractedMetadata: {
                ...mediaUploadRecord.extractedMetadata as object,
                ...result.metadata,
                embeddingModel: result.embeddingModel,
                processingTimeMs: result.processingTimeMs,
                // CORREÇÃO 17/12/2025: qdrantPointId só é definido se Qdrant está configurado
                qdrantPointId: result.embedding.length > 0 && isQdrantConfigured() ? mediaUploadRecord.id : null,
              },
            })
            .where(eq(schema.mediaUploads.id, mediaUploadRecord.id));

          logger.info({
            uploadId: mediaUploadRecord.id,
            transcriptionLength: result.transcription.length,
            language: result.transcriptionLanguage,
            embeddingDim: result.embedding.length,
            qdrantConfigured: isQdrantConfigured(),
          }, 'Áudio processado com sucesso (JSON upload)');

        // REMOVIDO 23/12/2025: Processamento de vídeo desabilitado (muito pesado para GPU)
        // Plataforma suporta apenas: texto, áudio e imagem
        } else if (mediaType === 'document') {
          // CORREÇÃO 17/12/2025: Processar documento como no endpoint FormData
          const documentProcessor = getDocumentProcessor();
          
          if (!(await documentProcessor.isReadyAsync())) {
            throw new Error(
              'Document Processor não está pronto. Verifique conectividade com GPU Manager Service.'
            );
          }
          
          const result = await documentProcessor.processDocument(
            fileBuffer,
            body.mimeType,
            { extractMetadata: true, generateEmbeddings: true }
          );

          // Validar embedding (Regra 6 - Enterprise-Grade)
          if (result.combinedEmbedding.length > 0) {
            validateEmbeddingDimension(result.combinedEmbedding, EMBEDDING_DIMENSIONS.TEXT, 'TEXT');
          } else {
            throw new Error('combinedEmbedding vazio recebido do document-processor (estado inválido)');
          }
          
          await db.update(schema.mediaUploads)
            .set({
              processingStatus: 'completed',
              transcription: result.fullText.slice(0, 65000),
              textEmbedding: result.combinedEmbedding.length > 0 ? result.combinedEmbedding : null,
              extractedMetadata: {
                ...mediaUploadRecord.extractedMetadata as object,
                ...result.metadata,
                embeddingModel: result.embeddingModel,
                chunksCount: result.chunks.length,
                processingTimeMs: result.processingTimeMs,
              },
            })
            .where(eq(schema.mediaUploads.id, mediaUploadRecord.id));

          logger.info({
            uploadId: mediaUploadRecord.id,
            format: result.metadata.format,
            pageCount: result.metadata.pageCount,
            wordCount: result.metadata.wordCount,
            chunksCount: result.chunks.length,
            embeddingDim: result.combinedEmbedding.length,
          }, 'Documento processado com sucesso (JSON upload)');

        } else {
          // Tipo de mídia não suportado para processamento
          logger.warn({ uploadId: mediaUploadRecord.id, mediaType }, 'Tipo de mídia não suportado para processamento (JSON upload)');
          
          await db.update(schema.mediaUploads)
            .set({ 
              processingStatus: 'failed',
              extractedMetadata: {
                ...mediaUploadRecord.extractedMetadata as object,
                processingError: `Tipo de mídia não suportado: ${mediaType}`,
              },
            })
            .where(eq(schema.mediaUploads.id, mediaUploadRecord.id));
        }
      } catch (error) {
        logger.error({ error, uploadId: mediaUploadRecord.id }, 'Erro ao processar mídia JSON');
        await db.update(schema.mediaUploads)
          .set({ 
            processingStatus: 'failed',
            extractedMetadata: {
              ...mediaUploadRecord.extractedMetadata as object,
              processingError: String(error),
            },
          })
          .where(eq(schema.mediaUploads.id, mediaUploadRecord.id));
      }
    };

    processMediaAsync().catch(err => {
      logger.error({ err, uploadId: mediaUploadRecord.id }, 'Falha não tratada no processamento JSON');
    });

    res.status(201).json({
      uploadId: mediaUploadRecord.id,
      mediaType,
      fileUrl: storedFile.fileUrl,
      processingStatus: 'pending',
      duplicate: false,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Dados inválidos',
        details: error.errors,
      });
    }
    const errMsg = error instanceof Error ? error.message : String(error);
    if (errMsg.includes('Namespace inválido')) {
      return res.status(403).json({ error: errMsg });
    }
    logger.error({ error, tenantId }, 'Falha no upload JSON de mídia');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET status de um upload específico
app.get('/api/media/:id', requireAuth(), requireSameTenant(getTenantIdFromRequest), async (req: Request, res: Response, next: NextFunction) => {
  // Express 5 (path-to-regexp v8) não suporta regex inline em rotas.
  // Para evitar conflito com /api/media/uploads|stats|health, delegamos quando :id não parece UUID.
  const idCandidate = typeof req.params.id === 'string' ? req.params.id : '';
  if (!/^[0-9a-fA-F-]{36}$/u.test(idCandidate)) {
    return next();
  }

  // OWASP API3: Validação Zod obrigatória de parâmetros de rota
  const paramsResult = uuidParamSchema.safeParse({ id: idCandidate });
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID inválido', details: paramsResult.error.format() });
  }
  const { id } = paramsResult.data;

  // SEGURANÇA: Usar req.tenantId populado pelo middleware
  const tenantId = req.tenantId;
  
  if (!tenantId) {
    return res.status(401).json({ error: 'Autenticação necessária' });
  }

  try {
    const media = await db.query.mediaUploads.findFirst({
      where: and(
        eq(schema.mediaUploads.id, id),
        eq(schema.mediaUploads.tenantId, tenantId)
      ),
    });

    if (!media) {
      return res.status(404).json({ error: 'Upload não encontrado' });
    }

    const metadata = media.extractedMetadata as Record<string, unknown> | null;
    
    res.json({
      uploadId: media.id,
      mediaType: media.mediaType,
      fileUrl: media.fileUrl,
      thumbnailUrl: metadata?.thumbnailUrl || null,
      processingStatus: media.processingStatus,
      transcription: media.transcription,
      extractedMetadata: media.extractedMetadata,
      criadoEm: media.criadoEm,
    });
  } catch (error) {
    logger.error({ error, id, tenantId }, 'Erro ao buscar status de upload');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Listar uploads de mídia do tenant
app.get('/api/media/uploads', requireAuth(), requireSameTenant(getTenantIdFromRequest), async (req: Request, res: Response) => {
  // SEGURANÇA: Usar req.tenantId populado pelo middleware
  const tenantId = req.tenantId;
  
  if (!tenantId) {
    return res.status(401).json({ error: 'Autenticação necessária' });
  }

  // OWASP API3: Validação de query params
  const queryResult = mediaUploadsQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: queryResult.error.format() });
  }

  try {
    const limit = queryResult.data.limit ?? 50;
    const offset = queryResult.data.offset ?? 0;
    const { mediaType, conversationId, namespaceId } = queryResult.data;

    const whereConditions = [eq(schema.mediaUploads.tenantId, tenantId)];
    
    if (mediaType) {
      whereConditions.push(eq(schema.mediaUploads.mediaType, mediaType as MediaType));
    }
    
    if (conversationId) {
      whereConditions.push(eq(schema.mediaUploads.conversationId, conversationId));
    }

    if (namespaceId) {
      whereConditions.push(eq(schema.mediaUploads.namespaceId, namespaceId));
    }

    const uploads = await db.query.mediaUploads.findMany({
      where: and(...whereConditions),
      orderBy: [desc(schema.mediaUploads.criadoEm)],
      limit,
      offset,
    });

    const totalCount = await db.select({ count: sql<number>`count(*)` })
      .from(schema.mediaUploads)
      .where(and(...whereConditions));

    res.json({ 
      uploads,
      pagination: {
        limit,
        offset,
        total: totalCount[0]?.count || 0,
      },
    });
  } catch (error) {
    logger.error({ error, tenantId }, 'Falha ao listar uploads');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Detalhes de um upload específico
app.get('/api/media/uploads/:id', requireAuth(), requireSameTenant(getTenantIdFromRequest), async (req: Request, res: Response) => {
  // OWASP API3: Validação Zod obrigatória de parâmetros de rota
  const paramsResult = uuidParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID inválido', details: paramsResult.error.format() });
  }
  const { id } = paramsResult.data;

  // SEGURANÇA: Usar req.tenantId populado pelo middleware
  const tenantId = req.tenantId;
  
  if (!tenantId) {
    return res.status(401).json({ error: 'Autenticação necessária' });
  }

  try {
    const upload = await db.query.mediaUploads.findFirst({
      where: and(
        eq(schema.mediaUploads.id, id),
        eq(schema.mediaUploads.tenantId, tenantId)
      ),
    });

    if (!upload) {
      return res.status(404).json({ error: 'Upload não encontrado' });
    }

    res.json({ upload });
  } catch (error) {
    logger.error({ error, tenantId, uploadId: id }, 'Falha ao buscar upload');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Deletar upload
app.delete('/api/media/uploads/:id', requireAuth(), requireSameTenant(getTenantIdFromRequest), async (req: Request, res: Response) => {
  // OWASP API3: Validação Zod obrigatória de parâmetros de rota
  const paramsResult = uuidParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID inválido', details: paramsResult.error.format() });
  }
  const { id } = paramsResult.data;

  // SEGURANÇA: Usar req.tenantId populado pelo middleware
  const tenantId = req.tenantId;
  
  if (!tenantId) {
    return res.status(401).json({ error: 'Autenticação necessária' });
  }

  try {
    const upload = await db.query.mediaUploads.findFirst({
      where: and(
        eq(schema.mediaUploads.id, id),
        eq(schema.mediaUploads.tenantId, tenantId)
      ),
    });

    if (!upload) {
      return res.status(404).json({ error: 'Upload não encontrado' });
    }

    await db.delete(schema.mediaUploads)
      .where(eq(schema.mediaUploads.id, id));

    logger.info({ uploadId: id, tenantId }, 'Upload de mídia excluído');
    res.json({ success: true });
  } catch (error) {
    logger.error({ error, tenantId, uploadId: id }, 'Falha ao excluir upload');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Plano RAG Multimodal Enterprise Fase 4 - Promoção de mídia para treinamento
app.post('/api/media/uploads/:id/send-to-training', requireAuth(), requirePermission('training:training_data:write'), requireSameTenant(getTenantIdFromRequest), async (req: Request, res: Response) => {
  const paramsResult = z.object({ id: z.string().uuid('ID inválido') }).safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID inválido', details: paramsResult.error.format() });
  }
  const bodyResult = z.object({
    namespaceId: z.string().uuid().optional(),
  }).safeParse(req.body ?? {});
  if (!bodyResult.success) {
    return res.status(400).json({ error: 'Payload inválido', details: bodyResult.error.format() });
  }
  const { id } = paramsResult.data;

  const tenantId = req.tenantId;
  if (!tenantId) {
    return res.status(401).json({ error: 'Tenant não identificado' });
  }

  try {
    const upload = await db.query.mediaUploads.findFirst({
      where: and(
        eq(schema.mediaUploads.id, id),
        eq(schema.mediaUploads.tenantId, tenantId)
      ),
    });

    if (!upload) {
      return res.status(404).json({ error: 'Upload não encontrado' });
    }

    if (upload.processingStatus !== 'completed') {
      return res.status(422).json({
        error: 'Mídia ainda não foi processada. Aguarde o processamento completar.',
        processingStatus: upload.processingStatus,
      });
    }

    const targetNamespaceId = bodyResult.data.namespaceId ?? upload.namespaceId;
    if (!targetNamespaceId) {
      return res.status(422).json({ error: 'Mídia sem namespace não pode ser promovida para treinamento. Associe um namespace ao upload.' });
    }
    if (bodyResult.data.namespaceId) {
      await assertNamespaceOwnership(bodyResult.data.namespaceId, tenantId);
    }

    const content = upload.mediaType === 'image'
      ? (upload.llmDescription ?? (upload.extractedMetadata as { visionDescription?: string } | null)?.visionDescription ?? '')
      : (upload.transcription ?? '');

    if (!content || content.trim().length < 50) {
      return res.status(422).json({
        error: 'Conteúdo insuficiente para treinamento. Imagens precisam de descrição (OpenAI Vision). Áudios precisam de transcrição (ASR). Mínimo 50 caracteres.',
        hasContent: !!content,
        length: content?.length ?? 0,
      });
    }

    if (upload.approvedForTraining) {
      return res.status(409).json({
        error: 'Mídia já foi enviada para treinamento',
        approvedForTraining: upload.approvedForTraining,
      });
    }

    const validMediaTypes = ['image', 'audio'] as const;
    if (!validMediaTypes.includes(upload.mediaType as 'image' | 'audio')) {
      return res.status(422).json({ error: 'Tipo de mídia não suportado para treinamento. Apenas imagens e áudios.' });
    }

    const user = getAuthUser(req);
    const result = await collectTrainingFromMediaUpload({
      tenantId,
      namespaceId: targetNamespaceId,
      mediaUploadId: upload.id,
      mediaType: upload.mediaType as 'image' | 'audio',
      originalFilename: upload.originalFilename,
      content: content.trim(),
      userId: user.userId,
      role: user.role,
      customRoleId: user.customRoleId,
    });

    if (!result.sent) {
      return res.status(502).json({
        error: `Falha ao enviar mídia para o Training Service (${result.status ?? 'network'} - ${(result.error ?? 'sem detalhes').slice(0, 240)})`,
        status: result.status,
        details: result.error,
      });
    }

    await db
      .update(schema.mediaUploads)
      .set({
        approvedForTraining: true,
      })
      .where(eq(schema.mediaUploads.id, upload.id));

    logger.info({
      tenantId,
      mediaUploadId: upload.id,
      mediaType: upload.mediaType,
      trainingDataId: result.trainingDataId,
    }, 'Mídia promovida para treinamento');

    return res.json({
      success: true,
      data: {
        mediaUploadId: upload.id,
        trainingDataId: result.trainingDataId,
      },
      message: 'Mídia enviada para dataset de treinamento. Aprove na página Training.',
    });
  } catch (error) {
    logger.error({ error, mediaUploadId: id }, 'Falha ao promover mídia para treinamento');
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Estatísticas de uploads do tenant
app.get('/api/media/stats', requireAuth(), requireSameTenant(getTenantIdFromRequest), async (req: Request, res: Response) => {
  // SEGURANÇA: Usar req.tenantId populado pelo middleware
  const tenantId = req.tenantId;
  
  if (!tenantId) {
    return res.status(401).json({ error: 'Autenticação necessária' });
  }

  try {
    const stats = await db.select({
      mediaType: schema.mediaUploads.mediaType,
      processingStatus: schema.mediaUploads.processingStatus,
      count: sql<number>`count(*)`,
      totalSize: sql<number>`sum(file_size)`,
    })
      .from(schema.mediaUploads)
      .where(eq(schema.mediaUploads.tenantId, tenantId))
      .groupBy(schema.mediaUploads.mediaType, schema.mediaUploads.processingStatus);

    const summary = {
      byType: {} as Record<string, { count: number; totalSize: number }>,
      byStatus: {} as Record<string, number>,
      total: { count: 0, totalSize: 0 },
    };

    for (const row of stats) {
      const type = row.mediaType || 'unknown';
      const status = row.processingStatus || 'unknown';
      const count = Number(row.count);
      const size = Number(row.totalSize) || 0;

      if (!summary.byType[type]) {
        summary.byType[type] = { count: 0, totalSize: 0 };
      }
      summary.byType[type].count += count;
      summary.byType[type].totalSize += size;

      if (!summary.byStatus[status]) {
        summary.byStatus[status] = 0;
      }
      summary.byStatus[status] += count;

      summary.total.count += count;
      summary.total.totalSize += size;
    }

    res.json({ stats: summary });
  } catch (error) {
    logger.error({ error, tenantId }, 'Falha ao obter estatísticas');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Servir arquivos de mídia (com verificação de tenant e autenticação)
// SEGURANÇA: Requer autenticação e verifica que o usuário pertence ao tenant solicitado
app.get('/api/media/files/:tenantId/:mediaType/:filename', requireAuth(), requireSameTenant(getTenantIdFromRequest), async (req: Request, res: Response) => {
  const mediaPathParamsSchema = z.object({
    tenantId: z.string().uuid(),
    mediaType: z.enum(['image', 'audio', 'document']),
    filename: z.string().regex(/^[A-Za-z0-9._-]{1,255}$/),
  });
  const paramsParsed = mediaPathParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    return res.status(400).json({ error: 'Parametros de caminho invalidos' });
  }
  const { tenantId, mediaType, filename } = paramsParsed.data;
  
  // SEGURANÇA: Validar que o tenantId da URL corresponde ao tenant do usuário autenticado
  if (req.tenantId && req.tenantId !== tenantId) {
    return res.status(403).json({ error: 'Acesso negado a arquivos de outro tenant' });
  }
  
  try {
    const storageService = getStorageService();
    const filePath = `${tenantId}/${mediaType}/${filename}`;
    
    // Verificar se arquivo existe
    const exists = await storageService.fileExists(filePath);
    if (!exists) {
      return res.status(404).json({ error: 'Arquivo não encontrado' });
    }
    
    // BUG FIX 23/12/2025: Buscar MIME type original do banco de dados
    // Arquivos WebM podem ser tanto áudio quanto vídeo - usar MIME type original garante Content-Type correto
    // Isso previne problemas ao servir arquivos legados que são vídeos mas foram mapeados como áudio
    let contentType: string | null = null;
    try {
      const mediaRecord = await db.query.mediaUploads.findFirst({
        where: and(
          eq(schema.mediaUploads.tenantId, tenantId),
          eq(schema.mediaUploads.filePath, filePath)
        ),
        columns: {
          mimeType: true,
        },
      });
      
      if (mediaRecord?.mimeType) {
        contentType = mediaRecord.mimeType;
        logger.debug({ filePath, mimeType: contentType }, 'MIME type obtido do banco de dados');
      }
    } catch (dbError) {
      logger.warn({ error: dbError, filePath }, 'Erro ao buscar MIME type do banco - usando fallback');
    }
    
    // Fallback: determinar content type pela extensão se não encontrado no banco
    if (!contentType) {
      const ext = path.extname(filename).toLowerCase();
      const contentTypes: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.ogg': 'audio/ogg',
        // WebM suportado APENAS para áudio (vídeo é desabilitado na plataforma).
        // Para arquivos sem registro no DB (edge case), servimos como audio/webm.
        '.webm': 'audio/webm',
        '.pdf': 'application/pdf',
        '.txt': 'text/plain',
        '.md': 'text/markdown',
        '.json': 'application/json',
      };
      
      contentType = contentTypes[ext] || 'application/octet-stream';
      logger.debug({ filePath, ext, contentType }, 'MIME type determinado por extensão (fallback)');
    }
    
    // Ler arquivo
    const buffer = await storageService.readFile(filePath);
    
    res.set({
      'Content-Type': contentType,
      'Content-Length': buffer.length.toString(),
      'Cache-Control': 'public, max-age=31536000', // 1 ano para arquivos imutáveis
    });
    
    res.send(buffer);
  } catch (error) {
    logger.error({ error, tenantId, mediaType, filename }, 'Erro ao servir arquivo');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Busca vetorial otimizada com pgvector nativo (enterprise-grade)

// Health check específico para multimodal
// ATUALIZADO 23/12/2025: Removido suporte a vídeo (muito pesado para GPU)
// Plataforma suporta apenas: texto, áudio e imagem
app.get('/api/media/health', async (_req: Request, res: Response) => {
  try {
    const imageProcessor = getImageProcessor();
    const imageConfig = imageProcessor.getConfig();
    
    const audioProcessor = getAudioProcessor();
    const audioConfig = audioProcessor.getConfig();

    const documentProcessor = getDocumentProcessor();
    const documentConfig = documentProcessor.getConfig();

    // ============================================================================
    // Prontidão REAL (sem hardcoded/mocks): valida conectividade e dependências locais.
    // IMPORTANTE: Express < 5 pode não capturar rejeições de async handlers automaticamente,
    // então este endpoint deve SEMPRE tratar erros e responder.
    // ============================================================================
    const readinessResults = await Promise.allSettled([
      imageProcessor.isReadyAsync(),
      audioProcessor.isReadyAsync(),
      documentProcessor.isReadyAsync(),
    ]);

    const [imageResult, audioResult, documentResult] = readinessResults;

    const imageReady = imageResult.status === 'fulfilled' ? imageResult.value : false;
    const audioReady = audioResult.status === 'fulfilled' ? audioResult.value : false;
    const documentReady = documentResult.status === 'fulfilled' ? documentResult.value : false;

    // Logar falhas de forma segura para observabilidade (sem derrubar o endpoint)
    const rejected = readinessResults.filter((r) => r.status === 'rejected') as Array<PromiseRejectedResult>;
    if (rejected.length > 0) {
      logger.warn(
        { rejectedCount: rejected.length, errors: rejected.map((r) => String(r.reason)) },
        'Falha ao executar readiness checks (tratando como not_ready)'
      );
    }

    // Semântica de saúde enterprise:
    // - refletir APENAS as probes/capabilities (isReadyAsync), sem duplicar lógica de WHISPER_REQUIRED localmente.
    // - se Whisper estiver indisponível, audio ficará not_ready e o status global será degraded (sinal explícito).
    const allReady = imageReady && documentReady && audioReady;

    // BUG FIX 23/12/2025: Limites corretos por tipo de mídia (consistente com FILE_LIMITS)
    // Removido maxFileSizeMb: 100 (limite desatualizado de vídeo)
    // Limites reais: 10MB para imagens, 25MB para áudio, 50MB para documentos
    const FILE_LIMITS_MB = {
      image: 10,
      audio: 25,
      document: 50,
    } as const;

    res.json({
      status: allReady ? 'ok' : 'degraded',
      service: 'media-upload',
      timestamp: new Date().toISOString(),
      supportedTypes: SUPPORTED_MEDIA_TYPES,
      fileSizeLimitsMb: FILE_LIMITS_MB,
      processing: {
        image: {
          configured: imageConfig.configured,
          required: true,
          ready: imageReady,
          model: imageConfig.model,
          maxFileSizeMb: FILE_LIMITS_MB.image,
        },
        audio: {
          configured: audioConfig.configured,
          required: true,
          ready: audioReady,
          embeddingDim: audioConfig.embeddingDim,
          transcriptionModel: audioConfig.transcriptionModel,
          embeddingModel: audioConfig.embeddingModel,
          maxFileSizeMb: FILE_LIMITS_MB.audio,
        },
        // REMOVIDO 23/12/2025: video desabilitado (muito pesado para GPU)
        document: {
          configured: documentConfig.configured,
          required: true,
          ready: documentReady,
          embeddingDim: documentConfig.embeddingDim,
          maxDocumentSizeMB: documentConfig.maxDocumentSizeMB,
          maxFileSizeMb: FILE_LIMITS_MB.document,
          chunkSize: documentConfig.chunkSize,
          supportedFormats: documentConfig.supportedFormats,
        },
      },
    });
  } catch (error) {
    logger.error({ error }, 'Erro ao calcular health multimodal');
    res.status(500).json({
      status: 'error',
      service: 'media-upload',
      timestamp: new Date().toISOString(),
      error: 'Erro interno ao calcular health multimodal',
    });
  }
});

registerRagEmbeddingRoutes({
  app,
  logger,
});

// ============================================================================
// MIDDLEWARE: Not Found + Error Handler (Express.js 2025)
// ============================================================================

// Not Found handler (antes do error handler)
app.use(createNotFoundHandler({ serviceName: 'rag-service' }));

// Error handler global (OWASP 2023 + Express.js 2025)
app.use(createErrorHandler({ 
  serviceName: 'rag-service', 
  logger,
  includeStackInDev: true,
}));

// BUG FIX 23/12/2025: Registrar callback de database pool ANTES do IIFE para garantir cleanup mesmo se inicialização falhar
// Se Redis falhar, o server nunca é criado, mas o database pool já existe e precisa ser fechado
// Isso previne vazamento de conexões do database pool se a inicialização falhar parcialmente
registerShutdownCallback(
  'rag-database-pool',
  async () => {
    logger.info('Encerrando pool de conexões database...');
    await closeDatabasePool();
    logger.info('Pool de conexões encerrado com sucesso');
  },
  { priority: ShutdownPriority.DATABASE }
);

registerShutdownCallback(
  'rag-document-processing-reconciler',
  async () => {
    stopDocumentProcessingReconciler();
  },
  { priority: ShutdownPriority.BACKGROUND_JOBS }
);

void startRagBootstrap({
  app,
  logger,
  port: PORT ?? 3004,
  isProduction,
  gpuManagerUrl: GPU_MANAGER_URL,
  workerTenantId: WORKER_TENANT_ID ?? undefined,
  ragQueryCacheTtlMs: RAG_QUERY_CACHE_TTL_MS,
  startEmbeddingWorkerWhenRedisReady,
  startDocumentProcessingWorkerWhenRedisReady,
  startDocumentProcessingReconcilerWhenRedisReady,
  startTenantScopedWorkers,
  validateEmbeddingDimensionsSSOT,
  setRagSearchCache: (cache) => {
    ragSearchCache = cache as CacheAdapter<RagSearchResponse> | null;
  },
  setRagContextCache: (cache) => {
    ragContextCache = cache as CacheAdapter<RagContextResponse> | null;
  },
});

// ============================================================================
// INICIALIZAÇÃO QDRANT - Banco vetorial para texto (1024 dim)
// ARQUITETURA ENTERPRISE (17/12/2025):
// - Texto: Qdrant (Qwen3-Embedding-0.6B, 1024 dim)
// - Imagem: OpenAI Vision (descrição textual, sem embeddings de imagem)
// ============================================================================
// BUG FIX 23/12/2025: Inicialização movida para dentro do IIFE async (linha ~3527)
// Isso garante que a collection seja criada ANTES do servidor aceitar conexões
// Previne erro "Collection text_embeddings doesn't exist" em requisições precoces

// CORREÇÃO 23/12/2025: Timeouts e shutdown callbacks movidos para dentro do callback de inicialização do Redis
// Isso garante que o servidor só aceita conexões após dependências críticas estarem prontas
// O código duplicado foi removido - configuração do servidor agora está no escopo correto

// BUG FIX 23/12/2025: registerShutdownCallback para rag-database-pool movido para dentro do async IIFE
// Isso garante que o callback seja registrado mesmo se a inicialização falhar parcialmente
// O callback agora está registrado após o servidor estar inicializado com sucesso (linha 3488)
