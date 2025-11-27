import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import pgvector from 'pgvector/pg';
import * as schema from '@alice/shared/schema';

const { Pool } = pg;

let dbInstance: NodePgDatabase<typeof schema> | null = null;
let poolInstance: pg.Pool | null = null;
let pgvectorRegistered = false;

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
