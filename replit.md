# Alice - Plataforma Enterprise de IA Autônoma

## Overview

Alice is a production-ready, autonomous enterprise AI platform powered by the Llama 4 Maverick (400B parameters) model, self-hosted on Salad Cloud. Its core purpose is to provide a fully autonomous, private, and cost-predictable AI solution, free from external API dependencies and third-party token charges. Alice ensures absolute data privacy by keeping all operations within controlled infrastructure and offers unlimited customization through client-specific fine-tuning. It addresses issues of third-party dependency, data privacy concerns with external servers, and unpredictable costs associated with per-token billing.

The project encompasses a wide range of functionalities including real-time chat, deduplication, multi-tenancy, RBAC, RAG backend, and integrations with payment (Stripe, Wise), CRM (ERPNext), communication (Twilio, Resend), and robust authentication (OAuth 2.0, SAML 2.0). Recent enhancements include an AI Dashboard, human agent takeover/handover capabilities, an image gallery with rating, agentic RAG with hybrid search, and inline image display in chat. Future plans include advanced multimodal capabilities (audio/video), web crawling, and advanced analytics.

## User Preferences

### As 16 Regras Fundamentais

| Número | Regra | Descrição |
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

### Preferências de Idioma

| Contexto | Idioma |
|----------|--------|
| Documentação | Português Brasileiro |
| Comentários no código | Português Brasileiro |
| Mensagens de log | Português Brasileiro |
| Nomes de variáveis | Inglês |
| Termos técnicos | Inglês (OAuth, JWT, etc.) |

## System Architecture

Alice employs a microservices architecture, with core services deployed in `apps/` and shared utilities in `packages/`. The system is designed for high availability, scalability, and security, following 2025 best practices.

**Core Services:**

*   **Frontend (Porta 5000):** React 18, TypeScript 5, Vite 5, shadcn/ui, Tailwind CSS, TanStack Query, Wouter, react-i18next (PT-BR/EN).
*   **Auth (Porta 3001):** Handles OAuth 2.0 (Google, GitHub, Microsoft), SAML 2.0 (Azure AD, Okta), local authentication with bcrypt, and a 6-level RBAC system.
*   **Chat (Porta 3002):** Manages real-time communication via WebSockets, proxies LLM requests to Salad Cloud, streams tokens, and persists messages.
*   **RAG (Porta 3003):** Manages embeddings via Salad Cloud, utilizes `pgvector` with HNSW for native vector search (chunking: 500 chars, 50 overlap), and implements circuit breakers.
*   **Training (Porta 3004):** Collects training data, uses SemHash for deduplication, and manages fine-tuning jobs.
*   **Integrations (Porta 3005):** Centralizes third-party API interactions with circuit breakers for resilience.
*   **Observability (Porta 9090/3000/16686/3006):** A separate, independent microservice ensuring continuous monitoring even if the main system fails. It integrates Prometheus, Grafana, Jaeger, OpenTelemetry Collector, and Langfuse for comprehensive metrics and tracing.

**Architectural Decisions:**

*   **Learning Schedule:** Real-time RAG updates, daily auto-indexing, aggressive incremental fine-tuning (every 4 days with LoRA), and bi-weekly full fine-tuning.
*   **Real-time Pub/Sub:** Initially uses PostgreSQL NOTIFY for simplicity and persistence, with a future migration to Redis if scale demands ( >1k msg/s).
*   **Image Generation:** Leverages FLUX.1 Schnell (Apache 2.0) self-hosted on Salad Cloud, with progressive LoRA for learning from approved images and object storage + CLIP embeddings for multimodal RAG.
*   **Takeover/Handover:** Custom panel integrated into the Alice dashboard, avoiding costly third-party solutions. Automated triggers based on confidence scores, fallbacks, and sentiment analysis.
*   **Security:** Implements bcrypt for passwords, HttpOnly/Secure/SameSite cookies, CSRF protection, IP/endpoint rate limiting, and `tenant_id` isolation.
*   **Observability Stack:** Comprises Prometheus 3.0, Grafana OSS 11.3, Jaeger 1.62, OpenTelemetry Collector, and Langfuse 2.x for LLM-specific metrics.
*   **Database:** PostgreSQL with native `pgvector` HNSW indexes for efficient vector search on `media_uploads` (CLIP embeddings) and `document_chunks` (text embeddings).
*   **Deployment:** CI/CD pipeline via GitHub Actions for automated Docker image builds, pushes to GHCR, and SSH deployment to Hetzner Cloud.
*   **Development Environment:** Replit serves as the IDE for local development, debugging, and UI preview (using `server/index-dev.ts` for preview data, which is distinct from production code).
*   **Production Environment:** Hetzner Cloud (CX43 instance) hosts the enterprise system.

## External Dependencies

*   **Salad Cloud:**
    *   **LLM Principal:** Llama 4 Maverick (400B params) for text output, multimodal input.
    *   **Embeddings:** `text-embedding-3-small`.
    *   **Image Generation:** FLUX.1 Schnell (Apache 2.0), self-hosted on Salad Cloud GPUs.
    *   **CLIP Inference:** CLIP ViT-L/14 (MIT license), self-hosted for multimodal (text/image) embeddings with 768 dimensions.
*   **PostgreSQL:** Primary database, utilized for data persistence and native `pgvector` for vector search.
*   **Stripe Portugal:** For EUR payments via SEPA, including webhook processing.
*   **Wise:** For international money transfers supporting 50+ currencies.
*   **ERPNext:** Integrated CRM and ERP system.
*   **Twilio:** For WhatsApp and SMS communication.
*   **Resend:** For transactional email services.
*   **Traefik:** Used as the API Gateway for routing and SSL termination.
*   **GitHub Actions:** For CI/CD pipeline automation.
*   **Prometheus 3.0:** Open-source monitoring system.
*   **Grafana OSS 11.3:** Open-source analytics and visualization platform.
*   **Jaeger 1.62:** Distributed tracing system.
*   **OpenTelemetry Collector:** Open-source instrumentation for telemetry data.
*   **Langfuse 2.x:** Open-source platform for LLM observability.