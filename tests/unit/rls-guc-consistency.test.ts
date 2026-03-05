import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const LEGACY_TENANT_GUC_PATTERN = /current_setting\(\s*'app\.tenant_id'\s*(?:,\s*true\s*)?\)/i;

function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '');
}

function parseMigrationVersion(filename: string): number | null {
  const match = /^(\d{4})/.exec(filename);
  if (!match) return null;
  return Number.parseInt(match[1], 10);
}

describe('RLS GUC consistency guard', () => {
  it('blocks legacy app.tenant_id usage in migrations from 0088 onward', () => {
    const migrationsDir = path.join(process.cwd(), 'migrations');
    const migrationFiles = readdirSync(migrationsDir).filter((filename) => filename.endsWith('.sql'));

    const offenders: string[] = [];

    for (const filename of migrationFiles) {
      const version = parseMigrationVersion(filename);
      if (version === null || version < 88) continue;

      const source = readFileSync(path.join(migrationsDir, filename), 'utf-8');
      const sanitized = stripSqlComments(source);
      if (LEGACY_TENANT_GUC_PATTERN.test(sanitized)) {
        offenders.push(filename);
      }
    }

    expect(
      offenders,
      `Legacy app.tenant_id references are not allowed in migrations >= 0088: ${offenders.join(', ')}`
    ).toEqual([]);
  });

  it('keeps the RLS unification migration in place', () => {
    const migrationPath = path.join(process.cwd(), 'migrations', '0088_rls_guc_unification.sql');
    const source = readFileSync(migrationPath, 'utf-8');
    const sanitized = stripSqlComments(source);

    expect(sanitized.includes('current_tenant_id()')).toBe(true);
    expect(LEGACY_TENANT_GUC_PATTERN.test(sanitized)).toBe(false);
  });
});
