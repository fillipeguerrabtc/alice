import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function loadBiometricsSource(): string {
  const sourcePath = path.join(process.cwd(), 'apps', 'biometrics-service', 'main.py');
  return readFileSync(sourcePath, 'utf-8');
}

function loadAuthSource(): string {
  const indexSourcePath = path.join(process.cwd(), 'apps', 'auth-service', 'src', 'index.ts');
  const authRoutesSourcePath = path.join(process.cwd(), 'apps', 'auth-service', 'src', 'auth-routes.ts');
  const biometricsRoutesSourcePath = path.join(process.cwd(), 'apps', 'auth-service', 'src', 'routes', 'auth-biometrics-routes.ts');
  return [indexSourcePath, authRoutesSourcePath, biometricsRoutesSourcePath]
    .map((sourcePath) => readFileSync(sourcePath, 'utf-8'))
    .join('\n');
}

describe('biometrics liveness hardening guards', () => {
  it('keeps liveness env controls and passive liveness scoring in biometrics-service', () => {
    const source = loadBiometricsSource();
    expect(source.includes('BIOMETRICS_LIVENESS_THRESHOLD')).toBe(true);
    expect(source.includes('BIOMETRICS_ENFORCE_LIVENESS')).toBe(true);
    expect(source.includes('LIVENESS_THRESHOLD =')).toBe(true);
    expect(source.includes('ENFORCE_LIVENESS =')).toBe(true);
    expect(source.includes('def compute_passive_liveness(')).toBe(true);
    expect(source.includes('alice_biometrics_liveness_rejections_total')).toBe(true);
  });

  it('enforces liveness checks in enroll and verify paths with fail-closed behavior', () => {
    const source = loadBiometricsSource();
    const enrollPattern = /@app\.post\("\/enroll"\)[\s\S]*?if ENFORCE_LIVENESS and liveness_score < LIVENESS_THRESHOLD:/;
    const verifyPattern = /@app\.post\("\/verify"\)[\s\S]*?if ENFORCE_LIVENESS and liveness_score < LIVENESS_THRESHOLD:/;
    expect(enrollPattern.test(source)).toBe(true);
    expect(verifyPattern.test(source)).toBe(true);
  });

  it('keeps auth-service mapping upstream biometrics errors without collapsing all failures to 500', () => {
    const source = loadAuthSource();
    expect(source.includes('class BiometricsServiceError extends Error')).toBe(true);
    expect(source.includes('function resolveBiometricsError(error: unknown)')).toBe(true);
    expect(source.includes('const mapped = resolveBiometricsError(error);')).toBe(true);
    expect(source.includes('res.status(mapped.status).json({ error: mapped.message });')).toBe(true);
  });
});
