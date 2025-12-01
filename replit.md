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
- **OIDC Provider**: node-oidc-provider v9.5.2 (OpenID Certified) with Alice as the sole IdP for Grafana and ERPNext. PKCE (S256) and RS256 JWT signing are mandatory, with a PostgreSQL adapter. Custom claims include role, tenant_id, modules, and auth_provider.
- **Real-time Chat**: WebSockets for streaming LLM tokens with rate limiting.
- **RAG Backend**: Salad Cloud for embeddings, pgvector for vector search.
- **Image Generation**: Self-hosted FLUX.1 Schnell on Salad Cloud.
- **Multimodal Embeddings**: Self-hosted CLIP ViT-L/14 on Salad Cloud.
- **Takeover/Handover**: Custom panel with automatic triggers based on confidence scores, fallbacks, and sentiment analysis.
- **CI/CD**: Automated GitHub Actions for Docker image building, deployment to Hetzner, and health checks.
- **Code Quality**: Pino for logging, TypeScript strict mode, health checks.
- **Logger Singleton**: Enterprise-grade logging com Pino usando padrão singleton. Um único base logger é criado com transport pino-pretty, e todos os serviços usam child loggers via `createLogger('service-name')`. Isso elimina vazamento de listeners `process.on('exit')` que ocorria com múltiplas instâncias pino. Uso: `import { createLogger } from '@alice/shared-utils'`. Child loggers herdam o transport do singleton base (zero overhead).
- **Build System**: `esbuild` and 3-stage Dockerfiles. Vite build isolated in `client/` to prevent pnpm workspace conflicts.
- **Resilience & Performance**: Connection pool lifecycle management, Opossum Circuit Breaker, WebSocket rate limiting, Docker resource limits, sanitization of secrets, CSRF token comparison, AbortController for external calls.
- **ShutdownManager Centralizado**: Gerenciador enterprise-grade de graceful shutdown em `@alice/shared-utils`. Elimina duplicação de listeners SIGTERM/SIGINT, coordena ordem de shutdown por prioridade (HTTP_SERVER=100 → WEBSOCKET=90 → BACKGROUND_JOBS=80 → DATABASE=50). Uso: `registerShutdownCallback(name, fn, { priority: ShutdownPriority.HTTP_SERVER })`. **IMPORTANTE**: Callbacks são async/await - sempre usar `await closeDatabasePool()` e `await isPoolHealthy()` (funções assíncronas do `@alice/database`).
- **Security Hardening**: PostgreSQL RLS, sslmode=prefer, tenant_id indices, pgAudit, Docker Non-Root, Traefik v3.3, Redis ACL, GitHub Actions hardening, CSP Hardening, Compression Middleware, Server Timeouts, ERPNext Fail-Fast, central packages, JSONB TypeSafe with Zod schemas, React Suspense, Express Hardening Module, Zod Input Validation.
- **Stripe Idempotency**: `generateIdempotencyKey()` with `crypto.randomUUID()`, fail-fast in production if not provided.
- **WebSocket Auth**: PostgreSQL session validation (`connect-pg-simple`) with mandatory `SESSION_SECRET` and cached validated sessions.
- **Feature Flags**: Enterprise system with PostgreSQL persistence, TTL 60s cache, multi-tenant support, and Express middleware.
- **Identity Provisioning**: Automatic propagation Alice → Grafana/ERPNext via Outbox Pattern for `user.created`, `user.updated`, `user.role_changed`, `user.disabled`, `user.deleted` events.

### System Design Choices

- **Multi-tenant Isolation**: PostgreSQL Row Level Security (RLS) with `tenant_id` isolation policies.
- **OWASP API3**: Critical authentication routes use Zod schemas for input validation.

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
- **Object Storage**: Hetzner Object Storage (S3-compatible).