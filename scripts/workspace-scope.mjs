#!/usr/bin/env node
/**
 * Resolvedor de escopo de workspaces afetados para validações incrementais.
 *
 * Author: Fillipe Guerra
 * Data: 15 de Março de 2026
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = resolve(__dirname, '..');

const WORKSPACE_ROOTS = ['apps', 'packages'];
const SAFE_IGNORED_PREFIXES = [
  'attached_assets/',
  'docs/',
  'tests/',
];
export const GLOBAL_FULL_SCOPE_FILES = new Set([
  '.github/actions/setup-node-pnpm/action.yml',
  '.gitignore',
  '.nvmrc',
  'eslint.config.mjs',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'packages/tsconfig.base.json',
  'scripts/build-service.mjs',
  'turbo.json',
  'tsconfig.build.json',
]);
export const GLOBAL_FULL_SCOPE_PREFIXES = [
  'scripts/git-hooks/',
];

function normalizePath(pathValue) {
  return normalize(pathValue).replaceAll(sep, '/');
}

function execGit(rootDir, args) {
  return execFileSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function unique(values) {
  return [...new Set(values)];
}

function parseLines(rawValue) {
  return rawValue
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

export function resolveWorkspaceFromPath(workspaces, filePath) {
  for (const workspace of workspaces) {
    if (filePath === workspace.path || filePath.startsWith(`${workspace.path}/`)) {
      return workspace;
    }
  }

  return null;
}

export function buildReasonMap(selectedWorkspaces, directWorkspaceNames, reverseDependencies) {
  const reasons = new Map();

  for (const workspaceName of directWorkspaceNames) {
    reasons.set(workspaceName, {
      kind: 'direct',
      sources: [workspaceName],
    });
  }

  const queue = [...directWorkspaceNames];
  while (queue.length > 0) {
    const currentWorkspace = queue.shift();
    const dependents = reverseDependencies.get(currentWorkspace) ?? [];

    for (const dependentWorkspace of dependents) {
      if (!selectedWorkspaces.has(dependentWorkspace)) {
        continue;
      }

      const currentReason = reasons.get(dependentWorkspace);
      const currentSources = new Set(currentReason?.sources ?? []);
      const currentKinds = new Set(currentReason ? [currentReason.kind] : []);

      currentSources.add(currentWorkspace);
      currentKinds.add('dependency');

      if (!reasons.has(dependentWorkspace)) {
        queue.push(dependentWorkspace);
      }

      reasons.set(dependentWorkspace, {
        kind: currentKinds.has('direct') ? 'direct' : 'dependency',
        sources: [...currentSources].sort(),
      });
    }
  }

  return reasons;
}

export function loadWorkspaceGraph(rootDir = ROOT_DIR) {
  const workspaces = [];
  const workspaceByName = new Map();

  for (const workspaceRoot of WORKSPACE_ROOTS) {
    const rootPath = join(rootDir, workspaceRoot);
    if (!existsSync(rootPath)) {
      continue;
    }

    for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const workspacePath = join(workspaceRoot, entry.name);
      const manifestPath = join(rootDir, workspacePath, 'package.json');
      if (!existsSync(manifestPath)) {
        continue;
      }

      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const scripts = manifest.scripts ?? {};
      const workspace = {
        name: manifest.name,
        path: normalizePath(workspacePath),
        scripts,
        manifestPath: normalizePath(relative(rootDir, manifestPath)),
      };

      workspaces.push(workspace);
      workspaceByName.set(workspace.name, workspace);
    }
  }

  const dependencies = new Map();
  const reverseDependencies = new Map();

  for (const workspace of workspaces) {
    const manifestPath = join(rootDir, workspace.manifestPath);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const allDependencies = {
      ...(manifest.dependencies ?? {}),
      ...(manifest.devDependencies ?? {}),
      ...(manifest.peerDependencies ?? {}),
      ...(manifest.optionalDependencies ?? {}),
    };

    const internalDependencies = Object.keys(allDependencies)
      .filter(dependencyName => workspaceByName.has(dependencyName))
      .sort();

    dependencies.set(workspace.name, internalDependencies);

    for (const dependencyName of internalDependencies) {
      const dependents = reverseDependencies.get(dependencyName) ?? [];
      dependents.push(workspace.name);
      reverseDependencies.set(dependencyName, unique(dependents).sort());
    }
  }

  for (const workspace of workspaces) {
    if (!dependencies.has(workspace.name)) {
      dependencies.set(workspace.name, []);
    }

    if (!reverseDependencies.has(workspace.name)) {
      reverseDependencies.set(workspace.name, []);
    }
  }

  return {
    workspaces: workspaces.sort((left, right) => left.path.localeCompare(right.path)),
    workspaceByName,
    dependencies,
    reverseDependencies,
  };
}

export function detectChangedFiles(options = {}) {
  const rootDir = options.rootDir ?? ROOT_DIR;
  const baseRef = options.baseRef ?? process.env.ALICE_SCOPE_BASE_REF ?? '';
  const headRef = options.headRef ?? process.env.ALICE_SCOPE_HEAD_REF ?? 'HEAD';

  try {
    if (baseRef) {
      execGit(rootDir, ['rev-parse', '--verify', `${baseRef}^{commit}`]);
      execGit(rootDir, ['rev-parse', '--verify', `${headRef}^{commit}`]);

      return unique(parseLines(
        execGit(rootDir, ['diff', '--name-only', '--diff-filter=ACMRD', `${baseRef}...${headRef}`]),
      )).map(normalizePath);
    }

    const trackedChanges = parseLines(execGit(rootDir, ['diff', '--name-only', '--diff-filter=ACMRD', '--relative', 'HEAD']));
    const untrackedChanges = parseLines(execGit(rootDir, ['ls-files', '--others', '--exclude-standard']));

    return unique([...trackedChanges, ...untrackedChanges]).map(normalizePath);
  } catch (error) {
    return {
      fallbackToFull: true,
      reason: `Falha ao ler git diff (${error.message})`,
      changedFiles: [],
    };
  }
}

export function classifyScopeFromFiles(changedFiles, graph) {
  const directWorkspaceNames = new Set();
  const workspaceFileMap = new Map();
  const ignoredFiles = [];

  for (const changedFile of changedFiles) {
    if (SAFE_IGNORED_PREFIXES.some(prefix => changedFile.startsWith(prefix))) {
      ignoredFiles.push(changedFile);
      continue;
    }

    if (GLOBAL_FULL_SCOPE_FILES.has(changedFile)) {
      return {
        fallbackToFull: true,
        reason: `Mudança em configuração global crítica: ${changedFile}`,
        directWorkspaceNames,
        workspaceFileMap,
        ignoredFiles,
      };
    }

    if (GLOBAL_FULL_SCOPE_PREFIXES.some(prefix => changedFile.startsWith(prefix))) {
      return {
        fallbackToFull: true,
        reason: `Mudança em caminho global crítico: ${changedFile}`,
        directWorkspaceNames,
        workspaceFileMap,
        ignoredFiles,
      };
    }

    const workspace = resolveWorkspaceFromPath(graph.workspaces, changedFile);
    if (workspace) {
      directWorkspaceNames.add(workspace.name);

      const fileList = workspaceFileMap.get(workspace.name) ?? [];
      fileList.push(changedFile);
      workspaceFileMap.set(workspace.name, fileList.sort());
      continue;
    }

    if (
      changedFile.startsWith('.github/workflows/')
      || changedFile.startsWith('.github/.workflow-test')
    ) {
      ignoredFiles.push(changedFile);
      continue;
    }

    return {
      fallbackToFull: true,
      reason: `Caminho não classificado com segurança: ${changedFile}`,
      directWorkspaceNames,
      workspaceFileMap,
      ignoredFiles,
    };
  }

  return {
    fallbackToFull: false,
    reason: '',
    directWorkspaceNames,
    workspaceFileMap,
    ignoredFiles,
  };
}

export function expandImpactedWorkspaces(taskName, directWorkspaceNames, graph) {
  const selectedWorkspaces = new Set(directWorkspaceNames);

  if (taskName === 'build' || taskName === 'typecheck' || taskName === 'test') {
    const queue = [...directWorkspaceNames];

    while (queue.length > 0) {
      const currentWorkspace = queue.shift();
      const dependents = graph.reverseDependencies.get(currentWorkspace) ?? [];

      for (const dependentWorkspace of dependents) {
        if (selectedWorkspaces.has(dependentWorkspace)) {
          continue;
        }

        selectedWorkspaces.add(dependentWorkspace);
        queue.push(dependentWorkspace);
      }
    }
  }

  return [...selectedWorkspaces].sort();
}

export function resolveTaskScope(taskName, options = {}) {
  const rootDir = options.rootDir ?? ROOT_DIR;
  const graph = options.graph ?? loadWorkspaceGraph(rootDir);
  const changedFilesResult = options.changedFiles ?? detectChangedFiles(options);

  if (typeof changedFilesResult === 'object' && !Array.isArray(changedFilesResult) && changedFilesResult.fallbackToFull) {
    return {
      mode: 'full',
      reason: changedFilesResult.reason,
      changedFiles: changedFilesResult.changedFiles ?? [],
      ignoredFiles: [],
      directWorkspaceNames: [],
      selectedWorkspaceNames: graph.workspaces
        .filter(workspace => workspace.scripts[taskName])
        .map(workspace => workspace.name),
      reasonsByWorkspace: new Map(),
    };
  }

  const changedFiles = changedFilesResult;
  const classification = classifyScopeFromFiles(changedFiles, graph);

  if (classification.fallbackToFull) {
    return {
      mode: 'full',
      reason: classification.reason,
      changedFiles,
      ignoredFiles: classification.ignoredFiles,
      directWorkspaceNames: [...classification.directWorkspaceNames].sort(),
      selectedWorkspaceNames: graph.workspaces
        .filter(workspace => workspace.scripts[taskName])
        .map(workspace => workspace.name),
      reasonsByWorkspace: new Map(),
    };
  }

  const directWorkspaceNames = [...classification.directWorkspaceNames].sort();
  const selectedWorkspaceNames = expandImpactedWorkspaces(taskName, directWorkspaceNames, graph)
    .filter(workspaceName => graph.workspaceByName.get(workspaceName)?.scripts[taskName]);
  const selectedWorkspaceSet = new Set(selectedWorkspaceNames);
  const reasonsByWorkspace = buildReasonMap(selectedWorkspaceSet, directWorkspaceNames, graph.reverseDependencies);

  return {
    mode: selectedWorkspaceNames.length > 0 ? 'scoped' : 'empty',
    reason: selectedWorkspaceNames.length > 0
      ? 'Escopo incremental resolvido por git diff e grafo de dependências'
      : 'Nenhum workspace aplicável foi afetado',
    changedFiles,
    ignoredFiles: classification.ignoredFiles,
    directWorkspaceNames,
    selectedWorkspaceNames,
    reasonsByWorkspace,
    workspaceFiles: classification.workspaceFileMap,
  };
}

export function formatScopeReport(taskName, scopeResult) {
  const lines = [`[alice-scope] Task: ${taskName}`];

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

  return `${lines.join('\n')}\n`;
}
