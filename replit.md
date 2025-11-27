# Alice - Plataforma Enterprise de IA Autônoma

## Overview
Alice is a production-ready, autonomous enterprise AI platform built around the Llama 4 Maverick (400B parameters) model hosted on Salad Cloud. It aims to provide total autonomy, absolute data privacy, predictable costs by avoiding third-party token charges, and unlimited customization through fine-tuning. The platform addresses critical industry problems such as reliance on third-party APIs, data privacy concerns with external servers, and unpredictable costs associated with token-based pricing models. Key capabilities include real-time chat, deduplication, multi-tenancy, Role-Based Access Control (RBAC), RAG backend, payment processing (Stripe, Wise), CRM integration (ERPNext), communication (Twilio, Resend), and robust authentication.

## User Preferences
### Critical Rules
- LER ANTES DE AGIR: Inspecionar arquivos antes de implementar
- NÃO DUPLICAR: Verificar código existente primeiro
- WORKFLOW ESTRUTURADO: Diagnóstico → Plano → Aprovação → Implementação
- APROVAÇÃO OBRIGATÓRIA: Pedir aprovação antes de mudanças grandes
- NÃO MENTIR: Dizer "não sei" quando não souber
- SEM SOLUÇÕES TEMPORÁRIAS: **PROIBIDO**: workarounds, mocks, dados hardcoded, in-memory storage, valores default falsos. TODA lógica deve ser enterprise-grade com persistência real em PostgreSQL
- MUDANÇAS MÍNIMAS: Foco cirúrgico no problema
- QUALIDADE OBRIGATÓRIA: TypeScript strict, zero any, Pino
- VALIDAÇÃO CONTÍNUA: Testar após cada micro-passo
- DOCUMENTAÇÃO PT-BR: TODA documentação em português
- SEGUIR DOCS OFICIAIS: Melhores práticas 2025
- PRODUÇÃO HETZNER: Deploy via GitHub Actions
- INTERNACIONALIZAÇÃO: PT-BR primário, EN secundário
- VERIFICAR SECRETS: Checar variáveis existentes
- MICROSSERVIÇOS: Código em apps/, compartilhado em packages/
- MELHORES PRÁTICAS: API Gateway, health checks, circuit breakers

### Language Preferences
- Documentation: Português Brasileiro
- Code Comments: Português Brasileiro
- Log Messages: Português Brasileiro
- Variable Names: English
- Technical Terms: English (OAuth, JWT, etc.)

### Development Environment (Replit)
- The file `server/index-dev.ts` is ONLY for Replit preview and does NOT go into production.
- Data previews are allowed in `server/index-dev.ts` for UI testing purposes only.

## System Architecture

### Core Services
The platform is built on a microservices architecture with dedicated services for frontend, authentication, chat, RAG, training, integrations, and observability. Code is organized into `apps/` for microservices and `packages/` for shared components.

| Service | Port | Function |
|---------|-------|--------|
| frontend | 5000 | React SPA |
| api-gateway | 80/443 | Traefik |
| auth | 3001 | OAuth/SAML |
| chat | 3002 | LLM + WebSocket |
| rag | 3003 | Embeddings |
| training | 3004 | Fine-tuning |
| integrations | 3005 | Stripe, Wise, etc. |
| observability | 9090/3000/16686/3006 | Prometheus, Grafana, Jaeger, Langfuse |

### UI/UX Decisions
- **Frontend**: React 18, TypeScript 5, Vite 5, shadcn/ui, Tailwind CSS for a modern and responsive user interface.
- **Internationalization**: `react-i18next` for PT-BR/EN support.

### Technical Implementations
- **Authentication**: OAuth 2.0 (Google, GitHub, Microsoft), SAML 2.0 (Azure AD, Okta), local authentication with bcrypt, and a 6-level RBAC system.
- **Chat**: WebSocket for real-time streaming of tokens, proxy to Salad Cloud, and message persistence.
- **RAG**: Embeddings via Salad Cloud, `pgvector` for vector search, 500-character chunking with 50 overlap, and a 30-second circuit breaker.
- **Training**: Data collection, SemHash for deduplication, and fine-tuning job management.
- **Observability**: A separate, independent microservice (`apps/observability-service/`) using Prometheus 3.0, Grafana OSS 11.3, Jaeger 1.62, OpenTelemetry Collector, and Langfuse 2.x for LLM-specific metrics. Health checks are mandatory at `/api/service/health`.
- **Real-time Pub/Sub**: Utilizes PostgreSQL NOTIFY for simplicity and initial scalability, with a `conversation_states` table for persistence.
- **Image Generation**: Employs FLUX.1 Schnell (Apache 2.0) hosted on Salad Cloud, with progressive LoRA for learning from approved images, and object storage + CLIP embeddings for multimodal RAG.
- **Takeover/Handover**: Custom panel integrated into the dashboard with automatic triggers based on confidence scores, fallbacks, and sentiment analysis.
- **Security**: bcrypt 12 rounds for passwords, HttpOnly/Secure/SameSite cookies, CSRF protection with OAuth state parameter, rate limiting by IP and endpoint, and `tenant_id` for data isolation.

### Infrastructure
- **Development**: Replit serves as the IDE for coding, debugging, local testing, and Git operations.
- **Production**: Hetzner Cloud (CX43 instance) for deployment, with GitHub Actions for CI/CD, including Docker image building, pushing to GHCR, and SSH deployment.

### Development vs Production Distinction
- **DEV (Replit)**: IDE and UI preview, allows preview data in `server/index-dev.ts`.
- **PRODUCTION (Hetzner Cloud)**: Enterprise system, strictly prohibits mocks or hardcoded values (Rule 6).

## External Dependencies

- **Salad Cloud**:
    - **LLM Principal**: Llama 4 Maverick (400B parameters, 17B active MoE) for multimodal input (text, images, video) and text-only output. Context window of 1M tokens.
    - **Embeddings**: `text-embedding-3-small`.
    - **Image Generation**: FLUX.1 Schnell (Apache 2.0) self-hosted on Salad Cloud, utilizes RTX 3090/4090 GPUs.
    - **CLIP Inference**: CLIP ViT-L/14 (MIT License) for multimodal embeddings (768 dimensions), self-hosted on Salad Cloud (`apps/clip-inference-service/`) using RTX 3060+ GPUs.
- **PostgreSQL**: Primary database for persistence and real-time pub/sub via NOTIFY.
- **Stripe**: For EUR payments via SEPA, with webhooks for checkout and payment events.
- **Wise**: For global money transfers across 50+ currencies.
- **ERPNext**: Integrated CRM and ERP solution, implemented using official `frappe_docker`.
- **Twilio**: For WhatsApp and SMS communication.
- **Resend**: For transactional email services.
- **GitHub Actions**: For CI/CD pipeline automation.
- **Traefik**: As API Gateway with SSL.
- **Prometheus 3.0**: For metric collection and alerting.
- **Grafana OSS 11.3**: For dashboards and visualization.
- **Jaeger 1.62**: For distributed tracing.
- **OpenTelemetry Collector**: For unified instrumentation.
- **Langfuse 2.x**: For LLM-specific metrics.