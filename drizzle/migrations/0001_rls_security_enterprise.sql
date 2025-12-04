-- ============================================================================
-- MIGRAÇÃO: Row Level Security (RLS) Enterprise-Grade
-- Documentação: PostgreSQL 17 Security Hardening + OWASP API1/API5
-- ============================================================================

-- ============================================================================
-- 1. EXTENSÕES NECESSÁRIAS
-- ============================================================================

-- pgvector para embeddings (já instalado na imagem pgvector/pgvector)
CREATE EXTENSION IF NOT EXISTS vector;

-- NOTA: pgaudit removido - não disponível na imagem pgvector/pgvector:pg16
-- Para audit logging, usar logs nativos do PostgreSQL ou aplicar audit no nível da aplicação

-- ============================================================================
-- 2. ÍNDICES TENANT_ID (GAP-PG-002)
-- Cria índices compostos para performance em queries multi-tenant
-- NOTA: Usa DO blocks para verificar se tabelas existem antes de criar índices
-- ============================================================================

-- Função auxiliar para criar índice se tabela existir
DO $$
BEGIN
  -- Namespaces
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'namespaces') THEN
    CREATE INDEX IF NOT EXISTS idx_namespaces_tenant_slug ON namespaces(tenant_id, slug);
  END IF;

  -- Conversations
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'conversations') THEN
    CREATE INDEX IF NOT EXISTS idx_conversations_namespace_user ON conversations(namespace_id, user_id);
  END IF;

  -- Documents
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'documents') THEN
    CREATE INDEX IF NOT EXISTS idx_documents_namespace_processado ON documents(namespace_id, processado);
  END IF;

  -- Training Data
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'training_data') THEN
    CREATE INDEX IF NOT EXISTS idx_training_tenant_status_created ON training_data(tenant_id, status, criado_em DESC);
  END IF;

  -- Fine-tuning Jobs
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'fine_tuning_jobs') THEN
    CREATE INDEX IF NOT EXISTS idx_finetuning_tenant_status_created ON fine_tuning_jobs(tenant_id, status, criado_em DESC);
  END IF;

  -- Integrations
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'integrations') THEN
    CREATE INDEX IF NOT EXISTS idx_integrations_tenant_tipo_ativo ON integrations(tenant_id, tipo, ativo);
  END IF;

  -- Audit Logs
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_logs') THEN
    CREATE INDEX IF NOT EXISTS idx_audit_tenant_created_acao ON audit_logs(tenant_id, criado_em DESC, acao);
  END IF;

  -- Usage Metrics
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'usage_metrics') THEN
    CREATE INDEX IF NOT EXISTS idx_usage_tenant_data_type ON usage_metrics(tenant_id, data DESC, type);
  END IF;

  -- LLM Config
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'llm_config') THEN
    CREATE INDEX IF NOT EXISTS idx_llm_config_tenant_ativo ON llm_config(tenant_id, ativo);
  END IF;

  -- Wise Sync Log
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'wise_sync_log') THEN
    CREATE INDEX IF NOT EXISTS idx_wise_sync_tenant_status ON wise_sync_log(tenant_id, status);
  END IF;
END $$;

-- ============================================================================
-- 3. ROW LEVEL SECURITY (RLS) - GAP-PG-001
-- Políticas de isolamento multi-tenant OWASP API1/API5
-- ============================================================================

-- Função auxiliar para obter tenant_id da sessão atual
CREATE OR REPLACE FUNCTION current_tenant_id() 
RETURNS uuid AS $$
BEGIN
  RETURN NULLIF(current_setting('app.current_tenant_id', true), '')::uuid;
EXCEPTION
  WHEN others THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Função auxiliar para verificar se usuário é super_admin
CREATE OR REPLACE FUNCTION is_super_admin() 
RETURNS boolean AS $$
BEGIN
  RETURN COALESCE(current_setting('app.is_super_admin', true)::boolean, false);
EXCEPTION
  WHEN others THEN
    RETURN false;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================================
-- 3. ROW LEVEL SECURITY (RLS) - Aplicação Condicional
-- Verifica se tabelas existem antes de aplicar RLS
-- ============================================================================

DO $$
BEGIN
  -- TABELA: users
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
    ALTER TABLE users ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS users_tenant_isolation ON users;
    CREATE POLICY users_tenant_isolation ON users
      FOR ALL
      USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
      WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());
    RAISE NOTICE 'RLS aplicado em users';
  END IF;

  -- TABELA: namespaces
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'namespaces') THEN
    ALTER TABLE namespaces ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS namespaces_tenant_isolation ON namespaces;
    CREATE POLICY namespaces_tenant_isolation ON namespaces
      FOR ALL
      USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
      WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());
    RAISE NOTICE 'RLS aplicado em namespaces';
  END IF;

  -- TABELA: integrations
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'integrations') THEN
    ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS integrations_tenant_isolation ON integrations;
    CREATE POLICY integrations_tenant_isolation ON integrations
      FOR ALL
      USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
      WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());
    RAISE NOTICE 'RLS aplicado em integrations';
  END IF;

  -- TABELA: training_data
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'training_data') THEN
    ALTER TABLE training_data ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS training_data_tenant_isolation ON training_data;
    CREATE POLICY training_data_tenant_isolation ON training_data
      FOR ALL
      USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
      WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());
    RAISE NOTICE 'RLS aplicado em training_data';
  END IF;

  -- TABELA: fine_tuning_jobs
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'fine_tuning_jobs') THEN
    ALTER TABLE fine_tuning_jobs ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS fine_tuning_jobs_tenant_isolation ON fine_tuning_jobs;
    CREATE POLICY fine_tuning_jobs_tenant_isolation ON fine_tuning_jobs
      FOR ALL
      USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
      WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());
    RAISE NOTICE 'RLS aplicado em fine_tuning_jobs';
  END IF;

  -- TABELA: audit_logs
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_logs') THEN
    ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS audit_logs_tenant_isolation ON audit_logs;
    CREATE POLICY audit_logs_tenant_isolation ON audit_logs
      FOR ALL
      USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
      WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());
    RAISE NOTICE 'RLS aplicado em audit_logs';
  END IF;

  -- TABELA: usage_metrics
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'usage_metrics') THEN
    ALTER TABLE usage_metrics ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS usage_metrics_tenant_isolation ON usage_metrics;
    CREATE POLICY usage_metrics_tenant_isolation ON usage_metrics
      FOR ALL
      USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
      WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());
    RAISE NOTICE 'RLS aplicado em usage_metrics';
  END IF;

  -- TABELA: llm_config
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'llm_config') THEN
    ALTER TABLE llm_config ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS llm_config_tenant_isolation ON llm_config;
    CREATE POLICY llm_config_tenant_isolation ON llm_config
      FOR ALL
      USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
      WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());
    RAISE NOTICE 'RLS aplicado em llm_config';
  END IF;

  -- TABELA: wise_sync_log
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'wise_sync_log') THEN
    ALTER TABLE wise_sync_log ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS wise_sync_log_tenant_isolation ON wise_sync_log;
    CREATE POLICY wise_sync_log_tenant_isolation ON wise_sync_log
      FOR ALL
      USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
      WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());
    RAISE NOTICE 'RLS aplicado em wise_sync_log';
  END IF;
END $$;

-- ============================================================================
-- 4. AUDIT LOGGING (Via PostgreSQL nativo)
-- NOTA: pgaudit removido - usando log_statement nativo
-- ============================================================================

-- Configurar logging nativo do PostgreSQL para audit
-- Estas configurações são aplicadas via postgresql.conf ou variáveis de ambiente
-- ALTER SYSTEM SET log_statement = 'mod';  -- Log INSERT/UPDATE/DELETE
-- ALTER SYSTEM SET log_min_duration_statement = 1000;  -- Log queries > 1s

-- ============================================================================
-- 5. GRANT MÍNIMO NECESSÁRIO (Least Privilege)
-- ============================================================================

-- Revogar permissões públicas
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

-- Criar role para aplicação Alice
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'alice_app') THEN
    CREATE ROLE alice_app NOLOGIN;
  END IF;
END
$$;

-- Grant necessário para alice_app
GRANT USAGE ON SCHEMA public TO alice_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO alice_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO alice_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO alice_app;

-- Grants futuros automáticos
ALTER DEFAULT PRIVILEGES IN SCHEMA public 
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO alice_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public 
  GRANT USAGE, SELECT ON SEQUENCES TO alice_app;

-- ============================================================================
-- DOCUMENTAÇÃO
-- ============================================================================
COMMENT ON FUNCTION current_tenant_id() IS 'Retorna o tenant_id da sessão atual (app.current_tenant_id)';
COMMENT ON FUNCTION is_super_admin() IS 'Verifica se usuário atual é super_admin (app.is_super_admin)';

-- ============================================================================
-- Documento em Português Brasileiro
-- Atualizado: Novembro 2025
-- Versão: 1.0 - RLS Enterprise-Grade
-- ============================================================================
