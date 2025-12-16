-- ============================================================================
-- MIGRAÇÃO: Persistência Multimodal (Learning Orchestrator + Web Crawler + Media Jobs)
-- Descrição: adiciona colunas enterprise na learning_tasks e cria tabelas
--            learning_task_events, web_crawl_requests, web_crawl_results,
--            media_jobs com RLS multi-tenant.
-- Regra 6: Persistência real em PostgreSQL (zero workarounds/mocks)
-- 
-- NOTA (15/12/2025): 100% IDEMPOTENTE - pode ser re-executada em qualquer estado
-- - Foreign keys para tenants/users removidas (Drizzle ORM)
-- - DROP POLICY IF EXISTS antes de CREATE POLICY
-- - CREATE TABLE/INDEX IF NOT EXISTS
-- - DO blocks com verificação de existência
-- 
-- Autor: Fillipe Guerra
-- Data: 15 de Dezembro de 2025
-- Versão: 1.2 - 100% Idempotente (Enterprise-Grade)
-- ============================================================================

-- ============================================================================
-- 0) PRÉ-REQUISITO: Garantir que enum task_status existe
-- NOTA: Este enum é usado por learning_task_events e media_jobs
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_status') THEN
    CREATE TYPE task_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled');
    RAISE NOTICE 'Enum task_status criado';
  ELSE
    RAISE NOTICE 'Enum task_status já existe';
  END IF;
END$$;

-- ============================================================================
-- 1) Ajustes em learning_tasks para fila priorizada e RLS
-- NOTA (15/12/2025): Envolvido em DO block para idempotência - tabela pode não
-- existir no primeiro deploy (criada pelo Drizzle ORM)
-- ============================================================================

DO $$
BEGIN
  -- Verificar se tabela learning_tasks existe antes de alterar
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'learning_tasks') THEN
    -- NOTA: criado_por sem FK para users (criada pelo Drizzle ORM)
ALTER TABLE learning_tasks
  ADD COLUMN IF NOT EXISTS tenant_id UUID,
  ADD COLUMN IF NOT EXISTS prioridade INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS tentativas INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_tentativas INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS agendado_para TIMESTAMP NULL,
      ADD COLUMN IF NOT EXISTS criado_por VARCHAR(255);
    RAISE NOTICE 'Colunas adicionadas em learning_tasks';
  ELSE
    RAISE NOTICE 'Tabela learning_tasks não existe - será criada pelo Drizzle ORM';
  END IF;
END$$;

-- Backfill seguro de tenant_id (usa relacionamentos existentes)
-- NOTA (15/12/2025): Backfill condicional - só executa se tabelas Drizzle existirem
-- Em servidor virgem (primeiro deploy), essas tabelas ainda não existem
DO $$
BEGIN
  -- Verificar se tabela learning_tasks existe (pode não existir em primeiro deploy)
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'learning_tasks') THEN
    RAISE NOTICE 'Tabela learning_tasks não existe - pulando backfill (servidor virgem)';
    RETURN;
  END IF;

  -- Verificar se existem dados para migrar
  IF NOT EXISTS (SELECT 1 FROM learning_tasks LIMIT 1) THEN
    RAISE NOTICE 'Nenhum dado em learning_tasks - pulando backfill';
    -- Não precisa aplicar NOT NULL se tabela está vazia ou não existe
    RETURN;
  END IF;

  -- Se existir namespace associado E tabela namespaces existir, herda tenant do namespace
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'namespaces') THEN
  UPDATE learning_tasks lt
  SET tenant_id = n.tenant_id
  FROM namespaces n
  WHERE lt.namespace_id = n.id
    AND lt.tenant_id IS NULL;
  END IF;

  -- Se existir agent associado E tabela agents existir, herda tenant do agent
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'agents') THEN
  UPDATE learning_tasks lt
  SET tenant_id = a.tenant_id
  FROM agents a
  WHERE lt.agent_id = a.id
    AND lt.tenant_id IS NULL;
  END IF;

  -- Caso ainda reste null em tabela com dados, falha explicitamente para evitar dados órfãos
  IF EXISTS (SELECT 1 FROM learning_tasks WHERE tenant_id IS NULL) THEN
    RAISE EXCEPTION 'learning_tasks.tenant_id não pode ser nulo; revise dados legados antes do deploy.';
  END IF;
END$$;

-- Aplicar NOT NULL apenas se tabela existir e tiver dados válidos
-- NOTA: Em servidor virgem, a tabela pode não existir ou estar vazia
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'learning_tasks') THEN
    -- Verificar se há dados com tenant_id NULL (não deve aplicar NOT NULL nesse caso)
    IF NOT EXISTS (SELECT 1 FROM learning_tasks WHERE tenant_id IS NULL) THEN
      ALTER TABLE learning_tasks ALTER COLUMN tenant_id SET NOT NULL;
      RAISE NOTICE 'NOT NULL aplicado em learning_tasks.tenant_id';
    ELSE
      RAISE NOTICE 'Skipping NOT NULL - existem dados com tenant_id NULL';
    END IF;
  END IF;
END$$;

-- Índices e RLS para learning_tasks (apenas se tabela existir)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'learning_tasks') THEN
    -- Dropar índices antigos
DROP INDEX IF EXISTS idx_learning_tasks_priority;
DROP INDEX IF EXISTS idx_learning_tasks_status;
DROP INDEX IF EXISTS idx_learning_tasks_agent;

-- Garantir status NOT NULL com default pending (integridade da fila)
    -- Apenas se coluna status existir
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'learning_tasks' AND column_name = 'status'
    ) THEN
      ALTER TABLE learning_tasks ALTER COLUMN status SET NOT NULL;
    END IF;
    
    -- Criar índices (100% idempotente com IF NOT EXISTS)
    CREATE INDEX IF NOT EXISTS idx_learning_tasks_priority
  ON learning_tasks(tenant_id, status, prioridade, agendado_para, criado_em);
    CREATE INDEX IF NOT EXISTS idx_learning_tasks_status
  ON learning_tasks(tenant_id, status);
    CREATE INDEX IF NOT EXISTS idx_learning_tasks_agent
  ON learning_tasks(tenant_id, agent_id);

    -- RLS alinhado ao modelo multi-tenant
ALTER TABLE learning_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS learning_tasks_super_admin ON learning_tasks;
CREATE POLICY learning_tasks_super_admin ON learning_tasks
  FOR ALL
  USING (is_super_admin() = true);

DROP POLICY IF EXISTS learning_tasks_tenant_policy ON learning_tasks;
CREATE POLICY learning_tasks_tenant_policy ON learning_tasks
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
    
    RAISE NOTICE 'Índices e RLS aplicados em learning_tasks';
  ELSE
    RAISE NOTICE 'Tabela learning_tasks não existe - índices e RLS serão aplicados quando criada';
  END IF;
END$$;

-- ============================================================================
-- 2) Tabela: learning_task_events (log estruturado de progresso)
-- NOTA (15/12/2025): FK para learning_tasks removida - tabela pode não existir
-- no primeiro deploy (criada pelo Drizzle ORM). Integridade mantida pela app.
-- ============================================================================

CREATE TABLE IF NOT EXISTS learning_task_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  -- NOTA: learning_task_id sem FK para learning_tasks (criada pelo Drizzle ORM)
  learning_task_id UUID NOT NULL,
  status task_status NOT NULL,
  mensagem TEXT,
  payload JSONB DEFAULT '{}'::jsonb,
  criado_em TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_learning_task_events_task
  ON learning_task_events(learning_task_id);
CREATE INDEX IF NOT EXISTS idx_learning_task_events_tenant_status
  ON learning_task_events(tenant_id, status, criado_em);

ALTER TABLE learning_task_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS learning_task_events_super_admin ON learning_task_events;
CREATE POLICY learning_task_events_super_admin ON learning_task_events
  FOR ALL
  USING (is_super_admin() = true);

DROP POLICY IF EXISTS learning_task_events_tenant_policy ON learning_task_events;
CREATE POLICY learning_task_events_tenant_policy ON learning_task_events
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ============================================================================
-- 3) Enum: web_crawl_status
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'web_crawl_status') THEN
    CREATE TYPE web_crawl_status AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled');
  END IF;
END$$;

-- ============================================================================
-- 4) Tabela: web_crawl_requests
-- ============================================================================

-- NOTA: tenant_id e criado_por sem FKs (tabelas criadas pelo Drizzle ORM)
CREATE TABLE IF NOT EXISTS web_crawl_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  url TEXT NOT NULL,
  status web_crawl_status NOT NULL DEFAULT 'pending',
  profundidade_max INTEGER NOT NULL DEFAULT 1,
  paginas_max INTEGER NOT NULL DEFAULT 5,
  bytes_max INTEGER NOT NULL DEFAULT 5000000,
  timeout_ms INTEGER NOT NULL DEFAULT 15000,
  prioridade INTEGER NOT NULL DEFAULT 5,
  agendado_para TIMESTAMP NULL,
  iniciado_em TIMESTAMP NULL,
  finalizado_em TIMESTAMP NULL,
  erro TEXT NULL,
  criado_por VARCHAR(255),
  criado_em TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_web_crawl_tenant_status
  ON web_crawl_requests(tenant_id, status, prioridade, agendado_para, criado_em);
CREATE INDEX IF NOT EXISTS idx_web_crawl_url
  ON web_crawl_requests(url);

ALTER TABLE web_crawl_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS web_crawl_requests_super_admin ON web_crawl_requests;
CREATE POLICY web_crawl_requests_super_admin ON web_crawl_requests
  FOR ALL
  USING (is_super_admin() = true);

DROP POLICY IF EXISTS web_crawl_requests_tenant_policy ON web_crawl_requests;
CREATE POLICY web_crawl_requests_tenant_policy ON web_crawl_requests
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ============================================================================
-- 5) Tabela: web_crawl_results
-- ============================================================================

-- NOTA: tenant_id sem FK para tenants (criada pelo Drizzle ORM)
CREATE TABLE IF NOT EXISTS web_crawl_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  request_id UUID NOT NULL REFERENCES web_crawl_requests(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  titulo TEXT,
  conteudo TEXT,
  status_code INTEGER,
  mime_type VARCHAR(200),
  tamanho_bytes INTEGER,
  hash_conteudo VARCHAR(128),
  metadata JSONB DEFAULT '{}'::jsonb,
  criado_em TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_web_crawl_results_tenant
  ON web_crawl_results(tenant_id, request_id);
CREATE INDEX IF NOT EXISTS idx_web_crawl_results_url
  ON web_crawl_results(url);

ALTER TABLE web_crawl_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS web_crawl_results_super_admin ON web_crawl_results;
CREATE POLICY web_crawl_results_super_admin ON web_crawl_results
  FOR ALL
  USING (is_super_admin() = true);

DROP POLICY IF EXISTS web_crawl_results_tenant_policy ON web_crawl_results;
CREATE POLICY web_crawl_results_tenant_policy ON web_crawl_results
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ============================================================================
-- 6) Enum: media_job_type
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'media_job_type') THEN
    CREATE TYPE media_job_type AS ENUM ('tts', 'talking_head', 'lip_sync', 'long_video', 'image_enhance', 'audio_clean');
  END IF;
END$$;

-- ============================================================================
-- 7) Tabela: media_jobs (pipeline multimodal)
-- ============================================================================

-- NOTA: tenant_id e criado_por sem FKs (tabelas criadas pelo Drizzle ORM)
CREATE TABLE IF NOT EXISTS media_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  job_type media_job_type NOT NULL,
  status task_status DEFAULT 'pending',
  prioridade INTEGER NOT NULL DEFAULT 5,
  input_url TEXT,
  input_path TEXT,
  parametros JSONB DEFAULT '{}'::jsonb,
  resultado JSONB,
  erro TEXT,
  tentativas INTEGER NOT NULL DEFAULT 0,
  max_tentativas INTEGER NOT NULL DEFAULT 3,
  agendado_para TIMESTAMP,
  iniciado_em TIMESTAMP,
  finalizado_em TIMESTAMP,
  criado_por VARCHAR(255),
  criado_em TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_jobs_tenant_status
  ON media_jobs(tenant_id, status, prioridade, agendado_para, criado_em);
CREATE INDEX IF NOT EXISTS idx_media_jobs_type
  ON media_jobs(job_type);

ALTER TABLE media_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS media_jobs_super_admin ON media_jobs;
CREATE POLICY media_jobs_super_admin ON media_jobs
  FOR ALL
  USING (is_super_admin() = true);

DROP POLICY IF EXISTS media_jobs_tenant_policy ON media_jobs;
CREATE POLICY media_jobs_tenant_policy ON media_jobs
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ============================================================================
-- DOCUMENTAÇÃO
-- ============================================================================
-- Documento em Português Brasileiro
-- Autor: Fillipe Guerra
-- Data: 12 de Dezembro de 2025
-- Versão: 1.0 - Persistência Multimodal (Learning + Crawler + Media Jobs)
