# Alice - Plataforma Enterprise de IA Autônoma

### Overview

Alice is an autonomous enterprise AI platform, production-ready, utilizing the Llama 4 Maverick (400B parameters) model hosted on Salad Cloud. This architecture ensures total autonomy, absolute data privacy, predictable costs by avoiding third-party token charges, and unlimited customization through client-specific fine-tuning. The platform aims to solve issues related to third-party dependencies, data privacy concerns with external servers, and unpredictable costs from token-based billing. Alice offers real-time chat, deduplication, multi-tenancy, RBAC, RAG backend, and integrations with payment and communication services. Future plans include advanced multimodal capabilities, web crawling, and sophisticated analytics.

### User Preferences

- **Workflow:** Prioritize a structured workflow: Diagnosis → Plan → Approval → Implementation.
- **Approval:** Request approval before making significant changes.
- **Integrity:** Be honest and admit "I don't know" when unsure.
- **Quality:** Adhere to enterprise-grade logic with real PostgreSQL persistence; temporary solutions like workarounds, mocks, hardcoded data, in-memory storage, or false default values are strictly forbidden.
- **Focus:** Make minimal changes, focusing surgically on the problem.
- **Code Quality:** Ensure high quality with TypeScript strict mode, zero `any` types, and Pino for logging.
- **Testing:** Implement continuous validation by testing after each micro-step.
- **Documentation:** All documentation, code comments, and log messages must be in Brazilian Portuguese.
- **Best Practices:** Follow official documentation and best practices from 2025.
- **Production Deployment:** Deploy to Hetzner via GitHub Actions.
- **Internationalization:** Prioritize PT-BR, with EN as a secondary language.
- **Secrets Management:** Verify existing secret variables before adding new ones.
- **Microservices:** Organize code into `apps/` for microservices and `packages/` for shared components.
- **Architectural Patterns:** Implement best practices such as API Gateway, health checks, and circuit breakers.
- **Naming Conventions:** Use English for variable names and technical terms (e.g., OAuth, JWT).
- **Environment Distinction:** Code in `apps/` is for production, while `server/index-dev.ts` is exclusively for Replit UI preview and must not go to production.
- **Pino Logging:** Use Pino for all logging; `console.log` is prohibited.
- **TypeScript Strictness:** Always use TypeScript in strict mode; the `any` type is prohibited.
- **Health Checks:** Implement health checks for all services at `/api/service/health`.

### System Architecture

**Core Architecture Decisions:**

- **Learning Schedule:** RAG updates in real-time, daily auto-indexing, incremental fine-tuning every 4 days (LoRA), and full fine-tuning bi-weekly.
- **Pub/Sub:** Uses PostgreSQL NOTIFY for real-time updates with `conversation_states` table as a fallback for persistence; future migration to Redis if scale demands (1k msg/s).
- **Image Generation:** Utilizes FLUX.1 Schnell (Apache 2.0) self-hosted on Salad Cloud, with progressive LoRA for training on approved images, and object storage with CLIP embeddings for RAG.
- **Takeover/Handover:** Custom panel integrated into the Alice dashboard, with a default SLA of 30 minutes and automatic triggers based on low confidence (<70%), multiple fallbacks, or negative sentiment.
- **Observability:** A separate, independent microservice (`apps/observability-service/`) ensures monitoring even if the main system fails. It includes Prometheus 3.0 for metrics, Grafana OSS 11.3 for dashboards, Jaeger 1.62 for distributed tracing, OpenTelemetry Collector for instrumentation, and Langfuse 2.x for LLM-specific metrics.

**Main Services:**

-   **Frontend (Porta 5000):** React 18, TypeScript 5, Vite 5, shadcn/ui, Tailwind CSS, TanStack Query, Wouter, react-i18next.
-   **Autenticação (Porta 3001):** OAuth 2.0 (Google, GitHub, Microsoft), SAML 2.0 (Azure AD, Okta), local authentication with bcrypt, RBAC with 6 roles (super_admin, admin, manager, operator, viewer, guest).
-   **Chat (Porta 3002):** WebSocket for real-time communication, proxy to Salad Cloud, token streaming, message persistence.
-   **RAG (Porta 3003):** Embeddings via Salad Cloud, pgvector for vector search, chunking (500 chars, 50 overlap), circuit breaker (30s/50%/30s).
-   **Training (Porta 3004):** Training data collection, SemHash for deduplication, fine-tuning job management.
-   **Integrações (Porta 3005):** Manages Stripe, Wise, ERPNext, Twilio, Resend.
-   **Observability:** Prometheus, Grafana, Jaeger, OTel Collector, Langfuse (ports 9090, 3000, 16686, 3006).

**Security:**

-   **Passwords:** bcrypt with 12 rounds.
-   **Cookies:** HttpOnly, Secure, SameSite flags.
-   **CSRF:** State parameter in OAuth.
-   **Rate Limiting:** Implemented per IP and endpoint.
-   **Isolation:** `tenant_id` used in all queries for multi-tenancy.

**Infrastructure:**

-   **Development:** Replit IDE for coding, debugging, local testing, and Git operations.
-   **Production:** Hetzner Cloud (CX43: 8 vCPUs, 16 GB RAM, 160 GB SSD).
-   **CI/CD:** GitHub Actions pipeline for building Docker images, pushing to GHCR, SSH deployment to Hetzner, and health checks on push to main.

### External Dependencies

-   **Salad Cloud:**
    -   **LLM Principal:** Llama 4 Maverick (400B parameters, 17B active MoE) - Multimodal input, text output, 1M context, text-embedding-3-small embeddings. Circuit breaker with 30s timeout.
    -   **Geração de Imagens:** FLUX.1 Schnell (Apache 2.0), self-hosted on GPU (RTX 3090/4090).
    -   **Inferência CLIP:** CLIP ViT-L/14 (MIT license), self-hosted on GPU (RTX 3060+).
-   **Stripe Portugal:** For EUR payments via SEPA, with webhook support.
-   **Wise:** For international transfers (50+ currencies supported), with a 15s circuit breaker.
-   **ERPNext:** CRM and ERP system, integrated via `frappe_docker` (MariaDB, Redis, Gunicorn/Python, Nginx, Socket.io), with a 10s circuit breaker.
-   **Twilio:** For WhatsApp and SMS communication.
-   **Resend:** For transactional email services.