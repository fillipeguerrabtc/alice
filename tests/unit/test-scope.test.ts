import { describe, expect, it } from 'vitest';

import {
  collectWorkspaceReferencesFromTestContent,
  resolveTestScope,
} from '../../scripts/test-scope.mjs';

const mockGraph = {
  workspaces: [
    { name: '@alice/config', path: 'packages/config', scripts: { build: 'tsc -b', lint: 'eslint src/', typecheck: 'tsc --noEmit' } },
    { name: '@alice/shared-utils', path: 'packages/shared-utils', scripts: { build: 'tsc -b', lint: 'eslint src/', typecheck: 'tsc --noEmit' } },
    { name: '@alice/api-gateway', path: 'apps/api-gateway', scripts: { build: 'tsc', lint: 'eslint src/', typecheck: 'tsc --noEmit' } },
    { name: '@alice/auth-service', path: 'apps/auth-service', scripts: { build: 'node ../../scripts/build-service.mjs auth-service', lint: 'eslint src/', typecheck: 'tsc --noEmit' } },
  ],
  reverseDependencies: new Map([
    ['@alice/config', ['@alice/shared-utils', '@alice/auth-service']],
    ['@alice/shared-utils', ['@alice/auth-service']],
    ['@alice/api-gateway', []],
    ['@alice/auth-service', []],
  ]),
};

const mockTestGraph = {
  testFiles: [
    'tests/unit/packages/config-validation.test.ts',
    'tests/unit/services/auth-service.test.ts',
    'tests/unit/shared-utils/logger.test.ts',
  ],
  workspaceCoverage: new Map([
    ['@alice/config', ['tests/unit/packages/config-validation.test.ts']],
    ['@alice/shared-utils', ['tests/unit/shared-utils/logger.test.ts']],
    ['@alice/auth-service', ['tests/unit/services/auth-service.test.ts']],
    ['@alice/api-gateway', []],
  ]),
  testMetadata: new Map([
    [
      'tests/unit/packages/config-validation.test.ts',
      {
        file: 'tests/unit/packages/config-validation.test.ts',
        referencedWorkspaceNames: ['@alice/config'],
      },
    ],
    [
      'tests/unit/services/auth-service.test.ts',
      {
        file: 'tests/unit/services/auth-service.test.ts',
        referencedWorkspaceNames: ['@alice/auth-service', '@alice/shared-utils'],
      },
    ],
    [
      'tests/unit/shared-utils/logger.test.ts',
      {
        file: 'tests/unit/shared-utils/logger.test.ts',
        referencedWorkspaceNames: ['@alice/shared-utils'],
      },
    ],
  ]),
};

describe('test scope resolver', () => {
  it('maps centralized test files back to workspace paths and package names', () => {
    const referencedWorkspaces = collectWorkspaceReferencesFromTestContent(
      `
        import { foo } from '../../../apps/auth-service/src/index';
        import { logger } from '@alice/shared-utils';
      `,
      mockGraph,
    );

    expect(referencedWorkspaces).toEqual([
      '@alice/auth-service',
      '@alice/shared-utils',
    ]);
  });

  it('selects a changed test file directly without running the full suite', () => {
    const result = resolveTestScope({
      graph: mockGraph,
      testGraph: mockTestGraph,
      changedFiles: ['tests/unit/services/auth-service.test.ts'],
    });

    expect(result.mode).toBe('scoped');
    expect(result.directTestFiles).toEqual(['tests/unit/services/auth-service.test.ts']);
    expect(result.selectedTestFiles).toEqual(['tests/unit/services/auth-service.test.ts']);
  });

  it('expands package changes to dependent workspace test suites', () => {
    const result = resolveTestScope({
      graph: mockGraph,
      testGraph: mockTestGraph,
      changedFiles: ['packages/config/src/index.ts'],
    });

    expect(result.mode).toBe('scoped');
    expect(result.selectedWorkspaceNames).toEqual([
      '@alice/auth-service',
      '@alice/config',
      '@alice/shared-utils',
    ]);
    expect(result.selectedTestFiles).toEqual(mockTestGraph.testFiles);
  });

  it('falls back to full when an impacted workspace has no mapped tests', () => {
    const result = resolveTestScope({
      graph: mockGraph,
      testGraph: mockTestGraph,
      changedFiles: ['apps/api-gateway/src/index.ts'],
    });

    expect(result.mode).toBe('full');
    expect(result.reason).toContain('@alice/api-gateway');
    expect(result.selectedTestFiles).toEqual(mockTestGraph.testFiles);
  });

  it('falls back to full for test infrastructure changes', () => {
    const result = resolveTestScope({
      graph: mockGraph,
      testGraph: mockTestGraph,
      changedFiles: ['tests/utils/test-helpers.ts'],
    });

    expect(result.mode).toBe('full');
    expect(result.reason).toContain('caminho global crítico de testes');
  });

  it('ignores documentation-only changes', () => {
    const result = resolveTestScope({
      graph: mockGraph,
      testGraph: mockTestGraph,
      changedFiles: ['docs/VALIDACAO-INCREMENTAL-MONOREPO.md'],
    });

    expect(result.mode).toBe('empty');
    expect(result.ignoredFiles).toEqual(['docs/VALIDACAO-INCREMENTAL-MONOREPO.md']);
  });

  it('ignores markdown documentation outside docs without forcing full test execution', () => {
    const result = resolveTestScope({
      graph: mockGraph,
      testGraph: mockTestGraph,
      changedFiles: ['apps/observability-service/README.md', 'README.md'],
    });

    expect(result.mode).toBe('empty');
    expect(result.ignoredFiles).toEqual([
      'apps/observability-service/README.md',
      'README.md',
    ]);
  });
});
