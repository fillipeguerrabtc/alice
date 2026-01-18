-- ============================================================================
-- MIGRAÇÃO: Sliders de comportamento e humor (assistant_settings)
-- Descrição: Campos numéricos (0-100) para sliders enterprise
-- Regra 6: Persistência real em PostgreSQL (zero soluções temporárias)
--
-- Author: Fillipe Guerra
-- Data: 17 de Janeiro de 2026
-- Versão: 1.0
-- ============================================================================

ALTER TABLE assistant_settings
    ADD COLUMN IF NOT EXISTS behavior_directness INTEGER,
    ADD COLUMN IF NOT EXISTS behavior_proactivity INTEGER,
    ADD COLUMN IF NOT EXISTS mood_formality INTEGER,
    ADD COLUMN IF NOT EXISTS mood_empathy INTEGER;

-- ============================================================================
-- CONSTRAINTS: Garantir faixa 0-100 (quando definido)
-- ============================================================================

ALTER TABLE assistant_settings
    DROP CONSTRAINT IF EXISTS chk_assistant_settings_behavior_directness,
    DROP CONSTRAINT IF EXISTS chk_assistant_settings_behavior_proactivity,
    DROP CONSTRAINT IF EXISTS chk_assistant_settings_mood_formality,
    DROP CONSTRAINT IF EXISTS chk_assistant_settings_mood_empathy;

ALTER TABLE assistant_settings
    ADD CONSTRAINT chk_assistant_settings_behavior_directness
        CHECK (behavior_directness IS NULL OR (behavior_directness BETWEEN 0 AND 100)),
    ADD CONSTRAINT chk_assistant_settings_behavior_proactivity
        CHECK (behavior_proactivity IS NULL OR (behavior_proactivity BETWEEN 0 AND 100)),
    ADD CONSTRAINT chk_assistant_settings_mood_formality
        CHECK (mood_formality IS NULL OR (mood_formality BETWEEN 0 AND 100)),
    ADD CONSTRAINT chk_assistant_settings_mood_empathy
        CHECK (mood_empathy IS NULL OR (mood_empathy BETWEEN 0 AND 100));

-- ============================================================================
-- COMENTÁRIOS para documentação
-- ============================================================================

COMMENT ON COLUMN assistant_settings.behavior_directness IS 'Nível de diretividade (0-100)';
COMMENT ON COLUMN assistant_settings.behavior_proactivity IS 'Nível de proatividade (0-100)';
COMMENT ON COLUMN assistant_settings.mood_formality IS 'Nível de formalidade (0-100)';
COMMENT ON COLUMN assistant_settings.mood_empathy IS 'Nível de empatia (0-100)';

-- ============================================================================
-- Documento em Português Brasileiro
-- Author: Fillipe Guerra
-- Data: 17 de Janeiro de 2026
-- Versão: 1.0
-- ============================================================================
