# Alice - Plataforma Enterprise de IA Autônoma

## Overview

Alice is a production-ready enterprise autonomous AI platform leveraging the Llama 4 Maverick (400B parameter) model hosted on Salad Cloud. It aims to solve common enterprise challenges such as dependency on third-party APIs, data privacy concerns, and unpredictable costs associated with token-based pricing.

**Key Capabilities:**
- **Total Autonomy:** Operates without external API dependencies.
- **Absolute Privacy:** Ensures sensitive data remains within controlled infrastructure.
- **Predictable Costs:** Eliminates third-party token charges.
- **Unlimited Customization:** Supports client-specific fine-tuning.
- **Real-time Chat:** WebSocket-based streaming chat.
- **Multi-tenant Architecture:** Data isolation per tenant.
- **Role-Based Access Control (RBAC):** Six permission levels.
- **Retrieval Augmented Generation (RAG):** Embeddings and vector search.
- **Payment Processing:** Integrations with Stripe and Wise.
- **CRM Integration:** ERPNext integration.
- **Omnichannel Communication:** Twilio for WhatsApp and SMS, Resend for email.
- **Advanced Authentication:** OAuth 2.0 and SAML 2.0.
- **AI-Human Handover:** Seamless transition between AI and human agents.
- **Image Generation:** Self-hosted FLUX.1 Schnell model.

## User Preferences

### Critical Rules

| Number | Rule | Description |
|--------|------|-------------|
| 1 | LER ANTES DE AGIR | Inspecionar arquivos antes de implementar |
| 2 | NÃO DUPLICAR | Verificar código existente primeiro |
| 3 | WORKFLOW ESTRUTURADO | Diagnóstico → Plano → Aprovação → Implementação |
| 4 | APROVAÇÃO OBRIGATÓRIA | Pedir aprovação antes de mudanças grandes |
| 5 | NÃO MENTIR | Dizer "não sei" quando não souber |
| 6 | SEM SOLUÇÕES TEMPORÁRIAS | PROIBIDO: workarounds, mocks, dados hardcoded, in-memory storage, valores default falsos. TODA lógica deve ser enterprise-grade com persistência real em PostgreSQL |
| 7 | MUDANÇAS MÍNIMAS | Foco cirúrgico no problema |
| 8 | QUALIDADE OBRIGATÓRIA | TypeScript strict, zero any, Pino |
| 9 | VALIDAÇÃO CONTÍNUA | Testar após cada micro-passo |
| 10 | DOCUMENTAÇÃO PT-BR | TODA documentação em português |
| 11 | SEGUIR DOCS OFICIAIS | Melhores práticas 2025 |
| 12 | PRODUÇÃO HETZNER | Deploy via GitHub Actions |
| 13 | INTERNACIONALIZAÇÃO | PT-BR primário, EN secundário |
| 14 | VERIFICAR SECRETS | Checar variáveis existentes |
| 15 | MICROSSERVIÇOS | Código em apps/, compartilhado em packages/ |
| 16 | MELHORES PRÁTICAS | API Gateway, health checks, circuit breakers |

### Language Preferences

| Context | Language |
|---------|----------|
| Documentation | Português Brasileiro |
| Code comments | Português Brasileiro |
| Log messages | Português Brasileiro |
| Variable names | English |
| Technical terms | English (OAuth, JWT, etc.) |

## System Architecture

The platform follows a microservices architecture, with core services deployed on Hetzner Cloud and a React SPA frontend. Development is primarily done on Replit, distinguishing between DEV (Replit preview) and PRODUCTION (Hetzner).

**Core Services:**
-   **frontend:** React Single Page Application (SPA).
-   **api-gateway:** Traefik for routing and SSL.
-   **auth:** Handles OAuth/SAML authentication.
-   **chat:** Manages LLM interactions and WebSocket streaming.
-   **rag:** Manages embeddings and vector search for RAG.
-   **training:** Dedicated for model fine-tuning.
-   **integrations:** Manages third-party integrations (Stripe, Wise, Twilio, Resend).
-   **observability:** For monitoring with Prometheus, Grafana, Jaeger, Langfuse.

**Technology Stack:**
-   **Backend:** Node.js (v20 LTS), TypeScript (strict mode, no `any`), Pino for logging.
-   **Database:** PostgreSQL with `pgvector` for native HNSW vector search.
-   **Containerization:** Docker.
-   **CI/CD:** GitHub Actions for automated deployment to Hetzner.
-   **Frontend:** React.

**Key Design Patterns & Implementations:**
-   **Multi-tenancy:** Enforced via `tenant_id` in database queries and a dedicated `tenants` table.
-   **RBAC:** Six predefined roles with granular access control.
-   **Data Deduplication:** Using SemHash.
-   **Handover/Takeover System:** A `Conversation Orchestrator` (in `apps/chat-service`) facilitates smooth transitions between AI and human agents based on triggers like negative sentiment, frustration keywords, or SLA breaches.
-   **Schema Management:** Centralized schema definition in `packages/shared/src/schema.ts` using Drizzle ORM.
    -   `users` table: includes `authProvider` (not `authProviderId`).
    -   `messages` table: `conteudo` (not `content`), `isFromUser` (not `role`).
    -   `generatedImages` table: Stores FLUX.1 images with ratings.
    -   `documentChunks` table: Stores RAG chunks (1536 dimensions).
    -   `mediaUploads` table: Stores media with CLIP embeddings (768 dimensions).
-   **Vector Search:** Native `pgvector` with HNSW indices (`m=16`, `ef_construction=64`) for `media_uploads` (CLIP embeddings) and `document_chunks` (text embeddings).
-   **Security:** `bcrypt` for passwords, HttpOnly/Secure/SameSite cookies, CSRF protection via OAuth state parameter, rate limiting, and tenant isolation.
-   **Branding:** Centralized asset management under `assets/branding/` with consistent use of `logo-round.png` and `favicon.png` across the UI.
-   **Health Checks:** Mandatory `/api/service/health` endpoints for all microservices.

## External Dependencies

-   **Salad Cloud:**
    -   **LLM:** Llama 4 Maverick (400B parameters, 17B active MoE) - Multimodal input, text output. 1M token context.
    -   **Embeddings:** `text-embedding-3-small` (1536 dimensions).
    -   **Circuit Breaker:** 30s timeout for LLM calls.
-   **FLUX.1 Schnell:** Self-hosted image generation model (Apache 2.0 license) on dedicated GPU (RTX 3090/4090).
-   **CLIP ViT-L/14:** Self-hosted multimodal embedding inference service (MIT license), 768 dimensions.
-   **Stripe Portugal:** For EUR payments via SEPA, including webhook integration.
-   **Wise:** For international transfers across 50+ currencies, with automatic synchronization.
-   **ERPNext:** Integrated CRM and ERP system.
-   **Twilio:** For WhatsApp and SMS communication, including webhook for message reception and status, and HMAC signature validation.
-   **Resend:** For transactional email services.
-   **PostgreSQL:** Primary database with `pgvector` extension.