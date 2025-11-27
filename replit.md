# Alice - Plataforma Enterprise de IA Autônoma

## Overview

Alice is a production-ready, autonomous enterprise AI platform powered by a self-hosted Llama 4 Maverick (400B parameters) model on Salad Cloud. It offers full autonomy, absolute data privacy, predictable costs, and unlimited customization through fine-tuning. Alice addresses issues of third-party dependency, data privacy concerns, and unpredictable token-based pricing. Key capabilities include real-time chat, deduplication, multi-tenancy, RBAC, RAG backend, and integrations with payment, CRM, and communication services. The platform is designed for verticalized use cases, featuring aggressive auto-learning, multimodal RAG, and a comprehensive observability stack. The business vision is to provide a secure, cost-effective, and highly customizable AI solution for enterprises.

## User Preferences

- **Workflow Estruturado**: Diagnóstico → Plano → Aprovação → Implementação.
- **Aprovação Obrigatória**: Pedir aprovação antes de fazer mudanças grandes.
- **Não Mentir**: Dizer "não sei" quando não souber.
- **Sem Soluções Temporárias**: **PROIBIDO**: workarounds, mocks, dados hardcoded, in-memory storage, valores default falsos. TODA lógica deve ser enterprise-grade com persistência real em PostgreSQL.
- **Mínimas Mudanças**: Foco cirúrgico no problema.
- **Qualidade Obrigatória**: Usar TypeScript strict, zero `any`, e Pino para logging.
- **Validação Contínua**: Testar após cada micro-passo.
- **Documentação PT-BR**: Toda a documentação e comentários de código devem ser em português brasileiro. Mensagens de log em português brasileiro.
- **Seguir Docs Oficiais**: Implementar as melhores práticas de 2025.
- **Produção Hetzner**: Deploy via GitHub Actions.
- **Internacionalização**: PT-BR primário, EN secundário.
- **Verificar Secrets**: Checar variáveis de ambiente existentes.
- **Microsserviços**: Código em `apps/`, compartilhado em `packages/`.
- **Melhores Práticas**: Implementar API Gateway, health checks, circuit breakers.
- **Não Duplicar**: Verificar código existente antes de implementar novas funcionalidades.
- **LER ANTES DE AGIR**: Inspecionar arquivos antes de implementar.
- **Variáveis e Termos Técnicos**: Nomes de variáveis em inglês; termos técnicos (OAuth, JWT, etc.) em inglês.
- **Pino para Logging**: Usar Pino para logging; `console.log` é PROIBIDO.
- **TypeScript Strict**: Modo strict; `any` é PROIBIDO.
- **Health Check**: Obrigatório em `/api/servico/health`.
- **Replit Dev Environment**: Dados de preview permitidos em `server/index-dev.ts` APENAS para o ambiente de desenvolvimento Replit, que NÃO vai para produção.

## System Architecture

The system is built as a collection of microservices using TypeScript, NodeJS, and React.

**UI/UX Decisions:**
- Frontend: React 18, TypeScript 5, Vite 5.
- Styling: shadcn/ui + Tailwind CSS.
- Internationalization: `react-i18next` for PT-BR/EN.

**Technical Implementations & System Design:**
- **Core AI Model**: Llama 4 Maverick (400B params, 17B active MoE) hosted on Salad Cloud, providing multimodal input (text, image, video) and text-only output. Context window of 1M tokens.
- **Observability**: Dedicated microservice (`apps/observability-service/`) for monitoring, ensuring independence. Stack includes Prometheus 3.0 (metrics), Grafana OSS 11.3 (dashboards), Jaeger 1.62 (tracing), OpenTelemetry Collector (instrumentation), and Langfuse 2.x (LLM metrics).
- **Scheduled Learning**: Real-time RAG updates, daily auto-indexing, incremental fine-tuning every 4 days (LoRA), and full fine-tuning bi-weekly.
- **Real-time Pub/Sub**: Utilizes PostgreSQL NOTIFY for simplicity and initial scalability, with a `conversation_states` table as a fallback. Future migration to Redis if message rates exceed 1k msg/s.
- **Image Generation**: Employs FLUX.1 Schnell (Apache 2.0) self-hosted on Salad Cloud with RTX 3090/4090 GPUs. Progressive LoRA for continuous learning from approved images. Storage uses object storage with CLIP embeddings for multimodal RAG.
- **Multimodal RAG**:
    - Image Uploads: CLIP embeddings (768 dim) via `SALAD_CLIP_ENDPOINT`.
    - Audio Uploads: Whisper + text embeddings (1536 dim) via `SALAD_WHISPER_ENDPOINT`.
    - Search: Cosine similarity for image-to-image and text-to-image searches.
    - Storage: Local + S3 compatible, multi-tenant with `tenant_id`.
- **Takeover/Handover**: Custom panel integrated into the dashboard, replacing expensive third-party solutions. Automated triggers based on confidence scores, fallback counts, and sentiment analysis.
- **API Gateway**: Traefik handles routing and SSL.
- **Authentication**: OAuth 2.0 (Google, GitHub, Microsoft) and SAML 2.0 (Azure AD, Okta), local authentication with bcrypt, and RBAC with 6 defined roles.
- **Chat Service**: WebSocket for real-time communication, proxies to Salad Cloud, streams tokens, and persists messages.
- **RAG Service**: Embeddings via Salad Cloud, `pgvector` for vector search, chunking (500 chars, 50 overlap), and a circuit breaker (30s/50%/30s).
- **Training Service**: Collects training data, uses SemHash for deduplication, and manages fine-tuning jobs.
- **Security**: bcrypt for passwords, HttpOnly/Secure/SameSite cookies, CSRF protection via OAuth state parameter, rate limiting per IP/endpoint, and `tenant_id` for data isolation.
- **CI/CD**: GitHub Actions pipeline for building Docker images, pushing to GHCR, SSH deployment to Hetzner, and health checks.
- **Development Environment**: Replit for IDE, debugging, local testing, and Git operations.
- **Production Infrastructure**: Hetzner Cloud (CX43 instance) with 8 vCPUs, 16GB RAM, 160GB SSD.

## External Dependencies

- **Salad Cloud**:
    - **LLM**: Hosts Llama 4 Maverick (400B parameters) for core AI model.
    - **Image Generation**: Hosts FLUX.1 Schnell model.
    - **CLIP Inference**: Hosts CLIP ViT-L/14 for multimodal embeddings (text and image).
    - **Embeddings**: Provides `text-embedding-3-small` for RAG.
    - **Whisper**: Provides endpoint for audio transcription.
- **PostgreSQL**: Primary database for data persistence and Pub/Sub mechanism (NOTIFY).
- **Stripe Portugal**: Payment gateway for EUR payments via SEPA, with webhooks for checkout and payment events.
- **Wise**: Service for global money transfers in 50+ currencies.
- **ERPNext**: Integrated CRM and ERP system.
- **Twilio**: Used for WhatsApp and SMS communication.
- **Resend**: Transactional email service.
- **Prometheus 3.0**: Open-source monitoring system for metrics collection.
- **Grafana OSS 11.3**: Open-source platform for data visualization and dashboards.
- **Jaeger 1.62**: Distributed tracing system.
- **OpenTelemetry Collector**: Vendor-agnostic instrumentation for telemetry data.
- **Langfuse 2.x**: Open-source platform for LLM specific metrics.
- **GitHub Actions**: CI/CD pipeline for automated builds and deployments.