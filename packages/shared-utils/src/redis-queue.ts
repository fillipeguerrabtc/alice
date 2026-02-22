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

  constructor(stream: string, options: RedisStreamQueueOptions) {
    this.stream = stream;
    this.dlqStream = `${stream}:dlq`;
    this.group = options.group;
    this.consumer = options.consumer;
    this.maxRetries = options.maxRetries ?? 3;
    this.minIdleMs = options.minIdleMs ?? 30_000;
    this.idempotencyTtlSeconds = options.idempotencyTtlSeconds ?? 1800;
    this.backoffBaseMs = options.backoffBaseMs ?? 500;
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
    return true;
  }

  async lag(client: RedisClientType): Promise<number> {
    const raw = await client.sendCommand(['XLEN', this.stream]);
    const asNumber = Number(raw);
    return Number.isFinite(asNumber) ? asNumber : 0;
  }

  async consumeOnce(
    client: RedisClientType,
    onMessage: (payload: TPayload, envelope: QueueEnvelope<TPayload>) => Promise<void>,
  ): Promise<boolean> {
    await this.ensureGroup(client);

    const readRaw = await client.sendCommand([
      'XREADGROUP', 'GROUP', this.group, this.consumer, 'COUNT', '1', 'BLOCK', '1000', 'STREAMS', this.stream, '>',
    ]);
    let messages = asStreamMessages(readRaw);

    if (messages.length === 0) {
      const claimRaw = await client.sendCommand([
        'XAUTOCLAIM', this.stream, this.group, this.consumer, String(this.minIdleMs), '0-0', 'COUNT', '1',
      ]);
      messages = asAutoClaimMessages(claimRaw);
    }

    if (messages.length === 0) {
      return false;
    }

    const message = messages[0];
    const payloadRaw = message.fields[STREAM_FIELD_PAYLOAD];
    if (!payloadRaw) {
      await client.sendCommand(['XACK', this.stream, this.group, message.id]);
      return true;
    }

    const envelope = JSON.parse(payloadRaw) as QueueEnvelope<TPayload>;
    try {
      await onMessage(envelope.payload, envelope);
      await client.sendCommand(['XACK', this.stream, this.group, message.id]);
      return true;
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
      return true;
    }
  }
}
