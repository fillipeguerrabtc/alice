/**
 * Image Processor Service - Alice Enterprise Platform
 * 
 * Processamento de imagens:
 * - CLIP embeddings (768 dimensões) via serviço local (alice-clip-inference)
 * - Thumbnails via sharp (quando disponível)
 * - Extração de metadata EXIF
 * - Circuit breaker para resiliência (Regra 16 CLAUDE.md)
 * 
 * ARQUITETURA AUTÔNOMA (Regra 6 CLAUDE.md):
 * - CLIP roda localmente no Hetzner via CPU (100% local)
 * - Embeddings CLIP são gerados 100% localmente via CPU no servidor Hetzner
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

// Configuração CLIP Local (Autônomo - Regra 6)
// REGRA 6: Serviço local no Hetzner, não depende de API externa
// Serviço interno na rede Docker privada - não requer autenticação
const CLIP_SERVICE_URL = process.env.CLIP_SERVICE_URL || 'http://alice-clip-inference:8080';

// Dimensão dos embeddings CLIP (ViT-L/14)
export const CLIP_EMBEDDING_DIM = 768;

// ============================================================================
// CIRCUIT BREAKER - CLIP API (Regra 16 - Melhores Práticas 2025)
// Usa CIRCUIT_BREAKER_PRESETS centralizado (Regra 2 - Não Duplicar)
// ============================================================================

// Função interna para chamar API CLIP (será protegida pelo circuit breaker)
interface ClipApiParams {
  endpoint: string;
  body: { text?: string; image?: string; model: string };
}

async function callClipApiInternal(params: ClipApiParams): Promise<{ embedding: number[]; model: string }> {
  // REGRA 6: Serviço local autônomo - não depende de API externa
  // Serviço interno na rede Docker privada - não requer autenticação
  const response = await fetch(`${CLIP_SERVICE_URL}${params.endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params.body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`CLIP API error: ${response.status} - ${errorText}`);
  }

  const result = await response.json() as { embedding: number[]; model: string; input_type?: string };
  
  if (!result.embedding || !Array.isArray(result.embedding)) {
    throw new Error('Resposta CLIP inválida - embedding ausente');
  }

  return {
    embedding: result.embedding,
    model: result.model || 'ViT-L/14',
  };
}

// Circuit breaker para chamadas CLIP
const clipBreaker = createCircuitBreaker(callClipApiInternal, {
  name: 'clip-api',
  ...CIRCUIT_BREAKER_PRESETS.clipEmbeddings,
});

// Função para chamar API CLIP através do circuit breaker
async function callClipApi(params: ClipApiParams): Promise<{ embedding: number[]; model: string }> {
  return clipBreaker.fire(params) as Promise<{ embedding: number[]; model: string }>;
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
    // "Configured" aqui significa: existe URL configurada; prontidão real depende do health check.
    // (Regra 6: sem hardcoded/false positives)
    this.isConfigured = typeof CLIP_SERVICE_URL === 'string' && CLIP_SERVICE_URL.length > 0;
    logger.info(
      { serviceUrl: CLIP_SERVICE_URL, configured: this.isConfigured },
      'Image Processor configurado com serviço CLIP local (autônomo)'
    );
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

    // Gerar embedding via CLIP
    let embedding: number[] = [];
    let embeddingModel = 'none';

    if (this.isConfigured) {
      try {
        const result = await this.generateClipEmbedding(imageBuffer, mimeType);
        embedding = result.embedding;
        embeddingModel = result.model;
      } catch (error) {
        logger.error({ error }, 'Erro ao gerar CLIP embedding');
        // Regra 6 (CLAUDE.md): PROIBIDO retornar embeddings "falsos" (ex: vetor de zeros).
        // Em caso de falha, retornamos "sem embedding" e deixamos o call site persistir como NULL (ou ignorar).
        embedding = [];
        embeddingModel = 'unavailable';
      }
    }
    // REGRA 6: Serviço local sempre disponível (serviço interno na rede Docker)

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
      thumbnailSize: thumbnailBuffer?.length,
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
   * Gera embedding CLIP de texto via serviço local (com circuit breaker - Regra 16)
   * Permite buscar imagens por descrição textual
   * 
   * ARQUITETURA AUTÔNOMA: Usa serviço local alice-clip-inference (100% local via CPU no Hetzner)
   * Embeddings são gerados 100% localmente via CPU no servidor Hetzner
   * 
   * @param text - Texto descritivo para gerar embedding (ex: "gato laranja dormindo")
   * @returns Embedding CLIP (768 dim) e modelo usado
   */
  async generateTextEmbedding(text: string): Promise<{ embedding: number[]; model: string }> {
    // REGRA 6: Serviço local sempre disponível (serviço interno na rede Docker)

    if (!text || text.trim().length === 0) {
      throw new Error('Texto vazio não é permitido para geração de embedding');
    }

    const startTime = Date.now();
    const trimmedText = text.trim();

    try {
      // Usar circuit breaker para resiliência (Regra 16)
      const result = await callClipApi({
        endpoint: '/inference/clip',
        body: {
          text: trimmedText,
          model: 'ViT-L/14',
        },
      });

      // Validar dimensão do embedding (Enterprise-Grade - Regra 6)
      // Lança erro se dimensão estiver incorreta (não apenas warning)
      validateEmbeddingDimension(result.embedding, CLIP_EMBEDDING_DIM, 'CLIP');

      const processingTimeMs = Date.now() - startTime;

      logger.info({
        textLength: trimmedText.length,
        embeddingDim: result.embedding.length,
        model: result.model || 'ViT-L/14',
        processingTimeMs,
      }, 'Text embedding CLIP gerado com sucesso');

      return {
        embedding: result.embedding,
        model: result.model || 'ViT-L/14',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ 
        error: errorMessage, 
        textLength: trimmedText.length,
        endpoint: `${CLIP_SERVICE_URL}/inference/clip`,
      }, 'Erro ao gerar text embedding CLIP (circuit breaker)');
      throw error;
    }
  }

  /**
   * Gera thumbnail da imagem
   * Sem dependência de sharp - usa imagem original para imagens pequenas
   * ou retorna undefined para imagens grandes (thumbnail não disponível)
   */
  private async generateThumbnail(
    imageBuffer: Buffer,
    mimeType: string,
    maxSize: number,
    metadata: ImageMetadata
  ): Promise<{ buffer: Buffer; mimeType: string } | null> {
    try {
      // Se a imagem já é pequena o suficiente, usa como próprio thumbnail
      const width = metadata.width || 0;
      const height = metadata.height || 0;
      
      if (width > 0 && height > 0 && width <= maxSize * 2 && height <= maxSize * 2) {
        // Imagem pequena - usar original como thumbnail
        logger.debug({ width, height, maxSize }, 'Usando imagem original como thumbnail');
        return {
          buffer: imageBuffer,
          mimeType,
        };
      }

      // Para imagens grandes, tentamos carregar sharp dinamicamente
      // Se sharp não estiver disponível, usamos fallback
      try {
        // Tenta carregar sharp dinamicamente (módulo opcional)
        // REGRA 8: TypeScript strict, zero any - tipagem explícita para módulo dinâmico
        const sharpModule = await import('sharp').catch(() => null);
        
        // Tipo helper para módulo sharp (pode ser default export ou named export)
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

          logger.debug({ 
            originalSize: imageBuffer.length, 
            thumbnailSize: thumbnailBuffer.length 
          }, 'Thumbnail gerado com sharp');

          return {
            buffer: thumbnailBuffer,
            mimeType: 'image/jpeg',
          };
        }
      } catch {
        // Sharp não instalado ou não funciona - usar fallback silenciosamente
        logger.debug('Sharp não disponível, usando fallback');
      }

      // Fallback: para imagens grandes sem sharp, retornar a imagem original
      // se for menor que 500KB, caso contrário não gerar thumbnail
      if (imageBuffer.length < 500 * 1024) {
        return {
          buffer: imageBuffer,
          mimeType,
        };
      }

      logger.warn({ 
        width, 
        height, 
        size: imageBuffer.length 
      }, 'Thumbnail não gerado - imagem muito grande e sharp não disponível');
      
      return null;
    } catch (error) {
      logger.error({ error }, 'Erro ao gerar thumbnail');
      return null;
    }
  }

  /**
   * Gera embedding CLIP via serviço local (com circuit breaker - Regra 16)
   * ARQUITETURA AUTÔNOMA: Serviço local no Hetzner via CPU (100% local)
   */
  private async generateClipEmbedding(
    imageBuffer: Buffer,
    mimeType: string
  ): Promise<{ embedding: number[]; model: string }> {
    const base64Image = imageBuffer.toString('base64');
    
    try {
      // Usar circuit breaker para resiliência
      const result = await callClipApi({
        endpoint: '/inference/clip',
        body: {
          image: `data:${mimeType};base64,${base64Image}`,
          model: 'ViT-L/14',
        },
      });
      
      // Validar dimensão do embedding (Enterprise-Grade - Regra 6)
      // Lança erro se dimensão estiver incorreta (não apenas warning)
      validateEmbeddingDimension(result.embedding, CLIP_EMBEDDING_DIM, 'CLIP');

      return {
        embedding: result.embedding,
        model: result.model || 'ViT-L/14',
      };
    } catch (error) {
      logger.error({ error }, 'Erro na API CLIP (circuit breaker)');
      throw error;
    }
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

    // Determinar formato baseado no MIME type
    const formatMap: Record<string, string> = {
      'image/jpeg': 'jpeg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'image/svg+xml': 'svg',
      'image/bmp': 'bmp',
    };
    metadata.format = formatMap[mimeType] || 'unknown';

    // Tentar extrair dimensões do header da imagem
    try {
      const dimensions = this.extractDimensionsFromBuffer(imageBuffer, mimeType);
      if (dimensions) {
        metadata.width = dimensions.width;
        metadata.height = dimensions.height;
      }
    } catch (error) {
      logger.warn({ error }, 'Não foi possível extrair dimensões da imagem');
    }

    // Extração EXIF (simplificada - sem dependência externa)
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
   * Extrai dimensões do buffer da imagem (PNG/JPEG/GIF/WebP)
   */
  private extractDimensionsFromBuffer(
    buffer: Buffer,
    mimeType: string
  ): { width: number; height: number } | null {
    try {
      // PNG: dimensões nos bytes 16-23 do header
      if (mimeType === 'image/png' && buffer.length >= 24) {
        if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
          const width = buffer.readUInt32BE(16);
          const height = buffer.readUInt32BE(20);
          return { width, height };
        }
      }

      // JPEG: procurar marker SOF0 (0xFFC0) ou SOF2 (0xFFC2)
      if (mimeType === 'image/jpeg' && buffer.length > 2) {
        if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
          let offset = 2;
          while (offset < buffer.length - 8) {
            if (buffer[offset] === 0xFF) {
              const marker = buffer[offset + 1];
              // SOF0, SOF1, SOF2, SOF3
              if (marker >= 0xC0 && marker <= 0xC3) {
                const height = buffer.readUInt16BE(offset + 5);
                const width = buffer.readUInt16BE(offset + 7);
                return { width, height };
              }
              // Pular para próximo marker
              const length = buffer.readUInt16BE(offset + 2);
              offset += 2 + length;
            } else {
              offset++;
            }
          }
        }
      }

      // GIF: dimensões nos bytes 6-9
      if (mimeType === 'image/gif' && buffer.length >= 10) {
        if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
          const width = buffer.readUInt16LE(6);
          const height = buffer.readUInt16LE(8);
          return { width, height };
        }
      }

      // WebP: mais complexo, precisa parsear RIFF container
      if (mimeType === 'image/webp' && buffer.length >= 30) {
        if (buffer.slice(0, 4).toString() === 'RIFF' && buffer.slice(8, 12).toString() === 'WEBP') {
          const chunk = buffer.slice(12, 16).toString();
          if (chunk === 'VP8 ' && buffer.length >= 30) {
            // VP8 lossy
            const width = buffer.readUInt16LE(26) & 0x3FFF;
            const height = buffer.readUInt16LE(28) & 0x3FFF;
            return { width, height };
          } else if (chunk === 'VP8L' && buffer.length >= 25) {
            // VP8L lossless
            const bits = buffer.readUInt32LE(21);
            const width = (bits & 0x3FFF) + 1;
            const height = ((bits >> 14) & 0x3FFF) + 1;
            return { width, height };
          }
        }
      }

      return null;
    } catch (error) {
      logger.warn({ error, mimeType }, 'Erro ao extrair dimensões');
      return null;
    }
  }

  /**
   * Extrai campos EXIF básicos (sem biblioteca externa)
   */
  private extractBasicExif(buffer: Buffer): Record<string, unknown> {
    const exif: Record<string, unknown> = {};

    // Verificar se é JPEG
    if (buffer[0] !== 0xFF || buffer[1] !== 0xD8) {
      return exif;
    }

    // Procurar marker EXIF (APP1)
    let offset = 2;
    while (offset < buffer.length - 4) {
      if (buffer[offset] === 0xFF && buffer[offset + 1] === 0xE1) {
        const length = buffer.readUInt16BE(offset + 2);
        const app1Data = buffer.slice(offset + 4, offset + 2 + length);
        
        // Verificar header "Exif\0\0"
        if (app1Data.slice(0, 6).toString() === 'Exif\0\0') {
          exif.hasExif = true;
          // Parsear TIFF header e IFDs seria muito complexo aqui
          // Apenas indicamos que existe EXIF
        }
        break;
      }
      offset++;
    }

    return exif;
  }

  /**
   * Verifica se o serviço está configurado corretamente
   */
  /**
   * @deprecated Use `isReadyAsync()` para readiness real (com checagem de rede).
   *
   * Mantido por compatibilidade: `isReady()` é **síncrono** e indica apenas se o processor
   * está "configurado" localmente. NÃO garante disponibilidade do `alice-clip-inference`.
   */
  isReady(): boolean {
    return this.isConfigured;
  }

  /**
   * Readiness real: valida conectividade com o `alice-clip-inference` (capability CLIP).
   */
  private async checkReadyAsync(): Promise<boolean> {
    // REGRA 6: Serviço local é OBRIGATÓRIO em produção (autonomia)
    // IMPORTANTE: Apesar de ser 100% LOCAL (CPU Hetzner), dependemos do alice-clip-inference estar acessível.
    // Isso evita falso-positivo de readiness quando o container de inferência multimodal está fora do ar.
    if (!this.isConfigured) return false;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s timeout para readiness check

    try {
      // /ready/clip valida SOMENTE a capacidade CLIP (evita falso-negativo quando o serviço está "degraded" por Whisper)
      const response = await fetch(`${CLIP_SERVICE_URL}/ready/clip`, {
        method: 'GET',
        signal: controller.signal,
      });

      if (!response.ok) {
        logger.warn(
          { status: response.status, serviceUrl: CLIP_SERVICE_URL },
          'CLIP inference service não está pronto'
        );
        return false;
      }

      return true;
    } catch (error) {
      logger.error({ error, serviceUrl: CLIP_SERVICE_URL }, 'Erro ao verificar readiness do CLIP inference service');
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Alias explícito para padronização com outros processors.
   * Contrato: SEMPRE assíncrono e retorna `Promise<boolean>`.
   */
  async isReadyAsync(): Promise<boolean> {
    return await this.checkReadyAsync();
  }

  /**
   * Retorna informações sobre a configuração
   */
  getConfig(): { configured: boolean; embeddingDim: number; model: string; serviceUrl: string } {
    return {
      configured: this.isConfigured,
      embeddingDim: CLIP_EMBEDDING_DIM,
      model: this.isConfigured ? 'ViT-L/14 (Local - CPU no Hetzner)' : 'NÃO CONFIGURADO',
      serviceUrl: CLIP_SERVICE_URL,
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
 * Retorna status do circuit breaker CLIP (Regra 16 - Observability)
 */
export function getClipCircuitBreakerStatus(): {
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
  const stats = clipBreaker.stats;
  return {
    state: clipBreaker.opened ? 'open' : (clipBreaker.halfOpen ? 'half-open' : 'closed'),
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
