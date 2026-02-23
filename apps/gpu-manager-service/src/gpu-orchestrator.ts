/**
 * GPU Orchestrator - Orquestração simplificada de containers GPU
 *
 * ABORDAGEM SIMPLES (menor latência):
 * - Troca apenas Embeddings ↔ Trainer (LLM permanece sempre ativo)
 * - Em modo simultaneous, embeddings não são parados; trainer sobe apenas sob demanda
 * - VRAM: LLM ~6GB + Trainer ~12GB ≈ 18GB < 20GB (coexistência viável)
 *
 * Estados:
 * - llm_embeddings: LLM + Embeddings ativos (padrão)
 * - training: LLM + Trainer ativos (embeddings parado)
 *
 * Fluxo:
 * - Treino solicitado → para embeddings → sobe trainer
 * - RAG/embeddings durante treino → interrompe treino → volta embeddings
 * - 10 min idle pós-treino → volta automaticamente para embeddings
 *
 * Autor: Fillipe Guerra
 * Data: 11 de Fevereiro de 2026
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '@alice/logger';

const execAsync = promisify(exec);
const logger = createLogger('gpu-orchestrator');
const GPU_TRAINING_PROFILE = 'gpu-training';

/** Estado atual do orquestrador */
export type OrchestratorState =
  | 'llm_embeddings'   // LLM + Embeddings (padrão)
  | 'training'         // LLM + Trainer
  | 'switching_to_training'
  | 'switching_to_llm';

/** Configuração do orquestrador (env vars) */
const COMPOSE_DIR = process.env.GPU_ORCHESTRATOR_COMPOSE_DIR || '/opt/alice/compose/stacks';
const COMPOSE_ENV_FILE = process.env.GPU_ORCHESTRATOR_ENV_FILE || '/opt/alice/compose/.env.prod';
const COMPOSE_PROJECT = process.env.GPU_ORCHESTRATOR_PROJECT || 'alice-alice';
const DOCKER_COMPOSE_CMD = process.env.DOCKER_COMPOSE_CMD || 'docker compose';
const IDLE_RETURN_MS = parseInt(process.env.GPU_ORCHESTRATOR_IDLE_MS || '600000', 10); // 10 min
const resolvedConcurrencyMode = process.env.GPU_CONCURRENCY_MODE ?? process.env.GPU_ORCHESTRATION_MODE ?? 'simultaneous';
if (resolvedConcurrencyMode !== 'simultaneous' && resolvedConcurrencyMode !== 'preemptive') {
  throw new Error(`GPU_CONCURRENCY_MODE inválido: ${resolvedConcurrencyMode}. Valores permitidos: simultaneous|preemptive`);
}
export const GPU_CONCURRENCY_MODE = resolvedConcurrencyMode;
// Compatibilidade retroativa para variáveis/código legado
export const GPU_ORCHESTRATION_MODE = GPU_CONCURRENCY_MODE;

/** Estado em memória (persistência opcional via Redis em versão futura) */
let currentState: OrchestratorState = 'llm_embeddings';
let _lastTrainingActivityAt = 0;
let idleReturnTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Executa comando docker compose (timeout configurável)
 */
async function runCompose(args: string[], timeoutMs = 60000): Promise<{ stdout: string; stderr: string }> {
  const base = `${COMPOSE_DIR}/docker-compose.base.yml`;
  const alice = `${COMPOSE_DIR}/docker-compose.alice.yml`;
  const parts = [
    DOCKER_COMPOSE_CMD,
    `-p ${COMPOSE_PROJECT}`,
    `-f ${base}`,
    `-f ${alice}`,
    `--env-file ${COMPOSE_ENV_FILE}`,
    ...args,
  ];
  const cmd = `cd "${COMPOSE_DIR}" && ${parts.join(' ')}`;

  try {
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: timeoutMs,
      env: { ...process.env, DOCKER_HOST: process.env.DOCKER_HOST || 'unix:///var/run/docker.sock' },
    });
    return { stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ cmd, error: msg }, 'Falha ao executar docker compose');
    throw new Error(`docker compose failed: ${msg}`);
  }
}

/**
 * Verifica se o orquestrador está disponível (socket + compose)
 */
export async function isOrchestratorAvailable(): Promise<boolean> {
  try {
    await execAsync('docker info', { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Retorna estado atual
 */
export function getOrchestratorState(): OrchestratorState {
  return currentState;
}

/**
 * Troca para modo treino (para embeddings, sobe trainer)
 */
export async function switchToTraining(): Promise<void> {
  if (currentState === 'training') {
    _lastTrainingActivityAt = Date.now();
    return;
  }
  if (currentState === 'switching_to_training' || currentState === 'switching_to_llm') {
    throw new Error('Troca em andamento');
  }

  currentState = 'switching_to_training';
  if (GPU_ORCHESTRATION_MODE === 'simultaneous') {
    logger.info('Orquestrador: subindo trainer sob demanda (modo simultaneous)');
    try {
      await runCompose(['--profile', GPU_TRAINING_PROFILE, 'up', '-d', 'gpu-trainer'], 120000);
      currentState = 'training';
      _lastTrainingActivityAt = Date.now();
      scheduleIdleReturn();
      logger.info('Orquestrador: trainer ativo (modo simultaneous)');
      return;
    } catch (error) {
      currentState = 'llm_embeddings';
      scheduleIdleReturn();
      throw error;
    }
  }
  logger.info('Orquestrador: trocando para modo treino (parando embeddings, subindo trainer)');

  try {
    await runCompose(['stop', 'gpu-embeddings'], 30000);
    await runCompose(['--profile', GPU_TRAINING_PROFILE, 'up', '-d', 'gpu-trainer'], 120000);
    currentState = 'training';
    _lastTrainingActivityAt = Date.now();
    scheduleIdleReturn();
    logger.info('Orquestrador: modo treino ativo');
  } catch (error) {
    currentState = 'llm_embeddings';
    scheduleIdleReturn();
    throw error;
  }
}

/**
 * Volta para modo LLM+Embeddings (para trainer, sobe embeddings)
 */
export async function switchToLlmEmbeddings(): Promise<void> {
  if (currentState === 'llm_embeddings') return;
  if (currentState === 'switching_to_training' || currentState === 'switching_to_llm') {
    throw new Error('Troca em andamento');
  }

  currentState = 'switching_to_llm';
  cancelIdleReturn();
  if (GPU_ORCHESTRATION_MODE === 'simultaneous') {
    logger.info('Orquestrador: parando trainer (modo simultaneous)');
    try {
      await runCompose(['--profile', GPU_TRAINING_PROFILE, 'stop', 'gpu-trainer'], 60000);
      currentState = 'llm_embeddings';
      logger.info('Orquestrador: trainer parado (modo simultaneous)');
      return;
    } catch (error) {
      currentState = 'training';
      throw error;
    }
  }
  logger.info('Orquestrador: voltando para LLM+Embeddings (parando trainer, subindo embeddings)');

  try {
    await runCompose(['--profile', GPU_TRAINING_PROFILE, 'stop', 'gpu-trainer'], 60000);
    await runCompose(['up', '-d', 'gpu-embeddings'], 120000);
    currentState = 'llm_embeddings';
    logger.info('Orquestrador: modo LLM+Embeddings ativo');
  } catch (error) {
    currentState = 'training';
    throw error;
  }
}

function scheduleIdleReturn(): void {
  cancelIdleReturn();
  if (currentState !== 'training') return;

  idleReturnTimer = setTimeout(() => {
    idleReturnTimer = null;
    logger.info('Orquestrador: 10 min idle - retornando para LLM+Embeddings');
    switchToLlmEmbeddings().catch((err) => {
      logger.error({ err }, 'Falha no retorno automático por idle');
    });
  }, IDLE_RETURN_MS);
}

function cancelIdleReturn(): void {
  if (idleReturnTimer) {
    clearTimeout(idleReturnTimer);
    idleReturnTimer = null;
  }
}

/**
 * Registra atividade de treino (reset do timer de idle)
 */
export function reportTrainingActivity(): void {
  _lastTrainingActivityAt = Date.now();
  if (currentState === 'training') {
    scheduleIdleReturn();
  }
}

/**
 * Cleanup (shutdown)
 */
export function shutdownOrchestrator(): void {
  cancelIdleReturn();
}
