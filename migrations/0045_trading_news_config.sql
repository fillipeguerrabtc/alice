-- ============================================================================
-- MIGRATION: Configuração de notícias (SearXNG) em perfis de trading
-- Data: 31/01/2026
-- ============================================================================

ALTER TABLE trading_analysis_profiles
  ADD COLUMN IF NOT EXISTS news_config jsonb NOT NULL DEFAULT '{
    "engines": [],
    "categories": "general",
    "language": "pt-BR",
    "safesearch": "1",
    "timeRange": "last_24_hours",
    "queryTemplates": ["{symbol} {marketType} news {terms}"],
    "extraTerms": [],
    "maxResults": 5
  }'::jsonb;
