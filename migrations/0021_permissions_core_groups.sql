-- ============================================================================
-- MIGRAÇÃO 0021: Permissões Admin (Core + Grupos + CRUD Permissões)
-- Descrição: Adiciona permissões administrativas para gestão enterprise.
-- Regra 6: Persistência real em PostgreSQL (zero soluções temporárias)
--
-- Autor: Fillipe Guerra
-- Data: 19 de Janeiro de 2026
-- Versão: 1.0
-- ============================================================================

WITH new_permissions AS (
  SELECT * FROM (VALUES
    ('admin:alice_core:write', 'Editar Core da Alice', 'Permite editar o core de prompts e regras centrais da Alice', 'admin'),
    ('admin:permissions:read', 'Visualizar Permissões', 'Permite visualizar permissões do sistema', 'admin'),
    ('admin:permissions:write', 'Criar/Editar Permissões', 'Permite criar e editar permissões do sistema', 'admin'),
    ('admin:permissions:delete', 'Excluir Permissões', 'Permite excluir permissões do sistema', 'admin'),
    ('admin:permissions:manage', 'Gerenciar Permissões', 'Permite gerenciar permissões e suas atribuições', 'admin'),
    ('admin:groups:read', 'Visualizar Grupos', 'Permite visualizar grupos organizacionais', 'admin'),
    ('admin:groups:write', 'Criar/Editar Grupos', 'Permite criar e editar grupos organizacionais', 'admin'),
    ('admin:groups:delete', 'Excluir Grupos', 'Permite excluir grupos organizacionais', 'admin'),
    ('admin:groups:manage', 'Gerenciar Grupos', 'Permite gerenciar membros de grupos organizacionais', 'admin')
  ) AS v(codigo, nome, descricao, modulo)
)
INSERT INTO permissions (codigo, nome, descricao, modulo)
SELECT codigo, nome, descricao, modulo
FROM new_permissions
ON CONFLICT (codigo) DO NOTHING;

WITH perm_ids AS (
  SELECT id, codigo
  FROM permissions
  WHERE codigo IN (
    'admin:alice_core:write',
    'admin:permissions:read',
    'admin:permissions:write',
    'admin:permissions:delete',
    'admin:permissions:manage',
    'admin:groups:read',
    'admin:groups:write',
    'admin:groups:delete',
    'admin:groups:manage'
  )
),
roles AS (
  SELECT unnest(ARRAY['super_admin', 'admin'])::text AS role
)
INSERT INTO role_permissions (role, permission_id)
SELECT roles.role::user_role, perm_ids.id
FROM roles
CROSS JOIN perm_ids
WHERE NOT EXISTS (
  SELECT 1
  FROM role_permissions rp
  WHERE rp.role = roles.role::user_role AND rp.permission_id = perm_ids.id
);

-- ============================================================================
-- Documento em Português Brasileiro
-- Autor: Fillipe Guerra
-- Data: 19 de Janeiro de 2026
-- Versão: 1.0
-- ============================================================================
