import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function loadSource(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf-8');
}

describe('distributed tracing propagation guards', () => {
  it('keeps traceparent propagation in async-context middleware', () => {
    const source = loadSource('packages/shared-utils/src/async-context.ts');
    expect(source.includes("TRACEPARENT_HEADER")).toBe(true);
    expect(source.includes('createChildTraceparent(incomingTraceparent)')).toBe(true);
    expect(source.includes('res.setHeader(TRACEPARENT_HEADER, traceparent);')).toBe(true);
    expect(source.includes('headers[TRACEPARENT_HEADER] = context.traceparent;')).toBe(true);
  });

  it('keeps trace/correlation propagation in internal service headers', () => {
    const source = loadSource('packages/shared-utils/src/rbac/middleware.ts');
    expect(source.includes('const contextHeaders = getContextHeaders();')).toBe(true);
    expect(source.includes("headers['x-correlation-id'] = contextHeaders['x-correlation-id'];")).toBe(true);
    expect(source.includes("headers['x-request-id'] = contextHeaders['x-request-id'];")).toBe(true);
    expect(source.includes('headers.traceparent = contextHeaders.traceparent;')).toBe(true);
  });
});
