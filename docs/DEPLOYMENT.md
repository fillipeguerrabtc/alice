# Alice Enterprise Platform - Guia de Deploy

**Autor:** Fillipe Guerra  
**Data:** 02 de Janeiro de 2026  
**Versão:** 7.17 - Deploy Enterprise Hardening (Smoke Tests + Persistência de Logs)

> **Migração 100% Self-Hosted (27/12/2025):** Pipeline completo migrado para runner próprio (Hetzner CPX32 - 4 vCPU, 8GB RAM) seguindo melhores práticas enterprise 2025. Todos os workflows (CI, Release, Deploy) executam no self-hosted runner para controle total, custos previsíveis e compliance.

> **Semantic Versioning Automático (27/12/2025):** Versionamento agora segue Conventional Commits automaticamente: `feat!:` ou `BREAKING CHANGE:` → MAJOR bump, `feat:` → MINOR bump, `fix:` → PATCH bump. Cache Docker otimizado com `--provenance=false`, `--sbom=false` e `BUILDKIT_INLINE_CACHE=1` para builds mais rápidos.

## Visão Geral da Arquitetura - 50 Containers em Produção

A plataforma Alice é composta por **50 containers** organizados em 7 categorias (44 serviços + 5 GPU + 1 backup):

### Categoria 1: Infraestrutura Core (7 serviços)

| # | Serviço | Container | Descrição | Tecnologia |
|---|---------|-----------|-----------|------------|
| 1 | **Caddy Gateway** | `alice-caddy` | Reverse proxy com SSL automático (Let's Encrypt), HTTP/3 nativo (QUIC), configuração declarativa. Substitui Traefik desde 02/01/2026. | Caddy 2.8.4 Alpine |
| 2 | **pgBackRest Init** | `alice-pgbackrest-init` | Init container que cria stanza de backup ANTES do PostgreSQL iniciar. Corrige crash loop de archive_command. | pgBackRest 2.57.0 |
| 3 | **PostgreSQL** | `alice-postgres` | Banco de dados principal com extensão pgvector para busca semântica, RLS para multi-tenancy. | PostgreSQL 16 + pgvector |
| 4 | **Alice Redis** | `alice-redis` | Cache distribuído dedicado para serviços Alice (sessões, RBAC). Segregação enterprise do ERPNext. node-redis 5.x suporta Redis 7.x. | Redis 7.4.7 Alpine |
| 5 | **Qdrant** | `alice-qdrant` | Banco vetorial para embeddings de texto (4096 dim Qwen3-Embedding-8B). HNSW index otimizado. | Qdrant v1.16.2 |
| 6 | **Tor Proxy** | `alice-tor` | Proxy SOCKS5 Tor para engines .onion no SearXNG (ahmia, torch). Enterprise 23/12/2025. | dperson/torproxy |
| 7 | **SearXNG** | `alice-searxng` | Metabusca interna para Web Search (auto-hospedado, protegido por secret) | searxng/searxng |

> **NOTA 02/01/2026**: Traefik, traefik-init e dockerproxy foram substituídos por **Caddy**. Vantagens: SSL automático com retry inteligente (evita rate limits Let's Encrypt), HTTP/3 nativo (QUIC protocol), footprint 40MB (vs 100MB Traefik), configuração declarativa via Caddyfile (vs labels Docker). Elimina necessidade de Docker Socket Proxy pois Caddy não precisa acessar a API Docker.

> **Migração 100% Self-Hosted (27/12/2025):** Pipeline completo migrado para runner próprio (Hetzner CPX32 - 4 vCPU, 8GB RAM). Todos os workflows (CI, Release, Deploy) executam no self-hosted runner (`runs-on: [self-hosted, linux, deploy]`) para controle total, custos previsíveis e compliance. Deploy workflow com gate de segurança (`validate-trigger`) - `version` é OBRIGATÓRIA e deve ser tag válida (v1.0.0). Deploy executa remoto no Production Server via `appleboy/ssh-action` (SSH para `secrets.HETZNER_VM_HOST`). Pipeline 100% sequencial: Push → CI → Release → Deploy. **CORREÇÃO 28/12/2025:** Scripts obsoletos `deploy-remote.sh` e `deploy-local.sh` removidos - workflow usa script inline no SSH action (mais auditável, sem dependências externas).

### Categoria 2: Microsserviços Alice (7 serviços)

| # | Serviço | Container | Diretório | Descrição | Tecnologia |
|---|---------|-----------|-----------|-----------|------------|
| 7 | **Frontend** | `alice-frontend` | `apps/frontend-service` | Interface web responsiva com chat em tempo real, dashboard de métricas, painel de takeover/handover. | React 18, Vite 7.3, shadcn/ui, i18n PT-BR |
| 8 | **Auth Service** | `alice-auth` | `apps/auth-service` | Autenticação enterprise com OAuth 2.0, SAML 2.0, OIDC Provider, RBAC 6 níveis, sessões PostgreSQL. | Node.js, node-oidc-provider v9.5.2 |
| 9 | **Chat Service** | `alice-chat` | `apps/chat-service` | Chat em tempo real com streaming de tokens LLM via WebSocket, rate limiting, conversation orchestrator. | Node.js, WebSocket, GPU Manager Service |
| 10 | **RAG Service** | `alice-rag` | `apps/rag-service` | Retrieval-Augmented Generation com embeddings GPU local. Texto: Qwen3-Embedding-8B (4096 dim → Qdrant). Imagem: OpenCLIP (1024 dim → pgvector). | Node.js, Qdrant, pgvector |
| 11 | **Training Service** | `alice-training` | `apps/training-service` | Fine-tuning e self-learning automático. Scheduler de aprendizado, integração GPU Manager Service. | Node.js, GPU Manager Service |
| 12 | **Integrations Service** | `alice-integrations` | `apps/integrations-service` | Integrações com serviços externos: Stripe (pagamentos EUR/SEPA), Wise (transferências), Twilio (WhatsApp), Gmail SMTP (emails), KuCoin Futures (Trading). | Node.js, Stripe SDK, Wise API |
| 13 | **Observability Service** | `alice-observability` | `apps/observability-service` | Stack de observabilidade: métricas Prometheus, dashboards Grafana, tracing Jaeger, backup orchestrator. | Node.js, Prometheus, Grafana, Jaeger |

> **NOTA (25/12/2025):** Todos os serviços GPU rodam localmente no servidor Hetzner GPU GEX44 e são gerenciados pelo GPU Manager Service. Processamento multimodal usa serviços GPU locais com Qwen3-Embedding-8B (texto, 4096 dim) e OpenCLIP ViT-H/14 (imagem, 1024 dim).

> **NOTA 02/01/2026:** O Caddy (`alice-caddy`) atua como API Gateway em produção com roteamento via Caddyfile, SSL automático e HTTP/3. O `apps/api-gateway` Node.js existe apenas para desenvolvimento local.

### Categoria 3: ERPNext Stack (15 serviços)

| # | Serviço | Container | Descrição | Tecnologia |
|---|---------|-----------|-----------|------------|
| 15 | **MariaDB** | `erpnext-mariadb` | Banco de dados do ERPNext com replicação GTID, binlog para backup incremental. | MariaDB 10.11 |
| 16 | **Redis Cache** | `erpnext-redis-cache` | Cache de sessões e dados frequentes do ERPNext. ERPNext v15 requer Redis 6.x. | Redis 6.2.21 Alpine |
| 17 | **Redis Queue** | `erpnext-redis-queue` | Fila de jobs assíncronos do ERPNext (background jobs). ERPNext v15 requer Redis 6.x. | Redis 6.2.21 Alpine |
| 18 | **Configurator** | `erpnext-configurator` | Configurador inicial do Frappe Bench. Roda uma vez no primeiro deploy. | Frappe/ERPNext v15.91.3 |
| 19 | **Create Site** | `erpnext-create-site` | Criador do site ERPNext. Inicializa banco de dados e estrutura. | Frappe/ERPNext v15.91.3 |
| 20 | **Backend** | `erpnext-backend` | Backend Python do Frappe/ERPNext. APIs REST e lógica de negócio. | Frappe/ERPNext v15.91.3 |
| 21 | **Frontend** | `erpnext-frontend` | Frontend NGINX do ERPNext. Serve arquivos estáticos e proxy reverso. | Frappe/ERPNext v15.91.3 |
| 22 | **WebSocket** | `erpnext-websocket` | Socket.io para atualizações em tempo real no ERPNext. | Frappe/ERPNext v15.91.3 |
| 23 | **Scheduler** | `erpnext-scheduler` | Agendador de tarefas periódicas (cron jobs do ERPNext). | Frappe/ERPNext v15.91.3 |
| 24 | **Worker Default 1** | `erpnext-worker-default` | Worker para jobs normais (5-60 segundos) - instância 1. | Frappe/ERPNext v15.91.3 |
| 25 | **Worker Short 1** | `erpnext-worker-short` | Worker para jobs rápidos (< 5 segundos) - instância 1. | Frappe/ERPNext v15.91.3 |
| 26 | **Worker Long 1** | `erpnext-worker-long` | Worker para jobs longos (> 60 segundos) - instância 1. | Frappe/ERPNext v15.91.3 |
| 27 | **Worker Default 2** | `erpnext-worker-default-2` | Worker para jobs normais (5-60 segundos) - instância 2. | Frappe/ERPNext v15.91.3 |
| 28 | **Worker Short 2** | `erpnext-worker-short-2` | Worker para jobs rápidos (< 5 segundos) - instância 2. | Frappe/ERPNext v15.91.3 |
| 29 | **Worker Long 2** | `erpnext-worker-long-2` | Worker para jobs longos (> 60 segundos) - instância 2. | Frappe/ERPNext v15.91.3 |

### Categoria 4: Observability Stack (14 serviços)

| # | Serviço | Container | Descrição | Tecnologia |
|---|---------|-----------|-----------|------------|
| 30 | **Langfuse Web** | `langfuse` | Observabilidade de LLM - interface web e API para métricas de tokens, latência, custos. | Langfuse 3.140.0 |
| 31 | **Langfuse Worker** | `langfuse-worker` | Worker assíncrono do Langfuse v3 para processamento de traces e métricas. | Langfuse 3.140.0 |
| 32 | **Langfuse DB** | `alice-langfuse-db` | PostgreSQL dedicado para Langfuse (isolamento de dados). | PostgreSQL 16 |
| 33 | **ClickHouse** | `clickhouse` | **OLAP Backend obrigatório Langfuse v3**. Analytics de alta performance. | ClickHouse 25.12-alpine |
| 34 | **Prometheus** | `prometheus` | Coleta e armazenamento de métricas de todos os serviços. | Prometheus 3.8.1 |
| 35 | **Grafana** | `grafana` | Dashboards e visualização de métricas. SSO integrado com Alice IdP. | Grafana OSS 12.3.1 |
| 36 | **Loki** | `loki` | Agregação e armazenamento de logs (like Prometheus, but for logs). | Loki 3.6.3 |
| 37 | **Promtail** | `promtail` | Agent que coleta logs dos containers e envia para Loki. | Promtail 3.6.3 |
| 38 | **Jaeger** | `jaeger` | Distributed tracing para debug de requisições entre microsserviços. | Jaeger 2.13.0 |
| 39 | **Vector** | `alice-vector` | Agregador de logs enterprise. Coleta logs de todos os containers e envia para Loki. | Vector 0.51.1 |
| 40 | **OTel Collector** | `alice-otel-collector` | OpenTelemetry Collector para traces e métricas (OTLP). | OTel Collector 0.142.0 |
| 41 | **Node Exporter** | `alice-node-exporter` | Métricas do host (CPU, memória, disco) para Prometheus. | Node Exporter 1.9.1 |
| 42 | **cAdvisor** | `alice-cadvisor` | Métricas de containers Docker para Prometheus. | cAdvisor 0.52.1 |

> **NOTA 01/01/2026**: Alertmanager foi removido. **Grafana Alerting** assumiu todas as funcionalidades de alertas, oferecendo UI completa para configuração de Contact Points, Notification Policies e Mute Timings.

### Categoria 5: Backup (1 serviço)

| # | Serviço | Container | Descrição | Tecnologia |
|---|---------|-----------|-----------|------------|
| 44 | **pgBackRest** | `alice-pgbackrest` | Backup enterprise do PostgreSQL: full, incremental, PITR (Point-in-Time Recovery), WAL archiving, criptografia AES-256. | pgBackRest 2.57.0 |

### Diagrama de Arquitetura

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                         CURSOR IDE (APENAS DEV)                          │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Edição de código, revisão, planejamento                          │  │
│  │  NÃO executa a aplicação - apenas desenvolvimento                 │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │
                              Git Push
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       GITHUB ACTIONS CI/CD                               │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  1. Build Pacotes Compartilhados                                   │  │
│  │  2. Build Imagens Docker                                           │  │
│  │  3. Push para GHCR                                                 │  │
│  │  4. Deploy remoto via self-hosted runner (Deploy Server) → SSH      │  │
│  │  5. Deploy Docker Compose                                          │  │
│  │  6. Health Checks                                                  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ⚠️  DEPLOY 100% AUTOMÁTICO - NENHUM COMANDO MANUAL EM PRODUÇÃO         │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│               PRODUÇÃO (Hetzner Cloud - GEX44) - 51 CONTAINERS         │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │    GEX44 (Intel i5-13500 14 Core, 64GB DDR4, 1.92TB NVMe RAID 1)  │ │
│  │                                                                     │ │
│  │  ┌──────────────────────────────────────────────────────────────┐  │ │
   │  │  │ INFRAESTRUTURA CORE (6)                                       │  │ │
   │  │  │  pgbackrest-init → caddy → postgres → redis → qdrant          │  │ │
   │  │  │  searxng (metabusca)                                          │  │ │
   │  │  └──────────────────────────────────────────────────────────────┘  │ │
   │  │                              │                                      │ │
   │  │  ┌──────────────────────────┴───────────────────────────────────┐  │ │
   │  │  │ MICROSSERVIÇOS ALICE (8)                                      │  │ │
   │  │  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐             │  │ │
   │  │  │  │Frontend │ │  Auth   │ │  Chat   │ │   RAG   │             │  │ │
   │  │  │  │  :5000  │ │ :3001   │ │  :3002  │ │  :3003  │             │  │ │
   │  │  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘             │  │ │
   │  │  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐             │  │ │
   │  │  │  │Training │ │Integra. │ │Observab.│ │  CLIP   │             │  │ │
   │  │  │  │  :3004  │ │  :3005  │ │  :3010  │ │  :8000  │             │  │ │
   │  │  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘             │  │ │
   │  │  └──────────────────────────────────────────────────────────────┘  │ │
   │  │                              │                                      │ │
   │  │  ┌──────────────────────────┴───────────────────────────────────┐  │ │
   │  │  │ ERPNEXT STACK (15)                                            │  │ │
   │  │  │  mariadb │ redis-cache │ redis-queue │ configurator           │  │ │
   │  │  │  create-site │ backend │ frontend │ websocket │ scheduler     │  │ │
   │  │  │  worker-default (x2) │ worker-short (x2) │ worker-long (x2)   │  │ │
   │  │  └──────────────────────────────────────────────────────────────┘  │ │
   │  │                              │                                      │ │
   │  │  ┌──────────────────────────┴───────────────────────────────────┐  │ │
   │  │  │ OBSERVABILITY STACK (12) + Grafana Alerting                    │  │ │
   │  │  │  langfuse (web+worker+db) │ prometheus │ grafana+alerting     │  │ │
   │  │  │  loki │ promtail │ jaeger │ vector │ otel-collector           │  │ │
   │  │  │  node-exporter │ cadvisor                                     │  │ │
   │  │  └──────────────────────────────────────────────────────────────┘  │ │
   │  │                              │                                      │ │
   │  │  ┌──────────────────────────┴───────────────────────────────────┐  │ │
   │  │  │ BACKUP (1)                                                    │  │ │
   │  │  │  pgbackrest (PostgreSQL PITR + WAL archiving + AES-256)       │  │ │
   │  │  └──────────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ Recursos Hetzner GEX44:                                            │ │
│  │  • CPU: Intel Core i5-13500 14 Core (6 P-cores, 8 E-cores)       │ │
│  │  • RAM: 64GB DDR4 ECC      • GPU: RTX 4000 Ada 20GB VRAM         │ │
│  │  • SSD: 2x 1.92TB NVMe (RAID 1 = 1.92TB utilizável)               │ │
│  │  • Tráfego: 1 Gbit/s       • Custo: €184.00/mês                  │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Recursos Utilizados

### Hetzner Cloud (Produção)

| Recurso | Especificação | Custo |
|---------|---------------|-------|
| GEX44 (Dedicated GPU) | Intel i5-13500 14 Core, 64GB DDR4, 2x 1.92TB NVMe RAID 1, RTX 4000 Ada 20GB | €184.00/mês |
| IPv4 Público | Endereço dedicado | €0.50/mês |
| **Volume alice-data** | Não necessário - servidor GEX44 possui 1.92TB interno | €0.00/mês |
| Snapshots | Backup automático | €0.012/GB/mês |
| **Total Base** | | **€184.00/mês** |

### Volume Hetzner (alice-data)

Storage interno do servidor GEX44 (1.92TB utilizável) montado diretamente em `/opt/alice`:

**Estrutura Enterprise (13/12/2025):**

| Diretório | Propósito | Permissões | Uso Estimado |
|-----------|-----------|------------|--------------|
| `/opt/alice/data/` | Dados de DBs e serviços | 750 | ~50-200GB (com 1.92TB disponível) |
| `/opt/alice/uploads/` | Uploads multimodais (DUAS estruturas) | 750 | ~100-500GB (com 1.92TB disponível) |
| ├── `{tenantId}/` | Uploads gerais de usuários (isolamento por tenant) | 750 | |
| │   ├── `image/` | Imagens enviadas via /api/media/upload | 750 | |
| │   ├── `audio/` | Áudios enviados via /api/media/upload | 750 | |
| │   └── `document/` | Documentos enviados via /api/media/upload | 750 | |
| `/opt/alice/backups/` | Backups enterprise | 750 | ~100-300GB (com 1.92TB disponível) |
| ├── `postgresql/` | Backups PostgreSQL (pgBackRest) | 750 | |
| ├── `mariadb/` | Backups MariaDB | 750 | |
| ├── `redis/` | Snapshots Redis | 750 | |
| └── `manifests/` | Manifestos JSON de backups | 750 | |
| `/opt/alice/logs/` | Logs de serviços | 750 | ~1-5GB |

> **NOTA:** Servidor GEX44 possui 1.92TB de storage interno (muito superior aos 160GB do servidor anterior). Não é necessário volume externo adicional.

### GitHub (Gratuito)

| Recurso | Free Tier | Nosso Uso |
|---------|-----------|-----------|
| Actions (Público) | Ilimitado | Todo CI/CD |
| Actions (Privado) | 2000 min/mês | ~500 min |
| Container Registry | 500MB | Imagens Docker |

### GPU Services (Hetzner GPU GEX44 - Local)

| Recurso | Custo |
|---------|-------|
| Servidor GPU GEX44 | €184.00/mês (fixo) |
| GPU Manager Service | Incluído (gerencia requisições localmente) |
| Mixtral 8x7B (vLLM) | Local (sem custo adicional) |
| FLUX.1 Schnell | Sob demanda |

### DuckDNS (Gratuito)

| Recurso | Custo |
|---------|-------|
| Subdomínio dinâmico | Gratuito |
| Atualizações automáticas | Gratuito |

---

## Instruções de Configuração

### 1. Criar Servidor Hetzner Cloud

1. Acesse [console.hetzner.cloud](https://console.hetzner.cloud)
2. Crie novo projeto ou use "Default"
3. **Servers** → **Add Server**
4. Configure:
   - **Location:** Nuremberg (recomendado) ou Helsinki
   - **Image:** Ubuntu 24.04
   - **Type:** Dedicated GPU-Server → **GEX44**
   - **SSH Key:** Adicione sua chave pública
   - **IPv4:** Habilitado
   - **Name:** `alice-prod`
5. Clique **Create & Buy now**
6. Anote o IP público (ex: `178.63.41.108`)

### 2. Configurar DNS (DuckDNS)

1. Acesse [duckdns.org](https://www.duckdns.org)
2. Faça login com sua conta
3. Crie um subdomínio: `yesyoudeserve`
4. Atualize o IP para o IP público do servidor Hetzner
5. Domínio resultante: `yesyoudeserve.duckdns.org`

### 3. Gerar API Token Hetzner

1. Console Hetzner → **Security** → **API Tokens**
2. Clique **Generate API Token**
3. Description: `github-actions-alice`
4. Permissions: **Read & Write**
5. Copie o token (mostrado apenas uma vez!)

### 4. Configurar GitHub Secrets

Vá para: Repositório → **Settings** → **Secrets and variables** → **Actions**

**Secrets Obrigatórios:**

```bash
# ========== INFRAESTRUTURA HETZNER ==========
HETZNER_API_TOKEN=seu-token-api-hetzner
HETZNER_VM_HOST=178.63.41.108
HETZNER_VM_USER=root
HETZNER_SSH_PRIVATE_KEY=<cole-sua-chave-ssh-privada-aqui>

# ========== POSTGRESQL ==========
POSTGRES_PASSWORD=senha-segura-gerada

# ========== SESSÃO E SEGURANÇA ==========
SESSION_SECRET=seu-session-secret-seguro

# ========== STRIPE (RECEBER PAGAMENTOS) ==========
STRIPE_SECRET_KEY=sk_live_xxxxx
STRIPE_PUBLISHABLE_KEY=pk_live_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx

# ========== WISE (ENVIAR PAGAMENTOS GLOBAIS) ==========
WISE_API_KEY=xxxxx
WISE_PROFILE_ID=xxxxx
WISE_WEBHOOK_SECRET=xxxxx  # opcional para webhooks

# ========== OAUTH GOOGLE ==========
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx

# ========== OAUTH GITHUB (NOME CORRIGIDO!) ==========
OAUTH_GITHUB_CLIENT_ID=Ov23xxxxx
OAUTH_GITHUB_CLIENT_SECRET=xxxxx

# ========== GPU SERVICES (Hetzner GEX44 - Local) ==========
# Todos os serviços GPU rodam localmente no servidor Hetzner GPU GEX44
# GPU Manager Service gerencia todas as requisições GPU com fila priorizada
# Não são necessários secrets externos para GPU (tudo local)

# ========== TWILIO (WHATSAPP) ==========
TWILIO_ACCOUNT_SID=ACxxxxx
TWILIO_AUTH_TOKEN=xxxxx
TWILIO_WHATSAPP_NUMBER=+14155238886

# ========== GMAIL SMTP (GRAFANA ALERTING) ==========
# NOTA 01/01/2026: Alertmanager removido, SMTP agora via Grafana GF_SMTP_*
GMAIL_USER=seuemail@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx

# ========== DOMÍNIO E SSL ==========
ACME_EMAIL=seu-email@exemplo.com

# ========== OBSERVABILITY (Langfuse + Grafana) ==========
LANGFUSE_SECRET_KEY=sk-lf-xxxxx
LANGFUSE_NEXT_AUTH_SECRET=sua-chave-segura-32-chars

# ========== ADMIN CREDENTIALS (31/12/2025) ==========
# Grafana 12: username customizável, senha específica
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=sua-senha-grafana-forte

# ERPNext 15: username FIXO "Administrator", apenas senha configurável
ERPNEXT_ADMIN_PASSWORD=sua-senha-erpnext-forte

# Admin centralizado (opcional - derivado de GRAFANA_* se não definido)
# ADMIN_USER=seu-email-admin  # Opcional
# ADMIN_PWD=sua-senha-forte   # Opcional
```

**⚠️ IMPORTANTE:** O GitHub NÃO permite secrets começando com `GITHUB_`. Use `OAUTH_GITHUB_` como prefixo.

### 5. Conexão SSH ao Servidor

**Arquitetura de 2 Servidores (26/12/2025):**

| Servidor | Alias SSH | IP | Função |
|----------|-----------|-----|--------|
| **Deploy Server** | `alice-hetzner` | 46.224.46.93 | GitHub Actions Runner, CI/CD (CPX32 - 4 vCPU, 8GB RAM) |
| **Production Server** | `alice-prod` | 178.63.41.108 | Aplicação + GPU (50 containers) |

**Configuração SSH** (`~/.ssh/config`):

```text
Host alice-hetzner
    HostName 46.224.46.93
    User root
    IdentityFile ~/.ssh/alice-deploy

Host alice-prod
    HostName 178.63.41.108
    User root
    IdentityFile ~/.ssh/alice-deploy
```

**Conexão rápida:**

```bash
# Deploy Server (runner)
ssh alice-hetzner

# Production Server (aplicação)
ssh alice-prod
```

**Especificações do Servidor (verificado em 03/12/2025):**

| Recurso | Valor |
|---------|-------|
| **SO** | Ubuntu 24.04.3 LTS (Noble Numbat) |
| **Docker** | 29.1.3 |
| **Docker Compose** | v5.0.0 |
| **CPU** | Intel Core i5-13500 14 Core (6 P-cores, 8 E-cores) |
| **RAM** | 64GB DDR4 ECC |
| **GPU** | NVIDIA RTX 4000 SFF Ada Generation (20GB VRAM) |
| **Disco** | 2x 1.92TB NVMe SSD Datacenter Edition (Software RAID 1 = 1.92TB utilizável) |
| **IP** | 178.63.41.108 |
| **Localização** | Hetzner Cloud |

### 6. Configurar Servidor Hetzner (Primeira vez)

```bash
# Conectar via SSH
ssh alice-hetzner

# Atualizar sistema
apt update && apt upgrade -y

# Instalar Docker
curl -fsSL https://get.docker.com | sh

# Instalar Docker Compose
apt install docker-compose-plugin -y

# Verificar instalação
docker --version
docker compose version

# Configurar firewall
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable

# Configurar Docker daemon.json (Enterprise GPU - 28/12/2025)
# NOTA: Requer NVIDIA Container Toolkit instalado e configurado no Production Server.
# IMPORTANTE (Best Practices 2025): o workflow de deploy NÃO instala toolkit/driver durante o deploy.
# Infra de GPU é pré-requisito do servidor e é validada via fail-fast no workflow.
cat > /etc/docker/daemon.json << 'EOF'
{
  "default-runtime": "nvidia",
  "runtimes": {
    "nvidia": {
      "args": [],
      "path": "nvidia-container-runtime"
    }
  },
  "storage-driver": "overlay2",
  "live-restore": true,
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "5"
  },
  "max-concurrent-downloads": 10,
  "max-concurrent-uploads": 10,
  "builder": {
    "gc": {
      "enabled": true,
      "defaultKeepStorage": "20GB"
    }
  },
  "features": {
    "buildkit": true
  }
}
EOF
systemctl restart docker

# Habilitar NVIDIA Persistence Mode (GPU sempre ativa - sem cold start)
nvidia-smi -pm 1

# Validação obrigatória (deve passar antes do primeiro deploy):
# 1) Driver OK
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
# 2) GPU acessível via Docker (runtime NVIDIA)
timeout 45s docker run --rm --gpus all nvidia/cuda:12.6.0-base-ubuntu22.04 nvidia-smi

# Configurar NVIDIA CDI (Container Device Interface - Best Practice 2025)
nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml

# Hardening do kernel (segurança de rede - 19/12/2025)
cat > /etc/sysctl.d/99-security.conf << 'EOF'
# Security hardening - Alice Enterprise Platform
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.icmp_echo_ignore_broadcasts = 1
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0
net.ipv4.tcp_syncookies = 1
net.ipv4.tcp_max_syn_backlog = 2048
net.ipv4.tcp_synack_retries = 2
net.ipv4.tcp_syn_retries = 5
net.ipv4.conf.all.log_martians = 1
net.ipv4.icmp_ignore_bogus_error_responses = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0
net.ipv6.conf.all.accept_ra = 0
net.ipv6.conf.default.accept_ra = 0
fs.file-max = 65535
net.core.somaxconn = 65535
EOF
sysctl -p /etc/sysctl.d/99-security.conf

# Otimizações GPU (performance CUDA - 28/12/2025)
cat > /etc/sysctl.d/99-alice-gpu.conf << 'EOF'
# Alice Enterprise Platform - GPU Optimizations
# Ref: NVIDIA Best Practices for Data Center GPUs

# Reduzir swap para priorizar RAM (GPU precisa de RAM rápida)
vm.swappiness = 10

# Aumentar dirty ratio para melhor throughput de I/O
vm.dirty_ratio = 40
vm.dirty_background_ratio = 10

# Aumentar limites de memória compartilhada (para CUDA)
kernel.shmmax = 68719476736
kernel.shmall = 4294967296

# Network buffers (para transferência de dados GPU)
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.core.rmem_default = 1048576
net.core.wmem_default = 1048576
net.ipv4.tcp_rmem = 4096 1048576 16777216
net.ipv4.tcp_wmem = 4096 1048576 16777216

# File handles (containers GPU abrem muitos arquivos)
fs.file-max = 2097152
fs.inotify.max_user_watches = 524288
EOF
sysctl -p /etc/sysctl.d/99-alice-gpu.conf

# Verificar se volume Hetzner está montado
df -h | grep alice-data

# Se não estiver montado, verificar /mnt/HC_Volume_*
ls -la /mnt/

# Criar symlink se necessário (volume já deve estar montado pela Hetzner)
# ln -sf /mnt/HC_Volume_XXXXXX /mnt/alice-data
# ln -sf /mnt/alice-data /opt/alice

# Verificar estrutura de diretórios (criada automaticamente pelo deploy)
ls -la /opt/alice/

# Instalar e configurar fail2ban (proteção contra brute-force)
apt install -y fail2ban
systemctl enable fail2ban
systemctl start fail2ban

# Verificar IPs banidos
fail2ban-client status sshd
```

### 6.1. Configurar Self-Hosted Runner (Deploy Server)

**⚠️ OBRIGATÓRIO para workflows funcionarem corretamente:**

O runner self-hosted Hetzner CPX32 está configurado com **otimizações enterprise** (27/12/2025):

#### Otimizações Aplicadas

| Categoria | Configuração | Valor | Benefício |
|-----------|--------------|-------|-----------|
| **Kernel** | net.core.rmem_max | 16MB | Downloads rápidos de imagens Docker |
| **Kernel** | vm.swappiness | 10 | Preferir RAM sobre swap |
| **Kernel** | fs.inotify.max_user_watches | 524288 | Suporte a muitos arquivos |
| **Docker** | max-concurrent-downloads | 10 | Builds paralelos |
| **Docker** | BuildKit | enabled | Cache de camadas otimizado |
| **Docker** | GC | 20GB | Limpeza automática de cache |
| **Limits** | nofile | 1048576 | Muitos arquivos abertos |
| **Systemd** | NODE_OPTIONS | --max-old-space-size=6144 | 6GB RAM para Node.js |
| **Systemd** | Nice | -5 | Alta prioridade CPU |
| **Cron** | Cleanup | 3h diário | Limpeza automática de disco |

#### Arquivos de Configuração

```bash
# Conectar ao Deploy Server
ssh alice-hetzner

# Arquivos de configuração enterprise criados:
/etc/sysctl.d/99-github-runner.conf        # Kernel tuning (rede, memória, inotify)
/etc/docker/daemon.json                     # Docker daemon otimizado
/etc/security/limits.d/99-runner.conf       # Limits de recursos (nofile, nproc)
/etc/systemd/system/actions.runner.*.d/override.conf  # Service override (NODE_OPTIONS, Nice)
/opt/cleanup-runner.sh                      # Script de limpeza automática
/etc/cron.d/runner-cleanup                  # Cron para limpeza diária 3h

# Verificar otimizações aplicadas
sysctl net.core.rmem_max vm.swappiness fs.inotify.max_user_watches
cat /etc/docker/daemon.json | jq
systemctl show actions.runner.*.service | grep -E 'Environment|LimitNOFILE|Nice'

# Verificar status do runner
systemctl status actions.runner.fillipeguerrabtc-alice.hetzner-deploy-runner.service
```

#### Configurar Passwordless Sudo (se necessário)

```bash
# Configurar passwordless sudo (substituir USER pelo usuário do runner)
echo "root ALL=(ALL) NOPASSWD: ALL" | tee /etc/sudoers.d/actions-runner
chmod 0440 /etc/sudoers.d/actions-runner

# Testar passwordless sudo
sudo -n whoami  # Deve retornar root sem pedir senha
```

**Nota:** Os workflows usam `sudo -n` (non-interactive). Se não configurado, comandos de limpeza falharão silenciosamente.

### 6. Primeiro Deploy

O deploy é **100% automático** via GitHub Actions:

1. Faça commit e push para a branch `main`
2. O GitHub Actions irá automaticamente:
   - Build dos containers
   - Push para GHCR
   - SSH para Hetzner
   - Deploy via Docker Compose
   - Health checks
3. Acesse: `https://yesyoudeserve.duckdns.org`

**⚠️ IMPORTANTE:** Nenhum comando manual é necessário em produção. Todo deploy acontece automaticamente.

---

## Fluxo de CI/CD (Best Practices 2025)

**Tag única e determinística:** a pipeline de deploy usa a versão recebida pelo `release.yml` (`inputs.version` ou calculada automaticamente) como tag principal das imagens. Build, security scan (Trivy) e deploy consomem exatamente a mesma tag, garantindo alinhamento entre imagens analisadas e imagens publicadas.

### Versionamento Automático (30/12/2025)

O workflow de release (`release.yml`) suporta versionamento automático baseado em Conventional Commits:

- **Versão automática**: Use `version: "auto"` ou deixe vazio para calcular automaticamente a próxima versão baseada em:
  - **BREAKING CHANGE** ou commits com `!` (ex: `feat!:`, `fix!:`) → **MAJOR** bump (v2.0.0)
  - **feat:** (sem `!`) → **MINOR** bump (v1.1.0)
  - **fix:** ou outros → **PATCH** bump (v1.0.1)

- **Reutilização de tags**: Se uma tag já existe e aponta para o mesmo commit atual, ela é reutilizada automaticamente (útil para rollbacks). Se a tag aponta para um commit diferente, o workflow falha com erro claro.

- **Cache e retagging**: O sistema de cache e retagging funciona corretamente mesmo quando tags são reutilizadas, garantindo que imagens Docker sejam reutilizadas quando apropriado (sem rebuilds desnecessários).

### Pipeline Unificada (17/12/2025)

```text
┌─────────────────────────────────────────────────────────────────┐
│                     FLUXO CI/CD ALICE - PIPELINE UNIFICADA       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Push para main                                                  │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────────────┐                                        │
│  │ CI - Build & Test   │ ← AUTOMÁTICO                           │
│  │ • TypeScript check  │                                        │
│  │ • ESLint            │                                        │
│  │ • Build packages    │                                        │
│  │ • Build services    │                                        │
│  │ • Security scan     │                                        │
│  └─────────────────────┘                                        │
│       │ (se passar)                                              │
│       ▼                                                          │
│  ┌─────────────────────┐                                        │
│  │ Release & Tag       │ ← AUTOMÁTICO (v1.0.X incremental)      │
│  │ • Cria Git tag      │                                        │
│  │ • Publica Docker imgs│ (rebuild só do que mudou; retag GHCR)  │
│  │ • Push para GHCR    │                                        │
│  │ • Cria GitHub Rel.  │                                        │
│  └─────────────────────┘                                        │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────────────┐                                        │
│  │ Deploy Production   │ ← 100% AUTO (sem aprovação)            │
│  │ • SSH para Hetzner  │   50 containers                        │
│  │ • Docker Compose up │                                        │
│  │ • Validate GPU URLs │   4 Container Groups (pré-criados)     │
│  │ • Health checks     │   RTX 4000 Ada 20GB (Mixtral, FLUX, ASR, Emb.)  │
│  │ • Rollback auto     │                                        │
│  └─────────────────────┘                                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Etapas Detalhadas

| Etapa | Trigger | Descrição |
|-------|---------|-----------|
| **CI - Build & Test** | Push para `main` | Validação automática de código |
| **Release & Tag** | CI passa | Versionamento semântico automático |
| **Deploy Hetzner** | Release passa | 50 containers via Docker Compose |
| **Validate GPU** | Deploy Hetzner passa | Valida URLs GPU (Container Groups pré-criados) |
| **Health Check** | Validate GPU passa | Validação e rollback automático |

### GPU é OBRIGATÓRIO - Enterprise-Grade (25/12/2025)

**⚠️ ARQUITETURA ENTERPRISE:** Os serviços GPU são **OBRIGATÓRIOS**, não opcionais. GPUs são o coração da plataforma de IA - sem eles, a plataforma não funciona. Todos os serviços GPU rodam localmente no servidor Hetzner GPU GEX44, gerenciados pelo GPU Manager Service.

| Serviço GPU | Função | Impacto se Falhar |
|-------------|--------|-------------------|
| **GPU Manager Service** | Gerenciamento centralizado (fila, VRAM, circuit breakers) | Todas as requisições GPU falham |
| **Mixtral 8x7B** | LLM (chat, trading) | Chat não funciona |
| **Embeddings GPU** | Qwen3 + OpenCLIP (RAG) | RAG não funciona |
| **FLUX.1 Schnell** | Geração de imagens | Imagens não funcionam |
| **ASR Canary-1B** | Transcrição de áudio | Áudio não funciona |
| **GPU Trainer** | Fine-tuning LoRA (prioridade 3) | Fine-tuning não funciona (chat/embeddings continuam) |

**Health Check Completo:**
- Verifica **6 serviços Hetzner**: Frontend, Auth, Chat, RAG, ERPNext, Grafana
- Valida **GPU Manager Service** e serviços GPU locais
- **Tolerância zero**: Qualquer falha dispara rollback automático

**Rollback Enterprise (25/12/2025):**
- Dispara se deploy falhar
- Reverte containers para última versão estável
- GPU services são parte do deploy único (não separado)

Pipeline: push para `main` → CI → Release → Deploy (100% automático - todos os 50 containers no servidor único).

### Versionamento Automático (30/12/2025)

O workflow de release (`release.yml`) suporta versionamento automático baseado em Conventional Commits:

**Opções de versionamento:**
- **Automático**: Use `version: "auto"` ou deixe vazio no workflow_dispatch para calcular automaticamente a próxima versão baseada em:
  - **BREAKING CHANGE** ou commits com `!` (ex: `feat!:`, `fix!:`) → **MAJOR** bump (v2.0.0)
  - **feat:** (sem `!`) → **MINOR** bump (v1.1.0)
  - **fix:** ou outros → **PATCH** bump (v1.0.1)
- **Manual**: Forneça a versão explicitamente (ex: `v1.4.25`)
- **Reutilização de tags**: Se uma tag já existe e aponta para o mesmo commit atual, ela é reutilizada automaticamente (útil para rollbacks)

**Cálculo de versão inteligente (30/12/2025):**
- Usa a **MAIOR versão existente** como base (não `git describe` que pega tag mais próxima)
- Se versão calculada já existe (releases paralelos), incrementa PATCH automaticamente
- Exemplo: se v1.6.0 existe e MINOR bump seria v1.7.0, mas v1.7.0 já existe → usa v1.7.1

**Deploy automático (30/12/2025):**
- O Deploy workflow aceita versão vazia e obtém automaticamente da tag mais recente quando disparado pelo Release workflow
- Garante que imagens Docker existem no GHCR antes de fazer deploy
- Cache e tags já gerenciados pelo Release workflow (não faz rebuild no deploy)

**Cache inteligente (30/12/2025):**
- Builds só acontecem quando há mudanças relevantes nos arquivos do serviço
- Retagging automático quando não há mudanças (evita rebuilds desnecessários)
- Cache de registry (GHCR) mantido por imagem para builds mais rápidos

**Reutilização de tags:**
- Se uma tag já existe e aponta para o mesmo commit atual, ela é reutilizada automaticamente (útil para rollbacks)
- Se a tag aponta para um commit diferente, o workflow falha com erro claro
- Cache e retagging funcionam corretamente mesmo quando tags são reutilizadas

**Exemplo de fluxo:**
- Última tag: `v1.4.24`
- Commits desde a tag: `feat: adiciona nova funcionalidade`
- Versão calculada: `v1.5.0` (MINOR bump)

### Deploy 100% Automático

O deploy dispara **automaticamente** após Release bem-sucedido, sem necessidade de aprovação manual:

```bash
# Fluxo 100% automático:
1. Push para main
2. CI valida código (TypeScript, ESLint, testes)
3. Release cria tag e imagens Docker
4. Security Scan (Trivy) valida imagens
5. Deploy executa automaticamente
6. Health checks validam serviços
7. Rollback automático se falhar

# Deploy manual (emergência):
Actions → Deploy to Production → Run workflow → Selecionar versão
```

**Benefícios do Pipeline 100% Automático:**

- ✅ Zero intervenção humana no deploy
- ✅ Feedback rápido (push → produção em minutos)
- ✅ Security scan obrigatório antes do deploy
- ✅ Migrations executadas automaticamente na ordem correta (0001 → 0002 → 0003)

### Deploy Enterprise Hardening (02/01/2026)

O workflow de deploy inclui validações enterprise completas para garantir deploys confiáveis:

#### Smoke Tests Pós-Deploy

Validações automáticas executadas APÓS o deploy completar e ANTES de marcar como sucesso:

| Test | Descrição | Comando |
|------|-----------|---------|
| **PostgreSQL** | Verifica se aceita conexões | `pg_isready -U alice` |
| **pgvector** | Valida operação vetorial real | `SELECT '[1,2,3]'::vector <-> '[4,5,6]'::vector` |
| **Redis** | Verifica resposta PING/PONG | `redis-cli PING` |
| **Caddy** | Verifica HTTP na porta 80/443 | `wget --spider http://localhost:80/` |
| **GPU Manager** | Valida health endpoint | `wget --spider http://localhost:3010/health` |
| **Conectividade** | Chat → GPU Manager | `wget http://alice-gpu-manager:3010/health` |

#### Persistência de Logs de Deploy

Todos os logs de deploy são salvos automaticamente para troubleshooting futuro:

```bash
# Formato do arquivo de log
/opt/alice/logs/deploy-YYYYMMDD-HHMMSS.log

# Exemplo
/opt/alice/logs/deploy-20260102-141530.log

# Visualizar logs de um deploy específico
cat /opt/alice/logs/deploy-20260102-141530.log | less
```

#### Validação do Repositório pgBackRest

Antes de iniciar o deploy, o workflow valida:

1. **Existência do diretório**: `/opt/alice/backups/postgresql` deve existir
2. **Permissões**: UID/GID devem ser 999:999 (postgres)
3. **Estrutura**: Detecta se é primeiro deploy ou repositório existente
4. **Correção automática**: Se permissões incorretas, corrige automaticamente

#### pgBackRest Stanza Creation (Fix Crítico)

O `pgbackrest-init` agora cria a stanza SEM precisar de `pg_control`:

```bash
# ANTES (falhava): Tentava ler pg_control que não existe no primeiro deploy
pgbackrest --stanza=alice_prod --no-online stanza-create  # Lia pg1-path do config

# DEPOIS (funciona): Passa configs via CLI, sem pg1-*
pgbackrest \
    --stanza=alice_prod \
    --repo1-path=/var/lib/pgbackrest \
    --repo1-cipher-type=aes-256-cbc \
    --repo1-cipher-pass="${CIPHER_PASS}" \
    --no-online \
    stanza-create  # Cria stanza vazia, sincroniza depois
```

### Migrations do Banco de Dados

O workflow de deploy executa automaticamente todas as migrations na ordem correta:

1. **Schema Base (Drizzle ORM)**: `drizzle-kit push` cria/atualiza todas as tabelas definidas no schema antes das migrations SQL incrementais
2. **0001_rls_security_enterprise.sql**: Configura RLS (Row Level Security), funções de tenant, índices e grants
3. **0002_create_feature_flags.sql**: Cria tabela de feature flags enterprise
4. **0003_update_embedding_dimensions_1024.sql**: Atualiza dimensões de embeddings de imagem para 1024 (OpenCLIP ViT-H/14 → pgvector) - **CRÍTICA**

**⚠️ IMPORTANTE - Arquitetura de Embeddings (17/12/2025):**
- **Texto**: Qwen3-Embedding-8B (4096 dim) → **Qdrant** (não usa migration SQL)
- **Imagem**: OpenCLIP ViT-H/14 (1024 dim) → **pgvector** (migration 0003)

**🔧 Melhorias Enterprise (23/12/2025):**
- **URL-Encoding de Credenciais**: `DATABASE_URL` agora usa URL-encoding adequado (RFC 3986) para user, password e database name. Suporta senhas com qualquer caractere especial (@, :, ?, #, etc.) sem quebrar a string de conexão.
- **Timeout Protection**: `drizzle-kit push` tem timeout de 300s (5 min) e validação de conexão explícita antes da execução. Previne hangs indefinidos se PostgreSQL não está totalmente pronto.
- **Fail-Fast**: Se `drizzle-kit push` falhar ou exceder timeout, o deploy é abortado imediatamente (schema base é crítico).

O workflow de deploy executa todas as migrations automaticamente na ordem correta antes de iniciar os serviços.

- ✅ Rollback automático se health checks falharem
- ✅ Rastreabilidade completa de releases

### Docker Build Cache (Registry Cache)

O pipeline utiliza **Registry Cache no GHCR** para acelerar builds:

| Estratégia | Descrição |
|------------|-----------|
| `cache-from: type=registry` | Puxa cache do GHCR (não é branch-specific) |
| `cache-to: type=registry,mode=max` | Salva todas as layers intermediárias |
| Imagens `:cache` | Cada serviço tem sua própria imagem de cache |

**Vantagens sobre GHA Cache:**

- ✅ Compartilhado entre `release.yml` (tags) e `deploy-production.yml` (tag/SHA versionado)
- ✅ Sem limite de 10GB do GitHub Actions cache
- ✅ Reprodutibilidade: releases usam a tag exata
- ✅ Funciona com runners GitHub-hosted E self-hosted (cache armazenado no GHCR, não no runner)
- ✅ Primeiro build: cria cache do zero (sem cache disponível) - build completo
- ✅ Builds subsequentes: usam cache automaticamente - builds incrementais rápidos

**Comportamento do Cache:**

- **Primeiro build após mudança de runner**: Cache não existe, build completo (normal)
- **Builds subsequentes**: Cache disponível no GHCR, build incremental rápido
- **Cache opcional**: Se cache não existe, build continua sem erro (comportamento esperado do Docker Buildx)
- **Invalidação automática**: Cache é invalidado por hash SHA256 quando arquivos mudam

**Performance Esperada:**

| Cenário | Sem Cache | Com Cache |
|---------|-----------|-----------|
| Primeiro build (cache vazio) | ~45 min | ~45 min |
| Rebuild completo | ~45 min | ~45 min |
| Mudança em 1 serviço | ~45 min | ~7 min |
| Nenhuma mudança | ~45 min | ~3 min |

### Cache de Dependências no CI

O CI utiliza cache nativo do GitHub Actions para dependências:

| Componente | Estratégia | Economia |
|------------|------------|----------|
| **pnpm (Node.js)** | Composite action `.github/actions/setup-node-pnpm` | ~6-10 min/run |
| **pip (Python/PyTorch)** | `actions/setup-python` com `cache: 'pip'` | ~900MB/build |
| **Artifacts** | `packages/*/dist` compartilhado entre jobs | Build incremental |
| **Versões Node/pnpm** | Calculadas 1x via outputs (detect-changes) | Elimina ~14 curls API |

### Otimização CI Performance (27/12/2025)

**Pipeline Enterprise - 3 Workflows por Responsabilidade:**

| Workflow | Responsabilidade | Jobs |
|----------|------------------|------|
| **CI** | Validar código (typecheck/lint/security) | 4 jobs |
| **Release** | Buildar imagens Docker + GitHub Release | 3 jobs |
| **Deploy** | Deployar para Hetzner + Health Check | 6 jobs |

**Otimizações Aplicadas:**

1. **REMOVIDO `build-all` do CI:** Redundante - Release já builda via Docker
2. **CONSOLIDADO `security-scan` + `compliance-checks`:** Agora 1 job único `security-and-compliance`
3. **Composite Action Reutilizável:** `.github/actions/setup-node-pnpm/action.yml`
4. **Versões via Outputs:** Job `detect-changes` calcula versões 1x e passa via outputs
5. **Jobs Simplificados:** `security-and-compliance` e `trigger-release` não fazem setup Node.js
6. **Cache Restore/Save Separados:** Usa `actions/cache/restore` + `actions/cache/save` (best practice 2025)

**Fix Cache Persistence (27/12/2025):** `actions/cache` não executa post-step de save corretamente em composite actions. Corrigido para usar restore/save separados, garantindo cache persistido entre jobs.

**Economia Total:** CI de ~20min → ~8min (redução de 60%)

**⚠️ REGRA CRÍTICA:** NUNCA limpar caches do GitHub Actions nos workflows:

- ❌ `rm -rf ~/.cache/pip` - Quebra cache do pip
- ❌ `rm -rf ~/.pnpm-store` - Quebra cache do pnpm
- ❌ `--no-cache-dir` no pip - Desabilita cache
- ✅ Usar `cache: 'pnpm'` e `cache: 'pip'` nativos

---

## URLs de Produção

### Aplicação Principal

| Serviço | URL | Descrição |
|---------|-----|-----------|
| Alice Frontend | <https://yesyoudeserve.duckdns.org> | SPA React principal |
| Alice Chat | <https://yesyoudeserve.duckdns.org/chat> | Interface de chat (SPA route) |
| Alice Dashboard | <https://yesyoudeserve.duckdns.org/dashboard> | Painel administrativo (SPA route) |
| Alice Trading | <https://yesyoudeserve.duckdns.org/trading> | Interface de trading BTC (SPA route) |
| Alice WebSocket | <wss://yesyoudeserve.duckdns.org/ws> | WebSocket para streaming em tempo real |

### APIs REST (Microsserviços)

| API | URL | Descrição |
|-----|-----|-----------|
| Auth API | <https://yesyoudeserve.duckdns.org/api/auth> | Autenticação OAuth/SAML, sessões, RBAC |
| Chat API | <https://yesyoudeserve.duckdns.org/api/chat> | Conversas com LLM, histórico |
| RAG API | <https://yesyoudeserve.duckdns.org/api/rag> | Embeddings, busca semântica, documentos |
| Training API | <https://yesyoudeserve.duckdns.org/api/training> | Fine-tuning LoRA, jobs |
| Integrations API | <https://yesyoudeserve.duckdns.org/api/integrations> | Trading, Stripe, Twilio, Wise |
| Observability API | <https://yesyoudeserve.duckdns.org/api/observability> | Health checks, métricas internas |
| Webhook | <https://yesyoudeserve.duckdns.org/webhook> | Webhooks externos (Stripe, etc) |

### ERPNext

| Serviço | URL |
|---------|-----|
| ERPNext | <https://erp.yesyoudeserve.duckdns.org> |

### Observability Stack

| Serviço | URL | Descrição |
|---------|-----|-----------|
| Grafana | <https://observability.yesyoudeserve.duckdns.org> | Dashboards e alertas |
| Prometheus | <https://metrics.yesyoudeserve.duckdns.org> | Métricas e consultas |
| Jaeger | <https://traces.yesyoudeserve.duckdns.org> | Distributed tracing |
| Langfuse | <https://langfuse.yesyoudeserve.duckdns.org> | LLM observability |
| Health Check | <https://yesyoudeserve.duckdns.org/api/observability/health> | Status do stack |

> **NOTA 01/01/2026**: Alertas gerenciados via Grafana Alerting (menu Alerting no Grafana).

### Infraestrutura

| Serviço | URL | Status |
|---------|-----|--------|
| Caddy Admin API | localhost:2019 | Healthcheck interno (não exposto externamente) |

> **NOTA:** A Admin API do Caddy é usada apenas para healthcheck interno e não está exposta externamente por segurança. Para debug, acesse via SSH e `docker logs alice-caddy`.

---

## Manutenção de Imagens Docker Externas

**Autor:** Fillipe Guerra  
**Data:** 02 de Janeiro de 2026

### Validação de Tags

Antes de cada deploy, o workflow valida que TODAS as 23 imagens externas existem no Docker Hub:

- 14 imagens de observability (Prometheus, Grafana, Loki, etc.)
- 3 imagens de infrastructure (Caddy, Tor, SearXNG)
- 2 imagens MinIO (S3 para Langfuse v3)
- 2 imagens de database (ClickHouse, Redis)
- 1 imagem ERPNext
- 1 imagem MariaDB

### Atualização de Tags Rotacionadas

Se uma tag for removida do Docker Hub:

1. Executar `docker manifest inspect <image>:<tag>` para verificar se existe
2. Atualizar em `docker-compose.prod.yml`
3. Atualizar em `.github/workflows/deploy-production.yml` (linha 270+)
4. Testar localmente: `docker compose -f docker-compose.prod.yml pull <service>`
5. Commit + Push

### Lista de Imagens Externas (23 total)

```bash
# MinIO (Langfuse v3 S3)
minio/minio:RELEASE.2024-12-18T13-15-44Z
minio/mc:RELEASE.2024-10-29T15-34-59Z

# Database & Vector Store
clickhouse/clickhouse-server:25.12-alpine
redis:8.4.0-alpine                # Alice (node-redis 5.x suporta Redis 8)
redis:6.2.21-alpine               # ERPNext (requer Redis 6.x - docs.frappe.io)
qdrant/qdrant:v1.16.2
mariadb:10.11

# Infrastructure
caddy:2.8.4-alpine
busybox:1.36
dperson/torproxy:latest
searxng/searxng:latest
tecnativa/docker-socket-proxy:latest

# Observability
prom/prometheus:v3.8.1
grafana/grafana:12.3.1
grafana/loki:3.6.3
grafana/promtail:3.6.3
jaegertracing/jaeger:2.13.0
langfuse/langfuse:3.89
prom/node-exporter:v1.9.1
timberio/vector:0.51.0-alpine
otel/opentelemetry-collector-contrib:0.142.0
gcr.io/cadvisor/cadvisor:v0.52.1

# ERPNext
frappe/erpnext:v15.91.1
```

---

## Rollback

### Automático

Rollback automático acontece se health checks falharem após deploy.

### Manual

```bash
# SSH para o servidor de produção
ssh alice-prod

# Listar imagens disponíveis
docker images | grep alice

# Rollback para versão anterior
docker pull ghcr.io/SEU-REPO/alice-auth:SHA-ANTERIOR
docker compose -f /opt/alice/docker-compose.prod.yml up -d --force-recreate alice-auth
```

---

## Monitoramento

### Logs

```bash
# Ver logs de todos os containers
cd /opt/alice && docker compose logs -f

# Logs de serviço específico
docker logs -f alice-auth

# Logs do Caddy (API Gateway)
docker logs -f alice-caddy

# Logs da Observability Stack
docker logs -f alice-prometheus
docker logs -f alice-grafana
docker logs -f alice-jaeger
docker logs -f alice-langfuse
```

### Health Checks

```bash
# Verificar status dos serviços
docker compose ps

# Testar endpoints principais
curl -s https://yesyoudeserve.duckdns.org/api/health
curl -s https://yesyoudeserve.duckdns.org/api/auth/health

# Testar observability stack
curl -s https://yesyoudeserve.duckdns.org/observability/health
```

### Recursos do Servidor

```bash
# CPU, memória, processos
htop

# Disco
df -h

# Docker stats
docker stats
```

---

## Backup

### PostgreSQL (Alice)

```bash
# Backup manual
docker exec alice-postgres pg_dump -U alice alice_db > /opt/alice/backups/alice_$(date +%Y%m%d).sql

# Restore
cat backup.sql | docker exec -i alice-postgres psql -U alice alice_db
```

### PostgreSQL (Langfuse)

```bash
# Backup manual
docker exec langfuse-postgres pg_dump -U langfuse langfuse > /opt/alice/backups/langfuse_$(date +%Y%m%d).sql

# Restore
cat backup.sql | docker exec -i langfuse-postgres psql -U langfuse langfuse
```

### MariaDB (ERPNext)

```bash
# Backup manual
docker exec erpnext-mariadb mysqldump -u root -p$MYSQL_ROOT_PASSWORD erpnext > /opt/alice/backups/erpnext_$(date +%Y%m%d).sql

# Restore
cat backup.sql | docker exec -i erpnext-mariadb mysql -u root -p$MYSQL_ROOT_PASSWORD erpnext
```

### Backup Automatizado via Dashboard Admin

A plataforma Alice inclui um **Painel de Backup & Restore** enterprise-grade acessível em `/backup-admin`:

#### Funcionalidades do Backup Admin

| Funcionalidade | Descrição |
|----------------|-----------|
| **Backup Full** | Backup completo de PostgreSQL, MariaDB e Redis com um clique |
| **Backup Incremental** | Backup incremental para economia de tempo e espaço |
| **Restore Seletivo** | Restauração com seleção de ponto no tempo (PITR) |
| **Histórico de Backups** | Lista completa com manifestos JSON de cada backup |
| **Schedule Configurável** | Configuração de cron expressions para backups automáticos |
| **Status em Tempo Real** | Monitoramento do progresso durante operações |
| **Retenção Configurável** | Definição de dias de retenção para full, incremental e arquivo |
| **Exclusão de Backups** | Excluir manifestos de backups antigos manualmente |
| **Limpeza Automática** | Botão para limpar backups expirados baseado na retenção |
| **Monitor de Disco** | Visualização de uso de disco do volume e uploads |

#### Arquitetura de Backup

```text
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
│  │              Volume Local Hetzner (/opt/alice/backups)      ││
│  │              100GB EXT4 - Expansível até 10TB               ││
│  │  ├── postgresql/   (pgBackRest full + incremental + WAL)    ││
│  │  ├── mariadb/      (Mariabackup dumps comprimidos)          ││
│  │  ├── redis/        (RDB snapshots)                          ││
│  │  └── manifests/    (JSON de cada backup)                    ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

> **NOTA:** Backups são armazenados 100% localmente no Volume Hetzner.
> Para backups offsite, o admin pode fazer download manual via Dashboard ou configurar rsync externo.

#### API Endpoints de Backup

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `GET` | `/api/backup/status` | Status atual do job de backup |
| `GET` | `/api/backup/history` | Histórico de backups com manifestos |
| `GET` | `/api/backup/schedule` | Configuração atual de schedule |
| `GET` | `/api/backup/disk-usage` | **Uso de disco do volume (Volume + Uploads)** |
| `POST` | `/api/backup/run` | Iniciar backup (full ou incremental) |
| `POST` | `/api/backup/restore` | Iniciar restauração |
| `PUT` | `/api/backup/schedule` | Atualizar configuração de schedule |
| `POST` | `/api/backup/pre-deploy` | Snapshot pré-deploy para rollback |
| `POST` | `/api/backup/cleanup` | **Limpar backups antigos (por retenção)** |
| `DELETE` | `/api/backup/:id` | **Excluir manifesto de backup específico** |

#### Schedule Padrão (Configurável via Dashboard)

```text
Full Backup:        0 3 * * 0   (Domingo às 03:00)
Incremental Backup: 0 3 * * 1-6 (Segunda a Sábado às 03:00)
Retenção Full:      15 dias
Retenção Incremental: 7 dias
Retenção Arquivo:   30 dias
```

> **NOTA:** Valores de retenção configuráveis via Dashboard Admin → Backup → Configurar.
> Retenção otimizada para Volume de 100GB.

---

## Resumo de Custos

| Componente | Custo Mensal |
|------------|--------------|
| Hetzner GEX44 | €184.00 |
| IPv4 Público | €0.50 |
| DuckDNS | $0 (gratuito) |
| GitHub Actions | $0 (gratuito) |
| **Total Infraestrutura** | **~€9.49/mês** |
| **Total com LLM** | **~$60-210/mês** |

---

## Resolução de Problemas

### Problemas de Conexão SSH

```bash
# Verificar se o alias está configurado (~/.ssh/config)
cat ~/.ssh/config | grep -A3 alice-hetzner

# Conectar usando alias (recomendado)
ssh alice-hetzner

# Ou conectar diretamente com a chave
ssh -i ~/.ssh/alice-deploy root@178.63.41.108

# Verificar conexão com verbose
ssh -v alice-hetzner

# Verificar permissões da chave (deve ser 600)
chmod 600 ~/.ssh/alice-deploy

# No Windows PowerShell, verificar config
Get-Content $env:USERPROFILE\.ssh\config
```

### Container não inicia

```bash
# Ver logs detalhados
docker logs alice-auth --tail 100

# Verificar recursos
htop
df -h

# Reiniciar container
docker compose restart alice-auth
```

### SSL não funciona

```bash
# Verificar Caddy
docker logs alice-caddy

# Verificar certificados (Caddy armazena em /data)
docker exec alice-caddy ls -la /data/caddy/certificates/acme-v02.api.letsencrypt.org-directory
```

### Firewall bloqueando

```bash
# Verificar regras
ufw status verbose

# Adicionar porta
ufw allow PORTA/tcp
```

### Observability não responde

```bash
# Verificar containers
docker ps | grep -E "(prometheus|grafana|jaeger|langfuse)"

# Ver logs
docker logs alice-prometheus --tail 50
docker logs alice-grafana --tail 50
docker logs alice-langfuse --tail 50

# Health check
curl http://localhost:3010/health
```

### Erro "manifest unknown" ao fazer pull de imagem

**Sintoma:**
```
Error response from daemon: manifest for <image>:<tag> not found: manifest unknown
```

**Causa:** Tag da imagem foi removida/rotacionada do Docker Hub. Isso é comum com imagens como MinIO, Caddy e Prometheus que fazem rotação agressiva de tags antigas.

**Solução:**
1. Verificar tags disponíveis no Docker Hub:
   ```bash
   # Usando skopeo (instalado em muitas distros)
   docker run --rm quay.io/skopeo/stable list-tags docker://docker.io/<imagem>
   
   # Ou via API Docker Hub
   curl -s "https://hub.docker.com/v2/repositories/<namespace>/<image>/tags?page_size=20" | jq '.results[].name'
   ```

2. Atualizar `docker-compose.prod.yml` com tag válida

3. Se tag `latest` existir, usar temporariamente e abrir issue para fixar versão

4. **IMPORTANTE:** O workflow de deploy agora valida TODAS as imagens externas ANTES de iniciar o deploy. Se uma tag está inválida, o deploy falha rapidamente (fail-fast) ao invés de falhar após 20+ minutos durante o pull.

**Prevenção (01/01/2026):**
- O step `Verificar imagens externas (Docker Hub)` no workflow valida 18 imagens externas
- Se qualquer imagem estiver com tag inválida, o deploy é abortado imediatamente
- Verifique `.github/component-versions.json` para tags atuais

---

### Deploy timeout após 45 minutos

**Causa:** Primeiro deploy pode demorar mais que o esperado devido a:
- Pull de ~50 containers (15-30min com conexão lenta ou rate limiting do Docker Hub)
- Inicialização do ClickHouse (até 6 minutos)
- Criação de site ERPNext (~300 tabelas, até 10 minutos)
- Execução de migrations SQL
- Inicialização de Langfuse v3 + MinIO

**Solução:**
1. Timeout atual já é 45 minutos (adequado para maioria dos casos)
2. `command_timeout` SSH é 40 minutos
3. Se necessário, fazer pull manual das imagens pesadas antes:
   ```bash
   ssh alice-hetzner
   cd /opt/alice/app/infra/docker
   docker compose pull minio clickhouse erpnext-backend langfuse
   ```

4. Se usando Docker Hub anônimo (rate limit de 100 pulls/6h):
   - Adicionar `DOCKERHUB_USERNAME` e `DOCKERHUB_TOKEN` nos secrets
   - Rate limit autenticado: 200 pulls/6h

---

### MinIO não inicia ou bucket não é criado

**Sintoma:** Langfuse reporta erros de S3 ou não consegue salvar eventos.

**Diagnóstico:**
```bash
# Verificar status do MinIO
docker logs alice-minio --tail 100

# Verificar se bucket foi criado (minio-init)
docker logs alice-minio-init --tail 50

# Verificar health
docker inspect alice-minio | jq '.[0].State.Health'
```

**Causas Comuns:**
1. **Secret `MINIO_ROOT_PASSWORD` não configurado** - Verificar em GitHub Secrets
2. **Diretório de dados não existe** - Verificado automaticamente pelo deploy
3. **Tag do `minio/mc` rotacionada** - Atualizar para tag válida

**Solução:**
1. Garantir que `MINIO_ROOT_PASSWORD` está nos secrets do GitHub
2. Verificar se diretório `/opt/alice/data/minio` existe no servidor
3. Verificar tag do MinIO Client em `docker-compose.prod.yml`

---

### ERPNext não instala (erro "No such option: --verbose")

**Problema:** Deploy falha com erro `Error: No such option: --verbose` durante instalação do ERPNext.

**Causa:** O comando `bench install-app` não aceita a flag `--verbose` (diferente de `bench new-site` que aceita).

**Solução:** A flag `--verbose` foi removida do comando `bench install-app` no `docker-compose.prod.yml` (corrigido em 25/12/2025).

**Verificação:**
```bash
# Verificar logs do container erpnext-create-site
docker logs erpnext-create-site --tail 100

# Verificar se site foi criado mas ERPNext não foi instalado
docker exec erpnext-create-site ls -la /home/frappe/frappe-bench/sites/
```

---

## Scripts Disponíveis

| Script | Descrição |
|--------|-----------|
| `infra/scripts/setup-hetzner.sh` | Configura Docker e dependências na VM |
| `infra/scripts/backup.sh` | Backup do banco de dados |
| `infra/scripts/restore.sh` | Restore do banco de dados |

---

## Arquivos de Configuração

| Arquivo | Descrição |
|---------|-----------|
| `.github/workflows/deploy-production.yml` | Pipeline CI/CD completo |
| `infra/docker/docker-compose.prod.yml` | Stack Docker para produção |
| `infra/docker/.env.prod.example` | Exemplo de variáveis de ambiente |
| `apps/observability-service/docker-compose.yml` | Stack de observabilidade |
| `apps/observability-service/.env.example` | Variáveis da observabilidade |

---

---

## Docker Compose v2+ Health Checks (01/01/2026)

### Formato Correto para Health Checks

Docker Compose v2.40+ **requer** que o array `test:` comece com "CMD" ou "CMD-SHELL":

```yaml
# CORRETO - Docker Compose v2+ (Alpine - "node" no PATH)
healthcheck:
  test: ["CMD", "node", "-e", "require('http').get(...)"]

# ERRADO - causa erro "healthcheck.test must start with CMD"
healthcheck:
  test: ["node", "-e", "require('http').get(...)"]
```

### Serviços Node.js Alpine (sem curl/wget por padrão)

Os 7 serviços Node.js usam imagens `node:22-alpine3.21` (CVE-2023-45853 fix). Health checks usam Node.js diretamente via `node` no PATH:

| Serviço | Endpoint | Verifica |
|---------|----------|----------|
| alice-auth | `/ready` | PostgreSQL |
| alice-chat | `/ready` | PostgreSQL + LLM |
| alice-rag | `/ready` | PostgreSQL + embeddings |
| alice-training | `/ready` | PostgreSQL + embeddings |
| alice-integrations | `/ready` | PostgreSQL + ERPNext |
| alice-observability | `/ready` | Observability stack |

**Referência:** [Docker Compose Healthcheck Specification](https://docs.docker.com/compose/compose-file/05-services/#healthcheck)

---

---

## 🔐 Security Hardening (Enterprise - 10/12/2025)

### Status Completo

| Item | Status | Cobertura |
|------|--------|-----------|
| **no-new-privileges** | ✅ | 50/50 containers (100%) |
| **resource limits** | ✅ | 50/50 containers (100%) |
| **read_only: true** | ✅ | 25/50 containers (aplicável apenas onde não há escrita) |
| **SHA256 digests** | ✅ | 26/26 imagens externas (100%) |
| **healthchecks** | ✅ | 38/38 containers (3 init usam service_completed_successfully) |

### Compatibilidade do Stack de Observabilidade (pins atuais - 19/12/2025)

- Prometheus 3.8.1 + Grafana Alerting: Alertmanager removido em 01/01/2026, alertas via Grafana Alerting.
- Grafana 12.3.1: atualização maior; dashboards e datasources preservados.
- Loki/Promtail 3.6.3: versão alinhada; labels e pipeline existentes compatíveis.
- Jaeger 2.13.0: estável; OTLP habilitado por padrão. v1 EOL em 31/12/2025.
- OTel Collector 0.142.0: configurações atuais (receivers/exporters) compatíveis.

### Permissões Enterprise por Serviço (19/12/2025)

| Serviço | UID | Permissão | Diretório |
|---------|-----|-----------|-----------|
| Grafana | 472 | 755 | /opt/alice/data/grafana |
| Prometheus | 65534 | 755 | /opt/alice/data/prometheus |
| Loki | 10001 | 755 | /opt/alice/data/loki |
| PostgreSQL | 999 | 700 | /opt/alice/data/postgres |
| Langfuse DB | 70 | 755 | /opt/alice/data/langfuse-db |
| Redis | 999 | 755 | /opt/alice/data/redis-alice |
| Qdrant | root | 755 | /opt/alice/data/qdrant |
| Caddy Data | 1000 | 700 | /opt/alice/data/caddy |
| SearXNG | 977 | 755 | /opt/alice/data/searxng-config |

> **NOTA:** Workflow deploy-production.yml configura automaticamente todas essas permissões.
- Vector 0.43.1: sink Loki ativo; sem mudanças de breaking para docker_logs.

### Notas Importantes

- **ERPNext Workers (9 containers):** Têm `security_opt: no-new-privileges:true` e resource limits, mas **NÃO** têm `read_only: true` pois precisam escrever em volumes (`erpnext_sites`, `erpnext_logs`). Este é o comportamento correto e enterprise-grade.

- **ERPNext Init Containers (2 containers):** Têm `security_opt: no-new-privileges:true` e resource limits, mas **NÃO** têm `read_only: true` pois precisam escrever em volumes durante a inicialização. Este é o comportamento correto e enterprise-grade.

- **Containers com `read_only: true`:** Apenas containers que não precisam escrever em volumes têm `read_only: true` aplicado. Containers que precisam escrever (workers, init, databases) não têm `read_only: true`, mas têm todos os outros aspectos de security hardening aplicados.

- **Grafana Alerting SMTP (01/01/2026):** GMAIL_APP_PASSWORD passado via variável de ambiente `GF_SMTP_PASSWORD` no Grafana. Alertmanager foi removido.

- **CORS/WebSocket:** `CORS_ORIGINS` e `WEBSOCKET_ALLOWED_ORIGINS` são obrigatórios no `.env.prod` para o chat-service e agora são validados no workflow de deploy.

- **Vector:** porta 8686 exposta para métricas Prometheus; escreve estado em `/var/lib/vector` (sem `read_only: true`).

**Referência:** `docs/VERIFICACAO-COMPLETA-ENTERPRISE.md` - Seção "Security Hardening (Docker Compose)"

---

*Autor: Fillipe Guerra*
*Documento atualizado em: 02 de Janeiro de 2026*
*Versão: 7.13 - Critical Pipeline Fixes*
*Data: 02 de Janeiro de 2026*
*Tecnologias: Node.js (versão LTS automática via API + fallback .nvmrc), pnpm (versão automática via package.json), TypeScript 5.9.3, Alpine 3.21*
*Total de Containers: 50 (7 infra + 7 Alice + 15 ERPNext + 14 observability + 6 GPU + 1 backup)*
*Security Hardening: 100% completo - 50/50 containers com no-new-privileges, 50/50 com resource limits, 25/50 com read_only*
*Servidor: Ubuntu 24.04.3 LTS, Docker 29.1.3, Docker Compose v5.0.0*
*Storage: Volume Hetzner alice-data 100GB montado em /opt/alice*
*ARQUITETURA ENTERPRISE: Texto Qwen3-Embedding-8B (4096 dim → Qdrant) | Imagem OpenCLIP (1024 dim → pgvector) | LLM Mixtral 8x7B (vLLM)*
*Pipeline Enterprise (26/12/2025): Deploy Server (CPX32 - IP 46.224.46.93, 4 vCPU, 8GB RAM) separado + Production Server (GEX44 GPU - IP 178.63.41.108). Todos os 50 containers rodam no servidor único, incluindo GPU services gerenciados pelo GPU Manager Service.*

*Migração Traefik→Caddy (02/01/2026): Traefik, traefik-init e dockerproxy substituídos por Caddy. Vantagens: SSL automático com retry inteligente, HTTP/3 nativo (QUIC), footprint 40MB vs 100MB. Total: 7 infra (era 8).*
*Otimização CI (27/12/2025): Composite action `.github/actions/setup-node-pnpm` elimina duplicação de setup (14x → 1x). Economia de ~6-10min por run. Fix cache persistence: usa actions/cache/restore + actions/cache/save separados (best practice 2025).*
*GPU: RTX 4000 SFF Ada (20GB VRAM) - Mixtral 8x7B vLLM, FLUX.1 Schnell, ASR Canary-1B, Embeddings Qwen3+OpenCLIP*
*Redis Alice: 7.4.7-alpine - Cache distribuído (node-redis 5.x suporta Redis 7.x)*
*Redis ERPNext: 6.2.21-alpine - ERPNext v15 requer Redis 6.x (docs.frappe.io)*
*Retenção Padrão: Full 15d, Incremental 7d, Archive 30d*
