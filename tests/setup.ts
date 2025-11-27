/**
 * Setup Global de Testes - Alice Enterprise Platform
 * 
 * Configuração executada antes de todos os testes.
 * Inicializa variáveis de ambiente e configurações necessárias.
 * 
 * Documentação em PT-BR (Regra 10 replit.md)
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
beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  
  // Desabilitar logs durante testes para output limpo
  process.env.PINO_LOG_LEVEL = 'silent';
  
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
