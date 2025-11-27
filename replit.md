# Alice - Plataforma Enterprise de IA Autônoma

## Overview

Alice is a production-ready, autonomous enterprise AI platform built around the Llama 4 Maverick (400B parameters) model, self-hosted on Salad Cloud. Its core purpose is to provide a highly customizable, private, and cost-predictable AI solution, eliminating dependencies on external APIs and their associated risks like fluctuating costs and data privacy concerns.

Key capabilities include:
- **Total Autonomy**: No reliance on external APIs.
- **Absolute Privacy**: All data remains within controlled infrastructure.
- **Predictable Costs**: Avoids third-party token-based pricing.
- **Unlimited Customization**: Tailored fine-tuning for each client.
- **Real-time Interaction**: Chat with streaming capabilities and advanced RAG.
- **Multimodal AI**: Handles text, images, and video input, with state-of-the-art image generation.
- **Enterprise Features**: Multi-tenancy, Role-Based Access Control (RBAC), robust security, and comprehensive observability.

The project aims to solve problems associated with third-party AI dependencies, data privacy, and unpredictable costs, offering a robust, in-house AI solution for enterprises.

## User Preferences

- **Read Before Acting**: Always inspect relevant files before implementing any changes.
- **Avoid Duplication**: Check for existing code before creating new implementations.
- **Structured Workflow**: Follow a strict workflow: Diagnosis → Plan → Approval → Implementation.
- **Mandatory Approval**: Seek approval before making significant changes.
- **Honesty**: State "I don't know" when unsure.
- **No Temporary Solutions**: Prohibit workarounds, mocks, hardcoded data, in-memory storage, or false default values. All logic must be enterprise-grade with real PostgreSQL persistence.
- **Minimal Changes**: Focus surgically on the problem at hand.
- **Quality Mandate**: Adhere to TypeScript strict mode, disallow `any`, and use Pino for logging.
- **Continuous Validation**: Test after every micro-step.
- **Documentation in PT-BR**: All documentation must be in Brazilian Portuguese.
- **Official Documentation**: Follow official documentation and best practices (2025 standards).
- **Production Deployment**: Deploy to Hetzner via GitHub Actions.
- **Internationalization**: PT-BR primary, EN secondary.
- **Secret Verification**: Always check existing environment variables for secrets.
- **Microservices Architecture**: Code organized into `apps/` for microservices, shared logic in `packages/`.
- **Best Practices**: Implement API Gateway, health checks, and circuit breakers.
- **Language Preferences**:
    - Documentation, code comments, and log messages in Brazilian Portuguese.
    - Variable names and technical terms (e.g., OAuth, JWT) in English.
- **Development vs. Production Distinction**:
    - Replit environment is for IDE and UI preview; `server/index-dev.ts` allows preview data and *does not* go to production.
    - Hetzner Cloud is for the real enterprise system; mocks/hardcoded values are strictly forbidden (Rule 6).
- **Logging**: Use Pino for all logging. `console.log` is forbidden.
- **TypeScript**: Use strict mode; `any` is forbidden.
- **Health Checks**: Mandatory `/api/service/health` endpoint for all services.

## System Architecture

### Core Architectural Decisions

- **Microservices**: Application is divided into independent services located in `apps/`, with shared components in `packages/`.
- **Verticalized Learning Schedule**:
    - RAG update: Real-time.
    - Auto-indexing: Daily.
    - Incremental Fine-tuning (LoRA): Every 4 days.
    - Complete Fine-tuning: Bi-weekly.
- **Real-time Pub/Sub**: Utilizes PostgreSQL NOTIFY for real-time communication, with `conversation_states` table as a persistent fallback. Future migration to Redis considered for high-scale needs (>1k msg/s).
- **Image Generation**: Employs FLUX.1 Schnell (Apache 2.0) self-hosted on Salad Cloud for predictable costs, with progressive LoRA for continuous learning from approved images. Object storage + CLIP embeddings for RAG multimodal.
- **Takeover/Handover**: Custom in-platform panel for human agents, avoiding third-party solutions like Twilio Flex. Automatic triggers based on confidence scores, fallbacks, and sentiment.
- **Observability**: Dedicated, independent microservice (`apps/observability-service/`) for monitoring.
    - **Stack**: Prometheus 3.0 (metrics), Grafana OSS 11.3 (dashboards), Jaeger 1.62 (distributed tracing), OpenTelemetry Collector (instrumentation), Langfuse 2.x (LLM metrics), Custom Health Checker API.
    - **LLM-specific Metrics**: Token Usage, TTFT, Request Latency, Error Rate, Cost per Request, RAG Retrieval Time.

### Services and Technology Stack

- **Frontend (Porta 5000)**:
    - React 18, TypeScript 5, Vite 5
    - UI: shadcn/ui, Tailwind CSS
    - State Management: TanStack Query
    - Routing: Wouter
    - Internationalization: react-i18next (PT-BR/EN)
- **API Gateway (Porta 80/443)**: Traefik with SSL.
- **Authentication (Porta 3001)**:
    - OAuth 2.0 (Google, GitHub, Microsoft)
    - SAML 2.0 (Azure AD, Okta)
    - Local authentication with bcrypt
    - RBAC with 6 defined roles (super_admin, admin, manager, operator, viewer, guest).
- **Chat (Porta 3002)**:
    - WebSocket for real-time communication
    - Proxy to Salad Cloud for LLM inference (streaming tokens)
    - Message persistence.
- **RAG (Porta 3003)**:
    - Embeddings via Salad Cloud
    - `pgvector` for vector search
    - Chunking strategy: 500 characters with 50 overlap
    - Circuit Breaker: 30s timeout, 50% error rate, 30s open.
- **Training (Porta 3004)**:
    - Training data collection
    - SemHash for deduplication
    - Fine-tuning job management.
- **Integrations (Porta 3005)**: Handles external service connections with dedicated circuit breakers.
- **Observability (Porta 9090/3000/16686/3006)**: See "Observability" above.

### Security Practices

- **Passwords**: bcrypt with 12 rounds.
- **Cookies**: HttpOnly, Secure, SameSite.
- **CSRF**: OAuth state parameter.
- **Rate Limiting**: Per IP and endpoint.
- **Isolation**: `tenant_id` in all database queries.

### Infrastructure

- **Development**: Replit (IDE, local debugging, Git operations).
- **Production**: Hetzner Cloud (CX43, 8 vCPUs, 16 GB RAM, 160 GB SSD).
- **CI/CD**: GitHub Actions pipeline for building Docker images, pushing to GHCR, SSH deployment to Hetzner, and health checks.

## External Dependencies

- **Salad Cloud**:
    - **LLM Principal**: Llama 4 Maverick (400B parameters, 17B active MoE) for text processing. Multimodal input, text output. Context: 1M tokens.
    - **Embeddings**: `text-embedding-3-small`.
    - **Image Generation**: FLUX.1 Schnell (Apache 2.0) self-hosted. GPU: RTX 3090/4090.
    - **CLIP Inference (Multimodal Embeddings)**: CLIP ViT-L/14 (MIT License) self-hosted for cross-modal search (text-to-image, image-to-image). GPU: RTX 3060+.
- **PostgreSQL**: Primary database for persistence and real-time pub/sub.
- **Stripe Portugal**: Payment processing for EUR via SEPA, including webhooks.
- **Wise**: International money transfers, supporting 50+ currencies. Circuit breaker: 15s timeout.
- **ERPNext**: Integrated CRM and ERP system. Circuit breaker: 10s timeout. Utilizes `frappe_docker` (MariaDB, Redis Cache/Queue, Gunicorn, Nginx, Socket.io).
- **Twilio**: WhatsApp and SMS communication.
- **Resend**: Transactional email services.