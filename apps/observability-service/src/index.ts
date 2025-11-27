/**
 * Observability Health Checker - Alice Enterprise Platform
 * 
 * Serviço de health check para o stack de observabilidade.
 * Monitora Prometheus, Grafana, Jaeger e Langfuse.
 * Expõe endpoint unificado para status do stack.
 * 
 * Porta: 3007
 * 
 * Documentação PT-BR (Regra 10 replit.md)
 * TypeScript strict (Regra 8 replit.md)
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
}).child({ service: 'observability-health' });

const PORT = process.env.PORT || 3007;

// URLs internas (dentro do docker network)
const PROMETHEUS_URL = process.env.PROMETHEUS_URL || 'http://prometheus:9090';
const GRAFANA_URL = process.env.GRAFANA_URL || 'http://grafana:3000';
const JAEGER_URL = process.env.JAEGER_URL || 'http://jaeger:16686';
const LANGFUSE_URL = process.env.LANGFUSE_URL || 'http://langfuse:3000';

// URLs externas (para API /urls)
const PROMETHEUS_EXTERNAL = process.env.PROMETHEUS_EXTERNAL_URL || 'https://prometheus.yesyoudeserve.duckdns.org';
const GRAFANA_EXTERNAL = process.env.GRAFANA_EXTERNAL_URL || 'https://observability.yesyoudeserve.duckdns.org';
const JAEGER_EXTERNAL = process.env.JAEGER_EXTERNAL_URL || 'https://tracing.yesyoudeserve.duckdns.org';
const LANGFUSE_EXTERNAL = process.env.LANGFUSE_EXTERNAL_URL || 'https://llm-metrics.yesyoudeserve.duckdns.org';

interface ServiceStatus {
  name: string;
  url: string;
  status: 'healthy' | 'unhealthy' | 'unknown';
  latencyMs: number;
  lastCheck: string;
  error?: string;
}

interface StackHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  services: ServiceStatus[];
  uptimeSeconds: number;
}

const startTime = Date.now();

// Verificar saúde de um serviço via HTTP
async function checkServiceHealth(
  name: string, 
  baseUrl: string, 
  healthPath: string
): Promise<ServiceStatus> {
  const url = `${baseUrl}${healthPath}`;
  const startMs = Date.now();
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
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
      logger.warn({ service: name, statusCode: response.status }, 'Serviço com erro');
      return {
        name,
        url: baseUrl,
        status: 'unhealthy',
        latencyMs,
        lastCheck: new Date().toISOString(),
        error: `HTTP ${response.status}`,
      };
    }
  } catch (error) {
    const latencyMs = Date.now() - startMs;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    
    logger.error({ service: name, error: errorMessage }, 'Falha ao verificar serviço');
    
    return {
      name,
      url: baseUrl,
      status: 'unhealthy',
      latencyMs,
      lastCheck: new Date().toISOString(),
      error: errorMessage,
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

app.use(cors());
app.use(express.json());

// ============================================================================
// ENDPOINTS
// ============================================================================

// Health check simples (para docker healthcheck)
app.get('/health', (_req: Request, res: Response) => {
  res.json({ 
    status: 'ok', 
    service: 'observability-health',
    timestamp: new Date().toISOString(),
  });
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
      const value = service.status === 'healthy' ? 1 : 0;
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
    
    res.set('Content-Type', 'text/plain');
    res.send(metrics);
  } catch (error) {
    res.status(500).send('# Error generating metrics\n');
  }
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
// STARTUP
// ============================================================================

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Observability Health Checker iniciado');
  logger.info({ 
    prometheus: PROMETHEUS_URL,
    grafana: GRAFANA_URL,
    jaeger: JAEGER_URL,
    langfuse: LANGFUSE_URL,
  }, 'Monitorando serviços de observabilidade');
});
