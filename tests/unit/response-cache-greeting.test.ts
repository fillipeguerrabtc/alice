import { describe, expect, it } from 'vitest';
import { isGreeting } from '../../apps/chat-service/src/response-cache';

describe('response-cache isGreeting', () => {
  it('detecta saudacao composta em portugues', () => {
    expect(isGreeting('Boa tarde, tudo bem?')).toBe(true);
  });

  it('detecta "tudo bem com você?"', () => {
    expect(isGreeting('tudo bem com você?')).toBe(true);
  });

  it('detecta saudacoes curtas e variacoes relevantes em portugues brasileiro', () => {
    expect(isGreeting('Opa')).toBe(true);
    expect(isGreeting('Bora')).toBe(true);
    expect(isGreeting('Tudo bem por ai')).toBe(true);
    expect(isGreeting('Tudo bem por aí?')).toBe(true);
    expect(isGreeting('Tudo bem aí')).toBe(true);
    expect(isGreeting('Tudo bem ai')).toBe(true);
    expect(isGreeting('Olá, bom dia')).toBe(true);
    expect(isGreeting('Oi, tudo bem por ai?')).toBe(true);
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

  it('nao amplia greeting gate para termos de dominio', () => {
    expect(isGreeting('Bora revisar trading')).toBe(false);
    expect(isGreeting('Tudo bem por ai com BTC hoje?')).toBe(false);
  });
});

