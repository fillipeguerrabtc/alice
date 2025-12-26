/**
 * Setup Global de Testes - Alice Enterprise Platform
 * 
 * Configuração executada antes de todos os testes.
 * Inicializa variáveis de ambiente e configurações necessárias.
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 * Regra 8: Usar Pino, console.log é PROIBIDO
 */

import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import pino from 'pino';

// Logger específico para testes (Regra 8 - Pino obrigatório)
const testLogger = pino({
  level: 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
}).child({ module: 'test-setup' });

// Configurar variáveis de ambiente para testes
// NOTA (26/12/2025): Definir ANTES do beforeAll para evitar fail-fast no import de gpu-client
process.env.NODE_ENV = 'test';
process.env.INTERNAL_API_SECRET = 'test-secret-for-unit-tests';
process.env.LOG_LEVEL = 'error';
process.env.PINO_LOG_LEVEL = 'silent';

beforeAll(() => {
  testLogger.info('Iniciando suite de testes Alice Enterprise Platform');
});

afterAll(() => {
  testLogger.info('Suite de testes finalizada');
});

// Limpar mocks entre testes
beforeEach(() => {
  // Reset de estado se necessário
});

afterEach(() => {
  // Cleanup após cada teste
});

// Tipos globais para testes
declare global {
  namespace Vi {
    interface JestAssertion<T = unknown> {
      toBeHealthy(): T;
    }
  }
}

export {};
