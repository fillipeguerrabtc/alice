import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function loadImmutableAuditSource(): string {
  const sourcePath = path.join(process.cwd(), 'packages', 'shared-utils', 'src', 'immutable-audit-ledger.ts');
  return readFileSync(sourcePath, 'utf-8');
}

describe('immutable audit ledger implementation guards', () => {
  it('uses advisory lock and chain position sequencing per stream', () => {
    const source = loadImmutableAuditSource();
    expect(source.includes('pg_advisory_xact_lock(hashtext(${lockKey}))')).toBe(true);
    expect(source.includes('chainPosition = (previous?.chainPosition ?? 0) + 1')).toBe(true);
    expect(source.includes('eq(schema.immutableAuditEvents.streamKey, params.input.streamKey)')).toBe(true);
  });

  it('computes sha256 hash over canonicalized payload and previous hash', () => {
    const source = loadImmutableAuditSource();
    expect(source.includes('function canonicalizeForHash(value: unknown): string')).toBe(true);
    expect(source.includes("hashAlgorithm: 'sha256'")).toBe(true);
    expect(source.includes('prevEventHash: params.prevEventHash')).toBe(true);
    expect(source.includes("crypto.createHash('sha256').update(canonical).digest('hex')")).toBe(true);
  });

  it('exports reusable chain verification helper for service monitors', () => {
    const source = loadImmutableAuditSource();
    expect(source.includes('export function verifyImmutableAuditChain(events: ImmutableAuditChainEvent[])')).toBe(true);
    expect(source.includes('CHAIN_POSITION_MISMATCH')).toBe(true);
    expect(source.includes('PREV_HASH_MISMATCH')).toBe(true);
  });
});
