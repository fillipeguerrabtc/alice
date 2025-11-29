/**
 * Sistema de Feature Flags Enterprise - Alice Platform
 * 
 * Sistema de feature flags runtime com:
 * - Persistência em PostgreSQL (Regra 6 - ZERO soluções temporárias)
 * - Cache com TTL para performance
 * - Suporte multi-tenant
 * - Fallback seguro para produção
 * - Auditoria de mudanças
 * 
 * Documentação em PT-BR (Regra 10 replit.md)
 * 
 * @module @alice/shared-utils/feature-flags
 */

import { createLogger } from './logger.js';
import { z } from 'zod';

const logger = createLogger('feature-flags');

// ============================================================================
// SCHEMAS DE VALIDAÇÃO - Feature Flags
// ============================================================================

/**
 * Schema de configuração de feature flag
 */
export const featureFlagSchema = z.object({
  key: z.string().min(1).max(100).regex(/^[a-z][a-z0-9_]*$/, 
    'Key deve ser lowercase com underscores, começando com letra'),
  enabled: z.boolean(),
  description: z.string().max(500).optional(),
  tenantId: z.string().uuid().optional(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
  createdBy: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type FeatureFlag = z.infer<typeof featureFlagSchema>;

/**
 * Schema para criação de feature flag
 */
export const createFeatureFlagSchema = featureFlagSchema.pick({
  key: true,
  enabled: true,
  description: true,
  tenantId: true,
  metadata: true,
});

export type CreateFeatureFlag = z.infer<typeof createFeatureFlagSchema>;

// ============================================================================
// FEATURE FLAG KEYS - Chaves padrão do sistema
// ============================================================================

/**
 * Chaves de feature flags disponíveis no sistema Alice.
 * Usar sempre estas constantes para evitar typos.
 */
export const FEATURE_FLAGS = {
  // Integrações
  STRIPE_ENABLED: 'stripe_enabled',
  WISE_ENABLED: 'wise_enabled',
  ERPNEXT_ENABLED: 'erpnext_enabled',
  TWILIO_ENABLED: 'twilio_enabled',
  RESEND_ENABLED: 'resend_enabled',
  
  // AI Features
  IMAGE_GENERATION_ENABLED: 'image_generation_enabled',
  RAG_ENABLED: 'rag_enabled',
  CLIP_EMBEDDINGS_ENABLED: 'clip_embeddings_enabled',
  TRAINING_ENABLED: 'training_enabled',
  
  // Autenticação
  SAML_ENABLED: 'saml_enabled',
  GOOGLE_OAUTH_ENABLED: 'google_oauth_enabled',
  GITHUB_OAUTH_ENABLED: 'github_oauth_enabled',
  MICROSOFT_OAUTH_ENABLED: 'microsoft_oauth_enabled',
  
  // Funcionalidades
  HANDOVER_ENABLED: 'handover_enabled',
  AUTO_ESCALATION_ENABLED: 'auto_escalation_enabled',
  WEBSOCKET_ENABLED: 'websocket_enabled',
  
  // Observability
  LANGFUSE_ENABLED: 'langfuse_enabled',
  PROMETHEUS_ENABLED: 'prometheus_enabled',
  JAEGER_ENABLED: 'jaeger_enabled',
} as const;

export type FeatureFlagKey = typeof FEATURE_FLAGS[keyof typeof FEATURE_FLAGS];

// ============================================================================
// CACHE - Sistema de cache com TTL
// ============================================================================

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Cache thread-safe com TTL para feature flags.
 * Evita queries repetitivas ao banco.
 */
class FeatureFlagCache {
  private cache = new Map<string, CacheEntry<boolean>>();
  private readonly ttlMs: number;
  
  constructor(ttlSeconds = 60) {
    this.ttlMs = ttlSeconds * 1000;
  }
  
  /**
   * Obtém valor do cache se não expirado
   */
  get(key: string, tenantId?: string): boolean | undefined {
    const cacheKey = this.buildCacheKey(key, tenantId);
    const entry = this.cache.get(cacheKey);
    
    if (!entry) {
      return undefined;
    }
    
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(cacheKey);
      return undefined;
    }
    
    return entry.value;
  }
  
  /**
   * Define valor no cache com TTL
   */
  set(key: string, value: boolean, tenantId?: string): void {
    const cacheKey = this.buildCacheKey(key, tenantId);
    this.cache.set(cacheKey, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }
  
  /**
   * Invalida cache para uma chave
   */
  invalidate(key: string, tenantId?: string): void {
    const cacheKey = this.buildCacheKey(key, tenantId);
    this.cache.delete(cacheKey);
    logger.debug({ key, tenantId }, 'Cache de feature flag invalidado');
  }
  
  /**
   * Invalida todo o cache (para atualizações em massa)
   */
  invalidateAll(): void {
    const size = this.cache.size;
    this.cache.clear();
    logger.info({ entriesCleared: size }, 'Cache de feature flags limpo');
  }
  
  /**
   * Estatísticas do cache para monitoramento
   */
  getStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
  
  private buildCacheKey(key: string, tenantId?: string): string {
    return tenantId ? `${tenantId}:${key}` : `global:${key}`;
  }
}

// Singleton do cache (TTL de 60 segundos)
const flagCache = new FeatureFlagCache(60);

// ============================================================================
// STORAGE INTERFACE - Abstração para persistência
// ============================================================================

/**
 * Interface de storage para feature flags.
 * Permite diferentes implementações (PostgreSQL, Redis, etc.)
 */
export interface FeatureFlagStorage {
  /**
   * Obtém feature flag do storage
   */
  get(key: string, tenantId?: string): Promise<FeatureFlag | null>;
  
  /**
   * Lista todas as feature flags
   */
  list(tenantId?: string): Promise<FeatureFlag[]>;
  
  /**
   * Cria ou atualiza feature flag
   */
  set(flag: CreateFeatureFlag, userId?: string): Promise<FeatureFlag>;
  
  /**
   * Remove feature flag
   */
  delete(key: string, tenantId?: string): Promise<boolean>;
}

// Storage atual (será injetado na inicialização)
let currentStorage: FeatureFlagStorage | null = null;

// ============================================================================
// CONFIGURAÇÃO PADRÃO - Valores default para produção
// ============================================================================

/**
 * Valores padrão para feature flags em produção.
 * Usado quando o storage não está disponível ou flag não existe.
 * 
 * SEGURANÇA: Por padrão, integrações são DESABILITADAS
 * até que sejam explicitamente configuradas.
 */
const DEFAULT_FLAGS: Record<FeatureFlagKey, boolean> = {
  // Integrações - DESABILITADAS por padrão (requer configuração)
  [FEATURE_FLAGS.STRIPE_ENABLED]: false,
  [FEATURE_FLAGS.WISE_ENABLED]: false,
  [FEATURE_FLAGS.ERPNEXT_ENABLED]: false,
  [FEATURE_FLAGS.TWILIO_ENABLED]: false,
  [FEATURE_FLAGS.RESEND_ENABLED]: false,
  
  // AI Features - HABILITADAS (core da plataforma)
  [FEATURE_FLAGS.IMAGE_GENERATION_ENABLED]: true,
  [FEATURE_FLAGS.RAG_ENABLED]: true,
  [FEATURE_FLAGS.CLIP_EMBEDDINGS_ENABLED]: true,
  [FEATURE_FLAGS.TRAINING_ENABLED]: true,
  
  // Autenticação - DESABILITADAS (requer OAuth configurado)
  [FEATURE_FLAGS.SAML_ENABLED]: false,
  [FEATURE_FLAGS.GOOGLE_OAUTH_ENABLED]: false,
  [FEATURE_FLAGS.GITHUB_OAUTH_ENABLED]: false,
  [FEATURE_FLAGS.MICROSOFT_OAUTH_ENABLED]: false,
  
  // Funcionalidades - HABILITADAS
  [FEATURE_FLAGS.HANDOVER_ENABLED]: true,
  [FEATURE_FLAGS.AUTO_ESCALATION_ENABLED]: true,
  [FEATURE_FLAGS.WEBSOCKET_ENABLED]: true,
  
  // Observability - HABILITADAS
  [FEATURE_FLAGS.LANGFUSE_ENABLED]: true,
  [FEATURE_FLAGS.PROMETHEUS_ENABLED]: true,
  [FEATURE_FLAGS.JAEGER_ENABLED]: true,
};

// ============================================================================
// API PÚBLICA - Funções de uso do sistema
// ============================================================================

/**
 * Inicializa o sistema de feature flags com storage.
 * Deve ser chamado na inicialização do serviço.
 */
export function initFeatureFlags(storage: FeatureFlagStorage): void {
  currentStorage = storage;
  logger.info('Sistema de feature flags inicializado');
}

/**
 * Verifica se uma feature flag está habilitada.
 * 
 * Ordem de verificação:
 * 1. Cache local (TTL 60s)
 * 2. Storage (PostgreSQL)
 * 3. Valor padrão
 * 
 * @param key - Chave da feature flag (usar FEATURE_FLAGS.*)
 * @param tenantId - ID do tenant (opcional, para flags por tenant)
 * @returns true se habilitada, false caso contrário
 * 
 * @example
 * ```typescript
 * import { isFeatureEnabled, FEATURE_FLAGS } from '@alice/shared-utils';
 * 
 * if (isFeatureEnabled(FEATURE_FLAGS.STRIPE_ENABLED)) {
 *   // Stripe está habilitado
 * }
 * ```
 */
export async function isFeatureEnabled(
  key: FeatureFlagKey,
  tenantId?: string
): Promise<boolean> {
  // 1. Verificar cache
  const cached = flagCache.get(key, tenantId);
  if (cached !== undefined) {
    return cached;
  }
  
  // 2. Verificar storage
  if (currentStorage) {
    try {
      const flag = await currentStorage.get(key, tenantId);
      if (flag) {
        flagCache.set(key, flag.enabled, tenantId);
        return flag.enabled;
      }
    } catch (error) {
      logger.warn({ key, tenantId, error }, 'Erro ao buscar feature flag do storage');
    }
  }
  
  // 3. Usar valor padrão
  const defaultValue = DEFAULT_FLAGS[key] ?? false;
  flagCache.set(key, defaultValue, tenantId);
  
  logger.debug({ key, tenantId, enabled: defaultValue }, 'Usando valor padrão de feature flag');
  return defaultValue;
}

/**
 * Versão síncrona para verificação de feature flag.
 * Usa apenas cache - para código crítico que não pode ser async.
 * 
 * ATENÇÃO: Retorna valor padrão se não estiver no cache.
 * Preferir isFeatureEnabled() quando possível.
 */
export function isFeatureEnabledSync(
  key: FeatureFlagKey,
  tenantId?: string
): boolean {
  const cached = flagCache.get(key, tenantId);
  if (cached !== undefined) {
    return cached;
  }
  
  return DEFAULT_FLAGS[key] ?? false;
}

/**
 * Define estado de uma feature flag.
 * Invalida cache automaticamente.
 */
export async function setFeatureFlag(
  flag: CreateFeatureFlag,
  userId?: string
): Promise<FeatureFlag | null> {
  if (!currentStorage) {
    logger.error('Storage não configurado - não é possível definir feature flag');
    return null;
  }
  
  try {
    const result = await currentStorage.set(flag, userId);
    flagCache.invalidate(flag.key, flag.tenantId);
    
    logger.info({
      key: flag.key,
      enabled: flag.enabled,
      tenantId: flag.tenantId,
      userId,
    }, 'Feature flag atualizada');
    
    return result;
  } catch (error) {
    logger.error({ flag, error }, 'Erro ao definir feature flag');
    return null;
  }
}

/**
 * Lista todas as feature flags.
 */
export async function listFeatureFlags(
  tenantId?: string
): Promise<FeatureFlag[]> {
  if (!currentStorage) {
    logger.warn('Storage não configurado - retornando lista vazia');
    return [];
  }
  
  try {
    return await currentStorage.list(tenantId);
  } catch (error) {
    logger.error({ tenantId, error }, 'Erro ao listar feature flags');
    return [];
  }
}

/**
 * Remove uma feature flag.
 * Invalida cache automaticamente.
 */
export async function deleteFeatureFlag(
  key: string,
  tenantId?: string
): Promise<boolean> {
  if (!currentStorage) {
    logger.error('Storage não configurado - não é possível remover feature flag');
    return false;
  }
  
  try {
    const result = await currentStorage.delete(key, tenantId);
    flagCache.invalidate(key, tenantId);
    
    logger.info({ key, tenantId }, 'Feature flag removida');
    return result;
  } catch (error) {
    logger.error({ key, tenantId, error }, 'Erro ao remover feature flag');
    return false;
  }
}

/**
 * Invalida cache de feature flags.
 * Útil após atualizações em massa.
 */
export function invalidateFeatureFlagCache(): void {
  flagCache.invalidateAll();
}

/**
 * Obtém estatísticas do cache para monitoramento.
 */
export function getFeatureFlagCacheStats(): { size: number; keys: string[] } {
  return flagCache.getStats();
}

/**
 * Obtém todos os valores padrão de feature flags.
 * Útil para documentação e inicialização.
 */
export function getDefaultFeatureFlags(): Record<FeatureFlagKey, boolean> {
  return { ...DEFAULT_FLAGS };
}

// ============================================================================
// MIDDLEWARE EXPRESS - Injeção de feature flags no request
// ============================================================================

import { Request, Response, NextFunction } from 'express';

/**
 * Extensão do Request para incluir feature flags
 */
declare global {
  namespace Express {
    interface Request {
      featureFlags?: {
        isEnabled: (key: FeatureFlagKey) => Promise<boolean>;
        isEnabledSync: (key: FeatureFlagKey) => boolean;
      };
    }
  }
}

/**
 * Middleware Express para injetar helper de feature flags no request.
 * 
 * @example
 * ```typescript
 * import { featureFlagsMiddleware, FEATURE_FLAGS } from '@alice/shared-utils';
 * 
 * app.use(featureFlagsMiddleware());
 * 
 * app.get('/api/checkout', async (req, res) => {
 *   if (!await req.featureFlags?.isEnabled(FEATURE_FLAGS.STRIPE_ENABLED)) {
 *     return res.status(503).json({ error: 'Pagamentos desabilitados' });
 *   }
 *   // ...
 * });
 * ```
 */
export function featureFlagsMiddleware() {
  return (req: Request, _res: Response, next: NextFunction) => {
    const tenantId = (req as { tenantId?: string }).tenantId;
    
    req.featureFlags = {
      isEnabled: (key: FeatureFlagKey) => isFeatureEnabled(key, tenantId),
      isEnabledSync: (key: FeatureFlagKey) => isFeatureEnabledSync(key, tenantId),
    };
    
    next();
  };
}

// ============================================================================
// GUARD FUNCTIONS - Helpers para verificação rápida
// ============================================================================

/**
 * Verifica se integração Stripe está habilitada.
 */
export async function isStripeEnabled(tenantId?: string): Promise<boolean> {
  return isFeatureEnabled(FEATURE_FLAGS.STRIPE_ENABLED, tenantId);
}

/**
 * Verifica se integração Wise está habilitada.
 */
export async function isWiseEnabled(tenantId?: string): Promise<boolean> {
  return isFeatureEnabled(FEATURE_FLAGS.WISE_ENABLED, tenantId);
}

/**
 * Verifica se integração ERPNext está habilitada.
 */
export async function isERPNextEnabled(tenantId?: string): Promise<boolean> {
  return isFeatureEnabled(FEATURE_FLAGS.ERPNEXT_ENABLED, tenantId);
}

/**
 * Verifica se integração Twilio está habilitada.
 */
export async function isTwilioEnabled(tenantId?: string): Promise<boolean> {
  return isFeatureEnabled(FEATURE_FLAGS.TWILIO_ENABLED, tenantId);
}

/**
 * Verifica se geração de imagens está habilitada.
 */
export async function isImageGenerationEnabled(tenantId?: string): Promise<boolean> {
  return isFeatureEnabled(FEATURE_FLAGS.IMAGE_GENERATION_ENABLED, tenantId);
}

/**
 * Verifica se RAG está habilitado.
 */
export async function isRAGEnabled(tenantId?: string): Promise<boolean> {
  return isFeatureEnabled(FEATURE_FLAGS.RAG_ENABLED, tenantId);
}

/**
 * Verifica se handover está habilitado.
 */
export async function isHandoverEnabled(tenantId?: string): Promise<boolean> {
  return isFeatureEnabled(FEATURE_FLAGS.HANDOVER_ENABLED, tenantId);
}
