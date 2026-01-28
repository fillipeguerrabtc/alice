-- ============================================================================
-- MIGRAÇÃO 0030: Multi-Roles de Usuário (cargos) + Roles Customizadas
-- Descrição: Permite múltiplas roles base e múltiplas roles customizadas por usuário.
-- Regra 6: Persistência real em PostgreSQL (zero soluções temporárias)
--
-- Autor: Fillipe Guerra
-- Data: 23 de Janeiro de 2026
-- Versão: 1.0
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL,
  created_at timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_roles_user_role ON user_roles(user_id, role);
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);

CREATE TABLE IF NOT EXISTS user_custom_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  custom_role_id uuid NOT NULL REFERENCES custom_roles(id) ON DELETE CASCADE,
  created_at timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_custom_roles_user_role ON user_custom_roles(user_id, custom_role_id);
CREATE INDEX IF NOT EXISTS idx_user_custom_roles_user ON user_custom_roles(user_id);

-- Backfill: roles base (users.role) -> user_roles
INSERT INTO user_roles (user_id, role)
SELECT id, role::user_role
FROM users
WHERE role IS NOT NULL
ON CONFLICT DO NOTHING;

-- Backfill: role customizada (users.custom_role_id) -> user_custom_roles
INSERT INTO user_custom_roles (user_id, custom_role_id)
SELECT id, custom_role_id
FROM users
WHERE custom_role_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ============================================================================
-- Documento em Português Brasileiro
-- Autor: Fillipe Guerra
-- Data: 23 de Janeiro de 2026
-- Versão: 1.0
-- ============================================================================
