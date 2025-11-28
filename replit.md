# Alice - Plataforma Enterprise de IA Autônoma

## Overview

Alice is a production-ready enterprise autonomous AI platform leveraging the **Llama 4 Maverick (400B parameters)** model, self-hosted on Salad Cloud. Its core purpose is to provide an AI solution with **total autonomy, absolute data privacy, predictable costs, and unlimited customization** through fine-tuning.

The platform addresses critical industry problems such as reliance on third-party APIs, data privacy concerns with external servers, and unpredictable costs associated with token-based pricing.

Key capabilities include: real-time chat with streaming, deduplication, multi-tenancy, Role-Based Access Control (RBAC), RAG (Retrieval Augmented Generation) backend, multimodal image generation (FLUX.1 Schnell), and a comprehensive observability stack. The business vision is to deliver a robust, secure, and cost-effective AI solution tailored for enterprise needs, ensuring data sovereignty and flexibility.

## User Preferences

- **LER ANTES DE AGIR**: Inspecionar arquivos antes de implementar.
- **NÃO DUPLICAR**: Verificar código existente primeiro.
- **WORKFLOW ESTRUTURADO**: Diagnóstico → Plano → Aprovação → Implementação.
- **APROVAÇÃO OBRIGATÓRIA**: Pedir aprovação antes de mudanças grandes.
- **NÃO MENTIR**: Dizer "não sei" quando não souber.
- **SEM SOLUÇÕES TEMPORÁRIAS**: **PROIBIDO**: workarounds, mocks, dados hardcoded, in-memory storage, valores default falsos. TODA lógica deve ser enterprise-grade com persistência real em PostgreSQL.
- **MUDANÇAS MÍNIMAS**: Foco cirúrgico no problema.
- **QUALIDADE OBRIGATÓRIA**: TypeScript strict, zero any, Pino.
- **VALIDAÇÃO CONTÍNUA**: Testar após cada micro-passo.
- **DOCUMENTAÇÃO PT-BR**: TODA documentação em português.
- **SEGUIR DOCS OFICIAIS**: Melhores práticas 2025.
- **PRODUÇÃO HETZNER**: Deploy via GitHub Actions.
- **INTERNACIONALIZAÇÃO**: PT-BR primário, EN secundário.
- **VERIFICAR SECRETS**: Checar variáveis existentes.
- **MICROSSERVIÇOS**: Código em apps/, compartilhado em packages/.
- **MELHORES PRÁTICAS**: API Gateway, health checks, circuit breakers.

### Preferências de Idioma

- **Documentação**: Português Brasileiro
- **Comentários no código**: Português Brasileiro
- **Mensagens de log**: Português Brasileiro
- **Nomes de variáveis**: Inglês
- **Termos técnicos**: Inglês (OAuth, JWT, etc.)

## System Architecture

Alice employs a microservices architecture, with each service (`frontend`, `auth`, `chat`, `rag`, `training`, `integrations`, `observability`) running in its own container and communicating via an API Gateway (Traefik). The system prioritizes enterprise-grade solutions, data privacy, and scalability.

### UI/UX Decisions
- **Frontend**: Built with React 18, TypeScript 5, Vite 5, shadcn/ui, and Tailwind CSS for a modern and responsive user interface.
- **Internationalization**: Supports PT-BR (primary) and EN using `react-i18next`.
- **Dashboard IA**: Provides metrics for conversations, images, SLA, and circuit breakers.
- **Takeover/Handover Panel**: Custom-built within the Alice dashboard for human agents, integrating Web and WhatsApp interactions.

### Technical Implementations
- **Authentication**: Implements OAuth 2.0 (Google, GitHub, Microsoft) and SAML 2.0 (Azure AD, Okta), with local authentication using bcrypt and a 6-level RBAC system.
- **Real-time Chat**: Utilizes WebSockets for streaming LLM tokens and ensuring real-time interaction.
- **RAG Backend**: Employs pgvector for vector search and self-hosted embeddings via Salad Cloud, with a circuit breaker for robustness. Chunking is configured at 500 characters with 50 overlap.
- **Training**: Manages fine-tuning jobs, collects training data, and uses SemHash for deduplication. Incremental fine-tuning occurs every 4 days using LoRA, with full fine-tuning every two weeks.
- **Image Generation**: Leverages FLUX.1 Schnell (Apache 2.0) self-hosted on Salad Cloud with progressive LoRA for continuous learning from approved images. Image storage uses Object Storage with CLIP embeddings for multimodal RAG.
- **Observability**: A separate, independent microservice (`apps/observability-service/`) provides comprehensive monitoring using Prometheus 3.0, Grafana OSS 11.3, Jaeger 1.62, OpenTelemetry Collector, and Langfuse 2.x for LLM-specific metrics (Token Usage, TTFT, Latency, Error Rate, Cost per Request, RAG Retrieval Time).
- **Pub/Sub**: Initially uses PostgreSQL NOTIFY for real-time updates, with a fallback to `conversation_states` table for persistence.
- **Security**: Implements bcrypt for passwords, HttpOnly/Secure/SameSite cookies, CSRF protection, rate limiting, and `tenant_id` isolation in queries.
- **Code Standards**: Strict TypeScript (`no-any`), Pino for logging (no `console.log`), and mandatory health checks at `/api/servico/health`.

### System Design Choices
- **Microservices Architecture**: Code is organized into `apps/` for microservices and `packages/` for shared code, facilitating independent deployment and scalability.
- **Deployment**: Production deployments are automated via GitHub Actions to Hetzner Cloud.
- **Development Environment**: Replit is used as the IDE and for UI preview, with `server/index-dev.ts` providing preview data (not used in production).
- **TypeScript Build System**: A refined build process using `tsconfig.build.json` and `pnpm workspace` ensures correct build order and Docker compatibility.

## External Dependencies

- **Salad Cloud**:
  - **LLM**: Llama 4 Maverick (400B parameters, 17B active MoE) for text processing (input multimodal, output text only).
  - **Embeddings**: text-embedding-3-small (self-hosted).
  - **Image Generation**: FLUX.1 Schnell (Apache 2.0) self-hosted on RTX 3090/4090 GPUs.
  - **CLIP Inference**: CLIP ViT-L/14 (MIT license) for multimodal embeddings, self-hosted on RTX 3060+ GPUs.
- **PostgreSQL**: Primary database for all persistent data and initial real-time Pub/Sub.
- **Stripe Portugal**: For processing EUR payments and webhooks.
- **Wise**: For global money transfers in 50+ currencies.
- **ERPNext**: Integrated CRM and ERP system.
- **Twilio**: For WhatsApp and SMS communication.
- **Resend**: For transactional email services.
- **Hetzner Cloud**: Production hosting environment.
- **GitHub Actions**: For CI/CD pipelines.
- **Let's Encrypt**: For SSL/TLS certificates.