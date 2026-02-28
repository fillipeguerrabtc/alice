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

  it('detecta ruído linguístico em texto embaralhado', () => {
    const corruptedText = [
      'Claro, Felipe, Aqui está a previsão de tempo para Guarujé (SP) para o prenhã e próxx dias:',
      'previsão será fornec cida informaçõessobre temperattura, possíveis chuvensde chuenchãs.',
      'temperatura mínima 1 e°° e máx pre e4°* e1°** e4°* com prenchã:',
      'e possíveis chu chuunspré chu e chuve 1 prenchãss preenchãss.',
    ].join(' ');

    const result = evaluateCorruptedAssistantResponse(corruptedText, 'default');
    expect(result.corrupted).toBe(true);
    expect(result.reason).toBe('linguistic_noise');
  });

  it('não marca texto natural em pt-BR como ruído linguístico', () => {
    const normalText = [
      'Claro, Fillipe. Amanhã em Guarujá a temperatura deve variar entre 24°C e 30°C.',
      'Há chance de chuva fraca no período da tarde, com ventos moderados e céu parcialmente nublado.',
      'Se quiser, eu também posso trazer a previsão por hora com fontes atualizadas da web.',
    ].join(' ');

    const result = evaluateCorruptedAssistantResponse(normalText, 'default');
    expect(result.corrupted).toBe(false);
    expect(result.reason).toBeNull();
  });
});
