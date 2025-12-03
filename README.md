# Alice - Plataforma Enterprise de IA Autônoma

<div align="center">

![Alice Logo](https://img.shields.io/badge/Alice-IA%20Enterprise-blue?style=for-the-badge&logo=robot&logoColor=white)
![Version](https://img.shields.io/badge/versão-2.0.0-green?style=for-the-badge)
![License](https://img.shields.io/badge/licença-Proprietária-red?style=for-the-badge)
![LLM](https://img.shields.io/badge/LLM-Llama%204%20Maverick%20400B-purple?style=for-the-badge)

**Plataforma de IA autônoma multimodal 100% self-hosted com LLM próprio**

[Documentação](#documentação) | [Início Rápido](#início-rápido) | [Arquitetura](#arquitetura) | [Deploy](#deploy)

</div>

---

## Visão Geral

**Alice** é uma plataforma enterprise de IA autônoma pronta para produção. Utiliza o modelo LLM **Llama 4 Maverick (400B parâmetros)** hospedado em infraestrutura própria (Salad Cloud GPUs), garantindo 100% de autonomia sem dependência de APIs externas como OpenAI ou Anthropic.

### Capacidades Principais

| Capacidade | Descrição |
|------------|-----------|
| **IA 100% Autônoma** | LLM próprio (Llama 4 Maverick 400B) hospedado em Salad Cloud GPUs |
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
│                  PRODUÇÃO (Hetzner Cloud - Nuremberg)                │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │    CX43 VM (8 vCPU AMD EPYC, 16GB RAM, 160GB NVMe SSD)          ││
│  │    IP: 46.224.46.93 | Domínio: yesyoudeserve.duckdns.org       ││
│  │  ┌─────────┐ ┌───────┐ ┌───────┐ ┌─────────┐ ┌───────────┐     ││
│  │  │ Traefik │ │ Auth  │ │ Chat  │ │   RAG   │ │ Training  │     ││
│  │  │ Gateway │ │:3001  │ │:3002  │ │  :3003  │ │  :3004    │     ││
│  │  └─────────┘ └───────┘ └───────┘ └─────────┘ └───────────┘     ││
│  │  ┌─────────────┐ ┌─────────────────────────────────────────┐   ││
│  │  │Integrations │ │         OBSERVABILITY STACK             │   ││
│  │  │   :3005     │ │ Prometheus │ Grafana │ Jaeger │ Langfuse│   ││
│  │  └─────────────┘ └─────────────────────────────────────────┘   ││
│  └─────────────────────────────────────────────────────────────────┘│
└───────────────────────────────────┬─────────────────────────────────┘
                                    │ API Calls
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      SALAD CLOUD (GPUs)                              │
│       Llama 4 Maverick 400B (Inferência) + FLUX.1 Schnell (Imagens) │
└─────────────────────────────────────────────────────────────────────┘
```

### Arquitetura de Microsserviços - 26 Containers em Produção

A plataforma Alice é composta por **26 containers** organizados em 4 categorias:

#### Categoria 1: Infraestrutura Core (4 serviços)

| # | Serviço | Container | Descrição |
|---|---------|-----------|-----------|
| 1 | Docker Socket Proxy | `dockerproxy` | Proxy seguro para API Docker |
| 2 | Traefik Init | `traefik-init` | Inicializador de certificados SSL |
| 3 | API Gateway | `traefik` | Gateway com SSL automático (Let's Encrypt) |
| 4 | PostgreSQL | `postgres` | Banco principal com pgvector e RLS |

#### Categoria 2: Microsserviços Alice (8 serviços)

| # | Serviço | Container | Porta | Descrição |
|---|---------|-----------|-------|-----------|
| 5 | Frontend | `alice-frontend` | 5000 | React 18 + Vite 5 + shadcn/ui |
| 6 | Auth Service | `alice-auth` | 3001 | OAuth 2.0, SAML 2.0, RBAC 6 níveis |
| 7 | Chat Service | `alice-chat` | 3002 | WebSocket streaming + LLM Salad Cloud |
| 8 | RAG Service | `alice-rag` | 3003 | pgvector + embeddings + busca semântica |
| 9 | Training Service | `alice-training` | 3004 | Fine-tuning + self-learning |
| 10 | Integrations | `alice-integrations` | 3005 | Stripe, Wise, Twilio, Resend |
| 11 | Observability | `alice-observability` | 3010 | Prometheus, Grafana, Jaeger, Backup |
| 12 | CLIP Inference | `alice-clip-inference` | 8000 | Embeddings multimodais (Python) |

> **NOTA:** O Traefik (`alice-traefik`) atua como API Gateway em produção.

#### Categoria 3: ERPNext Stack (12 serviços)

| # | Serviço | Container | Descrição |
|---|---------|-----------|-----------|
| 13 | MariaDB | `erpnext-mariadb` | Banco de dados ERPNext |
| 14 | Redis Cache | `erpnext-redis-cache` | Cache de sessões |
| 15 | Redis Queue | `erpnext-redis-queue` | Fila de jobs |
| 16 | Configurator | `erpnext-configurator` | Configurador Frappe Bench |
| 17 | Create Site | `erpnext-create-site` | Criador do site ERPNext |
| 18 | Backend | `erpnext-backend` | Backend Python Frappe |
| 19 | Frontend | `erpnext-frontend` | Frontend NGINX |
| 20 | WebSocket | `erpnext-websocket` | Socket.io real-time |
| 21 | Scheduler | `erpnext-scheduler` | Tarefas periódicas |
| 22 | Worker Short | `erpnext-worker-short` | Jobs rápidos |
| 23 | Worker Default | `erpnext-worker-default` | Jobs normais |
| 24 | Worker Long | `erpnext-worker-long` | Jobs longos |

#### Categoria 4: Infraestrutura Backup/Logs (2 serviços)

| # | Serviço | Container | Descrição |
|---|---------|-----------|-----------|
| 25 | pgBackRest | `pgbackrest` | Backup enterprise PostgreSQL (PITR) |
| 26 | Vector | `vector` | Agregador de logs (Datadog Vector) |

---

## Início Rápido

### Pré-requisitos

- Node.js 20+
- PostgreSQL 16+ com pgvector
- Docker (para produção)

### Desenvolvimento (Cursor IDE)

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
| **Produção** | Hetzner Cloud CX43 | 8 vCPU, 16GB RAM, Nuremberg |

### Pipeline CI/CD (Best Practices 2025)

```
Push → CI (auto) → Release (auto) → Deploy (auto)

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
   ├── Security scan (Trivy) das imagens
   └── Health checks + Rollback automático
```

**Pipeline 100% Automático:** Push para `main` vai direto para produção após todas as validações passarem.

### URLs de Produção

| Serviço | URL |
|---------|-----|
| **Alice Frontend** | https://yesyoudeserve.duckdns.org |
| **Alice Chat** | https://yesyoudeserve.duckdns.org/chat |
| **Alice Dashboard** | https://yesyoudeserve.duckdns.org/dashboard |
| **ERPNext** | https://erp.yesyoudeserve.duckdns.org |
| **Grafana** | https://observability.yesyoudeserve.duckdns.org |
| **Prometheus** | https://prometheus.yesyoudeserve.duckdns.org |
| **Jaeger** | https://tracing.yesyoudeserve.duckdns.org |
| **Langfuse** | https://llm-metrics.yesyoudeserve.duckdns.org |

Consulte [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) para instruções detalhadas.

---

## Estrutura do Projeto

```
alice/
├── apps/                           # Microserviços independentes
│   ├── frontend-service/           # React + Vite SPA
│   ├── api-gateway/                # Traefik v3.1 config
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
├── .github/workflows/              # CI/CD
│   └── deploy-production.yml       # Deploy automatizado
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
- React 18, TypeScript 5, Vite 5
- TanStack Query, Wouter
- shadcn/ui, Tailwind CSS 4
- Framer Motion, react-i18next

### Backend
- Node.js 22 LTS, Express 4
- Drizzle ORM, PostgreSQL 16 + pgvector
- WebSocket (ws), Pino (logging)
- Passport.js, openid-client

### Infraestrutura
- Docker, Traefik v3.1
- GitHub Actions CI/CD
- Hetzner Cloud (Nuremberg)

### Observabilidade
- Prometheus 3.0 (métricas)
- Grafana OSS 11.3 (dashboards)
- Jaeger 1.62 (tracing distribuído)
- OpenTelemetry (instrumentação)
- Langfuse (métricas LLM)

---

## Documentação

| Documento | Descrição |
|-----------|-----------|
| [replit.md](replit.md) | Contexto completo do projeto e 17 regras |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Guia de deploy para produção |
| [docs/SECRETS.md](docs/SECRETS.md) | Guia de secrets e webhooks |
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
| **Resource Limits** | 26/26 containers | 100% |
| **read_only: true** | 26/26 containers | 100% |
| **security_opt: no-new-privileges** | 26/26 containers | 100% |
| **Healthchecks** | 24/24 containers (init excluídos) | 100% |
| **SHA256 Digests** | 9 imagens externas únicas | 100% |
| **TypeScript strict** | Zero erros | 100% |

### Supply Chain Security (SHA256 Pinned Images)

| Imagem | Versão | Status |
|--------|--------|--------|
| Traefik | v3.3 | Pinned |
| PostgreSQL | pg16 (pgvector) | Pinned |
| MariaDB | 10.11 | Pinned |
| Redis | 7-alpine | Pinned |
| ERPNext | v15.88.0 | Pinned |
| Vector | 0.43.1-alpine | Pinned |
| pgBackRest | 2.54.2-alpine | Pinned |
| Docker Socket Proxy | latest | Pinned |
| BusyBox | 1.36 | Pinned |

### Immutable Infrastructure

Todos os 26 containers operam com filesystem read-only + tmpfs para escrita temporária, seguindo as melhores práticas Docker 2025 e OWASP Container Security.

---

<div align="center">

**Desenvolvido para empresas que exigem IA autônoma, privada e customizável**

*Autor: Fillipe Guerra*
*Versão 3.2.0 - Dezembro 2025*
*Total de Containers: 26 (4 infraestrutura + 8 Alice + 12 ERPNext + 2 backup/logs)*
*Production Audit: 100% Compliant*

</div>
