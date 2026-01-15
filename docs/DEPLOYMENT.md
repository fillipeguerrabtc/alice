# Alice Enterprise Platform - Guia de Deploy

**Autor:** Fillipe Guerra  
**Data:** 15 de Janeiro de 2026  
**Versão:** 9.3 - Alinhamento SSOT + Observability + Docs

> **Consolidação de Documentação (15/01/2026):** O conteúdo antes separado em `docs/PRODUCTION_SETUP.md` foi consolidado neste guia (SSOT) para evitar fragmentação.

> **🚀 ATUALIZAÇÃO ENTERPRISE v3.0.0 (06/01/2026) - Pipeline CI/CD:**  
> Pipeline CI/CD enterprise completo com deploy modular em 5 stacks independentes.
> 
> **Release Consolidado (`release.yml`):**
> - ✅ Build de 17 imagens Docker (12 microservices + 5 GPU)
> - ✅ Retag Inteligente: Diff analysis (só builda o que mudou)
> - ✅ Cache GHCR: Por imagem (máxima eficiência BuildKit)
> - ✅ Smoke Test: PostgreSQL + pgvector (detecta SIGILL/AVX-512)
> - ✅ Jobs: `create-release` → `build-images` → `trigger-deploy`
> - ✅ Dispara automaticamente `deploy-stack-modular.yml` após sucesso
> 
> **Deploy Modular v3 (`deploy-stack-modular.yml`):**
> - ✅ 5 stacks independentes (INFRA, ALICE, OBSERVABILITY, ERPNEXT, BACKUP)
> - ✅ Paralelização: INFRA → (ALICE + OBSERVABILITY + ERPNEXT + BACKUP em paralelo)
> - ✅ Rollback Cirúrgico: Só reverte stack com falha
> - ✅ Produção Parcial: ERPNext falha → Alice continua operacional
> - ✅ Isolamento: Docker Compose projects (`-p alice-{stack}`)
> - ✅ External Networks/Volumes: Dados compartilhados preservados
> - ✅ Health Checks Completos: 50 containers verificados (retry 30-45x)
> 
> **Performance:**
> - Release: Build 17 imagens ~5-10min (retag inteligente otimiza)
> - Deploy: 5 stacks em paralelo = **~10min** ⚡
> 
> **Workflows Ativos:**
> - `.github/workflows/release.yml` ⭐ (Release & Tag - dispara builds e deploy)
> - `.github/workflows/deploy-stack-modular.yml` (Deploy - Production Modular)
> 
> **Documentação Completa:** Ver `CLAUDE.md` seção "Release Enterprise Consolidado"

> **ATUALIZAÇÃO MAJOR 05/01/2026:** Arquitetura refatorada para **5 stacks independentes** com deploy/rollback modular. Cada stack pode ser deployado, rolledback e monitorado separadamente. ERPNext pode falhar sem afetar Alice. Produção parcial agora é possível.

> **🛡️ CORREÇÃO CRÍTICA 09/01/2026 - PostgreSQL Permissions Enterprise:**
> Implementada correção completa de **3 FASES** para resolver "container alice-postgres is unhealthy" em servidor limpo:
>
> **FASE 1: Preparação Inline (deploy-stack-modular.yml)**
> - Diretório PostgreSQL criado ANTES do `docker compose up`
> - Teste de escrita REAL via Docker (`docker run --user 70:70 -v ... touch`)
> - Validação de ownership (70:70 Alpine) e mode (700)
> - Elimina race condition entre jobs `prepare` e `deploy-infra`
> 
> **FASE 2: Entrypoint Wrapper (infra/postgres/entrypoint-wrapper.sh)**
> - Script fail-fast no container PostgreSQL
> - Valida PGDATA configurado, existência e gravabilidade do diretório
> - Executa teste de escrita real antes do startup
> - Mensagens de erro claras com diagnóstico automático e comandos de correção
> 
> **FASE 3: Arquitetura Resiliente (job prepare-infrastructure)**
> - Job dedicado que executa ANTES de `deploy-infra`
> - Validação completa do servidor (IP, GPU, Docker, disco mínimo 20GB)
> - Criação atômica de diretórios via `fix-production-permissions.sh`
> 
> **Healthcheck Melhorado (docker-compose.infra.yml)**
> - Estágio 0: `pgrep -x postgres` detecta crash imediato por Permission denied
> - Executa ANTES de pg_isready para fail-fast mais rápido
> - start_period aumentado para 300s, retries para 30

> **Migração 100% Self-Hosted (27/12/2025):** Pipeline completo migrado para runner próprio (Hetzner CPX32 - 4 vCPU, 8GB RAM) seguindo melhores práticas enterprise 2025. Todos os workflows (CI, Release, Deploy) executam no self-hosted runner para controle total, custos previsíveis e compliance.

> **Semantic Versioning Automático (27/12/2025):** Versionamento agora segue Conventional Commits automaticamente: `feat!:` ou `BREAKING CHANGE:` → MAJOR bump, `feat:` → MINOR bump, `fix:` → PATCH bump. Cache Docker otimizado com `--provenance=false`, `--sbom=false` e `BUILDKIT_INLINE_CACHE=1` para builds mais rápidos.

## Arquitetura Multi-Stack (05/01/2026)

A plataforma foi refatorada em **5 stacks independentes** para permitir:
- ✅ **Produção Parcial**: Alice funciona mesmo se ERPNext falhar
- ✅ **Rollback Cirúrgico**: Reverter apenas o stack com problema
- ✅ **Deploy Independente**: Atualizar Observability sem downtime de Alice
- ✅ **Isolamento de Falhas**: Problema em um stack não propaga para outros

### Stacks Disponíveis

| Stack | Containers | Descrição | Arquivo Docker Compose |
|-------|------------|-----------|------------------------|
| **INFRA** | 11 | PostgreSQL, PgBouncer, Redis, Qdrant, Caddy, MinIO, SearXNG, Tor | `stacks/docker-compose.infra.yml` |
| **ALICE** | 8 + 5 GPU | Microsserviços core + GPU Manager + GPU containers | `stacks/docker-compose.alice.yml` |
| **OBSERVABILITY** | 13 | Prometheus, Grafana, Loki, Jaeger, Langfuse, ClickHouse | `stacks/docker-compose.observability.yml` |
| **ERPNEXT** | 15 | MariaDB, Redis Cache/Queue, Backend, Workers | `stacks/docker-compose.erpnext.yml` |
| **BACKUP** | 1 | pgBackRest enterprise | `stacks/docker-compose.backup.yml` |

### Deploy Modular via GitHub Actions

**Workflow:** `.github/workflows/deploy-stack-modular.yml` (v3.0.0)  
**Nome no GitHub Actions:** **Deploy - Production (Modular)**

#### Deploy Automático (100% pipeline)

- **Gatilho**: **Workflow "Release & Tag" termina com sucesso** (`workflow_run: completed`)
- **Fonte de verdade**: **TAG** da release (`vX.Y.Z`) extraída do commit SHA do Release workflow
- **Comportamento**: deploy automático do stack `all` (sequência: infra → drizzle → alice → observability → erpnext → backup)
- **Observação**: Deploy só acontece DEPOIS que Release terminar completamente (build de imagens + publicação da Release). Evita deploy aparecer "junto" com CI na UI do GitHub.

```bash
# Deploy de um stack específico
gh workflow run deploy-stack-modular.yml -f stack=alice -f version=v1.0.0

# Deploy de todos os stacks (paralelo automático v3)
gh workflow run deploy-stack-modular.yml -f stack=all -f version=v1.0.0

# Dry run (validação sem deploy)
gh workflow run deploy-stack-modular.yml -f stack=observability -f version=v1.0.0 -f dry_run=true

# Rollback manual de um stack específico
gh workflow run deploy-stack-modular.yml -f stack=erpnext -f version=v1.0.0 -f rollback=true -f rollback_version=v0.9.0

# SMART DEPLOY - Deploy inteligente que pula stacks healthy
gh workflow run deploy-stack-modular.yml -f stack=all -f version=v1.0.0 -f smart_deploy=true
```

### Smart Deploy (v3.1 - 09/01/2026)

O **Smart Deploy** é uma funcionalidade enterprise que detecta automaticamente o estado dos stacks no servidor de produção e pula os que já estão healthy:

| Cenário | Comportamento |
|---------|---------------|
| `smart_deploy=false` | Deploy tradicional (todos os stacks selecionados) |
| `smart_deploy=true` + `stack=all` | Verifica servidor, pula stacks healthy |
| `smart_deploy=true` + `stack=X` | Força deploy do stack X mesmo se healthy |

**Benefícios:**
- ✅ **Economia de tempo**: Não re-deploya stacks funcionais
- ✅ **Preservação de dados**: Stacks healthy mantidos intactos
- ✅ **Deploy cirúrgico**: Apenas stacks problemáticos são atualizados
- ✅ **Produção parcial real**: INFRA healthy → Deploy apenas ALICE/OBSERVABILITY/ERPNEXT

**Funcionamento interno:**
1. Step `server-health` conecta via SSH ao servidor de produção
2. Verifica estado de cada container (healthy, unhealthy, missing)
3. Retorna status por stack: `healthy`, `unhealthy`, ou `missing`
4. Step `stacks` decide quais stacks deployar baseado no status

**Exemplo prático:**
```bash
# Servidor tem INFRA e BACKUP healthy, resto missing
# Smart Deploy vai:
# - PULAR INFRA (healthy)
# - PULAR BACKUP (healthy)
# - DEPLOYAR ALICE (missing)
# - DEPLOYAR OBSERVABILITY (missing)
# - DEPLOYAR ERPNEXT (missing)
```

### Ordem de Deploy (v3 - Paralelo)

**Deploy Modular v3 automatiza a ordem correta com paralelização:**

```
prepare (copia arquivos)
   ↓
deploy-infra + health-infra (PostgreSQL, PgBouncer, Redis, Qdrant, Caddy, MinIO, SearXNG, Tor)
   ↓
drizzle-push (migrações schema PostgreSQL)
   ↓
   ├────────┬────────────┬──────────────┐
   │        │            │              │
deploy-alice  deploy-observability  deploy-erpnext  deploy-backup
health-alice  health-observability  health-erpnext  health-backup
rollback*     rollback*              rollback*       rollback*

* Rollback automático só dispara se health check FALHAR
```

**Características v3:**
- ✅ **INFRA**: Sempre primeiro (obrigatório)
- ✅ **Drizzle**: Após INFRA healthy (migrations)
- ✅ **4 Stacks em PARALELO**: Alice + Observability + ERPNext + Backup
- ✅ **Isolamento**: Falha de um não afeta outros

### Histórico de Versões por Stack

Cada stack mantém seu histórico de versões em:
- `/opt/alice/versions/{stack}.current` - Versão atual
- `/opt/alice/versions/{stack}.previous` - Versão anterior (para rollback)

Exemplo:
```bash
# Verificar versão atual de cada stack
cat /opt/alice/versions/infra.current       # v1.0.0
cat /opt/alice/versions/alice.current       # v1.0.0
cat /opt/alice/versions/observability.current # v1.0.0
cat /opt/alice/versions/erpnext.current     # v0.9.5 (versão diferente)
```

---

## 🚀 Primeiro Deploy - Checklist Completo

> **⚠️ IMPORTANTE:** Esta seção é CRÍTICA para primeiro deploy em servidor limpo.
> O servidor Hetzner GEX44 (178.63.41.108) deve estar preparado antes do deploy.

### Pré-Requisitos do Servidor

Antes de executar o primeiro deploy, valide:

| Item | Validação | Como Verificar |
|------|-----------|----------------|
| **IP Correto** | 178.63.41.108 | `hostname -I \| grep -w 178.63.41.108` |
| **GPU Disponível** | NVIDIA RTX 4000 Ada | `nvidia-smi` |
| **Docker** | 29.1.3+ | `docker --version` |
| **Docker Compose** | 5.0.0+ | `docker compose version` |
| **NVIDIA Container Toolkit** | Instalado | `docker run --rm --gpus all nvidia/cuda:12.0.0-base-ubuntu22.04 nvidia-smi` |
| **Disco Disponível** | Mínimo 200GB livre | `df -h /opt/alice` |
| **Memória RAM** | 64GB | `free -h` |

### Preparação Automática do Servidor

O workflow `deploy-stack-modular.yml` inclui preparação automática via script idempotente.

**Script:** `infra/scripts/prepare-production-server.sh`

**O que o script faz:**
1. ✅ Valida servidor correto (178.63.41.108)
2. ✅ Valida GPU disponível
3. ✅ Cria estrutura /opt/alice (30+ diretórios)
4. ✅ Configura permissões por serviço (13 UIDs diferentes)
5. ✅ Cria networks Docker externas (alice-network, erpnext-network)
6. ✅ Valida permissões PostgreSQL (fail-fast)

**Execução manual (opcional):**
```bash
# SSH no servidor de produção
ssh root@178.63.41.108

# Executar script de preparação
sudo /opt/alice/app/infra/scripts/prepare-production-server.sh
```

**⚠️ NOTA:** O workflow executa este script automaticamente no job `prepare`.
Execução manual é opcional para validar antes do deploy.

### Transferência de Scripts via Tarball (09/01/2026)

O workflow utiliza transferência atômica via tarball para garantir que todos os scripts SSOT estejam presentes no servidor antes da execução.

**Problema Resolvido:**
- Scripts SSOT (`permissions-config.sh`, `fix-production-permissions.sh`) não eram transferidos
- Tentativa de baixar via curl falhava (tag não existe durante deploy)
- `prepare-production-server.sh` falhava: "fix-production-permissions.sh não encontrado"

**Fluxo de Transferência:**

```
┌─────────────────────────────────────┐     ┌─────────────────────────────────────┐
│  GitHub Runner (Local)              │     │  Servidor Produção (Hetzner)        │
│  ┌────────────────────────────────┐ │     │  ┌─────────────────────────────────┐│
│  │ 1. Validar scripts existem    │ │     │  │                                 ││
│  │ 2. tar czf alice-scripts.tar.gz│ │     │  │                                 ││
│  │ 3. SCP → /tmp/                │─┼─SCP─┼─▶│ 4. tar xzf → /tmp/scripts/     ││
│  └────────────────────────────────┘ │     │  │ 5. chmod +x scripts/*.sh       ││
│                                     │     │  │ 6. Validar scripts presentes   ││
│                                     │     │  │ 7. sudo bash prepare-prod...   ││
│                                     │     │  └─────────────────────────────────┘│
└─────────────────────────────────────┘     └─────────────────────────────────────┘
```

**Scripts Transferidos:**
| Script | Descrição |
|--------|-----------|
| `permissions-config.sh` | SSOT - Define UIDs/GIDs/permissões |
| `fix-production-permissions.sh` | Cria/valida/corrige permissões |
| `prepare-production-server.sh` | Orquestra preparação do servidor |

**Benefícios:**
- ✅ **Atômico**: Transferência tudo-ou-nada (sem estado parcial)
- ✅ **Independente**: Usa arquivos do checkout local, não depende de tag GitHub
- ✅ **Comprimido**: Gzip reduz tempo de transferência
- ✅ **Validação Dupla**: Valida antes de empacotar E antes de executar

**REF:** CLAUDE.md Regra 6 (Enterprise-grade), Regra 9 (Validação contínua)

### Checklist do Primeiro Deploy

- [ ] **1. Secrets Configurados no GitHub**
  - [ ] 54 secrets configurados em `Settings → Secrets and variables → Actions`
  - [ ] Ver lista completa em `docs/SECRETS.md`
  - [ ] Validar secrets obrigatórios: `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `ADMIN_USER`, `ADMIN_PWD`

- [ ] **2. SSH Key Configurada**
  - [ ] `HETZNER_SSH_PRIVATE_KEY` configurado no GitHub Secrets
  - [ ] Key permite acesso root@178.63.41.108
  - [ ] Testar manualmente: `ssh -i ~/.ssh/alice-deploy root@178.63.41.108`

- [ ] **3. GHCR Login Funcionando**
  - [ ] PAT (Personal Access Token) com permissões `read:packages`, `write:packages`
  - [ ] Token configurado em `GITHUB_TOKEN` (automático) ou `GH_TOKEN` (manual)

- [ ] **4. Servidor Preparado**
  - [ ] Script `prepare-production-server.sh` executado (manual ou automático)
  - [ ] Networks Docker criadas: `alice-network`, `erpnext-network`
  - [ ] Estrutura /opt/alice criada com permissões corretas

- [ ] **5. Release Criada**
  - [ ] Workflow `release.yml` executado com sucesso
  - [ ] Imagens Docker buildadas e pushadas para GHCR
  - [ ] Tag criada (ex: v1.0.0)

- [ ] **6. Deploy Executado**
  - [ ] Workflow `deploy-stack-modular.yml` disparado automaticamente ou manualmente
  - [ ] Stack `all` deployado: infra → alice → observability → erpnext → backup
  - [ ] Health checks passaram para todos os 50 containers

- [ ] **7. Validação Pós-Deploy**
  - [ ] Grafana acessível: https://observability.yesyoudeserve.duckdns.org
  - [ ] Alice Frontend acessível: https://yesyoudeserve.duckdns.org
  - [ ] ERPNext acessível: https://erp.yesyoudeserve.duckdns.org
  - [ ] PostgreSQL healthy: `docker exec alice-postgres pg_isready`
  - [ ] GPU containers rodando: `docker ps | grep gpu-`

### Tempo Esperado

| Fase | Tempo | Descrição |
|------|-------|-----------|
| **Preparação** | 2-3 min | Validar servidor, criar estrutura, networks |
| **Deploy INFRA** | 3-5 min | PostgreSQL, PgBouncer, Redis, Qdrant, Caddy, MinIO |
| **Deploy ALICE** | 5-7 min | 7 microsserviços + GPU Manager |
| **Deploy OBSERVABILITY** | 4-6 min | Prometheus, Grafana, Loki, Langfuse |
| **Deploy ERPNEXT** | 6-8 min | 15 containers (MariaDB, Backend, Workers) |
| **Deploy BACKUP** | 1-2 min | pgBackRest |
| **Health Checks** | 2-3 min | 50 containers (retry 30-45x) |
| **TOTAL** | **23-34 min** | Primeiro deploy completo |

**⚠️ IMPORTANTE:** Primeiro deploy demora mais devido a:
- Pull de imagens Docker (~10GB total)
- Inicialização do PostgreSQL (criação de schemas)
- Compilação do pgvector (primeira vez)
- Let's Encrypt SSL (solicitação de certificados)

---

## Visão Geral da Arquitetura - 50 Containers em Produção

A plataforma Alice é composta por **50 containers** organizados em 7 categorias (44 serviços + 5 GPU + 1 backup):

### Categoria 1: Infraestrutura Core (7 serviços)

| # | Serviço | Container | Descrição | Tecnologia |
|---|---------|-----------|-----------|------------|
| 1 | **Caddy Gateway** | `alice-caddy` | Reverse proxy com SSL automático (Let's Encrypt), HTTP/3 nativo (QUIC), configuração declarativa. Substitui Traefik desde 02/01/2026. | Caddy 2.8.4 Alpine |
| 2 | **pgBackRest Init** | `alice-pgbackrest-init` | Init container que cria stanza de backup ANTES do PostgreSQL iniciar. Corrige crash loop de archive_command. | pgBackRest 2.57.0 |
| 3 | **PostgreSQL** | `alice-postgres` | Banco de dados principal com extensão pgvector para busca semântica, RLS para multi-tenancy. | PostgreSQL 16 + pgvector |
| 4 | **PgBouncer** | `alice-pgbouncer` | Connection pooling para PostgreSQL. Reduz conexões idle de ~50 para ~10, economia de ~400MB RAM. Pool mode transaction. | PgBouncer 1.23.1 (Bitnami) |
| 5 | **Alice Redis** | `alice-redis` | Cache distribuído dedicado para serviços Alice (sessões, RBAC). Segregação enterprise do ERPNext. node-redis 5.x suporta Redis 7.x. | Redis 7.4.7 Alpine |
| 6 | **Qdrant** | `alice-qdrant` | Banco vetorial para embeddings de texto (4096 dim Qwen3-Embedding-8B). HNSW index otimizado. | Qdrant v1.16.2 |
| 7 | **Tor Proxy** | `alice-tor` | Proxy SOCKS5 Tor para engines .onion no SearXNG (ahmia, torch). Enterprise 23/12/2025. | dperson/torproxy |
| 8 | **SearXNG** | `alice-searxng` | Metabusca interna para Web Search (auto-hospedado, protegido por secret) | searxng/searxng |

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
| Qwen2.5-VL 7B (vLLM) | Local (sem custo adicional) - ARQUITETURA v4.0.0 |
| Embeddings INT8 | Local (sem custo adicional) |
| ASR Canary-1B | Local (sem custo adicional) |

> **NOTA v4.0.0:** FLUX.1 Schnell REMOVIDO. Todos serviços GPU rodam SIMULTANEAMENTE (15GB/20GB VRAM).

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

### Self-Hosted Runner (Deploy Server)

O pipeline Alice usa **100% self-hosted runner** (Hetzner CPX32 - 4 vCPU, 8GB RAM) seguindo melhores práticas enterprise 2025.

**Arquitetura de Runners:**

| Tipo de Job | Runner | Motivo |
|-------------|--------|--------|
| **CI/Tests** | Self-hosted (`[self-hosted, linux, deploy]`) | Controle total, compliance |
| **Builds Docker** | Self-hosted (`[self-hosted, linux, deploy]`) | Recursos dedicados, sem rate limits |
| **Security Scans** | Self-hosted (`[self-hosted, linux, deploy]`) | Isolamento na infra própria |
| **Deploy** | Self-hosted (`[self-hosted, linux, deploy]`) | Acesso SSH ao servidor de produção |

**Verificar Status do Runner:**

```bash
# Conectar ao Deploy Server
ssh alice-hetzner

# Verificar se o runner está rodando
systemctl status actions.runner.fillipeguerrabtc-alice.*.service

# Ver logs do runner
journalctl -u actions.runner.fillipeguerrabtc-alice.*.service -f

# Verificar labels (deve ter: self-hosted, linux, deploy)
cat /opt/actions-runner/.runner
```

**Verificar no GitHub:**
1. Acesse: `https://github.com/fillipeguerrabtc/alice/settings/actions/runners`
2. Verifique se há um runner **ativo** com labels: `self-hosted`, `linux`, `deploy`
3. Status deve ser **"Online"** (verde)

**Enterprise Hardening Aplicado:**

| Categoria | Configuração |
|-----------|--------------|
| **Kernel** | `net.core.rmem_max=16MB`, `vm.swappiness=10`, `fs.inotify.max_user_watches=524288` |
| **Docker** | BuildKit, `max-concurrent-downloads=10`, `builder.gc.defaultKeepStorage=20GB` |
| **Limits** | `nofile=1048576`, `nproc=65535`, `memlock=unlimited` |
| **Systemd** | `NODE_OPTIONS=--max-old-space-size=6144` (6GB), `Nice=-5` |
| **Cron** | Limpeza diária 3h: Docker cache, workspaces antigos, logs |

**Se Runner Offline:**

```bash
# Reiniciar o runner
systemctl restart actions.runner.fillipeguerrabtc-alice.*.service

# Verificar logs para diagnóstico
journalctl -u actions.runner.fillipeguerrabtc-alice.*.service -n 50
```

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
│  │ • Validate GPU URLs │   4 GPU Services (SIMULTÂNEOS)         │
│  │ • Health checks     │   RTX 4000 Ada 20GB (Qwen2.5-VL, Emb, ASR) - v4.0.0  │
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

### GPU é OBRIGATÓRIO - Enterprise-Grade - ARQUITETURA v4.0.0 (11/01/2026)

**⚠️ ARQUITETURA ENTERPRISE v4.0.0:** Os serviços GPU são **OBRIGATÓRIOS**, não opcionais. GPUs são o coração da plataforma de IA - sem eles, a plataforma não funciona. Todos os serviços GPU rodam localmente no servidor Hetzner GPU GEX44, gerenciados pelo GPU Manager Service. **TODOS os serviços rodam SIMULTANEAMENTE** (15GB/20GB VRAM).

| Serviço GPU | Função | VRAM | Impacto se Falhar |
|-------------|--------|------|-------------------|
| **GPU Manager Service** | Gerenciamento centralizado (fila, VRAM, circuit breakers) | N/A | Todas as requisições GPU falham |
| **Qwen2.5-VL 7B** | LLM multimodal (chat, trading, vision) | ~4GB | Chat não funciona |
| **Embeddings GPU** | Qwen3-Embedding-8B INT8 + OpenCLIP (RAG) | ~8GB | RAG não funciona |
| **ASR Canary-1B** | Transcrição de áudio | ~3GB | Áudio não funciona |
| **GPU Trainer** | Fine-tuning QLoRA (on-demand via profile) | ~5GB | Fine-tuning não funciona (chat/embeddings continuam) |

> **NOTA v4.0.0:** FLUX.1 Schnell REMOVIDO - Alice ANALISA imagens via Qwen2.5-VL Vision mas NÃO gera. Zero latência de troca entre serviços.

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

### Single Source of Truth - SSOT (07/01/2026)

**Arquivo Central:** `infra/versions.env`

Todas as versões de imagens Docker públicas são centralizadas em um único arquivo SSOT:

```bash
# INFRA Stack
REDIS_ALICE_VERSION=7.4.7-alpine
QDRANT_VERSION=v1.16.2
SEARXNG_VERSION=2025.12.30-a5c946a32
MINIO_IMAGE=quay.io/minio/minio
MINIO_VERSION=latest

# OBSERVABILITY Stack
PROMETHEUS_VERSION=v3.8.1
GRAFANA_VERSION=12.3.1
LANGFUSE_VERSION=3.85.0
# ... mais variáveis

# ERPNEXT Stack
ERPNEXT_VERSION=v15.91.3
MARIADB_VERSION=10.8.8
REDIS_ERPNEXT_VERSION=6.2.21-alpine
```

**Fluxo de Versionamento:**
1. **versions.env** define todas as versões (SSOT)
2. **docker-compose.*.yml** usam `${VAR:-default}` para referenciar
3. **deploy-stack-modular.yml** valida existência das imagens públicas ANTES do deploy
4. **generate-env-prod.sh** gera `.env.prod` com todas as versões para o servidor

**Validação de Imagens Públicas (07/01/2026):**
- Deploy valida todas as imagens públicas via `docker manifest inspect`
- Fail-fast: detecta imagens inexistentes no CI, não no servidor de produção
- Evita falhas de deploy por imagens descontinuadas (ex: MinIO Docker Hub)

**Atualização Manual de Dependências (07/01/2026):**
- Estratégia migrada de Dependabot automático para atualização manual quinzenal
- GitHub Security Alerts continuam ativos para detecção de CVEs
- Ver seção "Atualização de Dependências - Estratégia Manual" em `CLAUDE.md`
- Processo: verificar CVEs → atualizar → testar local → staging → produção

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

#### Upload de Logs como GitHub Artifacts (04/01/2026)

Logs de deploy são automaticamente baixados do servidor Hetzner e publicados como GitHub Artifacts para troubleshooting facilitado:

**Arquivos coletados:**
- `/tmp/compose_up_attempt_*.log` - Logs de tentativas de docker compose up
- `/tmp/init_logs_*.txt` - Logs de init containers
- `/opt/alice/logs/deploy-metrics-*.json` - Métricas de deploy (sucesso/falha)
- Logs das últimas 500 linhas de cada container Alice

**Acesso aos artifacts:**
1. Acesse a aba "Actions" do repositório
2. Clique na run do workflow de deploy
3. Na seção "Artifacts", baixe `deploy-logs-vX.Y.Z`

**Processo técnico (job separado `collect-logs`):**
1. **Configurar SSH** - Chave SSH configurada no runner
2. **Preparar logs no Hetzner** - Agrega todos os logs em tarball
3. **Baixar via SCP** - Transfere tarball para o runner
4. **Limpar SSH** - Remove chave por segurança
5. **Upload artifact** - Publica logs no GitHub Actions

> **CORREÇÃO 04/01/2026:** Os logs são criados no servidor Hetzner via SSH, não no runner GitHub Actions. O workflow agora baixa os logs via SCP antes de fazer o upload-artifact. Retenção: 90 dias.

> **CORREÇÃO CRÍTICA 04/01/2026 (Bug 1):** A coleta de logs foi movida para um **job separado `collect-logs`** com `if: always()` no **nível do job**. PROBLEMA ANTERIOR: Os steps de logs estavam no job `register-success` que só executa quando deploy tem sucesso. Mesmo com `if: always()` nos steps, eles nunca executavam em falhas porque a condição do job (`needs.deploy.result == 'success'`) impedia o job de iniciar. IRONIA: Logs são mais necessários em cenários de falha para troubleshooting. SOLUÇÃO: Job independente que SEMPRE executa após deploy/health-check/rollback.

> **CORREÇÃO 04/01/2026 (Download Step):** Adicionado `if: always()` no step "Baixar logs do Hetzner". PROBLEMA ANTERIOR: Step de download não tinha `if: always()` mas step de upload tinha. Se SSH falhasse, download era pulado, `mkdir -p ./deploy-logs` não executava, e upload falhava porque path não existia (`if-no-files-found: warn` só trata diretórios VAZIOS, não paths inexistentes). SOLUÇÃO: Step de download agora executa sempre, garantindo que diretório seja criado.

> **CORREÇÃO CRÍTICA 04/01/2026 (JSON como Tarball):** Quando não existem logs no Hetzner, o servidor escrevia um JSON de status (`{"status": "no_logs_found", ...}`) diretamente em `/tmp/deploy-logs-bundle.tar.gz`. Este arquivo era baixado via SCP, e a lógica downstream: (1) verificava se arquivo existe (SIM), (2) tentava `tar -xzf` que falhava silenciosamente por ser JSON, (3) deletava o arquivo. O branch `else` que criaria `download-status.json` nunca executava porque arquivo existia. RESULTADO: Diretório vazio sem indicação do que aconteceu. SOLUÇÃO: Validar se arquivo é tarball ANTES de extrair usando `tar -tzf` (list mode, não extrai). Se não é tarball mas começa com `{` (JSON), renomeia para `bundle-status.json` preservando a informação de status. Se formato desconhecido, cria status com diagnóstico via `file -b`.

#### Logging Enterprise "Nível Diamante" (09/01/2026)

Os jobs de deploy agora incluem logging enterprise detalhado para troubleshooting imediato:

**Melhorias implementadas em TODOS os 5 deploys:**

| Melhoria | Descrição | Benefício |
|----------|-----------|-----------|
| **Timestamp de Início** | `🕐 Início: YYYY-MM-DD HH:MM:SS` | Correlação com logs externos |
| **Quick Health Check** | Verifica status de TODOS os containers IMEDIATAMENTE após `docker compose up` | Detecção precoce de falhas |
| **Tempo Total** | `⏱️ Tempo total: Xs` no final do deploy | Métricas de performance |

**Formato do Quick Health Check:**
```bash
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 VERIFICAÇÃO INICIAL DE SAÚDE (quick check):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ✅ alice-frontend: running (health: starting)
   ✅ alice-auth: running (health: healthy)
   ❌ alice-chat: exited (health: none)      ← PROBLEMA DETECTADO!
   ...
```

**Benefícios Enterprise:**
- ✅ **Visibilidade Imediata**: Problemas detectados ANTES do health check job
- ✅ **Correlação Temporal**: Timestamp permite correlacionar com Grafana/Loki
- ✅ **Métricas de Deploy**: Tempo total ajuda a identificar regressões de performance
- ✅ **Troubleshooting Rápido**: Saber se container está "running" vs "healthy" vs "exited"

**Containers verificados por stack:**
- **ALICE**: 8 containers (frontend, auth, chat, rag, training, integrations, observability, gpu-manager)
- **OBSERVABILITY**: 13 containers (prometheus, grafana, loki, promtail, jaeger, langfuse, etc)
- **ERPNEXT**: 10 containers (mariadb, redis-cache, redis-queue, backend, frontend, etc)
- **BACKUP**: 1 container (pgbackrest)
- **INFRA**: Usa verificação completa existente (init containers, healthchecks)

> **REF**: CLAUDE.md Regra 6 (Enterprise-grade), Regra 9 (Validação contínua), Regra 16 (Health checks)

#### Auditoria de Deploys no PostgreSQL (04/01/2026)

Cada deploy bem-sucedido é registrado na tabela `deployments` do PostgreSQL para auditoria enterprise completa:

**Estrutura da tabela:**
```sql
CREATE TABLE deployments (
  id SERIAL PRIMARY KEY,
  version TEXT NOT NULL,           -- Ex: v1.2.3
  deployed_at TIMESTAMPTZ,         -- Timestamp do deploy
  deployed_by TEXT,                -- GitHub actor que disparou
  duration_seconds INTEGER,        -- Duração do deploy em segundos
  containers_count INTEGER,        -- Número de containers running após deploy
  status TEXT NOT NULL,            -- 'success', 'failed', 'rolled_back'
  triggered_by TEXT,               -- 'release-workflow', 'manual', etc
  services TEXT,                   -- 'all' ou lista específica
  metadata JSONB                   -- commit, workflow_run_id, etc
);
```

**Consultas úteis:**
```sql
-- Últimos 10 deploys com métricas
SELECT version, deployed_at, deployed_by, status, duration_seconds, containers_count 
FROM deployments ORDER BY deployed_at DESC LIMIT 10;

-- Deploys por mês
SELECT date_trunc('month', deployed_at) AS mes, COUNT(*) 
FROM deployments GROUP BY 1 ORDER BY 1 DESC;

-- Taxa de sucesso
SELECT status, COUNT(*), ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER(), 2) AS pct
FROM deployments GROUP BY status;

-- Tempo médio de deploy (sucesso apenas)
SELECT AVG(duration_seconds)::INTEGER AS avg_duration_s
FROM deployments WHERE status = 'success' AND duration_seconds IS NOT NULL;
```

> **CORREÇÃO SEGURANÇA 04/01/2026:** O INSERT usa variáveis psql (`-v var=value`) com interpolação segura (`:'var'`) ao invés de interpolação shell direta. Isso previne SQL injection e erros de sintaxe com valores contendo aspas simples (ex: "O'Brien"). Ref: PostgreSQL docs "psql Variables".

> **CORREÇÃO CRÍTICA 04/01/2026 (Bug 2):** Adicionado `if: always()` no step de registro no banco. PROBLEMA ANTERIOR: Se o step de notificação de sucesso falhasse, o registro no PostgreSQL era pulado (default é `if: success()`), quebrando a trilha de auditoria enterprise. SOLUÇÃO: Step agora executa SEMPRE dentro do job `register-success`.

> **MELHORIA 04/01/2026:** Adicionado registro de falha no job `rollback`. Quando um deploy falha e rollback é executado, um registro com `status: 'rolled_back'` é inserido na tabela `deployments` (com `continue-on-error: true` pois o PostgreSQL pode não estar disponível após falha grave). Isso garante auditoria completa de TODOS os deploys, não apenas os bem-sucedidos.

> **CORREÇÃO 04/01/2026 (Métricas BD):** Colunas `duration_seconds` e `containers_count` agora são populadas. PROBLEMA ANTERIOR: Essas colunas existiam no schema mas os INSERTs nunca as preenchiam (sempre NULL). Os dados estavam disponíveis (`DEPLOY_DURATION` e `TOTAL_RUNNING` eram calculados e usados no JSON e notificações Slack), mas não eram passados para o registro BD. SOLUÇÃO: Job `deploy` agora exporta outputs `duration_seconds` e `containers_count` via steps capture-metrics/export-metrics. Jobs `register-success` e `rollback` recebem esses valores e os inserem no BD. Usa `NULLIF(:v_var, 0)` para evitar inserir 0 quando valor indisponível.

> **CORREÇÃO 04/01/2026 (Consistência Best-Effort):** Adicionado `continue-on-error: true` no step "Registrar deploy no banco de dados" do job `register-success` para consistência com o job `rollback` que já tinha essa flag. PROBLEMA ANTERIOR: Se o PostgreSQL INSERT falhasse por motivo transitório (SSH drop, BD momentaneamente indisponível), o workflow era marcado como "failed" mesmo que o deploy tenha sido bem-sucedido. Isso causava confusão na análise de deploys. SOLUÇÃO: Auditoria tratada como best-effort em ambos os jobs - não deve causar falso-positivo de falha quando deploy foi bem-sucedido.

#### Validação do Repositório pgBackRest

Antes de iniciar o deploy, o workflow valida:

1. **Existência do diretório**: `/opt/alice/backups/postgresql` deve existir
2. **Permissões**: UID/GID devem ser 70:70 (postgres Alpine)
3. **Estrutura**: Detecta se é primeiro deploy ou repositório existente
4. **Correção automática**: Se permissões incorretas, corrige automaticamente via SSOT

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
redis:7.4.7-alpine                # Alice (SSOT infra/versions.env) - Redis 7.x LTS
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

### Automático (Handler Unificado de Exit - 04/01/2026)

O rollback automático acontece se health checks falharem após deploy. A arquitetura usa um **handler unificado de exit** que executa duas fases:

1. **Diagnóstico** (`capture_failure_diagnostics`):
   - Captura estado de todos os containers (running/exited/dead)
   - Logs específicos do Caddy (healthcheck, env vars, validação Caddyfile)
   - Logs de containers com exit code != 0
   - Estado de containers exited/dead

2. **Rollback** (`perform_rollback`):
   - Para containers iniciados neste deploy
   - Preserva dados persistentes em `/opt/alice/data/`
   - Salva métricas de falha em JSON
   - Envia notificação Slack (se configurado)

> **CORREÇÃO CRÍTICA (04/01/2026):** Em bash, `trap X EXIT` substitui traps anteriores (não adiciona). Antes tínhamos dois traps separados e o segundo sobrescrevia o primeiro, fazendo diagnósticos nunca executarem. Agora há um único trap `combined_exit_handler` que chama ambas as funções na ordem correta.

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

### pgBackRest Init falha com "PGBACKREST_REPO1_CIPHER_PASS não definido"

**Sintoma:** Deploy falha no container `alice-pgbackrest-init` com erro:
```
[pgBackRest Init] ERRO: PGBACKREST_REPO1_CIPHER_PASS não definido
Configure BACKUP_CIPHER_PASS nos secrets do GitHub
```

**Causas:**
1. **Secret `BACKUP_CIPHER_PASS` não configurado no GitHub** - Mais comum
2. **Secret existe mas está vazio** - GitHub permite secrets vazios
3. **Secret muito curto** - Mínimo 32 caracteres exigido

**Diagnóstico:**
```bash
# Verificar logs do pgbackrest-init
docker logs alice-pgbackrest-init --tail 50

# Verificar se .env.prod tem a variável
grep BACKUP_CIPHER_PASS /opt/alice/app/infra/docker/.env.prod | wc -c
# Deve retornar > 50 (32 chars + nome da variável)
```

**Solução:**
1. Acessar GitHub → Settings → Secrets and variables → Actions
2. Verificar se `BACKUP_CIPHER_PASS` existe e tem valor
3. Se não existir ou estiver vazio, gerar novo valor:
   ```bash
   openssl rand -hex 32  # Gera 64 caracteres hexadecimais
   ```
4. Atualizar o secret no GitHub com o valor gerado
5. Re-executar o deploy

**Nota (02/01/2026):** A validação agora acontece em 3 pontos do workflow, garantindo fail-fast antes de iniciar containers.

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
| **healthchecks** | ✅ | 46/46 containers verificam saúde REAL (3 init usam service_completed_successfully) |

### Compatibilidade do Stack de Observabilidade (pins atuais - 19/12/2025)

- Prometheus 3.8.1 + Grafana Alerting: Alertmanager removido em 01/01/2026, alertas via Grafana Alerting.
- Grafana 12.3.1: atualização maior; dashboards e datasources preservados.
- Loki/Promtail 3.6.3: versão alinhada; labels e pipeline existentes compatíveis.
- Jaeger 2.13.0: estável; OTLP habilitado por padrão. v1 EOL em 31/12/2025.
- OTel Collector 0.142.0: configurações atuais (receivers/exporters) compatíveis.

### Permissões Enterprise por Serviço (Atualizado 09/01/2026)

> **🔧 SSOT (Single Source of Truth) 09/01/2026:** Todas as configurações de permissões são centralizadas em `infra/scripts/permissions-config.sh`. Este arquivo é o SSOT para UIDs, GIDs e permissões, usado por todos os scripts de infraestrutura.

**Arquitetura SSOT:**
```
permissions-config.sh (SSOT)
         ↓
    ┌─────────────────────────────┬──────────────────────────────────┐
    ↓                             ↓                                  ↓
prepare-production-server.sh  fix-production-permissions.sh  (scripts futuros)
```

**Documentação Completa:** Ver `docs/PERMISSIONS.md` para detalhes sobre o sistema SSOT.

#### Estrutura de Diretórios e Permissões

| Serviço | UID | Permissão | Diretório | Justificativa |
|---------|-----|-----------|-----------|---------------|
| PostgreSQL | 70 | 700 | /opt/alice/data/postgres | Alpine UID, security hardening obrigatório |
| pgBackRest | 70 | 755 | /opt/alice/data/pgbackrest-spool | Mesmo UID do PostgreSQL (Alpine) |
| Redis Alice | 999 | 755 | /opt/alice/data/redis-alice | Alpine Redis padrão |
| Caddy | 1000 | 755 | /opt/alice/data/caddy | Web server, serve certificados públicos |
| Caddy Config | 1000 | 755 | /opt/alice/data/caddy-config | Configurações Caddy |
| SearXNG | 977 | 755 | /opt/alice/data/searxng-config | Metabusca interna |
| MinIO | 0 (root) | 755 | /opt/alice/data/minio | Object storage (requer root) |
| Qdrant | 0 (root) | 755 | /opt/alice/data/qdrant | Banco vetorial (requer root) |
| Jaeger | 10001 | 755 | /opt/alice/data/jaeger | Tracing (distroless) |
| Langfuse DB | 70 | 700 | /opt/alice/data/langfuse-db | PostgreSQL strict mode |
| ClickHouse | 101 | 755 | /opt/alice/data/clickhouse | OLAP Langfuse |
| Vector | 0 (root) | 755 | /opt/alice/data/vector | Agregador de logs |
| Grafana | 472 | 755 | /opt/alice/data/grafana | Dashboards |
| Prometheus | 65534 | 755 | /opt/alice/data/prometheus | Métricas (Alpine nobody) |
| Loki | 10001 | 755 | /opt/alice/data/loki | Logs (distroless) |
| ERPNext Sites | 1000 | 755 | /opt/alice/data/erpnext-sites | Sites Frappe |
| ERPNext MariaDB | 999 | 755 | /opt/alice/data/erpnext-mariadb | Banco ERPNext |
| ERPNext Redis Cache | 999 | 755 | /opt/alice/data/erpnext-redis-cache | Cache ERPNext |
| ERPNext Redis Queue | 999 | 755 | /opt/alice/data/erpnext-redis-queue | Queue ERPNext |
| Backups | 70 | 755 | /opt/alice/backups/postgresql | pgBackRest (Alpine UID 70) |
| Uploads | 1000 | 755 | /opt/alice/uploads | RAG multimodal |
| Secrets | 0 (root) | 700 | /opt/alice/secrets | Apenas root pode ler |

> **NOTA IMPORTANTE (08/01/2026):** PostgreSQL migrou de Debian (UID 999) para Alpine (UID 70) por CVE-2023-45853. Todos os UIDs de PostgreSQL e pgBackRest agora usam UID 70.

#### Uso do Script de Permissões

**Arquivos:**
- `infra/scripts/permissions-config.sh` - SSOT (Single Source of Truth)
- `infra/scripts/fix-production-permissions.sh` - Script de criação/validação
- `infra/scripts/prepare-production-server.sh` - Preparação do servidor (delega ao SSOT)

```bash
# Preview das mudanças (não executa)
./infra/scripts/fix-production-permissions.sh --dry-run

# Criar diretórios e aplicar permissões (requer root)
sudo ./infra/scripts/fix-production-permissions.sh --create

# Validar permissões existentes (CI/CD)
./infra/scripts/fix-production-permissions.sh --validate
```

**Características:**
- ✅ **SSOT**: Configurações centralizadas em permissions-config.sh
- ✅ **Idempotente**: Pode rodar múltiplas vezes sem problemas
- ✅ **UIDs Explícitos**: Usa UIDs numéricos (70:70) ao invés de nomes (postgres:postgres)
- ✅ **Validação Recursiva**: Verifica ownership de TODOS os arquivos/diretórios
- ✅ **Bits Especiais**: Detecta e remove setuid/setgid/sticky bits indesejados
- ✅ **Logs Detalhados**: Mostra cada operação (criado, modificado, inalterado)
- ✅ **Fail-Fast**: Para imediatamente em caso de erro

**Integração CI/CD:**  
O workflow `deploy-stack-modular.yml` executa automaticamente este script no job `prepare` antes de qualquer deploy:

```yaml
- name: Preparar infraestrutura base
  script: |
    # Executar script enterprise de permissões (usa SSOT)
    sudo /opt/alice/app/infra/scripts/fix-production-permissions.sh --create
    
    # Validar que tudo está correto (fail-fast)
    sudo /opt/alice/app/infra/scripts/fix-production-permissions.sh --validate
```

> **NOTA:** O script `prepare-production-server.sh` agora delega TODA lógica de permissões para `fix-production-permissions.sh`, garantindo consistência via SSOT.
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
*Documento atualizado em: 11 de Janeiro de 2026*
*Versão: 8.0 - Arquitetura GPU v4.0.0*
*Data: 11 de Janeiro de 2026*
*Tecnologias: Node.js (versão LTS automática via API + fallback .nvmrc), pnpm (versão automática via package.json), TypeScript 5.9.3, Alpine 3.21*
*Total de Containers: 50 (7 infra + 7 Alice + 15 ERPNext + 14 observability + 4 GPU + 1 backup + 1 trainer on-demand)*
*Security Hardening: 100% completo - 50/50 containers com no-new-privileges, 50/50 com resource limits, 25/50 com read_only*
*Servidor: Ubuntu 24.04.3 LTS, Docker 29.1.3, Docker Compose v5.0.0*
*Storage: Volume Hetzner alice-data 100GB montado em /opt/alice*
*ARQUITETURA ENTERPRISE v4.0.0: Texto Qwen3-Embedding-8B INT8 (4096 dim → Qdrant) | Imagem OpenCLIP (1024 dim → pgvector) | LLM Qwen2.5-VL 7B AWQ (vLLM) - multimodal texto+vision*
*Pipeline Enterprise (26/12/2025): Deploy Server (CPX32 - IP 46.224.46.93, 4 vCPU, 8GB RAM) separado + Production Server (GEX44 GPU - IP 178.63.41.108). Todos os 50 containers rodam no servidor único, incluindo GPU services gerenciados pelo GPU Manager Service.*

*Migração Traefik→Caddy (02/01/2026): Traefik, traefik-init e dockerproxy substituídos por Caddy. Vantagens: SSL automático com retry inteligente, HTTP/3 nativo (QUIC), footprint 40MB vs 100MB. Total: 7 infra (era 8).*
*Otimização CI (27/12/2025): Composite action `.github/actions/setup-node-pnpm` elimina duplicação de setup (14x → 1x). Economia de ~6-10min por run. Fix cache persistence: usa actions/cache/restore + actions/cache/save separados (best practice 2025).*
*GPU v4.0.0 (11/01/2026): RTX 4000 SFF Ada (20GB VRAM) - TODOS SIMULTÂNEOS (15GB/20GB): Qwen2.5-VL 7B (~4GB), Embeddings INT8 (~8GB), ASR Canary-1B (~3GB). Trainer QLoRA on-demand via profile.*
*Redis Alice: 7.4.7-alpine - Cache distribuído (node-redis 5.x suporta Redis 7.x)*
*Redis ERPNext: 6.2.21-alpine - ERPNext v15 requer Redis 6.x (docs.frappe.io)*
*Retenção Padrão: Full 15d, Incremental 7d, Archive 30d*

---

## 📦 Init Containers - Sequência de Execução

Alice Platform usa **init containers** (one-time jobs com `restart: "no"`) para setup inicial do sistema. Estes containers executam uma única vez, completam com exit 0, e permanecem em estado "exited" - **isto é comportamento esperado e correto**.

### Sequência de Execução (Primeiro Deploy)

Os init containers executam em ordem de dependência:

#### 1. **alice-pgbackrest-init** (30s-60s)
   - **Função:** Cria stanza pgBackRest para backups PostgreSQL PITR
   - **Exit 0 significa:** PostgreSQL pode iniciar WAL archiving
   - **Dependência:** PostgreSQL deve estar healthy
   - **Logs:** `/tmp/init_logs_alice-pgbackrest-init.txt`

> **NOTA PostgreSQL (09/01/2026):** O container PostgreSQL agora inclui `entrypoint-wrapper.sh` (FASE 2) que valida permissões do diretório PGDATA antes de iniciar o daemon. Se permissões estiverem incorretas, o container falha com mensagens de diagnóstico claras e comandos de correção. Ver `infra/postgres/entrypoint-wrapper.sh`.

#### 2. **alice-minio-init** (10s-30s)
   - **Função:** Cria buckets MinIO para Langfuse v3 object storage
   - **Exit 0 significa:** Langfuse pode armazenar traces/eventos
   - **Dependência:** MinIO deve estar healthy
   - **Logs:** `/tmp/init_logs_alice-minio-init.txt`

#### 3. **erpnext-configurator** (60s-120s)
   - **Função:** Inicializa Frappe Bench no volume compartilhado
   - **Exit 0 significa:** create-site pode executar bench commands
   - **Dependência:** MariaDB e Redis (cache + queue) devem estar healthy
   - **Logs:** `/tmp/init_logs_erpnext-configurator.txt`

#### 4. **erpnext-create-site** (3min-10min) ⚠️ **CRÍTICO - MAIS DEMORADO**
   - **Função:** Cria site ERPNext completo (database schema + arquivos + instalação do app)
   - **Exit 0 significa:** Workers ERPNext podem iniciar e processar jobs
   - **Dependência:** erpnext-configurator completado + MariaDB healthy
   - **Comando:** `bench new-site --install-app erpnext` (atômico)
   - **Tempo esperado:** 3-10 minutos no primeiro deploy (cria ~300 tabelas)
   - **Logs:** `/tmp/init_logs_erpnext-create-site.txt`
   - **Nota:** Pode demorar até 10min - timeout de 90min no workflow é adequado

### ⏱️ Espera Inteligente (Implementado em 04/01/2026)

O workflow de deploy agora aguarda **ativamente** que TODOS os init containers completem antes de verificar containers normais:

```bash
# Aguarda até 2 minutos para init containers completarem
INIT_TIMEOUT=120
while [ $INIT_ELAPSED -lt $INIT_TIMEOUT ]; do
  for init_container in "${INIT_CONTAINERS[@]}"; do
    STATUS=$(docker inspect --format='{{.State.Status}}' "$init_container")
    
    case "$STATUS" in
      "running")
        echo "⏳ $init_container ainda executando..."
        ALL_INIT_COMPLETED=0  # Continuar esperando
        ;;
      "exited")
        # Verificar exit code
        EXIT_CODE=$(docker inspect --format='{{.State.ExitCode}}' "$init_container")
        if [ "$EXIT_CODE" != "0" ]; then
          exit 1  # Fail-fast imediato
        fi
        ;;
      "created")
        # Container ainda não iniciou - continuar esperando
        echo "⏳ $init_container ainda não iniciou..."
        ALL_INIT_COMPLETED=0
        ;;
      "dead"|"restarting"|"paused")
        # Estados problemáticos - fail-fast imediato
        exit 1
        ;;
      *)
        # Estado desconhecido - fail-fast imediato
        exit 1
        ;;
    esac
  done
done

# Aguarda 30s para service containers iniciarem healthchecks
sleep 30
```

**Estados de Container Tratados (Correção 04/01/2026):**

| Estado | Ação | Motivo |
|--------|------|--------|
| `running` | Continuar esperando | Container ainda executando |
| `exited` (exit 0) | Marcar como completado | Init container terminou com sucesso |
| `exited` (exit != 0) | **Fail-fast** | Init container falhou |
| `created` | Continuar esperando | Container ainda não iniciou |
| `dead` | **Fail-fast** | Container morreu (OOM, crash fatal) |
| `restarting` | **Fail-fast** | Init containers NÃO devem restartar |
| `paused` | **Fail-fast** | Estado inesperado para init container |
| `unknown`/outro | **Fail-fast** | Estado desconhecido = problema grave |
| Container não existe | Continuar esperando | Ainda não criado pelo Docker Compose |

**Benefícios:**
- ✅ Elimina race condition (check executando antes de inits completarem)
- ✅ Progress indicator mostra tempo decorrido (a cada 15s)
- ✅ Fail-fast imediato se init container falhar
- ✅ Service containers têm tempo adequado para iniciar healthchecks
- ✅ **Tratamento completo de TODOS os estados Docker** (correção 04/01/2026)

### ✅ Comportamento Esperado vs ❌ Problemas

| Status | Exit Code | Container Tipo | Interpretação |
|--------|-----------|----------------|---------------|
| `exited` | `0` | **Init container** | ✅ **SUCESSO** - Completou tarefa |
| `exited` | `0` | Container normal | ❌ **PROBLEMA** - Não deve parar |
| `exited` | `!= 0` | Qualquer | ❌ **PROBLEMA** - Falha na execução |
| `running` | N/A | Qualquer | ✅ **OK** - Funcionando normalmente |
| `created` | N/A | **Init container** | ⏳ **AGUARDANDO** - Ainda não iniciou |
| `dead` | N/A | Qualquer | ❌ **PROBLEMA** - OOM ou crash fatal |
| `restarting` | N/A | **Init container** | ❌ **PROBLEMA** - Crash loop (NÃO deve restartar) |
| `paused` | N/A | Qualquer | ❌ **PROBLEMA** - Estado inesperado |
| `unknown` | N/A | Qualquer | ❌ **PROBLEMA** - Falha de comunicação Docker |

### 🔍 Troubleshooting Init Containers

**Container exitou com exit 0 mas deploy falhou:**
```bash
# Isto PODE ser correto se for init container
docker ps -a | grep init

# Verificar se é realmente init container
docker inspect --format='{{.HostConfig.RestartPolicy.Name}}' erpnext-create-site
# Resultado esperado: "no" (init container)

# Verificar exit code
docker inspect --format='{{.State.ExitCode}}' erpnext-create-site
# Resultado esperado: 0 (sucesso)
```

**Logs de init containers preservados:**
```bash
# Logs são capturados automaticamente durante deploy
ls -la /tmp/init_logs_*.txt

# Ver logs específicos
cat /tmp/init_logs_erpnext-create-site.txt
```

**Validar manualmente se site ERPNext foi criado:**
```bash
# Verificar estrutura de arquivos no volume
ls -la /opt/alice/data/erpnext-sites/erp.yesyoudeserve.duckdns.org/

# Arquivos críticos esperados:
# - site_config.json (configuração do site)
# - currentsite.txt (nome do site ativo)
```

**Retry manual se init container falhou:**
```bash
# Remover container com problema
docker rm -f erpnext-create-site

# Re-executar apenas o init container
docker compose -f /opt/alice/app/infra/docker/docker-compose.prod.yml \
  --env-file /opt/alice/app/infra/docker/.env.prod \
  up -d erpnext-create-site

# Monitorar logs em tempo real
docker logs -f erpnext-create-site
```

---

## 🔧 Troubleshooting

### Init Containers Marcados como Unhealthy

**Problema:** Container `alice-pgbackrest-init`, `alice-minio-init`, `erpnext-configurator` ou `erpnext-create-site` marcado como unhealthy causando falha no deploy, embora tenha completado com sucesso (exit 0).

**Causa Raiz:** Init containers (`restart: "no"`) têm comportamento diferente de containers normais:
- **Init containers:** Status `exited` com exit code 0 = **SUCESSO** ✅
- **Containers normais:** Status `exited` (qualquer exit code) = **PROBLEMA** ❌

**Sintoma:**
```bash
❌ FAIL-FAST: Containers com problemas detectados!
📋 Containers problemáticos:
   - alice-pgbackrest-init: status=exited, exit=0 (unhealthy)
```

**Solução (Implementada em 04/01/2026):**

A função `check_container_health()` no workflow de deploy agora distingue corretamente entre init containers e containers normais:

```bash
# Init containers conhecidos (CORREÇÃO 04/01/2026: adicionado erpnext-create-site)
INIT_CONTAINERS=("alice-pgbackrest-init" "alice-minio-init" "erpnext-configurator" "erpnext-create-site")

# Lógica específica
if [ "$IS_INIT" -eq 1 ]; then
  # Init container: status "exited" com exit 0 é SUCESSO
  if [ "$STATUS" = "exited" ] && [ "$EXIT_CODE" != "0" ]; then
    IS_PROBLEM=1  # Apenas exit code != 0 é problema
  fi
else
  # Container normal: status "exited" SEMPRE é problema
  if [ "$STATUS" = "exited" ]; then
    IS_PROBLEM=1  # Qualquer exit code
  fi
fi
```

**Diagnóstico Manual:**

Se você suspeitar que um init container falhou, verifique:

```bash
# Verificar status e exit code
docker inspect --format='{{.State.Status}} {{.State.ExitCode}}' alice-pgbackrest-init

# Ver logs completos
docker logs alice-pgbackrest-init

# Ver timestamps
docker inspect --format='Started: {{.State.StartedAt}}' alice-pgbackrest-init
docker inspect --format='Finished: {{.State.FinishedAt}}' alice-pgbackrest-init
```

**Valores Esperados:**
- ✅ **Status:** `exited`
- ✅ **Exit Code:** `0`
- ✅ **Duração:** Geralmente < 30 segundos

**Valores Problemáticos:**
- ❌ Exit code != 0 → Verificar logs para erro específico
- ❌ Status = `created` → Container nunca iniciou (dependency failed)
- ❌ Duração > 2 minutos → Pode estar travado

### 🔒 Validação Específica do Caddy (Implementado em 04/01/2026)

O workflow de deploy agora valida o **Caddy separadamente** antes de verificar outros containers:

```bash
# Aguardar Caddy iniciar
sleep 10

# Verificar se está rodando
docker ps --filter "name=alice-caddy" --filter "status=running"

# Aguardar até 60s para ficar healthy
CADDY_TIMEOUT=60
while [ "$CADDY_HEALTH" != "healthy" ] && [ $CADDY_ELAPSED -lt $CADDY_TIMEOUT ]; do
  echo "⏳ Aguardando Caddy ficar healthy (${CADDY_ELAPSED}s/${CADDY_TIMEOUT}s)..."
  sleep 5
done

# Fail-fast se não ficou healthy
if [ "$CADDY_HEALTH" != "healthy" ]; then
  docker logs --tail 100 alice-caddy
  exit 1
fi
```

**Por que validar Caddy separadamente?**
- ✅ Caddy pode demorar 30-60s para obter certificado SSL (ACME/Let's Encrypt)
- ✅ Fail-fast específico se Caddy falhar (com logs detalhados)
- ✅ Evita falso positivo se Caddy ainda estiver em processo de SSL
- ✅ Captura logs do Caddy IMEDIATAMENTE se houver problema

**Logs do Caddy sem avisos (Caddyfile otimizado em 04/01/2026):**

Removidos headers redundantes que causavam 32 avisos:
```bash
# ANTES (causava avisos)
header_up X-Forwarded-For {remote_host}
header_up X-Forwarded-Proto {scheme}

# DEPOIS (sem avisos)
# Caddy adiciona esses headers automaticamente
# Ref: https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#defaults
```

### Disk Space Insuficiente

**Problema:** Deploy falha com erro "Espaço insuficiente".

**Causa Raiz:** `/opt/alice` precisa de mínimo 10GB livre para deploy seguro.

**Sintoma:**
```bash
❌ ERRO CRÍTICO: Espaço insuficiente em /opt/alice
   Disponível: 3GB
   Requerido: 10GB
```

**Solução:**

1. Verificar uso atual:
```bash
df -h /opt/alice
du -h --max-depth=2 /opt/alice | sort -rh | head -20
```

2. Limpar dados antigos:
```bash
# Remover logs antigos (> 30 dias)
find /opt/alice/logs -type f -mtime +30 -delete

# Limpar backups antigos (manter últimos 7 dias)
find /opt/alice/backups -type f -mtime +7 -delete

# Remover imagens Docker não utilizadas
docker system prune -af --volumes
```

3. Expandir volume (se necessário):
```bash
# No Hetzner Cloud Console, expandir volume para 200GB+
# Depois redimensionar filesystem:
sudo resize2fs /dev/disk/by-id/scsi-0HC_Volume_XXXXX
```

### Container Normal com Status "Exited"

**Problema:** Container normal (long-running) tem status `exited`.

**Causa Raiz:** Containers normais devem ter status `running`. Se tiverem `exited`, significa problema:
- Restart policy failed
- Dependency failed  
- Crash gracefully (exit 0 ainda é problema)
- Manual stop

**Sintoma:**
```bash
📋 Containers problemáticos:
   - alice-postgres: status=exited, exit=0 (container normal não deve parar)
```

**Diagnóstico:**

```bash
# Ver por que container parou
docker logs --tail=100 alice-postgres

# Verificar restart count (> 2 indica instabilidade)
docker inspect --format='{{.RestartCount}}' alice-postgres

# Verificar health checks
docker inspect --format='{{.State.Health.Status}}' alice-postgres

# Tentar restart manual
docker restart alice-postgres

# Verificar dependências
docker-compose -f docker-compose.prod.yml ps
```

### Métricas do Sistema Durante Deploy

**Implementado em 04/01/2026:** Deploy agora captura métricas automaticamente:

**Baseline (antes do deploy):**
```bash
📊 MÉTRICAS DO SISTEMA:
💾 Disco: 85GB disponível em /opt/alice
🧠 Memória: 48GB livre de 64GB
⚙️ CPU Load: 0.52, 0.48, 0.45
🐳 Docker: 12GB em uso (images: 8GB, containers: 4GB)
```

**Após falha (diagnóstico):**
- Mesmo output é capturado automaticamente
- Permite comparar antes/depois
- Identifica se falha foi por falta de recursos

**Acesso Manual:**
```bash
# Ver métricas atuais
df -h /opt/alice
free -h
uptime
docker system df
```

### Referências

- **CLAUDE.md v4.60:** Changelog completo da correção de init containers
- **Docker Compose Healthcheck:** https://docs.docker.com/compose/compose-file/compose-file-v3/#healthcheck
- **pgBackRest 2.57.0 Release:** https://pgbackrest.org/release.html
- **GitHub Workflow Deploy:** `.github/workflows/deploy-production.yml`

### Secrets Ausentes (CORREÇÃO 5)

**Problema:** Deploy falha imediatamente com erro "Secrets obrigatórias ausentes".

**Causa Raiz:** Validação PRÉ-DEPLOY (v4.61) verifica 12 secrets críticas ANTES do docker compose up.

**Sintoma:**
```bash
❌ ERRO CRÍTICO: Secrets obrigatórias ausentes ou vazias no .env.prod!

📋 Secrets faltantes:
   - POSTGRES_PASSWORD
   - BACKUP_CIPHER_PASS
```

**Solução:**

1. Configure secrets no GitHub:
```
Settings → Secrets → Actions → New repository secret
```

2. Secrets obrigatórias (v4.61):
- `POSTGRES_PASSWORD` - Senha do PostgreSQL
- `REDIS_PASSWORD` - Senha do Redis
- `BACKUP_CIPHER_PASS` - Senha de criptografia pgBackRest (32+ chars)
- `SESSION_SECRET` - Secret para sessões web
- `INTERNAL_API_SECRET` - Secret para APIs internas
- `QDRANT_API_KEY` - API key do Qdrant
- `GMAIL_USER` - Email Gmail para SMTP
- `GMAIL_APP_PASSWORD` - App Password do Gmail
- `GRAFANA_ADMIN_USER` - Usuário admin Grafana
- `GRAFANA_ADMIN_PASSWORD` - Senha admin Grafana
- `ERPNEXT_ADMIN_PASSWORD` - Senha admin ERPNext
- `MINIO_ROOT_PASSWORD` - Senha root MinIO

3. Gerar secrets seguras:
```bash
# Geral (16 bytes = 32 chars hex)
openssl rand -hex 16

# pgBackRest (32 bytes = 64 chars hex, OBRIGATÓRIO)
openssl rand -hex 32
```

### Inodes Insuficientes (CORREÇÃO 6)

**Problema:** Warning sobre poucos inodes disponíveis.

**Causa Raiz:** Sistema pode ter GB livres mas sem inodes (limite de arquivos).

**Sintoma:**
```bash
⚠️ AVISO: Poucos inodes disponíveis!
   Disponível: 5000 inodes
   Recomendado: 10000 inodes
```

**Diagnóstico:**
```bash
# Verificar inodes
df -i /opt/alice

# Encontrar diretórios com muitos arquivos
find /opt/alice -xdev -printf '%h\n' | sort | uniq -c | sort -rn | head -20
```

**Solução:**
```bash
# Limpar logs fragmentados
find /opt/alice/logs -type f -name "*.log.*" -mtime +7 -delete

# Limpar cache de pacotes
docker system prune -af

# Se persistir, considere aumentar inodes no filesystem
```

### Logs de Init Containers Vazios (CORREÇÃO 7-8)

**Problema:** Logs de init containers aparecem vazios em troubleshooting.

**Solução (Implementada em v4.61):**

Logs são **automaticamente preservados** em `/tmp` após docker compose up:

```bash
# Ver logs preservados
cat /tmp/init_logs_alice-pgbackrest-init.txt
cat /tmp/init_logs_alice-minio-init.txt
cat /tmp/init_logs_erpnext-configurator.txt

# Quantidade de linhas capturadas
wc -l /tmp/init_logs_*.txt
```

Captura acontece ANTES de containers serem removidos pelo Docker.

### Container Unhealthy Sem Causa (CORREÇÃO 9-10)

**Problema:** Mensagem "unhealthy" sem explicar WHY.

**Solução (Implementada em v4.61):**

Agora mostra última linha do healthcheck log:

```bash
📦 Init Container: alice-pgbackrest-init - status=exited, exit=0 (completou com sucesso)
🐳 Container: alice-postgres - status=running, exit=0 (unhealthy - connection refused on port 5432)
```

**Emojis indicam tipo:**
- 📦 = Init container (status exited é OK)
- 🐳 = Container normal (status exited é PROBLEMA)

### Análise de Causa Raiz (CORREÇÃO 11-12)

**Problema:** Falhas sem correlação clara da causa.

**Solução (Implementada em v4.61):**

Deploy agora mostra análise automática:

```bash
🔍 ANÁLISE DE CAUSA RAIZ
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔍 Container: alice-auth

📊 Dependências do container:
   alice-postgres alice-redis

🔐 Variáveis de ambiente críticas:
   POSTGRES_PASSWORD=***
   SESSION_SECRET=***
   INTERNAL_API_SECRET=***

❌ Exit code 137 - Possíveis causas:
   - SIGKILL (OOM killer? Memória insuficiente?)
```

**Interpretação de Exit Codes:**
- `1` - Erro genérico (verificar logs)
- `2` - Comando incorreto ou parâmetros inválidos
- `126` - Comando não executável (permissões?)
- `127` - Comando não encontrado (PATH incorreto?)
- `137` - SIGKILL (OOM killer, memória insuficiente)
- `143` - SIGTERM (terminado por outro processo)

### Timeouts Configuráveis (CORREÇÃO 13-15)

**Problema:** Timeouts hardcoded não adequados para ambiente.

**Solução (Implementada em v4.61):**

Configure via variáveis de ambiente no workflow:

```yaml
env:
  MONITOR_INTERVAL: 10      # Segundos entre checks (default: 5)
  MAX_WAIT_TIME: 900        # Timeout total em segundos (default: 600)
  HEALTHCHECK_RETRIES: 50   # Tentativas máximas (default: 30)
```

**Ver configuração usada:**
```bash
⏱️  Configuração de timeouts para monitoramento:
   Monitor interval: 10s (tempo entre verificações)
   Max wait time: 900s (timeout total)
   Healthcheck retries: 50 (tentativas máximas)
```

**Casos de uso:**
- **Ambiente lento:** Aumentar `MONITOR_INTERVAL` e `MAX_WAIT_TIME`
- **Ambiente rápido:** Diminuir para fail-fast mais rápido
- **Primeiro deploy:** Aumentar `HEALTHCHECK_RETRIES` (pull de imagens demora)

### Progress Tracking (CORREÇÃO 16-18)

**Problema:** Deploy parece travado sem feedback de progresso.

**Solução (Implementada em v4.61):**

Progress tracking visual em tempo real:

```bash
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 PROGRESSO: [7/13 - 53%] Validação PRÉ-DEPLOY de secrets obrigatórias
⏱️  Tempo decorrido: 145s
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Métricas periódicas durante retry:**

A cada 3 tentativas de operações críticas (ex: pgvector), mostra:

```bash
📊 Métricas do sistema durante retry (tentativa 6):
CONTAINER       CPU %    MEM USAGE
alice-postgres  2.5%     450MB / 2GB
alice-redis     0.8%     120MB / 1GB
```

**Fases do deploy (13 total):**
1. Validação do servidor
2. Pre-flight checks
3. Validação .env.prod
4. Estrutura de diretórios
5. Secrets
6. Clone repositório
7. Login registries
7.5. Validação PRÉ-DEPLOY secrets (NOVO v4.61)
8. Networks Docker
9. Pull imagens
10. Deploy containers
11. Deploy GPU
12. Smoke tests
13. Verificação final

---

*Seção de Troubleshooting adicionada em: 04 de Janeiro de 2026*
*Atualizada com Correções 5-18 em: 04 de Janeiro de 2026*
*Atualizada com Primeiro Deploy e 5 Failure Modes em: 07 de Janeiro de 2026*
*Autor: Fillipe Guerra*

---

## 🔧 Troubleshooting - 5 Failure Modes Comuns

Esta seção documenta os **5 failure modes mais comuns** em deploy de produção e suas soluções.

### Failure Mode #1: Grafana Redirect Loop (ERR_TOO_MANY_REDIRECTS)

**Sintoma:**
```
Browser: ERR_TOO_MANY_REDIRECTS
URL: https://observability.yesyoudeserve.duckdns.org
```

**Causa Raiz:**
- Grafana configurado com `GF_SECURITY_COOKIE_SECURE: "true"`
- Caddy termina SSL → envia HTTP para Grafana
- Grafana com cookie_secure=true força HTTPS → **loop infinito**

**Solução (Implementada em v5.0):**
```yaml
# infra/docker/stacks/docker-compose.observability.yml
environment:
  GF_SERVER_PROTOCOL: http                          # TLS terminado no Caddy
  GF_SERVER_DOMAIN: observability.yesyoudeserve.duckdns.org
  GF_SECURITY_COOKIE_SECURE: "false"                # Caddy adiciona Secure flag
  GF_SECURITY_COOKIE_SAMESITE: lax                  # Compatível com OAuth
  GF_SERVER_ENFORCE_DOMAIN: "false"                 # Evita problemas
  GF_SECURITY_STRICT_TRANSPORT_SECURITY: "false"    # Caddy adiciona HSTS
```

**Referência:** https://grafana.com/docs/grafana/latest/setup-grafana/configure-grafana/reverse-proxy/

**Como Validar:**
```bash
# SSH no servidor
docker logs grafana | grep -i "redirect\|cookie"

# Testar endpoint local (deve responder HTTP 200)
docker exec grafana wget --spider -q http://localhost:3000/api/health
```

---

### Failure Mode #2: PostgreSQL Não Inicia (Permissões Incorretas)

**Sintoma:**
```
Container: alice-postgres (ou alice-jaeger)
Status: unhealthy ou restart loop infinito
Log: FATAL: data directory "/var/lib/postgresql/data" has invalid permissions
Log (Jaeger): Error Creating Dir: "/badger/key" err: mkdir /badger/key: permission denied
```

**Causa Raiz:**
- Diretório não existe ou tem owner/group incorreto
- PostgreSQL requer UID 999:999 com permissões 700
- Jaeger requer UID 10001:10001 com permissões 755
- Outros serviços têm UIDs específicos (ver tabela de permissões acima)

**Solução Automática (Implementada em v5.0 - 07/01/2026, Atualizada v9.1 - 09/01/2026):**

1. **FASE 1 - Preparação Inline (deploy-stack-modular.yml):**
```bash
# Preparação do diretório PostgreSQL ANTES do docker compose up
mkdir -p /opt/alice/data/postgres
chown -R 999:999 /opt/alice/data/postgres
chmod 700 /opt/alice/data/postgres

# Teste de escrita REAL via Docker (como UID 999)
docker run --rm --user 999:999 -v /opt/alice/data/postgres:/test alpine:3.21 touch /test/.write-test
```

2. **FASE 2 - Entrypoint Wrapper (infra/postgres/entrypoint-wrapper.sh):**
```bash
# O container PostgreSQL agora inclui validação de permissões NO STARTUP
# Se falhar, mostra diagnóstico claro com comandos de correção
# Ver arquivo: infra/postgres/entrypoint-wrapper.sh
```

3. **FASE 3 - Job prepare-infrastructure (deploy-stack-modular.yml):**
```bash
# Script enterprise gerencia TODOS os 22 diretórios automaticamente
# Executado pelo workflow deploy-stack-modular.yml no job 'prepare-infrastructure'
sudo /opt/alice/app/infra/scripts/fix-production-permissions.sh --create

# Validação fail-fast (CI/CD)
sudo /opt/alice/app/infra/scripts/fix-production-permissions.sh --validate
```

**Como Corrigir Manualmente:**
```bash
# SSH no servidor
sudo chown -R 999:999 /opt/alice/data/postgres
```bash
# OPÇÃO 1: Usar script enterprise (RECOMENDADO)
cd /opt/alice/app
sudo ./infra/scripts/fix-production-permissions.sh --create

# OPÇÃO 2: Corrigir manualmente apenas PostgreSQL
sudo chown -R 999:999 /opt/alice/data/postgres
sudo chmod 700 /opt/alice/data/postgres

# Validar permissões
ls -ld /opt/alice/data/postgres
# Esperado: drwx------ 2 999 999 ...

# Testar escrita
sudo -u "#999" touch /opt/alice/data/postgres/.test && echo "OK" || echo "FAIL"
sudo rm -f /opt/alice/data/postgres/.test

# OPÇÃO 3: Validar todas as permissões
cd /opt/alice/app
sudo ./infra/scripts/fix-production-permissions.sh --validate
```

**Verificação de Containers em Restart Loop:**
```bash
# Ver containers com problemas de restart
docker ps -a --filter "status=restarting" --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"

# Ver logs de container específico
docker logs alice-postgres --tail 50
docker logs alice-jaeger --tail 50

# Ver número de restarts
docker ps --format "table {{.Names}}\t{{.Status}}"
```

---

### Failure Mode #3: Caddyfile Inválido (Caddy Não Inicia)

**Sintoma:**
```
Container: alice-caddy
Status: unhealthy ou exited(1)
Log: Error: adapting config using caddyfile: ...
```

**Causa Raiz:**
- Erro de sintaxe no Caddyfile
- Workflow só descobre no health check (timeout)
- Perda de tempo (5-10 min) esperando falha

**Solução (Implementada em v5.0):**
```yaml
# Workflow valida Caddyfile ANTES do deploy (job prepare)
- name: Validar Caddyfile (syntax check)
  run: |
    docker run --rm -v "$(pwd)/infra/docker/Caddyfile:/etc/caddy/Caddyfile:ro" \
      caddy:2.8.4-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

**Como Validar Manualmente:**
```bash
# Validar sintaxe do Caddyfile
docker run --rm -v "$(pwd)/infra/docker/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2.8.4-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

# Se Caddy já está rodando, validar dentro do container
docker exec alice-caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

# Verificar logs do Caddy
docker logs alice-caddy --tail 100

# Testar endpoint /health
docker exec alice-caddy wget --spider -q http://localhost/health && echo "OK" || echo "FAIL"
```

---

### Failure Mode #4: Disco Cheio (PostgreSQL/Backups Falhando)

**Sintoma:**
```
Container: alice-postgres ou alice-pgbackrest
Status: unhealthy
Log: ERROR: could not extend file ... No space left on device
```

**Causa Raiz:**
- Servidor Hetzner GEX44 tem 1.92TB NVMe RAID 1
- Backups full + incremental acumulam espaço
- PostgreSQL WAL logs crescem rapidamente

**Solução:**
```bash
# Verificar uso de disco
df -h /opt/alice

# Limpar backups antigos (manter últimos 7 dias)
find /opt/alice/backups/postgresql -type f -mtime +7 -delete

# Limpar logs antigos
find /opt/alice/logs -type f -mtime +30 -delete

# Verificar tamanho do PostgreSQL
docker exec alice-postgres psql -U postgres -c "
  SELECT pg_size_pretty(pg_database_size('postgres'));
"

# Compactar backups (se necessário)
cd /opt/alice/backups/postgresql
find . -name "*.gz" -exec gunzip {} \; -exec gzip -9 {} \;
```

**Prevenção (Implementada):**
```bash
# Workflow valida espaço em disco antes do deploy
AVAILABLE=$(df -h /opt/alice | tail -1 | awk '{print $4}' | sed 's/G//')
if [ "$AVAILABLE" -lt 50 ]; then
  echo "❌ ERRO: Menos de 50GB disponíveis"
  exit 1
fi
```

---

### Failure Mode #5: Networks Docker Faltando (Containers Não Se Comunicam)

**Sintoma:**
```
Container: alice-auth ou alice-chat
Status: unhealthy
Log: Error: connect ECONNREFUSED postgres:5432
```

**Causa Raiz:**
- Networks Docker externas não criadas (`alice-network`, `erpnext-network`)
- Docker Compose espera networks externas (`external: true`)
- Containers não conseguem se comunicar

**Solução (Implementada em v5.0):**
```bash
# Script prepare-production-server.sh cria networks automaticamente
docker network create --driver bridge --subnet 172.28.0.0/16 alice-network 2>/dev/null || true
docker network create --driver bridge erpnext-network 2>/dev/null || true
```

**Como Validar:**
```bash
# Verificar networks existem
docker network ls | grep -E "alice-network|erpnext-network"

# Inspecionar network alice-network
docker network inspect alice-network

# Verificar containers conectados
docker network inspect alice-network | grep -A5 "Containers"

# Recriar network (se necessário)
docker network rm alice-network
docker network create --driver bridge --subnet 172.28.0.0/16 alice-network
```

**Como Corrigir Manualmente:**
```bash
# SSH no servidor
# 1. Criar networks
docker network create --driver bridge --subnet 172.28.0.0/16 alice-network
docker network create --driver bridge erpnext-network

# 2. Verificar criação
docker network ls

# 3. Reconectar containers (se necessário)
cd /opt/alice/app/infra/docker/stacks
docker compose -f docker-compose.base.yml -f docker-compose.infra.yml -p alice-infra down
docker compose -f docker-compose.base.yml -f docker-compose.infra.yml -p alice-infra up -d
```

---

### Matriz de Decisão - Troubleshooting Rápido

| Sintoma | Failure Mode | Ação Imediata |
|---------|--------------|---------------|
| Browser: ERR_TOO_MANY_REDIRECTS | #1 - Grafana | Verificar `GF_SECURITY_COOKIE_SECURE` |
| PostgreSQL: data directory has invalid permissions | #2 - Permissões | `sudo chown -R 999:999 /opt/alice/data/postgres` |
| Caddy: adapting config error | #3 - Caddyfile | `caddy validate --config Caddyfile` |
| PostgreSQL: No space left on device | #4 - Disco | `df -h /opt/alice` + limpar backups |
| Container: ECONNREFUSED postgres:5432 | #5 - Networks | `docker network create alice-network` |

---

### Logs Úteis para Diagnóstico

```bash
# PostgreSQL
docker logs alice-postgres --tail 100

# Grafana
docker logs grafana --tail 100

# Caddy
docker logs alice-caddy --tail 100

# Todos os containers unhealthy
docker ps -a --filter health=unhealthy

# Verificar uso de recursos
docker stats --no-stream

# Verificar eventos Docker (últimos 1h)
docker events --since 1h

# Verificar permissões críticas
ls -ld /opt/alice/data/{postgres,grafana,prometheus}

# Verificar networks
docker network ls
docker network inspect alice-network
```

---

*Seção de Troubleshooting 5 Failure Modes adicionada em: 07 de Janeiro de 2026*
*Correção Enterprise PostgreSQL Permissions (3 Fases) adicionada em: 09 de Janeiro de 2026*
*Autor: Fillipe Guerra*
*Versão: 9.1 - Enterprise PostgreSQL Permissions + Resilient Architecture*
