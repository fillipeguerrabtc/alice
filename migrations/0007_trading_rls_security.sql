-- ============================================================================
-- MIGRAÇÃO: Row Level Security (RLS) para Tabelas de Trading
-- Descrição: Segurança multi-tenant para módulo de Trading KuCoin Futures
-- Documentação: PostgreSQL 16 Security Hardening + OWASP API1/API5
-- 
-- Author: Fillipe Guerra
-- Data: 17 de Dezembro de 2025
-- Versão: 1.0 - RLS para tabelas de Trading BTC Futures
-- ============================================================================

-- ============================================================================
-- 1. ÍNDICES PARA PERFORMANCE EM QUERIES MULTI-TENANT
-- ============================================================================

DO $$
BEGIN
  -- Trading Signals
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'trading_signals') THEN
    CREATE INDEX IF NOT EXISTS idx_trading_signals_tenant_active ON trading_signals(tenant_id, is_active);
  END IF;

  -- Trading Orders
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'trading_orders') THEN
    CREATE INDEX IF NOT EXISTS idx_trading_orders_tenant_status ON trading_orders(tenant_id, status);
  END IF;

  -- Trading Positions
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'trading_positions') THEN
    CREATE INDEX IF NOT EXISTS idx_trading_positions_tenant_status ON trading_positions(tenant_id, status);
  END IF;

  -- Trading Audit Log
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'trading_audit_log') THEN
    CREATE INDEX IF NOT EXISTS idx_trading_audit_tenant_created ON trading_audit_log(tenant_id, criado_em DESC);
  END IF;

  -- Trading Dataset
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'trading_dataset') THEN
    CREATE INDEX IF NOT EXISTS idx_trading_dataset_tenant_status ON trading_dataset(tenant_id, status);
  END IF;

  -- Trading LoRA Jobs
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'trading_lora_jobs') THEN
    CREATE INDEX IF NOT EXISTS idx_trading_lora_jobs_tenant_status ON trading_lora_jobs(tenant_id, status);
  END IF;
END $$;

-- ============================================================================
-- 2. ROW LEVEL SECURITY (RLS) PARA TABELAS DE TRADING
-- Isolamento multi-tenant completo conforme OWASP API1/API5
-- ============================================================================

DO $$
BEGIN
  -- TABELA: trading_signals
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'trading_signals') THEN
    ALTER TABLE trading_signals ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS trading_signals_tenant_isolation ON trading_signals;
    CREATE POLICY trading_signals_tenant_isolation ON trading_signals
      FOR ALL
      USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
      WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());
    RAISE NOTICE 'RLS aplicado em trading_signals';
  END IF;

  -- TABELA: trading_orders
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'trading_orders') THEN
    ALTER TABLE trading_orders ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS trading_orders_tenant_isolation ON trading_orders;
    CREATE POLICY trading_orders_tenant_isolation ON trading_orders
      FOR ALL
      USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
      WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());
    RAISE NOTICE 'RLS aplicado em trading_orders';
  END IF;

  -- TABELA: trading_positions
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'trading_positions') THEN
    ALTER TABLE trading_positions ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS trading_positions_tenant_isolation ON trading_positions;
    CREATE POLICY trading_positions_tenant_isolation ON trading_positions
      FOR ALL
      USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
      WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());
    RAISE NOTICE 'RLS aplicado em trading_positions';
  END IF;

  -- TABELA: trading_risk_config
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'trading_risk_config') THEN
    ALTER TABLE trading_risk_config ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS trading_risk_config_tenant_isolation ON trading_risk_config;
    CREATE POLICY trading_risk_config_tenant_isolation ON trading_risk_config
      FOR ALL
      USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
      WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());
    RAISE NOTICE 'RLS aplicado em trading_risk_config';
  END IF;

  -- TABELA: trading_audit_log
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'trading_audit_log') THEN
    ALTER TABLE trading_audit_log ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS trading_audit_log_tenant_isolation ON trading_audit_log;
    CREATE POLICY trading_audit_log_tenant_isolation ON trading_audit_log
      FOR ALL
      USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
      WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());
    RAISE NOTICE 'RLS aplicado em trading_audit_log';
  END IF;

  -- TABELA: trading_market_data (sem tenant_id - dados públicos de mercado)
  -- Não precisa de RLS pois é dado público (candles, tickers, etc.)

  -- TABELA: trading_dataset
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'trading_dataset') THEN
    ALTER TABLE trading_dataset ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS trading_dataset_tenant_isolation ON trading_dataset;
    CREATE POLICY trading_dataset_tenant_isolation ON trading_dataset
      FOR ALL
      USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
      WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());
    RAISE NOTICE 'RLS aplicado em trading_dataset';
  END IF;

  -- TABELA: trading_lora_jobs
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'trading_lora_jobs') THEN
    ALTER TABLE trading_lora_jobs ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS trading_lora_jobs_tenant_isolation ON trading_lora_jobs;
    CREATE POLICY trading_lora_jobs_tenant_isolation ON trading_lora_jobs
      FOR ALL
      USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
      WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());
    RAISE NOTICE 'RLS aplicado em trading_lora_jobs';
  END IF;
END $$;

-- ============================================================================
-- 3. COMENTÁRIOS PARA DOCUMENTAÇÃO
-- ============================================================================

COMMENT ON TABLE trading_signals IS 'Sinais de trading gerados pelo Mixtral 8x7B LLM para BTC Futures KuCoin - RLS habilitado';
COMMENT ON TABLE trading_orders IS 'Ordens de trading (OMS) enviadas para KuCoin Futures - RLS habilitado';
COMMENT ON TABLE trading_positions IS 'Posições abertas e fechadas (EMS) no KuCoin Futures - RLS habilitado';
COMMENT ON TABLE trading_risk_config IS 'Configuração de gestão de risco por tenant - RLS habilitado';
COMMENT ON TABLE trading_audit_log IS 'Audit log imutável de todas operações de trading - RLS habilitado';
COMMENT ON TABLE trading_market_data IS 'Dados históricos de mercado (candles, tickers) - Dados públicos sem RLS';
COMMENT ON TABLE trading_dataset IS 'Dataset para fine-tuning LoRA do modelo de trading - RLS habilitado';
COMMENT ON TABLE trading_lora_jobs IS 'Jobs de treinamento LoRA para trading - RLS habilitado';

-- ============================================================================
-- 4. VERIFICAÇÃO FINAL
-- ============================================================================

DO $$
DECLARE
  table_count INTEGER;
  rls_count INTEGER;
BEGIN
  -- Conta tabelas de trading
  SELECT COUNT(*) INTO table_count 
  FROM information_schema.tables 
  WHERE table_name LIKE 'trading_%';

  -- Conta tabelas com RLS ativo
  SELECT COUNT(*) INTO rls_count 
  FROM pg_tables t
  JOIN pg_class c ON c.relname = t.tablename
  WHERE t.tablename LIKE 'trading_%'
  AND c.relrowsecurity = true;

  RAISE NOTICE 'Trading: % tabelas encontradas, % com RLS ativo', table_count, rls_count;
END $$;
