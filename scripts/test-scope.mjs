#!/usr/bin/env node
/**
 * Resolvedor incremental de testes com fail-safe para execução full.
 *
 * Author: Fillipe Guerra
 * Data: 15 de Março de 2026
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, normalize, relative, resolve, sep } from 'node:path';
import {
  ROOT_DIR,
  GLOBAL_FULL_SCOPE_FILES,
  GLOBAL_FULL_SCOPE_PREFIXES,
  buildReasonMap,
  detectChangedFiles,
  expandImpactedWorkspaces,
  loadWorkspaceGraph,
  resolveWorkspaceFromPath,
} from './workspace-scope.mjs';

const SAFE_IGNORED_PREFIXES = [
  'attached_assets/',
  'docs/',
];
const TEST_ROOT = 'tests';
const TEST_FILE_SUFFIX = '.test.ts';
const TEST_FULL_SCOPE_FILES = new Set([
  ...GLOBAL_FULL_SCOPE_FILES,
  'tests/setup.ts',
  'vitest.config.ts',
]);
const TEST_FULL_SCOPE_PREFIXES = [
  ...GLOBAL_FULL_SCOPE_PREFIXES,
  '.github/workflows/',
  '.github/.workflow-test',
  'tests/utils/',
];

function normalizePath(pathValue) {
  return normalize(pathValue).replaceAll(sep, '/');
}

function unique(values) {
  return [...new Set(values)];
}

function discoverTestFiles(rootDir, currentDir = TEST_ROOT) {
  const directoryPath = join(rootDir, currentDir);
  if (!existsSync(directoryPath)) {
    return [];
  }

  const discoveredFiles = [];
  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    const entryPath = normalizePath(join(currentDir, entry.name));

    if (entry.isDirectory()) {
      discoveredFiles.push(...discoverTestFiles(rootDir, entryPath));
      continue;
    }

    if (entry.isFile() && entryPath.endsWith(TEST_FILE_SUFFIX)) {
      discoveredFiles.push(entryPath);
    }
  }

  return discoveredFiles.sort();
}

export function collectWorkspaceReferencesFromTestContent(testContent, graph) {
  const referencedWorkspaceNames = new Set();

  for (const workspace of graph.workspaces) {
    if (
      testContent.includes(workspace.name)
      || testContent.includes(`${workspace.path}/`)
      || testContent.includes(`../${workspace.path}/`)
      || testContent.includes(`../../${workspace.path}/`)
      || testContent.includes(`../../../${workspace.path}/`)
    ) {
      referencedWorkspaceNames.add(workspace.name);
    }
  }

  return [...referencedWorkspaceNames].sort();
}

export function buildTestGraph(rootDir = ROOT_DIR, graph = loadWorkspaceGraph(rootDir)) {
  const testFiles = discoverTestFiles(rootDir);
  const testsByWorkspace = new Map();
  const workspaceCoverage = new Map();
  const testMetadata = new Map();

  for (const testFile of testFiles) {
    const testFilePath = join(rootDir, testFile);
    const testContent = readFileSync(testFilePath, 'utf8');
    const referencedWorkspaceNames = collectWorkspaceReferencesFromTestContent(testContent, graph);

    testMetadata.set(testFile, {
      file: testFile,
      referencedWorkspaceNames,
    });

    for (const workspaceName of referencedWorkspaceNames) {
      const fileList = testsByWorkspace.get(workspaceName) ?? [];
      fileList.push(testFile);
      testsByWorkspace.set(workspaceName, unique(fileList).sort());
    }
  }

  for (const workspace of graph.workspaces) {
    workspaceCoverage.set(workspace.name, testsByWorkspace.get(workspace.name) ?? []);
  }

  return {
    testFiles,
    testsByWorkspace,
    workspaceCoverage,
    testMetadata,
  };
}

function classifyChangedTestScope(changedFiles, graph, testGraph) {
  const directWorkspaceNames = new Set();
  const directTestFiles = new Set();
  const ignoredFiles = [];
  const workspaceFileMap = new Map();

  for (const changedFile of changedFiles) {
    if (SAFE_IGNORED_PREFIXES.some(prefix => changedFile.startsWith(prefix))) {
      ignoredFiles.push(changedFile);
      continue;
    }

    if (TEST_FULL_SCOPE_FILES.has(changedFile)) {
      return {
        fallbackToFull: true,
        reason: `Mudança em configuração global crítica de testes: ${changedFile}`,
        directWorkspaceNames,
        directTestFiles,
        ignoredFiles,
        workspaceFileMap,
      };
    }

    if (TEST_FULL_SCOPE_PREFIXES.some(prefix => changedFile.startsWith(prefix))) {
      return {
        fallbackToFull: true,
        reason: `Mudança em caminho global crítico de testes: ${changedFile}`,
        directWorkspaceNames,
        directTestFiles,
        ignoredFiles,
        workspaceFileMap,
      };
    }

    if (changedFile.startsWith(`${TEST_ROOT}/`)) {
      if (changedFile.endsWith(TEST_FILE_SUFFIX) && testGraph.testMetadata.has(changedFile)) {
        directTestFiles.add(changedFile);
        continue;
      }

      return {
        fallbackToFull: true,
        reason: `Mudança em infraestrutura de testes sem classificação segura: ${changedFile}`,
        directWorkspaceNames,
        directTestFiles,
        ignoredFiles,
        workspaceFileMap,
      };
    }

    const workspace = resolveWorkspaceFromPath(graph.workspaces, changedFile);
    if (workspace) {
      directWorkspaceNames.add(workspace.name);

      const fileList = workspaceFileMap.get(workspace.name) ?? [];
      fileList.push(changedFile);
      workspaceFileMap.set(workspace.name, unique(fileList).sort());
      continue;
    }

    return {
      fallbackToFull: true,
      reason: `Caminho não classificado com segurança para testes: ${changedFile}`,
      directWorkspaceNames,
      directTestFiles,
      ignoredFiles,
      workspaceFileMap,
    };
  }

  return {
    fallbackToFull: false,
    reason: '',
    directWorkspaceNames,
    directTestFiles,
    ignoredFiles,
    workspaceFileMap,
  };
}

export function resolveTestScope(options = {}) {
  const rootDir = options.rootDir ?? ROOT_DIR;
  const graph = options.graph ?? loadWorkspaceGraph(rootDir);
  const testGraph = options.testGraph ?? buildTestGraph(rootDir, graph);
  const changedFilesResult = options.changedFiles ?? detectChangedFiles(options);

  if (typeof changedFilesResult === 'object' && !Array.isArray(changedFilesResult) && changedFilesResult.fallbackToFull) {
    return {
      mode: 'full',
      reason: changedFilesResult.reason,
      changedFiles: changedFilesResult.changedFiles ?? [],
      ignoredFiles: [],
      directWorkspaceNames: [],
      selectedWorkspaceNames: [],
      directTestFiles: [],
      selectedTestFiles: testGraph.testFiles,
      reasonsByWorkspace: new Map(),
      workspaceFiles: new Map(),
      testGraph,
    };
  }

  const changedFiles = changedFilesResult;
  const classification = classifyChangedTestScope(changedFiles, graph, testGraph);

  if (classification.fallbackToFull) {
    return {
      mode: 'full',
      reason: classification.reason,
      changedFiles,
      ignoredFiles: classification.ignoredFiles,
      directWorkspaceNames: [...classification.directWorkspaceNames].sort(),
      selectedWorkspaceNames: [],
      directTestFiles: [...classification.directTestFiles].sort(),
      selectedTestFiles: testGraph.testFiles,
      reasonsByWorkspace: new Map(),
      workspaceFiles: classification.workspaceFileMap,
      testGraph,
    };
  }

  const directWorkspaceNames = [...classification.directWorkspaceNames].sort();
  const selectedWorkspaceNames = expandImpactedWorkspaces('test', directWorkspaceNames, graph);
  const selectedWorkspaceSet = new Set(selectedWorkspaceNames);
  const reasonsByWorkspace = buildReasonMap(selectedWorkspaceSet, directWorkspaceNames, graph.reverseDependencies);
  const selectedTestFiles = new Set(classification.directTestFiles);
  const uncoveredWorkspaces = [];

  for (const workspaceName of selectedWorkspaceNames) {
    const mappedTestFiles = testGraph.workspaceCoverage.get(workspaceName) ?? [];

    if (mappedTestFiles.length === 0) {
      uncoveredWorkspaces.push(workspaceName);
      continue;
    }

    for (const testFile of mappedTestFiles) {
      selectedTestFiles.add(testFile);
    }
  }

  if (uncoveredWorkspaces.length > 0) {
    return {
      mode: 'full',
      reason: `Workspace sem mapeamento confiável de testes: ${uncoveredWorkspaces.join(', ')}`,
      changedFiles,
      ignoredFiles: classification.ignoredFiles,
      directWorkspaceNames,
      selectedWorkspaceNames,
      directTestFiles: [...classification.directTestFiles].sort(),
      selectedTestFiles: testGraph.testFiles,
      reasonsByWorkspace,
      workspaceFiles: classification.workspaceFileMap,
      testGraph,
    };
  }

  const orderedSelectedTestFiles = [...selectedTestFiles].sort();

  return {
    mode: orderedSelectedTestFiles.length > 0 ? 'scoped' : 'empty',
    reason: orderedSelectedTestFiles.length > 0
      ? 'Escopo incremental de testes resolvido por git diff, grafo de dependências e mapeamento de suites'
      : 'Nenhum teste aplicável foi afetado',
    changedFiles,
    ignoredFiles: classification.ignoredFiles,
    directWorkspaceNames,
    selectedWorkspaceNames,
    directTestFiles: [...classification.directTestFiles].sort(),
    selectedTestFiles: orderedSelectedTestFiles,
    reasonsByWorkspace,
    workspaceFiles: classification.workspaceFileMap,
    testGraph,
  };
}

export function formatTestScopeReport(scopeResult) {
  const lines = ['[alice-scope] Task: test'];

  if (scopeResult.reason) {
    lines.push(`[alice-scope] Reason: ${scopeResult.reason}`);
  }

  if (scopeResult.changedFiles.length > 0) {
    lines.push(`[alice-scope] Changed files (${scopeResult.changedFiles.length}):`);
    for (const filePath of scopeResult.changedFiles) {
      lines.push(`  - ${filePath}`);
    }
  } else {
    lines.push('[alice-scope] Changed files: none');
  }

  if (scopeResult.ignoredFiles.length > 0) {
    lines.push(`[alice-scope] Ignored files (${scopeResult.ignoredFiles.length}):`);
    for (const filePath of scopeResult.ignoredFiles) {
      lines.push(`  - ${filePath}`);
    }
  }

  if (scopeResult.directWorkspaceNames.length > 0) {
    lines.push(`[alice-scope] Direct workspaces (${scopeResult.directWorkspaceNames.length}): ${scopeResult.directWorkspaceNames.join(', ')}`);
  }

  if (scopeResult.directTestFiles.length > 0) {
    lines.push(`[alice-scope] Direct tests (${scopeResult.directTestFiles.length}):`);
    for (const testFile of scopeResult.directTestFiles) {
      lines.push(`  - ${testFile}`);
    }
  }

  if (scopeResult.selectedWorkspaceNames.length > 0) {
    lines.push(`[alice-scope] Selected workspaces (${scopeResult.selectedWorkspaceNames.length}):`);
    for (const workspaceName of scopeResult.selectedWorkspaceNames) {
      const reason = scopeResult.reasonsByWorkspace.get(workspaceName);
      if (!reason) {
        lines.push(`  - ${workspaceName}`);
        continue;
      }

      const suffix = reason.kind === 'direct'
        ? 'direto'
        : `impactado por ${reason.sources.join(', ')}`;
      lines.push(`  - ${workspaceName} (${suffix})`);
    }
  }

  if (scopeResult.selectedTestFiles.length > 0) {
    lines.push(`[alice-scope] Selected tests (${scopeResult.selectedTestFiles.length}):`);
    for (const testFile of scopeResult.selectedTestFiles) {
      lines.push(`  - ${testFile}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

export function resolveRootRelativePath(rootDir, pathValue) {
  return normalizePath(relative(rootDir, resolve(rootDir, pathValue)));
}
