-- =============================================================================
-- Migration 0013: Renomear feature flag resend_enabled para email_enabled
-- =============================================================================
-- Data: 30/12/2025
-- Autor: Fillipe Guerra
-- Descrição: Renomeia o feature flag de Resend para Gmail SMTP
--
-- CONTEXTO:
-- A plataforma migrou de Resend para Gmail SMTP para envio de emails.
-- O feature flag precisa ser atualizado para refletir essa mudança.
--
-- IDEMPOTÊNCIA: Esta migration é segura para executar múltiplas vezes.
-- Apenas renomeia se o registro antigo existir e o novo não existir.
-- =============================================================================

-- Renomear o feature flag de resend_enabled para email_enabled
-- Apenas se o registro antigo existir e o novo não existir
UPDATE feature_flags
SET 
  key = 'email_enabled',
  description = 'Integração Gmail SMTP (requer configuração)'
WHERE key = 'resend_enabled'
  AND NOT EXISTS (SELECT 1 FROM feature_flags WHERE key = 'email_enabled');

-- Se por algum motivo ambos existirem, remover o antigo
DELETE FROM feature_flags 
WHERE key = 'resend_enabled' 
  AND EXISTS (SELECT 1 FROM feature_flags WHERE key = 'email_enabled');

-- Inserir o novo flag se não existir nenhum dos dois (primeiro deploy)
INSERT INTO feature_flags (key, enabled, description, criado_em)
SELECT 'email_enabled', false, 'Integração Gmail SMTP (requer configuração)', NOW()
WHERE NOT EXISTS (SELECT 1 FROM feature_flags WHERE key = 'email_enabled')
  AND NOT EXISTS (SELECT 1 FROM feature_flags WHERE key = 'resend_enabled');
