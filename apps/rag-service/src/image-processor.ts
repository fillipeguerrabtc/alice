/**
 * Image Processor Service - Alice Enterprise Platform
 * 
 * Processamento de imagens:
 * - OpenCLIP ViT-H/14 embeddings (1024 dimensões) via GPU Manager Service
 * - Thumbnails via sharp (quando disponível)
 * - Extração de metadata EXIF
 * - Circuit breaker para resiliência (Regra 16 CLAUDE.md)
 * 
 * ARQUITETURA 100% GPU (25/12/2025):
 * - OpenCLIP ViT-H/14 roda em GPU via GPU Manager Service (1024 dim)
 * - GPU é OBRIGATÓRIO - SEM fallback CPU (Regra 6 - sem workarounds)
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import { createLogger } from '@alice/logger';
import { createCircuitBreaker, CIRCUIT_BREAKER_PRESETS, requestGpu, GpuServiceType, GpuRequestPriority } from '@alice/shared-utils';
import { validateEmbeddingDimension } from '@alice/database';

const logger = createLogger('image-processor');

type OpenAIResponsesApiResponse = {
  id?: string;
  model?: string;
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

function extractOutputTextFromResponsesApi(resp: OpenAIResponsesApiResponse | undefined): string | null {
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
const DEFAULT_VLM_IMAGE_PROMPT =
  'Você é um assistente especializado em Trading, Finanças, Contabilidade e Matemática. ' +
  'Analise a imagem enviada. Se for um gráfico (candles, indicadores), descreva padrões, tendência, suportes/resistências, ' +
  'possíveis sinais e riscos. Se houver texto na imagem, transcreva o que for legível. ' +
  'Se a imagem não for de trading, descreva objetivamente o conteúdo. Responda em PT-BR.';

// GPU Manager Service - Gerenciamento centralizado de requisições GPU (25/12/2025)
// GPU é OBRIGATÓRIO - OpenCLIP ViT-H/14 (1024 dim) → pgvector
const GPU_MANAGER_URL = process.env.GPU_MANAGER_URL || 'http://alice-gpu-manager:3010';

// Dimensão dos embeddings de imagem (OpenCLIP ViT-H/14 - 1024 dim → pgvector)
export const CLIP_EMBEDDING_DIM = 1024;

// ============================================================================
// CIRCUIT BREAKER - GPU Embeddings API (Regra 16 - Melhores Práticas 2025)
// ============================================================================

// ============================================================================
// CIRCUIT BREAKERS - GPU Embeddings API (Regra 16 - Melhores Práticas 2025)
// ============================================================================

// Parâmetros para embedding de imagem
interface ImageEmbeddingsApiParams {
  image: string;
}

// Parâmetros para embedding de texto (busca text-to-image)
interface TextForImageApiParams {
  text: string;
}

interface VlmDescribeImageParams {
  imageDataUri: string;
  question?: string;
}

/**
 * Chama API GPU para embedding de IMAGEM (OpenCLIP ViT-H/14)
 */
async function callImageEmbeddingsGpuApi(params: ImageEmbeddingsApiParams): Promise<{ embedding: number[]; model: string }> {
  // ARQUITETURA ENTERPRISE (25/12/2025): Usar GPU Manager Service
  const gpuResponse = await requestGpu({
    serviceType: GpuServiceType.EMBEDDINGS,
    endpoint: '/embed/image',
    method: 'POST',
    priority: GpuRequestPriority.MEDIUM,
    timeout: 60000, // 60s timeout
    body: params,
  });

  if (!gpuResponse.success || !gpuResponse.data) {
    throw new Error(gpuResponse.error || 'Erro ao gerar embedding de imagem');
  }

  const result = gpuResponse.data as { embedding: number[]; model: string; dimension: number };
  
  if (!result.embedding || !Array.isArray(result.embedding)) {
    throw new Error('Resposta GPU inválida - embedding ausente');
  }

  return {
    embedding: result.embedding,
    model: result.model || 'OpenCLIP-ViT-H-14',
  };
}

/**
 * Chama API GPU para embedding de TEXTO para busca de imagens (OpenCLIP text encoder)
 * 
 * IMPORTANTE: Usa /embed/text-for-image que gera embeddings no MESMO espaço vetorial
 * das imagens (OpenCLIP 1024 dim), permitindo busca semântica correta text-to-image.
 * 
 * NÃO confundir com /embed/text que usa Qwen3-Embedding-0.6B (1024 dim - espaço vetorial diferente!)
 */
async function callTextForImageGpuApi(params: TextForImageApiParams): Promise<{ embedding: number[]; model: string }> {
  // ARQUITETURA ENTERPRISE (25/12/2025): Usar GPU Manager Service
  const gpuResponse = await requestGpu({
    serviceType: GpuServiceType.EMBEDDINGS,
    endpoint: '/embed/text-for-image',
    method: 'POST',
    priority: GpuRequestPriority.MEDIUM,
    timeout: 30000, // 30s timeout
    body: params,
  });

  if (!gpuResponse.success || !gpuResponse.data) {
    throw new Error(gpuResponse.error || 'Erro ao gerar embedding de texto para imagem');
  }

  const result = gpuResponse.data as { embedding: number[]; model: string; dimension: number };
  
  if (!result.embedding || !Array.isArray(result.embedding)) {
    throw new Error('Resposta GPU inválida - embedding ausente');
  }

  return {
    embedding: result.embedding,
    model: result.model || 'OpenCLIP-ViT-H-14',
  };
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY && process.env.NODE_ENV === 'production') {
  logger.error('OPENAI_API_KEY é obrigatório em produção (Vision via OpenAI)');
  process.exit(1);
}

/**
 * Chama OpenAI (Responses API) para extrair descrição/análise de imagem.
 */
async function callOpenAiDescribeImage(params: VlmDescribeImageParams): Promise<{ text: string; model: string }> {
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
          content: [{ type: 'input_text', text: DEFAULT_VLM_IMAGE_PROMPT }],
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


// Circuit breaker para chamadas GPU de IMAGEM
const gpuImageBreaker = createCircuitBreaker(callImageEmbeddingsGpuApi, {
  name: 'embeddings-gpu-image',
  ...CIRCUIT_BREAKER_PRESETS.clipEmbeddings,
});

// Circuit breaker para chamadas GPU de TEXTO para busca de imagens
const gpuTextForImageBreaker = createCircuitBreaker(callTextForImageGpuApi, {
  name: 'embeddings-gpu-text-for-image',
  ...CIRCUIT_BREAKER_PRESETS.clipEmbeddings,
});

// Circuit breaker para descrição de imagem via OpenAI (Vision)
const openAiVisionDescribeBreaker = createCircuitBreaker(callOpenAiDescribeImage, {
  name: 'openai-vision-describe-image',
  ...CIRCUIT_BREAKER_PRESETS.default,
});

async function callGpuImageApi(params: ImageEmbeddingsApiParams): Promise<{ embedding: number[]; model: string }> {
  return gpuImageBreaker.fire(params) as Promise<{ embedding: number[]; model: string }>;
}

async function callGpuTextForImageApi(params: TextForImageApiParams): Promise<{ embedding: number[]; model: string }> {
  return gpuTextForImageBreaker.fire(params) as Promise<{ embedding: number[]; model: string }>;
}

async function callOpenAiVisionDescribeApi(params: VlmDescribeImageParams): Promise<{ text: string; model: string }> {
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
  vlmDescription?: string;
  vlmModel?: string;
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
  // GPU Manager Service (Hetzner GEX44) sempre disponível - GPU dedicada 24/7
  private readonly isConfigured: boolean = true;

  constructor() {
    // ARQUITETURA ENTERPRISE (26/12/2025): GPU dedicada Hetzner GEX44 sempre disponível
    // GPU Manager Service gerencia todos os serviços GPU via rede Docker interna
    // Não há cold start - containers rodam 24/7
    logger.info(
      { gpuManagerUrl: GPU_MANAGER_URL, embeddingDim: CLIP_EMBEDDING_DIM },
      'Image Processor configurado - GPU dedicada 24/7 (OpenCLIP ViT-H/14, 1024 dim)'
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
    const {
      generateThumbnail = true,
      thumbnailSize = 256,
      extractExif = true,
      generateDescription = true,
      descriptionQuestion,
    } = options;

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

    // Descrever imagem via OpenAI Vision
    let vlmDescription: string | undefined;
    let vlmModel: string | undefined;
    if (generateDescription) {
      try {
        const base64Image = imageBuffer.toString('base64');
        const imageDataUri = `data:${mimeType};base64,${base64Image}`;
        const described = await callOpenAiVisionDescribeApi({ imageDataUri, question: descriptionQuestion });
        vlmDescription = described.text;
        vlmModel = described.model;
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
      embeddingDim: embedding.length,
      embeddingModel,
      hasThumbnail: !!thumbnailBuffer,
      metadata: { width: metadata.width, height: metadata.height, format: metadata.format },
      processingTimeMs,
    }, 'Imagem processada');

    return {
      embedding,
      embeddingModel,
      vlmDescription,
      vlmModel,
      thumbnailBuffer,
      thumbnailMimeType,
      metadata,
      processedAt: new Date().toISOString(),
      processingTimeMs,
    };
  }

  /**
   * Gera embedding de texto via GPU para busca por descrição de imagens
   * 
   * IMPORTANTE (Bug Fix 15/12/2025):
   * - Usa /embed/text-for-image (OpenCLIP text encoder)
   * - Gera embeddings no MESMO espaço vetorial das imagens
   * - Permite busca semântica correta text-to-image
   * - Protegido por circuit breaker (Regra 16)
   * 
   * NÃO confundir com embeddings de documentos que usam Qwen3-Embedding-0.6B (1024 dim → Qdrant)!
   */
  async generateTextEmbedding(text: string): Promise<{ embedding: number[]; model: string }> {
    if (!this.isConfigured) {
      throw new Error('GPU_MANAGER_URL não configurado - GPU é OBRIGATÓRIO');
    }

    if (!text || text.trim().length === 0) {
      throw new Error('Texto vazio não é permitido para geração de embedding');
    }

    const startTime = Date.now();
    const trimmedText = text.trim();

      // Usar circuit breaker para resiliência (Regra 16)
    // Chama /embed/text-for-image (OpenCLIP) para mesmo espaço vetorial das imagens
    const result = await callGpuTextForImageApi({ text: trimmedText });
    
      validateEmbeddingDimension(result.embedding, CLIP_EMBEDDING_DIM, 'CLIP');

      const processingTimeMs = Date.now() - startTime;

      logger.info({
        textLength: trimmedText.length,
        embeddingDim: result.embedding.length,
      model: result.model,
        processingTimeMs,
    }, 'Text-for-image embedding gerado via GPU (OpenCLIP)');

      return {
        embedding: result.embedding,
      model: result.model,
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
   * Gera embedding de imagem via GPU (OpenCLIP ViT-H/14, 1024 dim)
   * Protegido por circuit breaker (Regra 16)
   */
  private async generateImageEmbedding(
    imageBuffer: Buffer,
    mimeType: string
  ): Promise<{ embedding: number[]; model: string }> {
    const base64Image = imageBuffer.toString('base64');
    const imageDataUri = `data:${mimeType};base64,${base64Image}`;
      
    // Usar circuit breaker para resiliência (Regra 16)
    const result = await callGpuImageApi({ image: imageDataUri });
    
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
      // Verificar se GPU Manager Service está pronto
      // BUG FIX 25/12/2025: Container name correto é alice-gpu-manager (definido em docker-compose.prod.yml)
      const response = await fetch(`${process.env.GPU_MANAGER_URL || 'http://alice-gpu-manager:3010'}/ready`, {
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
    gpuManagerUrl: string;
  } {
    return {
      configured: this.isConfigured,
      embeddingDim: CLIP_EMBEDDING_DIM,
      model: 'OpenCLIP-ViT-H-14 (GPU Manager Service)',
      gpuManagerUrl: GPU_MANAGER_URL,
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
export function getGpuCircuitBreakerStatus(): {
  image: {
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
  textForImage: {
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
  const imageStats = gpuImageBreaker.stats;
  const textStats = gpuTextForImageBreaker.stats;
  
  return {
    image: {
      state: gpuImageBreaker.opened ? 'open' : (gpuImageBreaker.halfOpen ? 'half-open' : 'closed'),
      stats: {
        fires: imageStats.fires || 0,
        failures: imageStats.failures || 0,
        successes: imageStats.successes || 0,
        fallbacks: imageStats.fallbacks || 0,
        timeouts: imageStats.timeouts || 0,
        cacheHits: imageStats.cacheHits || 0,
        latencyMean: imageStats.latencyMean || 0,
      },
    },
    textForImage: {
      state: gpuTextForImageBreaker.opened ? 'open' : (gpuTextForImageBreaker.halfOpen ? 'half-open' : 'closed'),
    stats: {
        fires: textStats.fires || 0,
        failures: textStats.failures || 0,
        successes: textStats.successes || 0,
        fallbacks: textStats.fallbacks || 0,
        timeouts: textStats.timeouts || 0,
        cacheHits: textStats.cacheHits || 0,
        latencyMean: textStats.latencyMean || 0,
      },
    },
  };
}
