/**
 * Image Processor Service - Alice Enterprise Platform
 *
 * Processamento de imagens:
 * - Análise via OpenAI Vision (Responses API)
 *
 * ARQUITETURA ENTERPRISE:
 * - Toda análise/geração de imagens usa OpenAI (sem CPU/GPU local para visão)
 * - Thumbnails são gerados localmente em CPU (OpenAI não fornece)
 * - Não há EXIF ou metadata local (somente OpenAI)
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
    logger.error({
      status: response.status,
      statusText: response.statusText,
      model: 'gpt-4.1',
      errText,
    }, 'OpenAI Vision respondeu com erro');
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
  [key: string]: unknown;
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
  /**
   * Se true, gera thumbnail localmente (CPU).
   * Default: true (otimiza UX no chat).
   */
  generateThumbnail?: boolean;
  /**
   * Tamanho máximo do thumbnail (px).
   */
  thumbnailSize?: number;
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
    if (!this.isConfigured && process.env.NODE_ENV === 'production') {
      logger.error('OPENAI_API_KEY ausente em produção - processamento de imagem falhará até corrigir configuração');
    }
    logger.info(
      { openaiConfigured: this.isConfigured },
      'Image Processor configurado - OpenAI Vision (sem CPU/GPU local)'
    );
  }

  /**
   * Processa uma imagem: gera descrição (Vision) e thumbnail (CPU).
   * Não gera EXIF ou metadata local.
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
      generateDescription = true,
      descriptionQuestion,
    } = options;

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
        // Regra 6: não inventar descrição. O processamento da imagem continua (sem embeddings de imagem).
      }
    }

    // Gerar thumbnail local (CPU)
    let thumbnailBuffer: Buffer | undefined;
    let thumbnailMimeType: string | undefined;
    if (generateThumbnail) {
      const thumbnail = await this.generateThumbnail(imageBuffer, thumbnailSize);
      thumbnailBuffer = thumbnail?.buffer;
      thumbnailMimeType = thumbnail?.mimeType;
    }

    const processingTimeMs = Date.now() - startTime;

    logger.info({
      embeddingModel,
      hasThumbnail: Boolean(thumbnailBuffer),
      processingTimeMs,
    }, 'Imagem processada (OpenAI Vision + thumbnail CPU)');

    return {
      embedding,
      embeddingModel,
      visionDescription,
      visionModel,
      thumbnailBuffer,
      thumbnailMimeType,
      metadata: {},
      processedAt: new Date().toISOString(),
      processingTimeMs,
    };
  }

  /**
   * Gera thumbnail com CPU (OpenAI não fornece thumbnail).
   */
  private async generateThumbnail(
    imageBuffer: Buffer,
    maxSize: number
  ): Promise<{ buffer: Buffer; mimeType: string } | null> {
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

      return null;
    } catch (error) {
      logger.error({ error }, 'Erro ao gerar thumbnail (CPU)');
      return null;
    }
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
 * Retorna status dos circuit breakers Vision
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
