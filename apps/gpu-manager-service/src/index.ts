/**
 * GPU Manager Service - Alice Enterprise Platform
 * 
 * Serviço centralizado de gerenciamento de requisições GPU com fila priorizada,
 * monitoramento de VRAM, circuit breakers e métricas enterprise.
 * 
 * ARQUITETURA GPU (Gate 2):
 * - LLM (texto), Embeddings e Training são serviços GPU locais
 * - Vision e ASR via OpenAI
 * - Tipos de serviço são **capability-based** (modelo-agnóstico) para que
 *   a troca de modelos não exija mudanças em observabilidade.
 * - GPU Manager mantém fila priorizada, VRAM gates, circuit breakers e métricas.
 * 
 * Funcionalidades mantidas:
 * - Fila Redis com priorização (chat > trading > embeddings > outros)
 * - Monitoramento de VRAM em tempo real (nvidia-smi)
 * - Circuit breakers por serviço GPU
 * - Retry logic com backoff exponencial
 * - Métricas Prometheus (latência, fila, VRAM, erros)
 * - Graceful shutdown
 * - Health checks enterprise
 * 
 * Autor: Fillipe Guerra
 * Data: 16 de Janeiro de 2026
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import cors from 'cors';
import compression from 'compression';
import { Gauge, Histogram } from 'prom-client';
import { 
  CIRCUIT_BREAKER_PRESETS,
  createProtectedFetch,
  getRedisClient,
  isRedisAvailable,
  // CORREÇÃO 28/12/2025: Adicionar initializeRedisCache e closeRedisCacheClient
  // BUG: Serviço usava isRedisAvailable() sem chamar initializeRedisCache() primeiro
  // Resultado: redisClient sempre null → erro "Redis não disponível" → container crashava
  initializeRedisCache,
  closeRedisCacheClient,
  createAlicePrometheus,
  registerShutdownCallback,
  ShutdownPriority,
} from '@alice/shared-utils';
import { createLogger } from '@alice/logger';
import { 
  createCorrelationMiddleware, 
  createSecurityMiddleware,
  // createRateLimiter removido - não usado (GPU Manager Service usa autenticação interna)
  createErrorHandler,
  createNotFoundHandler,
  asyncHandler,
} from '@alice/shared-utils';
import { exec } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import { randomUUID } from 'crypto';

const execAsync = promisify(exec);
const logger = createLogger('gpu-manager');

const PORT = process.env.PORT || 3010;
// BUG FIX 26/12/2025: REDIS_URL removido - Redis é configurado via getRedisClient() de @alice/shared-utils
// BUG FIX 25/12/2025: REGRA 6 - Sem fallback em produção - variável DEVE estar definida
// INTERNAL_API_SECRET é obrigatório para autenticação service-to-service
// Fallback para string vazia desabilita autenticação, permitindo requisições não autenticadas
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;
if (!INTERNAL_API_SECRET && process.env.NODE_ENV === 'production') {
  logger.error('INTERNAL_API_SECRET é obrigatório em produção (Regra 6 - fail-fast)');
  process.exit(1);
}
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * GPU_SERVICE_TIMEOUT: Timeout padrão para requisições GPU (ms)
 * Configurável via variável de ambiente para permitir ajustes sem rebuild
 * Default: 60000ms (60s) - suficiente para a maioria das requisições
 * 
 * ENTERPRISE (27/12/2025): Variável lida do docker-compose.prod.yml
 * para permitir configuração dinâmica de timeouts em produção.
 */
const GPU_SERVICE_TIMEOUT = parseInt(process.env.GPU_SERVICE_TIMEOUT || '60000', 10);
if (isNaN(GPU_SERVICE_TIMEOUT) || GPU_SERVICE_TIMEOUT < 1000) {
  logger.error('GPU_SERVICE_TIMEOUT deve ser um número válido >= 1000ms');
  process.exit(1);
}
logger.info({ gpuServiceTimeout: GPU_SERVICE_TIMEOUT }, 'Timeout GPU configurado');

// Middleware de autenticação interna (service-to-service)
// BUG FIX 25/12/2025: GPU Manager Service endpoints devem aceitar X-Internal-Api-Secret, não requireAuth (OAuth/JWT)
// gpu-client.ts envia X-Internal-Api-Secret header para autenticação service-to-service
function requireInternalAuth(req: Request, res: Response, next: NextFunction): void {
  // Health check básico não requer auth (para docker healthcheck)
  if (req.path === '/health' || req.path === '/live' || req.path === '/ready') {
    return next();
  }

  // Em desenvolvimento sem secret configurado, permitir acesso
  if (!INTERNAL_API_SECRET && !IS_PRODUCTION) {
    logger.warn('INTERNAL_API_SECRET não configurado - permitindo acesso (apenas desenvolvimento)');
    return next();
  }

  // Verificar header X-Internal-Api-Secret (usado por gpu-client.ts)
  const secretHeader = req.headers['x-internal-api-secret'] as string;
  
  if (!secretHeader || secretHeader !== INTERNAL_API_SECRET) {
    logger.warn({ path: req.path, ip: req.ip }, 'Tentativa de acesso não autorizado ao GPU Manager Service');
    res.status(401).json({ error: 'Token de autenticação inválido ou ausente' });
    return;
  }

  next();
}

// ============================================================================
// CONFIGURAÇÃO
// ============================================================================

/** Prioridades de requisições GPU (maior = mais prioritário) */
export enum GpuRequestPriority {
  CRITICAL = 10,  // Chat em tempo real
  HIGH = 8,       // Trading (time-sensitive)
  MEDIUM = 5,     // Embeddings (RAG)
  LOW = 2,        // Treinamento e tarefas auxiliares
}

/** Tipos de serviços GPU */
export enum GpuServiceType {
  LLM = 'llm',                   // LLM (texto)
  EMBEDDINGS = 'embeddings',     // Embeddings (texto + imagem)
  TRAINING = 'training',         // Fine-tuning (sob demanda)
}

/**
 * Labels model-agnósticos (WS3-ready) para métricas/observabilidade.
 * IMPORTANTE: Estes labels representam o "tipo/capacidade" do serviço GPU,
 * não o nome do modelo atual. A migração de modelos no WS3 não deve exigir
 * mudanças em dashboards/alertas.
 */
type GpuCapability = 'llm' | 'embeddings' | 'training';

function capabilityForServiceType(serviceType: GpuServiceType): GpuCapability {
  switch (serviceType) {
    case GpuServiceType.LLM:
      return 'llm';
    case GpuServiceType.EMBEDDINGS:
      return 'embeddings';
    case GpuServiceType.TRAINING:
      return 'training';
  }
}

/** URLs dos serviços GPU (container names na rede Docker) */
// Gate 2: LLM separado (capabilities)
const GPU_SERVICE_URLS = {
  [GpuServiceType.LLM]: process.env.LLM_GPU_URL || 'http://gpu-llm:8000',
  [GpuServiceType.EMBEDDINGS]: process.env.EMBEDDINGS_GPU_URL || 'http://gpu-embeddings:8000',
  [GpuServiceType.TRAINING]: process.env.TRAINING_GPU_URL || 'http://gpu-trainer:8000',
};

/** VRAM necessária por serviço (GB)
 *
 * IMPORTANTE (Regra 6 - sem valores “falsos”): este valor é usado para:
 * - gate de admissão quando nvidia-smi não está disponível (fallback)
 * - estimativa de VRAM reservada por capacidade em dashboards
 *
 * Fonte de verdade:
 * - Em runtime real: nvidia-smi (quando disponível)
 * - Para fallback/estimativa: valores conservadores alinhados ao SSOT do stack modular
 *   (`infra/docker/stacks/docker-compose.alice.yml`) e ao budget de VRAM do vLLM.
 *
 * Observação:
 * - LLM (AWQ 4-bit): ~4-6GB (pesos) + KV cache conforme max-model-len / gpu-memory-utilization
 * Para coexistência em 20GB, usamos requisitos conservadores.
 */
const VRAM_REQUIREMENTS: Record<GpuServiceType, number> = {
  [GpuServiceType.LLM]: 6,           // LLM AWQ + KV cache (budget conservador)
  [GpuServiceType.EMBEDDINGS]: 3,    // Qwen3-Embedding-0.6B INT8 (budget conservador)
  [GpuServiceType.TRAINING]: 12,     // QLoRA (sob demanda, pausa outros)
};

/** VRAM total disponível (20GB para RTX 4000 Ada - Hetzner GEX44) */
// BUG FIX 25/12/2025: Corrigido de 24GB (RTX 4090) para 20GB (RTX 4000 Ada)
const TOTAL_VRAM_GB = 20;

/** Margem de segurança (GB) */
const VRAM_SAFETY_MARGIN_GB = 2;

/** Prefixo Redis para fila GPU */
const REDIS_QUEUE_PREFIX = 'alice:gpu:queue';
const REDIS_ACTIVE_PREFIX = 'alice:gpu:active';
// BUG FIX 26/12/2025: REDIS_METRICS_PREFIX removido - métricas via Prometheus, não Redis

/** Lock global para garantir execução serial em GPU única (VRAM compartilhada) */
const REDIS_GPU_LOCK_KEY = 'alice:gpu:lock';

/** Score composto: prioridade (dominante) + FIFO dentro da prioridade (mais antigo primeiro via -createdAt) */
const PRIORITY_SCORE_MULTIPLIER = 10_000_000_000_000; // 1e13 (seguro dentro de Number.MAX_SAFE_INTEGER)

type GpuLockValue = {
  requestId: string;
  serviceType: GpuServiceType;
  acquiredAt: number;
};

// ============================================================================
// TIPOS E INTERFACES
// ============================================================================

interface GpuRequest {
  id: string;
  serviceType: GpuServiceType;
  priority: GpuRequestPriority;
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
  tenantId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  retries: number;
  maxRetries: number;
}

interface GpuResponse {
  success: boolean;
  data?: unknown;
  error?: string;
  latencyMs: number;
  vramUsedGB?: number;
}

interface VramStatus {
  totalGB: number;
  usedGB: number;
  freeGB: number;
  utilizationPercent: number;
  activeServices: GpuServiceType[];
}

// ============================================================================
// CIRCUIT BREAKERS
// ============================================================================

/**
 * Circuit breakers DEVEM proteger as CHAMADAS REAIS aos serviços GPU (não apenas /health).
 * Gate 2: LLM (texto), Embeddings e Training locais
 */
const gpuServiceClients = {
  [GpuServiceType.LLM]: createProtectedFetch({
    name: 'gpu-llm',
    ...CIRCUIT_BREAKER_PRESETS.gpuLLM,
  }),
  [GpuServiceType.EMBEDDINGS]: createProtectedFetch({
    name: 'gpu-embeddings',
    ...CIRCUIT_BREAKER_PRESETS.embeddingsGPU,
  }),
  [GpuServiceType.TRAINING]: createProtectedFetch({
    name: 'gpu-trainer',
    ...CIRCUIT_BREAKER_PRESETS.gpuManager, // timeout alto para treinamento
  }),
} as const;

const protectedFetchByServiceType = {
  [GpuServiceType.LLM]: gpuServiceClients[GpuServiceType.LLM].fetch,
  [GpuServiceType.EMBEDDINGS]: gpuServiceClients[GpuServiceType.EMBEDDINGS].fetch,
  [GpuServiceType.TRAINING]: gpuServiceClients[GpuServiceType.TRAINING].fetch,
} as const;

// Converte response_format.json_schema para structured_outputs.json (API nativa vLLM 0.12.0).
// CRÍTICO: NÃO usar extra_body (conceito do SDK Python, não da API HTTP REST).
// NÃO usar guided_json (removido no vLLM 0.12.0).
// Ref: https://docs.vllm.ai/en/v0.12.0/features/structured_outputs/
function applyStructuredOutputs(params: {
  serviceType: GpuServiceType;
  endpoint: string;
  body?: unknown;
}): unknown {
  if (params.serviceType !== GpuServiceType.LLM) return params.body;
  if (!params.endpoint.includes('/v1/chat/completions')) return params.body;
  if (!params.body || typeof params.body !== 'object' || Array.isArray(params.body)) return params.body;

  const payload = { ...(params.body as Record<string, unknown>) };
  const responseFormat = payload.response_format as Record<string, unknown> | undefined;

  // Se não há response_format com json_schema, passa body sem modificação
  if (!responseFormat || responseFormat.type !== 'json_schema' || !responseFormat.json_schema) {
    // Remover extra_body se existir (campo inválido para API HTTP REST do vLLM)
    if (payload.extra_body) {
      delete payload.extra_body;
    }
    return payload;
  }

  // Extrair o schema JSON puro do wrapper OpenAI (response_format.json_schema.schema)
  const jsonSchemaWrapper = responseFormat.json_schema as Record<string, unknown>;
  const jsonSchema = (jsonSchemaWrapper.schema as Record<string, unknown>) ?? jsonSchemaWrapper;

  // Setar structured_outputs.json como campo TOP-LEVEL (API nativa vLLM 0.12.0)
  payload.structured_outputs = { json: jsonSchema };

  // Remover response_format para evitar conflito com structured_outputs
  delete payload.response_format;

  // Remover extra_body se existir (campo inválido para API HTTP REST do vLLM)
  if (payload.extra_body) {
    delete payload.extra_body;
  }

  return payload;
}

async function tryAcquireGpuLock(serviceType: GpuServiceType, requestId: string, ttlMs: number): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) {
    throw new Error('Redis não disponível - lock GPU é obrigatório');
  }
  const value: GpuLockValue = { requestId, serviceType, acquiredAt: Date.now() };
  const result = await redis.set(REDIS_GPU_LOCK_KEY, JSON.stringify(value), { NX: true, PX: ttlMs });
  return result === 'OK';
}

async function releaseGpuLockIfOwned(requestId: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  // Segurança enterprise: remover lock apenas se o owner (requestId) bater.
  const lua = `
    local key = KEYS[1]
    local reqId = ARGV[1]
    local v = redis.call("GET", key)
    if not v then
      return 0
    end
    local ok, decoded = pcall(cjson.decode, v)
    if not ok then
      return 0
    end
    if decoded["requestId"] == reqId then
      return redis.call("DEL", key)
    end
    return 0
  `;

  try {
    await redis.eval(lua, { keys: [REDIS_GPU_LOCK_KEY], arguments: [requestId] });
  } catch (error) {
    logger.error({ error, requestId }, 'Erro ao liberar lock GPU');
  }
}

// ============================================================================
// MONITORAMENTO DE VRAM
// ============================================================================

/**
 * Flag para evitar spam de logs quando nvidia-smi não está disponível
 * CORREÇÃO 28/12/2025: Em containers Distroless não há shell nem nvidia-smi
 * Logar apenas uma vez e usar fallback silenciosamente após isso
 */
let nvidiaSmiAvailable: boolean | null = null;

/**
 * Obtém status de VRAM via nvidia-smi
 * CORREÇÃO 28/12/2025: Graceful degradation em ambientes sem nvidia-smi
 * - Containers Distroless não têm shell (/bin/sh) para exec()
 * - GPU Manager pode rodar sem monitoramento de VRAM real
 * - Lock global Redis garante execução serial (evita OOM)
 */
async function getVramStatus(): Promise<VramStatus> {
  // Se já sabemos que nvidia-smi não está disponível, usar fallback silenciosamente
  if (nvidiaSmiAvailable === false) {
    return getVramFallback();
  }

  try {
    const { stdout } = await execAsync('nvidia-smi --query-gpu=memory.total,memory.used,memory.free --format=csv,noheader,nounits');
    const [total, used, free] = stdout.trim().split(',').map(s => parseInt(s.trim(), 10));
    
    // Marcar como disponível após primeira execução bem-sucedida
    if (nvidiaSmiAvailable === null) {
      nvidiaSmiAvailable = true;
      logger.info('nvidia-smi disponível - monitoramento de VRAM ativo');
    }

    // OBSERVABILIDADE: nvidia-smi retorna valores em MiB (nounits). Converter para GiB com precisão.
    const totalGB = total / 1024;
    const usedGB = used / 1024;
    const freeGB = free / 1024;
    const utilizationPercent = Math.round((used / total) * 100);

    // Métricas reais agregadas (bytes)
    gpuVramTotalBytes.set({ gpu_id: GPU_ID }, total * 1024 * 1024);
    gpuVramUsedBytes.set({ gpu_id: GPU_ID }, used * 1024 * 1024);

    // Obter serviços ativos do Redis
    const redis = getRedisClient();
    const activeServices: GpuServiceType[] = [];
    if (redis) {
      for (const serviceType of Object.values(GpuServiceType)) {
        const key = `${REDIS_ACTIVE_PREFIX}:${serviceType}`;
        const exists = await redis.exists(key);
        if (exists) {
          activeServices.push(serviceType);
        }
      }
    }

    // Métricas: VRAM reservada estimada por capacidade (bytes)
    // (não tenta inferir uso real por processo/container, mas mantém dashboards estáveis no WS3)
    gpuVramReservedBytes.set({ gpu_id: GPU_ID, service: 'llm' }, 0);
    gpuVramReservedBytes.set({ gpu_id: GPU_ID, service: 'embeddings' }, 0);
    gpuVramReservedBytes.set({ gpu_id: GPU_ID, service: 'training' }, 0);
    for (const serviceType of activeServices) {
      const cap = capabilityForServiceType(serviceType);
      const reservedBytes = VRAM_REQUIREMENTS[serviceType] * 1024 * 1024 * 1024;
      gpuVramReservedBytes.set({ gpu_id: GPU_ID, service: cap }, reservedBytes);
    }

    return {
      totalGB,
      usedGB,
      freeGB,
      utilizationPercent,
      activeServices,
    };
  } catch (error) {
    // Logar erro apenas na primeira tentativa
    if (nvidiaSmiAvailable === null) {
      nvidiaSmiAvailable = false;
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'nvidia-smi não disponível (esperado em Distroless) - usando valores de VRAM estimados'
      );
    }
    return getVramFallback();
  }
}

/**
 * Retorna valores de VRAM estimados quando nvidia-smi não está disponível
 */
async function getVramFallback(): Promise<VramStatus> {
  // Obter serviços ativos do Redis (ainda funciona sem nvidia-smi)
  const redis = getRedisClient();
  const activeServices: GpuServiceType[] = [];
  if (redis) {
    for (const serviceType of Object.values(GpuServiceType)) {
      const key = `${REDIS_ACTIVE_PREFIX}:${serviceType}`;
      const exists = await redis.exists(key);
      if (exists) {
        activeServices.push(serviceType);
      }
    }
  }

  // Estimar VRAM usada baseado em serviços ativos
  let estimatedUsedGB = 0;
  for (const service of activeServices) {
    estimatedUsedGB += VRAM_REQUIREMENTS[service];
  }

  // Proteção: fallback não pode gerar VRAM negativa e travar a fila.
  // Em ambientes sem nvidia-smi, o lock global Redis já garante execução serial.
  const boundedUsedGB = Math.min(TOTAL_VRAM_GB, estimatedUsedGB);
  const freeGB = Math.max(0, TOTAL_VRAM_GB - boundedUsedGB);
  const utilizationPercent = Math.max(
    0,
    Math.min(100, Math.round((boundedUsedGB / TOTAL_VRAM_GB) * 100))
  );

  // Métricas agregadas (bytes) - fallback baseado em budget declarado
  gpuVramTotalBytes.set({ gpu_id: GPU_ID }, TOTAL_VRAM_GB * 1024 * 1024 * 1024);
  gpuVramUsedBytes.set({ gpu_id: GPU_ID }, boundedUsedGB * 1024 * 1024 * 1024);

  // Métricas: VRAM reservada estimada por capacidade (bytes)
  // Zerar primeiro para evitar séries "stale" quando um serviço fica inativo.
  gpuVramReservedBytes.set({ gpu_id: GPU_ID, service: 'llm' }, 0);
  gpuVramReservedBytes.set({ gpu_id: GPU_ID, service: 'embeddings' }, 0);
  gpuVramReservedBytes.set({ gpu_id: GPU_ID, service: 'training' }, 0);
  for (const serviceType of activeServices) {
    const cap = capabilityForServiceType(serviceType);
    const reservedBytes = VRAM_REQUIREMENTS[serviceType] * 1024 * 1024 * 1024;
    gpuVramReservedBytes.set({ gpu_id: GPU_ID, service: cap }, reservedBytes);
  }

  return {
    totalGB: TOTAL_VRAM_GB,
    usedGB: boundedUsedGB,
    freeGB,
    utilizationPercent,
    activeServices,
  };
}

/**
 * Verifica se há VRAM suficiente para um serviço
 */
function hasEnoughVram(serviceType: GpuServiceType, currentVram: VramStatus): boolean {
  // Importante: o gate é para coexistência/concor­rência.
  // Se o serviço já está marcado como ativo, não exigimos "VRAM extra" para aceitar requisições.
  if (currentVram.activeServices.includes(serviceType)) {
    return true;
  }

  const required = VRAM_REQUIREMENTS[serviceType];
  const available = currentVram.freeGB;
  return available >= (required + VRAM_SAFETY_MARGIN_GB);
}

// ============================================================================
// FILA REDIS
// ============================================================================

/**
 * Adiciona requisição à fila priorizada
 * BUG FIX 25/12/2025: Adicionar verificação de null para evitar crash se Redis ficar indisponível
 */
async function enqueueRequest(request: GpuRequest): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    throw new Error('Redis não disponível - não é possível enfileirar requisição GPU');
  }
  
  const queueKey = `${REDIS_QUEUE_PREFIX}:${request.serviceType}`;
  const requestKey = `${REDIS_QUEUE_PREFIX}:request:${request.id}`;
  
  // Armazenar requisição completa
  await redis.setEx(
    requestKey,
    3600, // 1 hora TTL
    JSON.stringify(request)
  );
  
  // Adicionar à fila priorizada (sorted set)
  // - Prioridade domina (CRITICAL > HIGH > MEDIUM > LOW)
  // - Dentro da mesma prioridade: FIFO (mais antigo primeiro)
  // Nota: zPopMax retorna maior score, então usamos -createdAt para FIFO.
  await redis.zAdd(queueKey, {
    score: (request.priority * PRIORITY_SCORE_MULTIPLIER) - request.createdAt,
    value: request.id,
  });

  // Observabilidade: depth real por fila/capacidade (modelo-agnóstico)
  try {
    const depth = await redis.zCard(queueKey);
    gpuManagerQueueDepth.set({ queue: capabilityForServiceType(request.serviceType) }, depth);
  } catch (metricError) {
    logger.debug({ error: metricError }, 'Falha ao atualizar métrica de queue depth (enqueue)');
  }
  
  logger.info({
    requestId: request.id,
    serviceType: request.serviceType,
    priority: request.priority,
  }, 'Requisição GPU enfileirada');
}

/**
 * Remove e retorna próxima requisição da fila
 * BUG FIX 25/12/2025: Corrigido para pegar maior prioridade (zPopMax ao invés de zRange(-1, -1))
 * BUG FIX 25/12/2025: Adicionar verificação de null para evitar crash se Redis ficar indisponível
 */
async function dequeueRequest(serviceType: GpuServiceType): Promise<GpuRequest | null> {
  const redis = getRedisClient();
  if (!redis) {
    logger.warn('Redis não disponível - não é possível desenfileirar requisição GPU');
    return null;
  }
  
  const queueKey = `${REDIS_QUEUE_PREFIX}:${serviceType}`;
  
  // BUG FIX 25/12/2025: zRange(-1, -1) pega o último elemento (menor score se ordem crescente)
  // Precisamos do maior score (maior prioridade), então usamos zPopMax (atômico)
  // Prioridades: CRITICAL=10 > HIGH=8 > MEDIUM=5 > LOW=2
  // BUG FIX 26/12/2025: zPopMax sem count retorna objeto único { value, score } ou null
  const result = await redis.zPopMax(queueKey);
  if (!result) {
    return null;
  }
  
  const requestId = result.value;
  const requestKey = `${REDIS_QUEUE_PREFIX}:request:${requestId}`;
  
  // Obter requisição completa
  const requestData = await redis.get(requestKey);
  if (!requestData || typeof requestData !== 'string') {
    // BUG FIX 25/12/2025: zPopMax já removeu da fila atomicamente
    // Dados expiraram, mas elemento já foi removido da fila
    logger.warn({ requestId }, 'Dados da requisição expiraram após remoção da fila');
    return null;
  }
  
  // BUG FIX 26/12/2025: Type guard para garantir que é string (Redis v5 pode retornar tipos variados)
  const request: GpuRequest = JSON.parse(requestData);
  
  // BUG FIX 25/12/2025: zPopMax já remove o elemento da fila atomicamente
  // Não precisamos chamar zRem novamente
  
  return request;
}

/**
 * Marca serviço como ativo
 * BUG FIX 25/12/2025: Adicionar verificação de null para evitar crash se Redis ficar indisponível
 */
async function markServiceActive(serviceType: GpuServiceType, requestId: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    logger.warn({ serviceType, requestId }, 'Redis não disponível - não é possível marcar serviço como ativo');
    return;
  }
  const key = `${REDIS_ACTIVE_PREFIX}:${serviceType}`;
  await redis.setEx(key, 300, JSON.stringify({ requestId, startedAt: Date.now() })); // 5 min TTL
}

/**
 * Marca serviço como inativo
 * BUG FIX 25/12/2025: Adicionar verificação de null para evitar crash se Redis ficar indisponível
 */
async function markServiceInactive(serviceType: GpuServiceType): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    logger.warn({ serviceType }, 'Redis não disponível - não é possível marcar serviço como inativo');
    return;
  }
  const key = `${REDIS_ACTIVE_PREFIX}:${serviceType}`;
  await redis.del(key);
}

// ============================================================================
// PROCESSAMENTO DE REQUISIÇÕES
// ============================================================================

/**
 * Processa requisição GPU com retry e circuit breaker
 * 
 * Gate 2 (16/01/2026): LLM separado + Embeddings + Training locais
 * - Serviços GPU rodam simultaneamente com budget em 20GB (métricas = fonte de verdade)
 * - Zero latência de troca (não há orquestração dinâmica de start/stop)
 * - Treinamento é sob demanda via profile, com política operacional fora do caminho crítico
 */
async function processGpuRequest(request: GpuRequest): Promise<GpuResponse> {
  const startTime = Date.now();
  const serviceType = request.serviceType;
  const url = GPU_SERVICE_URLS[serviceType];
  const protectedFetch = protectedFetchByServiceType[serviceType];
  
  try {
    // Gate 2: Serviços sempre ativos, sem orquestração dinâmica
    const timeoutMs = request.timeout || GPU_SERVICE_TIMEOUT;
    const requestBody = applyStructuredOutputs({
      serviceType,
      endpoint: request.endpoint,
      body: request.body,
    });
    const response = await protectedFetch(`${url}${request.endpoint}`, {
      method: request.method,
      headers: {
        // Só setar JSON quando tiver body - evita bloquear endpoints que aceitam outros content-types
        ...(request.method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
        ...request.headers,
      },
      body: request.method !== 'GET' && requestBody ? JSON.stringify(requestBody) : undefined,
      timeoutMs,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GPU service error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const latencyMs = Date.now() - startTime;

    // Obter VRAM atual
    const vramStatus = await getVramStatus();

    return {
      success: true,
      data,
      latencyMs,
      vramUsedGB: vramStatus.usedGB,
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    logger.error({
      requestId: request.id,
      serviceType,
      error: error instanceof Error ? error.message : String(error),
      retries: request.retries,
    }, 'Erro ao processar requisição GPU');
    
    // Retry logic
    if (request.retries < request.maxRetries) {
      const backoffMs = Math.min(1000 * Math.pow(2, request.retries), 30000); // Max 30s
      logger.info({
        requestId: request.id,
        retries: request.retries + 1,
        backoffMs,
      }, 'Retentando requisição GPU');
      
      await new Promise(resolve => setTimeout(resolve, backoffMs));
      request.retries++;
      return processGpuRequest(request);
    }
    
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      latencyMs,
    };
  }
}

// ============================================================================
// WORKER DE FILA
// ============================================================================

let isWorkerRunning = false;

/**
 * Worker que processa fila de requisições GPU
 */
async function startQueueWorker(): Promise<void> {
  if (isWorkerRunning) {
    logger.warn('Worker de fila já está rodando');
    return;
  }
  
  isWorkerRunning = true;
  logger.info('Iniciando worker de fila GPU');
  
  // Gate 2:
  // Todos os serviços rodam simultaneamente, mas mantemos priorização na fila
  // para garantir que requisições críticas (chat/trading) sejam processadas primeiro.
  // 1) LLM (chat/trading - maior prioridade)
  // 2) EMBEDDINGS (RAG)
  // 3) TRAINING (sob demanda - menor prioridade)
  const servicePriorityOrder: GpuServiceType[] = [
    GpuServiceType.LLM,
    GpuServiceType.EMBEDDINGS,
    GpuServiceType.TRAINING,
  ];

  const processNextRequest = async (): Promise<void> => {
    try {
      // Se já existe lock GPU, não iniciar nova execução
      const redis = getRedisClient();
      if (!redis) {
        throw new Error('Redis não disponível - worker GPU exige Redis');
      }
      const lockExists = await redis.exists(REDIS_GPU_LOCK_KEY);
      if (lockExists) return;

      // Buscar a próxima requisição respeitando ordem global de prioridade
      for (const serviceType of servicePriorityOrder) {
        const request = await dequeueRequest(serviceType);
        if (!request) continue;

        // Observabilidade: tempo de espera na fila (do enqueue até o dequeue)
        const queue = capabilityForServiceType(serviceType);
        const waitSeconds = (Date.now() - request.createdAt) / 1000;
        gpuManagerQueueWaitDuration.observe({ queue }, waitSeconds);
        try {
          const depth = await redis.zCard(`${REDIS_QUEUE_PREFIX}:${serviceType}`);
          gpuManagerQueueDepth.set({ queue }, depth);
        } catch (metricError) {
          logger.debug({ error: metricError }, 'Falha ao atualizar métrica de queue depth (dequeue)');
        }

        // Tentar adquirir lock (TTL = timeout + margem)
        const timeoutMs = request.timeout || GPU_SERVICE_TIMEOUT;
        const lockTtlMs = Math.min(timeoutMs + 30000, 5 * 60 * 1000); // max 5 min
        const acquired = await tryAcquireGpuLock(serviceType, request.id, lockTtlMs);
        if (!acquired) {
          // Outra execução ganhou o lock; reenfileirar e sair
          await enqueueRequest(request);
          return;
        }

        try {
          // Verificar VRAM disponível (evita iniciar serviço que não cabe no momento)
          const vramStatus = await getVramStatus();
          if (!hasEnoughVram(serviceType, vramStatus)) {
            logger.warn({
              requestId: request.id,
              serviceType,
              requiredGB: VRAM_REQUIREMENTS[serviceType],
              availableGB: vramStatus.freeGB,
            }, 'VRAM insuficiente, reenfileirando requisição');

            // Reenfileirar sem degradar prioridade global do request original
            await enqueueRequest(request);
            return;
          }

          // Marcar serviço como ativo
          await markServiceActive(serviceType, request.id);

          // Processar requisição
          const response = await processGpuRequest(request);

          // Armazenar resultado no Redis (para polling)
          const resultKey = `${REDIS_QUEUE_PREFIX}:result:${request.id}`;
          await redis.setEx(resultKey, 300, JSON.stringify(response)); // 5 min TTL

          logger.info({
            requestId: request.id,
            serviceType,
            success: response.success,
            latencyMs: response.latencyMs,
          }, 'Requisição GPU processada');
          return;
        } finally {
          await markServiceInactive(serviceType);
          await releaseGpuLockIfOwned(request.id);
        }
      }
    } catch (error) {
      logger.error({ error }, 'Erro ao processar próxima requisição GPU');
    }
  };

  const processQueue = async () => {
    try {
      await processNextRequest();
    } catch (error) {
      logger.error({ error }, 'Erro no worker de fila GPU');
    }
    
    // Continuar processando
    if (isWorkerRunning) {
      setTimeout(processQueue, 100); // Poll a cada 100ms
    }
  };
  
  processQueue();
}

/**
 * Para worker de fila
 */
function stopQueueWorker(): void {
  isWorkerRunning = false;
  logger.info('Worker de fila GPU parado');
}

// ============================================================================
// EXPRESS APP
// ============================================================================

const app = express();
const server = createServer(app);

// Middleware
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(createCorrelationMiddleware({ serviceName: 'gpu-manager' }));
app.use(createSecurityMiddleware());

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'gpu-manager' });
});

// Liveness probe
app.get('/live', async (req: Request, res: Response) => {
  try {
    const redisHealthy = isRedisAvailable();
    res.json({ 
      status: 'alive',
      redis: redisHealthy ? 'healthy' : 'unhealthy',
    });
  } catch (error) {
    res.status(503).json({ status: 'unhealthy', error: String(error) });
  }
});

// Readiness probe
app.get('/ready', async (req: Request, res: Response) => {
  try {
    const redisHealthy = isRedisAvailable();
    const vramStatus = await getVramStatus();
    
    if (!redisHealthy) {
      return res.status(503).json({ status: 'not ready', reason: 'redis unavailable' });
    }
    
    res.json({ 
      status: 'ready',
      redis: 'healthy',
      vram: vramStatus,
    });
  } catch (error) {
    res.status(503).json({ status: 'not ready', error: String(error) });
  }
});

// Enfileirar requisição GPU
// BUG FIX 25/12/2025: Usar requireInternalAuth ao invés de requireAuth (aceita X-Internal-Api-Secret)
app.post('/api/gpu/queue', requireInternalAuth, asyncHandler(async (req: Request, res: Response) => {
  const schema = z.object({
    serviceType: z.nativeEnum(GpuServiceType),
    priority: z.nativeEnum(GpuRequestPriority).optional(),
    endpoint: z.string(),
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional(),
    body: z.unknown().optional(),
    headers: z.record(z.string()).optional(),
    timeout: z.number().optional(),
    maxRetries: z.number().optional(),
    metadata: z.record(z.unknown()).optional(),
  });
  
  const body = schema.parse(req.body);
  const requestId = `gpu-${randomUUID()}`;
  
  const request: GpuRequest = {
    id: requestId,
    serviceType: body.serviceType,
    priority: body.priority || GpuRequestPriority.MEDIUM,
    endpoint: body.endpoint,
    method: body.method || 'POST',
    body: body.body,
    headers: body.headers,
    timeout: body.timeout,
    // BUG FIX 25/12/2025: req.tenantId e req.userId não existem com requireInternalAuth
    // GPU Manager Service é interno - não precisa de tenant/user context para requisições GPU
    tenantId: undefined,
    userId: undefined,
    metadata: body.metadata,
    createdAt: Date.now(),
    retries: 0,
    maxRetries: body.maxRetries || 3,
  };
  
  await enqueueRequest(request);
  
  res.status(202).json({
    requestId,
    status: 'queued',
    message: 'Requisição enfileirada',
  });
}));

// Obter resultado de requisição
// BUG FIX 25/12/2025: Usar requireInternalAuth ao invés de requireAuth (aceita X-Internal-Api-Secret)
app.get('/api/gpu/queue/:requestId', requireInternalAuth, asyncHandler(async (req: Request, res: Response) => {
  const { requestId } = req.params;
  const redis = getRedisClient();
  if (!redis) {
    return res.status(503).json({ error: 'Redis não disponível' });
  }
  
  const resultKey = `${REDIS_QUEUE_PREFIX}:result:${requestId}`;
  
  const result = await redis.get(resultKey);
  if (!result || typeof result !== 'string') {
    return res.status(404).json({ error: 'Resultado não encontrado' });
  }
  
  // BUG FIX 26/12/2025: Type guard para garantir que é string (Redis v5 pode retornar tipos variados)
  const response: GpuResponse = JSON.parse(result);
  res.json(response);
}));

// Streaming LLM (bypass fila - proxy direto com verificação de circuit breaker e VRAM)
// Gate 2 (15/01/2026): Sem orquestração dinâmica, serviço sempre ativo
app.post('/api/gpu/stream', requireInternalAuth, asyncHandler(async (req: Request, res: Response) => {
  const schema = z.object({
    serviceType: z.nativeEnum(GpuServiceType),
    endpoint: z.string(),
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional(),
    body: z.unknown().optional(),
    headers: z.record(z.string()).optional(),
    timeout: z.number().optional(),
  });
  
  const body = schema.parse(req.body);
  const serviceType = body.serviceType;
  
  // Gate 2: streaming é suportado pelo LLM (texto)
  if (serviceType !== GpuServiceType.LLM) {
    return res.status(400).json({ error: 'Streaming suportado apenas para LLM' });
  }

  // Gate 2: Serviço sempre ativo, sem orquestração dinâmica
  const url = GPU_SERVICE_URLS[serviceType];
  const protectedFetch = protectedFetchByServiceType[serviceType];
  
  // Verificar VRAM disponível
  const vramStatus = await getVramStatus();
  if (!hasEnoughVram(serviceType, vramStatus)) {
    return res.status(503).json({ 
      error: 'VRAM insuficiente',
      requiredGB: VRAM_REQUIREMENTS[serviceType],
      availableGB: vramStatus.freeGB,
    });
  }
  
  try {
    const streamingRequestId = `stream-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const timeoutMs = body.timeout || GPU_SERVICE_TIMEOUT;

    // Streaming também precisa de lock global (GPU única) para garantir prioridade e VRAM
    const lockTtlMs = Math.min(timeoutMs + 30000, 5 * 60 * 1000);
    const acquired = await tryAcquireGpuLock(serviceType, streamingRequestId, lockTtlMs);
    if (!acquired) {
      return res.status(503).json({ error: 'GPU ocupada - tente novamente' });
    }

    await markServiceActive(serviceType, streamingRequestId);

    try {
      const requestBody = applyStructuredOutputs({
        serviceType,
        endpoint: body.endpoint,
        body: body.body,
      });
      const response = await protectedFetch(`${url}${body.endpoint}`, {
        method: body.method || 'POST',
        headers: {
          ...(body.method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
          ...body.headers,
        },
        body: body.method !== 'GET' && requestBody ? JSON.stringify(requestBody) : undefined,
        timeoutMs,
      });

      if (!response.ok) {
        const errorText = await response.text();
        res.status(response.status).json({ error: errorText });
        return;
      }

      if (!response.body) {
        res.status(500).json({ error: 'Resposta de streaming não contém body' });
        return;
      }

      // ARQUITETURA DE STREAMING (25/12/2025):
      // 1. GPU Manager Service faz fetch do gpu-mixtral e recebe Response com stream
      // 2. GPU Manager Service faz proxy do stream para sua resposta HTTP (res.write)
      // 3. Chat-service faz fetch do endpoint /api/gpu/stream e recebe Response com stream
      // 4. Chat-service faz proxy do stream para sua resposta HTTP (res.write)
      //
      // São duas requisições HTTP diferentes => não há conflito de body consumido.

      // Proxy do stream diretamente para o cliente (chat-service fará fetch deste endpoint e fará proxy)
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      // Pipe do stream (proxy direto)
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          res.write(decoder.decode(value, { stream: true }));
        }

        res.end();
      } catch (error) {
        logger.error({ error }, 'Erro ao fazer proxy de stream');
        if (!res.headersSent) {
          res.status(500).json({ error: 'Erro ao fazer proxy de stream' });
        } else {
          res.end();
        }
      } finally {
        reader.releaseLock();
      }
    } finally {
      await markServiceInactive(serviceType);
      await releaseGpuLockIfOwned(streamingRequestId);
    }
  } catch (error) {
    logger.error({ 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined 
    }, 'Erro na requisição streaming');
    if (!res.headersSent) {
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Erro desconhecido' 
      });
    }
  }
}));

// Status de VRAM
// BUG FIX 25/12/2025: Usar requireInternalAuth ao invés de requireAuth (aceita X-Internal-Api-Secret)
app.get('/api/gpu/vram', requireInternalAuth, asyncHandler(async (req: Request, res: Response) => {
  const vramStatus = await getVramStatus();
  res.json(vramStatus);
}));

// Status da fila
// BUG FIX 25/12/2025: Usar requireInternalAuth ao invés de requireAuth (aceita X-Internal-Api-Secret)
app.get('/api/gpu/queue/status', requireInternalAuth, asyncHandler(async (req: Request, res: Response) => {
  const redis = getRedisClient();
  if (!redis) {
    return res.status(503).json({ error: 'Redis não disponível' });
  }
  
  const status: Record<string, number> = {};
  
  for (const serviceType of Object.values(GpuServiceType)) {
    const queueKey = `${REDIS_QUEUE_PREFIX}:${serviceType}`;
    const count = await redis.zCard(queueKey);
    status[serviceType] = count;
  }
  
  res.json({
    queues: status,
    activeServices: (await getVramStatus()).activeServices,
  });
}));

// ===========================================================================
// Gate 2 (15/01/2026): Status dos serviços GPU
// ===========================================================================
// Endpoint para monitorar estado dos serviços GPU
// Todos rodam simultaneamente na nova arquitetura
app.get('/api/gpu/services', requireInternalAuth, asyncHandler(async (req: Request, res: Response) => {
  const vramStatus = await getVramStatus();
  
  // Gate 2: todos os serviços rodam simultaneamente EXCETO TRAINING
  // TRAINING é sob demanda (on_demand) - só inicia quando há job de fine-tuning
  const services: Record<string, { vramGB: number; url: string; status: string }> = {};
  for (const [type, url] of Object.entries(GPU_SERVICE_URLS)) {
    services[type] = {
      vramGB: VRAM_REQUIREMENTS[type as GpuServiceType],
      url,
      // FIX Bug 4 (11/01/2026): TRAINING é sob demanda, não always_active
      status: type === GpuServiceType.TRAINING ? 'on_demand' : 'always_active',
    };
  }
  
  // Gate 2: Calcular VRAM dinamicamente (exclui TRAINING - sob demanda)
  // BUG FIX 11/01/2026: vramFreeGB agora usa o mesmo cálculo de totalVramUsedGB
  // Antes: vramFreeGB era hardcoded (TOTAL_VRAM_GB - 15), causando inconsistência
  const totalVramUsedGB = Object.entries(VRAM_REQUIREMENTS)
    .filter(([key]) => key !== GpuServiceType.TRAINING)
    .reduce((sum, [, vram]) => sum + vram, 0);
  
  res.json({
    architecture: 'gate2',
    description: `Serviços GPU simultâneos (budget declarado: ${totalVramUsedGB}GB de ${TOTAL_VRAM_GB}GB; uso real via nvidia-smi quando disponível)`,
    services,
    vram: vramStatus,
    totalVramUsedGB,
    vramFreeGB: TOTAL_VRAM_GB - totalVramUsedGB,
  });
}));

// Métricas Prometheus
const prometheus = createAlicePrometheus({ serviceName: 'gpu-manager' });

// ============================================================================
// PROMETHEUS: Métricas específicas do GPU Manager (modelo-agnóstico)
// ============================================================================
// Total de VRAM (bytes) - valor real quando nvidia-smi está disponível
const gpuVramTotalBytes = new Gauge({
  name: 'alice_gpu_vram_total_bytes',
  help: 'VRAM total da GPU em bytes (fonte: nvidia-smi quando disponível)',
  labelNames: ['gpu_id'] as const,
  registers: [prometheus.registry],
});

// VRAM usada (bytes) - valor real agregado (nvidia-smi)
const gpuVramUsedBytes = new Gauge({
  name: 'alice_gpu_vram_used_bytes',
  help: 'VRAM usada total da GPU em bytes (fonte: nvidia-smi quando disponível)',
  labelNames: ['gpu_id'] as const,
  registers: [prometheus.registry],
});

// VRAM "reservada" por capacidade (bytes) - derivada de requisitos declarados
// (transparente: não tenta inferir uso real por processo/container)
const gpuVramReservedBytes = new Gauge({
  name: 'alice_gpu_vram_reserved_bytes',
  help: 'VRAM reservada estimada por capacidade (bytes) baseada em serviços ativos e requisitos declarados',
  labelNames: ['gpu_id', 'service'] as const,
  registers: [prometheus.registry],
});

// Depth da fila por capacidade (zset Redis)
const gpuManagerQueueDepth = new Gauge({
  name: 'alice_gpu_manager_queue_depth',
  help: 'Tamanho atual da fila Redis por capacidade (LLM/embeddings/training)',
  labelNames: ['queue'] as const,
  registers: [prometheus.registry],
});

// Tempo de espera na fila (segundos) por capacidade
const gpuManagerQueueWaitDuration = new Histogram({
  name: 'alice_gpu_manager_queue_wait_duration_seconds',
  help: 'Tempo de espera na fila Redis (segundos) por capacidade',
  labelNames: ['queue'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120],
  registers: [prometheus.registry],
});

// Helper: GPU única no GEX44 (RTX 4000 Ada). Mantemos configurável para suportar expansão futura.
const GPU_ID = process.env.NVIDIA_GPU_ID ?? '0';
// CORREÇÃO 26/12/2025: Usar contentType correto do registry (application/openmetrics-text)
// Padrão consistente com packages/shared-utils/src/prometheus.ts linha 702
app.get('/metrics', async (_req: Request, res: Response) => {
  try {
    res.set('Content-Type', prometheus.registry.contentType);
    res.end(await prometheus.registry.metrics());
  } catch (error) {
    logger.error({ error }, 'Erro ao gerar métricas Prometheus');
    res.status(500).end('Erro ao gerar métricas');
  }
});

// Error handlers
app.use(createErrorHandler());
app.use(createNotFoundHandler());

// ============================================================================
// INICIALIZAÇÃO
// ============================================================================

async function start(): Promise<void> {
  try {
    // CORREÇÃO 28/12/2025: Inicializar Redis ANTES de verificar disponibilidade
    // BUG CRÍTICO: isRedisAvailable() retornava false porque initializeRedisCache() nunca era chamado
    // Resultado: redisClient era sempre null → erro "Redis não disponível" → container crashava
    // Serviços que dependem de gpu-manager (chat, rag, training) falhavam em cascata
    logger.info('Inicializando conexão Redis...');
    await initializeRedisCache();
    
    // Verificar Redis
    if (!isRedisAvailable()) {
      throw new Error('Redis não disponível após inicialização');
    }
    logger.info('Redis inicializado com sucesso');

    // Gate 2: LLM (texto), Embeddings e Training locais. Containers GPU são gerenciados pelo Docker Compose.
    // Observação: VRAM real deve vir de nvidia-smi (quando disponível). Os "budgets" abaixo são apenas estimativa/fallback.
    const alwaysOnBudgetGB = Object.entries(VRAM_REQUIREMENTS)
      .filter(([key]) => key !== GpuServiceType.TRAINING)
      .reduce((sum, [, vram]) => sum + vram, 0);
    logger.info(
      { totalVramGB: TOTAL_VRAM_GB, alwaysOnBudgetGB },
      'Arquitetura GPU (Gate 2) - serviços always-on com budgets estimados'
    );
    
    // Iniciar worker de fila
    await startQueueWorker();
    
    // Iniciar servidor
    server.listen(PORT, () => {
      logger.info({ port: PORT }, 'GPU Manager Service iniciado');
    });
    
    // Graceful shutdown
    registerShutdownCallback('gpu-manager-server', async () => {
      logger.info('Encerrando GPU Manager Service...');
      stopQueueWorker();
      server.close();
      // CORREÇÃO 28/12/2025: Fechar conexão Redis no shutdown
      await closeRedisCacheClient();
      logger.info('Conexão Redis encerrada');
    }, { priority: ShutdownPriority.HTTP_SERVER });
    
  } catch (error) {
    logger.error({ error }, 'Erro ao iniciar GPU Manager Service');
    process.exit(1);
  }
}

start();

