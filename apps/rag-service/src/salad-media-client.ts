import { createCircuitBreaker, CIRCUIT_BREAKER_PRESETS, instrumentCircuitBreaker } from '@alice/shared-utils';
import type { AliceMetrics } from '@alice/shared-utils';
import { Logger } from 'pino';

const SALAD_API_URL = process.env.SALAD_API_URL || 'https://api.salad.com/api/public';
const SALAD_API_KEY = process.env.SALAD_API_KEY || '';
const SALAD_ORGANIZATION_ID = process.env.SALAD_ORGANIZATION_ID || '';
const SALAD_MEDIA_PROJECT = process.env.SALAD_MEDIA_PROJECT || process.env.SALAD_PROJECT_NAME || 'alice-media';

export interface SaladContainerConfig {
  name: string;
  image: string;
  cpu: number;
  memory: number;
  gpuClasses: string[];
  environmentVariables: Record<string, string>;
  replicas?: number;
}

export interface SaladJobResult {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'stopped' | 'succeeded' | 'failed' | 'deploying';
  startTime?: string;
  finishTime?: string;
  description?: string;
}

function headers() {
  return {
    'Content-Type': 'application/json',
    'Salad-Api-Key': SALAD_API_KEY,
  };
}

export function createSaladMediaClient(logger: Logger, metrics: AliceMetrics) {
  const createGroup = async (config: SaladContainerConfig) => {
    const url = `${SALAD_API_URL}/organizations/${SALAD_ORGANIZATION_ID}/projects/${SALAD_MEDIA_PROJECT}/containers`;
    const body = {
      name: config.name,
      display_name: config.name,
      container: {
        image: config.image,
        resources: {
          cpu: config.cpu,
          memory: config.memory,
          gpu_classes: config.gpuClasses,
        },
        environment_variables: config.environmentVariables,
      },
      replicas: config.replicas ?? 1,
      autostart: true,
      restart_policy: 'on_failure',
    };

    const response = await fetch(url, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Falha ao criar job Salad: ${response.status} - ${text}`);
    }
    return response.json() as Promise<{ id: string; name: string; currentState: { status: string } }>;
  };

  const getStatus = async (name: string) => {
    const url = `${SALAD_API_URL}/organizations/${SALAD_ORGANIZATION_ID}/projects/${SALAD_MEDIA_PROJECT}/containers/${name}`;
    const response = await fetch(url, { method: 'GET', headers: headers() });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Falha ao obter status Salad: ${response.status} - ${text}`);
    }
    return response.json() as Promise<SaladJobResult>;
  };

  const breakerCreate = createCircuitBreaker(createGroup, { name: 'salad-media-create', ...CIRCUIT_BREAKER_PRESETS.saladDeployment });
  const breakerStatus = createCircuitBreaker(getStatus, { name: 'salad-media-status', ...CIRCUIT_BREAKER_PRESETS.saladDeployment });
  
  // Instrumentar circuit breakers com métricas Prometheus (OBRIGATÓRIO - Regra 16 CLAUDE.md)
  // Observabilidade é enterprise-grade e não opcional na plataforma Alice
  instrumentCircuitBreaker(metrics, 'salad-media-create', breakerCreate as unknown);
  instrumentCircuitBreaker(metrics, 'salad-media-status', breakerStatus as unknown);

  async function createAndWait(config: SaladContainerConfig, pollMs = 5000, maxWaitMs = 15 * 60 * 1000): Promise<SaladJobResult> {
    const created = await breakerCreate.fire(config);
    const start = Date.now();
    let last: SaladJobResult = { id: created.id, name: created.name, status: 'pending' };

    while (Date.now() - start < maxWaitMs) {
      await new Promise((r) => setTimeout(r, pollMs));
      try {
        last = await breakerStatus.fire(config.name);
        if (['succeeded', 'failed', 'stopped'].includes(last.status)) {
          return last;
        }
      } catch (error) {
        logger.warn({ error }, 'Falha ao consultar status Salad');
      }
    }

    return { ...last, status: 'failed', description: 'Timeout ao aguardar job Salad' };
  }

  return {
    createAndWait,
  };
}
