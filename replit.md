# Alice - Plataforma Enterprise de IA Autônoma

## Overview

Alice is a production-ready, autonomous enterprise AI platform powered by the Llama 4 Maverick (400B parameters) model, self-hosted on Salad Cloud. It aims to solve the problems of third-party dependency, data privacy concerns, and unpredictable costs associated with external AI APIs. Alice offers complete autonomy, absolute data privacy, predictable costs, and unlimited customization through fine-tuning for each client.

The platform includes real-time chat with streaming, deduplication using SemHash, multi-tenant isolation, Role-Based Access Control (RBAC), a RAG backend for embeddings and vector search, and integrations with payment gateways (Stripe, Wise), CRM (ERPNext), communication (Twilio, Resend), and robust authentication (OAuth 2.0, SAML 2.0).

Key recent developments include an AI Dashboard with metrics, a human agent takeover/handover panel, an image gallery with rating and approval for training, Agentic RAG combining internal and Brave Search, and inline image display in chat. Future plans include advanced multimodal capabilities (audio/video), web crawling, and advanced analytics.

## User Preferences

- **Workflow:**
    - LER ANTES DE AGIR: Inspecionar arquivos antes de implementar.
    - NÃO DUPLICAR: Verificar código existente primeiro.
    - WORKFLOW ESTRUTURADO: Diagnóstico → Plano → Aprovação → Implementação.
    - APROVAÇÃO OBRIGATÓRIA: Pedir aprovação antes de mudanças grandes.
    - SEM SOLUÇÕES TEMPORÁRIAS: PROIBIDO: workarounds, mocks, dados hardcoded, in-memory storage, valores default falsos. TODA lógica deve ser enterprise-grade com persistência real em PostgreSQL.
    - MUDANÇAS MÍNIMAS: Foco cirúrgico no problema.
    - VALIDAÇÃO CONTÍNUA: Testar após cada micro-passo.
    - PRODUÇÃO HETZNER: Deploy via GitHub Actions.
    - SEGUIR DOCS OFICIAIS: Melhores práticas 2025.
    - MICROSSERVIÇOS: Código em apps/, compartilhado em packages/.
    - MELHORES PRÁTICAS: API Gateway, health checks, circuit breakers.
- **Communication & Documentation:**
    - NÃO MENTIR: Dizer "não sei" quando não souber.
    - DOCUMENTAÇÃO PT-BR: TODA documentação em português.
- **Coding Style:**
    - QUALIDADE OBRIGATÓRIA: TypeScript strict, zero any, Pino.
    - INTERNACIONALIZAÇÃO: PT-BR primário, EN secundário.
    - VERIFICAR SECRETS: Checar variáveis existentes.
    - Nomes de variáveis: Inglês.
    - Termos técnicos: Inglês (OAuth, JWT, etc.).
    - Comentários no código: Português Brasileiro.
    - Mensagens de log: Português Brasileiro.
- **General Working Preferences:**
    - O código em `apps/` (microserviços) vai para produção via GitHub Actions. O arquivo `server/index-dev.ts` é APENAS para preview no Replit e NÃO vai para produção.
    - Logging: Usar Pino. `console.log` é PROIBIDO.
    - TypeScript: Modo strict. `any` é PROIBIDO.
    - Health Check: Obrigatório em `/api/servico/health`.

## System Architecture

The system is built on a microservices architecture, with code organized in `apps/` for services and `packages/` for shared components.

**UI/UX Decisions:**
- Frontend: React 18 with TypeScript 5, Vite 5, shadcn/ui, Tailwind CSS.
- Internationalization: `react-i18next` for PT-BR/EN.

**Technical Implementations & Feature Specifications:**

- **AI Model:** Llama 4 Maverick (400B, 17B MoE active) hosted on Salad Cloud. Multimodal input, text output only. 1M token context.
- **Embeddings:** `text-embedding-3-small` also via Salad Cloud.
- **Image Generation:** FLUX.1 Schnell (Apache 2.0) self-hosted on Salad Cloud, using Progressive LoRA for learning from approved images. Storage uses Object Storage + CLIP embeddings.
- **Multimodal Embeddings (CLIP):** CLIP ViT-L/14 (MIT license) self-hosted on Salad Cloud for cross-modal search (text-to-image, image-to-image).
- **Authentication:** OAuth 2.0 (Google, GitHub, Microsoft), SAML 2.0 (Azure AD, Okta), local authentication with bcrypt (12 rounds). RBAC with 6 roles.
- **Real-time Communication:** WebSocket for chat, PostgreSQL NOTIFY for pub/sub (with `conversation_states` table for persistence), scalable to Redis if needed.
- **Data Management:** `pgvector` for vector search, SemHash for deduplication, multi-tenancy enforced by `tenant_id`.
- **Learning Schedule:** RAG updates in real-time, auto-indexing daily, incremental fine-tuning every 4 days, full fine-tuning bi-weekly.
- **Takeover/Handover:** Custom panel integrated into the dashboard, not using Twilio Flex. Automatic triggers based on confidence scores, fallbacks, and sentiment.
- **Observability (Critical Principle: Separate Microservice):**
    - Prometheus 3.0: Metrics collection, LLM alerts.
    - Grafana OSS 11.3: Dashboards, visualization.
    - Jaeger 1.62: Distributed tracing.
    - OpenTelemetry Collector: Unified instrumentation.
    - Langfuse 2.x: LLM-specific metrics (Token Usage, TTFT, Request Latency, Error Rate, Cost per Request, RAG Retrieval Time).
    - Custom Health Checker API.
    - Located in `apps/observability-service/`.

**System Design Choices:**
- **Microservices:** `apps/` contains distinct services, `packages/` for shared code.
- **API Gateway:** Traefik for routing and SSL.
- **Circuit Breakers:** Implemented for external integrations (RAG, Wise, ERPNext) to ensure resilience.
- **Development Environment:** Replit serves as the IDE for local debugging and UI preview using `server/index-dev.ts` (not deployed to production).
- **Production Environment:** Hetzner Cloud for enterprise deployment.
- **CI/CD:** GitHub Actions for automated Docker builds, pushes to GHCR, SSH deployment to Hetzner, and health checks.
- **Security Practices:** bcrypt for passwords, HttpOnly/Secure/SameSite cookies, CSRF protection via OAuth state parameter, rate limiting by IP/endpoint, `tenant_id` isolation.

## External Dependencies

- **Salad Cloud:**
    - **Llama 4 Maverick:** Primary LLM for inference (self-hosted).
    - **text-embedding-3-small:** For text embeddings (self-hosted).
    - **FLUX.1 Schnell:** For image generation (self-hosted, Apache 2.0).
    - **CLIP ViT-L/14:** For multimodal embeddings (self-hosted, MIT License).
- **PostgreSQL:** Primary database, including `pgvector` extension for vector search.
- **Stripe Portugal:** For EUR payments via SEPA.
- **Wise:** For global money transfers across 50+ currencies.
- **ERPNext (v15):** Integrated CRM and ERP solution, deployed via `frappe_docker`. Uses MariaDB, Redis (cache and queue).
- **Twilio:** For WhatsApp and SMS communication.
- **Resend:** For transactional email delivery.
- **Traefik:** As API Gateway.
- **Prometheus 3.0:** Open-source monitoring system.
- **Grafana OSS 11.3:** Open-source analytics and interactive visualization web application.
- **Jaeger 1.62:** Open-source distributed tracing system.
- **OpenTelemetry Collector:** Open-source vendor-agnostic implementation for sending telemetry data.
- **Langfuse 2.x:** Open-source platform for LLM observability.
- **GitHub Actions:** For CI/CD pipeline.