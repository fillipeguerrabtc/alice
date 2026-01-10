/**
 * Docker GPU Orchestrator - Alice Enterprise Platform
 * 
 * Orquestração dinâmica de containers GPU para GPU única (20GB VRAM).
 * Gerencia ciclo de vida dos containers GPU on-demand:
 * - Apenas 1 serviço GPU pesado por vez (VRAM compartilhada)
 * - Troca automática baseada em demanda
 * - Cache de serviço para evitar trocas frequentes
 * 
 * ARQUITETURA ENTERPRISE (09/01/2026):
 * - Docker API via dockerode para controle de containers
 * - Lock global Redis para garantir operações atômicas
 * - Health check com retry antes de retornar serviço como pronto
 * - Graceful shutdown dos containers GPU
 * 
 * Autor: Fillipe Guerra
 * Data: 09 de Janeiro de 2026
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import Docker from 'dockerode';
import { createLogger } from '@alice/logger';
import { getRedisClient } from '@alice/shared-utils';

const logger = createLogger('docker-orchestrator');

// ============================================================================
// CONFIGURAÇÃO
// ============================================================================

/** Timeout para aguardar container ficar healthy (ms) */
const CONTAINER_STARTUP_TIMEOUT_MS = parseInt(process.env.GPU_CONTAINER_STARTUP_TIMEOUT_MS || '120000', 10); // 2 min default

/** Intervalo de verificação de health (ms) */
const HEALTH_CHECK_INTERVAL_MS = 2000;

/** Tempo máximo de inatividade antes de parar serviço (ms) */
const IDLE_TIMEOUT_MS = parseInt(process.env.GPU_SERVICE_IDLE_TIMEOUT_MS || '300000', 10); // 5 min default

/** Serviço GPU padrão a manter rodando quando idle */
const DEFAULT_GPU_SERVICE = process.env.GPU_DEFAULT_SERVICE || 'mixtral';

/** Prefixo Redis para estado do orchestrator */
const REDIS_ORCHESTRATOR_PREFIX = 'alice:gpu:orchestrator';

/** Lock Redis para operações de troca de container */
const REDIS_SWITCH_LOCK_KEY = 'alice:gpu:orchestrator:switch-lock';

// ============================================================================
// TIPOS
// ============================================================================

export enum GpuContainerType {
  MIXTRAL = 'mixtral',
  EMBEDDINGS = 'embeddings',
  FLUX = 'flux',
  ASR = 'asr',
  TRAINING = 'training',
}

interface GpuContainerConfig {
  containerName: string;
  profile: string;
  image: string;
  port: number;
  healthEndpoint: string;
  vramRequired: number;
  startupTimeout: number;
}

interface GpuServiceState {
  activeService: GpuContainerType | null;
  lastUsed: number;
  isStarting: boolean;
  isStopping: boolean;
}

// ============================================================================
// CONFIGURAÇÃO DOS CONTAINERS GPU
// ============================================================================

const IMAGE_PREFIX = process.env.IMAGE_PREFIX || 'ghcr.io/fillipeguerrabtc/alice';
const IMAGE_TAG = process.env.IMAGE_TAG || 'latest';

const GPU_CONTAINERS: Record<GpuContainerType, GpuContainerConfig> = {
  [GpuContainerType.MIXTRAL]: {
    containerName: 'gpu-mixtral',
    profile: 'gpu-llm',
    image: `${IMAGE_PREFIX}-mixtral-vllm:${IMAGE_TAG}`,
    port: 8000,
    healthEndpoint: '/health',
    vramRequired: 18,
    startupTimeout: 120000, // 2 min - modelo grande
  },
  [GpuContainerType.EMBEDDINGS]: {
    containerName: 'gpu-embeddings',
    profile: 'gpu-embeddings',
    image: `${IMAGE_PREFIX}-embeddings-gpu:${IMAGE_TAG}`,
    port: 8000,
    healthEndpoint: '/health',
    vramRequired: 16,
    startupTimeout: 90000, // 1.5 min
  },
  [GpuContainerType.FLUX]: {
    containerName: 'gpu-flux',
    profile: 'gpu-flux',
    image: `${IMAGE_PREFIX}-flux-schnell:${IMAGE_TAG}`,
    port: 8000,
    healthEndpoint: '/health',
    vramRequired: 12,
    startupTimeout: 90000,
  },
  [GpuContainerType.ASR]: {
    containerName: 'gpu-asr',
    profile: 'gpu-asr',
    image: `${IMAGE_PREFIX}-asr-canary:${IMAGE_TAG}`,
    port: 8000,
    healthEndpoint: '/health',
    vramRequired: 3,
    startupTimeout: 60000, // 1 min - modelo menor
  },
  [GpuContainerType.TRAINING]: {
    containerName: 'gpu-trainer',
    profile: 'gpu-training',
    image: `${IMAGE_PREFIX}-lora-trainer:${IMAGE_TAG}`,
    port: 8000,
    healthEndpoint: '/health',
    vramRequired: 18,
    startupTimeout: 60000,
  },
};

// ============================================================================
// DOCKER CLIENT
// ============================================================================

let docker: Docker | null = null;

function getDockerClient(): Docker {
  if (!docker) {
    // Usar socket padrão do Docker
    docker = new Docker({ socketPath: '/var/run/docker.sock' });
  }
  return docker;
}

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

let orchestratorState: GpuServiceState = {
  activeService: null,
  lastUsed: Date.now(),
  isStarting: false,
  isStopping: false,
};

/** Timer para idle timeout */
let idleTimeoutTimer: NodeJS.Timeout | null = null;

/**
 * Persiste estado no Redis para resiliência
 */
async function saveState(): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  await redis.set(
    `${REDIS_ORCHESTRATOR_PREFIX}:state`,
    JSON.stringify(orchestratorState),
    { EX: 3600 } // 1 hora TTL
  );
}

/**
 * Carrega estado do Redis na inicialização
 */
async function loadState(): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  const state = await redis.get(`${REDIS_ORCHESTRATOR_PREFIX}:state`);
  if (state && typeof state === 'string') {
    try {
      orchestratorState = JSON.parse(state);
      logger.info({ state: orchestratorState }, 'Estado do orchestrator carregado do Redis');
    } catch (error) {
      logger.warn({ error }, 'Falha ao parsear estado do Redis, usando estado inicial');
    }
  }
}

// ============================================================================
// CONTAINER MANAGEMENT
// ============================================================================

/**
 * Verifica se um container existe
 */
async function containerExists(containerName: string): Promise<boolean> {
  try {
    const client = getDockerClient();
    const container = client.getContainer(containerName);
    await container.inspect();
    return true;
  } catch {
    return false;
  }
}

/**
 * Verifica se um container está rodando
 */
async function isContainerRunning(containerName: string): Promise<boolean> {
  try {
    const client = getDockerClient();
    const container = client.getContainer(containerName);
    const info = await container.inspect();
    return info.State.Running === true;
  } catch {
    return false;
  }
}

/**
 * Verifica se um container está healthy
 */
async function isContainerHealthy(containerName: string): Promise<boolean> {
  try {
    const client = getDockerClient();
    const container = client.getContainer(containerName);
    const info = await container.inspect();
    
    // Se não tem healthcheck definido, consideramos running como healthy
    if (!info.State.Health) {
      return info.State.Running === true;
    }
    
    return info.State.Health.Status === 'healthy';
  } catch {
    return false;
  }
}

/**
 * Inicia um container GPU usando docker start
 */
async function startContainer(serviceType: GpuContainerType): Promise<boolean> {
  const config = GPU_CONTAINERS[serviceType];
  const containerName = config.containerName;

  logger.info({ serviceType, containerName }, 'Iniciando container GPU');

  try {
    const client = getDockerClient();
    const container = client.getContainer(containerName);

    // Verificar se container existe
    const exists = await containerExists(containerName);
    if (!exists) {
      logger.error({ containerName }, 'Container GPU não existe - deve ser criado via docker compose');
      return false;
    }

    // Se já está rodando, apenas retornar
    if (await isContainerRunning(containerName)) {
      logger.info({ containerName }, 'Container GPU já está rodando');
      return true;
    }

    // Iniciar container
    await container.start();
    logger.info({ containerName }, 'Container GPU iniciado, aguardando healthcheck');

    // Aguardar container ficar healthy
    const startTime = Date.now();
    const timeout = config.startupTimeout || CONTAINER_STARTUP_TIMEOUT_MS;

    while (Date.now() - startTime < timeout) {
      if (await isContainerHealthy(containerName)) {
        logger.info({ containerName, startupMs: Date.now() - startTime }, 'Container GPU healthy');
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, HEALTH_CHECK_INTERVAL_MS));
    }

    logger.error({ containerName, timeout }, 'Timeout aguardando container GPU ficar healthy');
    return false;
  } catch (error) {
    logger.error({ error, containerName }, 'Erro ao iniciar container GPU');
    return false;
  }
}

/**
 * Para um container GPU gracefully
 */
async function stopContainer(serviceType: GpuContainerType): Promise<boolean> {
  const config = GPU_CONTAINERS[serviceType];
  const containerName = config.containerName;

  logger.info({ serviceType, containerName }, 'Parando container GPU');

  try {
    const client = getDockerClient();
    const container = client.getContainer(containerName);

    // Verificar se está rodando
    if (!(await isContainerRunning(containerName))) {
      logger.info({ containerName }, 'Container GPU já está parado');
      return true;
    }

    // Parar com timeout graceful (30s para liberar VRAM)
    await container.stop({ t: 30 });
    logger.info({ containerName }, 'Container GPU parado com sucesso');
    return true;
  } catch (error) {
    logger.error({ error, containerName }, 'Erro ao parar container GPU');
    return false;
  }
}

/**
 * Para todos os containers GPU
 */
async function stopAllGpuContainers(): Promise<void> {
  logger.info('Parando todos os containers GPU');

  for (const serviceType of Object.values(GpuContainerType)) {
    const containerName = GPU_CONTAINERS[serviceType].containerName;
    if (await isContainerRunning(containerName)) {
      await stopContainer(serviceType);
    }
  }
}

// ============================================================================
// ORCHESTRATION LOGIC
// ============================================================================

/**
 * Adquire lock de troca de serviço
 */
async function acquireSwitchLock(ttlMs: number = 180000): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return true; // Sem Redis, permitir operação

  const result = await redis.set(REDIS_SWITCH_LOCK_KEY, Date.now().toString(), { NX: true, PX: ttlMs });
  return result === 'OK';
}

/**
 * Libera lock de troca de serviço
 */
async function releaseSwitchLock(): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  await redis.del(REDIS_SWITCH_LOCK_KEY);
}

/**
 * Garante que um serviço GPU específico está rodando.
 * Se outro serviço está ativo, para ele primeiro e inicia o novo.
 * 
 * @param serviceType Tipo do serviço GPU necessário
 * @returns true se o serviço está pronto para uso
 */
export async function ensureGpuServiceRunning(serviceType: GpuContainerType): Promise<boolean> {
  const config = GPU_CONTAINERS[serviceType];
  const containerName = config.containerName;

  // Atualizar timestamp de uso
  orchestratorState.lastUsed = Date.now();
  resetIdleTimeout();

  // Se o serviço já está ativo e healthy, retornar imediatamente
  if (orchestratorState.activeService === serviceType) {
    if (await isContainerHealthy(containerName)) {
      logger.debug({ serviceType }, 'Serviço GPU já está ativo e healthy');
      return true;
    }
  }

  // Verificar se já tem operação em andamento
  if (orchestratorState.isStarting || orchestratorState.isStopping) {
    logger.warn({ serviceType, state: orchestratorState }, 'Operação de troca já em andamento');
    
    // Aguardar operação terminar (max 3 min)
    const waitStart = Date.now();
    while ((orchestratorState.isStarting || orchestratorState.isStopping) && Date.now() - waitStart < 180000) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Verificar se o serviço desejado está pronto agora
    if (orchestratorState.activeService === serviceType && await isContainerHealthy(containerName)) {
      return true;
    }
  }

  // Tentar adquirir lock
  const lockAcquired = await acquireSwitchLock();
  if (!lockAcquired) {
    logger.warn({ serviceType }, 'Não foi possível adquirir lock de troca - outra operação em andamento');
    
    // Aguardar e verificar se serviço ficou disponível
    await new Promise(resolve => setTimeout(resolve, 5000));
    return await isContainerHealthy(containerName);
  }

  try {
    orchestratorState.isStarting = true;
    await saveState();

    // Se há outro serviço ativo, parar ele primeiro
    if (orchestratorState.activeService && orchestratorState.activeService !== serviceType) {
      const currentService = orchestratorState.activeService;
      logger.info({ 
        currentService, 
        newService: serviceType 
      }, 'Trocando serviço GPU ativo');

      orchestratorState.isStopping = true;
      await saveState();

      const stopped = await stopContainer(currentService);
      if (!stopped) {
        logger.error({ currentService }, 'Falha ao parar serviço GPU atual');
        // Continuar mesmo assim - tentar forçar início do novo
      }

      orchestratorState.isStopping = false;
      orchestratorState.activeService = null;
      await saveState();

      // Pequena pausa para liberar VRAM
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Iniciar o novo serviço
    const started = await startContainer(serviceType);
    if (started) {
      orchestratorState.activeService = serviceType;
      orchestratorState.lastUsed = Date.now();
      logger.info({ serviceType }, 'Serviço GPU iniciado com sucesso');
    } else {
      logger.error({ serviceType }, 'Falha ao iniciar serviço GPU');
    }

    orchestratorState.isStarting = false;
    await saveState();

    return started;
  } catch (error) {
    logger.error({ error, serviceType }, 'Erro durante troca de serviço GPU');
    orchestratorState.isStarting = false;
    orchestratorState.isStopping = false;
    await saveState();
    return false;
  } finally {
    await releaseSwitchLock();
  }
}

/**
 * Retorna o estado atual dos serviços GPU
 */
export async function getGpuServicesStatus(): Promise<{
  activeService: GpuContainerType | null;
  services: Record<GpuContainerType, {
    running: boolean;
    healthy: boolean;
    containerName: string;
    vramRequired: number;
  }>;
  state: GpuServiceState;
}> {
  const services: Record<string, { running: boolean; healthy: boolean; containerName: string; vramRequired: number }> = {};

  for (const [serviceType, config] of Object.entries(GPU_CONTAINERS)) {
    const containerName = config.containerName;
    services[serviceType] = {
      running: await isContainerRunning(containerName),
      healthy: await isContainerHealthy(containerName),
      containerName,
      vramRequired: config.vramRequired,
    };
  }

  return {
    activeService: orchestratorState.activeService,
    services: services as Record<GpuContainerType, { running: boolean; healthy: boolean; containerName: string; vramRequired: number }>,
    state: { ...orchestratorState },
  };
}

// ============================================================================
// IDLE MANAGEMENT
// ============================================================================

/**
 * Reseta o timer de idle timeout
 */
function resetIdleTimeout(): void {
  if (idleTimeoutTimer) {
    clearTimeout(idleTimeoutTimer);
  }

  idleTimeoutTimer = setTimeout(async () => {
    await handleIdleTimeout();
  }, IDLE_TIMEOUT_MS);
}

/**
 * Callback quando sistema fica idle
 * Retorna ao serviço padrão (Mixtral) ou mantém o atual
 */
async function handleIdleTimeout(): Promise<void> {
  const defaultService = DEFAULT_GPU_SERVICE as GpuContainerType;

  // Se já está no serviço padrão, não fazer nada
  if (orchestratorState.activeService === defaultService) {
    logger.debug('Sistema idle, já no serviço padrão');
    resetIdleTimeout();
    return;
  }

  // Se não há serviço ativo, iniciar o padrão
  if (!orchestratorState.activeService) {
    logger.info({ defaultService }, 'Sistema idle sem serviço ativo, iniciando serviço padrão');
    await ensureGpuServiceRunning(defaultService);
    return;
  }

  // Trocar para o serviço padrão
  logger.info({ 
    currentService: orchestratorState.activeService, 
    defaultService 
  }, 'Sistema idle, trocando para serviço padrão');

  await ensureGpuServiceRunning(defaultService);
}

// ============================================================================
// INITIALIZATION
// ============================================================================

let orchestratorInitialized = false;

/**
 * Inicializa o orchestrator
 */
export async function initializeOrchestrator(): Promise<void> {
  if (orchestratorInitialized) {
    logger.warn('Orchestrator já inicializado');
    return;
  }

  // Verificar se Docker está acessível
  try {
    const client = getDockerClient();
    await client.ping();
    logger.info('Docker API acessível');
  } catch (error) {
    logger.error({ error }, 'Docker API não acessível - orchestrator desabilitado');
    return;
  }

  // Carregar estado do Redis
  await loadState();

  // Verificar estado real dos containers
  let runningService: GpuContainerType | null = null;
  for (const serviceType of Object.values(GpuContainerType)) {
    const config = GPU_CONTAINERS[serviceType];
    if (await isContainerRunning(config.containerName)) {
      runningService = serviceType;
      logger.info({ serviceType }, 'Container GPU encontrado rodando');
      break; // Apenas 1 deve estar rodando
    }
  }

  // Sincronizar estado
  orchestratorState.activeService = runningService;
  orchestratorState.isStarting = false;
  orchestratorState.isStopping = false;
  await saveState();

  // Iniciar serviço padrão se nenhum está rodando
  if (!runningService) {
    const defaultService = DEFAULT_GPU_SERVICE as GpuContainerType;
    logger.info({ defaultService }, 'Nenhum serviço GPU ativo, iniciando serviço padrão');
    await ensureGpuServiceRunning(defaultService);
  }

  // Iniciar timer de idle
  resetIdleTimeout();

  orchestratorInitialized = true;
  logger.info({ 
    activeService: orchestratorState.activeService,
    idleTimeoutMs: IDLE_TIMEOUT_MS,
    defaultService: DEFAULT_GPU_SERVICE,
  }, 'GPU Orchestrator inicializado');
}

/**
 * Para o orchestrator (graceful shutdown)
 */
export async function shutdownOrchestrator(): Promise<void> {
  logger.info('Encerrando GPU Orchestrator');

  if (idleTimeoutTimer) {
    clearTimeout(idleTimeoutTimer);
    idleTimeoutTimer = null;
  }

  // Salvar estado final
  await saveState();

  // Não parar os containers GPU no shutdown - podem ser usados por outras instâncias
  // Se necessário parar tudo: await stopAllGpuContainers();

  orchestratorInitialized = false;
  logger.info('GPU Orchestrator encerrado');
}

/**
 * Verifica se o orchestrator está habilitado
 */
export function isOrchestratorEnabled(): boolean {
  const enabled = process.env.GPU_ORCHESTRATOR_ENABLED !== 'false';
  return enabled;
}

/**
 * Mapeia GpuServiceType do index.ts para GpuContainerType do orchestrator
 */
export function mapServiceTypeToContainer(serviceType: string): GpuContainerType | null {
  const mapping: Record<string, GpuContainerType> = {
    'mixtral': GpuContainerType.MIXTRAL,
    'embeddings': GpuContainerType.EMBEDDINGS,
    'flux': GpuContainerType.FLUX,
    'asr': GpuContainerType.ASR,
    'training': GpuContainerType.TRAINING,
  };

  return mapping[serviceType] || null;
}
