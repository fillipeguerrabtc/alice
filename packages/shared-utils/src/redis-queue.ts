import type { RedisClientType } from 'redis';
import { createLogger } from './logger.js';

const logger = createLogger('redis-stream-queue');

const STREAM_FIELD_PAYLOAD = 'payload';

interface StreamMessage {
  id: string;
  fields: Record<string, string>;
}

export interface QueueEnvelope<TPayload extends Record<string, unknown>> {
  schemaVersion: 'v1';
  idempotencyKey: string;
  attempt: number;
  enqueuedAt: string;
  payload: TPayload;
}

export interface RedisStreamQueueOptions {
  group: string;
  consumer: string;
  maxRetries?: number;
  minIdleMs?: number;
  idempotencyTtlSeconds?: number;
  backoffBaseMs?: number;
  autoClaimCount?: number;
  streamMaxLen?: number;
}

export interface QueueLagMetrics {
  pending: number;
  lag: number;
  total: number;
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseXInfoMap(entry: unknown): Record<string, unknown> {
  if (!Array.isArray(entry)) return {};
  const output: Record<string, unknown> = {};
  for (let i = 0; i < entry.length; i += 2) {
    const key = entry[i];
    const value = entry[i + 1];
    if (typeof key === 'string') {
      output[key] = value;
    }
  }
  return output;
}

function asStreamMessages(raw: unknown): StreamMessage[] {
  if (!Array.isArray(raw)) return [];
  const streams = raw as unknown[];
  const output: StreamMessage[] = [];
  for (const streamEntry of streams) {
    if (!Array.isArray(streamEntry) || streamEntry.length < 2) continue;
    const streamMessages = streamEntry[1];
    if (!Array.isArray(streamMessages)) continue;
    for (const msg of streamMessages) {
      if (!Array.isArray(msg) || msg.length < 2) continue;
      const id = String(msg[0]);
      const flatFields = Array.isArray(msg[1]) ? msg[1] : [];
      const fields: Record<string, string> = {};
      for (let i = 0; i < flatFields.length; i += 2) {
        const key = flatFields[i];
        const value = flatFields[i + 1];
        if (typeof key === 'string' && typeof value === 'string') {
          fields[key] = value;
        }
      }
      output.push({ id, fields });
    }
  }
  return output;
}

function asAutoClaimMessages(raw: unknown): StreamMessage[] {
  if (!Array.isArray(raw) || raw.length < 2 || !Array.isArray(raw[1])) return [];
  return asStreamMessages([['stream', raw[1]]]);
}

function backoffDelayMs(baseMs: number, attempt: number): number {
  const safeAttempt = Math.max(1, attempt);
  return Math.min(baseMs * 2 ** (safeAttempt - 1), 30_000);
}

export class RedisStreamQueue<TPayload extends Record<string, unknown>> {
  private readonly stream: string;
  private readonly dlqStream: string;
  private readonly group: string;
  private readonly consumer: string;
  private readonly maxRetries: number;
  private readonly minIdleMs: number;
  private readonly idempotencyTtlSeconds: number;
  private readonly backoffBaseMs: number;
  private readonly autoClaimCount: number;
  private readonly streamMaxLen: number | null;
  private stopRequested = false;

  constructor(stream: string, options: RedisStreamQueueOptions) {
    this.stream = stream;
    this.dlqStream = `${stream}:dlq`;
    this.group = options.group;
    this.consumer = options.consumer;
    this.maxRetries = options.maxRetries ?? 3;
    this.minIdleMs = options.minIdleMs ?? 30_000;
    this.idempotencyTtlSeconds = options.idempotencyTtlSeconds ?? 1800;
    this.backoffBaseMs = options.backoffBaseMs ?? 500;
    this.autoClaimCount = Math.max(1, options.autoClaimCount ?? 10);
    this.streamMaxLen = options.streamMaxLen && options.streamMaxLen > 0 ? options.streamMaxLen : null;
  }

  private async ensureGroup(client: RedisClientType): Promise<void> {
    try {
      await client.sendCommand(['XGROUP', 'CREATE', this.stream, this.group, '0', 'MKSTREAM']);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('BUSYGROUP')) {
        throw error;
      }
    }
  }

  async enqueue(client: RedisClientType, payload: TPayload, idempotencyKey: string): Promise<boolean> {
    const lockKey = `${this.stream}:idempotency:${idempotencyKey}`;
    const lock = await client.set(lockKey, '1', { NX: true, EX: this.idempotencyTtlSeconds });
    if (!lock) {
      logger.info({ stream: this.stream, idempotencyKey }, 'Mensagem duplicada ignorada por idempotência');
      return false;
    }

    const envelope: QueueEnvelope<TPayload> = {
      schemaVersion: 'v1',
      idempotencyKey,
      attempt: 0,
      enqueuedAt: new Date().toISOString(),
      payload,
    };

    await client.sendCommand(['XADD', this.stream, '*', STREAM_FIELD_PAYLOAD, JSON.stringify(envelope)]);
    if (this.streamMaxLen !== null) {
      await client.sendCommand(['XTRIM', this.stream, 'MAXLEN', '~', String(this.streamMaxLen)]);
    }
    return true;
  }

  async lag(client: RedisClientType): Promise<number> {
    const metrics = await this.getLagMetrics(client);
    return metrics.total;
  }

  async getLagMetrics(client: RedisClientType): Promise<QueueLagMetrics> {
    const [streamLenRaw, groupsRaw] = await Promise.all([
      client.sendCommand(['XLEN', this.stream]),
      client.sendCommand(['XINFO', 'GROUPS', this.stream]),
    ]);
    const streamLen = asNumber(streamLenRaw);
    const groups = Array.isArray(groupsRaw) ? groupsRaw : [];
    const selectedGroup = groups
      .map((entry) => parseXInfoMap(entry))
      .find((entry) => String(entry.name ?? '') === this.group);

    const pending = asNumber(selectedGroup?.pending);
    // Redis >=7 retorna `lag` em XINFO GROUPS; em versions/paths sem campo, estimamos via XLEN - entries-read.
    // É uma aproximação conservadora para observabilidade (não usada para lógica de negócio).
    const lag = selectedGroup?.lag !== undefined
      ? asNumber(selectedGroup.lag)
      : Math.max(0, streamLen - asNumber(selectedGroup?.['entries-read']));

    return {
      pending,
      lag,
      total: pending + lag,
    };
  }

  async dlqSize(client: RedisClientType): Promise<number> {
    const raw = await client.sendCommand(['XLEN', this.dlqStream]);
    return asNumber(raw);
  }

  requestStop(): void {
    this.stopRequested = true;
  }

  async consumeOnce(
    client: RedisClientType,
    onMessage: (payload: TPayload, envelope: QueueEnvelope<TPayload>) => Promise<void>,
  ): Promise<boolean> {
    if (this.stopRequested) {
      return false;
    }
    await this.ensureGroup(client);

    const readRaw = await client.sendCommand([
      'XREADGROUP', 'GROUP', this.group, this.consumer, 'COUNT', String(this.autoClaimCount), 'BLOCK', '1000', 'STREAMS', this.stream, '>',
    ]);
    let messages = asStreamMessages(readRaw);

    if (messages.length === 0) {
      const claimRaw = await client.sendCommand([
        'XAUTOCLAIM', this.stream, this.group, this.consumer, String(this.minIdleMs), '0-0', 'COUNT', String(this.autoClaimCount),
      ]);
      messages = asAutoClaimMessages(claimRaw);
    }

    if (messages.length === 0) {
      return false;
    }

    for (const message of messages) {
      if (this.stopRequested) {
        break;
      }
      const payloadRaw = message.fields[STREAM_FIELD_PAYLOAD];
      if (!payloadRaw) {
        await client.sendCommand(['XACK', this.stream, this.group, message.id]);
        continue;
      }

      const envelope = JSON.parse(payloadRaw) as QueueEnvelope<TPayload>;
      try {
        await onMessage(envelope.payload, envelope);
        await client.sendCommand(['XACK', this.stream, this.group, message.id]);
      } catch (error) {
        const nextAttempt = envelope.attempt + 1;
        const messageText = error instanceof Error ? error.message : String(error);

        if (nextAttempt > this.maxRetries) {
          const deadLetter = {
            ...envelope,
            attempt: nextAttempt,
            failedAt: new Date().toISOString(),
            error: messageText,
          };
          await client.sendCommand(['XADD', this.dlqStream, '*', STREAM_FIELD_PAYLOAD, JSON.stringify(deadLetter)]);
          logger.error({ stream: this.stream, idempotencyKey: envelope.idempotencyKey, error: messageText }, 'Mensagem enviada para DLQ');
        } else {
          const retryEnvelope: QueueEnvelope<TPayload> = {
            ...envelope,
            attempt: nextAttempt,
          };
          const delayMs = backoffDelayMs(this.backoffBaseMs, nextAttempt);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          await client.sendCommand(['XADD', this.stream, '*', STREAM_FIELD_PAYLOAD, JSON.stringify(retryEnvelope)]);
          logger.warn({
            stream: this.stream,
            idempotencyKey: envelope.idempotencyKey,
            attempt: nextAttempt,
            delayMs,
            error: messageText,
          }, 'Mensagem reenfileirada para retry');
        }

        await client.sendCommand(['XACK', this.stream, this.group, message.id]);
      }
    }
    return true;
  }

  async consumeLoop(
    client: RedisClientType,
    onMessage: (payload: TPayload, envelope: QueueEnvelope<TPayload>) => Promise<void>,
    options?: {
      stopToken?: { isStopped: () => boolean };
      idleSleepMs?: number;
    },
  ): Promise<void> {
    const sleepMs = Math.max(25, options?.idleSleepMs ?? 250);
    while (!this.stopRequested && !options?.stopToken?.isStopped()) {
      const processed = await this.consumeOnce(client, onMessage);
      if (!processed) {
        await new Promise((resolve) => setTimeout(resolve, sleepMs));
      }
    }
  }
}
