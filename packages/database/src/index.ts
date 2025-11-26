import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '@alice/shared/schema';

const { Pool } = pg;

let dbInstance: NodePgDatabase<typeof schema> | null = null;
let poolInstance: pg.Pool | null = null;

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
