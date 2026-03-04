import crypto from 'node:crypto';
import { z } from 'zod';

export const TRAINING_EMBEDDING_DEDUPE_QUEUE = 'alice:training:embedding-dedupe';
export const TRAINING_NAMESPACE_PROFILE_RECONCILE_QUEUE = 'alice:training:namespace-profile-reconcile';
export const TRAINING_DATA_POLICY_GATE_QUEUE = 'alice:training:data-policy-gate';
export const TRAINING_FINE_TUNING_QUEUE = 'alice:training:fine-tuning';
export const TRAINING_FINE_TUNING_QUEUE_HIGH = `${TRAINING_FINE_TUNING_QUEUE}:high`;
export const TRAINING_FINE_TUNING_QUEUE_NORMAL = `${TRAINING_FINE_TUNING_QUEUE}:normal`;
export const TRAINING_FINE_TUNING_QUEUE_LOW = `${TRAINING_FINE_TUNING_QUEUE}:low`;

export const trainingRunPrioritySchema = z.enum(['low', 'normal', 'high']);
export type TrainingRunPriority = z.infer<typeof trainingRunPrioritySchema>;

export const trainingEmbeddingDedupeQueuePayloadSchema = z.object({
  trainingDataId: z.string().uuid(),
  tenantId: z.string().uuid(),
  namespaceId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  semhash: z.string().min(1).max(64),
  sourceType: z.string().min(1).max(50),
  sourceId: z.string().min(1).max(255).optional(),
  idempotencyKey: z.string().min(64).max(64),
  createdAt: z.string().datetime(),
}).strict();

export type TrainingEmbeddingDedupeQueuePayload = z.infer<typeof trainingEmbeddingDedupeQueuePayloadSchema>;

export const trainingNamespaceProfileReconcileQueuePayloadSchema = z.object({
  runId: z.string().uuid(),
  idempotencyKey: z.string().min(64).max(64),
  createdAt: z.string().datetime(),
}).strict();

export type TrainingNamespaceProfileReconcileQueuePayload = z.infer<typeof trainingNamespaceProfileReconcileQueuePayloadSchema>;

export const trainingDataPolicyGateQueuePayloadSchema = z.object({
  trainingDataId: z.string().uuid(),
  tenantId: z.string().uuid(),
  namespaceId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  semhash: z.string().min(1).max(64),
  idempotencyKey: z.string().min(64).max(64),
  createdAt: z.string().datetime(),
}).strict();

export type TrainingDataPolicyGateQueuePayload = z.infer<typeof trainingDataPolicyGateQueuePayloadSchema>;

export const trainingFineTuningQueuePayloadSchema = z.object({
  runId: z.string().uuid(),
  fineTuningJobId: z.string().uuid(),
  tenantId: z.string().uuid(),
  priority: trainingRunPrioritySchema.default('normal'),
  requestedBy: z.string().uuid().optional(),
  idempotencyKey: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string().datetime(),
}).strict();

export type TrainingFineTuningQueuePayload = z.infer<typeof trainingFineTuningQueuePayloadSchema>;

export function buildTrainingIdempotencyKey(params: {
  tenantId: string;
  sourceType: string;
  sourceId?: string | null;
  semhash: string;
}): string {
  const input = [
    params.tenantId.trim(),
    params.sourceType.trim(),
    params.sourceId?.trim() ?? '',
    params.semhash.trim(),
  ].join(':');
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function buildNamespaceProfileReconcileIdempotencyKey(params: {
  runId: string;
}): string {
  const input = [params.runId.trim()].join(':');
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function buildTrainingPolicyGateIdempotencyKey(params: {
  tenantId: string;
  trainingDataId: string;
  semhash: string;
}): string {
  const input = [
    params.tenantId.trim(),
    params.trainingDataId.trim(),
    params.semhash.trim(),
  ].join(':');
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function buildTrainingFineTuningIdempotencyKey(params: {
  fineTuningJobId: string;
}): string {
  const input = [params.fineTuningJobId.trim()].join(':');
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function resolveTrainingFineTuningQueue(priority: TrainingRunPriority | null | undefined): string {
  if (priority === 'high') return TRAINING_FINE_TUNING_QUEUE_HIGH;
  if (priority === 'low') return TRAINING_FINE_TUNING_QUEUE_LOW;
  return TRAINING_FINE_TUNING_QUEUE_NORMAL;
}
