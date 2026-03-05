/**
 * Utilitários de tracing distribuído (W3C Trace Context).
 *
 * Objetivo: garantir propagação consistente de `traceparent` entre serviços
 * sem depender de SDK externo.
 */

import { randomBytes } from 'crypto';

export const TRACEPARENT_HEADER = 'traceparent';

const TRACEPARENT_REGEX =
  /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

export interface ParsedTraceparent {
  version: string;
  traceId: string;
  parentId: string;
  traceFlags: string;
  raw: string;
}

function isAllZero(hex: string): boolean {
  return /^0+$/.test(hex);
}

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

function generateTraceId(): string {
  let value = randomHex(16);
  while (isAllZero(value)) {
    value = randomHex(16);
  }
  return value;
}

function generateSpanId(): string {
  let value = randomHex(8);
  while (isAllZero(value)) {
    value = randomHex(8);
  }
  return value;
}

function normalizeTraceFlags(traceFlags?: string): string {
  return traceFlags && /^[0-9a-f]{2}$/.test(traceFlags) ? traceFlags : '01';
}

export function parseTraceparent(traceparent: string | undefined | null): ParsedTraceparent | null {
  if (!traceparent) return null;

  const value = traceparent.trim().toLowerCase();
  const match = TRACEPARENT_REGEX.exec(value);
  if (!match) return null;

  const [, version, traceId, parentId, traceFlags] = match;
  if (isAllZero(traceId) || isAllZero(parentId)) return null;

  return {
    version,
    traceId,
    parentId,
    traceFlags,
    raw: value,
  };
}

export function formatTraceparent(traceId: string, parentId: string, traceFlags?: string): string {
  return `00-${traceId}-${parentId}-${normalizeTraceFlags(traceFlags)}`;
}

export function createRootTraceparent(traceFlags?: string): string {
  return formatTraceparent(generateTraceId(), generateSpanId(), traceFlags);
}

/**
 * Cria um `traceparent` filho:
 * - se houver `incoming` válido, preserva o mesmo traceId;
 * - caso contrário, inicia novo traceId.
 */
export function createChildTraceparent(incoming?: string | null): string {
  const parsed = parseTraceparent(incoming);
  if (!parsed) {
    return createRootTraceparent();
  }

  return formatTraceparent(parsed.traceId, generateSpanId(), parsed.traceFlags);
}
