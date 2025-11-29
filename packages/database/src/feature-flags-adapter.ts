/**
 * Adaptador Drizzle para Feature Flags Storage
 * 
 * Implementação concreta que conecta o sistema de feature flags
 * ao PostgreSQL via Drizzle ORM com suporte a RLS multi-tenant.
 * 
 * Documentação em PT-BR (Regra 10 replit.md)
 * 
 * @module @alice/database/feature-flags-adapter
 */

import { eq, and, isNull } from 'drizzle-orm';
import { getDatabase, withTenantContext, withSuperAdminContext, schema } from './index.js';

const { featureFlags } = schema;

// ============================================================================
// TIPOS LOCAIS (evita dependência circular com shared-utils)
// ============================================================================

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  description?: string;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
  createdBy?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateFeatureFlag {
  key: string;
  enabled: boolean;
  description?: string;
  tenantId?: string;
  metadata?: Record<string, unknown>;
}

export interface FeatureFlagStorage {
  get(key: string, tenantId?: string): Promise<FeatureFlag | null>;
  list(tenantId?: string): Promise<FeatureFlag[]>;
  set(flag: CreateFeatureFlag, userId?: string): Promise<FeatureFlag>;
  delete(key: string, tenantId?: string): Promise<boolean>;
}

// ============================================================================
// TIPOS
// ============================================================================

type FeatureFlagRow = typeof featureFlags.$inferSelect;

// ============================================================================
// HELPER: Mapear row do banco para FeatureFlag
// ============================================================================

function mapRowToFeatureFlag(row: FeatureFlagRow): FeatureFlag {
  return {
    key: row.key,
    enabled: row.enabled,
    description: row.description ?? undefined,
    tenantId: row.tenantId ?? undefined,
    createdAt: row.criadoEm ?? undefined,
    updatedAt: row.atualizadoEm ?? undefined,
    createdBy: row.createdBy ?? undefined,
    metadata: (row.metadata as Record<string, unknown>) ?? undefined,
  };
}

// ============================================================================
// IMPLEMENTAÇÃO DO STORAGE POSTGRESQL
// ============================================================================

/**
 * Cria storage de feature flags usando PostgreSQL via Drizzle.
 * Suporta isolamento multi-tenant via RLS.
 * 
 * @param useTenantContext - Se true, usa withTenantContext para RLS
 * @returns FeatureFlagStorage implementação
 * 
 * @example
 * ```typescript
 * import { createDrizzleFeatureFlagStorage } from '@alice/database/feature-flags-adapter';
 * import { initFeatureFlags } from '@alice/shared-utils';
 * 
 * // No início do serviço
 * const storage = createDrizzleFeatureFlagStorage();
 * initFeatureFlags(storage);
 * ```
 */
export function createDrizzleFeatureFlagStorage(): FeatureFlagStorage {
  return {
    async get(key: string, tenantId?: string): Promise<FeatureFlag | null> {
      const db = getDatabase();
      
      const whereCondition = tenantId
        ? and(eq(featureFlags.key, key), eq(featureFlags.tenantId, tenantId))
        : and(eq(featureFlags.key, key), isNull(featureFlags.tenantId));
      
      const row = await db.query.featureFlags.findFirst({
        where: whereCondition,
      });
      
      if (!row) {
        return null;
      }
      
      return mapRowToFeatureFlag(row);
    },
    
    async list(tenantId?: string): Promise<FeatureFlag[]> {
      const db = getDatabase();
      
      // Para listagem, incluir flags globais (tenantId = null) e do tenant específico
      const rows = await db.query.featureFlags.findMany({
        where: tenantId
          ? eq(featureFlags.tenantId, tenantId)
          : isNull(featureFlags.tenantId),
      });
      
      return rows.map(mapRowToFeatureFlag);
    },
    
    async set(flag: CreateFeatureFlag, userId?: string): Promise<FeatureFlag> {
      const db = getDatabase();
      
      const now = new Date();
      
      // Tentar atualizar primeiro
      const existing = await this.get(flag.key, flag.tenantId);
      
      if (existing) {
        // Update
        const whereCondition = flag.tenantId
          ? and(eq(featureFlags.key, flag.key), eq(featureFlags.tenantId, flag.tenantId))
          : and(eq(featureFlags.key, flag.key), isNull(featureFlags.tenantId));
        
        const [updated] = await db
          .update(featureFlags)
          .set({
            enabled: flag.enabled,
            description: flag.description,
            metadata: flag.metadata ?? {},
            updatedBy: userId ?? null,
            atualizadoEm: now,
          })
          .where(whereCondition)
          .returning();
        
        return mapRowToFeatureFlag(updated);
      } else {
        // Insert
        const [inserted] = await db
          .insert(featureFlags)
          .values({
            key: flag.key,
            enabled: flag.enabled,
            description: flag.description ?? null,
            tenantId: flag.tenantId ?? null,
            metadata: flag.metadata ?? {},
            createdBy: userId ?? null,
            updatedBy: userId ?? null,
            criadoEm: now,
            atualizadoEm: now,
          })
          .returning();
        
        return mapRowToFeatureFlag(inserted);
      }
    },
    
    async delete(key: string, tenantId?: string): Promise<boolean> {
      const db = getDatabase();
      
      const whereCondition = tenantId
        ? and(eq(featureFlags.key, key), eq(featureFlags.tenantId, tenantId))
        : and(eq(featureFlags.key, key), isNull(featureFlags.tenantId));
      
      const result = await db
        .delete(featureFlags)
        .where(whereCondition);
      
      // Drizzle retorna array vazio se nada foi deletado
      return (result as unknown as { rowCount?: number }).rowCount !== 0;
    },
  };
}

// ============================================================================
// VERSÃO COM TENANT CONTEXT (para uso com RLS)
// ============================================================================

/**
 * Cria storage com suporte a tenant context para RLS.
 * Usa withTenantContext para garantir isolamento.
 */
export function createDrizzleFeatureFlagStorageWithRLS(): FeatureFlagStorage {
  const baseStorage = createDrizzleFeatureFlagStorage();
  
  return {
    async get(key: string, tenantId?: string): Promise<FeatureFlag | null> {
      if (tenantId) {
        return withTenantContext(tenantId, false, async () => {
          return baseStorage.get(key, tenantId);
        });
      }
      // Flags globais: usar super admin context
      return withSuperAdminContext(async () => {
        return baseStorage.get(key, tenantId);
      });
    },
    
    async list(tenantId?: string): Promise<FeatureFlag[]> {
      if (tenantId) {
        return withTenantContext(tenantId, false, async () => {
          return baseStorage.list(tenantId);
        });
      }
      return withSuperAdminContext(async () => {
        return baseStorage.list(tenantId);
      });
    },
    
    async set(flag: CreateFeatureFlag, userId?: string): Promise<FeatureFlag> {
      if (flag.tenantId) {
        return withTenantContext(flag.tenantId, false, async () => {
          return baseStorage.set(flag, userId);
        });
      }
      return withSuperAdminContext(async () => {
        return baseStorage.set(flag, userId);
      });
    },
    
    async delete(key: string, tenantId?: string): Promise<boolean> {
      if (tenantId) {
        return withTenantContext(tenantId, false, async () => {
          return baseStorage.delete(key, tenantId);
        });
      }
      return withSuperAdminContext(async () => {
        return baseStorage.delete(key, tenantId);
      });
    },
  };
}
