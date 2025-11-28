# Alice - Plataforma Enterprise de IA Autônoma

## Overview

Alice is an autonomous AI enterprise platform, powered by the Llama 4 Maverick (400B parameters) model hosted on Salad Cloud. Its main purpose is to provide a fully autonomous AI solution that addresses critical business challenges such as absolute privacy, predictable costs, and unlimited customization through fine-tuning. The platform aims to eliminate dependencies on external APIs, privacy concerns with third-party servers, and unpredictable token-based pricing.

Key capabilities include real-time chat with streaming, deduplication, multi-tenancy, RBAC, RAG backend for embeddings and vector search, and integrations with payment systems (Stripe, Wise), CRM (ERPNext), and communication platforms (Twilio, Resend). Advanced AI features like image generation (FLUX.1 Schnell), aggressive self-learning, and a robust observability stack are also integrated.

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

Alice utilizes a microservices architecture, with each service running in its own container and communicating via an API Gateway (Traefik). The system prioritizes enterprise-grade solutions, data privacy, and scalability.

### Microservices

The platform is composed of several microservices, including:
- `frontend` (React SPA)
- `api-gateway` (Traefik)
- `auth` (OAuth/SAML, local auth, RBAC)
- `chat` (LLM, WebSocket, streaming, persistence)
- `rag` (Embeddings, vector search)
- `training` (Data collection, deduplication, fine-tuning)
- `integrations` (Proxies for external services)
- `observability` (Monitoring stack)

### UI/UX Decisions

-   **Frontend**: Built with React 18, TypeScript 5, Vite 5, shadcn/ui, and Tailwind CSS.
-   **Internationalization**: Supports PT-BR (primary) and EN using `react-i18next`.
-   **IA Dashboard**: Displays conversation metrics, images, SLA, and circuit breakers.
-   **Takeover/Handover Panel**: Integrated within the Alice dashboard for human agents, managing Web and WhatsApp interactions.

### Technical Implementations

-   **Authentication**: OAuth 2.0 (Google, GitHub, Microsoft), SAML 2.0 (Azure AD, Okta), local authentication with bcrypt, and a 6-level RBAC system.
-   **Real-time Chat**: Uses WebSockets for streaming LLM tokens.
-   **RAG Backend**: Leverages Salad Cloud for embeddings and pgvector for vector search, with chunking of 500 characters and 50 overlap. Implements a circuit breaker with 30s timeout, 50% error threshold, and 30s reset.
-   **Image Generation**: Utilizes self-hosted FLUX.1 Schnell (Apache 2.0) on Salad Cloud, with approved images contributing to training via Progressive LoRA and multimodal RAG via CLIP embeddings.
-   **Multimodal Embeddings**: Uses self-hosted CLIP ViT-L/14 (MIT license) on Salad Cloud for 768-dimension cross-modal embeddings.
-   **Takeover/Handover**: Custom panel with automatic triggers based on confidence scores, fallbacks, and sentiment analysis.
-   **CI/CD**: Automated GitHub Actions pipeline for building, pushing Docker images, SSH deployment to Hetzner, and health checks.
-   **Code Quality**: Enforces Pino for logging (no `console.log`), TypeScript strict mode (no `any`), and mandatory health checks at `/api/servico/health` for all services.
-   **Build System**: Utilizes `esbuild` bundling with topological sort for package building, and 3-stage Dockerfiles (Builder, Pruner, Runner) for efficient and deterministic builds.
-   **Resilience & Performance**: Implements connection pool lifecycle management (`packages/database`), Opossum Circuit Breaker for S3 operations (`apps/rag-service`), WebSocket rate limiting (`apps/chat-service`), Docker resource limits in production, and sanitization of secrets in logs.

## External Dependencies

### Salad Cloud

-   **LLM**: Llama 4 Maverick (400B params) for core AI capabilities.
-   **Embeddings**: text-embedding-3-small for RAG.
-   **Image Generation**: FLUX.1 Schnell (Apache 2.0).
-   **CLIP Inference**: CLIP ViT-L/14 (MIT) for multimodal embeddings.

### Integrations

-   **Payments**: Stripe Portugal (EUR via SEPA) and Wise (global transfers).
-   **CRM/ERP**: ERPNext (using `frappe_docker`).
-   **Communication**: Twilio (WhatsApp, SMS) and Resend (transactional emails).
-   **Database**: PostgreSQL with pgvector extension.
-   **Observability**: Prometheus 3.0, Grafana OSS 11.3, Jaeger 1.62, OpenTelemetry Collector, Langfuse 2.x.
-   **API Gateway**: Traefik for routing and SSL termination.
-   **CI/CD**: GitHub Actions.

---

## FASE 3 - Resiliência e Performance (28/11/2024)

### Implementações Concluídas

| Componente | Arquivo | Descrição |
|------------|---------|-----------|
| **Connection Pool Lifecycle** | `packages/database/src/index.ts` | Métricas de pool, graceful shutdown, health check |
| **Circuit Breaker S3** | `apps/rag-service/src/storage.ts` | Opossum CB para operações S3/MinIO |
| **WebSocket Rate Limiting** | `apps/chat-service/src/index.ts` | Sliding window + cooldown progressivo |
| **Docker Resource Limits** | `infra/docker/docker-compose.prod.yml` | Memory + CPU limits para todos os serviços |
| **Config Secrets Sanitization** | `packages/config/src/index.ts` | Redact de secrets nos logs |

### Connection Pool (packages/database)

```typescript
getPoolMetrics(): PoolMetrics           // Métricas em tempo real
isPoolHealthy(): Promise<boolean>       // Health check async
setupGracefulShutdown(logger?)          // SIGTERM/SIGINT handlers
```

### Circuit Breaker S3 (apps/rag-service)

- Timeout: 30s
- Error Threshold: 50%
- Reset Timeout: 30s
- Status: `getS3CircuitBreakerStatus()`

### WebSocket Rate Limiting (Sliding Window + Cooldown)

- Limite base: 60 mensagens por 60 segundos (sliding window real)
- Block Duration: 60 segundos
- Cooldown Progressivo: Após bloqueio, limite reduzido por fator 2x, 4x (máximo)
- Cooldown Decay: 5 minutos de bom comportamento reduz penalidade pela metade
- Response: `{ type: 'rate_limited', retryAfter: number }`

### Docker Resource Limits (Produção) - Atualizado 28/11/2025

Baseado em documentações oficiais 2025: PostgreSQL 17, MariaDB 10.11, Redis 7.4, Node.js 20 LTS, Traefik v3.1

**Servidor: Hetzner CX43 (8 vCPU, 16GB RAM)**

#### Alice Platform (7 serviços)

| Serviço | Memory Limit | CPU Limit | Memory Res | CPU Res | Docs 2025 |
|---------|--------------|-----------|------------|---------|-----------|
| postgres | 3G | 1.5 | 1G | 0.5 | PostgreSQL 17 + shm_size: 1g |
| alice-chat | 1G | 1.0 | 256M | 0.25 | Node.js 20 + WebSocket |
| alice-rag | 1G | 1.0 | 256M | 0.25 | Node.js 20 + pgvector |
| alice-training | 768M | 0.75 | 256M | 0.25 | Node.js 20 standard |
| alice-auth | 512M | 0.5 | 128M | 0.25 | Node.js 20 light |
| alice-integrations | 512M | 0.5 | 128M | 0.25 | Node.js 20 light |
| alice-frontend | 256M | 0.25 | 64M | 0.1 | Nginx static |

#### ERPNext Stack (10 serviços)

| Serviço | Memory Limit | CPU Limit | Memory Res | CPU Res | Docs 2025 |
|---------|--------------|-----------|------------|---------|-----------|
| erpnext-mariadb | 2G | 1.5 | 512M | 0.5 | MariaDB 10.11 + innodb_buffer_pool=1.4G |
| erpnext-backend | 2G | 1.5 | 512M | 0.5 | Frappe/Gunicorn |
| erpnext-redis-cache | 256M | 0.3 | 64M | 0.1 | Redis 7.4 + maxmemory=200mb |
| erpnext-redis-queue | 256M | 0.3 | 64M | 0.1 | Redis 7.4 + maxmemory=200mb |
| erpnext-frontend | 256M | 0.25 | 64M | 0.1 | Nginx static |
| erpnext-websocket | 256M | 0.3 | 64M | 0.1 | Node.js Socket.io |
| erpnext-scheduler | 512M | 0.3 | 128M | 0.1 | Python scheduler |
| erpnext-worker-short | 512M | 0.4 | 128M | 0.1 | Python worker |
| erpnext-worker-default | 512M | 0.4 | 128M | 0.1 | Python worker |
| erpnext-worker-long | 1G | 0.75 | 256M | 0.25 | Python heavy tasks |

#### Infraestrutura (3 serviços)

| Serviço | Memory Limit | CPU Limit | Memory Res | CPU Res | Docs 2025 |
|---------|--------------|-----------|------------|---------|-----------|
| traefik | 512M | 0.5 | 256M | 0.25 | Traefik v3.1 |
| dockerproxy | 64M | 0.1 | 32M | 0.05 | Minimal proxy |
| vector | 256M | 0.25 | 64M | 0.1 | Log collector |

#### Totais Calculados

| Recurso | Limits Total | Reservations Total | Servidor | Status |
|---------|--------------|--------------------|---------:|--------|
| **CPU** | ~11.35 vCPU | ~4.35 vCPU | 8 vCPU | Reservas OK, bursts permitidos |
| **Memory** | ~15.3 GB | ~4.3 GB | 16 GB | Dentro do limite |

### Config Secrets Sanitization

Secrets automaticamente redactados nos logs:
- SESSION_SECRET, DATABASE_URL, SALAD_API_KEY
- *_CLIENT_SECRET, *_WEBHOOK_SECRET, *_API_KEY
- Padrões: password, secret, token

---

*Documento em Português Brasileiro*
*Versão 5.7 - Novembro 2025*