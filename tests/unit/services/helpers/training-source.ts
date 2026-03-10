import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

function getTrainingSourceFiles(): string[] {
  const trainingSrcDir = path.join(process.cwd(), 'apps', 'training-service', 'src');
  const files: string[] = [path.join(trainingSrcDir, 'index.ts')];
  const routesDir = path.join(trainingSrcDir, 'routes');

  if (existsSync(routesDir)) {
    for (const routeFile of readdirSync(routesDir).sort()) {
      if (!routeFile.endsWith('.ts')) continue;
      files.push(path.join(routesDir, routeFile));
    }
  }

  const extraFiles = [
    'training-governance-audit.ts',
    'training-run-start-idempotency.ts',
  ];
  for (const extraFile of extraFiles) {
    files.push(path.join(trainingSrcDir, extraFile));
  }

  return files;
}

export function loadTrainingSource(): string {
  return getTrainingSourceFiles()
    .filter((filePath) => existsSync(filePath))
    .map((filePath) => readFileSync(filePath, 'utf-8'))
    .join('\n');
}

export function loadTrainingRouteSignatures(): Set<string> {
  const source = loadTrainingSource();
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
