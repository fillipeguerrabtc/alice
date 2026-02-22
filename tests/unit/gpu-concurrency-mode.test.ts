import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_GPU_CONCURRENCY_MODE = process.env.GPU_CONCURRENCY_MODE;
const ORIGINAL_GPU_ORCHESTRATION_MODE = process.env.GPU_ORCHESTRATION_MODE;

afterEach(() => {
  if (ORIGINAL_GPU_CONCURRENCY_MODE === undefined) {
    delete process.env.GPU_CONCURRENCY_MODE;
  } else {
    process.env.GPU_CONCURRENCY_MODE = ORIGINAL_GPU_CONCURRENCY_MODE;
  }

  if (ORIGINAL_GPU_ORCHESTRATION_MODE === undefined) {
    delete process.env.GPU_ORCHESTRATION_MODE;
  } else {
    process.env.GPU_ORCHESTRATION_MODE = ORIGINAL_GPU_ORCHESTRATION_MODE;
  }
});

describe('GPU_CONCURRENCY_MODE resolution', () => {
  it('prefers GPU_CONCURRENCY_MODE over legacy env', async () => {
    vi.resetModules();
    process.env.GPU_CONCURRENCY_MODE = 'preemptive';
    process.env.GPU_ORCHESTRATION_MODE = 'simultaneous';

    const mod = await import('../../apps/gpu-manager-service/src/gpu-orchestrator');
    expect(mod.GPU_CONCURRENCY_MODE).toBe('preemptive');
    expect(mod.GPU_ORCHESTRATION_MODE).toBe('preemptive');
  });

  it('fails fast for invalid values', async () => {
    vi.resetModules();
    process.env.GPU_CONCURRENCY_MODE = 'invalid';
    delete process.env.GPU_ORCHESTRATION_MODE;

    await expect(import('../../apps/gpu-manager-service/src/gpu-orchestrator')).rejects.toThrow(
      'GPU_CONCURRENCY_MODE inválido',
    );
  });
});
