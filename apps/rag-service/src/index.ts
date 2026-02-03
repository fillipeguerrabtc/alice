/**
 * RAG Service - Alice Enterprise Platform
 * 
 * Serviço de Retrieval-Augmented Generation com busca vetorial enterprise.
 * Implementa Circuit Breaker pattern (Regra 16 - Best Practices 2025).
 * 
 * ARQUITETURA ENTERPRISE (25/12/2025):
 * - Texto: Qwen3-Embedding-0.6B (1024 dim) → Qdrant via GPU Manager Service
 * - Imagem: OpenAI Vision → descrição textual (sem embeddings de imagem)
 * 
 * Autor: Fillipe Guerra
 * Data: 25 de Dezembro de 2025
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import express from 'express';
import type { Request, Response } from 'express';
import http from 'http';
import cors from 'cors';
// helmet aplicado via createSecurityMiddleware de @alice/shared-utils
import compression from 'compression';
// rateLimit via createRateLimiter de @alice/shared-utils
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
// CircuitBreaker via createCircuitBreaker de @alice/shared-utils
import { getDatabase, getPool, schema, closeDatabasePool, isPoolHealthy, createDrizzleFeatureFlagStorage, validateEmbeddingDimension, EMBEDDING_DIMENSIONS, withTenantContext } from '@alice/database';
import { eq, sql, desc, and } from '@alice/database';
import { z } from 'zod';
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
  setPermissionResolver,
  createCacheAdapter,
  type CacheAdapter,
  setupSwaggerUI,
  RAG_SERVICE_TAGS,
  // CORREÇÃO 23/12/2025: Redis cache distribuído para embedding-websocket
  initializeRedisCache,
  requestGpu,
  GpuServiceType,
  GpuRequestPriority,
  generateInternalAuthHeaders,
  Role,
} from '@alice/shared-utils';
import { ragServicePaths, ragServiceSchemas } from './openapi-specs.js';
import { createLogger } from '@alice/logger';

// Constante para verificar ambiente de produção
// BUG FIX 23/12/2025: Definir isProduction IMEDIATAMENTE após imports (TypeScript requer imports primeiro)
// Módulos importados de @alice/shared-utils verificam process.env.NODE_ENV diretamente (não isProduction local),
// então é seguro definir isProduction após imports. Esta constante é usada apenas neste módulo.
// IMPORTANTE: Se algum módulo importado precisar de isProduction durante import, isso causaria undefined.
// Verificado: todos os módulos importados usam process.env.NODE_ENV diretamente, não isProduction local.
const isProduction = process.env.NODE_ENV === 'production';
import { getStorageService } from './storage.js';
import { getImageProcessor, getVisionCircuitBreakerStatus } from './image-processor.js';
import { startEmbeddingWorker, getEmbeddingWorkerStatus } from './workers/embedding-worker.js';
import {
  enqueueEmbeddingJob,
  getEmbeddingJobStatus,
  getEmbeddingQueueStats,
  isQueueAvailable,
  type EmbeddingJobType,
} from './embedding-queue.js';
import { initEmbeddingWebSocket, closeEmbeddingWebSocket, getWebSocketStats } from './embedding-websocket.js';
import { getAudioProcessor } from './audio-processor.js';
import { getDocumentProcessor } from './document-processor.js';
import { createWebSearchClient, WebSearchOptions, WebSearchResult } from './web-search.js';
import { createLearningTask, dequeueNextLearningTask, updateLearningTaskStatus } from './learning-orchestrator.js';
import { startLearningWorker } from './workers/learning-worker.js';
import { startWebCrawlWorker } from './workers/web-crawl-worker.js';
// Cliente Qdrant para busca de texto (1024 dim - Qwen3-Embedding-0.6B)
// CORREÇÃO 17/12/2025: Adicionado upsertPoints para inserir documentos no Qdrant
// Bug: Busca usava Qdrant mas inserção era apenas PostgreSQL - resultados sempre vazios
import {
  searchPoints,
  upsertPoints,
  deletePointsByFilter,
  initTextCollection,
  isQdrantConfigured,
  healthCheck as qdrantHealthCheck,
  getQdrantCircuitBreakerStatus,
  TEXT_COLLECTION_NAME,
  TEXT_EMBEDDING_DIM,
  type QdrantSearchResult,
  createSessionAuthMiddleware,
  initializeSessionAuthCache,
} from '@alice/shared-utils';

interface MulterRequest extends Request {
  file?: Express.Multer.File;
}

type AuthUser = { id?: string; role?: 'super_admin' | string; tenantId?: string };

function getAuthUser(req: Request): AuthUser {
  const typed = req as Request & { user?: AuthUser };
  return typed.user ?? {};
}

function selectTrainingChunks(chunks: Array<{ id: string; conteudo: string; posicao: number }>): Array<{ id: string; conteudo: string; posicao: number }> {
  const eligible = chunks.filter((chunk) => chunk.conteudo.trim().length >= TRAINING_DOC_MIN_CHARS);
  if (eligible.length <= TRAINING_DOC_MAX_SAMPLES) return eligible;

  const step = Math.ceil(eligible.length / TRAINING_DOC_MAX_SAMPLES);
  const selected: Array<{ id: string; conteudo: string; posicao: number }> = [];
  for (let i = 0; i < eligible.length && selected.length < TRAINING_DOC_MAX_SAMPLES; i += step) {
    selected.push(eligible[i]);
  }
  return selected;
}

async function collectTrainingFromDocumentChunks(params: {
  tenantId: string;
  namespaceId: string;
  documentId: string;
  titulo: string;
  chunks: Array<{ id: string; conteudo: string; posicao: number }>;
  userId?: string;
  role?: string;
}): Promise<void> {
  if (!TRAINING_DOC_AUTO_COLLECT) return;
  if (!TRAINING_SERVICE_URL) {
    logger.warn({ documentId: params.documentId }, 'TRAINING_SERVICE_URL ausente - coleta de documentos para treinamento desabilitada');
    return;
  }

  const selected = selectTrainingChunks(params.chunks);
  if (selected.length === 0) return;

  const headers = generateInternalAuthHeaders({
    userId: params.userId ?? 'system',
    tenantId: params.tenantId,
    role: (params.role as Role) || 'operator',
  });

  for (const chunk of selected) {
    const payload = {
      tenantId: params.tenantId,
      namespaceId: params.namespaceId,
      source: 'document-ingest',
      sourceType: 'document',
      sourceId: params.documentId,
      sourceMetadata: {
        documentId: params.documentId,
        chunkId: chunk.id,
        posicao: chunk.posicao,
        titulo: params.titulo,
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
      const response = await fetch(`${TRAINING_SERVICE_URL}/api/training/data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.warn({
          documentId: params.documentId,
          chunkId: chunk.id,
          status: response.status,
          error: errorText,
        }, 'Falha ao enviar chunk para treinamento');
      }
    } catch (error) {
      logger.warn({
        documentId: params.documentId,
        chunkId: chunk.id,
        error: error instanceof Error ? error.message : String(error),
      }, 'Erro ao enviar chunk para treinamento');
    }
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

const PORT = process.env.PORT || 3003;
const DATABASE_URL = process.env.DATABASE_URL;
const corsOriginsEnv = process.env.CORS_ORIGINS;
if (!corsOriginsEnv && process.env.NODE_ENV === 'production') {
  logger.error('CORS_ORIGINS é obrigatório em produção (Regra 6 - fail-fast)');
  process.exit(1);
}
const CORS_ORIGINS = corsOriginsEnv
  ? corsOriginsEnv.split(',').map((origin) => origin.trim()).filter(Boolean)
  : [];

if (!DATABASE_URL) {
  logger.error('DATABASE_URL não configurada');
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

const SEARXNG_URL = normalizeBaseUrl(process.env.SEARXNG_URL);
const SEARXNG_SECRET_KEY = process.env.SEARXNG_SECRET_KEY;

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
    if (process.env.NODE_ENV === 'production') {
      logger.error({ varName, rawValue: raw }, errorMsg);
      throw new Error(errorMsg);
    }
    logger.warn({ varName, rawValue: raw, defaultValue }, `${errorMsg} Usando valor padrão.`);
    return defaultValue;
  }
  
  const parsed = parseInt(trimmed, 10);
  
  if (!Number.isFinite(parsed) || parsed <= 0) {
    const errorMsg = `${varName} inválido: "${raw}". Deve ser número inteiro positivo.`;
    if (process.env.NODE_ENV === 'production') {
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
  if (process.env.NODE_ENV === 'production') {
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
    if (process.env.NODE_ENV === 'production') {
      logger.error({ varName, rawValue: raw, parsed }, errorMsg);
      throw new Error(errorMsg);
    }
    logger.warn({ varName, rawValue: raw, parsed, defaultValue }, `${errorMsg} Usando valor padrão.`);
    return defaultValue;
  }
  return parsed;
}

// Workers (defaults seguros e configuráveis) - CORREÇÃO AUDITORIA 17/12/2025
const WORKER_POLL_MS = parseEnvInt(process.env.WORKER_POLL_MS, 3000, 'WORKER_POLL_MS');
const WORKER_CONCURRENCY = parseEnvInt(process.env.WORKER_CONCURRENCY, 2, 'WORKER_CONCURRENCY');
const WORKER_MAX_ATTEMPTS = parseEnvInt(process.env.WORKER_MAX_ATTEMPTS, 3, 'WORKER_MAX_ATTEMPTS');

const TRAINING_SERVICE_URL = process.env.TRAINING_SERVICE_URL;
const TRAINING_DOC_AUTO_COLLECT = parseEnvBool(
  process.env.TRAINING_DOC_AUTO_COLLECT,
  false,
  'TRAINING_DOC_AUTO_COLLECT'
);
const TRAINING_DOC_MAX_SAMPLES = parseEnvInt(
  process.env.TRAINING_DOC_MAX_SAMPLES,
  20,
  'TRAINING_DOC_MAX_SAMPLES'
);
const TRAINING_DOC_MIN_CHARS = parseEnvInt(
  process.env.TRAINING_DOC_MIN_CHARS,
  180,
  'TRAINING_DOC_MIN_CHARS'
);

const RAG_ADAPTIVE_K_ENABLED = parseEnvBool(
  process.env.RAG_ADAPTIVE_K_ENABLED,
  false,
  'RAG_ADAPTIVE_K_ENABLED'
);
const RAG_ADAPTIVE_K_MIN_RESULTS = parseEnvInt(
  process.env.RAG_ADAPTIVE_K_MIN_RESULTS,
  2,
  'RAG_ADAPTIVE_K_MIN_RESULTS'
);
const RAG_ADAPTIVE_K_MIN_THRESHOLD = parseEnvFloat(
  process.env.RAG_ADAPTIVE_K_MIN_THRESHOLD,
  0.55,
  'RAG_ADAPTIVE_K_MIN_THRESHOLD'
);
const RAG_ADAPTIVE_K_FALLBACK_DELTA = parseEnvFloat(
  process.env.RAG_ADAPTIVE_K_FALLBACK_DELTA,
  0.1,
  'RAG_ADAPTIVE_K_FALLBACK_DELTA'
);
const RAG_ADAPTIVE_K_SHORT_QUERY = parseEnvInt(
  process.env.RAG_ADAPTIVE_K_SHORT_QUERY,
  200,
  'RAG_ADAPTIVE_K_SHORT_QUERY'
);
const RAG_ADAPTIVE_K_MEDIUM_QUERY = parseEnvInt(
  process.env.RAG_ADAPTIVE_K_MEDIUM_QUERY,
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

// Inicializar métricas RBAC (Regra 16 - Observability Enterprise)
initRbacPrometheusMetrics(metrics.rbac);
logger.info('Métricas RBAC Prometheus inicializadas no rag-service');

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
const GPU_MANAGER_URL = process.env.GPU_MANAGER_URL || 'http://alice-gpu-manager:3010';

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

  // Construir filtro Qdrant (multi-tenancy + namespace opcional)
  const mustConditions: Array<{ key: string; match: { value: string } }> = [
    { key: 'tenantId', match: { value: tenantId } },
    { key: 'type', match: { value: 'document_chunk' } },
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
    return mappedResults
      .slice(0, effectiveParams.limit)
      .map((result: QdrantSearchResult): QdrantDocumentResult => {
        const payload = result.payload || {};
        return {
          id: String(result.id),
          documentId: String(payload.documentId || ''),
          conteudo: String(payload.conteudo || ''),
          posicao: typeof payload.posicao === 'number' ? payload.posicao : undefined,
          metadata: typeof payload.metadata === 'object' ? payload.metadata as Record<string, unknown> : undefined,
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
// WORKERS (opcionais) - ativados se WORKER_TENANT_ID estiver definido
// ============================================================================

const WORKER_TENANT_ID = process.env.WORKER_TENANT_ID;

if (WORKER_TENANT_ID) {
  startLearningWorker(db, {
    tenantId: WORKER_TENANT_ID,
    concurrency: WORKER_CONCURRENCY,
    pollIntervalMs: WORKER_POLL_MS,
    maxAttempts: WORKER_MAX_ATTEMPTS,
  });

  startWebCrawlWorker(db, {
    tenantId: WORKER_TENANT_ID,
    concurrency: WORKER_CONCURRENCY,
    pollIntervalMs: WORKER_POLL_MS,
    maxAttempts: WORKER_MAX_ATTEMPTS,
    searxngUrl: SEARXNG_URL,
    searxngKey: SEARXNG_SECRET_KEY,
  });

  // Embedding Worker - GPU Dedicada 24/7 (Hetzner GEX44)
  // Processa embeddings assíncronos via fila Redis
  startEmbeddingWorker({ metrics });

  logger.info({ tenantId: WORKER_TENANT_ID }, 'Workers multimodais iniciados (incluindo embedding-worker)');
} else {
  logger.info('Workers desativados: defina WORKER_TENANT_ID para habilitar processamento em background');
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
  'notícias', 'news', 'atualidades', 'hoje', 'ontem', 'recente',
  'preço', 'cotação', 'valor atual', 'quanto custa',
  'tempo', 'clima', 'previsão',
  'resultado', 'placar', 'jogo',
  'lançamento', 'novo', 'última versão',
  'como fazer', 'tutorial', 'passo a passo',
  'onde encontrar', 'onde comprar', 'onde fica',
  'quem é', 'biografia', 'história de',
];

const DEEP_WEB_KEYWORDS = [
  'deep web', 'deepweb', 'dark web', 'darkweb', '.onion', 'onion',
];

const INTERNAL_KEYWORDS = [
  'nosso', 'nossa', 'empresa', 'produto',
  'política', 'procedimento', 'processo interno',
  'manual', 'documentação interna', 'wiki',
  'funcionário', 'equipe', 'time',
  'projeto', 'sistema interno', 'ferramenta interna',
  'alice', 'plataforma',
];

function classifyQuery(query: string): ClassificationResult {
  const lowerQuery = query.toLowerCase();
  const isDeepWebQuery = DEEP_WEB_KEYWORDS.some((keyword) => lowerQuery.includes(keyword));
  
  const webScore = WEB_SEARCH_KEYWORDS.reduce((score, keyword) => {
    return lowerQuery.includes(keyword) ? score + 1 : score;
  }, 0);
  
  const internalScore = INTERNAL_KEYWORDS.reduce((score, keyword) => {
    return lowerQuery.includes(keyword) ? score + 1 : score;
  }, 0);
  
  const hasCurrentTimeReference = /(?:hoje|agora|atualmente|202\d)/i.test(query);
  
  if (isDeepWebQuery) {
    return {
      type: 'web',
      confidence: 0.9,
      reason: 'Query explicitamente solicita deep web (.onion)',
      webMode: 'deepweb',
    };
  }

  if (internalScore > 0 && webScore === 0) {
    return {
      type: 'internal',
      confidence: 0.9,
      reason: 'Query contém referências a documentos internos',
    };
  }
  
  if (webScore > 0 && internalScore === 0 && hasCurrentTimeReference) {
    return {
      type: 'web',
      confidence: 0.85,
      reason: 'Query requer informações atualizadas da web',
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
    reason: 'Consulta padrão para base de conhecimento interna',
  };
}

// SEGURANÇA: Helmet com CSP/HSTS enterprise (Express.js 2025 + OWASP 2023)
app.use(createSecurityMiddleware({
  contentSecurityPolicy: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV !== 'production',
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

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;
function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    chunks.push(text.slice(start, end));
    start = end - CHUNK_OVERLAP;
  }

  return chunks;
}

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

app.get('/api/rag/health', async (_req: Request, res: Response) => {
  const circuitState = gpuManagerEmbeddingsBreaker.opened ? 'open' : (gpuManagerEmbeddingsBreaker.halfOpen ? 'half-open' : 'closed');
  const qdrantStatus = getQdrantCircuitBreakerStatus();

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
  });
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

app.get('/api/rag/documents', requireAuth(), requirePermission('rag:documents:read'), requireSameTenant(getTenantIdFromRequest), async (req: Request, res: Response) => {
  // SEGURANÇA: Usar req.tenantId populado pelo middleware (RLS Enterprise)
  const tenantId = req.tenantId;
  
  // OWASP API3: Validação de query params
  const queryResult = documentsQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: queryResult.error.format() });
  }
  const { namespaceId } = queryResult.data;

  try {
    // MULTI-TENANCY: Documentos são isolados por namespace (que pertence a um tenant)
    // Buscar com relação para namespace e filtrar pelo tenantId
    const documents = await db.query.documents.findMany({
      with: { namespace: true },
      where: namespaceId ? eq(schema.documents.namespaceId, namespaceId) : undefined,
      orderBy: [desc(schema.documents.criadoEm)],
      limit: 100,
    });

    // Filtrar documentos pelo tenant do usuário (segurança adicional)
    const tenantDocuments = documents.filter(doc => 
      doc.namespace?.tenantId === tenantId
    );

    res.json({ documents: tenantDocuments });
  } catch (error) {
    logger.error({ error }, 'Falha ao buscar documentos');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

const createDocumentSchema = z.object({
  namespaceId: z.string().uuid().optional(),
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

async function assertNamespaceOwnership(namespaceId: string | undefined, tenantId: string): Promise<void> {
  if (!namespaceId) return;
  const namespace = await db.query.namespaces.findFirst({
    where: eq(schema.namespaces.id, namespaceId),
  });
  if (!namespace || namespace.tenantId !== tenantId) {
    throw new Error('Namespace inválido ou não pertence ao tenant');
  }
}

async function rebuildDocumentEmbeddings(params: {
  tenantId: string;
  documentId: string;
  namespaceId?: string | null;
  titulo: string;
  conteudo: string;
  fonte?: string | null;
  urlOrigem?: string | null;
}): Promise<number> {
  const content = params.conteudo;
  const chunks = chunkText(content);
  const qdrantPoints: Array<{ id: string; vector: number[]; payload: Record<string, unknown> }> = [];

  await db.delete(schema.documentChunks)
    .where(eq(schema.documentChunks.documentId, params.documentId));

  for (let i = 0; i < chunks.length; i += 1) {
    const embedding = await generateEmbedding(chunks[i]);
    validateEmbeddingDimension(embedding, EMBEDDING_DIMENSIONS.TEXT, 'TEXT');
    const [chunk] = await db.insert(schema.documentChunks).values({
      documentId: params.documentId,
      conteudo: chunks[i],
      posicao: i,
    }).returning();

    qdrantPoints.push({
      id: chunk.id,
      vector: embedding,
      payload: {
        type: 'document_chunk',
        documentId: params.documentId,
        conteudo: chunks[i],
        posicao: i,
        tenantId: params.tenantId,
        namespaceId: params.namespaceId ?? null,
        document_id: params.documentId,
        document_titulo: params.titulo,
        document_namespaceId: params.namespaceId ?? null,
        criadoEm: new Date().toISOString(),
      },
    });
  }

  if (isQdrantConfigured()) {
    await deletePointsByFilter(TEXT_COLLECTION_NAME, {
      must: [
        { key: 'tenantId', match: { value: params.tenantId } },
        { key: 'documentId', match: { value: params.documentId } },
      ],
    });

    const documentEmbedding = await generateEmbedding(content.slice(0, 2000));
    validateEmbeddingDimension(documentEmbedding, EMBEDDING_DIMENSIONS.TEXT, 'TEXT');

    await upsertPoints(TEXT_COLLECTION_NAME, [
      {
        id: `document-${params.documentId}`,
        vector: documentEmbedding,
        payload: {
          type: 'document',
          documentId: params.documentId,
          titulo: params.titulo,
          tenantId: params.tenantId,
          namespaceId: params.namespaceId ?? null,
          fonte: params.fonte ?? null,
          urlOrigem: params.urlOrigem ?? null,
          conteudoPreview: content.slice(0, 500),
          criadoEm: new Date().toISOString(),
        },
      },
      ...qdrantPoints,
    ]);
  }

  return chunks.length;
}

app.post('/api/rag/documents', requireAuth(), requirePermission('rag:documents:write'), requireSameTenant(getTenantIdFromRequest), async (req: Request, res: Response) => {
  // SEGURANÇA: Usar req.tenantId populado pelo middleware (RLS Enterprise)
  const tenantId = req.tenantId;
  
  if (!tenantId) {
    return res.status(401).json({ error: 'Tenant não identificado' });
  }

  try {
    const body = createDocumentSchema.parse(req.body);
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

    const documentEmbedding = await generateEmbedding(body.conteudo.slice(0, 2000));
    
    // Validar dimensão antes de salvar (Enterprise-Grade - Regra 6)
    validateEmbeddingDimension(documentEmbedding, EMBEDDING_DIMENSIONS.TEXT, 'TEXT');

    // MULTI-TENANCY: Documento associado ao tenant via namespaceId
    // namespaceId deve pertencer ao tenant do usuário (validado pelo backend)
    // Gate 2: Embeddings de TEXTO são SSOT no Qdrant (PostgreSQL mantém apenas conteúdo/metadados).
    const [document] = await db.insert(schema.documents).values({
      namespaceId: body.namespaceId,
      titulo: body.titulo,
      conteudo: body.conteudo,
      tipo: body.tipo,
      fonte: body.fonte,
      urlOrigem: body.urlOrigem,
      hashConteudo,
      // embedding OMITIDO - texto vai para Qdrant (SSOT)
      processado: false,
    }).returning();
    
    // Armazenar embedding do documento inteiro no Qdrant para busca semântica
    if (documentEmbedding.length > 0 && isQdrantConfigured()) {
      await upsertPoints(TEXT_COLLECTION_NAME, [{
        id: `document-${document.id}`,
        vector: documentEmbedding,
        payload: {
          type: 'document',
          documentId: document.id,
          titulo: body.titulo,
          tenantId: tenantId,
          namespaceId: body.namespaceId,
          fonte: body.fonte,
          urlOrigem: body.urlOrigem,
          conteudoPreview: body.conteudo.slice(0, 500),
          criadoEm: new Date().toISOString(),
        },
      }]);
      logger.debug({ documentId: document.id }, 'Embedding de documento inserido no Qdrant');
    }

    const chunks = chunkText(body.conteudo);
    
    // Gate 2: Inserir chunks no PostgreSQL (conteúdo) e no Qdrant (vetores)
    // PostgreSQL: Persistência relacional e backup
    // Qdrant: Busca semântica vetorial (1024 dim - Qwen3-Embedding-0.6B)
    const qdrantPoints = [];
    const createdChunks: Array<{ id: string; conteudo: string; posicao: number }> = [];
    
    for (let i = 0; i < chunks.length; i++) {
      const embedding = await generateEmbedding(chunks[i]);
      
      // Validar dimensão antes de salvar (Enterprise-Grade - Regra 6)
      validateEmbeddingDimension(embedding, EMBEDDING_DIMENSIONS.TEXT, 'TEXT');
      
      // Inserir no PostgreSQL (persistência relacional - SEM embedding)
      // Gate 2: Embeddings de texto vão APENAS para Qdrant (PostgreSQL armazena somente conteúdo/metadata)
      const [chunk] = await db.insert(schema.documentChunks).values({
        documentId: document.id,
        conteudo: chunks[i],
        posicao: i,
        // embedding OMITIDO - texto usa Qdrant (SSOT)
      }).returning();

      createdChunks.push({ id: chunk.id, conteudo: chunks[i], posicao: i });
      
      // Preparar ponto para Qdrant (busca vetorial - 1024 dim)
      qdrantPoints.push({
        id: chunk.id,
        vector: embedding,
        payload: {
          type: 'document_chunk',
          documentId: document.id,
          conteudo: chunks[i],
          posicao: i,
          tenantId: tenantId,
          namespaceId: body.namespaceId,
          document_id: document.id,
          document_titulo: body.titulo,
          document_namespaceId: body.namespaceId,
          criadoEm: new Date().toISOString(),
        }
      });
    }
    
    // Inserir todos os chunks no Qdrant em batch (performance enterprise)
    if (qdrantPoints.length > 0 && isQdrantConfigured()) {
      await upsertPoints(TEXT_COLLECTION_NAME, qdrantPoints);
      logger.info({ documentId: document.id, pointsInserted: qdrantPoints.length }, 'Chunks inseridos no Qdrant');
    }

    await db.update(schema.documents)
      .set({ processado: true })
      .where(eq(schema.documents.id, document.id));

    const resolvedNamespaceId = body.namespaceId ?? null;
    if (resolvedNamespaceId) {
      const user = getAuthUser(req);
      await collectTrainingFromDocumentChunks({
        tenantId,
        namespaceId: resolvedNamespaceId,
        documentId: document.id,
        titulo: body.titulo,
        chunks: createdChunks,
        userId: user.id,
        role: user.role,
      });
    } else {
      logger.warn({ documentId: document.id }, 'Documento criado sem namespaceId - coleta de training ignorada');
    }

    logger.info({ documentId: document.id, chunks: chunks.length }, 'Documento processado');
    res.json({ document, chunksCreated: chunks.length });
  } catch (error) {
    logger.error({ error }, 'Falha ao criar documento');
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

    const titulo = body.titulo ?? existing.titulo;
    const tipo = body.tipo ?? existing.tipo ?? undefined;
    const fonte = body.fonte ?? existing.fonte ?? undefined;
    const urlOrigem = body.urlOrigem ?? existing.urlOrigem ?? undefined;
    const hashConteudo = hashContent(conteudo);

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
        atualizadoEm: new Date(),
      })
      .where(eq(schema.documents.id, id));

    const chunksCreated = await rebuildDocumentEmbeddings({
      tenantId,
      documentId: id,
      namespaceId: resolvedNamespaceId,
      titulo,
      conteudo,
      fonte,
      urlOrigem,
    });

    await db.update(schema.documents)
      .set({ processado: true, atualizadoEm: new Date() })
      .where(eq(schema.documents.id, id));

    const updated = await db.query.documents.findFirst({
      where: eq(schema.documents.id, id),
    });

    res.json({
      document: updated ?? existing,
      chunksCreated,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro interno do servidor';
    logger.error({ error }, 'Falha ao atualizar documento');
    res.status(500).json({ error: errorMessage });
  }
});

app.post('/api/rag/documents/upload', requireAuth(), requirePermission('rag:documents:upload'), requireSameTenant(getTenantIdFromRequest), upload.single('file'), async (req: MulterRequest, res: Response) => {
  // SEGURANÇA: Usar req.tenantId populado pelo middleware (RLS Enterprise)
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  }

  // Validação de segurança enterprise unificada (Regra 16)
  const validation = validateDocumentUpload(req.file);
  if (!validation.valid) {
    logger.warn({ 
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      error: validation.error,
    }, 'Upload de documento rejeitado por validação de segurança');
    return res.status(400).json({ error: validation.error });
  }

  try {
    const content = req.file.buffer.toString('utf-8');
    const titulo = req.body.titulo || req.file.originalname;
    const namespaceId = req.body.namespaceId;
    if (!namespaceId) {
      return res.status(400).json({ error: 'Namespace obrigatório' });
    }
    await assertNamespaceOwnership(namespaceId, req.tenantId as string);

    const hashConteudo = hashContent(content);

    const documentEmbedding = await generateEmbedding(content.slice(0, 2000));
    
    // Validar dimensão antes de salvar (Enterprise-Grade - Regra 6)
    validateEmbeddingDimension(documentEmbedding, EMBEDDING_DIMENSIONS.TEXT, 'TEXT');

    // MULTI-TENANCY: Documento associado ao tenant via namespaceId
    // namespaceId deve pertencer ao tenant do usuário (validado pelo backend)
    // Gate 2: Embeddings de TEXTO são SSOT no Qdrant (PostgreSQL mantém apenas conteúdo/metadados).
    const [document] = await db.insert(schema.documents).values({
      namespaceId,
      titulo,
      conteudo: content,
      tipo: req.file.mimetype,
      hashConteudo,
      // embedding OMITIDO - texto vai para Qdrant (SSOT)
      processado: false,
    }).returning();
    
    // Armazenar embedding do documento inteiro no Qdrant para busca semântica
    if (documentEmbedding.length > 0 && isQdrantConfigured()) {
      await upsertPoints(TEXT_COLLECTION_NAME, [{
        id: `document-${document.id}`,
        vector: documentEmbedding,
        payload: {
          type: 'document',
          documentId: document.id,
          titulo: titulo,
          tenantId: req.tenantId,
          namespaceId: namespaceId,
          nomeArquivo: req.file?.originalname,
          tipoArquivo: req.file?.mimetype,
          conteudoPreview: content.slice(0, 500),
          criadoEm: new Date().toISOString(),
        },
      }]);
      logger.debug({ documentId: document.id }, 'Embedding de documento inserido no Qdrant');
    }

    const chunks = chunkText(content);
    
    // Gate 2: Inserir chunks no PostgreSQL (conteúdo) e no Qdrant (vetores)
    // PostgreSQL: Persistência relacional e backup
    // Qdrant: Busca semântica vetorial (1024 dim - Qwen3-Embedding-0.6B)
    const qdrantPoints = [];
    const createdChunks: Array<{ id: string; conteudo: string; posicao: number }> = [];
    
    for (let i = 0; i < chunks.length; i++) {
      const embedding = await generateEmbedding(chunks[i]);
      
      // Validar dimensão antes de salvar (Enterprise-Grade - Regra 6)
      validateEmbeddingDimension(embedding, EMBEDDING_DIMENSIONS.TEXT, 'TEXT');
      
      // Inserir no PostgreSQL (persistência relacional - SEM embedding)
      // Gate 2: Embeddings de texto vão APENAS para Qdrant (PostgreSQL armazena somente conteúdo/metadata)
      const [chunk] = await db.insert(schema.documentChunks).values({
        documentId: document.id,
        conteudo: chunks[i],
        posicao: i,
        // embedding OMITIDO - texto usa Qdrant (SSOT)
      }).returning();

      createdChunks.push({ id: chunk.id, conteudo: chunks[i], posicao: i });
      
      // Preparar ponto para Qdrant (busca vetorial - 1024 dim)
      qdrantPoints.push({
        id: chunk.id,
        vector: embedding,
        payload: {
          type: 'document_chunk',
          documentId: document.id,
          conteudo: chunks[i],
          posicao: i,
          tenantId: req.tenantId,
          namespaceId: namespaceId,
          document_id: document.id,
          document_titulo: titulo,
          document_nomeArquivo: req.file?.originalname,
          document_namespaceId: namespaceId,
          criadoEm: new Date().toISOString(),
        }
      });
    }
    
    // Inserir todos os chunks no Qdrant em batch (performance enterprise)
    if (qdrantPoints.length > 0 && isQdrantConfigured()) {
      await upsertPoints(TEXT_COLLECTION_NAME, qdrantPoints);
      logger.info({ documentId: document.id, pointsInserted: qdrantPoints.length }, 'Chunks inseridos no Qdrant');
    }

    await db.update(schema.documents)
      .set({ processado: true })
      .where(eq(schema.documents.id, document.id));

    // Invalidação de cache RAG: documento novo altera resultados de busca/contexto
    if (req.tenantId) {
      await invalidateRagCachesForTenant(req.tenantId);
    }

    const user = getAuthUser(req);
    await collectTrainingFromDocumentChunks({
      tenantId: req.tenantId as string,
      namespaceId,
      documentId: document.id,
      titulo,
      chunks: createdChunks,
      userId: user.id,
      role: user.role,
    });

    logger.info({ documentId: document.id, filename: req.file?.originalname }, 'Arquivo enviado e processado');
    res.json({ document, chunksCreated: chunks.length });
  } catch (error) {
    logger.error({ error }, 'Falha ao enviar documento');
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

app.delete('/api/rag/documents/:id', requireAuth(), requirePermission('rag:documents:delete'), requireSameTenant(getTenantIdFromRequest), async (req: Request, res: Response) => {
  // OWASP API3: Validação Zod obrigatória de parâmetros de rota
  const paramsResult = uuidParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID inválido', details: paramsResult.error.format() });
  }
  const { id } = paramsResult.data;
  
  // SEGURANÇA: Usar req.tenantId populado pelo middleware (RLS Enterprise)
  const tenantId = req.tenantId;

  try {
    // MULTI-TENANCY: Verificar se documento pertence ao tenant via namespace
    const document = await db.query.documents.findFirst({
      with: { namespace: true },
      where: eq(schema.documents.id, id),
    });
    
    // Verificar se documento existe e pertence ao tenant
    if (!document || document.namespace?.tenantId !== tenantId) {
      return res.status(404).json({ error: 'Documento não encontrado ou acesso negado' });
    }
    
    await db.delete(schema.documentChunks)
      .where(eq(schema.documentChunks.documentId, id));

    await db.delete(schema.documents)
      .where(eq(schema.documents.id, id));

    // Invalidação de cache RAG: exclusão altera resultados de busca/contexto
    if (tenantId) {
      await invalidateRagCachesForTenant(tenantId);
    }

    logger.info({ documentId: id, tenantId }, 'Documento excluído');
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Falha ao excluir documento');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.get('/api/rag/namespaces/:id/stats', requirePermission('rag:namespaces:read'), async (req: Request, res: Response) => {
  // OWASP API3: Validação Zod obrigatória de parâmetros de rota
  const paramsResult = uuidParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID inválido', details: paramsResult.error.format() });
  }
  const { id } = paramsResult.data;

  try {
    const documents = await db.query.documents.findMany({
      where: eq(schema.documents.namespaceId, id),
    });

    const totalDocuments = documents.length;
    const processedDocuments = documents.filter(d => d.processado).length;

    const chunks = await db.select({ count: sql<number>`count(*)` })
      .from(schema.documentChunks)
      .innerJoin(schema.documents, eq(schema.documentChunks.documentId, schema.documents.id))
      .where(eq(schema.documents.namespaceId, id));

    res.json({
      totalDocuments,
      processedDocuments,
      totalChunks: chunks[0]?.count || 0,
    });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter estatísticas');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ============================================================================
// AGENTIC RAG ENDPOINTS - Busca híbrida inteligente
// ============================================================================

const agenticSearchSchema = z.object({
  query: z.string().min(1),
  namespaceId: z.string().uuid().optional(),
  limit: z.coerce.number().min(1).max(20).default(5),
  threshold: z.coerce.number().min(0).max(1).default(0.6),
  forceMode: z.enum(['internal', 'web', 'hybrid']).optional(),
  webMode: z.enum(['web', 'deepweb']).optional(),
});

const webSearchSchema = z.object({
  query: z.string().min(1),
  limit: z.coerce.number().min(1).max(20).default(5),
  mode: z.enum(['web', 'deepweb']).optional(),
  engines: z.array(z.string().min(1)).optional(),
  categories: z.string().min(1).optional(),
  language: z.string().min(2).optional(),
  safesearch: z.string().min(1).optional(),
  timeRange: z.enum(['day', 'week', 'month', 'year']).optional(),
});

const webImageSearchSchema = z.object({
  query: z.string().min(1),
  limit: z.coerce.number().min(1).max(12).default(5),
});

app.post('/api/rag/web-search', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { query, limit, mode, engines, categories, language, safesearch, timeRange } = webSearchSchema.parse(req.body);
    
    if (!webSearchClient.isEnabled()) {
      return res.status(503).json({ 
        error: 'Busca web não configurada', 
        message: 'SEARXNG_SECRET_KEY não está configurada',
      });
    }

    const options: WebSearchOptions | undefined = mode === 'deepweb'
      ? { engines: ['ahmia'] }
      : {
        engines,
        categories,
        language,
        safesearch,
        timeRange,
      };
    const results = await webSearch(query, limit, options);
    
    logger.info({ query, results: results.length }, 'Busca web concluída');
    res.json({ results, source: 'searxng' });
  } catch (error) {
    logger.error({ error }, 'Falha na busca web');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.post('/api/rag/web-search/images', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { query, limit } = webImageSearchSchema.parse(req.body);

    if (!webSearchClient.isEnabled()) {
      return res.status(503).json({
        error: 'Busca web não configurada',
        message: 'SEARXNG_SECRET_KEY não está configurada',
      });
    }

    const results = await webSearchClient.searchImages(query, limit, { categories: 'images' });

    logger.info({ query, results: results.length }, 'Busca de imagens na web concluída');
    res.json({ results, source: 'searxng' });
  } catch (error) {
    logger.error({ error }, 'Falha na busca de imagens na web');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.post('/api/rag/classify', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { query } = req.body;
    
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Query é obrigatória' });
    }

    const classification = classifyQuery(query);
    
    res.json({ 
      query, 
      classification,
      webSearchAvailable: webSearchClient.isEnabled(),
    });
  } catch (error) {
    logger.error({ error }, 'Falha na classificação');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// SEGURANÇA: Usar req.tenantId populado pelo middleware requireAuth
// Alinhado com Express.js 2025 + OWASP 2025 best practices
function getTenantIdFromRequest(req: Request): string {
  return req.tenantId as string;
}

app.post('/api/rag/agentic', requireAuth(), requireSameTenant(getTenantIdFromRequest), async (req: Request, res: Response) => {
  // SEGURANÇA: Usar req.tenantId populado pelo middleware
  const tenantId = req.tenantId;
  
  if (!tenantId) {
    return res.status(401).json({ error: 'Autenticação necessária' });
  }

  try {
    const body = agenticSearchSchema.parse(req.body);
    
    const classification = body.forceMode 
      ? { type: body.forceMode, confidence: 1, reason: 'Modo forçado pelo usuário' }
      : classifyQuery(body.query);
    const resolvedWebMode = body.webMode ?? classification.webMode ?? 'web';
    
    const results: {
      internal: Array<{ documentId: string; titulo?: string; conteudo: string; similarity: number }>;
      web: WebSearchResult[];
      classification: ClassificationResult;
    } = {
      internal: [],
      web: [],
      classification,
    };

    if (classification.type === 'internal' || classification.type === 'hybrid') {
      // ============================================================================
      // BUSCA VETORIAL VIA QDRANT (Enterprise-Grade - 17/12/2025)
      // ============================================================================
      // Gate 2: Embeddings de texto com Qwen3-Embedding-0.6B (1024 dim) → Qdrant
      // PERFORMANCE: Índice HNSW otimizado (dim=1024)
      // MULTI-TENANCY: Filtro via payload (tenantId) no Qdrant
      // ============================================================================
      
      if (!isQdrantConfigured()) {
        logger.warn('Qdrant não configurado - busca interna indisponível para agentic');
      } else {
        const queryEmbedding = await generateEmbedding(body.query);
        
        // Buscar documentos similares via Qdrant
        results.internal = await searchDocumentsForContext(queryEmbedding, tenantId, {
          limit: body.limit,
          threshold: body.threshold,
          namespaceId: body.namespaceId,
        });
      }
    }

    if ((classification.type === 'web' || classification.type === 'hybrid') && webSearchClient.isEnabled()) {
      const webOptions: WebSearchOptions | undefined = resolvedWebMode === 'deepweb'
        ? { engines: ['ahmia'] }
        : undefined;
      results.web = await webSearch(body.query, body.limit, webOptions);
    }

    const context = buildAgenticContext(results.internal, results.web);

    logger.info({ 
      query: body.query, 
      tenantId,
      classification: classification.type,
      internalResults: results.internal.length,
      webResults: results.web.length,
    }, 'Busca agentic concluída');

    res.json({ 
      ...results,
      context,
      sources: {
        internal: results.internal.map(r => ({
          documentId: r.documentId,
          titulo: r.titulo,
          similarity: r.similarity,
        })),
        web: results.web.map(r => ({
          title: r.title,
          url: r.url,
        })),
      },
    });
  } catch (error) {
    logger.error({ error }, 'Falha na busca agentic');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

function buildAgenticContext(
  internal: Array<{ titulo?: string; conteudo: string; similarity: number }>,
  web: WebSearchResult[]
): string {
  const parts: string[] = [];

  if (internal.length > 0) {
    parts.push('## Documentos Internos\n');
    internal.forEach((doc, i) => {
      parts.push(`### ${i + 1}. ${doc.titulo || 'Documento sem título'} (Relevância: ${(doc.similarity * 100).toFixed(0)}%)`);
      parts.push(doc.conteudo);
      parts.push('');
    });
  }

  if (web.length > 0) {
    parts.push('\n## Resultados da Web\n');
    web.forEach((result, i) => {
      parts.push(`### ${i + 1}. ${result.title}`);
      parts.push(`Fonte: ${result.url}`);
      parts.push(result.description);
      parts.push('');
    });
  }

  return parts.join('\n');
}

app.get('/api/rag/agentic/status', requireAuth(), async (_req: Request, res: Response) => {
  const embeddingsState = gpuManagerEmbeddingsBreaker.opened ? 'open' : (gpuManagerEmbeddingsBreaker.halfOpen ? 'half-open' : 'closed');
  const webSearchState = webSearchClient.breakerState();

  res.json({
    webSearchEnabled: webSearchClient.isEnabled(),
    circuitBreakers: {
      embeddings: {
        state: embeddingsState,
        stats: {
          failures: gpuManagerEmbeddingsBreaker.stats.failures,
          successes: gpuManagerEmbeddingsBreaker.stats.successes,
          timeouts: gpuManagerEmbeddingsBreaker.stats.timeouts,
        },
      },
      webSearch: {
        state: webSearchState.state,
        stats: webSearchState.stats,
      },
    },
    classificationKeywords: {
      web: WEB_SEARCH_KEYWORDS.length,
      internal: INTERNAL_KEYWORDS.length,
    },
  });
});

// ============================================================================
// LEARNING ORCHESTRATOR - Fila priorizada com RLS
// ============================================================================

const learningTaskCreateSchema = z.object({
  tipo: z.string().min(1),
  prioridade: z.number().int().min(1).max(10).optional(),
  agentId: z.string().uuid().optional().nullable(),
  namespaceId: z.string().uuid().optional().nullable(),
  parametros: z.record(z.string(), z.unknown()).optional(),
  maxTentativas: z.number().int().min(1).max(10).optional(),
  agendadoPara: z.string().datetime().optional(),
});

const learningTaskStatusSchema = z.object({
  status: z.enum(['pending', 'processing', 'completed', 'failed', 'cancelled']),
  progresso: z.number().int().min(0).max(100).optional(),
  erro: z.string().optional().nullable(),
  resultado: z.record(z.string(), z.unknown()).optional().nullable(),
});

const learningTaskParamsSchema = z.object({
  id: z.string().uuid(),
});

app.post('/api/learning/tasks', requireAuth(), requireSameTenant(getTenantIdFromRequest), async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(401).json({ error: 'Autenticação necessária' });

  const user = getAuthUser(req);
  const isSuperAdmin = user.role === 'super_admin';

  try {
    const body = learningTaskCreateSchema.parse(req.body);

    const task = await withTenantContext(tenantId, isSuperAdmin, (tenantDb) =>
      createLearningTask(tenantDb, logger, {
        tenantId,
        tipo: body.tipo,
        prioridade: body.prioridade,
        agentId: body.agentId ?? null,
        namespaceId: body.namespaceId ?? null,
        parametros: body.parametros,
        maxTentativas: body.maxTentativas,
        agendadoPara: body.agendadoPara ? new Date(body.agendadoPara) : null,
        criadoPor: user.id ?? null,
      })
    );

    res.status(201).json({ task });
  } catch (error) {
    logger.error({ error }, 'Falha ao criar learning task');
    res.status(400).json({ error: (error as Error).message });
  }
});

app.post('/api/learning/tasks/dequeue', requireAuth(), requireSameTenant(getTenantIdFromRequest), async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(401).json({ error: 'Autenticação necessária' });

  const user = getAuthUser(req);
  const isSuperAdmin = user.role === 'super_admin';

  try {
    const task = await withTenantContext(tenantId, isSuperAdmin, (tenantDb) =>
      dequeueNextLearningTask(tenantDb, logger, tenantId)
    );

    res.json({ task });
  } catch (error) {
    logger.error({ error }, 'Falha ao dequeuer learning task');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.post('/api/learning/tasks/:id/status', requireAuth(), requireSameTenant(getTenantIdFromRequest), async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(401).json({ error: 'Autenticação necessária' });

  const user = getAuthUser(req);
  const isSuperAdmin = user.role === 'super_admin';

  try {
    const body = learningTaskStatusSchema.parse(req.body);
    const { id: taskId } = learningTaskParamsSchema.parse(req.params);

    await withTenantContext(tenantId, isSuperAdmin, (tenantDb) =>
      updateLearningTaskStatus(tenantDb, logger, {
        taskId,
        tenantId,
        status: body.status,
        progresso: body.progresso,
        erro: body.erro ?? null,
        resultado: body.resultado ?? null,
      })
    );

    if (body.status === 'completed') {
      metrics.training.completedJobsTotal.inc();
    } else if (body.status === 'failed') {
      metrics.training.failedJobsTotal.inc();
    }

    res.json({ ok: true });
  } catch (error) {
    logger.error({ error }, 'Falha ao atualizar status de learning task');
    res.status(400).json({ error: (error as Error).message });
  }
});

// ============================================================================
// MULTIMODAL UPLOAD - Fase 9
// ============================================================================

const mediaUploadSchema = z.object({
  conversationId: z.string().uuid().optional(),
  messageId: z.string().uuid().optional(),
  description: z.string().optional(),
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
});

// ============================================================================
// OWASP API3 - Schemas Zod para validação de query params
// Previne type coercion issues e input tampering
// ============================================================================

// Schema para query params de documentos
const documentsQuerySchema = z.object({
  namespaceId: z.string().uuid().optional(),
});

// Schema para query params de paginação com filtros de mídia
const mediaUploadsQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/).transform(Number).refine(n => n >= 1 && n <= 100, 'limit deve ser entre 1 e 100').optional(),
  offset: z.string().regex(/^\d+$/).transform(Number).refine(n => n >= 0, 'offset deve ser >= 0').optional(),
  // ATUALIZADO 23/12/2025: Removido 'video' (muito pesado para GPU)
  mediaType: z.enum(['image', 'audio', 'document']).optional(),
  conversationId: z.string().uuid().optional(),
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
    logger.error({ error, tenantId }, 'Falha no upload JSON de mídia');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET status de um upload específico
app.get('/api/media/:id', requireAuth(), requireSameTenant(getTenantIdFromRequest), async (req: Request, res: Response) => {
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
    const { mediaType, conversationId } = queryResult.data;

    const whereConditions = [eq(schema.mediaUploads.tenantId, tenantId)];
    
    if (mediaType) {
      whereConditions.push(eq(schema.mediaUploads.mediaType, mediaType as MediaType));
    }
    
    if (conversationId) {
      whereConditions.push(eq(schema.mediaUploads.conversationId, conversationId));
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
  const { tenantId, mediaType, filename } = req.params;
  
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

// Status do circuit breaker OpenAI Vision (Regra 16 - Observability)
app.get('/api/rag/circuit-breaker/embeddings', (_req: Request, res: Response) => {
  const visionStatus = getVisionCircuitBreakerStatus();

  res.json({
    service: 'openai',
    timestamp: new Date().toISOString(),
    circuitBreakers: {
      vision: visionStatus,
    },
  });
});

// ============================================================================
// EMBEDDING QUEUE - Processamento Assíncrono (GPU Dedicada 24/7)
// ============================================================================

/**
 * Enfileira job de embedding para processamento assíncrono
 * Retorna imediatamente com jobId para consulta posterior
 */
app.post('/api/rag/embeddings/queue',
  requireAuth(),
  async (req: Request, res: Response) => {
    try {
      const { tenantId } = getAuthUser(req);
      
      if (!tenantId) {
        return res.status(401).json({ error: 'Tenant não identificado' });
      }
      
      if (!isQueueAvailable()) {
        return res.status(503).json({ 
          error: 'Fila de embeddings não disponível',
          detail: 'Redis não está conectado',
        });
      }
      
      const body = req.body as {
        type: EmbeddingJobType;
        text?: string;
        texts?: string[];
        priority?: number;
        metadata?: {
          source?: string;
          correlationId?: string;
          originalFilename?: string;
        };
      };
      
      if (!body.type) {
        return res.status(400).json({ error: 'Campo "type" é obrigatório' });
      }
      
      // Validar input conforme o tipo
      if (body.type === 'text' && !body.text) {
        return res.status(400).json({ error: 'Campo "text" é obrigatório para este tipo' });
      }
      
      if (body.type === 'batch-text' && (!body.texts || body.texts.length === 0)) {
        return res.status(400).json({ error: 'Campo "texts" é obrigatório para batch de texto' });
      }
      
      
      const jobId = await enqueueEmbeddingJob({
        type: body.type,
        tenantId,
        userId: getAuthUser(req).id,
        priority: body.priority ?? 5,
        input: {
          text: body.text,
          texts: body.texts,
        },
        metadata: body.metadata,
      });
      
      logger.info({
        jobId,
        type: body.type,
        tenantId,
        gpuAvailable: true, // GPU dedicada Hetzner GEX44 24/7
      }, 'Job de embedding enfileirado');
      
      res.status(202).json({
        jobId,
        status: 'pending',
        message: 'Job enfileirado para processamento',
        gpuStatus: {
          available: true, // GPU dedicada Hetzner GEX44 - sempre disponível
          dedicatedServer: true, // 24/7 - sem cold start
          estimatedWaitMs: 1000, // GPU sempre disponível
        },
        statusUrl: `/api/rag/embeddings/queue/${jobId}`,
      });
    } catch (error) {
      logger.error({ error }, 'Erro ao enfileirar job de embedding');
      res.status(500).json({ error: 'Erro interno do servidor' });
    }
  }
);

/**
 * Estatísticas da fila de embeddings e WebSocket
 * IMPORTANTE: Esta rota estática DEVE vir ANTES da rota parametrizada /:jobId
 * para evitar que Express capture "stats" como jobId
 */
app.get('/api/rag/embeddings/queue/stats',
  requireAuth(),
  async (_req: Request, res: Response) => {
    try {
      const queueStats = await getEmbeddingQueueStats();
      const workerStatus = await getEmbeddingWorkerStatus();
      const wsStats = getWebSocketStats();
      
      res.json({
        queue: queueStats,
        worker: workerStatus,
        websocket: wsStats,
        gpuDedicated: true, // GPU Hetzner GEX44 24/7
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ error }, 'Erro ao obter estatísticas da fila');
      res.status(500).json({ error: 'Erro interno do servidor' });
    }
  }
);

/**
 * Consulta status de um job de embedding
 * NOTA: Esta rota parametrizada deve vir APÓS rotas estáticas como /stats
 */
app.get('/api/rag/embeddings/queue/:jobId',
  requireAuth(),
  async (req: Request, res: Response) => {
    try {
      const { tenantId } = getAuthUser(req);
      const { jobId } = req.params;
      
      if (!tenantId) {
        return res.status(401).json({ error: 'Tenant não identificado' });
      }
      
      const job = await getEmbeddingJobStatus(jobId);
      
      if (!job) {
        return res.status(404).json({ error: 'Job não encontrado' });
      }
      
      // Verificar isolamento de tenant
      if (job.tenantId !== tenantId) {
        return res.status(403).json({ error: 'Acesso negado a este job' });
      }
      
      res.json({
        jobId: job.id,
        type: job.type,
        status: job.status,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        error: job.error,
        result: job.status === 'completed' ? job.result : undefined,
        metadata: job.metadata,
      });
    } catch (error) {
      logger.error({ error }, 'Erro ao consultar job de embedding');
      res.status(500).json({ error: 'Erro interno do servidor' });
    }
  }
);

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

// CORREÇÃO 23/12/2025: Inicializar Redis cache ANTES de iniciar o servidor
// Evita race condition onde clientes WebSocket podem conectar antes do Redis estar pronto
// O embedding-websocket usa getRedisClient() que precisa do cliente inicializado
// ENTERPRISE-GRADE: Servidor só aceita conexões após dependências críticas estarem prontas (Regra 6)
// BUG FIX 23/12/2025: Converter para async/await para melhor controle de erros e evitar unhandled rejections
(async () => {
  try {
    setPermissionResolver(async (auth) => {
      const db = getDatabase();
      let customRoleId = auth.customRoleId;
      if (!customRoleId) {
        const user = await db.query.users.findFirst({
          where: eq(schema.users.id, auth.userId),
          columns: { customRoleId: true },
        });
        customRoleId = user?.customRoleId ?? undefined;
      }
      const isAdminRole = auth.role === 'admin' || auth.role === 'super_admin';
      const rolePermissions = isAdminRole
        ? await db.query.permissions.findMany({ columns: { codigo: true } })
        : await db.query.rolePermissions.findMany({
          where: eq(schema.rolePermissions.role, auth.role),
          with: { permission: true },
        });
      const customRolePermissions = customRoleId
        ? await db.query.customRolePermissions.findMany({
          where: eq(schema.customRolePermissions.customRoleId, customRoleId),
          with: { permission: true },
        })
        : [];
      return [
        ...rolePermissions
          .map((rp) => ('codigo' in rp ? rp.codigo : (rp as { permission?: { codigo?: string | null } }).permission?.codigo))
          .filter((code): code is string => Boolean(code)),
        ...customRolePermissions
          .map((rp) => (rp as { permission?: { codigo?: string | null } }).permission?.codigo)
          .filter((code): code is string => Boolean(code)),
      ];
    });

    // Inicializar Redis cache (crítico para embedding-websocket Pub/Sub)
    // BUG FIX 23/12/2025: Unificar tratamento de erro - uma única verificação após try-catch
    // Evita múltiplos pontos de exit e lógica duplicada
    // BUG FIX 23/12/2025: Garantir que redisConnected seja sempre definido explicitamente
    // Evita comportamento indefinido onde exceções podem deixar variável em estado inconsistente
    let redisConnected = false;
    try {
      redisConnected = await initializeRedisCache();
      // Garantir que redisConnected seja boolean explícito (não undefined)
      redisConnected = Boolean(redisConnected);
    } catch (redisError) {
      // Se initializeRedisCache() lançar exceção, tratar como falha crítica
      // IMPORTANTE: Definir redisConnected explicitamente como false para evitar estado indefinido
      redisConnected = false;
      logger.error({ error: redisError }, 'CRITICAL: Falha ao inicializar Redis cache - exceção lançada');
      // Não re-lançar exceção - já tratamos acima e definimos redisConnected = false
      // Verificação unificada abaixo tratará tanto false quanto exceções de forma consistente
    }
    
    // CORREÇÃO PR#107 (WS4): Inicializar cache de sessões HTTP (sessão + JWT OIDC)
    // - Em produção: Redis distribuído é obrigatório (fail-fast dentro de initializeSessionAuthCache)
    // - Em dev/test: cache fica desabilitado (sem in-memory)
    await initializeSessionAuthCache();

    // BUG FIX 23/12/2025: Verificação unificada - redisConnected sempre definido (true ou false)
    // Trata tanto retorno false quanto exceções de forma consistente
    // Evita múltiplos pontos de exit e lógica duplicada
    if (redisConnected) {
      logger.info('Redis cache inicializado para embedding-websocket');
    } else {
      // BUG FIX 23/12/2025: Redis é crítico para embedding-websocket Pub/Sub
      // Se Redis não estiver disponível, embedding-websocket não pode funcionar corretamente
      // Fail-fast em produção (Regra 6 - sem workarounds)
      // ÚNICO ponto de exit para falha de Redis - evita confusão sobre qual caminho foi tomado
      if (isProduction) {
        logger.error('CRITICAL: Redis é OBRIGATÓRIO para embedding-websocket Pub/Sub em produção. Abortando.');
        process.exit(1);
      } else {
        logger.warn('Redis cache não disponível - WebSocket funcionará sem Pub/Sub (modo desenvolvimento)');
      }
    }

    // Inicializar cache RAG (apenas se Redis distribuído estiver disponível)
    if (redisConnected) {
      const searchAdapter = createCacheAdapter<RagSearchResponse>('rag-search', RAG_QUERY_CACHE_TTL_MS);
      if (searchAdapter.isDistributed()) {
        ragSearchCache = searchAdapter;
      } else {
        ragSearchCache = null;
        logger.warn('Cache RAG (search) desabilitado: adapter não é distribuído');
      }

      const contextAdapter = createCacheAdapter<RagContextResponse>('rag-context', RAG_QUERY_CACHE_TTL_MS);
      if (contextAdapter.isDistributed()) {
        ragContextCache = contextAdapter;
      } else {
        ragContextCache = null;
        logger.warn('Cache RAG (context) desabilitado: adapter não é distribuído');
      }
    } else {
      // Sem in-memory: em dev/test, apenas não cacheamos.
      ragSearchCache = null;
      ragContextCache = null;
      logger.info('Cache RAG desabilitado (Redis indisponível)');
    }
    
    // BUG FIX 23/12/2025: Criar servidor HTTP mas NÃO iniciar ainda
    // Isso permite inicializar WebSocket ANTES de aceitar conexões
    // app.listen() começa a aceitar conexões imediatamente, causando race condition
    // Solução: Criar servidor manualmente, inicializar WebSocket, depois iniciar servidor
    const server = http.createServer(app);
    
    // BUG FIX 23/12/2025: Inicializar Qdrant collection ANTES de iniciar servidor HTTP
    // Isso garante que a collection text_embeddings exista antes de aceitar requisições
    if (isQdrantConfigured()) {
      try {
        await initTextCollection();
        logger.info({ 
          collection: TEXT_COLLECTION_NAME, 
          dimension: TEXT_EMBEDDING_DIM 
        }, 'Coleção Qdrant para embeddings de texto inicializada');
      } catch (error) {
        logger.error({ error }, 'Falha ao inicializar coleção Qdrant - servidor não iniciará');
        throw error; // Fail-fast se Qdrant não puder ser inicializado
      }
    } else {
      logger.warn('Qdrant não configurado (QDRANT_URL/QDRANT_API_KEY) - buscas de texto indisponíveis');
    }
    
    // BUG FIX 23/12/2025: Inicializar WebSocket ANTES de iniciar servidor HTTP
    // Isso garante que Redis Pub/Sub esteja pronto antes de aceitar qualquer conexão
    // Evita race condition onde clientes conectam antes do Redis estar inicializado
    // BUG FIX 23/12/2025: Em desenvolvimento, se Redis não estiver disponível, initEmbeddingWebSocket
    // permite WebSocket funcionar sem Pub/Sub (funcionalidade limitada) ao invés de crashar
    try {
      await initEmbeddingWebSocket(server);
      logger.info({ path: '/ws/embeddings' }, 'WebSocket para notificações de embeddings ativo');
    } catch (error) {
      // Em produção, erro já foi logado e propagado por initEmbeddingWebSocket
      // Em desenvolvimento, erro não deve ocorrer (função permite operação sem Redis)
      // Mas se ocorrer, tratar como erro crítico
      logger.error({ error }, 'CRITICAL: Falha ao inicializar WebSocket - abortando');
      throw error;
    }
    
    // BUG FIX 23/12/2025: Registrar shutdown callbacks específicos do servidor ANTES de server.listen()
    // Se o servidor falhar ao fazer bind na porta, server.on('error') chama process.exit(1)
    // Os callbacks devem estar registrados ANTES para garantir cleanup mesmo em falhas de inicialização
    // NOTA: Callback de database pool já está registrado fora do IIFE para garantir cleanup mesmo se inicialização falhar
    registerShutdownCallback(
      'rag-websocket-server',
      async () => {
        logger.info('Encerrando WebSocket server...');
        // BUG FIX 23/12/2025: closeEmbeddingWebSocket() é async e precisa de await
        // Sem await, cleanup (heartbeat intervals, Redis subscriber) pode não completar antes do shutdown
        // Isso causa resource leaks e conexões pendentes
        await closeEmbeddingWebSocket();
        logger.info('WebSocket server encerrado com sucesso');
      },
      { priority: ShutdownPriority.WEBSOCKET }
    );
    
    registerShutdownCallback(
      'rag-http-server',
      async () => {
        logger.info('Encerrando HTTP server...');
        await new Promise<void>((resolve, reject) => {
          server.close((err) => {
            if (err) {
              logger.error({ error: err }, 'Erro ao fechar HTTP server');
              reject(err);
            } else {
              logger.info('HTTP server encerrado com sucesso');
              resolve();
            }
          });
        });
      },
      { priority: ShutdownPriority.HTTP_SERVER }
    );
    
    // Configurar timeouts do servidor
    server.timeout = 60000; // 60s para processamento de embeddings/uploads
    server.keepAliveTimeout = 65000; // 65s (maior que ALB timeout padrão de 60s)
    server.headersTimeout = 66000; // Ligeiramente maior que keepAliveTimeout
    
    // BUG FIX 23/12/2025: Capturar erros assíncronos de inicialização do servidor (ex: porta em uso)
    // server.listen() emite evento 'error' se falhar após callback ser chamado
    // Isso previne unhandled promise rejections e garante fail-fast adequado
    // IMPORTANTE: Callbacks de shutdown já estão registrados acima, então cleanup será executado mesmo se servidor falhar
    server.on('error', (err: NodeJS.ErrnoException) => {
      logger.error({ 
        error: err.message, 
        code: err.code,
        port: PORT,
        stack: err.stack,
      }, 'Falha crítica ao iniciar servidor HTTP - abortando');
      // ENTERPRISE-GRADE: Fail-fast se servidor não pode iniciar (Regra 6 - sem workarounds)
      // Callbacks de shutdown já estão registrados, então cleanup será executado durante process.exit()
      process.exit(1);
    });
    
    // BUG FIX 23/12/2025: Iniciar servidor HTTP APÓS WebSocket estar pronto E callbacks registrados
    // Agora que Redis Pub/Sub está inicializado e callbacks de shutdown estão registrados,
    // podemos aceitar conexões com segurança e garantir cleanup mesmo em falhas
    server.listen(PORT, () => {
      logger.info({ 
        port: PORT, 
        gpuManagerUrl: GPU_MANAGER_URL,
        qdrantConfigured: isQdrantConfigured(),
        qdrantUrl: process.env.QDRANT_URL || 'not_configured',
        architecture: {
          text: 'Qwen3-Embedding-0.6B (1024 dim) → Qdrant',
          image: 'OpenAI Vision (descrição) - sem embeddings de imagem',
        },
        circuitBreaker: 'enabled',
        gpuDedicated: true, // Hetzner GEX44 24/7
        redisConnected,
      }, 'RAG service iniciado - ARQUITETURA ENTERPRISE (26/12/2025) via GPU Manager Service');
    });
  } catch (error) {
    // BUG FIX 23/12/2025: Capturar TODOS os erros (síncronos e assíncronos) da inicialização
    // async/await garante que erros sejam propagados corretamente e capturados aqui
    // Isso previne unhandled promise rejections e garante fail-fast adequado
    logger.error({ 
      error: (error as Error).message,
      stack: (error as Error).stack,
    }, 'Falha crítica ao inicializar servidor - abortando');
    // ENTERPRISE-GRADE: Fail-fast se inicialização falhar (Regra 6 - sem workarounds)
    process.exit(1);
  }
})().catch((error) => {
  // BUG FIX 23/12/2025: Adicionar catch handler explícito para prevenir unhandled promise rejections
  // Se qualquer erro assíncrono ocorrer fora do try-catch (ex: em callbacks de logger, promises não aguardadas),
  // será capturado aqui. Isso previne crashes silenciosos e garante que todos os erros sejam logados antes de exit
  logger.error({ 
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  }, 'CRITICAL: Unhandled rejection na inicialização do RAG service - abortando');
  process.exit(1);
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
