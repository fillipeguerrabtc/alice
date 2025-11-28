# Alice - Plataforma Enterprise de IA Autônoma

## Overview

Alice is a production-ready, autonomous enterprise AI platform powered by the **Llama 4 Maverick (400B parameters)** model hosted on Salad Cloud. Its primary purpose is to provide a fully autonomous AI solution that addresses critical enterprise challenges:
- **Absolute Privacy**: All data remains within controlled infrastructure.
- **Predictable Costs**: No third-party token-based charges.
- **Unlimited Customization**: Fine-tuning capabilities for specific client needs.

Alice aims to solve the problems of reliance on external APIs (pricing changes, discontinuations), data privacy concerns with third-party servers, and unpredictable costs associated with token-based billing.

Key capabilities include real-time chat with streaming, deduplication, multi-tenancy, Role-Based Access Control (RBAC), RAG backend for embeddings and vector search, and integrations with payment (Stripe, Wise), CRM (ERPNext), and communication (Twilio, Resend) services. The platform also features advanced AI capabilities like image generation (FLUX.1 Schnell), aggressive self-learning, and a robust observability stack.

## User Preferences

- **Read Before Acting**: Always inspect files and existing code before implementing any changes.
- **No Duplication**: Verify existing code for functionality before writing new code.
- **Structured Workflow**: Follow a strict workflow: Diagnosis → Plan → Approval → Implementation.
- **Approval Required**: Always ask for approval before making significant changes.
- **Honesty**: State "I don't know" when unsure.
- **No Temporary Solutions**: Avoid workarounds, mocks, hardcoded data, in-memory storage, or false default values. All logic must be enterprise-grade with real PostgreSQL persistence.
- **Official Data**: Focus on the problem and current best practices from official documentation.
- **Quality Mandatory**: Use TypeScript strict mode, no `any`, and Pino for logging.
- **Continuous Validation**: Test after every micro-step.
- **Documentation in PT-BR**: All documentation must be in Brazilian Portuguese.
- **Follow Official Docs**: Adhere to 2025 best practices.
- **Production on Hetzner**: Deploy via GitHub Actions.
- **Internationalization**: PT-BR primary, EN secondary.
- **Verify Secrets**: Check for existing environment variables.
- **Microservices**: Code in `apps/`, shared utilities in `packages/`.
- **Best Practices**: Implement API Gateway, health checks, and circuit breakers.
- **Language Preferences**:
    - Documentation: Portuguese (Brazil)
    - Code Comments: Portuguese (Brazil)
    - Log Messages: Portuguese (Brazil)
    - Variable Names: English
    - Technical Terms: English (e.g., OAuth, JWT)
- **Development vs. Production**:
    - **Development (Replit)**: Used as an IDE and for UI preview. Preview data is allowed only in `server/index-dev.ts`.
    - **Production (Hetzner Cloud)**: The real enterprise system. Mocks/hardcoded values are strictly forbidden (Rule 6).
    - Code in `apps/` (microservices) goes to production via GitHub Actions. `server/index-dev.ts` is ONLY for Replit preview and is not deployed to production.
- **Logging**: Use Pino for all logging; `console.log` is forbidden.
- **TypeScript**: Use strict mode; `any` is forbidden.
- **Health Checks**: Mandatory at `/api/service/health` for all services.

## System Architecture

Alice is designed as a microservices architecture, with core services residing in `apps/` and shared packages in `packages/`. The system emphasizes a verticalized learning schedule for RAG updates, aggressive auto-indexing, and incremental fine-tuning. Real-time communication leverages PostgreSQL NOTIFY for simplicity and scalability, with Redis as a future fallback.

**UI/UX Decisions:**
- Frontend: React 18, TypeScript 5, Vite 5.
- Styling: shadcn/ui and Tailwind CSS.
- State Management/Routing: TanStack Query and Wouter.
- Internationalization: `react-i18next` for PT-BR/EN.

**Technical Implementations:**

-   **Model Hosting**: Llama 4 Maverick (400B params) and FLUX.1 Schnell for image generation, both self-hosted on Salad Cloud for autonomy and cost control.
-   **Observability**: A separate, independent microservice for monitoring, guaranteeing observability even if the main system fails. It integrates Prometheus 3.0, Grafana OSS 11.3, Jaeger 1.62, OpenTelemetry Collector, and Langfuse 2.x for LLM-specific metrics.
-   **Security**: Implements `bcrypt` for passwords, HttpOnly/Secure/SameSite cookies, CSRF protection via OAuth state parameter, IP and endpoint rate limiting, and `tenant_id` based isolation.
-   **RBAC**: Features a 6-level hierarchy (super_admin, admin, manager, operator, viewer, guest).
-   **RAG**: Uses Salad Cloud for embeddings, `pgvector` for vector search, with chunking (500 chars, 50 overlap) and a circuit breaker (30s/50%/30s).
-   **Image Generation**: Leverages FLUX.1 Schnell model (Apache 2.0), self-hosted on Salad Cloud using RTX 3090/4090 GPUs. Approved images contribute to training via Progressive LoRA. Object Storage combined with CLIP embeddings enables multimodal RAG.
-   **Multimodal Embeddings**: CLIP ViT-L/14 (MIT License) self-hosted on Salad Cloud, providing 768-dimension embeddings for cross-modal search.
-   **Takeover/Handover**: Custom panel integrated into the dashboard, with automated triggers based on confidence scores, fallbacks, and sentiment analysis.
-   **CI/CD**: Automated pipeline on GitHub Actions for builds, Docker image pushes, SSH deployment to Hetzner, and health checks.

**System Design Choices:**

-   **Microservices**:
    -   `frontend` (5000): React SPA.
    -   `api-gateway` (80/443): Traefik.
    -   `auth` (3001): OAuth/SAML, local auth, RBAC.
    -   `chat` (3002): LLM, WebSocket, streaming, persistence.
    -   `rag` (3003): Embeddings, vector search.
    -   `training` (3004): Data collection, deduplication, fine-tuning job management.
    -   `integrations` (3005): External service proxies.
    -   `observability` (9090/3000/16686/3006): Monitoring stack.
-   **Production Infrastructure**: Hosted on Hetzner Cloud (CX43 server: 8 vCPUs, 16GB RAM, 160GB SSD).
-   **ERPNext Deployment**: Utilizes the official `frappe_docker` setup, ensuring idempotency for site creation and robust database/cache management.

## External Dependencies

-   **Salad Cloud**:
    -   **LLM**: Llama 4 Maverick (400B parameters) for core AI capabilities (text input, text output).
    -   **Embeddings**: `text-embedding-3-small` for RAG.
    -   **Image Generation**: FLUX.1 Schnell (Apache 2.0) for visual content creation.
    -   **CLIP Inference**: CLIP ViT-L/14 (MIT) for multimodal embeddings (self-hosted container group).
-   **Stripe Portugal**: For EUR payments via SEPA, including webhook integration.
-   **Wise**: For global money transfers in 50+ currencies.
-   **ERPNext**: Integrated CRM and ERP system. Utilizes `frappe_docker` for deployment.
-   **Twilio**: For WhatsApp and SMS communication.
-   **Resend**: For transactional email services.
-   **PostgreSQL**: Primary database with `pgvector` extension for vector search.
-   **Prometheus 3.0**: For metrics collection and alerting.
-   **Grafana OSS 11.3**: For dashboards and visualization.
-   **Jaeger 1.62**: For distributed tracing.
-   **OpenTelemetry Collector**: For unified instrumentation.
-   **Langfuse 2.x**: For LLM-specific metrics.
-   **Traefik**: As an API Gateway for routing and SSL termination.
-   **GitHub Actions**: For CI/CD pipelines.