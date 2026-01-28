-- =============================================================================
-- Migration 0012: Tabela de Indicadores Técnicos para Trading
-- =============================================================================
-- Armazena cálculos DETERMINÍSTICOS de indicadores técnicos.
-- Elimina alucinações do LLM ao fornecer dados reais calculados por código.
--
-- ARQUITETURA ENTERPRISE:
-- 1. Código calcula indicadores (determinístico)
-- 2. Valores são persistidos nesta tabela
-- 3. LLM recebe valores para INTERPRETAR (não calcular)
-- 4. Validação cruzada verifica se LLM citou valores corretos
--
-- Autor: Fillipe Guerra
-- Data: 21 de Dezembro de 2025
-- Regra 6: Persistência real em PostgreSQL, sem mocks
-- =============================================================================

-- Tabela de indicadores técnicos calculados
CREATE TABLE IF NOT EXISTS trading_technical_indicators (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Identificação temporal
    symbol VARCHAR(50) NOT NULL DEFAULT 'XBTUSDTM',
    interval VARCHAR(20) NOT NULL, -- '1m', '3m', '5m', '15m', '1h', '4h', '1d'
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    candle_timestamp TIMESTAMPTZ NOT NULL, -- Timestamp do último candle usado
    
    -- Preço atual
    current_price DECIMAL(20, 8) NOT NULL,
    
    -- RSI (Relative Strength Index)
    rsi_value DECIMAL(6, 2),
    rsi_interpretation VARCHAR(20), -- 'oversold', 'neutral', 'overbought'
    rsi_period INTEGER DEFAULT 14,
    
    -- MACD (Moving Average Convergence Divergence)
    macd_line DECIMAL(20, 8),
    macd_signal DECIMAL(20, 8),
    macd_histogram DECIMAL(20, 8),
    macd_interpretation VARCHAR(20), -- 'bullish', 'bearish', 'neutral'
    macd_crossover VARCHAR(20), -- 'bullish_cross', 'bearish_cross', 'none'
    
    -- Médias Móveis Exponenciais (EMA)
    ema_9 DECIMAL(20, 8),
    ema_21 DECIMAL(20, 8),
    ema_50 DECIMAL(20, 8),
    ema_200 DECIMAL(20, 8),
    
    -- Médias Móveis Simples (SMA)
    sma_20 DECIMAL(20, 8),
    sma_50 DECIMAL(20, 8),
    sma_200 DECIMAL(20, 8),
    
    -- Tendência baseada em MAs
    ma_trend VARCHAR(20), -- 'bullish', 'bearish', 'sideways'
    
    -- Bollinger Bands
    bollinger_upper DECIMAL(20, 8),
    bollinger_middle DECIMAL(20, 8),
    bollinger_lower DECIMAL(20, 8),
    bollinger_width DECIMAL(10, 6),
    bollinger_percent_b DECIMAL(6, 2),
    bollinger_interpretation VARCHAR(20), -- 'oversold', 'neutral', 'overbought'
    
    -- ATR (Average True Range)
    atr_value DECIMAL(20, 8),
    atr_percentage DECIMAL(6, 2),
    atr_volatility VARCHAR(20), -- 'low', 'medium', 'high'
    
    -- Stochastic Oscillator
    stochastic_k DECIMAL(6, 2),
    stochastic_d DECIMAL(6, 2),
    stochastic_interpretation VARCHAR(20), -- 'oversold', 'neutral', 'overbought'
    
    -- ADX (Average Directional Index)
    adx_value DECIMAL(6, 2),
    adx_plus_di DECIMAL(6, 2),
    adx_minus_di DECIMAL(6, 2),
    adx_trend_strength VARCHAR(20), -- 'weak', 'moderate', 'strong', 'very_strong'
    
    -- Suporte e Resistência (Pivot Points)
    pivot_point DECIMAL(20, 8),
    resistance_1 DECIMAL(20, 8),
    resistance_2 DECIMAL(20, 8),
    resistance_3 DECIMAL(20, 8),
    support_1 DECIMAL(20, 8),
    support_2 DECIMAL(20, 8),
    support_3 DECIMAL(20, 8),
    
    -- Volume
    current_volume DECIMAL(20, 2),
    average_volume DECIMAL(20, 2),
    volume_ratio DECIMAL(6, 2),
    obv DECIMAL(20, 2), -- On-Balance Volume
    volume_interpretation VARCHAR(20), -- 'low', 'normal', 'high', 'very_high'
    
    -- Sinal geral calculado por código (não LLM)
    overall_signal VARCHAR(20) NOT NULL, -- 'strong_buy', 'buy', 'neutral', 'sell', 'strong_sell'
    signal_confidence DECIMAL(4, 2) NOT NULL, -- 0.00 a 1.00
    
    -- Metadata JSON para dados adicionais
    metadata JSONB DEFAULT '{}',
    
    -- Timestamps
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Constraints
    CONSTRAINT valid_rsi CHECK (rsi_value IS NULL OR (rsi_value >= 0 AND rsi_value <= 100)),
    CONSTRAINT valid_confidence CHECK (signal_confidence >= 0 AND signal_confidence <= 1),
    CONSTRAINT valid_interval CHECK (interval IN ('1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '12h', '1d', '1w'))
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_trading_indicators_tenant 
    ON trading_technical_indicators(tenant_id);

CREATE INDEX IF NOT EXISTS idx_trading_indicators_symbol_interval 
    ON trading_technical_indicators(symbol, interval);

CREATE INDEX IF NOT EXISTS idx_trading_indicators_calculated_at 
    ON trading_technical_indicators(calculated_at DESC);

CREATE INDEX IF NOT EXISTS idx_trading_indicators_signal 
    ON trading_technical_indicators(overall_signal);

-- Índice composto para consultas frequentes
CREATE INDEX IF NOT EXISTS idx_trading_indicators_lookup
    ON trading_technical_indicators(tenant_id, symbol, interval, calculated_at DESC);

-- Comentários para documentação
COMMENT ON TABLE trading_technical_indicators IS 
'Indicadores técnicos calculados por código (determinísticos) para análise de trading. LLM recebe estes valores para INTERPRETAR, não calcular.';

COMMENT ON COLUMN trading_technical_indicators.overall_signal IS 
'Sinal calculado por código baseado em scoring de múltiplos indicadores - NÃO é gerado por LLM';

COMMENT ON COLUMN trading_technical_indicators.signal_confidence IS 
'Confiança do sinal (0-1) calculada por código - NÃO é probabilidade do LLM';

-- =============================================================================
-- RLS (Row Level Security) - Regra 6 CLAUDE.md
-- =============================================================================

ALTER TABLE trading_technical_indicators ENABLE ROW LEVEL SECURITY;

-- Policies (idempotentes)
DROP POLICY IF EXISTS trading_indicators_select_policy ON trading_technical_indicators;
CREATE POLICY trading_indicators_select_policy ON trading_technical_indicators
    FOR SELECT
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS trading_indicators_insert_policy ON trading_technical_indicators;
CREATE POLICY trading_indicators_insert_policy ON trading_technical_indicators
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS trading_indicators_update_policy ON trading_technical_indicators;
CREATE POLICY trading_indicators_update_policy ON trading_technical_indicators
    FOR UPDATE
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS trading_indicators_delete_policy ON trading_technical_indicators;
CREATE POLICY trading_indicators_delete_policy ON trading_technical_indicators
    FOR DELETE
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- =============================================================================
-- Tabela de Validação Cruzada (Cross-Validation)
-- =============================================================================
-- Registra quando o LLM cita valores e se foram validados como corretos

CREATE TABLE IF NOT EXISTS trading_llm_validations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Referências
    signal_id UUID REFERENCES trading_signals(id) ON DELETE SET NULL,
    indicator_snapshot_id UUID REFERENCES trading_technical_indicators(id) ON DELETE SET NULL,
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    
    -- Valores citados pelo LLM (extraídos da resposta)
    llm_cited_values JSONB NOT NULL, -- { "rsi": 45.2, "macd_histogram": 123.45, ... }
    
    -- Valores reais calculados por código
    actual_values JSONB NOT NULL, -- { "rsi": 45.18, "macd_histogram": 123.52, ... }
    
    -- Resultado da validação
    validation_passed BOOLEAN NOT NULL,
    discrepancies JSONB, -- { "rsi": { "cited": 45.2, "actual": 45.18, "diff": 0.02 } }
    max_allowed_deviation DECIMAL(6, 4) DEFAULT 0.01, -- 1% de desvio permitido
    
    -- Ação tomada
    action_taken VARCHAR(50), -- 'approved', 'rejected', 'flagged_for_review'
    
    -- Timestamps
    validated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_llm_validations_tenant 
    ON trading_llm_validations(tenant_id);

CREATE INDEX IF NOT EXISTS idx_llm_validations_signal 
    ON trading_llm_validations(signal_id);

CREATE INDEX IF NOT EXISTS idx_llm_validations_passed 
    ON trading_llm_validations(validation_passed);

CREATE INDEX IF NOT EXISTS idx_llm_validations_date 
    ON trading_llm_validations(validated_at DESC);

-- Comentários
COMMENT ON TABLE trading_llm_validations IS 
'Registro de validação cruzada entre valores citados pelo LLM e valores reais calculados. Detecta alucinações numéricas.';

-- RLS
ALTER TABLE trading_llm_validations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS llm_validations_select_policy ON trading_llm_validations;
CREATE POLICY llm_validations_select_policy ON trading_llm_validations
    FOR SELECT
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS llm_validations_insert_policy ON trading_llm_validations;
CREATE POLICY llm_validations_insert_policy ON trading_llm_validations
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS llm_validations_update_policy ON trading_llm_validations;
CREATE POLICY llm_validations_update_policy ON trading_llm_validations
    FOR UPDATE
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS llm_validations_delete_policy ON trading_llm_validations;
CREATE POLICY llm_validations_delete_policy ON trading_llm_validations
    FOR DELETE
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- =============================================================================
-- Nota sobre limpeza automática (dados antigos)
-- =============================================================================
-- IMPORTANTE: não usar índice parcial com now() porque a função não é IMMUTABLE.
-- O índice idx_trading_indicators_calculated_at já existe e deve ser usado
-- pelas rotinas de manutenção para filtrar por data.

