# Alice - Plataforma Enterprise de IA Autônoma

## Overview

Alice é uma plataforma enterprise de IA autônoma multimodal abrangente e pronta para produção. O projeto utiliza um modelo LLM proprietário, **Llama 4 Maverick (400B parâmetros)**, hospedado em infraestrutura própria (Salad Cloud GPUs), garantindo 100% de autonomia e privacidade sem dependência de APIs externas como OpenAI ou Anthropic.

### Capacidades Principais

| Capacidade | Descrição |
|------------|-----------|
| **IA 100% Autônoma** | LLM próprio (Llama 4 Maverick 400B) para controle total, privacidade, custos previsíveis |
| **Multimodal** | Suporte para texto, imagem, áudio e vídeo |
| **Auto-aprendizado** | Fine-tuning contínuo via SemHash e NeMo Curator |
| **Multi-tenant** | Múltiplas organizações com agentes IA especializados |
| **Enterprise RBAC** | Controle de acesso granular com roles hierárquicas |
| **RAG Avançado** | Base de conhecimento com pgvector e deduplicação semântica |

### Visão de Negócio
Fornecer uma solução de IA robusta, privada e customizável para empresas, sem dependência de provedores externos.

---

## User Preferences

### REGRAS CRÍTICAS - TOLERÂNCIA ZERO

| # | Regra | Descrição |
|---|---|---|
| 1 | **LER ANTES DE AGIR** | PROIBIDO implementar sem inspecionar arquivos, fluxos e dependências |
| 2 | **NÃO DUPLICAR** | Primeiro encontrar e reutilizar implementação existente |
| 3 | **WORKFLOW** | diagnóstico → leitura → plano mínimo → aprovação → micro-implementação → validação |
| 4 | **APROVAÇÃO** | Qualquer decisão técnica: PARAR e pedir aprovação |
| 5 | **NÃO MENTIR** | Se não sabe, dizer "Eu não sei". Se não verificou, dizer "Eu não verifiquei" |
| 6 | **SEM SOLUÇÕES TEMPORÁRIAS** | PROIBIDO: workarounds, hardcoded, mocks, placeholders |
| 7 | **MUDANÇAS MÍNIMAS** | Sem refatorações fora do escopo aprovado |
| 8 | **QUALIDADE** | TypeScript strict, zero LSP errors, zero any, Pino logging |
| 9 | **VALIDAÇÃO** | Validar após cada micro-passo |
| 10 | **DOCUMENTAÇÃO** | SEMPRE em PT-BR. NUNCA em Inglês |
| 11 | **DOCUMENTAÇÃO OFICIAL** | SEMPRE seguir docs oficiais e best practices 2025 |
| 12 | **HETZNER CLOUD** | Replit=IDE. Produção=Hetzner CX43 (8vCPU, 16GB, IP: 46.224.46.93) via GitHub Actions CI/CD |
| 13 | **i18n OBRIGATÓRIO** | PT-BR primário, EN secundário, switch em todas as páginas |
| 14 | **VERIFICAR SECRETS** | SEMPRE verificar chaves existentes antes de implementar |
| 15 | **SOMENTE MICROSERVIÇOS** | PROIBIDO código monolítico. apps/ para serviços, packages/ para shared |
| 16 | **MELHORES PRÁTICAS 2025** | API Gateway, health checks, circuit breakers, container-ready |

### Preferências de Linguagem
- **Documentação, comentários, logs:** Português Brasileiro (PT-BR)
- **Variáveis, funções, tipos, pacotes:** Inglês

---

## System Architecture

### Decisões Arquiteturais

| Decisão | Implementação |
|---------|---------------|
| **Microserviços** | 7 serviços independentes em apps/ |
| **LLM Dedicado** | Llama 4 Maverick 400B via Salad Cloud GPUs |
| **Autenticação** | Passport.js: OAuth 2.0 + SAML 2.0 + Local |
| **Gateway** | Traefik v3.1 com SSL automático |
| **Database** | PostgreSQL 16 + pgvector |
| **Logging** | Pino obrigatório (console.* proibido) |

### Estrutura de Microserviços

| Serviço | Porta | Responsabilidade |
|---------|-------|------------------|
| **frontend-service** | 5000/80 | React SPA, i18n, theming |
| **api-gateway** | 80/443 | Traefik, SSL, rate-limit |
| **auth-service** | 3001 | OAuth/SAML/Local, RBAC |
| **chat-service** | 3002 | LLM proxy, WebSocket |
| **rag-service** | 3003 | pgvector, embeddings |
| **training-service** | 3004 | Fine-tuning, SemHash |
| **integrations-service** | 3005 | Stripe, ERPNext, Twilio |

### Technical Stack

**Frontend:** React 18, TypeScript 5, Vite 5, shadcn/ui, Tailwind 4, react-i18next
**Backend:** Node.js 20, Express 4, Drizzle ORM, PostgreSQL 16, pgvector, Pino
**Infra:** Docker, Traefik v3.1, GitHub Actions, Hetzner Cloud

---

## External Dependencies

### Serviços e Secrets

| Serviço | Uso | Secrets |
|---------|-----|---------|
| **Salad Cloud** | GPUs para LLM Maverick 400B | SALAD_API_KEY, SALAD_ORGANIZATION_ID |
| **Stripe Portugal** | Receber pagamentos EUR, SEPA (ERPNext nativo) | STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET |
| **Wise** | Enviar pagamentos globais (Dashboard Admin) | WISE_API_KEY, WISE_PROFILE_ID, WISE_WEBHOOK_SECRET |
| **ERPNext** | CRM/ERP, centralização de vendas | ERPNEXT_URL, ERPNEXT_API_KEY, ERPNEXT_API_SECRET |
| **Twilio** | WhatsApp, SMS, Voice | TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER |
| **Resend** | Emails | RESEND_API_KEY |

### OAuth Providers
- **Google:** GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
- **GitHub:** GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
- **Microsoft:** MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_TENANT_ID

### SAML Providers
- **Azure AD / Okta:** SAML_ENTRY_POINT, SAML_ISSUER, SAML_CERT

---

## Secrets Management

```bash
# Database
DATABASE_URL, PGDATABASE, PGHOST, PGPORT, PGUSER, PGPASSWORD

# Session
SESSION_SECRET

# LLM Salad Cloud
SALAD_API_KEY, SALAD_ORGANIZATION_ID

# Stripe
STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET

# OAuth
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_TENANT_ID

# SAML
SAML_ENTRY_POINT, SAML_ISSUER, SAML_CERT

# Wise Pagamentos
WISE_API_KEY, WISE_PROFILE_ID, WISE_WEBHOOK_SECRET

# Integrações
ERPNEXT_URL, ERPNEXT_API_KEY, ERPNEXT_API_SECRET
TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER
RESEND_API_KEY

# Hetzner (GitHub Secrets)
HETZNER_VM_HOST, HETZNER_VM_USER, HETZNER_SSH_PRIVATE_KEY
```

---

## Infraestrutura Hetzner Cloud

### Servidor CX43 (Nuremberg)

| Config | Valor |
|--------|-------|
| **IP** | 46.224.46.93 |
| **User** | root |
| **SSH Port** | 22 |
| **Specs** | 8 vCPU AMD EPYC, 16GB RAM, 160GB NVMe |
| **Domínio** | yesyoudeserve.duckdns.org |

### Chave SSH

**Variável GitHub Secret:** `HETZNER_SSH_PRIVATE_KEY`

> **IMPORTANTE:** A chave privada SSH deve ser armazenada APENAS como GitHub Secret.
> NUNCA commitar chaves privadas no repositório.

---

## Estrutura do Projeto

```
alice/
├── apps/                           # Microserviços
│   ├── frontend-service/           # React + Vite
│   ├── api-gateway/                # Traefik config
│   ├── auth-service/               # OAuth/SAML/Local
│   ├── chat-service/               # LLM + WebSocket
│   ├── rag-service/                # pgvector + embeddings
│   ├── training-service/           # Fine-tuning + SemHash
│   └── integrations-service/       # Stripe, ERPNext, Twilio
├── packages/                       # Código compartilhado
│   ├── shared/src/schema.ts        # Drizzle ORM schema
│   ├── database/                   # PostgreSQL connection
│   ├── logger/                     # Pino config
│   └── config/                     # Zod validation
├── infra/docker/                   # Docker Compose
├── .github/workflows/              # CI/CD
└── server/index-dev.ts             # Dev gateway
```

---

## Data Models (packages/shared/src/schema.ts)

### Entidades Principais

| Entidade | Descrição |
|----------|-----------|
| **sessions** | Sessões de usuário |
| **tenants** | Multi-tenant (empresas) |
| **users** | Usuários com auth enterprise |
| **permissions** | Permissões granulares |
| **rolePermissions** | Role → Permissions mapping |
| **namespaces** | Contextos (Sales, Support, HR, Finance) |
| **agents** | Agentes IA especializados |
| **conversations** | Conversas com agentes |
| **messages** | Mensagens multimodal |
| **documents** | Knowledge base (RAG) |
| **documentChunks** | Chunks para RAG |
| **learningTasks** | Tarefas de fine-tuning |
| **integrations** | Integrações externas |
| **auditLogs** | Logs de auditoria |
| **usageMetrics** | Métricas de uso |

### Enums

```typescript
userRoleEnum: "super_admin" | "admin" | "manager" | "operator" | "viewer" | "guest"
agentStatusEnum: "active" | "training" | "paused" | "deprecated"
messageTypeEnum: "text" | "image" | "audio" | "video" | "document" | "mixed"
conversationStatusEnum: "active" | "archived" | "deleted"
taskStatusEnum: "pending" | "processing" | "completed" | "failed" | "cancelled"
```

---

## ERPNext Centralização

**TODAS vendas centralizadas no ERPNext:**

| Fonte | Fluxo |
|-------|-------|
| **Website** | Direto → ERPNext |
| **Alice WhatsApp** | Venda → Webhook → ERPNext Sales Order |
| **Stripe** | Pagamento → Webhook → ERPNext Payment Entry |

---

## Deploy Workflow (100% Automatizado)

```
1. Código no Replit
2. Git push → GitHub
3. GitHub Actions:
   ├── Code Quality
   ├── Security Scan
   ├── Build Docker Images
   ├── ⏸️ Aprovação Manual
   └── Deploy SSH → Hetzner
4. Health checks automáticos
5. Rollback se falhar
```

### URLs de Produção

| Serviço | URL |
|---------|-----|
| **Alice** | https://yesyoudeserve.duckdns.org |
| **ERPNext** | https://erp.yesyoudeserve.duckdns.org |
| **Traefik** | https://traefik.yesyoudeserve.duckdns.org |

---

## Enterprise Patterns

| Padrão | Status | Detalhes |
|--------|--------|----------|
| API Gateway (Traefik) | ✅ | v3.1, SSL automático, rate-limit |
| Circuit Breaker (opossum) | ✅ | ERPNext (10s/50%/30s), Wise (15s/50%/30s) |
| Health Checks | ✅ | /health em todos os serviços + status circuit breakers |
| Rate Limiting | ✅ | express-rate-limit configurado |
| Structured Logging (Pino) | ✅ | Todos os serviços, console.* proibido |
| 12-Factor App | ✅ | Config via env vars, stateless |
| Container-ready | ✅ | Docker Compose para produção |
| Auto SSL (Let's Encrypt) | ✅ | Traefik ACME automático |
| Multi-tenant | ✅ | Isolamento por tenant_id |
| RBAC | ✅ | 6 roles hierárquicas |

### Circuit Breakers Configurados

| Serviço | Timeout | Error Threshold | Reset Timeout |
|---------|---------|-----------------|---------------|
| ERPNext | 10s | 50% | 30s |
| Wise API | 15s | 50% | 30s |

---

## Padrões de Código

```typescript
// CORRETO - Pino logging
import { logger } from '@alice/logger';
logger.info({ userId }, 'Usuário autenticado');

// ERRADO - console.* PROIBIDO
console.log('msg'); // ❌ NUNCA

// CORRETO - TypeScript strict
interface User { id: string; email: string; role: UserRole; }

// ERRADO - any PROIBIDO
const user: any = {}; // ❌ NUNCA
```

---

## Resumo Técnico

| Aspecto | Valor |
|---------|-------|
| **Modelo LLM** | Llama 4 Maverick 400B (Salad Cloud) |
| **Arquitetura** | 7 Microserviços |
| **Database** | PostgreSQL 16 + pgvector |
| **Auth** | OAuth 2.0 + SAML 2.0 + Local |
| **Frontend** | React 18 + TypeScript + Vite |
| **Backend** | Node.js 20 + Express |
| **Produção** | Hetzner CX43 (Nuremberg) |
| **Deploy** | GitHub Actions CI/CD |
| **Gateway** | Traefik v3.1 (SSL auto) |
| **i18n** | PT-BR primário, EN secundário |
