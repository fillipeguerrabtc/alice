import crypto from 'crypto';
import type { Request, Response } from 'express';
import { and, eq, getDatabase, schema } from '@alice/database';
import { type getRedisClient } from '@alice/shared-utils';
import { z } from 'zod';
import {
  buildTrainingRunStartIdempotencyRedisKey,
  type TrainingRunStartIdempotencyOperation,
} from './training-enterprise-controls.js';

type FineTuningJobRow = typeof schema.fineTuningJobs.$inferSelect;

const trainingIdempotencyHeaderSchema = z.object({
  'x-idempotency-key': z.string().trim().min(16).max(128).regex(/^[A-Za-z0-9:_-]+$/),
});

const trainingRunStartIdempotencyRecordSchema = z.object({
  jobId: z.string().uuid(),
  fingerprint: z.string().length(64),
  createdAt: z.string().datetime(),
});

type TrainingRunStartIdempotencyRecord = z.infer<typeof trainingRunStartIdempotencyRecordSchema>;

type TrainingRunStartErrorCode =
  | 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH'
  | 'RUN_START_LOCK_CONTENTION'
  | 'RUN_START_ALREADY_ACTIVE'
  | 'RUN_START_CAPACITY_EXHAUSTED';

type TrainingRunStartReplayLookup =
  | { status: 'miss' }
  | { status: 'payload_mismatch' }
  | { status: 'hit'; job: FineTuningJobRow };

interface TrainingRunStartIdempotencyLogger {
  warn: (obj: Record<string, unknown>, msg: string) => void;
}

interface CreateTrainingRunStartIdempotencyServiceDeps {
  logger: TrainingRunStartIdempotencyLogger;
  runStartIdempotencyTtlSeconds: number;
  incrementRunStartIdempotencyMetric: (params: {
    endpoint: TrainingRunStartIdempotencyOperation;
    result: string;
  }) => void;
}

function stableStringifyForFingerprint(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringifyForFingerprint(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => typeof entryValue !== 'undefined')
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB));
  return `{${entries
    .map(([entryKey, entryValue]) => `${JSON.stringify(entryKey)}:${stableStringifyForFingerprint(entryValue)}`)
    .join(',')}}`;
}

export function createTrainingRunStartIdempotencyService(
  deps: CreateTrainingRunStartIdempotencyServiceDeps,
): {
  readOptionalTrainingIdempotencyKey: (req: Request) => { key: string | null; error: string | null };
  buildRunStartRequestFingerprint: (params: {
    operation: TrainingRunStartIdempotencyOperation;
    tenantId: string;
    payload: Record<string, unknown>;
  }) => string;
  hashIdempotencyKeyForAudit: (key: string) => string;
  applyIdempotencyResponseHeaders: (
    res: Response,
    idempotencyKey: string,
    status: 'created' | 'replayed' | 'conflict',
  ) => void;
  sendTrainingRunStartError: (params: {
    res: Response;
    status: 409 | 429;
    error: string;
    code: TrainingRunStartErrorCode;
    retryAfterSeconds?: number;
    idempotencyKey?: string | null;
  }) => Response;
  lookupRunStartIdempotencyReplay: (params: {
    redis: NonNullable<ReturnType<typeof getRedisClient>>;
    operation: TrainingRunStartIdempotencyOperation;
    tenantId: string;
    idempotencyKey: string;
    fingerprint: string;
  }) => Promise<TrainingRunStartReplayLookup>;
  storeRunStartIdempotencyRecord: (params: {
    redis: NonNullable<ReturnType<typeof getRedisClient>>;
    operation: TrainingRunStartIdempotencyOperation;
    tenantId: string;
    idempotencyKey: string;
    fingerprint: string;
    jobId: string;
  }) => Promise<void>;
} {
  const db = getDatabase();

  const applyIdempotencyResponseHeaders = (
    res: Response,
    idempotencyKey: string,
    status: 'created' | 'replayed' | 'conflict',
  ): void => {
    res.setHeader('X-Idempotency-Key', idempotencyKey);
    res.setHeader('X-Idempotency-Status', status);
  };

  return {
    readOptionalTrainingIdempotencyKey: (req) => {
      const raw = req.headers['x-idempotency-key'];
      if (typeof raw === 'undefined') return { key: null, error: null };
      if (Array.isArray(raw)) {
        return { key: null, error: 'Header X-Idempotency-Key invalido' };
      }
      const parsed = trainingIdempotencyHeaderSchema.safeParse({ 'x-idempotency-key': raw });
      if (!parsed.success) {
        return {
          key: null,
          error: 'Header X-Idempotency-Key invalido. Use 16-128 caracteres alfanumericos, ":", "_" ou "-".',
        };
      }
      return { key: parsed.data['x-idempotency-key'], error: null };
    },

    buildRunStartRequestFingerprint: (params) => (
      crypto.createHash('sha256').update(stableStringifyForFingerprint({
        operation: params.operation,
        tenantId: params.tenantId,
        payload: params.payload,
      })).digest('hex')
    ),

    hashIdempotencyKeyForAudit: (key) => crypto.createHash('sha256').update(key).digest('hex').slice(0, 16),

    applyIdempotencyResponseHeaders,

    sendTrainingRunStartError: (params) => {
      if (params.retryAfterSeconds && params.retryAfterSeconds > 0) {
        params.res.setHeader('Retry-After', String(params.retryAfterSeconds));
      }
      if (params.idempotencyKey) {
        applyIdempotencyResponseHeaders(params.res, params.idempotencyKey, 'conflict');
      }
      return params.res.status(params.status).json({
        error: params.error,
        code: params.code,
        retryAfterSeconds: params.retryAfterSeconds ?? null,
      });
    },

    lookupRunStartIdempotencyReplay: async (params) => {
      const redisKey = buildTrainingRunStartIdempotencyRedisKey({
        tenantId: params.tenantId,
        operation: params.operation,
        idempotencyKey: params.idempotencyKey,
      });

      let rawRecord: string | null = null;
      try {
        rawRecord = await params.redis.get(redisKey);
      } catch (error) {
        deps.incrementRunStartIdempotencyMetric({
          endpoint: params.operation,
          result: 'lookup_error',
        });
        deps.logger.warn(
          {
            endpoint: params.operation,
            tenantId: params.tenantId,
            error: error instanceof Error ? error.message : String(error),
          },
          'Falha ao consultar idempotencia de run start; seguindo fluxo normal',
        );
        return { status: 'miss' };
      }

      if (!rawRecord) {
        deps.incrementRunStartIdempotencyMetric({
          endpoint: params.operation,
          result: 'miss',
        });
        return { status: 'miss' };
      }

      let record: TrainingRunStartIdempotencyRecord | null = null;
      const parsedRecord = trainingRunStartIdempotencyRecordSchema.safeParse(
        rawRecord.trim().startsWith('{')
          ? (() => {
              try {
                return JSON.parse(rawRecord);
              } catch {
                return null;
              }
            })()
          : null,
      );
      if (parsedRecord.success) {
        record = parsedRecord.data;
      } else if (/^[0-9a-f-]{36}$/i.test(rawRecord.trim())) {
        record = {
          jobId: rawRecord.trim(),
          fingerprint: params.fingerprint,
          createdAt: new Date(0).toISOString(),
        };
      } else {
        deps.incrementRunStartIdempotencyMetric({
          endpoint: params.operation,
          result: 'invalid_record',
        });
        return { status: 'miss' };
      }

      if (record.fingerprint !== params.fingerprint) {
        deps.incrementRunStartIdempotencyMetric({
          endpoint: params.operation,
          result: 'payload_mismatch',
        });
        return { status: 'payload_mismatch' };
      }

      const existingJob = await db.query.fineTuningJobs.findFirst({
        where: and(
          eq(schema.fineTuningJobs.id, record.jobId),
          eq(schema.fineTuningJobs.tenantId, params.tenantId),
        ),
      });
      if (!existingJob) {
        deps.incrementRunStartIdempotencyMetric({
          endpoint: params.operation,
          result: 'orphaned',
        });
        try {
          await params.redis.del(redisKey);
        } catch {
          // best-effort cleanup
        }
        return { status: 'miss' };
      }

      deps.incrementRunStartIdempotencyMetric({
        endpoint: params.operation,
        result: 'hit',
      });
      return { status: 'hit', job: existingJob };
    },

    storeRunStartIdempotencyRecord: async (params) => {
      const redisKey = buildTrainingRunStartIdempotencyRedisKey({
        tenantId: params.tenantId,
        operation: params.operation,
        idempotencyKey: params.idempotencyKey,
      });
      const serializedRecord = JSON.stringify({
        jobId: params.jobId,
        fingerprint: params.fingerprint,
        createdAt: new Date().toISOString(),
      } satisfies TrainingRunStartIdempotencyRecord);

      try {
        const result = await params.redis.set(redisKey, serializedRecord, {
          EX: deps.runStartIdempotencyTtlSeconds,
          NX: true,
        });
        deps.incrementRunStartIdempotencyMetric({
          endpoint: params.operation,
          result: result === 'OK' ? 'stored' : 'store_conflict',
        });
      } catch (error) {
        deps.incrementRunStartIdempotencyMetric({
          endpoint: params.operation,
          result: 'store_error',
        });
        deps.logger.warn(
          {
            endpoint: params.operation,
            tenantId: params.tenantId,
            jobId: params.jobId,
            error: error instanceof Error ? error.message : String(error),
          },
          'Falha ao persistir registro de idempotencia para run start',
        );
      }
    },
  };
}
