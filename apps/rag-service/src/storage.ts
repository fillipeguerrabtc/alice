/**
 * Storage Service - Alice Enterprise Platform
 * 
 * Serviço de armazenamento de arquivos em disco local.
 * Persistência via volume Docker montado em /opt/alice/uploads.
 * 
 * Configuração via variáveis de ambiente:
 * - STORAGE_BASE_DIR: Diretório base para storage (default: /opt/alice/uploads)
 * - STORAGE_BASE_URL: URL base para servir arquivos (default: /api/media/files)
 * 
 * Arquitetura:
 * - Produção: Volume Docker persistente em /opt/alice/uploads
 * - Desenvolvimento: ./uploads (local)
 * 
 * Estrutura de diretórios (Enterprise - 23/12/2025):
 * /opt/alice/uploads/
 * ├── {tenantId}/                    # Uploads gerais de usuários (isolamento por tenant)
 * │   ├── image/                     # Imagens enviadas via /api/media/upload
 * │   ├── audio/                     # Áudios enviados via /api/media/upload
 * │   └── document/                  # Documentos enviados via /api/media/upload
 * ├── tts/                           # Outputs de jobs TTS (Salad) - output-{jobId}.wav
 * └── media/                         # Outros arquivos multimodais (reservado)
 * 
 * NOTA (23/12/2025): Vídeo REMOVIDO - muito pesado para GPU. Plataforma suporta apenas texto, áudio e imagem.
 * 
 * Permissões Enterprise:
 * - Diretórios: 750 (rwxr-x---) - owner/group rwx, outros sem acesso
 * - Arquivos: 640 (rw-r-----) - owner rw, group r, outros sem acesso
 * 
 * Autor: Fillipe Guerra
 * Data: 13 de Dezembro de 2025
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createLogger } from '@alice/logger';

const logger = createLogger('storage-service');

// ============================================================================
// CONFIGURAÇÃO DE STORAGE (Regra 6 CLAUDE.md - Enterprise-Grade)
// Volume Docker persistente para armazenamento de arquivos
// ============================================================================

const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';

// Diretório base para storage
// Produção: /opt/alice/uploads (volume Docker)
// Desenvolvimento: ./uploads (local)
const STORAGE_BASE_DIR = process.env.STORAGE_BASE_DIR || 
  (IS_PRODUCTION ? '/opt/alice/uploads' : './uploads');

// URL base para servir arquivos
const STORAGE_BASE_URL = process.env.STORAGE_BASE_URL || '/api/media/files';

// Log de configuração
logger.info({ 
  environment: NODE_ENV,
  storageBaseDir: STORAGE_BASE_DIR,
  storageBaseUrl: STORAGE_BASE_URL,
}, 'Storage Service inicializado - armazenamento em disco local');

// ============================================================================
// INTERFACES
// ============================================================================

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
  readFile(filePath: string): Promise<Buffer>;
  getAbsolutePath(filePath: string): string;
  getDiskUsage(): Promise<DiskUsageStats>;
}

// ATUALIZADO 23/12/2025: Removido 'video' (muito pesado para GPU)
export interface SaveFileOptions {
  tenantId: string;
  mediaType: 'image' | 'audio' | 'document';
  originalFilename: string;
  mimeType: string;
}

export interface DiskUsageStats {
  totalFiles: number;
  totalSize: string;
  totalSizeBytes: number;
  byMediaType: Record<string, { files: number; size: string; sizeBytes: number }>;
}

// ============================================================================
// LOCAL STORAGE SERVICE - Armazenamento em disco local
// ============================================================================

/**
 * Serviço de armazenamento em disco local
 * Salva arquivos no sistema de arquivos com estrutura organizada por tenant/mediaType
 */
class LocalStorageService implements StorageService {
  private baseDir: string;
  private baseUrl: string;

  constructor() {
    this.baseDir = STORAGE_BASE_DIR;
    this.baseUrl = STORAGE_BASE_URL;
    
    // Garantir que o diretório base existe
    this.ensureDirectoryExists(this.baseDir).catch(err => {
      logger.error({ error: err.message, baseDir: this.baseDir }, 'Erro ao criar diretório base de storage');
    });
  }

  /**
   * Garantir que um diretório existe, criando se necessário
   * Permissões enterprise: 750 (rwxr-x---) - owner/group rwx, outros sem acesso
   */
  async ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true, mode: 0o750 });
      logger.debug({ dirPath }, 'Diretório criado com permissões enterprise (750)');
    }
  }

  /**
   * Salvar arquivo no disco
   */
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
    
    // Salvar arquivo com permissões enterprise: 640 (rw-r-----) - owner rw, group r, outros sem acesso
    await fs.writeFile(absolutePath, buffer, { mode: 0o640 });
    
    logger.info({ 
      tenantId, 
      mediaType, 
      filename, 
      size: buffer.length,
      path: relativePath,
    }, 'Arquivo salvo com sucesso');
    
    return {
      filePath: relativePath,
      fileUrl: `${this.baseUrl}/${relativePath}`,
      fileSize: buffer.length,
    };
  }

  /**
   * Deletar arquivo do disco
   */
  async deleteFile(filePath: string): Promise<void> {
    const absolutePath = path.join(this.baseDir, filePath);
    try {
      await fs.unlink(absolutePath);
      logger.info({ filePath }, 'Arquivo deletado');
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        logger.warn({ filePath }, 'Arquivo não encontrado para deleção');
      } else {
        logger.error({ filePath, error: err.message }, 'Erro ao deletar arquivo');
        throw error;
      }
    }
  }

  /**
   * Obter URL pública do arquivo
   */
  getFileUrl(filePath: string): string {
    return `${this.baseUrl}/${filePath}`;
  }

  /**
   * Verificar se arquivo existe
   */
  async fileExists(filePath: string): Promise<boolean> {
    const absolutePath = path.join(this.baseDir, filePath);
    try {
      await fs.access(absolutePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ler arquivo do disco
   */
  async readFile(filePath: string): Promise<Buffer> {
    const absolutePath = path.join(this.baseDir, filePath);
    return fs.readFile(absolutePath);
  }

  /**
   * Obter caminho absoluto do arquivo
   */
  getAbsolutePath(filePath: string): string {
    return path.join(this.baseDir, filePath);
  }

  /**
   * Obter estatísticas de uso de disco
   * Considera AMBAS as estruturas:
   * 1. Uploads gerais: /uploads/{tenantId}/{mediaType}/{filename}
   * 2. Outputs de jobs Salad: /uploads/{tts}/output-{jobId}.{ext}
   * 
   * NOTA (23/12/2025): Diretórios de vídeo removidos (lip-sync, talking-head, long-video)
   */
  async getDiskUsage(): Promise<DiskUsageStats> {
    const stats: DiskUsageStats = {
      totalFiles: 0,
      totalSize: '0 B',
      totalSizeBytes: 0,
      byMediaType: {},
    };

    try {
      const entries = await fs.readdir(this.baseDir);
      
      for (const entry of entries) {
        const entryPath = path.join(this.baseDir, entry);
        const entryStat = await fs.stat(entryPath);
        
        if (!entryStat.isDirectory()) continue;
        
        // Estrutura 1: Uploads gerais por tenant (/uploads/{tenantId}/{mediaType}/...)
        // Detecta se é UUID (tenantId) ou nome de diretório de job Salad
        // ATUALIZADO 23/12/2025: Removidos diretórios de vídeo (lip-sync, talking-head, long-video)
        // BUG FIX 23/12/2025: Manter diretórios antigos na lista para compatibilidade com diretórios existentes
        // Se diretórios antigos ainda existem em disco, devem ser tratados como job output, não como tenantId
        const isJobOutputDir = ['tts', 'media', 'lip-sync', 'talking-head', 'long-video'].includes(entry);
        
        if (isJobOutputDir) {
          // Estrutura 2: Outputs de jobs Salad (/uploads/{jobType}/output-{jobId}.{ext})
          const jobType = entry === 'tts' ? 'audio' : 'media';
          
          if (!stats.byMediaType[jobType]) {
            stats.byMediaType[jobType] = { files: 0, size: '0 B', sizeBytes: 0 };
          }
          
          const files = await fs.readdir(entryPath);
          for (const file of files) {
            const filePath = path.join(entryPath, file);
            const fileStat = await fs.stat(filePath);
            
            if (fileStat.isFile()) {
              stats.totalFiles++;
              stats.totalSizeBytes += fileStat.size;
              stats.byMediaType[jobType].files++;
              stats.byMediaType[jobType].sizeBytes += fileStat.size;
            }
          }
        } else {
          // Estrutura 1: Uploads gerais por tenant
          const tenantPath = entryPath;
          const mediaTypes = await fs.readdir(tenantPath);
          
          for (const mediaType of mediaTypes) {
            const mediaPath = path.join(tenantPath, mediaType);
            const mediaStat = await fs.stat(mediaPath);
            
            if (!mediaStat.isDirectory()) continue;
            
            if (!stats.byMediaType[mediaType]) {
              stats.byMediaType[mediaType] = { files: 0, size: '0 B', sizeBytes: 0 };
            }
            
            const files = await fs.readdir(mediaPath);
            
            for (const file of files) {
              const filePath = path.join(mediaPath, file);
              const fileStat = await fs.stat(filePath);
              
              if (fileStat.isFile()) {
                stats.totalFiles++;
                stats.totalSizeBytes += fileStat.size;
                stats.byMediaType[mediaType].files++;
                stats.byMediaType[mediaType].sizeBytes += fileStat.size;
              }
            }
          }
        }
      }
      
      // Formatar tamanhos
      stats.totalSize = this.formatBytes(stats.totalSizeBytes);
      for (const mediaType of Object.keys(stats.byMediaType)) {
        stats.byMediaType[mediaType].size = this.formatBytes(stats.byMediaType[mediaType].sizeBytes);
      }
      
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'ENOENT') {
        logger.error({ error: err.message }, 'Erro ao calcular uso de disco');
      }
    }

    return stats;
  }

  /**
   * Formatar bytes para string legível
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }

  /**
   * Obter extensão do arquivo baseado no nome ou mimeType
   */
  private getExtension(filename: string, mimeType: string): string {
    // Tentar extrair do filename
    const ext = path.extname(filename);
    if (ext) return ext;
    
    // Fallback baseado no mimeType
    // ATUALIZADO 23/12/2025: Removidas extensões de vídeo (muito pesado para GPU)
    const mimeToExt: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'audio/mpeg': '.mp3',
      'audio/wav': '.wav',
      'audio/ogg': '.ogg',
      'audio/webm': '.webm',
      'application/pdf': '.pdf',
      'text/plain': '.txt',
      'text/markdown': '.md',
      'application/json': '.json',
    };
    
    return mimeToExt[mimeType] || '';
  }
}

// ============================================================================
// SINGLETON - Instância única do serviço de storage
// ============================================================================

let storageInstance: LocalStorageService | null = null;

/**
 * Retorna instância singleton do serviço de storage
 * Usa LocalStorageService com volume Docker persistente
 */
export function getStorageService(): LocalStorageService {
  if (!storageInstance) {
    storageInstance = new LocalStorageService();
  }
  return storageInstance;
}

// Exportar instância para uso direto
export const storage = getStorageService();
