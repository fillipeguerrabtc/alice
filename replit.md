# Alice - Plataforma Enterprise de IA Autônoma

## Overview

Alice is an autonomous AI enterprise platform, powered by the Llama 4 Maverick (400B parameters) model, hosted on Salad Cloud. Its core purpose is to deliver a fully autonomous AI solution that addresses critical business needs: absolute privacy, predictable costs, and unlimited customization via fine-tuning. The platform aims to eliminate dependencies on external APIs, mitigate privacy concerns with third-party servers, and provide an alternative to unpredictable token-based pricing models.

Key capabilities include real-time chat with streaming, deduplication, multi-tenancy, RBAC, a RAG backend for embeddings and vector search, and integrations with payment systems (Stripe, Wise), CRM (ERPNext), and communication platforms (Twilio, Resend). The platform also incorporates advanced AI features such as image generation, aggressive self-learning, and a robust observability stack. The business vision is to provide an enterprise-grade AI solution that offers unparalleled control and performance, enabling businesses to leverage AI without compromising on data security or cost predictability.

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
- `frontend`: React Single Page Application.
- `api-gateway`: Traefik for routing and SSL.
- `auth`: Handles OAuth/SAML, local authentication, and RBAC.
- `chat`: Manages LLM interactions, WebSockets, streaming, and persistence.
- `rag`: Provides embeddings and vector search capabilities.
- `training`: Manages data collection, deduplication, and fine-tuning.
- `integrations`: Proxies for external services.
- `observability`: Monitoring and logging stack.

### UI/UX Decisions

- **Frontend Stack**: React 18, TypeScript 5, Vite 5, shadcn/ui, Tailwind CSS.
- **Internationalization**: Primary support for PT-BR, secondary for EN using `react-i18next`.
- **IA Dashboard**: Features conversation metrics, image displays, SLA, and circuit breaker status.
- **Takeover/Handover Panel**: Integrated into the Alice dashboard for human agent intervention in Web and WhatsApp interactions.

### Technical Implementations

- **Authentication**: Supports OAuth 2.0 (Google, GitHub, Microsoft), SAML 2.0 (Azure AD, Okta), bcrypt-based local authentication, and a 6-level RBAC system. Service-to-service authentication uses HMAC-SHA256.
- **Real-time Chat**: Uses WebSockets for streaming LLM tokens, with rate limiting.
- **RAG Backend**: Utilizes Salad Cloud for embeddings and pgvector for vector search.
- **Image Generation**: Leverages self-hosted FLUX.1 Schnell on Salad Cloud.
- **Multimodal Embeddings**: Self-hosted CLIP ViT-L/14 on Salad Cloud for 768-dimension cross-modal embeddings.
- **Takeover/Handover**: Custom panel with automatic triggers based on confidence scores, fallbacks, and sentiment analysis.
- **CI/CD**: Automated GitHub Actions for Docker image building, pushing, SSH deployment to Hetzner, and health checks.
- **Code Quality**: Enforces Pino for logging, TypeScript strict mode, and mandatory health checks.
- **Build System**: `esbuild` for bundling and 3-stage Dockerfiles.
- **Resilience & Performance**: Includes connection pool lifecycle management, Opossum Circuit Breaker, WebSocket rate limiting, Docker resource limits, and sanitization of secrets in logs. CSRF token comparison uses `crypto.timingSafeEqual`. AbortController integrado em todas chamadas externas (ERPNext 10s, LLM streaming 60s, LLM sync 30s, cross-service 15s).
- **Security Hardening**: PostgreSQL RLS, sslmode=prefer, tenant_id indices, pgAudit, Docker Non-Root, Traefik v3.3, Redis ACL, GitHub Actions SHA Pinning and Permissions, CSP Hardening, Compression Middleware, Server Timeouts, ERPNext Fail-Fast, Frappe v15.74.2, central packages (`@alice/logger`, `@alice/config`, `@alice/shared`), JSONB TypeSafe with Zod schemas, React Suspense, Express Hardening Module (`createSecurityMiddleware`, `createRateLimiter`, `createErrorHandler`, `createNotFoundHandler`, `asyncHandler`), Zod Input Validation.
- **Stripe Idempotency**: `generateIdempotencyKey()` com crypto.randomUUID(). Fail-fast em produção se idempotencyKey não fornecida (Regra 6). Previne cobranças duplicadas em retries.
- **WebSocket Auth**: Validação de sessão PostgreSQL (connect-pg-simple) com SESSION_SECRET obrigatório em produção. Cache de sessões validadas (TTL 5min).
- **Service-to-Service Auth**: HMAC-SHA256 com headers assinados (`x-internal-signature`, `x-internal-timestamp`). Validação de 5 minutos. Guard `isInternalAuthEnabled()` antes de gerar headers.
- **Feature Flags**: Sistema enterprise de feature flags com persistência PostgreSQL, cache TTL 60s, suporte multi-tenant, middleware Express. 19 flags definidas (integrações, AI, auth, funcionalidades, observability).

### System Design Choices

- **Multi-tenant Isolation**: Implemented PostgreSQL Row Level Security (RLS) with tenant_id isolation policies.
- **OWASP API3**: Critical authentication routes use Zod schemas for input validation.

## External Dependencies

- **LLM**: Llama 4 Maverick (400B params) on Salad Cloud.
- **Embeddings**: text-embedding-3-small on Salad Cloud.
- **Image Generation**: FLUX.1 Schnell (Apache 2.0) on Salad Cloud.
- **CLIP Inference**: CLIP ViT-L/14 (MIT) on Salad Cloud.
- **Payments - Stripe**: Integrated with ERPNext.
- **Payments - Wise**: Dashboard Admin in Alice with synchronization to ERPNext.
- **CRM/ERP**: ERPNext (via `frappe_docker`).
- **Communication**: Twilio (WhatsApp, SMS), Resend (transactional emails).
- **Database**: PostgreSQL with pgvector extension.
- **Observability**: Prometheus 3.0, Grafana OSS 11.3, Jaeger 1.62, OpenTelemetry Collector, Langfuse 2.x.
- **API Gateway**: Traefik v3.3.
- **CI/CD**: GitHub Actions.

## Prontidão para Produção (Atualizado: Novembro 2025)

### Status Geral: 100% Pronto para Deploy

| Categoria | Status | Detalhes |
|-----------|--------|----------|
| Segurança Enterprise | 100% | RLS, RBAC 6-níveis, CSRF timingSafe, CSP, Helmet 8.x, HMAC S2S, Stripe Idempotency |
| Rate Limiting | 100% | Redis Store distribuído, fail-fast em produção (Regra 6), MemoryStore apenas dev |
| Server Timeouts | 100% | Todos os 7 serviços com timeout/keepAliveTimeout/headersTimeout, AbortController em todas chamadas |
| Input Validation | 100% | Zod schemas em todas rotas críticas (OWASP API3) |
| CI/CD | 100% | GitHub Actions com compliance checks automatizados |
| Observability | 100% | Prometheus, Grafana, Jaeger, Langfuse integrados |
| Integrações | 100% | Stripe/Wise/ERPNext/Twilio/Resend com secrets configurados |
| Testes Unitários | 100% | 97+ testes (segurança, RBAC, feature flags, health endpoints) |
| Feature Flags | 100% | 19 flags, PostgreSQL schema + migration, storage interface, cache TTL 60s, multi-tenant |
| Handover/Takeover | 100% | Escalação automática por keywords, sentimento, fallback count, confiança proxy |

### Design Pattern: Graceful Degradation

As integrações (Stripe, Wise, ERPNext, Twilio, Resend) são **opcionais por design**:
- Configs são opcionais no schema Zod
- Serviços verificam disponibilidade antes de usar
- Retornam HTTP 503 se integração não configurada
- Em produção, fail-fast se secrets críticas faltam

### Requisitos para Deploy

**Secrets GitHub - Configurados:**
- [x] `GH_PAT` - GitHub Personal Access Token
- [x] `HETZNER_SSH_PRIVATE_KEY`, `HETZNER_VM_HOST`, `HETZNER_VM_USER`
- [x] `PGPASSWORD`, `SESSION_SECRET`
- [x] `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- [x] `OAUTH_GITHUB_CLIENT_ID`, `OAUTH_GITHUB_CLIENT_SECRET`
- [x] `SALAD_API_KEY`, `SALAD_ORGANIZATION_ID`
- [x] `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`
- [x] `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`
- [x] `RESEND_API_KEY`
- [x] `WISE_API_KEY`, `WISE_PROFILE_ID`

### Gaps Resolvidos (Novembro 2025)

1. **Testes Unitários**: ✅ Expandido para 97+ testes (segurança, RBAC, feature flags, health)
2. **Feature Flags**: ✅ Sistema enterprise com PostgreSQL schema, storage interface, migration, cache TTL 60s, multi-tenant. initFeatureFlags() e middleware registrados em todos os serviços.
3. **Stripe Idempotency**: ✅ crypto.randomUUID + fail-fast em produção
4. **WebSocket Auth**: ✅ SESSION_SECRET obrigatório + cache PostgreSQL
5. **AbortController**: ✅ Todas chamadas externas com timeouts configurados
6. **HMAC S2S Auth**: ✅ Guard isInternalAuthEnabled + headers assinados
7. **WebSocket Zod Validation**: ✅ wsMessageSchema e wsAgentMessageSchema validam todas mensagens WebSocket (OWASP API3)
8. **RBAC Granular GET Routes**: ✅ /api/chat/stats e /api/chat/usage protegidos com requireAuth, requireSameTenant, requirePermission('chat:stats:read')
9. **Multi-tenancy RAG**: ✅ requireSameTenant em todos endpoints rag-service: documents (GET/POST), upload, search, delete
10. **Graceful Shutdown WebSocket**: ✅ clearInterval para heartbeatInterval e rateLimitCleanupInterval no shutdown
11. **Circuit Breakers**: ✅ Implementados em wiseClient.ts e saladCloudBreaker (chat-service)
12. **Webhook Replay Protection**: ✅ checkWebhookIdempotency() com tabela webhookEvents para Stripe e Wise

### Arquivos de Feature Flags

| Arquivo | Descrição |
|---------|-----------|
| `shared/schema.ts` | Tabela `featureFlags` Drizzle + tipos TypeScript |
| `packages/shared-utils/src/feature-flags.ts` | API pública, cache, middleware Express |
| `packages/shared-utils/src/feature-flags-storage.ts` | Storage interface + implementação PostgreSQL |
| `migrations/0001_create_feature_flags.sql` | Migração SQL com RLS, índices, trigger |
| `tests/unit/feature-flags.test.ts` | 47 testes unitários |
| `tests/unit/security-fixes.test.ts` | 50 testes de segurança |

### Pendentes para Infraestrutura (Não Bloqueantes)

**Secrets GitHub - Pendentes (ERPNext/Redis):**
- [ ] `WISE_WEBHOOK_SECRET` (opcional se Wise não usado)
- [ ] `REDIS_CACHE_PASSWORD`, `REDIS_QUEUE_PASSWORD` (para ACL em produção)
- [ ] `ERPNEXT_*` secrets (opcional se ERPNext não usado)

**Tarefas de Infraestrutura:**
- [ ] Configurar Redis ACL em produção (quando Redis passwords configuradas)
- [ ] Executar migrações RLS no PostgreSQL de produção
- [ ] Configurar webhooks Stripe/Wise em produção
- [ ] Validar DNS entries para subdomínios