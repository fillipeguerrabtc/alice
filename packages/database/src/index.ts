import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import pgvector from 'pgvector/pg';
import * as schema from '@alice/shared';

const { Pool } = pg;

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
// ============================================================================

export function setupGracefulShutdown(logger?: { info: (msg: string) => void; error: (obj: unknown, msg: string) => void }): void {
  if (shutdownRegistered) {
    return;
  }
  shutdownRegistered = true;
  
  const log = logger || {
    info: (msg: string) => console.log(`[database] ${msg}`),
    error: (obj: unknown, msg: string) => console.error(`[database] ${msg}`, obj),
  };
  
  const shutdown = async (signal: string) => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;
    log.info(`Recebido ${signal}, encerrando pool de conexões...`);
    
    try {
      await closeDatabase();
      log.info('Pool de conexões encerrado com sucesso');
    } catch (error) {
      log.error({ error }, 'Erro ao encerrar pool de conexões');
    }
  };
  
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
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
    });
    
    // Listener para erros de conexão (enterprise-grade)
    poolInstance.on('error', (err) => {
      console.error('[database] Erro inesperado no pool:', err.message);
    });
    
    // Registrar tipos pgvector em novas conexões (enterprise-grade)
    poolInstance.on('connect', async (client) => {
      if (!pgvectorRegistered) {
        await pgvector.registerTypes(client);
        pgvectorRegistered = true;
      }
    });
    
    dbInstance = drizzle(poolInstance, { schema });
  }
  
  return dbInstance;
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
