import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf-8');
}

describe('chat runtime announcements integration guards', () => {
  it('mantém assinatura Redis e broadcast websocket de runtime_notice no chat-websocket-runtime', () => {
    const source = read('apps/chat-service/src/chat-websocket-runtime.ts');
    expect(source.includes('RUNTIME_ANNOUNCEMENTS_CHANNEL')).toBe(true);
    expect(source.includes('runtimeAnnouncementSchema.safeParse')).toBe(true);
    expect(source.includes("type: 'runtime_notice'")).toBe(true);
    expect(source.includes('broadcastRuntimeNotice(parsed.data);')).toBe(true);
  });

  it('mantém propagação SSE de runtime_notice no endpoint de stream do chat', () => {
    const source = read('apps/chat-service/src/index.ts');
    expect(source.includes('registerRuntimeNoticeSseWriter')).toBe(true);
    expect(source.includes('writeRuntimeNoticeSseEvent')).toBe(true);
    expect(source.includes("type: 'runtime_notice'")).toBe(true);
  });

  it('mantém ciclo de vida do subscriber de runtime announcements no bootstrap', () => {
    const source = read('apps/chat-service/src/chat-bootstrap.ts');
    expect(source.includes('initializeRuntimeAnnouncementSubscriber')).toBe(true);
    expect(source.includes('closeRuntimeAnnouncementSubscriber')).toBe(true);
    expect(source.includes("'chat-runtime-announcements'")).toBe(true);
  });
});
