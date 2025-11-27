# Alice - Plataforma Enterprise de IA Autônoma

## Overview

Alice is a production-ready, autonomous enterprise AI platform powered by a self-hosted Llama 4 Maverick (400B parameters) model on Salad Cloud. Its primary purpose is to provide a fully autonomous AI solution that ensures absolute data privacy, predictable costs, and unlimited customization through fine-tuning for each client. Alice addresses common enterprise challenges by eliminating reliance on third-party APIs, safeguarding sensitive data, and preventing unpredictable token-based billing. The platform offers real-time chat, multi-tenant capabilities, robust Role-Based Access Control (RBAC), and multimodal RAG (Retrieval Augmented Generation) for advanced information retrieval. The business vision is to deliver a secure, scalable, and customizable AI infrastructure that empowers enterprises with full control over their AI operations and data.

## User Preferences

- **Workflow:**
  - **Structured Workflow:** Diagnosis → Plan → Approval → Implementation.
  - **Approval:** Request approval before making significant changes.
  - **Minimal Changes:** Focus surgically on the problem at hand.
  - **Continuous Validation:** Test after each micro-step.
  - **No Temporary Solutions:** **FORBIDDEN**: workarounds, mocks, hardcoded data, in-memory storage, false default values. ALL logic must be enterprise-grade with real PostgreSQL persistence.
- **Coding Style:**
  - **Quality:** TypeScript strict, zero `any`.
  - **Microservices:** Code resides in `apps/`, shared components in `packages/`.
  - **Best Practices:** Implement API Gateway, health checks, circuit breakers.
- **Communication and Documentation:**
  - **Documentation Language:** ALL documentation in Brazilian Portuguese.
  - **Code Comments:** Brazilian Portuguese.
  - **Log Messages:** Brazilian Portuguese.
  - **Variable Names:** English.
  - **Technical Terms:** English (e.g., OAuth, JWT).
  - **Official Documentation:** Follow 2025 best practices.
- **Development Environment:**
  - **Replit Usage:** Only for UI preview and local development.
  - **Production Deployment:** Via GitHub Actions to Hetzner.
  - **Development vs. Production Distinction:** `server/index-dev.ts` is for Replit preview ONLY and should NOT go to production.
- **General Working Preferences:**
  - **Read Before Acting:** Inspect files before implementing.
  - **No Duplication:** Check existing code first.
  - **Honesty:** State "I don't know" when unsure.
  - **Secret Management:** Verify existing environment variables/secrets.
  - **Logging:** Use Pino; `console.log` is **FORBIDDEN**.
  - **Health Checks:** Mandatory at `/api/service/health` endpoint.

## System Architecture

Alice employs a robust microservices architecture designed for scalability, security, and performance.

### UI/UX Decisions
- **Frontend Framework:** React 18 with TypeScript 5, Vite 5.
- **Styling:** shadcn/ui and Tailwind CSS for a modern, consistent look.
- **State Management & Routing:** TanStack Query for data fetching, Wouter for routing.
- **Internationalization:** `react-i18next` for PT-BR (primary) and EN (secondary).

### Technical Implementations
- **Core AI Model:** Llama 4 Maverick (400B parameters, 17B active MoE) hosted on Salad Cloud, ensuring autonomy and privacy.
- **Multimodal RAG:**
    - **Image Uploads:** CLIP embeddings (768 dim) via `SALAD_CLIP_ENDPOINT`.
    - **Audio Uploads:** Whisper transcription + text embeddings (1536 dim) via `SALAD_WHISPER_ENDPOINT`.
    - **Search:** Cosine similarity for image search, CLIP text embedding for text search.
    - **Storage:** Local and S3-compatible storage with multi-tenant isolation.
- **Real-time Communication:** WebSocket for chat with token streaming, backed by PostgreSQL NOTIFY for Pub/Sub.
- **Authentication:** OAuth 2.0 (Google, GitHub, Microsoft) and SAML 2.0 (Azure AD, Okta), with local bcrypt authentication.
- **Role-Based Access Control (RBAC):** 6 defined roles (super_admin, admin, manager, operator, viewer, guest) for granular permissions.
- **Deduplication:** SemHash for efficient data deduplication during training.
- **Image Generation:** FLUX.1 Schnell model (Apache 2.0) self-hosted on Salad Cloud, utilizing progressive LoRA for continuous learning.
- **Observability Stack:** A dedicated, independent microservice (`apps/observability-service/`) for monitoring, including Prometheus 3.0 (metrics), Grafana OSS 11.3 (dashboards), Jaeger 1.62 (distributed tracing), OpenTelemetry Collector (instrumentation), and Langfuse 2.x (LLM-specific metrics).
- **Takeover/Handover:** Custom panel integrated into the dashboard, with automated triggers based on confidence scores, fallbacks, and sentiment analysis.
- **Learning Schedule:** Real-time RAG updates, daily auto-indexing, incremental fine-tuning every 4 days, and full fine-tuning bi-weekly.

### System Design Choices
- **Microservices Architecture:** Services are compartmentalized (e.g., `auth`, `chat`, `rag`, `training`, `integrations`, `observability`).
- **API Gateway:** Traefik handles ingress, SSL, and routing.
- **Data Persistence:** PostgreSQL as the primary database, `pgvector` for vector embeddings.
- **Circuit Breakers:** Implemented across critical services (RAG, Wise, ERPNext) to enhance resilience.
- **Multi-tenancy:** Strict `tenant_id` isolation in all database queries and services.
- **Deployment:** Automated CI/CD pipeline using GitHub Actions for builds, Docker image pushes, and SSH deployment to Hetzner Cloud.
- **Security:** bcrypt for passwords, HttpOnly/Secure/SameSite cookies, CSRF protection via OAuth state parameter, IP/endpoint rate limiting.

## External Dependencies

Alice integrates with several external services and platforms, primarily through self-hosted solutions on Salad Cloud for maximum control and cost predictability.

- **Salad Cloud:**
    - **LLM Hosting:** Llama 4 Maverick (400B) for core AI inference.
    - **Embedding Generation:** `text-embedding-3-small` for text embeddings.
    - **Image Generation:** FLUX.1 Schnell for image synthesis.
    - **CLIP Inference:** Self-hosted CLIP ViT-L/14 model for multimodal embeddings (image & text).
    - **Whisper Inference:** Self-hosted Whisper for audio transcription.
- **Stripe Portugal:** For processing EUR payments via SEPA, with webhook integration.
- **Wise:** For international money transfers across 50+ currencies.
- **ERPNext:** Integrated CRM and ERP system.
- **Twilio:** For WhatsApp and SMS communication.
- **Resend:** For sending transactional emails.
- **Hetzner Cloud:** Production infrastructure hosting (CX43 instance).
- **GitHub Actions:** For CI/CD pipeline automation.
- **PostgreSQL:** Primary database, including `pgvector` extension.