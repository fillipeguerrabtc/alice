/**
 * Helpers de Teste - Alice Enterprise Platform
 * 
 * Funções utilitárias compartilhadas entre os testes.
 * Facilita criação de mocks, fixtures e assertions customizadas.
 * 
 * Documentação em PT-BR (Regra 10 replit.md)
 */

import { expect } from 'vitest';

/**
 * Verifica se uma resposta de health check é válida
 * @param response - Resposta da requisição
 * @param serviceName - Nome do serviço esperado
 */
export function expectHealthyResponse(
  response: { status: number; body: Record<string, unknown> },
  serviceName?: string
): void {
  expect(response.status).toBe(200);
  expect(response.body).toHaveProperty('status', 'ok');
  
  if (serviceName) {
    expect(response.body).toHaveProperty('service', serviceName);
  }
  
  expect(response.body).toHaveProperty('timestamp');
}

/**
 * Cria headers de autenticação para testes
 * @param role - Role do usuário para simular
 * @param tenantId - ID do tenant (opcional)
 */
export function createAuthHeaders(
  role: 'super_admin' | 'admin' | 'manager' | 'operator' | 'viewer' | 'guest',
  tenantId?: string
): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Test-Role': role,
    'X-Test-Tenant-Id': tenantId || 'test-tenant-id',
  };
}

/**
 * Gera um UUID v4 para testes
 */
export function generateTestId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Aguarda um tempo especificado (para testes assíncronos)
 * @param ms - Milissegundos para aguardar
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Cria um tenant de teste
 */
export function createTestTenant(): {
  id: string;
  nome: string;
  slug: string;
} {
  const id = generateTestId();
  return {
    id,
    nome: `Test Tenant ${id.slice(0, 8)}`,
    slug: `test-tenant-${id.slice(0, 8)}`,
  };
}

/**
 * Cria um usuário de teste
 */
export function createTestUser(
  role: 'super_admin' | 'admin' | 'manager' | 'operator' | 'viewer' | 'guest' = 'viewer'
): {
  id: string;
  email: string;
  nome: string;
  role: string;
  tenantId: string;
} {
  const id = generateTestId();
  return {
    id,
    email: `test-${id.slice(0, 8)}@alice.test`,
    nome: `Test User ${id.slice(0, 8)}`,
    role,
    tenantId: generateTestId(),
  };
}

/**
 * Verifica estrutura de erro padrão da API
 */
export function expectErrorResponse(
  response: { status: number; body: Record<string, unknown> },
  expectedStatus: number,
  expectedMessage?: string
): void {
  expect(response.status).toBe(expectedStatus);
  expect(response.body).toHaveProperty('error');
  
  if (expectedMessage) {
    expect(response.body.error).toContain(expectedMessage);
  }
}

/**
 * Configuração base para URLs de serviços em teste
 */
export const TEST_SERVICE_URLS = {
  auth: 'http://localhost:3001',
  chat: 'http://localhost:3002',
  rag: 'http://localhost:3003',
  training: 'http://localhost:3004',
  integrations: 'http://localhost:3005',
  gateway: 'http://localhost:3000',
  observability: 'http://localhost:3006',
} as const;

/**
 * Tipo para respostas de API
 */
export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  headers: Record<string, string>;
}

/**
 * Tipo para health check response
 */
export interface HealthCheckResponse {
  status: 'ok' | 'degraded' | 'unhealthy';
  service: string;
  timestamp: string;
  version?: string;
  dependencies?: Record<string, {
    status: 'ok' | 'degraded' | 'unhealthy';
    latency?: number;
  }>;
}
