/**
 * Cliente Salad Cloud - Training Service
 * 
 * Cliente HTTP para API Salad Cloud Container Groups.
 * Implementa fine-tuning via Container Engine com Docker images customizadas.
 * Circuit Breaker pattern (Regra 16 - Best Practices 2025).
 * Documentação em PT-BR (Regra 10 replit.md).
 * 
 * Referência: https://docs.salad.com/container-engine/tutorials/machine-learning/llm-fine-tuning
 * 
 * @module training-service/salad-client
 */

import CircuitBreaker from 'opossum';
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
}).child({ service: 'salad-client' });

const SALAD_API_URL = process.env.SALAD_API_URL || 'https://api.salad.com/api/public';
const SALAD_API_KEY = process.env.SALAD_API_KEY || '';
const SALAD_ORGANIZATION_ID = process.env.SALAD_ORGANIZATION_ID || '';
const SALAD_PROJECT_NAME = process.env.SALAD_PROJECT_NAME || 'alice-finetuning';

/**
 * Configuração de Container para fine-tuning
 */
export interface ContainerConfig {
  image: string;
  resources: {
    cpu: number;
    memory: number;
    gpuClasses: string[];
  };
  environmentVariables: Record<string, string>;
  command?: string[];
}

/**
 * Configuração de Container Group para fine-tuning
 */
export interface ContainerGroupConfig {
  name: string;
  displayName?: string;
  container: ContainerConfig;
  replicas: number;
  autoStartOnCreation?: boolean;
  restartPolicy?: 'always' | 'on_failure' | 'never';
  countryCodes?: string[];
}

/**
 * Status de Container Group
 */
export interface ContainerGroupStatus {
  id: string;
  name: string;
  displayName?: string;
  createTime: string;
  updateTime: string;
  currentState: {
    status: 'pending' | 'running' | 'stopped' | 'succeeded' | 'failed' | 'deploying';
    startTime?: string;
    finishTime?: string;
    description?: string;
    instanceStatusCounts?: {
      allocating: number;
      creating: number;
      running: number;
      stopping: number;
    };
  };
}

/**
 * Resposta de criação de Container Group
 */
export interface CreateContainerGroupResponse {
  id: string;
  name: string;
  createTime: string;
  currentState: {
    status: string;
  };
}

/**
 * Resposta de listagem de GPU Classes
 */
export interface GPUClass {
  id: string;
  name: string;
  prices: Array<{ priority: string; price: string }>;
  isHighDemand: boolean;
  gpuCount: number;
}

/**
 * Configuração de Circuit Breaker para Salad Cloud API
 * Timeout maior para operações de fine-tuning
 */
const saladBreakerOptions = {
  timeout: 60000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  volumeThreshold: 3,
};

/**
 * Headers padrão para API Salad Cloud
 */
function getHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Salad-Api-Key': SALAD_API_KEY,
  };
}

/**
 * Função interna para criar Container Group
 */
async function createContainerGroupInternal(
  config: ContainerGroupConfig
): Promise<CreateContainerGroupResponse> {
  const url = `${SALAD_API_URL}/organizations/${SALAD_ORGANIZATION_ID}/projects/${SALAD_PROJECT_NAME}/containers`;
  
  const body = {
    name: config.name,
    display_name: config.displayName || config.name,
    container: {
      image: config.container.image,
      resources: {
        cpu: config.container.resources.cpu,
        memory: config.container.resources.memory,
        gpu_classes: config.container.resources.gpuClasses,
      },
      environment_variables: config.container.environmentVariables,
      command: config.container.command,
    },
    replicas: config.replicas,
    autostart: config.autoStartOnCreation ?? true,
    restart_policy: config.restartPolicy || 'on_failure',
    country_codes: config.countryCodes,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Falha ao criar Container Group: ${response.status} - ${errorText}`);
  }

  return response.json() as Promise<CreateContainerGroupResponse>;
}

/**
 * Função interna para obter status de Container Group
 */
async function getContainerGroupStatusInternal(
  containerGroupName: string
): Promise<ContainerGroupStatus> {
  const url = `${SALAD_API_URL}/organizations/${SALAD_ORGANIZATION_ID}/projects/${SALAD_PROJECT_NAME}/containers/${containerGroupName}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: getHeaders(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Falha ao obter status: ${response.status} - ${errorText}`);
  }

  return response.json() as Promise<ContainerGroupStatus>;
}

/**
 * Função interna para deletar Container Group
 */
async function deleteContainerGroupInternal(
  containerGroupName: string
): Promise<void> {
  const url = `${SALAD_API_URL}/organizations/${SALAD_ORGANIZATION_ID}/projects/${SALAD_PROJECT_NAME}/containers/${containerGroupName}`;

  const response = await fetch(url, {
    method: 'DELETE',
    headers: getHeaders(),
  });

  if (!response.ok && response.status !== 404) {
    const errorText = await response.text();
    throw new Error(`Falha ao deletar Container Group: ${response.status} - ${errorText}`);
  }
}

/**
 * Função interna para parar Container Group
 */
async function stopContainerGroupInternal(
  containerGroupName: string
): Promise<void> {
  const url = `${SALAD_API_URL}/organizations/${SALAD_ORGANIZATION_ID}/projects/${SALAD_PROJECT_NAME}/containers/${containerGroupName}/stop`;

  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Falha ao parar Container Group: ${response.status} - ${errorText}`);
  }
}

/**
 * Função interna para listar GPU Classes disponíveis
 */
async function listGPUClassesInternal(): Promise<GPUClass[]> {
  const url = `${SALAD_API_URL}/organizations/${SALAD_ORGANIZATION_ID}/gpu-classes`;

  const response = await fetch(url, {
    method: 'GET',
    headers: getHeaders(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Falha ao listar GPU Classes: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as { items: GPUClass[] };
  return data.items;
}

const createBreaker = new CircuitBreaker(createContainerGroupInternal, saladBreakerOptions);
const statusBreaker = new CircuitBreaker(getContainerGroupStatusInternal, saladBreakerOptions);
const deleteBreaker = new CircuitBreaker(deleteContainerGroupInternal, saladBreakerOptions);
const stopBreaker = new CircuitBreaker(stopContainerGroupInternal, saladBreakerOptions);
const listGPUBreaker = new CircuitBreaker(listGPUClassesInternal, saladBreakerOptions);

[createBreaker, statusBreaker, deleteBreaker, stopBreaker, listGPUBreaker].forEach(breaker => {
  breaker.on('open', () => {
    logger.warn({ breaker: breaker.name }, 'Circuit breaker Salad Cloud: ABERTO');
  });
  breaker.on('halfOpen', () => {
    logger.info({ breaker: breaker.name }, 'Circuit breaker Salad Cloud: HALF-OPEN');
  });
  breaker.on('close', () => {
    logger.info({ breaker: breaker.name }, 'Circuit breaker Salad Cloud: FECHADO');
  });
});

/**
 * Cria um job de fine-tuning via Container Group
 * 
 * @param jobId - ID interno do job
 * @param config - Configuração do fine-tuning
 * @returns Container Group criado
 */
export async function createFineTuningJob(
  jobId: string,
  config: {
    baseModel: string;
    dataUrl: string;
    outputUrl: string;
    hyperparameters: {
      epochs: number;
      learningRate: number;
      batchSize: number;
    };
  }
): Promise<CreateContainerGroupResponse> {
  const containerConfig: ContainerGroupConfig = {
    name: `alice-ft-${jobId.slice(0, 8)}`,
    displayName: `Alice Fine-tuning Job ${jobId.slice(0, 8)}`,
    container: {
      image: 'ghcr.io/alice/finetuning:latest',
      resources: {
        cpu: 4,
        memory: 16384,
        gpuClasses: ['rtx4090', 'rtx4080', 'rtx3090'],
      },
      environmentVariables: {
        JOB_ID: jobId,
        BASE_MODEL: config.baseModel,
        DATA_URL: config.dataUrl,
        OUTPUT_URL: config.outputUrl,
        EPOCHS: String(config.hyperparameters.epochs),
        LEARNING_RATE: String(config.hyperparameters.learningRate),
        BATCH_SIZE: String(config.hyperparameters.batchSize),
        CHECKPOINT_INTERVAL: '3600',
        SALAD_ORGANIZATION_ID: SALAD_ORGANIZATION_ID,
      },
    },
    replicas: 1,
    autoStartOnCreation: true,
    restartPolicy: 'on_failure',
  };

  try {
    const result = await createBreaker.fire(containerConfig) as CreateContainerGroupResponse;
    logger.info({ 
      jobId, 
      containerGroupId: result.id,
      containerGroupName: result.name,
    }, 'Container Group de fine-tuning criado');
    return result;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Breaker is open')) {
      throw new Error('Serviço Salad Cloud temporariamente indisponível. Tente novamente em alguns segundos.');
    }
    throw error;
  }
}

/**
 * Obtém o status de um job de fine-tuning
 * 
 * @param containerGroupName - Nome do Container Group
 * @returns Status atual do job
 */
export async function getJobStatus(
  containerGroupName: string
): Promise<ContainerGroupStatus> {
  try {
    return await statusBreaker.fire(containerGroupName) as ContainerGroupStatus;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Breaker is open')) {
      throw new Error('Serviço Salad Cloud temporariamente indisponível.');
    }
    throw error;
  }
}

/**
 * Cancela um job de fine-tuning
 * 
 * @param containerGroupName - Nome do Container Group
 */
export async function cancelJob(containerGroupName: string): Promise<void> {
  try {
    await stopBreaker.fire(containerGroupName);
    await deleteBreaker.fire(containerGroupName);
    logger.info({ containerGroupName }, 'Job de fine-tuning cancelado');
  } catch (error) {
    if (error instanceof Error && error.message.includes('Breaker is open')) {
      throw new Error('Serviço Salad Cloud temporariamente indisponível.');
    }
    throw error;
  }
}

/**
 * Lista GPU Classes disponíveis
 * 
 * @returns Lista de GPU Classes
 */
export async function listGPUClasses(): Promise<GPUClass[]> {
  try {
    return await listGPUBreaker.fire() as GPUClass[];
  } catch (error) {
    if (error instanceof Error && error.message.includes('Breaker is open')) {
      throw new Error('Serviço Salad Cloud temporariamente indisponível.');
    }
    throw error;
  }
}

/**
 * Mapeia status do Container Group para status interno do job
 */
export function mapContainerStatusToJobStatus(
  containerStatus: ContainerGroupStatus['currentState']['status']
): 'pending' | 'preparing' | 'training' | 'completed' | 'failed' | 'cancelled' {
  switch (containerStatus) {
    case 'pending':
    case 'deploying':
      return 'preparing';
    case 'running':
      return 'training';
    case 'succeeded':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'stopped':
      return 'cancelled';
    default:
      return 'pending';
  }
}

/**
 * Gera dados de treinamento em formato JSONL
 * 
 * @param messages - Array de mensagens de treinamento
 * @returns String JSONL formatada
 */
export function generateTrainingJSONL(
  messages: Array<{
    messages: Array<{ role: string; content: string }>;
  }>
): string {
  return messages.map(entry => JSON.stringify({
    messages: entry.messages.map(m => ({
      role: m.role,
      content: m.content,
    })),
  })).join('\n');
}

/**
 * Obtém estatísticas dos Circuit Breakers
 */
export function getSaladBreakerStats() {
  return {
    create: {
      state: createBreaker.opened ? 'open' : (createBreaker.halfOpen ? 'half-open' : 'closed'),
      failures: createBreaker.stats.failures,
      successes: createBreaker.stats.successes,
    },
    status: {
      state: statusBreaker.opened ? 'open' : (statusBreaker.halfOpen ? 'half-open' : 'closed'),
      failures: statusBreaker.stats.failures,
      successes: statusBreaker.stats.successes,
    },
    delete: {
      state: deleteBreaker.opened ? 'open' : (deleteBreaker.halfOpen ? 'half-open' : 'closed'),
      failures: deleteBreaker.stats.failures,
      successes: deleteBreaker.stats.successes,
    },
  };
}

/**
 * Verifica se a API Salad Cloud está disponível
 */
export async function verificarDisponibilidadeSalad(): Promise<boolean> {
  try {
    const response = await fetch(`${SALAD_API_URL}/organizations/${SALAD_ORGANIZATION_ID}/gpu-classes`, {
      method: 'GET',
      headers: getHeaders(),
      signal: AbortSignal.timeout(10000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
