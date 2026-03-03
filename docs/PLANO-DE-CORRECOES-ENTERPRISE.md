
# PLANO DE CORRECOES ENTERPRISE - Alice

Data: 2026-02-26
Escopo: plano de implementacao detalhado, sem codar
Objetivo: fechar gaps do score atual (72%) e elevar readiness para padrao Diamante (>90%)

## Prioridades (ordem executiva)
1. Fechar riscos CRITICAL de seguranca de borda (chat internal routes + ws agent + RLS).
2. Fortalecer isolamento multi-tenant (RLS consistente + adocao sistematica de contexto tenant).
3. Eliminar execucao sincronica de workloads pesados e reforcar idempotencia.
4. Endurecer governanca trading/training (webhook trust, approvals, auditoria).
5. Ajustar observabilidade para tracing real e RBAC granular.

## EPIKO 1 - Security (P0)

### SEC-001 - Proteger `/api/chat/message` e `/api/chat/notify-agent` com auth interna forte
- Arquivos a alterar/criar:
  - Alterar `apps/chat-service/src/index.ts`
  - Alterar `apps/integrations-service/src/index.ts`
  - Alterar/criar utilitario em `packages/shared-utils/src/` para middleware HMAC interno reutilizavel
  - Criar testes em `tests/integration/chat-internal-auth.test.ts`
- Contratos:
  - Header obrigatorio: `X-Internal-Signature`, `X-Internal-Timestamp`, `X-Correlation-Id`
  - Janela anti-replay: 5 min
- Migrations:
  - Nao aplicavel
- Validacoes:
  - Zod em payload + validacao de assinatura + validacao de timestamp
- Idempotencia:
  - `X-Idempotency-Key` obrigatorio para `POST /api/chat/message`
- Metricas:
  - `alice_chat_internal_auth_fail_total`
  - `alice_chat_internal_replay_block_total`
- Testes necessarios:
  - Unit: assinatura valida/invalida/replay
  - Integration: rota bloqueia sem assinatura
  - E2E: integrations-service continua funcional
- Criterio de aceite:
  - 100% das chamadas sem assinatura valida retornam 401
  - Integracao WhatsApp continua operando sem regressao

### SEC-002 - Autenticacao forte em `/ws/agent`
- Arquivos a alterar/criar:
  - Alterar `apps/chat-service/src/index.ts`
  - Alterar frontend takeover hook/page em `apps/frontend-service/src/pages/Chat` ou `TakeoverPanel`
  - Criar testes em `tests/e2e/ws-agent-auth.test.ts`
- Contratos:
  - Token efemero assinado (aud=`ws-agent`, sub=`agentId`, tenantId)
  - Bind com sessao do usuario autenticado
- Migrations:
  - Nao aplicavel
- Validacoes:
  - Verificar token, exp, nonce, tenant e user binding
- Idempotencia:
  - Nao aplicavel
- Metricas:
  - `alice_ws_agent_auth_fail_total`
  - `alice_ws_agent_connection_total{status}`
- Testes necessarios:
  - Unit: token parser/validator
  - Integration: upgrade sem token -> 401
  - E2E: agente legitimo conecta
- Criterio de aceite:
  - Conexao sem token/sessao e sempre negada
  - Conexao com token valido e aceita

### SEC-003 - Uniformizar RLS GUC e remover `app.tenant_id`
- Arquivos a alterar/criar:
  - Criar migration `migrations/0086_rls_guc_unification.sql` (nome sugestivo)
  - Ajustar policies legadas em `migrations/*.sql` (reparo incremental)
  - Criar testes SQL em `tests/integration/rls-guc-consistency.test.ts`
- Contratos:
  - SSOT: `current_tenant_id()`
- Migrations:
  - `DROP POLICY/CREATE POLICY` em tabelas que usam `current_setting('app.tenant_id', true)`
- Validacoes:
  - Check CI bloqueando novos usos de `app.tenant_id`
- Idempotencia:
  - Migration idempotente com `IF EXISTS/IF NOT EXISTS`
- Metricas:
  - Nao aplicavel
- Testes necessarios:
  - Integration multi-tenant read/write
  - Regression para tabelas trading/demo/training scope
- Criterio de aceite:
  - Busca no repo sem ocorrencias de `current_setting('app.tenant_id'` em policies ativas

### SEC-004 - Endurecer status endpoints sensiveis em integrations/observability
- Arquivos a alterar/criar:
  - Alterar `apps/integrations-service/src/index.ts`
  - Alterar `apps/observability-service/src/index.ts`
  - Alterar mapa de permissoes em `packages/shared`/`packages/shared-utils`
  - Criar testes `tests/integration/rbac-observability-integrations.test.ts`
- Contratos:
  - Permissoes minimas: `integrations:status:read`, `observability:read`, `observability:logs:write`
- Migrations:
  - Se necessario, inserir permissoes novas em tabela de permissoes (migration SQL)
- Validacoes:
  - Bloquear acesso sem permissao
- Idempotencia:
  - Nao aplicavel
- Metricas:
  - `alice_rbac_forbidden_total{service,route}`
- Testes necessarios:
  - Unit RBAC
  - Integration 401/403/200 por perfil
- Criterio de aceite:
  - Rotas sensiveis inacessiveis por usuario sem role/permissao

## EPIKO 2 - Trading (P0/P1)

### TRD-001 - Corrigir RLS faltante em `trading_auto_run_steps`
- Arquivos a alterar/criar:
  - Criar migration `migrations/0087_trading_auto_run_steps_policy.sql`
  - Ajustar schema/testes onde necessario
- Contratos:
  - Policy `FOR ALL` tenant isolation coerente com `trading_auto_runs`
- Migrations:
  - `CREATE POLICY trading_auto_run_steps_tenant_isolation ...`
- Validacoes:
  - Testes de acesso por tenant
- Idempotencia:
  - `DO $$ BEGIN IF NOT EXISTS ... END $$`
- Metricas:
  - Nao aplicavel
- Testes necessarios:
  - Integration de leitura/escrita cross-tenant
- Criterio de aceite:
  - Tabela acessivel ao tenant correto e bloqueada para tenant incorreto

### TRD-002 - Fail-closed para postmortem worker (sem fallback sincronico)
- Arquivos a alterar/criar:
  - Alterar `apps/integrations-service/src/postmortem-worker.ts`
  - Alterar rotas de enfileiramento em `apps/integrations-service/src/index.ts`
  - Criar testes `tests/integration/postmortem-queue-failclosed.test.ts`
- Contratos:
  - Sem Redis: retorno 503 + retry strategy (nao processar inline)
- Migrations:
  - Opcional: tabela de incidentes de fila (se desejado)
- Validacoes:
  - Nao executar `executePostMortem` no request path
- Idempotencia:
  - Chave por `positionId + tenantId + snapshotHash`
- Metricas:
  - `alice_postmortem_enqueue_unavailable_total`
  - `alice_postmortem_queue_retry_total`
- Testes necessarios:
  - Unit fallback disabled
  - Integration sem Redis
- Criterio de aceite:
  - Tempo de resposta previsivel mesmo com Redis down

### TRD-003 - Ampliar controles de risco para execucao real (approval + kill-switch + limites)
- Arquivos a alterar/criar:
  - Alterar `apps/integrations-service/src/index.ts`
  - Alterar `apps/training-service/src/trading/jobs/model-risk-worker.ts`
  - Alterar `packages/shared/src/schema.ts`
- Contratos:
  - Ordem real exige `approvalStatus=approved` + risk gates (max order value/leverage/SL/TP)
- Migrations:
  - Nova migration para colunas de auditoria de gate (ex.: `risk_gate_decision`, `risk_gate_reason`)
- Validacoes:
  - Zod estrito para `marketType`, `marginMode`, `leverage`, `stopLoss`, `takeProfit`
- Idempotencia:
  - Execucao real com idempotency-key obrigatoria
- Metricas:
  - `alice_trading_risk_gate_block_total{reason}`
  - `alice_trading_real_order_attempt_total{status}`
- Testes necessarios:
  - Unit risk gate
  - Integration approval flow
  - E2E ordem real bloqueada sem aprovacao
- Criterio de aceite:
  - Nenhuma ordem real passa sem compliance de risk gate

### TRD-004 - Consolidar normalizacao de marketType/marginMode e dedupe sequencial WS
- Arquivos a alterar/criar:
  - Alterar `apps/chat-service/src/index.ts`
  - Alterar `apps/integrations-service/src/index.ts`
  - Criar utilitario comum em `packages/shared-utils/src/trading-market-normalization.ts`
- Contratos:
  - Enum unico para mercado/modo
- Migrations:
  - Nao aplicavel
- Validacoes:
  - Rejeitar combinacoes invalidas
- Idempotencia:
  - Dedupe por sequence/timebucket para market data e auto-runs
- Metricas:
  - `alice_trading_ws_deduped_messages_total`
- Testes necessarios:
  - Unit normalizador
  - Integration fluxo spot/margin/futures
- Criterio de aceite:
  - Sem inconsistencias de mapeamento entre servicos

## EPIKO 3 - Training, Dataset e Governanca de Modelo (P0/P1)

### TRN-001 - Assinatura forte em webhooks internos de training com claim de tenant
- Arquivos a alterar/criar:
  - Alterar `apps/training-service/src/index.ts`
  - Alterar chamadores internos em `apps/integrations-service/src/index.ts` e `apps/chat-service/src/index.ts`
  - Criar utilitario compartilhado em `packages/shared-utils/src/internal-signature.ts`
  - Criar testes `tests/integration/training-webhook-signature.test.ts`
- Contratos:
  - Headers obrigatorios: `X-Internal-Signature`, `X-Internal-Timestamp`, `X-Internal-Nonce`
  - Payload assinado inclui `tenantId`, `sourceService`, `eventType`
- Migrations:
  - Opcional: tabela anti-replay (`internal_nonces`) com TTL por tenant
- Validacoes:
  - Verificacao timing-safe de assinatura e janela temporal
  - `tenantId` efetivo deve vir do claim assinado, nao de header livre
- Idempotencia:
  - Chave de idempotencia por `tenantId + sourceEventId + eventType`
- Metricas:
  - `alice_training_webhook_auth_fail_total`
  - `alice_training_webhook_replay_block_total`
- Testes necessarios:
  - Unit assinatura/replay/janela temporal
  - Integration webhook com claim valido/invalido
  - E2E fluxo interno integrations -> training
- Criterio de aceite:
  - Nenhum webhook interno processa sem assinatura valida
  - Divergencia entre tenant assinado e tenant enviado resulta em 401/403

### TRN-002 - Fail-closed para ingestao de dataset aplicado a trading real
- Arquivos a alterar/criar:
  - Alterar `apps/training-service/src/index.ts`
  - Alterar `apps/training-service/src/scope-resolver.ts`
  - Alterar `apps/training-service/src/trading/jobs/model-risk-worker.ts`
  - Criar testes `tests/integration/training-fail-closed-trading.test.ts`
- Contratos:
  - Itens sem escopo confiavel ou sem aprovacao explicita nao podem alimentar decisao de trading real
- Migrations:
  - Criar migration para coluna de bloqueio e motivo (`trading_scope_blocked`, `trading_scope_block_reason`) em tabela de training_data
- Validacoes:
  - Regras Zod estritas para `scopeType`, `scopeId`, `confidence`, `approvalStatus`
- Idempotencia:
  - Upsert deterministico por hash de conteudo + metadados de origem
- Metricas:
  - `alice_training_fail_closed_block_total{reason}`
  - `alice_training_scope_confidence_histogram`
- Testes necessarios:
  - Unit validacao de regras fail-closed
  - Integration item quarentenado nao entra em pipeline de execucao real
  - E2E com fluxo completo postmortem -> training -> trading guard
- Criterio de aceite:
  - Nenhum dado nao-aprovado alcanca etapa de execucao real

### TRN-003 - Lineage e auditoria imutavel de mudancas de modelo
- Arquivos a alterar/criar:
  - Alterar `apps/training-service/src/index.ts`
  - Alterar `apps/training-service/src/lora-job-manager.ts`
  - Alterar `packages/shared/src/schema.ts`
  - Criar testes `tests/integration/model-lineage-audit.test.ts`
- Contratos:
  - Eventos obrigatorios: `model_promoted`, `model_rolled_back`, `scope_binding_changed`, `risk_override`
- Migrations:
  - Criar tabela append-only `model_governance_audit_events` com assinatura/hash de encadeamento
- Validacoes:
  - Nao permitir update/delete de eventos; somente insert
- Idempotencia:
  - `event_id` global unico por origem
- Metricas:
  - `alice_model_governance_events_total{eventType}`
  - `alice_model_governance_chain_break_total`
- Testes necessarios:
  - Unit hash-chain
  - Integration tentativa de alterar evento antigo deve falhar
  - E2E promocao e rollback registram eventos completos
- Criterio de aceite:
  - Toda ativacao/rollback de LoRA gera trilha imutavel verificavel

### TRN-004 - Enforcement de binding LoRA por namespace/agente com rollback automatico
- Arquivos a alterar/criar:
  - Alterar `apps/llm-gateway-service/src/index.ts`
  - Alterar `apps/training-service/src/lora-job-manager.ts`
  - Alterar `apps/training-service/src/index.ts`
  - Criar testes `tests/e2e/lora-scope-binding.test.ts`
- Contratos:
  - Resolver de modelo deve rejeitar fallback global para requests de trading quando scope especifico nao estiver aprovado
- Migrations:
  - Criar colunas em binding table para `approved_by`, `approved_at`, `rollback_target`
- Validacoes:
  - Schema de binding com status enum restrito (`pending`, `approved`, `rolled_back`, `revoked`)
- Idempotencia:
  - Operacao de bind/rebind idempotente por (`scopeType`, `scopeId`, `adapterId`)
- Metricas:
  - `alice_lora_binding_resolution_total{status}`
  - `alice_lora_binding_rollback_total`
- Testes necessarios:
  - Unit resolver de fallback fail-closed
  - Integration bind/rebind/rollback
  - E2E request trading sem binding aprovado deve bloquear
- Criterio de aceite:
  - Trading nao usa modelo fora de escopo aprovado

## EPIKO 4 - RAG e Data Security (P1)

### RAG-001 - Canonicalizacao forte de paths de media para bloquear traversal
- Arquivos a alterar/criar:
  - Alterar `apps/rag-service/src/index.ts`
  - Alterar `apps/rag-service/src/storage.ts`
  - Criar utilitario `apps/rag-service/src/path-security.ts`
  - Criar testes `tests/integration/rag-media-path-traversal.test.ts`
- Contratos:
  - IDs de media substituem path livre sempre que possivel (`mediaId` -> lookup DB -> path controlado)
- Migrations:
  - Opcional: tabela de alias de media com path canonicamente resolvido
- Validacoes:
  - Rejeitar `%2e`, `%2f`, `%5c`, `..`, path absoluto e prefix mismatch
- Idempotencia:
  - Nao aplicavel
- Metricas:
  - `alice_rag_media_path_block_total{reason}`
- Testes necessarios:
  - Unit canonicalizer
  - Integration tentativas de traversal
  - E2E download de media valida continua funcional
- Criterio de aceite:
  - Nenhum vetor de traversal retorna arquivo

### RAG-002 - Enfileirar todo processamento pesado de ingestao (parse/embedding) com idempotencia estrita
- Arquivos a alterar/criar:
  - Alterar `apps/rag-service/src/index.ts`
  - Alterar `apps/rag-service/src/embedding-queue.ts`
  - Alterar `apps/rag-service/src/workers/embedding-worker.ts`
  - Alterar `apps/rag-service/src/workers/learning-worker.ts`
  - Criar testes `tests/integration/rag-ingestion-queue-idempotency.test.ts`
- Contratos:
  - Upload retorna `202 Accepted` + `jobId`; status consultado por endpoint dedicado
- Migrations:
  - Criar tabela `rag_ingestion_jobs` com status, retries, checksum e tenantId
- Validacoes:
  - Checksums por arquivo/chunk para evitar duplicacao
- Idempotencia:
  - Chave `tenantId + namespace + checksum + pipelineVersion`
- Metricas:
  - `alice_rag_ingestion_job_total{status}`
  - `alice_rag_ingestion_deduped_total`
  - `alice_rag_ingestion_latency_seconds`
- Testes necessarios:
  - Unit dedupe logic
  - Integration retries e dead-letter
  - Load test de ingestao concorrente
- Criterio de aceite:
  - Sem processamento inline pesado no request thread

### RAG-003 - Isolamento tenant/namespace/agente no retrieval com RLS contextual obrigatorio
- Arquivos a alterar/criar:
  - Alterar `apps/rag-service/src/index.ts`
  - Alterar `packages/database/src/index.ts` (policy de uso de contexto)
  - Alterar `packages/shared/src/schema.ts`
  - Criar testes `tests/integration/rag-retrieval-tenant-isolation.test.ts`
- Contratos:
  - Toda consulta de retrieval exige `tenantId` contextual + filtro de namespace permitido
- Migrations:
  - Adicionar/ajustar policies RLS em tabelas de documentos/chunks/rag artifacts
- Validacoes:
  - `namespaceId` e `agentId` opcionais apenas quando explicitamente permitido por role
- Idempotencia:
  - Nao aplicavel
- Metricas:
  - `alice_rag_cross_tenant_block_total`
- Testes necessarios:
  - Integration cross-tenant negative tests
  - E2E retrieval com e sem permissao de escopo
- Criterio de aceite:
  - Nenhum documento de tenant A aparece em busca de tenant B

### RAG-004 - Hardening de upload para PDF/DOCX/HTML e URL crawl (SSRF/file bombs)
- Arquivos a alterar/criar:
  - Alterar `apps/rag-service/src/document-processor.ts`
  - Alterar `apps/rag-service/src/web-search.ts`
  - Alterar `apps/rag-service/src/index.ts`
  - Criar testes `tests/security/rag-upload-ssrf-bomb.test.ts`
- Contratos:
  - Lista de MIME permitidos, limite de tamanho e paginas por documento
  - URL ingestion somente por allowlist de dominios/egress policy
- Migrations:
  - Opcional: tabela de politicas por tenant (`rag_ingestion_policies`)
- Validacoes:
  - Magic bytes, profundidade de zip/docx, bloqueio de localhost/link-local/meta-data IPs
- Idempotencia:
  - Crawl job idempotente por URL canonica + janela temporal
- Metricas:
  - `alice_rag_upload_rejected_total{reason}`
  - `alice_rag_ssrf_block_total`
- Testes necessarios:
  - Unit validadores de MIME/URL
  - Integration uploads maliciosos
  - Security test SSRF (localhost/169.254.169.254)
- Criterio de aceite:
  - Upload/crawl malicioso bloqueado com erro explicito e auditavel

## EPIKO 5 - Infra, Deploy e Operacao (P1)

### INF-001 - Preflight obrigatorio de secrets e dependencia por stack
- Arquivos a alterar/criar:
  - Alterar `infra/docker/stacks/docker-compose.alice.yml`
  - Alterar scripts de deploy em `infra/runner/` e `infra/scripts/`
  - Criar `infra/scripts/preflight-secrets.ps1` e `infra/scripts/preflight-secrets.sh`
  - Criar testes `tests/integration/deploy-preflight.test.ts`
- Contratos:
  - Matriz declarativa de secrets por ambiente (`dev/staging/prod`)
- Migrations:
  - Nao aplicavel
- Validacoes:
  - Falha bloqueante antes de `docker compose up` com relatorio de ausencias
- Idempotencia:
  - Nao aplicavel
- Metricas:
  - `alice_deploy_preflight_fail_total{secret}`
- Testes necessarios:
  - Integration `compose config` com/sem env obrigatorio
- Criterio de aceite:
  - Nenhum deploy inicia com secret obrigatoria ausente

### INF-002 - SSOT de runtime: scripts root padronizados para modo microservicos
- Arquivos a alterar/criar:
  - Alterar `package.json` (scripts root)
  - Alterar `docs/DEPLOYMENT.md`
  - Alterar `docs/ARQUITETURA.md`
  - Criar teste de smoke em `tests/e2e/runtime-entrypoint-smoke.test.ts`
- Contratos:
  - Comandos default `dev/build/start` devem refletir arquitetura oficial multi-service
- Migrations:
  - Nao aplicavel
- Validacoes:
  - Execucao de comando legacy exige flag explicita (`legacy:*`)
- Idempotencia:
  - Nao aplicavel
- Metricas:
  - `alice_runtime_mode_selected_total{mode}`
- Testes necessarios:
  - Smoke do startup stack correto
- Criterio de aceite:
  - Operacao padrao nao inicia runtime legado por engano

### INF-003 - Hardening de compose: healthchecks, startup order e restart policy por criticidade
- Arquivos a alterar/criar:
  - Alterar `infra/docker/docker-compose.yml`
  - Alterar `infra/docker/stacks/docker-compose.base.yml`
  - Alterar `infra/docker/stacks/docker-compose.infra.yml`
  - Alterar `infra/docker/stacks/docker-compose.alice.yml`
- Contratos:
  - SLO minimo por servico com probes explicitos (`/health`, `/metrics`)
- Migrations:
  - Nao aplicavel
- Validacoes:
  - `depends_on` com `condition: service_healthy` onde suportado
- Idempotencia:
  - Nao aplicavel
- Metricas:
  - `alice_service_restart_total{service,reason}`
- Testes necessarios:
  - Chaos test de restart de dependencia critica (Redis/Postgres) e recuperacao
- Criterio de aceite:
  - Stack recupera falhas transientes sem intervencao manual

### INF-004 - Exercicios de restore (Game Day) para backup/DR
- Arquivos a alterar/criar:
  - Alterar `apps/observability-service/src/backup-orchestrator.ts`
  - Alterar `docs/DEPLOYMENT.md`
  - Criar `docs/DR-RUNBOOK.md`
  - Criar testes `tests/e2e/backup-restore-game-day.test.ts`
- Contratos:
  - RTO/RPO declarados e medidos por ambiente
- Migrations:
  - Opcional: tabela para historico de restores (`restore_executions`)
- Validacoes:
  - Restore completo de Postgres + objetos de vetores + verificacao de consistencia
- Idempotencia:
  - Execucao de restore com lock de processo por ambiente
- Metricas:
  - `alice_backup_restore_duration_seconds`
  - `alice_backup_restore_success_total`
- Testes necessarios:
  - E2E restore automatizado em ambiente de ensaio
- Criterio de aceite:
  - DR testado periodicamente com evidencias de sucesso e tempos dentro de meta

## EPIKO 6 - Observability e SRE (P1)

### OBS-001 - RBAC fino em todas as rotas de observabilidade nao-publicas
- Arquivos a alterar/criar:
  - Alterar `apps/observability-service/src/index.ts`
  - Alterar `packages/shared/src/schema.ts` (permissoes)
  - Criar testes `tests/integration/observability-rbac.test.ts`
- Contratos:
  - Permissoes: `observability:read`, `observability:admin`, `observability:logs:write`
- Migrations:
  - Insercao de permissoes em tabelas RBAC (migration SQL)
- Validacoes:
  - So `/health` publico; demais rotas com auth + permission
- Idempotencia:
  - Nao aplicavel
- Metricas:
  - `alice_observability_forbidden_total{route}`
- Testes necessarios:
  - Integration por perfis
- Criterio de aceite:
  - Nenhuma rota operacional responde 200 para usuario sem permissao

### OBS-002 - Tracing distribuido end-to-end nos fluxos criticos
- Arquivos a alterar/criar:
  - Alterar `apps/chat-service/src/index.ts`
  - Alterar `apps/integrations-service/src/index.ts`
  - Alterar `apps/rag-service/src/index.ts`
  - Alterar `apps/training-service/src/index.ts`
  - Criar inicializacao comum em `packages/shared-utils/src/tracing.ts`
- Contratos:
  - Propagacao obrigatoria de `traceparent` e `x-correlation-id` entre servicos
- Migrations:
  - Nao aplicavel
- Validacoes:
  - Span roots por request HTTP/WS e spans filhos por chamadas cross-service/DB/Redis
- Idempotencia:
  - Nao aplicavel
- Metricas:
  - `alice_trace_span_export_fail_total`
  - `alice_trace_coverage_ratio`
- Testes necessarios:
  - Integration com assert de spans no collector
  - E2E de jornada chat e trading com trace completo
- Criterio de aceite:
  - 95%+ das requests criticas com trace completo no Jaeger

### OBS-003 - SLOs e alertas por jornada (chat stream, trading signal, training queue, rag ingest)
- Arquivos a alterar/criar:
  - Alterar `infra/observability/prometheus.yml`
  - Alterar `infra/observability/grafana/provisioning/` (dashboards/alerts)
  - Alterar instrumentacao nos servicos: chat/integrations/training/rag
- Contratos:
  - SLOs definidos por latencia p95/p99, erro, disponibilidade e atraso de fila
- Migrations:
  - Nao aplicavel
- Validacoes:
  - Alertas com severidade e runbook associado
- Idempotencia:
  - Nao aplicavel
- Metricas:
  - `alice_slo_burn_rate{journey}`
  - `alice_queue_lag_seconds{service}`
- Testes necessarios:
  - Teste de alertas sintenticos em ambiente de observabilidade
- Criterio de aceite:
  - Alertas disparam com precisao e dashboards cobrem 100% das jornadas criticas

### OBS-004 - Auditoria imutavel para eventos de alto risco (trading/approvals/overrides)
- Arquivos a alterar/criar:
  - Alterar `apps/integrations-service/src/index.ts`
  - Alterar `apps/training-service/src/index.ts`
  - Alterar `packages/logger/src/index.ts`
  - Criar testes `tests/integration/high-risk-audit-events.test.ts`
- Contratos:
  - Evento deve incluir actor, tenant, recurso, antes/depois, motivo, correlationId
- Migrations:
  - Criar tabela append-only `high_risk_audit_events`
- Validacoes:
  - Escrita obrigatoria no ponto de decisao critica antes de efetivar operacao
- Idempotencia:
  - `event_uid` dedupe para replays
- Metricas:
  - `alice_high_risk_audit_events_total{eventType}`
- Testes necessarios:
  - Integration validando persistencia de eventos em approve/reject/override
- Criterio de aceite:
  - 100% de eventos criticos geram trilha auditavel e consultavel

## EPIKO 7 - Frontend UX/Streaming e Borda de Seguranca (P1)

### FE-001 - Remover polling residual de trading onde WS ja existe
- Arquivos a alterar/criar:
  - Alterar `apps/frontend-service/src/pages/DemoTrading.tsx`
  - Alterar `apps/frontend-service/src/hooks/useKucoinWebSocket.ts`
  - Alterar `apps/frontend-service/src/services/api/tradingDemo.ts`
  - Criar testes `tests/e2e/frontend-trading-realtime.test.ts`
- Contratos:
  - Fonte primaria para market data deve ser WS; polling apenas fallback controlado por feature flag
- Migrations:
  - Nao aplicavel
- Validacoes:
  - Desligar `refetchInterval` em endpoints de ticker/orderbook/klines quando stream ativo
- Idempotencia:
  - Dedupe no cliente por sequence para evitar repaint de dados antigos
- Metricas:
  - `alice_frontend_market_polling_total`
  - `alice_frontend_ws_reconnect_total`
- Testes necessarios:
  - E2E de atualizacao em tempo real com reconexao
- Criterio de aceite:
  - Reducao mensuravel de chamadas polling sem perda de atualizacao real-time

### FE-002 - Contrato de streaming de chat token-a-token com backpressure e cancelamento
- Arquivos a alterar/criar:
  - Alterar `apps/frontend-service/src/hooks/use-websocket-chat.ts`
  - Alterar `apps/frontend-service/src/pages/Chat/index.tsx`
  - Alterar `apps/chat-service/src/index.ts`
  - Criar testes `tests/e2e/chat-streaming-backpressure.test.ts`
- Contratos:
  - Eventos SSE/WS padronizados: `token`, `partial`, `final`, `error`, `usage`
- Migrations:
  - Nao aplicavel
- Validacoes:
  - AbortController/timeout no cliente e cancelamento no servidor
- Idempotencia:
  - `streamId` para reanexar stream apos reconexao
- Metricas:
  - `alice_chat_stream_tokens_total`
  - `alice_chat_stream_abort_total`
  - `alice_chat_stream_latency_seconds`
- Testes necessarios:
  - Unit parser de eventos
  - E2E cancelamento sem leak de conexao
  - Load test de concorrencia de streams
- Criterio de aceite:
  - Fluxo token-a-token estavel sob carga, com cancelamento limpo

### FE-003 - Fluxo seguro para token de `/ws/agent` no frontend
- Arquivos a alterar/criar:
  - Alterar `apps/frontend-service/src/pages/TakeoverPanel.tsx`
  - Alterar `apps/frontend-service/src/pages/Chat/index.tsx`
  - Alterar `apps/chat-service/src/index.ts` (endpoint de emissao token efemero)
  - Criar testes `tests/e2e/frontend-ws-agent-secure-token.test.ts`
- Contratos:
  - Frontend nunca envia `agentId/tenantId` sem token assinado emitido server-side
- Migrations:
  - Nao aplicavel
- Validacoes:
  - Token curto, one-time-use, expiracao <= 60s
- Idempotencia:
  - Nao aplicavel
- Metricas:
  - `alice_ws_agent_token_issue_total`
  - `alice_ws_agent_token_reject_total{reason}`
- Testes necessarios:
  - E2E takeover com token valido e invalido
- Criterio de aceite:
  - Sem token efemero valido, UI nao estabelece canal `/ws/agent`

### FE-004 - Remover logica sensivel do cliente e reforcar gates por permissao
- Arquivos a alterar/criar:
  - Alterar `apps/frontend-service/src/lib/authUtils.ts`
  - Alterar `apps/frontend-service/src/pages/Trading.tsx`
  - Alterar `apps/frontend-service/src/pages/Observability.tsx`
  - Criar testes `tests/e2e/frontend-permission-gates.test.ts`
- Contratos:
  - Cliente so exibe features; decisao de autorizacao continua exclusivamente no backend
- Migrations:
  - Nao aplicavel
- Validacoes:
  - Guards de UI sincronizados com claims do backend
- Idempotencia:
  - Nao aplicavel
- Metricas:
  - `alice_frontend_forbidden_route_attempt_total`
- Testes necessarios:
  - E2E por perfil de role/permissao
- Criterio de aceite:
  - Usuario sem permissao nao acessa acao critica nem por URL direta

## Plano de execucao por ondas

### Onda 1 (Semana 1-2) - Bloqueio de risco imediato
- SEC-001, SEC-002, SEC-003, TRD-001, TRD-002
- Meta: remover todos os CRITICAL e principal HIGH operacional
- Gate de saida:
  - Zero achados CRITICAL abertos
  - Testes de seguranca e isolamento tenant verdes

### Onda 2 (Semana 3-4) - Governanca trading/training + RAG hardening
- TRD-003, TRD-004, TRN-001, TRN-002, RAG-001, RAG-004
- Meta: reduzir risco de modelo e risco de dados
- Gate de saida:
  - Fail-closed comprovado em trading/training
  - Traversal/SSRF bloqueados por testes automatizados

### Onda 3 (Semana 5-6) - Operacao, observabilidade e UX realtime
- TRN-003, TRN-004, RAG-002, RAG-003, INF-001, INF-002, OBS-001, FE-001
- Meta: robustez operacional e isolamento de escopo
- Gate de saida:
  - Deploy preflight ativo
  - Polling residual reduzido e metricas de realtime monitoradas

### Onda 4 (Semana 7-8) - Diamante readiness
- INF-003, INF-004, OBS-002, OBS-003, OBS-004, FE-002, FE-003, FE-004
- Meta: elevar platform readiness >90%
- Gate de saida:
  - Tracing fim-a-fim operacional
  - Auditoria imutavel completa
  - SLOs e alertas cobrindo jornadas criticas

## Metas de score apos execucao do plano
- Seguranca & Tenant Isolation: 62 -> 90+
- Trading Risk Controls & Governanca: 74 -> 90+
- Confiabilidade/Resiliencia: 76 -> 92+
- Integridade de Dados (DB/RLS): 68 -> 90+
- Observabilidade: 78 -> 92+
- Performance: 72 -> 88+
- Qualidade de Engenharia: 80 -> 90+

Estimativa de Diamond Readiness pos-plano: **90% a 93%** (dependente da execucao integral e validacao por testes/chaos/game days).
