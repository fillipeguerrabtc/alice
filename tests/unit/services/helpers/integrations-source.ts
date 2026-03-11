import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

function getIntegrationsSourceFiles(): string[] {
  const integrationsSrcDir = path.join(process.cwd(), 'apps', 'integrations-service', 'src');
  const files: string[] = [path.join(integrationsSrcDir, 'index.ts')];
  const routesDir = path.join(integrationsSrcDir, 'routes');

  if (existsSync(routesDir)) {
    for (const routeFile of readdirSync(routesDir).sort()) {
      if (!routeFile.endsWith('.ts')) continue;
      files.push(path.join(routesDir, routeFile));
    }
  }

  const extraFiles = [
    'integrations-lifecycle.ts',
    'integrations-immutable-audit-runtime-service.ts',
  ];
  for (const extraFile of extraFiles) {
    files.push(path.join(integrationsSrcDir, extraFile));
  }

  return files;
}

export function loadIntegrationsSource(): string {
  return getIntegrationsSourceFiles()
    .filter((filePath) => existsSync(filePath))
    .map((filePath) => readFileSync(filePath, 'utf-8'))
    .join('\n');
}
