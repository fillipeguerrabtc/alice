-- ============================================================================
-- MIGRAÇÃO 0020: Grupos organizacionais de usuários (user_groups)
-- Descrição: Tabelas de grupos e membros para organização interna (sem RBAC)
-- Regra 6: Persistência real em PostgreSQL (zero soluções temporárias)
--
-- Autor: Fillipe Guerra
-- Data: 19 de Janeiro de 2026
-- Versão: 1.0
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    nome VARCHAR(255) NOT NULL,
    descricao TEXT,
    ativo BOOLEAN DEFAULT TRUE,
    criado_por UUID REFERENCES users(id),
    atualizado_por UUID REFERENCES users(id),
    criado_em TIMESTAMP DEFAULT now(),
    atualizado_em TIMESTAMP DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_groups_tenant_nome
    ON user_groups (tenant_id, nome);

CREATE INDEX IF NOT EXISTS idx_user_groups_tenant
    ON user_groups (tenant_id);

CREATE INDEX IF NOT EXISTS idx_user_groups_nome
    ON user_groups (nome);

CREATE TABLE IF NOT EXISTS user_group_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    group_id UUID NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    criado_por UUID REFERENCES users(id),
    criado_em TIMESTAMP DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_group_members_group_user
    ON user_group_members (group_id, user_id);

CREATE INDEX IF NOT EXISTS idx_user_group_members_tenant
    ON user_group_members (tenant_id);

CREATE INDEX IF NOT EXISTS idx_user_group_members_user
    ON user_group_members (user_id);

CREATE INDEX IF NOT EXISTS idx_user_group_members_group
    ON user_group_members (group_id);

-- ============================================================================
-- Documento em Português Brasileiro
-- Autor: Fillipe Guerra
-- Data: 19 de Janeiro de 2026
-- Versão: 1.0
-- ============================================================================
