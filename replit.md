# Alice - Plataforma Enterprise de IA Autônoma

## Overview

Alice is an enterprise-grade autonomous AI platform designed for production environments. It leverages the **Llama 4 Maverick (400B parameters)** model hosted on Salad Cloud, offering complete autonomy, absolute data privacy, predictable costs by avoiding third-party token charges, and unlimited customization through fine-tuning.

The platform addresses critical issues such as dependency on third-party APIs, data privacy concerns with sensitive information on external servers, and unpredictable costs associated with token-based pricing models. Key capabilities include real-time chat with streaming, data deduplication, multi-tenancy, Role-Based Access Control (RBAC), a RAG (Retrieval Augmented Generation) backend with vector search, and integrations with payment, CRM, and communication services.

Alice aims to provide a robust, private, and cost-effective AI solution for businesses, supporting advanced features like aggressive auto-learning, multimodal image generation (FLUX.1 Schnell), and a comprehensive observability stack.

## User Preferences

*   **LER ANTES DE AGIR**: Inspecionar arquivos antes de implementar qualquer código.
*   **NÃO DUPLICAR**: Verificar código existente antes de criar novas funcionalidades.
*   **WORKFLOW ESTRUTURADO**: Seguir o fluxo de Diagnóstico → Plano → Aprovação → Implementação.
*   **APROVAÇÃO OBRIGATÓRIA**: Pedir aprovação antes de fazer mudanças significativas.
*   **NÃO MENTIR**: Dizer "não sei" quando não souber a resposta.
*   **SEM SOLUÇÕES TEMPORÁRIAS**: PROIBIDO workarounds, mocks, dados hardcoded, in-memory storage, ou valores default falsos. TODA lógica deve ser enterprise-grade com persistência real em PostgreSQL.
*   **MUDANÇAS MÍNIMAS**: Foco cirúrgico no problema, fazendo apenas as mudanças necessárias.
*   **QUALIDADE OBRIGATÓRIA**: Usar TypeScript strict, evitar `any`, e utilizar Pino para logging.
*   **VALIDAÇÃO CONTÍNUA**: Testar após cada micro-passo na implementação.
*   **DOCUMENTAÇÃO PT-BR**: TODA a documentação deve ser em português brasileiro.
*   **SEGUIR DOCS OFICIAIS**: Adotar as melhores práticas de 2025 conforme documentações oficiais.
*   **PRODUÇÃO HETZNER**: O deploy deve ser feito via GitHub Actions para o ambiente de produção na Hetzner.
*   **INTERNACIONALIZAÇÃO**: PT-BR como idioma primário, EN como secundário.
*   **VERIFICAR SECRETS**: Checar as variáveis de ambiente existentes e configuradas.
*   **MICROSSERVIÇOS**: Organizar o código em `apps/` para microserviços e `packages/` para código compartilhado.
*   **MELHORES PRÁTICAS**: Implementar API Gateway, health checks e circuit breakers.
*   **Linguagem da documentação, comentários e logs**: Português Brasileiro.
*   **Nomes de variáveis e termos técnicos**: Inglês.
*   **Ambiente DEV vs PRODUÇÃO**: O ambiente Replit é APENAS para desenvolvimento e preview de UI. Dados de preview são permitidos em `server/index-dev.ts` SOMENTE para este fim, e este arquivo NÃO vai para produção. O código em `apps/` é o que vai para produção.

## System Architecture

The Alice platform is built on a microservices architecture, with each service responsible for specific functionalities. The core technology stack emphasizes TypeScript, React, and PostgreSQL.

**Core Services:**

*   **Frontend (Porta 5000):** React 18 SPA with Vite 5, shadcn/ui, Tailwind CSS, TanStack Query, Wouter, and react-i18next for PT-BR/EN.
*   **API Gateway (Porta 80/443):** Traefik for routing and SSL termination.
*   **Authentication (Porta 3001):** Handles OAuth 2.0 (Google, GitHub, Microsoft), SAML 2.0 (Azure AD, Okta), local bcrypt authentication, and RBAC with 6 roles.
*   **Chat (Porta 3002):** Manages real-time communication via WebSockets, proxies requests to Salad Cloud's LLM, handles token streaming, and persists messages.
*   **RAG (Porta 3003):** Utilizes Salad Cloud for embeddings, pgvector for vector search, 500-character chunking with 50-character overlap, and a circuit breaker (30s/50%/30s).
*   **Training (Porta 3004):** Collects training data, uses SemHash for deduplication, and manages fine-tuning jobs.
*   **Integrations (Porta 3005):** Centralizes third-party integrations (Stripe, Wise, ERPNext, Twilio, Resend) with configured circuit breakers.
*   **Observability (Porta 9090/3000/16686/3006):** A separate and independent microservice stack including Prometheus 3.0 (metrics), Grafana OSS 11.3 (dashboards), Jaeger 1.62 (distributed tracing), OpenTelemetry Collector (instrumentation), and Langfuse 2.x (LLM metrics).

**Architectural Decisions:**

*   **Learning Schedule:** Real-time RAG updates, daily auto-indexing, aggressive incremental fine-tuning every 4 days (LoRA), and full fine-tuning bi-weekly.
*   **Pub/Sub:** Primarily uses PostgreSQL NOTIFY for real-time updates, with `conversation_states` table as a fallback for persistence. Redis planned for future scaling (>1k msg/s).
*   **Image Generation:** Uses FLUX.1 Schnell model (Apache 2.0) self-hosted on Salad Cloud, with progressive LoRA for continuous learning from approved images. Storage uses Object Storage with CLIP embeddings for multimodal RAG.
*   **Takeover/Handover:** Custom panel integrated into the Alice dashboard, avoiding Twilio Flex. Default SLA of 30 minutes, with automatic triggers based on confidence scores, fallbacks, and sentiment.
*   **Security:** Implements bcrypt (12 rounds) for passwords, HttpOnly/Secure/SameSite cookies, CSRF protection via OAuth state parameter, IP/endpoint rate limiting, and `tenant_id` isolation in queries.
*   **RBAC:** Six predefined roles: `super_admin`, `admin`, `manager`, `operator`, `viewer`, and `guest`.
*   **Development Environment:** Replit serves as the IDE for local development, debugging, and Git operations.
*   **Production Environment:** Deployed on Hetzner Cloud (CX43: 8 vCPUs, 16 GB RAM, 160 GB SSD) via GitHub Actions CI/CD pipeline.
*   **Logging:** Enforces Pino for logging; `console.log` is prohibited.
*   **TypeScript:** Strict mode is mandatory; `any` type is prohibited.
*   **Health Checks:** All services must expose a health check endpoint at `/api/service/health`.

## External Dependencies

*   **Salad Cloud:**
    *   **LLM Principal:** Llama 4 Maverick (400B parameters), multimodal input, text output, 1M tokens context, text-embedding-3-small for embeddings. Circuit breaker with 30s timeout.
    *   **Image Generation:** FLUX.1 Schnell (Apache 2.0), self-hosted on Salad Cloud Container Group (RTX 3090/4090 GPU), 1-3 seconds/image.
    *   **CLIP Inference:** CLIP ViT-L/14 (MIT license), self-hosted on Salad Cloud Container Group (RTX 3060+ GPU) for multimodal embeddings (768 dimension).
*   **Stripe Portugal:** For EUR payments via SEPA, with webhook integration for checkout and payments.
*   **Wise:** For global international transfers supporting 50+ currencies. Circuit breaker with 15s timeout.
*   **ERPNext:** Integrated CRM and ERP solution, deployed via `frappe_docker` (MariaDB, Redis, Gunicorn, Nginx, Socket.io, Workers). Circuit breaker with 10s timeout.
*   **Twilio:** For WhatsApp and SMS communication services.
*   **Resend:** For transactional email delivery.
*   **PostgreSQL:** Primary database for persistent storage and pub/sub (NOTIFY).
*   **Prometheus 3.0:** Open-source monitoring system for time-series data collection.
*   **Grafana OSS 11.3:** Open-source platform for data visualization and dashboards.
*   **Jaeger 1.62:** Open-source distributed tracing system.
*   **OpenTelemetry Collector:** Open-source component for collecting and processing telemetry data.
*   **Langfuse 2.x:** Open-source platform for LLM specific metrics and observability.