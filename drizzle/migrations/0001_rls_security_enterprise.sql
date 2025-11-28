-- ============================================================================
-- MIGRAÇÃO: Row Level Security (RLS) Enterprise-Grade
-- Documentação: PostgreSQL 17 Security Hardening + OWASP API1/API5
-- Referência: docs/DOCUMENTACAO-2025.md - GAP-PG-001/002/003
-- ============================================================================

-- ============================================================================
-- 1. EXTENSÕES NECESSÁRIAS
-- ============================================================================

-- pgAudit para audit logging (GAP-PG-004)
CREATE EXTENSION IF NOT EXISTS pgaudit;

-- pgvector para embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- 2. ÍNDICES TENANT_ID (GAP-PG-002)
-- Cria índices compostos para performance em queries multi-tenant
-- NOTA: Removido CONCURRENTLY para compatibilidade com migrations transacionais
-- ============================================================================

-- Namespaces
CREATE INDEX IF NOT EXISTS idx_namespaces_tenant_slug 
ON namespaces(tenant_id, slug);

-- Conversations (via namespace -> tenant)
CREATE INDEX IF NOT EXISTS idx_conversations_namespace_user 
ON conversations(namespace_id, user_id);

-- Documents
CREATE INDEX IF NOT EXISTS idx_documents_namespace_processado 
ON documents(namespace_id, processado);

-- Training Data
CREATE INDEX IF NOT EXISTS idx_training_tenant_status_created 
ON training_data(tenant_id, status, criado_em DESC);

-- Fine-tuning Jobs
CREATE INDEX IF NOT EXISTS idx_finetuning_tenant_status_created 
ON fine_tuning_jobs(tenant_id, status, criado_em DESC);

-- Integrations
CREATE INDEX IF NOT EXISTS idx_integrations_tenant_tipo_ativo 
ON integrations(tenant_id, tipo, ativo);

-- Audit Logs (particionado por data para performance)
CREATE INDEX IF NOT EXISTS idx_audit_tenant_created_acao 
ON audit_logs(tenant_id, criado_em DESC, acao);

-- Usage Metrics
CREATE INDEX IF NOT EXISTS idx_usage_tenant_data_type 
ON usage_metrics(tenant_id, data DESC, type);

-- LLM Config
CREATE INDEX IF NOT EXISTS idx_llm_config_tenant_ativo 
ON llm_config(tenant_id, ativo);

-- Wise Sync Log
CREATE INDEX IF NOT EXISTS idx_wise_sync_tenant_status 
ON wise_sync_log(tenant_id, status);

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
-- TABELA: users
-- ============================================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_tenant_isolation ON users;
CREATE POLICY users_tenant_isolation ON users
  FOR ALL
  USING (
    is_super_admin() 
    OR tenant_id IS NULL 
    OR tenant_id = current_tenant_id()
  )
  WITH CHECK (
    is_super_admin() 
    OR tenant_id IS NULL 
    OR tenant_id = current_tenant_id()
  );

-- ============================================================================
-- TABELA: namespaces
-- ============================================================================
ALTER TABLE namespaces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS namespaces_tenant_isolation ON namespaces;
CREATE POLICY namespaces_tenant_isolation ON namespaces
  FOR ALL
  USING (
    is_super_admin() 
    OR tenant_id IS NULL 
    OR tenant_id = current_tenant_id()
  )
  WITH CHECK (
    is_super_admin() 
    OR tenant_id IS NULL 
    OR tenant_id = current_tenant_id()
  );

-- ============================================================================
-- TABELA: integrations
-- ============================================================================
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS integrations_tenant_isolation ON integrations;
CREATE POLICY integrations_tenant_isolation ON integrations
  FOR ALL
  USING (
    is_super_admin() 
    OR tenant_id IS NULL 
    OR tenant_id = current_tenant_id()
  )
  WITH CHECK (
    is_super_admin() 
    OR tenant_id IS NULL 
    OR tenant_id = current_tenant_id()
  );

-- ============================================================================
-- TABELA: training_data
-- ============================================================================
ALTER TABLE training_data ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS training_data_tenant_isolation ON training_data;
CREATE POLICY training_data_tenant_isolation ON training_data
  FOR ALL
  USING (
    is_super_admin() 
    OR tenant_id IS NULL 
    OR tenant_id = current_tenant_id()
  )
  WITH CHECK (
    is_super_admin() 
    OR tenant_id IS NULL 
    OR tenant_id = current_tenant_id()
  );

-- ============================================================================
-- TABELA: fine_tuning_jobs
-- ============================================================================
ALTER TABLE fine_tuning_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fine_tuning_jobs_tenant_isolation ON fine_tuning_jobs;
CREATE POLICY fine_tuning_jobs_tenant_isolation ON fine_tuning_jobs
  FOR ALL
  USING (
    is_super_admin() 
    OR tenant_id IS NULL 
    OR tenant_id = current_tenant_id()
  )
  WITH CHECK (
    is_super_admin() 
    OR tenant_id IS NULL 
    OR tenant_id = current_tenant_id()
  );

-- ============================================================================
-- TABELA: audit_logs
-- ============================================================================
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_logs_tenant_isolation ON audit_logs;
CREATE POLICY audit_logs_tenant_isolation ON audit_logs
  FOR ALL
  USING (
    is_super_admin() 
    OR tenant_id IS NULL 
    OR tenant_id = current_tenant_id()
  )
  WITH CHECK (
    is_super_admin() 
    OR tenant_id IS NULL 
    OR tenant_id = current_tenant_id()
  );

-- ============================================================================
-- TABELA: usage_metrics
-- ============================================================================
ALTER TABLE usage_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usage_metrics_tenant_isolation ON usage_metrics;
CREATE POLICY usage_metrics_tenant_isolation ON usage_metrics
  FOR ALL
  USING (
    is_super_admin() 
    OR tenant_id IS NULL 
    OR tenant_id = current_tenant_id()
  )
  WITH CHECK (
    is_super_admin() 
    OR tenant_id IS NULL 
    OR tenant_id = current_tenant_id()
  );

-- ============================================================================
-- TABELA: llm_config
-- ============================================================================
ALTER TABLE llm_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS llm_config_tenant_isolation ON llm_config;
CREATE POLICY llm_config_tenant_isolation ON llm_config
  FOR ALL
  USING (
    is_super_admin() 
    OR tenant_id IS NULL 
    OR tenant_id = current_tenant_id()
  )
  WITH CHECK (
    is_super_admin() 
    OR tenant_id IS NULL 
    OR tenant_id = current_tenant_id()
  );

-- ============================================================================
-- TABELA: wise_sync_log
-- ============================================================================
ALTER TABLE wise_sync_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wise_sync_log_tenant_isolation ON wise_sync_log;
CREATE POLICY wise_sync_log_tenant_isolation ON wise_sync_log
  FOR ALL
  USING (
    is_super_admin() 
    OR tenant_id IS NULL 
    OR tenant_id = current_tenant_id()
  )
  WITH CHECK (
    is_super_admin() 
    OR tenant_id IS NULL 
    OR tenant_id = current_tenant_id()
  );

-- ============================================================================
-- 4. CONFIGURAÇÃO pgAudit (GAP-PG-004)
-- Audit logging para compliance enterprise
-- ============================================================================

-- Configurar pgAudit para log de operações DDL e DML
ALTER SYSTEM SET pgaudit.log = 'ddl, write';
ALTER SYSTEM SET pgaudit.log_catalog = 'off';
ALTER SYSTEM SET pgaudit.log_parameter = 'on';
ALTER SYSTEM SET pgaudit.log_statement_once = 'on';
ALTER SYSTEM SET pgaudit.log_level = 'log';

-- Reload config
SELECT pg_reload_conf();

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
