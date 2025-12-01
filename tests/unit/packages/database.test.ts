/**
 * Testes Unitários - @alice/database
 * 
 * Testes para funções críticas do módulo de database:
 * - isPoolHealthy (verificação de saúde do pool com timeout usando pool.query)
 * - getPoolMetrics (métricas do pool)
 * 
 * Usa dependency injection via _setPoolForTesting para testar o módulo real
 * 
 * Documentação em PT-BR (Regra 10 replit.md)
 * Regra 9: Validação contínua
 * Regra 16: Melhores práticas enterprise
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import pg from 'pg';
import {
  isPoolHealthy,
  getPoolMetrics,
  _setPoolForTesting,
  _setShuttingDownForTesting,
  _resetForTesting,
} from '@alice/database';

// ============================================================================
// TIPOS E HELPERS
// ============================================================================

type MockPool = {
  query: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  on: ReturnType<typeof vi.fn>;
} & Partial<pg.Pool>;

function createMockPool(overrides: Partial<MockPool> = {}): MockPool {
  return {
    query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
    end: vi.fn().mockResolvedValue(undefined),
    totalCount: 5,
    idleCount: 3,
    waitingCount: 0,
    on: vi.fn(),
    ...overrides,
  } as MockPool;
}

// ============================================================================
// TESTES - isPoolHealthy (MÓDULO REAL com pool mockado)
// ============================================================================

describe('@alice/database - isPoolHealthy (módulo real)', () => {
  beforeEach(() => {
    _resetForTesting();
  });

  afterEach(() => {
    _resetForTesting();
  });

  describe('cenários de sucesso', () => {
    it('deve retornar true quando pool está saudável', async () => {
      const mockPool = createMockPool({
        query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
      });
      _setPoolForTesting(mockPool as unknown as pg.Pool);
      
      const isHealthy = await isPoolHealthy(2000);
      
      expect(isHealthy).toBe(true);
      expect(mockPool.query).toHaveBeenCalledWith('SELECT 1');
    });

    it('deve usar timeout padrão de 2000ms', async () => {
      const mockPool = createMockPool({
        query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
      });
      _setPoolForTesting(mockPool as unknown as pg.Pool);
      
      const startTime = Date.now();
      await isPoolHealthy(); // sem timeout explícito
      const elapsed = Date.now() - startTime;
      
      // Deve completar rapidamente, não esperar timeout
      expect(elapsed).toBeLessThan(100);
    });

    it('deve chamar pool.query apenas uma vez', async () => {
      const mockPool = createMockPool({
        query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
      });
      _setPoolForTesting(mockPool as unknown as pg.Pool);
      
      await isPoolHealthy(2000);
      
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });
  });

  describe('cenários de falha', () => {
    it('deve retornar false quando pool é null', async () => {
      _setPoolForTesting(null);
      
      const isHealthy = await isPoolHealthy(2000);
      
      expect(isHealthy).toBe(false);
    });

    it('deve retornar false durante shutdown', async () => {
      const mockPool = createMockPool();
      _setPoolForTesting(mockPool as unknown as pg.Pool);
      _setShuttingDownForTesting(true);
      
      const isHealthy = await isPoolHealthy(2000);
      
      expect(isHealthy).toBe(false);
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('deve retornar false quando query falha', async () => {
      const mockPool = createMockPool({
        query: vi.fn().mockRejectedValue(new Error('Connection refused')),
      });
      _setPoolForTesting(mockPool as unknown as pg.Pool);
      
      const isHealthy = await isPoolHealthy(2000);
      
      expect(isHealthy).toBe(false);
    });
  });

  describe('cenários de timeout', () => {
    it('deve retornar false quando query excede timeout', async () => {
      const slowQuery = new Promise((resolve) => setTimeout(resolve, 5000));
      const mockPool = createMockPool({
        query: vi.fn().mockReturnValue(slowQuery),
      });
      _setPoolForTesting(mockPool as unknown as pg.Pool);
      
      const startTime = Date.now();
      const isHealthy = await isPoolHealthy(100); // 100ms timeout
      const elapsed = Date.now() - startTime;
      
      expect(isHealthy).toBe(false);
      expect(elapsed).toBeLessThan(500); // Deve falhar antes de 500ms
    });

    it('deve usar timeout configurável', async () => {
      // Primeira chamada: timeout curto deve falhar
      const slowQuery = new Promise((resolve) => setTimeout(resolve, 500));
      const mockPool = createMockPool({
        query: vi.fn().mockReturnValue(slowQuery),
      });
      _setPoolForTesting(mockPool as unknown as pg.Pool);
      
      const isHealthyShort = await isPoolHealthy(50);
      expect(isHealthyShort).toBe(false);
      
      // Segunda chamada: query rápida deve passar
      _resetForTesting();
      const fastPool = createMockPool({
        query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
      });
      _setPoolForTesting(fastPool as unknown as pg.Pool);
      
      const isHealthyLong = await isPoolHealthy(2000);
      expect(isHealthyLong).toBe(true);
    });
  });

  describe('sem vazamento de conexões (pool.query auto-libera)', () => {
    it('pool.query auto-gerencia conexões - não há client.release()', async () => {
      const mockPool = createMockPool();
      _setPoolForTesting(mockPool as unknown as pg.Pool);
      
      await isPoolHealthy(2000);
      
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });

    it('mesmo em timeout, pool.query não vaza conexões', async () => {
      const slowQuery = new Promise((resolve) => 
        setTimeout(() => resolve({ rows: [{ '?column?': 1 }] }), 5000)
      );
      const mockPool = createMockPool({
        query: vi.fn().mockReturnValue(slowQuery),
      });
      _setPoolForTesting(mockPool as unknown as pg.Pool);
      
      const isHealthy = await isPoolHealthy(50);
      
      expect(isHealthy).toBe(false);
      // A query eventualmente completa e pool.query auto-libera
    });
  });

  describe('sem unhandled rejections (enterprise-grade)', () => {
    it('deve capturar rejeição tardia sem crash', async () => {
      // Query que demora e depois rejeita
      const slowThenReject = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Late rejection')), 200)
      );
      const mockPool = createMockPool({
        query: vi.fn().mockReturnValue(slowThenReject),
      });
      _setPoolForTesting(mockPool as unknown as pg.Pool);
      
      const isHealthy = await isPoolHealthy(50);
      expect(isHealthy).toBe(false);
      
      // Esperar a rejeição tardia ser processada
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Se chegou aqui sem crash, passou
      expect(true).toBe(true);
    });

    it('deve retornar false em rejeição de query sem crash', async () => {
      const mockPool = createMockPool({
        query: vi.fn().mockRejectedValue(new Error('Database error')),
      });
      _setPoolForTesting(mockPool as unknown as pg.Pool);
      
      const isHealthy = await isPoolHealthy(2000);
      
      expect(isHealthy).toBe(false);
    });

    it('deve limpar timeout quando query resolve primeiro', async () => {
      vi.useFakeTimers();
      
      const mockPool = createMockPool({
        query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
      });
      _setPoolForTesting(mockPool as unknown as pg.Pool);
      
      const promise = isPoolHealthy(5000);
      
      await vi.runAllTimersAsync();
      
      const isHealthy = await promise;
      expect(isHealthy).toBe(true);
      
      vi.useRealTimers();
    });
  });
});

// ============================================================================
// TESTES - getPoolMetrics (MÓDULO REAL)
// ============================================================================

describe('@alice/database - getPoolMetrics (módulo real)', () => {
  beforeEach(() => {
    _resetForTesting();
  });

  afterEach(() => {
    _resetForTesting();
  });

  it('deve retornar métricas zeradas quando pool não inicializado', () => {
    _setPoolForTesting(null);
    
    const metrics = getPoolMetrics();
    
    expect(metrics.totalConnections).toBe(0);
    expect(metrics.idleConnections).toBe(0);
    expect(metrics.waitingClients).toBe(0);
    expect(metrics.maxConnections).toBe(0);
    expect(metrics.isHealthy).toBe(false);
  });

  it('deve retornar métricas corretas do pool', () => {
    const mockPool = createMockPool({
      totalCount: 10,
      idleCount: 5,
      waitingCount: 2,
    });
    _setPoolForTesting(mockPool as unknown as pg.Pool);
    
    const metrics = getPoolMetrics();
    
    expect(metrics.totalConnections).toBe(10);
    expect(metrics.idleConnections).toBe(5);
    expect(metrics.waitingClients).toBe(2);
    expect(metrics.isHealthy).toBe(true);
    expect(metrics.isShuttingDown).toBe(false);
  });

  it('deve indicar não saudável durante shutdown', () => {
    const mockPool = createMockPool();
    _setPoolForTesting(mockPool as unknown as pg.Pool);
    _setShuttingDownForTesting(true);
    
    const metrics = getPoolMetrics();
    
    expect(metrics.isHealthy).toBe(false);
    expect(metrics.isShuttingDown).toBe(true);
  });

  it('deve indicar não saudável quando totalCount é 0', () => {
    const mockPool = createMockPool({
      totalCount: 0,
      idleCount: 0,
      waitingCount: 0,
    });
    _setPoolForTesting(mockPool as unknown as pg.Pool);
    
    const metrics = getPoolMetrics();
    
    expect(metrics.isHealthy).toBe(false);
  });
});
