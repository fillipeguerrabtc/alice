# Alice - Plataforma Enterprise de IA Autônoma

## Overview

Alice is a production-ready enterprise autonomous AI platform built around the Llama 4 Maverick (400B parameters) model, self-hosted on Salad Cloud. This architecture ensures complete autonomy, absolute data privacy, predictable costs by avoiding third-party token charges, and unlimited customization through fine-tuning. The platform addresses common enterprise AI challenges like dependency on third-party APIs, data privacy concerns, and unpredictable costs. Key capabilities include real-time chat, deduplication, multi-tenancy, RBAC, RAG backend, image generation (FLUX.1 Schnell), and aggressive auto-learning. Future plans include advanced multimodal capabilities, web crawling, and advanced analytics.

## User Preferences

### The 16 Fundamental Rules

| Number | Rule | Description |
|--------|-------|-----------|
| 1 | LER ANTES DE AGIR | Inspecionar arquivos antes de implementar |
| 2 | NÃO DUPLICAR | Verificar código existente primeiro |
| 3 | WORKFLOW ESTRUTURADO | Diagnóstico → Plano → Aprovação → Implementação |
| 4 | APROVAÇÃO OBRIGATÓRIA | Pedir aprovação antes de mudanças grandes |
| 5 | NÃO MENTIR | Dizer "não sei" quando não souber |
| 6 | SEM SOLUÇÕES TEMPORÁRIAS | **PROIBIDO**: workarounds, mocks, dados hardcoded, in-memory storage, valores default falsos. TODA lógica deve ser enterprise-grade com persistência real em PostgreSQL |
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
|----------|--------|
| Documentation | Português Brasileiro |
| Code Comments | Português Brasileiro |
| Log Messages | Português Brasileiro |
| Variable Names | English |
| Technical Terms | English (OAuth, JWT, etc.) |

### Development Environment (Replit) Rules

- The `server/index-dev.ts` file is ONLY for preview within Replit and is NOT deployed to production.
- Preview data is allowed in `server/index-dev.ts` for UI visualization.
- The code in `apps/` (microservices) goes to production via GitHub Actions.

## System Architecture

The Alice platform employs a microservice architecture with distinct services for various functionalities, all orchestrated by an API Gateway (Traefik).

### Core Services

- **Frontend (Porta 5000):** React 18, TypeScript 5, Vite 5, shadcn/ui, Tailwind CSS, TanStack Query, Wouter, react-i18next (PT-BR/EN).
- **Authentication (Porta 3001):** OAuth 2.0 (Google, GitHub, Microsoft), SAML 2.0 (Azure AD, Okta), local authentication with bcrypt, RBAC with 6 roles.
- **Chat (Porta 3002):** WebSocket for real-time communication, proxy to Salad Cloud LLM, token streaming, message persistence.
- **RAG (Porta 3003):** Embeddings via Salad Cloud, pgvector for vector search, chunking (500 chars, 50 overlap), circuit breaker (30s/50%/30s).
- **Training (Porta 3004):** Training data collection, SemHash for deduplication, fine-tuning job management.
- **Integrations (Porta 3005):** Handles external services like Stripe, Wise, ERPNext, Twilio, Resend.
- **Observability (Porta 9090/3000/16686/3006):** Dedicated microservice for monitoring, including Prometheus 3.0 (metrics), Grafana OSS 11.3 (dashboards), Jaeger 1.62 (distributed tracing), OpenTelemetry Collector (instrumentation), and Langfuse 2.x (LLM metrics). This service is designed to be separate and independent to ensure continuous monitoring.

### Observability Architecture

- **Principle:** Separate and independent observability microservice to guarantee monitoring even if the main system fails.
- **LLM Specific Metrics:** Token Usage, Time to First Token (TTFT), Request Latency, Error Rate, Cost per Request, RAG Retrieval Time.
- **Stack:** Prometheus, Grafana, Jaeger, OpenTelemetry Collector, Langfuse, and a custom Health Checker API.

### Schedule de Aprendizado (Verticalized Use)

- **RAG update:** Real-time.
- **Auto-indexação:** Daily.
- **Fine-tuning incremental:** Every 4 days (LoRA with new data).
- **Fine-tuning completo:** Bi-weekly (deeper retraining).

### Pub/Sub Real-time

- **Technology:** PostgreSQL NOTIFY for simplicity and initial scalability.
- **Fallback:** `conversation_states` table for persistence guarantee.
- **Future Migration:** Redis if message rates exceed 1k msg/s.

### Image Generation

- **Model:** FLUX.1 Schnell (state-of-the-art 2025, Apache 2.0).
- **Hosting:** Salad Cloud (self-hosted container group).
- **Learning:** Progressive LoRA using approved images.
- **Storage:** Object Storage + CLIP embeddings for multimodal RAG.

### Takeover/Handover

- **Panel:** Custom built into the Alice dashboard, not using Twilio Flex.
- **SLA Default:** 30 minutes.
- **Automatic Triggers:** Confidence <70%, 3+ fallbacks, negative sentiment.

### Security

- **Practices:** bcrypt 12 rounds for passwords, HttpOnly/Secure/SameSite cookies, OAuth state parameter for CSRF, rate limiting by IP/endpoint, `tenant_id` isolation in queries.
- **RBAC Hierarchy:** 6 roles (super_admin, admin, manager, operator, viewer, guest) with progressively decreasing access.

### Infrastructure

- **Development:** Replit IDE for coding, debugging, local testing, and Git operations.
- **Production:** Hetzner Cloud (CX43: 8 vCPUs, 16 GB RAM, 160 GB SSD) with deployments handled via GitHub Actions.

### Build System (pnpm Workspaces - Enterprise 2025)

- **Package Manager:** pnpm@10.12.4 (padrão enterprise 2025)
- **Workspace Config:** pnpm-workspace.yaml com packages/* e apps/*
- **GitHub Actions:** pnpm/action-setup@v4 com cache otimizado BuildKit
- **Dockerfiles:** Multi-stage builds seguindo padrão oficial pnpm.io:
  - Stage 1 (deps): Copia package.json de todos os pacotes workspace
  - Stage 2 (builder): pnpm install → build pacotes → build serviço → pnpm deploy --prod
  - Stage 3 (runner): node:20-slim com usuário não-root + health checks
- **Pacotes Internos (packages/):** shared, shared-utils, config, logger, database
- **Serviços (apps/):** chat, auth, rag, training, integrations, api-gateway, frontend, observability
- **Campo "files":** Todos os 13 package.json têm `"files": ["dist"]` para pnpm deploy incluir artefatos compilados

## External Dependencies

- **Salad Cloud:**
    - **LLM Principal:** Llama 4 Maverick (400B parameters, 17B active MoE) for text generation. Multimodal input (text, images, video) but text-only output. Context window: 1M tokens.
    - **Embeddings:** text-embedding-3-small.
    - **Image Generation:** FLUX.1 Schnell (Apache 2.0, self-hosted container group on RTX 3090/4090 GPUs).
    - **CLIP Inference (Multimodal Embeddings):** CLIP ViT-L/14 (MIT license) self-hosted container group on RTX 3060+ GPUs. Provides 768-dimension embeddings for cross-modal search.
- **PostgreSQL:** Primary database with pgvector extension for RAG.
- **Stripe Portugal:** For EUR payments via SEPA, including webhook processing.
- **Wise:** For global money transfers in 50+ currencies.
- **ERPNext:** Integrated CRM and ERP system. Implemented with `frappe_docker` for MariaDB, Redis, Gunicorn/Python, Nginx, and Socket.io services.
- **Twilio:** For WhatsApp and SMS messaging.
- **Resend:** For transactional email delivery.
- **GitHub Actions:** CI/CD pipeline for building Docker images, pushing to GHCR, and deploying to Hetzner Cloud via SSH.