/**
 * Storage Service - Alice Enterprise Platform
 * 
 * Serviço de armazenamento de arquivos abstrato.
 * Suporta armazenamento local (dev) e compatível S3/MinIO (produção).
 * 
 * Configuração via variáveis de ambiente:
 * - STORAGE_TYPE: 'local' (default em dev) ou 's3' (produção)
 * - STORAGE_BASE_DIR: Diretório base para storage local (default: ./uploads)
 * - S3_ENDPOINT: URL do endpoint S3/MinIO (ex: http://minio:9000)
 * - S3_ACCESS_KEY: Access key S3/MinIO
 * - S3_SECRET_KEY: Secret key S3/MinIO
 * - S3_BUCKET: Nome do bucket (default: alice-media)
 * - S3_REGION: Região S3 (default: us-east-1)
 * 
 * Documentação em PT-BR (Regra 10 replit.md)
 */

import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import pino from 'pino';
import CircuitBreaker from 'opossum';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
}).child({ service: 'storage-service' });

// ============================================================================
// CIRCUIT BREAKER S3 (Enterprise-Grade - Regra 16 replit.md)
// ============================================================================

const s3CircuitBreakerOptions = {
  timeout: 30000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  volumeThreshold: 5,
};

interface S3Request {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Uint8Array;
}

async function s3FetchInternal(request: S3Request): Promise<Response> {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });
  
  if (!response.ok && response.status !== 404) {
    throw new Error(`S3 request failed: ${response.status} ${response.statusText}`);
  }
  
  return response;
}

const s3Breaker = new CircuitBreaker(s3FetchInternal, s3CircuitBreakerOptions);

s3Breaker.on('open', () => logger.warn('Circuit breaker S3: ABERTO - Storage temporariamente indisponível'));
s3Breaker.on('halfOpen', () => logger.info('Circuit breaker S3: HALF-OPEN - Testando reconexão'));
s3Breaker.on('close', () => logger.info('Circuit breaker S3: FECHADO - Storage operacional'));

export interface S3CircuitBreakerStatus {
  state: 'closed' | 'open' | 'halfOpen';
  stats: {
    failures: number;
    successes: number;
    timeouts: number;
  };
}

export function getS3CircuitBreakerStatus(): S3CircuitBreakerStatus {
  const state = s3Breaker.opened ? 'open' : s3Breaker.halfOpen ? 'halfOpen' : 'closed';
  return {
    state,
    stats: {
      failures: s3Breaker.stats.failures,
      successes: s3Breaker.stats.successes,
      timeouts: s3Breaker.stats.timeouts,
    },
  };
}

// Configuração de storage
const STORAGE_TYPE = process.env.STORAGE_TYPE || 'local';
const STORAGE_BASE_DIR = process.env.STORAGE_BASE_DIR || './uploads';

// Configuração S3/MinIO (para produção)
const S3_ENDPOINT = process.env.S3_ENDPOINT;
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY;
const S3_SECRET_KEY = process.env.S3_SECRET_KEY;
const S3_BUCKET = process.env.S3_BUCKET || 'alice-media';
const S3_REGION = process.env.S3_REGION || 'us-east-1';

export interface StoredFile {
  filePath: string;
  fileUrl: string;
  fileSize: number;
}

export interface StorageService {
  saveFile(buffer: Buffer, options: SaveFileOptions): Promise<StoredFile>;
  deleteFile(filePath: string): Promise<void>;
  getFileUrl(filePath: string): string;
  fileExists(filePath: string): Promise<boolean>;
}

export interface SaveFileOptions {
  tenantId: string;
  mediaType: 'image' | 'audio' | 'video' | 'document';
  originalFilename: string;
  mimeType: string;
}

/**
 * Serviço de armazenamento local para desenvolvimento
 * Salva arquivos no sistema de arquivos local
 */
class LocalStorageService implements StorageService {
  private baseDir: string;
  private baseUrl: string;

  constructor() {
    this.baseDir = STORAGE_BASE_DIR;
    this.baseUrl = process.env.STORAGE_BASE_URL || '/api/media/files';
  }

  async ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
    }
  }

  async saveFile(buffer: Buffer, options: SaveFileOptions): Promise<StoredFile> {
    const { tenantId, mediaType, originalFilename, mimeType } = options;
    
    // Converter Buffer para Uint8Array (compatibilidade TypeScript 5 + Node.js 20)
    const bufferData = new Uint8Array(buffer);
    
    // Gerar nome de arquivo único
    const timestamp = Date.now();
    const hash = crypto.createHash('md5').update(bufferData).digest('hex').substring(0, 8);
    const ext = this.getExtension(originalFilename, mimeType);
    const filename = `${timestamp}-${hash}${ext}`;
    
    // Estrutura: /uploads/{tenantId}/{mediaType}/{filename}
    const relativePath = path.join(tenantId, mediaType, filename);
    const absolutePath = path.join(this.baseDir, relativePath);
    
    // Garantir que o diretório existe
    await this.ensureDirectoryExists(path.dirname(absolutePath));
    
    // Salvar arquivo
    await fs.writeFile(absolutePath, bufferData);
    
    logger.info({ 
      tenantId, 
      mediaType, 
      filename, 
      size: buffer.length 
    }, 'Arquivo salvo localmente');
    
    return {
      filePath: relativePath,
      fileUrl: `${this.baseUrl}/${relativePath}`,
      fileSize: buffer.length,
    };
  }

  async deleteFile(filePath: string): Promise<void> {
    const absolutePath = path.join(this.baseDir, filePath);
    try {
      await fs.unlink(absolutePath);
      logger.info({ filePath }, 'Arquivo deletado');
    } catch (error) {
      logger.warn({ filePath, error }, 'Erro ao deletar arquivo');
    }
  }

  getFileUrl(filePath: string): string {
    return `${this.baseUrl}/${filePath}`;
  }

  async fileExists(filePath: string): Promise<boolean> {
    const absolutePath = path.join(this.baseDir, filePath);
    try {
      await fs.access(absolutePath);
      return true;
    } catch {
      return false;
    }
  }

  async readFile(filePath: string): Promise<Buffer> {
    const absolutePath = path.join(this.baseDir, filePath);
    return fs.readFile(absolutePath);
  }

  private getExtension(filename: string, mimeType: string): string {
    // Tentar extrair do filename
    const ext = path.extname(filename);
    if (ext) return ext;
    
    // Fallback baseado no mimeType
    const mimeToExt: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'audio/mpeg': '.mp3',
      'audio/wav': '.wav',
      'audio/ogg': '.ogg',
      'audio/webm': '.webm',
      'video/mp4': '.mp4',
      'video/webm': '.webm',
      'video/ogg': '.ogv',
      'video/quicktime': '.mov',
      'application/pdf': '.pdf',
      'text/plain': '.txt',
      'text/markdown': '.md',
      'application/json': '.json',
    };
    
    return mimeToExt[mimeType] || '';
  }
}

// ============================================================================
// S3 STORAGE SERVICE - Para produção na Hetzner (Fase 12)
// ============================================================================

/**
 * Serviço de armazenamento S3/MinIO para produção
 * Requer configuração via variáveis de ambiente
 * 
 * Nota: A implementação completa do S3 será adicionada quando
 * o deploy de produção for configurado (Fase 12)
 */
class S3StorageService implements StorageService {
  private endpoint: string;
  private bucket: string;
  private baseUrl: string;

  constructor() {
    if (!S3_ENDPOINT || !S3_ACCESS_KEY || !S3_SECRET_KEY) {
      throw new Error(
        'S3 Storage requer configuração: S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY'
      );
    }
    
    this.endpoint = S3_ENDPOINT;
    this.bucket = S3_BUCKET;
    this.baseUrl = `${S3_ENDPOINT}/${S3_BUCKET}`;
    
    logger.info({ 
      endpoint: this.endpoint, 
      bucket: this.bucket,
      region: S3_REGION,
    }, 'S3 Storage Service inicializado');
  }

  async saveFile(buffer: Buffer, options: SaveFileOptions): Promise<StoredFile> {
    const { tenantId, mediaType, originalFilename, mimeType } = options;
    
    const bufferData = new Uint8Array(buffer);
    
    const timestamp = Date.now();
    const hash = crypto.createHash('md5').update(bufferData).digest('hex').substring(0, 8);
    const ext = this.getExtension(originalFilename, mimeType);
    const filename = `${timestamp}-${hash}${ext}`;
    
    const objectKey = `${tenantId}/${mediaType}/${filename}`;
    const url = `${this.endpoint}/${this.bucket}/${objectKey}`;
    
    try {
      // Usar circuit breaker para resiliência (Regra 16)
      await s3Breaker.fire({
        url,
        method: 'PUT',
        headers: {
          'Content-Type': mimeType,
          'Content-Length': buffer.length.toString(),
          'Authorization': `Basic ${Buffer.from(`${S3_ACCESS_KEY}:${S3_SECRET_KEY}`).toString('base64')}`,
        },
        body: bufferData,
      });
      
      logger.info({ tenantId, mediaType, objectKey, size: buffer.length }, 'Arquivo salvo no S3');
      
      return {
        filePath: objectKey,
        fileUrl: `${this.baseUrl}/${objectKey}`,
        fileSize: buffer.length,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('Breaker is open')) {
        logger.warn({ objectKey }, 'Circuit breaker S3 aberto - storage temporariamente indisponível');
        throw new Error('Serviço de storage temporariamente indisponível');
      }
      throw error;
    }
  }

  async deleteFile(filePath: string): Promise<void> {
    const url = `${this.endpoint}/${this.bucket}/${filePath}`;
    
    try {
      await s3Breaker.fire({
        url,
        method: 'DELETE',
        headers: {
          'Authorization': `Basic ${Buffer.from(`${S3_ACCESS_KEY}:${S3_SECRET_KEY}`).toString('base64')}`,
        },
      });
      logger.info({ filePath }, 'Arquivo deletado do S3');
    } catch (error) {
      if (error instanceof Error && error.message.includes('Breaker is open')) {
        logger.warn({ filePath }, 'Circuit breaker S3 aberto - delete ignorado');
        return;
      }
      logger.warn({ filePath, error }, 'Erro ao deletar arquivo do S3');
    }
  }

  getFileUrl(filePath: string): string {
    return `${this.baseUrl}/${filePath}`;
  }

  async fileExists(filePath: string): Promise<boolean> {
    const url = `${this.endpoint}/${this.bucket}/${filePath}`;
    
    try {
      const response = await s3Breaker.fire({
        url,
        method: 'HEAD',
        headers: {
          'Authorization': `Basic ${Buffer.from(`${S3_ACCESS_KEY}:${S3_SECRET_KEY}`).toString('base64')}`,
        },
      }) as Response;
      return response.ok;
    } catch {
      return false;
    }
  }

  async readFile(filePath: string): Promise<Buffer> {
    const url = `${this.endpoint}/${this.bucket}/${filePath}`;
    
    try {
      const response = await s3Breaker.fire({
        url,
        method: 'GET',
        headers: {
          'Authorization': `Basic ${Buffer.from(`${S3_ACCESS_KEY}:${S3_SECRET_KEY}`).toString('base64')}`,
        },
      }) as Response;
      
      if (!response.ok) {
        throw new Error(`Arquivo não encontrado no S3: ${filePath}`);
      }
      
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (error instanceof Error && error.message.includes('Breaker is open')) {
        throw new Error('Serviço de storage temporariamente indisponível');
      }
      throw error;
    }
  }

  private getExtension(filename: string, mimeType: string): string {
    const ext = path.extname(filename);
    if (ext) return ext;
    
    const mimeToExt: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'audio/mpeg': '.mp3',
      'audio/wav': '.wav',
      'audio/ogg': '.ogg',
      'audio/webm': '.webm',
      'video/mp4': '.mp4',
      'video/webm': '.webm',
      'video/ogg': '.ogv',
      'video/quicktime': '.mov',
      'application/pdf': '.pdf',
      'text/plain': '.txt',
      'text/markdown': '.md',
      'application/json': '.json',
    };
    
    return mimeToExt[mimeType] || '';
  }
}

// ============================================================================
// FACTORY - Seleciona o serviço de storage baseado na configuração
// ============================================================================

let storageInstance: StorageService | null = null;

export function getStorageService(): LocalStorageService | S3StorageService {
  if (!storageInstance) {
    if (STORAGE_TYPE === 's3' && S3_ENDPOINT) {
      logger.info('Usando S3 Storage Service (produção)');
      storageInstance = new S3StorageService();
    } else {
      logger.info({ baseDir: STORAGE_BASE_DIR }, 'Usando Local Storage Service (desenvolvimento)');
      storageInstance = new LocalStorageService();
    }
  }
  return storageInstance as LocalStorageService | S3StorageService;
}

// Exportar para uso direto
export const storage = getStorageService();
