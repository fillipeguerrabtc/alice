import { describe, expect, it } from 'vitest';
import { resolvePreferredNameSources } from '../../apps/chat-service/src/user-name-utils';

describe('resolvePreferredNameSources', () => {
  it('prioriza preferredName da coluna quando disponível', () => {
    const result = resolvePreferredNameSources({
      preferredNameColumn: 'Alice',
      preferences: { preferredName: 'Outro Nome' },
    });

    expect(result.preferredName).toBe('Alice');
    expect(result.shouldBackfillPreferredName).toBe(false);
  });

  it('usa preferredName das preferências e sinaliza backfill quando coluna está vazia', () => {
    const result = resolvePreferredNameSources({
      preferredNameColumn: null,
      preferences: { preferredName: 'João' },
    });

    expect(result.preferredName).toBe('João');
    expect(result.preferredNameFromPrefs).toBe('João');
    expect(result.shouldBackfillPreferredName).toBe(true);
  });

  it('retorna null quando nenhum nome válido foi informado', () => {
    const result = resolvePreferredNameSources({
      preferredNameColumn: '  ',
      preferences: { preferredName: 'x' },
    });

    expect(result.preferredName).toBeNull();
    expect(result.shouldBackfillPreferredName).toBe(false);
  });
});
