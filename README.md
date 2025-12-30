# Alice - Plataforma Enterprise de IA Autônoma

**Autor:** Fillipe Guerra  
**Data:** 29 de Dezembro de 2025
**Versão:** 4.46

<div align="center">

![Alice Logo](https://img.shields.io/badge/Alice-IA%20Enterprise-blue?style=for-the-badge&logo=robot&logoColor=white)
![Version](https://img.shields.io/badge/versão-4.46-green?style=for-the-badge)
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

A plataforma Alice é composta por **50 containers** organizados em 6 categorias (todos rodando no servidor Hetzner GPU único):

#### Categoria 1: Infraestrutura Core (8 serviços)

| # | Serviço | Container | Descrição |
|---|---------|-----------|-----------|
| 1 | Tor Proxy | `alice-tor` | Proxy SOCKS5 para engines .onion (SearXNG) |
| 2 | SearXNG | `alice-searxng` | Metabusca interna (Web Search) |
| 3 | Docker Socket Proxy | `alice-dockerproxy` | Proxy seguro para API Docker |
| 4 | Traefik Init | `alice-traefik-init` | Inicializador de certificados SSL |
| 5 | API Gateway | `alice-traefik` | Gateway com SSL automático (Let's Encrypt) |
| 6 | PostgreSQL | `alice-postgres` | Banco principal com pgvector e RLS |
| 7 | Alice Redis | `alice-redis` | Cache distribuído dedicado para Alice |
| 8 | Qdrant | `alice-qdrant` | Banco vetorial para texto (4096 dim, HNSW index) |

#### Categoria 2: Microsserviços Alice (8 serviços)

| # | Serviço | Container | Porta | Descrição |
|---|---------|-----------|-------|-----------|
| 9 | Frontend | `alice-frontend` | 5000 | React 19.2.3 + Vite 7.3 + shadcn/ui |
| 10 | Auth Service | `alice-auth` | 3001 | OAuth 2.0, SAML 2.0, RBAC 6 níveis |
| 11 | Chat Service | `alice-chat` | 3002 | WebSocket streaming + LLM via GPU Manager |
| 12 | RAG Service | `alice-rag` | 3003 | pgvector + embeddings + busca semântica |
| 13 | Training Service | `alice-training` | 3004 | Fine-tuning + self-learning |
| 14 | Integrations | `alice-integrations` | 3005 | Stripe, Wise, Twilio, Resend, KuCoin Futures |
| 15 | Observability | `alice-observability` | 3007 | Prometheus, Grafana, Jaeger, Backup |
| 16 | GPU Manager | `alice-gpu-manager` | 3010 | Gerenciamento centralizado GPU (fila, VRAM, circuit breakers) |

> **NOTA:** O Traefik (`alice-traefik`) atua como API Gateway em produção. Embeddings 100% via GPU Manager Service local (Qwen3-Embedding-8B 4096 dim + OpenCLIP 1024 dim).

#### Categoria 3: ERPNext Stack (15 serviços)

| # | Serviço | Container | Descrição |
|---|---------|-----------|-----------|
| 17 | MariaDB | `erpnext-mariadb` | Banco de dados ERPNext |
| 18 | Redis Cache | `erpnext-redis-cache` | Cache de sessões ERPNext |
| 19 | Redis Queue | `erpnext-redis-queue` | Fila de jobs ERPNext |
| 20 | Configurator | `erpnext-configurator` | Configurador Frappe Bench (init) |
| 21 | Create Site | `erpnext-create-site` | Criador do site ERPNext (init) |
| 22 | Backend | `erpnext-backend` | Backend Python Frappe |
| 23 | Frontend | `erpnext-frontend` | Frontend NGINX |
| 24 | WebSocket | `erpnext-websocket` | Socket.io real-time |
| 25 | Scheduler | `erpnext-scheduler` | Tarefas periódicas |
| 26 | Worker Default 1 | `erpnext-worker-default` | Jobs normais (instância 1) |
| 27 | Worker Short 1 | `erpnext-worker-short` | Jobs rápidos (instância 1) |
| 28 | Worker Long 1 | `erpnext-worker-long` | Jobs longos (instância 1) |
| 29 | Worker Default 2 | `erpnext-worker-default-2` | Jobs normais (instância 2) |
| 30 | Worker Short 2 | `erpnext-worker-short-2` | Jobs rápidos (instância 2) |
| 31 | Worker Long 2 | `erpnext-worker-long-2` | Jobs longos (instância 2) |

#### Categoria 4: Observability Stack (13 serviços)

| # | Serviço | Container | Descrição |
|---|---------|-----------|-----------|
| 32 | ClickHouse | `alice-clickhouse` | OLAP database para Langfuse analytics |
| 33 | Langfuse Web | `langfuse` | LLM observability e analytics |
| 34 | Langfuse DB | `alice-langfuse-db` | PostgreSQL dedicado Langfuse |
| 35 | Prometheus | `prometheus` | Coleta e armazenamento de métricas |
| 36 | Grafana | `grafana` | Dashboards e visualizações |
| 37 | Loki | `loki` | Agregação e armazenamento de logs |
| 38 | Promtail | `promtail` | Coleta de logs do host |
| 39 | Jaeger | `jaeger` | Distributed tracing |
| 40 | Vector | `alice-vector` | Agregação de logs → Loki |
| 41 | Alertmanager | `alice-alertmanager` | Gestão e roteamento de alertas |
| 42 | OTel Collector | `alice-otel-collector` | Instrumentação OpenTelemetry |
| 43 | Node Exporter | `alice-node-exporter` | Métricas do host Linux |
| 44 | cAdvisor | `alice-cadvisor` | Métricas de containers Docker |

#### Categoria 5: GPU Services (5 serviços Python)

| # | Serviço | Container | Descrição |
|---|---------|-----------|-----------|
| 45 | GPU Mixtral (LLM) | `gpu-mixtral` | Mixtral 8x7B vLLM AWQ para chat e trading |
| 46 | GPU Embeddings | `gpu-embeddings` | Qwen3-Embedding-8B (texto) + OpenCLIP ViT-H/14 (imagem) |
| 47 | GPU FLUX | `gpu-flux` | FLUX.1 Schnell para geração de imagens |
| 48 | GPU ASR | `gpu-asr` | Canary-1B (NeMo) para transcrição de áudio |
| 49 | GPU Trainer | `gpu-trainer` | Fine-tuning LoRA para customização do modelo |

#### Categoria 6: Backup (1 serviço)

| # | Serviço | Container | Descrição |
|---|---------|-----------|-----------|
| 50 | pgBackRest | `alice-pgbackrest` | Backup enterprise PostgreSQL (PITR, WAL, AES-256) |

---

## Início Rápido

### Pré-requisitos

- Node.js 22 LTS
- PostgreSQL 16+ com pgvector
- pnpm 10.26.2+
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
   ├── Publica imagens Docker no GHCR (rebuild apenas do que mudou; retag do restante)
   └── Push para GHCR
4. Deploy Production (100% automático):
   ├── Dispara automaticamente após Release
   ├── Deploy Hetzner GPU (50 containers: 8 infra + 8 Alice + 15 ERPNext + 13 obs + 5 GPU + 1 backup)
   ├── Health checks + Rollback automático
   └── GPU: RTX 4000 Ada (20GB VRAM) - Mixtral, FLUX, ASR, Embeddings (gerenciados pelo GPU Manager Service)
```

**Hetzner GPU 100% Automático:** Push para `main` aciona CI → Release → Deploy com health checks e rollback. Todos os 50 containers (8 infra + 8 Alice + 15 ERPNext + 13 observability + 5 GPU + 1 backup) rodam no mesmo servidor Hetzner GPU único, eliminando latência de rede e simplificando gerenciamento.

**GPU Manager Service:**
- Gerenciamento centralizado de todas as requisições GPU (LLM, Embeddings, FLUX, ASR)
- Fila priorizada (Redis) com monitoramento VRAM em tempo real (nvidia-smi)
- Circuit breakers, retry logic e métricas Prometheus
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
| **Alertmanager** | https://alertmanager.yesyoudeserve.duckdns.org | Alertas e notificações |

Consulte [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) para instruções detalhadas.

---

## Estrutura do Projeto

```
alice/
├── apps/                           # Microserviços independentes
│   ├── frontend-service/           # React 19.2.3 + Vite 7.3 SPA
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
├── .github/
│   ├── actions/                    # Composite actions reutilizáveis
│   │   └── setup-node-pnpm/        # Setup Node.js + pnpm (elimina duplicação)
│   └── workflows/                  # CI/CD (3 workflows)
│       ├── ci.yml                  # Build & Test (otimizado 27/12/2025)
│       ├── release.yml             # Versionamento semântico
│       └── production-deploy.yml   # Deploy Hetzner GPU (100% automático)
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
- TypeScript 5.9.3, pnpm 10.26.2 (versão automática via package.json)
- Drizzle ORM, PostgreSQL 16 + pgvector
- WebSocket (ws), Pino (logging estruturado)
- Passport.js, openid-client
- HTTP Compression (gzip level 6)

### Infraestrutura
- Docker, Traefik v3.6.4 (HTTP/2 habilitado)
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
- Langfuse 2.94 (métricas LLM)

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
| **Resource Limits** | 50/50 containers | 100% |
| **read_only: true** | 25/50 containers | 100% aplicável (somente onde não há escrita) |
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
| pgBackRest | 2.57.0 | Pinned |
| Docker Socket Proxy | latest | Pinned |
| BusyBox | 1.37 | Pinned |

### Immutable Infrastructure

Todos os 50 containers têm security hardening completo aplicado. Containers que não precisam escrever (25 containers) operam com filesystem read-only + tmpfs para escrita temporária. Containers que precisam escrever (25 containers: bancos de dados, workers/init ERPNext, node-exporter, cadvisor, alertmanager, serviços GPU) mantêm `security_opt: no-new-privileges:true` e resource limits.

- Alertmanager: senha SMTP via arquivo em `/opt/alice/secrets/alertmanager/smtp_password` montado em `/run/secrets` (sem senha inline em env).

---

<div align="center">

**Desenvolvido para empresas que exigem IA autônoma, privada e customizável**

*Autor: Fillipe Guerra*
*Versão 4.46 - 29 de Dezembro de 2025*
*Tecnologias: Node.js 22 LTS, Express 5.2, Vite 7.3, Tailwind CSS 4.1, React 19.2, pnpm 10.26.2, TypeScript 5.9.3*
*Total de Containers: 50 (8 infra + 8 Alice + 15 ERPNext + 13 observability + 5 GPU + 1 backup)*
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
*Otimização CI (27/12/2025): Composite action reutilizável elimina duplicação de setup (14x → 1x), economia de ~6-10min por run*
*Runner Enterprise Hardening (27/12/2025): Kernel tuning, Docker daemon otimizado, limits, systemd override, cron cleanup diário 3h*

</div>
