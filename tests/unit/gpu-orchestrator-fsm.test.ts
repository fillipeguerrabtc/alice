import { afterEach, describe, expect, it, vi } from 'vitest';

type ExecScenario = {
  error?: string;
  stdout?: string;
  stderr?: string;
};

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;

const { execMock, execQueue } = vi.hoisted(() => {
  const queue: ExecScenario[] = [];
  const promisifyCustom = Symbol.for('nodejs.util.promisify.custom');

  const mock = vi.fn(
    (
      _command: string,
      optionsOrCallback: ExecCallback | Record<string, unknown>,
      maybeCallback?: ExecCallback,
    ) => {
      const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
      if (!callback) {
        throw new Error('Callback ausente no mock de exec');
      }

      const scenario = queue.shift();
      if (scenario?.error) {
        callback(new Error(scenario.error), scenario.stdout ?? '', scenario.stderr ?? '');
        return {} as never;
      }

      callback(null, scenario?.stdout ?? '', scenario?.stderr ?? '');
      return {} as never;
    },
  );

  (mock as unknown as Record<symbol, unknown>)[promisifyCustom] = (
    command: string,
    options?: Record<string, unknown>,
  ) =>
    new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      mock(command, options ?? {}, (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      });
    });

  return {
    execMock: mock,
    execQueue: queue,
  };
});

vi.mock('child_process', () => ({
  exec: execMock,
}));

vi.mock('@alice/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const ORIGINAL_GPU_CONCURRENCY_MODE = process.env.GPU_CONCURRENCY_MODE;
const ORIGINAL_GPU_ORCHESTRATOR_COMPOSE_DIR = process.env.GPU_ORCHESTRATOR_COMPOSE_DIR;
const ORIGINAL_GPU_ORCHESTRATOR_ENV_FILE = process.env.GPU_ORCHESTRATOR_ENV_FILE;

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  execQueue.splice(0, execQueue.length);

  if (ORIGINAL_GPU_CONCURRENCY_MODE === undefined) {
    delete process.env.GPU_CONCURRENCY_MODE;
  } else {
    process.env.GPU_CONCURRENCY_MODE = ORIGINAL_GPU_CONCURRENCY_MODE;
  }

  if (ORIGINAL_GPU_ORCHESTRATOR_COMPOSE_DIR === undefined) {
    delete process.env.GPU_ORCHESTRATOR_COMPOSE_DIR;
  } else {
    process.env.GPU_ORCHESTRATOR_COMPOSE_DIR = ORIGINAL_GPU_ORCHESTRATOR_COMPOSE_DIR;
  }

  if (ORIGINAL_GPU_ORCHESTRATOR_ENV_FILE === undefined) {
    delete process.env.GPU_ORCHESTRATOR_ENV_FILE;
  } else {
    process.env.GPU_ORCHESTRATOR_ENV_FILE = ORIGINAL_GPU_ORCHESTRATOR_ENV_FILE;
  }
});

describe('gpu-orchestrator FSM transitions', () => {
  it('executa ciclo principal de prepare-training e restore-serving com sucesso', async () => {
    process.env.GPU_CONCURRENCY_MODE = 'preemptive';
    process.env.GPU_ORCHESTRATOR_COMPOSE_DIR = '/opt/alice/compose/stacks';
    process.env.GPU_ORCHESTRATOR_ENV_FILE = '/opt/alice/compose/.env.prod';

    execQueue.push({ stdout: 'serving drained' });
    execQueue.push({ stdout: 'training started' });
    execQueue.push({ stdout: 'training stopped' });
    execQueue.push({ stdout: 'serving restored' });
    const waitForServingDrain = vi.fn(async () => ({
      durationMs: 12,
      inflightAtStart: 1,
      inflightAtFinish: 0,
      forcedInterruptions: 0,
      timedOut: false,
    }));

    const mod = await import('../../apps/gpu-manager-service/src/gpu-orchestrator');

    expect(mod.getOrchestratorState()).toBe('serving_ready');
    await mod.prepareTrainingRuntime({ trigger: 'manual_api', reason: 'teste', waitForServingDrain });
    expect(mod.getOrchestratorState()).toBe('training_active');
    expect(waitForServingDrain).toHaveBeenCalledTimes(1);

    await mod.restoreServingRuntime({ trigger: 'manual_api', reason: 'teste' });
    expect(mod.getOrchestratorState()).toBe('serving_ready');

    expect(execMock).toHaveBeenCalledTimes(4);
    const commands = execMock.mock.calls.map((call) => String(call[0]));
    expect(commands[0]).toContain('stop gpu-llm gpu-embeddings');
    expect(commands[1]).toContain('--profile gpu-training up -d gpu-trainer');
    expect(commands[2]).toContain('--profile gpu-training stop gpu-trainer');
    expect(commands[3]).toContain('up -d gpu-llm gpu-embeddings');
  });

  it('aplica preempção mesmo quando drain retorna timeout com corte forçado', async () => {
    process.env.GPU_CONCURRENCY_MODE = 'preemptive';

    execQueue.push({ stdout: 'serving drained' });
    execQueue.push({ stdout: 'training started' });

    const mod = await import('../../apps/gpu-manager-service/src/gpu-orchestrator');
    await mod.prepareTrainingRuntime({
      trigger: 'queue_request',
      reason: 'drain com corte',
      waitForServingDrain: async () => ({
        durationMs: 30000,
        inflightAtStart: 3,
        inflightAtFinish: 1,
        forcedInterruptions: 2,
        timedOut: true,
      }),
    });

    expect(mod.getOrchestratorState()).toBe('training_active');
    expect(execMock).toHaveBeenCalledTimes(2);
    const commands = execMock.mock.calls.map((call) => String(call[0]));
    expect(commands[0]).toContain('stop gpu-llm gpu-embeddings');
    expect(commands[1]).toContain('--profile gpu-training up -d gpu-trainer');
  });

  it('move FSM para error quando callback de drain falha', async () => {
    process.env.GPU_CONCURRENCY_MODE = 'preemptive';

    const mod = await import('../../apps/gpu-manager-service/src/gpu-orchestrator');
    await expect(
      mod.prepareTrainingRuntime({
        trigger: 'queue_request',
        reason: 'teste falha drain',
        waitForServingDrain: async () => {
          throw new Error('drain callback failed');
        },
      }),
    ).rejects.toThrow('drain callback failed');
    expect(mod.getOrchestratorState()).toBe('error');
  });

  it('move FSM para error quando falha no prepare-training', async () => {
    process.env.GPU_CONCURRENCY_MODE = 'preemptive';

    execQueue.push({ stdout: 'serving drained' });
    execQueue.push({ error: 'trainer start failed' });

    const mod = await import('../../apps/gpu-manager-service/src/gpu-orchestrator');

    await expect(
      mod.prepareTrainingRuntime({ trigger: 'queue_request', reason: 'teste falha prepare' }),
    ).rejects.toThrow('docker compose failed');
    expect(mod.getOrchestratorState()).toBe('error');
  });

  it('move FSM para error quando falha no restore-serving', async () => {
    process.env.GPU_CONCURRENCY_MODE = 'preemptive';

    execQueue.push({ stdout: 'serving drained' });
    execQueue.push({ stdout: 'training started' });
    execQueue.push({ stdout: 'training stopped' });
    execQueue.push({ error: 'serving restore failed' });

    const mod = await import('../../apps/gpu-manager-service/src/gpu-orchestrator');

    await mod.prepareTrainingRuntime({ trigger: 'queue_request', reason: 'setup treino' });
    await expect(
      mod.restoreServingRuntime({ trigger: 'manual_api', reason: 'teste falha restore' }),
    ).rejects.toThrow('docker compose failed');
    expect(mod.getOrchestratorState()).toBe('error');
  });
});
