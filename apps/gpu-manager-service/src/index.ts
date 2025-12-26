/**
 * GPU Manager Service - Alice Enterprise Platform
 * 
 * Serviço centralizado de gerenciamento de requisições GPU com fila priorizada,
 * monitoramento de VRAM, circuit breakers e métricas enterprise.
 * 
 * ARQUITETURA ENTERPRISE (25/12/2025):
 * - Fila Redis com priorização (chat > trading > embeddings > outros)
 * - Monitoramento de VRAM em tempo real (nvidia-smi)
 * - Circuit breakers por serviço GPU
 * - Retry logic com backoff exponencial
 * - Métricas Prometheus (latência, fila, VRAM, erros)
 * - Graceful shutdown
 * - Health checks enterprise
 * 
 * Autor: Fillipe Guerra
 * Data: 25 de Dezembro de 2025
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import cors from 'cors';
import compression from 'compression';
import { 
  CIRCUIT_BREAKER_PRESETS,
  createProtectedFetch,
  getRedisClient,
  isRedisAvailable,
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
  LOW = 2,        // Geração de imagens, ASR, Treinamento (LoRA)
}

/** Tipos de serviços GPU */
export enum GpuServiceType {
  MIXTRAL = 'mixtral',           // LLM (Mixtral 8x7B)
  EMBEDDINGS = 'embeddings',     // Qwen3 + OpenCLIP
  FLUX = 'flux',                 // Geração de imagens
  ASR = 'asr',                   // Transcrição de áudio
  TRAINING = 'training',         // Fine-tuning LoRA (GPU dedicada 20GB - prioridade baixa)
}

/** URLs dos serviços GPU (container names na rede Docker) */
// BUG FIX 25/12/2025: Defaults devem usar container names, não localhost (não funciona em Docker network)
const GPU_SERVICE_URLS = {
  [GpuServiceType.MIXTRAL]: process.env.MIXTRAL_GPU_URL || 'http://gpu-mixtral:8000',
  [GpuServiceType.EMBEDDINGS]: process.env.EMBEDDINGS_GPU_URL || 'http://gpu-embeddings:8000',
  [GpuServiceType.FLUX]: process.env.FLUX_GPU_URL || 'http://gpu-flux:8000',
  [GpuServiceType.ASR]: process.env.ASR_GPU_URL || 'http://gpu-asr:8000',
  [GpuServiceType.TRAINING]: process.env.TRAINING_GPU_URL || 'http://gpu-trainer:8000',
};

/** VRAM necessária por serviço (GB) */
// BUG FIX 25/12/2025: Ajustado para RTX 4000 Ada (20GB) - Hetzner GEX44
const VRAM_REQUIREMENTS: Record<GpuServiceType, number> = {
  [GpuServiceType.MIXTRAL]: 18,      // ~16-18GB (reduzido de 20GB para caber em 20GB com margem)
  [GpuServiceType.EMBEDDINGS]: 16,   // ~14-16GB (reduzido de 18GB)
  [GpuServiceType.FLUX]: 12,         // ~10-12GB (reduzido de 14GB)
  [GpuServiceType.ASR]: 3,           // ~2-4GB (mantido)
  [GpuServiceType.TRAINING]: 18,     // LoRA/QLoRA Mixtral: alto consumo - executar apenas quando houver VRAM
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
 * Bug 1: remover breaker.fire() e usar fetch() direto elimina fail-fast/backpressure.
 */
const gpuServiceClients = {
  [GpuServiceType.MIXTRAL]: createProtectedFetch({
    name: 'gpu-mixtral',
    ...CIRCUIT_BREAKER_PRESETS.mixtralLLM,
  }),
  [GpuServiceType.EMBEDDINGS]: createProtectedFetch({
    name: 'gpu-embeddings',
    ...CIRCUIT_BREAKER_PRESETS.embeddingsGPU,
  }),
  [GpuServiceType.FLUX]: createProtectedFetch({
    name: 'gpu-flux',
    ...CIRCUIT_BREAKER_PRESETS.fluxImageGen,
  }),
  [GpuServiceType.ASR]: createProtectedFetch({
    name: 'gpu-asr',
    ...CIRCUIT_BREAKER_PRESETS.asrCanary,
  }),
  [GpuServiceType.TRAINING]: createProtectedFetch({
    name: 'gpu-trainer',
    ...CIRCUIT_BREAKER_PRESETS.gpuManager, // timeout alto, mas slices devem ser curtas (preemptível)
  }),
} as const;

const protectedFetchByServiceType = {
  [GpuServiceType.MIXTRAL]: gpuServiceClients[GpuServiceType.MIXTRAL].fetch,
  [GpuServiceType.EMBEDDINGS]: gpuServiceClients[GpuServiceType.EMBEDDINGS].fetch,
  [GpuServiceType.FLUX]: gpuServiceClients[GpuServiceType.FLUX].fetch,
  [GpuServiceType.ASR]: gpuServiceClients[GpuServiceType.ASR].fetch,
  [GpuServiceType.TRAINING]: gpuServiceClients[GpuServiceType.TRAINING].fetch,
} as const;

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
 * Obtém status de VRAM via nvidia-smi
 */
async function getVramStatus(): Promise<VramStatus> {
  try {
    const { stdout } = await execAsync('nvidia-smi --query-gpu=memory.total,memory.used,memory.free --format=csv,noheader,nounits');
    const [total, used, free] = stdout.trim().split(',').map(s => parseInt(s.trim(), 10));
    
    const totalGB = Math.round(total / 1024);
    const usedGB = Math.round(used / 1024);
    const freeGB = Math.round(free / 1024);
    const utilizationPercent = Math.round((used / total) * 100);

    // Obter serviços ativos do Redis
    // BUG FIX 25/12/2025: Adicionar verificação de null para evitar crash se Redis ficar indisponível
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

    return {
      totalGB,
      usedGB,
      freeGB,
      utilizationPercent,
      activeServices,
    };
  } catch (error) {
    logger.error({ error }, 'Erro ao obter status de VRAM');
    // Fallback: assumir valores padrão
    return {
      totalGB: TOTAL_VRAM_GB,
      usedGB: 0,
      freeGB: TOTAL_VRAM_GB,
      utilizationPercent: 0,
      activeServices: [],
    };
  }
}

/**
 * Verifica se há VRAM suficiente para um serviço
 */
function hasEnoughVram(serviceType: GpuServiceType, currentVram: VramStatus): boolean {
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
  if (!requestData) {
    // BUG FIX 25/12/2025: zPopMax já removeu da fila atomicamente
    // Dados expiraram, mas elemento já foi removido da fila
    logger.warn({ requestId }, 'Dados da requisição expiraram após remoção da fila');
    return null;
  }
  
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
 */
async function processGpuRequest(request: GpuRequest): Promise<GpuResponse> {
  const startTime = Date.now();
  const serviceType = request.serviceType;
  const url = GPU_SERVICE_URLS[serviceType];
  const protectedFetch = protectedFetchByServiceType[serviceType];
  
  try {
    const timeoutMs = request.timeout || 60000; // 60s padrão
    const response = await protectedFetch(`${url}${request.endpoint}`, {
      method: request.method,
      headers: {
        // Só setar JSON quando tiver body - evita bloquear endpoints que aceitam outros content-types
        ...(request.method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
        ...request.headers,
      },
      body: request.method !== 'GET' && request.body ? JSON.stringify(request.body) : undefined,
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
  
  // ARQUITETURA ENTERPRISE (26/12/2025):
  // GPU única (VRAM compartilhada) => execução SERIAL com lock global + prioridade global:
  // 1) MIXTRAL (chat/WhatsApp inferência)
  // 2) EMBEDDINGS
  // 3) Demais (ASR/FLUX)
  const servicePriorityOrder: GpuServiceType[] = [
    GpuServiceType.MIXTRAL,
    GpuServiceType.EMBEDDINGS,
    GpuServiceType.ASR,
    GpuServiceType.FLUX,
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

        // Tentar adquirir lock (TTL = timeout + margem)
        const timeoutMs = request.timeout || 60000;
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
  if (!result) {
    return res.status(404).json({ error: 'Resultado não encontrado' });
  }
  
  const response: GpuResponse = JSON.parse(result);
  res.json(response);
}));

// Streaming LLM (bypass fila - proxy direto com verificação de circuit breaker e VRAM)
// BUG FIX 25/12/2025: Streaming requer proxy direto (não pode usar fila com polling)
// BUG FIX 25/12/2025: Usar requireInternalAuth ao invés de requireAuth (aceita X-Internal-Api-Secret)
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
  
  // Apenas MIXTRAL suporta streaming no momento
  if (serviceType !== GpuServiceType.MIXTRAL) {
    return res.status(400).json({ error: 'Streaming suportado apenas para MIXTRAL' });
  }
  
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
    const timeoutMs = body.timeout || 60000;

    // Streaming também precisa de lock global (GPU única) para garantir prioridade e VRAM
    const lockTtlMs = Math.min(timeoutMs + 30000, 5 * 60 * 1000);
    const acquired = await tryAcquireGpuLock(serviceType, streamingRequestId, lockTtlMs);
    if (!acquired) {
      return res.status(503).json({ error: 'GPU ocupada - tente novamente' });
    }

    await markServiceActive(serviceType, streamingRequestId);

    try {
      const response = await protectedFetch(`${url}${body.endpoint}`, {
        method: body.method || 'POST',
        headers: {
          ...(body.method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
          ...body.headers,
        },
        body: body.method !== 'GET' && body.body ? JSON.stringify(body.body) : undefined,
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
    logger.error({ error }, 'Erro na requisição streaming');
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

// Métricas Prometheus
const prometheus = createAlicePrometheus({ serviceName: 'gpu-manager' });
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
    // Verificar Redis
    if (!isRedisAvailable()) {
      throw new Error('Redis não disponível');
    }
    
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
    }, { priority: ShutdownPriority.HTTP_SERVER });
    
  } catch (error) {
    logger.error({ error }, 'Erro ao iniciar GPU Manager Service');
    process.exit(1);
  }
}

start();

