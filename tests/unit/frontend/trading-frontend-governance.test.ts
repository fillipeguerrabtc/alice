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

    expect(packageJson.scripts?.build).toBe('vite build --config vite.config.ts');
    expect(packageJson.scripts?.typecheck).toBe(
      'tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json',
    );
    expect(packageJson.scripts?.build).not.toContain('tsc -b --noEmit');
  });
});

describe('trading hook-order governance', () => {
  it('keeps trading V2 useMemo hooks isolated above workspace returns', () => {
    const tradingContentSource = readProjectFile('apps/frontend-service/src/pages/TradingContent.tsx');
    const tradingV2Source = readProjectFile('apps/frontend-service/src/pages/TradingV2WorkspaceView.tsx');
    const statusGuardIndex = tradingContentSource.indexOf('const statusGuardNode = resolveTradingStatusGate(');
    const workspaceViewIndex = tradingContentSource.indexOf('<TradingV2WorkspaceView');
    const visibleTabValuesIndex = tradingV2Source.indexOf('const visibleTabValues = useMemo(');
    const sidebarSectionsIndex = tradingV2Source.indexOf('const sidebarSections = useMemo(');
    const bottomTraySectionsIndex = tradingV2Source.indexOf('const bottomTraySections = useMemo(');
    const workspaceReturnIndex = tradingV2Source.indexOf('return (');

    expect(statusGuardIndex).toBeGreaterThan(-1);
    expect(workspaceViewIndex).toBeGreaterThan(statusGuardIndex);
    expect(visibleTabValuesIndex).toBeGreaterThan(-1);
    expect(sidebarSectionsIndex).toBeGreaterThan(-1);
    expect(bottomTraySectionsIndex).toBeGreaterThan(-1);
    expect(workspaceReturnIndex).toBeGreaterThan(-1);

    expect(visibleTabValuesIndex).toBeLessThan(workspaceReturnIndex);
    expect(sidebarSectionsIndex).toBeLessThan(workspaceReturnIndex);
    expect(bottomTraySectionsIndex).toBeLessThan(workspaceReturnIndex);
  });
});
