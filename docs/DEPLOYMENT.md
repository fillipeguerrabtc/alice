# Alice Enterprise Platform - Guia de Deploy

**Autor:** Fillipe Guerra  
**Data:** 12 de Dezembro de 2025

## Visão Geral da Arquitetura - 42 Containers em Produção

A plataforma Alice é composta por **42 containers** organizados em 6 categorias:

### Categoria 1: Infraestrutura Core (6 serviços)

| # | Serviço | Container | Descrição | Tecnologia |
|---|---------|-----------|-----------|------------|
| 1 | **Docker Socket Proxy** | `dockerproxy` | Proxy seguro para API Docker. Expõe apenas endpoints necessários para Traefik, sem acesso de escrita. | Tecnativa Docker Socket Proxy |
| 2 | **Traefik Init** | `traefik-init` | Inicializador de certificados SSL. Configura permissões do diretório ACME para que Traefik rode como non-root. | BusyBox 1.37 |
| 3 | **API Gateway** | `traefik` | Gateway de API com SSL automático (Let's Encrypt), roteamento dinâmico, rate limiting e load balancing. | Traefik v3.6 |
| 4 | **PostgreSQL** | `postgres` | Banco de dados principal com extensão pgvector para busca semântica, RLS para multi-tenancy. | PostgreSQL 16 + pgvector |
| 5 | **Alice Redis** | `alice-redis` | Cache distribuído dedicado para serviços Alice (sessões, RBAC). Segregação enterprise do ERPNext. | Redis 7.4 Alpine |
| 6 | **SearXNG** | `alice-searxng` | Metabusca interna para Web Search (auto-hospedado, protegido por secret) | searxng/searxng |

### Categoria 2: Microsserviços Alice (8 serviços)

| # | Serviço | Container | Diretório | Descrição | Tecnologia |
|---|---------|-----------|-----------|-----------|------------|
| 7 | **Frontend** | `alice-frontend` | `apps/frontend-service` | Interface web responsiva com chat em tempo real, dashboard de métricas, painel de takeover/handover. | React 18, Vite 5, shadcn/ui, i18n PT-BR |
| 8 | **Auth Service** | `alice-auth` | `apps/auth-service` | Autenticação enterprise com OAuth 2.0, SAML 2.0, OIDC Provider, RBAC 6 níveis, sessões PostgreSQL. | Node.js, node-oidc-provider v9.5.2 |
| 9 | **Chat Service** | `alice-chat` | `apps/chat-service` | Chat em tempo real com streaming de tokens LLM via WebSocket, rate limiting, conversation orchestrator. | Node.js, WebSocket, Salad Cloud |
| 10 | **RAG Service** | `alice-rag` | `apps/rag-service` | Retrieval-Augmented Generation com embeddings 100% locais via CPU no Hetzner (multilingual-e5-base + CLIP ViT-L/14), busca semântica pgvector, processamento de documentos. | Node.js, pgvector, CLIP Service local (CPU no Hetzner) |
| 11 | **Training Service** | `alice-training` | `apps/training-service` | Fine-tuning e self-learning automático. Scheduler de aprendizado, integração Salad Cloud. | Node.js, Salad Cloud |
| 12 | **Integrations Service** | `alice-integrations` | `apps/integrations-service` | Integrações com serviços externos: Stripe (pagamentos EUR/SEPA), Wise (transferências), Twilio (WhatsApp), Resend (emails). | Node.js, Stripe SDK, Wise API |
| 13 | **Observability Service** | `alice-observability` | `apps/observability-service` | Stack de observabilidade: métricas Prometheus, dashboards Grafana, tracing Jaeger, backup orchestrator. | Node.js, Prometheus, Grafana, Jaeger |
| 14 | **Multimodal Inference** | `alice-clip-inference` | `apps/clip-inference-service` | Processamento multimodal 100% LOCAL (CPU Hetzner): embeddings de texto (multilingual-e5-base, 768 dim), embeddings de imagem (CLIP ViT-L/14, 768 dim), transcrição de áudio (faster-whisper medium). | Python, PyTorch 2.9.1, FastAPI |

> **NOTA:** O Traefik (`alice-traefik`) já atua como API Gateway em produção com roteamento dinâmico, rate limiting e circuit breakers via middlewares. O `apps/api-gateway` Node.js existe apenas para desenvolvimento local.

### Categoria 3: ERPNext Stack (12 serviços)

| # | Serviço | Container | Descrição | Tecnologia |
|---|---------|-----------|-----------|------------|
| 15 | **MariaDB** | `erpnext-mariadb` | Banco de dados do ERPNext com replicação GTID, binlog para backup incremental. | MariaDB 10.11.15 |
| 16 | **Redis Cache** | `erpnext-redis-cache` | Cache de sessões e dados frequentes do ERPNext. | Redis 7 |
| 17 | **Redis Queue** | `erpnext-redis-queue` | Fila de jobs assíncronos do ERPNext (background jobs). | Redis 7 |
| 18 | **Configurator** | `erpnext-configurator` | Configurador inicial do Frappe Bench. Roda uma vez no primeiro deploy. | Frappe Bench |
| 19 | **Create Site** | `erpnext-create-site` | Criador do site ERPNext. Inicializa banco de dados e estrutura. | Frappe Bench |
| 20 | **Backend** | `erpnext-backend` | Backend Python do Frappe/ERPNext. APIs REST e lógica de negócio. | Python, Frappe v15 |
| 21 | **Frontend** | `erpnext-frontend` | Frontend NGINX do ERPNext. Serve arquivos estáticos e proxy reverso. | NGINX |
| 22 | **WebSocket** | `erpnext-websocket` | Socket.io para atualizações em tempo real no ERPNext. | Node.js, Socket.io |
| 23 | **Scheduler** | `erpnext-scheduler` | Agendador de tarefas periódicas (cron jobs do ERPNext). | Python, Frappe |
| 24 | **Worker Short** | `erpnext-worker-short` | Worker para jobs rápidos (< 5 segundos). | Python, Frappe |
| 25 | **Worker Default** | `erpnext-worker-default` | Worker para jobs normais (5-60 segundos). | Python, Frappe |
| 26 | **Worker Long** | `erpnext-worker-long` | Worker para jobs longos (> 60 segundos). | Python, Frappe |

### Categoria 4: Backup e Logs (2 serviços)

| # | Serviço | Container | Descrição | Tecnologia |
|---|---------|-----------|-----------|------------|
| 27 | **pgBackRest** | `pgbackrest` | Backup enterprise do PostgreSQL: full, incremental, PITR (Point-in-Time Recovery), WAL archiving. | pgBackRest (versão automática via GitHub API) |
| 28 | **Vector** | `vector` | Agregador de logs. Coleta logs de todos os containers e encaminha para observability stack. | Vector (Datadog) |

### Diagrama de Arquitetura

```
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
│  │  4. SSH para Hetzner VM                                            │  │
│  │  5. Deploy Docker Compose                                          │  │
│  │  6. Health Checks                                                  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ⚠️  DEPLOY 100% AUTOMÁTICO - NENHUM COMANDO MANUAL EM PRODUÇÃO         │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│               PRODUÇÃO (Hetzner Cloud - CX43) - 41 CONTAINERS           │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │             CX43 (8 vCPUs, 16GB RAM, 160GB SSD)                    │ │
│  │                                                                     │ │
│  │  ┌──────────────────────────────────────────────────────────────┐  │ │
│  │  │ INFRAESTRUTURA CORE (5)                                       │  │ │
│  │  │  dockerproxy → traefik-init → traefik → postgres → redis     │  │ │
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
│  │  │ ERPNEXT STACK (12)                                            │  │ │
│  │  │  mariadb │ redis-cache │ redis-queue │ configurator           │  │ │
│  │  │  create-site │ backend │ frontend │ websocket                 │  │ │
│  │  │  scheduler │ worker-short │ worker-default │ worker-long      │  │ │
│  │  └──────────────────────────────────────────────────────────────┘  │ │
│  │                              │                                      │ │
│  │  ┌──────────────────────────┴───────────────────────────────────┐  │ │
│  │  │ BACKUP/LOGS (2)                                               │  │ │
│  │  │  pgbackrest (PostgreSQL PITR) │ vector (Log Aggregator)       │  │ │
│  │  └──────────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ Recursos Hetzner CX43:                                             │ │
│  │  • vCPUs: 8 (AMD EPYC)      • RAM: 16GB                           │ │
│  │  • SSD: 160GB NVMe          • Tráfego: 20TB/mês                   │ │
│  │  • IPv4 + IPv6              • Custo: €9.49/mês                    │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Recursos Utilizados

### Hetzner Cloud (Produção)

| Recurso | Especificação | Custo |
|---------|---------------|-------|
| CX43 (Cost-Optimized) | 8 vCPU, 16GB RAM, 160GB SSD | €8.99/mês |
| IPv4 Público | Endereço dedicado | €0.50/mês |
| **Volume alice-data** | 100GB EXT4 (dados + uploads + backups) | €4.40/mês |
| Snapshots | Backup automático | €0.012/GB/mês |
| **Total Base** | | **€13.89/mês** |

### Volume Hetzner (alice-data)

Volume persistente de 100GB montado em `/mnt/alice-data` com symlink `/opt/alice`:

| Diretório | Propósito | Uso Estimado |
|-----------|-----------|--------------|
| `/opt/alice/data/postgresql` | Dados PostgreSQL + pgvector | ~20-50GB |
| `/opt/alice/data/mariadb` | Dados MariaDB (ERPNext) | ~5-20GB |
| `/opt/alice/data/redis` | Persistência Redis | ~1GB |
| `/opt/alice/uploads` | Uploads RAG (imagens, áudios, vídeos, docs) | ~10-30GB |
| `/opt/alice/backups` | Backups locais (pgBackRest, MariaDB, Redis) | ~20-40GB |

> **NOTA:** Volume expansível até 10TB a qualquer momento via Console Hetzner.

### GitHub (Gratuito)

| Recurso | Free Tier | Nosso Uso |
|---------|-----------|-----------|
| Actions (Público) | Ilimitado | Todo CI/CD |
| Actions (Privado) | 2000 min/mês | ~500 min |
| Container Registry | 500MB | Imagens Docker |

### SaladCloud (Pago - GPUs para LLM)

| Recurso | Custo |
|---------|-------|
| Horas GPU | $0.10-0.30/hora |
| Llama 4 Maverick | Sob demanda |
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
   - **Type:** Cost-Optimized → **CX43**
   - **SSH Key:** Adicione sua chave pública
   - **IPv4:** Habilitado
   - **Name:** `alice-prod`
5. Clique **Create & Buy now**
6. Anote o IP público (ex: `46.224.46.93`)

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
HETZNER_VM_HOST=46.224.46.93
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

# ========== SALAD CLOUD (LLM) ==========
SALAD_API_KEY=sua-api-key
SALAD_ORGANIZATION_ID=org_xxxxx

# ========== TWILIO (WHATSAPP) ==========
TWILIO_ACCOUNT_SID=ACxxxxx
TWILIO_AUTH_TOKEN=xxxxx
TWILIO_WHATSAPP_NUMBER=+14155238886

# ========== RESEND (EMAIL) ==========
RESEND_API_KEY=re_xxxxx

# ========== DOMÍNIO E SSL ==========
ACME_EMAIL=seu-email@exemplo.com

# ========== OBSERVABILITY (Langfuse + Grafana) ==========
LANGFUSE_SECRET_KEY=sk-lf-xxxxx
LANGFUSE_NEXT_AUTH_SECRET=sua-chave-segura-32-chars
ADMIN_USER=seu-email-admin
ADMIN_PWD=sua-senha-forte
GRAFANA_ADMIN_USER=${ADMIN_USER}
GRAFANA_ADMIN_PASSWORD=${ADMIN_PWD}
```

**⚠️ IMPORTANTE:** O GitHub NÃO permite secrets começando com `GITHUB_`. Use `OAUTH_GITHUB_` como prefixo.

### 5. Conexão SSH ao Servidor

**Configuração local recomendada** (`~/.ssh/config`):

```
Host alice-hetzner
    HostName 46.224.46.93
    User root
    IdentityFile ~/.ssh/alice-deploy
```

**Conexão rápida:**

```bash
# Usando alias (recomendado)
ssh alice-hetzner

# Ou diretamente com a chave
ssh -i ~/.ssh/alice-deploy root@46.224.46.93
```

**Especificações do Servidor (verificado em 03/12/2025):**

| Recurso | Valor |
|---------|-------|
| **SO** | Ubuntu 24.04.3 LTS (Noble Numbat) |
| **Docker** | 29.1.2 |
| **Docker Compose** | v5.0.0 |
| **CPU** | 8 vCPUs (AMD EPYC) |
| **RAM** | 16GB |
| **Disco** | 160GB NVMe SSD |
| **IP** | 46.224.46.93 |
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

# Verificar se volume Hetzner está montado
df -h | grep alice-data

# Se não estiver montado, verificar /mnt/HC_Volume_*
ls -la /mnt/

# Criar symlink se necessário (volume já deve estar montado pela Hetzner)
# ln -sf /mnt/HC_Volume_XXXXXX /mnt/alice-data
# ln -sf /mnt/alice-data /opt/alice

# Verificar estrutura de diretórios (criada automaticamente pelo deploy)
ls -la /opt/alice/
```

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

### Pipeline Automatizado

```
┌─────────────────────────────────────────────────────────────────┐
│                     FLUXO CI/CD ALICE                            │
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
│  │ • Build Docker imgs │                                        │
│  │ • Push para GHCR    │                                        │
│  │ • Cria GitHub Rel.  │                                        │
│  └─────────────────────┘                                        │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────────────┐                                        │
│  │ Deploy Production   │ ← 100% AUTO (sem aprovação)            │
│  │ • SSH para Hetzner  │                                        │
│  │ • Docker Compose up │                                        │
│  │ • Health checks     │                                        │
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
| **Deploy Production** | Release passa | 100% automático (sem aprovação) |

Pipeline totalmente automático: push para `main` vai direto para produção.

### Versionamento Automático

O Release é disparado automaticamente quando o CI passa, com versão incremental:
- `v1.0.5` → `v1.0.6` → `v1.0.7` ...

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

### Migrations do Banco de Dados

O workflow de deploy executa automaticamente todas as migrations na ordem correta:

1. **0001_rls_security_enterprise.sql**: Configura RLS (Row Level Security), funções de tenant, índices e grants
2. **0002_create_feature_flags.sql**: Cria tabela de feature flags enterprise
3. **0003_update_embedding_dimensions_768.sql**: Atualiza dimensões de embeddings para 768 (multilingual-e5-base + CLIP) - **CRÍTICA**

**⚠️ IMPORTANTE:** A migration 0003 é **OBRIGATÓRIA** e deve ser executada antes do deploy do código que usa `vector(768)`. O workflow de deploy executa todas as migrations automaticamente na ordem correta antes de iniciar os serviços.
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
- ✅ Compartilhado entre `release.yml` (tags) e `deploy-production.yml` (main)
- ✅ Sem limite de 10GB do GitHub Actions cache
- ✅ Reprodutibilidade: releases usam a tag exata

**Performance Esperada:**
| Cenário | Sem Cache | Com Cache |
|---------|-----------|-----------|
| Rebuild completo | ~45 min | ~45 min |
| Mudança em 1 serviço | ~45 min | ~7 min |
| Nenhuma mudança | ~45 min | ~3 min |

### Cache de Dependências no CI

O CI utiliza cache nativo do GitHub Actions para dependências:

| Componente | Estratégia | Economia |
|------------|------------|----------|
| **pnpm (Node.js)** | `actions/setup-node` com `cache: 'pnpm'` | ~2 min/job |
| **pip (Python/PyTorch)** | `actions/setup-python` com `cache: 'pip'` | ~900MB/build |
| **Artifacts** | `packages/*/dist` compartilhado entre jobs | Build incremental |

**⚠️ REGRA CRÍTICA:** NUNCA limpar caches do GitHub Actions nos workflows:
- ❌ `rm -rf ~/.cache/pip` - Quebra cache do pip
- ❌ `rm -rf ~/.pnpm-store` - Quebra cache do pnpm
- ❌ `--no-cache-dir` no pip - Desabilita cache
- ✅ Usar `cache: 'pnpm'` e `cache: 'pip'` nativos

---

## URLs de Produção

### Aplicação Principal

| Serviço | URL |
|---------|-----|
| Alice Frontend | https://yesyoudeserve.duckdns.org |
| Alice Chat | https://yesyoudeserve.duckdns.org/chat |
| Alice Dashboard | https://yesyoudeserve.duckdns.org/dashboard |
| Alice API | https://yesyoudeserve.duckdns.org/api |

### ERPNext

| Serviço | URL |
|---------|-----|
| ERPNext | https://erp.yesyoudeserve.duckdns.org |

### Observability Stack

| Serviço | URL | Descrição |
|---------|-----|-----------|
| Grafana | https://observability.yesyoudeserve.duckdns.org | Dashboards e alertas |
| Prometheus | https://prometheus.yesyoudeserve.duckdns.org | Métricas e consultas |
| Jaeger | https://tracing.yesyoudeserve.duckdns.org | Distributed tracing |
| Langfuse | https://llm-metrics.yesyoudeserve.duckdns.org | Métricas LLM |
| Health Check | https://yesyoudeserve.duckdns.org/observability/health | Status do stack |

### Infraestrutura

| Serviço | URL |
|---------|-----|
| Traefik Dashboard | https://traefik.yesyoudeserve.duckdns.org (protegido) |

---

## Rollback

### Automático
Rollback automático acontece se health checks falharem após deploy.

### Manual

```bash
# SSH para o servidor
ssh root@46.224.46.93

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

# Logs do Traefik (API Gateway)
docker logs -f traefik

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

```
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
| Hetzner CX43 | €8.99 |
| IPv4 Público | €0.50 |
| DuckDNS | $0 (gratuito) |
| GitHub Actions | $0 (gratuito) |
| **SaladCloud GPUs** | **Variável ($50-200)** |
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
ssh -i ~/.ssh/alice-deploy root@46.224.46.93

# Verificar conexão com verbose
ssh -v alice-hetzner

# Verificar permissões da chave (deve ser 600)
chmod 600 ~/.ssh/alice-deploy

# No Windows PowerShell, verificar config
Get-Content $env:USERPROFILE\.ssh\config
```

**Configuração SSH recomendada** (`~/.ssh/config`):
```
Host alice-hetzner
    HostName 46.224.46.93
    User root
    IdentityFile ~/.ssh/alice-deploy
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
# Verificar Traefik
docker logs traefik

# Verificar certificados
docker exec traefik cat /letsencrypt/acme.json | jq '.le.Certificates'
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

## Docker Compose v2+ Health Checks (04/12/2025)

### Formato Correto para Health Checks

Docker Compose v2.40+ **requer** que o array `test:` comece com "CMD" ou "CMD-SHELL":

```yaml
# CORRETO - Docker Compose v2+
healthcheck:
  test: ["CMD", "/nodejs/bin/node", "-e", "require('http').get(...)"]

# ERRADO - causa erro "healthcheck.test must start with CMD"
healthcheck:
  test: ["/nodejs/bin/node", "-e", "require('http').get(...)"]
```

### Serviços Distroless (sem curl/wget)

Os 6 serviços Node.js usam imagens Google Distroless que **não** incluem curl ou wget. Health checks usam Node.js diretamente:

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
| **no-new-privileges** | ✅ | 41/41 containers (100%) |
| **resource limits** | ✅ | 41/41 containers (100%) |
| **read_only: true** | ✅ | 23/41 containers (aplicável apenas onde não há escrita) |
| **SHA256 digests** | ✅ | 26/26 imagens externas (100%) |
| **healthchecks** | ✅ | 38/38 containers (3 init usam service_completed_successfully) |

### Compatibilidade do Stack de Observabilidade (pins atuais)
- Prometheus 3.0.1 + Alertmanager 0.27.0: sem breaking conhecido para scrape/alert rules existentes; manter atenção em mudanças de métricas deprecated (consultar release notes v3.0/v0.27).
- Grafana 11.1.4: atualização menor; dashboards e datasources preservados.
- Loki/Promtail 3.1.0: versão alinhada; labels e pipeline existentes compatíveis.
- Jaeger 1.58: estável; OTLP habilitado.
- OTel Collector 0.114.0: configurações atuais (receivers/exporters) compatíveis; revisar changelog se adicionar novos pipelines.
- Vector 0.43.1: sink Loki ativo; sem mudanças de breaking para docker_logs.

### Notas Importantes

- **ERPNext Workers (9 containers):** Têm `security_opt: no-new-privileges:true` e resource limits, mas **NÃO** têm `read_only: true` pois precisam escrever em volumes (`erpnext_sites`, `erpnext_logs`). Este é o comportamento correto e enterprise-grade.

- **ERPNext Init Containers (2 containers):** Têm `security_opt: no-new-privileges:true` e resource limits, mas **NÃO** têm `read_only: true` pois precisam escrever em volumes durante a inicialização. Este é o comportamento correto e enterprise-grade.

- **Containers com `read_only: true`:** Apenas containers que não precisam escrever em volumes têm `read_only: true` aplicado. Containers que precisam escrever (workers, init, databases) não têm `read_only: true`, mas têm todos os outros aspectos de security hardening aplicados.

- **Alertmanager SMTP:** senha carregada via arquivo `/opt/alice/secrets/alertmanager/smtp_password` montado em `/run/secrets`; não colocar senha inline em variáveis de ambiente.

- **Vector:** porta 8686 exposta para métricas Prometheus; escreve estado em `/var/lib/vector` (sem `read_only: true`).

**Referência:** `docs/VERIFICACAO-COMPLETA-ENTERPRISE.md` - Seção "Security Hardening (Docker Compose)"

---

*Autor: Fillipe Guerra*
*Documento atualizado em: 12 de Dezembro de 2025*
*Versão: 6.5 - Processamento Multimodal 100% LOCAL + 18 Regras*
*Tecnologias: Node.js (versão LTS automática via API + fallback .nvmrc), pnpm (versão automática via package.json), TypeScript 5.9.3, Google Distroless*
*Total de Containers: 42 (6 infraestrutura + 8 Alice + 15 ERPNext + 12 observability + 1 backup)*
*Security Hardening: 100% completo - 41/41 containers com no-new-privileges, 41/41 com resource limits, 23/41 com read_only (12/12/2025)*
*Servidor: Ubuntu 24.04.3 LTS, Docker 29.1.2, Docker Compose v5.0.0*
*Storage: Volume Hetzner alice-data 100GB montado em /opt/alice*
*Processamento Multimodal: 100% LOCAL via CPU Hetzner - embeddings (texto + imagem) + transcrição de áudio*
*Redis Alice: Cache distribuído dedicado (segregação enterprise do ERPNext)*
*Retenção Padrão: Full 15d, Incremental 7d, Archive 30d*
