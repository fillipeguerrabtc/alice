-- ============================================================================
-- MIGRAÇÃO 0027: Roles Customizadas (Departamentos/Funções)
-- Descrição: Adiciona roles customizadas por tenant e mapeamento de permissões.
-- Regra 6: Persistência real em PostgreSQL (zero soluções temporárias)
--
-- Autor: Fillipe Guerra
-- Data: 22 de Janeiro de 2026
-- Versão: 1.0
-- ============================================================================

-- Tabela de roles customizadas por tenant
CREATE TABLE IF NOT EXISTS custom_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),
  nome varchar(255) NOT NULL,
  slug varchar(100) NOT NULL,
  descricao text,
  base_role user_role NOT NULL DEFAULT 'viewer',
  ativo boolean DEFAULT true,
  criado_em timestamp DEFAULT now(),
  atualizado_em timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_custom_roles_tenant ON custom_roles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_custom_roles_base_role ON custom_roles(base_role);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_custom_roles_tenant_slug ON custom_roles(tenant_id, slug);

-- Mapeamento de permissões por role customizada
CREATE TABLE IF NOT EXISTS custom_role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  custom_role_id uuid NOT NULL REFERENCES custom_roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  criado_em timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_custom_role_permissions_role ON custom_role_permissions(custom_role_id);
CREATE INDEX IF NOT EXISTS idx_custom_role_permissions_permission ON custom_role_permissions(permission_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_custom_role_permissions ON custom_role_permissions(custom_role_id, permission_id);

-- Coluna de role customizada no usuário
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS custom_role_id uuid REFERENCES custom_roles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_custom_role ON users(custom_role_id);

-- ============================================================================
-- Documento em Português Brasileiro
-- Autor: Fillipe Guerra
-- Data: 22 de Janeiro de 2026
-- Versão: 1.0
-- ============================================================================
