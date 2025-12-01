import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import pgvector from 'pgvector/pg';
import * as schema from '@alice/shared';
import { createLogger } from '@alice/logger';

const { Pool } = pg;

// Logger singleton do módulo (Regra 8 replit.md - Pino obrigatório)
const logger = createLogger('database');

let dbInstance: NodePgDatabase<typeof schema> | null = null;
let poolInstance: pg.Pool | null = null;
let pgvectorRegistered = false;
let shutdownRegistered = false;
let isShuttingDown = false;

// ============================================================================
// POOL METRICS (Enterprise-Grade - Regra 16 replit.md)
// ============================================================================

export interface PoolMetrics {
  totalConnections: number;
  idleConnections: number;
  waitingClients: number;
  maxConnections: number;
  isHealthy: boolean;
  isShuttingDown: boolean;
}

export function getPoolMetrics(): PoolMetrics {
  if (!poolInstance) {
    return {
      totalConnections: 0,
      idleConnections: 0,
      waitingClients: 0,
      maxConnections: 0,
      isHealthy: false,
      isShuttingDown,
    };
  }
  
  return {
    totalConnections: poolInstance.totalCount,
    idleConnections: poolInstance.idleCount,
    waitingClients: poolInstance.waitingCount,
    maxConnections: 10,
    isHealthy: !isShuttingDown && poolInstance.totalCount > 0,
    isShuttingDown,
  };
}

export async function isPoolHealthy(): Promise<boolean> {
  if (!poolInstance || isShuttingDown) {
    return false;
  }
  
  try {
    const client = await poolInstance.connect();
    await client.query('SELECT 1');
    client.release();
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// GRACEFUL SHUTDOWN (Enterprise-Grade - Regra 16 replit.md)
// Refatorado para usar ShutdownManager centralizado (elimina duplicação de listeners)
// ============================================================================


/**
 * Função de shutdown do pool de conexões
 * Usada pelo ShutdownManager para encerrar conexões de forma ordenada
 */
export async function closeDatabasePool(): Promise<void> {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  logger.info('Encerrando pool de conexões...');
  
  try {
    await closeDatabase();
    logger.info('Pool de conexões encerrado com sucesso');
  } catch (error) {
    logger.error({ error }, 'Erro ao encerrar pool de conexões');
    throw error;
  }
}

/**
 * Configurar logger para shutdown do database
 * NOTA: Esta função NÃO registra process handlers (usar ShutdownManager)
 * 
 * @deprecated Use registerShutdownCallback() do @alice/shared-utils em vez disso
 */
export function setupGracefulShutdown(): void {
  if (shutdownRegistered) {
    return;
  }
  shutdownRegistered = true;
  
  logger.info('Database pool configurado para graceful shutdown (use ShutdownManager para registrar callbacks)');
}

// ============================================================================
// TENANT CONTEXT (RLS Enterprise-Grade - Regra 16 replit.md)
// Implementação segura sem SQL injection, usando parameterized queries
// ============================================================================

// Validação UUID para prevenir SQL injection (OWASP API1)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUUID(value: string): boolean {
  return UUID_REGEX.test(value);
}

function sanitizeTenantId(tenantId: string | null): string {
  if (!tenantId) return '';
  if (!isValidUUID(tenantId)) {
    throw new Error(`[database] Tenant ID inválido: formato UUID esperado`);
  }
  return tenantId;
}

export function getDatabase(): NodePgDatabase<typeof schema> {
  if (!dbInstance) {
    const connectionString = process.env.DATABASE_URL;
    
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is required');
    }
    
    poolInstance = new Pool({ 
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      // Enterprise-Grade: statement_timeout padrão de 30s para prevenir queries runaway
      // Pode ser overriden por query específica via SET LOCAL
      statement_timeout: 30000,
      // Enterprise-Grade: idle_in_transaction_session_timeout para prevenir transações órfãs
      // Fecha conexões que ficam idle em transação por mais de 60s (PostgreSQL 2025 best practice)
      idle_in_transaction_session_timeout: 60000,
    });
    
    // Listener para erros de conexão (enterprise-grade)
    poolInstance.on('error', (err: Error) => {
      logger.error({ error: err.message }, 'Erro inesperado no pool');
    });
    
    // Registrar tipos pgvector em novas conexões (enterprise-grade)
    poolInstance.on('connect', async (client: pg.PoolClient) => {
      if (!pgvectorRegistered) {
        await pgvector.registerTypes(client);
        pgvectorRegistered = true;
      }
    });
    
    dbInstance = drizzle(poolInstance, { schema });
  }
  
  return dbInstance;
}

// ============================================================================
// FUNÇÃO PARA EXECUTAR QUERY COM CONTEXTO DE TENANT (RLS)
// Usa conexão dedicada com GUCs configurados via SET LOCAL (transação-scoped)
// Previne SQL injection via validação UUID
// ============================================================================

export async function withTenantContext<T>(
  tenantId: string | null,
  isSuperAdmin: boolean,
  fn: (db: NodePgDatabase<typeof schema>) => Promise<T>
): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  
  try {
    // Validar e sanitizar tenant ID para prevenir SQL injection
    const safeTenantId = sanitizeTenantId(tenantId);
    const safeIsSuperAdmin = isSuperAdmin === true ? 'true' : 'false';
    
    // Iniciar transação para usar SET LOCAL (escopo de transação)
    await client.query('BEGIN');
    
    // Configurar contexto RLS usando SET LOCAL (valores só válidos nesta transação)
    // Usa format() do PostgreSQL para escapar valores corretamente
    await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [safeTenantId]);
    await client.query(`SELECT set_config('app.is_super_admin', $1, true)`, [safeIsSuperAdmin]);
    
    // Criar instância Drizzle dedicada para esta conexão
    const tenantDb = drizzle(client, { schema });
    
    // Executar função com DB tenant-scoped
    const result = await fn(tenantDb);
    
    // Commit da transação
    await client.query('COMMIT');
    
    return result;
  } catch (error) {
    // Rollback em caso de erro
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    // Liberar conexão de volta para o pool
    client.release();
  }
}

// ============================================================================
// HELPER PARA CONTEXTO SUPER ADMIN (bypass RLS)
// ============================================================================

export async function withSuperAdminContext<T>(
  fn: (db: NodePgDatabase<typeof schema>) => Promise<T>
): Promise<T> {
  return withTenantContext(null, true, fn);
}

export function getPool(): pg.Pool {
  if (!poolInstance) {
    getDatabase();
  }
  return poolInstance!;
}

export async function closeDatabase(): Promise<void> {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = null;
    dbInstance = null;
  }
}

export { schema };
export type Database = NodePgDatabase<typeof schema>;

// ============================================================================
// RE-EXPORTS DO DRIZZLE-ORM (Singleton Pattern - Regra 16 replit.md)
// Todos os microsserviços DEVEM usar estas funções via @alice/database
// para garantir uma única instância do drizzle-orm no monorepo
// ============================================================================
export { 
  eq, 
  and, 
  or, 
  not, 
  desc, 
  asc, 
  sql, 
  isNull, 
  isNotNull,
  inArray,
  notInArray,
  between,
  like,
  ilike,
  gt,
  gte,
  lt,
  lte,
  ne,
  count,
  sum,
  avg,
  min,
  max,
} from 'drizzle-orm';

export type { SQL, InferSelectModel, InferInsertModel } from 'drizzle-orm';

// Feature Flags Storage Adapter
export { 
  createDrizzleFeatureFlagStorage, 
  createDrizzleFeatureFlagStorageWithRLS 
} from './feature-flags-adapter.js';

// ============================================================================
// PGVECTOR UTILITIES (Enterprise-Grade)
// ============================================================================
// Converte array de números para formato SQL pgvector
// Uso: toSql([0.1, 0.2, ...]) -> string compatível com vector type
export const toSql = pgvector.toSql;

// Dimensões dos embeddings (conforme replit.md)
export const EMBEDDING_DIMENSIONS = {
  TEXT: 1536,   // text-embedding-3-small via Salad Cloud
  CLIP: 768,    // CLIP ViT-L/14 via Salad Cloud
} as const;
