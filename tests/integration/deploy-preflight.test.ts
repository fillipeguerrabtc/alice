import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf-8');
}

describe('deploy preflight scripts', () => {
  it('keeps shell and powershell preflight scripts available', () => {
    expect(existsSync(path.join(process.cwd(), 'infra/scripts/preflight-secrets.sh'))).toBe(true);
    expect(existsSync(path.join(process.cwd(), 'infra/scripts/preflight-secrets.ps1'))).toBe(true);
  });

  it('checks required runtime secrets by stack matrix', () => {
    const shellSource = read('infra/scripts/preflight-secrets.sh');
    expect(shellSource.includes('--stack all|alice|infra|observability|backup')).toBe(true);
    expect(shellSource.includes('POSTGRES_PASSWORD')).toBe(true);
    expect(shellSource.includes('INTERNAL_API_SECRET')).toBe(true);
    expect(shellSource.includes('QDRANT_API_KEY')).toBe(true);
    expect(shellSource.includes('BACKUP_CIPHER_PASS')).toBe(true);
  });

  it('supports compose config validation as a fail-fast preflight gate', () => {
    const shellSource = read('infra/scripts/preflight-secrets.sh');
    const powershellSource = read('infra/scripts/preflight-secrets.ps1');
    expect(shellSource.includes('COMPOSE_FILES=()')).toBe(true);
    expect(shellSource.includes('compose_args+=(-f "$compose_file")')).toBe(true);
    expect(shellSource.includes('docker compose --env-file "$ENV_FILE" "${compose_args[@]}" config')).toBe(true);
    expect(powershellSource.includes('[string[]]$ComposeFile = @()')).toBe(true);
    expect(powershellSource.includes('$composeArgs += @(\'-f\', $file)')).toBe(true);
    expect(powershellSource.includes('& docker compose --env-file $EnvFile @composeArgs config')).toBe(true);
  });
});
