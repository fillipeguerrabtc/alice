/**
 * GPU Orchestrator - FSM canônica de orquestração GPU
 *
 * Estados canônicos:
 * - serving_ready
 * - serving_draining
 * - training_starting
 * - training_active
 * - training_finishing
 * - serving_restoring
 * - error
 *
 * Regras operacionais:
 * - serving = gpu-llm + gpu-embeddings
 * - training = gpu-trainer
 * - Sem retorno automático por timeout
 * - Retorno para serving apenas por conclusão explícita do ciclo de treinamento
 *   (chamador) ou por restore manual.
 *
 * Compatibilidade:
 * - Mantém exports legados `switchToTraining` e `switchToLlmEmbeddings`
 *   como aliases para os comandos canônicos.
 *
 * Autor: Fillipe Guerra
 * Data: 11 de Março de 2026
 */

import { exec } from 'child_process';
import { access, constants as fsConstants } from 'node:fs/promises';
import { promisify } from 'util';
import { createLogger } from '@alice/logger';

const execAsync = promisify(exec);
const logger = createLogger('gpu-orchestrator');
const GPU_TRAINING_PROFILE = 'gpu-training';

export type OrchestratorState =
  | 'serving_ready'
  | 'serving_draining'
  | 'training_starting'
  | 'training_active'
  | 'training_finishing'
  | 'serving_restoring'
  | 'error';

export type OrchestratorTransitionTrigger = 'startup' | 'queue_request' | 'manual_api' | 'system';

export interface OrchestratorTransition {
  fromState: OrchestratorState;
  toState: OrchestratorState;
  trigger: OrchestratorTransitionTrigger;
  reason: string;
  at: string;
}

export interface ServingDrainResult {
  durationMs: number;
  inflightAtStart: number;
  inflightAtFinish: number;
  forcedInterruptions: number;
  timedOut: boolean;
}

type TransitionListener = (transition: OrchestratorTransition) => Promise<void> | void;

/** Configuração do orquestrador (env vars) */
const COMPOSE_DIR = process.env.GPU_ORCHESTRATOR_COMPOSE_DIR || '/opt/alice/compose/stacks';
const COMPOSE_ENV_FILE = process.env.GPU_ORCHESTRATOR_ENV_FILE || '/opt/alice/compose/.env.prod';
const TRAINING_ONLY_COMPOSE_FILE =
  process.env.GPU_ORCHESTRATOR_TRAINING_COMPOSE_FILE || `${COMPOSE_DIR}/docker-compose.gpu-training.yml`;
const COMPOSE_PROJECT = process.env.GPU_ORCHESTRATOR_PROJECT || 'alice-alice';
const DOCKER_COMPOSE_CMD = process.env.DOCKER_COMPOSE_CMD || 'docker compose';
const resolvedConcurrencyMode = process.env.GPU_CONCURRENCY_MODE ?? process.env.GPU_ORCHESTRATION_MODE ?? 'simultaneous';
if (resolvedConcurrencyMode !== 'simultaneous' && resolvedConcurrencyMode !== 'preemptive') {
  throw new Error(`GPU_CONCURRENCY_MODE inválido: ${resolvedConcurrencyMode}. Valores permitidos: simultaneous|preemptive`);
}
export const GPU_CONCURRENCY_MODE = resolvedConcurrencyMode;
// Compatibilidade retroativa para variáveis/código legado
export const GPU_ORCHESTRATION_MODE = GPU_CONCURRENCY_MODE;

/** Estado em memória da FSM */
let currentState: OrchestratorState = 'serving_ready';
const transitionListeners = new Set<TransitionListener>();

function isTransitionState(state: OrchestratorState): boolean {
  return (
    state === 'serving_draining'
    || state === 'training_starting'
    || state === 'training_finishing'
    || state === 'serving_restoring'
  );
}

async function transitionTo(
  nextState: OrchestratorState,
  params: { trigger: OrchestratorTransitionTrigger; reason: string },
): Promise<void> {
  if (currentState === nextState) {
    return;
  }

  const previousState = currentState;
  currentState = nextState;

  const transition: OrchestratorTransition = {
    fromState: previousState,
    toState: nextState,
    trigger: params.trigger,
    reason: params.reason,
    at: new Date().toISOString(),
  };

  logger.info(
    {
      fromState: transition.fromState,
      toState: transition.toState,
      trigger: transition.trigger,
      reason: transition.reason,
    },
    'FSM de orquestração GPU: transição de estado',
  );

  for (const listener of transitionListeners) {
    try {
      await listener(transition);
    } catch (error) {
      logger.error(
        {
          error,
          fromState: transition.fromState,
          toState: transition.toState,
          trigger: transition.trigger,
        },
        'Listener de transição da FSM falhou',
      );
    }
  }
}

/**
 * Executa comando docker compose (timeout configurável)
 */
async function runCompose(args: string[], timeoutMs = 60000): Promise<{ stdout: string; stderr: string }> {
  const envFileReadable = await isComposeEnvFileReadable();
  const cmdWithEnvFile = buildComposeCommand(args, { includeEnvFile: envFileReadable });
  try {
    const { stdout, stderr } = await execAsync(cmdWithEnvFile, {
      timeout: timeoutMs,
      env: { ...process.env, DOCKER_HOST: process.env.DOCKER_HOST || 'unix:///var/run/docker.sock' },
    });
    return { stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    const primaryError = error instanceof Error ? error.message : String(error);
    if (!envFileReadable) {
      const cmdTrainingOnly = buildComposeCommand(args, { includeEnvFile: false, mode: 'training_only' });
      logger.warn(
        { cmd: cmdWithEnvFile, composeEnvFile: COMPOSE_ENV_FILE, error: primaryError },
        'Compose sem env-file falhou; tentando compose dedicado do gpu-trainer',
      );
      return runComposeTrainingOnlyFallback({
        cmdTrainingOnly,
        timeoutMs,
        primaryError,
      });
    }

    if (!isEnvFilePermissionError(primaryError)) {
      logger.error({ cmd: cmdWithEnvFile, error: primaryError }, 'Falha ao executar docker compose');
      throw new Error(`docker compose failed: ${primaryError}`);
    }

    logger.warn(
      { cmd: cmdWithEnvFile, composeEnvFile: COMPOSE_ENV_FILE, error: primaryError },
      'Permissao negada no env-file do compose; tentando fallback com env do processo',
    );

    const cmdWithoutEnvFile = buildComposeCommand(args, { includeEnvFile: false });
      try {
        const { stdout, stderr } = await execAsync(cmdWithoutEnvFile, {
          timeout: timeoutMs,
          env: { ...process.env, DOCKER_HOST: process.env.DOCKER_HOST || 'unix:///var/run/docker.sock' },
        });
      logger.info({ cmd: cmdWithoutEnvFile }, 'Fallback sem env-file executado com sucesso');
      return { stdout: stdout.trim(), stderr: stderr.trim() };
    } catch (fallbackError) {
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      if (!isEnvFilePermissionError(fallbackMessage)) {
        logger.error(
          { cmd: cmdWithoutEnvFile, error: fallbackMessage, initialError: primaryError },
          'Falha ao executar docker compose no fallback sem env-file',
        );
        throw new Error(`docker compose failed: ${fallbackMessage}`);
      }

      const cmdTrainingOnly = buildComposeCommand(args, { includeEnvFile: false, mode: 'training_only' });
      logger.warn(
        { cmd: cmdTrainingOnly, error: fallbackMessage },
        'Fallback sem env-file ainda bloqueado; tentando compose dedicado do gpu-trainer',
      );
      return runComposeTrainingOnlyFallback({
        cmdTrainingOnly,
        timeoutMs,
        primaryError,
        previousError: fallbackMessage,
      });
    }
  }
}

async function isComposeEnvFileReadable(): Promise<boolean> {
  try {
    await access(COMPOSE_ENV_FILE, fsConstants.R_OK);
    return true;
  } catch (error) {
    logger.warn(
      {
        composeEnvFile: COMPOSE_ENV_FILE,
        error: error instanceof Error ? error.message : String(error),
      },
      'Env-file do compose indisponivel para leitura; fallback sem env-file sera aplicado',
    );
    return false;
  }
}

async function runComposeTrainingOnlyFallback(params: {
  cmdTrainingOnly: string;
  timeoutMs: number;
  primaryError: string;
  previousError?: string;
}): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execAsync(params.cmdTrainingOnly, {
      timeout: params.timeoutMs,
      env: { ...process.env, DOCKER_HOST: process.env.DOCKER_HOST || 'unix:///var/run/docker.sock' },
    });
    logger.info({ cmd: params.cmdTrainingOnly }, 'Fallback com compose dedicado do gpu-trainer executado com sucesso');
    return { stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (trainingOnlyError) {
    const trainingOnlyMessage = trainingOnlyError instanceof Error ? trainingOnlyError.message : String(trainingOnlyError);
    logger.error(
      {
        cmd: params.cmdTrainingOnly,
        error: trainingOnlyMessage,
        previousError: params.previousError,
        initialError: params.primaryError,
      },
      'Falha ao executar docker compose no fallback dedicado do gpu-trainer',
    );
    throw new Error(`docker compose failed: ${trainingOnlyMessage}`);
  }
}

function buildComposeCommand(
  args: string[],
  options: { includeEnvFile: boolean; mode?: 'full' | 'training_only' },
): string {
  const mode = options.mode ?? 'full';
  const base = `${COMPOSE_DIR}/docker-compose.base.yml`;
  const composeFiles = mode === 'training_only'
    ? [base, TRAINING_ONLY_COMPOSE_FILE]
    : [base, `${COMPOSE_DIR}/docker-compose.alice.yml`];
  const parts = [
    DOCKER_COMPOSE_CMD,
    `-p ${COMPOSE_PROJECT}`,
    ...composeFiles.flatMap((file) => [`-f ${file}`]),
    ...(options.includeEnvFile ? [`--env-file ${COMPOSE_ENV_FILE}`] : []),
    ...args,
  ];
  return `cd "${COMPOSE_DIR}" && ${parts.join(' ')}`;
}

function isEnvFilePermissionError(errorMessage: string): boolean {
  const normalized = errorMessage.toLowerCase();
  return normalized.includes('permission denied') && normalized.includes(COMPOSE_ENV_FILE.toLowerCase());
}

/**
 * Verifica se o orquestrador está disponível (socket + compose)
 */
export async function isOrchestratorAvailable(): Promise<boolean> {
  try {
    await execAsync('docker info', { timeout: 5000 });
    return true;
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'Orquestrador indisponivel: docker info falhou (socket/permissoes)',
    );
    return false;
  }
}

/**
 * Retorna estado atual
 */
export function getOrchestratorState(): OrchestratorState {
  return currentState;
}

export function isTrainingRuntimeState(state: OrchestratorState = currentState): boolean {
  return (
    state === 'training_starting'
    || state === 'training_active'
    || state === 'training_finishing'
  );
}

export function onOrchestratorTransition(listener: TransitionListener): () => void {
  transitionListeners.add(listener);
  return () => {
    transitionListeners.delete(listener);
  };
}

export async function prepareTrainingRuntime(options?: {
  trigger?: OrchestratorTransitionTrigger;
  reason?: string;
  waitForServingDrain?: () => Promise<ServingDrainResult>;
}): Promise<void> {
  const trigger = options?.trigger ?? 'system';
  const reason = options?.reason ?? 'Preparar runtime GPU para treinamento';

  if (currentState === 'training_active') {
    return;
  }
  if (isTransitionState(currentState)) {
    throw new Error('Transição de orquestração já em andamento');
  }

  await transitionTo('serving_draining', { trigger, reason: `${reason} - drenando serving` });

  try {
    if (options?.waitForServingDrain) {
      const drainResult = await options.waitForServingDrain();
      logger.info(
        {
          durationMs: drainResult.durationMs,
          inflightAtStart: drainResult.inflightAtStart,
          inflightAtFinish: drainResult.inflightAtFinish,
          forcedInterruptions: drainResult.forcedInterruptions,
          timedOut: drainResult.timedOut,
        },
        'Drain de serving concluído antes da preempção para treinamento',
      );
    }

    // Runtime mutuamente exclusivo: desliga serving antes de iniciar trainer.
    await runCompose(['stop', 'gpu-llm', 'gpu-embeddings'], 90000);

    await transitionTo('training_starting', { trigger, reason: `${reason} - iniciando trainer` });
    await runCompose(['--profile', GPU_TRAINING_PROFILE, 'up', '-d', 'gpu-trainer'], 120000);

    await transitionTo('training_active', { trigger, reason: `${reason} - treinamento ativo` });
  } catch (error) {
    await transitionTo('error', {
      trigger,
      reason: `${reason} - falha: ${error instanceof Error ? error.message : String(error)}`,
    });
    throw error;
  }
}

export async function restoreServingRuntime(options?: {
  trigger?: OrchestratorTransitionTrigger;
  reason?: string;
}): Promise<void> {
  const trigger = options?.trigger ?? 'system';
  const reason = options?.reason ?? 'Restaurar runtime de serving';

  if (currentState === 'serving_ready') {
    return;
  }
  if (isTransitionState(currentState)) {
    throw new Error('Transição de orquestração já em andamento');
  }

  const isRecoveringFromError = currentState === 'error';
  if (!isRecoveringFromError) {
    await transitionTo('training_finishing', { trigger, reason: `${reason} - finalizando treinamento` });
  }

  try {
    await runCompose(['--profile', GPU_TRAINING_PROFILE, 'stop', 'gpu-trainer'], 90000);

    await transitionTo('serving_restoring', { trigger, reason: `${reason} - restaurando serving` });
    await runCompose(['up', '-d', 'gpu-llm', 'gpu-embeddings'], 120000);

    await transitionTo('serving_ready', { trigger, reason: `${reason} - serving pronto` });
  } catch (error) {
    await transitionTo('error', {
      trigger,
      reason: `${reason} - falha: ${error instanceof Error ? error.message : String(error)}`,
    });
    throw error;
  }
}

/**
 * Compatibilidade retroativa de API interna.
 */
export async function switchToTraining(): Promise<void> {
  await prepareTrainingRuntime({ trigger: 'system', reason: 'Alias compatível switchToTraining' });
}

/**
 * Compatibilidade retroativa de API interna.
 */
export async function switchToLlmEmbeddings(): Promise<void> {
  await restoreServingRuntime({ trigger: 'system', reason: 'Alias compatível switchToLlmEmbeddings' });
}

/**
 * Semântica mantida por compatibilidade; retorno automático por idle foi removido.
 */
export function reportTrainingActivity(): void {
  logger.debug('reportTrainingActivity chamado; idle return desabilitado na FSM canônica');
}

/**
 * Cleanup (shutdown)
 */
export function shutdownOrchestrator(): void {
  transitionListeners.clear();
}
