import { describe, expect, it } from 'vitest';

import {
  classifyScopeFromFiles,
  expandImpactedWorkspaces,
  isPipelineOnlyPath,
} from '../../scripts/workspace-scope.mjs';

const mockGraph = {
  workspaces: [
    { name: '@alice/logger', path: 'packages/logger', scripts: { build: 'tsc -b', lint: 'eslint src/', typecheck: 'tsc --noEmit' } },
    { name: '@alice/config', path: 'packages/config', scripts: { build: 'tsc -b', lint: 'eslint src/', typecheck: 'tsc --noEmit' } },
    { name: '@alice/shared-utils', path: 'packages/shared-utils', scripts: { build: 'tsc -b', lint: 'eslint src/', typecheck: 'tsc --noEmit' } },
    { name: '@alice/auth-service', path: 'apps/auth-service', scripts: { build: 'node ../../scripts/build-service.mjs auth-service', lint: 'eslint src/', typecheck: 'tsc --noEmit' } },
  ],
  reverseDependencies: new Map([
    ['@alice/logger', ['@alice/config']],
    ['@alice/config', ['@alice/shared-utils', '@alice/auth-service']],
    ['@alice/shared-utils', ['@alice/auth-service']],
    ['@alice/auth-service', []],
  ]),
};

describe('workspace scope resolver', () => {
  it('resolve workspace changes directly by file path', () => {
    const result = classifyScopeFromFiles(
      ['packages/config/src/index.ts'],
      mockGraph,
    );

    expect(result.fallbackToFull).toBe(false);
    expect([...result.directWorkspaceNames]).toEqual(['@alice/config']);
    expect(result.workspaceFileMap.get('@alice/config')).toEqual([
      'packages/config/src/index.ts',
    ]);
  });

  it('expands build and typecheck through downstream dependents', () => {
    expect(
      expandImpactedWorkspaces('build', ['@alice/config'], mockGraph),
    ).toEqual([
      '@alice/auth-service',
      '@alice/config',
      '@alice/shared-utils',
    ]);

    expect(
      expandImpactedWorkspaces('typecheck', ['@alice/config'], mockGraph),
    ).toEqual([
      '@alice/auth-service',
      '@alice/config',
      '@alice/shared-utils',
    ]);
  });

  it('keeps lint scoped only to directly changed workspaces', () => {
    expect(
      expandImpactedWorkspaces('lint', ['@alice/config'], mockGraph),
    ).toEqual(['@alice/config']);
  });

  it('expands test through downstream dependents like build and typecheck', () => {
    expect(
      expandImpactedWorkspaces('test', ['@alice/config'], mockGraph),
    ).toEqual([
      '@alice/auth-service',
      '@alice/config',
      '@alice/shared-utils',
    ]);
  });

  it('falls back to full for critical global configuration changes', () => {
    const result = classifyScopeFromFiles(['turbo.json'], mockGraph);

    expect(result.fallbackToFull).toBe(true);
    expect(result.reason).toContain('configuração global crítica');
  });

  it('ignores documentation-only changes', () => {
    const result = classifyScopeFromFiles(
      ['docs/ARQUITETURA.md'],
      mockGraph,
    );

    expect(result.fallbackToFull).toBe(false);
    expect([...result.directWorkspaceNames]).toEqual([]);
    expect(result.ignoredFiles).toEqual(['docs/ARQUITETURA.md']);
  });

  it('ignores markdown documentation outside docs without classifying workspace impact', () => {
    const result = classifyScopeFromFiles(
      ['apps/observability-service/README.md', 'README.md'],
      mockGraph,
    );

    expect(result.fallbackToFull).toBe(false);
    expect([...result.directWorkspaceNames]).toEqual([]);
    expect(result.ignoredFiles).toEqual([
      'apps/observability-service/README.md',
      'README.md',
    ]);
  });

  it('classifies workflow and action paths as pipeline-only for release gating', () => {
    expect(isPipelineOnlyPath('.github/workflows/ci.yml')).toBe(true);
    expect(isPipelineOnlyPath('.github/actions/setup-node-pnpm/action.yml')).toBe(true);
    expect(isPipelineOnlyPath('apps/auth-service/src/index.ts')).toBe(false);
  });
});
