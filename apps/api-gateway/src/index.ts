/**
 * Alice Enterprise Platform - API Gateway (Desenvolvimento)
 * 
 * Gateway de desenvolvimento para orquestrar microserviços localmente.
 * Em produção, usar Traefik com a configuração em config/traefik.yml
 * 
 * Funcionalidades:
 * - Rate limiting (Regra 16 - Best Practices 2025)
 * - Health checks agregados
 * - Circuit breaker para resiliência
 * - Proxy reverso para microserviços
 * - Logging centralizado via Pino
 * 
 * Documentação em PT-BR (Regra 10 replit.md)
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { createProxyMiddleware, Options } from 'http-proxy-middleware';
import CircuitBreaker from 'opossum';
import pino from 'pino';
import {
  createSecurityMiddleware,
  createRateLimiter,
  createErrorHandler,
  createNotFoundHandler,
} from '@alice/shared-utils';
import { z } from 'zod';

const logger = pino({
  name: 'api-gateway',
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'development' ? {
    target: 'pino-pretty',
    options: { colorize: true },
  } : undefined,
});

// Schema de configuração do gateway
const gatewayConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  // URLs dos microserviços
  AUTH_SERVICE_URL: z.string().default('http://localhost:3001'),
  CHAT_SERVICE_URL: z.string().default('http://localhost:3002'),
  RAG_SERVICE_URL: z.string().default('http://localhost:3003'),
  TRAINING_SERVICE_URL: z.string().default('http://localhost:3004'),
  INTEGRATIONS_SERVICE_URL: z.string().default('http://localhost:3005'),
  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),
  // CORS
  CORS_ORIGIN: z.string().default('http://localhost:5000'),
});

type GatewayConfig = z.infer<typeof gatewayConfigSchema>;

let config: GatewayConfig;
try {
  config = gatewayConfigSchema.parse(process.env);
} catch (error) {
  logger.warn({ error }, 'Configuração parcial, usando defaults');
  config = gatewayConfigSchema.parse({});
}

const app: express.Application = express();

// SEGURANÇA: Desabilitar X-Powered-By header (Express.js 2025 + OWASP API8)
app.disable('x-powered-by');

// SEGURANÇA: Trust proxy = 1 para confiar apenas no primeiro proxy (Traefik)
// Evita bypass de rate limiting (express-rate-limit 2025 best practice)
app.set('trust proxy', 1);

// SEGURANÇA: Helmet centralizado com CSP (módulo @alice/shared-utils)
app.use(createSecurityMiddleware({
  contentSecurityPolicy: config.NODE_ENV === 'production',
  isDevelopment: config.NODE_ENV === 'development',
}));

// CORS configurado
const corsOrigins = config.CORS_ORIGIN.split(',').map(o => o.trim());
app.use(cors({
  origin: corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'X-Requested-With', 'x-tenant-id', 'x-correlation-id'],
}));

// Rate limiting global com suporte multi-tenant (módulo @alice/shared-utils)
app.use(createRateLimiter({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.RATE_LIMIT_MAX_REQUESTS,
  serviceName: 'api-gateway',
  skipRoutes: ['/health', '/api/health', '/metrics'],
}));

// Rate limiting mais restrito para autenticação
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10, // 10 tentativas
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
  keyGenerator: (req) => req.ip || 'unknown',
});

// SEGURANÇA: Limites de payload para prevenir DoS (OWASP API4)
app.use(express.json({ limit: '10mb' }));

// Definição dos serviços e suas configurações
interface ServiceConfig {
  name: string;
  url: string;
  healthPath: string;
  pathPrefix: string;
}

const services: ServiceConfig[] = [
  { name: 'auth-service', url: config.AUTH_SERVICE_URL, healthPath: '/api/auth/health', pathPrefix: '/api/auth' },
  { name: 'chat-service', url: config.CHAT_SERVICE_URL, healthPath: '/api/chat/health', pathPrefix: '/api/chat' },
  { name: 'rag-service', url: config.RAG_SERVICE_URL, healthPath: '/api/rag/health', pathPrefix: '/api/rag' },
  { name: 'training-service', url: config.TRAINING_SERVICE_URL, healthPath: '/api/training/health', pathPrefix: '/api/training' },
  { name: 'integrations-service', url: config.INTEGRATIONS_SERVICE_URL, healthPath: '/api/integrations/health', pathPrefix: '/api/integrations' },
];

// Circuit Breaker para cada serviço
const circuitBreakers = new Map<string, CircuitBreaker>();

interface HealthCheckFunction {
  (): Promise<{ status: string; service: string }>;
}

services.forEach(service => {
  const healthCheck: HealthCheckFunction = async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    try {
      const response = await fetch(`${service.url}${service.healthPath}`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`Serviço ${service.name} não está saudável`);
      }
      return { status: 'ok', service: service.name };
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  };

  const breaker = new CircuitBreaker(healthCheck, {
    timeout: 10000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    volumeThreshold: 5,
  });

  breaker.on('open', () => {
    logger.warn({ service: service.name }, 'Circuit breaker ABERTO - serviço indisponível');
  });

  breaker.on('halfOpen', () => {
    logger.info({ service: service.name }, 'Circuit breaker HALF-OPEN - testando serviço');
  });

  breaker.on('close', () => {
    logger.info({ service: service.name }, 'Circuit breaker FECHADO - serviço restaurado');
  });

  circuitBreakers.set(service.name, breaker);
});

// Health check agregado
app.get('/api/health', async (_req: Request, res: Response) => {
  const healthResults: Record<string, unknown> = {
    gateway: { status: 'ok', timestamp: new Date().toISOString() },
    services: {},
  };

  const serviceChecks = await Promise.allSettled(
    services.map(async (service) => {
      const breaker = circuitBreakers.get(service.name);
      if (!breaker) {
        return { name: service.name, status: 'unknown' };
      }

      try {
        await breaker.fire();
        return { name: service.name, status: 'ok', circuit: 'closed' };
      } catch {
        return { 
          name: service.name, 
          status: 'error', 
          circuit: breaker.opened ? 'open' : 'closed',
        };
      }
    })
  );

  let allHealthy = true;
  serviceChecks.forEach((result) => {
    if (result.status === 'fulfilled') {
      const serviceResult = result.value as { name: string; status: string; circuit?: string };
      (healthResults.services as Record<string, unknown>)[serviceResult.name] = {
        status: serviceResult.status,
        circuit: serviceResult.circuit || 'unknown',
      };
      if (serviceResult.status !== 'ok') {
        allHealthy = false;
      }
    } else {
      allHealthy = false;
    }
  });

  healthResults.overall = allHealthy ? 'healthy' : 'degraded';
  res.status(allHealthy ? 200 : 503).json(healthResults);
});

// Health check simples (para load balancers)
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'api-gateway', timestamp: new Date().toISOString() });
});

// Métricas básicas (para Prometheus/Grafana)
app.get('/metrics', (_req: Request, res: Response) => {
  const metrics: string[] = [];
  
  circuitBreakers.forEach((breaker, serviceName) => {
    const stats = breaker.stats;
    metrics.push(`# HELP circuit_breaker_${serviceName}_fires Total de requisições`);
    metrics.push(`circuit_breaker_${serviceName}_fires ${stats.fires}`);
    metrics.push(`circuit_breaker_${serviceName}_failures ${stats.failures}`);
    metrics.push(`circuit_breaker_${serviceName}_successes ${stats.successes}`);
    metrics.push(`circuit_breaker_${serviceName}_timeouts ${stats.timeouts}`);
    metrics.push(`circuit_breaker_${serviceName}_state ${breaker.opened ? 1 : 0}`);
  });

  res.type('text/plain').send(metrics.join('\n'));
});

// Middleware de logging para requisições
const requestLogger = (req: Request, _res: Response, next: NextFunction) => {
  const start = Date.now();
  _res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info({
      method: req.method,
      path: req.path,
      status: _res.statusCode,
      duration,
      ip: req.ip,
    }, 'Requisição processada');
  });
  next();
};
app.use(requestLogger);

// Configurar proxy para cada serviço
const createServiceProxy = (service: ServiceConfig): Options => ({
  target: service.url,
  changeOrigin: true,
  pathRewrite: undefined,
  on: {
    proxyReq: (_proxyReq, req) => {
      logger.debug({ 
        service: service.name, 
        path: (req as Request).path,
        method: (req as Request).method,
      }, 'Proxy request');
    },
    error: (err, _req, res) => {
      logger.error({ error: err, service: service.name }, 'Erro no proxy');
      if (res && 'writeHead' in res && typeof res.writeHead === 'function') {
        const response = res as Response;
        if (!response.headersSent) {
          response.status(503).json({ 
            error: 'Serviço temporariamente indisponível',
            service: service.name,
          });
        }
      }
    },
  },
});

// Rate limiter especial para login
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// Configurar proxies para cada serviço
services.forEach(service => {
  const proxyOptions = createServiceProxy(service);
  app.use(service.pathPrefix, createProxyMiddleware(proxyOptions));
  logger.info({ service: service.name, prefix: service.pathPrefix, target: service.url }, 'Proxy configurado');
});

// Rota 404 para paths não encontrados (módulo @alice/shared-utils)
app.use(createNotFoundHandler({ serviceName: 'api-gateway' }));

// Error handler global (módulo @alice/shared-utils)
app.use(createErrorHandler({
  serviceName: 'api-gateway',
  logger: {
    error: (obj: object, msg: string) => logger.error(obj, msg),
  },
}));

// Iniciar servidor
const PORT = config.PORT;

const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info({ port: PORT }, 'API Gateway iniciado');
  logger.info({ services: services.map(s => ({ name: s.name, url: s.url })) }, 'Serviços configurados');
});

// SEGURANÇA: Timeouts para prevenir conexões pendentes (Node.js 20 LTS Best Practices)
server.timeout = 30000; // 30s timeout para requisições
server.keepAliveTimeout = 65000; // 65s (maior que ALB timeout padrão de 60s)
server.headersTimeout = 66000; // Ligeiramente maior que keepAliveTimeout

// Graceful shutdown
const gracefulShutdown = async () => {
  logger.info('Encerrando API Gateway...');
  
  server.close(() => {
    logger.info('Conexões HTTP encerradas');
  });

  circuitBreakers.forEach((breaker, name) => {
    breaker.shutdown();
    logger.info({ service: name }, 'Circuit breaker encerrado');
  });

  setTimeout(() => {
    logger.warn('Forçando encerramento após timeout');
    process.exit(1);
  }, 10000);
};

// Usamos process.once() em vez de process.on() para evitar listeners duplicados
process.once('SIGTERM', gracefulShutdown);
process.once('SIGINT', gracefulShutdown);

export { app, server };
