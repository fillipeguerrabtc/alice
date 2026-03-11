import { readFileSync } from 'node:fs';
import path from 'node:path';

function getRagSourceFiles(): string[] {
  const ragSrcDir = path.join(process.cwd(), 'apps', 'rag-service', 'src');
  return [
    path.join(ragSrcDir, 'index.ts'),
    path.join(ragSrcDir, 'rag-document-routes.ts'),
  ];
}

export function loadRagSource(): string {
  return getRagSourceFiles()
    .map((filePath) => readFileSync(filePath, 'utf-8'))
    .join('\n');
}

export function loadRagRouteSignatures(): Set<string> {
  const source = loadRagSource();
  const routeRegex = /app\.(get|post|patch|delete)\('([^']+)'/g;

  const signatures = new Set<string>();
  let match = routeRegex.exec(source);
  while (match) {
    const [, method, pathname] = match;
    signatures.add(`${method.toUpperCase()} ${pathname}`);
    match = routeRegex.exec(source);
  }
  return signatures;
}
