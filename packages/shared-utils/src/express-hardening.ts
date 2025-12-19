/**
 * Express Hardening Module - Alice Enterprise Platform
 * 
 * Módulo centralizado para configuração de segurança Express.js 2025.
 * Implementa best practices: Helmet, Rate Limiting com Redis, Error Handling.
 * 
 * Referências:
 * - Express.js 4.21+ Security Best Practices
 * - OWASP API Security Top 10 2023
 * - Helmet 8.x Configuration Guide
 * - express-rate-limit 8.2.1 + rate-limit-redis 4.3.0 (2025)
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 * 
 * @module @alice/shared-utils/express-hardening
 */

import { Request, Response, NextFunction, Express, RequestHandler, ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import rateLimit, { Options as RateLimitOptions, Store, ipKeyGenerator } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { createClient, RedisClientType } from 'redis';
import compression from 'compression';
import { createLogger } from './logger.js';

/**
 * Logger singleton do módulo (usa child logger do base singleton)
 */
const logger = createLogger('express-hardening');

/**
 * Cliente Redis singleton para rate limiting distribuído
 * OWASP API4/8: Distribuído para funcionar em escala multi-pod
 */
let redisClient: RedisClientType | null = null;
let redisConnectionPromise: Promise<RedisClientType | null> | null = null;

/**
 * Obtém ou cria cliente Redis para rate limiting
 * Usa padrão singleton para reutilizar conexão entre serviços
 */
async function getRedisClient(): Promise<RedisClientType | null> {
  const redisUrl = process.env.REDIS_URL;
  
  if (!redisUrl) {
    return null;
  }
  
  if (redisClient?.isOpen) {
    return redisClient;
  }
  
  if (redisConnectionPromise) {
    return redisConnectionPromise;
  }
  
  redisConnectionPromise = (async () => {
    const isProduction = process.env.NODE_ENV === 'production';
    
    try {
      const client = createClient({
        url: redisUrl,
        socket: {
          connectTimeout: 5000,
          reconnectStrategy: (retries) => {
            if (retries > 3) {
              // REGRA 6: Em produção, fail-fast se Redis não disponível
              if (isProduction) {
                logger.fatal('CRÍTICO: Redis indisponível em produção - fail-fast (Regra 6)');
                throw new Error('Redis obrigatório em produção para rate limiting distribuído');
              }
              logger.warn('Redis: máximo de tentativas atingido (desenvolvimento)');
              return new Error('Max retries reached');
            }
            return Math.min(retries * 100, 2000);
          },
        },
      });
      
      client.on('error', (err) => {
        logger.error({ error: err.message }, 'Erro Redis');
        // REGRA 6: Em produção, erro de Redis é crítico
        if (isProduction) {
          logger.fatal({ error: err.message }, 'CRÍTICO: Erro Redis em produção - serviço pode estar comprometido');
        }
      });
      
      client.on('connect', () => {
        logger.info('Redis conectado para rate limiting distribuído');
      });
      
      await client.connect();
      redisClient = client as RedisClientType;
      return redisClient;
    } catch (error) {
      // REGRA 6: Em produção, NUNCA usar MemoryStore - fail-fast
      if (isProduction) {
        logger.fatal({ error: (error as Error).message }, 'CRÍTICO: Falha ao conectar Redis em produção');
        throw new Error(`Redis obrigatório em produção: ${(error as Error).message}`);
      }
      logger.warn({ error: (error as Error).message }, 'Falha ao conectar Redis (desenvolvimento), usando MemoryStore');
      redisConnectionPromise = null;
      return null;
    }
  })();
  
  return redisConnectionPromise;
}

/**
 * Cria Redis Store para rate limiting (OWASP API4/8 2025)
 * Retorna null se Redis não está disponível (fallback para MemoryStore)
 */
async function createRedisStoreIfAvailable(prefix: string): Promise<Store | null> {
  const client = await getRedisClient();
  
  if (!client) {
    return null;
  }
  
  try {
    return new RedisStore({
      sendCommand: (...args: string[]) => client.sendCommand(args),
      prefix: `rl:${prefix}:`,
    });
  } catch (error) {
    logger.warn({ error: (error as Error).message }, 'Falha ao criar RedisStore');
    return null;
  }
}

/**
 * Configuração de Helmet para segurança enterprise (OWASP 2023 + Helmet 8.x)
 * CSP, HSTS, X-Frame-Options, etc.
 */
export function createSecurityMiddleware(options?: {
  contentSecurityPolicy?: boolean;
  isDevelopment?: boolean;
}): RequestHandler {
  const isDev = options?.isDevelopment ?? process.env.NODE_ENV !== 'production';
  const enableCSP = options?.contentSecurityPolicy ?? true;

  return helmet({
    contentSecurityPolicy: enableCSP ? {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: isDev 
          ? ["'self'", "'unsafe-inline'"] 
          : ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        fontSrc: ["'self'", "https:", "data:"],
        connectSrc: ["'self'", "https:", "wss:"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: isDev ? null : [],
      },
    } : false,
    
    strictTransportSecurity: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    
    frameguard: { action: 'deny' },
    noSniff: true,
    xssFilter: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    dnsPrefetchControl: { allow: false },
    ieNoOpen: true,
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },
    hidePoweredBy: true,
  });
}

/**
 * Opções para Rate Limiter multi-tenant
 */
export interface MultiTenantRateLimitOptions {
  windowMs?: number;
  max?: number;
  message?: string | object;
  skipRoutes?: string[];
  serviceName?: string;
  useRedis?: boolean;
}

/**
 * Rate Limiter com suporte multi-tenant e Redis distribuído (express-rate-limit 8.2.1 + rate-limit-redis 4.3.0)
 * 
 * OWASP API4/8 2025:
 * - Produção: Redis Store para consistência entre pods
 * - Desenvolvimento: MemoryStore (fallback automático)
 * 
 * Features:
 * - keyGenerator baseado em IP + tenantId
 * - skip para health checks
 * - handler customizado com logging
 * - standardHeaders: 'draft-8' (IETF 2025)
 */
export function createRateLimiter(options?: MultiTenantRateLimitOptions): RequestHandler {
  const {
    windowMs = 60 * 1000,
    max = 100,
    message = { error: 'Muitas requisições. Tente novamente em 1 minuto.' },
    skipRoutes = ['/health', '/api/*/health'],
    serviceName = 'unknown',
    useRedis = process.env.NODE_ENV === 'production',
  } = options || {};

  const isProduction = process.env.NODE_ENV === 'production';
  
  const keyGenerator = (req: Request): string => {
    const rawIp = req.ip || req.socket?.remoteAddress || '0.0.0.0';
    const ip = ipKeyGenerator(rawIp);
    const tenantId = (req.headers['x-tenant-id'] as string) || req.tenantId || 'anonymous';
    return `${ip}:${tenantId}`;
  };
  
  const skip = (req: Request): boolean => {
    const path = req.path.toLowerCase();
    
    if (path.includes('/health')) {
      return true;
    }
    
    for (const route of skipRoutes) {
      if (route.includes('*')) {
        const pattern = route.replace(/\*/g, '.*');
        if (new RegExp(`^${pattern}$`).test(path)) {
          return true;
        }
      } else if (path === route || path.startsWith(route)) {
        return true;
      }
    }
    
    return false;
  };
  
  const handler = (req: Request, res: Response, _next: NextFunction, optionsUsed: RateLimitOptions) => {
    const tenantId = req.tenantId || 'unknown';
    const ip = req.ip || 'unknown';
    
    logger.warn({
      service: serviceName,
      event: 'rate_limit_exceeded',
      tenantId,
      ip,
      path: req.path,
      method: req.method,
      windowMs: optionsUsed.windowMs,
      max: optionsUsed.limit,
    }, 'Rate limit excedido');
    
    res.status(429).json(message);
  };

  if (useRedis && process.env.REDIS_URL) {
    let redisLimiter: RequestHandler | null = null;
    
    const baseLimiterOptions: Partial<RateLimitOptions> = {
      windowMs,
      limit: max,
      message,
      standardHeaders: 'draft-8' as const,
      legacyHeaders: false,
      keyGenerator,
      skip,
      handler,
    };
    
    const fallbackLimiter: RequestHandler = rateLimit(baseLimiterOptions);
    
    createRedisStoreIfAvailable(serviceName).then(store => {
      if (store) {
        logger.info({ service: serviceName }, 'Rate limiting atualizado para Redis Store (OWASP API4/8 compliant)');
        redisLimiter = rateLimit({
          ...baseLimiterOptions,
          store,
        });
      } else {
        logger.warn({ service: serviceName }, 'Rate limiting mantido em MemoryStore (Redis indisponível)');
      }
    }).catch(err => {
      logger.error({ service: serviceName, error: err }, 'Erro ao inicializar Redis Store');
    });
    
    return (req: Request, res: Response, next: NextFunction) => {
      const limiter = redisLimiter || fallbackLimiter;
      return limiter(req, res, next);
    };
  }
  
  // REGRA 6: Em produção, Redis é OBRIGATÓRIO - fail-fast
  if (isProduction && !process.env.REDIS_URL) {
    throw new Error(`[${serviceName}] CRÍTICO: REDIS_URL não configurado em produção. Rate limiting distribuído é obrigatório (Regra 6 - SEM SOLUÇÕES TEMPORÁRIAS)`);
  }
  
  // Desenvolvimento: MemoryStore é aceitável
  return rateLimit({
    windowMs,
    limit: max,
    message,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator,
    skip,
    handler,
  });
}

/**
 * Wrapper para rotas async (Express.js 2025)
 * Captura erros de funções async e passa para error handler
 */
export function asyncHandler<T extends Request = Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<void | Response>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as T, res, next)).catch(next);
  };
}

/**
 * Error Handler Global (Express.js 2025 + OWASP)
 */
export interface ErrorHandlerOptions {
  serviceName?: string;
  logger?: {
    error: (obj: object, msg: string) => void;
  };
  includeStackInDev?: boolean;
}

export function createErrorHandler(options?: ErrorHandlerOptions): ErrorRequestHandler {
  const {
    serviceName = 'unknown',
    logger,
    includeStackInDev = true,
  } = options || {};

  const isProduction = process.env.NODE_ENV === 'production';
  const showStackTrace = !isProduction && includeStackInDev;

  // Express 5: ErrorRequestHandler espera (err, req, res, next)
  return ((err: Error & { status?: number; statusCode?: number }, req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const correlationId = req.headers['x-correlation-id'] || 'unknown';
    const tenantId = req.tenantId || (req.headers['x-tenant-id'] as string) || 'unknown';

    const logEntry = {
      service: serviceName,
      event: 'unhandled_error',
      status,
      path: req.path,
      method: req.method,
      correlationId,
      tenantId,
      error: {
        message: err.message,
        name: err.name,
        stack: err.stack,
      },
      timestamp: new Date().toISOString(),
    };

    if (logger) {
      logger.error(logEntry, 'Erro não tratado');
    }

    const response: {
      error: string;
      message?: string;
      correlationId: string;
      stack?: string;
    } = {
      error: status >= 500 ? 'Erro interno do servidor' : err.message,
      correlationId: correlationId as string,
    };

    if (showStackTrace) {
      response.message = err.message;
      response.stack = err.stack;
    }

    if (!res.headersSent) {
      res.status(status).json(response);
    }
  }) as ErrorRequestHandler;
}

/**
 * Middleware 404 Not Found (Express.js 2025)
 */
export function createNotFoundHandler(options?: {
  serviceName?: string;
}): RequestHandler {
  const serviceName = options?.serviceName || 'unknown';

  return (req: Request, res: Response) => {
    const correlationId = req.headers['x-correlation-id'] || 'unknown';
    
    res.status(404).json({
      error: 'Rota não encontrada',
      path: req.path,
      method: req.method,
      service: serviceName,
      correlationId,
    });
  };
}

/**
 * Configura Express app com todas as configurações de segurança
 */
export interface HardeningConfig {
  serviceName: string;
  trustProxy?: number | boolean;
  enableCompression?: boolean;
  enableCSP?: boolean;
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
  skipRateLimitRoutes?: string[];
  useRedis?: boolean;
  logger?: {
    error: (obj: object, msg: string) => void;
  };
}

export function applySecurityHardening(app: Express, config: HardeningConfig): void {
  const {
    serviceName,
    trustProxy = 1,
    enableCompression = true,
    enableCSP = true,
    rateLimitMax = 100,
    rateLimitWindowMs = 60 * 1000,
    skipRateLimitRoutes = [],
    useRedis = process.env.NODE_ENV === 'production',
  } = config;

  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);

  app.use(createSecurityMiddleware({
    contentSecurityPolicy: enableCSP,
    isDevelopment: process.env.NODE_ENV !== 'production',
  }));

  if (enableCompression) {
    app.use(compression());
  }

  app.use(createRateLimiter({
    max: rateLimitMax,
    windowMs: rateLimitWindowMs,
    skipRoutes: skipRateLimitRoutes,
    serviceName,
    useRedis,
  }));
}

/**
 * Configura timeouts do servidor HTTP (Node.js 20 LTS 2025)
 * 
 * Best practices:
 * - server.timeout: tempo máximo para requisição completa
 * - keepAliveTimeout: deve ser maior que ALB timeout (60s default)
 * - headersTimeout: ligeiramente maior que keepAliveTimeout
 */
export interface ServerTimeoutConfig {
  timeout?: number;
  keepAliveTimeout?: number;
  headersTimeout?: number;
}

export function configureServerTimeouts(
  server: { timeout: number; keepAliveTimeout: number; headersTimeout: number },
  config?: ServerTimeoutConfig
): void {
  const {
    timeout = 30000,
    keepAliveTimeout = 65000,
    headersTimeout = 66000,
  } = config || {};

  server.timeout = timeout;
  server.keepAliveTimeout = keepAliveTimeout;
  server.headersTimeout = headersTimeout;
}

/**
 * Encerra cliente Redis de rate limiting
 * Chamar durante graceful shutdown
 */
export async function closeRedisRateLimitClient(): Promise<void> {
  if (redisClient?.isOpen) {
    try {
      await redisClient.quit();
      logger.info('Cliente Redis de rate limiting encerrado');
    } catch (error) {
      logger.warn({ error }, 'Erro ao encerrar Redis');
    }
  }
  redisClient = null;
  redisConnectionPromise = null;
}

/**
 * Schemas Zod comuns para validação de rotas
 */
export const CommonSchemas = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  paginationDefaults: {
    page: 1,
    limit: 50,
    maxLimit: 100,
  },
};
