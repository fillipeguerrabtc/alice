-- ============================================================================
-- MIGRATION: Presets de notícias (SearXNG) para Trading
-- Data: 31/01/2026
-- ============================================================================

CREATE TABLE IF NOT EXISTS trading_news_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name varchar(120) NOT NULL,
  description text,
  config jsonb NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id),
  criado_em timestamp DEFAULT now(),
  atualizado_em timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trading_news_presets_tenant ON trading_news_presets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_trading_news_presets_name ON trading_news_presets(name);
CREATE INDEX IF NOT EXISTS idx_trading_news_presets_default ON trading_news_presets(is_default);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trading_news_presets_tenant_name ON trading_news_presets(tenant_id, name);

-- RLS multi-tenant
ALTER TABLE trading_news_presets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trading_news_presets_tenant_isolation ON trading_news_presets;
CREATE POLICY trading_news_presets_tenant_isolation ON trading_news_presets
  FOR ALL
  USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());

-- Presets principais por tenant (idempotente)
WITH preset_defs AS (
  SELECT
    'Cripto Essencial'::varchar AS name,
    'Notícias gerais de cripto com contexto macro.'::text AS description,
    '{
      "engines": [],
      "categories": "general",
      "language": "pt-BR",
      "safesearch": "1",
      "timeRange": "last_24_hours",
      "queryTemplates": [
        "{symbol} {marketType} news {terms}",
        "bitcoin news {terms}",
        "crypto market news {terms}"
      ],
      "extraTerms": ["macro", "regulação", "ETF", "CPI", "FOMC"],
      "maxResults": 5
    }'::jsonb AS config,
    true AS is_default
  UNION ALL
  SELECT
    'Macro & Regulação Global',
    'Macro global, bancos centrais e regulações internacionais.',
    '{
      "engines": [],
      "categories": "general",
      "language": "en",
      "safesearch": "1",
      "timeRange": "month",
      "queryTemplates": [
        "crypto regulation {terms}",
        "macro economy crypto {terms}",
        "central bank policy crypto {terms}"
      ],
      "extraTerms": ["SEC", "CFTC", "ESMA", "FATF", "MiCA", "ETF"],
      "maxResults": 5
    }'::jsonb,
    false
  UNION ALL
  SELECT
    'Brasil Regulação & Fiscal',
    'Regulação e fiscal no Brasil (CVM, Banco Central, Receita).',
    '{
      "engines": [],
      "categories": "general",
      "language": "pt-BR",
      "safesearch": "1",
      "timeRange": "month",
      "queryTemplates": [
        "Brasil regulação cripto {terms}",
        "Banco Central cripto {terms}",
        "CVM cripto {terms}"
      ],
      "extraTerms": ["tributação", "receita federal", "CBDC", "Drex"],
      "maxResults": 5
    }'::jsonb,
    false
  UNION ALL
  SELECT
    'Geopolítica & Risco',
    'Eventos geopolíticos e risco sistêmico com impacto em cripto.',
    '{
      "engines": [],
      "categories": "general",
      "language": "en",
      "safesearch": "1",
      "timeRange": "month",
      "queryTemplates": [
        "geopolitics risk assets crypto {terms}",
        "sanctions crypto {terms}",
        "war conflict market risk {terms}"
      ],
      "extraTerms": ["energy", "oil", "risk-off", "liquidity"],
      "maxResults": 5
    }'::jsonb,
    false
)
INSERT INTO trading_news_presets (tenant_id, name, description, config, is_default)
SELECT t.id, p.name, p.description, p.config, p.is_default
FROM tenants t
CROSS JOIN preset_defs p
WHERE NOT EXISTS (
  SELECT 1
  FROM trading_news_presets existing
  WHERE existing.tenant_id = t.id
    AND existing.name = p.name
);
