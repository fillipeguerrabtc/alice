/**
 * Configurações Centralizadas - Alice Enterprise Platform
 * 
 * Centraliza configurações de CORS, timeouts, limites e URLs.
 * Documentação em PT-BR (Regra 10 replit.md).
 * 
 * @module @alice/shared-utils/config
 */

import { z } from 'zod';

/**
 * Schema de validação para variáveis de ambiente
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  
  DATABASE_URL: z.string().optional(),
  
  SALAD_API_KEY: z.string().optional(),
  SALAD_ORGANIZATION_ID: z.string().optional(),
  SALAD_API_URL: z.string().default('https://api.salad.com/api/public'),
  
  CORS_ORIGINS: z.string().optional(),
  
  PRODUCTION_DOMAIN: z.string().default('yesyoudeserve.duckdns.org'),
});

/**
 * Configurações de ambiente validadas
 */
export function getEnvConfig() {
  return envSchema.parse(process.env);
}

/**
 * Domínios permitidos para CORS em produção
 */
export const PRODUCTION_CORS_ORIGINS = [
  'https://yesyoudeserve.duckdns.org',
  'https://erp.yesyoudeserve.duckdns.org',
  'https://api.yesyoudeserve.duckdns.org',
];

/**
 * Domínios permitidos para CORS em desenvolvimento
 */
export const DEVELOPMENT_CORS_ORIGINS = [
  'http://localhost:5000',
  'http://localhost:3000',
  'http://127.0.0.1:5000',
];

/**
 * Obtém lista de origens CORS baseada no ambiente
 * 
 * @returns Array de origens permitidas para CORS
 * 
 * @example
 * ```typescript
 * import { getCorsOrigins } from '@alice/shared-utils/config';
 * 
 * app.use(cors({
 *   origin: getCorsOrigins(),
 *   credentials: true,
 * }));
 * ```
 */
export function getCorsOrigins(): string[] {
  const envOrigins = process.env.CORS_ORIGINS;
  
  if (envOrigins) {
    return envOrigins.split(',').map(origin => origin.trim());
  }
  
  const isProd = process.env.NODE_ENV === 'production';
  
  if (isProd) {
    return PRODUCTION_CORS_ORIGINS;
  }
  
  return [...DEVELOPMENT_CORS_ORIGINS, ...PRODUCTION_CORS_ORIGINS];
}

/**
 * Configuração CORS pronta para uso com Express
 * 
 * @returns Objeto de configuração para middleware cors
 */
export function getCorsConfig() {
  const origins = getCorsOrigins();
  
  return {
    origin: origins.length > 0 ? origins : false,
    credentials: origins.length > 0,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-User-Id',
      'X-Tenant-Id',
      'X-Request-Id',
    ],
    exposedHeaders: [
      'X-Request-Id',
      'X-Response-Time',
    ],
    maxAge: 86400,
  };
}

/**
 * Configuração de Rate Limiting
 */
export const RATE_LIMIT_CONFIG = {
  /** Janela de tempo em ms (1 minuto) */
  windowMs: 60 * 1000,
  
  /** Configurações por tipo de endpoint */
  limits: {
    /** Endpoints públicos (login, registro) */
    public: 20,
    /** Endpoints autenticados padrão */
    authenticated: 100,
    /** Endpoints de API (chat, RAG) */
    api: 60,
    /** Endpoints administrativos */
    admin: 30,
    /** Uploads de arquivos */
    upload: 10,
    /** Webhooks */
    webhook: 100,
  },
};

/**
 * URLs dos serviços internos
 */
export const SERVICE_URLS = {
  auth: process.env.AUTH_SERVICE_URL || 'http://auth-service:3001',
  chat: process.env.CHAT_SERVICE_URL || 'http://chat-service:3002',
  rag: process.env.RAG_SERVICE_URL || 'http://rag-service:3003',
  training: process.env.TRAINING_SERVICE_URL || 'http://training-service:3004',
  integrations: process.env.INTEGRATIONS_SERVICE_URL || 'http://integrations-service:3005',
};

/**
 * Timeouts padrão em milissegundos
 */
export const DEFAULT_TIMEOUTS = {
  /** Requisição HTTP padrão */
  http: 30000,
  /** Chamada LLM (inferência) */
  llm: 60000,
  /** Geração de embeddings */
  embeddings: 30000,
  /** Busca RAG */
  ragSearch: 10000,
  /** APIs externas (Stripe, Wise) */
  externalApi: 15000,
  /** Upload de arquivos */
  fileUpload: 120000,
  /** Fine-tuning job */
  fineTuning: 300000,
};

/**
 * Limites de tamanho
 */
export const SIZE_LIMITS = {
  /** Tamanho máximo de upload em bytes (50MB) */
  maxFileUpload: 50 * 1024 * 1024,
  /** Tamanho máximo de mensagem em caracteres */
  maxMessageLength: 32000,
  /** Tamanho máximo de documento para RAG */
  maxDocumentSize: 10 * 1024 * 1024,
  /** Limite de chunks por documento */
  maxChunksPerDocument: 1000,
  /** Limite de resultados de busca RAG */
  maxRagResults: 20,
};

/**
 * Configuração de chunking para RAG
 */
export const RAG_CHUNK_CONFIG = {
  /** Tamanho do chunk em caracteres */
  chunkSize: 1000,
  /** Sobreposição entre chunks */
  chunkOverlap: 200,
  /** Dimensão dos embeddings (text-embedding-3-small) */
  embeddingDimensions: 384,
  /** Threshold de similaridade para busca */
  similarityThreshold: 0.7,
};

/**
 * Configuração Salad Cloud
 */
export const SALAD_CONFIG = {
  apiUrl: process.env.SALAD_API_URL || 'https://api.salad.com/api/public',
  organizationId: process.env.SALAD_ORGANIZATION_ID || '',
  models: {
    chat: 'llama4-maverick',
    embeddings: 'text-embedding-3-small',
  },
  defaults: {
    maxTokens: 4096,
    temperature: 0.7,
    topP: 0.9,
  },
};
