/**
 * Learning Worker - Alice Enterprise Platform
 *
 * Worker enterprise para processamento de tarefas de aprendizado.
 * Processa tarefas de diferentes tipos via fila PostgreSQL:
 * - rag_update: Reindexação de documentos RAG
 * - auto_indexing: Auto-indexação periódica
 * - incremental_fine_tuning: Fine-tuning incremental via LoRA
 * - complete_fine_tuning: Fine-tuning completo
 * - embedding_generation: Geração de embeddings para novos documentos
 *
 * Regra 6 CLAUDE.md: PROIBIDO stubs/mocks - lógica real enterprise
 * Regra 8 CLAUDE.md: TypeScript strict, zero any
 * Regra 16 CLAUDE.md: Circuit breaker para chamadas externas
 *
 * Autor: Fillipe Guerra
 * Data: 19 de Dezembro de 2025
 */

import pLimit from 'p-limit';
import { dequeueNextLearningTask, updateLearningTaskStatus } from '../learning-orchestrator.js';
import { createLogger } from '@alice/logger';
import type { Database } from '@alice/database';
// CORREÇÃO 19/12/2025: Remover 'desc' não utilizado (no-unused-vars)
import { eq, and, schema, sql, isNull, inArray } from '@alice/database';
import { createCircuitBreaker, CIRCUIT_BREAKER_PRESETS } from '@alice/shared-utils';

const logger = createLogger('learning-worker');

// ============================================================================
// TIPOS
// ============================================================================

interface LearningWorkerConfig {
  tenantId: string;
  concurrency: number;
  pollIntervalMs: number;
  maxAttempts: number;
}

// Tipo LearningTask inferido do schema Drizzle (Regra 2 CLAUDE.md - NÃO DUPLICAR)
type LearningTask = typeof schema.learningTasks.$inferSelect;

// Tipos de tarefas suportados
type LearningTaskType =
  | 'rag_update'
  | 'auto_indexing'
  | 'incremental_fine_tuning'
  | 'complete_fine_tuning'
  | 'embedding_generation';

// Resultado de processamento
interface TaskResult {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}

// ============================================================================
// CONFIGURAÇÃO
// ============================================================================

// URL do training-service para fine-tuning
const TRAINING_SERVICE_URL = process.env.TRAINING_SERVICE_URL || 'http://alice-training:3004';

// URL do embeddings GPU para geração de embeddings
// GPU Manager Service gerencia embeddings localmente (Hetzner GEX44)
// URL interna: http://gpu-embeddings:8000 (não precisa de secret)
const EMBEDDINGS_GPU_URL = process.env.EMBEDDINGS_GPU_URL || 'http://gpu-embeddings:8000';

// Timeout para chamadas HTTP (em ms)
const HTTP_TIMEOUT = 60000; // 60 segundos

// ============================================================================
// CIRCUIT BREAKERS
// ============================================================================

/**
 * Função interna para chamar training-service
 */
async function callTrainingServiceInternal(
  endpoint: string,
  method: string,
  body?: Record<string, unknown>
): Promise<Response> {
  const url = `${TRAINING_SERVICE_URL}${endpoint}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HTTP_TIMEOUT);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Função interna para chamar embeddings GPU
 */
async function callEmbeddingsGpuInternal(
  texts: string[]
): Promise<{ embeddings: number[][] }> {
  // EMBEDDINGS_GPU_URL tem fallback para serviço local (não precisa validar)

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HTTP_TIMEOUT);

  try {
    const response = await fetch(`${EMBEDDINGS_GPU_URL}/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`GPU embeddings failed: ${response.status}`);
    }

    return response.json() as Promise<{ embeddings: number[][] }>;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Circuit breakers com presets enterprise
const trainingBreaker = createCircuitBreaker(callTrainingServiceInternal, {
  name: 'learning-worker-training',
  ...CIRCUIT_BREAKER_PRESETS.default,
});

const embeddingsBreaker = createCircuitBreaker(callEmbeddingsGpuInternal, {
  name: 'learning-worker-embeddings',
  ...CIRCUIT_BREAKER_PRESETS.embeddingsGPU,
});

// ============================================================================
// PROCESSADORES DE TAREFAS
// ============================================================================

/**
 * Processa tarefa de atualização RAG
 * Reindexação de documentos modificados recentemente
 */
async function processRagUpdate(
  db: Database,
  task: LearningTask
): Promise<TaskResult> {
  const params = task.parametros as Record<string, unknown> | null;
  const namespaceId = params?.namespaceId as string | undefined;
  const forceReindex = params?.forceReindex as boolean | undefined;

  logger.info({ taskId: task.id, namespaceId, forceReindex }, 'Iniciando RAG update');

  // CORREÇÃO 18/12/2025: Schema documents não tem tenantId nem status
  // Multi-tenancy é via namespaceId, status via campo 'processado' (boolean)
  // Buscar namespace do tenant para filtrar documentos corretamente
  const tenantNamespaces = await db.query.namespaces.findMany({
    where: eq(schema.namespaces.tenantId, task.tenantId),
  });
  const tenantNamespaceIds = tenantNamespaces.map(ns => ns.id);

  // Buscar documentos que precisam de reindexação
  // CORREÇÃO 19/12/2025: Bug Fix - usar inArray() ao invés de sql template literal
  // sql`...IN (${ids.join(',')})` parametriza a string inteira como único valor,
  // produzindo SQL como `namespace_id IN ($1)` onde $1 = 'uuid1,uuid2,uuid3' (string única)
  // inArray() do Drizzle gera corretamente `namespace_id IN ($1, $2, $3)` com valores separados
  const whereConditions = tenantNamespaceIds.length > 0
    ? namespaceId
      ? and(
          eq(schema.documents.namespaceId, namespaceId),
          // Verificar que namespace pertence ao tenant
          inArray(schema.documents.namespaceId, tenantNamespaceIds)
        )
      : inArray(schema.documents.namespaceId, tenantNamespaceIds)
    : undefined;

  // Documentos sem embedding ou modificados após embedding
  const documents = whereConditions 
    ? await db.query.documents.findMany({
        where: whereConditions,
        limit: 100, // Processar em batches
      })
    : [];

  let processedCount = 0;
  let errorCount = 0;

  for (const doc of documents) {
    try {
      // Verificar se documento precisa de reindexação
      const chunks = await db.query.documentChunks.findMany({
        where: eq(schema.documentChunks.documentId, doc.id),
      });

      if (chunks.length === 0 || forceReindex) {
        // Documento precisa de processamento
        // O processamento real de embeddings é feito pelo embedding-worker via Qdrant
        // Aqui marcamos como não processado para reprocessamento
        await db.update(schema.documents)
          .set({
            processado: false, // Usa processado ao invés de status
            atualizadoEm: sql`NOW()`,
          })
          .where(eq(schema.documents.id, doc.id));
        processedCount++;
      }
    } catch (error) {
      logger.error({ docId: doc.id, error: (error as Error).message }, 'Erro ao processar documento');
      errorCount++;
    }
  }

  return {
    success: errorCount === 0,
    message: `RAG update: ${processedCount} documentos marcados para reprocessamento, ${errorCount} erros`,
    data: {
      totalDocuments: documents.length,
      processedCount,
      errorCount,
    },
  };
}

/**
 * Processa tarefa de auto-indexação
 * Indexação automática de novos documentos
 * CORREÇÃO 18/12/2025: Schema documents usa processado (boolean) não status
 */
async function processAutoIndexing(
  db: Database,
  task: LearningTask
): Promise<TaskResult> {
  logger.info({ taskId: task.id }, 'Iniciando auto-indexação');

  // Buscar namespaces do tenant para filtrar documentos
  const tenantNamespaces = await db.query.namespaces.findMany({
    where: eq(schema.namespaces.tenantId, task.tenantId),
  });
  const tenantNamespaceIds = tenantNamespaces.map(ns => ns.id);

  // Buscar documentos pendentes de indexação (processado = false)
  // CORREÇÃO 19/12/2025: Bug Fix - usar inArray() ao invés de sql template literal
  // Mesmo problema do processRagUpdate - sql template parametriza string inteira
  const pendingDocs = tenantNamespaceIds.length > 0
    ? await db.query.documents.findMany({
        where: and(
          inArray(schema.documents.namespaceId, tenantNamespaceIds),
          eq(schema.documents.processado, false)
        ),
        limit: 50, // Processar em batches menores para auto-indexação
      })
    : [];

  let processedCount = 0;
  let errorCount = 0;

  for (const doc of pendingDocs) {
    try {
      // Verificar se já tem chunks (pode ter sido processado parcialmente)
      const existingChunks = await db.query.documentChunks.findMany({
        where: eq(schema.documentChunks.documentId, doc.id),
      });

      if (existingChunks.length > 0) {
        // Já tem chunks, marcar como processado
        await db.update(schema.documents)
          .set({
            processado: true,
            atualizadoEm: sql`NOW()`,
          })
          .where(eq(schema.documents.id, doc.id));
        processedCount++;
      } else {
        // Precisa de processamento - será feito pelo embedding-worker
        // Documento permanece com processado=false para o worker pegar
        processedCount++;
      }
    } catch (error) {
      logger.error({ docId: doc.id, error: (error as Error).message }, 'Erro na auto-indexação');
      errorCount++;
    }
  }

  return {
    success: errorCount === 0,
    message: `Auto-indexação: ${processedCount} documentos processados, ${errorCount} erros`,
    data: {
      totalPending: pendingDocs.length,
      processedCount,
      errorCount,
    },
  };
}

/**
 * Processa tarefa de fine-tuning incremental (LoRA)
 * Chama training-service para executar Progressive LoRA
 */
async function processIncrementalFineTuning(
  db: Database,
  task: LearningTask
): Promise<TaskResult> {
  const params = task.parametros as Record<string, unknown> | null;
  const includeImages = params?.includeImages as boolean | undefined;

  logger.info({ taskId: task.id, includeImages }, 'Iniciando fine-tuning incremental LoRA');

  // Verificar dados aprovados disponíveis
  const approvedData = await db.query.trainingData.findMany({
    where: and(
      eq(schema.trainingData.tenantId, task.tenantId),
      eq(schema.trainingData.status, 'approved'),
      isNull(schema.trainingData.usedInJobId)
    ),
  });

  if (approvedData.length < 50) {
    return {
      success: false,
      message: `Dados insuficientes para fine-tuning: ${approvedData.length}/50 mínimo`,
      data: { dataCount: approvedData.length, minRequired: 50 },
    };
  }

  try {
    // Chamar training-service para iniciar Progressive LoRA
    const response = await trainingBreaker.fire(
      '/api/training/lora/progressive',
      'POST',
      {
        tenantId: task.tenantId,
        includeImages: includeImages ?? false,
        learningTaskId: task.id,
      }
    ) as Response;

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Training service error: ${response.status} - ${errorText}`);
    }

    const result = await response.json() as { jobId?: string; status?: string };

    return {
      success: true,
      message: 'Fine-tuning incremental iniciado com sucesso',
      data: {
        jobId: result.jobId,
        dataCount: approvedData.length,
        status: result.status,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ taskId: task.id, error: errorMessage }, 'Erro no fine-tuning incremental');

    return {
      success: false,
      message: `Erro no fine-tuning: ${errorMessage}`,
      data: { error: errorMessage },
    };
  }
}

/**
 * Processa tarefa de fine-tuning completo
 * Similar ao incremental mas com todos os dados disponíveis
 */
async function processCompleteFineTuning(
  db: Database,
  task: LearningTask
): Promise<TaskResult> {
  logger.info({ taskId: task.id }, 'Iniciando fine-tuning completo');

  // Verificar dados aprovados disponíveis
  const approvedData = await db.query.trainingData.findMany({
    where: and(
      eq(schema.trainingData.tenantId, task.tenantId),
      eq(schema.trainingData.status, 'approved')
    ),
  });

  if (approvedData.length < 200) {
    return {
      success: false,
      message: `Dados insuficientes para fine-tuning completo: ${approvedData.length}/200 mínimo`,
      data: { dataCount: approvedData.length, minRequired: 200 },
    };
  }

  // Verificar qualidade dos dados
  const highQualityData = approvedData.filter(
    (d: typeof schema.trainingData.$inferSelect) => (d.rating || 0) >= 4
  );
  const qualityScore = highQualityData.length / approvedData.length;

  if (qualityScore < 0.5) {
    return {
      success: false,
      message: `Qualidade insuficiente: ${(qualityScore * 100).toFixed(1)}% com rating >= 4`,
      data: { qualityScore, minRequired: 0.5 },
    };
  }

  try {
    // Chamar training-service para iniciar fine-tuning completo
    const response = await trainingBreaker.fire(
      '/api/training/lora/complete',
      'POST',
      {
        tenantId: task.tenantId,
        includeImages: true,
        learningTaskId: task.id,
      }
    ) as Response;

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Training service error: ${response.status} - ${errorText}`);
    }

    const result = await response.json() as { jobId?: string; status?: string };

    return {
      success: true,
      message: 'Fine-tuning completo iniciado com sucesso',
      data: {
        jobId: result.jobId,
        dataCount: approvedData.length,
        qualityScore,
        status: result.status,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ taskId: task.id, error: errorMessage }, 'Erro no fine-tuning completo');

    return {
      success: false,
      message: `Erro no fine-tuning: ${errorMessage}`,
      data: { error: errorMessage },
    };
  }
}

/**
 * Processa tarefa de geração de embeddings
 * Gera embeddings para textos específicos
 */
async function processEmbeddingGeneration(
  db: Database,
  task: LearningTask
): Promise<TaskResult> {
  const params = task.parametros as Record<string, unknown> | null;
  const texts = params?.texts as string[] | undefined;
  const documentIds = params?.documentIds as string[] | undefined;

  logger.info({ taskId: task.id, textsCount: texts?.length, documentIds }, 'Iniciando geração de embeddings');

  // BUG FIX 25/12/2025: EMBEDDINGS_GPU_URL tem fallback (linha 69), então sempre será truthy
  // Removida validação inalcançável - o fallback garante que sempre haverá uma URL válida
  // Se o serviço não estiver acessível, o erro será capturado na chamada fetch (linha 117)

  let textsToProcess: string[] = [];

  // CORREÇÃO 18/12/2025: documentChunks não tem tenantId
  // Buscar chunks diretamente pelos documentIds (já filtrados por tenant)
  // CORREÇÃO 19/12/2025: Bug Fix - usar inArray() ao invés de sql template literal
  // sql`...= ANY(ARRAY[${ids.map(...).join(',')}])` parametriza como string única,
  // produzindo SQL como `= ANY(ARRAY[$1])` onde $1 = "'uuid1'::uuid,'uuid2'::uuid" (string literal)
  // inArray() do Drizzle gera corretamente `document_id IN ($1, $2, $3)` com UUIDs separados
  if (documentIds && documentIds.length > 0) {
    const chunks = await db.query.documentChunks.findMany({
      where: inArray(schema.documentChunks.documentId, documentIds),
    });
    textsToProcess = chunks.map(c => c.conteudo).filter(Boolean);
  } else if (texts && texts.length > 0) {
    textsToProcess = texts;
  }

  if (textsToProcess.length === 0) {
    return {
      success: false,
      message: 'Nenhum texto para processar',
      data: {},
    };
  }

  try {
    // Chamar GPU para gerar embeddings
    const result = await embeddingsBreaker.fire(textsToProcess) as { embeddings: number[][] };

    return {
      success: true,
      message: `Embeddings gerados: ${result.embeddings.length} vetores`,
      data: {
        count: result.embeddings.length,
        dimension: result.embeddings[0]?.length || 0,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ taskId: task.id, error: errorMessage }, 'Erro na geração de embeddings');

    return {
      success: false,
      message: `Erro na geração de embeddings: ${errorMessage}`,
      data: { error: errorMessage },
    };
  }
}

// ============================================================================
// DISPATCHER DE TAREFAS
// ============================================================================

/**
 * Processa uma tarefa baseado no seu tipo
 */
async function processTask(
  db: Database,
  task: LearningTask
): Promise<TaskResult> {
  const taskType = task.tipo as LearningTaskType;

  switch (taskType) {
    case 'rag_update':
      return processRagUpdate(db, task);

    case 'auto_indexing':
      return processAutoIndexing(db, task);

    case 'incremental_fine_tuning':
      return processIncrementalFineTuning(db, task);

    case 'complete_fine_tuning':
      return processCompleteFineTuning(db, task);

    case 'embedding_generation':
      return processEmbeddingGeneration(db, task);

    default:
      logger.warn({ taskId: task.id, taskType }, 'Tipo de tarefa não reconhecido');
      return {
        success: false,
        message: `Tipo de tarefa não suportado: ${taskType}`,
        data: { supportedTypes: ['rag_update', 'auto_indexing', 'incremental_fine_tuning', 'complete_fine_tuning', 'embedding_generation'] },
      };
  }
}

// ============================================================================
// WORKER PRINCIPAL
// ============================================================================

/**
 * Inicia o learning worker
 *
 * @param db - Conexão com banco de dados
 * @param config - Configuração do worker
 */
export function startLearningWorker(db: Database, config: LearningWorkerConfig) {
  const limit = pLimit(config.concurrency);

  async function processLoop() {
    try {
      const task = await dequeueNextLearningTask(db, logger, config.tenantId);
      if (!task) return;

      await limit(async () => {
        const startTime = Date.now();

        try {
          // Processar tarefa baseado no tipo
          const result = await processTask(db, task);
          const processingTimeMs = Date.now() - startTime;

          // Atualizar status da tarefa
          await updateLearningTaskStatus(db, logger, {
            taskId: task.id,
            tenantId: config.tenantId,
            status: result.success ? 'completed' : 'failed',
            progresso: result.success ? 100 : 0,
            resultado: {
              ...result.data,
              message: result.message,
              processingTimeMs,
            },
            erro: result.success ? null : result.message,
          });

          logger.info({
            taskId: task.id,
            tipo: task.tipo,
            success: result.success,
            processingTimeMs,
          }, 'Tarefa de learning processada');

        } catch (error) {
          const attempts = task.tentativas ?? 0;
          const maxAttempts = task.maxTentativas ?? config.maxAttempts;
          const status = attempts >= maxAttempts ? 'failed' : 'pending';

          await updateLearningTaskStatus(db, logger, {
            taskId: task.id,
            tenantId: config.tenantId,
            status,
            erro: (error as Error).message,
          });

          logger.error({
            taskId: task.id,
            tipo: task.tipo,
            error: (error as Error).message,
            attempts,
            maxAttempts,
          }, 'Erro ao processar tarefa de learning');
        }
      });
    } catch (error) {
      logger.error({ error }, 'Erro no loop do learning-worker');
    }
  }

  setInterval(processLoop, config.pollIntervalMs).unref();
  logger.info({
    tenantId: config.tenantId,
    pollIntervalMs: config.pollIntervalMs,
    concurrency: config.concurrency,
  }, 'Learning worker iniciado');
}
