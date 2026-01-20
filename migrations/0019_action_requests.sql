-- ============================================================================
-- MIGRAÇÃO: Action Requests (Confirmação de ações críticas)
-- Descrição: Cria tabela action_requests para confirmar e auditar ações críticas
--            (ex: trading), com status e payload persistidos.
-- Regra 6: Persistência real em PostgreSQL (zero workarounds/mocks)
--
-- Autor: Fillipe Guerra
-- Data: 18 de Janeiro de 2026
-- Versão: 1.0
-- ============================================================================

-- ============================================================================
-- 1) ENUMS (idempotente)
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'action_request_type') THEN
    CREATE TYPE action_request_type AS ENUM ('trading', 'integration');
    RAISE NOTICE 'Enum action_request_type criado';
  ELSE
    RAISE NOTICE 'Enum action_request_type já existe';
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'action_request_status') THEN
    CREATE TYPE action_request_status AS ENUM ('pending', 'approved', 'rejected', 'executed', 'failed', 'cancelled');
    RAISE NOTICE 'Enum action_request_status criado';
  ELSE
    RAISE NOTICE 'Enum action_request_status já existe';
  END IF;
END$$;

-- ============================================================================
-- 2) TABELA action_requests (idempotente)
-- ============================================================================
CREATE TABLE IF NOT EXISTS action_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  conversation_id UUID NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NULL REFERENCES users(id),
  agent_id UUID NULL REFERENCES agents(id),
  type action_request_type NOT NULL,
  status action_request_status NOT NULL DEFAULT 'pending',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolved_by UUID NULL REFERENCES users(id),
  resolution_note TEXT NULL,
  criado_em TIMESTAMP DEFAULT NOW(),
  atualizado_em TIMESTAMP DEFAULT NOW(),
  resolvido_em TIMESTAMP NULL
);

-- ============================================================================
-- 3) INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_action_requests_tenant ON action_requests (tenant_id);
CREATE INDEX IF NOT EXISTS idx_action_requests_conversation ON action_requests (conversation_id);
CREATE INDEX IF NOT EXISTS idx_action_requests_status ON action_requests (tenant_id, status, criado_em);

-- ============================================================================
-- 4) ROW LEVEL SECURITY (RLS)
-- ============================================================================
ALTER TABLE action_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS action_requests_tenant_isolation ON action_requests;
CREATE POLICY action_requests_tenant_isolation ON action_requests
  FOR ALL
  USING (is_super_admin() OR tenant_id = current_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id = current_tenant_id());

-- ============================================================================
-- Documento em Português Brasileiro
-- Autor: Fillipe Guerra
-- Data: 18 de Janeiro de 2026
-- Versão: 1.0
-- ============================================================================
