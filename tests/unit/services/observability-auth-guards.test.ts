import { describe, expect, it } from 'vitest';
import { loadObservabilitySource } from './helpers/observability-source';

describe('observability-service auth guards', () => {
  it('keeps only probe routes in session publicPaths', () => {
    const source = loadObservabilitySource();
    const publicPathsBlock = source.match(/publicPaths:\s*\[[\s\S]*?\]/);
    expect(publicPathsBlock).toBeTruthy();
    const block = publicPathsBlock?.[0] ?? '';

    expect(block.includes('/health')).toBe(true);
    expect(block.includes('/live')).toBe(true);
    expect(block.includes('/ready')).toBe(true);
    expect(block.includes('/metrics')).toBe(true);
    expect(block.includes('/api/observability/health')).toBe(false);
  });

  it('applies requireInternalOrSessionAuth globally after middleware setup', () => {
    const source = loadObservabilitySource();
    expect(source.includes('app.use(requireInternalOrSessionAuth);')).toBe(true);
  });

  it('protects critical observability routes with explicit RBAC guards', () => {
    const source = loadObservabilitySource();

    expect(
      /app\.get\('\/api\/observability\/health',\s*requireObservabilityRead,/.test(source)
    ).toBe(true);
    expect(
      /app\.post\('\/api\/observability\/logs',\s*requireObservabilityLogsWrite,/.test(source)
    ).toBe(true);
    expect(
      /app\.get\('\/api\/observability\/urls',\s*requireObservabilityAdmin,/.test(source)
    ).toBe(true);
  });
});
