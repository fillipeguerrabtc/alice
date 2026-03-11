import { readFileSync } from 'node:fs';
import path from 'node:path';

function getObservabilitySourceFiles(): string[] {
  const observabilitySrcDir = path.join(process.cwd(), 'apps', 'observability-service', 'src');
  return [
    path.join(observabilitySrcDir, 'index.ts'),
    path.join(observabilitySrcDir, 'observability-health-routes.ts'),
    path.join(observabilitySrcDir, 'observability-metrics-routes.ts'),
    path.join(observabilitySrcDir, 'observability-admin-routes.ts'),
  ];
}

export function loadObservabilitySource(): string {
  return getObservabilitySourceFiles()
    .map((filePath) => readFileSync(filePath, 'utf-8'))
    .join('\n');
}

export function loadObservabilityRouteSignatures(): Set<string> {
  const source = loadObservabilitySource();
  const routeRegex = /app\.(get|post|patch|delete)\(\s*'([^']+)'/g;

  const signatures = new Set<string>();
  let match = routeRegex.exec(source);
  while (match) {
    const [, method, pathname] = match;
    signatures.add(`${method.toUpperCase()} ${pathname}`);
    match = routeRegex.exec(source);
  }
  return signatures;
}
