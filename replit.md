# Alice - Plataforma Enterprise de IA Autônoma

## Overview

Alice is an autonomous, production-ready enterprise AI platform built around the **Llama 4 Maverick (400B parameters)** model hosted on Salad Cloud. It aims to solve critical problems in enterprise AI:
1.  **Eliminate Third-Party Dependency**: Provides full autonomy, removing reliance on external APIs that might change pricing or discontinue services.
2.  **Ensure Data Privacy**: Guarantees absolute data privacy by keeping all sensitive information within controlled infrastructure.
3.  **Offer Predictable Costs**: Delivers transparent and predictable costs by avoiding third-party token-based billing.
4.  **Enable Unlimited Customization**: Allows extensive fine-tuning specific to each client's needs.

The platform offers real-time chat with streaming, multi-tenant isolation, robust RBAC, RAG backend with HNSW vector search, and integrations with Stripe, Wise, ERPNext, Twilio, and Resend.

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
The frontend is a React SPA. Branding assets for "Yes You Deserve" are managed centrally and deployed to the frontend service.

### Technical Implementations
-   **AI Model**: Llama 4 Maverick (400B params, 17B active MoE) via Salad Cloud. Multimodal input (text, images, video), text output only. 1M token context.
-   **Embeddings**: `text-embedding-3-small` (1536 dimensions) for RAG and CLIP ViT-L/14 (768 dimensions) for multimodal inference.
-   **Image Generation**: FLUX.1 Schnell, self-hosted on RTX 3090/4090 GPUs.
-   **Real-time Chat**: WebSocket with streaming capabilities.
-   **Deduplication**: SemHash for duplicate data detection.
-   **Multi-tenancy**: Isolation enforced via `tenant_id` in queries.
-   **Authentication**: OAuth 2.0 and SAML 2.0.
-   **RBAC**: 6 levels of permission (super\_admin, admin, manager, operator, viewer, guest).
-   **Vector Search**: Native `pgvector` with HNSW indices (`m=16`, `ef_construction=64`) for `media_uploads` (CLIP embeddings) and `document_chunks` (text embeddings).
-   **Handover/Takeover System**: `conversation-orchestrator` enables seamless transition between AI and human agents, with automatic escalation triggers (negative sentiment, frustration keywords, repeated questions, explicit request, SLA breach).
-   **Logging**: Pino logger; `console.log` is forbidden.
-   **TypeScript**: Strict mode, `any` type forbidden.
-   **Health Checks**: Mandatory `/api/service/health` endpoints for all microservices.

### System Design Choices
-   **Microservices Architecture**: Code organized into microservices in the `apps/` directory, sharing common packages in `packages/`.
-   **API Gateway**: Traefik handles routing and SSL.
-   **CI/CD**: GitHub Actions for automated testing, migration (`db:push`), and deployment to Hetzner Cloud.
-   **Security**: bcrypt (12 rounds) for passwords, HttpOnly/Secure/SameSite cookies, CSRF protection (OAuth state parameter), rate limiting by IP and endpoint.
-   **Observability**: Integrated Prometheus, Grafana, Jaeger, and Langfuse.

### Services Overview
-   **frontend**: React SPA (port 5000)
-   **api-gateway**: Traefik (ports 80/443)
-   **auth**: OAuth/SAML (port 3001)
-   **chat**: LLM + WebSocket (port 3002)
-   **rag**: Embeddings (port 3003)
-   **training**: Fine-tuning (port 3004)
-   **integrations**: Stripe, Wise, etc. (port 3005)
-   **observability**: Monitoring and tracing (ports 9090/3000/16686/3007)

## External Dependencies

-   **Salad Cloud**:
    -   **LLM**: Llama 4 Maverick (400B params), multimodal input, text output. Circuit breaker: 30s timeout.
    -   **Embeddings**: text-embedding-3-small.
-   **Self-hosted Models (via Salad Container Groups)**:
    -   **Image Generation**: FLUX.1 Schnell.
    -   **CLIP Inference**: CLIP ViT-L/14 (multimodal embeddings).
-   **Stripe Portugal**: Payments in EUR via SEPA, webhook integration for checkout and payments.
-   **Wise**: International transfers, supporting 50+ currencies.
-   **ERPNext**: Integrated CRM and ERP system.
-   **Twilio**: WhatsApp and SMS communication, with webhook support.
-   **Resend**: Transactional email service.
-   **PostgreSQL**: Primary database with `pgvector` extension for vector similarity search.
-   **GitHub Actions**: CI/CD pipeline for deployment and automation.
-   **Hetzner Cloud**: Production infrastructure hosting.

## Testing

### Vitest Configuration

| Command | Description |
|---------|-------------|
| `npm test` | Run all tests |
| `npm run test:watch` | Watch mode for development |
| `npm run test:coverage` | Coverage report |
| `npm run test:ui` | Visual interface |

### Test Structure

| Folder | Description | Tests |
|--------|-------------|-------|
| `tests/unit/` | Unit tests | 111 tests |
| `tests/setup.ts` | Global configuration | Pino logger |
| `tests/utils/test-helpers.ts` | Helper functions | UUID, mocks |

### Test Files

| File | Description | Tests |
|------|-------------|-------|
| `setup-verification.test.ts` | Vitest setup validation | 8 |
| `health-endpoints.test.ts` | Health endpoint contracts | 45 |
| `schema-validation.test.ts` | Drizzle schema validation | 58 |

### Health Endpoint Contract Tests

Validates schemas for all 6 microservices:

| Service | Port | Endpoint | Tests |
|---------|------|----------|-------|
| auth-service | 3001 | `/api/auth/health` | 5 |
| chat-service | 3002 | `/api/chat/health` | 6 |
| rag-service | 3003 | `/api/rag/health` | 6 |
| training-service | 3004 | `/api/training/health` | 5 |
| integrations-service | 3005 | `/api/integrations/health` | 5 |
| observability-service | 3007 | `/api/observability/health` | 5 |

### Validated Schemas

| Service | Specific Fields |
|---------|-----------------|
| auth | providers (OAuth), metrics |
| chat | llmProvider, model, circuitBreakers (llm, rag) |
| rag | embeddingsProvider, model, circuitBreaker |
| training | saladCloudAvailable, circuitBreakers (embeddings, saladContainerGroups) |
| integrations | integrations (stripe, erpnext, wise), circuitBreakers |
| observability | services (Prometheus, Grafana, Jaeger, Langfuse), uptimeSeconds |

### Schema Validation Tests

Validates Drizzle ORM schema structure:

| Category | Tests | Description |
|----------|-------|-------------|
| Enums RBAC | 12 | userRoleEnum (6 níveis), messageTypeEnum, status enums |
| Tabelas Principais | 22 | tenants, users, agents, conversations, messages, documents |
| Insert Schemas | 18 | Zod validation for all main tables |
| Integridade | 6 | Multi-tenancy, timestamps, pgvector, SemHash |

## Recent Changes (November 2025)

### Schema Validation Tests (Phase 1 Step 1.3)

Implemented 58 tests for validating Drizzle schema:
- `tests/unit/schema-validation.test.ts` - Schema structure validation
- Enums: userRoleEnum, messageTypeEnum, conversationControlModeEnum
- Tables: tenants, users, agents, conversations, messages, documents
- Insert Schemas: Zod validation with required fields
- Total: 111 tests passing (8 setup + 45 health + 58 schema)

### Health Endpoint Tests (Phase 1 Step 1.2)

Implemented 45 contract tests for validating microservice schemas:
- `tests/unit/health-endpoints.test.ts` - Zod schema validation
- Schemas for auth, chat, rag, training, integrations, observability
- Circuit breaker states (open, closed, half-open)
- Port and endpoint configuration (Rule 16)