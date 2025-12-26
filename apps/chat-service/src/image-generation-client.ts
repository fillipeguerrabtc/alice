/**
 * Image Generation Client - Alice Enterprise Platform
 * 
 * Cliente para FLUX.1 Schnell self-hosted via GPU Manager Service.
 * Gera imagens em 1-3 segundos com custo otimizado.
 * 
 * Modelo: FLUX.1 Schnell (Apache 2.0, uso comercial permitido)
 * Hospedagem: GPU Manager Service (Hetzner GPU)
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import { createCircuitBreaker, CIRCUIT_BREAKER_PRESETS, requestGpu, GpuServiceType, GpuRequestPriority } from '@alice/shared-utils';
import { createLogger } from '@alice/logger';
import { eq, validateEmbeddingDimension, EMBEDDING_DIMENSIONS } from '@alice/database';
import * as schema from '@alice/shared/schema';
import type { Database } from '@alice/database';

// CORREÇÃO AUDITORIA 17/12/2025: Usar createLogger padronizado da plataforma
// Bug: pino direto com pino-pretty não segue padrão enterprise (Regra 2)
const logger = createLogger('image-generation');

// GPU Manager Service - Gerenciamento centralizado de requisições GPU (25/12/2025)
// BUG FIX 25/12/2025: Container name correto é alice-gpu-manager (definido em docker-compose.prod.yml)
// Este fallback não será usado se GPU_MANAGER_URL estiver definido no docker-compose.prod.yml
const GPU_MANAGER_URL = process.env.GPU_MANAGER_URL || 'http://alice-gpu-manager:3010';

let db: Database;

export function initImageGeneration(dbClient: Database): void {
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
// Usa CIRCUIT_BREAKER_PRESETS centralizado (Regra 2 - Não Duplicar)
// ============================================================================

async function generateImageInternal(request: ImageGenerationRequest): Promise<ImageGenerationResponse> {
  // ARQUITETURA ENTERPRISE (25/12/2025): Usar GPU Manager Service para gerenciar requisições FLUX
  const startTime = Date.now();

  // Enfileirar requisição no GPU Manager com prioridade LOW (geração de imagens)
  const gpuResponse = await requestGpu({
    serviceType: GpuServiceType.FLUX,
    endpoint: '/generate',
    method: 'POST',
    priority: GpuRequestPriority.LOW,
    timeout: 30000, // 30s para geração de imagens
    body: {
      prompt: request.prompt,
      negative_prompt: request.negativePrompt || '',
      width: request.width || 1024,
      height: request.height || 1024,
      num_inference_steps: request.steps || 4,
      seed: request.seed || Math.floor(Math.random() * 2147483647),
      guidance_scale: request.guidanceScale || 3.5,
    },
  });

  if (!gpuResponse.success || !gpuResponse.data) {
    throw new Error(gpuResponse.error || 'Erro na geração de imagem');
  }

  // BUG FIX 25/12/2025: gpuResponse.data já é um objeto parseado (não um Response)
  // requestGpu retorna GpuResponse onde data é unknown (objeto já parseado do JSON)
  // Não devemos chamar .json() em um objeto já parseado
  const data = gpuResponse.data as {
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

const imageGenBreaker = createCircuitBreaker(generateImageInternal, {
  name: 'flux-image-gen',
  ...CIRCUIT_BREAKER_PRESETS.fluxImageGen,
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
  // BUG FIX 25/12/2025: Declarar pendingRecord no escopo da função para estar disponível no catch
  // BUG FIX 25/12/2025: .returning() retorna array - usar destructuring para extrair primeiro elemento
  // TypeScript infere tipo corretamente do schema, mas precisamos garantir que primeiro elemento existe
  let pendingRecord: typeof schema.generatedImages.$inferSelect | undefined;
  
  try {
    const inserted = await db.insert(schema.generatedImages).values({
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
    
    // BUG FIX 25/12/2025: .returning() sempre retorna array com pelo menos um elemento
    // Extrair primeiro elemento explicitamente para garantir type safety
    pendingRecord = inserted[0];

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
    
    // BUG FIX 25/12/2025: Atualizar status do registro para 'failed' quando geração falha
    // Previne registros órfãos com status permanente 'generating'
    if (pendingRecord?.id) {
      try {
        await db.update(schema.generatedImages)
          .set({
            status: 'failed',
            metadata: {
              error: error instanceof Error ? error.message : 'Erro desconhecido',
              failedAt: new Date().toISOString(),
            },
          })
          .where(eq(schema.generatedImages.id, pendingRecord.id));
        
        logger.info({ imageId: pendingRecord.id }, 'Status da imagem atualizado para failed após erro');
      } catch (updateError) {
        // Se falhar ao atualizar, logar mas não impedir o throw do erro original
        logger.error({ error: updateError, imageId: pendingRecord.id }, 'Erro ao atualizar status da imagem para failed');
      }
    }
    
    if (error instanceof Error && error.message.includes('Breaker is open')) {
      throw new Error('Serviço de geração de imagens temporariamente indisponível. Tente novamente em alguns segundos.');
    }
    
    throw error;
  }
}

// ============================================================================
// IMAGE EMBEDDINGS (Para RAG Multimodal)
// ARQUITETURA 100% GPU (25/12/2025): OpenCLIP ViT-H/14 via GPU Manager Service
// Embeddings de imagem com 1024 dimensões para máxima qualidade
// ============================================================================

// BUG FIX 25/12/2025: GPU_MANAGER_URL já declarado na linha 26 - removida declaração duplicada
// GPU Manager Service - Gerenciamento centralizado de requisições GPU (25/12/2025)

async function generateImageEmbeddingInternal(imageBase64: string): Promise<CLIPEmbeddingResponse> {
  // ARQUITETURA ENTERPRISE (25/12/2025): OpenCLIP ViT-H/14 via GPU Manager Service
  // Embeddings de imagem com 1024 dimensões para máxima qualidade
  // NOTA: imageBase64 pode vir com ou sem prefixo data:image/...;base64,
  // O servidor Python trata ambos os formatos, mas padronizamos para incluir prefixo
  // Se já tem prefixo, usar como está; caso contrário, adicionar prefixo genérico
  const imageData = imageBase64.startsWith('data:') 
    ? imageBase64 
    : `data:image/png;base64,${imageBase64}`;
  
  // Enfileirar requisição no GPU Manager com prioridade MEDIUM (embeddings)
  const gpuResponse = await requestGpu({
    serviceType: GpuServiceType.EMBEDDINGS,
    endpoint: '/embed/image',
    method: 'POST',
    priority: GpuRequestPriority.MEDIUM,
    timeout: 30000, // 30s para embeddings
    body: {
      image: imageData,
    },
  });

  if (!gpuResponse.success || !gpuResponse.data) {
    throw new Error(gpuResponse.error || 'Erro ao gerar embedding de imagem (GPU)');
  }

  const data = gpuResponse.data as { embedding: number[]; model: string };
  return { embedding: data.embedding };
}

const imageEmbeddingBreaker = createCircuitBreaker(generateImageEmbeddingInternal, {
  name: 'image-embeddings-gpu',
  ...CIRCUIT_BREAKER_PRESETS.clipEmbeddings,
  timeout: 30000, // GPU pode precisar de tempo para warm-up
});

/**
 * Gera embedding de imagem via OpenCLIP ViT-H/14 GPU (1024 dimensões)
 * ARQUITETURA 100% GPU (15/12/2025)
 */
export async function generateCLIPEmbedding(imageBase64: string): Promise<number[]> {
  try {
    const result = await imageEmbeddingBreaker.fire(imageBase64) as CLIPEmbeddingResponse;
    return result.embedding;
  } catch (error) {
    logger.error({ error }, 'Erro ao gerar embedding de imagem (GPU)');
    throw error;
  }
}

/**
 * Armazena CLIP embedding para uma imagem gerada
 */
export async function storeImageEmbedding(imageId: string, imageBase64: string): Promise<void> {
  try {
    const embedding = await generateCLIPEmbedding(imageBase64);
    
    // Validar dimensão CLIP antes de salvar (Enterprise-Grade - Regra 6)
    validateEmbeddingDimension(embedding, EMBEDDING_DIMENSIONS.CLIP, 'CLIP');
    
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
