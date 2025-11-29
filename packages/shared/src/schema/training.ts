/**
 * Schema Training - Alice Enterprise Platform
 * 
 * Tabelas de treinamento: training data, fine-tuning jobs, model versions, auto-learning.
 * Domínio de aprendizado e fine-tuning.
 * 
 * Documentação em PT-BR (Regra 10 replit.md)
 * TypeScript strict (Regra 8 replit.md)
 * 
 * @module @alice/shared/schema/training
 */

import {
  pgTable,
  text,
  varchar,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
  uuid,
  real,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

import {
  trainingDataStatusEnum,
  fineTuningJobStatusEnum,
  modelVersionStatusEnum,
  autoLearningScheduleStatusEnum,
} from "./enums.js";
import { tenants } from "./core.js";
import {
  TrainingMessages,
  FineTuningHyperparameters,
  FineTuningMetrics,
  ModelVersionMetrics,
  GenericMetadata,
} from "./shared-zod.js";

// Forward reference para evitar dependência circular
// namespaces será definido em rag.ts
declare const namespaces: { id: ReturnType<typeof uuid> };

// ============================================================================
// TRAINING DATA (Dados para Fine-tuning)
// ============================================================================

export const trainingData = pgTable(
  "training_data",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    namespaceId: uuid("namespace_id"),
    source: varchar("source", { length: 50 }).notNull(),
    sourceId: varchar("source_id", { length: 255 }),
    messages: jsonb("messages").$type<TrainingMessages>().notNull(),
    rating: integer("rating"),
    status: trainingDataStatusEnum("status").default("pending"),
    semhash: varchar("semhash", { length: 64 }),
    embedding: real("embedding").array(),
    isDuplicate: boolean("is_duplicate").default(false),
    duplicateOfId: uuid("duplicate_of_id"),
    similarityScore: real("similarity_score"),
    usedInJobId: varchar("used_in_job_id", { length: 255 }),
    criadoEm: timestamp("criado_em").defaultNow(),
    processadoEm: timestamp("processado_em"),
  },
  (table) => ({
    idxTrainingTenant: index("idx_training_tenant").on(table.tenantId),
    idxTrainingNamespace: index("idx_training_namespace").on(table.namespaceId),
    idxTrainingStatus: index("idx_training_status").on(table.status),
    idxTrainingSemhash: index("idx_training_semhash").on(table.semhash),
    idxTrainingSource: index("idx_training_source").on(table.source),
  })
);

// ============================================================================
// JOBS DE FINE-TUNING
// ============================================================================

export const fineTuningJobs = pgTable(
  "fine_tuning_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    name: varchar("name", { length: 255 }).notNull(),
    baseModel: varchar("base_model", { length: 100 }).notNull(),
    status: fineTuningJobStatusEnum("status").default("pending"),
    progress: integer("progress").default(0),
    containerGroupId: varchar("container_group_id", { length: 255 }),
    trainingDataCount: integer("training_data_count").default(0),
    validationDataCount: integer("validation_data_count").default(0),
    hyperparameters: jsonb("hyperparameters").$type<FineTuningHyperparameters>().default({}),
    metrics: jsonb("metrics").$type<FineTuningMetrics>().default({}),
    resultModel: varchar("result_model", { length: 255 }),
    errorMessage: text("error_message"),
    iniciadoEm: timestamp("iniciado_em"),
    completadoEm: timestamp("completado_em"),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idxFinetuningTenant: index("idx_finetuning_tenant").on(table.tenantId),
    idxFinetuningStatus: index("idx_finetuning_status").on(table.status),
  })
);

// ============================================================================
// MODEL VERSIONS (Progressive LoRA e Versionamento)
// ============================================================================

export const modelVersions = pgTable(
  "model_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    name: varchar("name", { length: 255 }).notNull(),
    version: integer("version").notNull().default(1),
    baseModel: varchar("base_model", { length: 100 }).notNull().default("llama4-maverick"),
    loraPath: text("lora_path"),
    status: modelVersionStatusEnum("status").default("training"),
    fineTuningJobId: uuid("fine_tuning_job_id").references(() => fineTuningJobs.id),
    trainingDataCount: integer("training_data_count").default(0),
    imageDataCount: integer("image_data_count").default(0),
    metrics: jsonb("metrics").$type<ModelVersionMetrics>().default({}),
    baselineMetrics: jsonb("baseline_metrics").$type<ModelVersionMetrics>().default({}),
    improvementPercent: real("improvement_percent"),
    isActive: boolean("is_active").default(false),
    rolledBackFrom: uuid("rolled_back_from"),
    rolledBackReason: text("rolled_back_reason"),
    criadoEm: timestamp("criado_em").defaultNow(),
    ativadoEm: timestamp("ativado_em"),
    deprecadoEm: timestamp("deprecado_em"),
  },
  (table) => ({
    idxModelVersionsTenant: index("idx_model_versions_tenant").on(table.tenantId),
    idxModelVersionsStatus: index("idx_model_versions_status").on(table.status),
    idxModelVersionsActive: index("idx_model_versions_active").on(table.isActive),
    idxModelVersionsVersion: index("idx_model_versions_version").on(table.version),
  })
);

// ============================================================================
// AUTO-LEARNING SCHEDULE
// ============================================================================

export const autoLearningSchedule = pgTable(
  "auto_learning_schedule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    scheduleType: varchar("schedule_type", { length: 50 }).notNull(),
    status: autoLearningScheduleStatusEnum("status").default("scheduled"),
    scheduledFor: timestamp("scheduled_for").notNull(),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    modelVersionId: uuid("model_version_id").references(() => modelVersions.id),
    dataCollected: integer("data_collected").default(0),
    imagesCollected: integer("images_collected").default(0),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata").$type<GenericMetadata>().default({}),
    criadoEm: timestamp("criado_em").defaultNow(),
  },
  (table) => ({
    idxAutoLearningTenant: index("idx_auto_learning_tenant").on(table.tenantId),
    idxAutoLearningStatus: index("idx_auto_learning_status").on(table.status),
    idxAutoLearningScheduled: index("idx_auto_learning_scheduled").on(table.scheduledFor),
  })
);

// ============================================================================
// INSERT SCHEMAS (drizzle-zod)
// ============================================================================

export const insertTrainingDataSchema = createInsertSchema(trainingData).omit({
  id: true,
  criadoEm: true,
  processadoEm: true,
});
export type InsertTrainingData = z.infer<typeof insertTrainingDataSchema>;
export type TrainingData = typeof trainingData.$inferSelect;

export const insertFineTuningJobSchema = createInsertSchema(fineTuningJobs).omit({
  id: true,
  criadoEm: true,
});
export type InsertFineTuningJob = z.infer<typeof insertFineTuningJobSchema>;
export type FineTuningJob = typeof fineTuningJobs.$inferSelect;

export const insertModelVersionSchema = createInsertSchema(modelVersions).omit({
  id: true,
  criadoEm: true,
});
export type InsertModelVersion = z.infer<typeof insertModelVersionSchema>;
export type ModelVersion = typeof modelVersions.$inferSelect;

export const insertAutoLearningScheduleSchema = createInsertSchema(autoLearningSchedule).omit({
  id: true,
  criadoEm: true,
});
export type InsertAutoLearningSchedule = z.infer<typeof insertAutoLearningScheduleSchema>;
export type AutoLearningSchedule = typeof autoLearningSchedule.$inferSelect;
