import { describe, expect, it } from 'vitest';
import { normalizeAppPathname, resolveAppShellState } from '../../apps/frontend-service/src/lib/app-shell';

describe('frontend standalone shell resolver', () => {
  it('mantem a plataforma completa na raiz em standalone', () => {
    expect(resolveAppShellState('/', true)).toEqual({
      featureRoot: null,
      lockViewport: false,
      mode: 'platform',
    });
  });

  it('isola o chat quando a entrada standalone parte de /chat', () => {
    expect(resolveAppShellState('/chat/123?tab=latest', true)).toEqual({
      featureRoot: '/chat',
      lockViewport: true,
      mode: 'feature',
    });
  });

  it('isola o trading quando a entrada standalone parte de /trading', () => {
    expect(resolveAppShellState('/trading', true)).toEqual({
      featureRoot: '/trading',
      lockViewport: false,
      mode: 'feature',
    });
  });

  it('mantem o comportamento de plataforma em browser normal', () => {
    expect(resolveAppShellState('/trading', false)).toEqual({
      featureRoot: null,
      lockViewport: false,
      mode: 'platform',
    });
  });

  it('normaliza pathname removendo query string e hash', () => {
    expect(normalizeAppPathname('/chat/abc?foo=bar#bottom')).toBe('/chat/abc');
  });
});
