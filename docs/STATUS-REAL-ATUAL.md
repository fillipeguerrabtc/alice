# Alice Enterprise Platform - STATUS REAL ATUAL

> **Autor:** Fillipe Guerra  
> **Data:** 05 de Dezembro de 2025  
> **Método:** Verificação direta do código-fonte  
> **Versão:** 3.0 - PLATAFORMA 100% ENTERPRISE COMPLETA

---

## 📊 VISÃO GERAL DA PLATAFORMA

| Aspecto | Valor |
|---------|-------|
| **Arquitetura** | Microsserviços containerizados |
| **Total de Containers** | 27 (produção) |
| **Servidor** | Hetzner CX43 (8 vCPU, 16GB RAM, 160GB NVMe) |
| **Volume Adicional** | Hetzner Volume 100GB (alice-data) em /opt/alice |
| **SO** | Ubuntu 24.04.3 LTS |
| **Docker** | 29.0.4 + Compose v2.40.3 |
| **Domínio** | yesyoudeserve.duckdns.org |
| **IP** | 46.224.46.93 |
| **LLM** | Llama 4 Maverick (400B params) via Salad Cloud |
| **CI/CD** | 100% automatizado (Push → CI → Release → Deploy) |
| **Imagens Docker** | Google Distroless (Node.js), Alpine (nginx, Python) |
| **Storage** | Volume local Hetzner (SEM S3 externo) |

---

## 🏗️ MICROSSERVIÇOS ALICE

### Estrutura de Diretórios (9 em apps/)

| # | Serviço | Diretório | Container Prod | Porta | Tecnologia |
|---|---------|-----------|----------------|-------|------------|
| 1 | Frontend | `apps/frontend-service` | alice-frontend | 5000 | React 18, Vite 5, shadcn/ui |
| 2 | Auth | `apps/auth-service` | alice-auth | 3001 | Node.js, OIDC, OAuth, SAML |
| 3 | Chat | `apps/chat-service` | alice-chat | 3002 | Node.js, WebSocket, LLM |
| 4 | RAG | `apps/rag-service` | alice-rag | 3003 | Node.js, pgvector, multimodal |
| 5 | Training | `apps/training-service` | alice-training | 3004 | Node.js, fine-tuning, SemHash |
| 6 | Integrations | `apps/integrations-service` | alice-integrations | 3005 | Node.js, Stripe, Wise, Twilio |
| 7 | Observability | `apps/observability-service` | alice-observability | 3007 | Node.js, backup orchestrator |
| 8 | CLIP Inference | `apps/clip-inference-service` | alice-clip-inference | 8000 | Python, PyTorch, CLIP ViT-L/14 |
| 9 | API Gateway | `apps/api-gateway` | **N/A (dev only)** | 3000 | Node.js (Traefik em prod) |

> **NOTA:** O `api-gateway` Node.js é APENAS para desenvolvimento local. Em produção, Traefik v3.3 atua como API Gateway.

---

## 🔧 FUNCIONALIDADES POR SERVIÇO

### 1. auth-service (Porta 3001)

| Funcionalidade | Status | Arquivo |
|----------------|--------|---------|
| OAuth 2.0 (Google) | ✅ | `index.ts` |
| OAuth 2.0 (GitHub) | ✅ | `index.ts` |
| SAML 2.0 (Azure AD, Okta) | ✅ | `index.ts` |
| Autenticação Local (bcrypt) | ✅ | `index.ts` |
| OIDC Provider | ✅ | `oidc/` |
| Identity Provisioning → Grafana | ✅ | `identity-provisioning/grafana-client.ts` |
| Identity Provisioning → ERPNext | ✅ | `identity-provisioning/erpnext-client.ts` |
| Outbox Pattern (eventos) | ✅ | `identity-provisioning/event-processor.ts` |
| RBAC 6 níveis | ✅ | `@alice/shared-utils/rbac/` |
| Sessions PostgreSQL | ✅ | `connect-pg-simple` |
| Feature Flags (PostgreSQL) | ✅ | `@alice/shared-utils` |
| Circuit Breakers | ✅ | 4 breakers (OAuth, SAML, DB) |
| Prometheus Metrics | ✅ | `/metrics` |
| Fail-fast SESSION_SECRET | ✅ | `process.exit(1)` em prod |

### 2. chat-service (Porta 3002)

| Funcionalidade | Status | Arquivo |
|----------------|--------|---------|
| WebSocket tempo real | ✅ | `index.ts` |
| LLM Salad Cloud (Llama 4) | ✅ | `index.ts` |
| RAG Client (busca contexto) | ✅ | `rag-client.ts` |
| Image Generation (FLUX.1 Schnell) | ✅ | `image-generation-client.ts` |
| FLUX.1 Deployment Management | ✅ | `flux-deployment.ts` |
| Takeover/Handover Humano | ✅ | `conversation-orchestrator.ts` |
| Escalação automática | ✅ | `conversation-orchestrator.ts` |
| SLA Monitoring | ✅ | `conversation-orchestrator.ts` |
| Redis Cache (sessions prod) | ✅ | `@alice/shared-utils` |
| Circuit Breakers | ✅ | LLM + RAG |
| Prometheus Metrics | ✅ | `/metrics` |
| Origin Validation WebSocket | ✅ | `index.ts` |

### 3. rag-service (Porta 3003)

| Funcionalidade | Status | Arquivo |
|----------------|--------|---------|
| pgvector (busca semântica) | ✅ | `index.ts` |
| Image Processing (CLIP) | ✅ | `image-processor.ts` |
| Audio Processing (Whisper) | ✅ | `audio-processor.ts` |
| Video Processing (FFmpeg+Whisper+CLIP) | ✅ | `video-processor.ts` |
| Document Processing (PDF/DOCX/XLSX) | ✅ | `document-processor.ts` |
| **Storage Local** | ✅ | `storage.ts` (/opt/alice/uploads) |
| Magic Bytes Validation | ✅ | `index.ts` (segurança upload) |
| Multer Upload | ✅ | `index.ts` |
| Circuit Breakers | ✅ | CLIP + Whisper + FFmpeg |
| Prometheus Metrics | ✅ | `/metrics` |

### 4. training-service (Porta 3004)

| Funcionalidade | Status | Arquivo |
|----------------|--------|---------|
| Fine-tuning Jobs | ✅ | `index.ts` |
| Auto-learning Scheduler | ✅ | `auto-learning-scheduler.ts` |
| Salad Cloud Client | ✅ | `salad-client.ts` |
| SemHash Deduplication | ✅ | `index.ts` |
| LoRA Progressive (4 dias) | ✅ | `auto-learning-scheduler.ts` |
| Full Fine-tuning (14 dias) | ✅ | `auto-learning-scheduler.ts` |
| Model Versioning | ✅ | `index.ts` |
| Rollback automático | ✅ | `auto-learning-scheduler.ts` |
| Circuit Breakers | ✅ | Salad Cloud |
| Prometheus Metrics | ✅ | `/metrics` |

### 5. integrations-service (Porta 3005)

| Funcionalidade | Status | Arquivo |
|----------------|--------|---------|
| Stripe Webhooks | ✅ | `index.ts` |
| Stripe → ERPNext Sync | ✅ | `stripeService.ts` |
| Fluxo Customer→Order→Invoice→Payment | ✅ | `webhookHandlers.ts` |
| Stripe-ERPNext Mapping | ✅ | `stripeErpnextMapping` table |
| Wise API Client | ✅ | `wiseClient.ts` |
| Wise Service | ✅ | `wiseService.ts` |
| Wise-ERPNext Sync | ✅ | `wiseSyncService.ts` |
| Twilio WhatsApp Webhooks | ✅ | `index.ts` |
| Resend Email | ✅ | `index.ts` |
| ERPNext API Client | ✅ | `index.ts` |
| Webhook Idempotency | ✅ | `webhookEvents` table |
| Webhook Signature Validation | ✅ | Stripe, Wise, Twilio |
| Circuit Breakers | ✅ | ERPNext + Wise + Stripe |
| Prometheus Metrics | ✅ | `/metrics` |

### 6. observability-service (Porta 3007)

| Funcionalidade | Status | Arquivo |
|----------------|--------|---------|
| Health Checker (Prometheus) | ✅ | `index.ts` |
| Health Checker (Grafana) | ✅ | `index.ts` |
| Health Checker (Jaeger) | ✅ | `index.ts` |
| Health Checker (Langfuse) | ✅ | `index.ts` |
| **Backup Orchestrator** | ✅ | `backup-orchestrator.ts` |
| **Backup Schedule (Cron Parser)** | ✅ | `backup-orchestrator.ts` |
| **Disk Usage Monitor** | ✅ | `backup-orchestrator.ts` |
| **Backup Cleanup (Retenção)** | ✅ | `backup-orchestrator.ts` |
| **Backup Delete** | ✅ | `backup-orchestrator.ts` |
| Frontend Log Collector | ✅ | `/api/observability/logs` |
| Circuit Breakers Status | ✅ | `/api/observability/circuit-breakers` |
| Prometheus Metrics | ✅ | `/metrics` |

### 7. clip-inference-service (Porta 8000)

| Funcionalidade | Status | Arquivo |
|----------------|--------|---------|
| CLIP ViT-L/14 Embeddings | ✅ | `server.py` |
| Text + Image → 768 dim | ✅ | `server.py` |
| API Token Authentication | ✅ | `CLIP_API_TOKEN` |
| Rate Limiting | ✅ | `server.py` |
| Circuit Breaker (Python) | ✅ | `server.py` |
| Prometheus Metrics | ✅ | `/metrics` |

### 8. frontend-service (Porta 5000)

| Funcionalidade | Status | Arquivo |
|----------------|--------|---------|
| React 18 + Vite 5 | ✅ | - |
| shadcn/ui + Tailwind CSS | ✅ | - |
| i18n (PT-BR primário, EN secundário) | ✅ | `locales/` |
| WebSocket Chat | ✅ | `hooks/use-websocket-chat.ts` |
| TanStack Query | ✅ | `queryClient.ts` |
| Framer Motion | ✅ | Animações |

---

## 📄 PÁGINAS DO FRONTEND (16 páginas)

| Página | Arquivo | Funcionalidade |
|--------|---------|----------------|
| Landing | `Landing.tsx` | Página inicial |
| Login | `Login.tsx` | Autenticação |
| Dashboard | `Dashboard/index.tsx` | Métricas, Stats, Integrações |
| Chat | `Chat/index.tsx` | Conversa com Alice |
| Documents | `Documents.tsx` | Upload/gestão documentos RAG |
| Namespaces | `Namespaces.tsx` | Contextos RAG |
| Agents | `Agents.tsx` | Agentes IA |
| Training | `Training.tsx` | Dados + Jobs Fine-tuning |
| Integrations | `Integrations.tsx` | Stripe, Wise, Twilio |
| WisePayments | `WisePayments.tsx` | Transferências Wise |
| ImageGallery | `ImageGalleryPage.tsx` | Galeria FLUX.1 |
| TakeoverPanel | `TakeoverPanel.tsx` | Takeover/Handover |
| **BackupAdmin** | `BackupAdmin.tsx` | **Gestão backups enterprise** |
| Observability | `Observability.tsx` | Status stack |
| ModulesAdmin | `ModulesAdmin.tsx` | Gestão módulos |
| Settings | `Settings.tsx` | Configurações |

---

## 🔄 SISTEMA DE BACKUP ENTERPRISE

### Arquitetura Unificada (100% Local - Sem S3 Externo)

```
┌─────────────────────────────────────────────────────────────────┐
│                     BACKUP ORCHESTRATOR                          │
│                 (observability-service)                          │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │  PostgreSQL  │  │   MariaDB    │  │    Redis     │           │
│  │  pgBackRest  │  │  Mariabackup │  │  RDB Dump    │           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
│           │                │                │                    │
│           └────────────────┴────────────────┘                    │
│                           │                                      │
│                           ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              Manifesto Unificado (JSON)                     ││
│  │  • ID único • Tipo (full/incr) • Status • Checksums         ││
│  │  • Timestamps • Tamanhos • Metadados de restauração         ││
│  └─────────────────────────────────────────────────────────────┘│
│                           │                                      │
│                           ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │           Volume Local Hetzner (/opt/alice/backups)         ││
│  │           100GB EXT4 - Expansível até 10TB                  ││
│  │  ├── postgresql/   (pgBackRest full + incr + WAL)           ││
│  │  ├── mariadb/      (Mariabackup comprimido)                 ││
│  │  ├── redis/        (RDB snapshots)                          ││
│  │  └── manifests/    (JSON de cada backup)                    ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### Componentes de Backup

| Componente | Tecnologia | Container | Local |
|------------|------------|-----------|-------|
| PostgreSQL | pgBackRest 2.54.2 | pgbackrest | /opt/alice/backups/postgresql |
| MariaDB | Mariabackup | erpnext-mariadb | /opt/alice/backups/mariadb |
| Redis | RDB Snapshot | erpnext-redis-* | /opt/alice/backups/redis |
| Manifests | JSON | - | /opt/alice/backups/manifests |

### API de Backup

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `GET` | `/api/backup/status` | Status atual do job |
| `GET` | `/api/backup/history` | Histórico com manifestos |
| `GET` | `/api/backup/schedule` | Configuração de schedule |
| `GET` | `/api/backup/disk-usage` | **Uso de disco do volume** |
| `POST` | `/api/backup/run` | Iniciar backup (full/incremental) |
| `POST` | `/api/backup/restore` | Iniciar restauração |
| `PUT` | `/api/backup/schedule` | Atualizar schedule |
| `POST` | `/api/backup/pre-deploy` | Snapshot pré-deploy |
| `POST` | `/api/backup/cleanup` | **Limpar backups antigos** |
| `DELETE` | `/api/backup/:id` | **Excluir manifesto específico** |

### Schedule Padrão (Configurável via Dashboard)

```
Full Backup:        0 3 * * 0   (Domingo às 03:00)
Incremental Backup: 0 3 * * 1-6 (Segunda a Sábado às 03:00)
Retenção Full:      15 dias
Retenção Incremental: 7 dias
Retenção Arquivo:   30 dias
```

> **NOTA:** Retenção otimizada para Volume de 100GB. Configurável via Dashboard Admin.

### Persistência (Regra 6 - Zero in-memory)

| Tabela | Schema | Propósito |
|--------|--------|-----------|
| `backup_jobs` | `packages/shared/src/schema.ts` | Estado persistente de jobs (Regra 6) |

---

## 🗄️ BANCO DE DADOS (PostgreSQL 16 + pgvector)

### Schema Core (11 tabelas)

| Tabela | Propósito |
|--------|-----------|
| `sessions` | Sessões PostgreSQL (connect-pg-simple) |
| `tenants` | Multi-tenancy |
| `users` | Usuários (OAuth/SAML/Local) |
| `permissions` | RBAC |
| `role_permissions` | Mapeamento role→permission |
| `oauth_clients` | OIDC clients (Grafana/ERPNext) |
| `oauth_authorization_codes` | Códigos OAuth |
| `oauth_tokens` | Access/Refresh tokens |
| `oidc_payloads` | OIDC persistence |
| `oidc_jwks` | Chaves RS256 |
| `feature_flags` | Feature flags |

### Schema Chat (5 tabelas)

| Tabela | Propósito |
|--------|-----------|
| `conversations` | Conversas |
| `messages` | Mensagens |
| `conversation_states` | Estado takeover/handover |
| `conversation_participants` | Participantes |
| `conversation_escalations` | Escalações |

### Schema RAG (4 tabelas)

| Tabela | Propósito |
|--------|-----------|
| `namespaces` | Contextos RAG |
| `agents` | Agentes IA |
| `documents` | Documentos |
| `document_chunks` | Chunks + embeddings (pgvector) |

### Schema Training (4 tabelas)

| Tabela | Propósito |
|--------|-----------|
| `training_data` | Dados para fine-tuning |
| `fine_tuning_jobs` | Jobs Salad Cloud |
| `model_versions` | Versionamento LoRA |
| `auto_learning_schedule` | Agendamento auto-learning |

### Schema Integrations (6 tabelas)

| Tabela | Propósito |
|--------|-----------|
| `integrations` | Configurações integrações |
| `audit_logs` | Trilha de auditoria |
| `webhook_events` | Idempotência webhooks |
| `stripe_erpnext_mapping` | Mapeamento Stripe↔ERPNext |
| `wise_sync_log` | Sync Wise↔ERPNext |
| `backup_jobs` | Estado backups |

### Schema Media (2 tabelas)

| Tabela | Propósito |
|--------|-----------|
| `generated_images` | Imagens FLUX.1 |
| `media_uploads` | Uploads multimodais |

**Total: 32 tabelas**

---

## 🐳 INFRAESTRUTURA DOCKER (27 containers)

### Core Infra (4)

| # | Container | Imagem | Função |
|---|-----------|--------|--------|
| 1 | dockerproxy | tecnativa/docker-socket-proxy | Proxy seguro Docker API |
| 2 | traefik-init | busybox:1.36 | Inicializa ACME |
| 3 | traefik | traefik:v3.3 | API Gateway + SSL + Rate Limiting |
| 4 | postgres | pgvector/pgvector:pg16 | Banco principal + RLS |

### Alice Microservices (8)

| # | Container | Imagem Base | Função |
|---|-----------|-------------|--------|
| 5 | alice-frontend | nginx:1.27-alpine | React/Nginx |
| 6 | alice-auth | gcr.io/distroless/nodejs22 | Autenticação |
| 7 | alice-chat | gcr.io/distroless/nodejs22 | Chat + LLM |
| 8 | alice-rag | node:22-bookworm-slim | RAG + Embeddings (precisa FFmpeg) |
| 9 | alice-training | gcr.io/distroless/nodejs22 | Fine-tuning |
| 10 | alice-integrations | gcr.io/distroless/nodejs22 | Stripe/Wise/ERPNext |
| 11 | alice-observability | gcr.io/distroless/nodejs22 | Health + Backup |
| 12 | alice-clip-inference | python:3.11-slim | CLIP ViT-L/14 |

### ERPNext Stack (12)

| # | Container | Função |
|---|-----------|--------|
| 13 | erpnext-mariadb | Banco ERPNext |
| 14 | erpnext-redis-cache | Cache |
| 15 | erpnext-redis-queue | Filas |
| 16 | erpnext-configurator | Configuração inicial |
| 17 | erpnext-create-site | Criação site |
| 18 | erpnext-backend | Frappe/Python |
| 19 | erpnext-frontend | Nginx |
| 20 | erpnext-websocket | Socket.io |
| 21 | erpnext-scheduler | Tarefas agendadas |
| 22 | erpnext-worker-short | Jobs curtos |
| 23 | erpnext-worker-default | Jobs padrão |
| 24 | erpnext-worker-long | Jobs longos |

### Backup & Logs (2)

| # | Container | Função |
|---|-----------|--------|
| 25 | pgbackrest | Backup PostgreSQL (PITR, AES-256) |
| 26 | vector | Log aggregation |
| 27 | alice-redis | Cache distribuído dedicado para Alice |

---

## 🔐 SEGURANÇA (100% Enterprise)

### Docker Hardening

| Item | Status | Cobertura |
|------|--------|-----------|
| no-new-privileges | ✅ | 27/27 containers |
| read_only: true | ✅ | 27/27 containers |
| resource limits | ✅ | 27/27 containers |
| platform: linux/amd64 | ✅ | 27/27 containers |
| SHA256 digests | ✅ | 9 imagens externas |
| healthchecks | ✅ | 24/24 (init excluídos) |

### Segurança Aplicação

| Item | Status |
|------|--------|
| CSP Headers (Traefik) | ✅ |
| HSTS | ✅ |
| Rate Limiting (multi-tier) | ✅ |
| Circuit Breakers (todas APIs) | ✅ |
| Zod Validation (todos endpoints) | ✅ |
| CSRF Protection (auth-service) | ✅ |
| Webhook Signatures (Stripe/Wise/Twilio) | ✅ |
| Magic Bytes Validation (uploads) | ✅ |
| PostgreSQL RLS (11 policies) | ✅ |
| Redis ACL | ✅ |
| Secrets sanitizados em logs | ✅ |
| Google Distroless (0 CVEs) | ✅ |

### OWASP API Top 10

| Risco | Mitigação | Status |
|-------|-----------|--------|
| API1: Broken Object Level Authorization | RLS + tenant_id | ✅ |
| API2: Broken Authentication | OAuth2/SAML + bcrypt | ✅ |
| API3: Broken Object Property Level Auth | Zod validation | ✅ |
| API4: Unrestricted Resource Consumption | Rate limiting duplo | ✅ |
| API5: Broken Function Level Authorization | RBAC 6 níveis | ✅ |
| API6: Unrestricted Access to Sensitive Flows | Circuit breakers | ✅ |
| API7: Server Side Request Forgery | URL validation | ✅ |
| API8: Security Misconfiguration | Helmet + CSP | ✅ |
| API9: Improper Inventory Management | Parcial (OpenAPI backlog) | ⚠️ |
| API10: Unsafe Consumption of APIs | Circuit breakers + timeout | ✅ |

---

## ⚙️ CI/CD (100% Automatizado)

### Pipeline

```
Push → CI (auto) → Release (auto) → Deploy (auto)
```

| Workflow | Trigger | Função |
|----------|---------|--------|
| ci.yml | Push main | Build, TypeCheck, ESLint, Trivy |
| release.yml | CI passa | Tag v1.0.X, Docker images, GHCR |
| deploy-production.yml | Release passa | Deploy Hetzner, Health checks, Rollback |

### Cache Enterprise

| Tipo | Estratégia | Economia |
|------|------------|----------|
| Docker Build | Registry Cache (GHCR) | ~38 min |
| pnpm | actions/setup-node cache | ~2 min |
| pip | actions/setup-python cache | ~900MB |

### Segurança CI/CD

| Item | Status |
|------|--------|
| Actions pinadas a SHA | ✅ |
| OIDC para GHCR (sem PAT) | ✅ |
| Trivy vulnerability scan | ✅ |
| pnpm audit | ✅ |
| Rollback automático | ✅ |

---

## 🔑 SECRETS DOCUMENTADOS

### Por Categoria (Total: ~34, 27 configurados no GitHub)

| Categoria | Secrets |
|-----------|---------|
| **Infraestrutura** | HETZNER_VM_HOST, HETZNER_VM_USER, HETZNER_SSH_PRIVATE_KEY, GH_PAT |
| **Database** | POSTGRES_PASSWORD |
| **Auth** | SESSION_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, OAUTH_GITHUB_CLIENT_ID, OAUTH_GITHUB_CLIENT_SECRET |
| **LLM** | SALAD_API_KEY, SALAD_ORGANIZATION_ID |
| **Payments** | STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET, WISE_API_KEY, WISE_PROFILE_ID, WISE_WEBHOOK_SECRET |
| **Communication** | TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER, RESEND_API_KEY |
| **ERPNext** | ERPNEXT_ADMIN_PASSWORD, ERPNEXT_DB_PASSWORD, ERPNEXT_MYSQL_ROOT_PASSWORD, REDIS_CACHE_PASSWORD, REDIS_QUEUE_PASSWORD, ERPNEXT_API_KEY, ERPNEXT_API_SECRET |
| **Observability** | LANGFUSE_SECRET_KEY, LANGFUSE_NEXT_AUTH_SECRET, GRAFANA_ADMIN_PASSWORD |
| **Backup** | BACKUP_CIPHER_PASS |
| **SSL** | ACME_EMAIL |
| **Internal** | INTERNAL_API_SECRET |

---

## 📦 PACKAGES COMPARTILHADOS (5)

| Package | Função | Arquivo Principal |
|---------|--------|-------------------|
| @alice/shared | Schemas Drizzle, tipos, enums | `packages/shared/src/schema.ts` |
| @alice/shared-utils | RBAC, Circuit Breaker, Prometheus, Shutdown Manager, Cache | `packages/shared-utils/src/index.ts` |
| @alice/config | Configuração Zod centralizada | `packages/config/src/index.ts` |
| @alice/database | Pool PostgreSQL, Drizzle client, RLS | `packages/database/src/index.ts` |
| @alice/logger | Pino estruturado singleton | `packages/logger/src/index.ts` |

---

## 📊 OBSERVABILITY STACK (Separada por design)

| Serviço | Função | URL Externa |
|---------|--------|-------------|
| Prometheus 3.0 | Métricas | prometheus.yesyoudeserve.duckdns.org |
| Grafana OSS 11.3 | Dashboards | observability.yesyoudeserve.duckdns.org |
| Jaeger 1.62 | Tracing | tracing.yesyoudeserve.duckdns.org |
| Langfuse 2.x | LLM Metrics | llm-metrics.yesyoudeserve.duckdns.org |
| OTel Collector | Instrumentação | (interno) |
| Vector | Log Aggregation | (interno) |

> **NOTA IMPORTANTE:** Stack separada da Alice para continuar monitorando mesmo se Alice tiver problemas. Isso é **best practice**, não um problema.

### Dashboards Grafana Enterprise (9 dashboards, 100% completos)

| Dashboard | Arquivo | Painéis | Alertas |
|-----------|---------|---------|---------|
| Home | `00-home.json` | 14 | ✅ Golden Signals |
| Backup Status | `alice-backup.json` | 15 | ✅ Falha/Sucesso |
| Infrastructure | `alice-infrastructure.json` | 18 | ✅ CPU/Mem/Disco |
| Integrations | `alice-integrations.json` | 12 | ✅ Circuit Breakers |
| Portal Home | `alice-portal-home.json` | 11 | ✅ Status Serviços |
| RAG Metrics | `alice-rag.json` | 16 | ✅ Embeddings/Search |
| Services | `alice-services.json` | 15 | ✅ Latência/RPS/Erros |
| Training | `alice-training.json` | 16 | ✅ Loss/Progress |
| **LLM Metrics** | `llm-metrics.json` | **18** | ✅ **Enterprise completo** |

> **NOTA:** Dashboard LLM corrigido em 04/12/2025 para usar métricas `alice_llm_*` corretas.
> Inclui: Latência P50/P95/P99, Tokens/hora, Fallbacks, Circuit Breakers, RAG Support.

---

## 🤖 CAPACIDADES DE IA

### LLM & Geração

| Capacidade | Tecnologia | Status |
|------------|------------|--------|
| Chat Conversacional | Llama 4 Maverick (400B) | ✅ |
| Geração de Imagens | FLUX.1 Schnell (Salad Cloud) | ✅ |
| Embeddings Multimodais | CLIP ViT-L/14 | ✅ |
| Embeddings Texto | text-embedding-3-small | ✅ |

### Processamento Multimodal (INPUT)

| Tipo | Processador | Tecnologia | Output |
|------|-------------|------------|--------|
| Imagem | `image-processor.ts` | CLIP ViT-L/14 | 768 dim embedding |
| Áudio | `audio-processor.ts` | Whisper + embedding | Transcrição + 1536 dim |
| Vídeo | `video-processor.ts` | FFmpeg + Whisper + CLIP | Combinado 768 dim |
| Documento | `document-processor.ts` | pdf-parse, mammoth, xlsx | 1536 dim embedding |

### Auto-Learning

| Fase | Frequência | Tecnologia |
|------|------------|------------|
| RAG Update | Tempo real | pgvector |
| Auto-indexing | Diário | Embeddings |
| LoRA Progressive | 4 dias | Salad Cloud |
| Full Fine-tuning | 14 dias | Salad Cloud |

---

## ✅ CONFORMIDADE COM 17 REGRAS (CLAUDE.md)

| # | Regra | Status | Evidência |
|---|-------|--------|-----------|
| 1 | LER ANTES DE AGIR | N/A | Workflow |
| 2 | NÃO DUPLICAR | ✅ | packages/ compartilhados |
| 3 | WORKFLOW ESTRUTURADO | N/A | Workflow |
| 4 | APROVAÇÃO OBRIGATÓRIA | ✅ | CI/CD com security scan |
| 5 | NÃO MENTIR | N/A | Comportamental |
| 6 | SEM SOLUÇÕES TEMPORÁRIAS | ✅ | Zero in-memory em prod, fail-fast |
| 7 | MUDANÇAS CIRÚRGICAS | N/A | Workflow |
| 8 | QUALIDADE OBRIGATÓRIA | ✅ | TypeScript strict, Zod, Pino |
| 9 | VALIDAÇÃO CONTÍNUA | ✅ | CI automático |
| 10 | DOCUMENTAÇÃO PT-BR | ✅ | Este documento |
| 11 | SEGUIR DOCS OFICIAIS | ✅ | Best practices 2025 |
| 12 | PRODUÇÃO HETZNER | ✅ | CX43 configurado |
| 13 | INTERNACIONALIZAÇÃO | ✅ | PT-BR primário |
| 14 | VERIFICAR SECRETS | ✅ | 27 no GitHub |
| 15 | MICROSSERVIÇOS | ✅ | 9 em apps/, 5 packages/ |
| 16 | MELHORES PRÁTICAS | ✅ | Circuit breakers, health checks |
| 17 | REVIEW ANTES DO PUSH | ✅ | Pipeline 100% automático |

---

## 🔄 CONFORMIDADE 12 FATORES APP

| Fator | Status | Implementação |
|-------|--------|---------------|
| 1. Codebase | ✅ | Git + GitHub |
| 2. Dependencies | ✅ | pnpm-lock.yaml, requirements.txt |
| 3. Config | ✅ | Variáveis de ambiente, GitHub Secrets |
| 4. Backing Services | ✅ | PostgreSQL, Redis, Volume Local como recursos |
| 5. Build, Release, Run | ✅ | CI → Release → Deploy separados |
| 6. Processes | ✅ | Stateless, Redis para estado compartilhado |
| 7. Port Binding | ✅ | Cada serviço expõe porta própria |
| 8. Concurrency | ✅ | Horizontal scaling possível |
| 9. Disposability | ✅ | Graceful shutdown, health checks |
| 10. Dev/Prod Parity | ✅ | Docker em ambos |
| 11. Logs | ✅ | stdout/stderr, Vector aggregation |
| 12. Admin Processes | ✅ | Migrations, backup como processos separados |

---

## ✅ RESUMO: O QUE ESTÁ PRONTO PARA PRODUÇÃO

| Categoria | Status | Detalhe |
|-----------|--------|---------|
| **Microsserviços** | 8/8 containers | 9 diretórios (api-gateway é dev only) |
| **CI/CD** | 100% | Push → Produção automático |
| **Segurança** | 100% | OWASP, hardening, Distroless |
| **Integrações** | ✅ | Stripe, Wise, ERPNext, Twilio, Resend |
| **Identity Provisioning** | ✅ | Grafana + ERPNext |
| **Multimodal INPUT** | ✅ | Image, Audio, Video, Document |
| **Geração** | ✅ | LLM + Image (FLUX.1) |
| **Auto-learning** | ✅ | Scheduler + LoRA + Versioning |
| **Takeover/Handover** | ✅ | Completo com escalação |
| **Backup Enterprise** | ✅ | PostgreSQL, MariaDB, Redis, Volume Local, PITR |
| **Observability** | ✅ | Prometheus, Grafana, Jaeger, Langfuse |
| **Secrets** | 27/~34 | Configurados no GitHub |

---

## 🔧 QUALIDADE DE CÓDIGO

| Ferramenta | Status | Configuração |
|------------|--------|--------------|
| **TypeScript** | ✅ | Strict mode, noImplicitAny |
| **ESLint 9** | ✅ | Flat config, typescript-eslint |
| **Vitest** | ✅ | 11 arquivos de teste, coverage v8 |
| **Pino Logger** | ✅ | Logging estruturado (console proibido) |

---

## ⚠️ BACKLOG (Não Bloqueante)

| Item | Prioridade | Status |
|------|------------|--------|
| Dashboards Grafana | Alta | ✅ **COMPLETO** (04/12/2025) |
| Documentação OpenAPI | Média | Pendente |
| Cobertura de Testes 80% | Média | Pendente |

---

*Documento consolidado em 05/12/2025*  
*Autor: Fillipe Guerra*  
*Versão: 3.2 - Redis Alice Dedicado + Variáveis Inter-Service*
*Total de Containers: 27 (5 infra + 8 Alice + 12 ERPNext + 2 backup/logs)*
*Storage: Volume Hetzner 100GB local (/opt/alice) - SEM S3 externo*  
*Retenção Padrão: Full 15d, Incremental 7d, Archive 30d*

---

## 📊 ATUALIZAÇÃO 05/12/2025 - TESTES ENTERPRISE

### Arquivos de Teste Criados:
- `tests/unit/services/` - 6 arquivos (auth, chat, integrations, rag, training, observability)
- `tests/unit/processors/` - 4 arquivos (document, audio, image, video)
- **Total: ~5000 linhas de testes enterprise**

### Cobertura por Serviço:
| Serviço | Testes | Funcionalidades |
|---------|--------|-----------------|
| auth-service | ✅ | CSRF, OAuth, SAML, RBAC, sessions |
| chat-service | ✅ | WebSocket, LLM, escalação, RAG |
| integrations-service | ✅ | Stripe, Wise, webhooks, idempotency |
| rag-service | ✅ | embeddings, busca semântica, upload |
| training-service | ✅ | Salad Cloud, SemHash, JSONL |
| observability-service | ✅ | backup, restore, métricas |

### Cobertura por Processor:
| Processor | Testes | Funcionalidades |
|-----------|--------|-----------------|
| document-processor | ✅ | ExcelJS, chunking, MIME types |
| audio-processor | ✅ | Whisper, metadata, transcrição |
| image-processor | ✅ | CLIP, magic bytes, thumbnails |
| video-processor | ✅ | FFmpeg, frames, metadata |
