/**
 * Image Processor Service - Alice Enterprise Platform
 * 
 * Processamento de imagens:
 * - CLIP embeddings (768 dimensões) via Salad Cloud
 * - Thumbnails via sharp (quando disponível)
 * - Extração de metadata EXIF
 * 
 * Documentação em PT-BR (Regra 10 replit.md)
 */

import pino from 'pino';
import crypto from 'crypto';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
}).child({ service: 'image-processor' });

// Configuração Salad Cloud
const SALAD_API_KEY = process.env.SALAD_API_KEY;
const SALAD_ORGANIZATION_ID = process.env.SALAD_ORGANIZATION_ID;
const SALAD_CLIP_ENDPOINT = process.env.SALAD_CLIP_ENDPOINT || 'https://api.salad.com/api/public';

// Dimensão dos embeddings CLIP (ViT-L/14)
export const CLIP_EMBEDDING_DIM = 768;

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
    if (SALAD_API_KEY && SALAD_ORGANIZATION_ID) {
      this.isConfigured = true;
      logger.info('Image Processor configurado com Salad Cloud');
    } else {
      logger.warn('SALAD_API_KEY ou SALAD_ORGANIZATION_ID não configurados - embeddings indisponíveis');
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
        // Usar embedding zero se falhar - marcado como erro
        embedding = new Array(CLIP_EMBEDDING_DIM).fill(0);
        embeddingModel = 'error-fallback-zero';
      }
    } else {
      // PRODUÇÃO: Salad Cloud é OBRIGATÓRIO (Regra 6 replit.md - PROIBIDO mocks)
      logger.error('SALAD_API_KEY não configurado - embeddings indisponíveis em produção');
      throw new Error('Configuração Salad Cloud obrigatória para processamento de imagens. Configure SALAD_API_KEY e SALAD_ORGANIZATION_ID.');
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
   * Gera embedding CLIP de texto via Salad Cloud
   * Permite buscar imagens por descrição textual
   * 
   * IMPORTANTE: Requer endpoint CLIP com suporte a texto configurado em SALAD_CLIP_ENDPOINT
   * O endpoint deve aceitar payload { text: string, model: string } e retornar { embedding: number[] }
   * 
   * @param text - Texto descritivo para gerar embedding (ex: "gato laranja dormindo")
   * @returns Embedding CLIP (768 dim) e modelo usado
   */
  async generateTextEmbedding(text: string): Promise<{ embedding: number[]; model: string }> {
    if (!this.isConfigured) {
      logger.error('SALAD_API_KEY não configurado - text embeddings CLIP indisponíveis');
      throw new Error('Configuração Salad Cloud obrigatória para embeddings de texto CLIP. Configure SALAD_API_KEY e SALAD_ORGANIZATION_ID.');
    }

    if (!text || text.trim().length === 0) {
      throw new Error('Texto vazio não é permitido para geração de embedding');
    }

    const startTime = Date.now();
    const trimmedText = text.trim();

    try {
      // Endpoint CLIP que suporta tanto imagem quanto texto
      // Formato padrão CLIP-as-a-service: POST /inference/clip com { text } ou { image }
      const response = await fetch(`${SALAD_CLIP_ENDPOINT}/inference/clip`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Salad-Api-Key': SALAD_API_KEY!,
          'Salad-Organization': SALAD_ORGANIZATION_ID!,
        },
        body: JSON.stringify({
          text: trimmedText,
          model: 'ViT-L/14',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({
          status: response.status,
          error: errorText,
          textLength: trimmedText.length,
        }, 'Falha na API CLIP para texto');
        throw new Error(`CLIP Text API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json() as { embedding: number[]; model: string };
      
      if (!result.embedding || !Array.isArray(result.embedding)) {
        throw new Error('Resposta CLIP inválida - embedding ausente');
      }

      // Validar dimensão do embedding
      if (result.embedding.length !== CLIP_EMBEDDING_DIM) {
        logger.warn({
          expected: CLIP_EMBEDDING_DIM,
          received: result.embedding.length,
        }, 'Dimensão do text embedding diferente do esperado - verificar configuração CLIP');
      }

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
        endpoint: `${SALAD_CLIP_ENDPOINT}/inference/clip`,
      }, 'Erro ao gerar text embedding CLIP - verificar se endpoint suporta texto');
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
        // Tenta carregar sharp usando require (mais tolerante com módulos opcionais)
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const sharp = require('sharp');
        
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
      } catch (sharpError) {
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
   * Gera embedding CLIP via Salad Cloud
   */
  private async generateClipEmbedding(
    imageBuffer: Buffer,
    mimeType: string
  ): Promise<{ embedding: number[]; model: string }> {
    const base64Image = imageBuffer.toString('base64');
    
    try {
      const response = await fetch(`${SALAD_CLIP_ENDPOINT}/inference/clip`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Salad-Api-Key': SALAD_API_KEY!,
          'Salad-Organization': SALAD_ORGANIZATION_ID!,
        },
        body: JSON.stringify({
          image: `data:${mimeType};base64,${base64Image}`,
          model: 'ViT-L/14',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`CLIP API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json() as { embedding: number[]; model: string };
      
      // Validar dimensão do embedding
      if (result.embedding.length !== CLIP_EMBEDDING_DIM) {
        logger.warn({
          expected: CLIP_EMBEDDING_DIM,
          received: result.embedding.length,
        }, 'Dimensão do embedding diferente do esperado');
      }

      return {
        embedding: result.embedding,
        model: result.model || 'ViT-L/14',
      };
    } catch (error) {
      logger.error({ error }, 'Erro na API CLIP');
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
  isReady(): boolean {
    // PRODUÇÃO: Salad Cloud é OBRIGATÓRIO (Regra 6 replit.md)
    return this.isConfigured;
  }

  /**
   * Retorna informações sobre a configuração
   */
  getConfig(): { configured: boolean; embeddingDim: number; model: string } {
    return {
      configured: this.isConfigured,
      embeddingDim: CLIP_EMBEDDING_DIM,
      model: this.isConfigured ? 'ViT-L/14 (Salad Cloud)' : 'NÃO CONFIGURADO',
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
