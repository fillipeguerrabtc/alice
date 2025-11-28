# Alice - Plataforma Enterprise de IA Autônoma

## Overview

Alice is a production-ready enterprise autonomous AI platform leveraging the **Llama 4 Maverick (400B parameters)** model hosted on Salad Cloud. Its core purpose is to provide a fully autonomous, private, cost-predictable, and highly customizable AI solution, eliminating dependencies on external APIs, ensuring data privacy, and avoiding unpredictable token-based costs. The platform focuses on verticalized AI applications, aggressive auto-learning, and multimodal capabilities.

## User Preferences

- **Read Before Acting**: Always inspect relevant files before implementing any changes.
- **Avoid Duplication**: Check existing code for similar functionalities before creating new ones.
- **Structured Workflow**: Follow a structured workflow: Diagnosis → Plan → Approval → Implementation.
- **Mandatory Approval**: Seek approval before making significant changes.
- **Honesty**: State "I don't know" when uncertain.
- **No Temporary Solutions**: Absolutely no workarounds, mocks, hardcoded data, in-memory storage, or false default values. All logic must be enterprise-grade with real PostgreSQL persistence.
- **Official Data**: Focus on the problem with surgical precision and adhere to the best practices from current official documentation.
- **Quality Mandatory**: Enforce TypeScript strict mode, zero `any` types, and use Pino for logging.
- **Continuous Validation**: Test after every small step.
- **Documentation in PT-BR**: All documentation must be in Brazilian Portuguese.
- **Official Docs Adherence**: Follow 2025 best practices from official documentation.
- **Hetzner Production Deployment**: Deployments are via GitHub Actions to Hetzner.
- **Internationalization**: PT-BR primary, EN secondary.
- **Verify Secrets**: Check for existing environment variables/secrets.
- **Microservices Architecture**: Code for microservices resides in `apps/`, shared code in `packages/`.
- **Best Practices**: Implement API Gateway, health checks, and circuit breakers.
- **Language Preferences**:
    - Documentation: Brazilian Portuguese
    - Code Comments: Brazilian Portuguese
    - Log Messages: Brazilian Portuguese
    - Variable Names: English
    - Technical Terms: English (e.g., OAuth, JWT)
- **Development vs. Production**: The `server/index-dev.ts` file is exclusively for Replit UI preview and **must not** be deployed to production. Production code resides in `apps/`.
- **Logging**: Use Pino for all logging. `console.log` is forbidden.
- **TypeScript Strictness**: Use TypeScript in strict mode. The `any` type is forbidden.
- **Health Checks**: Every service must have a health check endpoint at `/api/service/health`.

## System Architecture

**Core Principles:**
- **Autonomous AI**: Llama 4 Maverick (400B) self-hosted on Salad Cloud for full control and privacy.
- **Verticalized Learning**: Aggressive learning schedule with real-time RAG updates, daily auto-indexing, and frequent incremental/full fine-tuning using LoRA.
- **Real-time Communication**: WebSocket for chat with streaming tokens, backed by PostgreSQL NOTIFY for pub/sub.
- **Multimodal AI**: FLUX.1 Schnell for image generation and CLIP ViT-L/14 for multimodal embeddings, both self-hosted on Salad Cloud.
- **Microservices**: All core functionalities are encapsulated as microservices within the `apps/` directory, sharing common utilities from `packages/`.
- **Observability**: Dedicated, independent microservice for observability (Prometheus, Grafana, Jaeger, OpenTelemetry, Langfuse) to ensure monitoring resilience.
- **Enterprise Integrations**: Built-in integrations with Stripe, Wise, ERPNext, Twilio, and Resend with robust circuit breakers.
- **Robust Security**: OAuth 2.0, SAML 2.0, bcrypt for passwords, HttpOnly/Secure/SameSite cookies, CSRF protection, rate limiting, and multi-tenant isolation.
- **Role-Based Access Control (RBAC)**: 6 distinct levels of permissions for fine-grained access.
- **UI/UX**: React 18, TypeScript 5, Vite 5, shadcn/ui, Tailwind CSS, TanStack Query, Wouter, and react-i18next for i18n (PT-BR/EN).

**Key Architectural Decisions:**
- **RAG + Chat Integration**: Seamless integration of RAG backend with real-time chat.
- **Image Generation**: FLUX.1 Schnell model for state-of-the-art image generation, hosted on Salad Cloud. Progressive LoRA for continuous learning from approved images.
- **Takeover/Handover**: Custom panel within the Alice dashboard for human agent intervention, with automatic triggers based on confidence scores, fallbacks, and sentiment.
- **Observability Stack**: Dedicated `apps/observability-service/` using Prometheus (metrics), Grafana (dashboards), Jaeger (tracing), OpenTelemetry (instrumentation), and Langfuse (LLM metrics).
- **ERPNext Integration**: Full Dockerized ERPNext setup following official `frappe_docker` guidelines for CRM and ERP functionalities.

**Services & Ports:**
- `frontend`: 5000 (React SPA)
- `api-gateway`: 80/443 (Traefik)
- `auth`: 3001 (OAuth/SAML)
- `chat`: 3002 (LLM + WebSocket)
- `rag`: 3003 (Embeddings)
- `training`: 3004 (Fine-tuning)
- `integrations`: 3005 (Stripe, Wise, etc.)
- `observability`: 9090/3000/16686/3006 (Prometheus, Grafana, Jaeger, Langfuse)

## External Dependencies

- **Salad Cloud**:
    - **LLM**: Llama 4 Maverick (400B parameters) for main AI processing.
    - **Embeddings**: `text-embedding-3-small`.
    - **Image Generation**: FLUX.1 Schnell model (self-hosted container group).
    - **CLIP Inference**: CLIP ViT-L/14 for multimodal embeddings (self-hosted container group).
- **PostgreSQL**: Primary database for all persistent data, including `pgvector` for vector search.
- **Stripe Portugal**: Payment gateway for EUR transactions via SEPA.
- **Wise**: Global money transfers supporting 50+ currencies.
- **ERPNext**: CRM and ERP system, integrated via `frappe_docker`.
- **Twilio**: Messaging service for WhatsApp and SMS.
- **Resend**: Transactional email service.
- **Traefik**: API Gateway for routing and SSL termination.
- **GitHub Actions**: CI/CD pipeline for automated builds and deployments.
- **Hetzner Cloud**: Production infrastructure hosting.

## Acesso ao Servidor Hetzner (IMPORTANTE - NÃO ESQUECER)

- **IP do Servidor**: 46.224.46.93
- **Domínio**: yesyoudeserve.duckdns.org
- **Usuário SSH**: root
- **Chave SSH**: Localizada em `infra/scripts/setup-ssh-key.sh`
- **Para configurar a chave**: Execute `bash infra/scripts/setup-ssh-key.sh`
- **Para conectar**: `ssh root@46.224.46.93`