# Alice - Plataforma Enterprise de IA Autônoma

<div align="center">

![Alice Logo](https://img.shields.io/badge/Alice-IA%20Enterprise-blue?style=for-the-badge&logo=robot&logoColor=white)
![Version](https://img.shields.io/badge/versão-1.3.0-green?style=for-the-badge)
![License](https://img.shields.io/badge/licença-Proprietária-red?style=for-the-badge)
![LLM](https://img.shields.io/badge/LLM-Llama%204%20Maverick%20400B-purple?style=for-the-badge)

**Plataforma de IA autônoma multimodal 100% self-hosted com LLM próprio**

[Documentação](#documentação) | [Início Rápido](#início-rápido) | [Arquitetura](#arquitetura) | [Deploy](#deploy)

</div>

---

## Visão Geral

**Alice** é uma plataforma enterprise de IA autônoma multimodal pronta para produção. Utiliza o modelo LLM **Llama 4 Maverick (400B parâmetros)** hospedado em infraestrutura própria (Salad Cloud GPUs), garantindo 100% de autonomia sem dependência de APIs externas como OpenAI ou Anthropic.

### Capacidades Principais

| Capacidade | Descrição |
|------------|-----------|
| **IA 100% Autônoma** | LLM próprio (Llama 4 Maverick 400B) hospedado em Salad Cloud GPUs |
| **Multimodal** | Suporta texto, imagem, áudio e vídeo |
| **Auto-aprendizado** | Fine-tuning contínuo via SemHash e NeMo Curator |
| **Multi-tenant** | Suporte a múltiplas organizações com agentes IA especializados |
| **RAG Avançado** | Base de conhecimento com deduplicação semântica (pgvector) |
| **Enterprise RBAC** | Controle de acesso granular com roles hierárquicas |

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
│                         DESENVOLVIMENTO (Replit)                     │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────────────┐ │
│  │ Frontend  │  │ Serviços  │  │PostgreSQL │  │ Object Storage    │ │
│  │ React     │  │ Node.js   │  │ + pgvector│  │                   │ │
│  └───────────┘  └───────────┘  └───────────┘  └───────────────────┘ │
└───────────────────────────────────┬─────────────────────────────────┘
                                    │ Git Push
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    GITHUB ACTIONS CI/CD                              │
│  Build → Test → Security Scan → ⏸️ Aprovação Manual → Deploy        │
└───────────────────────────────────┬─────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  PRODUÇÃO (Hetzner Cloud - Nuremberg)                │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │    CX43 VM (8 vCPU AMD EPYC, 16GB RAM, 160GB NVMe SSD)          ││
│  │    IP: 46.224.46.93 | Domínio: yesyoudeserve.duckdns.org       ││
│  │  ┌─────────┐  ┌───────┐  ┌───────┐  ┌─────────┐  ┌───────────┐ ││
│  │  │ Traefik │  │ Auth  │  │ Chat  │  │   RAG   │  │ Training  │ ││
│  │  │ Gateway │  │:3001  │  │:3002  │  │  :3003  │  │  :3004    │ ││
│  │  └─────────┘  └───────┘  └───────┘  └─────────┘  └───────────┘ ││
│  └─────────────────────────────────────────────────────────────────┘│
└───────────────────────────────────┬─────────────────────────────────┘
                                    │ API Calls
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      SALAD CLOUD (GPUs)                              │
│                  Llama 4 Maverick 400B - Inferência LLM              │
└─────────────────────────────────────────────────────────────────────┘
```

### Microserviços

| Serviço | Porta | Responsabilidade |
|---------|-------|------------------|
| **frontend-service** | 80 | React SPA, i18n, theming |
| **api-gateway** | 80/443 | Traefik v3.1, SSL automático, rate-limit |
| **auth-service** | 3001 | OAuth 2.0, SAML 2.0, autenticação local, RBAC |
| **chat-service** | 3002 | LLM proxy via Salad Cloud, streaming, WebSocket |
| **rag-service** | 3003 | Embeddings, pgvector, busca semântica |
| **training-service** | 3004 | Auto-evolução, SemHash, fine-tuning |
| **integrations-service** | 3005 | Stripe, ERPNext, Twilio, Resend, WhatsApp |

---

## Início Rápido

### Pré-requisitos

- Node.js 20+
- PostgreSQL 16+ com pgvector
- Docker (para produção)

### Desenvolvimento (Replit)

```bash
# 1. Iniciar em modo desenvolvimento
npm run dev
```

O servidor iniciará automaticamente em `http://localhost:5000`.

### Variáveis de Ambiente

Consulte [docs/SECRETS.md](docs/SECRETS.md) para a lista completa de secrets necessários.

---

## Deploy

### Ambientes

| Ambiente | Plataforma | Descrição |
|----------|------------|-----------|
| **Desenvolvimento** | Replit | IDE, hot reload, debugging |
| **Produção** | Hetzner Cloud CX43 | 8 vCPU, 16GB RAM, Nuremberg |

### Pipeline CI/CD (100% Automatizado)

```
1. Push para branch main
2. GitHub Actions executa:
   ├── Lint & Typecheck
   ├── Build pacotes compartilhados
   ├── Build imagens Docker
   ├── Push para GHCR
   ├── ⏸️ Aprovação Manual
   └── Deploy SSH para Hetzner
3. Health checks automáticos
4. Rollback automático se falhar
```

### URLs de Produção

| Serviço | URL |
|---------|-----|
| **Alice Frontend** | https://yesyoudeserve.duckdns.org |
| **ERPNext** | https://erp.yesyoudeserve.duckdns.org |
| **Traefik Dashboard** | https://traefik.yesyoudeserve.duckdns.org |

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
│   └── integrations-service/       # Stripe, ERPNext, Twilio
│
├── packages/                       # Código compartilhado
│   ├── shared/                     # Schema Drizzle ORM
│   ├── database/                   # PostgreSQL + pgvector
│   ├── logger/                     # Pino configurado
│   └── config/                     # Validação Zod
│
├── infra/                          # Infraestrutura
│   ├── docker/                     # Docker Compose
│   └── scripts/                    # Scripts de setup
│
├── docs/                           # Documentação
│   ├── DEPLOYMENT.md               # Guia de deploy
│   └── SECRETS.md                  # Guia de secrets
│
├── .github/workflows/              # CI/CD
│   └── deploy-production.yml       # Deploy automatizado
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
- Node.js 20, Express 4
- Drizzle ORM, PostgreSQL 16 + pgvector
- WebSocket (ws), Pino (logging)
- Passport.js, openid-client

### Infraestrutura
- Docker, Traefik v3.1
- GitHub Actions CI/CD
- Hetzner Cloud (Nuremberg)

---

## Documentação

| Documento | Descrição |
|-----------|-----------|
| [replit.md](replit.md) | Contexto completo do projeto e 16 regras |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Guia de deploy para produção |
| [docs/SECRETS.md](docs/SECRETS.md) | Guia de secrets e webhooks |
| [design_guidelines.md](design_guidelines.md) | Diretrizes de design UI/UX |

---

## Padrões de Código

```typescript
// Logging - Pino OBRIGATÓRIO (console.* proibido)
import { logger } from '@alice/logger';
logger.info({ userId }, 'Usuário autenticado');

// TypeScript strict - zero any
interface User { id: string; email: string; role: UserRole; }
```

---

## Licença

Proprietário - Todos os direitos reservados.

---

<div align="center">

**Desenvolvido para empresas que exigem IA autônoma, privada e customizável**

</div>
