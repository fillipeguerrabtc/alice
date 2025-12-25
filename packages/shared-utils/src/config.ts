/**
 * Configurações Centralizadas - Alice Enterprise Platform
 * 
 * Centraliza configurações de CORS, timeouts, limites e URLs.
 * Implementa padrão lazy loading com cache resetável para testabilidade.
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md).
 * TypeScript strict mode, `any` proibido (Regra 8).
 * 
 * @module @alice/shared-utils/config
 */

import { z } from 'zod';

/**
 * Regex para validação de URL de serviço
 * Requer: protocolo (http/https) + hostname válido (não vazio) + porta opcional + path opcional
 * 
 * Exemplos válidos:
 * - http://auth-service:3001
 * - https://api.example.com
 * - http://localhost:5000/api/v1
 * 
 * Exemplos inválidos:
 * - https:// (sem hostname)
 * - https://: (hostname vazio)
 * - ftp://server (protocolo inválido)
 */
const SERVICE_URL_REGEX = /^https?:\/\/[a-zA-Z0-9][a-zA-Z0-9.-]*(:\d{1,5})?(\/[^\s]*)?$/;

/**
 * Schema para validação de URL de serviço (HTTP/HTTPS obrigatório)
 * Valida formato: http(s)://hostname:port ou http(s)://hostname
 */
const serviceUrlSchema = z.string().refine(
  (value) => {
    if (!value) return true;
    if (!SERVICE_URL_REGEX.test(value)) return false;
    try {
      const url = new URL(value);
      return url.hostname.length > 0;
    } catch {
      return false;
    }
  },
  'URL de serviço inválida: deve começar com http:// ou https:// e ter hostname válido'
).optional();

/**
 * Schema para validação de CORS origins (lista separada por vírgula)
 * Cada origem deve ser uma URL válida com hostname não vazio
 */
const corsOriginsSchema = z.string().refine(
  (value) => {
    if (!value) return true;
    const origins = value.split(',').map(o => o.trim());
    return origins.every(origin => {
      if (!SERVICE_URL_REGEX.test(origin)) return false;
      try {
        const url = new URL(origin);
        return url.hostname.length > 0;
      } catch {
        return false;
      }
    });
  },
  'CORS_ORIGINS inválido: cada origem deve ser uma URL válida (http:// ou https://) com hostname'
).optional();

/**
 * Schema de validação para variáveis de ambiente
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  
  DATABASE_URL: z.string().optional(),
  
  // Salad Cloud removido - migrado para GPU Manager Service (Hetzner GEX44)
  
  CORS_ORIGINS: corsOriginsSchema,
  
  PRODUCTION_DOMAIN: z.string().default('yesyoudeserve.duckdns.org'),
  
  AUTH_SERVICE_URL: serviceUrlSchema,
  CHAT_SERVICE_URL: serviceUrlSchema,
  RAG_SERVICE_URL: serviceUrlSchema,
  TRAINING_SERVICE_URL: serviceUrlSchema,
  INTEGRATIONS_SERVICE_URL: serviceUrlSchema,
});

/**
 * Configurações de ambiente validadas
 */
export function getEnvConfig() {
  return envSchema.parse(process.env);
}

/**
 * Tipo de URLs de serviços internos
 */
export interface ServiceUrlsConfig {
  auth: string;
  chat: string;
  rag: string;
  training: string;
  integrations: string;
}

/**
 * URLs padrão dos serviços (Regra 16 - Portas de microsserviços)
 */
const DEFAULT_SERVICE_URLS: ServiceUrlsConfig = {
  auth: 'http://auth-service:3001',
  chat: 'http://chat-service:3002',
  rag: 'http://rag-service:3003',
  training: 'http://training-service:3004',
  integrations: 'http://integrations-service:3005',
};

/**
 * Cache interno para SERVICE_URLS
 * Permite lazy loading e reset para testes
 */
let serviceUrlsCache: ServiceUrlsConfig | null = null;

/**
 * Resolve URLs de serviços a partir de variáveis de ambiente
 * 
 * @param env - Objeto com variáveis de ambiente (padrão: process.env)
 * @returns Objeto com URLs dos serviços resolvidas
 * 
 * @example
 * ```typescript
 * // Uso padrão (lê de process.env)
 * const urls = resolveServiceUrls();
 * 
 * // Teste com env customizado
 * const urls = resolveServiceUrls({ AUTH_SERVICE_URL: 'http://custom:9001' });
 * ```
 */
export function resolveServiceUrls(env: Record<string, string | undefined> = process.env): ServiceUrlsConfig {
  return {
    auth: env.AUTH_SERVICE_URL || DEFAULT_SERVICE_URLS.auth,
    chat: env.CHAT_SERVICE_URL || DEFAULT_SERVICE_URLS.chat,
    rag: env.RAG_SERVICE_URL || DEFAULT_SERVICE_URLS.rag,
    training: env.TRAINING_SERVICE_URL || DEFAULT_SERVICE_URLS.training,
    integrations: env.INTEGRATIONS_SERVICE_URL || DEFAULT_SERVICE_URLS.integrations,
  };
}

/**
 * Obtém URLs de serviços com cache lazy
 * 
 * Usa cache para evitar re-cálculos desnecessários em runtime.
 * O cache pode ser limpo com resetConfigCache() para testes.
 * 
 * @returns Objeto com URLs dos serviços
 */
export function getServiceUrls(): ServiceUrlsConfig {
  if (serviceUrlsCache === null) {
    serviceUrlsCache = resolveServiceUrls();
  }
  return serviceUrlsCache;
}

/**
 * Reseta o cache de configurações
 * 
 * IMPORTANTE: Esta função é destinada APENAS para testes.
 * Permite que testes modifiquem process.env e obtenham novos valores.
 * 
 * @example
 * ```typescript
 * // Em testes
 * beforeEach(() => {
 *   resetConfigCache();
 *   process.env.AUTH_SERVICE_URL = 'http://test:9001';
 * });
 * ```
 */
export function resetConfigCache(): void {
  serviceUrlsCache = null;
}

/**
 * Proxy para SERVICE_URLS - Compatibilidade retroativa
 * 
 * Permite acesso via `SERVICE_URLS.auth` etc., delegando para getServiceUrls().
 * Isso garante que código existente continue funcionando enquanto
 * permite testes de override via resetConfigCache().
 */
export const SERVICE_URLS: ServiceUrlsConfig = new Proxy({} as ServiceUrlsConfig, {
  get(_target, prop: keyof ServiceUrlsConfig): string {
    const urls = getServiceUrls();
    return urls[prop];
  },
  
  ownKeys(): (keyof ServiceUrlsConfig)[] {
    return ['auth', 'chat', 'rag', 'training', 'integrations'];
  },
  
  getOwnPropertyDescriptor(_target, prop: keyof ServiceUrlsConfig): PropertyDescriptor | undefined {
    const urls = getServiceUrls();
    if (prop in urls) {
      return {
        value: urls[prop],
        writable: false,
        enumerable: true,
        configurable: true,
      };
    }
    return undefined;
  },
  
  has(_target, prop: keyof ServiceUrlsConfig): boolean {
    return prop in DEFAULT_SERVICE_URLS;
  },
});

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
  /** Dimensão dos embeddings (Qwen3-Embedding-8B GPU - 4096 dim) - ARQUITETURA ENTERPRISE (17/12/2025) */
  embeddingDimensions: 4096,
  /** Threshold de similaridade para busca */
  similarityThreshold: 0.7,
};

/**
 * Configuração GPU Manager Service (Hetzner GEX44)
 * ARQUITETURA ENTERPRISE (25/12/2025): Todos os serviços GPU rodam localmente
 * Modelo: Mixtral 8x7B AWQ (quantizado para RTX 4000 Ada 20GB VRAM)
 */
export const GPU_MANAGER_CONFIG = {
  // GPU Manager Service URL (container name em produção: alice-gpu-manager:3010)
  // BUG FIX 25/12/2025: URL padrão corrigida para corresponder ao container_name do docker-compose.prod.yml
  url: process.env.GPU_MANAGER_URL || 'http://alice-gpu-manager:3010',
  models: {
    chat: 'TheBloke/Mixtral-8x7B-Instruct-v0.1-AWQ',
    embeddings: 'Qwen/Qwen3-Embedding-8B',
    image: 'laion/CLIP-ViT-H-14-laion2B-s32B-b79K',
    asr: 'nvidia/Canary-1B',
    flux: 'black-forest-labs/FLUX.1-schnell',
  },
  defaults: {
    maxTokens: 4096,
    temperature: 0.7,
    topP: 0.9,
  },
};

// Legacy: SALAD_CONFIG removido - usar GPU_MANAGER_CONFIG
export const SALAD_CONFIG = GPU_MANAGER_CONFIG;
