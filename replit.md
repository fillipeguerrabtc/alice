# Alice - Plataforma Enterprise de IA Autônoma

## Overview

Alice is an enterprise-grade autonomous AI platform designed for production environments. It leverages the Llama 4 Maverick (400B parameters) model hosted on Salad Cloud, ensuring complete autonomy, absolute data privacy within controlled infrastructure, predictable costs without third-party token charges, and unlimited customization through fine-tuning for each client.

The platform addresses critical industry problems such as dependence on external APIs, data privacy concerns with sensitive information on third-party servers, and unpredictable costs associated with token-based pricing. Alice aims to provide a robust, private, and cost-effective AI solution.

Key capabilities include real-time chat, data deduplication, multi-tenancy, role-based access control (RBAC), RAG backend for embeddings and vector search, integrated payment processing (Stripe, Wise), CRM integration (ERPNext), communication services (Twilio, Resend), and comprehensive observability.

## User Preferences

- **LER ANTES DE AGIR**: Inspecionar arquivos antes de implementar qualquer mudança.
- **NÃO DUPLICAR**: Verificar o código existente antes de adicionar novas funcionalidades ou módulos.
- **WORKFLOW ESTRUTURADO**: Seguir um fluxo de trabalho de Diagnóstico → Plano → Aprovação → Implementação.
- **APROVAÇÃO OBRIGATÓRIA**: Solicitar aprovação antes de realizar grandes mudanças no código ou na arquitetura.
- **NÃO MENTIR**: Dizer "não sei" quando a informação não for conhecida.
- **SEM SOLUÇÕES TEMPORÁRIAS**: **PROIBIDO** o uso de workarounds, mocks, dados hardcoded, armazenamento in-memory, ou valores default falsos. Toda a lógica deve ser enterprise-grade com persistência real em PostgreSQL.
- **MUDANÇAS MÍNIMAS**: Focar cirurgicamente na resolução do problema específico.
- **QUALIDADE OBRIGATÓRIA**: Utilizar TypeScript strict, proibir `any`, e usar Pino para logging.
- **VALIDAÇÃO CONTÍNUA**: Testar o código após cada micro-passo de implementação.
- **DOCUMENTAÇÃO PT-BR**: Toda a documentação deve ser em português brasileiro.
- **SEGUIR DOCS OFICIAIS**: Adotar as melhores práticas e documentações oficiais de 2025.
- **PRODUÇÃO HETZNER**: O deploy para produção deve ser feito via GitHub Actions para a Hetzner Cloud.
- **INTERNACIONALIZAÇÃO**: Português Brasileiro como idioma primário e Inglês como secundário.
- **VERIFICAR SECRETS**: Checar as variáveis de ambiente e secrets existentes antes de adicionar novas.
- **MICROSSERVIÇOS**: Organizar o código em `apps/` para microserviços e `packages/` para código compartilhado.
- **MELHORES PRÁTICAS**: Implementar API Gateway, health checks e circuit breakers.
- **Idiomas Preferidos**:
    - Documentação: Português Brasileiro
    - Comentários no código: Português Brasileiro
    - Mensagens de log: Português Brasileiro
    - Nomes de variáveis: Inglês
    - Termos técnicos: Inglês (OAuth, JWT, etc.)

## System Architecture

The Alice platform is built on a microservices architecture, with distinct services handling different functionalities.

**Core Services:**

-   **Frontend (Porta 5000):** React 18, TypeScript 5, Vite 5, shadcn/ui, Tailwind CSS, TanStack Query, Wouter, react-i18next (PT-BR/EN).
-   **API Gateway (Porta 80/443):** Traefik handles ingress, SSL termination, and routing.
-   **Authentication (Porta 3001):** Manages OAuth 2.0 (Google, GitHub, Microsoft) and SAML 2.0 (Azure AD, Okta) authentication, local authentication with bcrypt, and RBAC with 6 roles (super_admin, admin, manager, operator, viewer, guest).
-   **Chat (Porta 3002):** WebSocket for real-time communication, proxies to Salad Cloud for LLM inference, handles token streaming, and persists messages.
-   **RAG (Porta 3003):** Manages embeddings via Salad Cloud, utilizes pgvector for vector search, employs chunking (500 chars, 50 overlap), and implements a circuit breaker (30s/50%/30s).
-   **Training (Porta 3004):** Collects training data, uses SemHash for deduplication, and manages fine-tuning jobs.
-   **Integrations (Porta 3005):** Centralized service for third-party integrations with circuit breakers configured for each (e.g., Wise: 15s/50%/30s, ERPNext: 10s/50%/30s).
-   **Observability (Porta 9090/3000/16686/3006):** A separate and independent microservice stack for monitoring, including Prometheus 3.0 (metrics), Grafana OSS 11.3 (dashboards), Jaeger 1.62 (distributed tracing), OpenTelemetry Collector (instrumentation), and Langfuse 2.x (LLM metrics). This ensures monitoring even if the main system fails.

**Key Architectural Decisions:**

-   **Learning Schedule:** Real-time RAG updates, daily auto-indexing, incremental LoRA fine-tuning every 4 days, and full fine-tuning bi-weekly to ensure rapid and aggressive learning.
-   **Pub/Sub Real-time:** PostgreSQL NOTIFY for initial scaling, with `conversation_states` table as a fallback for persistence. Redis will be considered for higher throughput (>1k msg/s).
-   **Image Generation:** Uses FLUX.1 Schnell model (Apache 2.0) self-hosted on Salad Cloud for predictable costs, with progressive LoRA for continuous learning from approved images. Object Storage combined with CLIP embeddings enables multimodal RAG.
-   **Takeover/Handover:** Custom panel integrated into the Alice dashboard for human agents, avoiding costly third-party solutions like Twilio Flex. Automatic triggers for human intervention are based on confidence scores, fallbacks, and sentiment analysis.
-   **Security:** Implements bcrypt (12 rounds) for passwords, HttpOnly/Secure/SameSite cookies, CSRF protection via OAuth state parameter, IP/endpoint-based rate limiting, and `tenant_id` isolation in database queries.
-   **Development vs. Production:** Replit serves as the IDE and UI preview environment, allowing preview data in `server/index-dev.ts`. Production deploys to Hetzner Cloud via GitHub Actions, strictly prohibiting mocks or hardcoded data as per Rule 6.
-   **Code Standards:** Strict TypeScript with no `any`, Pino for logging (console.log is forbidden), and mandatory `/api/servico/health` endpoints for all services.

## External Dependencies

-   **Salad Cloud:**
    -   **LLM Principal:** Llama 4 Maverick (400B parameters, 17B active MoE) for text processing. Multimodal input (text, images, video) but text-only output. Context window of 1M tokens.
    -   **Embeddings:** `text-embedding-3-small`.
    -   **Image Generation:** FLUX.1 Schnell model (Apache 2.0), self-hosted on Salad Cloud (Container Group with RTX 3090/4090 GPUs).
    -   **CLIP Inference:** CLIP ViT-L/14 model (MIT License) for multimodal embeddings (768 dimensions), self-hosted on Salad Cloud (Container Group with RTX 3060+ GPUs).
-   **Stripe Portugal:** For EUR payments via SEPA, including webhook support for checkout and payment events.
-   **Wise:** For global money transfers supporting over 50 currencies.
-   **ERPNext:** Integrated CRM and ERP system, deployed via `frappe_docker` using MariaDB, Redis, Gunicorn, Nginx, and Socket.io.
-   **Twilio:** For WhatsApp and SMS communication services.
-   **Resend:** For transactional email delivery.
-   **PostgreSQL:** Primary database for persistent storage.