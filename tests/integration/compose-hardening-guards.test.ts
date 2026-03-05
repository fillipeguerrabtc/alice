import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf-8');
}

describe('compose hardening guards', () => {
  it('keeps healthchecks and restart policy in all production stacks', () => {
    const infra = read('infra/docker/stacks/docker-compose.infra.yml');
    const alice = read('infra/docker/stacks/docker-compose.alice.yml');
    const observability = read('infra/docker/stacks/docker-compose.observability.yml');
    const backup = read('infra/docker/stacks/docker-compose.backup.yml');

    for (const content of [infra, alice, observability, backup]) {
      expect(content.includes('healthcheck:')).toBe(true);
      expect(content.includes('restart:')).toBe(true);
    }
  });

  it('keeps startup ordering with service_healthy dependencies for critical services', () => {
    const infra = read('infra/docker/stacks/docker-compose.infra.yml');
    const alice = read('infra/docker/stacks/docker-compose.alice.yml');

    expect(infra.includes('depends_on:')).toBe(true);
    expect(infra.includes('condition: service_healthy')).toBe(true);
    expect(infra.includes('pgbackrest-init:')).toBe(true);
    expect(infra.includes('postgres:')).toBe(true);

    expect(alice.includes('alice-chat:')).toBe(true);
    expect(alice.includes('alice-llm-gateway:')).toBe(true);
    expect(alice.includes('gpu-manager:')).toBe(true);
    expect(alice.includes('condition: service_healthy')).toBe(true);
  });
});
