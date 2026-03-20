import { describe, expect, it } from 'vitest';
import {
  buildChatEmptyStateHeadline,
  buildNextHeadlineHistory,
  normalizeRecentHeadlineVariantKeys,
  resolveHeadlineDayPart,
} from '../../apps/chat-service/src/chat-empty-state-headline';

describe('chat-empty-state-headline', () => {
  it('resolve o turno do dia a partir da hora local', () => {
    expect(resolveHeadlineDayPart(8)).toBe('morning');
    expect(resolveHeadlineDayPart(14)).toBe('afternoon');
    expect(resolveHeadlineDayPart(20)).toBe('evening');
    expect(resolveHeadlineDayPart(2)).toBe('night');
  });

  it('gera headline de uma unica frase com saudacao ocasional e nome', () => {
    const result = buildChatEmptyStateHeadline({
      displayName: 'Lia',
      localHour: 9,
      locale: 'pt-BR',
      recentVariantKeys: [],
      seed: 'user-1:2026-03-20T09',
    });

    expect(result.headline).toContain('?');
    expect(result.headline.split(/[.!?]+/).filter(Boolean)).toHaveLength(1);
    expect(result.variantKey.startsWith('pt-BR:morning:')).toBe(true);
  });

  it('evita repetir imediatamente um variantKey recente quando existe outra opcao', () => {
    const first = buildChatEmptyStateHeadline({
      displayName: 'Lia',
      localHour: 10,
      locale: 'pt-BR',
      recentVariantKeys: [],
      seed: 'seed-repeat',
    });

    const second = buildChatEmptyStateHeadline({
      displayName: 'Lia',
      localHour: 10,
      locale: 'pt-BR',
      recentVariantKeys: [first.variantKey],
      seed: 'seed-repeat',
    });

    expect(second.variantKey).not.toBe(first.variantKey);
  });

  it('mantem historico enxuto e sem duplicatas', () => {
    const history = buildNextHeadlineHistory(['a', 'b', 'a', '', null], 'c');

    expect(history).toEqual(['c', 'a', 'b']);
    expect(normalizeRecentHeadlineVariantKeys(history)).toEqual(['c', 'a', 'b']);
  });
});
