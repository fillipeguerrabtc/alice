/**
 * Backup Orchestrator - Alice Enterprise Platform
 * 
 * Sistema unificado de backup e restore para toda a plataforma.
 * Coordena backups de PostgreSQL (pgBackRest), Redis (RDB) e
 * Qdrant com manifesto único.
 * 
 * STORAGE: Volume Local Hetzner (/opt/alice/backups) - SEM S3 EXTERNO
 * Os uploads de mídia são armazenados em /opt/alice/uploads (Volume local)
 * e NÃO são incluídos no backup automatizado (responsabilidade do admin).
 * 
 * Arquitetura: Orchestrator que dispara jobs em sequência com checkpoints
 * e validações - best practice enterprise 2025.
 * 
 * Regra 6: Enterprise-grade (sem workarounds) - Estado persistido em PostgreSQL
 * Regra 8: TypeScript strict, zero any, Pino
 * Regra 10: Documentação PT-BR
 * Regra 11: Seguir docs oficiais pgBackRest e Redis
 * Regra 16: Circuit breakers, health checks
 * 
 * ATUALIZADO: Migrado de in-memory para PostgreSQL (REGRA 6 COMPLIANCE)
 * ATUALIZADO: Removido S3 externo - 100% volume local (05/12/2025)
 * 
 * Autor: Fillipe Guerra
 * Data: 05 de Dezembro de 2025
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, mkdir, readdir, stat, statfs, copyFile } from 'fs/promises';
import { existsSync } from 'fs';
import type { Dirent } from 'fs';
import path from 'node:path';
import crypto from 'crypto';
import { z } from 'zod';
import { getDatabase, schema, eq, desc } from '@alice/database';
import { createLogger } from '@alice/logger';
import type { BackupComponentDetail, BackupManifestData, BackupJob } from '@alice/shared';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// CORREÇÃO AUDITORIA 17/12/2025: Usar createLogger padronizado (Regra 2 - Não Duplicar)
const logger = createLogger('backup-orchestrator');

// =============================================================================
// TIPOS E INTERFACES (TypeScript strict - Regra 8)
// =============================================================================

/** Status de cada componente no backup */
interface ComponentBackupStatus {
  component: 'postgresql' | 'redis' | 'qdrant' | 'uploads';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt?: string;
  completedAt?: string;
  durationSeconds?: number;
  size?: string;
  error?: string;
  metadata?: Record<string, string>;
}

/** Manifesto de backup unificado */
interface BackupManifest {
  id: string;
  type: 'full' | 'incremental' | 'differential';
  status: 'running' | 'completed' | 'failed' | 'partial';
  startedAt: string;
  completedAt?: string;
  durationSeconds?: number;
  totalSize?: string;
  components: {
    postgresql?: {
      status: 'completed' | 'failed' | 'skipped';
      lsn?: string;
      backupSet?: string;
      size?: string;
      walArchived?: boolean;
    };
    redis?: {
      status: 'completed' | 'failed' | 'skipped';
      rdbChecksum?: string;
      size?: string;
      backupFile?: string;
    };
    qdrant?: {
      status: 'completed' | 'failed' | 'skipped';
      snapshotName?: string;
      collections?: string[];
      snapshotFiles?: string[];
      size?: string;
    };
  };
  storage: {
    type: 'local';
    path: string;
    volumeName: string;
  };
  encryption: {
    enabled: boolean;
    algorithm?: string;
  };
  offsite?: {
    enabled: boolean;
    required: boolean;
    status: 'pending' | 'completed' | 'failed' | 'skipped';
    path?: string;
    syncedAt?: string;
    filesSynced?: number;
    verificationFile?: string;
    error?: string;
    encryption: {
      enabled: boolean;
      algorithm?: string;
    };
  };
  createdBy?: string;
  notes?: string;
}

interface OffsiteSyncedFile {
  relativePath: string;
  offsitePath: string;
  sourceSha256: string;
  offsiteSha256: string;
  sizeBytes: number;
}

interface OffsiteVerificationManifest {
  backupId: string;
  generatedAt: string;
  encryption: {
    enabled: boolean;
    algorithm?: string;
  };
  files: OffsiteSyncedFile[];
}

/** Status do job de backup em andamento (exportado para uso em testes/monitoramento) */
export interface BackupJobStatus {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: number;
  currentComponent?: string;
  components: ComponentBackupStatus[];
  manifest?: BackupManifest;
  startedAt: string;
  estimatedCompletion?: string;
}

/** Histórico de backups */
interface BackupHistory {
  manifests: BackupManifest[];
  totalCount: number;
  lastSuccessful?: BackupManifest;
  lastFailed?: BackupManifest;
}

// =============================================================================
// CONFIGURAÇÃO
// =============================================================================

const BACKUP_DIR = process.env.BACKUP_DIR || '/opt/alice/backups';
const BACKUP_DIR_RESOLVED = path.resolve(BACKUP_DIR);
const MANIFESTS_DIR = path.join(BACKUP_DIR, 'manifests');
const MANIFESTS_DIR_RESOLVED = path.resolve(MANIFESTS_DIR);
const BACKUP_ARTIFACTS_DIR = path.join(BACKUP_DIR, 'artifacts');
const BACKUP_ARTIFACTS_DIR_RESOLVED = path.resolve(BACKUP_ARTIFACTS_DIR);
const BACKUP_ID_REGEX = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,127})$/;
const BACKUP_OFFSITE_DIR = process.env.BACKUP_OFFSITE_DIR?.trim();
const BACKUP_OFFSITE_DIR_RESOLVED = BACKUP_OFFSITE_DIR ? path.resolve(BACKUP_OFFSITE_DIR) : undefined;
const BACKUP_OFFSITE_ENCRYPTION_ALGORITHM = 'aes-256-cbc';
const OFFSITE_VERIFICATION_FILE = 'offsite-verification.json';

// Containers Docker (nomes em produção)
// NOTA: POSTGRES_CONTAINER usado indiretamente via alice-pgbackrest que se conecta ao PostgreSQL
const _POSTGRES_CONTAINER = process.env.POSTGRES_CONTAINER || 'alice-postgres';
const REDIS_CONTAINER = process.env.REDIS_CONTAINER || 'alice-redis';
// NOTA: Qdrant é acessado via URL HTTP/REST, não via Docker exec
const QDRANT_URL = process.env.QDRANT_URL || 'http://alice-qdrant:6333';

// Re-exportar para uso futuro em funções de health check
export { _POSTGRES_CONTAINER as POSTGRES_CONTAINER };

// Criptografia
const BACKUP_CIPHER_PASS = process.env.BACKUP_CIPHER_PASS;

function parseBooleanEnv(rawValue: string | undefined, fallback: boolean): boolean {
  if (rawValue === undefined) return fallback;
  const normalized = rawValue.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

const BACKUP_OFFSITE_REQUIRED = parseBooleanEnv(process.env.BACKUP_OFFSITE_REQUIRED, true);
const BACKUP_OFFSITE_ENCRYPTION_REQUIRED = parseBooleanEnv(process.env.BACKUP_OFFSITE_ENCRYPTION_REQUIRED, true);

// Diretório de uploads (para informação de tamanho no dashboard)
const UPLOADS_DIR = process.env.UPLOADS_DIR || '/opt/alice/uploads';

function assertValidBackupId(backupId: string): void {
  const normalized = backupId.trim();
  if (!BACKUP_ID_REGEX.test(normalized)) {
    throw new Error('backupId inválido');
  }
  if (normalized.includes('..') || normalized.includes('/') || normalized.includes('\\')) {
    throw new Error('backupId inválido');
  }
}

function resolveBackupArtifactsDir(backupId: string): string {
  assertValidBackupId(backupId);
  const artifactsPath = path.resolve(BACKUP_ARTIFACTS_DIR, backupId);
  const artifactsPrefix = `${BACKUP_ARTIFACTS_DIR_RESOLVED}${path.sep}`;
  if (artifactsPath !== BACKUP_ARTIFACTS_DIR_RESOLVED && !artifactsPath.startsWith(artifactsPrefix)) {
    throw new Error('backupId inválido');
  }
  return artifactsPath;
}

function resolveManifestPath(backupId: string): string {
  assertValidBackupId(backupId);
  const manifestPath = path.resolve(MANIFESTS_DIR, `${backupId}.json`);
  const manifestsPrefix = `${MANIFESTS_DIR_RESOLVED}${path.sep}`;
  if (manifestPath !== MANIFESTS_DIR_RESOLVED && !manifestPath.startsWith(manifestsPrefix)) {
    throw new Error('backupId inválido');
  }
  return manifestPath;
}

function resolveOffsiteBackupDir(backupId: string): string {
  if (!BACKUP_OFFSITE_DIR_RESOLVED) {
    throw new Error('BACKUP_OFFSITE_DIR não configurado');
  }
  assertValidBackupId(backupId);
  const backupDir = path.resolve(BACKUP_OFFSITE_DIR_RESOLVED, backupId);
  const offsitePrefix = `${BACKUP_OFFSITE_DIR_RESOLVED}${path.sep}`;
  if (backupDir !== BACKUP_OFFSITE_DIR_RESOLVED && !backupDir.startsWith(offsitePrefix)) {
    throw new Error('backupId inválido');
  }
  return backupDir;
}

function assertSafeContainerName(container: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(container)) {
    throw new Error(`Container inválido: ${container}`);
  }
}

function assertSafePgBackrestSet(backupSet: string): string {
  const normalized = backupSet.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(normalized)) {
    throw new Error('backupSet inválido');
  }
  return normalized;
}

async function computeSha256FromFile(filePath: string): Promise<string> {
  const fileBuffer = await readFile(filePath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

async function listFilesRecursively(dirPath: string): Promise<string[]> {
  if (!existsSync(dirPath)) {
    return [];
  }

  const files: string[] = [];
  const queue: string[] = [dirPath];

  while (queue.length > 0) {
    const currentDir = queue.shift();
    if (!currentDir) continue;

    const entries = await readdir(currentDir, { withFileTypes: true, encoding: 'utf8' });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  return files.sort();
}

function asPortablePath(value: string): string {
  return value.split(path.sep).join('/');
}

function requireOffsiteEncryptionPassphrase(): string {
  if (!BACKUP_CIPHER_PASS || BACKUP_CIPHER_PASS.trim().length === 0) {
    throw new Error('BACKUP_CIPHER_PASS é obrigatório para backup offsite criptografado');
  }
  return BACKUP_CIPHER_PASS;
}

async function encryptFileToOffsite(sourcePath: string, destinationPath: string): Promise<void> {
  const cipherPass = requireOffsiteEncryptionPassphrase();
  await execFileAsync(
    'openssl',
    [
      'enc',
      `-${BACKUP_OFFSITE_ENCRYPTION_ALGORITHM}`,
      '-pbkdf2',
      '-salt',
      '-in',
      sourcePath,
      '-out',
      destinationPath,
      '-pass',
      'env:ALICE_BACKUP_CIPHER_PASS',
    ],
    {
      env: {
        ...process.env,
        ALICE_BACKUP_CIPHER_PASS: cipherPass,
      },
      timeout: 900000,
    },
  );
}

async function getDirectoryStats(dir: string): Promise<{ bytes: number; files: number }> {
  if (!existsSync(dir)) {
    return { bytes: 0, files: 0 };
  }
  const queue: string[] = [dir];
  let bytes = 0;
  let files = 0;

  while (queue.length > 0) {
    const currentDir = queue.shift();
    if (!currentDir) continue;

    let entries: Dirent[];
    try {
      entries = await readdir(currentDir, { withFileTypes: true, encoding: 'utf8' });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      try {
        const info = await stat(fullPath);
        bytes += info.size;
        files += 1;
      } catch {
        // Ignorar arquivos inacessíveis sem interromper cálculo agregado
      }
    }
  }

  return { bytes, files };
}

// =============================================================================
// PERSISTÊNCIA POSTGRESQL (Regra 6 - Enterprise-Grade)
// Estado de backup persistido no banco - NÃO in-memory
// =============================================================================

/**
 * Obter job de backup atual (running ou queued mais recente)
 * Regra 6: Persistência real em PostgreSQL
 */
async function getCurrentJob(): Promise<BackupJob | null> {
  try {
    const db = getDatabase();
    const jobs = await db
      .select()
      .from(schema.backupJobs)
      .where(eq(schema.backupJobs.status, 'running'))
      .orderBy(desc(schema.backupJobs.startedAt))
      .limit(1);
    
    return jobs[0] || null;
  } catch (error) {
    logger.error({ error }, 'Erro ao obter job atual do PostgreSQL');
    return null;
  }
}

/**
 * Criar novo job de backup no PostgreSQL
 */
async function createBackupJob(jobData: {
  jobId: string;
  backupType: 'full' | 'incremental' | 'differential';
  createdBy?: string;
}): Promise<BackupJob> {
  const db = getDatabase();
  const [job] = await db
    .insert(schema.backupJobs)
    .values({
      jobId: jobData.jobId,
      backupType: jobData.backupType,
      status: 'queued',
      progress: 0,
      components: [],
      startedAt: new Date(),
      createdBy: jobData.createdBy,
    })
    .returning();
  
  logger.info({ jobId: job.jobId }, 'Job de backup criado no PostgreSQL');
  return job;
}

/**
 * Atualizar status do job no PostgreSQL
 */
async function updateBackupJob(
  jobId: string, 
  updates: Partial<{
    status: 'queued' | 'running' | 'completed' | 'failed';
    progress: number;
    currentComponent: string | null;
    components: BackupComponentDetail[];
    manifest: BackupManifestData;
    totalSize: string;
    completedAt: Date;
    durationSeconds: number;
    error: string;
  }>
): Promise<BackupJob | null> {
  try {
    const db = getDatabase();
    const [updated] = await db
      .update(schema.backupJobs)
      .set({
        ...updates,
        atualizadoEm: new Date(),
      })
      .where(eq(schema.backupJobs.jobId, jobId))
      .returning();
    
    if (updated) {
      logger.debug({ jobId, updates: Object.keys(updates) }, 'Job atualizado no PostgreSQL');
    }
    return updated || null;
  } catch (error) {
    logger.error({ jobId, error }, 'Erro ao atualizar job no PostgreSQL');
    return null;
  }
}

/**
 * Obter job por ID
 * Exportado para uso em API REST e monitoramento
 */
export async function getBackupJobById(jobId: string): Promise<BackupJob | null> {
  try {
    const db = getDatabase();
    const [job] = await db
      .select()
      .from(schema.backupJobs)
      .where(eq(schema.backupJobs.jobId, jobId))
      .limit(1);
    
    return job || null;
  } catch (error) {
    logger.error({ jobId, error }, 'Erro ao obter job por ID');
    return null;
  }
}

/**
 * Listar jobs de backup do PostgreSQL
 * Exportado para uso em API REST e dashboard
 */
export async function listBackupJobs(limit = 50): Promise<BackupJob[]> {
  try {
    const db = getDatabase();
    return await db
      .select()
      .from(schema.backupJobs)
      .orderBy(desc(schema.backupJobs.startedAt))
      .limit(limit);
  } catch (error) {
    logger.error({ error }, 'Erro ao listar jobs');
    return [];
  }
}

// =============================================================================
// FUNÇÕES AUXILIARES
// =============================================================================

/** Gerar ID único para backup */
function generateBackupId(): string {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').split('.')[0];
  return `backup-${timestamp}`;
}

/** Formatar bytes para string legível */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/** Executar comando Docker exec */
async function dockerExec(container: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  assertSafeContainerName(container);
  logger.debug({ container, args }, 'Executando comando no container');
  
  try {
    const result = await execFileAsync('docker', ['exec', container, ...args], { timeout: 300000 }); // 5 min timeout
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message: string };
    logger.error({ container, args, error: err.message }, 'Erro ao executar comando no container');
    throw error;
  }
}

/** Salvar manifesto em disco */
async function saveManifest(manifest: BackupManifest): Promise<void> {
  await mkdir(MANIFESTS_DIR, { recursive: true });
  const filePath = path.join(MANIFESTS_DIR, `${manifest.id}.json`);
  await writeFile(filePath, JSON.stringify(manifest, null, 2), 'utf-8');
  logger.info({ manifestId: manifest.id, path: filePath }, 'Manifesto salvo');
}

/** Carregar manifesto do disco */
async function loadManifest(backupId: string): Promise<BackupManifest | null> {
  let filePath: string;
  try {
    filePath = resolveManifestPath(backupId);
  } catch {
    logger.warn({ backupId }, 'backupId inválido ao carregar manifesto');
    return null;
  }
  if (!existsSync(filePath)) return null;
  
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as BackupManifest;
  } catch (parseError) {
    // CORREÇÃO 17/12/2025: JSON.parse sem try/catch pode crashar serviço se arquivo corrompido
    logger.error({
      backupId,
      filePath,
      error: (parseError as Error).message,
    }, 'MANIFESTO CORROMPIDO: Falha ao parsear manifesto de backup');
    return null;
  }
}

/** Listar todos os manifestos */
async function listManifests(): Promise<BackupManifest[]> {
  if (!existsSync(MANIFESTS_DIR)) return [];
  
  const files = await readdir(MANIFESTS_DIR);
  const manifests: BackupManifest[] = [];
  
  for (const file of files) {
    if (file.endsWith('.json')) {
      try {
        const content = await readFile(path.join(MANIFESTS_DIR, file), 'utf-8');
        manifests.push(JSON.parse(content) as BackupManifest);
      } catch (parseError) {
        // CORREÇÃO 17/12/2025: JSON.parse sem try/catch pode crashar serviço se arquivo corrompido
        logger.warn({
          file,
          error: (parseError as Error).message,
        }, 'Manifesto corrompido ignorado durante listagem');
      }
    }
  }
  
  // Ordenar por data (mais recente primeiro)
  return manifests.sort((a, b) => 
    new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
}

// =============================================================================
// FUNÇÕES DE BACKUP POR COMPONENTE
// =============================================================================

/**
 * Backup PostgreSQL via pgBackRest
 * Suporta: full, differential, incremental
 * Retorna: LSN, backup set ID
 */
async function backupPostgreSQL(type: 'full' | 'diff' | 'incr'): Promise<ComponentBackupStatus> {
  const startTime = Date.now();
  const component: ComponentBackupStatus = {
    component: 'postgresql',
    status: 'running',
    startedAt: new Date().toISOString(),
  };
  
  logger.info({ type }, 'Iniciando backup PostgreSQL via pgBackRest');
  
  try {
    // Verificar se pgBackRest está disponível
    // Em produção, pgBackRest roda no container alice-pgbackrest
    const pgbackrestType = type === 'diff' ? 'diff' : type === 'incr' ? 'incr' : 'full';
    
    // Executar backup via pgBackRest (container dedicado)
    // NOTA: backupOutput capturado para logging futuro se necessário
    const { stdout: _backupOutput } = await execFileAsync(
      'docker',
      ['exec', 'alice-pgbackrest', 'pgbackrest', '--stanza=alice_prod', `--type=${pgbackrestType}`, 'backup'],
      { timeout: 1800000 } // 30 min timeout para backup full
    );
    logger.debug({ backupOutputLength: _backupOutput.length }, 'pgBackRest backup output recebido');
    
    // Obter informações do backup
    const { stdout: infoOutput } = await execFileAsync(
      'docker',
      ['exec', 'alice-pgbackrest', 'pgbackrest', 'info', '--stanza=alice_prod', '--output=json']
    );
    
    let info: Array<{ backup?: Array<{ lsn?: { start?: string }; label?: string }> }>;
    try {
      info = JSON.parse(infoOutput);
    } catch (parseError) {
      // CORREÇÃO 17/12/2025: JSON.parse sem try/catch pode crashar serviço se output inesperado
      logger.warn({
        error: (parseError as Error).message,
        outputLength: infoOutput.length,
      }, 'Falha ao parsear output do pgBackRest info - usando defaults');
      info = [];
    }
    const lastBackup = info[0]?.backup?.[0];
    
    component.status = 'completed';
    component.completedAt = new Date().toISOString();
    component.durationSeconds = Math.round((Date.now() - startTime) / 1000);
    component.metadata = {
      lsn: lastBackup?.lsn?.start || 'unknown',
      backupSet: lastBackup?.label || 'unknown',
      type: pgbackrestType,
    };
    
    logger.info({ 
      durationSeconds: component.durationSeconds,
      backupSet: component.metadata.backupSet 
    }, 'Backup PostgreSQL concluído');
    
  } catch (error) {
    const err = error as Error;
    component.status = 'failed';
    component.completedAt = new Date().toISOString();
    component.durationSeconds = Math.round((Date.now() - startTime) / 1000);
    component.error = err.message;
    
    logger.error({ error: err.message }, 'Falha no backup PostgreSQL');
  }
  
  return component;
}

/**
 * Backup Redis (RDB snapshot)
 * Retorna: checksum do RDB
 */
async function backupRedis(backupId: string): Promise<ComponentBackupStatus> {
  const startTime = Date.now();
  const component: ComponentBackupStatus = {
    component: 'redis',
    status: 'running',
    startedAt: new Date().toISOString(),
  };
  
  logger.info('Iniciando backup Redis (RDB snapshot)');
  
  try {
    // Forçar BGSAVE
    await dockerExec(REDIS_CONTAINER, ['redis-cli', 'BGSAVE']);
    
    // Aguardar BGSAVE completar
    let saving = true;
    while (saving) {
      const { stdout } = await dockerExec(REDIS_CONTAINER, ['redis-cli', 'LASTSAVE']);
      await new Promise(resolve => setTimeout(resolve, 1000));
      const { stdout: newStdout } = await dockerExec(REDIS_CONTAINER, ['redis-cli', 'LASTSAVE']);
      saving = stdout === newStdout;
    }
    
    // Copiar RDB para diretório de backup
    const backupPath = path.join(resolveBackupArtifactsDir(backupId), 'redis');
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
    const backupFile = `redis_${timestamp}.rdb`;
    
    await mkdir(backupPath, { recursive: true });
    const backupFilePath = path.join(backupPath, backupFile);
    await execFileAsync('docker', ['cp', `${REDIS_CONTAINER}:/data/dump.rdb`, backupFilePath]);
    
    // Calcular checksum
    const checksum = await computeSha256FromFile(backupFilePath);
    
    // Obter tamanho
    const stats = await stat(backupFilePath);
    
    component.status = 'completed';
    component.completedAt = new Date().toISOString();
    component.durationSeconds = Math.round((Date.now() - startTime) / 1000);
    component.size = formatBytes(stats.size);
    component.metadata = {
      rdbChecksum: checksum,
      backupFile,
      artifactRelativePath: asPortablePath(path.join('artifacts', backupId, 'redis', backupFile)),
    };
    
    logger.info({ 
      durationSeconds: component.durationSeconds,
      size: component.size,
      checksum: checksum.substring(0, 16) + '...'
    }, 'Backup Redis concluído');
    
  } catch (error) {
    const err = error as Error;
    component.status = 'failed';
    component.completedAt = new Date().toISOString();
    component.durationSeconds = Math.round((Date.now() - startTime) / 1000);
    component.error = err.message;
    
    logger.error({ error: err.message }, 'Falha no backup Redis');
  }

  return component;
}

/**
 * Backup Qdrant via API de Snapshots
 * Qdrant armazena embeddings de texto (1024 dim) críticos para RAG
 * Usa API REST: POST /collections/{collection_name}/snapshots
 * Retorna: snapshot name, collections backed up
 * 
 * ADICIONADO AUDITORIA 17/12/2025: Qdrant era o único DB sem backup
 * Embeddings de texto são críticos e não podem ser regenerados sem reprocessar documentos
 */
async function backupQdrant(backupId: string): Promise<ComponentBackupStatus> {
  const startTime = Date.now();
  const component: ComponentBackupStatus = {
    component: 'qdrant',
    status: 'running',
    startedAt: new Date().toISOString(),
  };
  
  logger.info('Iniciando backup Qdrant (snapshots de collections)');
  
  try {
    // Obter lista de collections
    const collectionsResponse = await fetch(`${QDRANT_URL}/collections`, {
      signal: AbortSignal.timeout(30000),
    });
    
    if (!collectionsResponse.ok) {
      throw new Error(`Falha ao listar collections: ${collectionsResponse.status}`);
    }
    
    const collectionsData = await collectionsResponse.json() as {
      result: { collections: Array<{ name: string }> };
    };
    const collections = collectionsData.result.collections.map(c => c.name);
    
    if (collections.length === 0) {
      logger.warn('Nenhuma collection encontrada no Qdrant');
      component.status = 'skipped';
      component.completedAt = new Date().toISOString();
      component.durationSeconds = Math.round((Date.now() - startTime) / 1000);
      component.metadata = { reason: 'Nenhuma collection' };
      return component;
    }
    
    // Criar diretório de backup
    const backupPath = path.join(resolveBackupArtifactsDir(backupId), 'qdrant');
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
    await mkdir(backupPath, { recursive: true });
    
    const snapshotNames: string[] = [];
    const snapshotFiles: string[] = [];
    let totalSize = 0;
    
    // Criar snapshot de cada collection
    for (const collectionName of collections) {
      logger.info({ collection: collectionName }, 'Criando snapshot da collection');
      
      // Criar snapshot via API
      const snapshotResponse = await fetch(
        `${QDRANT_URL}/collections/${collectionName}/snapshots`,
        {
          method: 'POST',
          signal: AbortSignal.timeout(300000), // 5 min timeout para snapshots grandes
        }
      );
      
      if (!snapshotResponse.ok) {
        logger.error({ collection: collectionName, status: snapshotResponse.status }, 'Falha ao criar snapshot');
        continue;
      }
      
      const snapshotData = await snapshotResponse.json() as {
        result: { name: string };
      };
      const snapshotName = snapshotData.result.name;
      snapshotNames.push(snapshotName);
      
      // Baixar snapshot
      const downloadResponse = await fetch(
        `${QDRANT_URL}/collections/${collectionName}/snapshots/${snapshotName}`,
        {
          signal: AbortSignal.timeout(600000), // 10 min timeout para download
        }
      );
      
      if (!downloadResponse.ok) {
        logger.error({ collection: collectionName, snapshot: snapshotName }, 'Falha ao baixar snapshot');
        continue;
      }
      
      // Salvar snapshot em arquivo
      const snapshotFileName = `${collectionName}.snapshot`;
      const snapshotFile = path.join(backupPath, snapshotFileName);
      const arrayBuffer = await downloadResponse.arrayBuffer();
      await writeFile(snapshotFile, Buffer.from(arrayBuffer));
      snapshotFiles.push(snapshotFileName);
      
      // Obter tamanho
      const stats = await stat(snapshotFile);
      totalSize += stats.size;
      
      logger.info({
        collection: collectionName,
        snapshot: snapshotName,
        size: formatBytes(stats.size),
      }, 'Snapshot da collection salvo');
      
      // Deletar snapshot do servidor Qdrant (já temos cópia local)
      await fetch(
        `${QDRANT_URL}/collections/${collectionName}/snapshots/${snapshotName}`,
        {
          method: 'DELETE',
          signal: AbortSignal.timeout(30000),
        }
      ).catch(err => {
        // Não falhar se não conseguir deletar do servidor
        logger.warn({ collection: collectionName, error: err.message }, 'Falha ao deletar snapshot do servidor');
      });
    }
    
    component.status = snapshotNames.length > 0 ? 'completed' : 'failed';
    component.completedAt = new Date().toISOString();
    component.durationSeconds = Math.round((Date.now() - startTime) / 1000);
    component.size = formatBytes(totalSize);
    component.metadata = {
      snapshotCount: snapshotNames.length.toString(),
      collections: collections.join(','),
      timestamp,
      snapshotFiles: JSON.stringify(snapshotFiles),
      artifactRelativeDir: asPortablePath(path.join('artifacts', backupId, 'qdrant')),
    };
    
    logger.info({
      durationSeconds: component.durationSeconds,
      size: component.size,
      collectionsCount: collections.length,
      snapshotsCount: snapshotNames.length,
    }, 'Backup Qdrant concluído');
    
  } catch (error) {
    const err = error as Error;
    component.status = 'failed';
    component.completedAt = new Date().toISOString();
    component.durationSeconds = Math.round((Date.now() - startTime) / 1000);
    component.error = err.message;
    
    logger.error({ error: err.message }, 'Falha no backup Qdrant');
  }
  
  return component;
}

/**
 * Obter informações do diretório de uploads (para dashboard)
 * NOTA: Uploads são armazenados em volume local, NÃO incluídos no backup automatizado
 * Admin pode fazer backup manual via rsync ou download via Dashboard
 */
async function getUploadsInfo(): Promise<{ filesCount: number; totalSize: string }> {
  try {
    if (!existsSync(UPLOADS_DIR)) {
      return { filesCount: 0, totalSize: '0 B' };
    }

    const { bytes: totalBytes, files: filesCount } = await getDirectoryStats(UPLOADS_DIR);
    return { filesCount, totalSize: formatBytes(totalBytes) };
  } catch (error) {
    logger.warn({ error }, 'Erro ao obter informações de uploads');
    return { filesCount: 0, totalSize: '0 B' };
  }
}

interface OffsiteSyncResult {
  status: 'completed' | 'failed' | 'skipped';
  syncedAt?: string;
  filesSynced?: number;
  verificationFile?: string;
  error?: string;
}

interface BackupReadinessReport {
  local: {
    manifestExists: boolean;
    redis: { status: 'ready' | 'missing' | 'checksum_mismatch' | 'skipped'; file?: string };
    qdrant: {
      status: 'ready' | 'missing' | 'skipped';
      expectedFiles: number;
      foundFiles: number;
      missingCollections: string[];
    };
  };
  offsite?: {
    configured: boolean;
    status: 'ready' | 'missing' | 'checksum_mismatch' | 'failed' | 'skipped';
    filesChecked: number;
    missingFiles: string[];
    verificationFile?: string;
    error?: string;
  };
  restoreReady: boolean;
}

async function writePostgreSqlMetadataArtifact(
  backupId: string,
  postgresql?: BackupManifest['components']['postgresql'],
): Promise<void> {
  if (!postgresql || postgresql.status !== 'completed') {
    return;
  }
  const artifactDir = resolveBackupArtifactsDir(backupId);
  const postgresDir = path.join(artifactDir, 'postgresql');
  await mkdir(postgresDir, { recursive: true });
  await writeFile(
    path.join(postgresDir, 'metadata.json'),
    JSON.stringify(
      {
        backupId,
        backupSet: postgresql.backupSet,
        lsn: postgresql.lsn,
        walArchived: postgresql.walArchived ?? false,
        exportedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf-8',
  );
}

function parseJsonStringArray(rawValue: string | undefined): string[] {
  if (!rawValue) return [];
  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0);
  } catch {
    return [];
  }
}

function buildRedisFileCandidates(manifest: BackupManifest): string[] {
  const backupId = manifest.id;
  const candidates = new Set<string>();
  const backupFile = manifest.components.redis?.backupFile;
  const backupArtifactDir = resolveBackupArtifactsDir(backupId);
  const legacyBackupDir = path.join(BACKUP_DIR, backupId, 'redis');
  const globalLegacyDir = path.join(BACKUP_DIR, 'redis');

  if (backupFile) {
    candidates.add(path.join(backupArtifactDir, 'redis', backupFile));
    candidates.add(path.join(legacyBackupDir, backupFile));
    candidates.add(path.join(globalLegacyDir, backupFile));
  }

  return [...candidates];
}

async function findMostRecentRedisDumpFile(): Promise<string | null> {
  const redisDir = path.join(BACKUP_DIR, 'redis');
  if (!existsSync(redisDir)) return null;
  const entries = await readdir(redisDir, { withFileTypes: true, encoding: 'utf8' });
  const dumps: Array<{ fullPath: string; mtimeMs: number }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.rdb')) continue;
    const fullPath = path.join(redisDir, entry.name);
    const fileStat = await stat(fullPath);
    dumps.push({ fullPath, mtimeMs: fileStat.mtimeMs });
  }
  dumps.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return dumps[0]?.fullPath ?? null;
}

async function resolveRedisBackupFilePath(manifest: BackupManifest): Promise<string | null> {
  for (const candidate of buildRedisFileCandidates(manifest)) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return findMostRecentRedisDumpFile();
}

function buildQdrantSnapshotCandidates(
  manifest: BackupManifest,
  collectionName: string,
  snapshotFileName?: string,
): string[] {
  const backupId = manifest.id;
  const candidates = new Set<string>();
  const artifactDir = resolveBackupArtifactsDir(backupId);

  if (snapshotFileName) {
    candidates.add(path.join(artifactDir, 'qdrant', snapshotFileName));
    candidates.add(path.join(BACKUP_DIR, backupId, 'qdrant', snapshotFileName));
  }

  const normalizedCollectionFile = `${collectionName}.snapshot`;
  candidates.add(path.join(artifactDir, 'qdrant', normalizedCollectionFile));
  candidates.add(path.join(BACKUP_DIR, backupId, 'qdrant', normalizedCollectionFile));

  const snapshotName = manifest.components.qdrant?.snapshotName;
  if (snapshotName) {
    candidates.add(path.join(BACKUP_DIR, 'qdrant', `${collectionName}_${snapshotName}.snapshot`));
  }

  return [...candidates];
}

function isOffsiteEnabled(): boolean {
  return Boolean(BACKUP_OFFSITE_DIR_RESOLVED);
}

async function syncBackupToOffsite(backupId: string): Promise<OffsiteSyncResult> {
  if (!isOffsiteEnabled()) {
    return { status: 'skipped' };
  }

  if (BACKUP_OFFSITE_ENCRYPTION_REQUIRED) {
    requireOffsiteEncryptionPassphrase();
  }

  if (BACKUP_OFFSITE_DIR_RESOLVED === BACKUP_DIR_RESOLVED) {
    throw new Error('BACKUP_OFFSITE_DIR deve ser diferente de BACKUP_DIR');
  }

  const offsiteBackupDir = resolveOffsiteBackupDir(backupId);
  const sourceFiles: Array<{ sourcePath: string; relativePath: string }> = [];
  const manifestPath = resolveManifestPath(backupId);
  const artifactDir = resolveBackupArtifactsDir(backupId);

  if (existsSync(manifestPath)) {
    sourceFiles.push({
      sourcePath: manifestPath,
      relativePath: asPortablePath(path.join('manifests', `${backupId}.json`)),
    });
  }

  if (existsSync(artifactDir)) {
    const artifactFiles = await listFilesRecursively(artifactDir);
    for (const filePath of artifactFiles) {
      sourceFiles.push({
        sourcePath: filePath,
        relativePath: asPortablePath(path.join('artifacts', backupId, path.relative(artifactDir, filePath))),
      });
    }
  }

  if (sourceFiles.length === 0) {
    return {
      status: 'failed',
      error: 'Nenhum artefato local encontrado para sincronização offsite',
    };
  }

  await mkdir(offsiteBackupDir, { recursive: true });

  const verificationEntries: OffsiteSyncedFile[] = [];
  for (const file of sourceFiles) {
    const sourceSha256 = await computeSha256FromFile(file.sourcePath);
    const offsiteRelativePath = BACKUP_OFFSITE_ENCRYPTION_REQUIRED
      ? `${file.relativePath}.enc`
      : file.relativePath;
    const offsitePath = path.join(offsiteBackupDir, offsiteRelativePath);
    await mkdir(path.dirname(offsitePath), { recursive: true });

    if (BACKUP_OFFSITE_ENCRYPTION_REQUIRED) {
      await encryptFileToOffsite(file.sourcePath, offsitePath);
    } else {
      await copyFile(file.sourcePath, offsitePath);
    }

    const offsiteSha256 = await computeSha256FromFile(offsitePath);
    const fileStat = await stat(file.sourcePath);
    verificationEntries.push({
      relativePath: file.relativePath,
      offsitePath: asPortablePath(path.relative(offsiteBackupDir, offsitePath)),
      sourceSha256,
      offsiteSha256,
      sizeBytes: fileStat.size,
    });
  }

  const verificationManifest: OffsiteVerificationManifest = {
    backupId,
    generatedAt: new Date().toISOString(),
    encryption: {
      enabled: BACKUP_OFFSITE_ENCRYPTION_REQUIRED,
      algorithm: BACKUP_OFFSITE_ENCRYPTION_REQUIRED ? BACKUP_OFFSITE_ENCRYPTION_ALGORITHM : undefined,
    },
    files: verificationEntries,
  };

  const verificationPath = path.join(offsiteBackupDir, OFFSITE_VERIFICATION_FILE);
  await writeFile(verificationPath, JSON.stringify(verificationManifest, null, 2), 'utf-8');

  return {
    status: 'completed',
    syncedAt: verificationManifest.generatedAt,
    filesSynced: verificationEntries.length,
    verificationFile: asPortablePath(path.relative(offsiteBackupDir, verificationPath)),
  };
}

async function verifyBackupReadiness(backupId: string, manifest: BackupManifest): Promise<BackupReadinessReport> {
  const manifestPath = resolveManifestPath(backupId);
  const localManifestExists = existsSync(manifestPath);

  let redisStatus: BackupReadinessReport['local']['redis'] = { status: 'skipped' };
  if (manifest.components.redis?.status === 'completed') {
    const redisBackupFile = await resolveRedisBackupFilePath(manifest);
    if (!redisBackupFile || !existsSync(redisBackupFile)) {
      redisStatus = { status: 'missing' };
    } else {
      const currentChecksum = await computeSha256FromFile(redisBackupFile);
      if (manifest.components.redis.rdbChecksum && currentChecksum !== manifest.components.redis.rdbChecksum) {
        redisStatus = { status: 'checksum_mismatch', file: redisBackupFile };
      } else {
        redisStatus = { status: 'ready', file: redisBackupFile };
      }
    }
  } else if (manifest.components.redis?.status === 'failed') {
    redisStatus = { status: 'missing' };
  }

  let qdrantStatus: BackupReadinessReport['local']['qdrant'] = {
    status: 'skipped',
    expectedFiles: 0,
    foundFiles: 0,
    missingCollections: [],
  };

  if (manifest.components.qdrant?.status === 'completed') {
    const collections = manifest.components.qdrant.collections ?? [];
    const snapshotFiles = manifest.components.qdrant.snapshotFiles ?? [];
    const missingCollections: string[] = [];
    let foundFiles = 0;

    for (let index = 0; index < collections.length; index += 1) {
      const collectionName = collections[index];
      const expectedSnapshotFile = snapshotFiles[index];
      const candidates = buildQdrantSnapshotCandidates(manifest, collectionName, expectedSnapshotFile);
      const existing = candidates.find(candidate => existsSync(candidate));
      if (!existing) {
        missingCollections.push(collectionName);
      } else {
        foundFiles += 1;
      }
    }

    qdrantStatus = {
      status: missingCollections.length > 0 ? 'missing' : 'ready',
      expectedFiles: collections.length,
      foundFiles,
      missingCollections,
    };
  } else if (manifest.components.qdrant?.status === 'failed') {
    qdrantStatus = {
      status: 'missing',
      expectedFiles: manifest.components.qdrant.collections?.length ?? 0,
      foundFiles: 0,
      missingCollections: manifest.components.qdrant.collections ?? [],
    };
  }

  let offsiteReport: BackupReadinessReport['offsite'] | undefined;
  if (!isOffsiteEnabled()) {
    offsiteReport = {
      configured: false,
      status: 'skipped',
      filesChecked: 0,
      missingFiles: [],
    };
  } else {
    const offsiteBackupDir = resolveOffsiteBackupDir(backupId);
    const verificationPath = path.join(offsiteBackupDir, OFFSITE_VERIFICATION_FILE);
    if (!existsSync(verificationPath)) {
      offsiteReport = {
        configured: true,
        status: 'missing',
        filesChecked: 0,
        missingFiles: [OFFSITE_VERIFICATION_FILE],
        verificationFile: OFFSITE_VERIFICATION_FILE,
      };
    } else {
      try {
        const rawVerification = await readFile(verificationPath, 'utf-8');
        const parsed = JSON.parse(rawVerification) as OffsiteVerificationManifest;
        const missingFiles: string[] = [];
        let checksumMismatch = false;
        for (const file of parsed.files) {
          const offsiteFilePath = path.join(offsiteBackupDir, file.offsitePath);
          if (!existsSync(offsiteFilePath)) {
            missingFiles.push(file.offsitePath);
            continue;
          }
          const offsiteChecksum = await computeSha256FromFile(offsiteFilePath);
          if (offsiteChecksum !== file.offsiteSha256) {
            checksumMismatch = true;
            missingFiles.push(file.offsitePath);
          }
        }
        offsiteReport = {
          configured: true,
          status: checksumMismatch ? 'checksum_mismatch' : missingFiles.length > 0 ? 'missing' : 'ready',
          filesChecked: parsed.files.length,
          missingFiles,
          verificationFile: OFFSITE_VERIFICATION_FILE,
        };
      } catch (error) {
        offsiteReport = {
          configured: true,
          status: 'failed',
          filesChecked: 0,
          missingFiles: [],
          verificationFile: OFFSITE_VERIFICATION_FILE,
          error: (error as Error).message,
        };
      }
    }
  }

  const localReady = localManifestExists
    && manifest.components.postgresql?.status !== 'failed'
    && redisStatus.status !== 'missing'
    && redisStatus.status !== 'checksum_mismatch'
    && qdrantStatus.status !== 'missing';

  const offsiteReady = !offsiteReport?.configured || offsiteReport.status === 'ready' || offsiteReport.status === 'skipped';
  const restoreReady = localReady && offsiteReady;

  return {
    local: {
      manifestExists: localManifestExists,
      redis: redisStatus,
      qdrant: qdrantStatus,
    },
    offsite: offsiteReport,
    restoreReady,
  };
}

// =============================================================================
// ORQUESTRADOR PRINCIPAL
// =============================================================================

/**
 * Executar backup unificado de toda a plataforma
 * Coordena todos os componentes em sequência com manifesto único
 * 
 * ATUALIZADO: Usa PostgreSQL para persistência (Regra 6)
 */
async function runUnifiedBackup(
  type: 'full' | 'incremental' = 'full',
  options?: { skipComponents?: string[]; notes?: string; createdBy?: string }
): Promise<BackupManifest> {
  const backupId = generateBackupId();
  const startTime = Date.now();
  
  logger.info({ backupId, type }, 'Iniciando backup unificado da plataforma');
  
  // Criar manifesto inicial
  const manifest: BackupManifest = {
    id: backupId,
    type: type === 'incremental' ? 'incremental' : 'full',
    status: 'running',
    startedAt: new Date().toISOString(),
    components: {},
    storage: {
      type: 'local',
      path: BACKUP_DIR,
      volumeName: 'alice-data',
    },
    encryption: {
      enabled: !!BACKUP_CIPHER_PASS,
      algorithm: BACKUP_CIPHER_PASS ? 'aes-256-cbc' : undefined,
    },
    createdBy: options?.createdBy,
    notes: options?.notes,
  };
  
  // Criar job no PostgreSQL (Regra 6 - Enterprise Persistence)
  await createBackupJob({
    jobId: backupId,
    backupType: type === 'incremental' ? 'incremental' : 'full',
    createdBy: options?.createdBy,
  });
  
  // Atualizar para running
  await updateBackupJob(backupId, { status: 'running' });

  await mkdir(resolveBackupArtifactsDir(backupId), { recursive: true });
  
  const skipComponents = options?.skipComponents || [];
  let hasFailures = false;
  const componentResults: BackupComponentDetail[] = [];
  
  try {
    // 1. PostgreSQL (principal - mais crítico)
    if (!skipComponents.includes('postgresql')) {
      await updateBackupJob(backupId, { currentComponent: 'postgresql', progress: 10 });
      
      const pgResult = await backupPostgreSQL(type === 'incremental' ? 'incr' : 'full');
      componentResults.push(pgResult as BackupComponentDetail);
      await updateBackupJob(backupId, { components: componentResults });
      
      manifest.components.postgresql = {
        status: pgResult.status === 'completed' ? 'completed' : 'failed',
        lsn: pgResult.metadata?.lsn,
        backupSet: pgResult.metadata?.backupSet,
        size: pgResult.size,
        walArchived: true,
      };
      
      if (pgResult.status === 'failed') hasFailures = true;
    }
    
    await updateBackupJob(backupId, { progress: 40 });
    
    // 2. Redis
    if (!skipComponents.includes('redis')) {
      await updateBackupJob(backupId, { currentComponent: 'redis', progress: 55 });

      const redisResult = await backupRedis(backupId);
      componentResults.push(redisResult as BackupComponentDetail);
      await updateBackupJob(backupId, { components: componentResults });

      manifest.components.redis = {
        status: redisResult.status === 'completed' ? 'completed' : 'failed',
        rdbChecksum: redisResult.metadata?.rdbChecksum,
        size: redisResult.size,
        backupFile: redisResult.metadata?.backupFile,
      };

      if (redisResult.status === 'failed') hasFailures = true;
    }

    await updateBackupJob(backupId, { progress: 70 });

    // 3. Qdrant (embeddings de texto - crítico para RAG)
    // ADICIONADO AUDITORIA 17/12/2025: Qdrant era o único DB sem backup
    if (!skipComponents.includes('qdrant')) {
      await updateBackupJob(backupId, { currentComponent: 'qdrant', progress: 80 });

      const qdrantResult = await backupQdrant(backupId);
      componentResults.push(qdrantResult as BackupComponentDetail);
      await updateBackupJob(backupId, { components: componentResults });

      const qdrantSnapshotFiles = parseJsonStringArray(qdrantResult.metadata?.snapshotFiles);
      manifest.components.qdrant = {
        status: qdrantResult.status === 'completed' ? 'completed' : 
                qdrantResult.status === 'skipped' ? 'skipped' : 'failed',
        snapshotName: qdrantResult.metadata?.timestamp,
        collections: qdrantResult.metadata?.collections?.split(',').filter(Boolean),
        snapshotFiles: qdrantSnapshotFiles.length > 0 ? qdrantSnapshotFiles : undefined,
        size: qdrantResult.size,
      };

      if (qdrantResult.status === 'failed') hasFailures = true;
    }

    await updateBackupJob(backupId, { progress: 95 });

    // NOTA: Uploads NÃO são incluídos no backup automatizado
    // Os uploads estão em /opt/alice/uploads (volume local) e devem ser
    // gerenciados separadamente pelo admin (rsync, download manual, etc.)
    
    // Finalizar manifesto
    manifest.completedAt = new Date().toISOString();
    manifest.durationSeconds = Math.round((Date.now() - startTime) / 1000);
    manifest.status = hasFailures ? 'partial' : 'completed';
    
    // Calcular tamanho total
    const totalBytes = componentResults
      .filter(c => c.size)
      .reduce((sum, c) => {
        const match = c.size?.match(/^([\d.]+)\s*(\w+)$/);
        if (!match) return sum;
        const [, value, unit] = match;
        const multipliers: Record<string, number> = { B: 1, KB: 1024, MB: 1024**2, GB: 1024**3, TB: 1024**4 };
        return sum + parseFloat(value) * (multipliers[unit] || 1);
      }, 0);
    manifest.totalSize = formatBytes(totalBytes);
    
    await writePostgreSqlMetadataArtifact(backupId, manifest.components.postgresql);

    // Salvar manifesto
    await saveManifest(manifest);

    if (isOffsiteEnabled()) {
      manifest.offsite = {
        enabled: true,
        required: BACKUP_OFFSITE_REQUIRED,
        status: 'pending',
        path: BACKUP_OFFSITE_DIR_RESOLVED,
        encryption: {
          enabled: BACKUP_OFFSITE_ENCRYPTION_REQUIRED,
          algorithm: BACKUP_OFFSITE_ENCRYPTION_REQUIRED ? BACKUP_OFFSITE_ENCRYPTION_ALGORITHM : undefined,
        },
      };

      let offsiteResult: OffsiteSyncResult;
      try {
        offsiteResult = await syncBackupToOffsite(backupId);
      } catch (error) {
        offsiteResult = {
          status: 'failed',
          error: (error as Error).message,
        };
      }
      manifest.offsite.status = offsiteResult.status;
      manifest.offsite.syncedAt = offsiteResult.syncedAt;
      manifest.offsite.filesSynced = offsiteResult.filesSynced;
      manifest.offsite.verificationFile = offsiteResult.verificationFile;
      manifest.offsite.error = offsiteResult.error;

      if (offsiteResult.status !== 'completed' && BACKUP_OFFSITE_REQUIRED) {
        hasFailures = true;
        manifest.status = 'partial';
      }

      await saveManifest(manifest);
    } else {
      manifest.offsite = {
        enabled: false,
        required: false,
        status: 'skipped',
        encryption: {
          enabled: false,
        },
      };
      await saveManifest(manifest);
    }
    
    // Atualizar job no PostgreSQL com status final (Regra 6)
    const manifestData: BackupManifestData = {
      components: manifest.components,
      storage: manifest.storage,
      encryption: manifest.encryption,
      notes: manifest.notes,
    };
    
    await updateBackupJob(backupId, { 
      status: hasFailures ? 'failed' : 'completed',
      progress: 100,
      manifest: manifestData,
      totalSize: manifest.totalSize,
      completedAt: new Date(),
      durationSeconds: manifest.durationSeconds,
      currentComponent: null,
    });
    
    logger.info({ 
      backupId, 
      status: manifest.status,
      durationSeconds: manifest.durationSeconds,
      totalSize: manifest.totalSize
    }, 'Backup unificado concluído');
    
  } catch (error) {
    const err = error as Error;
    manifest.status = 'failed';
    manifest.completedAt = new Date().toISOString();
    manifest.durationSeconds = Math.round((Date.now() - startTime) / 1000);
    
    await saveManifest(manifest);
    
    // Atualizar job no PostgreSQL com falha (Regra 6)
    await updateBackupJob(backupId, { 
      status: 'failed',
      error: err.message,
      completedAt: new Date(),
      durationSeconds: manifest.durationSeconds,
    });
    
    logger.error({ backupId, error: err.message }, 'Erro crítico no backup unificado');
    throw error;
  }
  
  return manifest;
}

/**
 * Executar restore unificado da plataforma
 * Restaura todos os componentes para o ponto do manifesto
 */
async function runUnifiedRestore(
  backupId: string,
  options?: { skipComponents?: string[]; dryRun?: boolean }
): Promise<{ success: boolean; message: string; details: Record<string, string> }> {
  assertValidBackupId(backupId);
  logger.info({ backupId, dryRun: options?.dryRun }, 'Iniciando restore unificado da plataforma');
  
  // Carregar manifesto
  const manifest = await loadManifest(backupId);
  if (!manifest) {
    throw new Error(`Manifesto não encontrado: ${backupId}`);
  }
  
  if (manifest.status !== 'completed' && manifest.status !== 'partial') {
    throw new Error(`Backup não pode ser restaurado: status=${manifest.status}`);
  }
  
  const skipComponents = options?.skipComponents || [];
  const details: Record<string, string> = {};
  let hasErrors = false;
  
  // ATENÇÃO: Em produção, o restore precisa:
  // 1. Parar os serviços
  // 2. Restaurar cada componente
  // 3. Reiniciar os serviços
  
  if (options?.dryRun) {
    logger.info({ backupId }, 'Dry run: simulando restore');
    return {
      success: true,
      message: `Dry run: restore do backup ${backupId} seria executado`,
      details: {
        postgresql: manifest.components.postgresql?.status || 'skip',
        redis: manifest.components.redis?.status || 'skip',
        // CORREÇÃO 18/12/2025: qdrant está em components, não na raiz do manifest
        qdrant: manifest.components.qdrant?.status || 'skip',
      },
    };
  }
  
  // 1. Restore PostgreSQL
  if (!skipComponents.includes('postgresql') && manifest.components.postgresql?.status === 'completed') {
    try {
      const backupSet = assertSafePgBackrestSet(manifest.components.postgresql.backupSet ?? '');
      logger.info({ backupSet }, 'Restaurando PostgreSQL');
      
      await execFileAsync(
        'docker',
        ['exec', 'alice-pgbackrest', 'pgbackrest', '--stanza=alice_prod', `--set=${backupSet}`, 'restore'],
        { timeout: 3600000 },
      );
      
      details.postgresql = 'restored';
    } catch (error) {
      const err = error as Error;
      details.postgresql = `failed: ${err.message}`;
      hasErrors = true;
    }
  }
  
  // 2. Restore Redis
  if (!skipComponents.includes('redis') && manifest.components.redis?.status === 'completed') {
    try {
      const redisBackupFile = await resolveRedisBackupFilePath(manifest);
      if (!redisBackupFile) {
        throw new Error('Artefato Redis não encontrado para restore');
      }
      logger.info(
        { checksum: manifest.components.redis.rdbChecksum, redisBackupFile },
        'Restore Redis requer operação coordenada de container',
      );
      details.redis = `ready_for_restore (${redisBackupFile})`;
    } catch (error) {
      const err = error as Error;
      details.redis = `failed: ${err.message}`;
      hasErrors = true;
    }
  }

  // 3. Restore Qdrant (embeddings texto - crítico para RAG)
  // ADICIONADO 17/12/2025: Restore de snapshots via API REST Qdrant
  // CORREÇÃO 07/03/2026: suporte a artefatos versionados por backupId + fallback legado
  if (!skipComponents.includes('qdrant') && manifest.components.qdrant?.status === 'completed') {
    try {
      const collections = manifest.components.qdrant.collections || [];
      const snapshotFiles = manifest.components.qdrant.snapshotFiles || [];
      
      logger.info({ collections: collections.length, backupId }, 'Restaurando Qdrant');
      
      let restoredCollections = 0;
      for (let index = 0; index < collections.length; index += 1) {
        const collectionName = collections[index];
        const expectedSnapshotFile = snapshotFiles[index];
        const candidates = buildQdrantSnapshotCandidates(manifest, collectionName, expectedSnapshotFile);
        const snapshotFile = candidates.find(candidate => existsSync(candidate));
        
        // Verificar se arquivo existe
        if (!snapshotFile) {
          logger.warn({ collectionName, backupId }, 'Arquivo de snapshot não encontrado, ignorando coleção');
          continue;
        }
        
        // Upload snapshot para Qdrant via API REST
        // POST /collections/{collection_name}/snapshots/upload
        const snapshotData = await readFile(snapshotFile);
        
        const uploadResponse = await fetch(
          `${QDRANT_URL}/collections/${collectionName}/snapshots/upload`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: snapshotData,
            signal: AbortSignal.timeout(600000), // 10 min por coleção
          }
        );
        
        if (!uploadResponse.ok) {
          const errorText = await uploadResponse.text();
          throw new Error(`Falha ao restaurar coleção ${collectionName}: ${uploadResponse.status} - ${errorText}`);
        }
        
        logger.info({ collectionName }, 'Coleção Qdrant restaurada');
        restoredCollections += 1;
      }
      
      details.qdrant = `restored (${restoredCollections}/${collections.length} collections)`;
    } catch (error) {
      const err = error as Error;
      details.qdrant = `failed: ${err.message}`;
      hasErrors = true;
      logger.error({ error: err.message }, 'Erro ao restaurar Qdrant');
    }
  }
  
  // NOTA: Uploads são armazenados em volume local separado (/opt/alice/uploads)
  // e NÃO são incluídos no restore automatizado
  
  logger.info({ backupId, hasErrors, details }, 'Restore unificado concluído');
  
  return {
    success: !hasErrors,
    message: hasErrors ? 'Restore concluído com erros' : 'Restore concluído com sucesso',
    details,
  };
}

// =============================================================================
// ROTAS DA API
// =============================================================================

const router: ReturnType<typeof Router> = Router();

// Schema de validação para backup (Zod - Regra 8)
// ATUALIZADO 17/12/2025: Adicionado 'qdrant' (embeddings texto - crítico para RAG)
const BackupRequestSchema = z.object({
  type: z.enum(['full', 'incremental']).default('full'),
  skipComponents: z.array(z.enum(['postgresql', 'redis', 'qdrant'])).optional(),
  notes: z.string().max(500).optional(),
});

// Schema de validação para restore
const RestoreRequestSchema = z.object({
  backupId: z.string().min(1).max(128).regex(BACKUP_ID_REGEX, 'backupId inválido'),
  skipComponents: z.array(z.enum(['postgresql', 'redis', 'qdrant'])).optional(),
  dryRun: z.boolean().default(false),
  confirm: z.literal(true, { message: 'Confirmação obrigatória para restore' }),
});

/**
 * POST /api/backup/run
 * Executar backup unificado de toda a plataforma
 * 
 * ATUALIZADO: Verifica job em andamento via PostgreSQL (Regra 6)
 */
router.post('/run', async (req: Request, res: Response) => {
  try {
    // Verificar se já existe backup em andamento (via PostgreSQL - Regra 6)
    const runningJob = await getCurrentJob();
    if (runningJob && runningJob.status === 'running') {
      res.status(409).json({
        error: 'Backup já em andamento',
        jobId: runningJob.jobId,
        progress: runningJob.progress,
      });
      return;
    }
    
    // Validar request
    const parsed = BackupRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
      return;
    }
    
    const { type, skipComponents, notes } = parsed.data;
    
    // Executar backup em background
    const manifest = await runUnifiedBackup(type, {
      skipComponents,
      notes,
      createdBy: (req as Request & { user?: { email?: string } }).user?.email,
    });
    
    res.status(201).json({
      success: true,
      message: 'Backup unificado concluído',
      manifest,
    });
    
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message }, 'Erro ao executar backup');
    res.status(500).json({ error: 'Erro ao executar backup', details: err.message });
  }
});

/**
 * POST /api/backup/restore
 * Executar restore unificado da plataforma
 */
router.post('/restore', async (req: Request, res: Response) => {
  try {
    // Validar request
    const parsed = RestoreRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
      return;
    }
    
    const { backupId, skipComponents, dryRun } = parsed.data;
    
    const result = await runUnifiedRestore(backupId, { skipComponents, dryRun });
    
    res.json(result);
    
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message }, 'Erro ao executar restore');
    res.status(500).json({ error: 'Erro ao executar restore', details: err.message });
  }
});

/**
 * GET /api/backup/status
 * Obter status do backup em andamento
 * 
 * ATUALIZADO: Usa PostgreSQL para persistência (Regra 6)
 */
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const currentJob = await getCurrentJob();
    
    if (!currentJob) {
      res.json({ status: 'idle', message: 'Nenhum backup em andamento' });
      return;
    }
    
    res.json({
      jobId: currentJob.jobId,
      status: currentJob.status,
      progress: currentJob.progress,
      currentComponent: currentJob.currentComponent,
      components: currentJob.components,
      manifest: currentJob.manifest,
      startedAt: currentJob.startedAt?.toISOString(),
      estimatedCompletion: currentJob.estimatedCompletion?.toISOString(),
    });
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message }, 'Erro ao obter status do backup');
    res.status(500).json({ error: 'Erro ao obter status', details: err.message });
  }
});

/**
 * GET /api/backup/history
 * Listar histórico de backups
 */
router.get('/history', async (_req: Request, res: Response) => {
  try {
    const manifests = await listManifests();
    
    const history: BackupHistory = {
      manifests,
      totalCount: manifests.length,
      lastSuccessful: manifests.find(m => m.status === 'completed'),
      lastFailed: manifests.find(m => m.status === 'failed'),
    };
    
    res.json(history);
    
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message }, 'Erro ao listar histórico');
    res.status(500).json({ error: 'Erro ao listar histórico', details: err.message });
  }
});

/**
 * GET /api/backup/manifest/:id
 * Obter manifesto de um backup específico
 */
router.get('/manifest/:id', async (req: Request, res: Response) => {
  try {
    const manifest = await loadManifest(req.params.id);
    
    if (!manifest) {
      res.status(404).json({ error: 'Manifesto não encontrado' });
      return;
    }
    
    res.json(manifest);
    
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message }, 'Erro ao carregar manifesto');
    res.status(500).json({ error: 'Erro ao carregar manifesto', details: err.message });
  }
});

/**
 * POST /api/backup/verify/:id
 * Verificar integridade de um backup
 */
router.post('/verify/:id', async (req: Request, res: Response) => {
  try {
    const backupId = req.params.id.trim();
    assertValidBackupId(backupId);

    const manifest = await loadManifest(backupId);
    
    if (!manifest) {
      res.status(404).json({ error: 'Manifesto não encontrado' });
      return;
    }
    
    logger.info({ backupId }, 'Verificando integridade e prontidão de restore do backup');

    const readiness = await verifyBackupReadiness(backupId, manifest);
    let postgresqlVerify: { status: 'passed' | 'failed'; output?: string; error?: string } = { status: 'passed' };
    try {
      const { stdout } = await execFileAsync(
        'docker',
        ['exec', 'alice-pgbackrest', 'pgbackrest', '--stanza=alice_prod', 'verify'],
        { timeout: 600000 },
      );
      postgresqlVerify = { status: 'passed', output: stdout };
    } catch (error) {
      postgresqlVerify = { status: 'failed', error: (error as Error).message };
    }

    const offsiteMustPass = isOffsiteEnabled() && BACKUP_OFFSITE_REQUIRED;
    const overallSuccess = readiness.restoreReady
      && postgresqlVerify.status === 'passed'
      && (!offsiteMustPass || readiness.offsite?.status === 'ready');
    
    res.json({
      success: overallSuccess,
      message: 'Verificação concluída',
      backupId,
      postgresqlVerify,
      readiness,
    });
    
  } catch (error) {
    const err = error as Error;
    if (err.message === 'backupId inválido') {
      res.status(400).json({ error: 'backupId inválido' });
      return;
    }
    logger.error({ error: err.message }, 'Erro ao verificar backup');
    res.status(500).json({ error: 'Erro ao verificar backup', details: err.message });
  }
});

// =============================================================================
// SCHEDULE DE BACKUPS AUTOMÁTICOS - Enterprise-Grade
// =============================================================================
// Best practices 2025: Configuração dinâmica via API, persistência em disco
// Regra 6: Sem workarounds - persistência real em arquivo JSON
// =============================================================================

/**
 * Configuração de schedule de backup
 * ATUALIZADO: 05/12/2025 - Migrado de offsite para storage local (Volume Hetzner)
 */
interface BackupSchedule {
  enabled: boolean;
  fullBackup: {
    enabled: boolean;
    cronExpression: string;
    description: string;
  };
  incrementalBackup: {
    enabled: boolean;
    cronExpression: string;
    description: string;
  };
  retention: {
    fullBackupDays: number;
    incrementalBackupDays: number;
    archiveDays: number;
  };
  storage: {
    type: 'local';
    path: string;
    volumeName: string;
  };
  notifications: {
    onSuccess: boolean;
    onFailure: boolean;
    webhookUrl?: string;
  };
  lastModified: string;
  modifiedBy?: string;
}

const SCHEDULE_FILE = path.join(BACKUP_DIR, 'schedule.json');

/** Configuração padrão de schedule (Enterprise best practices) */
const DEFAULT_SCHEDULE: BackupSchedule = {
  enabled: true,
  fullBackup: {
    enabled: true,
    cronExpression: '0 3 * * 0',
    description: 'Backup full aos domingos às 03:00 UTC',
  },
  incrementalBackup: {
    enabled: true,
    cronExpression: '0 3 * * 1-6',
    description: 'Backup incremental de segunda a sábado às 03:00 UTC',
  },
  retention: {
    fullBackupDays: 30,      // Otimizado para servidor GEX44 (1.92TB disponível)
    incrementalBackupDays: 7,
    archiveDays: 90,         // Otimizado para servidor GEX44 (1.92TB disponível)
  },
  storage: {
    type: 'local',
    path: '/opt/alice/backups',
    volumeName: 'alice-data',
  },
  notifications: {
    onSuccess: false,
    onFailure: true,
  },
  lastModified: new Date().toISOString(),
};

/** Carregar schedule do disco */
async function loadSchedule(): Promise<BackupSchedule> {
  try {
    if (!existsSync(SCHEDULE_FILE)) {
      await saveSchedule(DEFAULT_SCHEDULE);
      return DEFAULT_SCHEDULE;
    }
    
    const content = await readFile(SCHEDULE_FILE, 'utf-8');
    return JSON.parse(content) as BackupSchedule;
  } catch (error) {
    logger.warn({ error }, 'Erro ao carregar schedule, usando padrão');
    return DEFAULT_SCHEDULE;
  }
}

/** Salvar schedule em disco */
async function saveSchedule(schedule: BackupSchedule): Promise<void> {
  await mkdir(BACKUP_DIR, { recursive: true });
  await writeFile(SCHEDULE_FILE, JSON.stringify(schedule, null, 2), 'utf-8');
  logger.info('Schedule de backup salvo');
}

/** Validar expressão cron */
function validateCronExpression(expr: string): boolean {
  const cronRegex = /^(\*|([0-5]?\d)) (\*|([01]?\d|2[0-3])) (\*|([1-9]|[12]\d|3[01])) (\*|([1-9]|1[0-2])) (\*|[0-6](-[0-6])?(,[0-6](-[0-6])?)*)$/;
  return cronRegex.test(expr);
}

/** Schema Zod para validação de schedule */
const scheduleUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  fullBackup: z.object({
    enabled: z.boolean(),
    cronExpression: z.string().refine(validateCronExpression, {
      message: 'Expressão cron inválida (formato: min hora dia mês diaSemana)',
    }),
    description: z.string().optional(),
  }).optional(),
  incrementalBackup: z.object({
    enabled: z.boolean(),
    cronExpression: z.string().refine(validateCronExpression, {
      message: 'Expressão cron inválida',
    }),
    description: z.string().optional(),
  }).optional(),
  retention: z.object({
    fullBackupDays: z.number().min(1).max(365),
    incrementalBackupDays: z.number().min(1).max(30),
    archiveDays: z.number().min(7).max(3650),
  }).optional(),
  storage: z.object({
    type: z.literal('local'),
    path: z.string(),
    volumeName: z.string(),
  }).optional(),
  notifications: z.object({
    onSuccess: z.boolean(),
    onFailure: z.boolean(),
    // NOTA: .transform() converte null para undefined para compatibilidade com interface BackupSchedule
    webhookUrl: z.string().url().optional().nullable().transform(val => val ?? undefined),
  }).optional(),
});

/**
 * GET /api/backup/schedule
 * Obter configuração atual de schedule de backups
 */
router.get('/schedule', async (_req: Request, res: Response) => {
  try {
    const schedule = await loadSchedule();
    res.json(schedule);
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message }, 'Erro ao carregar schedule');
    res.status(500).json({ error: 'Erro ao carregar schedule', details: err.message });
  }
});

/**
 * PUT /api/backup/schedule
 * Atualizar configuração de schedule de backups
 */
router.put('/schedule', async (req: Request, res: Response) => {
  try {
    const parsed = scheduleUpdateSchema.safeParse(req.body);
    
    if (!parsed.success) {
      res.status(400).json({
        error: 'Dados inválidos',
        details: parsed.error.errors,
      });
      return;
    }
    
    const currentSchedule = await loadSchedule();
    
    const updatedSchedule: BackupSchedule = {
      ...currentSchedule,
      ...parsed.data,
      fullBackup: parsed.data.fullBackup 
        ? { ...currentSchedule.fullBackup, ...parsed.data.fullBackup }
        : currentSchedule.fullBackup,
      incrementalBackup: parsed.data.incrementalBackup
        ? { ...currentSchedule.incrementalBackup, ...parsed.data.incrementalBackup }
        : currentSchedule.incrementalBackup,
      retention: parsed.data.retention
        ? { ...currentSchedule.retention, ...parsed.data.retention }
        : currentSchedule.retention,
      storage: parsed.data.storage
        ? { ...currentSchedule.storage, ...parsed.data.storage }
        : currentSchedule.storage,
      notifications: parsed.data.notifications
        ? { ...currentSchedule.notifications, ...parsed.data.notifications }
        : currentSchedule.notifications,
      lastModified: new Date().toISOString(),
      modifiedBy: req.headers['x-user-id'] as string || 'admin',
    };
    
    await saveSchedule(updatedSchedule);
    
    logger.info({ schedule: updatedSchedule }, 'Schedule de backup atualizado');
    
    res.json({
      success: true,
      message: 'Schedule atualizado com sucesso',
      schedule: updatedSchedule,
    });
    
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message }, 'Erro ao atualizar schedule');
    res.status(500).json({ error: 'Erro ao atualizar schedule', details: err.message });
  }
});

/**
 * POST /api/backup/schedule/test
 * Testar configuração de schedule (dry-run)
 */
router.post('/schedule/test', async (_req: Request, res: Response) => {
  try {
    const schedule = await loadSchedule();
    
    const nextFullBackup = getNextCronRun(schedule.fullBackup.cronExpression);
    const nextIncrementalBackup = getNextCronRun(schedule.incrementalBackup.cronExpression);
    
    res.json({
      success: true,
      message: 'Configuração de schedule válida',
      nextRuns: {
        fullBackup: schedule.fullBackup.enabled ? nextFullBackup : null,
        incrementalBackup: schedule.incrementalBackup.enabled ? nextIncrementalBackup : null,
      },
      schedule,
    });
    
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message }, 'Erro ao testar schedule');
    res.status(500).json({ error: 'Erro ao testar schedule', details: err.message });
  }
});

/**
 * Parser de cron expressions completo - Enterprise Grade
 * Suporta: minute, hour, dayOfMonth, month, dayOfWeek
 * 
 * Formato: "MIN HOUR DOM MON DOW"
 * - MIN: 0-59
 * - HOUR: 0-23  
 * - DOM: 1-31 (dia do mes)
 * - MON: 1-12 (mes)
 * - DOW: 0-6 (dia da semana, 0=domingo)
 * 
 * Suporta:
 * - Wildcards: *
 * - Ranges: 1-5
 * - Lists: 1,3,5
 * - Steps: asterisco/5, 0-30/10 (exemplo: cada 5 unidades)
 * 
 * @param cronExpression - Expressao cron no formato padrao
 * @returns ISO string da proxima execucao
 */
function getNextCronRun(cronExpression: string): string {
  const parts = cronExpression.split(' ');
  if (parts.length !== 5) {
    logger.warn({ cronExpression }, 'Expressão cron inválida, usando defaults');
    return new Date(Date.now() + 86400000).toISOString(); // +1 dia
  }
  
  const [minuteExpr, hourExpr, domExpr, monthExpr, dowExpr] = parts;
  
  const parseField = (expr: string, min: number, max: number): number[] => {
    const values: Set<number> = new Set();
    
    // Wildcard
    if (expr === '*') {
      for (let i = min; i <= max; i++) values.add(i);
      return Array.from(values);
    }
    
    // Listas separadas por vírgula
    const segments = expr.split(',');
    
    for (const segment of segments) {
      // Steps: */5 ou 0-30/10
      if (segment.includes('/')) {
        const [rangeStr, stepStr] = segment.split('/');
        const step = parseInt(stepStr) || 1;
        let start = min;
        let end = max;
        
        if (rangeStr !== '*' && rangeStr.includes('-')) {
          const [rangeStart, rangeEnd] = rangeStr.split('-').map(Number);
          start = rangeStart;
          end = rangeEnd;
        } else if (rangeStr !== '*') {
          const parsed = parseInt(rangeStr, 10);
          start = Number.isNaN(parsed) ? min : parsed;
        }
        
        for (let i = start; i <= end; i += step) {
          if (i >= min && i <= max) values.add(i);
        }
      }
      // Ranges: 1-5
      else if (segment.includes('-')) {
        const [start, end] = segment.split('-').map(Number);
        for (let i = start; i <= end; i++) {
          if (i >= min && i <= max) values.add(i);
        }
      }
      // Valor único
      else {
        const val = parseInt(segment);
        if (!isNaN(val) && val >= min && val <= max) values.add(val);
      }
    }
    
    return Array.from(values).sort((a, b) => a - b);
  };
  
  const minutes = parseField(minuteExpr, 0, 59);
  const hours = parseField(hourExpr, 0, 23);
  const daysOfMonth = parseField(domExpr, 1, 31);
  const months = parseField(monthExpr, 1, 12);
  const daysOfWeek = parseField(dowExpr, 0, 6);
  
  const now = new Date();
  const maxIterations = 366 * 24 * 60; // Máximo 1 ano de iterações
  
  for (let i = 0; i < maxIterations; i++) {
    const candidate = new Date(now.getTime() + i * 60000); // Avança minuto a minuto
    candidate.setSeconds(0);
    candidate.setMilliseconds(0);
    
    const candMinute = candidate.getMinutes();
    const candHour = candidate.getHours();
    const candDom = candidate.getDate();
    const candMonth = candidate.getMonth() + 1; // JavaScript usa 0-11
    const candDow = candidate.getDay();
    
    // Validar todos os campos
    if (!minutes.includes(candMinute)) continue;
    if (!hours.includes(candHour)) continue;
    if (!months.includes(candMonth)) continue;
    
    // DOM e DOW: se ambos não são *, precisa satisfazer pelo menos um
    // Se um deles é *, precisa satisfazer o outro
    const domIsWildcard = domExpr === '*';
    const dowIsWildcard = dowExpr === '*';
    
    if (domIsWildcard && dowIsWildcard) {
      // Ambos wildcard: qualquer dia é válido
    } else if (domIsWildcard) {
      // Apenas DOW especificado
      if (!daysOfWeek.includes(candDow)) continue;
    } else if (dowIsWildcard) {
      // Apenas DOM especificado
      if (!daysOfMonth.includes(candDom)) continue;
    } else {
      // Ambos especificados: satisfazer pelo menos um (comportamento padrão cron)
      if (!daysOfMonth.includes(candDom) && !daysOfWeek.includes(candDow)) continue;
    }
    
    // Se chegou aqui, encontrou próxima execução
    if (candidate > now) {
      return candidate.toISOString();
    }
  }
  
  // Fallback: próximo dia às 03:00
  const fallback = new Date(now);
  fallback.setDate(fallback.getDate() + 1);
  fallback.setHours(3, 0, 0, 0);
  return fallback.toISOString();
}

// =============================================================================
// PRE-DEPLOY SNAPSHOT - Para rollback automático
// =============================================================================

/**
 * POST /api/backup/pre-deploy
 * Criar snapshot pré-deploy para rollback automático
 * Chamado pelo CI/CD antes de cada deploy
 */
router.post('/pre-deploy', async (req: Request, res: Response) => {
  try {
    const { deployId, version, actor } = req.body as {
      deployId?: string;
      version?: string;
      actor?: string;
    };
    
    logger.info({ deployId, version, actor }, 'Iniciando snapshot pré-deploy');
    
    const backupId = `pre-deploy-${deployId || Date.now()}`;
    
    const manifest: BackupManifest = {
      id: backupId,
      type: 'full',
      status: 'running',
      startedAt: new Date().toISOString(),
      components: {},
      storage: {
        type: 'local',
        path: BACKUP_DIR,
        volumeName: 'alice-data',
      },
      encryption: { enabled: true, algorithm: 'AES-256-CBC' },
      createdBy: actor || 'ci-cd',
      notes: `Snapshot pré-deploy para versão ${version || 'unknown'}`,
    };
    
    await saveManifest(manifest);
    
    try {
      await execAsync(
        `docker exec alice-pgbackrest pgbackrest --stanza=alice_prod --type=full backup`,
        { timeout: 1800000 }
      );
      
      manifest.components.postgresql = {
        status: 'completed',
        backupSet: backupId,
      };
    } catch (error) {
      manifest.components.postgresql = { status: 'failed' };
      logger.error({ error }, 'Falha no snapshot PostgreSQL pré-deploy');
    }
    
    manifest.status = manifest.components.postgresql?.status === 'completed' ? 'completed' : 'failed';
    manifest.completedAt = new Date().toISOString();
    
    await saveManifest(manifest);
    
    res.json({
      success: manifest.status === 'completed',
      backupId,
      manifest,
    });
    
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message }, 'Erro ao criar snapshot pré-deploy');
    res.status(500).json({ error: 'Erro ao criar snapshot pré-deploy', details: err.message });
  }
});

// =============================================================================
// ENDPOINTS DE GESTÃO DE DISCO E BACKUPS (Enterprise - Volume Local)
// =============================================================================

/**
 * GET /api/backup/disk-usage
 * Obter informações de uso de disco do volume de backups
 */
router.get('/disk-usage', async (_req: Request, res: Response) => {
  try {
    // Obter uso de disco dos diretórios de backup
    const getDirSize = async (dir: string): Promise<number> => {
      if (!existsSync(dir)) return 0;
      try {
        const { bytes } = await getDirectoryStats(dir);
        return bytes;
      } catch {
        return 0;
      }
    };

    // ATUALIZADO 17/12/2025: Adicionado Qdrant (embeddings texto - crítico para RAG)
    const [postgresqlSize, redisSize, qdrantSize, manifestsSize] = await Promise.all([
      getDirSize(path.join(BACKUP_DIR, 'postgresql')),
      getDirSize(path.join(BACKUP_DIR, 'redis')),
      getDirSize(path.join(BACKUP_DIR, 'qdrant')),
      getDirSize(MANIFESTS_DIR),
    ]);

    // Obter informações de uploads (separado - para referência)
    const uploadsInfo = await getUploadsInfo();

    // Obter espaço livre no volume
    let volumeFree = 0;
    let volumeTotal = 0;
    try {
      const fsStats = await statfs(BACKUP_DIR);
      volumeTotal = Number(fsStats.blocks) * Number(fsStats.bsize);
      volumeFree = Number(fsStats.bavail) * Number(fsStats.bsize);
    } catch {
      // Fallback se df falhar
    }

    const totalBackupSize = postgresqlSize + redisSize + qdrantSize + manifestsSize;

    res.json({
      backups: {
        postgresql: formatBytes(postgresqlSize),
        redis: formatBytes(redisSize),
        qdrant: formatBytes(qdrantSize),
        manifests: formatBytes(manifestsSize),
        total: formatBytes(totalBackupSize),
      },
      uploads: {
        filesCount: uploadsInfo.filesCount,
        totalSize: uploadsInfo.totalSize,
        path: UPLOADS_DIR,
      },
      volume: {
        name: 'alice-data',
        path: '/opt/alice',
        total: formatBytes(volumeTotal),
        free: formatBytes(volumeFree),
        usedPercent: volumeTotal > 0 ? Math.round((1 - volumeFree / volumeTotal) * 100) : 0,
      },
    });
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message }, 'Erro ao obter uso de disco');
    res.status(500).json({ error: 'Erro ao obter uso de disco', details: err.message });
  }
});

/**
 * DELETE /api/backup/:id
 * Excluir um backup específico
 * ATENÇÃO: Operação irreversível - requer confirmação
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const backupId = req.params.id.trim();
    assertValidBackupId(backupId);
    const { confirm } = req.query;

    if (confirm !== 'true') {
      res.status(400).json({ 
        error: 'Confirmação obrigatória', 
        message: 'Adicione ?confirm=true para confirmar exclusão' 
      });
      return;
    }

    // Verificar se manifesto existe
    const manifest = await loadManifest(backupId);
    if (!manifest) {
      res.status(404).json({ error: 'Backup não encontrado' });
      return;
    }

    // Não permitir excluir backup em andamento
    if (manifest.status === 'running') {
      res.status(409).json({ error: 'Não é possível excluir backup em andamento' });
      return;
    }

    // Excluir manifesto
    const manifestPath = resolveManifestPath(backupId);
    if (existsSync(manifestPath)) {
      const { unlink } = await import('fs/promises');
      await unlink(manifestPath);
    }

    // NOTA: Os dados de backup do pgBackRest são gerenciados pelo próprio pgBackRest
    // A exclusão manual de backups PostgreSQL deve ser feita via pgbackrest expire

    logger.info({ backupId }, 'Manifesto de backup excluído');

    res.json({
      success: true,
      message: `Manifesto do backup ${backupId} excluído`,
      note: 'Dados do pgBackRest devem ser limpos via comando expire',
    });
  } catch (error) {
    const err = error as Error;
    if (err.message === 'backupId inválido') {
      res.status(400).json({ error: 'backupId inválido' });
      return;
    }
    logger.error({ error: err.message }, 'Erro ao excluir backup');
    res.status(500).json({ error: 'Erro ao excluir backup', details: err.message });
  }
});

/**
 * POST /api/backup/cleanup
 * Executar limpeza de backups antigos baseado na retenção configurada
 */
router.post('/cleanup', async (_req: Request, res: Response) => {
  try {
    const schedule = await loadSchedule();
    const { retention } = schedule;

    logger.info({ retention }, 'Iniciando limpeza de backups antigos');

    // Carregar todos os manifestos
    const manifests = await listManifests();
    const now = Date.now();
    const deleted: string[] = [];

    for (const manifest of manifests) {
      const backupDate = new Date(manifest.startedAt).getTime();
      const ageDays = (now - backupDate) / (1000 * 60 * 60 * 24);

      let shouldDelete = false;

      if (manifest.type === 'full' && ageDays > retention.fullBackupDays) {
        shouldDelete = true;
      } else if (manifest.type === 'incremental' && ageDays > retention.incrementalBackupDays) {
        shouldDelete = true;
      } else if (ageDays > retention.archiveDays) {
        shouldDelete = true;
      }

      if (shouldDelete && manifest.status !== 'running') {
        const manifestPath = path.join(MANIFESTS_DIR, `${manifest.id}.json`);
        if (existsSync(manifestPath)) {
          const { unlink } = await import('fs/promises');
          await unlink(manifestPath);
          deleted.push(manifest.id);
        }
      }
    }

    // Executar expire no pgBackRest
    try {
      await execAsync(
        'docker exec alice-pgbackrest pgbackrest --stanza=alice_prod expire',
        { timeout: 300000 }
      );
    } catch (expireError) {
      logger.warn({ error: expireError }, 'Erro ao executar pgbackrest expire');
    }

    logger.info({ deletedCount: deleted.length, deleted }, 'Limpeza de backups concluída');

    res.json({
      success: true,
      deletedManifests: deleted.length,
      deleted,
      retention,
    });
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message }, 'Erro ao executar limpeza');
    res.status(500).json({ error: 'Erro ao executar limpeza', details: err.message });
  }
});

export { router as backupRouter };
