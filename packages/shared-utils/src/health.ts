/**
 * Sistema de Health Checks - Alice Enterprise Platform
 * 
 * Padroniza health checks para todos os serviços.
 * Documentação em PT-BR (Regra 10 CLAUDE.md).
 * 
 * @module @alice/shared-utils/health
 */

import { Request, Response } from 'express';
import { getCircuitBreakerStats, CircuitBreakerStats } from './circuit-breaker.js';
import CircuitBreaker from 'opossum';

/**
 * Status de saúde de uma dependência
 */
export type DependencyStatus = 'healthy' | 'degraded' | 'unhealthy';

/**
 * Informação de saúde de uma dependência
 */
export interface DependencyHealth {
  name: string;
  status: DependencyStatus;
  responseTimeMs?: number;
  message?: string;
  circuitBreaker?: CircuitBreakerStats;
}

/**
 * Resposta do health check
 */
export interface HealthCheckResponse {
  status: 'ok' | 'degraded' | 'unhealthy';
  service: string;
  version: string;
  timestamp: string;
  uptime: number;
  dependencies: DependencyHealth[];
}

/**
 * Função para verificar saúde de uma dependência
 */
export type DependencyChecker = () => Promise<DependencyHealth>;

/**
 * Configuração do health check
 */
export interface HealthCheckConfig {
  service: string;
  version?: string;
  dependencyCheckers?: Map<string, DependencyChecker>;
  circuitBreakers?: Map<string, CircuitBreaker>;
}

/**
 * Cria um handler de health check padronizado
 * 
 * @param config - Configuração do health check
 * @returns Handler Express para o endpoint de health
 * 
 * @example
 * ```typescript
 * import { createHealthHandler } from '@alice/shared-utils/health';
 * 
 * const healthHandler = createHealthHandler({
 *   service: 'chat-service',
 *   version: '1.0.0',
 *   circuitBreakers: new Map([
 *     ['salad-llm', saladBreaker],
 *     ['rag-service', ragBreaker],
 *   ]),
 * });
 * 
 * app.get('/api/chat/health', healthHandler);
 * ```
 */
export function createHealthHandler(config: HealthCheckConfig) {
  const startTime = Date.now();

  return async (_req: Request, res: Response): Promise<void> => {
    const dependencies: DependencyHealth[] = [];
    let overallStatus: 'ok' | 'degraded' | 'unhealthy' = 'ok';

    if (config.circuitBreakers) {
      for (const [name, breaker] of config.circuitBreakers) {
        const stats = getCircuitBreakerStats(breaker);
        let status: DependencyStatus = 'healthy';

        if (stats.state === 'open') {
          status = 'unhealthy';
          overallStatus = 'unhealthy';
        } else if (stats.state === 'half-open') {
          status = 'degraded';
          if (overallStatus === 'ok') overallStatus = 'degraded';
        }

        dependencies.push({
          name,
          status,
          circuitBreaker: stats,
        });
      }
    }

    if (config.dependencyCheckers) {
      for (const [name, checker] of config.dependencyCheckers) {
        try {
          const startCheck = performance.now();
          const health = await checker();
          health.responseTimeMs = Math.round(performance.now() - startCheck);
          dependencies.push(health);

          if (health.status === 'unhealthy') {
            overallStatus = 'unhealthy';
          } else if (health.status === 'degraded' && overallStatus === 'ok') {
            overallStatus = 'degraded';
          }
        } catch (error) {
          dependencies.push({
            name,
            status: 'unhealthy',
            message: error instanceof Error ? error.message : 'Erro desconhecido',
          });
          overallStatus = 'unhealthy';
        }
      }
    }

    const response: HealthCheckResponse = {
      status: overallStatus,
      service: config.service,
      version: config.version || '1.0.0',
      timestamp: new Date().toISOString(),
      uptime: Math.round((Date.now() - startTime) / 1000),
      dependencies,
    };

    const statusCode = overallStatus === 'ok' ? 200 : overallStatus === 'degraded' ? 200 : 503;
    res.status(statusCode).json(response);
  };
}

/**
 * Cria um verificador de saúde para banco de dados PostgreSQL
 * 
 * @param checkFn - Função que executa uma query simples no banco
 * @returns DependencyChecker
 */
export function createDatabaseChecker(
  checkFn: () => Promise<unknown>
): DependencyChecker {
  return async (): Promise<DependencyHealth> => {
    try {
      const start = performance.now();
      await checkFn();
      return {
        name: 'database',
        status: 'healthy',
        responseTimeMs: Math.round(performance.now() - start),
      };
    } catch (error) {
      return {
        name: 'database',
        status: 'unhealthy',
        message: error instanceof Error ? error.message : 'Conexão falhou',
      };
    }
  };
}

/**
 * Cria um verificador de saúde para serviço HTTP externo
 * 
 * @param name - Nome do serviço
 * @param url - URL do endpoint de health do serviço
 * @param timeout - Timeout em ms (padrão: 5000)
 * @returns DependencyChecker
 */
export function createHttpChecker(
  name: string,
  url: string,
  timeout = 5000
): DependencyChecker {
  return async (): Promise<DependencyHealth> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const start = performance.now();
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        return {
          name,
          status: 'healthy',
          responseTimeMs: Math.round(performance.now() - start),
        };
      } else {
        return {
          name,
          status: 'degraded',
          responseTimeMs: Math.round(performance.now() - start),
          message: `Status ${response.status}`,
        };
      }
    } catch (error) {
      clearTimeout(timeoutId);
      return {
        name,
        status: 'unhealthy',
        message: error instanceof Error ? error.message : 'Conexão falhou',
      };
    }
  };
}

/**
 * Middleware para adicionar headers de saúde em todas as respostas
 * 
 * @param serviceName - Nome do serviço
 * @returns Middleware Express
 */
export function healthHeadersMiddleware(serviceName: string) {
  return (_req: Request, res: Response, next: () => void): void => {
    res.setHeader('X-Service-Name', serviceName);
    res.setHeader('X-Response-Time-Start', Date.now().toString());
    
    res.on('finish', () => {
      const start = parseInt(res.getHeader('X-Response-Time-Start') as string || '0');
      if (start) {
        res.setHeader('X-Response-Time', `${Date.now() - start}ms`);
      }
    });

    next();
  };
}
