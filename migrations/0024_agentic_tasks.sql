-- ============================================================================
-- MIGRAÇÃO: Agentic Tasks (Documentos/Relatórios/Contabilidade/Planejamento)
-- Descrição: Adiciona tipos de action_request e cria tabela agentic_tasks
-- Regra 6: Persistência real em PostgreSQL (zero workarounds/mocks)
--
-- Autor: Fillipe Guerra
-- Data: 21 de Janeiro de 2026
-- Versão: 1.0
-- ============================================================================

-- ============================================================================
-- 1) ENUMS - action_request_type (novos tipos)
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'action_request_type' AND e.enumlabel = 'document'
  ) THEN
    ALTER TYPE action_request_type ADD VALUE 'document';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'action_request_type' AND e.enumlabel = 'report'
  ) THEN
    ALTER TYPE action_request_type ADD VALUE 'report';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'action_request_type' AND e.enumlabel = 'accounting'
  ) THEN
    ALTER TYPE action_request_type ADD VALUE 'accounting';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'action_request_type' AND e.enumlabel = 'planning'
  ) THEN
    ALTER TYPE action_request_type ADD VALUE 'planning';
  END IF;
END$$;

-- ============================================================================
-- 2) ENUM agentic_task_type (idempotente)
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agentic_task_type') THEN
    CREATE TYPE agentic_task_type AS ENUM ('document', 'report', 'accounting', 'planning');
    RAISE NOTICE 'Enum agentic_task_type criado';
  ELSE
    RAISE NOTICE 'Enum agentic_task_type já existe';
  END IF;
END$$;

-- ============================================================================
-- 3) TABELA agentic_tasks (idempotente)
-- ============================================================================
CREATE TABLE IF NOT EXISTS agentic_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  conversation_id UUID NULL REFERENCES conversations(id) ON DELETE SET NULL,
  action_request_id UUID NULL REFERENCES action_requests(id) ON DELETE SET NULL,
  user_id UUID NULL REFERENCES users(id),
  agent_id UUID NULL REFERENCES agents(id),
  type agentic_task_type NOT NULL,
  status task_status NOT NULL DEFAULT 'pending',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB NULL,
  error TEXT NULL,
  started_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 4) INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_agentic_tasks_tenant ON agentic_tasks (tenant_id);
CREATE INDEX IF NOT EXISTS idx_agentic_tasks_status ON agentic_tasks (tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_agentic_tasks_type ON agentic_tasks (tenant_id, type);
CREATE INDEX IF NOT EXISTS idx_agentic_tasks_conversation ON agentic_tasks (conversation_id);
CREATE INDEX IF NOT EXISTS idx_agentic_tasks_action_request ON agentic_tasks (action_request_id);

-- ============================================================================
-- 5) ROW LEVEL SECURITY (RLS)
-- ============================================================================
ALTER TABLE agentic_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agentic_tasks_tenant_isolation ON agentic_tasks;
CREATE POLICY agentic_tasks_tenant_isolation ON agentic_tasks
  FOR ALL
  USING (is_super_admin() OR tenant_id = current_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id = current_tenant_id());

-- ============================================================================
-- Documento em Português Brasileiro
-- Autor: Fillipe Guerra
-- Data: 21 de Janeiro de 2026
-- Versão: 1.0
-- ============================================================================
