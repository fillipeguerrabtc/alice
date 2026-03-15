import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function readProjectFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('frontend build governance', () => {
  it('keeps frontend build free of tsc build-mode noEmit references that break CI', () => {
    const packageJson = JSON.parse(
      readProjectFile('apps/frontend-service/package.json'),
    ) as {
      scripts?: Record<string, string | undefined>;
    };

    expect(packageJson.scripts?.build).toBe('pnpm run typecheck && vite build');
    expect(packageJson.scripts?.typecheck).toBe(
      'tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json',
    );
    expect(packageJson.scripts?.build).not.toContain('tsc -b --noEmit');
  });
});

describe('trading hook-order governance', () => {
  it('keeps trading useMemo hooks above status guard early returns', () => {
    const source = readProjectFile('apps/frontend-service/src/pages/TradingContent.tsx');
    const statusGuardIndex = source.indexOf('const statusGuardNode = resolveTradingStatusGate(');
    const visibleTabValuesIndex = source.indexOf('const visibleTabValues = useMemo(');
    const v2SidebarSectionsIndex = source.indexOf('const v2SidebarSections = useMemo(');
    const v2BottomTraySectionsIndex = source.indexOf('const v2BottomTraySections = useMemo(');

    expect(statusGuardIndex).toBeGreaterThan(-1);
    expect(visibleTabValuesIndex).toBeGreaterThan(-1);
    expect(v2SidebarSectionsIndex).toBeGreaterThan(-1);
    expect(v2BottomTraySectionsIndex).toBeGreaterThan(-1);

    expect(visibleTabValuesIndex).toBeLessThan(statusGuardIndex);
    expect(v2SidebarSectionsIndex).toBeLessThan(statusGuardIndex);
    expect(v2BottomTraySectionsIndex).toBeLessThan(statusGuardIndex);
  });
});
