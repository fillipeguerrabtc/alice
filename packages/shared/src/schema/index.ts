/**
 * Schema Barrel Export - Alice Enterprise Platform
 * 
 * Re-exporta todos os módulos do schema para manter
 * compatibilidade com imports existentes.
 * 
 * Uso: import { tenants, users, conversations } from '@alice/shared/schema'
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 * TypeScript strict (Regra 8 CLAUDE.md)
 * 
 * @module @alice/shared/schema
 */

// ============================================================================
// SHARED ZOD SCHEMAS
// ============================================================================

export * from "./shared-zod.js";

// ============================================================================
// ENUMS
// ============================================================================

export * from "./enums.js";

// ============================================================================
// CORE (tenants, users, sessions, permissions, oauth, oidc, feature flags)
// ============================================================================

export * from "./core.js";

// ============================================================================
// RAG (namespaces, agents, documents, chunks)
// ============================================================================

export * from "./rag.js";

// ============================================================================
// CHAT (conversations, messages, handover/takeover)
// ============================================================================

export * from "./chat.js";

// ============================================================================
// TRAINING (training data, fine-tuning, model versions, auto-learning)
// ============================================================================

export * from "./training.js";

// ============================================================================
// INTEGRATIONS (integrations, audit logs, webhooks, stripe-erpnext, wise)
// ============================================================================

export * from "./integrations.js";

// ============================================================================
// MEDIA (generated images, media uploads)
// ============================================================================

export * from "./media.js";

// ============================================================================
// RELATIONS
// ============================================================================

export * from "./relations.js";
