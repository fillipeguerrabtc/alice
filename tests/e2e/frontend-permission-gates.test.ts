import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf-8');
}

describe('frontend permission gates guards', () => {
  it('keeps centralized permission helper in auth utils', () => {
    const source = read('apps/frontend-service/src/lib/authUtils.ts');
    expect(source.includes('export function hasPermission(')).toBe(true);
    expect(source.includes("includes('admin')")).toBe(true);
    expect(source.includes("includes('super_admin')")).toBe(true);
  });

  it('keeps Trading page gated by integrations:trading:read permission', () => {
    const tradingWrapperSource = read('apps/frontend-service/src/pages/Trading.tsx');
    const tradingPermissionsQuerySource = read('apps/frontend-service/src/components/trading/useTradingPermissionsQuery.ts');
    expect(tradingPermissionsQuerySource.includes("'/api/auth/rbac/permissions'")).toBe(true);
    expect(tradingWrapperSource.includes("'integrations:trading:read'")).toBe(true);
    expect(tradingWrapperSource.includes('if (!canReadTrading)')).toBe(true);
  });

  it('keeps Observability page gated by observability:read permission', () => {
    const source = read('apps/frontend-service/src/pages/Observability.tsx');
    expect(source.includes("'observability:read'")).toBe(true);
    expect(source.includes('if (!canReadObservability)')).toBe(true);
    expect(source.includes('card-observability-forbidden')).toBe(true);
  });
});
