import { describe, expect, it } from 'vitest';
import { isGreeting } from '../../apps/chat-service/src/response-cache';

describe('response-cache isGreeting', () => {
  it('detecta saudacao composta em portugues', () => {
    expect(isGreeting('Boa tarde, tudo bem?')).toBe(true);
  });

  it('detecta saudacao simples em ingles', () => {
    expect(isGreeting('Hello!')).toBe(true);
  });

  it('nao classifica mensagem de trading como saudacao', () => {
    expect(isGreeting('Bom dia, pode gerar sinal de BTC?')).toBe(false);
  });

  it('nao classifica mensagem longa fora de escopo', () => {
    expect(isGreeting('Bom dia, preciso ajustar meu portfolio e revisar ordens de futuros agora.')).toBe(false);
  });
});

