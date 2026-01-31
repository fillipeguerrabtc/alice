-- ============================================================================
-- MIGRATION: Time range para notícias (SearXNG) em Trading
-- Data: 31/01/2026
-- ============================================================================

-- Atualiza default da coluna news_config para incluir timeRange
ALTER TABLE trading_analysis_profiles
  ALTER COLUMN news_config SET DEFAULT '{
    "engines": [],
    "categories": "general",
    "language": "pt-BR",
    "safesearch": "1",
    "timeRange": "last_24_hours",
    "queryTemplates": ["{symbol} {marketType} news {terms}"],
    "extraTerms": [],
    "maxResults": 5
  }'::jsonb;

-- Backfill somente quando não existe timeRange
UPDATE trading_analysis_profiles
SET news_config = jsonb_set(news_config, '{timeRange}', '"last_24_hours"', true)
WHERE NOT (news_config ? 'timeRange');

UPDATE trading_news_presets
SET config = jsonb_set(config, '{timeRange}', '"last_24_hours"', true)
WHERE NOT (config ? 'timeRange');
