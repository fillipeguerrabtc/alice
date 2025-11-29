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
import http from 'http';
import https from 'https';
import pino from 'pino';
import { createCircuitBreaker, CIRCUIT_BREAKER_PRESETS } from '@alice/shared-utils';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
}).child({ service: 'storage-service' });

// ============================================================================
// CIRCUIT BREAKER S3 (Enterprise-Grade - Regra 16 replit.md)
// Usa CIRCUIT_BREAKER_PRESETS centralizado (Regra 2 - Não Duplicar)
// ============================================================================

/**
 * Interface para requisições S3
 * 
 * Usa módulos http/https nativos do Node.js para evitar incompatibilidades
 * de tipos com o fetch global (@types/node 20.16+ | TypeScript 5.5+).
 * 
 * O módulo http/https nativo aceita Buffer diretamente sem problemas de tipos.
 */
interface S3Request {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Buffer;
}

/**
 * Resposta simplificada da requisição S3
 */
interface S3Response {
  ok: boolean;
  status: number;
  statusText: string;
}

/**
 * Executa requisição HTTP para S3/MinIO usando módulo nativo do Node.js
 * 
 * Esta implementação usa http/https nativo em vez do fetch global para
 * garantir compatibilidade total com Buffer em todas as versões do TypeScript.
 * 
 * @param request - Objeto com url, method, headers e body opcional
 * @returns Promise com resposta simplificada
 */
async function s3FetchInternal(request: S3Request): Promise<S3Response> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(request.url);
    const isHttps = urlObj.protocol === 'https:';
    const httpModule = isHttps ? https : http;
    
    const options: http.RequestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: request.method,
      headers: request.headers,
      timeout: 30000,
    };
    
    const req = httpModule.request(options, (res) => {
      // Consumir response body para liberar recursos
      res.on('data', () => {});
      res.on('end', () => {
        const ok = res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300;
        resolve({
          ok: ok || res.statusCode === 404,
          status: res.statusCode || 0,
          statusText: res.statusMessage || '',
        });
      });
    });
    
    req.on('error', (error) => {
      reject(new Error(`S3 request failed: ${error.message}`));
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('S3 request timeout'));
    });
    
    // Escrever body se existir
    if (request.body) {
      req.write(request.body);
    }
    
    req.end();
  });
}

const s3Breaker = createCircuitBreaker(s3FetchInternal, {
  name: 's3-storage',
  ...CIRCUIT_BREAKER_PRESETS.s3Storage,
});

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

// ============================================================================
// CONFIGURAÇÃO DE STORAGE (Regra 6 replit.md - SEM SOLUÇÕES TEMPORÁRIAS)
// 
// NÃO-DESENVOLVIMENTO: OBRIGA S3 - Hetzner Object Storage (fail-fast)
// DESENVOLVIMENTO: Permite local OU S3 (deve ser explícito)
// ============================================================================

const NODE_ENV = process.env.NODE_ENV || 'development';
// QUALQUER ambiente não-development requer S3 (production, staging, preview, test)
const IS_DEVELOPMENT = NODE_ENV === 'development';
const REQUIRES_S3 = !IS_DEVELOPMENT;

// Configuração S3/Hetzner Object Storage
const S3_ENDPOINT = process.env.S3_ENDPOINT;
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY;
const S3_SECRET_KEY = process.env.S3_SECRET_KEY;
const S3_BUCKET = process.env.S3_BUCKET || 'alice-media';
// Hetzner Object Storage - regiões disponíveis: fsn1, nbg1, hel1
const S3_REGION = process.env.S3_REGION || 'fsn1';

/**
 * Valida formato do endpoint S3 (Regra 6 - fail-fast)
 * Aceita URLs válidas para Hetzner, MinIO, AWS S3 ou compatíveis
 */
function validateS3EndpointFormat(endpoint: string): void {
  try {
    const url = new URL(endpoint);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error(`Protocolo inválido: ${url.protocol}. Use http: ou https:`);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'URL malformada';
    throw new Error(`S3_ENDPOINT inválido (${endpoint}): ${msg}`);
  }
}

/**
 * Verifica conectividade S3 via HEAD bucket (Regra 6 - fail-fast no boot)
 * CRÍTICO: Deve ser chamado durante inicialização do serviço
 */
async function verifyS3Connectivity(): Promise<void> {
  if (!S3_ENDPOINT || !S3_ACCESS_KEY || !S3_SECRET_KEY) {
    throw new Error('S3 não configurado - verificação de conectividade impossível');
  }
  
  const url = `${S3_ENDPOINT}/${S3_BUCKET}`;
  
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const httpModule = isHttps ? https : http;
    
    const options: http.RequestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname,
      method: 'HEAD',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${S3_ACCESS_KEY}:${S3_SECRET_KEY}`).toString('base64')}`,
      },
      timeout: 10000,
    };
    
    const req = httpModule.request(options, (res) => {
      res.on('data', () => {});
      res.on('end', () => {
        // REGRA 6 (fail-fast): APENAS 2xx é sucesso
        // 403 = credenciais inválidas -> FATAL
        // 404 = bucket não existe -> FATAL
        // 5xx = servidor com problema -> FATAL
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          logger.info({ 
            endpoint: S3_ENDPOINT,
            bucket: S3_BUCKET,
            statusCode: res.statusCode,
          }, 'S3 conectividade verificada com sucesso');
          resolve();
        } else if (res.statusCode === 403) {
          reject(new Error(`S3 credenciais inválidas (403 Forbidden). Verifique S3_ACCESS_KEY e S3_SECRET_KEY`));
        } else if (res.statusCode === 404) {
          reject(new Error(`S3 bucket '${S3_BUCKET}' não existe (404 Not Found). Crie o bucket antes do deploy`));
        } else {
          reject(new Error(`S3 retornou erro HTTP ${res.statusCode}: ${res.statusMessage}`));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(new Error(`S3 inacessível (${S3_ENDPOINT}): ${error.message}`));
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`S3 timeout após 10s (${S3_ENDPOINT})`));
    });
    
    req.end();
  });
}

// Validação OBRIGATÓRIA para ambientes não-development (Regra 6 - fail-fast)
if (REQUIRES_S3) {
  const missingVars: string[] = [];
  if (!S3_ENDPOINT) missingVars.push('S3_ENDPOINT');
  if (!S3_ACCESS_KEY) missingVars.push('S3_ACCESS_KEY');
  if (!S3_SECRET_KEY) missingVars.push('S3_SECRET_KEY');
  
  if (missingVars.length > 0) {
    const errorMsg = `[FATAL] Ambiente ${NODE_ENV} requer Object Storage S3. ` +
      `Variáveis faltando: ${missingVars.join(', ')}. ` +
      `Endpoints Hetzner: https://fsn1.your-objectstorage.com (Falkenstein), ` +
      `https://nbg1.your-objectstorage.com (Nuremberg), ` +
      `https://hel1.your-objectstorage.com (Helsinki)`;
    logger.fatal({ missingVars, environment: NODE_ENV }, errorMsg);
    throw new Error(errorMsg);
  }
  
  // Validar formato do endpoint (fail-fast)
  validateS3EndpointFormat(S3_ENDPOINT!);
  
  // Verificar conectividade S3 no boot (fail-fast async)
  // Nota: Executado via IIFE para não bloquear import do módulo
  (async () => {
    try {
      await verifyS3Connectivity();
      logger.info({ environment: NODE_ENV }, 'S3 verificado e pronto para uso');
    } catch (error) {
      const errorMsg = `[FATAL] S3 inacessível em ambiente ${NODE_ENV}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`;
      logger.fatal({ error, environment: NODE_ENV }, errorMsg);
      // Em ambientes não-dev, falha de S3 é fatal
      process.exit(1);
    }
  })();
}

// STORAGE_TYPE: 's3' em ambientes não-dev, 'local' apenas em development
const STORAGE_TYPE = REQUIRES_S3 ? 's3' : (process.env.STORAGE_TYPE || 'local');
const STORAGE_BASE_DIR = process.env.STORAGE_BASE_DIR || './uploads';

// Log de configuração
logger.info({ 
  environment: NODE_ENV,
  requiresS3: REQUIRES_S3,
  storageType: STORAGE_TYPE,
  s3Endpoint: S3_ENDPOINT ? S3_ENDPOINT.replace(/\/\/[^@]*@/, '//***@') : undefined,
  s3Region: S3_REGION,
  s3Bucket: S3_BUCKET,
}, 'Configuração de storage inicializada');

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
    
    // Gerar nome de arquivo único
    const timestamp = Date.now();
    const hash = crypto.createHash('md5').update(buffer).digest('hex').substring(0, 8);
    const ext = this.getExtension(originalFilename, mimeType);
    const filename = `${timestamp}-${hash}${ext}`;
    
    // Estrutura: /uploads/{tenantId}/{mediaType}/{filename}
    const relativePath = path.join(tenantId, mediaType, filename);
    const absolutePath = path.join(this.baseDir, relativePath);
    
    // Garantir que o diretório existe
    await this.ensureDirectoryExists(path.dirname(absolutePath));
    
    // Salvar arquivo (Buffer é diretamente compatível com fs.writeFile)
    await fs.writeFile(absolutePath, buffer);
    
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
    
    const timestamp = Date.now();
    const hash = crypto.createHash('md5').update(buffer).digest('hex').substring(0, 8);
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
        body: buffer,
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
// (Regra 6 replit.md - fail-fast em produção)
// ============================================================================

let storageInstance: StorageService | null = null;

/**
 * Retorna instância do serviço de storage apropriado.
 * 
 * NÃO-DESENVOLVIMENTO: Sempre retorna S3StorageService (Hetzner Object Storage)
 * DESENVOLVIMENTO: Retorna LocalStorageService ou S3StorageService conforme config
 * 
 * @throws Error se ambiente não-dev e S3 não configurado (Regra 6 - fail-fast)
 */
export function getStorageService(): LocalStorageService | S3StorageService {
  if (!storageInstance) {
    if (STORAGE_TYPE === 's3') {
      // S3 obrigatório - validação já feita no módulo para ambientes não-dev
      logger.info({ 
        endpoint: S3_ENDPOINT,
        bucket: S3_BUCKET,
        region: S3_REGION,
      }, 'Inicializando S3 Storage Service (Hetzner Object Storage)');
      storageInstance = new S3StorageService();
    } else if (IS_DEVELOPMENT) {
      // Local SOMENTE permitido em desenvolvimento
      logger.info({ 
        baseDir: STORAGE_BASE_DIR,
        warning: 'Storage local - APENAS para desenvolvimento',
      }, 'Inicializando Local Storage Service');
      storageInstance = new LocalStorageService();
    } else {
      // Nunca deve chegar aqui - validação fail-fast já disparou
      throw new Error(`[FATAL] Storage local não permitido em ambiente ${NODE_ENV} (Regra 6 replit.md)`);
    }
  }
  return storageInstance as LocalStorageService | S3StorageService;
}

// Exportar para uso direto
export const storage = getStorageService();
