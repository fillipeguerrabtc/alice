# Alice - Plataforma Enterprise de IA Autônoma

### Overview
Alice is a production-ready, autonomous enterprise AI platform built around the Llama 4 Maverick (400B parameters) model, self-hosted on Salad Cloud. It offers total autonomy, absolute data privacy, predictable costs by avoiding third-party token charges, and unlimited customization through fine-tuning. The platform addresses common enterprise AI challenges like dependency on third-party APIs, data privacy concerns, and unpredictable costs associated with token-based pricing. Key capabilities include real-time chat, deduplication, multi-tenancy, RBAC, RAG backend, multimodal capabilities (image generation, CLIP embeddings), and integrations with payment, CRM, and communication services.

### User Preferences
- **Communication Style**: Direct and to the point.
- **Coding Practices**:
    - **No Duplication**: Check existing code first.
    - **No Temporary Solutions**: Prohibit workarounds, mocks, hardcoded data, in-memory storage, or false default values. All logic must be enterprise-grade with real PostgreSQL persistence.
    - **Minimal Changes**: Focus surgically on the problem.
    - **Quality Mandatory**: Use TypeScript strict, zero `any`, and Pino for logging.
    - **Continuous Validation**: Test after each micro-step.
    - **Official Docs**: Follow best practices from official documentation (2025 standards).
    - **Microservices**: Code in `apps/`, shared in `packages/`.
    - **Best Practices**: API Gateway, health checks, circuit breakers.
- **Workflow**:
    - **Read Before Action**: Inspect files before implementing.
    - **Structured Workflow**: Diagnosis → Plan → Approval → Implementation.
    - **Approval Mandatory**: Ask for approval before making significant changes.
- **Interaction**:
    - **Honesty**: Say "I don't know" when uncertain.
    - **Documentation Language**: All documentation, code comments, and log messages in Brazilian Portuguese.
    - **Variable Naming**: English for variable names and technical terms (e.g., OAuth, JWT).
    - **Internationalization**: PT-BR primary, EN secondary.
    - **Secrets Management**: Check existing variables.
- **Development Environment**:
    - The `server/index-dev.ts` file is ONLY for Replit preview and should NOT be deployed to production.
- **No Changes to Folder/Files**:
    - Do not deploy `server/index-dev.ts` to production.

### System Architecture

**Core Principles & Technologies:**
- **AI Model**: Llama 4 Maverick (400B parameters) on Salad Cloud.
- **Image Generation**: FLUX.1 Schnell (Apache 2.0) on Salad Cloud.
- **Multimodal Embeddings**: CLIP ViT-L/14 (MIT License) self-hosted on Salad Cloud.
- **Database**: PostgreSQL with `pgvector` for vector search.
- **Real-time Communication**: WebSocket for chat streaming.
- **Authentication**: OAuth 2.0 (Google, GitHub, Microsoft) and SAML 2.0 (Azure AD, Okta), local authentication with bcrypt, RBAC with 6 roles.
- **Observability**: Dedicated microservice (`apps/observability-service/`) with Prometheus 3.0, Grafana OSS 11.3, Jaeger 1.62, OpenTelemetry Collector, and Langfuse 2.x.
- **CI/CD**: GitHub Actions for automated build, push to GHCR, and deploy to Hetzner Cloud.
- **Logging**: Pino for all logging; `console.log` is prohibited.
- **TypeScript**: Strict mode, `any` type is prohibited.
- **Health Checks**: Mandatory at `/api/service/health` endpoints.

**UI/UX Decisions:**
- **Frontend**: React 18 + TypeScript 5 + Vite 5, `shadcn/ui` + Tailwind CSS, TanStack Query, Wouter, `react-i18next` for PT-BR/EN.

**Feature Specifications & Implementations:**
- **RAG System**: Embeddings via Salad Cloud, `pgvector` for vector search, chunking (500 chars, 50 overlap), circuit breaker (30s/50%/30s).
- **Learning Schedule**: Real-time RAG updates, daily auto-indexing, incremental fine-tuning (LoRA) every 4 days, full fine-tuning bi-weekly.
- **Pub/Sub**: PostgreSQL NOTIFY for real-time, with `conversation_states` table as fallback. Future migration to Redis if scale demands.
- **Takeover/Handover**: Custom panel integrated into the dashboard (no Twilio Flex), default SLA of 30 minutes, automatic triggers based on confidence scores, fallbacks, and negative sentiment.
- **Security**: bcrypt 12 rounds for passwords, HttpOnly/Secure/SameSite cookies, CSRF protection via OAuth state parameter, rate limiting per IP and endpoint, `tenant_id` isolation in queries.

**System Design Choices:**
- **Microservice Architecture**: Code organized into `apps/` for microservices, shared code in `packages/`.
- **API Gateway**: Traefik for routing and SSL.
- **Production Environment**: Hetzner Cloud (CX43, 8 vCPUs, 16 GB RAM, 160 GB SSD).
- **Development Environment**: Replit for IDE, local debugging, and Git operations.

### External Dependencies

- **Salad Cloud**:
    - **LLM**: Llama 4 Maverick (400B parameters, 17B active MoE) - Multimodal input, text output.
    - **Embeddings**: `text-embedding-3-small`.
    - **Image Generation**: FLUX.1 Schnell (Apache 2.0).
    - **CLIP Inference**: CLIP ViT-L/14 (MIT) for multimodal embeddings.
- **Stripe Portugal**: Payments in EUR via SEPA, webhooks.
- **Wise**: Global transfers (50+ currencies), 15s timeout.
- **ERPNext**: CRM and ERP integration (Frappe Docker deployment), 10s timeout.
- **Twilio**: WhatsApp and SMS messaging.
- **Resend**: Transactional emails.
- **PostgreSQL**: Primary database, used for persistence and `pgvector`.
- **Redis**: Cache and queue (used by ERPNext, potential future Pub/Sub).
- **Prometheus 3.0**: Metrics collection and alerting.
- **Grafana OSS 11.3**: Dashboards and visualization.
- **Jaeger 1.62**: Distributed tracing.
- **OpenTelemetry Collector**: Unified instrumentation.
- **Langfuse 2.x**: LLM-specific metrics.