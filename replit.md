# Alice - Plataforma Enterprise de IA Autônoma

## Overview

Alice is an autonomous, production-ready enterprise AI platform built around the **Llama 4 Maverick (400B parameters)** model hosted on Salad Cloud. It aims to solve critical problems in enterprise AI by eliminating third-party dependency, ensuring data privacy, offering predictable costs, and enabling unlimited customization. The platform provides real-time chat with streaming, multi-tenant isolation, robust RBAC, RAG backend with HNSW vector search, and integrations with various enterprise services.

## User Preferences

-   **Communication Style**: All documentation, code comments, and log messages should be in Brazilian Portuguese.
-   **Coding Style**: Variable names and technical terms (e.g., OAuth, JWT) should be in English.
-   **Workflow Preferences**:
    -   **READ BEFORE ACTING**: Always inspect existing files before implementing new features.
    -   **DO NOT DUPLICATE**: Check for existing code before writing new code.
    -   **STRUCTURED WORKFLOW**: Follow a structured workflow: Diagnosis → Plan → Approval → Implementation.
    -   **APPROVAL REQUIRED**: Request approval before making significant changes.
    -   **NO LIES**: State "I don't know" when unsure.
    -   **NO TEMPORARY SOLUTIONS**: Avoid workarounds, mocks, hardcoded data, in-memory storage, or false default values. All logic must be enterprise-grade with real PostgreSQL persistence.
    -   **MINIMAL CHANGES**: Focus surgically on the problem at hand.
    -   **QUALITY MANDATORY**: Use TypeScript strict mode, forbid `any`, and use Pino for logging.
    -   **CONTINUOUS VALIDATION**: Test after each micro-step.
    -   **FOLLOW OFFICIAL DOCS**: Adhere to 2025 best practices.
    -   **PRODUCTION ON HETZNER**: Deploy via GitHub Actions.
    -   **INTERNATIONALIZATION**: Brazilian Portuguese primary, English secondary.
    -   **CHECK SECRETS**: Verify existing variables.
    -   **MICROSERVICES**: Code in `apps/`, shared in `packages/`.
    -   **BEST PRACTICES**: Implement API Gateway, health checks, and circuit breakers.
-   **Interaction Preferences**: Ask for approval before making major changes.
-   **Agent Working Preferences**: The development environment (Replit) is for UI preview and local development; `server/index-dev.ts` is only for preview and does not go into production. All production code must adhere to enterprise-grade standards without mocks or hardcoded values.

## System Architecture

### UI/UX Decisions
The frontend is a React SPA, with branding assets managed centrally.

### Technical Implementations
-   **AI Model**: Llama 4 Maverick (400B params, 17B active MoE) via Salad Cloud, supporting multimodal input (text, images, video) with text output and 1M token context.
-   **Embeddings**: `text-embedding-3-small` (1536 dimensions) for RAG and CLIP ViT-L/14 (768 dimensions) for multimodal inference.
-   **Image Generation**: FLUX.1 Schnell, self-hosted on RTX 3090/4090 GPUs.
-   **Real-time Chat**: WebSocket with streaming capabilities.
-   **Deduplication**: SemHash for duplicate data detection.
-   **Multi-tenancy**: Isolation enforced via `tenant_id`.
-   **Authentication**: OAuth 2.0 and SAML 2.0.
-   **RBAC**: 6 levels of permission (super_admin, admin, manager, operator, viewer, guest).
-   **Vector Search**: Native `pgvector` with HNSW indices for `media_uploads` (CLIP embeddings) and `document_chunks` (text embeddings).
-   **Handover/Takeover System**: `conversation-orchestrator` for seamless AI-to-human agent transitions with automatic escalation.
-   **Logging**: Pino logger; `console.log` is forbidden.
-   **TypeScript**: Strict mode, `any` type forbidden.
-   **Health Checks**: Mandatory `/api/service/health` endpoints for all microservices.

### System Design Choices
-   **Microservices Architecture**: Code organized into microservices in `apps/` with shared packages in `packages/`.
-   **API Gateway**: Traefik for routing and SSL.
-   **CI/CD**: GitHub Actions for automated testing, migration, and deployment.
-   **Security**: bcrypt (12 rounds) for passwords, HttpOnly/Secure/SameSite cookies, CSRF protection, rate limiting.
-   **Observability**: Integrated Prometheus, Grafana, Jaeger, and Langfuse.

### Services Overview
-   **frontend**: React SPA
-   **api-gateway**: Traefik
-   **auth**: OAuth/SAML
-   **chat**: LLM + WebSocket
-   **rag**: Embeddings
-   **training**: Fine-tuning
-   **integrations**: Stripe, Wise, etc.
-   **observability**: Monitoring and tracing

## External Dependencies

-   **Salad Cloud**: Llama 4 Maverick (LLM), `text-embedding-3-small` (embeddings).
-   **Self-hosted Models (via Salad Container Groups)**: FLUX.1 Schnell (Image Generation), CLIP ViT-L/14 (multimodal embeddings).
-   **Stripe Portugal**: Payments in EUR via SEPA, webhook integration.
-   **Wise**: International transfers (50+ currencies).
-   **ERPNext**: Integrated CRM and ERP system.
-   **Twilio**: WhatsApp and SMS communication with webhook support.
-   **Resend**: Transactional email service.
-   **PostgreSQL**: Primary database with `pgvector` extension.
-   **GitHub Actions**: CI/CD pipeline.
-   **Hetzner Cloud**: Production infrastructure hosting.

## Recent Changes (November 2025)

### Logging Compliance (Regra 8 - COMPLETO)

- `apps/frontend-service/src/lib/logger.ts`: Frontend logger resiliente (sendBeacon + fetch, retry com backoff, queue 100 itens, flush automático)
- `apps/frontend-service/src/pages/Chat.tsx`: frontendLogger.warn + toast para uploads inválidos
- `apps/observability-service/src/index.ts`: Rota POST /api/observability/logs para receber telemetria do frontend
- `packages/config/src/index.ts`: Pino logger para erros de configuração
- Zero console.* em código executável

### Testing

- 334 testes passando (unit + contract)
- RBAC: 81 testes (hierarquia, permissões, middleware, cache)
- Config: 117 testes (validação, service URLs, timeouts)
- Schema: 58 testes (Drizzle, enums, tabelas)
- Health: 45 testes (contratos de todos os serviços)
- Frontend Logger: 25 testes (estrutura, retry, queue, flush automático)

### CI/CD Pipeline (Regra 9 - COMPLETO)

- `.github/workflows/deploy-production.yml`: Testes unitários integrados ao pipeline
- Node.js 20 LTS consistente em CI, Docker e produção (zero incompatibilidade)
- Pipeline completo: ESLint → TypeScript Check → **Testes Unitários (334)** → npm audit → Build Docker → Aprovação Manual → Deploy Hetzner → Health Checks
- Deploy bloqueado automaticamente se qualquer teste falhar

### Backlog

- Microsoft OAuth: Stub documentado, autenticação local/Google/GitHub/SAML funcionam
- Testes E2E: Playwright (futuro)
- Testes de Carga: k6 (futuro)