-- Wise Sandbox Catalog - Persistência Enterprise
-- Regra 6: persistência real em PostgreSQL (sem in-memory)

CREATE TABLE IF NOT EXISTS wise_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid REFERENCES users(id),
  wise_user_id integer,
  token_type varchar(50) NOT NULL,
  access_token text NOT NULL,
  refresh_token text,
  scope text,
  expires_at timestamp,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wise_tokens_tenant ON wise_tokens(tenant_id);
CREATE INDEX IF NOT EXISTS idx_wise_tokens_user ON wise_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_wise_tokens_type ON wise_tokens(token_type);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_wise_tokens_tenant_type_user ON wise_tokens(tenant_id, token_type, user_id);

CREATE TABLE IF NOT EXISTS wise_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  wise_user_id integer NOT NULL,
  email varchar(255),
  name varchar(255),
  active boolean DEFAULT true,
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wise_users_tenant ON wise_users(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_wise_users_tenant_wise_id ON wise_users(tenant_id, wise_user_id);

CREATE TABLE IF NOT EXISTS wise_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  wise_profile_id integer NOT NULL,
  type varchar(40),
  details jsonb DEFAULT '{}'::jsonb,
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wise_profiles_tenant ON wise_profiles(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_wise_profiles_tenant_wise_id ON wise_profiles(tenant_id, wise_profile_id);

CREATE TABLE IF NOT EXISTS wise_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  wise_balance_id integer NOT NULL,
  wise_profile_id integer,
  currency varchar(10) NOT NULL,
  type varchar(30),
  name varchar(255),
  amount jsonb,
  reserved_amount jsonb,
  total_worth jsonb,
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wise_balances_tenant ON wise_balances(tenant_id);
CREATE INDEX IF NOT EXISTS idx_wise_balances_currency ON wise_balances(currency);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_wise_balances_tenant_wise_id ON wise_balances(tenant_id, wise_balance_id);

CREATE TABLE IF NOT EXISTS wise_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  wise_recipient_id integer NOT NULL,
  wise_profile_id integer,
  account_holder_name varchar(255),
  currency varchar(10),
  type varchar(50),
  active boolean DEFAULT true,
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wise_recipients_tenant ON wise_recipients(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_wise_recipients_tenant_wise_id ON wise_recipients(tenant_id, wise_recipient_id);

CREATE TABLE IF NOT EXISTS wise_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  wise_quote_id varchar(100) NOT NULL,
  source_currency varchar(10),
  target_currency varchar(10),
  source_amount real,
  target_amount real,
  rate real,
  fee real,
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wise_quotes_tenant ON wise_quotes(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_wise_quotes_tenant_wise_id ON wise_quotes(tenant_id, wise_quote_id);

CREATE TABLE IF NOT EXISTS wise_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  wise_transfer_id integer NOT NULL,
  status varchar(50),
  source_currency varchar(10),
  target_currency varchar(10),
  source_value real,
  target_value real,
  customer_transaction_id varchar(255),
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wise_transfers_tenant ON wise_transfers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_wise_transfers_status ON wise_transfers(status);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_wise_transfers_tenant_wise_id ON wise_transfers(tenant_id, wise_transfer_id);

CREATE TABLE IF NOT EXISTS wise_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  wise_card_token varchar(128) NOT NULL,
  wise_profile_id integer,
  status varchar(40),
  type varchar(50),
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wise_cards_tenant ON wise_cards(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_wise_cards_tenant_token ON wise_cards(tenant_id, wise_card_token);

CREATE TABLE IF NOT EXISTS wise_card_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  wise_card_order_id varchar(128) NOT NULL,
  status varchar(40),
  type varchar(50),
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wise_card_orders_tenant ON wise_card_orders(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_wise_card_orders_tenant_id ON wise_card_orders(tenant_id, wise_card_order_id);

CREATE TABLE IF NOT EXISTS wise_card_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  wise_transaction_id varchar(128) NOT NULL,
  wise_card_token varchar(128),
  status varchar(40),
  amount jsonb,
  data jsonb DEFAULT '{}'::jsonb,
  occurred_at timestamp,
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wise_card_tx_tenant ON wise_card_transactions(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_wise_card_tx_tenant_id ON wise_card_transactions(tenant_id, wise_transaction_id);

CREATE TABLE IF NOT EXISTS wise_spend_controls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  wise_rule_id integer NOT NULL,
  type varchar(20),
  operation varchar(20),
  description varchar(255),
  values jsonb,
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wise_spend_controls_tenant ON wise_spend_controls(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_wise_spend_controls_tenant_id ON wise_spend_controls(tenant_id, wise_rule_id);

CREATE TABLE IF NOT EXISTS wise_spend_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  scope varchar(20) NOT NULL,
  wise_profile_id integer,
  wise_card_token varchar(128),
  data jsonb DEFAULT '{}'::jsonb,
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wise_spend_limits_tenant ON wise_spend_limits(tenant_id);

CREATE TABLE IF NOT EXISTS wise_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  wise_dispute_id varchar(128) NOT NULL,
  status varchar(40),
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wise_disputes_tenant ON wise_disputes(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_wise_disputes_tenant_id ON wise_disputes(tenant_id, wise_dispute_id);

CREATE TABLE IF NOT EXISTS wise_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  wise_activity_id varchar(128),
  resource_type varchar(50),
  status varchar(40),
  occurred_at timestamp,
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wise_activities_tenant ON wise_activities(tenant_id);

CREATE TABLE IF NOT EXISTS wise_kyc_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  wise_kyc_review_id varchar(128) NOT NULL,
  status varchar(40),
  link_url text,
  required_by timestamp,
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wise_kyc_reviews_tenant ON wise_kyc_reviews(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_wise_kyc_reviews_tenant_id ON wise_kyc_reviews(tenant_id, wise_kyc_review_id);

CREATE TABLE IF NOT EXISTS wise_verification_evidences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  wise_profile_id integer,
  evidence_key varchar(120),
  status varchar(40),
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wise_verification_tenant ON wise_verification_evidences(tenant_id);

CREATE TABLE IF NOT EXISTS wise_webhook_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  wise_subscription_id varchar(128) NOT NULL,
  scope_domain varchar(30),
  scope_id varchar(128),
  trigger_on varchar(120),
  delivery_url text,
  delivery_version varchar(20),
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wise_webhook_subs_tenant ON wise_webhook_subscriptions(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_wise_webhook_subs_tenant_id ON wise_webhook_subscriptions(tenant_id, wise_subscription_id);

CREATE TABLE IF NOT EXISTS wise_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),
  delivery_id varchar(128),
  subscription_id varchar(128),
  event_type varchar(120),
  schema_version varchar(20),
  sent_at timestamp,
  signature_valid boolean DEFAULT false,
  payload jsonb DEFAULT '{}'::jsonb,
  received_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wise_webhook_events_tenant ON wise_webhook_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_wise_webhook_events_event ON wise_webhook_events(event_type);

-- RLS multi-tenant
ALTER TABLE wise_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE wise_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE wise_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE wise_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE wise_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE wise_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE wise_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE wise_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE wise_card_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE wise_card_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE wise_spend_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE wise_spend_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE wise_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE wise_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE wise_kyc_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE wise_verification_evidences ENABLE ROW LEVEL SECURITY;
ALTER TABLE wise_webhook_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE wise_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wise_tokens_tenant_isolation ON wise_tokens;
CREATE POLICY wise_tokens_tenant_isolation ON wise_tokens
  FOR ALL
  USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS wise_users_tenant_isolation ON wise_users;
CREATE POLICY wise_users_tenant_isolation ON wise_users
  FOR ALL
  USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS wise_profiles_tenant_isolation ON wise_profiles;
CREATE POLICY wise_profiles_tenant_isolation ON wise_profiles
  FOR ALL
  USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS wise_balances_tenant_isolation ON wise_balances;
CREATE POLICY wise_balances_tenant_isolation ON wise_balances
  FOR ALL
  USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS wise_recipients_tenant_isolation ON wise_recipients;
CREATE POLICY wise_recipients_tenant_isolation ON wise_recipients
  FOR ALL
  USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS wise_quotes_tenant_isolation ON wise_quotes;
CREATE POLICY wise_quotes_tenant_isolation ON wise_quotes
  FOR ALL
  USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS wise_transfers_tenant_isolation ON wise_transfers;
CREATE POLICY wise_transfers_tenant_isolation ON wise_transfers
  FOR ALL
  USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS wise_cards_tenant_isolation ON wise_cards;
CREATE POLICY wise_cards_tenant_isolation ON wise_cards
  FOR ALL
  USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS wise_card_orders_tenant_isolation ON wise_card_orders;
CREATE POLICY wise_card_orders_tenant_isolation ON wise_card_orders
  FOR ALL
  USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS wise_card_transactions_tenant_isolation ON wise_card_transactions;
CREATE POLICY wise_card_transactions_tenant_isolation ON wise_card_transactions
  FOR ALL
  USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS wise_spend_controls_tenant_isolation ON wise_spend_controls;
CREATE POLICY wise_spend_controls_tenant_isolation ON wise_spend_controls
  FOR ALL
  USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS wise_spend_limits_tenant_isolation ON wise_spend_limits;
CREATE POLICY wise_spend_limits_tenant_isolation ON wise_spend_limits
  FOR ALL
  USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS wise_disputes_tenant_isolation ON wise_disputes;
CREATE POLICY wise_disputes_tenant_isolation ON wise_disputes
  FOR ALL
  USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS wise_activities_tenant_isolation ON wise_activities;
CREATE POLICY wise_activities_tenant_isolation ON wise_activities
  FOR ALL
  USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS wise_kyc_reviews_tenant_isolation ON wise_kyc_reviews;
CREATE POLICY wise_kyc_reviews_tenant_isolation ON wise_kyc_reviews
  FOR ALL
  USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS wise_verification_evidences_tenant_isolation ON wise_verification_evidences;
CREATE POLICY wise_verification_evidences_tenant_isolation ON wise_verification_evidences
  FOR ALL
  USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS wise_webhook_subscriptions_tenant_isolation ON wise_webhook_subscriptions;
CREATE POLICY wise_webhook_subscriptions_tenant_isolation ON wise_webhook_subscriptions
  FOR ALL
  USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS wise_webhook_events_tenant_isolation ON wise_webhook_events;
CREATE POLICY wise_webhook_events_tenant_isolation ON wise_webhook_events
  FOR ALL
  USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());
