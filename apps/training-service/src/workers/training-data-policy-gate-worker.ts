import type { Database } from '@alice/database';
import { and, eq, schema } from '@alice/database';
import { getNamespaceProfileDefaultConfig, getSystemConfig } from '@alice/database/system-config';
import { createLogger } from '@alice/logger';
import { NamespaceProfileConfigSchema } from '@alice/shared';
import {
  callGatewayComplete,
  getRedisClient,
  GpuRequestPriority,
  GpuServiceType,
  isGatewayConfigured,
  RedisStreamQueue,
  requestGpu,
  TRAINING_DATA_POLICY_GATE_QUEUE,
  trainingDataPolicyGateQueuePayloadSchema,
} from '@alice/shared-utils';
import { z } from 'zod';

const logger = createLogger('training-policy-gate-worker');

const PROCESSING_LOCK_TTL_SECONDS = 600;
const QUEUE_STREAM_MAX_LEN = 20_000;

const llmJudgeResponseSchema = z.object({
  relevance: z.number().min(0).max(1),
  correctnessRisk: z.number().min(0).max(1),
  piiRisk: z.number().min(0).max(1),
  realtimeClaimsRisk: z.number().min(0).max(1),
  formatCompliance: z.number().min(0).max(1),
  overallScore: z.number().min(0).max(1),
  recommendedAction: z.enum(['approve', 'pending', 'quarantine', 'reject']),
  notes: z.string().min(1).max(1200),
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadDefaultProfileConfig() {
  return getNamespaceProfileDefaultConfig();
}

function parseGatewayContent(content: string): unknown {
  const trimmed = content.trim();
  if (trimmed.startsWith('```')) {
    return JSON.parse(trimmed.replace(/^```[a-z]*\s*/i, '').replace(/```$/, '').trim());
  }
  return JSON.parse(trimmed);
}

async function runLlmJudge(params: {
  tenantId: string;
  userId?: string;
  namespaceId?: string | null;
  prompt: string;
  model: string;
  temperature: number;
  maxTokens: number;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
}): Promise<z.infer<typeof llmJudgeResponseSchema>> {
  const judgeMessages = [
    { role: 'system' as const, content: params.prompt },
    { role: 'user' as const, content: JSON.stringify(params.messages) },
  ];

  if (isGatewayConfigured()) {
    const gatewayResult = await callGatewayComplete({
      messages: judgeMessages,
      config: {
        model: params.model,
        temperature: params.temperature,
        maxTokens: params.maxTokens,
      },
      context: {
        route: '/training/policy-gate/judge',
        tenantId: params.tenantId,
        userId: params.userId,
        namespaceId: params.namespaceId ?? undefined,
      },
      requestOptions: { timeout: 120_000, priority: 'high' },
    });
    if (!gatewayResult.success || !gatewayResult.data) {
      throw new Error(gatewayResult.error || 'Falha no llm-gateway-service para policy gate');
    }
    const gatewayData = gatewayResult.data as { choices?: Array<{ message?: { content?: string } }> };
    const rawContent = String(gatewayData.choices?.[0]?.message?.content ?? '');
    return llmJudgeResponseSchema.parse(parseGatewayContent(rawContent));
  }

  const gpuResult = await requestGpu({
    serviceType: GpuServiceType.LLM,
    endpoint: '/v1/chat/completions',
    method: 'POST',
    priority: GpuRequestPriority.HIGH,
    timeout: 120_000,
    body: {
      model: params.model,
      messages: judgeMessages,
      max_tokens: params.maxTokens,
      temperature: params.temperature,
      stream: false,
    },
  });
  if (!gpuResult.success || !gpuResult.data) {
    throw new Error(gpuResult.error || 'Falha no gpu-manager para policy gate');
  }
  const gpuData = gpuResult.data as { choices?: Array<{ message?: { content?: string } }> };
  const rawContent = String(gpuData.choices?.[0]?.message?.content ?? '');
  return llmJudgeResponseSchema.parse(parseGatewayContent(rawContent));
}

export function createTrainingDataPolicyGateWorker(params: {
  db: Database;
  pollIntervalMs: number;
}): () => Promise<void> {
  const queue = new RedisStreamQueue(TRAINING_DATA_POLICY_GATE_QUEUE, {
    group: 'training-service',
    consumer: `training-policy-gate-${process.pid}`,
    maxRetries: 3,
    autoClaimCount: 10,
    streamMaxLen: QUEUE_STREAM_MAX_LEN,
  });

  let stopped = false;
  const stopToken = { isStopped: () => stopped };

  const runLoop = async () => {
    const redis = getRedisClient();
    if (!redis) {
      logger.warn({ queue: TRAINING_DATA_POLICY_GATE_QUEUE }, 'Redis indisponível para worker de policy gate');
      return;
    }

    await queue.consumeLoop(
      redis,
      async (rawPayload) => {
        const payload = trainingDataPolicyGateQueuePayloadSchema.parse(rawPayload);
        const lockKey = `${TRAINING_DATA_POLICY_GATE_QUEUE}:processing:${payload.idempotencyKey}`;
        const lock = await redis.set(lockKey, payload.trainingDataId, { NX: true, EX: PROCESSING_LOCK_TTL_SECONDS });
        if (!lock) return;

        try {
          const item = await params.db.query.trainingData.findFirst({
            where: and(
              eq(schema.trainingData.id, payload.trainingDataId),
              eq(schema.trainingData.tenantId, payload.tenantId)
            ),
          });
          if (!item) return;

          const defaultConfig = await loadDefaultProfileConfig();
          const profile = payload.namespaceId
            ? await params.db.query.namespaceProfiles.findFirst({
              where: and(
                eq(schema.namespaceProfiles.tenantId, payload.tenantId),
                eq(schema.namespaceProfiles.namespaceId, payload.namespaceId)
              ),
            })
            : null;
          const profileConfig = profile
            ? NamespaceProfileConfigSchema.parse(profile.config)
            : defaultConfig;

          if (!profileConfig.quality.llmJudge.enabled) return;

          const judgePrompt = await getSystemConfig(profileConfig.quality.llmJudge.promptSystemConfigKey);
          if (!judgePrompt) {
            throw new Error(`Prompt do LLM Judge ausente em system_config: ${profileConfig.quality.llmJudge.promptSystemConfigKey}`);
          }

          const judgeResult = await runLlmJudge({
            tenantId: payload.tenantId,
            userId: payload.userId,
            namespaceId: payload.namespaceId ?? null,
            prompt: judgePrompt,
            model: profileConfig.quality.llmJudge.model,
            temperature: profileConfig.quality.llmJudge.temperature,
            maxTokens: profileConfig.quality.llmJudge.maxTokens,
            messages: item.messages as Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
          });

          const mergedScore = Math.max(0, Math.min(1, ((item.qualityScore ?? 0) + judgeResult.overallScore) / 2));
          const shouldReject = judgeResult.recommendedAction === 'reject';
          const shouldQuarantine = judgeResult.recommendedAction === 'quarantine' || judgeResult.recommendedAction === 'pending';
          const updates = {
            qualityScore: mergedScore,
            needsHumanReview: shouldQuarantine ? true : item.needsHumanReview,
            quarantineReason: shouldQuarantine ? 'llm_judge_policy' : item.quarantineReason,
            status: shouldReject ? 'rejected' as const : item.status,
            reviewNotes: [item.reviewNotes, `LLM Judge: ${judgeResult.notes}`].filter(Boolean).join(' | '),
            processedAt: shouldReject ? new Date() : item.processedAt,
            processadoEm: shouldReject ? new Date() : item.processadoEm,
          };
          await params.db.update(schema.trainingData)
            .set(updates)
            .where(eq(schema.trainingData.id, item.id));

          await params.db.insert(schema.trainingLineageEvents).values({
            tenantId: payload.tenantId,
            namespaceId: item.namespaceId,
            eventType: 'training_data.judged',
            sourceTable: 'training_data',
            sourceId: item.id,
            producedTable: 'training_data',
            producedId: item.id,
            metadata: {
              overallScore: judgeResult.overallScore,
              recommendedAction: judgeResult.recommendedAction,
              notes: judgeResult.notes,
            },
          });
          if (shouldQuarantine) {
            await params.db.insert(schema.trainingLineageEvents).values({
              tenantId: payload.tenantId,
              namespaceId: item.namespaceId,
              eventType: 'training_data.quarantined',
              sourceTable: 'training_data',
              sourceId: item.id,
              producedTable: 'training_data',
              producedId: item.id,
              metadata: { reason: 'llm_judge_policy' },
            });
          }
          if (shouldReject) {
            await params.db.insert(schema.trainingLineageEvents).values({
              tenantId: payload.tenantId,
              namespaceId: item.namespaceId,
              eventType: 'training_data.rejected',
              sourceTable: 'training_data',
              sourceId: item.id,
              producedTable: 'training_data',
              producedId: item.id,
              metadata: { reason: 'llm_judge_policy' },
            });
          }
        } finally {
          await redis.del(lockKey).catch(() => undefined);
        }
      },
      { stopToken, idleSleepMs: params.pollIntervalMs }
    );
  };

  void (async () => {
    while (!stopped) {
      try {
        await runLoop();
      } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Loop do policy gate falhou; retomando');
        await sleep(params.pollIntervalMs);
      }
    }
  })();

  return async () => {
    stopped = true;
    queue.requestStop();
    await sleep(params.pollIntervalMs + 50);
  };
}
