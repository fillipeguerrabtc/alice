import crypto from 'node:crypto';
import { and, desc, eq, schema, sql, type Database } from '@alice/database';
import type { SQLWrapper } from 'drizzle-orm';

type ImmutableAuditExecutor = {
  execute: (query: string | SQLWrapper) => PromiseLike<unknown>;
  select: Database['select'];
  insert: Database['insert'];
};

export interface AppendImmutableAuditEventInput {
  tenantId: string;
  stream: string;
  streamKey: string;
  eventType: string;
  resourceType: string;
  resourceId?: string | null;
  actorUserId?: string | null;
  sourceService: string;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  payload?: Record<string, unknown>;
  occurredAt?: Date;
}

export interface ImmutableAuditWriteResult {
  id: string;
  chainPosition: number;
  eventHash: string;
  prevEventHash: string | null;
}

function canonicalizeForHash(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalizeForHash(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => typeof entryValue !== 'undefined')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([entryKey, entryValue]) => `${JSON.stringify(entryKey)}:${canonicalizeForHash(entryValue)}`);
  return `{${entries.join(',')}}`;
}

function buildImmutableEventHash(params: {
  tenantId: string;
  stream: string;
  streamKey: string;
  chainPosition: number;
  prevEventHash: string | null;
  eventType: string;
  resourceType: string;
  resourceId: string | null;
  actorUserId: string | null;
  sourceService: string;
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  payload: Record<string, unknown>;
  occurredAtIso: string;
}): string {
  const canonical = canonicalizeForHash({
    schemaVersion: 1,
    hashAlgorithm: 'sha256',
    tenantId: params.tenantId,
    stream: params.stream,
    streamKey: params.streamKey,
    chainPosition: params.chainPosition,
    prevEventHash: params.prevEventHash,
    eventType: params.eventType,
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    actorUserId: params.actorUserId,
    sourceService: params.sourceService,
    requestId: params.requestId,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    payload: params.payload,
    occurredAt: params.occurredAtIso,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export async function appendImmutableAuditEventWithExecutor(params: {
  executor: ImmutableAuditExecutor;
  input: AppendImmutableAuditEventInput;
}): Promise<ImmutableAuditWriteResult> {
  const payload = params.input.payload ?? {};
  const occurredAt = params.input.occurredAt ?? new Date();
  const occurredAtIso = occurredAt.toISOString();
  const lockKey = `${params.input.tenantId}:${params.input.stream}:${params.input.streamKey}`;

  await params.executor.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);

  const [previous] = await params.executor.select({
    chainPosition: schema.immutableAuditEvents.chainPosition,
    eventHash: schema.immutableAuditEvents.eventHash,
  })
    .from(schema.immutableAuditEvents)
    .where(and(
      eq(schema.immutableAuditEvents.tenantId, params.input.tenantId),
      eq(schema.immutableAuditEvents.stream, params.input.stream),
      eq(schema.immutableAuditEvents.streamKey, params.input.streamKey),
    ))
    .orderBy(desc(schema.immutableAuditEvents.chainPosition))
    .limit(1);

  const prevEventHash = previous?.eventHash ?? null;
  const chainPosition = (previous?.chainPosition ?? 0) + 1;
  const eventHash = buildImmutableEventHash({
    tenantId: params.input.tenantId,
    stream: params.input.stream,
    streamKey: params.input.streamKey,
    chainPosition,
    prevEventHash,
    eventType: params.input.eventType,
    resourceType: params.input.resourceType,
    resourceId: params.input.resourceId ?? null,
    actorUserId: params.input.actorUserId ?? null,
    sourceService: params.input.sourceService,
    requestId: params.input.requestId ?? null,
    ipAddress: params.input.ipAddress ?? null,
    userAgent: params.input.userAgent ?? null,
    payload,
    occurredAtIso,
  });

  const [inserted] = await params.executor.insert(schema.immutableAuditEvents).values({
    tenantId: params.input.tenantId,
    actorUserId: params.input.actorUserId ?? null,
    sourceService: params.input.sourceService,
    stream: params.input.stream,
    streamKey: params.input.streamKey,
    chainPosition,
    eventType: params.input.eventType,
    resourceType: params.input.resourceType,
    resourceId: params.input.resourceId ?? null,
    requestId: params.input.requestId ?? null,
    ipAddress: params.input.ipAddress ?? null,
    userAgent: params.input.userAgent ?? null,
    payload,
    prevEventHash,
    eventHash,
    hashAlgorithm: 'sha256',
    occurredAt,
  }).returning({
    id: schema.immutableAuditEvents.id,
    chainPosition: schema.immutableAuditEvents.chainPosition,
    eventHash: schema.immutableAuditEvents.eventHash,
    prevEventHash: schema.immutableAuditEvents.prevEventHash,
  });

  return inserted;
}

export async function appendImmutableAuditEvent(params: {
  db: Database;
  input: AppendImmutableAuditEventInput;
}): Promise<ImmutableAuditWriteResult> {
  return params.db.transaction(async (tx) => appendImmutableAuditEventWithExecutor({
    executor: tx as unknown as ImmutableAuditExecutor,
    input: params.input,
  }));
}
