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

  it('detecta ruido linguistico em texto embaralhado', () => {
    const corruptedText = [
      'Claro Fillipe, segue previzaaao gxtrn para guaruja: prnxx dados zxqrm.',
      'temperattura mnnima 24 e maxx 30 com chuvenss irrgulares e frqnt venttos.',
      'condicao geral: clmpsk, trvbn, qwrtzz e rrraaaj em varios blocoss.',
    ].join(' ');

    const result = evaluateCorruptedAssistantResponse(corruptedText, 'default');
    expect(result.corrupted).toBe(true);
    expect(result.reason).toBe('linguistic_noise');
  });

  it('nao marca texto natural em pt-BR como ruido linguistico', () => {
    const normalText = [
      'Claro, Fillipe. Amanha em Guaruja a temperatura deve variar entre 24 e 30 graus.',
      'Ha chance de chuva fraca no periodo da tarde, com ventos moderados e ceu parcialmente nublado.',
      'Se quiser, eu tambem posso trazer a previsao por hora com fontes atualizadas da web.',
    ].join(' ');

    const result = evaluateCorruptedAssistantResponse(normalText, 'default');
    expect(result.corrupted).toBe(false);
    expect(result.reason).toBeNull();
  });

  it('detecta vazamento de estilo CSS com semicolon soup', () => {
    const corruptedCssLeak = Array.from({ length: 8 }, () => ';rred;').join(' ');
    const result = evaluateCorruptedAssistantResponse(corruptedCssLeak, 'default');

    expect(result.corrupted).toBe(true);
    expect(result.reason).toBe('css_style_leak');
  });
});
