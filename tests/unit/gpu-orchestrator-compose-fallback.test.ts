import { afterEach, describe, expect, it, vi } from 'vitest';

type ExecScenario = {
  error?: string;
  stdout?: string;
  stderr?: string;
};

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;

const { execMock, execQueue, loggerMock } = vi.hoisted(() => {
  const queue: ExecScenario[] = [];
  const promisifyCustom = Symbol.for('nodejs.util.promisify.custom');
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

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

  return { execMock: mock, execQueue: queue, loggerMock: logger };
});

vi.mock('child_process', () => ({
  exec: execMock,
}));

vi.mock('@alice/logger', () => ({
  createLogger: () => loggerMock,
}));

const ORIGINAL_ENV = {
  GPU_CONCURRENCY_MODE: process.env.GPU_CONCURRENCY_MODE,
  GPU_ORCHESTRATOR_COMPOSE_DIR: process.env.GPU_ORCHESTRATOR_COMPOSE_DIR,
  GPU_ORCHESTRATOR_ENV_FILE: process.env.GPU_ORCHESTRATOR_ENV_FILE,
  GPU_ORCHESTRATOR_TRAINING_COMPOSE_FILE: process.env.GPU_ORCHESTRATOR_TRAINING_COMPOSE_FILE,
};

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  execQueue.splice(0, execQueue.length);

  if (ORIGINAL_ENV.GPU_CONCURRENCY_MODE === undefined) {
    delete process.env.GPU_CONCURRENCY_MODE;
  } else {
    process.env.GPU_CONCURRENCY_MODE = ORIGINAL_ENV.GPU_CONCURRENCY_MODE;
  }

  if (ORIGINAL_ENV.GPU_ORCHESTRATOR_COMPOSE_DIR === undefined) {
    delete process.env.GPU_ORCHESTRATOR_COMPOSE_DIR;
  } else {
    process.env.GPU_ORCHESTRATOR_COMPOSE_DIR = ORIGINAL_ENV.GPU_ORCHESTRATOR_COMPOSE_DIR;
  }

  if (ORIGINAL_ENV.GPU_ORCHESTRATOR_ENV_FILE === undefined) {
    delete process.env.GPU_ORCHESTRATOR_ENV_FILE;
  } else {
    process.env.GPU_ORCHESTRATOR_ENV_FILE = ORIGINAL_ENV.GPU_ORCHESTRATOR_ENV_FILE;
  }

  if (ORIGINAL_ENV.GPU_ORCHESTRATOR_TRAINING_COMPOSE_FILE === undefined) {
    delete process.env.GPU_ORCHESTRATOR_TRAINING_COMPOSE_FILE;
  } else {
    process.env.GPU_ORCHESTRATOR_TRAINING_COMPOSE_FILE = ORIGINAL_ENV.GPU_ORCHESTRATOR_TRAINING_COMPOSE_FILE;
  }
});

describe('gpu-orchestrator docker compose fallback', () => {
  it('faz fallback sem --env-file quando ocorrer permission denied no env-file', async () => {
    process.env.GPU_CONCURRENCY_MODE = 'simultaneous';
    process.env.GPU_ORCHESTRATOR_COMPOSE_DIR = '/opt/alice/compose/stacks';
    process.env.GPU_ORCHESTRATOR_ENV_FILE = '/opt/alice/compose/.env.prod';

    execQueue.push({ stdout: 'serving drained' });
    execQueue.push({
      error:
        'Command failed: docker compose --env-file /opt/alice/compose/.env.prod\nopen /opt/alice/compose/.env.prod: permission denied',
    });
    execQueue.push({ stdout: 'gpu-trainer started' });

    const mod = await import('../../apps/gpu-manager-service/src/gpu-orchestrator');
    await mod.switchToTraining();

    expect(execMock).toHaveBeenCalledTimes(3);
    const firstCmd = execMock.mock.calls[0]?.[0] as string;
    const secondCmd = execMock.mock.calls[1]?.[0] as string;
    const thirdCmd = execMock.mock.calls[2]?.[0] as string;

    expect(firstCmd).toContain('--env-file /opt/alice/compose/.env.prod');
    expect(firstCmd).toContain('stop gpu-llm gpu-embeddings');
    expect(secondCmd).toContain('--env-file /opt/alice/compose/.env.prod');
    expect(secondCmd).toContain('--profile gpu-training up -d gpu-trainer');
    expect(thirdCmd).not.toContain('--env-file');
    expect(thirdCmd).toContain('--profile gpu-training up -d gpu-trainer');
    expect(mod.getOrchestratorState()).toBe('training_active');
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
  });

  it('nao faz fallback para erros que nao sao de permissao no env-file', async () => {
    process.env.GPU_CONCURRENCY_MODE = 'simultaneous';
    process.env.GPU_ORCHESTRATOR_COMPOSE_DIR = '/opt/alice/compose/stacks';
    process.env.GPU_ORCHESTRATOR_ENV_FILE = '/opt/alice/compose/.env.prod';

    execQueue.push({ stdout: 'serving drained' });
    execQueue.push({
      error: 'Command failed: docker compose ... error: got unexpected EOF from daemon',
    });

    const mod = await import('../../apps/gpu-manager-service/src/gpu-orchestrator');

    await expect(mod.switchToTraining()).rejects.toThrow('docker compose failed');
    expect(execMock).toHaveBeenCalledTimes(2);
    expect(loggerMock.warn).not.toHaveBeenCalled();
  });

  it('usa compose dedicado do gpu-trainer quando fallback sem --env-file continua falhando por permissao', async () => {
    process.env.GPU_CONCURRENCY_MODE = 'simultaneous';
    process.env.GPU_ORCHESTRATOR_COMPOSE_DIR = '/opt/alice/compose/stacks';
    process.env.GPU_ORCHESTRATOR_ENV_FILE = '/opt/alice/compose/.env.prod';

    execQueue.push({ stdout: 'serving drained' });
    execQueue.push({
      error:
        'Command failed: docker compose --env-file /opt/alice/compose/.env.prod\nopen /opt/alice/compose/.env.prod: permission denied',
    });
    execQueue.push({
      error:
        'Command failed: docker compose ...\nfailed to load /opt/alice/compose/.env.prod: open /opt/alice/compose/.env.prod: permission denied',
    });
    execQueue.push({ stdout: 'gpu-trainer started with dedicated compose' });

    const mod = await import('../../apps/gpu-manager-service/src/gpu-orchestrator');
    await mod.switchToTraining();

    expect(execMock).toHaveBeenCalledTimes(4);
    const firstCmd = execMock.mock.calls[0]?.[0] as string;
    const secondCmd = execMock.mock.calls[1]?.[0] as string;
    const thirdCmd = execMock.mock.calls[2]?.[0] as string;
    const fourthCmd = execMock.mock.calls[3]?.[0] as string;

    expect(firstCmd).toContain('--env-file /opt/alice/compose/.env.prod');
    expect(firstCmd).toContain('stop gpu-llm gpu-embeddings');
    expect(secondCmd).toContain('/opt/alice/compose/stacks/docker-compose.alice.yml');
    expect(secondCmd).toContain('--profile gpu-training up -d gpu-trainer');
    expect(secondCmd).toContain('--env-file /opt/alice/compose/.env.prod');
    expect(thirdCmd).toContain('/opt/alice/compose/stacks/docker-compose.alice.yml');
    expect(thirdCmd).not.toContain('--env-file');
    expect(fourthCmd).toContain('/opt/alice/compose/stacks/docker-compose.gpu-training.yml');
    expect(fourthCmd).not.toContain('/opt/alice/compose/stacks/docker-compose.alice.yml');
    expect(fourthCmd).toContain('--profile gpu-training up -d gpu-trainer');
    expect(mod.getOrchestratorState()).toBe('training_active');
  });
});
