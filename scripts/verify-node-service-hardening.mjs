import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const SERVICE_SRC_DIRS = [
  'apps/auth-service/src',
  'apps/chat-service/src',
  'apps/llm-gateway-service/src',
  'apps/rag-service/src',
  'apps/training-service/src',
  'apps/integrations-service/src',
  'apps/api-gateway/src',
  'apps/observability-service/src',
  'apps/gpu-manager-service/src',
];

function collectSourceFiles(directoryPath) {
  const absolutePath = path.join(ROOT_DIR, directoryPath);
  if (!existsSync(absolutePath)) {
    return [];
  }

  const files = [];
  const stack = [absolutePath];

  while (stack.length > 0) {
    const currentDirectory = stack.pop();
    if (!currentDirectory) {
      continue;
    }

    for (const entry of readdirSync(currentDirectory)) {
      const entryPath = path.join(currentDirectory, entry);
      const entryStats = statSync(entryPath);

      if (entryStats.isDirectory()) {
        stack.push(entryPath);
        continue;
      }

      if (/\.(c|m)?ts$/.test(entryPath)) {
        files.push(entryPath);
      }
    }
  }

  return files;
}

function directoryContainsPattern(filePaths, pattern) {
  return filePaths.some(filePath => pattern.test(readFileSync(filePath, 'utf8')));
}

const failures = [];

for (const serviceDir of SERVICE_SRC_DIRS) {
  const serviceFiles = collectSourceFiles(serviceDir);

  if (serviceFiles.length === 0) {
    continue;
  }

  const hasSharedUtilsImport = directoryContainsPattern(serviceFiles, /@alice\/shared-utils/);
  const hasSecurityMiddlewareUsage = directoryContainsPattern(
    serviceFiles,
    /createSecurityMiddleware|createRateLimiter/,
  );
  const hasServerTimeout = directoryContainsPattern(serviceFiles, /server\.timeout/);
  const hasKeepAliveTimeout = directoryContainsPattern(serviceFiles, /keepAliveTimeout/);
  const hasHeadersTimeout = directoryContainsPattern(serviceFiles, /headersTimeout/);

  if (!hasSharedUtilsImport || !hasSecurityMiddlewareUsage) {
    failures.push(`${serviceDir} sem evidência de express hardening centralizado`);
  }

  if (!hasServerTimeout || !hasKeepAliveTimeout || !hasHeadersTimeout) {
    failures.push(`${serviceDir} sem configuração completa de timeouts HTTP`);
  }
}

if (failures.length > 0) {
  console.error('ERRO: verificacao de hardening e timeouts encontrou pendencias.');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('✅ Express hardening verificado');
console.log('✅ Server timeouts verificados');
