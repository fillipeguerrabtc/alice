/**
 * Image Processor Service - Alice Enterprise Platform
 * 
 * Processamento de imagens:
 * - OpenCLIP ViT-H/14 embeddings (1024 dimensões) via GPU (Salad Cloud)
 * - Thumbnails via sharp (quando disponível)
 * - Extração de metadata EXIF
 * - Circuit breaker para resiliência (Regra 16 CLAUDE.md)
 * 
 * ARQUITETURA 100% GPU (Opção B - Alta Qualidade) - 15/12/2025:
 * - OpenCLIP ViT-H/14 roda em GPU via Salad Cloud (1024 dim)
 * - GPU é OBRIGATÓRIO - SEM fallback CPU (Regra 6 - sem workarounds)
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import pino from 'pino';
import { createCircuitBreaker, CIRCUIT_BREAKER_PRESETS } from '@alice/shared-utils';
import { validateEmbeddingDimension } from '@alice/database';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
}).child({ service: 'image-processor' });

// Configuração Embeddings GPU (Salad Cloud) - ARQUITETURA 100% GPU
// GPU é OBRIGATÓRIO - schema usa vector(1024)
const EMBEDDINGS_GPU_URL = process.env.EMBEDDINGS_GPU_URL || '';

// Dimensão dos embeddings (OpenCLIP ViT-H/14 - 1024 dim)
export const CLIP_EMBEDDING_DIM = 1024;

// ============================================================================
// CIRCUIT BREAKER - GPU Embeddings API (Regra 16 - Melhores Práticas 2025)
// ============================================================================

interface EmbeddingsApiParams {
  image: string;
}

async function callEmbeddingsGpuApi(params: EmbeddingsApiParams): Promise<{ embedding: number[]; model: string }> {
  if (!EMBEDDINGS_GPU_URL) {
    throw new Error('EMBEDDINGS_GPU_URL não configurado - GPU é OBRIGATÓRIO para embeddings (schema vector(1024))');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

  try {
    const response = await fetch(`${EMBEDDINGS_GPU_URL}/embed/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GPU Embeddings API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json() as { embedding: number[]; model: string; dimension: number };
    
    if (!result.embedding || !Array.isArray(result.embedding)) {
      throw new Error('Resposta GPU inválida - embedding ausente');
    }

    return {
      embedding: result.embedding,
      model: result.model || 'OpenCLIP-ViT-H-14',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

// Circuit breaker para chamadas GPU
const gpuBreaker = createCircuitBreaker(callEmbeddingsGpuApi, {
  name: 'embeddings-gpu-image',
  ...CIRCUIT_BREAKER_PRESETS.clipEmbeddings,
});

async function callGpuApi(params: EmbeddingsApiParams): Promise<{ embedding: number[]; model: string }> {
  return gpuBreaker.fire(params) as Promise<{ embedding: number[]; model: string }>;
}

export interface ImageMetadata {
  width?: number;
  height?: number;
  format?: string;
  colorSpace?: string;
  hasAlpha?: boolean;
  exif?: Record<string, unknown>;
  orientation?: number;
  dpi?: number;
}

export interface ProcessedImage {
  embedding: number[];
  embeddingModel: string;
  thumbnailBuffer?: Buffer;
  thumbnailMimeType?: string;
  metadata: ImageMetadata;
  processedAt: string;
  processingTimeMs: number;
}

export interface ImageProcessorOptions {
  generateThumbnail?: boolean;
  thumbnailSize?: number;
  extractExif?: boolean;
}

class ImageProcessorService {
  private isConfigured: boolean = false;

  constructor() {
    this.isConfigured = typeof EMBEDDINGS_GPU_URL === 'string' && EMBEDDINGS_GPU_URL.length > 0;
    
    if (!this.isConfigured) {
      logger.warn('EMBEDDINGS_GPU_URL não configurado - embeddings de imagem não funcionarão');
    } else {
      logger.info(
        { gpuUrl: EMBEDDINGS_GPU_URL, embeddingDim: CLIP_EMBEDDING_DIM },
        'Image Processor configurado - ARQUITETURA 100% GPU (OpenCLIP ViT-H/14, 1024 dim)'
      );
    }
  }

  /**
   * Processa uma imagem: gera embedding, thumbnail e extrai metadata
   */
  async processImage(
    imageBuffer: Buffer,
    mimeType: string,
    options: ImageProcessorOptions = {}
  ): Promise<ProcessedImage> {
    const startTime = Date.now();
    const { generateThumbnail = true, thumbnailSize = 256, extractExif = true } = options;

    // Extrair metadata básica
    const metadata = await this.extractMetadata(imageBuffer, mimeType, extractExif);

    // Gerar embedding via GPU (OBRIGATÓRIO)
    let embedding: number[] = [];
    let embeddingModel = 'none';

    if (this.isConfigured) {
      try {
        const result = await this.generateImageEmbedding(imageBuffer, mimeType);
        embedding = result.embedding;
        embeddingModel = result.model;
      } catch (error) {
        logger.error({ error }, 'Erro ao gerar embedding de imagem via GPU');
        // Regra 6: NÃO retornar embedding falso, deixar vazio
        embedding = [];
        embeddingModel = 'error';
      }
    } else {
      logger.error('GPU não configurado - embedding de imagem não gerado');
      embeddingModel = 'not_configured';
    }

    // Gerar thumbnail
    let thumbnailBuffer: Buffer | undefined;
    let thumbnailMimeType: string | undefined;

    if (generateThumbnail) {
      const thumbnail = await this.generateThumbnail(imageBuffer, mimeType, thumbnailSize, metadata);
      thumbnailBuffer = thumbnail?.buffer;
      thumbnailMimeType = thumbnail?.mimeType;
    }

    const processingTimeMs = Date.now() - startTime;

    logger.info({
      embeddingDim: embedding.length,
      embeddingModel,
      hasThumbnail: !!thumbnailBuffer,
      metadata: { width: metadata.width, height: metadata.height, format: metadata.format },
      processingTimeMs,
    }, 'Imagem processada');

    return {
      embedding,
      embeddingModel,
      thumbnailBuffer,
      thumbnailMimeType,
      metadata,
      processedAt: new Date().toISOString(),
      processingTimeMs,
    };
  }

  /**
   * Gera embedding de texto via GPU para busca por descrição
   * Permite buscar imagens por descrição textual
   */
  async generateTextEmbedding(text: string): Promise<{ embedding: number[]; model: string }> {
    if (!this.isConfigured) {
      throw new Error('EMBEDDINGS_GPU_URL não configurado - GPU é OBRIGATÓRIO');
    }

    if (!text || text.trim().length === 0) {
      throw new Error('Texto vazio não é permitido para geração de embedding');
    }

    const startTime = Date.now();
    const trimmedText = text.trim();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(`${EMBEDDINGS_GPU_URL}/embed/text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmedText }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`GPU Embeddings API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json() as { embedding: number[]; model: string; dimension: number };
      
      validateEmbeddingDimension(result.embedding, CLIP_EMBEDDING_DIM, 'CLIP');

      const processingTimeMs = Date.now() - startTime;

      logger.info({
        textLength: trimmedText.length,
        embeddingDim: result.embedding.length,
        model: result.model,
        processingTimeMs,
      }, 'Text embedding gerado via GPU');

      return {
        embedding: result.embedding,
        model: result.model || 'BAAI/bge-m3',
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Gera thumbnail da imagem
   */
  private async generateThumbnail(
    imageBuffer: Buffer,
    mimeType: string,
    maxSize: number,
    metadata: ImageMetadata
  ): Promise<{ buffer: Buffer; mimeType: string } | null> {
    try {
      const width = metadata.width || 0;
      const height = metadata.height || 0;
      
      if (width > 0 && height > 0 && width <= maxSize * 2 && height <= maxSize * 2) {
        return { buffer: imageBuffer, mimeType };
      }

      try {
        const sharpModule = await import('sharp').catch(() => null);
        
        type SharpModule = {
          default?: (input?: Buffer | string) => SharpInstance;
        } & ((input?: Buffer | string) => SharpInstance);
        
        type SharpInstance = {
          resize: (width: number, height: number, options?: { fit?: string; withoutEnlargement?: boolean }) => SharpInstance;
          jpeg: (options?: { quality?: number }) => SharpInstance;
          toBuffer: () => Promise<Buffer>;
        };
        
        const sharp = sharpModule 
          ? ((sharpModule as unknown as SharpModule).default ?? (sharpModule as unknown as SharpModule))
          : null;
        
        if (sharp && typeof sharp === 'function') {
          const thumbnailBuffer = await sharp(imageBuffer)
            .resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();

          return { buffer: thumbnailBuffer, mimeType: 'image/jpeg' };
        }
      } catch {
        logger.debug('Sharp não disponível');
      }

      if (imageBuffer.length < 500 * 1024) {
        return { buffer: imageBuffer, mimeType };
      }

      return null;
    } catch (error) {
      logger.error({ error }, 'Erro ao gerar thumbnail');
      return null;
    }
  }

  /**
   * Gera embedding de imagem via GPU (OpenCLIP ViT-H/14, 1024 dim)
   */
  private async generateImageEmbedding(
    imageBuffer: Buffer,
    mimeType: string
  ): Promise<{ embedding: number[]; model: string }> {
    const base64Image = imageBuffer.toString('base64');
    const imageDataUri = `data:${mimeType};base64,${base64Image}`;
    
    const result = await callGpuApi({ image: imageDataUri });
    
    validateEmbeddingDimension(result.embedding, CLIP_EMBEDDING_DIM, 'CLIP');

    return result;
  }

  /**
   * Extrai metadata da imagem
   */
  private async extractMetadata(
    imageBuffer: Buffer,
    mimeType: string,
    extractExif: boolean
  ): Promise<ImageMetadata> {
    const metadata: ImageMetadata = {};

    const formatMap: Record<string, string> = {
      'image/jpeg': 'jpeg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'image/svg+xml': 'svg',
      'image/bmp': 'bmp',
    };
    metadata.format = formatMap[mimeType] || 'unknown';

    try {
      const dimensions = this.extractDimensionsFromBuffer(imageBuffer, mimeType);
      if (dimensions) {
        metadata.width = dimensions.width;
        metadata.height = dimensions.height;
      }
    } catch (error) {
      logger.warn({ error }, 'Não foi possível extrair dimensões da imagem');
    }

    if (extractExif && (mimeType === 'image/jpeg' || mimeType === 'image/tiff')) {
      try {
        const exif = this.extractBasicExif(imageBuffer);
        if (Object.keys(exif).length > 0) {
          metadata.exif = exif;
        }
      } catch (error) {
        logger.warn({ error }, 'Não foi possível extrair EXIF');
      }
    }

    return metadata;
  }

  /**
   * Extrai dimensões do buffer da imagem
   */
  private extractDimensionsFromBuffer(
    buffer: Buffer,
    mimeType: string
  ): { width: number; height: number } | null {
    try {
      // PNG
      if (mimeType === 'image/png' && buffer.length >= 24) {
        if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
          return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
        }
      }

      // JPEG
      if (mimeType === 'image/jpeg' && buffer.length > 2) {
        if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
          let offset = 2;
          while (offset < buffer.length - 8) {
            if (buffer[offset] === 0xFF) {
              const marker = buffer[offset + 1];
              if (marker >= 0xC0 && marker <= 0xC3) {
                return { 
                  width: buffer.readUInt16BE(offset + 7), 
                  height: buffer.readUInt16BE(offset + 5) 
                };
              }
              const length = buffer.readUInt16BE(offset + 2);
              offset += 2 + length;
            } else {
              offset++;
            }
          }
        }
      }

      // GIF
      if (mimeType === 'image/gif' && buffer.length >= 10) {
        if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
          return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
        }
      }

      // WebP
      if (mimeType === 'image/webp' && buffer.length >= 30) {
        if (buffer.slice(0, 4).toString() === 'RIFF' && buffer.slice(8, 12).toString() === 'WEBP') {
          const chunk = buffer.slice(12, 16).toString();
          if (chunk === 'VP8 ' && buffer.length >= 30) {
            return { 
              width: buffer.readUInt16LE(26) & 0x3FFF, 
              height: buffer.readUInt16LE(28) & 0x3FFF 
            };
          } else if (chunk === 'VP8L' && buffer.length >= 25) {
            const bits = buffer.readUInt32LE(21);
            return { width: (bits & 0x3FFF) + 1, height: ((bits >> 14) & 0x3FFF) + 1 };
          }
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Extrai campos EXIF básicos
   */
  private extractBasicExif(buffer: Buffer): Record<string, unknown> {
    const exif: Record<string, unknown> = {};

    if (buffer[0] !== 0xFF || buffer[1] !== 0xD8) {
      return exif;
    }

    let offset = 2;
    while (offset < buffer.length - 4) {
      if (buffer[offset] === 0xFF && buffer[offset + 1] === 0xE1) {
        const length = buffer.readUInt16BE(offset + 2);
        const app1Data = buffer.slice(offset + 4, offset + 2 + length);
        
        if (app1Data.slice(0, 6).toString() === 'Exif\0\0') {
          exif.hasExif = true;
        }
        break;
      }
      offset++;
    }

    return exif;
  }

  isReady(): boolean {
    return this.isConfigured;
  }

  async isReadyAsync(): Promise<boolean> {
    if (!this.isConfigured) return false;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    try {
      const response = await fetch(`${EMBEDDINGS_GPU_URL}/ready`, {
        method: 'GET',
        signal: controller.signal,
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  getConfig(): { 
    configured: boolean; 
    embeddingDim: number; 
    model: string; 
    gpuUrl: string;
  } {
    return {
      configured: this.isConfigured,
      embeddingDim: CLIP_EMBEDDING_DIM,
      model: 'OpenCLIP-ViT-H-14 (GPU - Salad Cloud)',
      gpuUrl: EMBEDDINGS_GPU_URL,
    };
  }
}

// Singleton
let imageProcessorInstance: ImageProcessorService | null = null;

export function getImageProcessor(): ImageProcessorService {
  if (!imageProcessorInstance) {
    imageProcessorInstance = new ImageProcessorService();
  }
  return imageProcessorInstance;
}

export const imageProcessor = getImageProcessor();

/**
 * Retorna status do circuit breaker GPU
 */
export function getGpuCircuitBreakerStatus(): {
  state: string;
  stats: {
    fires: number;
    failures: number;
    successes: number;
    fallbacks: number;
    timeouts: number;
    cacheHits: number;
    latencyMean: number;
  };
} {
  const stats = gpuBreaker.stats;
  return {
    state: gpuBreaker.opened ? 'open' : (gpuBreaker.halfOpen ? 'half-open' : 'closed'),
    stats: {
      fires: stats.fires || 0,
      failures: stats.failures || 0,
      successes: stats.successes || 0,
      fallbacks: stats.fallbacks || 0,
      timeouts: stats.timeouts || 0,
      cacheHits: stats.cacheHits || 0,
      latencyMean: stats.latencyMean || 0,
    },
  };
}
