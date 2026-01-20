# Alice - Plataforma Enterprise de IA Autônoma

**Autor:** Fillipe Guerra  
**Data:** 18 de Janeiro de 2026  
**Versão:** 7.38 - Correções RBAC cache e queries dinâmicas

<div align="center">

![Alice Logo](https://img.shields.io/badge/Alice-IA%20Enterprise-blue?style=for-the-badge&logo=robot&logoColor=white)
![Version](https://img.shields.io/badge/versão-7.38-green?style=for-the-badge)
![License](https://img.shields.io/badge/licença-Proprietária-red?style=for-the-badge)
![LLM](https://img.shields.io/badge/LLM-Qwen2.5%207B-purple?style=for-the-badge)

**Plataforma de IA autônoma multimodal 100% self-hosted com LLM próprio**

[Documentação](#documentação) | [Início Rápido](#início-rápido) | [Arquitetura](#arquitetura) | [Deploy](#deploy)

</div>

---

## Visão Geral

**Alice** é uma plataforma enterprise de IA autônoma pronta para produção, **especializada em Finanças, Trading e Gestão Financeira**. Utiliza o LLM **Qwen2.5 7B (vLLM AWQ)** hospedado em infraestrutura própria (Hetzner GPU Server GEX44 - RTX 4000 Ada 20GB), com Vision e geração de imagens via OpenAI.

### Capacidades Principais

| Capacidade | Descrição |
|------------|-----------|
| **IA 100% Autônoma** | LLM próprio (Qwen2.5 7B vLLM AWQ) hospedado em servidor Hetzner GPU GEX44 (RTX 4000 Ada 20GB) |
| **Chat em Tempo Real** | Conversação via WebSocket com streaming de tokens |
| **Análise de Imagens** | OpenAI Vision (gpt-4.1) para gráficos, documentos, screenshots |
| **Deduplicação Semântica** | SemHash para filtragem de dados duplicados no treinamento |
| **Multi-tenant** | Suporte a múltiplas organizações com agentes IA especializados |
| **RAG Agentic** | Busca híbrida (interna + Brave Search) com classificador inteligente |
| **Enterprise RBAC** | Controle de acesso granular com 6 roles hierárquicas |
| **Gestão de Usuários/Grupos/Permissões** | Painel dedicado com CRUD e atribuição por role |
| **Governança do Core** | Permissão `admin:alice_core:write` para editar prompts centrais |
| **Observabilidade LLM** | Prometheus, Grafana, Jaeger, Langfuse para métricas específicas |
| **Auto-aprendizado** | QLoRA semanal (domingo 3:00 AM) com dados aprovados |

### Diferenciais

| Benefício | Descrição |
|-----------|-----------|
| **Autonomia Total** | Controle completo sobre modelo e inferência |
| **Privacidade** | Dados nunca saem da sua infraestrutura |
| **Custo Previsível** | LLM local sem cobrança por token; Vision/Imagens via OpenAI |
| **Customização** | Fine-tuning específico para cada cliente |
| **Disponibilidade** | LLM local resiliente; Vision depende de API OpenAI |

## Documentação principal (SSOT)

- Índice e escopo dos documentos: `docs/INDEX.md`
- Arquitetura completa: `docs/ARQUITETURA.md`
- GPU (Gate 2): `docs/ARQUITETURA-GPU-MANAGER.md`
- Deploy/CI/CD: `docs/DEPLOYMENT.md`
- Observabilidade: `docs/OBSERVABILITY.md`
- Status real atual: `docs/STATUS-REAL-ATUAL.md`
- Secrets e permissões: `docs/SECRETS.md`, `docs/PERMISSIONS.md`

## Arquitetura (resumo)

- **Gate 2**: LLM local (Qwen2.5 7B) + Vision/Imagens via OpenAI.
- **GPU local**: LLM + Embeddings + ASR (always-on) com budget 20GB.
- **RBAC**: painel de usuários/grupos/permissões e controle de Core via `admin:alice_core:write`.
- **Deploy**: multi-stack modular com rollback cirúrgico.

Para detalhes completos de arquitetura, pipeline e deploy, utilize os documentos SSOT acima.

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
| Deploy INFRA/OBSERVABILITY/ERPNEXT/BACKUP | 4 stacks standard | **~10min** |
| Deploy ALICE | Stack com GPU images | **~20-25min** |
| Rollback | Stack específico | **Cirúrgico** 🎯 |

> **OTIMIZAÇÃO COMPLETA (12/01/2026):** **TODAS AS 3 IMAGENS GPU** migradas de `pytorch-devel` para `pytorch-runtime`:
> - **embeddings-gpu**: 17.6GB → ~11GB (-6GB)
> - **asr-canary**: 17GB → ~11GB (-6GB)  
> - **lora-trainer**: 17GB → ~11GB (-6GB)
> 
> **Resultado:** Economia total de **18GB (-35%)**, download **50x mais rápido**, Deploy ALICE reduzido de **~40min para ~20-25min**. Timeout configurado: command_timeout=45m (margem), job timeout=50m.

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
 - Windows (PowerShell): chave em `C:\Users\filli\.ssh\alice-deploy` e config em `C:\Users\filli\.ssh\config`
 - Windows (comando direto): `ssh -i C:\Users\filli\.ssh\alice-deploy root@178.63.41.108`

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

Consulte `docs/INDEX.md` para o mapa completo de SSOT e links oficiais.

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

*Performance: HTTP Compression (gzip), HTTP/3 (Caddy), SHA Pinning 95%+*
*PostgreSQL: HNSW indexes + 10 índices compostos + 12 tabelas Trading com RLS*
*Storage: Servidor GEX44 1.92TB interno (/opt/alice) - SEM S3 externo*
*ARQUITETURA ENTERPRISE: Texto 1024 dim Qwen3-Embedding-0.6B (Qdrant) | Imagem: OpenAI Vision → descrição → embeddings de texto (Qdrant)*
*Trading BTC Futures: KuCoin Perpetuals + Indicadores Técnicos Determinísticos + Validação Cruzada Anti-Alucinação*
*LLM: Qwen2.5 7B (vLLM AWQ) via Hetzner GPU Server GEX44 (RTX 4000 Ada 20GB) - Texto*
*GPU Services (Gate 2): LLM (Qwen2.5 7B), Embeddings Qwen3-Embedding-0.6B INT8 (1024 dim), ASR Canary-1B - gerenciados pelo GPU Manager Service. Vision/Imagens via OpenAI*
*Pipeline Enterprise (06/01/2026): Release (`release.yml`) → Deploy Modular (`deploy-stack-modular.yml` - 5 stacks independentes ~10min)*
*Rollback Cirúrgico: Só reverte stack com falha, outros continuam funcionando 100%*

</div>

<!-- Teste CI/CD 30/12/2025 - verificando se apenas CI inicia ou se Deploy também dispara -->
