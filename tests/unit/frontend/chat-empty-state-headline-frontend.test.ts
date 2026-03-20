import { describe, expect, it } from 'vitest';
import { buildFallbackChatEmptyStateHeadline } from '../../../apps/frontend-service/src/pages/Chat/chat-empty-state-headline';

describe('frontend chat empty state headline fallback', () => {
  it('prioriza o nome do usuario quando existe contexto autenticado', () => {
    const result = buildFallbackChatEmptyStateHeadline({
      firstName: 'Lia',
      preferredName: 'Lia',
      timezone: 'America/Sao_Paulo',
    }, new Date('2026-03-20T12:00:00.000Z'));

    expect(result.headline).toContain('Lia');
    expect(result.theme).toBe('organize');
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

    expect(result.headline).toContain('Sao Paulo - Brasil');
  });
});
