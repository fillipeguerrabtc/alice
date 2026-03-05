import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function loadRagSource(): string {
  const sourcePath = path.join(process.cwd(), 'apps', 'rag-service', 'src', 'index.ts');
  return readFileSync(sourcePath, 'utf-8');
}

function loadStorageSource(): string {
  const sourcePath = path.join(process.cwd(), 'apps', 'rag-service', 'src', 'storage.ts');
  return readFileSync(sourcePath, 'utf-8');
}

describe('rag-service media security guards', () => {
  it('protects media file route with auth and tenant isolation middleware', () => {
    const source = loadRagSource();
    const routePattern =
      /app\.get\('\/api\/media\/files\/:tenantId\/:mediaType\/:filename',\s*requireAuth\(\),\s*requireSameTenant\(getTenantIdFromRequest\),\s*async/;
    expect(routePattern.test(source)).toBe(true);
  });

  it('validates tenantId, mediaType and filename path params with strict schema', () => {
    const source = loadRagSource();
    expect(source.includes("tenantId: z.string().uuid()")).toBe(true);
    expect(source.includes("mediaType: z.enum(['image', 'audio', 'document'])")).toBe(true);
    expect(source.includes("filename: z.string().regex(/^[A-Za-z0-9._-]{1,255}$/)")).toBe(true);
  });

  it('blocks cross-tenant file access before storage read', () => {
    const source = loadRagSource();
    const crossTenantGuardPattern = /if \(req\.tenantId && req\.tenantId !== tenantId\) \{[\s\S]*?return res\.status\(403\)\.json\(/;
    expect(crossTenantGuardPattern.test(source)).toBe(true);
  });

  it('keeps canonicalized safe path resolver with traversal detection', () => {
    const source = loadStorageSource();
    expect(source.includes("if (filePath.includes('\\0')) {")).toBe(true);
    expect(source.includes('const normalized = path.normalize(filePath);')).toBe(true);
    expect(source.includes('const absolutePath = path.resolve(this.baseDir, withoutLeadingSeparators);')).toBe(true);
    expect(source.includes('if (!absolutePath.startsWith(`${basePath}${path.sep}`) && absolutePath !== basePath) {')).toBe(true);
    expect(source.includes("throw new Error('Path traversal detectado');")).toBe(true);
  });

  it('routes fileExists/readFile through resolveSafeAbsolutePath guard', () => {
    const source = loadStorageSource();
    expect(source.includes('absolutePath = this.resolveSafeAbsolutePath(filePath);')).toBe(true);
    expect(source.includes('const absolutePath = this.resolveSafeAbsolutePath(filePath);')).toBe(true);
  });
});
