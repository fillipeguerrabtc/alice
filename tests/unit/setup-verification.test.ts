/**
 * Teste de Verificação do Setup - Alice Enterprise Platform
 * 
 * Teste básico para validar que a configuração do Vitest está funcionando.
 * Este arquivo pode ser removido após confirmação do setup.
 * 
 * Documentação em PT-BR (Regra 10 replit.md)
 */

import { describe, it, expect } from 'vitest';
import { 
  generateTestId, 
  createTestUser, 
  createTestTenant,
  expectHealthyResponse,
  TEST_SERVICE_URLS,
} from '../utils/test-helpers';

describe('Setup do Vitest', () => {
  it('deve executar um teste básico', () => {
    expect(true).toBe(true);
  });

  it('deve ter acesso às variáveis de ambiente', () => {
    expect(process.env.NODE_ENV).toBe('test');
  });
});

describe('Helpers de Teste', () => {
  it('deve gerar um UUID válido', () => {
    const id = generateTestId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('deve criar um usuário de teste', () => {
    const user = createTestUser('admin');
    
    expect(user).toHaveProperty('id');
    expect(user).toHaveProperty('email');
    expect(user).toHaveProperty('nome');
    expect(user.role).toBe('admin');
    expect(user.email).toMatch(/@alice\.test$/);
  });

  it('deve criar um tenant de teste', () => {
    const tenant = createTestTenant();
    
    expect(tenant).toHaveProperty('id');
    expect(tenant).toHaveProperty('nome');
    expect(tenant).toHaveProperty('slug');
    expect(tenant.slug).toMatch(/^test-tenant-/);
  });

  it('deve ter URLs de serviços configuradas', () => {
    expect(TEST_SERVICE_URLS.auth).toBe('http://localhost:3001');
    expect(TEST_SERVICE_URLS.chat).toBe('http://localhost:3002');
    expect(TEST_SERVICE_URLS.rag).toBe('http://localhost:3003');
    expect(TEST_SERVICE_URLS.training).toBe('http://localhost:3004');
    expect(TEST_SERVICE_URLS.integrations).toBe('http://localhost:3005');
  });
});

describe('Função expectHealthyResponse', () => {
  it('deve validar resposta de health check', () => {
    const mockResponse = {
      status: 200,
      body: {
        status: 'ok',
        service: 'test-service',
        timestamp: new Date().toISOString(),
      },
    };

    expect(() => {
      expectHealthyResponse(mockResponse, 'test-service');
    }).not.toThrow();
  });

  it('deve falhar para status diferente de 200', () => {
    const mockResponse = {
      status: 500,
      body: {
        status: 'error',
        timestamp: new Date().toISOString(),
      },
    };

    expect(() => {
      expectHealthyResponse(mockResponse);
    }).toThrow();
  });
});
