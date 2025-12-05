/**
 * Instrumentação Prometheus - Alice Enterprise Platform
 * 
 * Módulo compartilhado para métricas Prometheus com prom-client.
 * Padrão de nomenclatura: alice_* para todas as métricas.
 * 
 * Métricas implementadas:
 * - HTTP: latência, throughput, erros, requests em andamento
 * - Circuit Breaker: estado (open/closed/half-open)
 * - LLM: latência de inferência, tokens gerados
 * - RAG: documentos indexados, busca vetorial
 * - Training: jobs ativos, loss, GPU utilization
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md).
 * 
 * @module @alice/shared-utils/prometheus
 */

import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createLogger } from './logger.js';

// Reexportar tipos do prom-client para uso nos serviços
export { Counter, Histogram, Gauge, Registry } from 'prom-client';

const logger = createLogger('prometheus');

/**
 * Buckets padrão para histogramas de latência HTTP (segundos)
 * Baseado em SRE Golden Signals - percentis P50, P90, P95, P99
 */
const HTTP_LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

/**
 * Buckets para latência LLM (mais longos devido a inference)
 */
const LLM_LATENCY_BUCKETS = [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300];

/**
 * Buckets para embeddings/vector search
 */
const EMBEDDING_LATENCY_BUCKETS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

/**
 * Estados possíveis do Circuit Breaker
 */
export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

/**
 * Interface para configuração do Prometheus
 */
export interface PrometheusConfig {
  /** Nome do serviço (usado como label) */
  serviceName: string;
  /** Prefixo das métricas (padrão: alice_) */
  prefix?: string;
  /** Coletar métricas padrão do Node.js (CPU, memória, event loop) */
  collectDefaultMetrics?: boolean;
  /** Intervalo de coleta de métricas padrão em ms (padrão: 10000) */
  defaultMetricsInterval?: number;
}

/**
 * Interface para métricas do sistema
 */
export interface AliceMetrics {
  /** Registry do Prometheus */
  registry: Registry;
  
  /** Métricas HTTP */
  http: {
    /** Duração das requisições HTTP */
    requestDuration: Histogram;
    /** Total de requisições HTTP */
    requestsTotal: Counter;
    /** Requisições em andamento */
    requestsInFlight: Gauge;
    /** Total de erros HTTP */
    errorsTotal: Counter;
  };
  
  /** Métricas de Circuit Breaker */
  circuitBreaker: {
    /** Estado do circuit breaker (0=closed, 1=open, 0.5=half-open) */
    state: Gauge;
    /** Total de falhas */
    failuresTotal: Counter;
    /** Total de sucessos */
    successesTotal: Counter;
    /** Total de timeouts */
    timeoutsTotal: Counter;
    /** Total de rejeições */
    rejectsTotal: Counter;
  };
  
  /** Métricas LLM */
  llm: {
    /** Duração da inferência LLM */
    inferenceDuration: Histogram;
    /** Total de tokens gerados */
    tokensGenerated: Counter;
    /** Total de tokens de prompt */
    tokensPrompt: Counter;
    /** Sessões simultâneas de chat */
    activeSessions: Gauge;
    /** Total de fallbacks */
    fallbacksTotal: Counter;
  };
  
  /** Métricas RAG */
  rag: {
    /** Documentos indexados */
    documentsIndexed: Gauge;
    /** Total de chunks */
    chunksTotal: Gauge;
    /** Duração da busca vetorial */
    searchDuration: Histogram;
    /** Duração da geração de embeddings */
    embeddingDuration: Histogram;
    /** Taxa de cache hit */
    cacheHitRate: Gauge;
    /** Queries por segundo */
    queriesTotal: Counter;
  };
  
  /** Métricas Training */
  training: {
    /** Jobs ativos por estágio */
    activeJobs: Gauge;
    /** Jobs completados */
    completedJobsTotal: Counter;
    /** Jobs falhos */
    failedJobsTotal: Counter;
    /** Loss de treinamento */
    trainingLoss: Gauge;
    /** Loss de validação */
    validationLoss: Gauge;
    /** Duração de epoch */
    epochDuration: Histogram;
    /** Utilização GPU */
    gpuUtilization: Gauge;
    /** Uso de VRAM */
    vramUsage: Gauge;
    /** Feedback positivo */
    positiveFeedback: Counter;
    /** Feedback negativo */
    negativeFeedback: Counter;
    /** Correções manuais */
    corrections: Counter;
  };
  
  /** Métricas de integrações externas */
  integrations: {
    /** Duração das chamadas externas */
    callDuration: Histogram;
    /** Total de chamadas */
    callsTotal: Counter;
    /** Total de erros */
    errorsTotal: Counter;
  };
  
  /** Métricas RBAC - Role-Based Access Control */
  rbac: {
    /** Cache hits de permissões (label: tenant_id) */
    cacheHitsTotal: Counter<'tenant_id'>;
    /** Cache misses de permissões (label: tenant_id) */
    cacheMissesTotal: Counter<'tenant_id'>;
    /** Invalidações de cache (label: reason) */
    cacheInvalidationsTotal: Counter<'reason'>;
    /** Duração da verificação de permissão (label: permission) */
    checkDuration: Histogram<'permission'>;
    /** Taxa de cache hit (0-1) - sem labels */
    cacheHitRate: Gauge<string>;
  };
}

/**
 * Cria instância do Prometheus com métricas Alice
 * 
 * @param config - Configuração do Prometheus
 * @returns Objeto com registry e métricas
 * 
 * @example
 * ```typescript
 * import { createAlicePrometheus } from '@alice/shared-utils/prometheus';
 * 
 * const { registry, metrics, metricsRouter } = createAlicePrometheus({
 *   serviceName: 'auth-service',
 * });
 * 
 * app.use(metricsRouter);
 * ```
 */
export function createAlicePrometheus(config: PrometheusConfig): {
  registry: Registry;
  metrics: AliceMetrics;
  metricsRouter: Router;
  httpMetricsMiddleware: (req: Request, res: Response, next: NextFunction) => void;
} {
  const prefix = config.prefix ?? 'alice_';
  const serviceName = config.serviceName;
  
  // Criar registry isolado
  const registry = new Registry();
  registry.setDefaultLabels({ service: serviceName });
  
  // Coletar métricas padrão do Node.js
  if (config.collectDefaultMetrics !== false) {
    collectDefaultMetrics({
      register: registry,
      prefix,
      gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5],
    });
  }
  
  // ============================================================================
  // MÉTRICAS HTTP
  // ============================================================================
  
  const httpRequestDuration = new Histogram({
    name: `${prefix}http_request_duration_seconds`,
    help: 'Duração das requisições HTTP em segundos',
    labelNames: ['method', 'route', 'status_code'] as const,
    buckets: HTTP_LATENCY_BUCKETS,
    registers: [registry],
  });
  
  const httpRequestsTotal = new Counter({
    name: `${prefix}http_requests_total`,
    help: 'Total de requisições HTTP',
    labelNames: ['method', 'route', 'status_code'] as const,
    registers: [registry],
  });
  
  const httpRequestsInFlight = new Gauge({
    name: `${prefix}http_requests_in_flight`,
    help: 'Número de requisições HTTP em andamento',
    registers: [registry],
  });
  
  const httpErrorsTotal = new Counter({
    name: `${prefix}http_errors_total`,
    help: 'Total de erros HTTP (status >= 400)',
    labelNames: ['method', 'route', 'status_code', 'error_type'] as const,
    registers: [registry],
  });
  
  // ============================================================================
  // MÉTRICAS CIRCUIT BREAKER
  // ============================================================================
  
  const circuitBreakerState = new Gauge({
    name: `${prefix}circuit_breaker_state`,
    help: 'Estado do circuit breaker (0=closed, 0.5=half-open, 1=open)',
    labelNames: ['name'] as const,
    registers: [registry],
  });
  
  const circuitBreakerFailures = new Counter({
    name: `${prefix}circuit_breaker_failures_total`,
    help: 'Total de falhas do circuit breaker',
    labelNames: ['name'] as const,
    registers: [registry],
  });
  
  const circuitBreakerSuccesses = new Counter({
    name: `${prefix}circuit_breaker_successes_total`,
    help: 'Total de sucessos do circuit breaker',
    labelNames: ['name'] as const,
    registers: [registry],
  });
  
  const circuitBreakerTimeouts = new Counter({
    name: `${prefix}circuit_breaker_timeouts_total`,
    help: 'Total de timeouts do circuit breaker',
    labelNames: ['name'] as const,
    registers: [registry],
  });
  
  const circuitBreakerRejects = new Counter({
    name: `${prefix}circuit_breaker_rejects_total`,
    help: 'Total de rejeições do circuit breaker (quando aberto)',
    labelNames: ['name'] as const,
    registers: [registry],
  });
  
  // ============================================================================
  // MÉTRICAS LLM
  // ============================================================================
  
  const llmInferenceDuration = new Histogram({
    name: `${prefix}llm_inference_duration_seconds`,
    help: 'Duração da inferência LLM em segundos',
    labelNames: ['model', 'type'] as const,
    buckets: LLM_LATENCY_BUCKETS,
    registers: [registry],
  });
  
  const llmTokensGenerated = new Counter({
    name: `${prefix}llm_tokens_generated_total`,
    help: 'Total de tokens gerados (completion)',
    labelNames: ['model'] as const,
    registers: [registry],
  });
  
  const llmTokensPrompt = new Counter({
    name: `${prefix}llm_tokens_prompt_total`,
    help: 'Total de tokens de prompt',
    labelNames: ['model'] as const,
    registers: [registry],
  });
  
  const llmActiveSessions = new Gauge({
    name: `${prefix}llm_active_sessions`,
    help: 'Número de sessões de chat simultâneas',
    registers: [registry],
  });
  
  const llmFallbacksTotal = new Counter({
    name: `${prefix}llm_fallbacks_total`,
    help: 'Total de fallbacks para modelo alternativo',
    labelNames: ['reason'] as const,
    registers: [registry],
  });
  
  // ============================================================================
  // MÉTRICAS RAG
  // ============================================================================
  
  const ragDocumentsIndexed = new Gauge({
    name: `${prefix}rag_documents_indexed`,
    help: 'Número de documentos indexados',
    labelNames: ['tenant_id'] as const,
    registers: [registry],
  });
  
  const ragChunksTotal = new Gauge({
    name: `${prefix}rag_chunks_total`,
    help: 'Número total de chunks no índice',
    labelNames: ['tenant_id'] as const,
    registers: [registry],
  });
  
  const ragSearchDuration = new Histogram({
    name: `${prefix}rag_search_duration_seconds`,
    help: 'Duração da busca vetorial em segundos',
    labelNames: ['tenant_id'] as const,
    buckets: EMBEDDING_LATENCY_BUCKETS,
    registers: [registry],
  });
  
  const ragEmbeddingDuration = new Histogram({
    name: `${prefix}rag_embedding_duration_seconds`,
    help: 'Duração da geração de embeddings em segundos',
    labelNames: ['model'] as const,
    buckets: EMBEDDING_LATENCY_BUCKETS,
    registers: [registry],
  });
  
  const ragCacheHitRate = new Gauge({
    name: `${prefix}rag_cache_hit_rate`,
    help: 'Taxa de cache hit (0-1)',
    registers: [registry],
  });
  
  const ragQueriesTotal = new Counter({
    name: `${prefix}rag_queries_total`,
    help: 'Total de queries RAG',
    labelNames: ['tenant_id', 'result'] as const,
    registers: [registry],
  });
  
  // ============================================================================
  // MÉTRICAS TRAINING
  // ============================================================================
  
  const trainingActiveJobs = new Gauge({
    name: `${prefix}training_active_jobs`,
    help: 'Número de jobs de treinamento ativos',
    labelNames: ['stage'] as const,
    registers: [registry],
  });
  
  const trainingCompletedJobsTotal = new Counter({
    name: `${prefix}training_completed_jobs_total`,
    help: 'Total de jobs de treinamento completados',
    registers: [registry],
  });
  
  const trainingFailedJobsTotal = new Counter({
    name: `${prefix}training_failed_jobs_total`,
    help: 'Total de jobs de treinamento falhos',
    labelNames: ['reason'] as const,
    registers: [registry],
  });
  
  const trainingLoss = new Gauge({
    name: `${prefix}training_loss`,
    help: 'Loss atual do treinamento',
    labelNames: ['job_id', 'type'] as const,
    registers: [registry],
  });
  
  const trainingValidationLoss = new Gauge({
    name: `${prefix}training_validation_loss`,
    help: 'Loss de validação',
    labelNames: ['job_id'] as const,
    registers: [registry],
  });
  
  const trainingEpochDuration = new Histogram({
    name: `${prefix}training_epoch_duration_seconds`,
    help: 'Duração de cada epoch em segundos',
    labelNames: ['job_id'] as const,
    buckets: [60, 120, 300, 600, 1800, 3600],
    registers: [registry],
  });
  
  const trainingGpuUtilization = new Gauge({
    name: `${prefix}training_gpu_utilization_percent`,
    help: 'Utilização da GPU em percentual',
    labelNames: ['gpu_id'] as const,
    registers: [registry],
  });
  
  const trainingVramUsage = new Gauge({
    name: `${prefix}training_vram_usage_bytes`,
    help: 'Uso de VRAM em bytes',
    labelNames: ['gpu_id'] as const,
    registers: [registry],
  });
  
  const trainingPositiveFeedback = new Counter({
    name: `${prefix}training_feedback_positive_total`,
    help: 'Total de feedbacks positivos para self-learning',
    labelNames: ['tenant_id'] as const,
    registers: [registry],
  });
  
  const trainingNegativeFeedback = new Counter({
    name: `${prefix}training_feedback_negative_total`,
    help: 'Total de feedbacks negativos para self-learning',
    labelNames: ['tenant_id'] as const,
    registers: [registry],
  });
  
  const trainingCorrections = new Counter({
    name: `${prefix}training_corrections_total`,
    help: 'Total de correções manuais para self-learning',
    labelNames: ['tenant_id'] as const,
    registers: [registry],
  });
  
  // ============================================================================
  // MÉTRICAS INTEGRAÇÕES EXTERNAS
  // ============================================================================
  
  const integrationCallDuration = new Histogram({
    name: `${prefix}integration_call_duration_seconds`,
    help: 'Duração das chamadas a integrações externas em segundos',
    labelNames: ['integration', 'operation'] as const,
    buckets: HTTP_LATENCY_BUCKETS,
    registers: [registry],
  });
  
  const integrationCallsTotal = new Counter({
    name: `${prefix}integration_calls_total`,
    help: 'Total de chamadas a integrações externas',
    labelNames: ['integration', 'operation', 'status'] as const,
    registers: [registry],
  });
  
  const integrationErrorsTotal = new Counter({
    name: `${prefix}integration_errors_total`,
    help: 'Total de erros em integrações externas',
    labelNames: ['integration', 'operation', 'error_type'] as const,
    registers: [registry],
  });
  
  // ============================================================================
  // MÉTRICAS RBAC
  // ============================================================================
  
  const rbacCacheHitsTotal = new Counter({
    name: `${prefix}rbac_cache_hits_total`,
    help: 'Total de cache hits no sistema RBAC',
    labelNames: ['tenant_id'] as const,
    registers: [registry],
  });
  
  const rbacCacheMissesTotal = new Counter({
    name: `${prefix}rbac_cache_misses_total`,
    help: 'Total de cache misses no sistema RBAC',
    labelNames: ['tenant_id'] as const,
    registers: [registry],
  });
  
  const rbacCacheInvalidationsTotal = new Counter({
    name: `${prefix}rbac_cache_invalidations_total`,
    help: 'Total de invalidações de cache RBAC',
    labelNames: ['reason'] as const,
    registers: [registry],
  });
  
  const rbacCheckDuration = new Histogram({
    name: `${prefix}rbac_check_duration_seconds`,
    help: 'Duração da verificação de permissão RBAC em segundos',
    labelNames: ['permission'] as const,
    buckets: [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.025, 0.05, 0.1],
    registers: [registry],
  });
  
  const rbacCacheHitRate = new Gauge({
    name: `${prefix}rbac_cache_hit_rate`,
    help: 'Taxa de cache hit RBAC (0-1)',
    registers: [registry],
  });
  
  // ============================================================================
  // OBJETO DE MÉTRICAS
  // ============================================================================
  
  // Usa 'satisfies AliceMetrics' para:
  // 1. Preservar tipos literais dos labels (Counter<'tenant_id'> vs Counter<string>)
  // 2. Manter contrato de tipo AliceMetrics para Regra 8 (TypeScript strict)
  // prom-client 15.x + TypeScript 5.x: satisfies é a melhor prática 2025
  const metrics = {
    registry,
    http: {
      requestDuration: httpRequestDuration,
      requestsTotal: httpRequestsTotal,
      requestsInFlight: httpRequestsInFlight,
      errorsTotal: httpErrorsTotal,
    },
    circuitBreaker: {
      state: circuitBreakerState,
      failuresTotal: circuitBreakerFailures,
      successesTotal: circuitBreakerSuccesses,
      timeoutsTotal: circuitBreakerTimeouts,
      rejectsTotal: circuitBreakerRejects,
    },
    llm: {
      inferenceDuration: llmInferenceDuration,
      tokensGenerated: llmTokensGenerated,
      tokensPrompt: llmTokensPrompt,
      activeSessions: llmActiveSessions,
      fallbacksTotal: llmFallbacksTotal,
    },
    rag: {
      documentsIndexed: ragDocumentsIndexed,
      chunksTotal: ragChunksTotal,
      searchDuration: ragSearchDuration,
      embeddingDuration: ragEmbeddingDuration,
      cacheHitRate: ragCacheHitRate,
      queriesTotal: ragQueriesTotal,
    },
    training: {
      activeJobs: trainingActiveJobs,
      completedJobsTotal: trainingCompletedJobsTotal,
      failedJobsTotal: trainingFailedJobsTotal,
      trainingLoss: trainingLoss,
      validationLoss: trainingValidationLoss,
      epochDuration: trainingEpochDuration,
      gpuUtilization: trainingGpuUtilization,
      vramUsage: trainingVramUsage,
      positiveFeedback: trainingPositiveFeedback,
      negativeFeedback: trainingNegativeFeedback,
      corrections: trainingCorrections,
    },
    integrations: {
      callDuration: integrationCallDuration,
      callsTotal: integrationCallsTotal,
      errorsTotal: integrationErrorsTotal,
    },
    rbac: {
      cacheHitsTotal: rbacCacheHitsTotal,
      cacheMissesTotal: rbacCacheMissesTotal,
      cacheInvalidationsTotal: rbacCacheInvalidationsTotal,
      checkDuration: rbacCheckDuration,
      cacheHitRate: rbacCacheHitRate,
    },
  } satisfies AliceMetrics;
  
  // ============================================================================
  // MIDDLEWARE HTTP
  // ============================================================================
  
  /**
   * Middleware para coletar métricas HTTP automaticamente
   */
  function httpMetricsMiddleware(req: Request, res: Response, next: NextFunction): void {
    // Ignorar endpoint /metrics
    if (req.path === '/metrics') {
      return next();
    }
    
    const startTime = process.hrtime.bigint();
    httpRequestsInFlight.inc();
    
    res.on('finish', () => {
      const endTime = process.hrtime.bigint();
      const durationSeconds = Number(endTime - startTime) / 1e9;
      
      // Normalizar rota para evitar cardinalidade alta
      const route = normalizeRoute(req.route?.path ?? req.path);
      const method = req.method;
      const statusCode = res.statusCode.toString();
      
      httpRequestDuration.observe({ method, route, status_code: statusCode }, durationSeconds);
      httpRequestsTotal.inc({ method, route, status_code: statusCode });
      httpRequestsInFlight.dec();
      
      // Registrar erros
      if (res.statusCode >= 400) {
        const errorType = res.statusCode >= 500 ? 'server_error' : 'client_error';
        httpErrorsTotal.inc({ method, route, status_code: statusCode, error_type: errorType });
      }
    });
    
    next();
  }
  
  // ============================================================================
  // ROUTER DE MÉTRICAS
  // ============================================================================
  
  /**
   * Cria router Express para endpoint /metrics
   */
  function createMetricsRouter(): Router {
    const router = Router();
    
    router.get('/metrics', async (_req: Request, res: Response) => {
      try {
        res.set('Content-Type', registry.contentType);
        res.end(await registry.metrics());
      } catch (error) {
        logger.error({ error }, 'Erro ao gerar métricas Prometheus');
        res.status(500).end('Erro ao gerar métricas');
      }
    });
    
    return router;
  }
  
  logger.info({ serviceName }, 'Prometheus inicializado com sucesso');
  
  return {
    registry,
    metrics,
    metricsRouter: createMetricsRouter(),
    httpMetricsMiddleware,
  };
}

/**
 * Normaliza rota para evitar cardinalidade alta em métricas
 * Substitui IDs dinâmicos por placeholders
 * 
 * @param path - Caminho da rota
 * @returns Caminho normalizado
 * 
 * @example
 * normalizeRoute('/api/users/123/posts/456') // '/api/users/:id/posts/:id'
 */
function normalizeRoute(path: string): string {
  return path
    // UUIDs
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':uuid')
    // IDs numéricos longos
    .replace(/\/\d{6,}/g, '/:id')
    // IDs numéricos curtos no final
    .replace(/\/\d+$/g, '/:id')
    // IDs numéricos no meio
    .replace(/\/\d+\//g, '/:id/')
    // Tokens JWT ou hashes longos
    .replace(/\/[a-zA-Z0-9_-]{20,}/g, '/:token')
    // Remove trailing slash
    .replace(/\/$/, '') || '/';
}

/**
 * Converte estado do circuit breaker para valor numérico
 * 
 * @param state - Estado do circuit breaker
 * @returns Valor numérico (0=closed, 0.5=half-open, 1=open)
 */
export function circuitBreakerStateToNumber(state: CircuitBreakerState): number {
  switch (state) {
    case 'closed':
      return 0;
    case 'half-open':
      return 0.5;
    case 'open':
      return 1;
    default:
      return 0;
  }
}

/**
 * Helper para instrumentar circuit breakers existentes (opossum)
 * 
 * @param metrics - Métricas Alice
 * @param circuitName - Nome do circuit breaker
 * @param opossum - Instância do CircuitBreaker opossum
 * 
 * @example
 * ```typescript
 * import { instrumentCircuitBreaker } from '@alice/shared-utils/prometheus';
 * 
 * const stripeCircuit = createCircuitBreaker('stripe', stripeCall);
 * instrumentCircuitBreaker(metrics, 'stripe', stripeCircuit);
 * ```
 */
export function instrumentCircuitBreaker(
  metrics: AliceMetrics,
  circuitName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  opossum: any
): void {
  const { circuitBreaker } = metrics;
  
  // Estado inicial: fechado
  circuitBreaker.state.set({ name: circuitName }, 0);
  
  // Eventos do circuit breaker
  opossum.on('success', () => {
    circuitBreaker.successesTotal.inc({ name: circuitName });
  });
  
  opossum.on('failure', () => {
    circuitBreaker.failuresTotal.inc({ name: circuitName });
  });
  
  opossum.on('timeout', () => {
    circuitBreaker.timeoutsTotal.inc({ name: circuitName });
  });
  
  opossum.on('reject', () => {
    circuitBreaker.rejectsTotal.inc({ name: circuitName });
  });
  
  opossum.on('open', () => {
    circuitBreaker.state.set({ name: circuitName }, 1);
    logger.warn({ circuitName }, 'Circuit breaker aberto');
  });
  
  opossum.on('halfOpen', () => {
    circuitBreaker.state.set({ name: circuitName }, 0.5);
    logger.info({ circuitName }, 'Circuit breaker half-open');
  });
  
  opossum.on('close', () => {
    circuitBreaker.state.set({ name: circuitName }, 0);
    logger.info({ circuitName }, 'Circuit breaker fechado');
  });
}

/**
 * Helper para medir tempo de execução e registrar em histogram
 * 
 * @param histogram - Histogram do Prometheus
 * @param labels - Labels para o histogram
 * @param fn - Função a ser executada
 * @returns Resultado da função
 * 
 * @example
 * ```typescript
 * const result = await measureDuration(
 *   metrics.llm.inferenceDuration,
 *   { model: 'llama4-maverick', type: 'chat' },
 *   async () => llmClient.chat(messages)
 * );
 * ```
 */
export async function measureDuration<T>(
  histogram: Histogram,
  labels: Record<string, string>,
  fn: () => Promise<T>
): Promise<T> {
  const end = histogram.startTimer(labels);
  try {
    return await fn();
  } finally {
    end();
  }
}

/**
 * Versão síncrona do measureDuration
 */
export function measureDurationSync<T>(
  histogram: Histogram,
  labels: Record<string, string>,
  fn: () => T
): T {
  const end = histogram.startTimer(labels);
  try {
    return fn();
  } finally {
    end();
  }
}
