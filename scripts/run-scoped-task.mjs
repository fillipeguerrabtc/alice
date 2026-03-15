#!/usr/bin/env node
/**
 * Executor CLI para tasks Turbo com escopo incremental fail-closed.
 *
 * Author: Fillipe Guerra
 * Data: 15 de Março de 2026
 */

import { spawnSync } from 'node:child_process';
import {
  ROOT_DIR,
  formatScopeReport,
  loadWorkspaceGraph,
  resolveTaskScope,
} from './workspace-scope.mjs';

const VALID_TASKS = new Set(['build', 'lint', 'typecheck']);
const TURBO_CACHE_DIR = '.cache/turbo';

function parseArguments(rawArgs) {
  const args = [...rawArgs];
  const taskName = args.shift();
  const options = {
    full: false,
    baseRef: '',
    headRef: '',
  };

  while (args.length > 0) {
    const currentArg = args.shift();

    if (currentArg === '--full') {
      options.full = true;
      continue;
    }

    if (currentArg === '--base') {
      options.baseRef = args.shift() ?? '';
      continue;
    }

    if (currentArg === '--head') {
      options.headRef = args.shift() ?? '';
      continue;
    }
  }

  return { taskName, options };
}

function runTurbo(taskName, workspaceNames) {
  const turboArgs = ['exec', 'turbo', 'run', taskName, '--cache-dir', TURBO_CACHE_DIR];

  for (const workspaceName of workspaceNames) {
    turboArgs.push('--filter', workspaceName);
  }

  const result = spawnSync('pnpm', turboArgs, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: process.env,
  });

  if (typeof result.status === 'number') {
    process.exit(result.status);
  }

  process.exit(1);
}

const { taskName, options } = parseArguments(process.argv.slice(2));
if (!VALID_TASKS.has(taskName)) {
  console.error(`[alice-scope] Task inválida. Use build, lint ou typecheck.`);
  process.exit(1);
}

const graph = loadWorkspaceGraph(ROOT_DIR);

if (options.full || process.env.ALICE_FORCE_FULL_VALIDATION === '1') {
  const fullWorkspaceNames = graph.workspaces
    .filter(workspace => workspace.scripts[taskName])
    .map(workspace => workspace.name);

  console.log(`[alice-scope] Task: ${taskName}`);
  console.log('[alice-scope] Reason: Execução full solicitada explicitamente');
  console.log(`[alice-scope] Selected workspaces (${fullWorkspaceNames.length}): ${fullWorkspaceNames.join(', ')}`);
  runTurbo(taskName, fullWorkspaceNames);
}

const scopeResult = resolveTaskScope(taskName, {
  rootDir: ROOT_DIR,
  graph,
  baseRef: options.baseRef,
  headRef: options.headRef,
});

process.stdout.write(formatScopeReport(taskName, scopeResult));

if (scopeResult.mode === 'empty') {
  console.log(`[alice-scope] Nenhum workspace precisa executar ${taskName}.`);
  process.exit(0);
}

runTurbo(taskName, scopeResult.selectedWorkspaceNames);
