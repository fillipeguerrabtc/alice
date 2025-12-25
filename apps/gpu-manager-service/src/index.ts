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
  createCircuitBreaker, 
  CIRCUIT_BREAKER_PRESETS,
  getRedisClient,
  isRedisAvailable,
  createAlicePrometheus,
  registerShutdownCallback,
  ShutdownPriority,
  instrumentCircuitBreaker,
} from '@alice/shared-utils';
import { createLogger } from '@alice/logger';
import { 
  createCorrelationMiddleware, 
  createSecurityMiddleware,
  createRateLimiter,
  createErrorHandler,
  createNotFoundHandler,
  asyncHandler,
} from '@alice/shared-utils';
import { exec } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';

const execAsync = promisify(exec);
const logger = createLogger('gpu-manager');

const PORT = process.env.PORT || 3010;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || '';
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
  LOW = 2,        // Geração de imagens, ASR
}

/** Tipos de serviços GPU */
export enum GpuServiceType {
  MIXTRAL = 'mixtral',           // LLM (Mixtral 8x7B)
  EMBEDDINGS = 'embeddings',     // Qwen3 + OpenCLIP
  FLUX = 'flux',                 // Geração de imagens
  ASR = 'asr',                   // Transcrição de áudio
}

/** URLs dos serviços GPU (container names na rede Docker) */
// BUG FIX 25/12/2025: Defaults devem usar container names, não localhost (não funciona em Docker network)
const GPU_SERVICE_URLS = {
  [GpuServiceType.MIXTRAL]: process.env.MIXTRAL_GPU_URL || 'http://gpu-mixtral:8000',
  [GpuServiceType.EMBEDDINGS]: process.env.EMBEDDINGS_GPU_URL || 'http://gpu-embeddings:8000',
  [GpuServiceType.FLUX]: process.env.FLUX_GPU_URL || 'http://gpu-flux:8000',
  [GpuServiceType.ASR]: process.env.ASR_GPU_URL || 'http://gpu-asr:8000',
};

/** VRAM necessária por serviço (GB) */
// BUG FIX 25/12/2025: Ajustado para RTX 4000 Ada (20GB) - Hetzner GEX44
const VRAM_REQUIREMENTS: Record<GpuServiceType, number> = {
  [GpuServiceType.MIXTRAL]: 18,      // ~16-18GB (reduzido de 20GB para caber em 20GB com margem)
  [GpuServiceType.EMBEDDINGS]: 16,   // ~14-16GB (reduzido de 18GB)
  [GpuServiceType.FLUX]: 12,         // ~10-12GB (reduzido de 14GB)
  [GpuServiceType.ASR]: 3,           // ~2-4GB (mantido)
};

/** VRAM total disponível (20GB para RTX 4000 Ada - Hetzner GEX44) */
// BUG FIX 25/12/2025: Corrigido de 24GB (RTX 4090) para 20GB (RTX 4000 Ada)
const TOTAL_VRAM_GB = 20;

/** Margem de segurança (GB) */
const VRAM_SAFETY_MARGIN_GB = 2;

/** Prefixo Redis para fila GPU */
const REDIS_QUEUE_PREFIX = 'alice:gpu:queue';
const REDIS_ACTIVE_PREFIX = 'alice:gpu:active';
const REDIS_METRICS_PREFIX = 'alice:gpu:metrics';

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

const circuitBreakers = {
  [GpuServiceType.MIXTRAL]: createCircuitBreaker(
    async () => {
      const url = GPU_SERVICE_URLS[GpuServiceType.MIXTRAL];
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`Health check failed: ${response.status}`);
    },
    {
      ...CIRCUIT_BREAKER_PRESETS.ENTERPRISE,
      name: 'gpu-mixtral',
    }
  ),
  [GpuServiceType.EMBEDDINGS]: createCircuitBreaker(
    async () => {
      const url = GPU_SERVICE_URLS[GpuServiceType.EMBEDDINGS];
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`Health check failed: ${response.status}`);
    },
    {
      ...CIRCUIT_BREAKER_PRESETS.ENTERPRISE,
      name: 'gpu-embeddings',
    }
  ),
  [GpuServiceType.FLUX]: createCircuitBreaker(
    async () => {
      const url = GPU_SERVICE_URLS[GpuServiceType.FLUX];
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`Health check failed: ${response.status}`);
    },
    {
      ...CIRCUIT_BREAKER_PRESETS.ENTERPRISE,
      name: 'gpu-flux',
    }
  ),
  [GpuServiceType.ASR]: createCircuitBreaker(
    async () => {
      const url = GPU_SERVICE_URLS[GpuServiceType.ASR];
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`Health check failed: ${response.status}`);
    },
    {
      ...CIRCUIT_BREAKER_PRESETS.ENTERPRISE,
      name: 'gpu-asr',
    }
  ),
};

// Instrumentar circuit breakers para métricas
Object.values(circuitBreakers).forEach(cb => instrumentCircuitBreaker(cb, 'gpu-manager'));

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
  
  // Adicionar à fila priorizada (sorted set: score = prioridade, value = requestId)
  await redis.zAdd(queueKey, {
    score: request.priority,
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
  const result = await redis.zPopMax(queueKey, 1);
  if (!result || result.length === 0) {
    return null;
  }
  
  const requestId = result[0].value;
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
  const circuitBreaker = circuitBreakers[serviceType];
  
  try {
    // BUG FIX 25/12/2025: Opossum usa .opened (boolean) não .state === 'OPEN'
    // Verificar circuit breaker
    if (circuitBreaker.opened) {
      throw new Error(`Circuit breaker OPEN para ${serviceType}`);
    }
    
    // Fazer requisição
    const controller = new AbortController();
    const timeout = request.timeout || 60000; // 60s padrão
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await circuitBreaker.fire(async () => {
        return fetch(`${url}${request.endpoint}`, {
          method: request.method,
          headers: {
            'Content-Type': 'application/json',
            ...request.headers,
          },
          body: request.method !== 'GET' && request.body ? JSON.stringify(request.body) : undefined,
          signal: controller.signal,
        });
      });
      
      clearTimeout(timeoutId);
      
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
      clearTimeout(timeoutId);
      throw error;
    }
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
  
  const processQueue = async () => {
    try {
      // Processar cada tipo de serviço
      for (const serviceType of Object.values(GpuServiceType)) {
        // Verificar se há requisições na fila
        const request = await dequeueRequest(serviceType);
        if (!request) {
          continue;
        }
        
        // Verificar VRAM disponível
        const vramStatus = await getVramStatus();
        if (!hasEnoughVram(serviceType, vramStatus)) {
          logger.warn({
            serviceType,
            requiredGB: VRAM_REQUIREMENTS[serviceType],
            availableGB: vramStatus.freeGB,
          }, 'VRAM insuficiente, reenfileirando requisição');
          
          // Reenfileirar com prioridade reduzida
          request.priority = Math.max(1, request.priority - 1);
          await enqueueRequest(request);
          continue;
        }
        
        // Marcar serviço como ativo
        await markServiceActive(serviceType, request.id);
        
        try {
          // Processar requisição
          const response = await processGpuRequest(request);
          
          // Armazenar resultado no Redis (para polling)
          // BUG FIX 25/12/2025: Adicionar verificação de null para evitar crash se Redis ficar indisponível
          const redis = getRedisClient();
          if (redis) {
            const resultKey = `${REDIS_QUEUE_PREFIX}:result:${request.id}`;
            await redis.setEx(resultKey, 300, JSON.stringify(response)); // 5 min TTL
          } else {
            logger.warn({ requestId: request.id }, 'Redis não disponível - resultado não foi armazenado para polling');
          }
          
          logger.info({
            requestId: request.id,
            serviceType,
            success: response.success,
            latencyMs: response.latencyMs,
          }, 'Requisição GPU processada');
        } finally {
          // Marcar serviço como inativo
          await markServiceInactive(serviceType);
        }
      }
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
app.use(createCorrelationMiddleware());
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
  const requestId = `gpu-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
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
  const circuitBreaker = circuitBreakers[serviceType];
  
  // Verificar circuit breaker
  if (circuitBreaker.opened) {
    return res.status(503).json({ error: 'Circuit breaker OPEN' });
  }
  
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
    const controller = new AbortController();
    const timeout = body.timeout || 60000;
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    // Fazer requisição streaming ao gpu-mixtral
    const response = await circuitBreaker.fire(async () => {
      return fetch(`${url}${body.endpoint}`, {
        method: body.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...body.headers,
        },
        body: body.method !== 'GET' && body.body ? JSON.stringify(body.body) : undefined,
        signal: controller.signal,
      });
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText });
    }
    
    if (!response.body) {
      return res.status(500).json({ error: 'Resposta de streaming não contém body' });
    }
    
    // BUG FIX 25/12/2025: NÃO fazer proxy aqui - retornar Response diretamente para chat-service
    // O chat-service fará o proxy do stream. Se fizermos proxy aqui, o body será consumido
    // e o chat-service não poderá ler o stream novamente.
    //
    // SOLUÇÃO: O chat-service deve fazer proxy do stream diretamente do GPU Manager Service.
    // O GPU Manager Service já está fazendo proxy do stream do gpu-mixtral para sua resposta HTTP.
    // O chat-service deve fazer proxy do stream do GPU Manager Service para sua resposta HTTP.
    //
    // Mas o problema é que o Response do fetch já teve seu body consumido pelo GPU Manager Service.
    //
    // SOLUÇÃO FINAL: O chat-service deve fazer fetch do endpoint /api/gpu/stream e fazer proxy
    // do stream diretamente para sua resposta HTTP, sem tentar ler o Response via streamResponse().
    // Isso requer mudar o chat-service para fazer proxy diretamente, sem usar streamResponse().
    //
    // Por enquanto, vamos fazer o proxy aqui, mas o chat-service não deve tentar ler o Response.
    // O chat-service deve fazer fetch do endpoint /api/gpu/stream e fazer proxy do stream diretamente.
    
    // Proxy do stream diretamente para o cliente
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Pipe do stream (proxy direto)
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        // BUG FIX 25/12/2025: Stream body é one-time-readable - pipe direto para res
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
const prometheus = createAlicePrometheus('gpu-manager');
app.get('/metrics', (req: Request, res: Response) => {
  res.set('Content-Type', 'text/plain');
  res.send(prometheus.register.metrics());
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
    registerShutdownCallback(async () => {
      logger.info('Encerrando GPU Manager Service...');
      stopQueueWorker();
      server.close();
    }, ShutdownPriority.HIGH);
    
  } catch (error) {
    logger.error({ error }, 'Erro ao iniciar GPU Manager Service');
    process.exit(1);
  }
}

start();

