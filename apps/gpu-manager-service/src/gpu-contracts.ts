/** Prioridades de requisições GPU (maior = mais prioritário) */
export enum GpuRequestPriority {
  CRITICAL = 10,
  HIGH = 8,
  MEDIUM = 5,
  LOW = 2,
}

/** Tipos de serviços GPU */
export enum GpuServiceType {
  LLM = 'llm',
  EMBEDDINGS = 'embeddings',
  TRAINING = 'training',
}

/** Label model-agnóstico para observabilidade */
export type GpuCapability = 'llm' | 'embeddings' | 'training';

export interface GpuRequest {
  id: string;
  serviceType: GpuServiceType;
  priority: GpuRequestPriority;
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
  tenantId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  retries: number;
  maxRetries: number;
}

export interface GpuResponse {
  success: boolean;
  data?: unknown;
  error?: string;
  latencyMs: number;
  vramUsedGB?: number;
}

export interface VramStatus {
  totalGB: number;
  usedGB: number;
  freeGB: number;
  utilizationPercent: number;
  activeServices: GpuServiceType[];
}
