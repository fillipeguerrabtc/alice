# Alice Enterprise Platform - STATUS REAL ATUAL

> **Autor:** Fillipe Guerra  
> **Data:** 12 de Dezembro de 2025  
> **Método:** Verificação direta do código-fonte + Revisão sistemática completa  
> **Versão:** 3.14 - Correção workflow inválido (update-dependencies)

---

## 📊 VISÃO GERAL DA PLATAFORMA

| Aspecto | Valor |
|---------|-------|
| **Arquitetura** | Microsserviços containerizados |
| **Total de Containers** | 41 (produção) |
| **Servidor** | Hetzner CX43 (8 vCPU, 16GB RAM, 160GB NVMe) |
| **Volume Adicional** | Hetzner Volume 100GB (alice-data) em /opt/alice |
| **SO** | Ubuntu 24.04.3 LTS |
| **Docker** | 29.1.2 + Compose v5.0.0 |
| **Domínio** | yesyoudeserve.duckdns.org |
| **IP** | 46.224.46.93 |
| **LLM** | Llama 4 Maverick (400B params) via Salad Cloud |
| **CI/CD** | 100% automatizado (Push → CI → Release → Deploy) |
| **Imagens Docker** | Google Distroless (Node.js), Alpine (nginx, Python) |
| **Storage** | Volume local Hetzner (SEM S3 externo) |

### Security Hardening (12/12/2025)

| Item | Status | Cobertura |
|------|--------|-----------|
| `security_opt: no-new-privileges` | ✅ | 41/41 containers (100%) |
| `read_only: true` | ✅ | 23/41 (aplicável apenas onde não há escrita) |
| Resource limits | ✅ | 41/41 containers (100%) |
| SHA256 digests | ✅ | 26 imagens externas únicas |
| Healthchecks | ✅ | 38/38 containers (3 init usam service_completed_successfully) |

**Compatibilidade Observabilidade (pins atuais)**  
- Prometheus 3.0.1 / Alertmanager 0.27.0: sem breaking identificado; monitorar métricas deprecated.  
- Grafana 11.1.4: atualização menor.  
- Loki/Promtail 3.1.0: pareados, sem mudanças em labels/pipeline.  
- Jaeger 1.58: estável; OTLP habilitado.  
- OTel Collector 0.114.0: config atual compatível; revisar changelog em novos pipelines.  
- Vector 0.43.1: sink Loki ativo.
- Alertmanager SMTP: senha via arquivo `/opt/alice/secrets/alertmanager/smtp_password` montado em `/run/secrets` (sem senha inline em env).
- Vector: métricas expostas em 8686 para Prometheus; escrita em `/var/lib/vector` (sem read_only).

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
| 8 | Multimodal Inference | `apps/clip-inference-service` | alice-clip-inference | 8000 | Python, PyTorch, FastAPI - Embeddings (texto + imagem) + Transcrição 100% LOCAL |
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
| Audio Processing (faster-whisper LOCAL) | ✅ | `audio-processor.ts` |
| Video Processing (FFmpeg+faster-whisper+CLIP) | ✅ | `video-processor.ts` |
| Document Processing (PDF/DOCX/XLSX) | ✅ | `document-processor.ts` |
| **Storage Local** | ✅ | `storage.ts` (/opt/alice/uploads) |
| Magic Bytes Validation | ✅ | `index.ts` (segurança upload) |
| Multer Upload | ✅ | `index.ts` |
| Circuit Breakers | ✅ | Multimodal Inference (clip-inference-service) |
| Prometheus Metrics | ✅ | `/metrics` |

> **Nota (Readiness enterprise):** O `video-processor` valida prontidão real dos processadores (`audio-processor` e `image-processor`) usando `isReadyAsync()` (contrato explícito `Promise<boolean>`) e evita falso-positivo ao nunca tratar `Promise<boolean>` como boolean. Para compatibilidade, `image-processor.isReady()` voltou a ser **síncrono** (apenas “configurado”), e o readiness real fica em `isReadyAsync()`. Além disso, cada processor valida **apenas** as capabilities necessárias no `clip-inference-service`:
> - `image-processor` → `GET /ready/clip`
> - `audio-processor` → `GET /ready/whisper` + `GET /ready/text-embedding`
>
> **Nota (Health enterprise):** o endpoint `GET /api/media/health` reporta prontidão real de **image/audio/video/document** (sem “pendente” hardcoded) e **sempre responde** (handler completo envolto em `try/catch`). Internamente, não propaga exceções de readiness (usa `Promise.allSettled` + logs). Para **document**, a prontidão valida conectividade com o `alice-clip-inference` via `GET /ready/text-embedding` (evita falso-positivo). Para **video**, o endpoint usa `await video-processor.getConfigAsync()` após `isReadyAsync()` para não reportar `configured=false` com `ready=true`.
>
> **Capacidades opcionais:** quando `WHISPER_REQUIRED=false`, **audio** e **video** são marcados como `required: false` no payload e não derrubam o `status` global (permite operar apenas com **image + document/text embeddings**).

> **Nota (Observability):** no `audio-processor`, `durationSeconds` usa preferencialmente a duração extraída do header (`metadata.duration`) como fallback quando a transcrição falha; quando não for possível determinar a duração (ex: formato sem parser), `durationSeconds` permanece `null` (estado **desconhecido**), evitando reportar `0` (que pode significar “áudio vazio/silencioso”).

> **Nota (Regra 6 - sem valores falsos):** `audio-processor`, `image-processor`, `document-processor` e `video-processor` **não** retornam mais embeddings “falsos” (ex: vetor de zeros) em cenários de erro. Em falha de geração de embedding, retornam **embedding vazio** (`[]`) com `embeddingModel: "unavailable"` e o pipeline persiste como **NULL/ignora** (evitando “hardcoded”, “mock” ou “default falso”).

> **Nota (Validação de embedding - enterprise):** no `video-processor`, o embedding de texto só é considerado válido se tiver **dimensão correta (768)**, **valores finitos** e **ao menos um valor não-zero**. Embeddings inválidos (ex.: all-zero, `NaN`, `Infinity`) são ignorados e o resultado usa apenas frames (CLIP). **Se não houver frames**, o `combinedEmbedding` é `[]` e o `clipEmbedding` é persistido como `NULL` (o `textEmbedding` continua persistido separadamente).
>
> **Nota (Robustez CLIP frames):** o `combinedEmbedding` nunca contém `NaN`: frames CLIP com dimensão incorreta ou valores não-finitos são ignorados antes do cálculo da média; se nenhum frame válido existir, `combinedEmbedding` é `[]` (persistido como `NULL`).
>
> **Nota (Robustez normalizedText - enterprise):** no `combineVideoEmbeddingsForSearch`, após o slice de `textEmbedding`, há validação adicional para garantir que `normalizedText.length === CLIP_EMBEDDING_DIM` antes de acessar índices no loop de combinação. Isso previne `NaN` em edge cases de corrupção de dados. Além disso, cada valor de `normalizedText[i]` é validado como finito antes de ser usado na combinação (fallback seguro para 0 com log de warning).

> **Nota (Fail-fast multimodal):** o `clip-inference-service` **não inicia** em produção se o Whisper falhar ao carregar (comportamento fail-fast). Para cenários excepcionais (ex: dev/diagnóstico), é possível iniciar com `WHISPER_REQUIRED=false` (serviço sobe sem transcrição).
>
> **Importante:** quando `WHISPER_REQUIRED=false`, o `GET /ready` **não exige** Whisper (para não ficar permanentemente `not_ready`), mas o `GET /ready/whisper` continua falhando — e por consequência `audio-processor.isReadyAsync()` ficará `false` (comportamento correto: áudio requer Whisper).
>
> **Semântica HTTP (enterprise-grade):** quando `WHISPER_REQUIRED=false` e Whisper não está carregado, o endpoint `POST /inference/transcribe` responde **501 (Not Implemented)** com a mensagem “Transcrição desabilitada…”, evitando retornar **503** (que sinaliza indisponibilidade temporária).
>
> **Importante (consistência de configuração):** `WHISPER_REQUIRED` é lido **uma única vez** no startup do `clip-inference-service` e reutilizado em todos os handlers, evitando divergência de comportamento.

> **Nota (Readiness por capability):** além do `GET /ready` (prontidão do serviço como um todo), o `clip-inference-service` expõe probes por capacidade:
> - `GET /ready/clip` (somente CLIP)
> - `GET /ready/text-embedding` (somente embeddings de texto)
> - `GET /ready/whisper` (somente transcrição)
>
> Isso evita falso-negativo quando o serviço está `status: "degraded"` por uma capacidade não usada pelo consumer (ex: `image-processor` não depende de Whisper).

> **Nota (Robustez enterprise):**
> - `document-processor`: valida **explicitamente** a dimensão de cada embedding de chunk (768) antes de acumular/médias, evitando corrupção silenciosa se a dependência retornar payload inconsistente.
> - `clip-inference-service`: garante cleanup de arquivo temporário mesmo se ocorrer exceção ao escrever o áudio (atribui `tmp_path` antes do `write()`).

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

### 7. clip-inference-service - Multimodal Inference (Porta 8080)

| Funcionalidade | Status | Arquivo |
|----------------|--------|---------|
| **Embeddings de Imagem** (CLIP ViT-L/14 - 768 dim) | ✅ | `server.py` |
| **Embeddings de Texto** (multilingual-e5-base - 768 dim) | ✅ | `server.py` |
| **Transcrição de Áudio** (faster-whisper medium) | ✅ | `server.py` |
| Suporte Multilíngue (100+ idiomas) | ✅ | multilingual-e5-base + faster-whisper |
| 100% LOCAL (CPU Hetzner) | ✅ | Nenhuma dependência externa |
| Rate Limiting | ✅ | `server.py` |
| Circuit Breaker (Python) | ✅ | `server.py` (CLIP + Text + Whisper) |
| Prometheus Metrics | ✅ | `/metrics` |

> **ARQUITETURA AUTÔNOMA (Regra 6):** Todos os processamentos multimodais são 100% locais via CPU no servidor Hetzner. Nenhuma dependência de APIs externas para embeddings ou transcrição.

> **Consistência Health/Readiness (Best Practices 2025):** quando o Whisper falha ao carregar, `/health` reporta `status: "degraded"` (e `whisper_model: ""`), alinhando o sinal com o `/ready` (que retorna `503` quando não pronto). Isso evita sinais contraditórios para consumidores internos (ex: RAG áudio/vídeo).

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
| **Training** | `Training.tsx` | **3 tabs: Dados + Jobs + Bulk Import (NOVO)** |
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

## 🐳 INFRAESTRUTURA DOCKER (41 containers)

### Core Infra (5)

| # | Container | Imagem | Função |
|---|-----------|--------|--------|
| 1 | dockerproxy | tecnativa/docker-socket-proxy | Proxy seguro Docker API |
| 2 | traefik-init | busybox:1.36 | Inicializa ACME |
| 3 | traefik | traefik:v3.3 | API Gateway + SSL + Rate Limiting |
| 4 | postgres | pgvector/pgvector:pg16 | Banco principal + RLS |
| 5 | alice-redis | redis:7-alpine | Cache distribuído dedicado Alice |

### Alice Microservices (8)

| # | Container | Imagem Base | Função |
|---|-----------|-------------|--------|
| 6 | alice-frontend | nginx:1.27-alpine | React/Nginx |
| 7 | alice-auth | gcr.io/distroless/nodejs22 | Autenticação |
| 8 | alice-chat | gcr.io/distroless/nodejs22 | Chat + LLM |
| 9 | alice-rag | node:22-bookworm-slim | RAG + Embeddings (precisa FFmpeg) |
| 10 | alice-training | gcr.io/distroless/nodejs22 | Fine-tuning |
| 11 | alice-integrations | gcr.io/distroless/nodejs22 | Stripe/Wise/ERPNext |
| 12 | alice-observability | gcr.io/distroless/nodejs22 | Health + Backup |
| 13 | alice-clip-inference | python:3.11-slim | CLIP ViT-L/14 |

### ERPNext Stack (12)

| # | Container | Função |
|---|-----------|--------|
| 14 | erpnext-mariadb | Banco ERPNext |
| 15 | erpnext-redis-cache | Cache |
| 16 | erpnext-redis-queue | Filas |
| 17 | erpnext-configurator | Configuração inicial |
| 18 | erpnext-create-site | Criação site |
| 19 | erpnext-backend | Frappe/Python |
| 20 | erpnext-frontend | Nginx |
| 21 | erpnext-websocket | Socket.io |
| 22 | erpnext-scheduler | Tarefas agendadas |
| 23 | erpnext-worker-short | Jobs curtos |
| 24 | erpnext-worker-default | Jobs padrão |
| 25 | erpnext-worker-long | Jobs longos |

### Backup & Logs (2)

| # | Container | Função |
|---|-----------|--------|
| 26 | pgbackrest | Backup PostgreSQL (PITR, AES-256) |
| 27 | vector | Log aggregation |

---

## 🔐 SEGURANÇA (100% Enterprise)

### Docker Hardening

| Item | Status | Cobertura |
|------|--------|-----------|
| no-new-privileges | ✅ | 41/41 containers (100% COMPLETO) |
| read_only: true | ✅ | 23/41 containers (apenas onde não há escrita necessária) |
| resource limits | ✅ | 41/41 containers (100% COMPLETO) |
| platform: linux/amd64 | ✅ | 41/41 containers |
| **Nota:** Containers que precisam escrever (18: bancos, workers/init ERPNext, node-exporter, cadvisor, alertmanager) não usam `read_only`, mas mantêm `no-new-privileges` e limits. |
| SHA256 digests | ✅ | 26 imagens externas |
| healthchecks | ✅ | 38/38 (3 init usam service_completed_successfully) |

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

### Atualização Periódica (Dependências e Pacotes do Sistema)

- **`update-dependencies.yml`**: atualiza dependências Node.js (pnpm) de forma **automatizada**, criando **branch + PR** (não faz deploy).
- **`update-system-packages.yml`**: atualiza pacotes do sistema/infra (Hetzner) via fluxo automatizado e controlado.

> **NOTA (12/12/2025):** Corrigido erro que invalidava o workflow `update-dependencies.yml`. A causa raiz foi o uso de IDs com hífen (ex.: `check-updates`) referenciados em expressões (`steps.check-updates...` / `needs.check-updates...`), o que quebra o parser de expressões do GitHub Actions. O padrão adotado é usar IDs com underscore (ex.: `check_updates`) para garantir compatibilidade.

### Arquitetura do CI (trigger-release)

O workflow CI usa dependência direta do GitHub Actions com validação explícita:
- **trigger-release** depende de: `build-and-check`, `build-services`, `build-clip-inference`, `build-frontend`, `security-scan`, `compliance-checks`
- **CRÍTICO**: `needs` apenas cria ordem de execução, mas **não impede execução** se jobs upstream falharem
- A condição `if` **verifica explicitamente** que todos os jobs upstream tiveram `result == 'success'`
- Padrão enterprise: `needs.{job}.result == 'success'` para cada job crítico (mesmo padrão usado em `release.yml` e `deploy-production.yml`)

> **NOTA (12/12/2025):** Removido job `ci-status` intermediário que estava instável. A validação explícita na condição `if` é mais confiável e segue o padrão usado em outros workflows do projeto.

> **NOTA (12/12/2025):** O cálculo de versão no `trigger-release` trata tags não-semânticas e zeros à esquerda corretamente:
> - **Valores default para componentes ausentes** (`v1` → `MAJOR=1, MINOR=0, PATCH=0` → `v1.0.1`)
> - **Validação semver 2.0**: Regex `^(0|[1-9][0-9]*)$` rejeita zeros à esquerda (ex: `08`, `007`)
> - **Segurança adicional**: Usa `10#$PATCH` na aritmética para forçar interpretação decimal (previne erros de octal como `$((08 + 1))`)
> - **Fallback seguro**: `v0.0.1` para formatos completamente inválidos

---

## 🔑 SECRETS DOCUMENTADOS

### Por Categoria (Total: ~39, 35 configurados no GitHub)

| Categoria | Secrets |
|-----------|---------|
| **Infraestrutura** | HETZNER_VM_HOST, HETZNER_VM_USER, HETZNER_SSH_PRIVATE_KEY, GH_PAT |
| **Database** | POSTGRES_PASSWORD |
| **Auth** | SESSION_SECRET, ADMIN_USER, ADMIN_PWD, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, OAUTH_GITHUB_CLIENT_ID, OAUTH_GITHUB_CLIENT_SECRET |
| **LLM** | SALAD_API_KEY, SALAD_ORGANIZATION_ID |
| **Payments** | STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET, WISE_API_KEY, WISE_PROFILE_ID, WISE_WEBHOOK_SECRET |
| **Communication** | TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER, RESEND_API_KEY |
| **ERPNext** | ERPNEXT_ADMIN_PASSWORD, ERPNEXT_DB_PASSWORD, ERPNEXT_MYSQL_ROOT_PASSWORD, REDIS_CACHE_PASSWORD, REDIS_QUEUE_PASSWORD, ERPNEXT_API_KEY, ERPNEXT_API_SECRET |
| **Observability** | LANGFUSE_SECRET_KEY, LANGFUSE_NEXT_AUTH_SECRET, GRAFANA_ADMIN_USER, GRAFANA_ADMIN_PASSWORD |
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
| Embeddings Multimodais | CLIP ViT-L/14 (100% local - CPU no Hetzner) | ✅ |
| Embeddings Texto | multilingual-e5-base (100% local - CPU no Hetzner) | ✅ |

### Processamento Multimodal (INPUT) - 100% LOCAL

> **ARQUITETURA AUTÔNOMA (Regra 6):** Todos os processamentos são realizados localmente via CPU no servidor Hetzner. Nenhuma dependência de APIs externas.

| Tipo | Processador | Tecnologia LOCAL | Output |
|------|-------------|------------------|--------|
| Imagem | `image-processor.ts` | CLIP ViT-L/14 | 768 dim embedding |
| Áudio | `audio-processor.ts` | faster-whisper medium + multilingual-e5-base | Transcrição + 768 dim embedding |
| Vídeo | `video-processor.ts` | FFmpeg + faster-whisper + CLIP | Combinado 768 dim |
| Documento | `document-processor.ts` | pdf-parse, mammoth, xlsx + multilingual-e5-base | 768 dim embedding |

**Serviço de Inferência:** `clip-inference-service` (Python FastAPI)

### Auto-Learning

| Fase | Frequência | Tecnologia |
|------|------------|------------|
| RAG Update | Tempo real | pgvector |
| Auto-indexing | Diário | Embeddings |
| LoRA Progressive | 4 dias | Salad Cloud |
| Full Fine-tuning | 14 dias | Salad Cloud |

---

## ✅ CONFORMIDADE COM 18 REGRAS (CLAUDE.md)

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
| 17 | REVIEW ANTES DO COMMIT | ✅ | Review antes de cada commit consolidado |
| 18 | COMMITS CONSOLIDADOS E PUSH MANUAL | ✅ | Commits consolidados enterprise, push manual apenas |

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

---

## 📝 ATUALIZAÇÃO 09/12/2025 - BULK IMPORT ENTERPRISE UI

### Funcionalidade Implementada

✅ **Interface Visual para Bulk Import de Training Data**

**Localização:** Página Training (`/training`) → Tab "Import em Massa"

**Capacidades:**
- ✅ Upload de arquivos JSON/JSONL via drag & drop
- ✅ Validação automática com Zod schema (TypeScript strict)
- ✅ Preview dos dados antes da importação
- ✅ Auto-aprovação configurável
- ✅ Source customizável
- ✅ Progress feedback visual
- ✅ Error handling enterprise
- ✅ Suporte a até 1000 entradas por arquivo (10MB máx)
- ✅ Internacionalização PT-BR e EN

**Componentes Criados:**
- `apps/frontend-service/src/components/ui/alert.tsx` (shadcn/ui)
- Tab "Import em Massa" integrada em `Training.tsx`

**Validações:**
- Tamanho de arquivo (máx 10MB)
- Formato JSON/JSONL válido
- Estrutura de dados (messages array)
- Limite de 1000 entradas
- Rating entre 1 e 5 (opcional)

**Aderência às 18 Regras:**
- ✅ Regra 6: API real, zero workarounds
- ✅ Regra 8: TypeScript strict, zero `any`
- ✅ Regra 10: Documentação PT-BR
- ✅ Regra 13: i18n PT-BR primário
- ✅ Regra 16: UX enterprise 2025

---

*Documento atualizado em: 12/12/2025*  
*Autor: Fillipe Guerra*  
*Versão: 3.14 - Correção workflow inválido (update-dependencies) + alinhamento CI/CD*
*Total de Containers: 41 (5 infra + 8 Alice + 15 ERPNext + 12 observability + 1 backup)*
*Storage: Volume Hetzner 100GB local (/opt/alice) - SEM S3 externo*  
*Retenção Padrão: Full 15d, Incremental 7d, Archive 30d*
*Bulk Import: UI enterprise com drag & drop, validação Zod, preview (09/12/2025)*

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
| audio-processor | ✅ | faster-whisper LOCAL, metadata, transcrição |
| image-processor | ✅ | CLIP, magic bytes, thumbnails |
| video-processor | ✅ | FFmpeg, frames, metadata |
