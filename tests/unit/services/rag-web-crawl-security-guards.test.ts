import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function loadWorkerSource(): string {
  const sourcePath = path.join(process.cwd(), 'apps', 'rag-service', 'src', 'workers', 'web-crawl-worker.ts');
  return readFileSync(sourcePath, 'utf-8');
}

describe('rag web-crawl worker security guards', () => {
  it('validates outbound crawl urls before fetching', () => {
    const source = loadWorkerSource();
    expect(source.includes("import { assertSafeOutboundUrl } from '../url-security.js';")).toBe(true);
    expect(source.includes('const currentUrl = await assertSafeOutboundUrl(url);')).toBe(true);
  });

  it('enforces manual redirect handling with safe revalidation', () => {
    const source = loadWorkerSource();
    expect(source.includes("redirect: 'manual',")).toBe(true);
    expect(source.includes('if (res.status >= 300 && res.status < 400) {')).toBe(true);
    expect(source.includes('const nextUrl = new URL(location, currentUrl);')).toBe(true);
    expect(source.includes('return fetchPage(nextUrl.toString(), bytesMax, timeoutMs, redirectDepth + 1);')).toBe(true);
  });

  it('persists the resolved safe url in crawl results', () => {
    const source = loadWorkerSource();
    expect(source.includes('resolvedUrl: currentUrl.toString(),')).toBe(true);
    expect(source.includes('url: page.resolvedUrl,')).toBe(true);
  });
});
