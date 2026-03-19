#!/usr/bin/env node
/**
 * Executor de lint para arquivos raiz fora dos workspaces do Turbo.
 *
 * Author: Fillipe Guerra
 * Data: 19 de Marco de 2026
 */

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { ROOT_DIR, detectChangedFiles } from './workspace-scope.mjs';

function parseArguments(rawArgs) {
  return {
    full: rawArgs.includes('--full'),
  };
}

function collectFiles(rootRelativePath, matcher) {
  const absolutePath = join(ROOT_DIR, rootRelativePath);
  const results = [];
  const stack = [absolutePath];

  while (stack.length > 0) {
    const currentPath = stack.pop();
    if (!currentPath) {
      continue;
    }

    const currentStat = statSync(currentPath);
    if (currentStat.isDirectory()) {
      for (const entry of readdirSync(currentPath)) {
        stack.push(join(currentPath, entry));
      }
      continue;
    }

    if (matcher(currentPath)) {
      results.push(currentPath.replace(`${ROOT_DIR}/`, ''));
    }
  }

  return results.sort((left, right) => left.localeCompare(right));
}

function isRootLintTarget(filePath) {
  return filePath === 'eslint.config.mjs'
    || (filePath.startsWith('scripts/') && filePath.endsWith('.mjs'))
    || (filePath.startsWith('tests/unit/') && filePath.endsWith('.ts'));
}

function resolveFullTargets() {
  const files = new Set(['eslint.config.mjs']);

  for (const filePath of collectFiles('scripts', filePath => filePath.endsWith('.mjs'))) {
    files.add(filePath);
  }

  for (const filePath of collectFiles('tests/unit', filePath => filePath.endsWith('.ts'))) {
    files.add(filePath);
  }

  return [...files].sort((left, right) => left.localeCompare(right));
}

function runEslint(filePaths) {
  if (filePaths.length === 0) {
    console.log('[alice-root-lint] Nenhum arquivo raiz elegível para lint.');
    process.exit(0);
  }

  console.log(`[alice-root-lint] Arquivos selecionados (${filePaths.length}): ${filePaths.join(', ')}`);

  const result = spawnSync(
    'pnpm',
    ['exec', 'eslint', '--no-ignore', ...filePaths],
    {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      env: process.env,
    },
  );

  if (typeof result.status === 'number') {
    process.exit(result.status);
  }

  process.exit(1);
}

const options = parseArguments(process.argv.slice(2));

if (options.full || process.env.ALICE_FORCE_FULL_VALIDATION === '1') {
  runEslint(resolveFullTargets());
}

const changedFiles = detectChangedFiles({ rootDir: ROOT_DIR });
if (!Array.isArray(changedFiles)) {
  console.log(`[alice-root-lint] ${changedFiles.reason}`);
  console.log('[alice-root-lint] Fallback para lint full dos arquivos raiz elegíveis.');
  runEslint(resolveFullTargets());
}

const selectedFiles = changedFiles.filter(isRootLintTarget);
runEslint(selectedFiles);
