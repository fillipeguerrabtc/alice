import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import pgvector from 'pgvector/pg';
import * as schema from '@alice/shared';
import { createLogger } from '@alice/logger';

const { Pool } = pg;

// Logger singleton do módulo (Regra 8 CLAUDE.md - Pino obrigatório)
const logger = createLogger('database');

let dbInstance: NodePgDatabase<typeof schema> | null = null;
let poolInstance: pg.Pool | null = null;
let pgvectorRegistered = false;
let shutdownRegistered = false;
let isShuttingDown = false;

// ============================================================================
// TESTING UTILITIES (Enterprise-Grade - Dependency Injection)
// Permite injeção de pool mockado para testes sem afetar API pública
// ============================================================================

/**
 * Injetar pool para testes unitários
 * APENAS para uso em testes - não usar em código de produção
 * 
 * @internal
 */
export function _setPoolForTesting(mockPool: pg.Pool | null): void {
  poolInstance = mockPool;
}

/**
 * Definir estado de shutdown para testes
 * APENAS para uso em testes - não usar em código de produção
 * 
 * @internal
 */
export function _setShuttingDownForTesting(value: boolean): void {
  isShuttingDown = value;
}

/**
 * Resetar estado interno para testes
 * APENAS para uso em testes - não usar em código de produção
 * 
 * @internal
 */
export function _resetForTesting(): void {
  poolInstance = null;
  dbInstance = null;
  isShuttingDown = false;
  pgvectorRegistered = false;
  shutdownRegistered = false;
}

// ============================================================================
// POOL METRICS (Enterprise-Grade - Regra 16 CLAUDE.md)
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

/**
 * Verificar saúde do pool PostgreSQL com timeout
 * 
 * Usa pool.query() diretamente (auto-gerencia conexões sem vazamento).
 * Enterprise-grade: fail-fast em produção se DB estiver lento.
 * 
 * IMPORTANTE: Usa pool.query() em vez de pool.connect() para evitar
 * vazamento de conexões quando timeout ocorre antes do connect completar.
 * pool.query() auto-libera a conexão ao pool após completar.
 * 
 * Rejeições tardias são capturadas para evitar unhandled rejection crashes.
 * 
 * @param timeoutMs - Timeout em ms para a operação completa (default: 2000ms)
 * @returns Promise<boolean> - true se pool saudável, false caso contrário
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */
export async function isPoolHealthy(timeoutMs = 2000): Promise<boolean> {
  if (!poolInstance || isShuttingDown) {
    // Estado esperado em testes e durante startup/shutdown. Não é warning operacional.
    logger.debug({ hasPool: !!poolInstance, isShuttingDown }, 'isPoolHealthy: pool não inicializado ou em shutdown');
    return false;
  }
  
  // Usar AbortController pattern para gerenciar timeout
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  
  // Promise da query com catch para evitar unhandled rejections
  const queryPromise = poolInstance.query('SELECT 1')
    .then(() => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      logger.debug('Pool de conexões saudável');
      return true;
    })
    .catch((error: Error) => {
      // Capturar rejeição para evitar crash por unhandled rejection
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Healthcheck falhou: sinalizar via retorno false e log informativo (sem WARN).
      logger.info({ healthy: false, error: errorMessage }, 'Query de health check falhou');
      return false;
    });
  
  // Promise de timeout
  const timeoutPromise = new Promise<false>((resolve) => {
    timeoutId = setTimeout(() => {
      // Timeout de healthcheck: registrar como informativo (sem WARN) e retornar false.
      logger.info({ healthy: false, timeoutMs }, 'Timeout na verificação de saúde do pool');
      resolve(false);
    }, timeoutMs);
  });
  
  // Race: primeiro a resolver vence (ambos retornam boolean, sem unhandled rejections)
  return Promise.race([queryPromise, timeoutPromise]);
}

// ============================================================================
// GRACEFUL SHUTDOWN (Enterprise-Grade - Regra 16 CLAUDE.md)
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
// TENANT CONTEXT (RLS Enterprise-Grade - Regra 16 CLAUDE.md)
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
      // =======================================================================
      // CORREÇÃO PR#103 (10/01/2026): Removidos statement_timeout e 
      // idle_in_transaction_session_timeout como startup parameters
      // =======================================================================
      // PROBLEMA: PgBouncer em transaction pooling mode NÃO suporta parâmetros
      //           de sessão no startup. Erro: "unsupported startup parameter"
      //           Isso impedia TODOS os serviços Alice de conectar ao PostgreSQL.
      //
      // CAUSA RAIZ: node-postgres passa esses parâmetros via protocol startup,
      //             mas PgBouncer multiplixa conexões e rejeita session params.
      //
      // SOLUÇÃO: Remover da config do Pool. Se necessário para queries específicas,
      //          usar SET LOCAL statement_timeout = '30s' dentro da transação.
      //
      // REF: https://www.pgbouncer.org/faq.html#how-to-use-prepared-statements-with-transaction-pooling
      // REF: CLAUDE.md Regra 7 (Diagnóstico de causa raiz)
      // =======================================================================
    });
    
    // CORREÇÃO 31/12/2025: Listener para erros de conexão (enterprise-grade)
    // Melhorado para capturar mais detalhes úteis para debug
    poolInstance.on('error', (err: Error & { code?: string; detail?: string; hint?: string; position?: string }) => {
      logger.error({
        error: {
          message: err.message,
          code: err.code,
          detail: err.detail,
          hint: err.hint,
          stack: err.stack,
        },
        pool: {
          totalConnections: poolInstance?.totalCount,
          idleConnections: poolInstance?.idleCount,
          waitingClients: poolInstance?.waitingCount,
        },
      }, 'Erro inesperado no pool de conexões PostgreSQL');
    });

    // CORREÇÃO 31/12/2025: Log de conexão removida do pool (debug de vazamento)
    poolInstance.on('remove', () => {
      logger.debug({
        pool: {
          totalConnections: poolInstance?.totalCount,
          idleConnections: poolInstance?.idleCount,
          waitingClients: poolInstance?.waitingCount,
        },
      }, 'Conexão removida do pool');
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

// ============================================================================
// CONNECT WITH RETRY (Enterprise-Grade - Regra 16 CLAUDE.md)
// ============================================================================
// Implementa retry logic com exponential backoff para conexão com PostgreSQL
// Verifica também se extensão pgvector está disponível (obrigatório)
// Usar no startup de serviços ANTES de iniciar server HTTP
// ============================================================================

export interface ConnectWithRetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  checkPgvector?: boolean;
}

/**
 * Conectar ao PostgreSQL com retry logic e exponential backoff
 * 
 * IMPORTANTE: Chamar esta função no startup do serviço ANTES de iniciar o server HTTP
 * Isso garante que o banco está pronto antes de aceitar requisições
 * 
 * @param options - Configurações de retry
 * @returns Promise<void> - Resolve quando conectado, rejeita após max retries
 * 
 * @example
 * ```typescript
 * // No startup do serviço
 * await connectWithRetry({ maxRetries: 15, checkPgvector: true });
 * app.listen(PORT);
 * ```
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */
export async function connectWithRetry(options: ConnectWithRetryOptions = {}): Promise<void> {
  const {
    maxRetries = 15,
    initialDelayMs = 1000,
    maxDelayMs = 30000,
    checkPgvector = true,
  } = options;
  
  let attempt = 0;
  let delay = initialDelayMs;
  
  while (attempt < maxRetries) {
    try {
      // Tentar obter database (cria pool se não existir)
      // _db não é usado diretamente, mas getDatabase() inicializa o pool
      const _db = getDatabase();
      
      // Verificar se conexão funciona com query simples
      const pool = getPool();
      await pool.query('SELECT 1');
      
      // Verificar se extensão pgvector está disponível (obrigatório para embeddings de imagem)
      if (checkPgvector) {
        const result = await pool.query(
          "SELECT 1 FROM pg_extension WHERE extname = 'vector'"
        );
        
        if (result.rows.length === 0) {
          throw new Error('pgvector extension not available - required for image embeddings');
        }
      }
      
      logger.info({
        attempts: attempt + 1,
        pgvectorChecked: checkPgvector,
      }, '✅ Conexão com PostgreSQL estabelecida com sucesso');
      
      return;
      
    } catch (error) {
      attempt++;
      
      if (attempt >= maxRetries) {
        logger.fatal({
          error: error instanceof Error ? error.message : String(error),
          attempts: attempt,
          maxRetries,
        }, '❌ FATAL: Falha ao conectar ao PostgreSQL após máximo de tentativas');
        throw error;
      }
      
      logger.warn({
        error: error instanceof Error ? error.message : String(error),
        attempt,
        maxRetries,
        nextRetryMs: delay,
      }, `⚠️ Conexão com PostgreSQL falhou, tentando novamente... (${attempt}/${maxRetries})`);
      
      // Aguardar com exponential backoff
      await new Promise(resolve => setTimeout(resolve, delay));
      
      // Exponential backoff com cap
      delay = Math.min(delay * 2, maxDelayMs);
    }
  }
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
// RE-EXPORTS DO DRIZZLE-ORM (Singleton Pattern - Regra 16 CLAUDE.md)
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

// Dimensões dos embeddings (conforme CLAUDE.md)
// ARQUITETURA ENTERPRISE (17/12/2025):
// - Texto: Qwen3-Embedding-0.6B (1024 dim) → Qdrant
// - Imagem: OpenCLIP ViT-H/14 (1024 dim) → pgvector
export const EMBEDDING_DIMENSIONS = {
  TEXT: 1024,    // Qwen3-Embedding-0.6B (GPU Manager Service - Hetzner GEX44) → Qdrant
  CLIP: 1024,    // OpenCLIP ViT-H/14 (GPU Manager Service - Hetzner GEX44) → pgvector
} as const;

/**
 * Valida dimensão de embedding antes de salvar no database/Qdrant
 * Lança erro se dimensão estiver incorreta (enterprise-grade - Regra 6)
 * 
 * @param embedding - Array de números representando o embedding
 * @param expectedDim - Dimensão esperada (1024 para TEXT/Qdrant, 1024 para CLIP/pgvector)
 * @param type - Tipo de embedding ('TEXT' ou 'CLIP') para mensagem de erro
 * @throws Error se dimensão estiver incorreta
 * 
 * ARQUITETURA ENTERPRISE (17/12/2025):
 * - TEXT: Qwen3-Embedding-0.6B (1024 dim) → Qdrant
 * - CLIP: OpenCLIP ViT-H/14 (1024 dim) → pgvector
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */
export function validateEmbeddingDimension(
  embedding: number[] | null | undefined,
  expectedDim: number = EMBEDDING_DIMENSIONS.TEXT,
  type: 'TEXT' | 'CLIP' = 'TEXT'
): void {
  if (!embedding || embedding.length === 0) {
    throw new Error(`Embedding ${type} vazio ou nulo não pode ser salvo`);
  }
  
  const storage = type === 'TEXT' ? 'Qdrant' : 'pgvector';
  if (embedding.length !== expectedDim) {
    throw new Error(
      `Embedding ${type} com dimensão incorreta: ${embedding.length} (esperado: ${expectedDim}). ` +
      `Isso causará erro no ${storage}. Verifique o serviço de embeddings GPU.`
    );
  }
  
  // Validar que todos os valores são números válidos
  for (let i = 0; i < embedding.length; i++) {
    if (typeof embedding[i] !== 'number' || !isFinite(embedding[i])) {
      throw new Error(
        `Embedding ${type} contém valor inválido na posição ${i}: ${embedding[i]}. ` +
        `Todos os valores devem ser números finitos.`
      );
    }
  }
}
