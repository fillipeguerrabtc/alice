-- ============================================================================
-- MIGRAÇÃO: Action Requests - Foreign Keys (aplica em bases existentes)
-- Descrição: Adiciona constraints FK faltantes em action_requests de forma
--            idempotente (checando pg_constraint).
-- Regra 6: Persistência real em PostgreSQL (zero workarounds/mocks)
--
-- Autor: Fillipe Guerra
-- Data: 20 de Janeiro de 2026
-- Versão: 1.0
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'action_requests'::regclass
      AND contype = 'f'
      AND confrelid = 'tenants'::regclass
      AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'action_requests'::regclass AND attname = 'tenant_id')]::smallint[]
  ) THEN
    ALTER TABLE action_requests
      ADD CONSTRAINT fk_action_requests_tenant_id
      FOREIGN KEY (tenant_id) REFERENCES tenants(id);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'action_requests'::regclass
      AND contype = 'f'
      AND confrelid = 'conversations'::regclass
      AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'action_requests'::regclass AND attname = 'conversation_id')]::smallint[]
  ) THEN
    ALTER TABLE action_requests
      ADD CONSTRAINT fk_action_requests_conversation_id
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'action_requests'::regclass
      AND contype = 'f'
      AND confrelid = 'users'::regclass
      AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'action_requests'::regclass AND attname = 'user_id')]::smallint[]
  ) THEN
    ALTER TABLE action_requests
      ADD CONSTRAINT fk_action_requests_user_id
      FOREIGN KEY (user_id) REFERENCES users(id);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'action_requests'::regclass
      AND contype = 'f'
      AND confrelid = 'agents'::regclass
      AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'action_requests'::regclass AND attname = 'agent_id')]::smallint[]
  ) THEN
    ALTER TABLE action_requests
      ADD CONSTRAINT fk_action_requests_agent_id
      FOREIGN KEY (agent_id) REFERENCES agents(id);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'action_requests'::regclass
      AND contype = 'f'
      AND confrelid = 'users'::regclass
      AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'action_requests'::regclass AND attname = 'resolved_by')]::smallint[]
  ) THEN
    ALTER TABLE action_requests
      ADD CONSTRAINT fk_action_requests_resolved_by
      FOREIGN KEY (resolved_by) REFERENCES users(id);
  END IF;
END$$;

-- ============================================================================
-- Documento em Português Brasileiro
-- Autor: Fillipe Guerra
-- Data: 20 de Janeiro de 2026
-- Versão: 1.0
-- ============================================================================
