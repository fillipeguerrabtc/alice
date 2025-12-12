/**
 * RAG Service - Alice Enterprise Platform
 * 
 * Serviço de Retrieval-Augmented Generation com pgvector para embeddings.
 * Implementa Circuit Breaker pattern (Regra 16 - Best Practices 2025).
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
// helmet aplicado via createSecurityMiddleware de @alice/shared-utils
import compression from 'compression';
// rateLimit via createRateLimiter de @alice/shared-utils
import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
// CircuitBreaker via createCircuitBreaker de @alice/shared-utils
import { getDatabase, getPool, schema, toSql, closeDatabasePool, isPoolHealthy, createDrizzleFeatureFlagStorage, validateEmbeddingDimension, EMBEDDING_DIMENSIONS, withTenantContext } from '@alice/database';
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
  setupSwaggerUI,
  RAG_SERVICE_TAGS,
} from '@alice/shared-utils';
import { ragServicePaths, ragServiceSchemas } from './openapi-specs.js';
import { createLogger } from '@alice/logger';
import { resolveClipServiceUrl } from './clip-service-url.js';
import { getStorageService } from './storage.js';
import { getImageProcessor, CLIP_EMBEDDING_DIM, getClipCircuitBreakerStatus } from './image-processor.js';
import { getAudioProcessor } from './audio-processor.js';
import { getVideoProcessor } from './video-processor.js';
import { getDocumentProcessor } from './document-processor.js';
import { createWebSearchClient, WebSearchResult } from './web-search.js';
import { createLearningTask, dequeueNextLearningTask, updateLearningTaskStatus } from './learning-orchestrator.js';

interface MulterRequest extends Request {
  file?: Express.Multer.File;
}

// ============================================================================
// MULTIMODAL - Tipos de mídia suportados (Fase 9)
// ============================================================================

const SUPPORTED_MEDIA_TYPES = {
  image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  audio: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/mp4'],
  video: ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'],
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
  ...SUPPORTED_MEDIA_TYPES.video,
  ...SUPPORTED_MEDIA_TYPES.document,
];

type MediaType = 'image' | 'audio' | 'video' | 'document';

function detectMediaType(mimeType: string): MediaType | null {
  if (SUPPORTED_MEDIA_TYPES.image.includes(mimeType as typeof SUPPORTED_MEDIA_TYPES.image[number])) return 'image';
  if (SUPPORTED_MEDIA_TYPES.audio.includes(mimeType as typeof SUPPORTED_MEDIA_TYPES.audio[number])) return 'audio';
  if (SUPPORTED_MEDIA_TYPES.video.includes(mimeType as typeof SUPPORTED_MEDIA_TYPES.video[number])) return 'video';
  if (SUPPORTED_MEDIA_TYPES.document.includes(mimeType as typeof SUPPORTED_MEDIA_TYPES.document[number])) return 'document';
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
  'video/mp4': [
    { bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 }, // "ftyp" at offset 4
  ],
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
// CLIP Service URL para processamento multimodal LOCAL (Regra 6 - Autonomia Total)
// Inclui: embeddings (texto + imagem) + transcrição de áudio
const CLIP_SERVICE_URL = resolveClipServiceUrl(logger);
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
// ARQUITETURA MULTIMODAL 100% LOCAL (Regra 6 CLAUDE.md - Autonomia Total)
// ==============================================================================
// TODOS os processamentos multimodais são 100% LOCAIS via CPU no servidor Hetzner:
// - Text embeddings: multilingual-e5-base (768 dim)
// - Image embeddings: CLIP ViT-L/14 (768 dim)
// - Transcrição de áudio: faster-whisper medium
// 
// NÃO dependem de APIs externas - autonomia total
// Serviço: clip-inference-service (Python FastAPI no Hetzner)
// ==============================================================================
//
// SALAD CLOUD é usado APENAS para:
// - chat-service: LLM inference (Llama 4 Maverick 400B)
// - training-service: fine-tuning de modelos
// - image-generation: FLUX.1 Schnell
//
// SALAD_API_KEY NÃO é usada no rag-service (tudo é local)

const SEARXNG_URL = process.env.SEARXNG_URL || 'http://alice-searxng:8080';
const SEARXNG_SECRET_KEY = process.env.SEARXNG_SECRET_KEY;

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

// Upload para mídia multimodal (imagem, áudio, vídeo)
const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { 
    fileSize: 100 * 1024 * 1024, // 100MB para vídeos
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
// CIRCUIT BREAKER - Text Embeddings Local (Regra 6 - Autonomia Total)
// Usa serviço local alice-clip-inference com multilingual-e5-base
// Usa CIRCUIT_BREAKER_PRESETS centralizado (Regra 2 - Não Duplicar)
// ============================================================================

interface TextEmbeddingResponse {
  embedding: number[];
  model: string;
  processing_time_ms: number;
}

async function generateEmbeddingInternal(text: string): Promise<number[]> {
  // REGRA 6: Serviço local autônomo - não depende de API externa
  // Serviço interno na rede Docker privada - não requer autenticação
  const response = await fetch(`${CLIP_SERVICE_URL}/inference/text-embedding`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      context: 'query', // Queries de busca usam prefixo "query: "
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Falha ao gerar embedding: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as TextEmbeddingResponse;
  const resultEmbedding = data.embedding;
  
  if (!resultEmbedding || resultEmbedding.length === 0) {
    throw new Error('Serviço de embeddings retornou resultado vazio');
  }
  
  // Validar dimensão (deve ser 768 para multilingual-e5-base) - Enterprise-Grade
  // Lança erro se dimensão estiver incorreta (não apenas warning)
  validateEmbeddingDimension(resultEmbedding, EMBEDDING_DIMENSIONS.TEXT, 'TEXT');
  
  return resultEmbedding;
}

const embeddingsBreaker = createCircuitBreaker(generateEmbeddingInternal, {
  name: 'text-embeddings-local',
  ...CIRCUIT_BREAKER_PRESETS.textEmbeddings,
});

// Instrumentar circuit breaker com métricas Prometheus
// Type assertion necessária: Opossum CircuitBreaker tem tipos de eventos mais específicos
instrumentCircuitBreaker(metrics, 'text-embeddings-local', embeddingsBreaker as unknown as Parameters<typeof instrumentCircuitBreaker>[2]);

async function generateEmbedding(text: string): Promise<number[]> {
  try {
    return await embeddingsBreaker.fire(text) as number[];
  } catch (error) {
    if (error instanceof Error && error.message.includes('Breaker is open')) {
      logger.warn('Circuit breaker aberto - Embeddings temporariamente indisponível');
      throw new Error('Serviço de embeddings temporariamente indisponível. Tente novamente em alguns segundos.');
    }
    throw error;
  }
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

const webSearch = (query: string, count?: number) => webSearchClient.search(query, count);

// ============================================================================
// QUERY CLASSIFIER - Decidir entre RAG interno vs Web Search
// ============================================================================

type QueryType = 'internal' | 'web' | 'hybrid';

interface ClassificationResult {
  type: QueryType;
  confidence: number;
  reason: string;
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
  
  const webScore = WEB_SEARCH_KEYWORDS.reduce((score, keyword) => {
    return lowerQuery.includes(keyword) ? score + 1 : score;
  }, 0);
  
  const internalScore = INTERNAL_KEYWORDS.reduce((score, keyword) => {
    return lowerQuery.includes(keyword) ? score + 1 : score;
  }, 0);
  
  const hasCurrentTimeReference = /(?:hoje|agora|atualmente|202\d)/i.test(query);
  
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

app.get('/api/rag/health', (_req: Request, res: Response) => {
  const circuitState = embeddingsBreaker.opened ? 'open' : (embeddingsBreaker.halfOpen ? 'half-open' : 'closed');
  
  res.json({ 
    status: 'ok', 
    service: 'rag-service', 
    timestamp: new Date().toISOString(),
    embeddingsProvider: 'local', // 100% local via CPU no servidor Hetzner (multilingual-e5-base + CLIP ViT-L/14)
    model: 'intfloat/multilingual-e5-base (Local - CPU no Hetzner)',
    circuitBreaker: {
      state: circuitState,
      stats: {
        failures: embeddingsBreaker.stats.failures,
        successes: embeddingsBreaker.stats.successes,
        timeouts: embeddingsBreaker.stats.timeouts,
      },
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
    const embeddingsReady = !embeddingsBreaker.opened;
    
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

app.post('/api/rag/documents', requireAuth(), requirePermission('rag:documents:write'), requireSameTenant(getTenantIdFromRequest), async (req: Request, res: Response) => {
  // SEGURANÇA: Usar req.tenantId populado pelo middleware (RLS Enterprise)
  const tenantId = req.tenantId;
  
  try {
    const body = createDocumentSchema.parse(req.body);

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
    // namespaceId deve pertencer ao tenant do usuário (validado pelo frontend/API)
    const [document] = await db.insert(schema.documents).values({
      namespaceId: body.namespaceId,
      titulo: body.titulo,
      conteudo: body.conteudo,
      tipo: body.tipo,
      fonte: body.fonte,
      urlOrigem: body.urlOrigem,
      hashConteudo,
      embedding: documentEmbedding,
      processado: false,
    }).returning();

    const chunks = chunkText(body.conteudo);
    
    for (let i = 0; i < chunks.length; i++) {
      const embedding = await generateEmbedding(chunks[i]);
      
      // Validar dimensão antes de salvar (Enterprise-Grade - Regra 6)
      validateEmbeddingDimension(embedding, EMBEDDING_DIMENSIONS.TEXT, 'TEXT');
      
      await db.insert(schema.documentChunks).values({
        documentId: document.id,
        conteudo: chunks[i],
        posicao: i,
        embedding,
      });
    }

    await db.update(schema.documents)
      .set({ processado: true })
      .where(eq(schema.documents.id, document.id));

    logger.info({ documentId: document.id, chunks: chunks.length }, 'Documento processado');
    res.json({ document, chunksCreated: chunks.length });
  } catch (error) {
    logger.error({ error }, 'Falha ao criar documento');
    res.status(500).json({ error: 'Erro interno do servidor' });
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

    const hashConteudo = hashContent(content);

    const documentEmbedding = await generateEmbedding(content.slice(0, 2000));
    
    // Validar dimensão antes de salvar (Enterprise-Grade - Regra 6)
    validateEmbeddingDimension(documentEmbedding, EMBEDDING_DIMENSIONS.TEXT, 'TEXT');

    // MULTI-TENANCY: Documento associado ao tenant via namespaceId
    // namespaceId deve pertencer ao tenant do usuário (validado pelo middleware)
    const [document] = await db.insert(schema.documents).values({
      namespaceId,
      titulo,
      conteudo: content,
      tipo: req.file.mimetype,
      hashConteudo,
      embedding: documentEmbedding,
      processado: false,
    }).returning();

    const chunks = chunkText(content);
    
    for (let i = 0; i < chunks.length; i++) {
      const embedding = await generateEmbedding(chunks[i]);
      
      // Validar dimensão antes de salvar (Enterprise-Grade - Regra 6)
      validateEmbeddingDimension(embedding, EMBEDDING_DIMENSIONS.TEXT, 'TEXT');
      
      await db.insert(schema.documentChunks).values({
        documentId: document.id,
        conteudo: chunks[i],
        posicao: i,
        embedding,
      });
    }

    await db.update(schema.documents)
      .set({ processado: true })
      .where(eq(schema.documents.id, document.id));

    logger.info({ documentId: document.id, filename: req.file.originalname }, 'Arquivo enviado e processado');
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
  const tenantId = req.tenantId;
  
  try {
    const body = searchSchema.parse(req.body);

    const queryEmbedding = await generateEmbedding(body.query);
    
    // ============================================================================
    // BUSCA VETORIAL NATIVA PGVECTOR COM ÍNDICE HNSW (Enterprise-Grade)
    // ============================================================================
    // SEGURANÇA: Prepared statement com embedding serializado como parâmetro
    // PERFORMANCE: Índice HNSW (m=16, ef_construction=64) para O(log N)
    // ÍNDICE: idx_document_chunks_embedding_hnsw (vector_cosine_ops)
    // MULTI-TENANCY: Filtro obrigatório por tenant_id (Regra 16)
    // ============================================================================
    
    // Converter embedding para formato SQL pgvector (enterprise-grade)
    const embeddingVector = toSql(queryEmbedding);
    
    // Query parametrizada para node-postgres (Regra 6 - Enterprise-grade)
    const pool = getPool();
    // MULTI-TENANCY: tenant_id é parâmetro obrigatório na busca
    const queryParams: (string | number)[] = [embeddingVector, body.limit * 2, tenantId];
    const paramIndex = 4;
    
    let namespaceFilter = '';
    if (body.namespaceId) {
      namespaceFilter = `AND d.namespace_id = $${paramIndex}`;
      queryParams.push(body.namespaceId);
    }
    
    const { rows: results } = await pool.query<{
      id: string;
      documentId: string;
      conteudo: string;
      posicao: number;
      metadata: Record<string, unknown>;
      criadoEm: Date;
      doc_id: string | null;
      doc_titulo: string | null;
      doc_nomeArquivo: string | null;
      doc_namespaceId: string | null;
      similarity: number;
    }>(`
      SELECT 
        dc.id,
        dc.document_id as "documentId",
        dc.conteudo,
        dc.posicao,
        dc.metadata,
        dc.criado_em as "criadoEm",
        d.id as "doc_id",
        d.titulo as "doc_titulo",
        d.nome_arquivo as "doc_nomeArquivo",
        d.namespace_id as "doc_namespaceId",
        -- Embeddings são 100% locais via CPU no servidor Hetzner (multilingual-e5-base - 768 dim)
        -- Não depende de APIs externas - autonomia total (Regra 6)
        -- OBRIGATÓRIO: Migration 0003_update_embedding_dimensions_768.sql DEVE ser executada antes do deploy
        -- A migration atualiza as colunas de vector(1536) para vector(768)
        -- Não fazer cast na coluna - PostgreSQL usa o tipo da coluna automaticamente
        -- Apenas o parâmetro $1 precisa de cast explícito para vector(768)
        -- Se a migration não for executada, haverá erro de incompatibilidade de dimensões
        1 - (dc.embedding <=> $1::vector(768)) / 2 as similarity
      FROM document_chunks dc
      LEFT JOIN documents d ON dc.document_id = d.id
      WHERE 
        dc.embedding IS NOT NULL
        AND d.tenant_id = $3
        ${namespaceFilter}
      ORDER BY dc.embedding <=> $1::vector(768)
      LIMIT $2
    `, queryParams);
    
    // Filtrar por threshold e formatar resultados
    const filteredResults = results
      .filter(r => Number(r.similarity) >= body.threshold)
      .slice(0, body.limit)
      .map(r => ({
        id: r.id,
        documentId: r.documentId,
        conteudo: r.conteudo,
        posicao: r.posicao,
        metadata: r.metadata,
        criadoEm: r.criadoEm,
        similarity: Math.round(Number(r.similarity) * 10000) / 10000,
        document: r.doc_id ? {
          id: r.doc_id,
          titulo: r.doc_titulo,
          nomeArquivo: r.doc_nomeArquivo,
          namespaceId: r.doc_namespaceId,
        } : null,
      }));

    logger.info({ query: body.query, results: filteredResults.length }, 'Busca concluída');
    res.json({ results: filteredResults });
  } catch (error) {
    logger.error({ error }, 'Falha na busca');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.post('/api/rag/context', requireAuth(), async (req: Request, res: Response) => {
  try {
    const body = searchSchema.parse(req.body);

    const queryEmbedding = await generateEmbedding(body.query);
    
    // ============================================================================
    // BUSCA VETORIAL NATIVA PGVECTOR COM ÍNDICE HNSW (Enterprise-Grade)
    // ============================================================================
    // SEGURANÇA: Prepared statement com embedding serializado como parâmetro
    // PERFORMANCE: Índice HNSW (m=16, ef_construction=64) para O(log N)
    // ÍNDICE: idx_document_chunks_embedding_hnsw (vector_cosine_ops)
    // ============================================================================
    
    // Converter embedding para formato SQL pgvector (enterprise-grade)
    const embeddingVector = toSql(queryEmbedding);
    
    // Query parametrizada para node-postgres (Regra 6 - Enterprise-grade)
    const pool = getPool();
    const queryParams: (string | number)[] = [embeddingVector, body.limit * 2];
    const paramIndex = 3;
    
    let namespaceFilter = '';
    if (body.namespaceId) {
      namespaceFilter = `AND d.namespace_id = $${paramIndex}`;
      queryParams.push(body.namespaceId);
    }
    
    const { rows: dbResults } = await pool.query<{
      id: string;
      documentId: string;
      conteudo: string;
      doc_titulo: string | null;
      similarity: number;
    }>(`
      SELECT 
        dc.id,
        dc.document_id as "documentId",
        dc.conteudo,
        d.titulo as "doc_titulo",
        -- Embeddings são 100% locais via CPU no servidor Hetzner (multilingual-e5-base - 768 dim)
        -- Não depende de APIs externas - autonomia total (Regra 6)
        -- OBRIGATÓRIO: Migration 0003_update_embedding_dimensions_768.sql DEVE ser executada antes do deploy
        -- Não fazer cast na coluna - PostgreSQL usa o tipo da coluna automaticamente
        1 - (dc.embedding <=> $1::vector(768)) / 2 as similarity
      FROM document_chunks dc
      LEFT JOIN documents d ON dc.document_id = d.id
      WHERE 
        dc.embedding IS NOT NULL
        ${namespaceFilter}
      ORDER BY dc.embedding <=> $1::vector(768)
      LIMIT $2
    `, queryParams);
    
    // Filtrar por threshold
    const results = dbResults
      .filter(r => Number(r.similarity) >= body.threshold)
      .slice(0, body.limit);

    const context = results
      .map(r => `[Fonte: ${r.doc_titulo || 'Desconhecido'}]\n${r.conteudo}`)
      .join('\n\n---\n\n');

    res.json({ 
      context,
      sources: results.map(r => ({
        documentId: r.documentId,
        titulo: r.doc_titulo,
        similarity: Math.round(Number(r.similarity) * 10000) / 10000,
      })),
    });
  } catch (error) {
    logger.error({ error }, 'Falha ao gerar contexto');
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
});

app.post('/api/rag/web-search', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { query, limit = 5 } = req.body;
    
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Query é obrigatória' });
    }

    if (!webSearchClient.isEnabled()) {
      return res.status(503).json({ 
        error: 'Busca web não configurada', 
        message: 'SEARXNG_SECRET_KEY não está configurada',
      });
    }

    const results = await webSearch(query, limit);
    
    logger.info({ query, results: results.length }, 'Busca web concluída');
    res.json({ results, source: 'searxng' });
  } catch (error) {
    logger.error({ error }, 'Falha na busca web');
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
      // BUSCA VETORIAL NATIVA PGVECTOR COM ÍNDICE HNSW (Enterprise-Grade)
      // ============================================================================
      // SEGURANÇA: Prepared statement + isolamento por tenant_id
      // PERFORMANCE: Índice HNSW para O(log N)
      // MULTI-TENANCY: Filtra por namespaces do tenant
      // ============================================================================
      
      const queryEmbedding = await generateEmbedding(body.query);
      // Converter embedding para formato SQL pgvector (enterprise-grade)
      const embeddingVector = toSql(queryEmbedding);
      
      // Query parametrizada para node-postgres (Regra 6 - Enterprise-grade)
      const pool = getPool();
      const queryParams: (string | number)[] = [embeddingVector, tenantId, body.limit * 2];
      const paramIndex = 4;
      
      let namespaceFilter = '';
      if (body.namespaceId) {
        namespaceFilter = `AND d.namespace_id = $${paramIndex}`;
        queryParams.push(body.namespaceId);
      }
      
      const { rows: dbResults } = await pool.query<{
        documentId: string;
        titulo: string | null;
        conteudo: string;
        similarity: number;
      }>(`
        SELECT 
          dc.document_id as "documentId",
          d.titulo,
          dc.conteudo,
          -- Embeddings são 100% locais via CPU no servidor Hetzner (multilingual-e5-base - 768 dim)
        -- Não depende de APIs externas - autonomia total (Regra 6)
          -- OBRIGATÓRIO: Migration 0003_update_embedding_dimensions_768.sql DEVE ser executada antes do deploy
          -- Não fazer cast na coluna - PostgreSQL usa o tipo da coluna automaticamente
          1 - (dc.embedding <=> $1::vector(768)) / 2 as similarity
        FROM document_chunks dc
        INNER JOIN documents d ON dc.document_id = d.id
        INNER JOIN namespaces n ON d.namespace_id = n.id
        WHERE 
          dc.embedding IS NOT NULL
          AND n.tenant_id = $2
          ${namespaceFilter}
        ORDER BY dc.embedding <=> $1::vector(768)
        LIMIT $3
      `, queryParams);
      
      // Filtrar por threshold e formatar
      const internalResults = dbResults
        .filter(r => Number(r.similarity) >= body.threshold)
        .slice(0, body.limit)
        .map(r => ({
          documentId: r.documentId as string,
          titulo: r.titulo as string | undefined,
          conteudo: r.conteudo as string,
          similarity: Math.round(Number(r.similarity) * 10000) / 10000,
        }));

      results.internal = internalResults;
    }

    if ((classification.type === 'web' || classification.type === 'hybrid') && webSearchClient.isEnabled()) {
      results.web = await webSearch(body.query, body.limit);
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
  const embeddingsState = embeddingsBreaker.opened ? 'open' : (embeddingsBreaker.halfOpen ? 'half-open' : 'closed');
  const webSearchState = webSearchClient.breakerState();

  res.json({
    webSearchEnabled: webSearchClient.isEnabled(),
    circuitBreakers: {
      embeddings: {
        state: embeddingsState,
        stats: {
          failures: embeddingsBreaker.stats.failures,
          successes: embeddingsBreaker.stats.successes,
          timeouts: embeddingsBreaker.stats.timeouts,
        },
      },
      webSearch: webSearchState,
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

app.post('/api/learning/tasks', requireAuth(), requireSameTenant(getTenantIdFromRequest), async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(401).json({ error: 'Autenticação necessária' });

  const isSuperAdmin = (req.user as any)?.role === 'super_admin';

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
        criadoPor: (req.user as any)?.id ?? null,
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

  const isSuperAdmin = (req.user as any)?.role === 'super_admin';

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

  const isSuperAdmin = (req.user as any)?.role === 'super_admin';

  try {
    const body = learningTaskStatusSchema.parse(req.body);
    const taskId = req.params.id;

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
          // Processar imagem com CLIP embedding
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

          // Validar dimensão CLIP antes de salvar (Enterprise-Grade - Regra 6)
          validateEmbeddingDimension(result.embedding, EMBEDDING_DIMENSIONS.CLIP, 'CLIP');
          
          // Atualizar registro com embedding CLIP, thumbnail (em metadata) e metadata
          await db.update(schema.mediaUploads)
            .set({
              processingStatus: 'completed',
              clipEmbedding: result.embedding, // CLIP embedding 768 dim para imagens
              extractedMetadata: {
                ...mediaUploadRecord.extractedMetadata as object,
                ...result.metadata,
                embeddingModel: result.embeddingModel,
                hasThumbnail: !!thumbnailPath,
                thumbnailPath, // Armazenar em metadata (não há coluna no schema)
                thumbnailUrl,  // Armazenar em metadata (não há coluna no schema)
                processingTimeMs: result.processingTimeMs,
              },
            })
            .where(eq(schema.mediaUploads.id, mediaUploadRecord.id));

          logger.info({
            uploadId: mediaUploadRecord.id,
            embeddingDim: result.embedding.length,
            embeddingModel: result.embeddingModel,
            hasThumbnail: !!thumbnailPath,
          }, 'Imagem processada com sucesso');
        } else if (mediaType === 'audio') {
          // Processar áudio com Whisper transcrição
          const audioProcessor = getAudioProcessor();
          const result = await audioProcessor.processAudio(
            req.file!.buffer,
            req.file!.mimetype
          );

          // Validar dimensão de texto antes de salvar (Enterprise-Grade - Regra 6)
          if (result.embedding.length > 0) {
            validateEmbeddingDimension(result.embedding, EMBEDDING_DIMENSIONS.TEXT, 'TEXT');
          }
          
          // Atualizar registro com transcrição, embedding de texto e metadata
          await db.update(schema.mediaUploads)
            .set({
              processingStatus: 'completed',
              transcription: result.transcription,
              transcriptionLanguage: result.transcriptionLanguage,
              transcriptionConfidence: result.transcriptionConfidence,
              textEmbedding: result.embedding.length > 0 ? result.embedding : null, // Text embedding 768 dim (multilingual-e5-base local - CPU no Hetzner)
              extractedMetadata: {
                ...mediaUploadRecord.extractedMetadata as object,
                ...result.metadata,
                embeddingModel: result.embeddingModel,
                processingTimeMs: result.processingTimeMs,
              },
            })
            .where(eq(schema.mediaUploads.id, mediaUploadRecord.id));

          logger.info({
            uploadId: mediaUploadRecord.id,
            transcriptionLength: result.transcription.length,
            language: result.transcriptionLanguage,
            embeddingDim: result.embedding.length,
          }, 'Áudio processado com sucesso');
        } else if (mediaType === 'video') {
          // Processar vídeo: extrai áudio para transcrição + frames para CLIP
          const videoProcessor = getVideoProcessor();
          
          // Usar versão async para aguardar inicialização completa (evita race condition)
          if (!(await videoProcessor.isReadyAsync())) {
            throw new Error(
              'Video Processor não está pronto. Verifique FFmpeg/FFprobe e conectividade com o serviço local de inferência (alice-clip-inference).'
            );
          }
          
          const result = await videoProcessor.processVideo(
            req.file!.buffer,
            req.file!.mimetype,
            { language: 'auto', extractFrames: true, generateTranscription: true }
          );

          // Validar dimensões antes de salvar (Enterprise-Grade - Regra 6)
          if (result.textEmbedding.length > 0) {
            validateEmbeddingDimension(result.textEmbedding, EMBEDDING_DIMENSIONS.TEXT, 'TEXT');
          }
          if (result.combinedEmbedding.length > 0) {
            validateEmbeddingDimension(result.combinedEmbedding, EMBEDDING_DIMENSIONS.CLIP, 'CLIP');
          }
          
          // Atualizar registro com embeddings combinados e transcrição
          await db.update(schema.mediaUploads)
            .set({
              processingStatus: 'completed',
              transcription: result.transcription,
              transcriptionLanguage: result.transcriptionLanguage,
              transcriptionConfidence: result.transcriptionConfidence,
              textEmbedding: result.textEmbedding.length > 0 ? result.textEmbedding : null,
              clipEmbedding: result.combinedEmbedding.length > 0 ? result.combinedEmbedding : null,
              extractedMetadata: {
                ...mediaUploadRecord.extractedMetadata as object,
                ...result.metadata,
                embeddingModel: result.embeddingModel,
                framesExtracted: result.framesExtracted,
                frameEmbeddingsCount: result.frameEmbeddings.length,
                processingTimeMs: result.processingTimeMs,
              },
            })
            .where(eq(schema.mediaUploads.id, mediaUploadRecord.id));

          logger.info({
            uploadId: mediaUploadRecord.id,
            transcriptionLength: result.transcription.length,
            framesExtracted: result.framesExtracted,
            textEmbeddingDim: result.textEmbedding.length,
            combinedEmbeddingDim: result.combinedEmbedding.length,
          }, 'Vídeo processado com sucesso');
        } else if (mediaType === 'document') {
          // Processar documento: extrai texto e gera embeddings
          const documentProcessor = getDocumentProcessor();
          
          // Prontidão REAL: document depende de text embeddings locais (alice-clip-inference)
          // Evita falso-positivo de "ready" quando a dependência está indisponível.
          if (!(await documentProcessor.isReadyAsync())) {
            throw new Error(
              'Document Processor não está pronto. Verifique conectividade com o serviço local de embeddings (alice-clip-inference).'
            );
          }
          
          const result = await documentProcessor.processDocument(
            req.file!.buffer,
            req.file!.mimetype,
            { extractMetadata: true, generateEmbeddings: true }
          );

          // IMPORTANTE: no document-processor, `combinedEmbedding` é a MÉDIA dos embeddings de TEXTO
          // (multilingual-e5-base, 768 dim). Portanto, a validação correta aqui é `TEXT` (não CLIP).
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
        message: 'Upload recebido. Processamento CLIP iniciado.',
        features: ['CLIP embedding (768 dim)', 'thumbnail', 'metadata extraction'],
      },
      audio: {
        message: 'Upload recebido. Transcrição Whisper iniciada.',
        features: ['Transcrição Whisper', 'text embedding (768 dim - multilingual-e5-base local - CPU no Hetzner)', 'metadata extraction'],
      },
      video: {
        message: 'Upload recebido. Processamento pendente.',
        features: ['Frame extraction (pendente)', 'Transcrição Whisper (pendente)'],
      },
      document: {
        message: 'Upload recebido. Processamento pendente.',
        features: ['Text extraction (pendente)', 'text embedding (pendente)'],
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

// OWASP API3 - Schema para busca de mídia
const mediaSearchSchema = z.object({
  query: z.string().max(2000).optional(),
  imageId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(10),
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
  mediaType: z.enum(['image', 'audio', 'video', 'document']).optional(),
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
    
    // Limitar tamanho (100MB)
    const maxSize = 100 * 1024 * 1024;
    if (fileSize > maxSize) {
      return res.status(400).json({ 
        error: 'Arquivo muito grande',
        maxSizeMb: 100,
        receivedSizeMb: Math.round(fileSize / 1024 / 1024),
      });
    }

    const mediaType = detectMediaType(body.mimeType);
    if (!mediaType) {
      return res.status(400).json({ 
        error: 'Tipo de mídia não suportado',
        mimeType: body.mimeType,
        supportedTypes: ALL_SUPPORTED_MIMES,
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

    // Processar assíncrono (mesmo código do endpoint FormData)
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

          await db.update(schema.mediaUploads)
            .set({
              processingStatus: 'completed',
              clipEmbedding: result.embedding,
              extractedMetadata: {
                ...mediaUploadRecord.extractedMetadata as object,
                ...result.metadata,
                embeddingModel: result.embeddingModel,
                hasThumbnail: !!thumbnailPath,
                thumbnailPath,
                thumbnailUrl,
                processingTimeMs: result.processingTimeMs,
              },
            })
            .where(eq(schema.mediaUploads.id, mediaUploadRecord.id));

        } else if (mediaType === 'audio') {
          const audioProcessor = getAudioProcessor();
          const result = await audioProcessor.processAudio(fileBuffer, body.mimeType);

          await db.update(schema.mediaUploads)
            .set({
              processingStatus: 'completed',
              transcription: result.transcription,
              transcriptionLanguage: result.transcriptionLanguage,
              transcriptionConfidence: result.transcriptionConfidence,
              textEmbedding: result.embedding.length > 0 ? result.embedding : null,
              extractedMetadata: {
                ...mediaUploadRecord.extractedMetadata as object,
                ...result.metadata,
                embeddingModel: result.embeddingModel,
                processingTimeMs: result.processingTimeMs,
              },
            })
            .where(eq(schema.mediaUploads.id, mediaUploadRecord.id));
        } else {
          await db.update(schema.mediaUploads)
            .set({ processingStatus: 'pending' })
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
    
    // Ler arquivo
    const buffer = await storageService.readFile(filePath);
    
    // Determinar content type
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
      '.webm': 'video/webm',
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.pdf': 'application/pdf',
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.json': 'application/json',
    };
    
    const contentType = contentTypes[ext] || 'application/octet-stream';
    
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

// Busca semântica de imagens por similaridade de embedding
app.post('/api/media/search', requireAuth(), requireSameTenant(getTenantIdFromRequest), async (req: Request, res: Response) => {
  // SEGURANÇA: Usar req.tenantId populado pelo middleware requireAuth (Regra 8)
  const tenantId = req.tenantId;
  
  if (!tenantId) {
    return res.status(401).json({ error: 'Autenticação necessária' });
  }

  // OWASP API3 - Validação Zod obrigatória
  const parseResult = mediaSearchSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Input inválido' });
  }
  const { query, imageId, limit } = parseResult.data;

  try {
    if (!query && !imageId) {
      return res.status(400).json({ 
        error: 'Forneça "query" (texto) ou "imageId" (busca por imagem similar)' 
      });
    }

    // Se temos imageId, buscar embedding da imagem de referência
    let queryEmbedding: number[] | null = null;

    if (imageId) {
      const [referenceImage] = await db
        .select({ clipEmbedding: schema.mediaUploads.clipEmbedding })
        .from(schema.mediaUploads)
        .where(and(
          eq(schema.mediaUploads.id, imageId),
          eq(schema.mediaUploads.tenantId, tenantId as string),
          eq(schema.mediaUploads.mediaType, 'image'),
          eq(schema.mediaUploads.processingStatus, 'completed')
        ))
        .limit(1);

      if (!referenceImage?.clipEmbedding) {
        return res.status(404).json({ 
          error: 'Imagem de referência não encontrada ou ainda não processada' 
        });
      }

      queryEmbedding = referenceImage.clipEmbedding as number[];
    } else if (query) {
      // Busca por texto: gerar embedding CLIP do texto via serviço local (100% local via CPU no Hetzner)
      // REGRA 6: Serviço local sempre disponível (serviço interno na rede Docker)
      const imageProcessor = getImageProcessor();
      
      try {
        const textResult = await imageProcessor.generateTextEmbedding(query);
        queryEmbedding = textResult.embedding;
        
        logger.info({
          queryLength: query.length,
          embeddingDim: queryEmbedding.length,
          model: textResult.model,
        }, 'Text embedding gerado para busca visual');
      } catch (embeddingError) {
        logger.error({ error: embeddingError, query }, 'Erro ao gerar text embedding para busca');
        return res.status(500).json({
          error: 'Falha ao processar texto para busca',
          detail: embeddingError instanceof Error ? embeddingError.message : 'Erro desconhecido',
        });
      }
    }

    if (!queryEmbedding) {
      return res.status(400).json({ error: 'Não foi possível obter embedding para busca' });
    }

    // Validar embedding antes de usar (segurança - Regra 6)
    if (!Array.isArray(queryEmbedding) || queryEmbedding.length !== CLIP_EMBEDDING_DIM) {
      logger.error({ embeddingLength: queryEmbedding?.length, expected: CLIP_EMBEDDING_DIM }, 'Embedding com dimensão inválida');
      return res.status(400).json({ error: 'Embedding inválido - dimensão incorreta' });
    }
    
    // Garantir que todos os valores são números válidos (segurança)
    const sanitizedEmbedding = queryEmbedding.map(v => {
      const num = Number(v);
      if (!Number.isFinite(num)) {
        throw new Error('Embedding contém valores inválidos');
      }
      return num;
    });

    const safeLimit = Math.min(Math.max(1, limit), 50);

    // ============================================================================
    // BUSCA VETORIAL NATIVA PGVECTOR COM ÍNDICE HNSW (Enterprise-Grade)
    // ============================================================================
    // SEGURANÇA: Prepared statement com embedding serializado como parâmetro
    // PERFORMANCE: Índice HNSW (m=16, ef_construction=64) para O(log N)
    // ISOLAMENTO: tenant_id garante multi-tenancy seguro
    // ÍNDICE: idx_media_uploads_clip_embedding_hnsw (vector_cosine_ops)
    // ============================================================================
    
    // Converter embedding CLIP para formato SQL pgvector (enterprise-grade - 768 dim)
    const embeddingVector = toSql(sanitizedEmbedding);
    
    // Query parametrizada para node-postgres (Regra 6 - Enterprise-grade)
    // O operador <=> retorna distância (0 = idêntico, 2 = oposto)
    // Similaridade = 1 - (distância / 2) para normalizar para [0, 1]
    const pool = getPool();
    const queryParams: (string | number)[] = [embeddingVector, tenantId, safeLimit];
    const paramIndex = 4;
    
    let excludeImageFilter = '';
    if (imageId) {
      excludeImageFilter = `AND id != $${paramIndex}`;
      queryParams.push(imageId);
    }
    
    const { rows: nativeResults } = await pool.query<{
      id: string;
      originalFilename: string;
      fileUrl: string | null;
      mimeType: string;
      extractedMetadata: Record<string, unknown>;
      criadoEm: Date;
      similarity: number;
    }>(`
      SELECT 
        id,
        original_filename as "originalFilename",
        file_url as "fileUrl",
        mime_type as "mimeType",
        extracted_metadata as "extractedMetadata",
        criado_em as "criadoEm",
        -- CLIP embeddings são 100% locais via CPU no servidor Hetzner (CLIP ViT-L/14 - 768 dim)
        -- Não depende de APIs externas - autonomia total (Regra 6)
        -- OBRIGATÓRIO: Migration 0003_update_embedding_dimensions_768.sql DEVE ser executada antes do deploy
        -- Não fazer cast na coluna - PostgreSQL usa o tipo da coluna automaticamente
        1 - (clip_embedding <=> $1::vector(768)) / 2 as similarity
      FROM media_uploads
      WHERE 
        tenant_id = $2
        AND media_type = 'image'
        AND processing_status = 'completed'
        AND clip_embedding IS NOT NULL
        ${excludeImageFilter}
      ORDER BY clip_embedding <=> $1::vector(768)
      LIMIT $3
    `, queryParams);

    // Formatar resultados
    const results = nativeResults.map(row => ({
      id: row.id,
      originalFilename: row.originalFilename,
      fileUrl: row.fileUrl,
      mimeType: row.mimeType,
      metadata: row.extractedMetadata,
      similarity: Math.round(Number(row.similarity) * 10000) / 10000,
      criadoEm: row.criadoEm,
    }));

    logger.info({
      tenantId,
      queryType: imageId ? 'image' : 'text',
      resultsCount: results.length,
    }, 'Busca semântica de imagens');

    res.json({
      results,
      query: {
        type: imageId ? 'image' : 'text',
        value: imageId || query,
      },
      total: results.length,
    });
  } catch (error) {
    logger.error({ error, tenantId }, 'Erro na busca semântica');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Busca vetorial otimizada com pgvector nativo (enterprise-grade)

// Health check específico para multimodal
app.get('/api/media/health', async (_req: Request, res: Response) => {
  try {
    const imageProcessor = getImageProcessor();
    const imageConfig = imageProcessor.getConfig();
    
    const audioProcessor = getAudioProcessor();
    const audioConfig = audioProcessor.getConfig();

    const videoProcessor = getVideoProcessor();

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
      videoProcessor.isReadyAsync(),
      documentProcessor.isReadyAsync(),
    ]);

    const [imageResult, audioResult, videoResult, documentResult] = readinessResults;

    const imageReady = imageResult.status === 'fulfilled' ? imageResult.value : false;
    const audioReady = audioResult.status === 'fulfilled' ? audioResult.value : false;
    const videoReady = videoResult.status === 'fulfilled' ? videoResult.value : false;
    const documentReady = documentResult.status === 'fulfilled' ? documentResult.value : false;

    // Logar falhas de forma segura para observabilidade (sem derrubar o endpoint)
    const rejected = readinessResults.filter((r) => r.status === 'rejected') as Array<PromiseRejectedResult>;
    if (rejected.length > 0) {
      logger.warn(
        { rejectedCount: rejected.length, errors: rejected.map((r) => String(r.reason)) },
        'Falha ao executar readiness checks (tratando como not_ready)'
      );
    }

    // Garantir consistência: obter config APÓS inicialização assíncrona.
    // `getConfig()` é usado APENAS como fallback para manter o endpoint responsivo em erro inesperado.
    let videoConfig: ReturnType<typeof videoProcessor.getConfig>;
    try {
      videoConfig = await videoProcessor.getConfigAsync();
    } catch (error) {
      logger.warn({ error }, 'Falha ao obter config assíncrona do video-processor (fallback para getConfig() síncrono)');
      videoConfig = videoProcessor.getConfig();
    }

    // Semântica de saúde enterprise:
    // - refletir APENAS as probes/capabilities (isReadyAsync), sem duplicar lógica de WHISPER_REQUIRED localmente.
    // - se Whisper estiver indisponível, audio/video ficarão not_ready e o status global será degraded (sinal explícito).
    const allReady = imageReady && documentReady && audioReady && videoReady;

    res.json({
      status: allReady ? 'ok' : 'degraded',
      service: 'media-upload',
      timestamp: new Date().toISOString(),
      supportedTypes: SUPPORTED_MEDIA_TYPES,
      maxFileSizeMb: 100,
      processing: {
        image: {
          configured: imageConfig.configured,
          required: true,
          ready: imageReady,
          embeddingDim: imageConfig.embeddingDim,
          model: imageConfig.model,
        },
        audio: {
          configured: audioConfig.configured,
          required: true,
          ready: audioReady,
          embeddingDim: audioConfig.embeddingDim,
          transcriptionModel: audioConfig.transcriptionModel,
          embeddingModel: audioConfig.embeddingModel,
        },
        video: {
          configured: videoConfig.configured,
          required: true,
          ready: videoReady,
          textEmbeddingDim: videoConfig.textEmbeddingDim,
          frameEmbeddingDim: videoConfig.frameEmbeddingDim,
          maxDurationSeconds: videoConfig.maxDurationSeconds,
          framesPerMinute: videoConfig.framesPerMinute,
        },
        document: {
          configured: documentConfig.configured,
          required: true,
          ready: documentReady,
          embeddingDim: documentConfig.embeddingDim,
          maxDocumentSizeMB: documentConfig.maxDocumentSizeMB,
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

// Status do circuit breaker CLIP (Regra 16 - Observability)
app.get('/api/rag/circuit-breaker/clip', (_req: Request, res: Response) => {
  const clipStatus = getClipCircuitBreakerStatus();
  
  res.json({
    service: 'clip-embeddings',
    timestamp: new Date().toISOString(),
    circuitBreaker: clipStatus,
  });
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

const server = app.listen(PORT, () => {
  logger.info({ 
    port: PORT, 
    embeddingsConfigured: true, // Embeddings sempre locais (Regra 6 - Autonomia Total)
    clipServiceUrl: CLIP_SERVICE_URL,
    circuitBreaker: 'enabled',
  }, 'RAG service iniciado com Circuit Breaker e embeddings locais');
});

// SEGURANÇA: Timeouts para prevenir conexões pendentes (Node.js 20 LTS Best Practices)
server.timeout = 60000; // 60s para processamento de embeddings/uploads
server.keepAliveTimeout = 65000; // 65s (maior que ALB timeout padrão de 60s)
server.headersTimeout = 66000; // Ligeiramente maior que keepAliveTimeout

// ============================================================================
// GRACEFUL SHUTDOWN (Enterprise-Grade - Regra 16 CLAUDE.md)
// ShutdownManager centralizado elimina duplicação de listeners (Regra 6)
// Ordem: HTTP server → Database pool
// ============================================================================

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

registerShutdownCallback(
  'rag-database-pool',
  async () => {
    logger.info('Encerrando pool de conexões database...');
    await closeDatabasePool();
    logger.info('Pool de conexões encerrado com sucesso');
  },
  { priority: ShutdownPriority.DATABASE }
);
