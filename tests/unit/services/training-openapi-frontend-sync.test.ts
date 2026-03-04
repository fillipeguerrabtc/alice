import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { trainingServicePaths } from '../../../apps/training-service/src/openapi-specs';

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

const MANUAL_VARIABLE_URL_ROUTES: Array<{ method: HttpMethod; path: string }> = [
  { method: 'GET', path: '/api/training/auto-learning/status' },
  { method: 'GET', path: '/api/training/run/status' },
  { method: 'GET', path: '/api/training/queue/status' },
];

function normalizeFrontendPath(rawPath: string): string {
  const withoutQuery = rawPath.split('?')[0];
  return withoutQuery.replace(/\$\{[^}]+\}/g, '{id}');
}

function extractTrainingApiCallsFromFrontend(): Array<{ method: HttpMethod; path: string }> {
  const trainingPagePath = path.join(process.cwd(), 'apps', 'frontend-service', 'src', 'pages', 'Training.tsx');
  const source = readFileSync(trainingPagePath, 'utf-8');
  const apiRequestRegex = /apiRequest\(\s*'(GET|POST|PATCH|DELETE)'\s*,\s*(`[^`]+`|'[^']+')/g;

  const calls: Array<{ method: HttpMethod; path: string }> = [];
  let match = apiRequestRegex.exec(source);
  while (match) {
    const method = match[1] as HttpMethod;
    const literal = match[2];
    const pathValue = literal.slice(1, -1);
    if (!pathValue.startsWith('/api/training')) {
      match = apiRequestRegex.exec(source);
      continue;
    }
    calls.push({
      method,
      path: normalizeFrontendPath(pathValue),
    });
    match = apiRequestRegex.exec(source);
  }

  return calls;
}

describe('Training OpenAPI - frontend route sync', () => {
  it('documents every training endpoint called by Training.tsx', () => {
    const openApiEntries = new Set<string>();

    for (const [openApiPath, methods] of Object.entries(trainingServicePaths)) {
      for (const method of Object.keys(methods)) {
        openApiEntries.add(`${method.toUpperCase()} ${openApiPath}`);
      }
    }

    const frontendCalls = [
      ...extractTrainingApiCallsFromFrontend(),
      ...MANUAL_VARIABLE_URL_ROUTES,
    ];

    const uniqueFrontendCalls = Array.from(
      new Set(frontendCalls.map((call) => `${call.method} ${call.path}`))
    );

    for (const signature of uniqueFrontendCalls) {
      expect(
        openApiEntries.has(signature),
        `Frontend Training endpoint not documented in OpenAPI: ${signature}`
      ).toBe(true);
    }
  });
});

