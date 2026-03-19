import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import {
  ROOT_DIR,
  isDocumentationPath,
  isPipelineOnlyPath,
} from './workspace-scope.mjs';

const WINDOW_ARG = process.argv[2] ?? '200';
const WINDOW = Number.parseInt(WINDOW_ARG, 10);
const ENFORCE_FAILURE = process.env.ENFORCE_FAILURE === 'true';
const DOC_TOUCH_WARN_THRESHOLD_PCT = Number.parseFloat(
  process.env.DOC_TOUCH_WARN_THRESHOLD_PCT ?? process.env.DOC_TOUCH_THRESHOLD_PCT ?? '45',
);
const PIPELINE_TOUCH_WARN_THRESHOLD_PCT = Number.parseFloat(
  process.env.PIPELINE_TOUCH_WARN_THRESHOLD_PCT ?? '35',
);
const LARGE_SOURCE_FILE_WARN_LINES = Number.parseInt(
  process.env.LARGE_SOURCE_FILE_WARN_LINES ?? '700',
  10,
);
const LARGE_SOURCE_FILE_FAIL_LINES = Number.parseInt(
  process.env.LARGE_SOURCE_FILE_FAIL_LINES ?? '900',
  10,
);

function execGit(args) {
  return execFileSync('git', args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function getFileLineCount(relativeFilePath) {
  const absolutePath = path.join(ROOT_DIR, relativeFilePath);

  if (!existsSync(absolutePath)) {
    return null;
  }

  const content = readFileSync(absolutePath, 'utf8');
  return content.length === 0 ? 0 : content.split(/\r?\n/).length;
}

function isSourceFilePath(filePath) {
  return /\.(c|m)?(t|j)sx?$/.test(filePath);
}

function resolveHistoricalRange(totalCommitsAvailable) {
  if (totalCommitsAvailable <= WINDOW) {
    return 'HEAD';
  }

  return `HEAD~${WINDOW}..HEAD`;
}

function isValidCommitRef(ref) {
  if (!ref) {
    return false;
  }

  try {
    execGit(['cat-file', '-e', `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function resolveEventRange() {
  const explicitBase = process.env.ALICE_ENTERPRISE_FOCUS_BASE_SHA ?? '';
  const explicitHead = process.env.ALICE_ENTERPRISE_FOCUS_HEAD_SHA ?? '';
  if (explicitBase && explicitHead) {
    return {
      baseSha: explicitBase,
      headSha: explicitHead,
      diffMode: process.env.ALICE_ENTERPRISE_FOCUS_DIFF_MODE ?? 'double_dot',
      source: 'range_explicit',
    };
  }

  const eventName = process.env.GITHUB_EVENT_NAME ?? '';
  const eventPath = process.env.GITHUB_EVENT_PATH ?? '';

  if (!eventName || !eventPath || !existsSync(eventPath)) {
    return null;
  }

  const event = JSON.parse(readFileSync(eventPath, 'utf8'));

  if (eventName === 'push') {
    const baseSha = typeof event.before === 'string' ? event.before : '';
    const headSha =
      typeof event.after === 'string' && event.after
        ? event.after
        : (process.env.GITHUB_SHA ?? '');

    if (!headSha) {
      return null;
    }

    return {
      baseSha,
      headSha,
      diffMode: /^0+$/.test(baseSha) ? 'single_commit' : 'double_dot',
      source: 'github_push',
    };
  }

  if (eventName.startsWith('pull_request')) {
    const baseSha = event.pull_request?.base?.sha ?? '';
    const headSha = event.pull_request?.head?.sha ?? process.env.GITHUB_SHA ?? '';
    if (!baseSha || !headSha) {
      return null;
    }

    return {
      baseSha,
      headSha,
      diffMode: 'triple_dot',
      source: 'github_pull_request',
    };
  }

  return null;
}

function getChangedPaths(baseRef, headRef, diffMode) {
  switch (diffMode) {
    case 'triple_dot':
      return execGit(['diff', '--name-only', `${baseRef}...${headRef}`])
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
    case 'single_commit':
      return execGit(['show', '--pretty=format:', '--name-only', headRef])
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
    default:
      return execGit(['diff', '--name-only', `${baseRef}..${headRef}`])
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
  }
}

function countCommitsInRange(baseRef, headRef, diffMode) {
  switch (diffMode) {
    case 'triple_dot':
      return Number.parseInt(execGit(['rev-list', '--right-only', '--count', `${baseRef}...${headRef}`]), 10);
    case 'single_commit':
      return 1;
    default:
      return Number.parseInt(execGit(['rev-list', '--count', `${baseRef}..${headRef}`]), 10);
  }
}

function formatPercentage(value, total) {
  if (total <= 0) {
    return '0.00';
  }

  return ((value * 100) / total).toFixed(2);
}

function classifyTouches(filePaths) {
  const docsTouches = filePaths.filter(filePath => isDocumentationPath(filePath)).length;
  const pipelineTouches = filePaths.filter(filePath => isPipelineOnlyPath(filePath)).length;
  const sourceTouches = filePaths.filter(filePath => isSourceFilePath(filePath)).length;

  return {
    docsTouches,
    pipelineTouches,
    sourceTouches,
    totalTouches: filePaths.length,
  };
}

function getLargeChangedSourceFiles(filePaths) {
  return [...new Set(filePaths)]
    .filter(filePath => isSourceFilePath(filePath))
    .map(filePath => ({
      filePath,
      lineCount: getFileLineCount(filePath),
    }))
    .filter(file => file.lineCount !== null)
    .sort((left, right) => right.lineCount - left.lineCount);
}

function logGitHubOutput(key, value) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
}

if (!Number.isInteger(WINDOW) || WINDOW <= 0) {
  console.error(`ERRO: janela de commits invalida: '${WINDOW_ARG}'. Use um inteiro positivo.`);
  process.exit(2);
}

const totalCommitsAvailable = Number.parseInt(execGit(['rev-list', '--count', 'HEAD']), 10);
if (totalCommitsAvailable <= 0) {
  console.error('ERRO: repositorio sem commits.');
  process.exit(2);
}

const historicalRange = resolveHistoricalRange(totalCommitsAvailable);
let analysisSource = 'historical_window';
let primaryRange = historicalRange;
let primaryChangedPaths = execGit(['log', '--name-only', '--pretty=format:', historicalRange])
  .split('\n')
  .map(line => line.trim())
  .filter(Boolean);
let commitsTotal = Number.parseInt(
  execGit(['log', '--pretty=format:%s', historicalRange]).split('\n').filter(Boolean).length.toString(),
  10,
);

const eventRange = resolveEventRange();

if (eventRange && isValidCommitRef(eventRange.headSha)) {
  if (eventRange.diffMode === 'single_commit' || isValidCommitRef(eventRange.baseSha)) {
    analysisSource = eventRange.source;
    primaryRange =
      eventRange.diffMode === 'single_commit'
        ? eventRange.headSha
        : `${eventRange.baseSha}..${eventRange.headSha}`;
    primaryChangedPaths = getChangedPaths(eventRange.baseSha, eventRange.headSha, eventRange.diffMode);
    commitsTotal = countCommitsInRange(eventRange.baseSha, eventRange.headSha, eventRange.diffMode);
  }
}

const primaryTouches = classifyTouches(primaryChangedPaths);
const historicalTouches = classifyTouches(
  execGit(['log', '--name-only', '--pretty=format:', historicalRange])
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean),
);
const docTouchPct = formatPercentage(primaryTouches.docsTouches, primaryTouches.totalTouches);
const pipelineTouchPct = formatPercentage(primaryTouches.pipelineTouches, primaryTouches.totalTouches);
const historicalDocTouchPct = formatPercentage(
  historicalTouches.docsTouches,
  historicalTouches.totalTouches,
);
const largeChangedSourceFiles = getLargeChangedSourceFiles(primaryChangedPaths);
const largeSourceFilesWarn = largeChangedSourceFiles.filter(
  file => file.lineCount >= LARGE_SOURCE_FILE_WARN_LINES,
);
const largeSourceFilesFail = largeChangedSourceFiles.filter(
  file => file.lineCount >= LARGE_SOURCE_FILE_FAIL_LINES,
);

logGitHubOutput('analysis_source', analysisSource);
logGitHubOutput('docs_touch_pct', docTouchPct);
logGitHubOutput('pipeline_touch_pct', pipelineTouchPct);

console.log(`Modo de analise: ${analysisSource}`);
console.log(`Range principal: ${primaryRange}`);
console.log(`Commits no range principal: ${commitsTotal}`);
console.log(`Touches totais: ${primaryTouches.totalTouches}`);
console.log(`Touches docs+README: ${primaryTouches.docsTouches} (${docTouchPct}%)`);
console.log(`Touches pipeline-only: ${primaryTouches.pipelineTouches} (${pipelineTouchPct}%)`);
console.log(`Touches codigo fonte: ${primaryTouches.sourceTouches}`);
if (analysisSource !== 'historical_window') {
  console.log(`Range historico auxiliar: ${historicalRange}`);
  console.log(
    `Touches docs+README historico: ${historicalTouches.docsTouches} (${historicalDocTouchPct}%)`,
  );
}

if (largeChangedSourceFiles.length > 0) {
  console.log('Top arquivos fonte alterados por densidade:');
  for (const file of largeChangedSourceFiles.slice(0, 5)) {
    console.log(`- ${file.filePath}: ${file.lineCount} linhas`);
  }
}

let warningCount = 0;

function warn(message) {
  warningCount += 1;
  console.log(`WARN - ${message}`);
}

if (Number.parseFloat(docTouchPct) > DOC_TOUCH_WARN_THRESHOLD_PCT) {
  warn(`Churn documental elevado no delta atual: ${docTouchPct}% > ${DOC_TOUCH_WARN_THRESHOLD_PCT}%`);
} else {
  console.log(
    `OK   - Churn documental do delta atual: ${docTouchPct}% <= ${DOC_TOUCH_WARN_THRESHOLD_PCT}%`,
  );
}

if (Number.parseFloat(pipelineTouchPct) > PIPELINE_TOUCH_WARN_THRESHOLD_PCT) {
  warn(`Churn de pipeline elevado no delta atual: ${pipelineTouchPct}% > ${PIPELINE_TOUCH_WARN_THRESHOLD_PCT}%`);
} else {
  console.log(
    `OK   - Churn de pipeline do delta atual: ${pipelineTouchPct}% <= ${PIPELINE_TOUCH_WARN_THRESHOLD_PCT}%`,
  );
}

if (analysisSource !== 'historical_window') {
  if (Number.parseFloat(historicalDocTouchPct) > DOC_TOUCH_WARN_THRESHOLD_PCT) {
    warn(
      `Churn documental historico elevado (telemetria): ${historicalDocTouchPct}% > ${DOC_TOUCH_WARN_THRESHOLD_PCT}%`,
    );
  } else {
    console.log(
      `OK   - Churn documental historico (telemetria): ${historicalDocTouchPct}% <= ${DOC_TOUCH_WARN_THRESHOLD_PCT}%`,
    );
  }
}

if (largeSourceFilesWarn.length > 0) {
  warn(
    `Arquivos fonte alterados acima do threshold de atencao (${LARGE_SOURCE_FILE_WARN_LINES} linhas): ${largeSourceFilesWarn
      .map(file => `${file.filePath}=${file.lineCount}`)
      .join(', ')}`,
  );
} else {
  console.log(
    `OK   - Nenhum arquivo fonte alterado acima de ${LARGE_SOURCE_FILE_WARN_LINES} linhas no delta atual.`,
  );
}

if (ENFORCE_FAILURE && largeSourceFilesFail.length > 0) {
  console.log(
    `FAIL - Arquivos fonte alterados acima do threshold estrito (${LARGE_SOURCE_FILE_FAIL_LINES} linhas): ${largeSourceFilesFail
      .map(file => `${file.filePath}=${file.lineCount}`)
      .join(', ')}`,
  );
  console.log('Resultado: FAIL (telemetria strict detectou hotspots acima do limite estrito).');
  process.exit(1);
}

if (warningCount > 0) {
  console.log('Resultado: WARN (telemetria de foco registrou hotspots ou churn acima do alvo).');
  process.exit(0);
}

console.log('Resultado: OK (telemetria de foco dentro do alvo).');
