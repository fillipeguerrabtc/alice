-- Migration: Marcar fontes como "já enviadas para treinamento" para evitar duplicidade
-- Todas as fontes que podem gerar training_data ou trading_dataset passam a ter
-- sent_to_training_at preenchido após envio bem-sucedido.
-- Autor: Fillipe Guerra | Data: 2026-02-11

-- conversations: enviar conversa para Training (chat)
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS sent_to_training_at TIMESTAMPTZ;

COMMENT ON COLUMN conversations.sent_to_training_at IS 'Preenchido quando a conversa foi enviada para a página Training (evita envio duplo).';

-- documents: enviar documento RAG para Training
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS sent_to_training_at TIMESTAMPTZ;

COMMENT ON COLUMN documents.sent_to_training_at IS 'Preenchido quando o documento foi enviado para Training (evita envio duplo).';

-- trading_signals: criar dataset de trading a partir do sinal
ALTER TABLE trading_signals
  ADD COLUMN IF NOT EXISTS sent_to_training_at TIMESTAMPTZ;

COMMENT ON COLUMN trading_signals.sent_to_training_at IS 'Preenchido quando um trading_dataset foi criado a partir deste sinal (evita envio duplo).';

-- trading_postmortems: enviar post-mortem para Training
ALTER TABLE trading_postmortems
  ADD COLUMN IF NOT EXISTS sent_to_training_at TIMESTAMPTZ;

COMMENT ON COLUMN trading_postmortems.sent_to_training_at IS 'Preenchido quando um trading_dataset foi criado a partir deste post-mortem (evita envio duplo).';

-- Índices para consultas "já enviado?"
CREATE INDEX IF NOT EXISTS idx_conversations_sent_to_training_at ON conversations (sent_to_training_at) WHERE sent_to_training_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_sent_to_training_at ON documents (sent_to_training_at) WHERE sent_to_training_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trading_signals_sent_to_training_at ON trading_signals (sent_to_training_at) WHERE sent_to_training_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trading_postmortems_sent_to_training_at ON trading_postmortems (sent_to_training_at) WHERE sent_to_training_at IS NOT NULL;
