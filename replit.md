# Alice - Plataforma Enterprise de IA Autônoma

## Overview
Alice is a production-ready, autonomous enterprise AI platform built around the Llama 4 Maverick (400B parameters) model hosted on Salad Cloud. Its core purpose is to provide a highly customizable, private, and cost-predictable AI solution, solving common enterprise challenges such as third-party API dependency, data privacy concerns, and unpredictable token-based costs. The platform offers full autonomy, ensuring data never leaves the controlled infrastructure and allowing for unlimited customization through fine-tuning for each client.

## User Preferences
- **Critical Rule 1: READ BEFORE ACTING**: Inspect files before implementing.
- **Critical Rule 2: DO NOT DUPLICATE**: Check existing code first.
- **Critical Rule 3: STRUCTURED WORKFLOW**: Diagnosis → Plan → Approval → Implementation.
- **Critical Rule 4: MANDATORY APPROVAL**: Ask for approval before making major changes.
- **Critical Rule 5: DO NOT LIE**: Say "I don't know" when unsure.
- **Critical Rule 6: NO TEMPORARY SOLUTIONS**: FORBIDDEN: workarounds, mocks, hardcoded data, in-memory storage, false default values. ALL logic must be enterprise-grade with real persistence in PostgreSQL.
- **Critical Rule 7: MINIMUM CHANGES**: Surgical focus on the problem.
- **Critical Rule 8: MANDATORY QUALITY**: TypeScript strict, zero any, Pino for logging.
- **Critical Rule 9: CONTINUOUS VALIDATION**: Test after every micro-step.
- **Critical Rule 10: DOCUMENTATION IN PT-BR**: ALL documentation in Portuguese.
- **Critical Rule 11: FOLLOW OFFICIAL DOCS**: Best practices 2025.
- **Critical Rule 12: PRODUCTION ON HETZNER**: Deploy via GitHub Actions.
- **Critical Rule 13: INTERNATIONALIZATION**: PT-BR primary, EN secondary.
- **Critical Rule 14: CHECK SECRETS**: Verify existing variables.
- **Critical Rule 15: MICROSERVICES**: Code in apps/, shared in packages/.
- **Critical Rule 16: BEST PRACTICES**: API Gateway, health checks, circuit breakers.
- **Documentation Language**: Brazilian Portuguese.
- **Code Comments Language**: Brazilian Portuguese.
- **Log Messages Language**: Brazilian Portuguese.
- **Variable Naming Convention**: English.
- **Technical Terms**: English (e.g., OAuth, JWT).
- The file `server/index-dev.ts` is ONLY for preview in Replit and MUST NOT go into production.

## System Architecture
Alice is structured as a collection of microservices, adhering to an API Gateway pattern with Traefik. The frontend is a React Single Page Application (SPA). A centralized schema (`packages/shared/src/schema.ts`) defines core data structures such as `users`, `tenants`, `messages`, `conversations`, `conversationStates`, `generatedImages`, `documentChunks`, and `mediaUploads`, with specific naming conventions (e.g., `conteudo` not `content`, `isFromUser` not `role`).

**Key Features:**
- **Real-time Chat**: WebSocket-based with streaming.
- **Deduplication**: Using SemHash for data integrity.
- **Multi-tenancy**: Isolation enforced via `tenant_id`.
- **Role-Based Access Control (RBAC)**: 6 permission levels (super_admin, admin, manager, operator, viewer, guest).
- **RAG Backend**: Utilizes embeddings and native pgvector with HNSW indices for efficient vector search (1536 dimensions for text, 768 for CLIP).
- **Image Generation**: FLUX.1 Schnell self-hosted on dedicated GPU (RTX 3090/4090).
- **Multimodal Embeddings**: CLIP ViT-L/14 self-hosted for 768-dimensional multimodal embeddings.
- **Authentication**: OAuth 2.0 and SAML 2.0.
- **Handover/Takeover System**: A `Conversation Orchestrator` enables seamless transition between AI and human agents based on sentiment, keywords, explicit requests, and SLA breaches.

**Technical Implementations & Design Choices:**
- **UI/UX**: Branding "Yes You Deserve" with specific logo and favicon assets.
- **Security**: bcrypt 12 rounds for passwords, HttpOnly/Secure/SameSite cookies, CSRF protection, rate limiting, and `tenant_id` isolation.
- **Logging**: Exclusively uses Pino for backend logging; `console.log` is forbidden. Frontend uses a custom logger with `sendBeacon` and `fetch fallback` for robust telemetry to `/api/observability/logs`.
- **Code Quality**: Strict TypeScript (`no any`), 100% test coverage target, and comprehensive CI/CD pipeline blocking deployments on any test, ESLint, TypeScript, or npm audit failures.
- **Infrastructure**: Production hosted on Hetzner Cloud (CX43, 8 vCPUs, 16 GB RAM, 160 GB SSD).
- **CI/CD**: GitHub Actions workflow (`.github/workflows/deploy-production.yml`) includes ESLint, TypeScript check, unit tests (334+ passing), npm audit, Docker builds, manual approval, and SSH-based deployment to Hetzner. Node.js 20 LTS is consistent across all environments.
- **Health Checks**: Mandatory `/api/servico/health` endpoint for all microservices.

## External Dependencies
- **Salad Cloud**:
    - **LLM**: Llama 4 Maverick (400B parameters, 17B active MoE) for text input/output, 1M token context.
    - **Embeddings**: `text-embedding-3-small` (1536 dimensions).
    - **Circuit Breaker**: 30s timeout.
- **Stripe (Portugal)**: For EUR payments via SEPA, with webhook integration.
- **Wise**: For international transfers in 50+ currencies, with `WiseSyncService` for automatic synchronization.
- **ERPNext**: Integrated CRM and ERP solution.
- **Twilio**: For WhatsApp and SMS messaging, including webhooks for message receipt and status, with HMAC signature validation.
- **Resend**: For transactional emails.