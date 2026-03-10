/**
 * Implementação PostgreSQL do Feature Flags Storage
 * 
 * Persistência real em PostgreSQL usando Drizzle ORM.
 * Suporta multi-tenant com isolamento por tenant_id.
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 * 
 * @module @alice/shared-utils/feature-flags-storage
 */

import { createLogger } from './logger.js';
import { 
  FeatureFlagStorage, 
  FeatureFlag, 
  CreateFeatureFlag
} from './feature-flags.js';

const logger = createLogger('feature-flags-storage');

// ============================================================================
// TIPOS PARA O DRIZZLE
// ============================================================================

/**
 * Interface do resultado do banco de dados.
 * Compatível com a tabela feature_flags do schema.ts.
 */
interface FeatureFlagRow {
  id: string;
  tenantId: string | null;
  key: string;
  enabled: boolean;
  description: string | null;
  metadata: Record<string, unknown> | null;
  createdBy: string | null;
  updatedBy: string | null;
  criadoEm: Date | null;
  atualizadoEm: Date | null;
}

/**
 * Interface para operações de banco de dados.
 * Implementação agnóstica - pode ser Drizzle ou outro ORM.
 */
export interface DatabaseOperations {
  /**
   * Busca uma feature flag pelo key e tenantId
   */
  findFeatureFlag(key: string, tenantId?: string): Promise<FeatureFlagRow | null>;
  
  /**
   * Lista todas as feature flags (opcionalmente filtrado por tenant)
   */
  listFeatureFlags(tenantId?: string): Promise<FeatureFlagRow[]>;
  
  /**
   * Cria ou atualiza uma feature flag (upsert)
   */
  upsertFeatureFlag(data: {
    key: string;
    enabled: boolean;
    description?: string | null;
    tenantId?: string | null;
    metadata?: Record<string, unknown> | null;
    createdBy?: string | null;
    updatedBy?: string | null;
  }): Promise<FeatureFlagRow>;
  
  /**
   * Remove uma feature flag
   */
  deleteFeatureFlag(key: string, tenantId?: string): Promise<boolean>;
}

// ============================================================================
// POSTGRESQL STORAGE IMPLEMENTATION
// ============================================================================

/**
 * Implementação do FeatureFlagStorage usando PostgreSQL.
 * Requer injeção de DatabaseOperations compatível com Drizzle.
 * 
 * @example
 * ```typescript
 * import { db } from './db';
 * import { featureFlags } from '@alice/shared/schema';
 * import { createPostgreSQLStorage } from '@alice/shared-utils/feature-flags-storage';
 * 
 * const dbOps: DatabaseOperations = {
 *   findFeatureFlag: async (key, tenantId) => {
 *     return db.query.featureFlags.findFirst({
 *       where: and(
 *         eq(featureFlags.key, key),
 *         tenantId ? eq(featureFlags.tenantId, tenantId) : isNull(featureFlags.tenantId)
 *       )
 *     });
 *   },
 *   // ... outras operações
 * };
 * 
 * const storage = createPostgreSQLStorage(dbOps);
 * initFeatureFlags(storage);
 * ```
 */
export function createPostgreSQLStorage(dbOps: DatabaseOperations): FeatureFlagStorage {
  return {
    async get(key: string, tenantId?: string): Promise<FeatureFlag | null> {
      try {
        const row = await dbOps.findFeatureFlag(key, tenantId);
        
        if (!row) {
          return null;
        }
        
        return mapRowToFeatureFlag(row);
      } catch (error) {
        logger.error({ key, tenantId, error }, 'Erro ao buscar feature flag do PostgreSQL');
        throw error;
      }
    },
    
    async list(tenantId?: string): Promise<FeatureFlag[]> {
      try {
        const rows = await dbOps.listFeatureFlags(tenantId);
        return rows.map(mapRowToFeatureFlag);
      } catch (error) {
        logger.error({ tenantId, error }, 'Erro ao listar feature flags do PostgreSQL');
        throw error;
      }
    },
    
    async set(flag: CreateFeatureFlag, userId?: string): Promise<FeatureFlag> {
      try {
        const row = await dbOps.upsertFeatureFlag({
          key: flag.key,
          enabled: flag.enabled,
          description: flag.description,
          tenantId: flag.tenantId,
          metadata: flag.metadata,
          createdBy: userId,
          updatedBy: userId,
        });
        
        logger.info({
          key: flag.key,
          enabled: flag.enabled,
          tenantId: flag.tenantId,
          userId,
        }, 'Feature flag persistida no PostgreSQL');
        
        return mapRowToFeatureFlag(row);
      } catch (error) {
        logger.error({ flag, error }, 'Erro ao persistir feature flag no PostgreSQL');
        throw error;
      }
    },
    
    async delete(key: string, tenantId?: string): Promise<boolean> {
      try {
        const deleted = await dbOps.deleteFeatureFlag(key, tenantId);
        
        if (deleted) {
          logger.info({ key, tenantId }, 'Feature flag removida do PostgreSQL');
        }
        
        return deleted;
      } catch (error) {
        logger.error({ key, tenantId, error }, 'Erro ao remover feature flag do PostgreSQL');
        throw error;
      }
    },
  };
}

/**
 * Converte row do banco para FeatureFlag
 */
function mapRowToFeatureFlag(row: FeatureFlagRow): FeatureFlag {
  return {
    key: row.key,
    enabled: row.enabled,
    description: row.description ?? undefined,
    tenantId: row.tenantId ?? undefined,
    createdAt: row.criadoEm ?? undefined,
    updatedAt: row.atualizadoEm ?? undefined,
    createdBy: row.createdBy ?? undefined,
    metadata: row.metadata ?? undefined,
  };
}

// ============================================================================
// HELPER: Criar DatabaseOperations com Drizzle
// ============================================================================

/**
 * Tipos para integração com Drizzle.
 * Usados internamente para criar as operações de banco.
 */
export interface DrizzleDB {
  select: () => unknown;
  insert: (table: unknown) => { values: (data: unknown) => { onConflictDoUpdate: (opts: unknown) => { returning: () => Promise<unknown[]> } } };
  delete: (table: unknown) => { where: (condition: unknown) => Promise<{ rowCount: number }> };
  query: {
    featureFlags: {
      findFirst: (opts: { where: unknown }) => Promise<FeatureFlagRow | null>;
      findMany: (opts: { where: unknown }) => Promise<FeatureFlagRow[]>;
    };
  };
}

/**
 * Cria DatabaseOperations a partir de um client Drizzle.
 * Função helper para simplificar a integração.
 * 
 * NOTA: Esta função espera que featureFlags seja passado como parâmetro
 * para evitar dependência circular.
 */
export function createDrizzleOperations(
  db: DrizzleDB,
  featureFlagsTable: unknown,
  operators: {
    eq: (col: unknown, val: unknown) => unknown;
    and: (...args: unknown[]) => unknown;
    isNull: (col: unknown) => unknown;
  }
): DatabaseOperations {
  const { eq, and, isNull } = operators;
  const table = featureFlagsTable as Record<string, unknown>;
  
  return {
    async findFeatureFlag(key: string, tenantId?: string): Promise<FeatureFlagRow | null> {
      const whereCondition = tenantId
        ? and(eq(table.key, key), eq(table.tenantId, tenantId))
        : and(eq(table.key, key), isNull(table.tenantId));
      
      return db.query.featureFlags.findFirst({
        where: whereCondition,
      });
    },
    
    async listFeatureFlags(tenantId?: string): Promise<FeatureFlagRow[]> {
      const whereCondition = tenantId
        ? eq(table.tenantId, tenantId)
        : isNull(table.tenantId);
      
      return db.query.featureFlags.findMany({
        where: whereCondition,
      });
    },
    
    async upsertFeatureFlag(data): Promise<FeatureFlagRow> {
      const result = await db
        .insert(featureFlagsTable)
        .values({
          key: data.key,
          enabled: data.enabled,
          description: data.description,
          tenantId: data.tenantId,
          metadata: data.metadata,
          createdBy: data.createdBy,
          updatedBy: data.updatedBy,
          atualizadoEm: new Date(),
        })
        .onConflictDoUpdate({
          target: data.tenantId
            ? [table.key, table.tenantId]
            : [table.key],
          set: {
            enabled: data.enabled,
            description: data.description,
            metadata: data.metadata,
            updatedBy: data.updatedBy,
            atualizadoEm: new Date(),
          },
        })
        .returning();
      
      return result[0] as FeatureFlagRow;
    },
    
    async deleteFeatureFlag(key: string, tenantId?: string): Promise<boolean> {
      const whereCondition = tenantId
        ? and(eq(table.key, key), eq(table.tenantId, tenantId))
        : and(eq(table.key, key), isNull(table.tenantId));
      
      const result = await db
        .delete(featureFlagsTable)
        .where(whereCondition);
      
      return (result as { rowCount: number }).rowCount > 0;
    },
  };
}
