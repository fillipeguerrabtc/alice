/**
 * Image Processor Service - Alice Enterprise Platform
 * 
 * Processamento de imagens:
 * - Análise via OpenAI Vision (Responses API)
 * - Thumbnails via sharp (quando disponível)
 * - Extração de metadata EXIF
 * 
 * ARQUITETURA ENTERPRISE:
 * - Toda análise/geração de imagens usa OpenAI (sem GPU)
 * - GPU é reservada apenas para texto, áudio, embeddings e treinamento
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import { createLogger } from '@alice/logger';
import { createCircuitBreaker, CIRCUIT_BREAKER_PRESETS } from '@alice/shared-utils';

const logger = createLogger('image-processor');

export type OpenAIResponsesApiResponse = {
  id?: string;
  model?: string;
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

export function extractOutputTextFromResponsesApi(resp: OpenAIResponsesApiResponse | undefined): string | null {
  const output = resp?.output;
  if (!output || !Array.isArray(output)) return null;
  const parts: string[] = [];
  for (const item of output) {
    const content = item?.content;
    if (!content || !Array.isArray(content)) continue;
    for (const c of content) {
      if (c?.type === 'output_text' && typeof c.text === 'string' && c.text.trim().length > 0) {
        parts.push(c.text);
      }
    }
  }
  const joined = parts.join('\n').trim();
  return joined.length > 0 ? joined : null;
}

// Prompt de descrição de imagens (Vision via OpenAI) - especializado no vertical financeiro.
// Regra 6: não é secret nem valor de infra; é parte da lógica de produto (prompt engineering).
const DEFAULT_VISION_IMAGE_PROMPT =
  'Você é um assistente especializado em Trading, Finanças, Contabilidade e Matemática. ' +
  'Analise a imagem enviada. Se for um gráfico (candles, indicadores), descreva padrões, tendência, suportes/resistências, ' +
  'possíveis sinais e riscos. Se houver texto na imagem, transcreva o que for legível. ' +
  'Se a imagem não for de trading, descreva objetivamente o conteúdo. Responda em PT-BR.';

interface VisionDescribeImageParams {
  imageDataUri: string;
  question?: string;
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY && process.env.NODE_ENV === 'production') {
  logger.error('OPENAI_API_KEY é obrigatório em produção (Vision via OpenAI)');
  process.exit(1);
}

/**
 * Chama OpenAI (Responses API) para extrair descrição/análise de imagem.
 */
async function callOpenAiDescribeImage(params: VisionDescribeImageParams): Promise<{ text: string; model: string }> {
  const question =
    params.question && params.question.trim().length > 0 ? params.question.trim() : 'Descreva e analise esta imagem.';

  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY não configurada - Vision via OpenAI é obrigatória');
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4.1',
      max_output_tokens: 800,
      input: [
        {
          role: 'developer',
          content: [{ type: 'input_text', text: DEFAULT_VISION_IMAGE_PROMPT }],
        },
        {
          role: 'user',
          content: [
            { type: 'input_text', text: question },
            { type: 'input_image', image_url: params.imageDataUri, detail: 'auto' },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`OpenAI Vision error: ${response.status} - ${errText}`);
  }

  const payload = (await response.json()) as OpenAIResponsesApiResponse;
  const content = extractOutputTextFromResponsesApi(payload);
  if (!payload?.id || !payload?.model || !content) {
    throw new Error('Resposta inválida da OpenAI Responses API (Vision)');
  }

  return { text: content, model: payload.model };
}


// Circuit breaker para descrição de imagem via OpenAI (Vision)
const openAiVisionDescribeBreaker = createCircuitBreaker(callOpenAiDescribeImage, {
  name: 'openai-vision-describe-image',
  ...CIRCUIT_BREAKER_PRESETS.default,
});

async function callOpenAiVisionDescribeApi(params: VisionDescribeImageParams): Promise<{ text: string; model: string }> {
  return openAiVisionDescribeBreaker.fire(params) as Promise<{ text: string; model: string }>;
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
  visionDescription?: string;
  visionModel?: string;
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
  /**
   * Se true, extrai descrição via OpenAI Vision e inclui no resultado.
   * Default: true (Vision é requisito central do produto).
   */
  generateDescription?: boolean;
  /**
   * Pergunta opcional para guiar a análise de Vision.
   * Ex.: "Identifique suportes e resistências no gráfico".
   */
  descriptionQuestion?: string;
}

class ImageProcessorService {
  // OpenAI Vision é obrigatório para processamento de imagens
  private readonly isConfigured: boolean = Boolean(OPENAI_API_KEY);

  constructor() {
    logger.info(
      { openaiConfigured: this.isConfigured },
      'Image Processor configurado - OpenAI Vision (sem GPU para imagens)'
    );
  }

  /**
   * Processa uma imagem: gera descrição (Vision), thumbnail e metadata.
   * Embeddings de imagem são gerados separadamente via OpenAI Embeddings.
   */
  async processImage(
    imageBuffer: Buffer,
    mimeType: string,
    options: ImageProcessorOptions = {}
  ): Promise<ProcessedImage> {
    const startTime = Date.now();
    const {
      generateThumbnail = true,
      thumbnailSize = 256,
      extractExif = true,
      generateDescription = true,
      descriptionQuestion,
    } = options;

    // Extrair metadata básica
    const metadata = await this.extractMetadata(imageBuffer, mimeType, extractExif);

    // Embeddings são gerados separadamente via OpenAI Embeddings (sem GPU)
    const embedding: number[] = [];
    const embeddingModel = 'openai-vision';

    // Descrever imagem via OpenAI Vision
    let visionDescription: string | undefined;
    let visionModel: string | undefined;
    if (generateDescription) {
      try {
        const base64Image = imageBuffer.toString('base64');
        const imageDataUri = `data:${mimeType};base64,${base64Image}`;
        const described = await callOpenAiVisionDescribeApi({ imageDataUri, question: descriptionQuestion });
        visionDescription = described.text;
        visionModel = described.model;
      } catch (error) {
        logger.error({ error }, 'Erro ao gerar descrição de imagem via OpenAI Vision');
        // Regra 6: não inventar descrição. O processamento da imagem continua (embeddings + thumbnail).
      }
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
      embeddingModel,
      hasThumbnail: !!thumbnailBuffer,
      metadata: { width: metadata.width, height: metadata.height, format: metadata.format },
      processingTimeMs,
    }, 'Imagem processada');

    return {
      embedding,
      embeddingModel,
      visionDescription,
      visionModel,
      thumbnailBuffer,
      thumbnailMimeType,
      metadata,
      processedAt: new Date().toISOString(),
      processingTimeMs,
    };
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
    return this.isConfigured;
  }

  getConfig(): { 
    configured: boolean; 
    model: string; 
  } {
    return {
      configured: this.isConfigured,
      model: 'OpenAI Vision (Responses API)',
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
 * Retorna status dos circuit breakers GPU
 */
export function getVisionCircuitBreakerStatus(): {
  openaiVision: {
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
  };
} {
  const visionStats = openAiVisionDescribeBreaker.stats;

  return {
    openaiVision: {
      state: openAiVisionDescribeBreaker.opened ? 'open' : (openAiVisionDescribeBreaker.halfOpen ? 'half-open' : 'closed'),
      stats: {
        fires: visionStats.fires || 0,
        failures: visionStats.failures || 0,
        successes: visionStats.successes || 0,
        fallbacks: visionStats.fallbacks || 0,
        timeouts: visionStats.timeouts || 0,
        cacheHits: visionStats.cacheHits || 0,
        latencyMean: visionStats.latencyMean || 0,
      },
    },
  };
}
