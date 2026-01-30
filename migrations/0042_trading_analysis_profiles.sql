-- Perfis de análise/sinais multi-timeframe (Enterprise)
-- Regra 6: persistência real em PostgreSQL

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'trading_profile_kind'
  ) THEN
    CREATE TYPE trading_profile_kind AS ENUM ('analysis', 'signal');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS trading_analysis_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  kind trading_profile_kind NOT NULL,
  name varchar(100) NOT NULL DEFAULT 'default',
  timeframes trading_interval[] NOT NULL DEFAULT ARRAY['5m']::trading_interval[],
  indicators jsonb NOT NULL DEFAULT '["rsi","macd","moving_averages","bollinger","atr","stochastic","adx","support_resistance","volume"]'::jsonb,
  data_sources jsonb NOT NULL DEFAULT '{"orderBook": false, "news": false, "trainingData": false}'::jsonb,
  model_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  consensus jsonb NOT NULL DEFAULT '{"rule":"majority"}'::jsonb,
  criado_em timestamp DEFAULT now(),
  atualizado_em timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trading_profiles_tenant ON trading_analysis_profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_trading_profiles_kind ON trading_analysis_profiles(kind);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trading_profiles_tenant_kind ON trading_analysis_profiles(tenant_id, kind);

-- RLS multi-tenant
ALTER TABLE trading_analysis_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trading_analysis_profiles_tenant_isolation ON trading_analysis_profiles;
CREATE POLICY trading_analysis_profiles_tenant_isolation ON trading_analysis_profiles
  FOR ALL
  USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());
