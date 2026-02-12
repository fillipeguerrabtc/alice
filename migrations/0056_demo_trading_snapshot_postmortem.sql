-- Migration: 0056_demo_trading_snapshot_postmortem
-- Descrição: Expande técnicas de trading, cria snapshot store, post-mortem engine e tabelas demo trading
-- Autor: Fillipe Guerra
-- Data: 09 de Fevereiro de 2026

-- ============================================================
-- PARTE 1: Expandir trading_technique_enum com 5 novas técnicas
-- ============================================================
ALTER TYPE trading_technique ADD VALUE IF NOT EXISTS 'cash_and_carry';
ALTER TYPE trading_technique ADD VALUE IF NOT EXISTS 'basis_trade';
ALTER TYPE trading_technique ADD VALUE IF NOT EXISTS 'funding_arbitrage';
ALTER TYPE trading_technique ADD VALUE IF NOT EXISTS 'grid_trading';
ALTER TYPE trading_technique ADD VALUE IF NOT EXISTS 'market_making';

-- ============================================================
-- PARTE 1.1: Expandir trading_dataset_source_type com 'postmortem'
-- ============================================================
ALTER TYPE trading_dataset_source_type ADD VALUE IF NOT EXISTS 'postmortem';

-- ============================================================
-- PARTE 2: Snapshot Store
-- ============================================================
CREATE TABLE IF NOT EXISTS trading_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    kind TEXT NOT NULL CHECK (kind IN (
        'market_entry', 'market_exit', 'candles',
        'orderbook_top', 'news', 'evidence_pack'
    )),
    data JSONB NOT NULL,
    refs JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trading_snapshots_tenant ON trading_snapshots(tenant_id);
CREATE INDEX IF NOT EXISTS idx_trading_snapshots_kind ON trading_snapshots(kind);
CREATE INDEX IF NOT EXISTS idx_trading_snapshots_created ON trading_snapshots(created_at);
CREATE INDEX IF NOT EXISTS idx_trading_snapshots_refs ON trading_snapshots USING GIN(refs);

ALTER TABLE trading_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trading_snapshots_tenant_isolation ON trading_snapshots;
CREATE POLICY trading_snapshots_tenant_isolation ON trading_snapshots
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ============================================================
-- PARTE 3: Post-Mortem Engine
-- ============================================================
CREATE TABLE IF NOT EXISTS trading_postmortems (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    position_id UUID NOT NULL,
    is_demo BOOLEAN NOT NULL DEFAULT false,
    fingerprint TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
        'queued', 'processing_cpu', 'completed_cpu',
        'processing_llm', 'completed', 'failed'
    )),
    -- Phase 1 CPU
    classification JSONB,
    evidence_pack_snapshot_id UUID REFERENCES trading_snapshots(id),
    -- Phase 2 LLM
    motivators JSONB DEFAULT '[]',
    success_factors JSONB DEFAULT '[]',
    failure_factors JSONB DEFAULT '[]',
    lessons JSONB,
    -- Meta
    engine_versions JSONB NOT NULL,
    error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_postmortem_fingerprint ON trading_postmortems(fingerprint);
CREATE INDEX IF NOT EXISTS idx_postmortem_position ON trading_postmortems(position_id);
CREATE INDEX IF NOT EXISTS idx_postmortem_tenant_status ON trading_postmortems(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_postmortem_created ON trading_postmortems(created_at);

ALTER TABLE trading_postmortems ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trading_postmortems_tenant_isolation ON trading_postmortems;
CREATE POLICY trading_postmortems_tenant_isolation ON trading_postmortems
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ============================================================
-- PARTE 4: Demo Trading - Balances
-- ============================================================
CREATE TABLE IF NOT EXISTS demo_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    currency TEXT NOT NULL DEFAULT 'USDT',
    available NUMERIC(20,8) NOT NULL DEFAULT 100000,
    frozen NUMERIC(20,8) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, currency)
);

ALTER TABLE demo_balances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS demo_balances_tenant_isolation ON demo_balances;
CREATE POLICY demo_balances_tenant_isolation ON demo_balances
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ============================================================
-- PARTE 5: Demo Trading - Fund History
-- ============================================================
CREATE TABLE IF NOT EXISTS demo_fund_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    amount NUMERIC(20,8) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USDT',
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_demo_fund_history_tenant ON demo_fund_history(tenant_id);

ALTER TABLE demo_fund_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS demo_fund_history_tenant_isolation ON demo_fund_history;
CREATE POLICY demo_fund_history_tenant_isolation ON demo_fund_history
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ============================================================
-- PARTE 6: Demo Trading - Orders
-- ============================================================
CREATE TABLE IF NOT EXISTS demo_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    market_type TEXT NOT NULL CHECK (market_type IN ('spot', 'futures', 'margin')),
    symbol TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
    order_type TEXT NOT NULL CHECK (order_type IN ('market', 'limit', 'stop')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'open', 'filled', 'partially_filled', 'cancelled', 'failed'
    )),
    price NUMERIC(20,8),
    stop_price NUMERIC(20,8),
    size NUMERIC(20,8) NOT NULL,
    leverage INTEGER DEFAULT 1,
    filled_size NUMERIC(20,8) DEFAULT 0,
    avg_filled_price NUMERIC(20,8),
    fees NUMERIC(20,8) DEFAULT 0,
    signal_id UUID,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    filled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_demo_orders_tenant ON demo_orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_demo_orders_status ON demo_orders(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_demo_orders_symbol ON demo_orders(symbol);

ALTER TABLE demo_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS demo_orders_tenant_isolation ON demo_orders;
CREATE POLICY demo_orders_tenant_isolation ON demo_orders
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ============================================================
-- PARTE 7: Demo Trading - Positions
-- ============================================================
CREATE TABLE IF NOT EXISTS demo_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    market_type TEXT NOT NULL CHECK (market_type IN ('spot', 'futures', 'margin')),
    symbol TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('long', 'short')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'liquidated')),
    entry_price NUMERIC(20,8) NOT NULL,
    exit_price NUMERIC(20,8),
    current_price NUMERIC(20,8),
    size NUMERIC(20,8) NOT NULL,
    leverage INTEGER DEFAULT 1,
    stop_loss NUMERIC(20,8),
    take_profit NUMERIC(20,8),
    unrealized_pnl NUMERIC(20,8) DEFAULT 0,
    realized_pnl NUMERIC(20,8) DEFAULT 0,
    total_fees NUMERIC(20,8) DEFAULT 0,
    margin_amount NUMERIC(20,8),
    liquidation_price NUMERIC(20,8),
    entry_snapshot_id UUID REFERENCES trading_snapshots(id),
    exit_snapshot_id UUID REFERENCES trading_snapshots(id),
    metadata JSONB DEFAULT '{}',
    opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_demo_positions_tenant ON demo_positions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_demo_positions_status ON demo_positions(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_demo_positions_symbol ON demo_positions(symbol);

ALTER TABLE demo_positions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS demo_positions_tenant_isolation ON demo_positions;
CREATE POLICY demo_positions_tenant_isolation ON demo_positions
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
