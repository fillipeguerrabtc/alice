-- Migration 0010: Índices Compostos para Queries Frequentes
-- 
-- Adiciona índices compostos e parciais para otimizar queries mais comuns:
-- - messages: por conversação e data
-- - trading_orders: por tenant e status (parcial)
-- - conversations: por tenant e data
-- - documents: por namespace e data de processamento
-- 
-- Documentação em PT-BR (Regra 10 CLAUDE.md)
-- Autor: Fillipe Guerra
-- Data: 19 de Dezembro de 2025

-- ============================================================================
-- ÍNDICES COMPOSTOS PARA QUERIES FREQUENTES
-- ============================================================================

-- messages: Query frequente por conversação ordenada por data
-- Otimiza: SELECT * FROM messages WHERE conversation_id = ? ORDER BY criado_em DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_conversation_created
ON messages (conversation_id, criado_em DESC);

-- conversations: Query frequente por tenant ordenada por último acesso
-- Otimiza: SELECT * FROM conversations WHERE tenant_id = ? ORDER BY atualizado_em DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_tenant_updated
ON conversations (tenant_id, atualizado_em DESC);

-- ============================================================================
-- ÍNDICES PARCIAIS PARA FILTROS COMUNS (Trading)
-- ============================================================================

-- trading_orders: Índice parcial para ordens ativas
-- Otimiza: SELECT * FROM trading_orders WHERE tenant_id = ? AND status IN ('open', 'pending')
-- Reduz tamanho do índice ignorando ordens canceladas/preenchidas (maioria)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trading_orders_active
ON trading_orders (tenant_id, status)
WHERE status IN ('open', 'pending');

-- trading_positions: Índice parcial para posições abertas
-- Otimiza: SELECT * FROM trading_positions WHERE tenant_id = ? AND status = 'open'
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trading_positions_open
ON trading_positions (tenant_id, symbol)
WHERE status = 'open';

-- trading_signals: Índice para sinais recentes por símbolo
-- Otimiza: SELECT * FROM trading_signals WHERE symbol = ? ORDER BY criado_em DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trading_signals_symbol_created
ON trading_signals (symbol, criado_em DESC);

-- ============================================================================
-- ÍNDICES PARA RAG E DOCUMENTOS
-- ============================================================================

-- documents: Por namespace e data de processamento
-- Otimiza: SELECT * FROM documents WHERE namespace_id = ? AND processado = true ORDER BY atualizado_em DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_namespace_processed
ON documents (namespace_id, processado, atualizado_em DESC)
WHERE processado = true;

-- document_chunks: Por documento pai
-- Otimiza: SELECT * FROM document_chunks WHERE document_id = ? ORDER BY chunk_index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_chunks_document_order
ON document_chunks (document_id, chunk_index);

-- ============================================================================
-- ÍNDICES PARA AUDITORIA E LOGS
-- ============================================================================

-- audit_logs: Por tenant e data (queries de compliance)
-- Otimiza: SELECT * FROM audit_logs WHERE tenant_id = ? ORDER BY criado_em DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_tenant_timestamp
ON audit_logs (tenant_id, criado_em DESC);

-- ============================================================================
-- COMENTÁRIOS DE DOCUMENTAÇÃO
-- ============================================================================

COMMENT ON INDEX idx_messages_conversation_created IS 
  'Índice composto para listar mensagens por conversação ordenadas por data (query mais frequente do chat)';

COMMENT ON INDEX idx_conversations_tenant_updated IS 
  'Índice composto para listar conversações por tenant ordenadas por último acesso';

COMMENT ON INDEX idx_trading_orders_active IS 
  'Índice parcial para ordens ativas - exclui ordens canceladas/preenchidas (90%+ dos registros)';

COMMENT ON INDEX idx_trading_positions_open IS 
  'Índice parcial para posições abertas por tenant e símbolo';

COMMENT ON INDEX idx_trading_signals_symbol_created IS 
  'Índice composto para sinais de trading por símbolo ordenados por data';

COMMENT ON INDEX idx_documents_namespace_processed IS 
  'Índice parcial para documentos processados por namespace';

COMMENT ON INDEX idx_document_chunks_document_order IS 
  'Índice composto para chunks ordenados por índice dentro do documento';

COMMENT ON INDEX idx_audit_logs_tenant_timestamp IS 
  'Índice composto para consultas de auditoria por tenant e período';
