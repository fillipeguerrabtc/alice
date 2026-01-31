-- Preferências de símbolos (favoritos e destaques) por usuário/mercado
-- Regra 6: persistência real em PostgreSQL

CREATE TABLE IF NOT EXISTS trading_symbol_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  market_type trading_market_type NOT NULL DEFAULT 'futures',
  margin_mode trading_margin_mode NOT NULL DEFAULT 'cross',
  favorites text[] NOT NULL DEFAULT ARRAY[]::text[],
  featured text[] NOT NULL DEFAULT ARRAY[]::text[],
  criado_em timestamp DEFAULT now(),
  atualizado_em timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trading_symbol_prefs_tenant ON trading_symbol_preferences(tenant_id);
CREATE INDEX IF NOT EXISTS idx_trading_symbol_prefs_user ON trading_symbol_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_trading_symbol_prefs_market ON trading_symbol_preferences(market_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trading_symbol_prefs_user_market
  ON trading_symbol_preferences(tenant_id, user_id, market_type, margin_mode);

-- RLS multi-tenant
ALTER TABLE trading_symbol_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trading_symbol_preferences_tenant_isolation ON trading_symbol_preferences;
CREATE POLICY trading_symbol_preferences_tenant_isolation ON trading_symbol_preferences
  FOR ALL
  USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());
