import type { Logger } from 'pino';
import {
  GpuRequestPriority,
  GpuServiceType,
  type GpuCapability,
  type VramStatus,
} from './gpu-contracts.js';

export type GpuRejectionReason = 'insufficient_vram' | 'low_vram_low_priority' | 'gpu_busy' | 'simultaneous_policy';

export function capabilityForServiceType(serviceType: GpuServiceType): GpuCapability {
  switch (serviceType) {
    case GpuServiceType.LLM:
      return 'llm';
    case GpuServiceType.EMBEDDINGS:
      return 'embeddings';
    case GpuServiceType.TRAINING:
      return 'training';
  }
}

export function hasEnoughVram(params: {
  serviceType: GpuServiceType;
  currentVram: VramStatus;
  vramRequirements: Record<GpuServiceType, number>;
  vramSafetyMarginGb: number;
}): boolean {
  const { serviceType, currentVram, vramRequirements, vramSafetyMarginGb } = params;

  if (currentVram.activeServices.includes(serviceType)) {
    return true;
  }

  const required = vramRequirements[serviceType];
  const available = currentVram.freeGB;
  return available >= (required + vramSafetyMarginGb);
}

function isLowPriority(priority: GpuRequestPriority): boolean {
  return priority <= GpuRequestPriority.MEDIUM;
}

export function admissionControlReason(params: {
  serviceType: GpuServiceType;
  priority: GpuRequestPriority;
  vramStatus: VramStatus;
  vramRequirements: Record<GpuServiceType, number>;
  vramSafetyMarginGb: number;
  admissionMinFreeGb: Record<GpuServiceType, number>;
  logger: Logger;
}): GpuRejectionReason | null {
  const {
    serviceType,
    priority,
    vramStatus,
    vramRequirements,
    vramSafetyMarginGb,
    admissionMinFreeGb,
    logger,
  } = params;

  const reason = (() => {
    if (!hasEnoughVram({
      serviceType,
      currentVram: vramStatus,
      vramRequirements,
      vramSafetyMarginGb,
    })) {
      return 'insufficient_vram' as const;
    }
    if (isLowPriority(priority) && vramStatus.freeGB < admissionMinFreeGb[serviceType]) {
      return 'low_vram_low_priority' as const;
    }
    return null;
  })();

  logger.info({
    serviceType,
    priority,
    freeGB: vramStatus.freeGB,
    usedGB: vramStatus.usedGB,
    threshold: admissionMinFreeGb[serviceType],
    required: vramRequirements[serviceType],
    safetyMargin: vramSafetyMarginGb,
    activeServices: vramStatus.activeServices,
    decision: reason ?? 'admitted',
  }, reason ? `Admission control: ${reason}` : 'Admission control: requisição admitida');

  return reason;
}
