# Alice - Plataforma Enterprise de IA Autônoma

## Overview

Alice is an autonomous AI enterprise platform, powered by the Llama 4 Maverick (400B parameters) model, hosted on Salad Cloud. Its core purpose is to deliver a fully autonomous AI solution that addresses critical business needs: absolute privacy, predictable costs, and unlimited customization via fine-tuning. The platform aims to eliminate dependencies on external APIs, mitigate privacy concerns with third-party servers, and provide an alternative to unpredictable token-based pricing models.

Key capabilities include real-time chat with streaming, deduplication, multi-tenancy, RBAC, a RAG backend for embeddings and vector search, and integrations with payment systems (Stripe, Wise), CRM (ERPNext), and communication platforms (Twilio, Resend). The platform also incorporates advanced AI features such as image generation (FLUX.1 Schnell), aggressive self-learning, and a robust observability stack. The business vision is to provide an enterprise-grade AI solution that offers unparalleled control and performance, enabling businesses to leverage AI without compromising on data security or cost predictability.

## User Preferences

### 16 Regras Fundamentais

| # | Regra | Descrição |
|---|-------|-----------|
| 1 | **LER ANTES DE AGIR** | Inspecionar arquivos antes de implementar |
| 2 | **NÃO DUPLICAR** | Verificar código existente primeiro |
| 3 | **WORKFLOW ESTRUTURADO** | Diagnóstico → Plano → Aprovação → Implementação |
| 4 | **APROVAÇÃO OBRIGATÓRIA** | Pedir aprovação antes de mudanças grandes |
| 5 | **NÃO MENTIR** | Dizer "não sei" quando não souber |
| 6 | **SEM SOLUÇÕES TEMPORÁRIAS** | **PROIBIDO**: workarounds, mocks, dados hardcoded, in-memory storage, valores default falsos. TODA lógica deve ser enterprise-grade com persistência real em PostgreSQL |
| 7 | **MUDANÇAS CIRÚRGICAS** | Diagnosticar causa raiz antes de agir. Analisar impacto em componentes dependentes. Implementar mudança isolada. |
| 8 | **QUALIDADE OBRIGATÓRIA** | TypeScript strict, zero any, Pino |
| 9 | **VALIDAÇÃO CONTÍNUA** | Testar após cada micro-passo |
| 10 | **DOCUMENTAÇÃO PT-BR** | TODA documentação em português |
| 11 | **SEGUIR DOCS OFICIAIS** | Melhores práticas 2025 |
| 12 | **PRODUÇÃO HETZNER** | Deploy via GitHub Actions |
| 13 | **INTERNACIONALIZAÇÃO** | PT-BR primário, EN secundário |
| 14 | **VERIFICAR SECRETS** | Checar variáveis existentes |
| 15 | **MICROSSERVIÇOS** | Código em apps/, compartilhado em packages/ |
| 16 | **MELHORES PRÁTICAS** | API Gateway, health checks, circuit breakers |

### Preferências de Idioma

| Contexto | Idioma |
|----------|--------|
| Documentação | Português Brasileiro |
| Comentários no código | Português Brasileiro |
| Mensagens de log | Português Brasileiro |
| Nomes de variáveis | Inglês |
| Termos técnicos | Inglês (OAuth, JWT, etc.) |

### Ambiente de Desenvolvimento vs Produção

| Ambiente | Local | Propósito | Regras |
|----------|-------|-----------|--------|
| DESENVOLVIMENTO | Replit | IDE e preview de UI | Dados de preview permitidos APENAS em `server/index-dev.ts` |
| PRODUÇÃO | Hetzner Cloud | Sistema enterprise real | **PROIBIDO** mocks/hardcoded (Regra 6) |

**IMPORTANTE**: Código em `apps/` (microsserviços) vai para produção via GitHub Actions. `server/index-dev.ts` é APENAS para preview no Replit e NÃO é deployado para produção.

## System Architecture

Alice employs a microservices architecture, with services containerized and communicating via an API Gateway (Traefik). The system is designed for enterprise-grade solutions, prioritizing data privacy, scalability, and resilience.

### Microservices

The platform includes several microservices:
-   `frontend`: React Single Page Application.
-   `api-gateway`: Traefik for routing and SSL.
-   `auth`: Handles OAuth/SAML, local authentication, and RBAC.
-   `chat`: Manages LLM interactions, WebSockets, streaming, and persistence.
-   `rag`: Provides embeddings and vector search capabilities.
-   `training`: Manages data collection, deduplication, and fine-tuning.
-   `integrations`: Proxies for external services.
-   `observability`: Monitoring and logging stack.

### UI/UX Decisions

-   **Frontend Stack**: React 18, TypeScript 5, Vite 5, shadcn/ui, Tailwind CSS.
-   **Internationalization**: Primary support for PT-BR, secondary for EN using `react-i18next`.
-   **IA Dashboard**: Features conversation metrics, image displays, SLA, and circuit breaker status.
-   **Takeover/Handover Panel**: Integrated into the Alice dashboard for human agent intervention in Web and WhatsApp interactions.

### Technical Implementations

-   **Authentication**: Supports OAuth 2.0 (Google, GitHub, Microsoft), SAML 2.0 (Azure AD, Okta), bcrypt-based local authentication, and a 6-level RBAC system. Service-to-service authentication uses HMAC-SHA256 for secure internal communication.
-   **Real-time Chat**: Uses WebSockets for streaming LLM tokens, with rate limiting (sliding window + progressive cooldown).
-   **RAG Backend**: Utilizes Salad Cloud for embeddings and pgvector for vector search (500-character chunks, 50 overlap). Implements a circuit breaker (30s timeout, 50% error, 30s reset) for S3 operations.
-   **Image Generation**: Leverages self-hosted FLUX.1 Schnell on Salad Cloud, with approved images contributing to training via Progressive LoRA and multimodal RAG via CLIP embeddings.
-   **Multimodal Embeddings**: Self-hosted CLIP ViT-L/14 on Salad Cloud for 768-dimension cross-modal embeddings.
-   **Takeover/Handover**: Custom panel with automatic triggers based on confidence scores, fallbacks, and sentiment analysis.
-   **CI/CD**: Automated GitHub Actions for Docker image building, pushing, SSH deployment to Hetzner, and health checks.
-   **Code Quality**: Enforces Pino for logging, TypeScript strict mode, and mandatory health checks at `/api/servico/health`.
-   **Build System**: `esbuild` for bundling with topological sort, and 3-stage Dockerfiles (Builder, Pruner, Runner).
-   **Resilience & Performance**: Includes connection pool lifecycle management (`packages/database`), Opossum Circuit Breaker, WebSocket rate limiting, Docker resource limits in production, and sanitization of secrets in logs. CSRF token comparison uses `crypto.timingSafeEqual` for security. AbortController is integrated with `fetchWithAbort` and `createProtectedFetch` for robust timeout handling.

### System Design Choices

-   **Multi-tenant Isolation**: Implemented PostgreSQL Row Level Security (RLS) with tenant_id isolation policies. Migration available in `drizzle/migrations/0001_rls_security_enterprise.sql`.

### Security Hardening (Novembro 2025)

-   **PostgreSQL RLS**: Row Level Security habilitado em todas as tabelas tenant-scoped (users, namespaces, integrations, training_data, etc.). Funções auxiliares `current_tenant_id()` e `is_super_admin()` para políticas de acesso.
-   **PostgreSQL sslmode**: Conexões com sslmode=prefer configuradas em todos os 5 microsserviços Alice que acessam o banco.
-   **Índices tenant_id**: Índices compostos criados para performance em queries multi-tenant.
-   **pgAudit**: Extension habilitada para audit logging de operações DDL e DML.
-   **Docker Non-Root**: Todos os 9 Dockerfiles (8 serviços Alice + CLIP) rodam como usuários non-root com UIDs específicos.
-   **Traefik v3.3**: API Gateway com CAP_NET_BIND_SERVICE, rate limiting via ipStrategy (anti-spoofing), security headers middleware.
-   **Redis ACL**: Autenticação habilitada para Redis cache e queue do ERPNext com comandos perigosos desabilitados (FLUSHALL, FLUSHDB, CONFIG, DEBUG).
-   **GitHub Actions SHA Pinning**: Todas as actions pinadas a commit SHA para supply chain security.
-   **GitHub Actions Permissions**: Least privilege configurado no nível do workflow e em cada job.
-   **CSP Hardening**: Content-Security-Policy sem 'unsafe-eval', apenas 'unsafe-inline' mantido para React hydration.
-   **Compression Middleware**: Todos os 7 microsserviços Node.js usam compression() após helmet() para otimização de banda (Express.js 2025).
-   **Server Timeouts**: Configurados em todos os serviços seguindo Node.js 20 LTS: server.timeout (30s padrão, 60s RAG, 120s chat), keepAliveTimeout (65s), headersTimeout (66s).
-   **ERPNext Fail-Fast**: Defaults inseguros removidos do docker-compose.prod.yml. Credenciais obrigatórias via sintaxe :? que falha se não configuradas.
-   **Frappe v15.74.2**: Versão específica pinada em todos os 9 containers ERPNext para mitigar CVEs críticos (SQL Injection, RCE).
-   **Packages Centralizados**: @alice/logger (Pino com JSON em produção, pino-pretty em dev), @alice/config (validação Zod + sanitização de secrets), @alice/shared (schema Drizzle unificado com tabelas de rastreabilidade).
-   **JSONB TypeSafe (Fase 3 Enterprise)**: Todas as 30+ colunas JSONB tipadas com Zod schemas e `.$type<>()` do Drizzle ORM. Schemas incluem: TenantConfiguracoes, UserPreferencias, NamespaceConfiguracoes, AgentMetricas, LlmConfigAvancada, MessageAnexos, MessageMetadata, ConversationMetadata, LearningTaskParametros, LearningTaskResultado, IntegrationConfiguracao, IntegrationCredenciais, AuditLogDetalhes, TrainingMessages, FineTuningHyperparameters, FineTuningMetrics, WebhookPayload, EscalationTriggerDetails, ModelVersionMetrics, PiiDetails, ContentFlags, ExtractedMetadata, SessionData. Zero `any` em colunas JSONB.
-   **React Suspense (Fase 5 Performance)**: React.lazy() implementado em todas as páginas (Dashboard, Chat, Documents, Training, Integrations, Users, Agents, Settings, WisePayments, Landing, Login, NotFound) com Suspense boundaries e PageLoader fallback.
-   **Express Hardening Module (Fase 6 OWASP)**: Módulo centralizado `packages/shared-utils/src/express-hardening.ts` aplicado em TODOS os 7 microsserviços (auth, chat, integrations, rag, training, api-gateway, observability). Inclui: (1) `createSecurityMiddleware` com Helmet 8.x, CSP strict em produção (sem unsafe-inline para scripts), HSTS preload, X-Frame-Options deny; (2) `createRateLimiter` multi-tenant com ipKeyGenerator para IPv6 subnet handling (express-rate-limit 8.2.1 com standardHeaders: 'draft-8' IETF), leitura de tenant via header x-tenant-id antes do auth middleware; (3) `createErrorHandler` global que nunca vaza stack traces em produção (verificação estrita de NODE_ENV); (4) `createNotFoundHandler` com identificação de serviço; (5) `asyncHandler` wrapper para rotas async. Middleware ordering padronizado: helmet → correlation → compression → cors → rateLimit → body parsers → routes → notFound → errorHandler.
-   **Zod Input Validation (OWASP API3)**: Schemas Zod aplicados em rotas críticas de autenticação (register, login) com validação de email, senha forte (min 8 chars, maiúscula, minúscula, número), limites de tamanho, e normalização automática (lowercase, trim). Middleware `validateLogin` executa antes do passport.authenticate para bloquear payloads malformados.

## External Dependencies

### Salad Cloud

-   **LLM**: Llama 4 Maverick (400B params).
-   **Embeddings**: text-embedding-3-small.
-   **Image Generation**: FLUX.1 Schnell (Apache 2.0).
-   **CLIP Inference**: CLIP ViT-L/14 (MIT).

### Integrations

-   **Payments - Stripe**: Integração NATIVA do ERPNext (módulo Stripe payments). Alice usa ERPNext para efetuar vendas e tudo fica registrado no ERPNext como sistema central. Não existe dashboard Stripe na Alice. Fluxo completo: checkout.session.completed → Sales Order → Invoice → Payment Entry com rastreabilidade via tabela `stripe_erpnext_mapping` (state machine: pending → order_created → invoice_created → complete).
-   **Payments - Wise**: Dashboard Admin na Alice (`client/src/pages/WisePayments.tsx`) para gerenciar pagamentos globais. Sincronização automática com ERPNext via `wiseSyncService.ts` para manter controle centralizado de todas as transferências. Webhook com validação HMAC via timingSafeEqual.
-   **CRM/ERP**: ERPNext (via `frappe_docker`) - Sistema central e absoluto onde TUDO fica registrado (vendas Stripe, pagamentos Wise, clientes, pedidos).
-   **Communication**: Twilio (WhatsApp, SMS), Resend (transactional emails).
-   **Database**: PostgreSQL with pgvector extension. Tabelas de rastreabilidade: `webhook_events` (idempotência), `stripe_erpnext_mapping` (mapeamento Stripe→ERPNext), `wise_sync_log` (auditoria Wise→ERPNext).
-   **Observability**: Prometheus 3.0, Grafana OSS 11.3, Jaeger 1.62, OpenTelemetry Collector, Langfuse 2.x.
-   **API Gateway**: Traefik v3.3 com security headers middleware e rate limiting.
-   **CI/CD**: GitHub Actions com SHA pinning para supply chain security e OIDC/GITHUB_TOKEN para GHCR.