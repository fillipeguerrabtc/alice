import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function loadRagSource(): string {
  const sourcePath = path.join(process.cwd(), 'apps', 'rag-service', 'src', 'index.ts');
  return readFileSync(sourcePath, 'utf-8');
}

describe('rag worker security guards', () => {
  it('keeps web-crawl allowlist env guardrails', () => {
    const source = loadRagSource();
    expect(source.includes('WEB_CRAWL_REQUIRE_ALLOWLIST')).toBe(true);
    expect(source.includes('WEB_CRAWL_ALLOWED_DOMAINS')).toBe(true);
    expect(
      source.includes('WEB_CRAWL_ALLOWED_DOMAINS e obrigatorio quando WEB_CRAWL_REQUIRE_ALLOWLIST=true.')
    ).toBe(true);
  });

  it('passes allowlist config to web-crawl worker startup', () => {
    const source = loadRagSource();
    expect(source.includes('allowedDomains: WEB_CRAWL_ALLOWED_DOMAINS,')).toBe(true);
    expect(source.includes('requireAllowlist: WEB_CRAWL_REQUIRE_ALLOWLIST,')).toBe(true);
  });
});
