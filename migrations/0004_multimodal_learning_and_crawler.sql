-- ============================================================================
-- MIGRAÇÃO: Persistência Multimodal (Learning Orchestrator + Web Crawler + Media Jobs)
-- Descrição: adiciona colunas enterprise na learning_tasks e cria tabelas
--            learning_task_events, web_crawl_requests, web_crawl_results,
--            media_jobs com RLS multi-tenant.
-- Regra 6: Persistência real em PostgreSQL (zero workarounds/mocks)
-- Autor: Fillipe Guerra
-- Data: 12 de Dezembro de 2025
-- Versão: 1.0
-- ============================================================================

-- ============================================================================
-- 1) Ajustes em learning_tasks para fila priorizada e RLS
-- ============================================================================

ALTER TABLE learning_tasks
  ADD COLUMN IF NOT EXISTS tenant_id UUID,
  ADD COLUMN IF NOT EXISTS prioridade INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS tentativas INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_tentativas INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS agendado_para TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS criado_por VARCHAR(255) REFERENCES users(id);

-- Backfill seguro de tenant_id (usa relacionamentos existentes)
DO $$
BEGIN
  -- Se existir namespace associado, herda tenant do namespace
  UPDATE learning_tasks lt
  SET tenant_id = n.tenant_id
  FROM namespaces n
  WHERE lt.namespace_id = n.id
    AND lt.tenant_id IS NULL;

  -- Se existir agent associado, herda tenant do agent
  UPDATE learning_tasks lt
  SET tenant_id = a.tenant_id
  FROM agents a
  WHERE lt.agent_id = a.id
    AND lt.tenant_id IS NULL;

  -- Caso ainda reste null, falha explicitamente para evitar dados órfãos
  IF EXISTS (SELECT 1 FROM learning_tasks WHERE tenant_id IS NULL) THEN
    RAISE EXCEPTION 'learning_tasks.tenant_id não pode ser nulo; revise dados legados antes do deploy.';
  END IF;
END$$;

-- Agora aplicar NOT NULL e FK
ALTER TABLE learning_tasks
  ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE learning_tasks
  ADD CONSTRAINT learning_tasks_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);

-- Índices priorizados por tenant/status
CREATE INDEX IF NOT EXISTS idx_learning_tasks_priority
  ON learning_tasks(tenant_id, status, prioridade, agendado_para, criado_em);
CREATE INDEX IF NOT EXISTS idx_learning_tasks_status
  ON learning_tasks(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_learning_tasks_agent
  ON learning_tasks(tenant_id, agent_id);

-- RLS alinhado ao modelo multi-tenant (usa funções current_tenant_id/is_super_admin)
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

-- ============================================================================
-- 2) Tabela: learning_task_events (log estruturado de progresso)
-- ============================================================================

CREATE TABLE IF NOT EXISTS learning_task_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  learning_task_id UUID NOT NULL REFERENCES learning_tasks(id) ON DELETE CASCADE,
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

CREATE TABLE IF NOT EXISTS web_crawl_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
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
  criado_por VARCHAR(255) REFERENCES users(id),
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

CREATE TABLE IF NOT EXISTS web_crawl_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
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

CREATE TABLE IF NOT EXISTS media_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
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
  criado_por VARCHAR(255) REFERENCES users(id),
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
