import { describe, expect, it } from 'vitest';
import { resolvePreferredNameSources } from '../../apps/chat-service/src/user-name-utils';

describe('resolvePreferredNameSources', () => {
  it('prioriza preferredName da coluna quando disponivel', () => {
    const result = resolvePreferredNameSources({
      preferredNameColumn: 'Alice',
      preferences: { preferredName: 'Outro Nome' },
    });

    expect(result.preferredName).toBe('Alice');
    expect(result.shouldBackfillPreferredName).toBe(false);
  });

  it('usa preferredName das preferencias e sinaliza backfill quando coluna esta vazia', () => {
    const result = resolvePreferredNameSources({
      preferredNameColumn: null,
      preferences: { preferredName: 'Joao' },
    });

    expect(result.preferredName).toBe('Joao');
    expect(result.preferredNameFromPrefs).toBe('Joao');
    expect(result.shouldBackfillPreferredName).toBe(true);
  });

  it('aceita chaves legadas nas preferencias do usuario', () => {
    const result = resolvePreferredNameSources({
      preferredNameColumn: null,
      preferences: { preferred_name: 'Filipe' },
    });

    expect(result.preferredName).toBe('Filipe');
    expect(result.preferredNameFromPrefs).toBe('Filipe');
    expect(result.shouldBackfillPreferredName).toBe(true);
  });

  it('retorna null quando nenhum nome valido foi informado', () => {
    const result = resolvePreferredNameSources({
      preferredNameColumn: '  ',
      preferences: { preferredName: 'x' },
    });

    expect(result.preferredName).toBeNull();
    expect(result.shouldBackfillPreferredName).toBe(false);
  });

  it('ignora displayName para evitar backfill indevido de preferredName', () => {
    const result = resolvePreferredNameSources({
      preferredNameColumn: null,
      preferences: { displayName: 'Nome de Exibicao' },
    });

    expect(result.preferredName).toBeNull();
    expect(result.preferredNameFromPrefs).toBeNull();
    expect(result.shouldBackfillPreferredName).toBe(false);
  });
});

