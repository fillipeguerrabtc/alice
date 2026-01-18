# Alice Enterprise Platform - STATUS REAL ATUAL

**Autor:** Fillipe Guerra  
**Data:** 18 de Janeiro de 2026  
**Método:** Verificação direta do código-fonte + revisão sistemática completa  
**Versão:** 7.13 - Build-service alinhado à release v3.21.1

---

## Resumo executivo

- Arquitetura multi-stack modular com 5 stacks independentes e rollback cirúrgico.
- GPU local dedicada ao LLM, embeddings e ASR (20GB VRAM budget) com Vision e geração via OpenAI.
- CI/CD 100% automático (Push → CI → Release → Deploy) com versionamento e cache enterprise.
- Observabilidade completa com Prometheus, Grafana, Loki, Jaeger e Langfuse.
- Segurança enterprise com hardening de containers, RLS no PostgreSQL e validação Zod em APIs.

---

## Visão geral da plataforma

- Arquitetura: Multi-Stack Modular (5 stacks independentes).
- Total de containers: 50 (10 infra + 8 Alice + 4 GPU + 13 observability + 15 ERPNext + 1 backup + 1 trainer on-demand).
- Servidor: Hetzner GEX44 (Intel Core i5-13500 14 Core, 64GB DDR4 RAM, 2x 1.92TB NVMe SSD RAID 1, RTX 4000 Ada 20GB).
- SO: Ubuntu 24.04.3 LTS.
- Docker: 29.1.3 + Compose v5.0.0.
- Domínio: yesyoudeserve.duckdns.org.
- IP produção: 178.63.41.108.
- LLM (texto): Qwen2.5 7B Instruct (AWQ) via GPU Manager.
- Vision (análise de imagens): OpenAI Responses API (`gpt-4.1`).
- Geração de imagens: OpenAI Images API (`gpt-image-1`).
- Storage: Volume local Hetzner (sem S3 externo).

---

## Arquitetura Gate 2 (GPU + OpenAI)

- GPU local: LLM (texto), embeddings (texto/imagem) e ASR (always-on).
- Vision e geração de imagens: OpenAI (sem VLM local).
- GPU Manager Service: fila priorizada, monitoramento VRAM, circuit breakers e métricas Prometheus.
- Budget VRAM: 20GB com serviços simultâneos.

---

## Stacks e serviços

### Stack INFRA

- PostgreSQL 16 + pgvector.
- PgBouncer.
- Redis (cache).
- Qdrant (vetorial texto 1024 dim).
- Caddy (API Gateway + SSL + HTTP/3).
- MinIO (S3 interno para Langfuse).
- SearXNG + Tor.

### Stack ALICE

- Frontend (React + Vite).
- Auth Service (OAuth, SAML, OIDC).
- Chat Service (WebSocket + streaming LLM).
- RAG Service (pgvector + embeddings).
- Training Service (auto-learning + fine-tuning).
- Integrations Service (Stripe, Wise, Twilio, Gmail SMTP, KuCoin).
- Observability Service (health + backups).
- GPU Manager Service.

### Stack GPU (local)

- `gpu-llm`: Qwen2.5 7B (vLLM).
- `gpu-embeddings`: Qwen3-Embedding-0.6B INT8 + OpenCLIP.
- `gpu-asr`: Canary-1B.
- `gpu-trainer`: QLoRA sob demanda (profile).

### Stack OBSERVABILITY

- Prometheus, Grafana (Alerting), Loki, Jaeger, Langfuse, ClickHouse, OTel Collector, Vector, Node Exporter, cAdvisor.

### Stack ERPNEXT

- MariaDB, Redis Cache/Queue, backend, websocket, scheduler e workers.

### Stack BACKUP

- pgBackRest (PITR, incremental, AES-256).

---

## Serviços Alice (apps/)

- `frontend-service`: React 19 + Vite 7.3 + i18n PT-BR/EN.
- `auth-service`: OAuth 2.0, SAML 2.0, OIDC Provider, RBAC 6 níveis, sessões PostgreSQL.
- `chat-service`: WebSocket, streaming LLM, RAG client, takeover/handover, comandos de trading.
- `rag-service`: upload multimodal, embeddings GPU, fila assíncrona, WebSocket de embeddings.
- `training-service`: scheduler, fine-tuning QLoRA, SemHash.
- `integrations-service`: Stripe/Wise/Twilio/ERPNext/KuCoin + circuit breakers.
- `observability-service`: health checker, backup orchestrator, métricas.
- `api-gateway` Node.js: apenas dev local (Caddy em produção).

---

## Banco de dados (PostgreSQL 16 + pgvector)

### Schema Core

- `sessions`, `tenants`, `users`, `permissions`, `role_permissions`, `oauth_clients`, `oauth_authorization_codes`, `oauth_tokens`, `oidc_payloads`, `oidc_jwks`, `feature_flags`, `assistant_settings`.

### Schema Chat

- `conversations`, `messages`, `conversation_states`, `conversation_participants`, `conversation_escalations`.

### Schema RAG

- `namespaces`, `agents`, `documents`, `document_chunks`.

### Schema Training

- `training_data`, `fine_tuning_jobs`, `model_versions`, `auto_learning_schedule`.

### Schema Integrations

- `integrations`, `audit_logs`, `webhook_events`, `stripe_erpnext_mapping`, `wise_sync_log`, `backup_jobs`.

### Schema Media

- `generated_images`, `media_uploads`.

### Schema Trading

- `trading_signals`, `trading_orders`, `trading_positions`, `trading_risk_config`, `trading_audit_log`, `trading_market_data`, `trading_dataset`, `trading_lora_jobs`.

---

## Observabilidade

- Prometheus 3.8.1 e Grafana 12.3.1 com Grafana Alerting (Alertmanager removido).
- Dashboards principais: Home, Services, LLM Metrics, RAG Metrics, Integrations, Infrastructure, Training, Backup.
- Loki/Promtail 3.6.3 e Jaeger 2.13.0 (OTLP habilitado).
- Langfuse v3 com worker e ClickHouse 25.12-alpine.

---

## CI/CD

- Pipeline: Push → CI → Release → Deploy.
- Workflows: `ci.yml`, `release.yml`, `deploy-stack-modular.yml`.
- Cache enterprise: BuildKit/registry cache, pnpm cache e pip cache.
- Rollback cirúrgico por stack.
- Versionamento semântico automático via Conventional Commits.

---

## Segurança

- Hardening de containers: `no-new-privileges`, `read_only` quando aplicável, limits em 100% dos serviços.
- Validação Zod em endpoints e parâmetros críticos.
- RLS aplicado nas tabelas de trading.
- Secrets obrigatórios validados no deploy (fail-fast).
- TLS automático via Caddy.

---

## Capacidades de IA

- Chat e trading via LLM local (Qwen2.5 7B AWQ).
- Vision e geração de imagens via OpenAI (gpt-4.1 / gpt-image-1).
- Embeddings texto: Qwen3-Embedding-0.6B INT8 (1024 dim) → Qdrant.
- Embeddings imagem: OpenCLIP ViT-H/14 (1024 dim) → pgvector.
- ASR: Canary-1B (GPU).

---

## Backups

- PostgreSQL: pgBackRest (full + incremental + WAL).
- MariaDB: Mariabackup.
- Redis: RDB snapshots.
- Manifestos JSON por job.

### Schedule padrão

```text
Full Backup:        0 3 * * 0
Incremental Backup: 0 3 * * 1-6
Retenção Full:      15 dias
Retenção Incremental: 7 dias
Retenção Arquivo:   30 dias
```

---

## Atualizações recentes (resumo)

- Pipeline modular enterprise e SSOT de versões.
- Healthchecks reais para todos os serviços.
- OpenAPI atualizado para geração de imagens via OpenAI.
- Remoção definitiva de VLM/FLUX local.
- Persistência completa do chat via streaming (conversas e mensagens salvas).
- Página enterprise de Configuração da Alice (system prompt, comportamento e humor).
- Validação do SSE `/api/chat/stream` antes de iniciar o streaming (evita erro de headers enviados).
- Observabilidade: scrape Prometheus corrigido (node-exporter via bridge, Qdrant com API key, Vector com exporter dedicado, Jaeger com métricas em 8888).
- GPU Manager: métricas de VRAM total/usada no fallback quando `nvidia-smi` não está disponível.
- Upload multimodal no streaming com análise de imagens via OpenAI e SSE `media_uploaded`.
- Headers internos para upload de mídia no RAG e geração de imagem via OpenAI (auth service-to-service).
- OpenAI Images: `response_format` explícito + validação de retorno `b64_json`.
- OpenAI Vision: logs com `status` e `x-request-id` para diagnóstico real.
- Suporte enterprise a proxy (`OPENAI_PROXY`, `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`).
- Limite configurável de payload para Vision (`OPENAI_VISION_MAX_BYTES`).
- Build de microsserviços: `build-service.mjs` igual à release v3.21.1 (produção).
- Incremento atômico de `totalMensagens` em streams concorrentes (evita perda de contagem).
- Upsert atômico em `/api/assistant-settings` para evitar conflito em concorrência.
- pgBackRest: reset controlado quando `archive.info` existe sem `backup.info`.
- pgBackRest: captura stderr+stdout no stanza-create para detectar mismatch.
- pgBackRest: stanza-delete com `--force --force` no reset controlado.
- pgBackRest: stop file + limpeza de metadados no reset automático.
- ERPNext: mysqld_exporter usa .my.cnf gerado em runtime com usuário dedicado.
- TLS Caddy: ACME_EMAIL agora é obrigatório (fail-fast no deploy).
- ERPNext: ERPNEXT_MYSQL_EXPORTER_USER garantido na geração do .env.prod.

---

## Qualidade e conformidade

- TypeScript strict e ESLint 9 com zero warnings.
- Vitest com suite de testes atualizada para Gate 2.
- Observância às 18 regras do `CLAUDE.md`.
- Princípios 12-Factor App atendidos.

---

## Backlog (não bloqueante)

- Cobertura de testes 80%.
- Documentação OpenAPI ampliada para endpoints restantes.

---

## Referências internas

- `docs/ARQUITETURA.md`
- `docs/ARQUITETURA-GPU-MANAGER.md`
- `docs/DEPLOYMENT.md`
- `docs/OBSERVABILITY.md`
- `docs/SECRETS.md`
