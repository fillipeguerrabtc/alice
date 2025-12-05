/**
 * Enums PostgreSQL - Alice Enterprise Platform
 * 
 * Todos os enums do banco de dados centralizados.
 * Usados por múltiplos domínios via import.
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 * TypeScript strict (Regra 8 CLAUDE.md)
 * 
 * @module @alice/shared/schema/enums
 */

import { pgEnum } from "drizzle-orm/pg-core";

// ============================================================================
// CORE ENUMS
// ============================================================================

export const userRoleEnum = pgEnum("user_role", [
  "super_admin",
  "admin",
  "manager",
  "operator",
  "viewer",
  "guest",
]);

// ============================================================================
// CHAT ENUMS
// ============================================================================

export const messageTypeEnum = pgEnum("message_type", [
  "text",
  "image",
  "audio",
  "video",
  "document",
  "mixed",
]);

export const conversationStatusEnum = pgEnum("conversation_status", [
  "active",
  "archived",
  "deleted",
]);

export const conversationControlModeEnum = pgEnum("conversation_control_mode", [
  "bot",           // Alice está respondendo
  "human",         // Agente humano assumiu (takeover)
  "pending_handoff", // Aguardando agente humano
  "hybrid",        // Modo híbrido (sugestões IA + aprovação humana)
]);

export const escalationTriggerEnum = pgEnum("escalation_trigger", [
  "low_confidence",     // Confiança LLM < 70%
  "fallback_count",     // 3+ fallbacks consecutivos
  "negative_sentiment", // Sentimento negativo detectado
  "keyword_match",      // "falar com humano", "atendente", etc.
  "manual_request",     // Agente solicitou takeover manualmente
  "sla_breach",         // SLA de resposta excedido
]);

export const messageOriginEnum = pgEnum("message_origin", [
  "bot",      // Mensagem gerada pela Alice
  "human",    // Mensagem de agente humano
  "customer", // Mensagem do cliente
  "system",   // Mensagem de sistema (notificações, etc.)
]);

// ============================================================================
// RAG ENUMS
// ============================================================================

export const agentStatusEnum = pgEnum("agent_status", [
  "active",
  "training",
  "paused",
  "deprecated",
]);

export const documentStatusEnum = pgEnum("document_status", [
  "pending",
  "processing",
  "completed",
  "failed",
]);

// ============================================================================
// TRAINING ENUMS
// ============================================================================

export const taskStatusEnum = pgEnum("task_status", [
  "pending",
  "processing",
  "completed",
  "failed",
  "cancelled",
]);

export const trainingDataStatusEnum = pgEnum("training_data_status", [
  "pending",
  "approved",
  "rejected",
  "used",
]);

export const fineTuningJobStatusEnum = pgEnum("fine_tuning_job_status", [
  "pending",
  "preparing",
  "training",
  "validating",
  "completed",
  "failed",
  "cancelled",
]);

export const modelVersionStatusEnum = pgEnum("model_version_status", [
  "training",
  "validating",
  "active",
  "deprecated",
  "rolled_back",
]);

export const autoLearningScheduleStatusEnum = pgEnum("auto_learning_schedule_status", [
  "scheduled",
  "running",
  "completed",
  "failed",
  "skipped",
]);

// ============================================================================
// INTEGRATIONS ENUMS
// ============================================================================

export const webhookSourceEnum = pgEnum("webhook_source", [
  "stripe",
  "wise",
  "twilio",
  "erpnext",
]);

export const wiseSyncStatusEnum = pgEnum("wise_sync_status", [
  "pending",
  "synced",
  "failed",
  "retrying",
  "manual_review",
]);

// ============================================================================
// MEDIA ENUMS
// ============================================================================

export const generatedImageStatusEnum = pgEnum("generated_image_status", [
  "pending",
  "generating",
  "completed",
  "failed",
]);

export const mediaTypeEnum = pgEnum("media_type", [
  "image",
  "audio",
  "video",
  "document",
]);

export const mediaProcessingStatusEnum = pgEnum("media_processing_status", [
  "pending",
  "processing",
  "completed",
  "failed",
]);

// ============================================================================
// BACKUP ENUMS (Regra 6 - Enterprise-Grade Persistence)
// ============================================================================

export const backupJobStatusEnum = pgEnum("backup_job_status", [
  "queued",
  "running",
  "completed",
  "failed",
]);

export const backupTypeEnum = pgEnum("backup_type", [
  "full",
  "incremental",
  "differential",
]);

export const backupComponentStatusEnum = pgEnum("backup_component_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
]);
