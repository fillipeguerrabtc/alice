/**
 * Image Generation Client - Alice Enterprise Platform
 * 
 * Cliente para FLUX.1 Schnell self-hosted no Salad Cloud.
 * Gera imagens em 1-3 segundos com custo ~$0.20/hora.
 * 
 * Modelo: FLUX.1 Schnell (Apache 2.0, uso comercial permitido)
 * Hospedagem: Salad Cloud Container Group dedicado
 * 
 * Documentação em PT-BR (Regra 10 replit.md)
 */

import CircuitBreaker from 'opossum';
import pino from 'pino';
import { eq } from 'drizzle-orm';
import * as schema from '../../../shared/schema.js';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
}).child({ module: 'image-generation' });

const SALAD_API_KEY = process.env.SALAD_API_KEY;
const SALAD_ORGANIZATION_ID = process.env.SALAD_ORGANIZATION_ID;
const FLUX_ENDPOINT = process.env.FLUX_ENDPOINT || 'https://api.salad.com/api/public';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbClient = any;
let db: DbClient;

export function initImageGeneration(dbClient: DbClient): void {
  db = dbClient;
  logger.info('Image generation client inicializado com conexão compartilhada');
}

// ============================================================================
// TYPES
// ============================================================================

interface ImageGenerationRequest {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  seed?: number;
  guidanceScale?: number;
}

interface ImageGenerationResponse {
  imageBase64: string;
  generationTimeMs: number;
  seed: number;
  metadata: Record<string, unknown>;
}

interface CLIPEmbeddingResponse {
  embedding: number[];
}

// ============================================================================
// CIRCUIT BREAKER (Regra 16 - Best Practices 2025)
// ============================================================================

const circuitBreakerOptions = {
  timeout: 30000,           // FLUX.1 Schnell: 1-3s, timeout 30s
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  volumeThreshold: 3,
};

async function generateImageInternal(request: ImageGenerationRequest): Promise<ImageGenerationResponse> {
  if (!SALAD_API_KEY || !SALAD_ORGANIZATION_ID) {
    throw new Error('SALAD_API_KEY ou SALAD_ORGANIZATION_ID não configurados');
  }

  const startTime = Date.now();

  const response = await fetch(`${FLUX_ENDPOINT}/organizations/${SALAD_ORGANIZATION_ID}/inference-endpoints/flux-schnell/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Salad-Api-Key': SALAD_API_KEY,
    },
    body: JSON.stringify({
      prompt: request.prompt,
      negative_prompt: request.negativePrompt || '',
      width: request.width || 1024,
      height: request.height || 1024,
      num_inference_steps: request.steps || 4,
      seed: request.seed || Math.floor(Math.random() * 2147483647),
      guidance_scale: request.guidanceScale || 3.5,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Erro na geração de imagem: ${error}`);
  }

  const data = await response.json() as {
    image: string;
    seed: number;
    metadata?: Record<string, unknown>;
  };

  return {
    imageBase64: data.image,
    generationTimeMs: Date.now() - startTime,
    seed: data.seed,
    metadata: data.metadata || {},
  };
}

const imageGenBreaker = new CircuitBreaker(generateImageInternal, circuitBreakerOptions);

imageGenBreaker.on('open', () => {
  logger.warn('Circuit breaker FLUX.1: ABERTO - Serviço temporariamente indisponível');
});
imageGenBreaker.on('halfOpen', () => {
  logger.info('Circuit breaker FLUX.1: HALF-OPEN - Testando reconexão');
});
imageGenBreaker.on('close', () => {
  logger.info('Circuit breaker FLUX.1: FECHADO - Serviço funcionando normalmente');
});

// ============================================================================
// GERAÇÃO DE IMAGEM
// ============================================================================

/**
 * Gera uma imagem usando FLUX.1 Schnell
 */
export async function generateImage(
  request: ImageGenerationRequest,
  options?: {
    tenantId?: string;
    conversationId?: string;
    messageId?: string;
    createdBy?: string;
  }
): Promise<{
  imageId: string;
  imageBase64: string;
  generationTimeMs: number;
}> {
  try {
    const [pendingRecord] = await db.insert(schema.generatedImages).values({
      tenantId: options?.tenantId,
      conversationId: options?.conversationId,
      messageId: options?.messageId,
      createdBy: options?.createdBy,
      prompt: request.prompt,
      negativePrompt: request.negativePrompt,
      width: request.width || 1024,
      height: request.height || 1024,
      steps: request.steps || 4,
      seed: request.seed,
      guidanceScale: request.guidanceScale || 3.5,
      status: 'generating',
    }).returning();

    logger.info({ 
      imageId: pendingRecord.id, 
      prompt: request.prompt.substring(0, 100),
    }, 'Iniciando geração de imagem');

    const result = await imageGenBreaker.fire(request) as ImageGenerationResponse;

    const imageDataUrl = `data:image/png;base64,${result.imageBase64}`;
    
    await db.update(schema.generatedImages)
      .set({
        status: 'completed',
        seed: result.seed,
        generationTimeMs: result.generationTimeMs,
        imageUrl: imageDataUrl,
        metadata: result.metadata,
      })
      .where(eq(schema.generatedImages.id, pendingRecord.id));

    logger.info({ 
      imageId: pendingRecord.id, 
      generationTimeMs: result.generationTimeMs,
    }, 'Imagem gerada com sucesso e persistida');

    return {
      imageId: pendingRecord.id,
      imageBase64: result.imageBase64,
      generationTimeMs: result.generationTimeMs,
    };
  } catch (error) {
    logger.error({ error, request }, 'Erro ao gerar imagem');
    
    if (error instanceof Error && error.message.includes('Breaker is open')) {
      throw new Error('Serviço de geração de imagens temporariamente indisponível. Tente novamente em alguns segundos.');
    }
    
    throw error;
  }
}

// ============================================================================
// CLIP EMBEDDINGS (Para RAG Multimodal)
// ============================================================================

async function generateCLIPEmbeddingInternal(imageBase64: string): Promise<CLIPEmbeddingResponse> {
  if (!SALAD_API_KEY || !SALAD_ORGANIZATION_ID) {
    throw new Error('SALAD_API_KEY ou SALAD_ORGANIZATION_ID não configurados');
  }

  const response = await fetch(`${FLUX_ENDPOINT}/organizations/${SALAD_ORGANIZATION_ID}/inference-endpoints/clip-embeddings/embed`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Salad-Api-Key': SALAD_API_KEY,
    },
    body: JSON.stringify({
      image: imageBase64,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Erro ao gerar CLIP embedding: ${error}`);
  }

  const data = await response.json() as { embedding: number[] };
  return { embedding: data.embedding };
}

const clipBreaker = new CircuitBreaker(generateCLIPEmbeddingInternal, {
  ...circuitBreakerOptions,
  timeout: 10000,
});

/**
 * Gera embedding CLIP para uma imagem (768 dimensões)
 */
export async function generateCLIPEmbedding(imageBase64: string): Promise<number[]> {
  try {
    const result = await clipBreaker.fire(imageBase64) as CLIPEmbeddingResponse;
    return result.embedding;
  } catch (error) {
    logger.error({ error }, 'Erro ao gerar CLIP embedding');
    throw error;
  }
}

/**
 * Armazena CLIP embedding para uma imagem gerada
 */
export async function storeImageEmbedding(imageId: string, imageBase64: string): Promise<void> {
  try {
    const embedding = await generateCLIPEmbedding(imageBase64);
    
    await db.update(schema.generatedImages)
      .set({ clipEmbedding: embedding })
      .where(eq(schema.generatedImages.id, imageId));
    
    logger.info({ imageId, embeddingDimensions: embedding.length }, 'CLIP embedding armazenado');
  } catch (error) {
    logger.error({ error, imageId }, 'Erro ao armazenar CLIP embedding');
  }
}

// ============================================================================
// APROVAÇÃO E FEEDBACK
// ============================================================================

/**
 * Registra feedback do usuário para uma imagem
 */
export async function rateImage(imageId: string, score: number): Promise<void> {
  if (score < 1 || score > 5) {
    throw new Error('Score deve estar entre 1 e 5');
  }
  
  await db.update(schema.generatedImages)
    .set({ feedbackScore: score })
    .where(eq(schema.generatedImages.id, imageId));
  
  logger.info({ imageId, score }, 'Feedback de imagem registrado');
}

/**
 * Aprova imagem para uso em fine-tuning
 */
export async function approveForTraining(imageId: string, approved: boolean): Promise<void> {
  await db.update(schema.generatedImages)
    .set({ approvedForTraining: approved })
    .where(eq(schema.generatedImages.id, imageId));
  
  logger.info({ imageId, approved }, 'Status de aprovação para treinamento atualizado');
}

/**
 * Lista imagens aprovadas para fine-tuning que ainda não foram usadas
 */
export async function getApprovedImagesForTraining(limit = 100) {
  const images = await db.query.generatedImages.findMany({
    where: eq(schema.generatedImages.approvedForTraining, true),
    limit,
  }) as Array<typeof schema.generatedImages.$inferSelect>;
  
  return images.filter((img: typeof schema.generatedImages.$inferSelect) => !img.usedInFineTuning);
}

/**
 * Marca imagens como usadas em um job de fine-tuning
 */
export async function markImagesAsUsedInTraining(
  imageIds: string[],
  fineTuningJobId: string
): Promise<void> {
  for (const imageId of imageIds) {
    await db.update(schema.generatedImages)
      .set({
        usedInFineTuning: true,
        fineTuningJobId,
      })
      .where(eq(schema.generatedImages.id, imageId));
  }
  
  logger.info({ count: imageIds.length, fineTuningJobId }, 'Imagens marcadas como usadas em fine-tuning');
}

// ============================================================================
// STATUS E MÉTRICAS
// ============================================================================

/**
 * Retorna estatísticas do circuit breaker
 */
export function getImageGenBreakerStats() {
  return {
    state: imageGenBreaker.opened ? 'open' : (imageGenBreaker.halfOpen ? 'half-open' : 'closed'),
    stats: {
      failures: imageGenBreaker.stats.failures,
      successes: imageGenBreaker.stats.successes,
      timeouts: imageGenBreaker.stats.timeouts,
    },
  };
}

/**
 * Retorna estatísticas de geração de imagens
 */
export async function getImageGenerationStats() {
  type GeneratedImage = typeof schema.generatedImages.$inferSelect;
  const images = await db.query.generatedImages.findMany() as GeneratedImage[];
  
  const completed = images.filter((img: GeneratedImage) => img.status === 'completed');
  const avgGenerationTime = completed.length > 0
    ? completed.reduce((sum: number, img: GeneratedImage) => sum + (img.generationTimeMs || 0), 0) / completed.length
    : 0;
  
  return {
    total: images.length,
    completed: completed.length,
    pending: images.filter((img: GeneratedImage) => img.status === 'pending' || img.status === 'generating').length,
    failed: images.filter((img: GeneratedImage) => img.status === 'failed').length,
    approvedForTraining: images.filter((img: GeneratedImage) => img.approvedForTraining).length,
    usedInFineTuning: images.filter((img: GeneratedImage) => img.usedInFineTuning).length,
    averageGenerationTimeMs: Math.round(avgGenerationTime),
  };
}
