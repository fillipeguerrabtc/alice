# Alice - Plataforma Enterprise de IA Autônoma

## Overview

Alice is an autonomous AI enterprise platform, powered by the Llama 4 Maverick (400B parameters) model, hosted on Salad Cloud. Its core purpose is to deliver a fully autonomous AI solution that addresses critical business needs: absolute privacy, predictable costs, and unlimited customization via fine-tuning. The platform aims to eliminate dependencies on external APIs, mitigate privacy concerns with third-party servers, and provide an alternative to unpredictable token-based pricing models.

Key capabilities include real-time chat with streaming, deduplication, multi-tenancy, RBAC, a RAG backend for embeddings and vector search, and integrations with payment systems (Stripe, Wise), CRM (ERPNext), and communication platforms (Twilio, Resend). The platform also incorporates advanced AI features such as image generation (FLUX.1 Schnell), aggressive self-learning, and a robust observability stack. The business vision is to provide an enterprise-grade AI solution that offers unparalleled control and performance, enabling businesses to leverage AI without compromising on data security or cost predictability.

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

The platform includes several microservices:
-   `frontend`: React Single Page Application.
-   `api-gateway`: Traefik for routing and SSL.
-   `auth`: Handles OAuth/SAML, local authentication, and RBAC.
-   `chat`: Manages LLM interactions, WebSockets, streaming, and persistence.
-   `rag`: Provides embeddings and vector search capabilities.
-   `training`: Manages data collection, deduplication, and fine-tuning.
-   `integrations`: Proxies for external services.
-   `observability`: Monitoring and logging stack.

### UI/UX Decisions

-   **Frontend Stack**: React 18, TypeScript 5, Vite 5, shadcn/ui, Tailwind CSS.
-   **Internationalization**: Primary support for PT-BR, secondary for EN using `react-i18next`.
-   **IA Dashboard**: Features conversation metrics, image displays, SLA, and circuit breaker status.
-   **Takeover/Handover Panel**: Integrated into the Alice dashboard for human agent intervention in Web and WhatsApp interactions.

### Technical Implementations

-   **Authentication**: Supports OAuth 2.0 (Google, GitHub, Microsoft), SAML 2.0 (Azure AD, Okta), bcrypt-based local authentication, and a 6-level RBAC system. Service-to-service authentication uses HMAC-SHA256 for secure internal communication.
-   **Real-time Chat**: Uses WebSockets for streaming LLM tokens, with rate limiting (sliding window + progressive cooldown).
-   **RAG Backend**: Utilizes Salad Cloud for embeddings and pgvector for vector search (500-character chunks, 50 overlap). Implements a circuit breaker (30s timeout, 50% error, 30s reset) for S3 operations.
-   **Image Generation**: Leverages self-hosted FLUX.1 Schnell on Salad Cloud, with approved images contributing to training via Progressive LoRA and multimodal RAG via CLIP embeddings.
-   **Multimodal Embeddings**: Self-hosted CLIP ViT-L/14 on Salad Cloud for 768-dimension cross-modal embeddings.
-   **Takeover/Handover**: Custom panel with automatic triggers based on confidence scores, fallbacks, and sentiment analysis.
-   **CI/CD**: Automated GitHub Actions for Docker image building, pushing, SSH deployment to Hetzner, and health checks.
-   **Code Quality**: Enforces Pino for logging, TypeScript strict mode, and mandatory health checks at `/api/servico/health`.
-   **Build System**: `esbuild` for bundling with topological sort, and 3-stage Dockerfiles (Builder, Pruner, Runner).
-   **Resilience & Performance**: Includes connection pool lifecycle management (`packages/database`), Opossum Circuit Breaker, WebSocket rate limiting, Docker resource limits in production, and sanitization of secrets in logs. CSRF token comparison uses `crypto.timingSafeEqual` for security. AbortController is integrated with `fetchWithAbort` and `createProtectedFetch` for robust timeout handling.

### System Design Choices

-   **Multi-tenant Isolation**: Future plans include adding `NOT NULL` constraints to `tenant_id` columns, implementing PostgreSQL Row Level Security (RLS), and updating queries to filter by `tenant_id`.

## External Dependencies

### Salad Cloud

-   **LLM**: Llama 4 Maverick (400B params).
-   **Embeddings**: text-embedding-3-small.
-   **Image Generation**: FLUX.1 Schnell (Apache 2.0).
-   **CLIP Inference**: CLIP ViT-L/14 (MIT).

### Integrations

-   **Payments**: Stripe Portugal, Wise.
-   **CRM/ERP**: ERPNext (via `frappe_docker`).
-   **Communication**: Twilio (WhatsApp, SMS), Resend (transactional emails).
-   **Database**: PostgreSQL with pgvector extension.
-   **Observability**: Prometheus 3.0, Grafana OSS 11.3, Jaeger 1.62, OpenTelemetry Collector, Langfuse 2.x.
-   **API Gateway**: Traefik.
-   **CI/CD**: GitHub Actions.