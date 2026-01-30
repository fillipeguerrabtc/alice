-- ============================================================================
-- MIGRAÇÃO: Scheduler de Sinais LLM (Trading)
-- Descrição: Configuração persistida do scheduler de sinais (on-demand + batch)
--
-- Author: Fillipe Guerra
-- Data: 30 de Janeiro de 2026
-- Versão: 1.0 - Scheduler por tenant/marketType
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'trading_signal_schedulers') THEN
    CREATE TABLE trading_signal_schedulers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id),
      agent_id uuid REFERENCES agents(id),
      namespace_id uuid REFERENCES namespaces(id),
      market_type trading_market_type NOT NULL DEFAULT 'futures',
      margin_mode trading_margin_mode DEFAULT 'cross',
      interval_minutes integer NOT NULL DEFAULT 15,
      interval varchar(10) NOT NULL DEFAULT '5m',
      symbols text[] NOT NULL DEFAULT '{}'::text[],
      max_signals_per_run integer NOT NULL DEFAULT 1,
      enabled boolean NOT NULL DEFAULT false,
      last_run_at timestamp,
      next_run_at timestamp,
      last_success_at timestamp,
      last_signal_id uuid REFERENCES trading_signals(id),
      last_duration_ms integer,
      last_error text,
      criado_em timestamp DEFAULT now(),
      atualizado_em timestamp DEFAULT now()
    );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'trading_signal_schedulers') THEN
    CREATE INDEX IF NOT EXISTS idx_trading_signal_scheduler_tenant ON trading_signal_schedulers(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_trading_signal_scheduler_market ON trading_signal_schedulers(market_type);
    CREATE INDEX IF NOT EXISTS idx_trading_signal_scheduler_enabled ON trading_signal_schedulers(enabled);
    CREATE INDEX IF NOT EXISTS idx_trading_signal_scheduler_next_run ON trading_signal_schedulers(next_run_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_trading_signal_scheduler_tenant_market ON trading_signal_schedulers(tenant_id, market_type);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'trading_signal_schedulers') THEN
    ALTER TABLE trading_signal_schedulers ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS trading_signal_schedulers_tenant_isolation ON trading_signal_schedulers;
    CREATE POLICY trading_signal_schedulers_tenant_isolation ON trading_signal_schedulers
      FOR ALL
      USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
      WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());
    RAISE NOTICE 'RLS aplicado em trading_signal_schedulers';
  END IF;
END $$;

COMMENT ON TABLE trading_signal_schedulers IS 'Scheduler de sinais LLM por tenant e marketType - RLS habilitado';
