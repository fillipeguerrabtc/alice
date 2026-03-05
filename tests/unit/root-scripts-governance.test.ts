import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

type PackageScripts = Record<string, string | undefined>;

function loadRootPackageScripts(): PackageScripts {
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { scripts?: PackageScripts };
  return packageJson.scripts ?? {};
}

describe('root package scripts governance', () => {
  it('keeps microservices as default dev/build/start workflow', () => {
    const scripts = loadRootPackageScripts();
    expect(scripts.dev).toBe('pnpm run dev:microservices');
    expect(scripts.build).toBe('pnpm run build:microservices');
    expect(scripts.start).toBe('pnpm run start:microservices');
  });

  it('retains explicit legacy scripts for controlled fallback', () => {
    const scripts = loadRootPackageScripts();
    expect(scripts['dev:legacy']).toContain('server/index-dev.ts');
    expect(scripts['build:legacy']).toContain('server/index-prod.ts');
    expect(scripts['start:legacy']).toContain('node dist/index.js');
  });

  it('uses recursive app/package orchestration for microservices scripts', () => {
    const scripts = loadRootPackageScripts();
    expect(scripts['dev:microservices']).toContain('--filter "./apps/*"');
    expect(scripts['build:microservices']).toContain('--filter "./packages/*"');
    expect(scripts['build:microservices']).toContain('--filter "./apps/*"');
    expect(scripts['start:microservices']).toContain('--filter "./apps/*"');
  });
});
