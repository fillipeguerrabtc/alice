import crypto from 'node:crypto';
import { z } from 'zod';

export const TRAINING_EMBEDDING_DEDUPE_QUEUE = 'alice:training:embedding-dedupe';

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
