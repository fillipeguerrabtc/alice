# Alice - Plataforma Enterprise de IA Autônoma

**Autor:** Fillipe Guerra  
**Data:** 26 de Dezembro de 2025

<div align="center">

![Alice Logo](https://img.shields.io/badge/Alice-IA%20Enterprise-blue?style=for-the-badge&logo=robot&logoColor=white)
![Version](https://img.shields.io/badge/versão-4.10-green?style=for-the-badge)
![License](https://img.shields.io/badge/licença-Proprietária-red?style=for-the-badge)
![LLM](https://img.shields.io/badge/LLM-Mixtral%208x7B%20vLLM-purple?style=for-the-badge)

**Plataforma de IA autônoma multimodal 100% self-hosted com LLM próprio**

[Documentação](#documentação) | [Início Rápido](#início-rápido) | [Arquitetura](#arquitetura) | [Deploy](#deploy)

</div>

---

## Visão Geral

**Alice** é uma plataforma enterprise de IA autônoma pronta para produção. Utiliza o modelo LLM **Mixtral 8x7B (MoE ~12B ativos, vLLM AWQ)** hospedado em infraestrutura própria (Hetzner GPU Server GEX44 - RTX 4000 Ada 20GB), garantindo 100% de autonomia sem dependência de APIs externas como OpenAI ou Anthropic.

### Capacidades Principais

| Capacidade | Descrição |
|------------|-----------|
| **IA 100% Autônoma** | LLM próprio (Mixtral 8x7B vLLM AWQ) hospedado em servidor Hetzner GPU GEX44 (RTX 4000 Ada 20GB) |
| **Chat em Tempo Real** | Conversação via WebSocket com streaming de tokens |
| **Geração de Imagens** | FLUX.1 Schnell self-hosted (1-3 segundos por imagem) |
| **Deduplicação Semântica** | SemHash para filtragem de dados duplicados no treinamento |
| **Multi-tenant** | Suporte a múltiplas organizações com agentes IA especializados |
| **RAG Agentic** | Busca híbrida (interna + Brave Search) com classificador inteligente |
| **Enterprise RBAC** | Controle de acesso granular com 6 roles hierárquicas |
| **Observabilidade LLM** | Prometheus, Grafana, Jaeger, Langfuse para métricas específicas |
| **Auto-aprendizado** | Progressive LoRA a cada 4 dias com dados aprovados |

### Diferenciais

| Benefício | Descrição |
|-----------|-----------|
| **Autonomia Total** | Controle completo sobre modelo e inferência |
| **Privacidade** | Dados nunca saem da sua infraestrutura |
| **Custo Previsível** | Sem cobrança por token de terceiros |
| **Customização** | Fine-tuning específico para cada cliente |
| **Disponibilidade** | Sem dependência de SLAs externos |

> **Atualização 26/12/2025:** GPU dedicada Hetzner GEX44 (RTX 4000 Ada 20GB) 24/7 - containers Docker rodam continuamente, sem cold start. Arquitetura com 2 servidores: Deploy Server (CX22) para GitHub Actions self-hosted runner + Production Server (GEX44) com GPU dedicada.

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
│                    GITHUB ACTIONS CI/CD                              │
│  Build → Push para GHCR → Deploy SSH para Hetzner (100% AUTOMÁTICO) │
└───────────────────────────────────┬─────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  PRODUÇÃO (Hetzner GPU Server - Nuremberg)           │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │    GPU Server GEX44 (RTX 4000 Ada 20GB, 64GB DDR4, 1.92TB NVMe)  ││
│  │    IP: 178.63.41.108 | Domínio: yesyoudeserve.duckdns.org      ││
│  │  ┌─────────┐ ┌───────┐ ┌───────┐ ┌─────────┐ ┌───────────┐     ││
│  │  │ Traefik │ │ Auth  │ │ Chat  │ │   RAG   │ │ Training  │     ││
│  │  │ Gateway │ │:3001  │ │:3002  │ │  :3003  │ │  :3004    │     ││
│  │  └─────────┘ └───────┘ └───────┘ └─────────┘ └───────────┘     ││
│  │  ┌─────────────┐ ┌─────────────────────────────────────────┐   ││
│  │  │Integrations │ │         OBSERVABILITY STACK             │   ││
│  │  │   :3005     │ │ Prometheus │ Grafana │ Jaeger │ Langfuse│   ││
│  │  └─────────────┘ └─────────────────────────────────────────┘   ││
│  │  ┌─────────────────────────────────────────────────────────┐   ││
│  │  │              GPU SERVICES (Localhost)                    │   ││
│  │  │  GPU Manager │ Mixtral vLLM │ FLUX │ Embeddings │ ASR   │   ││
│  │  └─────────────────────────────────────────────────────────┘   ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

### Arquitetura de Microsserviços - 50 Containers em Produção

A plataforma Alice é composta por **50 containers** organizados em 7 categorias (todos rodando no servidor Hetzner GPU único):

#### Categoria 1: Infraestrutura Core (7 serviços)

| # | Serviço | Container | Descrição |
|---|---------|-----------|-----------|
| 1 | Docker Socket Proxy | `dockerproxy` | Proxy seguro para API Docker |
| 2 | Traefik Init | `traefik-init` | Inicializador de certificados SSL |
| 3 | API Gateway | `traefik` | Gateway com SSL automático (Let's Encrypt) |
| 4 | PostgreSQL | `postgres` | Banco principal com pgvector e RLS |
| 5 | Alice Redis | `alice-redis` | Cache distribuído dedicado para Alice |
| 6 | Qdrant | `alice-qdrant` | Banco vetorial para texto (4096 dim, HNSW index) |
| 7 | SearXNG | `alice-searxng` | Metabusca interna (Web Search) |

#### Categoria 2: Microsserviços Alice (7 serviços)

| # | Serviço | Container | Porta | Descrição |
|---|---------|-----------|-------|-----------|
| 8 | Frontend | `alice-frontend` | 5000 | React 18 + Vite 7.3 + shadcn/ui |
| 9 | Auth Service | `alice-auth` | 3001 | OAuth 2.0, SAML 2.0, RBAC 6 níveis |
| 10 | Chat Service | `alice-chat` | 3002 | WebSocket streaming + LLM via GPU Manager |
| 11 | RAG Service | `alice-rag` | 3003 | pgvector + embeddings + busca semântica |
| 12 | Training Service | `alice-training` | 3004 | Fine-tuning + self-learning |
| 13 | Integrations | `alice-integrations` | 3005 | Stripe, Wise, Twilio, Resend, KuCoin Futures |
| 14 | Observability | `alice-observability` | 3007 | Prometheus, Grafana, Jaeger, Backup |

> **NOTA:** O Traefik (`alice-traefik`) atua como API Gateway em produção. Embeddings 100% via GPU Manager Service local (Qwen3-Embedding-8B 4096 dim + OpenCLIP 1024 dim).

#### Categoria 3: ERPNext Stack (15 serviços)

| # | Serviço | Container | Descrição |
|---|---------|-----------|-----------|
| 15 | MariaDB | `erpnext-mariadb` | Banco de dados ERPNext |
| 16 | Redis Cache | `erpnext-redis-cache` | Cache de sessões ERPNext |
| 17 | Redis Queue | `erpnext-redis-queue` | Fila de jobs ERPNext |
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
| 39 | Alertmanager | `alice-alertmanager` | Gestão e roteamento de alertas |
| 40 | OTel Collector | `alice-otel-collector` | Instrumentação OpenTelemetry |
| 41 | Node Exporter | `alice-node-exporter` | Métricas do host Linux |
| 42 | cAdvisor | `alice-cadvisor` | Métricas de containers Docker |

#### Categoria 5: GPU Services (5 serviços)

| # | Serviço | Container | Descrição |
|---|---------|-----------|-----------|
| 43 | GPU Manager Service | `gpu-manager-service` | Gerenciamento centralizado de requisições GPU (fila priorizada, VRAM monitoring, circuit breakers) |
| 44 | GPU Mixtral (LLM) | `gpu-mixtral` | Mixtral 8x7B vLLM AWQ para chat e trading |
| 45 | GPU Embeddings | `gpu-embeddings` | Qwen3-Embedding-8B (texto) + OpenCLIP ViT-H/14 (imagem) |
| 46 | GPU FLUX | `gpu-flux` | FLUX.1 Schnell para geração de imagens |
| 47 | GPU ASR | `gpu-asr` | Canary-1B (NeMo) para transcrição de áudio |

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

### Pipeline CI/CD Unificada (Best Practices 2025)

```
Push → CI (auto) → Release (auto) → Deploy Hetzner (auto) → Validate GPU (auto)

1. Push para branch main
2. CI - Build & Test (automático):
   ├── TypeScript check
   ├── ESLint
   ├── Build packages/services
   └── Security scan (Trivy)
3. Release & Tag (automático se CI passar):
   ├── Cria tag v1.0.X (incremental)
   ├── Build imagens Docker
   └── Push para GHCR
4. Deploy Production (100% automático):
   ├── Dispara automaticamente após Release
   ├── Deploy Hetzner GPU (50 containers - 45 serviços + 4 GPU + 1 backup)
   ├── Health checks + Rollback automático
   └── GPU: RTX 4000 Ada (20GB VRAM) - Mixtral, FLUX, ASR, Embeddings (gerenciados pelo GPU Manager Service)
```

**Hetzner GPU 100% Automático:** Push para `main` aciona CI → Release → Deploy com health checks e rollback. Todos os 50 containers (45 serviços + 4 GPU + 1 backup) rodam no mesmo servidor Hetzner GPU único, eliminando latência de rede e simplificando gerenciamento.

**GPU Manager Service:**
- Gerenciamento centralizado de todas as requisições GPU (LLM, Embeddings, FLUX, ASR)
- Fila priorizada (Redis) com monitoramento VRAM em tempo real (nvidia-smi)
- Circuit breakers, retry logic e métricas Prometheus
- Guia completo: [docs/ARQUITETURA-GPU-MANAGER.md](docs/ARQUITETURA-GPU-MANAGER.md)

### Acesso SSH à Hetzner (Produção)

**Arquitetura de 2 Servidores (26/12/2025):**

| Servidor | Alias SSH | IP | Função |
|----------|-----------|-----|--------|
| **Deploy Server** | `alice-hetzner` | 5.78.77.83 | GitHub Actions Runner |
| **Production Server** | `alice-prod` | 178.63.41.108 | Aplicação + GPU |

**Configuração SSH** (`~/.ssh/config`):

```
Host alice-hetzner
    HostName 5.78.77.83
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
| **Alertmanager** | https://alertmanager.yesyoudeserve.duckdns.org | Alertas e notificações |

Consulte [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) para instruções detalhadas.

---

## Estrutura do Projeto

```
alice/
├── apps/                           # Microserviços independentes
│   ├── frontend-service/           # React 18 + Vite 7.3 SPA
│   ├── api-gateway/                # Traefik v3.6.4 config (dev only)
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
├── .github/workflows/              # CI/CD (4 workflows)
│   ├── ci.yml                      # Build & Test
│   ├── release.yml                 # Versionamento semântico
│   ├── deploy-production.yml       # Deploy Hetzner GPU (100% automático)
│   └── update-system-packages.yml  # Manutenção semanal
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
    └── index-dev.ts                # Gateway de desenvolvimento
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
- Docker, Traefik v3.6.4 (HTTP/2 habilitado)
- **Google Distroless** (6 serviços Node.js)
- nginx:1.27-alpine (frontend)
- GitHub Actions CI/CD (95%+ SHA pinning)
- Hetzner Cloud (Nuremberg)

### Observabilidade
- Prometheus 3.8.0 (métricas)
- Grafana OSS 11.6.2 (dashboards)
- Jaeger 1.76.0 (tracing distribuído)
- Loki 3.6.3, Promtail 3.6.3 (logs)
- OpenTelemetry Collector 0.141.0 (instrumentação)
- Langfuse 3.139.0 (métricas LLM)

---

## Documentação

| Documento | Descrição |
|-----------|-----------|
| [CLAUDE.md](CLAUDE.md) | Contexto completo do projeto e 18 regras |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Guia de deploy para produção |
| [docs/SECRETS.md](docs/SECRETS.md) | Guia de secrets e webhooks |
| [docs/STATUS-REAL-ATUAL.md](docs/STATUS-REAL-ATUAL.md) | Estado atual da plataforma (multimodal incluso) |
| [docs/SISTEMA-APRENDIZADO.md](docs/SISTEMA-APRENDIZADO.md) | Sistema de auto-aprendizado |
| [docs/FRAPPE-PATCHING.md](docs/FRAPPE-PATCHING.md) | Atualização de segurança ERPNext/Frappe |
| [apps/observability-service/README.md](apps/observability-service/README.md) | Stack de observabilidade |

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
| **Resource Limits** | 50/50 containers | 100% |
| **read_only: true** | 24/50 containers | 100% aplicável (somente onde não há escrita) |
| **security_opt: no-new-privileges** | 50/50 containers | 100% |
| **Healthchecks** | 38/38 containers | 100% (3 init usam service_completed_successfully) |
| **SHA256 Digests** | 26 imagens externas únicas | 100% |
| **TypeScript strict** | Zero erros | 100% |

### Supply Chain Security (SHA256 Pinned Images)

| Imagem | Versão | Status |
|--------|--------|--------|
| Traefik | v3.6.4 | Pinned |
| PostgreSQL | pg16 (pgvector) | Pinned |
| MariaDB | 10.11 | Pinned |
| Redis | 7.4.6-alpine | Pinned |
| ERPNext | v15.91.3 | Pinned |
| Vector | 0.51.1-alpine | Pinned |
| pgBackRest | 2.56.0 | Pinned |
| Docker Socket Proxy | latest | Pinned |
| BusyBox | 1.37 | Pinned |

### Immutable Infrastructure

Todos os 50 containers têm security hardening completo aplicado. Containers que não precisam escrever (24 containers) operam com filesystem read-only + tmpfs para escrita temporária. Containers que precisam escrever (26 containers: bancos de dados, workers/init ERPNext, langfuse-worker, node-exporter, cadvisor, alertmanager, serviços GPU) mantêm `security_opt: no-new-privileges:true` e resource limits.

- Alertmanager: senha SMTP via arquivo em `/opt/alice/secrets/alertmanager/smtp_password` montado em `/run/secrets` (sem senha inline em env).

---

<div align="center">

**Desenvolvido para empresas que exigem IA autônoma, privada e customizável**

*Autor: Fillipe Guerra*
*Versão 4.14 - 26 de Dezembro de 2025*
*Tecnologias: Node.js 22 LTS, Express 5.2, Vite 7.3, Tailwind CSS 4.1, React 19.2, pnpm 10.26.1, TypeScript 5.9.3*
*Total de Containers: 50 (8 infra + 8 Alice + 15 ERPNext + 14 observability + 4 GPU + 1 backup)*
*Production Audit: 100% Compliant | Zero CVEs (Distroless) | Docker Compose v5.0.0*
*Performance (19/12/2025): HTTP Compression (gzip), HTTP/2 (Traefik), SHA Pinning 95%+*
*PostgreSQL (21/12/2025): HNSW indexes + 10 índices compostos + 12 tabelas Trading com RLS*
*Storage: Servidor GEX44 1.92TB interno (/opt/alice) - SEM S3 externo*
*ARQUITETURA ENTERPRISE: Texto 4096 dim Qwen3-Embedding-8B (Qdrant) | Imagem 1024 dim OpenCLIP (pgvector)*
*Trading BTC Futures: KuCoin Perpetuals + Indicadores Técnicos Determinísticos + Validação Cruzada Anti-Alucinação*
*Trading Analysis (21/12/2025): RSI, MACD, EMA, SMA, Bollinger, ATR, Stochastic, ADX, Pivot Points + Aprovação de Sinais*
*LLM: Mixtral 8x7B (vLLM AWQ) via Hetzner GPU Server GEX44 (RTX 4000 Ada 20GB)*
*GPU Services (Hetzner): LLM (Mixtral vLLM), FLUX.1 Schnell, Qwen3-Embedding-8B, OpenCLIP, Canary-1B (ASR) - gerenciados pelo GPU Manager Service*
*Pipeline Unificada: Hetzner GPU 100% automático - todos os 50 containers no servidor único*

</div>
