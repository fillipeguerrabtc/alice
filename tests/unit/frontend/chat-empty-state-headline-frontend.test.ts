import { describe, expect, it } from 'vitest';
import {
  buildFallbackChatEmptyStateHeadline,
  resolveChatEmptyStateHeadline,
} from '../../../apps/frontend-service/src/pages/Chat/chat-empty-state-headline';

describe('frontend chat empty state headline fallback', () => {
  it('prioriza o nome do usuario quando existe contexto autenticado', () => {
    const result = buildFallbackChatEmptyStateHeadline({
      firstName: 'Lia',
      preferredName: 'Lia',
      timezone: 'America/Sao_Paulo',
    }, new Date('2026-03-20T12:00:00.000Z'));

    expect(result.headline).toContain('Lia');
    expect(result.headline.length).toBeLessThanOrEqual(72);
    expect(result.theme).toBe('momentum');
  });

  it('usa contexto de localizacao quando nao ha nome', () => {
    const result = buildFallbackChatEmptyStateHeadline({
      preferencias: {
        location: {
          city: 'Sao Paulo',
          countryName: 'Brasil',
        },
      },
    }, new Date('2026-03-20T12:00:00.000Z'));

    expect(result.headline).toContain('Sao Paulo');
  });

  it('nao usa fallback local durante o bootstrap quando a query ainda nao falhou', () => {
    const result = resolveChatEmptyStateHeadline({
      payload: null,
      user: {
        preferredName: 'Lia',
      },
      hasError: false,
    });

    expect(result).toBeNull();
  });

  it('usa fallback local apenas quando a query principal falha', () => {
    const result = resolveChatEmptyStateHeadline({
      payload: null,
      user: {
        preferredName: 'Lia',
      },
      hasError: true,
      now: new Date('2026-03-20T12:00:00.000Z'),
    });

    expect(result).toContain('Lia');
  });
});
