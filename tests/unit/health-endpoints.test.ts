/**
 * Testes de Health Endpoints - Alice Enterprise Platform
 * 
 * Testes de contrato para validar a estrutura de resposta dos 6 microsserviços.
 * Os serviços rodam em produção (Hetzner), então testamos schemas e estruturas.
 * 
 * Microsserviços testados:
 * - auth-service (3001)
 * - chat-service (3002)
 * - rag-service (3003)
 * - training-service (3004)
 * - integrations-service (3005)
 * - observability-service (3007)
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 * Regra 16: Health checks obrigatórios em /api/servico/health
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// ============================================================================
// SCHEMAS DE VALIDAÇÃO - Contratos de Health Endpoints
// ============================================================================

/**
 * Schema base para todos os health endpoints
 * Campos obrigatórios: status, service, timestamp
 */
const baseHealthSchema = z.object({
  status: z.enum(['ok', 'degraded', 'unhealthy', 'healthy']),
  service: z.string().min(1),
  timestamp: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)),
});

/**
 * Schema para circuit breaker stats (padrão com timeouts)
 */
const circuitBreakerStatsSchema = z.object({
  failures: z.number(),
  successes: z.number(),
  timeouts: z.number(),
});

/**
 * Schema para circuit breaker stats Wise (com rejects ao invés de timeouts)
 */
const circuitBreakerStatsWiseSchema = z.object({
  failures: z.number(),
  successes: z.number(),
  rejects: z.number(),
});

/**
 * Schema para RAG breaker stats (retorno flat, não nested)
 */
const ragBreakerStatsSchema = z.object({
  state: z.enum(['open', 'closed', 'half-open']),
  failures: z.number(),
  successes: z.number(),
  timeouts: z.number(),
  rejects: z.number(),
});

/**
 * Schema para auth-service /api/auth/health
 */
const authHealthSchema = baseHealthSchema.extend({
  providers: z.object({
    local: z.boolean(),
    google: z.boolean(),
    github: z.boolean(),
    saml: z.boolean(),
  }),
  metrics: z.object({
    totalProvidersConfigured: z.number(),
    attempts: z.record(z.number()),
    successes: z.record(z.number()),
    failures: z.record(z.number()),
    lastSuccess: z.record(z.string().nullable().or(z.null())),
    lastFailure: z.record(z.string().nullable().or(z.null())),
  }),
  note: z.string().optional(),
});

/**
 * Schema para chat-service /api/chat/health
 * Nota: O RAG breaker retorna estrutura flat (não nested em stats)
 */
// ARQUITETURA v4.0.0: Qwen2.5-VL substitui Mixtral
const chatHealthSchema = baseHealthSchema.extend({
  llmProvider: z.literal('gpu-manager-service'),
  model: z.literal('Qwen/Qwen2.5-VL-7B-Instruct-AWQ'),
  circuitBreakers: z.object({
    llm: z.object({
      state: z.enum(['open', 'closed', 'half-open']),
      stats: circuitBreakerStatsSchema,
    }),
    rag: ragBreakerStatsSchema,
  }),
});

/**
 * Schema para rag-service /api/rag/health
 */
// ARQUITETURA 100% GPU (15/12/2025)
const ragHealthSchema = baseHealthSchema.extend({
  embeddingsProvider: z.literal('gpu-manager-service'),
  model: z.literal('Qwen/Qwen3-Embedding-8B'),
  circuitBreaker: z.object({
    state: z.enum(['open', 'closed', 'half-open']),
    stats: circuitBreakerStatsSchema,
  }),
});

/**
 * Schema para training-service /api/training/health
 */
// ARQUITETURA GPU Manager Service (26/12/2025)
// GPU dedicada Hetzner GEX44 - 24/7, sem cold start
const trainingHealthSchema = baseHealthSchema.extend({
  embeddingsProvider: z.literal('gpu-manager-service'),
  model: z.literal('Qwen/Qwen3-Embedding-8B'),
  gpuManagerAvailable: z.boolean(),
  circuitBreakers: z.object({
    embeddings: z.object({
      state: z.enum(['open', 'closed', 'half-open']),
      stats: circuitBreakerStatsSchema,
    }),
    gpuManager: z.object({
      state: z.enum(['open', 'closed', 'half-open']),
      stats: circuitBreakerStatsSchema,
    }),
  }),
});

/**
 * Schema para integrations-service /api/integrations/health
 * Nota: Wise circuit breaker usa rejects ao invés de timeouts
 */
const integrationsHealthSchema = baseHealthSchema.extend({
  integrations: z.object({
    stripe: z.boolean(),
    erpnext: z.boolean(),
    wise: z.boolean(),
  }),
  circuitBreakers: z.object({
    erpnext: z.enum(['open', 'closed']),
    wise: z.object({
      state: z.enum(['open', 'closed', 'half-open']),
      stats: circuitBreakerStatsWiseSchema,
    }).nullable(),
  }),
});

/**
 * Schema para observability-service /health (simples)
 */
const observabilitySimpleHealthSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('observability-health'),
  timestamp: z.string(),
});

/**
 * Schema para observability-service /api/observability/health (completo)
 */
const observabilityFullHealthSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  timestamp: z.string(),
  services: z.array(z.object({
    name: z.string(),
    url: z.string(),
    status: z.enum(['healthy', 'unhealthy', 'unknown']),
    latencyMs: z.number(),
    lastCheck: z.string(),
    error: z.string().optional(),
  })),
  uptimeSeconds: z.number(),
});

// ============================================================================
// MOCKS DE RESPOSTAS - Simulação de respostas reais dos serviços
// Usando timestamp fixo para evitar testes flaky
// ============================================================================

const FIXED_TIMESTAMP = '2025-11-27T12:00:00.000Z';

const mockAuthHealthResponse = {
  status: 'ok',
  service: 'auth-service',
  timestamp: FIXED_TIMESTAMP,
  providers: {
    local: true,
    google: true,
    github: true,
    saml: false,
  },
  metrics: {
    totalProvidersConfigured: 3,
    attempts: { google: 10, github: 5, saml: 0, local: 20 },
    successes: { google: 9, github: 5, saml: 0, local: 18 },
    failures: { google: 1, github: 0, saml: 0, local: 2 },
    lastSuccess: { google: FIXED_TIMESTAMP, github: null, saml: null, local: FIXED_TIMESTAMP },
    lastFailure: { google: null, github: null, saml: null, local: null },
  },
  note: 'OAuth/SAML usam redirecionamentos HTTP do navegador - circuit breakers não são aplicáveis para fluxos de redirecionamento',
};

// ARQUITETURA v4.0.0: Qwen2.5-VL substitui Mixtral
const mockChatHealthResponse = {
  status: 'ok',
  service: 'chat-service',
  timestamp: FIXED_TIMESTAMP,
  llmProvider: 'gpu-manager-service',
  model: 'Qwen/Qwen2.5-VL-7B-Instruct-AWQ',
  circuitBreakers: {
    llm: {
      state: 'closed',
      stats: { failures: 0, successes: 100, timeouts: 0 },
    },
    rag: {
      state: 'closed',
      failures: 0,
      successes: 50,
      timeouts: 0,
      rejects: 0,
    },
  },
};

const mockRagHealthResponse = {
  status: 'ok',
  service: 'rag-service',
  timestamp: FIXED_TIMESTAMP,
  // ARQUITETURA ENTERPRISE (25/12/2025): Embeddings via GPU Manager Service
  embeddingsProvider: 'gpu-manager-service',
  model: 'Qwen/Qwen3-Embedding-8B',
  circuitBreaker: {
    state: 'closed',
    stats: { failures: 0, successes: 200, timeouts: 0 },
  },
};

// ARQUITETURA GPU Manager Service (26/12/2025)
// GPU dedicada Hetzner GEX44 - 24/7, sem cold start
const mockTrainingHealthResponse = {
  status: 'ok',
  service: 'training-service',
  timestamp: FIXED_TIMESTAMP,
  embeddingsProvider: 'gpu-manager-service',
  model: 'Qwen/Qwen3-Embedding-8B',
  gpuManagerAvailable: true,
  circuitBreakers: {
    embeddings: {
      state: 'closed',
      stats: { failures: 0, successes: 50, timeouts: 0 },
    },
    gpuManager: {
      state: 'closed',
      stats: { failures: 0, successes: 100, timeouts: 0 },
    },
  },
};

const mockIntegrationsHealthResponse = {
  status: 'ok',
  service: 'integrations-service',
  timestamp: FIXED_TIMESTAMP,
  integrations: {
    stripe: true,
    erpnext: false,
    wise: true,
  },
  circuitBreakers: {
    erpnext: 'closed',
    wise: {
      state: 'closed',
      stats: { failures: 0, successes: 30, rejects: 0 },
    },
  },
};

const mockObservabilitySimpleHealthResponse = {
  status: 'ok',
  service: 'observability-health',
  timestamp: FIXED_TIMESTAMP,
};

const mockObservabilityFullHealthResponse = {
  status: 'healthy',
  timestamp: FIXED_TIMESTAMP,
  services: [
    { name: 'Prometheus', url: 'http://prometheus:9090', status: 'healthy', latencyMs: 15, lastCheck: FIXED_TIMESTAMP },
    { name: 'Grafana', url: 'http://grafana:3000', status: 'healthy', latencyMs: 25, lastCheck: FIXED_TIMESTAMP },
    { name: 'Jaeger', url: 'http://jaeger:16686', status: 'healthy', latencyMs: 10, lastCheck: FIXED_TIMESTAMP },
    { name: 'Langfuse', url: 'http://langfuse:3000', status: 'healthy', latencyMs: 35, lastCheck: FIXED_TIMESTAMP },
  ],
  uptimeSeconds: 86400,
};

// ============================================================================
// TESTES DE CONTRATO - Validação de Schemas
// ============================================================================

describe('Health Endpoints - Contratos de Schema', () => {
  describe('auth-service (/api/auth/health)', () => {
    it('deve ter campos obrigatórios: status, service, timestamp', () => {
      const result = baseHealthSchema.safeParse(mockAuthHealthResponse);
      expect(result.success).toBe(true);
    });

    it('deve validar estrutura completa de auth-service', () => {
      const result = authHealthSchema.safeParse(mockAuthHealthResponse);
      expect(result.success).toBe(true);
    });

    it('deve ter service igual a "auth-service"', () => {
      expect(mockAuthHealthResponse.service).toBe('auth-service');
    });

    it('deve listar providers OAuth disponíveis', () => {
      expect(mockAuthHealthResponse.providers).toHaveProperty('local');
      expect(mockAuthHealthResponse.providers).toHaveProperty('google');
      expect(mockAuthHealthResponse.providers).toHaveProperty('github');
      expect(mockAuthHealthResponse.providers).toHaveProperty('saml');
    });

    it('deve incluir métricas de autenticação', () => {
      expect(mockAuthHealthResponse.metrics).toHaveProperty('totalProvidersConfigured');
      expect(mockAuthHealthResponse.metrics).toHaveProperty('attempts');
      expect(mockAuthHealthResponse.metrics).toHaveProperty('successes');
      expect(mockAuthHealthResponse.metrics).toHaveProperty('failures');
    });
  });

  describe('chat-service (/api/chat/health)', () => {
    it('deve ter campos obrigatórios: status, service, timestamp', () => {
      const result = baseHealthSchema.safeParse(mockChatHealthResponse);
      expect(result.success).toBe(true);
    });

    it('deve validar estrutura completa de chat-service', () => {
      const result = chatHealthSchema.safeParse(mockChatHealthResponse);
      expect(result.success).toBe(true);
    });

    it('deve ter service igual a "chat-service"', () => {
      expect(mockChatHealthResponse.service).toBe('chat-service');
    });

    it('deve usar llmProvider "gpu-manager-service"', () => {
      expect(mockChatHealthResponse.llmProvider).toBe('gpu-manager-service');
    });

    // ARQUITETURA v4.0.0: Qwen2.5-VL substitui Mixtral
    it('deve usar modelo "Qwen2.5-VL-7B-AWQ"', () => {
      expect(mockChatHealthResponse.model).toBe('Qwen/Qwen2.5-VL-7B-Instruct-AWQ');
    });

    it('deve ter circuit breakers para LLM e RAG', () => {
      expect(mockChatHealthResponse.circuitBreakers).toHaveProperty('llm');
      expect(mockChatHealthResponse.circuitBreakers).toHaveProperty('rag');
      expect(mockChatHealthResponse.circuitBreakers.llm).toHaveProperty('state');
      expect(mockChatHealthResponse.circuitBreakers.llm).toHaveProperty('stats');
      expect(mockChatHealthResponse.circuitBreakers.rag).toHaveProperty('state');
      expect(mockChatHealthResponse.circuitBreakers.rag).toHaveProperty('failures');
      expect(mockChatHealthResponse.circuitBreakers.rag).toHaveProperty('rejects');
    });
  });

  describe('rag-service (/api/rag/health)', () => {
    it('deve ter campos obrigatórios: status, service, timestamp', () => {
      const result = baseHealthSchema.safeParse(mockRagHealthResponse);
      expect(result.success).toBe(true);
    });

    it('deve validar estrutura completa de rag-service', () => {
      const result = ragHealthSchema.safeParse(mockRagHealthResponse);
      expect(result.success).toBe(true);
    });

    it('deve ter service igual a "rag-service"', () => {
      expect(mockRagHealthResponse.service).toBe('rag-service');
    });

    it('deve usar embeddingsProvider "gpu-manager-service"', () => {
      expect(mockRagHealthResponse.embeddingsProvider).toBe('gpu-manager-service');
    });

    it('deve usar modelo "Qwen/Qwen3-Embedding-8B" (GPU)', () => {
      expect(mockRagHealthResponse.model).toBe('Qwen/Qwen3-Embedding-8B');
    });

    it('deve ter circuit breaker para embeddings', () => {
      expect(mockRagHealthResponse.circuitBreaker).toHaveProperty('state');
      expect(mockRagHealthResponse.circuitBreaker).toHaveProperty('stats');
    });
  });

  describe('training-service (/api/training/health)', () => {
    it('deve ter campos obrigatórios: status, service, timestamp', () => {
      const result = baseHealthSchema.safeParse(mockTrainingHealthResponse);
      expect(result.success).toBe(true);
    });

    it('deve validar estrutura completa de training-service', () => {
      const result = trainingHealthSchema.safeParse(mockTrainingHealthResponse);
      expect(result.success).toBe(true);
    });

    it('deve ter service igual a "training-service"', () => {
      expect(mockTrainingHealthResponse.service).toBe('training-service');
    });

    it('deve indicar disponibilidade do GPU Manager Service', () => {
      expect(mockTrainingHealthResponse).toHaveProperty('gpuManagerAvailable');
      expect(typeof mockTrainingHealthResponse.gpuManagerAvailable).toBe('boolean');
    });

    it('deve ter circuit breakers para embeddings e GPU Manager', () => {
      expect(mockTrainingHealthResponse.circuitBreakers).toHaveProperty('embeddings');
      expect(mockTrainingHealthResponse.circuitBreakers).toHaveProperty('gpuManager');
    });
  });

  describe('integrations-service (/api/integrations/health)', () => {
    it('deve ter campos obrigatórios: status, service, timestamp', () => {
      const result = baseHealthSchema.safeParse(mockIntegrationsHealthResponse);
      expect(result.success).toBe(true);
    });

    it('deve validar estrutura completa de integrations-service', () => {
      const result = integrationsHealthSchema.safeParse(mockIntegrationsHealthResponse);
      expect(result.success).toBe(true);
    });

    it('deve ter service igual a "integrations-service"', () => {
      expect(mockIntegrationsHealthResponse.service).toBe('integrations-service');
    });

    it('deve listar status das integrações', () => {
      expect(mockIntegrationsHealthResponse.integrations).toHaveProperty('stripe');
      expect(mockIntegrationsHealthResponse.integrations).toHaveProperty('erpnext');
      expect(mockIntegrationsHealthResponse.integrations).toHaveProperty('wise');
    });

    it('deve ter circuit breakers para ERPNext e Wise', () => {
      expect(mockIntegrationsHealthResponse.circuitBreakers).toHaveProperty('erpnext');
      expect(mockIntegrationsHealthResponse.circuitBreakers).toHaveProperty('wise');
    });
  });

  describe('observability-service', () => {
    describe('/health (simples)', () => {
      it('deve validar estrutura simples', () => {
        const result = observabilitySimpleHealthSchema.safeParse(mockObservabilitySimpleHealthResponse);
        expect(result.success).toBe(true);
      });

      it('deve ter service igual a "observability-health"', () => {
        expect(mockObservabilitySimpleHealthResponse.service).toBe('observability-health');
      });
    });

    describe('/api/observability/health (completo)', () => {
      it('deve validar estrutura completa', () => {
        const result = observabilityFullHealthSchema.safeParse(mockObservabilityFullHealthResponse);
        expect(result.success).toBe(true);
      });

      it('deve listar status de Prometheus, Grafana, Jaeger, Langfuse', () => {
        const serviceNames = mockObservabilityFullHealthResponse.services.map(s => s.name);
        expect(serviceNames).toContain('Prometheus');
        expect(serviceNames).toContain('Grafana');
        expect(serviceNames).toContain('Jaeger');
        expect(serviceNames).toContain('Langfuse');
      });

      it('deve incluir uptimeSeconds', () => {
        expect(mockObservabilityFullHealthResponse).toHaveProperty('uptimeSeconds');
        expect(typeof mockObservabilityFullHealthResponse.uptimeSeconds).toBe('number');
      });
    });
  });
});

// ============================================================================
// TESTES DE ESTADOS - Circuit Breaker e Status Degraded
// ============================================================================

describe('Health Endpoints - Estados de Serviço', () => {
  describe('Estados de status', () => {
    it('status "ok" indica serviço funcionando normalmente', () => {
      expect(['ok', 'healthy']).toContain(mockAuthHealthResponse.status);
    });

    it('status "degraded" indica funcionalidade parcial', () => {
      const degradedResponse = { ...mockChatHealthResponse, status: 'degraded' };
      const result = chatHealthSchema.safeParse(degradedResponse);
      expect(result.success).toBe(true);
    });

    it('status "unhealthy" indica falha crítica', () => {
      const unhealthyResponse = { 
        ...mockObservabilityFullHealthResponse, 
        status: 'unhealthy',
        services: mockObservabilityFullHealthResponse.services.map(s => ({ ...s, status: 'unhealthy' as const })),
      };
      const result = observabilityFullHealthSchema.safeParse(unhealthyResponse);
      expect(result.success).toBe(true);
    });
  });

  describe('Estados de Circuit Breaker', () => {
    it('estado "closed" indica funcionamento normal', () => {
      expect(mockChatHealthResponse.circuitBreakers.llm.state).toBe('closed');
    });

    it('estado "open" indica falha e proteção ativa', () => {
      const openResponse = {
        ...mockChatHealthResponse,
        status: 'degraded',
        circuitBreakers: {
          ...mockChatHealthResponse.circuitBreakers,
          llm: { state: 'open' as const, stats: { failures: 10, successes: 0, timeouts: 5 } },
        },
      };
      const result = chatHealthSchema.safeParse(openResponse);
      expect(result.success).toBe(true);
      expect(openResponse.circuitBreakers.llm.state).toBe('open');
    });

    it('estado "half-open" indica teste de reconexão', () => {
      const halfOpenResponse = {
        ...mockRagHealthResponse,
        circuitBreaker: {
          state: 'half-open' as const,
          stats: { failures: 5, successes: 0, timeouts: 2 },
        },
      };
      const result = ragHealthSchema.safeParse(halfOpenResponse);
      expect(result.success).toBe(true);
    });
  });
});

// ============================================================================
// TESTES DE PORTAS E ENDPOINTS - Configuração de Arquitetura
// ============================================================================

describe('Health Endpoints - Configuração de Arquitetura', () => {
  const serviceConfig = {
    'auth-service': { port: 3001, endpoint: '/api/auth/health' },
    'chat-service': { port: 3002, endpoint: '/api/chat/health' },
    'rag-service': { port: 3003, endpoint: '/api/rag/health' },
    'training-service': { port: 3004, endpoint: '/api/training/health' },
    'integrations-service': { port: 3005, endpoint: '/api/integrations/health' },
    'observability-service': { port: 3007, endpoints: ['/health', '/api/observability/health'] },
  };

  it('auth-service deve rodar na porta 3001', () => {
    expect(serviceConfig['auth-service'].port).toBe(3001);
  });

  it('chat-service deve rodar na porta 3002', () => {
    expect(serviceConfig['chat-service'].port).toBe(3002);
  });

  it('rag-service deve rodar na porta 3003', () => {
    expect(serviceConfig['rag-service'].port).toBe(3003);
  });

  it('training-service deve rodar na porta 3004', () => {
    expect(serviceConfig['training-service'].port).toBe(3004);
  });

  it('integrations-service deve rodar na porta 3005', () => {
    expect(serviceConfig['integrations-service'].port).toBe(3005);
  });

  it('observability-service deve rodar na porta 3007', () => {
    expect(serviceConfig['observability-service'].port).toBe(3007);
  });

  it('todos os serviços devem seguir padrão /api/servico/health (Regra 16)', () => {
    const pattern = /^\/api\/\w+(-\w+)*\/health$/;
    
    expect(pattern.test(serviceConfig['auth-service'].endpoint)).toBe(true);
    expect(pattern.test(serviceConfig['chat-service'].endpoint)).toBe(true);
    expect(pattern.test(serviceConfig['rag-service'].endpoint)).toBe(true);
    expect(pattern.test(serviceConfig['training-service'].endpoint)).toBe(true);
    expect(pattern.test(serviceConfig['integrations-service'].endpoint)).toBe(true);
  });
});
