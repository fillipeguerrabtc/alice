import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import { admissionControlReason } from '../../apps/gpu-manager-service/src/gpu-admission';
import { GpuRequestPriority, GpuServiceType, type VramStatus } from '../../apps/gpu-manager-service/src/gpu-contracts';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: vi.fn(),
} as unknown as Logger;

const baseVramStatus: VramStatus = {
  totalGB: 20,
  usedGB: 4,
  freeGB: 16,
  utilizationPercent: 20,
  activeServices: [GpuServiceType.LLM, GpuServiceType.EMBEDDINGS],
};

const vramRequirements: Record<GpuServiceType, number> = {
  [GpuServiceType.LLM]: 6,
  [GpuServiceType.EMBEDDINGS]: 3,
  [GpuServiceType.TRAINING]: 8,
};

const admissionMinFreeGb: Record<GpuServiceType, number> = {
  [GpuServiceType.LLM]: 2,
  [GpuServiceType.EMBEDDINGS]: 1.5,
  [GpuServiceType.TRAINING]: 2,
};

describe('gpu-admission preemption and transition reasons', () => {
  it('rejeita inferência com serving_preempted_for_training quando preempção está ativa', () => {
    const reason = admissionControlReason({
      serviceType: GpuServiceType.LLM,
      priority: GpuRequestPriority.HIGH,
      vramStatus: baseVramStatus,
      vramRequirements,
      vramSafetyMarginGb: 2,
      admissionMinFreeGb,
      isTransitionInProgress: true,
      isServingPreemptedForTraining: true,
      logger,
    });

    expect(reason).toBe('serving_preempted_for_training');
  });

  it('rejeita inferência com transition_in_progress quando runtime está em transição', () => {
    const reason = admissionControlReason({
      serviceType: GpuServiceType.EMBEDDINGS,
      priority: GpuRequestPriority.MEDIUM,
      vramStatus: baseVramStatus,
      vramRequirements,
      vramSafetyMarginGb: 2,
      admissionMinFreeGb,
      isTransitionInProgress: true,
      isServingPreemptedForTraining: false,
      logger,
    });

    expect(reason).toBe('transition_in_progress');
  });

  it('não aplica bloqueio de transição/preempção para requests de training', () => {
    const reason = admissionControlReason({
      serviceType: GpuServiceType.TRAINING,
      priority: GpuRequestPriority.HIGH,
      vramStatus: baseVramStatus,
      vramRequirements,
      vramSafetyMarginGb: 2,
      admissionMinFreeGb,
      isTransitionInProgress: true,
      isServingPreemptedForTraining: true,
      logger,
    });

    expect(reason).toBeNull();
  });
});
