/**
 * Observability Health Checker - Alice Enterprise Platform
 * 
 * Serviço de health check para o stack de observabilidade.
 * Monitora Prometheus, Grafana, Jaeger e Langfuse.
 * Expõe endpoint unificado para status do stack.
 * 
 * Porta: 3007
 * 
 * Documentação PT-BR (Regra 10 CLAUDE.md)
 * TypeScript strict (Regra 8 CLAUDE.md)
 */

import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import compression from 'compression';
import cors from 'cors';
import CircuitBreaker from 'opossum';
import {
  createSecurityMiddleware,
  createRateLimiter,
  createErrorHandler,
  createNotFoundHandler,
  registerShutdownCallback,
  ShutdownPriority,
  setupSwaggerUI,
  OBSERVABILITY_SERVICE_TAGS,
} from '@alice/shared-utils';
import { createLogger } from '@alice/logger';
import { observabilityServicePaths, observabilityServiceSchemas } from './openapi-specs.js';
import { backupRouter } from './backup-orchestrator.js';

// CORREÇÃO AUDITORIA 17/12/2025: Usar createLogger padronizado (Regra 2 - Não Duplicar)
const logger = createLogger('observability-health');
const isProduction = process.env.NODE_ENV === 'production';

// Token de autenticação para endpoints internos (Regra 16 - Segurança)
// CORREÇÃO 23/12/2025: Nome correto é INTERNAL_API_SECRET (conforme secrets do repositório)
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;

if (!INTERNAL_API_SECRET && isProduction) {
  logger.error('CRITICAL: INTERNAL_API_SECRET é OBRIGATÓRIO em produção. Abortando.');
  process.exit(1);
}

// Middleware de autenticação para endpoints internos
function requireInternalAuth(req: Request, res: Response, next: NextFunction): void {
  // Health check básico não requer auth (para docker healthcheck)
  if (req.path === '/health') {
    return next();
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.replace('Bearer ', '');

  // Em desenvolvimento sem token configurado, permitir acesso
  if (!INTERNAL_API_SECRET && !isProduction) {
    return next();
  }

  if (!token || token !== INTERNAL_API_SECRET) {
    logger.warn({ path: req.path, ip: req.ip }, 'Tentativa de acesso não autorizado');
    res.status(401).json({ error: 'Token de autenticação inválido ou ausente' });
    return;
  }

  next();
}

const PORT = process.env.PORT || 3007;

// URLs internas (dentro do docker network)
const PROMETHEUS_URL = process.env.PROMETHEUS_URL || 'http://prometheus:9090';
const GRAFANA_URL = process.env.GRAFANA_URL || 'http://grafana:3000';
const JAEGER_URL = process.env.JAEGER_URL || 'http://jaeger:16686';
const LANGFUSE_URL = process.env.LANGFUSE_URL || 'http://langfuse:3000';

// URLs externas (para API /urls) - DEVEM corresponder às rotas do Traefik em docker-compose.prod.yml
const PROMETHEUS_EXTERNAL = process.env.PROMETHEUS_EXTERNAL_URL || 'https://metrics.yesyoudeserve.duckdns.org';
const GRAFANA_EXTERNAL = process.env.GRAFANA_EXTERNAL_URL || 'https://observability.yesyoudeserve.duckdns.org';
const JAEGER_EXTERNAL = process.env.JAEGER_EXTERNAL_URL || 'https://traces.yesyoudeserve.duckdns.org';
const LANGFUSE_EXTERNAL = process.env.LANGFUSE_EXTERNAL_URL || 'https://langfuse.yesyoudeserve.duckdns.org';

interface ServiceStatus {
  name: string;
  url: string;
  status: 'healthy' | 'unhealthy' | 'unknown';
  latencyMs: number;
  lastCheck: string;
  error?: string;
  circuitBreakerState?: 'closed' | 'open' | 'half-open';
}

interface StackHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  services: ServiceStatus[];
  uptimeSeconds: number;
}

const startTime = Date.now();

// ============================================================================
// CIRCUIT BREAKER PARA HEALTH CHECKS EXTERNOS (Regra 16 - Best Practices 2025)
// Protege contra falhas em cascata quando serviços externos estão indisponíveis
// ============================================================================

// Configuração do circuit breaker (Opossum 2025 Best Practices)
const circuitBreakerOptions: CircuitBreaker.Options = {
  timeout: 5000,           // 5s timeout por requisição
  errorThresholdPercentage: 50,  // Abre após 50% de falhas
  resetTimeout: 30000,     // 30s no estado "open" antes de tentar half-open
  volumeThreshold: 5,      // Mínimo 5 requisições antes de calcular porcentagem
  rollingCountTimeout: 10000,  // Janela de 10s para contagem de falhas
};

// Cache de circuit breakers por serviço
const circuitBreakers = new Map<string, CircuitBreaker<[string, string, string], ServiceStatus>>();

/**
 * Função interna de verificação de saúde (sem circuit breaker)
 * Usada como ação do circuit breaker
 */
async function checkServiceHealthInternal(
  name: string, 
  baseUrl: string, 
  healthPath: string
): Promise<ServiceStatus> {
  const url = `${baseUrl}${healthPath}`;
  const startMs = Date.now();
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  
  try {
    const response = await fetch(url, { 
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });
    
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startMs;
    
    if (response.ok) {
      logger.debug({ service: name, latencyMs }, 'Serviço saudável');
      return {
        name,
        url: baseUrl,
        status: 'healthy',
        latencyMs,
        lastCheck: new Date().toISOString(),
      };
    } else {
      // Resposta não-OK é considerada falha para o circuit breaker
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startMs;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    
    logger.error({ service: name, error: errorMessage }, 'Falha ao verificar serviço');
    
    // Re-throw para que o circuit breaker registre a falha
    throw Object.assign(new Error(errorMessage), { 
      serviceStatus: {
        name,
        url: baseUrl,
        status: 'unhealthy' as const,
        latencyMs,
        lastCheck: new Date().toISOString(),
        error: errorMessage,
      }
    });
  }
}

/**
 * Obter ou criar circuit breaker para um serviço
 */
function getOrCreateBreaker(name: string): CircuitBreaker<[string, string, string], ServiceStatus> {
  const existing = circuitBreakers.get(name);
  if (existing) return existing;
  
  const breaker = new CircuitBreaker(checkServiceHealthInternal, {
    ...circuitBreakerOptions,
    name: `health-check-${name}`,
  });
  
  // Event listeners para observabilidade (Regra 16)
  breaker.on('open', () => {
    logger.warn({ service: name }, 'Circuit breaker ABERTO - serviço temporariamente ignorado');
  });
  
  breaker.on('halfOpen', () => {
    logger.info({ service: name }, 'Circuit breaker HALF-OPEN - testando serviço');
  });
  
  breaker.on('close', () => {
    logger.info({ service: name }, 'Circuit breaker FECHADO - serviço recuperado');
  });
  
  breaker.on('fallback', () => {
    logger.debug({ service: name }, 'Circuit breaker fallback acionado');
  });
  
  circuitBreakers.set(name, breaker);
  return breaker;
}

/**
 * Obter estado do circuit breaker para um serviço
 */
function getBreakerState(name: string): 'closed' | 'open' | 'half-open' {
  const breaker = circuitBreakers.get(name);
  if (!breaker) return 'closed';
  
  if (breaker.opened) return 'open';
  if (breaker.halfOpen) return 'half-open';
  return 'closed';
}

// Verificar saúde de um serviço via HTTP com circuit breaker
async function checkServiceHealth(
  name: string, 
  baseUrl: string, 
  healthPath: string
): Promise<ServiceStatus> {
  const breaker = getOrCreateBreaker(name);
  const startMs = Date.now();
  
  try {
    // Executar health check através do circuit breaker
    const result = await breaker.fire(name, baseUrl, healthPath);
    return {
      ...result,
      circuitBreakerState: getBreakerState(name),
    };
  } catch (error: unknown) {
    const latencyMs = Date.now() - startMs;
    
    // Verificar se é um erro com serviceStatus (nossa falha de health check)
    if (error && typeof error === 'object' && 'serviceStatus' in error) {
      const typedError = error as { serviceStatus: ServiceStatus };
      return {
        ...typedError.serviceStatus,
        circuitBreakerState: getBreakerState(name),
      };
    }
    
    // Circuit breaker aberto - retornar status "unknown"
    if (error instanceof Error && error.message.includes('Breaker is open')) {
      logger.debug({ service: name }, 'Health check ignorado - circuit breaker aberto');
      return {
        name,
        url: baseUrl,
        status: 'unknown',
        latencyMs,
        lastCheck: new Date().toISOString(),
        error: 'Circuit breaker aberto - serviço temporariamente ignorado',
        circuitBreakerState: 'open',
      };
    }
    
    // Outro erro
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    return {
      name,
      url: baseUrl,
      status: 'unhealthy',
      latencyMs,
      lastCheck: new Date().toISOString(),
      error: errorMessage,
      circuitBreakerState: getBreakerState(name),
    };
  }
}

// Verificar saúde de todos os serviços
async function checkAllServices(): Promise<StackHealth> {
  const checks = await Promise.all([
    checkServiceHealth('Prometheus', PROMETHEUS_URL, '/-/healthy'),
    checkServiceHealth('Grafana', GRAFANA_URL, '/api/health'),
    checkServiceHealth('Jaeger', JAEGER_URL, '/'),
    checkServiceHealth('Langfuse', LANGFUSE_URL, '/api/public/health'),
  ]);

  const healthyCount = checks.filter(s => s.status === 'healthy').length;
  const totalCount = checks.length;

  let overallStatus: 'healthy' | 'degraded' | 'unhealthy';
  if (healthyCount === totalCount) {
    overallStatus = 'healthy';
  } else if (healthyCount > 0) {
    overallStatus = 'degraded';
  } else {
    overallStatus = 'unhealthy';
  }

  return {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    services: checks,
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
  };
}

const app = express();

// ============================================================================
// OPENAPI/SWAGGER: Documentação da API (OWASP API9)
// ============================================================================
setupSwaggerUI(app, {
  serviceName: 'observability-service',
  version: '1.0.0',
  description: 'Serviço de observabilidade: backup, restore, métricas agregadas.',
  port: Number(PORT),
  tags: OBSERVABILITY_SERVICE_TAGS,
  paths: observabilityServicePaths,
  schemas: observabilityServiceSchemas,
});
logger.info('Swagger UI configurado em /api/docs');

// SEGURANÇA: Desabilitar X-Powered-By header (Express.js 2025 + OWASP API8)
app.disable('x-powered-by');

// SEGURANÇA: Trust proxy = 1 para confiar apenas no primeiro proxy (Traefik)
// Evita bypass de rate limiting (express-rate-limit 2025 best practice)
app.set('trust proxy', 1);

// PERFORMANCE: Compression para respostas HTTP (Express.js 2025 Best Practices)
app.use(compression({ level: 6, threshold: 1024 }));

// SEGURANÇA: Helmet centralizado com CSP (módulo @alice/shared-utils)
app.use(createSecurityMiddleware({
  contentSecurityPolicy: isProduction,
  isDevelopment: !isProduction,
}));

// CORS configurado
const corsOriginsEnv = process.env.CORS_ORIGINS;
if (!corsOriginsEnv && isProduction) {
  logger.error('CORS_ORIGINS é obrigatório em produção (Regra 6 - fail-fast)');
  process.exit(1);
}
app.use(cors({
  origin: corsOriginsEnv
    ? corsOriginsEnv.split(',').map((origin) => origin.trim()).filter(Boolean)
    : [],
  credentials: true,
}));

// SEGURANÇA: Limites de payload para prevenir DoS (OWASP API4)
app.use(express.json({ limit: '1mb' }));

// Rate limiting multi-tenant (módulo @alice/shared-utils)
app.use(createRateLimiter({
  windowMs: 60 * 1000,
  max: 100,
  serviceName: 'observability-service',
  skipRoutes: ['/health', '/metrics'],
}));

// Aplicar autenticação em todos os endpoints exceto /health
app.use(requireInternalAuth);

// ============================================================================
// ENDPOINTS
// ============================================================================

// Health check simples (para docker healthcheck) - SEM autenticação
app.get('/health', (_req: Request, res: Response) => {
  res.json({ 
    status: 'ok', 
    service: 'observability-health',
    timestamp: new Date().toISOString(),
  });
});

// ============================================================================
// KUBERNETES PROBES: /ready e /live (Regra 16 - Best Practices 2025)
// /live: Processo está vivo? Se não, Kubernetes reinicia o container
// /ready: Pronto para tráfego? Verifica se pelo menos um serviço de observability responde
// ============================================================================

// Liveness probe - verificação simples que o processo responde
app.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({ 
    status: 'alive', 
    service: 'observability-service',
    timestamp: new Date().toISOString(),
  });
});

// Readiness probe - verifica se pelo menos um serviço de observability está acessível
app.get('/ready', async (_req: Request, res: Response) => {
  try {
    const health = await checkAllServices();
    const atLeastOneHealthy = health.services.some(s => s.status === 'healthy');
    
    if (atLeastOneHealthy) {
      res.status(200).json({
        status: 'ready',
        service: 'observability-service',
        timestamp: new Date().toISOString(),
        dependencies: Object.fromEntries(
          health.services.map(s => [s.name.toLowerCase(), s.status === 'healthy' ? 'ready' : 'not_ready'])
        ),
      });
    } else {
      res.status(503).json({
        status: 'not_ready',
        service: 'observability-service',
        reason: 'Nenhum serviço de observability disponível',
        timestamp: new Date().toISOString(),
        dependencies: Object.fromEntries(
          health.services.map(s => [s.name.toLowerCase(), s.status === 'healthy' ? 'ready' : 'not_ready'])
        ),
      });
    }
  } catch (error) {
    logger.error({ error }, 'Erro ao verificar readiness');
    res.status(503).json({
      status: 'not_ready',
      service: 'observability-service',
      reason: 'Erro ao verificar dependências',
      timestamp: new Date().toISOString(),
    });
  }
});

// Health check completo do stack
app.get('/api/observability/health', async (_req: Request, res: Response) => {
  try {
    const health = await checkAllServices();
    
    const statusCode = health.status === 'healthy' ? 200 : 
                       health.status === 'degraded' ? 207 : 503;
    
    res.status(statusCode).json(health);
  } catch (error) {
    logger.error({ error }, 'Erro ao verificar saúde do stack');
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Erro interno',
    });
  }
});

// Status individual de cada serviço
app.get('/api/observability/services/:name', async (req: Request, res: Response) => {
  const { name } = req.params;
  
  const serviceConfig: Record<string, { url: string; healthPath: string }> = {
    prometheus: { url: PROMETHEUS_URL, healthPath: '/-/healthy' },
    grafana: { url: GRAFANA_URL, healthPath: '/api/health' },
    jaeger: { url: JAEGER_URL, healthPath: '/' },
    langfuse: { url: LANGFUSE_URL, healthPath: '/api/public/health' },
  };

  const config = serviceConfig[name.toLowerCase()];
  if (!config) {
    res.status(404).json({ 
      error: 'Serviço não encontrado',
      available: Object.keys(serviceConfig),
    });
    return;
  }

  const status = await checkServiceHealth(name, config.url, config.healthPath);
  res.json(status);
});

// Métricas do health checker (formato Prometheus)
app.get('/metrics', async (_req: Request, res: Response) => {
  try {
    const health = await checkAllServices();
    
    let metrics = '# HELP observability_service_up Whether the observability service is up\n';
    metrics += '# TYPE observability_service_up gauge\n';
    
    for (const service of health.services) {
      const value = service.status === 'healthy' ? 1 : service.status === 'unknown' ? 0.5 : 0;
      metrics += `observability_service_up{service="${service.name.toLowerCase()}"} ${value}\n`;
    }
    
    metrics += '\n# HELP observability_service_latency_ms Latency to check service health in milliseconds\n';
    metrics += '# TYPE observability_service_latency_ms gauge\n';
    
    for (const service of health.services) {
      metrics += `observability_service_latency_ms{service="${service.name.toLowerCase()}"} ${service.latencyMs}\n`;
    }
    
    metrics += '\n# HELP observability_stack_status Overall observability stack status (1=healthy, 0.5=degraded, 0=unhealthy)\n';
    metrics += '# TYPE observability_stack_status gauge\n';
    const statusValue = health.status === 'healthy' ? 1 : health.status === 'degraded' ? 0.5 : 0;
    metrics += `observability_stack_status ${statusValue}\n`;
    
    metrics += '\n# HELP observability_uptime_seconds Uptime of health checker in seconds\n';
    metrics += '# TYPE observability_uptime_seconds counter\n';
    metrics += `observability_uptime_seconds ${health.uptimeSeconds}\n`;
    
    // Circuit breaker metrics (Regra 16 - Enterprise Observability)
    metrics += '\n# HELP observability_circuit_breaker_state Circuit breaker state (0=closed, 0.5=half-open, 1=open)\n';
    metrics += '# TYPE observability_circuit_breaker_state gauge\n';
    
    for (const service of health.services) {
      const stateValue = service.circuitBreakerState === 'open' ? 1 : 
                         service.circuitBreakerState === 'half-open' ? 0.5 : 0;
      metrics += `observability_circuit_breaker_state{service="${service.name.toLowerCase()}"} ${stateValue}\n`;
    }
    
    // Circuit breaker stats
    metrics += '\n# HELP observability_circuit_breaker_fires_total Total circuit breaker fire attempts\n';
    metrics += '# TYPE observability_circuit_breaker_fires_total counter\n';
    
    for (const [name, breaker] of circuitBreakers.entries()) {
      metrics += `observability_circuit_breaker_fires_total{service="${name.toLowerCase()}"} ${breaker.stats.fires}\n`;
    }
    
    metrics += '\n# HELP observability_circuit_breaker_failures_total Total circuit breaker failures\n';
    metrics += '# TYPE observability_circuit_breaker_failures_total counter\n';
    
    for (const [name, breaker] of circuitBreakers.entries()) {
      metrics += `observability_circuit_breaker_failures_total{service="${name.toLowerCase()}"} ${breaker.stats.failures}\n`;
    }
    
    res.set('Content-Type', 'text/plain');
    res.send(metrics);
  } catch {
    res.status(500).send('# Error generating metrics\n');
  }
});

// ============================================================================
// LOGS DO FRONTEND (Regra 8 - Logging estruturado)
// Recebe logs do frontend via beacon/fetch
// ============================================================================

interface FrontendLogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  context?: Record<string, unknown>;
  timestamp: string;
  service: string;
}

const frontendLogSchema = {
  validate(body: unknown): body is FrontendLogEntry {
    if (!body || typeof body !== 'object') return false;
    const log = body as Record<string, unknown>;
    return (
      typeof log.level === 'string' &&
      ['debug', 'info', 'warn', 'error'].includes(log.level) &&
      typeof log.message === 'string' &&
      typeof log.timestamp === 'string' &&
      typeof log.service === 'string'
    );
  }
};

app.post('/api/observability/logs', (req: Request, res: Response) => {
  try {
    const body = req.body;
    
    if (!frontendLogSchema.validate(body)) {
      res.status(400).json({ error: 'Formato de log inválido' });
      return;
    }

    const logMethod = body.level === 'error' ? 'error' :
                      body.level === 'warn' ? 'warn' :
                      body.level === 'info' ? 'info' : 'debug';

    logger[logMethod]({
      frontendLog: true,
      originalTimestamp: body.timestamp,
      frontendService: body.service,
      ...body.context,
    }, `[FRONTEND] ${body.message}`);

    res.status(202).json({ received: true });
  } catch (error) {
    logger.error({ error }, 'Erro ao processar log do frontend');
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Status dos circuit breakers (Regra 16 - Observability)
app.get('/api/observability/circuit-breakers', (_req: Request, res: Response) => {
  const statuses = Array.from(circuitBreakers.entries()).map(([name, breaker]) => ({
    name,
    state: breaker.opened ? 'open' : breaker.halfOpen ? 'half-open' : 'closed',
    stats: {
      fires: breaker.stats.fires,
      failures: breaker.stats.failures,
      successes: breaker.stats.successes,
      timeouts: breaker.stats.timeouts,
      fallbacks: breaker.stats.fallbacks,
      rejects: breaker.stats.rejects,
    },
    // Usar opções globais pois são compartilhadas entre todos os breakers
    config: {
      timeout: circuitBreakerOptions.timeout,
      errorThresholdPercentage: circuitBreakerOptions.errorThresholdPercentage,
      resetTimeout: circuitBreakerOptions.resetTimeout,
    },
  }));
  
  res.json({
    circuitBreakers: statuses,
    timestamp: new Date().toISOString(),
  });
});

// URLs de acesso rápido
app.get('/api/observability/urls', (_req: Request, res: Response) => {
  res.json({
    prometheus: {
      internal: PROMETHEUS_URL,
      external: PROMETHEUS_EXTERNAL,
      description: 'Métricas e alertas',
    },
    grafana: {
      internal: GRAFANA_URL,
      external: GRAFANA_EXTERNAL,
      description: 'Dashboards e visualização',
    },
    jaeger: {
      internal: JAEGER_URL,
      external: JAEGER_EXTERNAL,
      description: 'Distributed tracing',
    },
    langfuse: {
      internal: LANGFUSE_URL,
      external: LANGFUSE_EXTERNAL,
      description: 'Métricas LLM específicas',
    },
  });
});

// ============================================================================
// BACKUP ORCHESTRATOR (Sistema unificado de backup - Regra 6 Enterprise-grade)
// ============================================================================

app.use('/api/backup', requireInternalAuth, backupRouter);

logger.info('Backup Orchestrator registrado em /api/backup');

// ============================================================================
// ERROR HANDLERS (módulo @alice/shared-utils)
// ============================================================================

// Rota 404 para paths não encontrados
app.use(createNotFoundHandler({ serviceName: 'observability-service' }));

// Error handler global
app.use(createErrorHandler({
  serviceName: 'observability-service',
  logger: {
    error: (obj: object, msg: string) => logger.error(obj, msg),
  },
}));

// ============================================================================
// STARTUP
// ============================================================================

const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Observability Health Checker iniciado');
  logger.info({ 
    prometheus: PROMETHEUS_URL,
    grafana: GRAFANA_URL,
    jaeger: JAEGER_URL,
    langfuse: LANGFUSE_URL,
  }, 'Monitorando serviços de observabilidade');
});

// SEGURANÇA: Timeouts para prevenir conexões pendentes (Node.js 20 LTS Best Practices)
server.timeout = 30000; // 30s timeout para requisições
server.keepAliveTimeout = 65000; // 65s (maior que ALB timeout padrão de 60s)
server.headersTimeout = 66000; // Ligeiramente maior que keepAliveTimeout

// ============================================================================
// GRACEFUL SHUTDOWN (Enterprise-Grade - Regra 16 CLAUDE.md)
// ShutdownManager centralizado elimina duplicação de listeners (Regra 6)
// Ordem: Circuit Breakers → HTTP server
// ============================================================================

registerShutdownCallback(
  'observability-circuit-breakers',
  async () => {
    logger.info('Encerrando circuit breakers de health check...');
    circuitBreakers.forEach((breaker, name) => {
      breaker.shutdown();
      logger.info({ service: name }, 'Circuit breaker encerrado');
    });
  },
  { priority: ShutdownPriority.EXTERNAL_CONNECTIONS }
);

registerShutdownCallback(
  'observability-http-server',
  async () => {
    logger.info('Encerrando HTTP server...');
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          logger.error({ error: err }, 'Erro ao fechar HTTP server');
          reject(err);
        } else {
          logger.info('HTTP server encerrado com sucesso');
          resolve();
        }
      });
    });
  },
  { priority: ShutdownPriority.HTTP_SERVER }
);
