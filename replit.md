# Alice - Plataforma Enterprise de IA Autônoma

## Overview

Alice is an autonomous AI enterprise platform, powered by the Llama 4 Maverick (400B parameters) model, hosted on Salad Cloud. Its core purpose is to deliver a fully autonomous AI solution that addresses critical business needs: absolute privacy, predictable costs, and unlimited customization via fine-tuning. The platform aims to eliminate dependencies on external APIs, mitigate privacy concerns with third-party servers, and provide an alternative to unpredictable token-based pricing models.

Key capabilities include real-time chat with streaming, deduplication, multi-tenancy, RBAC, a RAG backend for embeddings and vector search, image generation, aggressive self-learning, and a robust observability stack. The business vision is to provide an enterprise-grade AI solution that offers unparalleled control and performance, enabling businesses to leverage AI without compromising on data security or cost predictability.

## User Preferences

### 16 Regras Fundamentais

| # | Regra | Descrição |
|---|-------|-----------|
| 1 | **LER ANTES DE AGIR** | Inspecionar arquivos antes de implementar |
| 2 | **NÃO DUPLICAR** | Verificar código existente primeiro |
| 3 | **WORKFLOW ESTRUTURADO** | Diagnóstico → Plano → Aprovação → Implementação |
| 4 | **APROVAÇÃO OBRIGATÓRIA** | Pedir aprovação antes de mudanças grandes |
| 5 | **NÃO MENTIR** | Dizer "não sei" quando não souber |
| 6 | **SEM SOLUÇÕES TEMPORÁRIAS** | **PROIBIDO**: workarounds, mocks, dados hardcoded, in-memory storage, valores default falsos. TODA lógica deve ser enterprise-grade com persistência real em PostgreSQL |
| 7 | **MUDANÇAS CIRÚRGICAS** | Diagnosticar causa raiz antes de agir. Analisar impacto em componentes dependentes. Implementar mudança isolada. |
| 8 | **QUALIDADE OBRIGATÓRIA** | TypeScript strict, zero any, Pino |
| 9 | **VALIDAÇÃO CONTÍNUA** | Testar após cada micro-passo |
| 10 | **DOCUMENTAÇÃO PT-BR** | TODA documentação em português |
| 11 | **SEGUIR DOCS OFICIAIS** | Melhores práticas 2025 |
| 12 | **PRODUÇÃO HETZNER** | Deploy via GitHub Actions |
| 13 | **INTERNACIONALIZAÇÃO** | PT-BR primário, EN secundário |
| 14 | **VERIFICAR SECRETS** | Checar variáveis existentes |
| 15 | **MICROSSERVIÇOS** | Código em apps/, compartilhado em packages/ |
| 16 | **MELHORES PRÁTICAS** | API Gateway, health checks, circuit breakers |

### Preferências de Idioma

| Contexto | Idioma |
|----------|--------|
| Documentação | Português Brasileiro |
| Comentários no código | Português Brasileiro |
| Mensagens de log | Português Brasileiro |
| Nomes de variáveis | Inglês |
| Termos técnicos | Inglês (OAuth, JWT, etc.) |

### Ambiente de Desenvolvimento vs Produção

| Ambiente | Local | Propósito | Regras |
|----------|-------|-----------|--------|
| DESENVOLVIMENTO | Replit | IDE e preview de UI | Dados de preview permitidos APENAS em `server/index-dev.ts` |
| PRODUÇÃO | Hetzner Cloud | Sistema enterprise real | **PROIBIDO** mocks/hardcoded (Regra 6) |

**IMPORTANTE**: Código em `apps/` (microsserviços) vai para produção via GitHub Actions. `server/index-dev.ts` é APENAS para preview no Replit e NÃO é deployado para produção.

## System Architecture

Alice employs a microservices architecture, with services containerized and communicating via an API Gateway (Traefik). The system is designed for enterprise-grade solutions, prioritizing data privacy, scalability, and resilience.

### Microservices

The platform includes several microservices: `frontend`, `api-gateway`, `auth`, `chat`, `rag`, `training`, `integrations`, and `observability`.

### UI/UX Decisions

- **Frontend Stack**: React 18, TypeScript 5, Vite 5, shadcn/ui, Tailwind CSS.
- **Internationalization**: Primary support for PT-BR, secondary for EN using `react-i18next`.
- **IA Dashboard**: Features conversation metrics, image displays, SLA, and circuit breaker status.
- **Takeover/Handover Panel**: Integrated into the Alice dashboard for human agent intervention in Web and WhatsApp interactions.

### Technical Implementations

- **Authentication**: OAuth 2.0, SAML 2.0, bcrypt local auth, 6-level RBAC, HMAC-SHA256 for service-to-service.
- **OIDC Provider**: node-oidc-provider v9.5.2 (OpenID Certified) com Alice como IdP único para Grafana e ERPNext. PKCE obrigatório (S256), RS256 JWT signing, PostgreSQL adapter (Regra 6 - sem in-memory). Claims customizados: role, tenant_id, modules, auth_provider.
- **Real-time Chat**: WebSockets for streaming LLM tokens with rate limiting.
- **RAG Backend**: Salad Cloud for embeddings, pgvector for vector search.
- **Image Generation**: Self-hosted FLUX.1 Schnell on Salad Cloud.
- **Multimodal Embeddings**: Self-hosted CLIP ViT-L/14 on Salad Cloud.
- **Takeover/Handover**: Custom panel with automatic triggers based on confidence scores, fallbacks, and sentiment analysis.
- **CI/CD**: Automated GitHub Actions for Docker image building, deployment to Hetzner, and health checks.
- **Code Quality**: Pino for logging, TypeScript strict mode, health checks.
- **Build System**: `esbuild` and 3-stage Dockerfiles. Vite build isolado no diretório `client/` para evitar conflitos com pnpm workspace.
- **Monorepo Build Fix**: Build script usa `cd client && vite build` para isolar o build do frontend, evitando que o Vite detecte `apps/frontend-service/index.html` como entrada adicional.
- **Resilience & Performance**: Connection pool lifecycle management, Opossum Circuit Breaker, WebSocket rate limiting, Docker resource limits, sanitization of secrets, CSRF token comparison, AbortController for external calls.
- **Security Hardening**: PostgreSQL RLS, sslmode=prefer, tenant_id indices, pgAudit, Docker Non-Root, Traefik v3.3, Redis ACL, GitHub Actions hardening, CSP Hardening, Compression Middleware, Server Timeouts, ERPNext Fail-Fast, central packages, JSONB TypeSafe with Zod schemas, React Suspense, Express Hardening Module, Zod Input Validation.
- **Stripe Idempotency**: `generateIdempotencyKey()` with `crypto.randomUUID()`, fail-fast in production if not provided.
- **WebSocket Auth**: PostgreSQL session validation (`connect-pg-simple`) with mandatory `SESSION_SECRET` and cached validated sessions.
- **Feature Flags**: Enterprise system with PostgreSQL persistence, TTL 60s cache, multi-tenant support, and Express middleware.
- **Identity Provisioning**: Propagação automática Alice → Grafana/ERPNext via Outbox Pattern. Eventos suportados: `user.created`, `user.updated`, `user.role_changed`, `user.disabled`, `user.deleted`. Endpoints: `PATCH /api/users/:id`, `PATCH /api/users/:id/role`, `PATCH /api/users/:id/status`, `DELETE /api/users/:id`.

### System Design Choices

- **Multi-tenant Isolation**: PostgreSQL Row Level Security (RLS) with `tenant_id` isolation policies.
- **OWASP API3**: Critical authentication routes use Zod schemas for input validation.

## Versões Padronizadas (2025)

**REGRA CRÍTICA**: Todas as dependências devem usar EXATAMENTE estas versões em TODOS os package.json.

| Categoria | Pacote | Versão |
|-----------|--------|--------|
| **Core** | TypeScript | 5.7.2 |
| **Core** | @types/node | 22.10.2 |
| **Build** | tsx | 4.20.6 |
| **Build** | esbuild | 0.25.12 |
| **Build** | vite | 5.4.21 |
| **Backend** | express | 4.21.2 |
| **Backend** | helmet | 8.1.0 |
| **Backend** | cors | 2.8.5 |
| **Logging** | pino | 10.1.0 |
| **Logging** | pino-pretty | 13.1.2 |
| **Database** | drizzle-orm | 0.39.1 |
| **Database** | drizzle-kit | 0.31.7 |
| **Database** | pg | 8.12.0 |
| **Validation** | zod | 3.24.2 |
| **Resilience** | opossum | 9.0.0 |
| **Frontend** | react | 18.3.1 |
| **Frontend** | @tanstack/react-query | 5.60.5 |
| **Frontend** | tailwindcss | 3.4.18 |

## External Dependencies

- **LLM**: Llama 4 Maverick (400B params) on Salad Cloud.
- **Embeddings**: text-embedding-3-small on Salad Cloud.
- **Image Generation**: FLUX.1 Schnell (Apache 2.0) on Salad Cloud.
- **CLIP Inference**: CLIP ViT-L/14 (MIT) on Salad Cloud.
- **Payments**: Stripe, Wise.
- **CRM/ERP**: ERPNext.
- **Communication**: Twilio (WhatsApp, SMS), Resend (transactional emails).
- **Database**: PostgreSQL with pgvector extension.
- **Observability**: Prometheus 3.0, Grafana OSS 11.3, Jaeger 1.62, OpenTelemetry Collector, Langfuse 2.x.
- **API Gateway**: Traefik v3.3.
- **CI/CD**: GitHub Actions.
- **Object Storage**: Hetzner Object Storage (S3-compatible) - regiões: fsn1, nbg1, hel1.

## Mudanças Recentes

### 2025-11-29: Code Review Enterprise

**P0 - Tipos prom-client 15.x RBAC (CORRIGIDO)**
- Interface `RbacPrometheusMetrics` refatorada com assinaturas exatas do prom-client 15.x:
  - `Counter.inc(value?: number): void;`
  - `Counter.inc(labels: Record<string, string | number>, value?: number): void;`
  - `Histogram.observe(value: number): void;`
  - `Histogram.observe(labels: Record<string, string | number>, value: number): void;`
  - `Gauge.set(value: number): void;`
- Uso de `satisfies AliceMetrics` em `createAlicePrometheus` para:
  - Preservar tipos literais dos labels (Counter<'tenant_id'>)
  - Manter contrato de tipo AliceMetrics (Regra 8)
- Todos os 7 microsserviços compilam sem erros TypeScript strict

**P1 - Storage S3 Hetzner (CORRIGIDO)**
- Eliminado fallback local em ambientes não-development (Regra 6)
- `REQUIRES_S3 = !IS_DEVELOPMENT` - staging/preview/production/test exigem S3
- Validação de formato de endpoint S3 no boot
- Verificação de conectividade via HEAD bucket com fail-fast:
  - 2xx = sucesso
  - 403 = credenciais inválidas (FATAL)
  - 404 = bucket não existe (FATAL)
  - 5xx = erro servidor (FATAL)
- Região default: `fsn1` (Hetzner Falkenstein)
- **BUG CRÍTICO readFile() CORRIGIDO**: s3FetchInternal não retornava body
  - Criado `S3ResponseWithBody` interface com campo `body: Buffer`
  - Criado `s3GetWithBody()` que coleta chunks e retorna body
  - Criado `s3GetBreaker` dedicado para GET (timeout 60s para downloads)
  - `readFile()` agora usa `s3GetBreaker` e retorna `response.body`
  - Tratamento específico: 404 = arquivo não encontrado, 403 = acesso negado

**P2 - Validação Zod WebSocket/RAG (JÁ IMPLEMENTADO)**
- Schemas por domínio: `packages/shared/src/schema/{chat,rag,media,shared-zod}.ts`
- WebSocket: `wsMessageSchema.safeParse()` já em uso
- Endpoints REST: Validação Zod em todos os handlers críticos

**P3 - Health Checks e Circuit Breakers (JÁ IMPLEMENTADOS)**
- API Gateway: CircuitBreaker por microsserviço com PRESETS
- Chat Service: ragBreaker, createBreaker (Flux)
- RAG Service: s3Breaker, clipBreaker
- Training Service: Salad Cloud breakers
- Observability: Health checks agregados com latência

## Bootstrap de Produção

### Pré-requisitos

1. **Servidor Hetzner CX43** configurado com Ubuntu 24.04
   - IP: 46.224.46.93
   - 8 vCPU, 16GB RAM, 160GB SSD
   - Domínio: yesyoudeserve.duckdns.org

2. **Secrets GitHub configurados** (ver matriz abaixo)

3. **Chave SSH** para acesso do Replit ao servidor

### Scripts de Setup

Os scripts estão em `infra/scripts/`:

| Script | Descrição | Onde Executar |
|--------|-----------|---------------|
| `setup-ssh-key.sh` | Configura chave SSH para deploy | Replit (local) |
| `setup-hetzner.sh` | Instala Docker, Nginx, PostgreSQL | Servidor Hetzner (via SSH) |
| `setup-ssl.sh` | Configura SSL Let's Encrypt | Servidor Hetzner (via SSH) |

### Passo a Passo

```bash
# 1. No Replit: Configurar chave SSH
bash infra/scripts/setup-ssh-key.sh

# 2. Testar conexão SSH
ssh root@46.224.46.93

# 3. No servidor Hetzner: Setup inicial
curl -sL https://raw.githubusercontent.com/fillipeguerrabtc/alice/main/infra/scripts/setup-hetzner.sh | bash

# 4. No servidor Hetzner: Configurar SSL
curl -sL https://raw.githubusercontent.com/fillipeguerrabtc/alice/main/infra/scripts/setup-ssl.sh | bash

# 5. No GitHub: Disparar workflow "Deploy to Production"
# Actions → Deploy to Production → Run workflow → Branch: main
```

### Disparar Deploy

1. Acesse: `https://github.com/fillipeguerrabtc/alice/actions`
2. Clique em **"Deploy to Production"** na sidebar
3. Clique em **"Run workflow"** (botão verde)
4. Selecione branch `main`
5. Clique em **"Run workflow"** novamente
6. Aguarde aprovação manual no stage de deploy

## Matriz de Secrets GitHub

**Status**: ✅ TODOS CONFIGURADOS (verificado em 2025-11-28)

| Secret | Descrição | Categoria |
|--------|-----------|-----------|
| `GH_PAT` | GitHub Personal Access Token para GHCR | CI/CD |
| `HETZNER_SSH_PRIVATE_KEY` | Chave SSH Ed25519 para deploy | Infraestrutura |
| `HETZNER_VM_HOST` | IP do servidor (46.224.46.93) | Infraestrutura |
| `HETZNER_VM_USER` | Usuário SSH (root) | Infraestrutura |
| `GOOGLE_CLIENT_ID` | OAuth Google | Autenticação |
| `GOOGLE_CLIENT_SECRET` | OAuth Google | Autenticação |
| `OAUTH_GITHUB_CLIENT_ID` | OAuth GitHub | Autenticação |
| `OAUTH_GITHUB_CLIENT_SECRET` | OAuth GitHub | Autenticação |
| `PGPASSWORD` | Senha PostgreSQL produção | Database |
| `SESSION_SECRET` | Secret para sessions Express | Segurança |
| `SALAD_API_KEY` | API key Salad Cloud | IA/LLM |
| `SALAD_ORGANIZATION_ID` | Org ID Salad Cloud | IA/LLM |
| `RESEND_API_KEY` | API key Resend (emails) | Comunicação |
| `STRIPE_PUBLISHABLE_KEY` | Stripe public key | Pagamentos |
| `STRIPE_SECRET_KEY` | Stripe secret key | Pagamentos |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook secret | Pagamentos |
| `TWILIO_ACCOUNT_SID` | Twilio Account SID | Comunicação |
| `TWILIO_AUTH_TOKEN` | Twilio Auth Token | Comunicação |
| `TWILIO_WHATSAPP_NUMBER` | Número WhatsApp Twilio | Comunicação |
| `WISE_API_KEY` | API key Wise | Pagamentos |
| `WISE_PROFILE_ID` | Profile ID Wise | Pagamentos |

### Verificar Secrets no GitHub

```bash
# Via GitHub CLI (se instalado)
gh secret list -R fillipeguerrabtc/alice

# Ou acessar manualmente:
# https://github.com/fillipeguerrabtc/alice/settings/secrets/actions
```