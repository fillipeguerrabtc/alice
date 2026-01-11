# Alice - Plataforma Enterprise de IA Autônoma

**Autor:** Fillipe Guerra  
**Data:** 11 de Janeiro de 2026  
**Versão:** 7.0 - Arquitetura GPU v4.0.0 (Qwen2.5-VL + INT8 Embeddings)

<div align="center">

![Alice Logo](https://img.shields.io/badge/Alice-IA%20Enterprise-blue?style=for-the-badge&logo=robot&logoColor=white)
![Version](https://img.shields.io/badge/versão-6.0-green?style=for-the-badge)
![License](https://img.shields.io/badge/licença-Proprietária-red?style=for-the-badge)
![LLM](https://img.shields.io/badge/LLM-Qwen2.5--VL%207B-purple?style=for-the-badge)

**Plataforma de IA autônoma multimodal 100% self-hosted com LLM próprio**

[Documentação](#documentação) | [Início Rápido](#início-rápido) | [Arquitetura](#arquitetura) | [Deploy](#deploy)

</div>

---

## Visão Geral

**Alice** é uma plataforma enterprise de IA autônoma pronta para produção, **especializada em Finanças, Trading e Gestão Financeira**. Utiliza o modelo multimodal **Qwen2.5-VL 7B (vLLM AWQ)** hospedado em infraestrutura própria (Hetzner GPU Server GEX44 - RTX 4000 Ada 20GB), garantindo 100% de autonomia sem dependência de APIs externas como OpenAI ou Anthropic.

### Capacidades Principais

| Capacidade | Descrição |
|------------|-----------|
| **IA 100% Autônoma** | LLM próprio (Qwen2.5-VL 7B vLLM AWQ) hospedado em servidor Hetzner GPU GEX44 (RTX 4000 Ada 20GB) |
| **Chat em Tempo Real** | Conversação via WebSocket com streaming de tokens |
| **Análise de Imagens** | Vision nativo via Qwen2.5-VL (análise de gráficos, documentos, screenshots) |
| **Deduplicação Semântica** | SemHash para filtragem de dados duplicados no treinamento |
| **Multi-tenant** | Suporte a múltiplas organizações com agentes IA especializados |
| **RAG Agentic** | Busca híbrida (interna + Brave Search) com classificador inteligente |
| **Enterprise RBAC** | Controle de acesso granular com 6 roles hierárquicas |
| **Observabilidade LLM** | Prometheus, Grafana, Jaeger, Langfuse para métricas específicas |
| **Auto-aprendizado** | QLoRA semanal (domingo 3:00 AM) com dados aprovados |

### Diferenciais

| Benefício | Descrição |
|-----------|-----------|
| **Autonomia Total** | Controle completo sobre modelo e inferência |
| **Privacidade** | Dados nunca saem da sua infraestrutura |
| **Custo Previsível** | Sem cobrança por token de terceiros |
| **Customização** | Fine-tuning específico para cada cliente |
| **Disponibilidade** | Sem dependência de SLAs externos |

> **🚀 ATUALIZAÇÃO ENTERPRISE v3.0.0 (06/01/2026) - Pipeline CI/CD:**  
> Pipeline CI/CD enterprise completo com deploy modular em 5 stacks independentes.
> 
> **Release Consolidado (`release.yml`):**
> - ✅ Build de 17 imagens Docker (12 microservices + 5 GPU)
> - ✅ Retag inteligente (diff analysis - só builda o que mudou)
> - ✅ Cache GHCR por imagem (máxima eficiência BuildKit)
> - ✅ Smoke test PostgreSQL + pgvector (detecta SIGILL/AVX-512 antes do deploy)
> - ✅ Jobs: `create-release` → `build-images` → `trigger-deploy`
> - ✅ Dispara automaticamente `deploy-stack-modular.yml` após sucesso
> 
> **Deploy Modular v3 (`deploy-stack-modular.yml`):**
> - ✅ 5 stacks independentes (INFRA, ALICE, OBSERVABILITY, ERPNEXT, BACKUP)
> - ✅ Paralelização real: INFRA → (ALICE + OBSERVABILITY + ERPNEXT + BACKUP em paralelo)
> - ✅ Rollback cirúrgico (só reverte stack com falha, outros continuam funcionando)
> - ✅ Produção parcial real (ERPNext falha → Alice continua 100% operacional)
> - ✅ Isolamento via Docker Compose projects (`-p alice-{stack}`)
> - ✅ External networks/volumes compartilhados (dados preservados entre deploys/rollbacks)
> - ✅ Health checks completos (50 containers verificados com retry logic 30-45x)
> 
> **Performance:**
> - Deploy v2 (sequencial): 5 stacks em série = ~30min
> - Deploy v3 (modular): 5 stacks em paralelo = **~10min** ⚡
> 
> **Workflows Ativos:**
> - `.github/workflows/release.yml` ⭐ (Release & Tag - dispara builds e deploy)
> - `.github/workflows/deploy-stack-modular.yml` (Deploy - Production Modular)

> **🧠 SMART DEPLOY v6.2 (09/01/2026) - Deploy Modular Inteligente:**  
> Implementado deploy inteligente que detecta stacks healthy e pula desnecessariamente.
> 
> **Funcionalidades:**
> - ✅ Detecta automaticamente estado de cada stack no servidor de produção
> - ✅ Pula stacks já healthy (economiza tempo, preserva dados)
> - ✅ Deploy cirúrgico apenas dos stacks que precisam
> - ✅ Força deploy de stack específico se selecionado manualmente
> 
> **Uso:**
> ```bash
> # Deploy inteligente - pula stacks healthy
> gh workflow run deploy-stack-modular.yml -f stack=all -f version=v3.8.9 -f smart_deploy=true
> 
> # Força deploy de stack específico mesmo se healthy
> gh workflow run deploy-stack-modular.yml -f stack=alice -f version=v3.8.9 -f smart_deploy=true
> ```
> 
> **Bug Fixes PR#96:**
> - ✅ pgBackRest: Removido `PGBACKREST_PG1_HOST` que forçava SSH (erro: "unable to execute 'ssh'")
> - ✅ Vector: Corrigido healthcheck (Alpine não tem bash, usa nc)
> - ✅ Outputs: Corrigido referência de steps (server-health → parse-health)
> - ✅ Rollbacks: Corrigido validação Docker filter (não suporta regex ^$)
> 
> **Arquitetura Redis Enterprise:**
> - INFRA: `alice-redis` (7.4.7-alpine) - Cache Alice
> - ERPNEXT: `erpnext-redis-cache` + `erpnext-redis-queue` (6.2.21-alpine) - Cache/Filas ERPNext

> **🔧 SSOT PERMISSIONS v6.3 (09/01/2026) - Single Source of Truth:**  
> Implementado sistema SSOT (Single Source of Truth) para gestão centralizada de permissões.
> 
> **Problema Resolvido:**
> - ❌ Dois scripts (`prepare-production-server.sh`, `fix-production-permissions.sh`) com valores diferentes
> - ❌ Inconsistências: langfuse-db (755 vs 700), caddy (700 vs 755), backups (750 vs 755)
> - ❌ Validação falhava sempre por inconsistência entre scripts
> 
> **Solução Enterprise:**
> - ✅ **SSOT**: `infra/scripts/permissions-config.sh` centraliza TODOS os UIDs/GIDs/permissões
> - ✅ **Zero Duplicação**: `prepare-production-server.sh` delega para `fix-production-permissions.sh`
> - ✅ **Bits Especiais**: Detecta e remove setuid/setgid/sticky bits (chmod 0755 com prefixo 0)
> - ✅ **Validação Recursiva**: Verifica ownership de TODOS os arquivos/diretórios
> - ✅ **Documentação**: `docs/PERMISSIONS.md` documenta todo o sistema
> 
> **Arquitetura:**
> ```
> permissions-config.sh (SSOT)
>          ↓
>     ┌────────────────────────────┬──────────────────────────────────┐
>     ↓                            ↓                                  ↓
> prepare-production-server.sh  fix-production-permissions.sh  (scripts futuros)
> ```
> 
> **Referências:** `docs/PERMISSIONS.md`, `docs/DEPLOYMENT.md` (Seção 8.2)

> **📦 TARBALL DEPLOY v6.4 (09/01/2026) - Transferência Atômica de Scripts:**  
> Implementada transferência de scripts SSOT via tarball para garantir consistência.
> 
> **Problema Resolvido:**
> - ❌ Scripts SSOT não eram transferidos para o servidor antes da execução
> - ❌ Tentativa de baixar via curl falhava (tag não existe durante deploy)
> - ❌ `prepare-production-server.sh` falhava: "fix-production-permissions.sh não encontrado"
> 
> **Solução Enterprise:**
> - ✅ **Tarball Atômico**: Empacota todos os scripts em `alice-scripts.tar.gz`
> - ✅ **Transferência SCP**: Envia tarball para `/tmp/` no servidor
> - ✅ **Extração Segura**: Extrai em `/tmp/scripts/` com chmod +x
> - ✅ **Validação Dupla**: Valida antes de empacotar E antes de executar
> 
> **Fluxo:**
> ```
> GitHub Runner (Local)           Servidor Produção (Hetzner)
> ┌─────────────────────┐         ┌─────────────────────────┐
> │ 1. Validar scripts  │         │                         │
> │ 2. tar czf tarball  │ ──SCP──▶│ 3. tar xzf → /tmp/scripts/
> │                     │         │ 4. Validar scripts      │
> │                     │         │ 5. Executar com sudo    │
> └─────────────────────┘         └─────────────────────────┘
> ```
> 
> **Benefícios:**
> - ✅ Não depende de tag existir no GitHub
> - ✅ Transferência atômica (tudo ou nada)
> - ✅ Preserva paths relativos dos scripts
> - ✅ Comprimido (gzip reduz tempo)
> 
> **REF:** CLAUDE.md Regra 2 (Não duplicar), Regra 6 (Enterprise-grade), Regra 9 (Validação contínua)

> **🛡️ CORREÇÃO CRÍTICA v6.1 (09/01/2026) - PostgreSQL Permissions Enterprise:**  
> Implementada correção de 3 fases para resolver "container alice-postgres is unhealthy" em servidor limpo.
> 
> **FASE 1: Correção Crítica (Bloqueador)**
> - ✅ Preparação inline do diretório PostgreSQL ANTES do `docker compose up`
> - ✅ Teste de escrita REAL via Docker (`docker run --user 70:70 -v ... touch`)
> - ✅ Validação de ownership (70:70 Alpine) e permissions (700)
> - ✅ Eliminação de race condition entre `prepare` e `deploy-infra`
> 
> **FASE 2: Defesa em Profundidade**
> - ✅ `entrypoint-wrapper.sh` no container PostgreSQL para fail-fast
> - ✅ Validação de PGDATA, existência de diretório, gravabilidade
> - ✅ Mensagens de erro claras com diagnóstico automático e comandos de correção
> 
> **FASE 3: Arquitetura Resiliente**
> - ✅ Job `prepare-infrastructure` dedicado no workflow
> - ✅ Validação completa do servidor (IP, GPU, Docker, disco)
> - ✅ Criação atômica de diretórios via SSOT (`permissions-config.sh`)
> - ✅ Healthcheck PostgreSQL com estágio 0 (`pgrep -x postgres`)
> 
> **NOTA (08/01/2026):** PostgreSQL migrou de Debian (UID 999) para Alpine (UID 70) por CVE-2023-45853.

> **Atualização 28/12/2025:** Pipeline 100% self-hosted com **Runner Enterprise Hardening** (Hetzner CPX32 - 4 vCPU AMD EPYC, 8GB RAM). Otimizações aplicadas: Kernel tuning (net.core.rmem_max=16MB, vm.swappiness=10), Docker daemon (BuildKit, max-downloads=10, GC=20GB), limits (nofile=1048576), systemd (NODE_OPTIONS=6GB, Nice=-5), cron cleanup diário. GPU dedicada Hetzner GEX44 (RTX 4000 Ada 20GB) 24/7 - containers Docker rodam continuamente, sem cold start.

> **Server GPU Optimizations 28/12/2025:** Servidor de produção otimizado para máxima performance GPU. **Docker:** default-runtime nvidia, live-restore, BuildKit GC. **NVIDIA:** Persistence Mode ENABLED (sem cold start), CDI configurado, Container Toolkit 1.18.1. **Kernel:** vm.swappiness=10, vm.dirty_ratio=40, shmmax=64GB (CUDA), buffers rede 16MB. **Hardware:** RTX 4000 Ada 20GB, Driver 580.95.05, CUDA 13.0.

---

## Arquitetura

### Diagrama de Alto Nível

```
┌─────────────────────────────────────────────────────────────────────┐
│                         DESENVOLVIMENTO (Cursor IDE)                 │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐                        │
│  │ Frontend  │  │ Serviços  │  │PostgreSQL │                        │
│  │ React     │  │ Node.js   │  │ + pgvector│                        │
│  └───────────┘  └───────────┘  └───────────┘                        │
└───────────────────────────────────┬─────────────────────────────────┘
                                    │ Git Push
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    GITHUB ACTIONS CI/CD (Modular v3)                 │
│  CI → Release Matrix → Deploy Modular → Health Check → Rollback     │
└───────────────────────────────────┬─────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  PRODUÇÃO (Hetzner GPU Server - Nuremberg)           │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │    GPU Server GEX44 (RTX 4000 Ada 20GB, 64GB DDR4, 1.92TB NVMe)  ││
│  │    IP: 178.63.41.108 | Domínio: yesyoudeserve.duckdns.org      ││
│  │  ┌─────────┐ ┌───────┐ ┌───────┐ ┌─────────┐ ┌───────────┐     ││
│  │  │  Caddy  │ │ Auth  │ │ Chat  │ │   RAG   │ │ Training  │     ││
│  │  │ Gateway │ │:3001  │ │:3002  │ │  :3003  │ │  :3004    │     ││
│  │  └─────────┘ └───────┘ └───────┘ └─────────┘ └───────────┘     ││
│  │  ┌─────────────┐ ┌─────────────────────────────────────────┐   ││
│  │  │Integrations │ │         OBSERVABILITY STACK             │   ││
│  │  │   :3005     │ │ Prometheus │ Grafana │ Jaeger │ Langfuse│   ││
│  │  └─────────────┘ └─────────────────────────────────────────┘   ││
│  │  ┌─────────────────────────────────────────────────────────┐   ││
│  │  │              GPU SERVICES (Localhost) v4.0.0             │   ││
│  │  │  GPU Manager │ Qwen2.5-VL │ Embeddings INT8 │ ASR       │   ││
│  │  └─────────────────────────────────────────────────────────┘   ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

### Arquitetura Multi-Stack Modular - 50 Containers em Produção

> **ATUALIZAÇÃO 05/01/2026:** Arquitetura refatorada para **5 stacks independentes** com deploy/rollback modular.

A plataforma Alice é composta por **50 containers** organizados em **5 stacks independentes** (todos rodando no servidor Hetzner GPU único):

#### Arquitetura de Stacks (Deploy Independente)

| Stack | Containers | Propósito | Rollback |
|-------|------------|-----------|----------|
| **INFRA** | 10 | PostgreSQL, Redis, Qdrant, Caddy, MinIO | Independente |
| **ALICE** | 8 + 4 GPU | Microsserviços core + GPU Manager | Independente |
| **OBSERVABILITY** | 13 | Prometheus, Grafana, Loki, Jaeger, Langfuse | Independente |
| **ERPNEXT** | 15 | ERP/CRM completo (100% isolado) | Independente |
| **BACKUP** | 1 | pgBackRest enterprise | Independente |

**Benefícios da Arquitetura Multi-Stack:**
- ✅ **Produção Parcial**: Alice funciona mesmo se ERPNext falhar
- ✅ **Rollback Cirúrgico**: Reverter apenas o stack com problema
- ✅ **Deploy Independente**: Atualizar Observability sem downtime de Alice
- ✅ **Isolamento de Falhas**: Problema em um stack não afeta outros

#### Categoria 1: Infraestrutura Core (7 serviços)

| # | Serviço | Container | Descrição |
|---|---------|-----------|-----------|
| 1 | Caddy Gateway | `alice-caddy` | Reverse proxy com SSL automático + HTTP/3 (substitui Traefik) |
| 2 | pgBackRest Init | `alice-pgbackrest-init` | Inicializador de stanza para backup (init container) |
| 3 | PostgreSQL | `alice-postgres` | Banco principal com pgvector, RLS e entrypoint-wrapper para validação de permissões |
| 4 | Alice Redis | `alice-redis` | Cache distribuído (Redis 8.4 - node-redis 5.x) |
| 5 | Qdrant | `alice-qdrant` | Banco vetorial para texto (4096 dim, HNSW index) |
| 6 | SearXNG | `alice-searxng` | Metabusca interna (Web Search) |
| 7 | Tor Proxy | `alice-tor` | Proxy SOCKS5 para engines .onion |

#### Categoria 2: Microsserviços Alice (7 serviços)

| # | Serviço | Container | Porta | Descrição |
|---|---------|-----------|-------|-----------|
| 8 | Frontend | `alice-frontend` | 5000 | React 18 + Vite 7.3 + shadcn/ui |
| 9 | Auth Service | `alice-auth` | 3001 | OAuth 2.0, SAML 2.0, RBAC 6 níveis |
| 10 | Chat Service | `alice-chat` | 3002 | WebSocket streaming + LLM via GPU Manager |
| 11 | RAG Service | `alice-rag` | 3003 | pgvector + embeddings + busca semântica |
| 12 | Training Service | `alice-training` | 3004 | Fine-tuning + self-learning |
| 13 | Integrations | `alice-integrations` | 3005 | Stripe, Wise, Twilio, Gmail SMTP, KuCoin Futures |
| 14 | Observability | `alice-observability` | 3007 | Prometheus, Grafana, Jaeger, Backup |

> **NOTA (02/01/2026):** Caddy (`alice-caddy`) substitui Traefik como API Gateway. Vantagens: SSL automático com retry inteligente, HTTP/3 nativo, footprint 40MB (vs 100MB Traefik), configuração declarativa via Caddyfile. Embeddings 100% via GPU Manager Service local (Qwen3-Embedding-8B 4096 dim + OpenCLIP 1024 dim).

#### Categoria 3: ERPNext Stack (15 serviços)

| # | Serviço | Container | Descrição |
|---|---------|-----------|-----------|
| 15 | MariaDB | `erpnext-mariadb` | Banco de dados ERPNext |
| 16 | Redis Cache | `erpnext-redis-cache` | Cache ERPNext (Redis 6.2 - compatibilidade v15) |
| 17 | Redis Queue | `erpnext-redis-queue` | Fila ERPNext (Redis 6.2 - compatibilidade v15) |
| 18 | Configurator | `erpnext-configurator` | Configurador Frappe Bench (init) |
| 19 | Create Site | `erpnext-create-site` | Criador do site ERPNext (init) |
| 20 | Backend | `erpnext-backend` | Backend Python Frappe |
| 21 | Frontend | `erpnext-frontend` | Frontend NGINX |
| 22 | WebSocket | `erpnext-websocket` | Socket.io real-time |
| 23 | Scheduler | `erpnext-scheduler` | Tarefas periódicas |
| 24 | Worker Default 1 | `erpnext-worker-default` | Jobs normais (instância 1) |
| 25 | Worker Short 1 | `erpnext-worker-short` | Jobs rápidos (instância 1) |
| 26 | Worker Long 1 | `erpnext-worker-long` | Jobs longos (instância 1) |
| 27 | Worker Default 2 | `erpnext-worker-default-2` | Jobs normais (instância 2) |
| 28 | Worker Short 2 | `erpnext-worker-short-2` | Jobs rápidos (instância 2) |
| 29 | Worker Long 2 | `erpnext-worker-long-2` | Jobs longos (instância 2) |

#### Categoria 4: Observability Stack (13 serviços)

| # | Serviço | Container | Descrição |
|---|---------|-----------|-----------|
| 30 | Langfuse Web | `langfuse` | LLM observability e analytics |
| 31 | Langfuse Worker | `langfuse-worker` | Processamento assíncrono (migrations/jobs) |
| 32 | Langfuse DB | `alice-langfuse-db` | PostgreSQL dedicado Langfuse |
| 33 | Prometheus | `prometheus` | Coleta e armazenamento de métricas |
| 34 | Grafana | `grafana` | Dashboards e visualizações |
| 35 | Loki | `loki` | Agregação e armazenamento de logs |
| 36 | Promtail | `promtail` | Coleta de logs do host |
| 37 | Jaeger | `jaeger` | Distributed tracing |
| 38 | Vector | `alice-vector` | Agregação de logs → Loki |
| 39 | OTel Collector | `alice-otel-collector` | Instrumentação OpenTelemetry |
| 40 | Node Exporter | `alice-node-exporter` | Métricas do host Linux |
| 41 | cAdvisor | `alice-cadvisor` | Métricas de containers Docker |

> **NOTA**: Alertmanager foi removido em 01/01/2026 e substituído pelo **Grafana Alerting**.

#### Categoria 5: GPU Services (4 serviços) - Arquitetura v4.0.0

| # | Serviço | Container | Descrição |
|---|---------|-----------|-----------|
| 42 | GPU Manager Service | `gpu-manager-service` | Gerenciamento centralizado de requisições GPU (fila priorizada, VRAM monitoring, circuit breakers) |
| 43 | GPU Qwen-VL (LLM + Vision) | `gpu-qwen-vl` | Qwen2.5-VL 7B AWQ para chat, trading e análise de gráficos (multimodal) |
| 44 | GPU Embeddings | `gpu-embeddings` | Qwen3-Embedding-8B INT8 (texto) + OpenCLIP ViT-H/14 (imagem) |
| 45 | GPU ASR | `gpu-asr` | Canary-1B (NeMo) para transcrição de áudio |

#### Categoria 6: Backup (1 serviço)

| # | Serviço | Container | Descrição |
|---|---------|-----------|-----------|
| 48 | pgBackRest | `alice-pgbackrest` | Backup enterprise PostgreSQL (PITR, WAL, AES-256) |

---

## Início Rápido

### Pré-requisitos

- Node.js 22 LTS
- PostgreSQL 16+ com pgvector
- pnpm 10.26.1+
- Docker (para produção)

### Desenvolvimento (Cursor IDE)

> **Padronização de Edição (Enterprise 2025):** O repositório usa `.gitattributes` + `.editorconfig` para padronizar line endings (**LF** para texto; **CRLF** apenas para scripts Windows) e evitar diffs ruidosos.

```bash
# 1. Instalar dependências
pnpm install

# 2. Iniciar em modo desenvolvimento
pnpm run dev
```

O servidor iniciará automaticamente em `http://localhost:5000`.

### Credenciais de Administrador (3 Sistemas Independentes)

A plataforma possui **3 sistemas independentes** que requerem credenciais de admin **obrigatórias e separadas**:

| Sistema | Username | Secret da Senha | Requisitos |
|---------|----------|-----------------|------------|
| **Alice Auth Service** | `ADMIN_USER` (email obrigatório) | `ADMIN_PWD` | Email válido (ex: admin@dominio.com), senha mín. 8 chars |
| **Grafana 12** | `GRAFANA_ADMIN_USER` (qualquer string) | `GRAFANA_ADMIN_PASSWORD` | Username customizável, senha recomendada 8+ chars |
| **ERPNext 15** | `Administrator` (fixo) | `ERPNEXT_ADMIN_PASSWORD` | Username não pode mudar (Frappe Framework), senha mín. 8 chars |

### SSO 100% Automatizado (31/12/2025)

O deploy configura SSO automaticamente - **não é necessário nenhum passo manual**:

| Secret Pré-Definido | Propósito |
|---------------------|-----------|
| `GRAFANA_OAUTH_CLIENT_SECRET` | OAuth para Grafana → Alice IdP |
| `ERPNEXT_OAUTH_CLIENT_SECRET` | OAuth para ERPNext → Alice IdP |

**Fluxo pós-deploy:**
1. ✅ Grafana exibe botão "Login com Alice Enterprise" automaticamente
2. ✅ ERPNext pode usar SSO via Alice (requer ativação no painel admin)
3. ✅ Admins locais funcionam como fallback de emergência

### Variáveis de Ambiente

Consulte [docs/SECRETS.md](docs/SECRETS.md) para a lista completa de secrets necessários.

---

## Deploy

### Ambientes

| Ambiente | Plataforma | Descrição |
|----------|------------|-----------|
| **Desenvolvimento** | Cursor IDE | IDE, hot reload, debugging, AI-assisted |
| **Produção** | Hetzner Cloud GEX44 | Intel Core i5-13500 14 Core, 64GB DDR4 RAM, 2x 1.92TB NVMe SSD (RAID 1) |

### Volume Persistente (alice-data)

| Diretório | Propósito |
|-----------|-----------|
| `/opt/alice/data` | Dados PostgreSQL, MariaDB, Redis |
| `/opt/alice/uploads` | Uploads RAG (imagens, áudios e documentos) |
| `/opt/alice/backups` | Backups locais (pgBackRest, MariaDB, Redis) |

### Pipeline CI/CD Enterprise Modular v3.0.0 (06/01/2026)

**Arquitetura completa seguindo melhores práticas oficiais GitHub Actions 2025:**

```
┌────────────────────────────────────────────────────────────────────┐
│ FASE 1: CI (Validação)                                             │
│  Push → Typecheck + ESLint + Build + Security Scan (Trivy)        │
│  Tempo: ~3min                                                      │
└───────────────────────────────┬────────────────────────────────────┘
                                │ Se passar
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│ FASE 2: RELEASE MODULAR (Matrix Strategy)                         │
│                                                                    │
│  ┌──────────────┐    ┌─────────────────────────────────────────┐ │
│  │  validate    │───→│  analyze-changes (diff desde tag ant.) │ │
│  └──────────────┘    └──────────────┬──────────────────────────┘ │
│                                     │                             │
│                      ┌──────────────┴───────────────┐             │
│                      │                              │             │
│            ┌─────────▼────────┐          ┌─────────▼────────┐    │
│            │ build-microservices│          │   build-gpu      │    │
│            │ Matrix (12 jobs)  │          │ Matrix (5 jobs)  │    │
│            │ Paralelo 5-7min   │          │ Paralelo 5-7min  │    │
│            └─────────┬────────┘          └─────────┬────────┘    │
│                      └──────────┬───────────────────┘             │
│                                 ▼                                 │
│                        ┌────────────────┐                         │
│                        │  smoke-test    │                         │
│                        │ PostgreSQL+pgv │                         │
│                        └────────┬───────┘                         │
│                                 ▼                                 │
│                        ┌────────────────┐                         │
│                        │publish-release │                         │
│                        │ GitHub Release │                         │
│                        └────────┬───────┘                         │
│                                 ▼                                 │
│                        ┌────────────────┐                         │
│                        │ trigger-deploy │                         │
│                        └────────────────┘                         │
│  Tempo total: ~5-7min (vs ~34min v2)                             │
└───────────────────────────────┬────────────────────────────────────┘
                                │
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│ FASE 3: DEPLOY MODULAR (Jobs Individuais)                         │
│                                                                    │
│  ┌──────────────┐    ┌────────────────┐                           │
│  │   validate   │───→│    prepare     │                           │
│  └──────────────┘    └────────┬───────┘                           │
│                               │                                   │
│                        ┌──────▼─────────┐                         │
│                        │ deploy-infra   │                         │
│                        │ health-infra   │                         │
│                        └──────┬─────────┘                         │
│                               │                                   │
│                        ┌──────▼─────────┐                         │
│                        │ drizzle-push   │ (migrations)            │
│                        └──────┬─────────┘                         │
│                               │                                   │
│             ┌─────────────────┼─────────────────┬─────────────┐   │
│             │                 │                 │             │   │
│      ┌──────▼──────┐   ┌──────▼──────┐   ┌──────▼──────┐   ┌▼┐  │
│      │deploy-alice │   │deploy-observ│   │deploy-erpnext│   │B│  │
│      │health-alice │   │health-observ│   │health-erpnext│   │A│  │
│      │rollback-alie│   │rollback-obs │   │rollback-erpnx│   │C│  │
│      └─────────────┘   └─────────────┘   └─────────────┘   └─┘  │
│                                                                    │
│      PARALELO: 4 stacks independentes após infra healthy         │
│                                                                    │
│  Tempo: ~10min (vs ~30min v2)                                    │
│  Rollback: Cirúrgico (só stack com falha)                        │
└────────────────────────────────────────────────────────────────────┘
```

**Workflows Enterprise:**

| Workflow | Arquivo | Descrição | Tempo |
|----------|---------|-----------|-------|
| **CI** | `ci.yml` | Validação (typecheck, lint, build, trivy) | ~3min |
| **Release** | `release.yml` | Build imagens + Tag + GitHub Release | ~5-10min |
| **Deploy** | `deploy-stack-modular.yml` | Deploy modular (5 stacks independentes) | **~10min** |

**Características Enterprise Release (`release.yml`):**
- ✅ **Build Condicional**: Diff analysis (só builda o que mudou desde tag anterior)
- ✅ **Retag Inteligente**: Imagens sem alterações são retagged (economiza tempo)
- ✅ **Cache GHCR**: Registry cache por imagem (máxima eficiência BuildKit)
- ✅ **Smoke Test**: PostgreSQL + pgvector (detecta SIGILL/AVX-512 antes do deploy)
- ✅ **17 Imagens**: 12 microservices + 5 GPU (sequencial otimizado)
- ✅ **Disparo Automático**: Deploy disparado automaticamente após sucesso

**Características Enterprise Deploy Modular (`deploy-stack-modular.yml`):**
- ✅ **5 Stacks Independentes**: INFRA, ALICE, OBSERVABILITY, ERPNEXT, BACKUP
- ✅ **Paralelização Real**: Alice + Observability + ERPNext + Backup em PARALELO após INFRA
- ✅ **Rollback Cirúrgico**: Só reverte stack com falha (outros continuam)
- ✅ **Produção Parcial**: ERPNext falha → Alice continua 100% operacional
- ✅ **Isolamento**: Docker Compose projects (`-p alice-{stack}`)
- ✅ **External Volumes/Networks**: Dados compartilhados preservados entre deploys/rollbacks
- ✅ **Health Checks**: 50 containers verificados com retry logic (30-45x)

**Performance Pipeline Enterprise:**

| Métrica | Descrição | Tempo |
|---------|-----------|-------|
| CI | Validação (typecheck, lint, trivy) | ~3min |
| Release | Build 17 imagens + GitHub Release | ~5-10min |
| Deploy | 5 stacks em paralelo | **~10min** |
| Rollback | Stack específico | **Cirúrgico** 🎯 |

**Versionamento Semântico Automático:**
- Conventional Commits (BREAKING→MAJOR, feat→MINOR, fix→PATCH)
- Tags criadas automaticamente pelo `release.yml`
- Changelog gerado automaticamente com classificação de commits
- Retag inteligente (só builda imagens com código alterado)

**Single Source of Truth (SSOT) - Versões de Imagens:**
- Todas as versões de imagens públicas centralizadas em `infra/versions.env`
- Docker-compose files usam variáveis `${VAR:-default}` do SSOT
- Deploy valida existência de imagens públicas ANTES do deploy
- Dependabot monitora e atualiza versões automaticamente

| Stack | Variáveis Principais |
|-------|---------------------|
| INFRA | `REDIS_ALICE_VERSION`, `QDRANT_VERSION`, `SEARXNG_VERSION`, `MINIO_*` |
| OBSERVABILITY | `PROMETHEUS_VERSION`, `GRAFANA_VERSION`, `LANGFUSE_VERSION`, etc |
| ERPNEXT | `ERPNEXT_VERSION`, `MARIADB_VERSION`, `REDIS_ERPNEXT_VERSION` |

**GPU Manager Service (v4.0.0):**
- Arquitetura simplificada: todos os serviços GPU rodam simultaneamente (15GB de 20GB VRAM)
- Gerenciamento centralizado de requisições GPU (LLM, Vision, Embeddings, ASR)
- Fila priorizada (Redis) com monitoramento VRAM em tempo real (nvidia-smi)
- Circuit breakers, retry logic e métricas Prometheus
- Zero latência de troca (sem orquestração dinâmica)
- Guia completo: [docs/ARQUITETURA-GPU-MANAGER.md](docs/ARQUITETURA-GPU-MANAGER.md)

### Acesso SSH à Hetzner (Produção)

**Arquitetura de 2 Servidores (26/12/2025):**

| Servidor | Alias SSH | IP | Função |
|----------|-----------|-----|--------|
| **Deploy Server** | `alice-hetzner` | 46.224.46.93 | GitHub Actions Runner (CPX32) |
| **Production Server** | `alice-prod` | 178.63.41.108 | Aplicação + GPU |

**Configuração SSH** (`~/.ssh/config`):

```
Host alice-hetzner
    HostName 46.224.46.93
    User root
    IdentityFile ~/.ssh/alice-deploy

Host alice-prod
    HostName 178.63.41.108
    User root
    IdentityFile ~/.ssh/alice-deploy
```

- Conexão Deploy Server: `ssh alice-hetzner`
- Conexão Production Server: `ssh alice-prod`
- Permissões da chave: `chmod 600 ~/.ssh/alice-deploy`

### URLs de Produção

| Serviço | URL | Descrição |
|---------|-----|-----------|
| **Alice Frontend** | https://yesyoudeserve.duckdns.org | SPA React principal |
| **Alice Chat** | https://yesyoudeserve.duckdns.org/chat | Interface de chat (SPA route) |
| **Alice Dashboard** | https://yesyoudeserve.duckdns.org/dashboard | Painel administrativo |
| **Alice Trading** | https://yesyoudeserve.duckdns.org/trading | Interface trading BTC |
| **Alice WebSocket** | wss://yesyoudeserve.duckdns.org/ws | Streaming em tempo real |
| **ERPNext** | https://erp.yesyoudeserve.duckdns.org | ERP/CRM Frappe |
| **Grafana** | https://observability.yesyoudeserve.duckdns.org | Dashboards e alertas |
| **Prometheus** | https://metrics.yesyoudeserve.duckdns.org | Métricas e consultas |
| **Jaeger** | https://traces.yesyoudeserve.duckdns.org | Distributed tracing |
| **Langfuse** | https://langfuse.yesyoudeserve.duckdns.org | LLM observability |

Consulte [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) para instruções detalhadas.

---

## Estrutura do Projeto

```
alice/
├── apps/                           # Microserviços independentes
│   ├── frontend-service/           # React 18 + Vite 7.3 SPA
│   ├── api-gateway/                # Node.js gateway (dev only - Caddy 2.8.4 em prod)
│   ├── auth-service/               # OAuth/SAML/Local + RBAC
│   ├── chat-service/               # LLM Proxy + WebSocket
│   ├── rag-service/                # Embeddings + pgvector
│   ├── training-service/           # SemHash + Fine-tuning
│   ├── integrations-service/       # Stripe, ERPNext, Twilio
│   └── observability-service/      # Prometheus, Grafana, Jaeger, Langfuse
│
├── packages/                       # Código compartilhado
│   ├── shared/                     # Schema Drizzle ORM
│   ├── database/                   # PostgreSQL + pgvector
│   ├── shared-utils/               # Logger singleton, ShutdownManager, Express hardening
│   └── config/                     # Validação Zod
│
├── infra/                          # Infraestrutura
│   ├── docker/                     # Docker Compose
│   └── scripts/                    # Scripts de setup
│
├── docs/                           # Documentação
│   ├── DEPLOYMENT.md               # Guia de deploy
│   ├── SECRETS.md                  # Guia de secrets
│   └── SISTEMA-APRENDIZADO.md      # Sistema de auto-aprendizado
│
├── .github/
│   ├── actions/                    # Composite actions reutilizáveis
│   │   └── setup-node-pnpm/        # Setup Node.js + pnpm (elimina duplicação)
│   └── workflows/                  # CI/CD (3 workflows Enterprise)
│       ├── ci.yml                  # Validação de código (dispara release.yml)
│       ├── release.yml             # Build imagens + Tag + GitHub Release
│       └── deploy-stack-modular.yml # Deploy modular (5 stacks independentes)
│
├── client/                         # Frontend React
│   └── src/
│       ├── pages/
│       │   ├── Chat.tsx            # Interface do chat (/chat)
│       │   └── Dashboard.tsx       # Dashboard admin (/dashboard)
│       └── hooks/
│           └── use-websocket-chat.ts  # Hook WebSocket
│
└── server/
    └── index-dev.ts                # Gateway de desenvolvimento (integrações reais - sem preview/mocks)
```

---

## Tecnologias

### Frontend
- React 19.2, TypeScript 5.9.3, Vite 7.3
- TanStack Query 5.90, Wouter 3.9
- shadcn/ui, Tailwind CSS 4.1, Framer Motion 12
- react-i18next 16.5, i18next 25.7

### Backend
- Node.js 22 LTS (versão automática via API + fallback .nvmrc), Express 5.2
- TypeScript 5.9.3, pnpm 10.26.1 (versão automática via package.json)
- Drizzle ORM, PostgreSQL 16 + pgvector
- WebSocket (ws), Pino (logging estruturado)
- Passport.js, openid-client
- HTTP Compression (gzip level 6)

### Infraestrutura
- Docker, **Caddy 2.8.4** (SSL automático + HTTP/3 nativo)
- **Google Distroless** (6 serviços Node.js)
- nginx:1.27-alpine (frontend)
- GitHub Actions CI/CD (95%+ SHA pinning, composite actions reutilizáveis)
- Hetzner Cloud (Nuremberg)

### Observabilidade
- Prometheus 3.8.1 (métricas)
- Grafana OSS 12.3.1 (dashboards)
- Jaeger 2.13.0 (tracing distribuído)
- Loki 3.6.3, Promtail 3.6.3 (logs)
- OpenTelemetry Collector 0.142.0 (instrumentação)
- Langfuse 3.140.0 (métricas LLM)

---

## Documentação

| Documento | Descrição |
|-----------|-----------|
| [CLAUDE.md](CLAUDE.md) | Contexto completo do projeto e 18 regras |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Guia de deploy para produção |
| [docs/SECRETS.md](docs/SECRETS.md) | Guia de secrets e webhooks |
| [docs/STATUS-REAL-ATUAL.md](docs/STATUS-REAL-ATUAL.md) | Estado atual da plataforma |
| [docs/ARQUITETURA.md](docs/ARQUITETURA.md) | Arquitetura completa (arc42 + C4 + ADRs) |
| [docs/ARQUITETURA-GPU-MANAGER.md](docs/ARQUITETURA-GPU-MANAGER.md) | GPU Manager Service (gerenciamento centralizado) |
| [docs/SISTEMA-APRENDIZADO.md](docs/SISTEMA-APRENDIZADO.md) | Sistema de auto-aprendizado |
| [docs/VERIFICAR-RUNNER.md](docs/VERIFICAR-RUNNER.md) | Verificação e hardening do runner self-hosted |

---

## Padrões de Código

```typescript
// Logging - Logger Singleton com child loggers (console.* proibido)
import { createLogger } from '@alice/shared-utils';
const logger = createLogger('meu-servico');
logger.info({ userId }, 'Usuário autenticado');

// Graceful Shutdown
import { registerShutdownCallback, ShutdownPriority } from '@alice/shared-utils';
registerShutdownCallback('database', closeDatabasePool, { priority: ShutdownPriority.DATABASE });

// TypeScript strict - zero any
interface User { id: string; email: string; role: UserRole; }
```

---

## Licença

Proprietário - Todos os direitos reservados.

---

---

## Security Hardening (Production Audit - Dezembro 2025)

### Docker 2025 Best Practices - 100% Compliance

| Métrica | Contagem | Cobertura |
|---------|----------|-----------|
| **Resource Limits** | 51/51 containers | 100% |
| **read_only: true** | 25/51 containers | 100% aplicável (somente onde não há escrita) |
| **security_opt: no-new-privileges** | 51/51 containers | 100% |
| **Healthchecks** | 38/38 containers | 100% (3 init usam service_completed_successfully) |
| **SHA256 Digests** | 26 imagens externas únicas | 100% |
| **TypeScript strict** | Zero erros | 100% |

### Supply Chain Security (SHA256 Pinned Images)

| Imagem | Versão | Status |
|--------|--------|--------|
| **Caddy** | 2.8.4-alpine | Pinned |
| PostgreSQL | pg16 (pgvector) | Pinned |
| MariaDB | 10.11 | Pinned |
| Redis (Alice) | 7.4.7-alpine | Pinned |
| Redis (ERPNext) | 6.2.21-alpine | Pinned |
| ERPNext | v15.91.3 | Pinned |
| Vector | 0.51.1-alpine | Pinned |
| pgBackRest | 2.57.0 | Pinned |
| BusyBox | 1.37 | Pinned |

> **NOTA Redis (01/01/2026)**: Alice usa Redis 8.4 (node-redis 5.x suporta completamente). ERPNext usa Redis 6.2 (ERPNext v15 requer Redis 6.x conforme docs.frappe.io).

### Immutable Infrastructure

Todos os 50 containers têm security hardening completo aplicado. Containers que não precisam escrever (25 containers) operam com filesystem read-only + tmpfs para escrita temporária. Containers que precisam escrever (25 containers: bancos de dados, workers/init ERPNext, langfuse-worker, node-exporter, cadvisor, serviços GPU) mantêm `security_opt: no-new-privileges:true` e resource limits.

> **NOTA 01/01/2026**: Alertmanager foi substituído pelo **Grafana Alerting**. Configuração SMTP agora via variáveis de ambiente `GF_SMTP_*` no Grafana.

---

<div align="center">

**Desenvolvido para empresas que exigem IA autônoma, privada e customizável**

*Autor: Fillipe Guerra*
*Versão 6.1 - 09 de Janeiro de 2026*
*Tecnologias: Node.js 22 LTS, Express 5.2, Vite 7.3, Tailwind CSS 4.1, React 19.2, pnpm 10.26.1, TypeScript 5.9.3*
*Total de Containers: 50 (10 infra + 8 Alice + 5 GPU + 13 observability + 15 ERPNext + 1 backup)*
*Arquitetura Multi-Stack (06/01/2026): 5 stacks independentes com deploy/rollback modular v3*
*Production Audit: 100% Compliant | Zero CVEs (Distroless) | Docker Compose v5.0.0*
*Performance: HTTP Compression (gzip), HTTP/3 (Caddy), SHA Pinning 95%+*
*PostgreSQL: HNSW indexes + 10 índices compostos + 12 tabelas Trading com RLS*
*Storage: Servidor GEX44 1.92TB interno (/opt/alice) - SEM S3 externo*
*ARQUITETURA ENTERPRISE: Texto 4096 dim Qwen3-Embedding-8B (Qdrant) | Imagem 1024 dim OpenCLIP (pgvector)*
*Trading BTC Futures: KuCoin Perpetuals + Indicadores Técnicos Determinísticos + Validação Cruzada Anti-Alucinação*
*LLM: Qwen2.5-VL 7B (vLLM AWQ) via Hetzner GPU Server GEX44 (RTX 4000 Ada 20GB) - Multimodal (texto + vision)*
*GPU Services v4.0.0: Qwen2.5-VL 7B (4GB), Qwen3-Embedding-8B INT8 (8GB), Canary-1B ASR (3GB) - todos simultâneos (15GB/20GB)*
*Pipeline Enterprise (06/01/2026): Release (`release.yml`) → Deploy Modular (`deploy-stack-modular.yml` - 5 stacks independentes ~10min)*
*Rollback Cirúrgico: Só reverte stack com falha, outros continuam funcionando 100%*

</div>

<!-- Teste CI/CD 30/12/2025 - verificando se apenas CI inicia ou se Deploy também dispara -->
