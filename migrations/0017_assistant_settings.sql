-- ============================================================================
-- MIGRAÇÃO: Criar tabela assistant_settings
-- Descrição: Configuração da Alice (system prompt, comportamento e humor)
-- Regra 6: Persistência real em PostgreSQL (zero soluções temporárias)
--
-- Author: Fillipe Guerra
-- Data: 17 de Janeiro de 2026
-- Versão: 1.0
-- ============================================================================

-- ============================================================================
-- TABELA: assistant_settings
-- NOTA: tenant_id/created_by/updated_by sem FK para manter compatibilidade
-- com a ordem de migrações (Drizzle cria FKs posteriormente).
-- ============================================================================

CREATE TABLE IF NOT EXISTS assistant_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID,
    system_prompt TEXT,
    behavior TEXT,
    mood TEXT,
    created_by UUID,
    updated_by UUID,
    criado_em TIMESTAMP DEFAULT NOW(),
    atualizado_em TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- ÍNDICES para performance
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_assistant_settings_tenant
    ON assistant_settings(tenant_id);

-- ============================================================================
-- TRIGGER: Atualizar atualizado_em automaticamente
-- ============================================================================

CREATE OR REPLACE FUNCTION update_assistant_settings_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.atualizado_em = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_assistant_settings_updated ON assistant_settings;
CREATE TRIGGER trigger_assistant_settings_updated
    BEFORE UPDATE ON assistant_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_assistant_settings_timestamp();

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) - Isolamento Multi-Tenant
-- ============================================================================

ALTER TABLE assistant_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS assistant_settings_super_admin_policy ON assistant_settings;
CREATE POLICY assistant_settings_super_admin_policy ON assistant_settings
    FOR ALL
    USING (
        is_super_admin() = true
    );

DROP POLICY IF EXISTS assistant_settings_tenant_read_policy ON assistant_settings;
CREATE POLICY assistant_settings_tenant_read_policy ON assistant_settings
    FOR SELECT
    USING (
        tenant_id = current_tenant_id()
    );

DROP POLICY IF EXISTS assistant_settings_tenant_write_policy ON assistant_settings;
CREATE POLICY assistant_settings_tenant_write_policy ON assistant_settings
    FOR ALL
    USING (
        tenant_id = current_tenant_id()
    )
    WITH CHECK (
        tenant_id = current_tenant_id()
    );

-- ============================================================================
-- COMENTÁRIOS para documentação
-- ============================================================================

COMMENT ON TABLE assistant_settings IS 'Configuração da Alice (system prompt, comportamento e humor)';
COMMENT ON COLUMN assistant_settings.system_prompt IS 'System prompt base configurável por tenant';
COMMENT ON COLUMN assistant_settings.behavior IS 'Regras e comportamentos operacionais da assistente';
COMMENT ON COLUMN assistant_settings.mood IS 'Tom e humor da assistente';

-- ============================================================================
-- Documento em Português Brasileiro
-- Author: Fillipe Guerra
-- Data: 17 de Janeiro de 2026
-- Versão: 1.0
-- ============================================================================
