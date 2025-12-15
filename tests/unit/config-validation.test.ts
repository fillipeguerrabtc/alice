/**
 * Testes de Configuração - Validação de variáveis de ambiente e config
 * Fase 1 Passo 1.4 - Alice Enterprise Platform
 * 
 * Valida:
 * - Schema de variáveis de ambiente (envSchema)
 * - Funções de configuração CORS
 * - Constantes de rate limiting, timeouts, limites
 * - URLs de serviços (portas conforme Regra 16)
 * - Configuração Salad Cloud
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 * Regra 8: Usar Pino, console.log é PROIBIDO
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { z } from 'zod';

import {
  getEnvConfig,
  getCorsOrigins,
  getCorsConfig,
  PRODUCTION_CORS_ORIGINS,
  DEVELOPMENT_CORS_ORIGINS,
  RATE_LIMIT_CONFIG,
  SERVICE_URLS,
  DEFAULT_TIMEOUTS,
  SIZE_LIMITS,
  RAG_CHUNK_CONFIG,
  SALAD_CONFIG,
  resolveServiceUrls,
  getServiceUrls,
  resetConfigCache,
} from '@alice/shared-utils/config';

const FIXED_TIMESTAMP = '2024-01-01T00:00:00.000Z';

describe('Config - Variáveis de Ambiente (envSchema)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('NODE_ENV', () => {
    it('deve aceitar "development" como valor válido', () => {
      process.env.NODE_ENV = 'development';
      const config = getEnvConfig();
      expect(config.NODE_ENV).toBe('development');
    });

    it('deve aceitar "production" como valor válido', () => {
      process.env.NODE_ENV = 'production';
      const config = getEnvConfig();
      expect(config.NODE_ENV).toBe('production');
    });

    it('deve aceitar "test" como valor válido', () => {
      process.env.NODE_ENV = 'test';
      const config = getEnvConfig();
      expect(config.NODE_ENV).toBe('test');
    });

    it('deve usar "development" como default', () => {
      delete process.env.NODE_ENV;
      const config = getEnvConfig();
      expect(config.NODE_ENV).toBe('development');
    });
  });

  describe('LOG_LEVEL', () => {
    it('deve aceitar níveis válidos de log (Pino)', () => {
      const validLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
      
      validLevels.forEach(level => {
        process.env.LOG_LEVEL = level;
        const config = getEnvConfig();
        expect(config.LOG_LEVEL).toBe(level);
      });
    });

    it('deve usar "info" como default', () => {
      delete process.env.LOG_LEVEL;
      const config = getEnvConfig();
      expect(config.LOG_LEVEL).toBe('info');
    });
  });

  describe('SALAD_API_URL', () => {
    it('deve ter URL padrão da Salad Cloud', () => {
      delete process.env.SALAD_API_URL;
      const config = getEnvConfig();
      expect(config.SALAD_API_URL).toBe('https://api.salad.com/api/public');
    });

    it('deve aceitar URL customizada', () => {
      process.env.SALAD_API_URL = 'https://custom.salad.api/v1';
      const config = getEnvConfig();
      expect(config.SALAD_API_URL).toBe('https://custom.salad.api/v1');
    });
  });

  describe('PRODUCTION_DOMAIN', () => {
    it('deve ter domínio padrão Yes You Deserve', () => {
      delete process.env.PRODUCTION_DOMAIN;
      const config = getEnvConfig();
      expect(config.PRODUCTION_DOMAIN).toBe('yesyoudeserve.duckdns.org');
    });
  });

  describe('Variáveis opcionais', () => {
    it('DATABASE_URL deve ser opcional', () => {
      delete process.env.DATABASE_URL;
      const config = getEnvConfig();
      expect(config.DATABASE_URL).toBeUndefined();
    });

    it('SALAD_API_KEY deve ser opcional', () => {
      delete process.env.SALAD_API_KEY;
      const config = getEnvConfig();
      expect(config.SALAD_API_KEY).toBeUndefined();
    });

    it('SALAD_ORGANIZATION_ID deve ser opcional', () => {
      delete process.env.SALAD_ORGANIZATION_ID;
      const config = getEnvConfig();
      expect(config.SALAD_ORGANIZATION_ID).toBeUndefined();
    });

    it('CORS_ORIGINS deve ser opcional', () => {
      delete process.env.CORS_ORIGINS;
      const config = getEnvConfig();
      expect(config.CORS_ORIGINS).toBeUndefined();
    });
  });

  describe('Validação negativa (casos de erro)', () => {
    it('deve rejeitar NODE_ENV inválido', () => {
      process.env.NODE_ENV = 'invalid_env';
      expect(() => getEnvConfig()).toThrow();
    });

    it('deve rejeitar LOG_LEVEL inválido', () => {
      process.env.NODE_ENV = 'test';
      process.env.LOG_LEVEL = 'invalid_level';
      expect(() => getEnvConfig()).toThrow();
    });

    it('deve rejeitar AUTH_SERVICE_URL sem protocolo', () => {
      process.env.NODE_ENV = 'test';
      process.env.AUTH_SERVICE_URL = 'auth-service:3001';
      expect(() => getEnvConfig()).toThrow();
    });

    it('deve rejeitar CHAT_SERVICE_URL com protocolo inválido', () => {
      process.env.NODE_ENV = 'test';
      process.env.CHAT_SERVICE_URL = 'ftp://chat-service:3002';
      expect(() => getEnvConfig()).toThrow();
    });

    it('deve rejeitar RAG_SERVICE_URL com formato inválido', () => {
      process.env.NODE_ENV = 'test';
      process.env.RAG_SERVICE_URL = 'http://';
      expect(() => getEnvConfig()).toThrow();
    });

    it('deve rejeitar CORS_ORIGINS com URL inválida', () => {
      process.env.NODE_ENV = 'test';
      process.env.CORS_ORIGINS = 'not-a-valid-url';
      expect(() => getEnvConfig()).toThrow();
    });

    it('deve rejeitar CORS_ORIGINS com protocolo inválido', () => {
      process.env.NODE_ENV = 'test';
      process.env.CORS_ORIGINS = 'ftp://invalid.com';
      expect(() => getEnvConfig()).toThrow();
    });

    it('deve rejeitar CORS_ORIGINS com uma URL válida e uma inválida', () => {
      process.env.NODE_ENV = 'test';
      process.env.CORS_ORIGINS = 'https://valid.com, invalid-url';
      expect(() => getEnvConfig()).toThrow();
    });

    it('deve rejeitar AUTH_SERVICE_URL sem hostname (https://)', () => {
      process.env.NODE_ENV = 'test';
      process.env.AUTH_SERVICE_URL = 'https://';
      expect(() => getEnvConfig()).toThrow();
    });

    it('deve rejeitar CHAT_SERVICE_URL com hostname vazio (https://:3000)', () => {
      process.env.NODE_ENV = 'test';
      process.env.CHAT_SERVICE_URL = 'https://:3000';
      expect(() => getEnvConfig()).toThrow();
    });

    it('deve rejeitar CORS_ORIGINS sem hostname', () => {
      process.env.NODE_ENV = 'test';
      process.env.CORS_ORIGINS = 'https://';
      expect(() => getEnvConfig()).toThrow();
    });

    it('deve rejeitar CORS_ORIGINS com uma origem sem hostname', () => {
      process.env.NODE_ENV = 'test';
      process.env.CORS_ORIGINS = 'https://valid.com, https://';
      expect(() => getEnvConfig()).toThrow();
    });
  });

  describe('SERVICE_URL validação positiva (formato válido)', () => {
    it('deve aceitar AUTH_SERVICE_URL com HTTP', () => {
      process.env.NODE_ENV = 'test';
      process.env.AUTH_SERVICE_URL = 'http://auth-service:3001';
      const config = getEnvConfig();
      expect(config.AUTH_SERVICE_URL).toBe('http://auth-service:3001');
    });

    it('deve aceitar CHAT_SERVICE_URL com HTTPS', () => {
      process.env.NODE_ENV = 'test';
      process.env.CHAT_SERVICE_URL = 'https://chat.example.com:443';
      const config = getEnvConfig();
      expect(config.CHAT_SERVICE_URL).toBe('https://chat.example.com:443');
    });

    it('deve aceitar RAG_SERVICE_URL sem porta (usa porta padrão)', () => {
      process.env.NODE_ENV = 'test';
      process.env.RAG_SERVICE_URL = 'http://rag-service';
      const config = getEnvConfig();
      expect(config.RAG_SERVICE_URL).toBe('http://rag-service');
    });

    it('deve aceitar TRAINING_SERVICE_URL com subdomínio', () => {
      process.env.NODE_ENV = 'test';
      process.env.TRAINING_SERVICE_URL = 'https://training.api.example.com:8080';
      const config = getEnvConfig();
      expect(config.TRAINING_SERVICE_URL).toBe('https://training.api.example.com:8080');
    });

    it('deve aceitar INTEGRATIONS_SERVICE_URL com path', () => {
      process.env.NODE_ENV = 'test';
      process.env.INTEGRATIONS_SERVICE_URL = 'http://integrations:3005/api/v1';
      const config = getEnvConfig();
      expect(config.INTEGRATIONS_SERVICE_URL).toBe('http://integrations:3005/api/v1');
    });

    it('deve aceitar CORS_ORIGINS com múltiplas URLs válidas', () => {
      process.env.NODE_ENV = 'test';
      process.env.CORS_ORIGINS = 'https://app.example.com, http://localhost:3000, https://api.example.com:8443';
      const config = getEnvConfig();
      expect(config.CORS_ORIGINS).toBe('https://app.example.com, http://localhost:3000, https://api.example.com:8443');
    });
  });
});

describe('Config - CORS Origins', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('PRODUCTION_CORS_ORIGINS', () => {
    it('deve incluir domínio principal Yes You Deserve', () => {
      expect(PRODUCTION_CORS_ORIGINS).toContain('https://yesyoudeserve.duckdns.org');
    });

    it('deve incluir subdomínio ERP', () => {
      expect(PRODUCTION_CORS_ORIGINS).toContain('https://erp.yesyoudeserve.duckdns.org');
    });

    it('deve incluir subdomínio API', () => {
      expect(PRODUCTION_CORS_ORIGINS).toContain('https://api.yesyoudeserve.duckdns.org');
    });

    it('deve ter exatamente 3 origens de produção', () => {
      expect(PRODUCTION_CORS_ORIGINS).toHaveLength(3);
    });

    it('todas as origens devem usar HTTPS', () => {
      PRODUCTION_CORS_ORIGINS.forEach(origin => {
        expect(origin).toMatch(/^https:\/\//);
      });
    });
  });

  describe('DEVELOPMENT_CORS_ORIGINS', () => {
    it('deve incluir localhost:5000 (frontend)', () => {
      expect(DEVELOPMENT_CORS_ORIGINS).toContain('http://localhost:5000');
    });

    it('deve incluir localhost:3000 (dev server)', () => {
      expect(DEVELOPMENT_CORS_ORIGINS).toContain('http://localhost:3000');
    });

    it('deve incluir 127.0.0.1:5000', () => {
      expect(DEVELOPMENT_CORS_ORIGINS).toContain('http://127.0.0.1:5000');
    });

    it('todas as origens de dev devem usar HTTP', () => {
      DEVELOPMENT_CORS_ORIGINS.forEach(origin => {
        expect(origin).toMatch(/^http:\/\//);
      });
    });
  });

  describe('getCorsOrigins()', () => {
    it('deve usar CORS_ORIGINS customizada quando definida', () => {
      process.env.CORS_ORIGINS = 'https://custom1.com, https://custom2.com';
      const origins = getCorsOrigins();
      expect(origins).toContain('https://custom1.com');
      expect(origins).toContain('https://custom2.com');
    });

    it('deve retornar apenas produção quando NODE_ENV=production', () => {
      delete process.env.CORS_ORIGINS;
      process.env.NODE_ENV = 'production';
      const origins = getCorsOrigins();
      expect(origins).toEqual(PRODUCTION_CORS_ORIGINS);
    });

    it('deve combinar dev e prod quando NODE_ENV=development', () => {
      delete process.env.CORS_ORIGINS;
      process.env.NODE_ENV = 'development';
      const origins = getCorsOrigins();
      expect(origins).toEqual(expect.arrayContaining(DEVELOPMENT_CORS_ORIGINS));
      expect(origins).toEqual(expect.arrayContaining(PRODUCTION_CORS_ORIGINS));
    });
  });

  describe('getCorsConfig()', () => {
    it('deve retornar objeto de configuração válido', () => {
      const config = getCorsConfig();
      expect(config).toHaveProperty('origin');
      expect(config).toHaveProperty('credentials');
      expect(config).toHaveProperty('methods');
      expect(config).toHaveProperty('allowedHeaders');
      expect(config).toHaveProperty('exposedHeaders');
      expect(config).toHaveProperty('maxAge');
    });

    it('deve incluir métodos HTTP padrão', () => {
      const config = getCorsConfig();
      expect(config.methods).toContain('GET');
      expect(config.methods).toContain('POST');
      expect(config.methods).toContain('PUT');
      expect(config.methods).toContain('PATCH');
      expect(config.methods).toContain('DELETE');
      expect(config.methods).toContain('OPTIONS');
    });

    it('deve incluir headers de autenticação', () => {
      const config = getCorsConfig();
      expect(config.allowedHeaders).toContain('Authorization');
      expect(config.allowedHeaders).toContain('Content-Type');
    });

    it('deve incluir headers de multi-tenancy (Regra 16)', () => {
      const config = getCorsConfig();
      expect(config.allowedHeaders).toContain('X-User-Id');
      expect(config.allowedHeaders).toContain('X-Tenant-Id');
      expect(config.allowedHeaders).toContain('X-Request-Id');
    });

    it('deve expor headers de resposta', () => {
      const config = getCorsConfig();
      expect(config.exposedHeaders).toContain('X-Request-Id');
      expect(config.exposedHeaders).toContain('X-Response-Time');
    });

    it('deve ter maxAge de 24 horas (86400 segundos)', () => {
      const config = getCorsConfig();
      expect(config.maxAge).toBe(86400);
    });
  });
});

describe('Config - Rate Limiting', () => {
  describe('RATE_LIMIT_CONFIG', () => {
    it('deve ter janela de tempo de 1 minuto (60000ms)', () => {
      expect(RATE_LIMIT_CONFIG.windowMs).toBe(60 * 1000);
    });

    it('deve ter limite para endpoints públicos', () => {
      expect(RATE_LIMIT_CONFIG.limits.public).toBe(20);
    });

    it('deve ter limite para endpoints autenticados', () => {
      expect(RATE_LIMIT_CONFIG.limits.authenticated).toBe(100);
    });

    it('deve ter limite para endpoints de API (chat, RAG)', () => {
      expect(RATE_LIMIT_CONFIG.limits.api).toBe(60);
    });

    it('deve ter limite para endpoints administrativos', () => {
      expect(RATE_LIMIT_CONFIG.limits.admin).toBe(30);
    });

    it('deve ter limite para uploads de arquivos', () => {
      expect(RATE_LIMIT_CONFIG.limits.upload).toBe(10);
    });

    it('deve ter limite para webhooks', () => {
      expect(RATE_LIMIT_CONFIG.limits.webhook).toBe(100);
    });

    it('limite público deve ser menor que autenticado', () => {
      expect(RATE_LIMIT_CONFIG.limits.public).toBeLessThan(RATE_LIMIT_CONFIG.limits.authenticated);
    });

    it('limite de upload deve ser o mais restritivo', () => {
      const allLimits = Object.values(RATE_LIMIT_CONFIG.limits) as number[];
      expect(RATE_LIMIT_CONFIG.limits.upload).toBe(Math.min(...allLimits));
    });
  });
});

describe('Config - Service URLs (Regra 16 - Portas)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetConfigCache();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetConfigCache();
  });

  describe('SERVICE_URLS (valores padrão)', () => {
    it('auth-service deve usar porta 3001', () => {
      expect(SERVICE_URLS.auth).toContain(':3001');
    });

    it('chat-service deve usar porta 3002', () => {
      expect(SERVICE_URLS.chat).toContain(':3002');
    });

    it('rag-service deve usar porta 3003', () => {
      expect(SERVICE_URLS.rag).toContain(':3003');
    });

    it('training-service deve usar porta 3004', () => {
      expect(SERVICE_URLS.training).toContain(':3004');
    });

    it('integrations-service deve usar porta 3005', () => {
      expect(SERVICE_URLS.integrations).toContain(':3005');
    });

    it('deve ter todos os 5 serviços principais configurados', () => {
      const services = ['auth', 'chat', 'rag', 'training', 'integrations'] as const;
      services.forEach(service => {
        expect(SERVICE_URLS).toHaveProperty(service);
      });
    });

    it('URLs padrão devem seguir padrão Docker (http://service-name:port)', () => {
      const urls = getServiceUrls();
      Object.values(urls).forEach(url => {
        expect(url).toMatch(/^http:\/\/[a-z-]+:\d+$/);
      });
    });
  });

  describe('resolveServiceUrls() - Resolução direta', () => {
    it('deve retornar URLs padrão quando env está vazio', () => {
      const urls = resolveServiceUrls({});
      expect(urls.auth).toBe('http://auth-service:3001');
      expect(urls.chat).toBe('http://chat-service:3002');
      expect(urls.rag).toBe('http://rag-service:3003');
      expect(urls.training).toBe('http://training-service:3004');
      expect(urls.integrations).toBe('http://integrations-service:3005');
    });

    it('deve sobrescrever auth com AUTH_SERVICE_URL', () => {
      const urls = resolveServiceUrls({ AUTH_SERVICE_URL: 'http://custom-auth:9001' });
      expect(urls.auth).toBe('http://custom-auth:9001');
    });

    it('deve sobrescrever chat com CHAT_SERVICE_URL', () => {
      const urls = resolveServiceUrls({ CHAT_SERVICE_URL: 'http://custom-chat:9002' });
      expect(urls.chat).toBe('http://custom-chat:9002');
    });

    it('deve sobrescrever rag com RAG_SERVICE_URL', () => {
      const urls = resolveServiceUrls({ RAG_SERVICE_URL: 'http://custom-rag:9003' });
      expect(urls.rag).toBe('http://custom-rag:9003');
    });

    it('deve sobrescrever training com TRAINING_SERVICE_URL', () => {
      const urls = resolveServiceUrls({ TRAINING_SERVICE_URL: 'http://custom-training:9004' });
      expect(urls.training).toBe('http://custom-training:9004');
    });

    it('deve sobrescrever integrations com INTEGRATIONS_SERVICE_URL', () => {
      const urls = resolveServiceUrls({ INTEGRATIONS_SERVICE_URL: 'http://custom-integrations:9005' });
      expect(urls.integrations).toBe('http://custom-integrations:9005');
    });

    it('deve sobrescrever múltiplos serviços simultaneamente', () => {
      const urls = resolveServiceUrls({
        AUTH_SERVICE_URL: 'http://a:1',
        CHAT_SERVICE_URL: 'http://b:2',
        RAG_SERVICE_URL: 'http://c:3',
      });
      expect(urls.auth).toBe('http://a:1');
      expect(urls.chat).toBe('http://b:2');
      expect(urls.rag).toBe('http://c:3');
      expect(urls.training).toBe('http://training-service:3004');
      expect(urls.integrations).toBe('http://integrations-service:3005');
    });
  });

  describe('getServiceUrls() + resetConfigCache() - Cache lazy', () => {
    it('deve usar cache na segunda chamada', () => {
      const urls1 = getServiceUrls();
      const urls2 = getServiceUrls();
      expect(urls1).toBe(urls2);
    });

    it('deve resetar cache corretamente', () => {
      const urls1 = getServiceUrls();
      resetConfigCache();
      const urls2 = getServiceUrls();
      expect(urls1).not.toBe(urls2);
      expect(urls1).toEqual(urls2);
    });

    it('deve refletir mudanças em process.env após reset', () => {
      resetConfigCache();
      process.env.AUTH_SERVICE_URL = 'http://new-auth:8001';
      const urls = getServiceUrls();
      expect(urls.auth).toBe('http://new-auth:8001');
    });
  });

  describe('SERVICE_URLS Proxy - Override via process.env', () => {
    it('deve refletir AUTH_SERVICE_URL após resetConfigCache', () => {
      process.env.AUTH_SERVICE_URL = 'http://proxy-auth:7001';
      resetConfigCache();
      expect(SERVICE_URLS.auth).toBe('http://proxy-auth:7001');
    });

    it('deve refletir CHAT_SERVICE_URL após resetConfigCache', () => {
      process.env.CHAT_SERVICE_URL = 'http://proxy-chat:7002';
      resetConfigCache();
      expect(SERVICE_URLS.chat).toBe('http://proxy-chat:7002');
    });

    it('deve refletir RAG_SERVICE_URL após resetConfigCache', () => {
      process.env.RAG_SERVICE_URL = 'http://proxy-rag:7003';
      resetConfigCache();
      expect(SERVICE_URLS.rag).toBe('http://proxy-rag:7003');
    });

    it('deve refletir TRAINING_SERVICE_URL após resetConfigCache', () => {
      process.env.TRAINING_SERVICE_URL = 'http://proxy-training:7004';
      resetConfigCache();
      expect(SERVICE_URLS.training).toBe('http://proxy-training:7004');
    });

    it('deve refletir INTEGRATIONS_SERVICE_URL após resetConfigCache', () => {
      process.env.INTEGRATIONS_SERVICE_URL = 'http://proxy-integrations:7005';
      resetConfigCache();
      expect(SERVICE_URLS.integrations).toBe('http://proxy-integrations:7005');
    });
  });

  describe('Edge cases - resetConfigCache', () => {
    it('deve funcionar quando chamado múltiplas vezes consecutivas', () => {
      resetConfigCache();
      resetConfigCache();
      resetConfigCache();
      const urls = getServiceUrls();
      expect(urls.auth).toBe('http://auth-service:3001');
    });

    it('deve funcionar quando cache está vazio', () => {
      resetConfigCache();
      expect(() => resetConfigCache()).not.toThrow();
    });

    it('deve permitir alternância entre valores', () => {
      process.env.AUTH_SERVICE_URL = 'http://first:1111';
      resetConfigCache();
      expect(SERVICE_URLS.auth).toBe('http://first:1111');
      
      process.env.AUTH_SERVICE_URL = 'http://second:2222';
      resetConfigCache();
      expect(SERVICE_URLS.auth).toBe('http://second:2222');
      
      delete process.env.AUTH_SERVICE_URL;
      resetConfigCache();
      expect(SERVICE_URLS.auth).toBe('http://auth-service:3001');
    });

    it('deve isolar mudanças entre serviços', () => {
      process.env.AUTH_SERVICE_URL = 'http://custom-auth:9999';
      resetConfigCache();
      
      expect(SERVICE_URLS.auth).toBe('http://custom-auth:9999');
      expect(SERVICE_URLS.chat).toBe('http://chat-service:3002');
      expect(SERVICE_URLS.rag).toBe('http://rag-service:3003');
    });
  });
});

describe('Config - Timeouts Padrão', () => {
  describe('DEFAULT_TIMEOUTS', () => {
    it('deve ter timeout HTTP padrão de 30 segundos', () => {
      expect(DEFAULT_TIMEOUTS.http).toBe(30000);
    });

    it('deve ter timeout LLM de 60 segundos (inferência Llama 4)', () => {
      expect(DEFAULT_TIMEOUTS.llm).toBe(60000);
    });

    it('deve ter timeout de embeddings de 30 segundos', () => {
      expect(DEFAULT_TIMEOUTS.embeddings).toBe(30000);
    });

    it('deve ter timeout de busca RAG de 10 segundos', () => {
      expect(DEFAULT_TIMEOUTS.ragSearch).toBe(10000);
    });

    it('deve ter timeout de APIs externas de 15 segundos', () => {
      expect(DEFAULT_TIMEOUTS.externalApi).toBe(15000);
    });

    it('deve ter timeout de upload de 120 segundos (2 minutos)', () => {
      expect(DEFAULT_TIMEOUTS.fileUpload).toBe(120000);
    });

    it('deve ter timeout de fine-tuning de 300 segundos (5 minutos)', () => {
      expect(DEFAULT_TIMEOUTS.fineTuning).toBe(300000);
    });

    it('timeout LLM deve ser maior que timeout HTTP padrão', () => {
      expect(DEFAULT_TIMEOUTS.llm).toBeGreaterThan(DEFAULT_TIMEOUTS.http);
    });

    it('timeout de fine-tuning deve ser o maior', () => {
      const allTimeouts = Object.values(DEFAULT_TIMEOUTS) as number[];
      expect(DEFAULT_TIMEOUTS.fineTuning).toBe(Math.max(...allTimeouts));
    });
  });
});

describe('Config - Limites de Tamanho', () => {
  describe('SIZE_LIMITS', () => {
    it('deve ter limite de upload de 50MB', () => {
      expect(SIZE_LIMITS.maxFileUpload).toBe(50 * 1024 * 1024);
    });

    it('deve ter limite de mensagem de 32000 caracteres', () => {
      expect(SIZE_LIMITS.maxMessageLength).toBe(32000);
    });

    it('deve ter limite de documento RAG de 10MB', () => {
      expect(SIZE_LIMITS.maxDocumentSize).toBe(10 * 1024 * 1024);
    });

    it('deve ter limite de 1000 chunks por documento', () => {
      expect(SIZE_LIMITS.maxChunksPerDocument).toBe(1000);
    });

    it('deve ter limite de 20 resultados RAG', () => {
      expect(SIZE_LIMITS.maxRagResults).toBe(20);
    });

    it('limite de upload deve ser maior que limite de documento', () => {
      expect(SIZE_LIMITS.maxFileUpload).toBeGreaterThan(SIZE_LIMITS.maxDocumentSize);
    });
  });
});

describe('Config - RAG Chunk Configuration', () => {
  describe('RAG_CHUNK_CONFIG', () => {
    it('deve ter chunk size de 1000 caracteres', () => {
      expect(RAG_CHUNK_CONFIG.chunkSize).toBe(1000);
    });

    it('deve ter overlap de 200 caracteres', () => {
      expect(RAG_CHUNK_CONFIG.chunkOverlap).toBe(200);
    });

    it('deve ter dimensão de embeddings de 1024 (BGE-M3 GPU)', () => {
      expect(RAG_CHUNK_CONFIG.embeddingDimensions).toBe(1024);
    });

    it('deve ter threshold de similaridade de 0.7', () => {
      expect(RAG_CHUNK_CONFIG.similarityThreshold).toBe(0.7);
    });

    it('overlap deve ser menor que chunk size', () => {
      expect(RAG_CHUNK_CONFIG.chunkOverlap).toBeLessThan(RAG_CHUNK_CONFIG.chunkSize);
    });

    it('similarity threshold deve estar entre 0 e 1', () => {
      expect(RAG_CHUNK_CONFIG.similarityThreshold).toBeGreaterThan(0);
      expect(RAG_CHUNK_CONFIG.similarityThreshold).toBeLessThanOrEqual(1);
    });
  });
});

describe('Config - Salad Cloud Configuration', () => {
  describe('SALAD_CONFIG', () => {
    it('deve ter URL padrão da API Salad Cloud', () => {
      expect(SALAD_CONFIG.apiUrl).toBe('https://api.salad.com/api/public');
    });

    it('deve ter modelo de chat configurado como llama4-maverick', () => {
      expect(SALAD_CONFIG.models.chat).toBe('llama4-maverick');
    });

    it('deve ter maxTokens padrão de 4096', () => {
      expect(SALAD_CONFIG.defaults.maxTokens).toBe(4096);
    });

    it('deve ter temperature padrão de 0.7', () => {
      expect(SALAD_CONFIG.defaults.temperature).toBe(0.7);
    });

    it('deve ter topP padrão de 0.9', () => {
      expect(SALAD_CONFIG.defaults.topP).toBe(0.9);
    });

    it('temperature deve estar entre 0 e 2', () => {
      expect(SALAD_CONFIG.defaults.temperature).toBeGreaterThanOrEqual(0);
      expect(SALAD_CONFIG.defaults.temperature).toBeLessThanOrEqual(2);
    });

    it('topP deve estar entre 0 e 1', () => {
      expect(SALAD_CONFIG.defaults.topP).toBeGreaterThan(0);
      expect(SALAD_CONFIG.defaults.topP).toBeLessThanOrEqual(1);
    });
  });
});

describe('Config - Consistência entre Configurações', () => {
  it('timeout de embeddings deve ser compatível com RAG search timeout', () => {
    expect(DEFAULT_TIMEOUTS.embeddings).toBeGreaterThanOrEqual(DEFAULT_TIMEOUTS.ragSearch);
  });

  it('limite de chunks deve ser compatível com tamanho de documento', () => {
    const avgChunkSize = RAG_CHUNK_CONFIG.chunkSize - RAG_CHUNK_CONFIG.chunkOverlap;
    const maxChunksNeeded = Math.ceil(SIZE_LIMITS.maxDocumentSize / avgChunkSize);
    expect(SIZE_LIMITS.maxChunksPerDocument).toBeGreaterThanOrEqual(1);
  });

  it('rate limit de API deve ser maior que rate limit público', () => {
    expect(RATE_LIMIT_CONFIG.limits.api).toBeGreaterThan(RATE_LIMIT_CONFIG.limits.public);
  });

  it('todas as portas de serviços devem ser únicas', () => {
    const ports = (Object.values(SERVICE_URLS) as string[]).map(url => {
      const match = url.match(/:(\d+)$/);
      return match ? match[1] : null;
    });
    const uniquePorts = new Set(ports);
    expect(uniquePorts.size).toBe(ports.length);
  });
});
