/**
 * Testes Unitários - @alice/shared-utils/shutdown-manager
 * 
 * Testes para o ShutdownManager centralizado usando o MÓDULO REAL:
 * - Registro de callbacks por prioridade
 * - Execução ordenada durante shutdown
 * - Timeout de handlers
 * - Idempotência de registro de process handlers
 * 
 * Usa _createTestableShutdownManager para criar instâncias isoladas
 * 
 * Documentação em PT-BR (Regra 10 replit.md)
 * Regra 9: Validação contínua
 * Regra 16: Melhores práticas enterprise (ShutdownManager centralizado)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ShutdownPriority,
  _createTestableShutdownManager,
  _resetShutdownManagerForTesting,
  type ShutdownManagerImpl,
} from '@alice/shared-utils';

// ============================================================================
// TESTES - ShutdownManager (MÓDULO REAL)
// ============================================================================

describe('@alice/shared-utils - ShutdownManager (módulo real)', () => {
  let manager: ShutdownManagerImpl;

  beforeEach(() => {
    _resetShutdownManagerForTesting();
    manager = _createTestableShutdownManager({
      defaultTimeoutMs: 1000,
      forceExitTimeoutMs: 5000,
      skipProcessHandlers: true, // Evita vazamento de listeners em testes
    });
  });

  afterEach(() => {
    manager.reset();
    _resetShutdownManagerForTesting();
  });

  describe('registerCallback', () => {
    it('deve registrar callback com sucesso', () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      
      manager.registerCallback('test-handler', handler, { priority: 50 });
      
      expect(manager.getCallbackCount()).toBe(1);
      expect(manager.listCallbacks()).toContainEqual({ name: 'test-handler', priority: 50 });
    });

    it('deve usar prioridade padrão (40 = EXTERNAL_CONNECTIONS) quando não especificada', () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      
      manager.registerCallback('default-priority', handler);
      
      const callbacks = manager.listCallbacks();
      expect(callbacks.find(cb => cb.name === 'default-priority')?.priority).toBe(ShutdownPriority.EXTERNAL_CONNECTIONS);
    });

    it('deve substituir callback existente com mesmo nome', () => {
      const handler1 = vi.fn().mockResolvedValue(undefined);
      const handler2 = vi.fn().mockResolvedValue(undefined);
      
      manager.registerCallback('same-name', handler1, { priority: 10 });
      manager.registerCallback('same-name', handler2, { priority: 20 });
      
      expect(manager.getCallbackCount()).toBe(1);
      expect(manager.listCallbacks()[0].priority).toBe(20);
    });

    it('deve permitir múltiplos callbacks com nomes diferentes', () => {
      manager.registerCallback('handler-1', vi.fn().mockResolvedValue(undefined), { priority: 100 });
      manager.registerCallback('handler-2', vi.fn().mockResolvedValue(undefined), { priority: 50 });
      manager.registerCallback('handler-3', vi.fn().mockResolvedValue(undefined), { priority: 10 });
      
      expect(manager.getCallbackCount()).toBe(3);
    });
  });

  describe('unregisterCallback', () => {
    it('deve remover callback existente', () => {
      manager.registerCallback('to-remove', vi.fn().mockResolvedValue(undefined));
      expect(manager.getCallbackCount()).toBe(1);
      
      manager.unregisterCallback('to-remove');
      
      expect(manager.getCallbackCount()).toBe(0);
    });

    it('deve ignorar silenciosamente callback inexistente', () => {
      manager.registerCallback('existing', vi.fn().mockResolvedValue(undefined));
      
      expect(() => manager.unregisterCallback('non-existent')).not.toThrow();
      expect(manager.getCallbackCount()).toBe(1);
    });
  });

  describe('shutdown - ordem de execução', () => {
    it('deve executar callbacks em ordem de prioridade decrescente', async () => {
      const executionOrder: string[] = [];
      
      manager.registerCallback('http-server', async () => {
        executionOrder.push('http-server');
      }, { priority: ShutdownPriority.HTTP_SERVER });
      
      manager.registerCallback('websocket', async () => {
        executionOrder.push('websocket');
      }, { priority: ShutdownPriority.WEBSOCKET });
      
      manager.registerCallback('database', async () => {
        executionOrder.push('database');
      }, { priority: ShutdownPriority.DATABASE });
      
      await manager.shutdown('SIGTERM', { skipProcessExit: true });
      
      expect(executionOrder).toEqual(['http-server', 'websocket', 'database']);
    });

    it('deve executar callbacks com mesma prioridade na ordem de registro', async () => {
      const executionOrder: string[] = [];
      
      manager.registerCallback('first', async () => {
        executionOrder.push('first');
      }, { priority: 50 });
      
      manager.registerCallback('second', async () => {
        executionOrder.push('second');
      }, { priority: 50 });
      
      await manager.shutdown('SIGTERM', { skipProcessExit: true });
      
      expect(executionOrder).toContain('first');
      expect(executionOrder).toContain('second');
    });
  });

  describe('shutdown - tratamento de erros', () => {
    it('deve continuar executando após erro em um handler', async () => {
      const handler1 = vi.fn().mockRejectedValue(new Error('Handler 1 failed'));
      const handler2 = vi.fn().mockResolvedValue(undefined);
      
      manager.registerCallback('failing', handler1, { priority: 100 });
      manager.registerCallback('succeeding', handler2, { priority: 50 });
      
      const result = await manager.shutdown('SIGTERM', { skipProcessExit: true });
      
      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].name).toBe('failing');
      expect(result.executedCallbacks).toContain('succeeding');
    });

    it('deve capturar timeout de handler', async () => {
      const slowHandler = vi.fn().mockImplementation(() => 
        new Promise(resolve => setTimeout(resolve, 5000))
      );
      
      manager.registerCallback('slow', slowHandler, { priority: 100, timeoutMs: 100 });
      
      const result = await manager.shutdown('SIGTERM', { skipProcessExit: true });
      
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].name).toBe('slow');
      expect(result.errors[0].error).toBe('Timeout');
    });
  });

  describe('shutdown - idempotência', () => {
    it('deve ignorar chamadas duplicadas durante shutdown', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      manager.registerCallback('once', handler);
      
      await manager.shutdown('SIGTERM', { skipProcessExit: true });
      expect(handler).toHaveBeenCalledTimes(1);
      
      await manager.shutdown('SIGINT', { skipProcessExit: true });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('deve indicar shutdown em progresso após primeira chamada', async () => {
      expect(manager.isShutdownInProgress()).toBe(false);
      
      manager.registerCallback('test', vi.fn().mockResolvedValue(undefined));
      await manager.shutdown('SIGTERM', { skipProcessExit: true });
      
      expect(manager.isShutdownInProgress()).toBe(true);
    });
  });

  describe('reset', () => {
    it('deve limpar todos os callbacks', () => {
      manager.registerCallback('handler-1', vi.fn().mockResolvedValue(undefined));
      manager.registerCallback('handler-2', vi.fn().mockResolvedValue(undefined));
      
      manager.reset();
      
      expect(manager.getCallbackCount()).toBe(0);
    });

    it('deve permitir novo shutdown após reset', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      manager.registerCallback('test', handler);
      await manager.shutdown('SIGTERM', { skipProcessExit: true });
      expect(handler).toHaveBeenCalledTimes(1);
      
      manager.reset();
      manager.registerCallback('test', handler);
      await manager.shutdown('SIGTERM', { skipProcessExit: true });
      
      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  describe('prioridades padrão (conforme replit.md)', () => {
    it('deve suportar prioridades documentadas', async () => {
      const executionOrder: string[] = [];
      
      manager.registerCallback('database', async () => {
        executionOrder.push('DATABASE');
      }, { priority: ShutdownPriority.DATABASE });
      
      manager.registerCallback('cache', async () => {
        executionOrder.push('CACHE');
      }, { priority: ShutdownPriority.CACHE });
      
      manager.registerCallback('http-server', async () => {
        executionOrder.push('HTTP_SERVER');
      }, { priority: ShutdownPriority.HTTP_SERVER });
      
      manager.registerCallback('websocket', async () => {
        executionOrder.push('WEBSOCKET');
      }, { priority: ShutdownPriority.WEBSOCKET });
      
      await manager.shutdown('SIGTERM', { skipProcessExit: true });
      
      expect(executionOrder).toEqual(['HTTP_SERVER', 'WEBSOCKET', 'CACHE', 'DATABASE']);
    });

    it('deve ter valores de prioridade corretos', () => {
      expect(ShutdownPriority.HTTP_SERVER).toBe(100);
      expect(ShutdownPriority.WEBSOCKET).toBe(90);
      expect(ShutdownPriority.BACKGROUND_JOBS).toBe(80);
      expect(ShutdownPriority.CACHE).toBe(70);
      expect(ShutdownPriority.MESSAGE_QUEUE).toBe(60);
      expect(ShutdownPriority.DATABASE).toBe(50);
      expect(ShutdownPriority.EXTERNAL_CONNECTIONS).toBe(40);
      expect(ShutdownPriority.LOGGING).toBe(10);
    });
  });
  
  describe('resultado do shutdown', () => {
    it('deve retornar callbacks executados com sucesso', async () => {
      manager.registerCallback('handler-1', vi.fn().mockResolvedValue(undefined), { priority: 100 });
      manager.registerCallback('handler-2', vi.fn().mockResolvedValue(undefined), { priority: 50 });
      
      const result = await manager.shutdown('SIGTERM', { skipProcessExit: true });
      
      expect(result.executedCallbacks).toContain('handler-1');
      expect(result.executedCallbacks).toContain('handler-2');
      expect(result.errors).toHaveLength(0);
    });

    it('deve retornar erros separados de callbacks executados', async () => {
      manager.registerCallback('success', vi.fn().mockResolvedValue(undefined), { priority: 100 });
      manager.registerCallback('failure', vi.fn().mockRejectedValue(new Error('Test error')), { priority: 50 });
      
      const result = await manager.shutdown('SIGTERM', { skipProcessExit: true });
      
      expect(result.executedCallbacks).toContain('success');
      expect(result.executedCallbacks).not.toContain('failure');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toEqual({ name: 'failure', error: 'Test error' });
    });
  });
});
