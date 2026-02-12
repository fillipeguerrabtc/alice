/**
 * Smoke tests - Dashboards Grafana (JSON)
 *
 * Valida existência, JSON válido e estrutura mínima dos dashboards provisionados.
 * SSOT: apps/observability-service/config/grafana/dashboards/
 *
 * Documentação em PT-BR (Regra 10 CLAUDE.md).
 * Regra 9: Validação contínua.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DASHBOARDS_DIR = join(
  process.cwd(),
  'apps',
  'observability-service',
  'config',
  'grafana',
  'dashboards',
);

/** Dashboards obrigatórios para deploy (Home e Demo Trading são críticos para smoke pós-deploy). */
const REQUIRED_DASHBOARDS = [
  '00-home.json',
  'alice-demo-trading.json',
  'alice-biometrics.json',
  'alice-llm-gateway.json',
  'llm-metrics.json',
];

interface GrafanaDashboardMeta {
  title?: string;
  uid?: string | null;
  panels?: unknown[];
  schemaVersion?: number;
}

describe('Observability - Dashboards Grafana (smoke)', () => {
  it('deve existir o diretório de dashboards', () => {
    const entries = readdirSync(DASHBOARDS_DIR, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile() && e.name.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(REQUIRED_DASHBOARDS.length);
  });

  it('cada dashboard obrigatório deve existir', () => {
    const entries = readdirSync(DASHBOARDS_DIR, { withFileTypes: true });
    const names = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
    for (const name of REQUIRED_DASHBOARDS) {
      expect(names.has(name), `Dashboard obrigatório ausente: ${name}`).toBe(true);
    }
  });

  it('cada arquivo .json no diretório deve ser JSON válido com panels e uid/title', () => {
    const entries = readdirSync(DASHBOARDS_DIR, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile() && e.name.endsWith('.json'));

    for (const dirent of files) {
      const path = join(DASHBOARDS_DIR, dirent.name);
      const raw = readFileSync(path, 'utf-8');

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        expect.fail(`${dirent.name}: JSON inválido - ${String(err)}`);
      }

      expect(typeof parsed).toBe('object');
      expect(parsed).not.toBe(null);

      const dash = parsed as GrafanaDashboardMeta;
      expect(Array.isArray(dash.panels), `${dirent.name}: deve ter "panels" (array)`).toBe(true);
      expect(
        typeof dash.uid === 'string' || typeof dash.title === 'string',
        `${dirent.name}: deve ter "uid" ou "title"`,
      ).toBe(true);
      if (dash.uid !== undefined && dash.uid !== null) {
        expect(typeof dash.uid).toBe('string');
        expect(dash.uid.length).toBeGreaterThan(0);
      }
    }
  });

  it('00-home.json deve ter uid ou title e link para Demo Trading', () => {
    const path = join(DASHBOARDS_DIR, '00-home.json');
    const raw = readFileSync(path, 'utf-8');
    const dash = JSON.parse(raw) as GrafanaDashboardMeta & { panels?: Array<{ options?: { content?: string } }> };
    expect(Array.isArray(dash.panels)).toBe(true);
    const markdownPanel = dash.panels?.find(
      (p) => p.options?.content && String(p.options.content).includes('Navegação Rápida'),
    );
    expect(markdownPanel).toBeDefined();
    const content = markdownPanel?.options?.content ?? '';
    expect(content).toMatch(/demo-trading|Demo Trading/i);
  });

  it('alice-demo-trading.json deve ter uid e panels', () => {
    const path = join(DASHBOARDS_DIR, 'alice-demo-trading.json');
    const raw = readFileSync(path, 'utf-8');
    const dash = JSON.parse(raw) as GrafanaDashboardMeta;
    expect(dash.uid).toBeDefined();
    expect(typeof dash.uid).toBe('string');
    expect(Array.isArray(dash.panels)).toBe(true);
    expect(dash.panels!.length).toBeGreaterThan(0);
  });

  it('alice-llm-gateway.json deve ter uid alice-llm-gateway e panels', () => {
    const path = join(DASHBOARDS_DIR, 'alice-llm-gateway.json');
    const raw = readFileSync(path, 'utf-8');
    const dash = JSON.parse(raw) as GrafanaDashboardMeta;
    expect(dash.uid).toBe('alice-llm-gateway');
    expect(Array.isArray(dash.panels)).toBe(true);
    expect(dash.panels!.length).toBeGreaterThan(0);
  });
});
