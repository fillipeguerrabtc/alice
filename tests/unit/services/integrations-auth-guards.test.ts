import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function loadIntegrationsSource(): string {
  const sourcePath = path.join(process.cwd(), 'apps', 'integrations-service', 'src', 'index.ts');
  return readFileSync(sourcePath, 'utf-8');
}

describe('integrations-service auth guards', () => {
  it('protects /api/integrations/health with integrations read permission', () => {
    const source = loadIntegrationsSource();
    const routePattern =
      /app\.get\('\/api\/integrations\/health',\s*requirePermission\('integrations:integrations:read'\),/;
    expect(routePattern.test(source)).toBe(true);
  });

  it('does not keep /api/integrations/health in session publicPaths bypass list', () => {
    const source = loadIntegrationsSource();
    const publicPathsBlock = source.match(/publicPaths:\s*\[[\s\S]*?\]/);
    expect(publicPathsBlock).toBeTruthy();
    expect(publicPathsBlock?.[0].includes('/api/integrations/health')).toBe(false);
  });

  it('does not keep /api/integrations/health in API rate-limit skip list', () => {
    const source = loadIntegrationsSource();
    const skipRoutesBlocks = source.match(/skipRoutes:\s*\[[\s\S]*?\]/g) ?? [];
    const skipRoutesSource = skipRoutesBlocks.join('\n');
    expect(skipRoutesSource.includes('/api/integrations/health')).toBe(false);
  });
});
