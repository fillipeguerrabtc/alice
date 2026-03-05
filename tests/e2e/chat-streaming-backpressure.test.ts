import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf-8');
}

describe('chat streaming backpressure guards', () => {
  it('keeps abort controller based cancellation in websocket chat hook', () => {
    const hookSource = read('apps/frontend-service/src/hooks/use-websocket-chat.ts');
    expect(hookSource.includes('abortControllerRef')).toBe(true);
    expect(hookSource.includes('new AbortController()')).toBe(true);
  });

  it('keeps stream cancellation and flush guards in chat page', () => {
    const pageSource = read('apps/frontend-service/src/pages/Chat/index.tsx');
    expect(pageSource.includes('streamControllerRef')).toBe(true);
    expect(pageSource.includes('cancelPendingContentFlush')).toBe(true);
    expect(pageSource.includes('AbortController')).toBe(true);
  });
});
