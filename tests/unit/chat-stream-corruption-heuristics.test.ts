import { describe, expect, it } from 'vitest';
import { evaluateCorruptedAssistantResponse } from '../../apps/chat-service/src/stream-corruption-heuristics';

describe('evaluateCorruptedAssistantResponse', () => {
  it('nao suprime respostas numericas no perfil trading por digit noise', () => {
    const numericContent = Array.from({ length: 80 }, (_, index) => `${index % 3} 12345 67890`).join(' ');

    const defaultProfile = evaluateCorruptedAssistantResponse(numericContent, 'default');
    const tradingProfile = evaluateCorruptedAssistantResponse(numericContent, 'trading');

    expect(defaultProfile.corrupted).toBe(true);
    expect(defaultProfile.reason).toBeTruthy();
    expect(tradingProfile.corrupted).toBe(false);
    expect(tradingProfile.reason).toBeNull();
  });
});
