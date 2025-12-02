# Alice - Plataforma Enterprise de IA Autônoma

## Overview
Alice is an autonomous AI enterprise platform powered by the Llama 4 Maverick (400B parameters) model, hosted on Salad Cloud. Its core purpose is to provide a fully autonomous AI solution with absolute privacy, predictable costs, and unlimited customization via fine-tuning. The platform aims to eliminate external API dependencies, mitigate privacy concerns, and offer an alternative to unpredictable token-based pricing. Key capabilities include real-time chat with streaming, deduplication, multi-tenancy, RBAC, a RAG backend, image generation, aggressive self-learning, and a robust observability stack. The business vision is to deliver an enterprise-grade AI solution with unparalleled control, performance, data security, and cost predictability.

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
Alice employs a microservices architecture with 26 containerized services orchestrated by Traefik API Gateway, emphasizing data privacy, scalability, and resilience.

**Core Architectural Components:**
- **Infrastructure Core**: Docker Socket Proxy, Traefik Init, Traefik API Gateway, PostgreSQL (with pgvector for semantic search and RLS for multi-tenancy).
- **Alice Microservices**:
    - **Frontend**: React 18, Vite 5, shadcn/ui, i18n PT-BR.
    - **Auth Service**: OAuth 2.0, SAML 2.0, OIDC Provider, 6-level RBAC, PostgreSQL sessions.
    - **Chat Service**: Real-time LLM token streaming via WebSockets.
    - **RAG Service**: Retrieval-Augmented Generation with embeddings and pgvector.
    - **Training Service**: Fine-tuning and self-learning scheduler.
    - **Integrations Service**: Handles external APIs (Stripe, Wise, Twilio, Resend).
    - **Observability Service**: Prometheus, Grafana, Jaeger for metrics, dashboards, and tracing.
    - **CLIP Inference**: Multimodal embeddings for images using CLIP ViT-L/14 (Python, PyTorch).
- **ERPNext Stack**: Includes MariaDB, Redis, Frappe Bench services, and NGINX frontend for comprehensive ERP functionalities.
- **Backup & Logs**: pgBackRest for PostgreSQL backups and Vector for log aggregation.

**Shared Packages (`packages/`):**
- `config`: Centralized configurations.
- `database`: Drizzle ORM, PostgreSQL schemas.
- `logger`: Pino structured logging.
- `shared`: Shared TypeScript types.
- `shared-utils`: Utilities like shutdown manager, circuit breaker, cache adapter.

**UI/UX Decisions:**
The frontend utilizes React 18, TypeScript 5, Vite 5, shadcn/ui, and Tailwind CSS, with PT-BR as the primary language. Key features include an AI Dashboard for performance metrics and a Takeover/Handover Panel for human intervention.

**Technical Implementations:**
- **Authentication**: Robust enterprise authentication (OAuth 2.0, SAML 2.0, 6-level RBAC, HMAC-SHA256 for S2S).
- **Real-time Communication**: WebSockets for LLM token streaming with rate limiting.
- **AI/ML**: RAG backend, image generation (FLUX.1 Schnell), and multimodal embeddings (CLIP ViT-L/14) are all self-hosted on Salad Cloud.
- **CI/CD**: Automated GitHub Actions for Docker builds and Hetzner deployments.
- **Code Quality**: Strict TypeScript, Pino logging, health checks.
- **Resilience & Performance**: Connection pooling, Circuit Breaker pattern, WebSocket rate limiting, graceful shutdowns.
- **Security Hardening**: PostgreSQL RLS, `sslmode=prefer`, `tenant_id` indices, pgAudit, Docker Non-Root, Redis ACL, CSP, input validation (Zod), and image scanning.
- **Caching**: Distributed cache adapter (Redis in production) for performance, including RBAC permission caching.
- **Secrets Management**: Secrets handled via chmod 600 files in `/tmp/alice-secrets/` and environment variables.
- **Feature Flags**: Enterprise-grade feature flag system with PostgreSQL persistence and TTL caching.
- **Identity Provisioning**: Automatic user propagation between Alice, Grafana, and ERPNext via Outbox Pattern.
- **Monorepo Management**: `pnpm overrides` for dependency deduplication.
- **RBAC API**: Dual API for permission checking (`checkPermission()` for cached, `checkPermissionDirect()` for direct).
- **API Security**: Rejects unsigned headers, `req.user` or HMAC-signed headers for authentication context.

**System Design Choices:**
- **Multi-tenant Isolation**: Achieved using PostgreSQL Row Level Security (RLS) with `tenant_id` policies.
- **API Security**: OWASP API3 compliance, with critical authentication routes utilizing Zod for input validation.

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

## Recent Changes (Dec 2025)

### Security Hardening - Production Audit

| Fase | Implementação | Status |
|------|---------------|--------|
| **FASE 1** | Content-Security-Policy (CSP) header no Traefik middleware | Completo |
| **FASE 2** | Healthchecks em 4 ERPNext workers (scheduler, short, default, long) | Completo |
| **FASE 3** | `security_opt: no-new-privileges:true` em TODOS 26 containers | Completo |
| **FASE 4** | Imagens pinadas com SHA256 digests 2024/2025 | Completo |
| **FASE 5** | `read_only: true` + tmpfs em TODOS 26 containers (Docker 2025 Best Practices) | Completo |

### Image Versions (SHA256 Pinned)

| Imagem | Versão | Digest |
|--------|--------|--------|
| Traefik | v3.3 | sha256:b8bded... |
| PostgreSQL | pg16 (pgvector) | sha256:d836eb... |
| MariaDB | 10.11 | sha256:dc249c... |
| Redis | 7-alpine | sha256:e600a2... |
| ERPNext | v15.88.0 | sha256:158d31... |
| Vector | 0.43.1-alpine | sha256:ffa011... |
| pgBackRest | 2.54.0 (woblerr) | Community image |
| Docker Socket Proxy | latest | sha256:2f92c6... |
| BusyBox | 1.36 | sha256:2376a0... |

### Compliance Verification

- **26 containers** = **26 security_opt entries** (100% coverage)
- **26 containers** = **26 read_only: true entries** (100% coverage)
- **CSP Headers**: OWASP 2025 compliant (unsafe-inline/eval required for React/ERPNext)
- **Healthchecks**: Todos os workers com verificação de processo via pgrep
- **Supply Chain Security**: Todas imagens externas com digest SHA256
- **Immutable Infrastructure**: Todos containers com filesystem read-only + tmpfs para escrita temporária