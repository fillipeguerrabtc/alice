/**
 * Testes de Schema - Validação de estruturas Drizzle
 * Fase 1 Passo 1.3 - Alice Enterprise Platform
 * 
 * Valida:
 * - Enums RBAC (6 níveis de permissão)
 * - Tabelas principais e suas colunas
 * - Insert schemas e validação Zod
 * - Tipos exportados
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  // Enums
  userRoleEnum,
  messageTypeEnum,
  conversationStatusEnum,
  agentStatusEnum,
  taskStatusEnum,
  trainingDataStatusEnum,
  fineTuningJobStatusEnum,
  conversationControlModeEnum,
  escalationTriggerEnum,
  messageOriginEnum,
  // Tabelas
  tenants,
  users,
  permissions,
  rolePermissions,
  namespaces,
  agents,
  conversations,
  messages,
  documents,
  documentChunks,
  learningTasks,
  integrations,
  llmConfig,
  auditLogs,
  usageMetrics,
  trainingData,
  fineTuningJobs,
  conversationStates,
  conversationParticipants,
  conversationEscalations,
  generatedImages,
  modelVersions,
  autoLearningSchedule,
  mediaUploads,
  // Insert Schemas
  insertTenantSchema,
  insertUserSchema,
  insertNamespaceSchema,
  insertAgentSchema,
  insertConversationSchema,
  insertMessageSchema,
  insertDocumentSchema,
  insertIntegrationSchema,
  insertLlmConfigSchema,
  insertMediaUploadSchema,
  insertTrainingDataSchema,
  insertFineTuningJobSchema,
  insertUsageMetricSchema,
  insertConversationStateSchema,
  insertConversationParticipantSchema,
  insertConversationEscalationSchema,
  insertGeneratedImageSchema,
} from '@shared/schema';

// ============================================================================
// TESTES DE ENUMS
// ============================================================================

describe('Schema - Enums RBAC', () => {
  describe('userRoleEnum (6 níveis de permissão)', () => {
    it('deve ter exatamente 6 roles na hierarquia correta', () => {
      const roles = userRoleEnum.enumValues;
      expect(roles).toHaveLength(6);
      expect(roles).toEqual([
        'super_admin',
        'admin',
        'manager',
        'operator',
        'viewer',
        'guest',
      ]);
    });

    it('deve ter super_admin como role mais privilegiado', () => {
      expect(userRoleEnum.enumValues[0]).toBe('super_admin');
    });

    it('deve ter guest como role menos privilegiado', () => {
      const roles = userRoleEnum.enumValues;
      expect(roles[roles.length - 1]).toBe('guest');
    });
  });

  // ATUALIZADO 23/12/2025: Removido 'video' (muito pesado para GPU)
  describe('messageTypeEnum (Multimodal)', () => {
    it('deve suportar todos os tipos de mídia multimodal', () => {
      const types = messageTypeEnum.enumValues;
      expect(types).toContain('text');
      expect(types).toContain('image');
      expect(types).toContain('audio');
      expect(types).toContain('document');
      expect(types).toContain('mixed');
    });
  });

  describe('conversationStatusEnum', () => {
    it('deve ter status válidos de conversa', () => {
      const statuses = conversationStatusEnum.enumValues;
      expect(statuses).toEqual(['active', 'archived', 'deleted']);
    });
  });

  describe('agentStatusEnum', () => {
    it('deve ter status válidos de agente', () => {
      const statuses = agentStatusEnum.enumValues;
      expect(statuses).toContain('active');
      expect(statuses).toContain('training');
      expect(statuses).toContain('paused');
      expect(statuses).toContain('deprecated');
    });
  });

  describe('taskStatusEnum', () => {
    it('deve ter status válidos de tarefa', () => {
      const statuses = taskStatusEnum.enumValues;
      expect(statuses).toEqual(['pending', 'processing', 'completed', 'failed', 'cancelled']);
    });
  });

  describe('trainingDataStatusEnum', () => {
    it('deve ter status válidos de dados de treinamento', () => {
      const statuses = trainingDataStatusEnum.enumValues;
      expect(statuses).toEqual(['pending', 'approved', 'rejected', 'used']);
    });
  });

  describe('fineTuningJobStatusEnum', () => {
    it('deve ter status válidos de job de fine-tuning', () => {
      const statuses = fineTuningJobStatusEnum.enumValues;
      expect(statuses).toContain('pending');
      expect(statuses).toContain('preparing');
      expect(statuses).toContain('training');
      expect(statuses).toContain('validating');
      expect(statuses).toContain('completed');
      expect(statuses).toContain('failed');
      expect(statuses).toContain('cancelled');
    });
  });

  describe('conversationControlModeEnum (Takeover/Handover)', () => {
    it('deve ter modos válidos de controle de conversa', () => {
      const modes = conversationControlModeEnum.enumValues;
      expect(modes).toContain('bot');
      expect(modes).toContain('human');
      expect(modes).toContain('pending_handoff');
      expect(modes).toContain('hybrid');
    });
  });

  describe('escalationTriggerEnum', () => {
    it('deve ter triggers válidos de escalação', () => {
      const triggers = escalationTriggerEnum.enumValues;
      expect(triggers).toContain('low_confidence');
      expect(triggers).toContain('fallback_count');
      expect(triggers).toContain('negative_sentiment');
      expect(triggers).toContain('keyword_match');
      expect(triggers).toContain('manual_request');
      expect(triggers).toContain('sla_breach');
    });
  });
});

// ============================================================================
// TESTES DE TABELAS PRINCIPAIS
// ============================================================================

describe('Schema - Tabelas Principais', () => {
  describe('tenants (Multi-tenant Enterprise)', () => {
    it('deve ter campos obrigatórios de tenant', () => {
      const columns = Object.keys(tenants);
      expect(columns).toContain('id');
      expect(columns).toContain('nome');
      expect(columns).toContain('slug');
      expect(columns).toContain('plano');
      expect(columns).toContain('ativo');
    });

    it('deve ter campos de configuração', () => {
      const columns = Object.keys(tenants);
      expect(columns).toContain('configuracoes');
      expect(columns).toContain('limiteUsuarios');
      expect(columns).toContain('limiteConversas');
      expect(columns).toContain('limiteArmazenamento');
    });
  });

  describe('users (Autenticação Multi-provedor)', () => {
    it('deve ter campos de autenticação OAuth/SAML/Local', () => {
      const columns = Object.keys(users);
      expect(columns).toContain('id');
      expect(columns).toContain('email');
      expect(columns).toContain('passwordHash');
      expect(columns).toContain('authProvider');
      expect(columns).toContain('authProviderId');
    });

    it('deve ter campos de RBAC', () => {
      const columns = Object.keys(users);
      expect(columns).toContain('role');
      expect(columns).toContain('tenantId');
    });

    it('deve ter campos de Stripe', () => {
      const columns = Object.keys(users);
      expect(columns).toContain('stripeCustomerId');
      expect(columns).toContain('stripeSubscriptionId');
    });

    it('deve ter campos de localização', () => {
      const columns = Object.keys(users);
      expect(columns).toContain('idioma');
      expect(columns).toContain('timezone');
    });
  });

  describe('permissions (RBAC Enterprise)', () => {
    it('deve ter campos de permissão', () => {
      const columns = Object.keys(permissions);
      expect(columns).toContain('id');
      expect(columns).toContain('codigo');
      expect(columns).toContain('nome');
      expect(columns).toContain('modulo');
    });
  });

  describe('agents (IA Especializada)', () => {
    it('deve ter campos de configuração de LLM', () => {
      const columns = Object.keys(agents);
      expect(columns).toContain('modeloBase');
      expect(columns).toContain('temperaturaModelo');
      expect(columns).toContain('maxTokens');
    });

    it('deve ter campos de personalização', () => {
      const columns = Object.keys(agents);
      expect(columns).toContain('personalidade');
      expect(columns).toContain('instrucoes');
      expect(columns).toContain('capacidades');
    });
  });

  describe('conversations', () => {
    it('deve ter campos de relação', () => {
      const columns = Object.keys(conversations);
      expect(columns).toContain('userId');
      expect(columns).toContain('agentId');
      expect(columns).toContain('namespaceId');
    });

    it('deve ter campos de status', () => {
      const columns = Object.keys(conversations);
      expect(columns).toContain('status');
      expect(columns).toContain('totalMensagens');
      expect(columns).toContain('ultimaMensagemEm');
    });
  });

  describe('messages (Multimodal)', () => {
    it('deve ter campos multimodal', () => {
      const columns = Object.keys(messages);
      expect(columns).toContain('tipo');
      expect(columns).toContain('conteudo');
      expect(columns).toContain('anexos');
    });

    it('deve ter campos de métricas', () => {
      const columns = Object.keys(messages);
      expect(columns).toContain('tokensUsados');
      expect(columns).toContain('latenciaMs');
    });
  });

  describe('documents (Base de Conhecimento RAG)', () => {
    it('deve ter campos de RAG', () => {
      const columns = Object.keys(documents);
      expect(columns).toContain('embedding');
      expect(columns).toContain('hashConteudo');
      expect(columns).toContain('semhash');
    });
  });

  describe('documentChunks', () => {
    it('deve ter campos de chunking', () => {
      const columns = Object.keys(documentChunks);
      expect(columns).toContain('documentId');
      expect(columns).toContain('conteudo');
      expect(columns).toContain('posicao');
      expect(columns).toContain('embedding');
    });
  });

  // ARQUITETURA 16/01/2026: LLM texto Qwen2.5 7B
  describe('llmConfig (Qwen2.5 7B)', () => {
    it('deve ter configuração de modelo LLM', () => {
      const columns = Object.keys(llmConfig);
      expect(columns).toContain('modelo');
      expect(columns).toContain('endpoint');
      expect(columns).toContain('maxTokens');
      expect(columns).toContain('temperatura');
      expect(columns).toContain('topP');
    });
  });

  describe('auditLogs (Enterprise Compliance)', () => {
    it('deve ter campos de auditoria', () => {
      const columns = Object.keys(auditLogs);
      expect(columns).toContain('tenantId');
      expect(columns).toContain('userId');
      expect(columns).toContain('acao');
      expect(columns).toContain('recurso');
      expect(columns).toContain('ip');
      expect(columns).toContain('userAgent');
    });
  });

  describe('usageMetrics', () => {
    it('deve ter campos de métricas de uso', () => {
      const columns = Object.keys(usageMetrics);
      expect(columns).toContain('totalMensagens');
      expect(columns).toContain('totalTokens');
      expect(columns).toContain('tokensPrompt');
      expect(columns).toContain('tokensCompletion');
      expect(columns).toContain('responseTime');
    });
  });

  describe('trainingData (Auto-evolução)', () => {
    it('deve ter campos de deduplicação SemHash', () => {
      const columns = Object.keys(trainingData);
      expect(columns).toContain('semhash');
      expect(columns).toContain('embedding');
      expect(columns).toContain('isDuplicate');
      expect(columns).toContain('similarityScore');
    });
  });

  describe('fineTuningJobs', () => {
    it('deve ter campos de GPU Manager Service (migração)', () => {
      const columns = Object.keys(fineTuningJobs);
      expect(columns).toContain('containerGroupId');
      expect(columns).toContain('baseModel');
      expect(columns).toContain('hyperparameters');
      expect(columns).toContain('metrics');
    });
  });

  describe('conversationStates (Takeover/Handover)', () => {
    it('deve ter campos de controle de conversa', () => {
      const columns = Object.keys(conversationStates);
      expect(columns).toContain('conversationId');
      expect(columns).toContain('controlMode');
      expect(columns).toContain('assignedAgentId');
      expect(columns).toContain('slaDeadline');
      expect(columns).toContain('fallbackCount');
      expect(columns).toContain('sentimentScore');
    });
  });

  describe('mediaUploads (embeddings de texto)', () => {
    it('deve ter campos de embedding de texto', () => {
      const columns = Object.keys(mediaUploads);
      expect(columns).toContain('textEmbedding');
      expect(columns).toContain('mediaType');
      expect(columns).toContain('filePath');
      expect(columns).toContain('fileSize');
    });
  });
});

// ============================================================================
// TESTES DE INSERT SCHEMAS
// ============================================================================

describe('Schema - Insert Schemas (Zod Validation)', () => {
  describe('insertTenantSchema', () => {
    it('deve ser um schema Zod válido', () => {
      expect(insertTenantSchema).toBeDefined();
      expect(insertTenantSchema._def).toBeDefined();
    });

    it('deve aceitar dados válidos de tenant', () => {
      const validTenant = {
        nome: 'Empresa Teste',
        slug: 'empresa-teste',
        plano: 'enterprise',
      };
      const result = insertTenantSchema.safeParse(validTenant);
      expect(result.success).toBe(true);
    });

    it('deve rejeitar tenant sem nome', () => {
      const invalidTenant = {
        slug: 'empresa-teste',
      };
      const result = insertTenantSchema.safeParse(invalidTenant);
      expect(result.success).toBe(false);
    });
  });

  describe('insertUserSchema', () => {
    it('deve ser um schema Zod válido', () => {
      expect(insertUserSchema).toBeDefined();
    });

    it('deve aceitar dados válidos de usuário', () => {
      const validUser = {
        email: 'user@test.com',
        firstName: 'Test',
        lastName: 'User',
        role: 'viewer',
      };
      const result = insertUserSchema.safeParse(validUser);
      expect(result.success).toBe(true);
    });
  });

  describe('insertAgentSchema', () => {
    it('deve ser um schema Zod válido', () => {
      expect(insertAgentSchema).toBeDefined();
    });

    it('deve aceitar dados válidos de agente', () => {
      // ARQUITETURA 16/01/2026: LLM texto Qwen2.5 7B
      const validAgent = {
        nome: 'Agente Vendas',
        slug: 'agente-vendas',
        modeloBase: 'Qwen2.5-7B-Instruct-AWQ',
      };
      const result = insertAgentSchema.safeParse(validAgent);
      expect(result.success).toBe(true);
    });
  });

  describe('insertMessageSchema', () => {
    it('deve ser um schema Zod válido', () => {
      expect(insertMessageSchema).toBeDefined();
    });
  });

  describe('insertDocumentSchema', () => {
    it('deve ser um schema Zod válido', () => {
      expect(insertDocumentSchema).toBeDefined();
    });

    it('deve aceitar dados válidos de documento', () => {
      const validDoc = {
        titulo: 'Manual do Usuário',
        conteudo: 'Conteúdo do manual...',
        tipo: 'pdf',
      };
      const result = insertDocumentSchema.safeParse(validDoc);
      expect(result.success).toBe(true);
    });
  });

  describe('insertLlmConfigSchema', () => {
    it('deve ser um schema Zod válido', () => {
      expect(insertLlmConfigSchema).toBeDefined();
    });

    it('deve aceitar configuração de LLM', () => {
      const validConfig = {
        // Gate 2: modelo LLM (texto) padrão
        modelo: 'Qwen2.5-7B-Instruct-AWQ',
        endpoint: 'http://alice-gpu-manager:3010/v1/chat',
        maxTokens: 2048,
        temperatura: 0.7,
      };
      const result = insertLlmConfigSchema.safeParse(validConfig);
      expect(result.success).toBe(true);
    });
  });

  describe('insertTrainingDataSchema', () => {
    it('deve ser um schema Zod válido', () => {
      expect(insertTrainingDataSchema).toBeDefined();
    });
  });

  describe('insertFineTuningJobSchema', () => {
    it('deve ser um schema Zod válido', () => {
      expect(insertFineTuningJobSchema).toBeDefined();
    });
  });

  describe('insertConversationStateSchema', () => {
    it('deve ser um schema Zod válido', () => {
      expect(insertConversationStateSchema).toBeDefined();
    });
  });

  describe('insertMediaUploadSchema', () => {
    it('deve ser um schema Zod válido', () => {
      expect(insertMediaUploadSchema).toBeDefined();
    });
  });
});

// ============================================================================
// TESTES DE INTEGRIDADE ESTRUTURAL
// ============================================================================

describe('Schema - Integridade Estrutural', () => {
  describe('Multi-tenancy', () => {
    it('tabelas principais devem ter referência a tenantId', () => {
      expect(Object.keys(users)).toContain('tenantId');
      expect(Object.keys(namespaces)).toContain('tenantId');
      expect(Object.keys(integrations)).toContain('tenantId');
      expect(Object.keys(auditLogs)).toContain('tenantId');
      expect(Object.keys(usageMetrics)).toContain('tenantId');
      expect(Object.keys(trainingData)).toContain('tenantId');
      expect(Object.keys(fineTuningJobs)).toContain('tenantId');
      expect(Object.keys(llmConfig)).toContain('tenantId');
    });
  });

  describe('Timestamps', () => {
    it('tabelas principais devem ter campos de timestamp', () => {
      expect(Object.keys(tenants)).toContain('criadoEm');
      expect(Object.keys(tenants)).toContain('atualizadoEm');
      expect(Object.keys(users)).toContain('createdAt');
      expect(Object.keys(users)).toContain('updatedAt');
      expect(Object.keys(messages)).toContain('criadoEm');
      expect(Object.keys(documents)).toContain('criadoEm');
      expect(Object.keys(auditLogs)).toContain('criadoEm');
    });
  });

  describe('Soft Delete', () => {
    it('tabelas com soft delete devem ter campo ativo', () => {
      expect(Object.keys(tenants)).toContain('ativo');
      expect(Object.keys(users)).toContain('ativo');
      expect(Object.keys(namespaces)).toContain('ativo');
      expect(Object.keys(integrations)).toContain('ativo');
      expect(Object.keys(llmConfig)).toContain('ativo');
    });
  });

  describe('pgvector (HNSW Indices)', () => {
    it('tabelas RAG devem ter campo embedding para pgvector', () => {
      expect(Object.keys(documents)).toContain('embedding');
      expect(Object.keys(documentChunks)).toContain('embedding');
      expect(Object.keys(trainingData)).toContain('embedding');
    });

    it('mediaUploads deve ter embedding de texto', () => {
      expect(Object.keys(mediaUploads)).toContain('textEmbedding');
    });
  });

  describe('Deduplicação SemHash', () => {
    it('tabelas relevantes devem ter campo semhash', () => {
      expect(Object.keys(documents)).toContain('semhash');
      expect(Object.keys(trainingData)).toContain('semhash');
    });
  });
});

