-- ============================================================================
-- MIGRAÇÃO: Trading Control History + RLS
-- Descrição: Tabela de histórico de handover/takeover entre Alice e operador
-- Documentação: PostgreSQL 16 Security Hardening + OWASP API1/API5
-- 
-- Author: Fillipe Guerra
-- Data: 17 de Dezembro de 2025
-- Versão: 1.0 - Tabela trading_control_history com RLS
-- ============================================================================

-- ============================================================================
-- 1. CRIAÇÃO DA TABELA (se não existir - Drizzle pode já ter criado)
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'trading_control_history') THEN
    CREATE TABLE trading_control_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      previous_mode VARCHAR(20) NOT NULL,
      new_mode VARCHAR(20) NOT NULL,
      changed_by UUID REFERENCES users(id),
      reason TEXT,
      metadata JSONB,
      criado_em TIMESTAMP DEFAULT NOW()
    );
    
    -- Índices para performance
    CREATE INDEX idx_trading_control_history_tenant ON trading_control_history(tenant_id);
    CREATE INDEX idx_trading_control_history_created ON trading_control_history(criado_em);
    CREATE INDEX idx_trading_control_history_changed_by ON trading_control_history(changed_by);
    
    RAISE NOTICE 'Tabela trading_control_history criada';
  END IF;
END $$;

-- ============================================================================
-- 2. ROW LEVEL SECURITY (RLS)
-- Isolamento multi-tenant completo conforme OWASP API1/API5
-- ============================================================================

DO $$
BEGIN
  -- Habilitar RLS
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'trading_control_history') THEN
    ALTER TABLE trading_control_history ENABLE ROW LEVEL SECURITY;
    
    -- Remover política existente se houver
    DROP POLICY IF EXISTS trading_control_history_tenant_isolation ON trading_control_history;
    
    -- Criar política de isolamento por tenant
    CREATE POLICY trading_control_history_tenant_isolation ON trading_control_history
      FOR ALL
      USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
      WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());
    
    RAISE NOTICE 'RLS aplicado em trading_control_history';
  END IF;
END $$;

-- ============================================================================
-- 3. COMENTÁRIOS PARA DOCUMENTAÇÃO
-- ============================================================================

COMMENT ON TABLE trading_control_history IS 'Histórico de handover/takeover entre Alice (IA) e operador humano - RLS habilitado';
COMMENT ON COLUMN trading_control_history.previous_mode IS 'Modo anterior: alice (automático) ou manual';
COMMENT ON COLUMN trading_control_history.new_mode IS 'Novo modo: alice (automático) ou manual';
COMMENT ON COLUMN trading_control_history.changed_by IS 'ID do usuário que realizou a mudança';
COMMENT ON COLUMN trading_control_history.reason IS 'Motivo da mudança de controle';
COMMENT ON COLUMN trading_control_history.metadata IS 'Dados adicionais em JSON (fonte, timestamp, etc.)';

-- ============================================================================
-- 4. VERIFICAÇÃO FINAL
-- ============================================================================

DO $$
DECLARE
  rls_enabled BOOLEAN;
BEGIN
  SELECT relrowsecurity INTO rls_enabled
  FROM pg_class
  WHERE relname = 'trading_control_history';
  
  IF rls_enabled THEN
    RAISE NOTICE 'trading_control_history: RLS está ATIVO';
  ELSE
    RAISE WARNING 'trading_control_history: RLS NÃO está ativo!';
  END IF;
END $$;
