/**
 * Alice Enterprise Platform - Shared Package
 * 
 * Re-exporta o schema principal para manter
 * compatibilidade com todos os serviços.
 * 
 * NOTA: Estrutura modular criada em ./schema/ para futuras migrações
 * incrementais. Atualmente usa o schema.ts monolítico para estabilidade.
 * 
 * @module @alice/shared
 */

export * from './schema.js';

// Re-exportar tipos/tabelas de backup que só existem no schema modular
export {
  BackupComponentDetail,
  BackupManifestData,
  backupJobs,
  insertBackupJobSchema,
  type InsertBackupJob,
  type BackupJob,
} from './schema/integrations.js';
