import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function loadChatServiceSource(): string {
  const sourcePath = path.join(process.cwd(), 'apps', 'chat-service', 'src', 'index.ts');
  return readFileSync(sourcePath, 'utf-8');
}

describe('chat-service internal route auth guards', () => {
  it('keeps /api/chat/message protected by HMAC auth and idempotency middleware', () => {
    const source = loadChatServiceSource();
    const routePattern =
      /app\.post\('\/api\/chat\/message',\s*requireInternalHmacAuth\(\),\s*requireInternalIdempotencyKey,/;
    expect(routePattern.test(source)).toBe(true);
  });

  it('keeps /api/chat/notify-agent protected by HMAC auth middleware', () => {
    const source = loadChatServiceSource();
    const routePattern =
      /app\.post\('\/api\/chat\/notify-agent',\s*requireInternalHmacAuth\(\),/;
    expect(routePattern.test(source)).toBe(true);
  });
});
