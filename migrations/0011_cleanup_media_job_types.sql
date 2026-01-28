-- =============================================================================
-- Migration 0011: Limpeza de Job Types de Mídia Obsoletos
-- =============================================================================
-- Remove job types que nunca foram implementados (TTS, Talking Head, Lip Sync, Long Video)
-- Mantém apenas: image_enhance, audio_clean
--
-- NOTA: No PostgreSQL, não é possível remover valores de um enum diretamente.
-- Esta migration usa a estratégia de criar novo enum e migrar os dados.
--
-- Autor: Fillipe Guerra
-- Data: 19 de Dezembro de 2025
-- =============================================================================

-- Passo 1: Deletar jobs com tipos obsoletos (se houver)
-- Regra 6 CLAUDE.md: Sem workarounds - limpeza completa
DELETE FROM media_jobs
WHERE job_type::text IN ('tts', 'talking_head', 'lip_sync', 'long_video');

-- Passo 2: Criar novo enum com apenas os tipos válidos
CREATE TYPE media_job_type_new AS ENUM ('image_enhance', 'audio_clean');

-- Passo 3: Alterar a coluna para usar o novo tipo
-- Primeiro, drop o default se houver
ALTER TABLE media_jobs 
ALTER COLUMN job_type DROP DEFAULT;

-- Alterar o tipo da coluna
ALTER TABLE media_jobs 
ALTER COLUMN job_type TYPE media_job_type_new 
USING job_type::text::media_job_type_new;

-- Passo 4: Remover o enum antigo
DROP TYPE IF EXISTS media_job_type;

-- Passo 5: Renomear o novo enum para o nome original
ALTER TYPE media_job_type_new RENAME TO media_job_type;

-- Passo 6: Adicionar comentário para auditoria
COMMENT ON TYPE media_job_type IS 'Tipos de jobs de mídia (limpeza 19/12/2025 - removidos: tts, talking_head, lip_sync, long_video)';
