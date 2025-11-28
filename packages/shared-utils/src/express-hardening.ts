/**
 * Express Hardening Module - Alice Enterprise Platform
 * 
 * Módulo centralizado para configuração de segurança Express.js 2025.
 * Implementa best practices: Helmet, Rate Limiting, Error Handling.
 * 
 * Referências:
 * - Express.js 4.21+ Security Best Practices
 * - OWASP API Security Top 10 2023
 * - Helmet 7.x Configuration Guide
 * - express-rate-limit 2025 Patterns
 * 
 * Documentação em PT-BR (Regra 10 replit.md)
 * 
 * @module @alice/shared-utils/express-hardening
 */

import { Request, Response, NextFunction, Express, RequestHandler } from 'express';
import helmet from 'helmet';
import rateLimit, { Options as RateLimitOptions, ipKeyGenerator } from 'express-rate-limit';
import compression from 'compression';

/**
 * Configuração de Helmet para segurança enterprise (OWASP 2023 + Helmet 7.x)
 * CSP, HSTS, X-Frame-Options, etc.
 */
export function createSecurityMiddleware(options?: {
  contentSecurityPolicy?: boolean;
  isDevelopment?: boolean;
}): RequestHandler {
  const isDev = options?.isDevelopment ?? process.env.NODE_ENV !== 'production';
  const enableCSP = options?.contentSecurityPolicy ?? true;

  return helmet({
    // Content Security Policy - previne XSS e injeção de scripts
    // PRODUÇÃO: CSP strict sem unsafe-inline (exceto styles para Tailwind)
    // DESENVOLVIMENTO: Relaxa para React HMR e debugging
    contentSecurityPolicy: enableCSP ? {
      directives: {
        defaultSrc: ["'self'"],
        // Produção: sem unsafe-inline para scripts (OWASP 2023)
        // Desenvolvimento: permite unsafe-inline para React Fast Refresh
        scriptSrc: isDev 
          ? ["'self'", "'unsafe-inline'"] 
          : ["'self'"],
        // Styles precisam de unsafe-inline para Tailwind CSS em ambos ambientes
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
    
    // HTTP Strict Transport Security - força HTTPS
    strictTransportSecurity: {
      maxAge: 31536000, // 1 ano
      includeSubDomains: true,
      preload: true,
    },
    
    // X-Frame-Options - previne clickjacking
    frameguard: { action: 'deny' },
    
    // X-Content-Type-Options - previne MIME sniffing
    noSniff: true,
    
    // X-XSS-Protection - legacy browser protection
    xssFilter: true,
    
    // Referrer-Policy - controla informação de referrer
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    
    // X-DNS-Prefetch-Control - controla DNS prefetch
    dnsPrefetchControl: { allow: false },
    
    // X-Download-Options - previne download automático em IE
    ieNoOpen: true,
    
    // X-Permitted-Cross-Domain-Policies - controla Flash/PDF
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },
    
    // Remove X-Powered-By (já fazemos via app.disable, mas double-check)
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
}

/**
 * Rate Limiter com suporte multi-tenant (express-rate-limit 2025)
 * - keyGenerator baseado em IP + tenantId
 * - skip para health checks
 * - handler customizado com logging
 */
export function createRateLimiter(options?: MultiTenantRateLimitOptions): RequestHandler {
  const {
    windowMs = 60 * 1000, // 1 minuto
    max = 100,
    message = { error: 'Muitas requisições. Tente novamente em 1 minuto.' },
    skipRoutes = ['/health', '/api/*/health'],
    serviceName = 'unknown',
  } = options || {};

  return rateLimit({
    windowMs,
    max,
    message,
    standardHeaders: true,
    legacyHeaders: false,
    
    // keyGenerator multi-tenant: combina IP + tenantId para isolamento
    // Usa ipKeyGenerator helper para IPv6 subnet handling (express-rate-limit 8.x)
    // NOTA: Rate limiter roda ANTES do auth middleware, então lê tenant de headers
    // x-tenant-id é injetado pelo API Gateway (Traefik) ou extraído de JWT pelo frontend
    keyGenerator: (req: Request): string => {
      // req.ip pode ser undefined em alguns casos (connections sem IP)
      const rawIp = req.ip || req.socket?.remoteAddress || '0.0.0.0';
      const ip = ipKeyGenerator(rawIp);
      // Prioriza header x-tenant-id (set by API Gateway/frontend)
      // Fallback para req.tenantId (set by auth middleware - pode não estar disponível aqui)
      const tenantId = (req.headers['x-tenant-id'] as string) || req.tenantId || 'anonymous';
      return `${ip}:${tenantId}`;
    },
    
    // skip para health checks e rotas configuradas
    skip: (req: Request): boolean => {
      const path = req.path.toLowerCase();
      
      // Sempre skip health checks
      if (path.includes('/health')) {
        return true;
      }
      
      // Verificar rotas customizadas
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
    },
    
    // handler customizado com logging
    handler: (req: Request, res: Response, next: NextFunction, optionsUsed: RateLimitOptions) => {
      const tenantId = req.tenantId || 'unknown';
      const ip = req.ip || 'unknown';
      
      // Log estruturado para monitoramento
      console.warn(JSON.stringify({
        level: 'warn',
        service: serviceName,
        event: 'rate_limit_exceeded',
        tenantId,
        ip,
        path: req.path,
        method: req.method,
        windowMs: optionsUsed.windowMs,
        max: optionsUsed.max,
        timestamp: new Date().toISOString(),
      }));
      
      res.status(429).json(message);
    },
  });
}

/**
 * Wrapper para rotas async (Express.js 2025)
 * Captura erros de funções async e passa para error handler
 * 
 * Uso:
 *   app.get('/rota', asyncHandler(async (req, res) => { ... }))
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
 * - Captura todos os erros não tratados
 * - Resposta padronizada
 * - Logging estruturado
 * - Não expõe stack traces em produção
 */
export interface ErrorHandlerOptions {
  serviceName?: string;
  logger?: {
    error: (obj: object, msg: string) => void;
  };
  includeStackInDev?: boolean;
}

export function createErrorHandler(options?: ErrorHandlerOptions): (
  err: Error & { status?: number; statusCode?: number },
  req: Request,
  res: Response,
  next: NextFunction
) => void {
  const {
    serviceName = 'unknown',
    logger,
    includeStackInDev = true,
  } = options || {};

  // SEGURANÇA: Verificação estrita de produção para evitar vazamento de stack
  // Usa NODE_ENV diretamente para evitar config drift entre serviços
  const isProduction = process.env.NODE_ENV === 'production';
  const showStackTrace = !isProduction && includeStackInDev;

  return (err, req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    const correlationId = req.headers['x-correlation-id'] || 'unknown';
    const tenantId = req.tenantId || (req.headers['x-tenant-id'] as string) || 'unknown';

    // Log estruturado (sempre inclui stack internamente para debug)
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
        stack: err.stack, // Stack sempre no log interno
      },
      timestamp: new Date().toISOString(),
    };

    if (logger) {
      logger.error(logEntry, 'Erro não tratado');
    } else {
      console.error(JSON.stringify(logEntry));
    }

    // Resposta padronizada (OWASP 2023 - não vaza info em produção)
    const response: {
      error: string;
      message?: string;
      correlationId: string;
      stack?: string;
    } = {
      error: status >= 500 ? 'Erro interno do servidor' : err.message,
      correlationId: correlationId as string,
    };

    // Stack trace APENAS em desenvolvimento (verificação estrita)
    if (showStackTrace) {
      response.message = err.message;
      response.stack = err.stack;
    }

    // Garantir que não enviamos resposta dupla
    if (!res.headersSent) {
      res.status(status).json(response);
    }
  };
}

/**
 * Middleware 404 Not Found (Express.js 2025)
 * Deve ser adicionado ANTES do error handler
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
 * Ordem correta de middlewares (Express.js 2025)
 */
export interface HardeningConfig {
  serviceName: string;
  trustProxy?: number | boolean;
  enableCompression?: boolean;
  enableCSP?: boolean;
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
  skipRateLimitRoutes?: string[];
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
    logger,
  } = config;

  // 1. Desabilitar X-Powered-By
  app.disable('x-powered-by');

  // 2. Trust proxy (Traefik)
  app.set('trust proxy', trustProxy);

  // 3. Helmet (segurança HTTP headers)
  app.use(createSecurityMiddleware({
    contentSecurityPolicy: enableCSP,
    isDevelopment: process.env.NODE_ENV !== 'production',
  }));

  // 4. Compression (performance)
  if (enableCompression) {
    app.use(compression());
  }

  // 5. Rate limiting (após compression, antes de rotas)
  app.use(createRateLimiter({
    max: rateLimitMax,
    windowMs: rateLimitWindowMs,
    skipRoutes: skipRateLimitRoutes,
    serviceName,
  }));

  // Nota: Error handler deve ser adicionado APÓS todas as rotas
  // Usar: app.use(createNotFoundHandler({ serviceName }));
  // Usar: app.use(createErrorHandler({ serviceName, logger }));
}

/**
 * Schemas Zod comuns para validação de rotas
 */
export const CommonSchemas = {
  // UUID validation
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  
  // Email validation (RFC 5322 simplificado)
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  
  // Pagination defaults
  paginationDefaults: {
    page: 1,
    limit: 50,
    maxLimit: 100,
  },
};
