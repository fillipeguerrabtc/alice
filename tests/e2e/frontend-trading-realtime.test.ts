import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf-8');
}

describe('frontend trading realtime guards', () => {
  it('keeps market polling disabled when websocket stream is healthy', () => {
    const source = read('apps/frontend-service/src/pages/DemoTrading.tsx');
    expect(source.includes('const wsHealthy = wsEnabled && wsState.connected && !wsState.error;')).toBe(true);
    expect(source.includes('refetchInterval: wsHealthy ? false : 3_000')).toBe(true);
  });
});
