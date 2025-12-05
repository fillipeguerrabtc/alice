/**
 * FLUX.1 Schnell Deployment - Alice Enterprise Platform
 * 
 * Configuração e deploy do FLUX.1 Schnell como Container Group
 * no Salad Cloud para geração de imagens self-hosted.
 * 
 * Especificações:
 * - Modelo: FLUX.1 Schnell (Apache 2.0, uso comercial)
 * - GPU: RTX 3090/4090 (24GB VRAM)
 * - Velocidade: 1-3 segundos/imagem
 * - Custo: ~$0.20/hora (~$20 por 100k imagens)
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 * 
 * @module chat-service/flux-deployment
 */

import { createCircuitBreaker, CIRCUIT_BREAKER_PRESETS } from '@alice/shared-utils';
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
}).child({ module: 'flux-deployment' });

const SALAD_API_URL = process.env.SALAD_API_URL || 'https://api.salad.com/api/public';
const SALAD_API_KEY = process.env.SALAD_API_KEY || '';
const SALAD_ORGANIZATION_ID = process.env.SALAD_ORGANIZATION_ID || '';
const SALAD_PROJECT_NAME = process.env.SALAD_PROJECT_NAME || 'alice-image-gen';

// ============================================================================
// TYPES
// ============================================================================

export interface FluxContainerConfig {
  name: string;
  displayName: string;
  replicas: number;
  gpuClass: 'rtx4090' | 'rtx4080' | 'rtx3090' | 'a100';
  minReplicas?: number;
  maxReplicas?: number;
  autoScaling?: boolean;
}

export interface ContainerGroupStatus {
  id: string;
  name: string;
  displayName: string;
  status: 'pending' | 'deploying' | 'running' | 'stopped' | 'failed';
  replicas: {
    desired: number;
    running: number;
    pending: number;
  };
  endpoint?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentResult {
  success: boolean;
  containerId?: string;
  containerName?: string;
  endpoint?: string;
  error?: string;
}

// ============================================================================
// CIRCUIT BREAKER
// Usa CIRCUIT_BREAKER_PRESETS centralizado (Regra 2 - Não Duplicar)
// ============================================================================

function getHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Salad-Api-Key': SALAD_API_KEY,
  };
}

// ============================================================================
// CONTAINER GROUP MANAGEMENT
// ============================================================================

async function createContainerGroupInternal(config: FluxContainerConfig): Promise<DeploymentResult> {
  const url = `${SALAD_API_URL}/organizations/${SALAD_ORGANIZATION_ID}/projects/${SALAD_PROJECT_NAME}/containers`;

  const gpuClassMap: Record<string, string[]> = {
    rtx4090: ['rtx4090'],
    rtx4080: ['rtx4080', 'rtx4090'],
    rtx3090: ['rtx3090', 'rtx4080', 'rtx4090'],
    a100: ['a100-40gb', 'a100-80gb'],
  };

  const body = {
    name: config.name,
    display_name: config.displayName,
    container: {
      image: 'ghcr.io/alice-platform/flux-schnell:latest',
      resources: {
        cpu: 4,
        memory: 16384,
        gpu_classes: gpuClassMap[config.gpuClass],
      },
      environment_variables: {
        MODEL_NAME: 'flux-schnell',
        MAX_BATCH_SIZE: '1',
        ENABLE_COMFYUI_API: 'true',
        HEALTH_CHECK_PORT: '8080',
        GENERATION_PORT: '8000',
        SALAD_ORGANIZATION_ID: SALAD_ORGANIZATION_ID,
      },
      ports: [
        { port: 8000, protocol: 'http' },
        { port: 8080, protocol: 'http' },
      ],
      readiness_probe: {
        http_get: {
          path: '/health',
          port: 8080,
        },
        initial_delay_seconds: 30,
        period_seconds: 10,
      },
      liveness_probe: {
        http_get: {
          path: '/health',
          port: 8080,
        },
        initial_delay_seconds: 60,
        period_seconds: 30,
      },
    },
    replicas: config.replicas,
    autostart: true,
    restart_policy: 'on_failure',
    networking: {
      protocol: 'http',
      port: 8000,
      auth: false,
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Falha ao criar Container Group FLUX.1: ${response.status} - ${errorText}`);
  }

  const result = await response.json() as { id: string; name: string; networking?: { dns?: string } };

  return {
    success: true,
    containerId: result.id,
    containerName: result.name,
    endpoint: result.networking?.dns,
  };
}

const createBreaker = createCircuitBreaker(createContainerGroupInternal, {
  name: 'flux-deployment',
  ...CIRCUIT_BREAKER_PRESETS.saladDeployment,
});

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Deploy FLUX.1 Schnell Container Group no Salad Cloud
 */
export async function deployFluxSchnell(
  options?: Partial<FluxContainerConfig>
): Promise<DeploymentResult> {
  const config: FluxContainerConfig = {
    name: options?.name || `alice-flux-${Date.now().toString(36)}`,
    displayName: options?.displayName || 'Alice FLUX.1 Schnell Image Generation',
    replicas: options?.replicas || 1,
    gpuClass: options?.gpuClass || 'rtx3090',
  };

  logger.info({ config }, 'Iniciando deploy FLUX.1 Schnell');

  try {
    const result = await createBreaker.fire(config) as DeploymentResult;
    
    logger.info({
      containerId: result.containerId,
      containerName: result.containerName,
      endpoint: result.endpoint,
    }, 'FLUX.1 Schnell deployed com sucesso');

    return result;
  } catch (error) {
    logger.error({ error }, 'Erro ao fazer deploy do FLUX.1');
    
    if (error instanceof Error && error.message.includes('Breaker is open')) {
      return {
        success: false,
        error: 'Serviço Salad Cloud temporariamente indisponível',
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    };
  }
}

/**
 * Obtém status do Container Group FLUX.1
 */
export async function getFluxDeploymentStatus(
  containerName: string
): Promise<ContainerGroupStatus | null> {
  const url = `${SALAD_API_URL}/organizations/${SALAD_ORGANIZATION_ID}/projects/${SALAD_PROJECT_NAME}/containers/${containerName}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: getHeaders(),
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`Falha ao obter status: ${response.status}`);
    }

    const data = await response.json() as {
      id: string;
      name: string;
      display_name: string;
      current_state: {
        status: string;
        instance_status_counts?: {
          running: number;
          pending: number;
          allocating: number;
        };
      };
      networking?: { dns?: string };
      create_time: string;
      update_time: string;
      replicas: number;
    };

    return {
      id: data.id,
      name: data.name,
      displayName: data.display_name,
      status: data.current_state.status as ContainerGroupStatus['status'],
      replicas: {
        desired: data.replicas,
        running: data.current_state.instance_status_counts?.running || 0,
        pending: data.current_state.instance_status_counts?.pending || 0,
      },
      endpoint: data.networking?.dns,
      createdAt: data.create_time,
      updatedAt: data.update_time,
    };
  } catch (error) {
    logger.error({ error, containerName }, 'Erro ao obter status FLUX');
    return null;
  }
}

/**
 * Para Container Group FLUX.1
 */
export async function stopFluxDeployment(containerName: string): Promise<boolean> {
  const url = `${SALAD_API_URL}/organizations/${SALAD_ORGANIZATION_ID}/projects/${SALAD_PROJECT_NAME}/containers/${containerName}/stop`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Falha ao parar: ${response.status}`);
    }

    logger.info({ containerName }, 'FLUX.1 Container Group parado');
    return true;
  } catch (error) {
    logger.error({ error, containerName }, 'Erro ao parar FLUX');
    return false;
  }
}

/**
 * Reinicia Container Group FLUX.1
 */
export async function restartFluxDeployment(containerName: string): Promise<boolean> {
  const url = `${SALAD_API_URL}/organizations/${SALAD_ORGANIZATION_ID}/projects/${SALAD_PROJECT_NAME}/containers/${containerName}/start`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Falha ao reiniciar: ${response.status}`);
    }

    logger.info({ containerName }, 'FLUX.1 Container Group reiniciado');
    return true;
  } catch (error) {
    logger.error({ error, containerName }, 'Erro ao reiniciar FLUX');
    return false;
  }
}

/**
 * Escala Container Group FLUX.1
 */
export async function scaleFluxDeployment(
  containerName: string,
  replicas: number
): Promise<boolean> {
  const url = `${SALAD_API_URL}/organizations/${SALAD_ORGANIZATION_ID}/projects/${SALAD_PROJECT_NAME}/containers/${containerName}`;

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ replicas }),
    });

    if (!response.ok) {
      throw new Error(`Falha ao escalar: ${response.status}`);
    }

    logger.info({ containerName, replicas }, 'FLUX.1 Container Group escalado');
    return true;
  } catch (error) {
    logger.error({ error, containerName, replicas }, 'Erro ao escalar FLUX');
    return false;
  }
}

/**
 * Health check do FLUX.1 endpoint
 */
export async function checkFluxHealth(endpoint: string): Promise<boolean> {
  try {
    const response = await fetch(`https://${endpoint}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(10000),
    });

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Lista todos os Container Groups de imagem
 */
export async function listFluxDeployments(): Promise<ContainerGroupStatus[]> {
  const url = `${SALAD_API_URL}/organizations/${SALAD_ORGANIZATION_ID}/projects/${SALAD_PROJECT_NAME}/containers`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Falha ao listar: ${response.status}`);
    }

    const data = await response.json() as { 
      items: Array<{
        id: string;
        name: string;
        display_name: string;
        current_state: { status: string };
        replicas: number;
        create_time: string;
        update_time: string;
      }>;
    };

    return data.items
      .filter(item => item.name.includes('flux') || item.name.includes('image'))
      .map(item => ({
        id: item.id,
        name: item.name,
        displayName: item.display_name,
        status: item.current_state.status as ContainerGroupStatus['status'],
        replicas: {
          desired: item.replicas,
          running: 0,
          pending: 0,
        },
        createdAt: item.create_time,
        updatedAt: item.update_time,
      }));
  } catch (error) {
    logger.error({ error }, 'Erro ao listar deployments FLUX');
    return [];
  }
}

/**
 * Estatísticas de deploy FLUX
 */
export function getFluxDeploymentStats() {
  return {
    circuitBreaker: {
      state: createBreaker.opened ? 'open' : (createBreaker.halfOpen ? 'half-open' : 'closed'),
      failures: createBreaker.stats.failures,
      successes: createBreaker.stats.successes,
    },
  };
}
