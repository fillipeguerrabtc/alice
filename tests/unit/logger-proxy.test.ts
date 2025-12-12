/**
 * Testes do @alice/logger - Contrato do Proxy
 *
 * Objetivo:
 * - Garantir que o export `logger` (Proxy) não aloque novas funções a cada acesso
 *   (identidade estável de métodos).
 * - Garantir que operações de reflexão funcionem (ex.: operador `in`, ownKeys).
 *
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import { describe, it, expect } from 'vitest';
import { logger } from '@alice/logger';

describe('@alice/logger - Contrato do Proxy', () => {
  it('deve manter identidade estável dos métodos', () => {
    const info1 = logger.info;
    const info2 = logger.info;
    expect(info1).toBe(info2);

    const fatal1 = logger.fatal;
    const fatal2 = logger.fatal;
    expect(fatal1).toBe(fatal2);
  });

  it('deve refletir métodos do logger real via operador in', () => {
    expect('info' in logger).toBe(true);
    expect('error' in logger).toBe(true);
  });

  it('deve suportar reflexão/enumeração sem lançar', () => {
    expect(() => Reflect.ownKeys(logger)).not.toThrow();
  });
});

