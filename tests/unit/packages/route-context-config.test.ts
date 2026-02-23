/**
 * Testes para route-context-config.ts
 *
 * Valida o mapeamento de pathname → contexto semântico,
 * incluindo trailing slashes e rotas dinâmicas (/chat/:id).
 *
 * Regra 10 CLAUDE.md: Documentação PT-BR
 * Regra 9 CLAUDE.md: Validação contínua
 */

import { describe, it, expect } from 'vitest';
import { pathnameToContext, ROUTE_TO_CONTEXT } from '../../../packages/shared-utils/src/route-context-config';

describe('pathnameToContext', () => {
  it('deve retornar "default" para raiz (/)', () => {
    expect(pathnameToContext('/')).toBe('default');
  });

  it('deve retornar "default" para /chat', () => {
    expect(pathnameToContext('/chat')).toBe('default');
  });

  it('deve retornar "default" para /chat/<uuid> via prefixo', () => {
    expect(pathnameToContext('/chat/550e8400-e29b-41d4-a716-446655440000')).toBe('default');
  });

  it('deve retornar "default" para /conversations', () => {
    expect(pathnameToContext('/conversations')).toBe('default');
  });

  it('deve retornar "trading" para /trading', () => {
    expect(pathnameToContext('/trading')).toBe('trading');
  });

  it('deve retornar "trading" para /demo-trading', () => {
    expect(pathnameToContext('/demo-trading')).toBe('trading');
  });

  it('deve retornar "trading" para /takeover', () => {
    expect(pathnameToContext('/takeover')).toBe('trading');
  });

  it('deve retornar "default" para pathname vazio', () => {
    expect(pathnameToContext('')).toBe('default');
  });

  it('deve retornar "default" para rota desconhecida', () => {
    expect(pathnameToContext('/unknown-route')).toBe('default');
  });

  it('deve adicionar / se pathname não começa com /', () => {
    expect(pathnameToContext('chat')).toBe('default');
    expect(pathnameToContext('trading')).toBe('trading');
  });

  it('ROUTE_TO_CONTEXT não deve conter padrões de rota (:param)', () => {
    for (const key of Object.keys(ROUTE_TO_CONTEXT)) {
      expect(key).not.toContain(':');
    }
  });
});
