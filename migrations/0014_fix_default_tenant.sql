-- ============================================================================
-- Migration 0014: Fix Default Tenant e Associar Usuários
-- ============================================================================
-- BUG FIX 13/01/2026: Criar tenant default e associar usuários órfãos
--
-- PROBLEMA: Usuários criados sem tenant_id causam falhas em:
-- - Chat: "Tentativa de acesso sem tenantId" 
-- - Trading: Retorna 401 "Autenticação necessária"
-- - Todas as features multi-tenant ficam quebradas
--
-- SOLUÇÃO:
-- 1. Criar tenant "Alice Platform" como tenant default
-- 2. Associar TODOS os usuários sem tenant_id a este tenant
-- 3. Adicionar constraint para OBRIGAR tenant_id em novos usuários
--
-- Autor: Fillipe Guerra
-- Data: 13 de Janeiro de 2026
-- ============================================================================

BEGIN;

-- Criar tenant default "Alice Platform" (idempotente)
INSERT INTO tenants (
    id,
    nome,
    slug,
    dominio,
    plano,
    limite_usuarios,
    limite_conversas,
    limite_armazenamento_gb,
    ativo,
    criado_em,
    atualizado_em
)
VALUES (
    gen_random_uuid(),
    'Alice Platform',
    'alice-platform',
    'yesyoudeserve.duckdns.org',
    'enterprise',
    999999, -- Sem limite para tenant default
    999999,
    999999,
    true,
    NOW(),
    NOW()
)
ON CONFLICT (slug) DO NOTHING;

-- Obter ID do tenant default
DO $$
DECLARE
    default_tenant_id UUID;
BEGIN
    SELECT id INTO default_tenant_id FROM tenants WHERE slug = 'alice-platform';
    
    -- Associar TODOS os usuários sem tenant_id ao tenant default
    UPDATE users 
    SET tenant_id = default_tenant_id,
        updated_at = NOW()
    WHERE tenant_id IS NULL;
    
    RAISE NOTICE 'Usuários órfãos associados ao tenant default: %', 
        (SELECT COUNT(*) FROM users WHERE tenant_id = default_tenant_id);
END $$;

-- Adicionar constraint NOT NULL para tenant_id (prevenir futuros órfãos)
-- NOTA: Usamos ALTER COLUMN SET NOT NULL ao invés de ADD CONSTRAINT para melhor performance
-- REF: PostgreSQL 16 Best Practices - NOT NULL é mais eficiente que CHECK constraint
ALTER TABLE users 
    ALTER COLUMN tenant_id SET NOT NULL;

-- Criar índice otimizado para queries por tenant (se não existir)
CREATE INDEX IF NOT EXISTS idx_users_tenant_active 
    ON users(tenant_id, ativo) 
    WHERE ativo = true;

COMMIT;
