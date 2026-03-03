-- ============================================================================
-- MIGRAÇÃO: Criar tabela feature_flags
-- Descrição: Sistema de Feature Flags Enterprise para Alice Platform
-- Regra 6: Persistência real em PostgreSQL (zero soluções temporárias)
-- 
-- Author: Fillipe Guerra
-- Data: 05 de Dezembro de 2025
-- Versão: 1.1 - Unificação de migrações
-- ============================================================================

-- ============================================================================
-- TABELA: feature_flags
-- NOTA (15/12/2025): Foreign keys para tenants/users removidas porque essas 
-- tabelas são criadas pelo Drizzle ORM APÓS as migrações SQL. A integridade
-- referencial é mantida pela aplicação (Regra 6 - Enterprise-Grade).
-- ============================================================================

CREATE TABLE IF NOT EXISTS feature_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- NOTA: tenant_id é UUID sem FK para tenants (criada pelo Drizzle ORM)
    -- Integridade referencial mantida pela aplicação
    tenant_id UUID,
    key VARCHAR(100) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT false,
    description TEXT,
    metadata JSONB DEFAULT '{}',
    -- NOTA: created_by/updated_by são VARCHAR sem FK para users (criada pelo Drizzle ORM)
    -- Integridade referencial mantida pela aplicação
    created_by VARCHAR(255),
    updated_by VARCHAR(255),
    criado_em TIMESTAMP DEFAULT NOW(),
    atualizado_em TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- ÍNDICES para performance
-- ============================================================================

-- Índice para busca por key (flags globais e tenant-specific)
CREATE INDEX IF NOT EXISTS idx_feature_flags_key 
    ON feature_flags(key);

-- Índice composto para busca por tenant + key (padrão de uso)
CREATE INDEX IF NOT EXISTS idx_feature_flags_tenant_key 
    ON feature_flags(tenant_id, key);

-- ============================================================================
-- UNIQUE CONSTRAINT para evitar duplicatas
-- ============================================================================

-- Flags globais (tenant_id NULL) devem ter key única
CREATE UNIQUE INDEX IF NOT EXISTS idx_feature_flags_global_key 
    ON feature_flags(key) 
    WHERE tenant_id IS NULL;

-- Flags por tenant devem ter key única por tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_feature_flags_tenant_unique_key 
    ON feature_flags(tenant_id, key) 
    WHERE tenant_id IS NOT NULL;

-- ============================================================================
-- TRIGGER: Atualizar atualizado_em automaticamente
-- ============================================================================

CREATE OR REPLACE FUNCTION update_feature_flags_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.atualizado_em = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_feature_flags_updated ON feature_flags;
CREATE TRIGGER trigger_feature_flags_updated
    BEFORE UPDATE ON feature_flags
    FOR EACH ROW
    EXECUTE FUNCTION update_feature_flags_timestamp();

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) - Isolamento Multi-Tenant
-- Usa funções definidas em 0001_rls_security_enterprise.sql
-- NOTA (15/12/2025): DROP POLICY IF EXISTS garante idempotência em re-deploys
-- ============================================================================

-- Habilitar RLS na tabela
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

-- Policy: Super admins podem ver/modificar todas as flags
DROP POLICY IF EXISTS feature_flags_super_admin_policy ON feature_flags;
CREATE POLICY feature_flags_super_admin_policy ON feature_flags
    FOR ALL
    USING (
        is_super_admin() = true
    );

-- Policy: Tenant admins podem ver flags globais e do seu tenant
DROP POLICY IF EXISTS feature_flags_tenant_read_policy ON feature_flags;
CREATE POLICY feature_flags_tenant_read_policy ON feature_flags
    FOR SELECT
    USING (
        tenant_id IS NULL 
        OR tenant_id = current_tenant_id()
    );

-- Policy: Tenant admins podem modificar apenas flags do seu tenant
DROP POLICY IF EXISTS feature_flags_tenant_write_policy ON feature_flags;
CREATE POLICY feature_flags_tenant_write_policy ON feature_flags
    FOR ALL
    USING (
        tenant_id = current_tenant_id()
    )
    WITH CHECK (
        tenant_id = current_tenant_id()
    );

-- ============================================================================
-- DADOS INICIAIS: Feature Flags padrão (opcionais)
-- ============================================================================

-- Inserir flags globais padrão apenas se não existirem
INSERT INTO feature_flags (key, enabled, description)
VALUES 
    ('image_generation_enabled', true, 'Geração de imagens via FLUX.1'),
    ('rag_enabled', true, 'Retrieval Augmented Generation'),
    ('clip_embeddings_enabled', true, 'Embeddings multimodais CLIP'),
    ('training_enabled', true, 'Fine-tuning e coleta de dados'),
    ('handover_enabled', true, 'Escalação para agentes humanos'),
    ('auto_escalation_enabled', true, 'Escalação automática por triggers'),
    ('websocket_enabled', true, 'WebSocket para chat real-time'),
    ('langfuse_enabled', true, 'Observability Langfuse'),
    ('prometheus_enabled', true, 'Métricas Prometheus'),
    ('jaeger_enabled', true, 'Tracing Jaeger'),
    ('stripe_enabled', false, 'Integração Stripe (requer configuração)'),
    ('wise_enabled', false, 'Integração Wise (requer configuração)'),
    ('twilio_enabled', false, 'Integração Twilio (requer configuração)'),
    ('email_enabled', false, 'Integração Gmail SMTP (requer configuração)'),
    ('saml_enabled', false, 'Autenticação SAML 2.0 (requer configuração)'),
    ('google_oauth_enabled', false, 'OAuth Google (requer configuração)'),
    ('github_oauth_enabled', false, 'OAuth GitHub (requer configuração)')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- COMENTÁRIOS para documentação
-- ============================================================================

COMMENT ON TABLE feature_flags IS 'Sistema de Feature Flags Enterprise - Alice Platform';
COMMENT ON COLUMN feature_flags.key IS 'Identificador único da flag (lowercase_underscore)';
COMMENT ON COLUMN feature_flags.enabled IS 'Estado da flag (true = habilitada)';
COMMENT ON COLUMN feature_flags.tenant_id IS 'ID do tenant (NULL = flag global)';
COMMENT ON COLUMN feature_flags.metadata IS 'Metadados extras em JSON (rollout percentual, etc)';

-- ============================================================================
-- Documento em Português Brasileiro
-- Author: Fillipe Guerra
-- Data: 05 de Dezembro de 2025
-- Versão: 1.1 - Feature Flags Enterprise (Unificação de migrações)
-- ============================================================================
