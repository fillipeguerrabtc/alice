# Alice - Plataforma Enterprise de IA Autônoma

## Overview

Alice is a production-ready, autonomous enterprise AI platform built around the Llama 4 Maverick (400B parameters) model hosted on Salad Cloud. It aims to provide total autonomy, absolute data privacy, predictable costs, and unlimited customization through fine-tuning. The platform addresses common issues with third-party AI APIs, such as unpredictable costs, data privacy concerns, and vendor lock-in. Alice offers a comprehensive suite of AI-powered features, including real-time chat, advanced RAG capabilities, image generation, multi-tenant support, robust role-based access control (RBAC), and seamless integration with critical business systems for payments, CRM, and communication. The project's ambition is to deliver a cutting-edge, self-contained AI solution that can be deeply integrated and customized for enterprise clients, ensuring high performance, scalability, and security.

## User Preferences

- **Workflow:** Diagnose the problem, create a plan, get approval, then implement. Approval is mandatory for major changes.
- **Problem Solving:** Focus surgically on the problem with minimal changes. Avoid temporary solutions, workarounds, mocks, hardcoded data, in-memory storage, or false default values. All logic must be enterprise-grade with real PostgreSQL persistence.
- **Code Quality:** Adhere to TypeScript strict mode, zero `any` types, and use Pino for logging. Console.log is forbidden.
- **Testing:** Validate continuously by testing after each micro-step.
- **Documentation & Language:** All documentation, code comments, and log messages must be in Brazilian Portuguese. Variable names and technical terms should be in English (e.g., OAuth, JWT).
- **Best Practices:** Follow official documentation and best practices for 2025. Implement API Gateway, health checks, and circuit breakers.
- **Microservices:** Organize code into `apps/` for microservices, with shared code in `packages/`.
- **Secrets:** Always check for existing environment variables/secrets before creating new ones.
- **File Inspection:** Inspect relevant files before implementing any changes.
- **No Duplication:** Check existing code to avoid duplicating functionality.
- **Honesty:** State "I don't know" when uncertain.
- **Production Environment:** Deployment is to Hetzner Cloud via GitHub Actions.
- **Internationalization:** PT-BR is primary, EN is secondary.
- **Replit Environment:** The `server/index-dev.ts` file is exclusively for Replit UI preview and must not be deployed to production. Data mocks are only allowed in `server/index-dev.ts` for development.

## System Architecture

The Alice platform is built as a collection of microservices, each handling specific functionalities, orchestrated behind an API Gateway (Traefik). The core AI capabilities leverage a self-hosted Llama 4 Maverick model for text processing and FLUX.1 Schnell for image generation, both running on Salad Cloud to ensure autonomy and cost predictability.

### UI/UX Decisions
- **Frontend:** Built with React 18, TypeScript 5, Vite 5, shadcn/ui, and Tailwind CSS for a modern, responsive user interface.
- **Internationalization:** Uses `react-i18next` for PT-BR (primary) and EN (secondary) language support.

### Technical Implementations
- **Core LLM:** Llama 4 Maverick (400B parameters, 17B active MoE) hosted on Salad Cloud. Supports multimodal input (text, images, video) but outputs text only. Features a 1M token context window.
- **Image Generation:** Utilizes FLUX.1 Schnell (Apache 2.0) self-hosted on Salad Cloud, trained with Progressive LoRA from approved images.
- **Multimodal Embeddings:** CLIP ViT-L/14 (MIT license) self-hosted on Salad Cloud for cross-modal search (text to image, image to image) with 768-dimension embeddings.
- **Real-time Chat:** Implemented with WebSockets for streaming tokens and persistent message storage.
- **RAG (Retrieval Augmented Generation):** Employs pgvector for vector search, with embeddings generated via Salad Cloud. Chunking is configured at 500 characters with 50-character overlap. Features aggressive auto-indexing and incremental/full fine-tuning for continuous learning.
- **Authentication:** Supports OAuth 2.0 (Google, GitHub, Microsoft) and SAML 2.0 (Azure AD, Okta), along with local authentication using bcrypt. Implements a 6-level RBAC system.
- **Observability:** A separate, independent microservice for robust monitoring, including Prometheus (metrics), Grafana (dashboards), Jaeger (tracing), OpenTelemetry Collector (instrumentation), and Langfuse (LLM-specific metrics).
- **Pub/Sub:** Initially uses PostgreSQL NOTIFY for real-time updates, with a fallback to a `conversation_states` table for persistence. Designed for future migration to Redis if scale demands.
- **Security:** Incorporates bcrypt for passwords, HttpOnly/Secure/SameSite cookies, OAuth state parameter for CSRF protection, rate limiting, and `tenant_id` isolation in queries.
- **CI/CD:** Automated pipeline with GitHub Actions for Docker image builds, pushes to GHCR, SSH deployment to Hetzner, and health checks.

### Feature Specifications
- **Deduplication:** Uses SemHash for identifying and removing duplicate data.
- **Multi-tenancy:** Enforced via `tenant_id` for data isolation.
- **Takeover/Handover:** Custom panel integrated into the dashboard for human agent intervention, triggered by confidence scores, fallbacks, or negative sentiment.
- **Agentic RAG:** Hybrid search combining internal knowledge base with Brave Search, guided by an intelligent classifier.
- **Dashboard:** AI-powered dashboard displaying conversation metrics, image generation statistics, SLA, and circuit breaker statuses.
- **Image Gallery:** System for rating and approving images for training, with multi-tenant support.

### System Design Choices
- **Microservice Architecture:** Services are modular and loosely coupled, residing in the `apps/` directory, with shared libraries in `packages/`.
- **Production Infrastructure:** Deployed on Hetzner Cloud (CX43 instance) for cost-effective, performant hosting.
- **Logging:** All logging is handled by Pino; `console.log` is prohibited.
- **Health Checks:** Mandatory `/api/service/health` endpoints for all services.
- **Scheduled Learning:**
    - RAG updates: Real-time
    - Auto-indexing: Daily
    - Incremental fine-tuning (LoRA): Every 4 days
    - Full fine-tuning: Bi-weekly

## External Dependencies

- **Salad Cloud:**
    - **Llama 4 Maverick (400B):** Primary LLM for text generation and understanding.
    - **FLUX.1 Schnell:** Model for image generation.
    - **CLIP ViT-L/14:** For multimodal (text/image) embeddings and cross-modal search.
    - **text-embedding-3-small:** For RAG embeddings.
- **PostgreSQL:** Primary database for persistent storage, including `pgvector` for vector embeddings and `NOTIFY` for real-time pub/sub.
- **Stripe Portugal:** For processing EUR payments and handling webhooks.
- **Wise:** For global money transfers in 50+ currencies.
- **ERPNext:** Integrated CRM and ERP system (deployed via official `frappe_docker`).
- **Twilio:** For WhatsApp and SMS communication.
- **Resend:** For transactional email delivery.
- **GitHub Actions:** For CI/CD pipeline automation.
- **Traefik:** Used as the API Gateway for routing and SSL termination.
- **Prometheus 3.0:** For metrics collection.
- **Grafana OSS 11.3:** For data visualization and dashboards.
- **Jaeger 1.62:** For distributed tracing.
- **OpenTelemetry Collector:** For unified instrumentation.
- **Langfuse 2.x:** For LLM-specific metrics.