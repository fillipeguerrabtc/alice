# Alice - Plataforma Enterprise de IA Autônoma

## Overview
Alice is an autonomous AI enterprise platform powered by the Llama 4 Maverick (400B parameters) model, hosted on Salad Cloud. It provides a fully autonomous AI solution focused on absolute privacy, predictable costs, and unlimited customization via fine-tuning. The platform aims to eliminate external API dependencies, mitigate privacy concerns, and offer an alternative to unpredictable token-based pricing. Key capabilities include real-time chat with streaming, deduplication, multi-tenancy, RBAC, a RAG backend, image generation, aggressive self-learning, and a robust observability stack. The business vision is to deliver an enterprise-grade AI solution with unparalleled control and performance, ensuring data security and cost predictability.

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
Alice uses a microservices architecture with containerized services communicating via Traefik API Gateway. It prioritizes data privacy, scalability, and resilience.

### Microservices
The platform includes `frontend`, `api-gateway`, `auth`, `chat`, `rag`, `training`, `integrations`, and `observability` microservices.

### UI/UX Decisions
The frontend uses React 18, TypeScript 5, Vite 5, shadcn/ui, and Tailwind CSS, with primary internationalization in PT-BR. Features include an AI Dashboard for metrics and a Takeover/Handover Panel for human agent intervention.

### Technical Implementations
- **Authentication**: OAuth 2.0, SAML 2.0, bcrypt local auth, 6-level RBAC, HMAC-SHA256 for S2S. Uses node-oidc-provider v9.5.2 with PostgreSQL adapter and custom claims.
- **Real-time Chat**: WebSockets for streaming LLM tokens with rate limiting.
- **RAG Backend**: Salad Cloud for embeddings, pgvector for vector search.
- **Image Generation**: Self-hosted FLUX.1 Schnell on Salad Cloud.
- **Multimodal Embeddings**: Self-hosted CLIP ViT-L/14 on Salad Cloud.
- **Takeover/Handover**: Custom panel with automatic triggers based on confidence, fallbacks, and sentiment analysis.
- **CI/CD**: Automated GitHub Actions for Docker image building, Hetzner deployment, and health checks.
- **Code Quality**: Pino for logging (singleton), TypeScript strict mode, health checks.
- **Build System**: `esbuild` and 3-stage Dockerfiles.
- **Resilience & Performance**: Connection pool management, Opossum Circuit Breaker, WebSocket rate limiting, Docker resource limits, secrets sanitization, CSRF tokens, AbortController.
- **Shutdown Manager**: Centralized graceful shutdown in `@alice/shared-utils` with prioritized callback execution.
- **Security Hardening**: PostgreSQL RLS, `sslmode=prefer`, `tenant_id` indices, pgAudit, Docker Non-Root, Traefik v3.3, Redis ACL, GitHub Actions hardening, CSP, Compression Middleware, Server Timeouts, ERPNext Fail-Fast, JSONB TypeSafe with Zod, React Suspense, Express Hardening, Zod Input Validation, Trivy Image Scan CI/CD, ERPNext v15.74.2 (CVEs corrected).
- **Redis Cache Adapter**: Distributed cache adapter (`RedisCacheAdapter` for production, `MemoryCacheAdapter` for dev) with fail-fast for Redis.
- **RBAC Permission Cache**: Asynchronous permission caching using `CacheAdapter` (Redis in production) with initialize/destroy methods.
- **Cache Initialization Pattern**: Centralized function `initializeAllCaches()` for startup and `close*` functions for shutdown.
- **Secrets Management**: Seed scripts save secrets to chmod 600 files in `/tmp/alice-secrets/`. Mandatory URLs via env vars.
- **Stripe Idempotency**: `generateIdempotencyKey()` using `crypto.randomUUID()`, fail-fast in production.
- **WebSocket Auth**: PostgreSQL session validation (`connect-pg-simple`) with mandatory `SESSION_SECRET`.
- **Feature Flags**: Enterprise system with PostgreSQL persistence, TTL cache, multi-tenant support, and Express middleware.
- **Identity Provisioning**: Automatic propagation Alice → Grafana/ERPNext via Outbox Pattern for user events.
- **pnpm Monorepo Deduplication**: `pnpm overrides` force unique versions of critical dependencies (`drizzle-orm`, `pg`, `@types/pg`, `@types/react`) to prevent type incompatibilities.
- **RBAC Dual API**: `checkPermission()` (async, Redis cache) and `checkPermissionDirect()` (sync, no cache) for different use cases.
- **extractAuthContext Security**: Rejects unsigned headers; only `req.user` (authenticated session) or internal HMAC-signed headers are accepted.

### System Design Choices
- **Multi-tenant Isolation**: PostgreSQL Row Level Security (RLS) with `tenant_id` isolation policies.
- **OWASP API3**: Critical authentication routes use Zod schemas for input validation.

## External Dependencies
- **LLM**: Llama 4 Maverick (400B params) on Salad Cloud.
- **Embeddings**: text-embedding-3-small on Salad Cloud.
- **Image Generation**: FLUX.1 Schnell on Salad Cloud.
- **CLIP Inference**: CLIP ViT-L/14 on Salad Cloud.
- **Payments**: Stripe, Wise.
- **CRM/ERP**: ERPNext.
- **Communication**: Twilio (WhatsApp, SMS), Resend (transactional emails).
- **Database**: PostgreSQL with pgvector extension.
- **Observability**: Prometheus 3.0, Grafana OSS 11.3, Jaeger 1.62, OpenTelemetry Collector, Langfuse 2.x.
- **API Gateway**: Traefik v3.3.
- **CI/CD**: GitHub Actions.
- **Object Storage**: Hetzner Object Storage (S3-compatible).

## GitHub Actions Secrets (Lista Completa - 02/12/2025)

**IMPORTANTE**: Estes são os nomes EXATOS dos secrets configurados no repositório GitHub.
Qualquer referência em workflows DEVE usar estes nomes.

| # | Secret | Categoria | Uso |
|---|--------|-----------|-----|
| 1 | `GH_PAT` | Infraestrutura | Personal Access Token para GHCR |
| 2 | `GOOGLE_CLIENT_ID` | OAuth | Login com Google |
| 3 | `GOOGLE_CLIENT_SECRET` | OAuth | Login com Google |
| 4 | `HETZNER_SSH_PRIVATE_KEY` | Infraestrutura | Chave SSH para deploy |
| 5 | `HETZNER_VM_HOST` | Infraestrutura | IP do servidor Hetzner |
| 6 | `HETZNER_VM_USER` | Infraestrutura | Usuário SSH (root) |
| 7 | `INTERNAL_API_SECRET` | Segurança | HMAC para comunicação S2S |
| 8 | `OAUTH_GITHUB_CLIENT_ID` | OAuth | Login com GitHub |
| 9 | `OAUTH_GITHUB_CLIENT_SECRET` | OAuth | Login com GitHub |
| 10 | `PGPASSWORD` | Database | Senha PostgreSQL |
| 11 | `RESEND_API_KEY` | Email | Emails transacionais |
| 12 | `SALAD_API_KEY` | LLM | Llama 4 Maverick API |
| 13 | `SALAD_ORGANIZATION_ID` | LLM | Organização Salad Cloud |
| 14 | `SESSION_SECRET` | Segurança | Sessões Express |
| 15 | `STRIPE_PUBLISHABLE_KEY` | Pagamentos | Stripe frontend |
| 16 | `STRIPE_SECRET_KEY` | Pagamentos | Stripe backend |
| 17 | `STRIPE_WEBHOOK_SECRET` | Pagamentos | Validação webhooks |
| 18 | `TWILIO_ACCOUNT_SID` | WhatsApp | Conta Twilio |
| 19 | `TWILIO_AUTH_TOKEN` | WhatsApp | Token Twilio |
| 20 | `TWILIO_WHATSAPP_NUMBER` | WhatsApp | Número WhatsApp |
| 21 | `WISE_API_KEY` | Pagamentos | Wise API |
| 22 | `WISE_PROFILE_ID` | Pagamentos | Perfil Wise |

## Recent Changes - Security Audit December 2025

### Verificação Completa de Segurança (02/12/2025)

| Componente | Status | Versão | CVEs Corrigidos |
|------------|--------|--------|-----------------|
| Node.js (pnpm audit) | **0 vulnerabilities** | - | GHSA-67mh-4wv8-2f99, GHSA-76c9-3jph-rj3q |
| PyTorch | **Atualizado** | 2.9.1 | CVE-2025-32434, CVE-2025-3730, CVE-2025-2953 |
| torchvision | Atualizado | 0.24.1 | Compatível com PyTorch 2.9.1 |
| urllib3 | Corrigido | ≥2.5.0 | CVE-2025-50181, CVE-2025-50182 |
| CUDA Docker | Atualizado | 12.8.0-cudnn9 | CVEs toolkit NVIDIA |
| esbuild (pnpm override) | Forçado | ≥0.25.0 | GHSA-67mh-4wv8-2f99 |
| on-headers (pnpm override) | Forçado | ≥1.1.0 | GHSA-76c9-3jph-rj3q |
| SSH Private Key | **Removido** | N/A | Arquivo `infra/scripts/setup-ssh-key.sh` deletado |

### Correções CI/CD (02/12/2025)

**Problema 1**: Trivy falhava porque dependências não estavam instaladas antes do scan.
**Solução**: Steps para instalar Node.js e Python dependencies ANTES do Trivy.

**Problema 2**: Chave SSH privada hardcoded em `infra/scripts/setup-ssh-key.sh` (HIGH severity).
**Solução**: Arquivo REMOVIDO. Chave SSH armazenada APENAS em Secrets (GitHub + Replit).

**Problema 3**: PyTorch 2.6.0 tinha CVE-2025-3730 (MEDIUM) e CVE-2025-2953 (LOW).
**Solução**: Atualizado para PyTorch 2.9.1 (latest stable - Nov 2025).

**IMPORTANTE**: NÃO usamos `exit-code: 0` no Trivy (workaround proibido pela Regra 6).
O pipeline DEVE falhar se vulnerabilidades CRITICAL/HIGH forem encontradas.