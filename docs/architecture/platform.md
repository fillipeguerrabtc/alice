# Alice Enterprise Platform - Arquitetura de Software

> **Autor:** Fillipe Guerra  
> **Data:** 11 de Março de 2026  
> **Versão:** 3.9.316 - Correção de deploy (ordem do find com -ignore_readdir_race) + hardening pós-plano  
> **Framework:** arc42 + C4 Model + ADRs  
> **Idioma:** Português Brasileiro (termos técnicos em inglês)
> 
> **Notas de atualização:** detalhes de CI/CD, Smart Deploy e troubleshooting ficam em `docs/operations/deployment.md` (SSOT). Hardening de DR/restore (offsite criptografado + readiness checks) fica em `docs/operations/runbooks/dr-game-day.md` e `apps/observability-service/src/backup-orchestrator.ts`.
> **Fonte canônica de execução do backlog:** `docs/archive/plans/codex-enterprise-execution.md`.

### Atualizações e precedência documental (11/03/2026)

- Este documento é normativo para arquitetura e decisões técnicas vigentes (arc42 + C4 + ADRs).
- O histórico de execução por rodada é mantido exclusivamente em `docs/archive/plans/codex-enterprise-execution.md`.
- O snapshot operacional consolidado permanece em `docs/status/current-platform-status.md`.
- Em caso de divergência entre relatório histórico e documento normativo, prevalecem os SSOT acima e o tracking canônico.

## Sumário

1. [Introdução e Objetivos](#1-introdução-e-objetivos)
2. [Restrições Arquiteturais](#2-restrições-arquiteturais)
3. [Contexto do Sistema (C4 Level 1)](#3-contexto-do-sistema-c4-level-1)
4. [Containers (C4 Level 2)](#4-containers-c4-level-2)
5. [Componentes (C4 Level 3)](#5-componentes-c4-level-3)
6. [Visão de Runtime](#6-visão-de-runtime)
7. [Visão de Deployment](#7-visão-de-deployment)
8. [Conceitos Transversais](#8-conceitos-transversais)
9. [Decisões Arquiteturais (ADRs)](#9-decisões-arquiteturais-adrs)
10. [Aderência às 18 Regras](#10-aderência-às-18-regras)
11. [12-Factor App Compliance](#11-12-factor-app-compliance)
12. [Riscos e Dívida Técnica](#12-riscos-e-dívida-técnica)
13. [Glossário](#13-glossário)

---

## 1. Introdução e Objetivos

### 1.1 Visão do Produto

**Alice** é uma plataforma enterprise de IA autônoma 100% self-hosted, projetada para organizações que exigem:

- **Privacidade Total**: Dados nunca saem da infraestrutura própria
- **Autonomia**: LLM próprio (Qwen3 8B AWQ) com Vision e geração de imagens via OpenAI - **Gate 2 (LLM local + OpenAI Vision)**
- **Customização**: Fine-tuning específico via QLoRA para cada domínio (especializado em finanças/matemática)
- **Custo Previsível**: LLM local sem cobrança por token; Vision/Imagens via OpenAI
- **Compliance**: LGPD, GDPR, SOC 2 ready
- **Agentic Web**: Busca web (texto e imagens) via SearXNG com integração direta no chat

### 1.2 Objetivos de Qualidade

| Prioridade | Objetivo | Métrica | Meta |
|------------|----------|---------|------|
| 1 | **Disponibilidade** | Uptime | 99.9% |
| 2 | **Segurança** | OWASP Top 10 | 10/10 mitigados |
| 3 | **Performance** | P95 Latency (chat) | < 2s |
| 4 | **Escalabilidade** | Concurrent Users | 1000+ |
| 5 | **Manutenibilidade** | Code Coverage | > 80% |

### 1.3 Stakeholders

| Stakeholder | Responsabilidade | Expectativa |
|-------------|------------------|-------------|
| Product Owner | Direção do produto | ROI, features |
| Arquiteto | Decisões técnicas | Qualidade, escalabilidade |
| Desenvolvedores | Implementação | Clareza, padrões |
| DevOps | Operações | Observabilidade, automação |
| Segurança | Compliance | Zero vulnerabilidades |
| Usuários Finais | Consumo | UX, velocidade |

> Atualização 21/12/2025: CI ajustado para evitar execuções duplicadas (push restrito ao `main` + PR em `main`) e correção de tipos do frontend (SignalApprovalPanel) garantindo build do Release.

---

## 2. Restrições Arquiteturais

### 2.1 Restrições Técnicas

#### Padrões de Repositório (Line Endings e EditorConfig)

- **Line endings determinísticos (2025)**: o repositório usa **LF** como padrão para arquivos de texto, com exceção de scripts Windows (`.bat/.cmd/.ps1`) que usam **CRLF**.
- **Fonte de verdade**: `.gitattributes` (Git) + `.editorconfig` (editores/IDE).
- **Objetivo**: eliminar diffs ruidosos e garantir builds/reviews determinísticos em Windows/Linux/macOS.

| Restrição | Descrição | Justificativa |
|-----------|-----------|---------------|
| **Node.js 22 LTS** | Runtime backend obrigatório | Performance, suporte long-term |
| **PostgreSQL 16** | Banco principal com pgvector | Embeddings vetoriais, RLS |
| **TypeScript strict** | Zero `any` permitido | Regra 8 CLAUDE.md |
| **Docker Compose** | Orquestração de containers | Simplicidade, portabilidade |
| **pnpm** | Package manager | Monorepo, deduplicação |

### 2.2 Restrições Organizacionais

| Restrição | Descrição | Impacto |
|-----------|-----------|---------|
| **100% Self-hosted** | Sem dependência de SaaS externos para core | Autonomia total |
| **Documentação PT-BR** | Regra 10 CLAUDE.md | Acessibilidade |
| **Zero Mocks em Produção** | Regra 6 CLAUDE.md | Qualidade enterprise |
| **Commits Consolidados** | Regra 18 CLAUDE.md | Histórico limpo |

### 2.3 Convenções

```
alice/
├── apps/                    # Microsserviços (Regra 15)
│   ├── auth-service/        # Autenticação/Autorização
│   ├── biometrics-service/  # Biometria (login, enroll, verify)
│   ├── chat-service/        # Chat + LLM + Trading
│   ├── llm-gateway-service/ # Gateway LLM (rota/contexto namespace/agente)
│   ├── rag-service/         # Embeddings + Busca Semântica
│   ├── training-service/    # Fine-tuning + Auto-learning
│   ├── integrations-service/# APIs externas + Trading
│   ├── observability-service/# Métricas + Backup
│   └── frontend-service/    # React SPA
├── packages/                # Código compartilhado
│   ├── shared/              # Schema Drizzle ORM
│   ├── database/            # Conexão PostgreSQL
│   ├── logger/              # Pino singleton
│   ├── config/              # Validação Zod
│   └── shared-utils/        # Utilities enterprise
├── infra/                   # Infraestrutura
│   ├── docker/              # Docker Compose
│   └── scripts/             # Automação e deploy
└── docs/                    # Documentação
```

---

## 3. Contexto do Sistema (C4 Level 1)

### 3.1 Diagrama de Contexto

```mermaid
C4Context
    title Alice Enterprise Platform - System Context

    Person(user, "Usuário", "Funcionário da empresa")
    Person(admin, "Administrador", "Gestão da plataforma")
    
    System(alice, "Alice Platform", "Plataforma de IA Autônoma Enterprise")
    
    System_Ext(gpuServer, "Hetzner GPU GEX44", "GPU Manager Service - LLM/Embeddings/Training local")
    System_Ext(openai, "OpenAI", "Vision + geração de imagens (sem embeddings de imagem)")
    System_Ext(kucoin, "KuCoin Futures", "Trading BTC Perpetuals")
    System_Ext(stripe, "Stripe", "Pagamentos")
    System_Ext(twilio, "Twilio", "WhatsApp/SMS")
    System_Ext(gmail, "Gmail SMTP", "Email transacional")
    
    Rel(user, alice, "Chat, consultas, trading")
    Rel(admin, alice, "Configuração, monitoramento")
    Rel(alice, gpuServer, "Inferência LLM, Embeddings e Training (local)")
    Rel(alice, openai, "Vision e geração de imagens")
    Rel(alice, kucoin, "Ordens de trading")
    Rel(alice, stripe, "Webhooks de pagamento")
    Rel(alice, twilio, "Mensagens WhatsApp")
    Rel(alice, gmail, "Emails")
```

### 3.2 Integrações Externas

| Sistema | Propósito | Protocolo | Autenticação |
|---------|-----------|-----------|--------------|
| **Hetzner GPU GEX44** | GPU Manager Service local - LLM/Embeddings/Training (Gate 2) | HTTP (localhost) | N/A (interno) |
| **OpenAI** | Vision (gpt-4.1) + Geração de imagens (gpt-image-1) | HTTPS | API Key |
| **KuCoin Futures** | Trading BTC | REST + WebSocket | HMAC-SHA256 |
| **Stripe** | Pagamentos | Webhooks | Signature verification |
| **Twilio** | WhatsApp/SMS | REST | API Key + Token |
| **Gmail SMTP** | Email | SMTP/TLS | App Password |
| **Grafana** | Dashboards | REST | OAuth 2.0 SSO |

---

## 4. Containers (C4 Level 2)

### 4.1 Diagrama de Containers

```mermaid
C4Container
    title Alice Platform - Container Diagram

    Person(user, "Usuário")
    
    Container_Boundary(alice, "Alice Platform") {
        Container(caddy, "Caddy", "API Gateway", "Roteamento, SSL automático, HTTP/3")
        Container(frontend, "Frontend", "React 18 + Vite 7.3", "SPA, shadcn/ui, i18n")
        Container(auth, "Auth Service", "Node.js", "OAuth, SAML, RBAC")
        Container(chat, "Chat Service", "Node.js", "WebSocket, LLM, Trading Commands")
        Container(rag, "RAG Service", "Node.js", "Embeddings, Busca Semântica")
        Container(training, "Training Service", "Node.js", "Fine-tuning, Auto-learning")
        Container(integrations, "Integrations", "Node.js", "Stripe, KuCoin, Twilio")
        Container(observability, "Observability", "Node.js", "Health, Backup")
        
        ContainerDb(postgres, "PostgreSQL", "PostgreSQL 16", "pgvector, RLS")
        ContainerDb(qdrant, "Qdrant", "Vector DB", "Embeddings texto 1024 dim")
    }
    
    System_Ext(gpuManager, "GPU Manager Service", "Gerenciamento GPU local")
    
    Rel(user, caddy, "HTTPS/HTTP3")
    Rel(caddy, frontend, "HTTP")
    Rel(caddy, auth, "HTTP")
    Rel(caddy, chat, "HTTP/WS")
    Rel(caddy, rag, "HTTP")
    Rel(chat, gpuManager, "HTTP", "LLM Inference (local)")
    Rel(rag, gpuManager, "HTTP", "Embeddings (local)")
    Rel(chat, postgres, "TCP")
    Rel(rag, qdrant, "HTTP", "Vector Search")
    Rel(auth, redis, "TCP", "Sessions")
```

### 4.2 Catálogo de Containers (49 Total)

#### Infraestrutura Core (7)

| # | Container | Tecnologia | Porta | Responsabilidade |
|---|-----------|------------|-------|------------------|
| 1 | `alice-caddy` | Caddy 2.10.0 | 80,443 | API Gateway, SSL automático, HTTP/3 |
| 2 | `alice-pgbackrest-init` | pgBackRest | - | Inicialização stanza backup |
| 3 | `alice-postgres` | PostgreSQL 16 | 5432 | Banco principal + pgvector |
| 4 | `alice-redis` | Redis 7.4.7 | 6379 | Cache distribuído (node-redis 5.x) |
| 5 | `alice-qdrant` | Qdrant | 6333 | Embeddings texto (1024 dim) |
| 6 | `alice-tor` | torproxy | 9050 | Proxy SOCKS5 Tor (.onion) |
| 7 | `alice-searxng` | SearXNG | 8080 | Metabusca interna |

> **Deep Web**: SearXNG usa engine `ahmia` com proxy `socks5h://alice-tor:9050` para pesquisas .onion quando solicitado.

> **NOTA 02/01/2026**: Traefik, traefik-init e dockerproxy foram substituídos por Caddy. Vantagens: SSL automático com retry inteligente, HTTP/3 nativo, footprint 40MB (vs 100MB Traefik), configuração declarativa via Caddyfile. **ACME resiliente**: ZeroSSL primário + Let's Encrypt fallback.

#### Microsserviços Alice (10)

| # | Container | Tecnologia | Porta | Responsabilidade |
|---|-----------|------------|-------|------------------|
| 8 | `alice-frontend` | React 18 + Vite 7.3 | 5000 | SPA, UI/UX |
| 9 | `alice-auth` | Node.js | 3001 | OAuth, SAML, RBAC |
| 10 | `alice-biometrics` | Python (FastAPI) | 3011 | Biometria (login, enroll, verify), /metrics Prometheus |
| 11 | `alice-chat` | Node.js | 3002 | WebSocket, LLM, Trading |
| 12 | `alice-llm-gateway` | Node.js | 3011 | Gateway LLM (rota/contexto namespace/agente) |
| 13 | `alice-rag` | Node.js | 3003 | RAG, Embeddings |
| 14 | `alice-training` | Node.js | 3004 | Fine-tuning, Auto-learning |
| 15 | `alice-integrations` | Node.js | 3005 | Stripe, KuCoin, Twilio |
| 16 | `alice-observability` | Node.js | 3007 | Health, Backup |
| 17 | `alice-gpu-manager` | Node.js | 3010 | Gerenciamento centralizado GPU |


| # | Container | Descrição |
|---|-----------|-----------|

#### Observability Stack (13)

| # | Container | Descrição |
|---|-----------|-----------|
| 30-42 | Observability | Prometheus, **Grafana** (+ Alerting), Loki, Promtail, Jaeger, Langfuse x2, **ClickHouse**, Vector, OTel, Node-Exporter, cAdvisor |

> **NOTA 01/01/2026**: Alertmanager removido. Grafana Alerting assumiu 100% das funcionalidades de alertas com UI completa.

#### Backup (1)

| # | Container | Descrição |
|---|-----------|-----------|
| 44 | `alice-pgbackrest` | Backup enterprise PostgreSQL |

---

## 5. Componentes (C4 Level 3)

### 5.1 Chat Service - Componentes

```mermaid
C4Component
    title Chat Service - Component Diagram

    Container_Boundary(chat, "Chat Service") {
        Component(wsHandler, "WebSocket Handler", "Socket.io", "Gerencia conexões em tempo real")
        Component(llmClient, "LLM Client", "HTTP Client", "Comunicação com LLM (texto) via GPU Manager (Gate 2)")
        Component(ragClient, "RAG Client", "HTTP Client", "Busca contexto semântico")
        Component(visionAnalyzer, "Vision Analyzer", "HTTP Client", "Análise de imagens via OpenAI (Gate 2)")
        Component(responseCache, "Response Cache", "Redis", "Greetings Gate")
        Component(tradingParser, "Trading Parser", "NLP", "Comandos de trading")
        Component(tradingOrch, "Trading Orchestrator", "State Machine", "Handover/Takeover")
        Component(convOrch, "Conversation Orchestrator", "State Machine", "Escalation, Fallback")
    }
    
    ComponentDb(db, "PostgreSQL", "Conversations, Messages")
    ComponentDb(redis, "Redis", "Sessions, Cache")
    
    System_Ext(gpuManager, "GPU Manager Service", "LLM GPU (local)")
    System_Ext(kucoin, "KuCoin", "Trading API")
    
    Rel(wsHandler, responseCache, "Check cache")
    Rel(wsHandler, ragClient, "Get context")
    Rel(wsHandler, llmClient, "Generate response")
    Rel(wsHandler, tradingParser, "Parse commands")
    Rel(tradingParser, tradingOrch, "Execute trading")
    Rel(tradingOrch, kucoin, "Place orders")
    Rel(llmClient, gpuManager, "Inference (local)")
```

#### Modo Agentic Enterprise (Chat Service)

- Ações críticas registradas em `action_requests` com aprovação explícita (financeiro).
- Configuração por tenant persistida em `agentic_settings` (links, escopo, políticas e detectores).
- Streaming de eventos agentic em tempo real (SSE/WS) com payload redigido.

### 5.2 RAG Service - Componentes

```mermaid
C4Component
    title RAG Service - Component Diagram

    Container_Boundary(rag, "RAG Service") {
        Component(docProc, "Document Processor", "Chunking", "PDF, DOCX, TXT")
        Component(audioProc, "Audio Processor", "OpenAI ASR", "Transcrição de áudio")
        Component(imageProc, "Image Processor", "OpenAI Vision", "Descrição textual (sem embeddings de imagem)")
        Component(embQueue, "Embedding Queue", "Redis", "Processamento assíncrono")
        Component(embWorker, "Embedding Worker", "Background", "GPU dedicada 24/7")
        Component(vectorSearch, "Vector Search", "Qdrant", "Busca semântica")
    }
    
    ComponentDb(postgres, "PostgreSQL", "Documentos, Metadados")
    ComponentDb(qdrant, "Qdrant", "Embeddings 1024 dim (texto)")
    
    System_Ext(gpuManager, "GPU Manager Service", "GPU Processing (Hetzner GEX44)")
    
    Rel(docProc, embQueue, "Enqueue")
    Rel(embWorker, gpuManager, "Generate embeddings")
    Rel(embWorker, qdrant, "Store vectors")
    Rel(vectorSearch, qdrant, "Query")
```

#### 5.2.1 Fluxo RAG Multimodal (11/02/2026)

O RAG multimodal integra documentos textuais, imagens e áudio em uma única busca vetorial. 
**Tipos de pontos no Qdrant:**

| Tipo | Fonte | Conteúdo indexado | Namespace |
|------|-------|-------------------|-----------|
| `document_chunk` | schema.documents | Chunks de texto | namespaceId |
| `media_image` | mediaUploads | visionDescription (OpenAI Vision) | namespaceId |
| `media_audio` | mediaUploads | transcription (ASR) | namespaceId |

**Busca unificada:** `searchDocumentsInQdrant` filtra por `type: any(['document_chunk','media_image','media_audio'])`. O chat utiliza contexto de todas as fontes na recuperação RAG.

**Fluxo Mídia → RAG:**
1. Upload via Chat ou aba Multimodal (Training) com `namespaceId`
2. Imagem → OpenAI Vision (descrição textual) → embedding → Qdrant `media_image`
3. Áudio → ASR (transcrição) → embedding → Qdrant `media_audio`
4. Busca RAG retorna chunks + mídia na mesma consulta vetorial

**Fluxo Mídia → Treinamento:**
1. Mídia processada com `namespaceId` obrigatório
2. POST `/api/media/uploads/:id/send-to-training` usa visionDescription/transcription como texto
3. `collectTrainingFromMediaUpload` → POST `/api/training/data` com `source: 'rag_media'`
4. `approvedForTraining: true` em mediaUploads; dados no próximo ciclo LoRA

**Página Documentos RAG:** Abas "Documentos" e "Mídia" em visão unificada. Botão "Enviar para treinamento" por item de mídia processada (requer namespace).

### 5.3 Auth Service - Componentes

```mermaid
C4Component
    title Auth Service - Component Diagram

    Container_Boundary(auth, "Auth Service") {
        Component(oauth, "OAuth Handler", "Passport.js", "Google, GitHub")
        Component(saml, "SAML Handler", "passport-saml", "Azure AD, Okta")
        Component(rbac, "RBAC Engine", "6 roles", "Permissões granulares")
        Component(sessions, "Session Manager", "Redis", "Sessões distribuídas")
    }
    
    ComponentDb(postgres, "PostgreSQL", "Users, Tenants, Permissions")
    ComponentDb(redis, "Redis", "Sessions")
    
    Rel(oauth, sessions, "Create session")
    Rel(saml, sessions, "Create session")
    Rel(rbac, postgres, "Check permissions")
    Rel(oidc, provisioning, "Sync identity")
```

**Módulos de rotas ativos em `apps/auth-service/src/routes/`:**
- `rbac-admin-routes.ts`
- `user-management-routes.ts`
- `auth-system-routes.ts`
- `auth-provider-routes.ts`
- `auth-password-routes.ts`
- `auth-biometrics-routes.ts`
- `auth-registration-routes.ts`

### 5.4 Integrations Service - Boundaries de Rotas (P0)

Atualização arquitetural aplicada para reduzir o acoplamento do arquivo único e manter o `index.ts` como composition root fino.

**Módulos ativos em `apps/integrations-service/src/routes/`:**

| Módulo | Contexto principal |
|--------|--------------------|
| `integration-core-routes.ts` | health agregado, stats e auditoria de trading |
| `integration-registry-routes.ts` | catálogo CRUD de integrações (`GET/POST /api/integrations`) |
| `stripe-routes.ts` | checkout, portal, products, payment intent e webhook Stripe |
| `email-routes.ts` | envio SMTP e health de email |
| `grafana-github-routes.ts` | dashboards Grafana e deploy stack via GitHub Actions |
| `twilio-webhook-routes.ts` | webhooks WhatsApp e status com validação de assinatura |
| `twilio-operational-routes.ts` | envio manual e status operacional Twilio |
| `trading-account-management-routes.ts` | funding, sub-accounts, depósitos, withdrawals, transferências e fees de trading |
| `trading-analysis-routes.ts` | perfil de análise/sinal, catálogo de arbitragem e análise técnica determinística completa por símbolo |
| `trading-analysis-history-routes.ts` | histórico de análises (consulta, soft-delete e purge) com filtros por período/técnica e governança por escopo |
| `trading-automation-routes.ts` | portfólios/candidates/rebalances, enqueue interno de jobs e lifecycle de auto-runs (`/api/trading/auto/*`) |
| `trading-control-routes.ts` | governança de handover/takeover (`control-history`/`control`) com persistência em `trading_control_history` e broadcast de mudança |
| `trading-dataset-routes.ts` | governança de datasets de trading (`stats`, `list`, `from-signal`, `review`) com validação de tenant/namespace |
| `trading-futures-routes.ts` | cobertura de endpoints Futures (ordens, posições, risco, funding e índices) com guardrails de auth KuCoin |
| `trading-margin-routes.ts` | cobertura de endpoints Margin (ordens, OCO, borrow/repay, juros, risk-limit e market data) com guardrails KuCoin |
| `trading-market-data-routes.ts` | endpoints de market data (`klines`, `orderbook`, `funding-rate`, `mark-price`, `trades`) com validações e hardening KuCoin |
| `trading-market-risk-routes.ts` | market data, conta, posições e governança de risco no domínio de trading |
| `trading-order-governance-routes.ts` | ciclo de ordens (review/approve/reject/create/cancel/sync), histórico com cursor/soft-delete, trilha de auditoria e stop-order create |
| `trading-scheduler-news-routes.ts` | schedulers de sinais/análise e presets de notícias (CRUD + apply no profile) com validação de mercado/arbitragem |
| `trading-signal-action-routes.ts` | criação, desativação, aprovação e rejeição de sinais com governança de treinamento/auditoria |
| `trading-signal-generation-routes.ts` | geração on-demand de sinais LLM com scan de universo e tratamento de erro de governança |
| `trading-signal-history-routes.ts` | leitura de sinais ativos, histórico paginado e governança de exclusão lógica/definitiva de histórico |
| `trading-spot-routes.ts` | cobertura de endpoints Spot (ordens, OCO, stop orders, fills, market data e DCP) com guardrails KuCoin |
| `trading-stop-order-routes.ts` | consulta/cancelamento de stop orders com validações por mercado e hardening de configuração KuCoin |
| `trading-symbol-routes.ts` | catálogo de símbolos e preferências por usuário/mercado no trading |
| `trading-validation-routes.ts` | histórico e diagnóstico de validações LLM com agregações SQL e execução RLS-safe (`withTenantContext`) |
| `trading-websocket-routes.ts` | status de trading e lifecycle de subscribe/unsubscribe KuCoin WS (futures, spot e margin) |
| `wise-account-details-routes.ts` | account details Wise (consulta e criação de orders) |
| `wise-balance-and-quotes-routes.ts` | saldos, taxas e cotações Wise (balances, rates, quotes, balance movements) |
| `wise-card-management-routes.ts` | gestão de cartões Wise (list/get/status/pin/permissions e bulk permissions) |
| `wise-card-orders-routes.ts` | card orders Wise (ciclo completo de criação, requisitos e status) |
| `wise-card-secure-routes.ts` | dados sensíveis e transações de cartão Wise (twCard + card transactions) |
| `wise-disputes-routes.ts` | gestão de disputas Wise (reasons, flow, upload, listagem e status) |
| `wise-spend-controls-routes.ts` | governança de spend controls Wise (listar/criar/remover/assign/unassign) |
| `wise-spend-limits-routes.ts` | gestão de spend limits Wise (profile + card) |
| `wise-sca-routes.ts` | operações SCA Wise (one-time token, session, pin, device fingerprint e facemap) |
| `wise-simulation-routes.ts` | simulações Wise (transfer, verification, spend, KYC requirements, bank import) |
| `wise-verification-kyc-routes.ts` | verificação e KYC Wise (evidências, upload e ciclo de KYC reviews) |
| `wise-webhook-management-routes.ts` | gestão de subscriptions de webhook Wise (`/webhooks`) |
| `wise-recipients-transfers-routes.ts` | recipients, transfers e batch groups do Wise |
| `wise-oauth-routes.ts` | troca/refresh de tokens OAuth Wise + status operacional Wise |
| `wise-reference-routes.ts` | leitura operacional Wise (recipient requirements, perfis, usuários e atividades) |
| `wise-webhook-routes.ts` | processamento de webhook Wise com validação de assinatura e idempotência |
| `demo-trading-routes.ts` | simulação demo (ordens, saldo, posições, métricas) |
| `postmortem-routes.ts` | geração e operação de post-mortems |
| `health-probe-routes.ts` | probes `/live` e `/ready` |

**Serviços auxiliares já desacoplados:**
- `twilio-channel-service.ts`: validação de assinatura Twilio e envio WhatsApp (reuso entre rotas operacionais e webhooks).

**Resultado esperado (enterprise):**
- ownership por bounded context;
- menor risco de regressão cruzada;
- guardrails OpenAPI/RBAC mais fáceis de auditar por módulo.
- cobertura de contrato OpenAPI/RBAC reforçada para scheduler, governança de datasets, análise técnica, market data, controle operacional e validações LLM críticas no domínio de trading.

### 5.5 Training Service - Boundaries de Rotas (P0 parcial)

Atualização arquitetural aplicada para iniciar a decomposição de endpoints operacionais do treinamento sem alterar a governança do pipeline assíncrono.

**Módulo ativo em `apps/training-service/src/routes/`:**

| Módulo | Contexto principal |
|--------|--------------------|
| `training-platform-routes.ts` | health/probes (`/api/training/health`, `/live`, `/ready`), enqueue interno de trading (`/internal/trading/enqueue/*`), auto-runs internos (`/internal/trading/auto/*`) e governança de configuração (`GET/PATCH /api/training/system-config`) |
| `training-audit-routes.ts` | auditoria de governança (`GET /api/training/audit/integrity`, `GET /api/training/audit/high-risk`) com validação de tenant/autorização e filtros de ação/limite |
| `training-lora-orchestrator-routes.ts` | gestão de adapters LoRA (`/api/training/lora/*`) e proxy de orquestrador GPU (`/api/training/gpu-orchestrator/*`) |
| `training-runtime-routes.ts` | visões operacionais de runtime e governança (`/api/training/auto-learning/status`, `/execution-modes`, `/stats`, `/queue/status`) |
| `training-run-management-routes.ts` | lifecycle operacional de runs (`/api/training/run/status`, `/run/history`, `/run/cancel`) |
| `training-schedule-routes.ts` | configuração de schedule de treinamento (`/api/training/schedule/configure`) com reconciliação por escopo |
| `training-data-review-routes.ts` | revisão/aprovação em lote de dados (`/api/training/data/approve-batch`) com governança de quarentena/escopo |
| `training-bulk-import-routes.ts` | ingestão em lote (`/api/training/bulk-import`) com validação de escopo, dedupe semântico e enqueue assíncrono |
| `training-webhook-routes.ts` | entrada de webhook (`/api/training/webhook`) com assinatura, digest, nonce anti-replay e validação de tenant |
| `training-data-routes.ts` | ingestão/listagem/governança de `training_data` (`/api/training/data*`) com auditoria de mudança de escopo e métricas de review/override |
| `training-job-query-routes.ts` | consultas de jobs (`/api/training/jobs*`) com stream SSE, governança de aprovações e trilha imutável por tenant |
| `training-job-cancel-routes.ts` | cancelamento de jobs (`DELETE /api/training/jobs/:id`) com governança de estados terminais e cancelamento de LoRA vinculado |
| `training-job-promotion-approval-routes.ts` | aprovação de promoção (`POST /api/training/jobs/:id/promotion-approval`) com lock de concorrência, dual-write auditável e resumo consolidado de aprovações |
| `training-job-rollback-routes.ts` | rollback de modelo (`POST /api/training/jobs/:id/rollback`) com lock de concorrência, validação de escopo e promoção ativa por tenant |
| `training-job-promote-routes.ts` | promoção de modelo (`POST /api/training/jobs/:id/promote`) com gates de avaliação/aprovação, lock por escopo e ativação de adapter |
| `training-run-start-routes.ts` | início de run on-demand (`POST /api/training/run/start`) com idempotência por chave, lock de concorrência, queue enqueue e auditoria de governança |
| `training-job-create-routes.ts` | criação de jobs customizados (`POST /api/training/jobs`) com idempotência, lock de concorrência, seleção de dataset, enqueue assíncrono e auditoria de governança |

**Serviços auxiliares já desacoplados no `training-service`:**
- `training-governance-audit.ts`: catálogo de ações de governança + persistência de auditoria imutável com suporte transacional.
- `training-promotion-approvals.ts`: consulta consolidada de aprovações de promoção por job/tenant para reuse entre boundaries de rota.
- `training-job-lifecycle.ts`: retomada de jobs pendentes pós-restart + cancelamento governado de fine-tuning/LoRA para reuse entre boundaries de rota e bootstrap.
- `training-run-start-idempotency.ts`: idempotência de run-start (`header`, fingerprint, lookup/store Redis e resposta padronizada) reutilizada por boundaries de criação e execução on-demand.

**Resultado esperado (enterprise):**
- composição de plataforma separada da orquestração de treinamento/fine-tuning;
- composição de auditoria separada da orquestração principal, mantendo trilha imutável auditável;
- composição de LoRA/orchestrator separada do núcleo de treinamento, mantendo políticas de escopo e autorização por tenant;
- composição de runtime/status separada do núcleo transacional, mantendo observabilidade e policy gates centralizados;
- composição de lifecycle de runs separada do núcleo de orquestração, mantendo governança de cancelamento e visibilidade operacional;
- composição de schedule separada da orquestração on-demand, mantendo políticas de escopo e cálculo de próxima execução;
- composição de revisão de dados separada da ingestão/orquestração, mantendo guardrails de aprovação e telemetria de revisão;
- composição de bulk-import separada da ingestão síncrona/webhook, mantendo quality gates e fila assíncrona de deduplicação/embedding;
- composição de webhook separada da ingestão geral, mantendo hardening de autenticação/integridade/replay em boundary dedicado;
- redução de acoplamento no `index.ts` mantendo contratos existentes;
- manutenção da semântica assíncrona com idempotency key nas filas internas de trading.
- gates explícitos de aprovação para promoção (`TRAINING_PROMOTION_REQUIRE_APPROVAL_GATES`) centralizados no SSOT de `system_config`.
- auto-promoção agendada condicionada a governança: quando gates de aprovação estão ativos, o job permanece candidato com status operacional `waiting_approvals`.

---

### 5.6 Frontend Service - Workspaces Operacionais (P2 em andamento)

Atualização arquitetural aplicada para reduzir mega-páginas e separar tarefas por contexto no frontend sem alterar contratos backend.

**Componentes compartilhados de UI (P2):**

| Componente | Caminho | Responsabilidade |
|------------|---------|------------------|
| `WorkspaceFilterBar` | `apps/frontend-service/src/components/ui/workspace-filter-bar.tsx` | Padronizar filtros de workspace com callbacks/tipagem consistente e `data-testid` auditável |
| `EmptyState` | `apps/frontend-service/src/components/ui/empty-state.tsx` | Padronizar estados vazios em cards/listas com título/descrição reutilizáveis |
| `TableEmptyRow` | `apps/frontend-service/src/components/ui/table-empty-row.tsx` | Padronizar estados vazios em tabelas com `colSpan` explícito e layout consistente |

**Adoção atual (07/03/2026):**
- `WorkspaceFilterBar` aplicado em `Trading`, `WisePayments`, `Training`, `Chat`, `Documents`, `Agents`, `Namespaces`, `UsersAdmin` e `DemoTrading`.
- `EmptyState` aplicado em `DemoTrading` (posições, saldos, ordens, post-mortem e histórico), `Trading` (candidates/runs/ordem selecionada), `UsersAdmin` (listas vazias de grupos e roles customizadas) e `Documents` (estado vazio de documentos e mídias), com baseline para expansão nas demais páginas P2.
- `TableEmptyRow` aplicado em `UsersAdmin` (usuários, permissões e permissões customizadas) para eliminar duplicação de `TableRow/TableCell` vazios.
- `EmptyState` também aplicado no diálogo de usuário do `UsersAdmin` quando não há grupos disponíveis para atribuição, reduzindo variações de padrão entre tabela e formulário.
- Decomposição incremental em andamento em `UsersAdmin`: abas `users`, `groups`, `roles` e `permissions` extraídas para `apps/frontend-service/src/pages/users-admin/components/users-tab-content.tsx`, `apps/frontend-service/src/pages/users-admin/components/groups-tab-content.tsx`, `apps/frontend-service/src/pages/users-admin/components/roles-tab-content.tsx` e `apps/frontend-service/src/pages/users-admin/components/permissions-tab-content.tsx`, mantendo `UsersAdmin.tsx` como container de orquestração de estado/mutações.
- Decomposição incremental de dialogs iniciada em `UsersAdmin`: diálogo de permissões de role customizada extraído para `apps/frontend-service/src/pages/users-admin/components/custom-role-permissions-dialog.tsx`, mantendo handlers de debounce/save queue no container para preservar semântica assíncrona.
- Decomposição incremental de seções do diálogo de usuário em `UsersAdmin`: `profile`, `roles`, `customRoles` e `groups` extraídos para `apps/frontend-service/src/pages/users-admin/components/user-dialog-profile-section.tsx`, `user-dialog-roles-section.tsx`, `user-dialog-custom-roles-section.tsx` e `user-dialog-groups-section.tsx`, mantendo o container como boundary de estado/mutações.
- Decomposição incremental de `Documents`: conteúdos das tabs `documents` e `media` extraídos para `apps/frontend-service/src/pages/documents/components/documents-tab-content.tsx` e `apps/frontend-service/src/pages/documents/components/media-tab-content.tsx`, mantendo `Documents.tsx` como boundary de estado/mutações e render callbacks.
- Decomposição incremental de dialogs operacionais em `Documents`: upload, delete confirm e envio para treinamento extraídos para `apps/frontend-service/src/pages/documents/components/upload-dialog.tsx`, `delete-confirm-dialog.tsx` e `media-send-training-dialog.tsx`, mantendo `Documents.tsx` como boundary de orquestração.
- Decomposição incremental de upload zone em `Documents`: dropzone de upload extraído para `apps/frontend-service/src/pages/documents/components/upload-zone.tsx`, removendo lógica inline do container e mantendo fluxo real de upload sem alteração de contrato.
- Decomposição incremental de viewer dialog em `Documents`: visualizador/edição de documento extraído para `apps/frontend-service/src/pages/documents/components/document-viewer-dialog.tsx`, mantendo `Documents.tsx` como orchestrator de estado/mutações e preservando contratos de API.
- Decomposição incremental de cards em `Documents`: componentes de apresentação `DocumentCard` e `MediaCard` extraídos para `apps/frontend-service/src/pages/documents/components/document-card.tsx` e `apps/frontend-service/src/pages/documents/components/media-card.tsx`, reduzindo acoplamento de UI no container sem alterar contratos.
- Decomposição incremental de workspace header em `Documents`: cabeçalho operacional (título, métricas, workspace filter e tabs) extraído para `apps/frontend-service/src/pages/documents/components/documents-workspace-header.tsx`, mantendo `Documents.tsx` focado em estado/mutações.
- Decomposição incremental de types/config em `Documents`: contratos de tipos (`Document`, `MediaUpload`, etc.) e configuração de workspace/tabs/status extraídos para `apps/frontend-service/src/pages/documents/types.ts` e `apps/frontend-service/src/pages/documents/config.ts`, reduzindo densidade do container sem alterar contratos.
- Decomposição incremental de formulários em `UsersAdmin`: dialogs de grupos, role customizada e permissões extraídos para `apps/frontend-service/src/pages/users-admin/components/group-form-dialog.tsx`, `custom-role-form-dialog.tsx` e `permission-form-dialog.tsx`; schemas/helpers e tipos de domínio centralizados em `apps/frontend-service/src/pages/users-admin/form-schemas.ts` e `apps/frontend-service/src/pages/users-admin/types.ts`.
- Decomposição incremental de gestão de membros em `UsersAdmin`: diálogo de membros de grupo extraído para `apps/frontend-service/src/pages/users-admin/components/group-members-dialog.tsx`, mantendo `UsersAdmin.tsx` como boundary de estado/mutações e preservando contratos de API/RBAC.
- Decomposição incremental de orquestração de permissões em `UsersAdmin`: debounce/save queue de permissões de role/custom role extraído para `apps/frontend-service/src/pages/users-admin/hooks/use-role-permission-orchestration.ts`, mantendo `UsersAdmin.tsx` como container de composição e reduzindo acoplamento de estado transiente.
- Decomposição incremental de lifecycle de usuário em `UsersAdmin`: fluxo de criação/edição/salvamento/status extraído para `apps/frontend-service/src/pages/users-admin/hooks/use-user-management.ts`, mantendo validações/mutações/toasts existentes e reduzindo densidade do container principal.
- Decomposição incremental de mutações em `Documents`: upload, exclusão, reprocessamento e envio para treinamento extraídos para `apps/frontend-service/src/pages/documents/hooks/use-documents-mutations.ts`, mantendo `Documents.tsx` como container de composição e reduzindo acoplamento operacional.
- Decomposição incremental de orquestração de dialogs em `Documents`: handlers de abertura/fechamento/confirmação dos dialogs de exclusão e envio para treinamento extraídos para `apps/frontend-service/src/pages/documents/hooks/use-documents-dialog-orchestration.ts`, reduzindo estado transiente no container e mantendo contratos de API.
- Decomposição incremental de estado derivado/filtros em `Documents`: filtros, stats, namespace map e listas derivadas de documentos/mídias extraídos para `apps/frontend-service/src/pages/documents/hooks/use-documents-derived-state.ts`, reduzindo densidade lógica do container sem alterar contratos de API.
- Decomposição incremental da aba `orders` em `Trading`: conteúdo operacional da aba de ordens extraído para `apps/frontend-service/src/components/trading/TradingOrdersTabContent.tsx`, mantendo `Trading.tsx` como composition root e reduzindo acoplamento visual/operacional sem alterar contratos de API.
- Decomposição incremental da aba `portfolio-auto` em `Trading`: conteúdo operacional da aba de portfólio automático extraído para `apps/frontend-service/src/components/trading/TradingPortfolioAutoTabContent.tsx`, mantendo `Trading.tsx` como composition root e reduzindo acoplamento visual/operacional sem alterar contratos de API.
- Decomposição incremental da aba `signals-auto` em `Trading`: conteúdo operacional da aba de auto-runs de sinais extraído para `apps/frontend-service/src/components/trading/TradingSignalsAutoTabContent.tsx`, mantendo `Trading.tsx` como composition root e reduzindo acoplamento visual/operacional sem alterar contratos de API.
- Decomposição incremental da aba `lab` em `Trading`: conteúdo operacional da aba de pesquisa assíncrona extraído para `apps/frontend-service/src/components/trading/TradingLabTabContent.tsx`, mantendo `Trading.tsx` como composition root e reduzindo acoplamento visual/operacional sem alterar contratos de API.
- Decomposição incremental das abas `control` e `account` em `Trading`: boundaries de handover/controle e gestão de conta extraídos para `apps/frontend-service/src/components/trading/TradingControlTabContent.tsx` e `apps/frontend-service/src/components/trading/TradingAccountTabContent.tsx`, mantendo `Trading.tsx` como composition root e reduzindo acoplamento visual/operacional sem alterar contratos de API.
- Decomposição incremental da aba `positions` em `Trading`: conteúdo operacional de posições Futures/Spot/Margin extraído para `apps/frontend-service/src/components/trading/TradingPositionsTabContent.tsx`, mantendo `Trading.tsx` como composition root e reduzindo acoplamento visual/operacional sem alterar contratos de API.
- Decomposição incremental das abas `history` e `postmortems` em `Trading`: conteúdos operacionais de histórico de ordens e post-mortems extraídos para `apps/frontend-service/src/components/trading/TradingHistoryTabContent.tsx` e `apps/frontend-service/src/components/trading/TradingPostMortemsTabContent.tsx`, mantendo `Trading.tsx` como composition root e reduzindo acoplamento visual/operacional sem alterar contratos de API.
- Decomposição incremental da seção de resultados da aba `signals` em `Trading`: bloco de detalhe/lista/aprovação extraído para `apps/frontend-service/src/components/trading/TradingSignalsResultsSection.tsx`, mantendo `Trading.tsx` como composition root e reduzindo acoplamento visual/operacional sem alterar contratos de API.
- Decomposição incremental da seção de scheduler da aba `signals` em `Trading`: bloco de configuração/status/salvamento extraído para `apps/frontend-service/src/components/trading/TradingSignalsSchedulerSection.tsx`, mantendo `Trading.tsx` como composition root e reduzindo acoplamento visual/operacional sem alterar contratos de API.
- Decomposição incremental da seção de configuração de perfil da aba `signals` em `Trading`: bloco de timeframes/indicadores/técnicas/ensemble/arbitragem/fontes extraído para `apps/frontend-service/src/components/trading/TradingSignalsProfileConfigurationSection.tsx`, mantendo `Trading.tsx` como composition root e reduzindo acoplamento visual/operacional sem alterar contratos de API.
- Decomposição incremental da seção de news/actions da aba `signals` em `Trading`: bloco de `NewsConfigEditor` e ações operacionais (`save profile`, `generate now`, `create/update preset`) extraído para `apps/frontend-service/src/components/trading/TradingSignalsNewsAndActionsSection.tsx`, mantendo `Trading.tsx` como composition root e reduzindo acoplamento visual/operacional sem alterar contratos de API.
- Decomposição incremental do diálogo de criação da aba `signals` em `Trading`: diálogo de novo sinal extraído para `apps/frontend-service/src/components/trading/TradingNewSignalDialog.tsx`, mantendo `Trading.tsx` como composition root de estado/mutações e reduzindo acoplamento visual sem alterar contratos de API.
- Decomposição incremental do diálogo de envio de post-mortem em `Trading`: diálogo de envio para treinamento extraído para `apps/frontend-service/src/components/trading/TradingPostmortemTrainingDialog.tsx`, mantendo `Trading.tsx` como composition root de estado/mutações e reduzindo acoplamento visual sem alterar contratos de API.
- Decomposição incremental do diálogo de revisão de ordem em `Trading`: diálogo de revisão/aprovação de ordens pendentes extraído para `apps/frontend-service/src/components/trading/TradingReviewOrderDialog.tsx`, mantendo `Trading.tsx` como composition root de estado/mutações e reduzindo acoplamento visual sem alterar contratos de API.
- Decomposição incremental do diálogo de configuração de risco em `Trading`: diálogo de limites/defaults de risco extraído para `apps/frontend-service/src/components/trading/TradingRiskConfigDialog.tsx`, mantendo `Trading.tsx` como composition root de estado/mutações e reduzindo acoplamento visual sem alterar contratos de API.
- Decomposição incremental do diálogo de nova ordem em `Trading`: diálogo operacional de criação de ordens (resumo, conversão contratos/USDT, leverage e SL/TP) extraído para `apps/frontend-service/src/components/trading/TradingNewOrderDialog.tsx`, mantendo `Trading.tsx` como composition root de estado/mutações e reduzindo acoplamento visual sem alterar contratos de API.
- Decomposição incremental das abas `analysis`, `chart` e `orderbook` em `Trading`: blocos inline dessas abas extraídos para `apps/frontend-service/src/components/trading/TradingAnalysisTabContent.tsx`, `TradingChartTabContent.tsx` e `TradingOrderBookTabContent.tsx`, mantendo `Trading.tsx` como composition root de estado/mutações e reduzindo densidade residual sem alterar contratos de API.
- Decomposição incremental da aba `overview` em `Trading`: bloco operacional da aba (quick trade, resumo de conta, sinais recentes e ordens recentes) extraído para `apps/frontend-service/src/components/trading/TradingOverviewTabContent.tsx`, mantendo `Trading.tsx` como composition root de estado/mutações e reduzindo densidade residual sem alterar contratos de API.
- Decomposição incremental das linhas de métricas em `Trading`: cards de métricas de mercado/conta e status operacional extraídos para `apps/frontend-service/src/components/trading/TradingStatsRows.tsx` (`TradingStatsPrimaryRow` e `TradingStatsSecondaryRow`), removendo helpers inline do container e reduzindo densidade residual sem alterar contratos de API.
- Decomposição incremental do header operacional em `Trading`: bloco de título/status, seletores de mercado/símbolo, ações de favoritos/destaques, indicador de conectividade WS e acesso à configuração de risco extraído para `apps/frontend-service/src/components/trading/TradingHeaderSection.tsx`, mantendo `Trading.tsx` como composition root de estado/mutações e reduzindo densidade residual sem alterar contratos de API.
- Decomposição incremental dos alertas operacionais em `Trading`: bloco de alertas de erro crítico de upstream e trading desabilitado extraído para `apps/frontend-service/src/components/trading/TradingOperationalAlerts.tsx`, mantendo `Trading.tsx` como composition root de estado/mutações e reduzindo densidade residual sem alterar contratos de API.
- Decomposição incremental do shell de navegação de tabs em `Trading`: estrutura compartilhada de `Tabs`, `WorkspaceFilterBar`, `TabsList` e `TabsTrigger` extraída para `apps/frontend-service/src/components/trading/TradingTabsShell.tsx`, mantendo `Trading.tsx` focado em estado/orquestração e reduzindo acoplamento de UI sem alterar contratos de API.
- Decomposição incremental da aba `signals` em `Trading`: bloco operacional de sinais (`perfil + news/actions + scheduler + resultados`) extraído para `apps/frontend-service/src/components/trading/TradingSignalsTabContent.tsx`, mantendo `Trading.tsx` como composition root de estado/mutações e reduzindo densidade residual sem alterar contratos de API.
- Decomposição incremental da seção de dialogs em `Trading`: bloco de dialogs operacionais (`nova ordem`, `OCO`, `review`, `risk config`, `post-mortem->training`, `novo sinal`) extraído para `apps/frontend-service/src/components/trading/TradingDialogsSection.tsx`, mantendo `Trading.tsx` como composition root de estado/mutações e reduzindo densidade residual sem alterar contratos de API.
- Decomposição incremental das abas operacionais residuais em `Trading`: abas `history`, `postmortems`, `chart`, `orderbook`, `control` e `account` agrupadas em `apps/frontend-service/src/components/trading/TradingOperationalTabsSection.tsx`, mantendo `Trading.tsx` como composition root de estado/mutações e reduzindo densidade residual sem alterar contratos de API.
- Decomposição incremental das abas primárias em `Trading`: abas `overview`, `portfolio-auto`, `signals-auto`, `lab`, `orders`, `positions`, `signals` e `analysis` agrupadas em `apps/frontend-service/src/components/trading/TradingPrimaryTabsSection.tsx`, mantendo `Trading.tsx` como composition root de estado/mutações e reduzindo densidade residual sem alterar contratos de API.
- Decomposição incremental da aba `balances` em `WisePayments`: bloco da aba extraído para `apps/frontend-service/src/pages/wise-payments/components/wise-balances-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- Decomposição incremental da aba `exchange` em `WisePayments`: bloco da aba extraído para `apps/frontend-service/src/pages/wise-payments/components/wise-exchange-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- Decomposição incremental da aba `transfers` em `WisePayments`: bloco da aba extraído para `apps/frontend-service/src/pages/wise-payments/components/wise-transfers-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- Decomposição incremental da aba `recipients` em `WisePayments`: bloco da aba extraído para `apps/frontend-service/src/pages/wise-payments/components/wise-recipients-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- Decomposição incremental da aba `quotes` em `WisePayments`: bloco da aba extraído para `apps/frontend-service/src/pages/wise-payments/components/wise-quotes-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- Decomposição incremental da aba `batch` em `WisePayments`: bloco da aba extraído para `apps/frontend-service/src/pages/wise-payments/components/wise-batch-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- Decomposição incremental da aba `profiles` em `WisePayments`: bloco da aba extraído para `apps/frontend-service/src/pages/wise-payments/components/wise-profiles-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- Decomposição incremental da aba `users` em `WisePayments`: bloco da aba extraído para `apps/frontend-service/src/pages/wise-payments/components/wise-users-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- Decomposição incremental da aba `activities` em `WisePayments`: bloco da aba extraído para `apps/frontend-service/src/pages/wise-payments/components/wise-activities-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- Decomposição incremental da aba `statements` em `WisePayments`: bloco da aba extraído para `apps/frontend-service/src/pages/wise-payments/components/wise-statements-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- Decomposição incremental da aba `account-details` em `WisePayments`: bloco da aba extraído para `apps/frontend-service/src/pages/wise-payments/components/wise-account-details-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- Decomposição incremental da aba `cards` em `WisePayments`: bloco da aba extraído para `apps/frontend-service/src/pages/wise-payments/components/wise-cards-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- Decomposição incremental da aba `card-orders` em `WisePayments`: bloco da aba extraído para `apps/frontend-service/src/pages/wise-payments/components/wise-card-orders-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- Decomposição incremental da aba `card-transactions` em `WisePayments`: bloco da aba extraído para `apps/frontend-service/src/pages/wise-payments/components/wise-card-transactions-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- Decomposição incremental da aba `spend-limits` em `WisePayments`: bloco da aba extraído para `apps/frontend-service/src/pages/wise-payments/components/wise-spend-limits-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- Decomposição incremental da aba `spend-controls` em `WisePayments`: bloco da aba extraído para `apps/frontend-service/src/pages/wise-payments/components/wise-spend-controls-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- Decomposição incremental da aba `disputes` em `WisePayments`: bloco da aba extraído para `apps/frontend-service/src/pages/wise-payments/components/wise-disputes-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- Decomposição incremental da aba `kyc` em `WisePayments`: bloco da aba extraído para `apps/frontend-service/src/pages/wise-payments/components/wise-kyc-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- Decomposição incremental da aba `webhooks` em `WisePayments`: bloco da aba extraído para `apps/frontend-service/src/pages/wise-payments/components/wise-webhooks-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- Decomposição incremental da aba `simulations` em `WisePayments`: bloco da aba extraído para `apps/frontend-service/src/pages/wise-payments/components/wise-simulations-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- Decomposição incremental da aba `sca` em `WisePayments`: bloco da aba extraído para `apps/frontend-service/src/pages/wise-payments/components/wise-sca-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- Decomposição incremental da aba `catalog` em `WisePayments`: bloco da aba extraído para `apps/frontend-service/src/pages/wise-payments/components/wise-catalog-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- Decomposição incremental da navegação/workspaces em `WisePayments`: catálogo de tabs, mapeamento de workspaces e tipos foram extraídos para `apps/frontend-service/src/pages/wise-payments/wise-payments-navigation.ts`, mantendo `WisePayments.tsx` como composition root e reduzindo o container para 3183 linhas sem alterar contratos de API.
- Decomposição incremental do guard de queries em `WisePayments`: bloqueio temporário de queries após respostas `401/429` e tratamento centralizado de erros foram extraídos para `apps/frontend-service/src/pages/wise-payments/use-wise-query-guard.ts`, mantendo `WisePayments.tsx` como composition root e reduzindo o container para 3133 linhas sem alterar contratos de API.
- Decomposição incremental dos handlers de referência em `WisePayments`: estado e handlers operacionais de `balanceCapacity`, `totalFunds`, `rates` e `recipientRequirements` foram extraídos para `apps/frontend-service/src/pages/wise-payments/use-wise-reference-actions.ts`, mantendo `WisePayments.tsx` como composition root e reduzindo o container para 3070 linhas sem alterar contratos de API.
- Decomposição incremental dos handlers de transferência/cartões em `WisePayments`: estado e handlers de `fund/cancel transfer`, permissões de cartão e fluxos `card secure` foram extraídos para `apps/frontend-service/src/pages/wise-payments/use-wise-transfer-and-card-actions.ts`, mantendo `WisePayments.tsx` como composition root e reduzindo o container para 2949 linhas sem alterar contratos de API.
- Decomposição incremental de upload de arquivos em `WisePayments`: estado e handlers de upload para disputas/KYC (`dispute`, `kyc document` e `kyc additional`) foram extraídos para `apps/frontend-service/src/pages/wise-payments/use-wise-file-upload-state.ts`, mantendo `WisePayments.tsx` como composition root e reduzindo o container para 2900 linhas sem alterar contratos de API.
- Decomposição incremental do catalog workbench em `WisePayments`: estado, efeitos de sincronização de `profileId` e handler de execução do catálogo foram extraídos para `apps/frontend-service/src/pages/wise-payments/use-wise-catalog-workbench.ts`, mantendo `WisePayments.tsx` como composition root e reduzindo o container para 2829 linhas sem alterar contratos de API.
- Decomposição incremental dos fluxos `webhooks/simulations/sca` em `WisePayments`: estado e mutações operacionais foram extraídos para `apps/frontend-service/src/pages/wise-payments/use-wise-webhook-simulation-sca-actions.ts`, mantendo `WisePayments.tsx` como composition root e reduzindo o container para 2586 linhas sem alterar contratos de API.
- Decomposição incremental dos fluxos `account-details/card-orders/disputes/kyc` em `WisePayments`: estado, mutações e handlers operacionais foram extraídos para `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-actions.ts`, mantendo `WisePayments.tsx` como composition root e reduzindo o container para 2076 linhas sem alterar contratos de API.
- Decomposição incremental dos fluxos `users/activities` em `WisePayments`: estado, mutações e handlers operacionais foram extraídos para `apps/frontend-service/src/pages/wise-payments/use-wise-user-activity-actions.ts`, mantendo `WisePayments.tsx` como composition root e reduzindo o container para 2025 linhas sem alterar contratos de API.
- Decomposição incremental dos fluxos `balances/quotes/exchange/statements` em `WisePayments`: estado, mutações e handlers operacionais foram extraídos para `apps/frontend-service/src/pages/wise-payments/use-wise-balance-exchange-statement-actions.ts`, mantendo `WisePayments.tsx` como composition root e reduzindo o container para 1826 linhas sem alterar contratos de API.
- Decomposição incremental dos fluxos `cards/spend-controls/spend-limits` em `WisePayments`: estado, mutações e handlers operacionais foram extraídos para `apps/frontend-service/src/pages/wise-payments/use-wise-card-spend-actions.ts`, mantendo `WisePayments.tsx` como composition root e reduzindo o container para 1518 linhas sem alterar contratos de API.
- Decomposição incremental dos fluxos `recipients` em `WisePayments`: estado/transições de diálogo e deleção de recipient foram extraídos para `apps/frontend-service/src/pages/wise-payments/use-wise-recipient-actions.ts`, mantendo `WisePayments.tsx` como composition root e reduzindo o container para 1503 linhas sem alterar contratos de API.
- Decomposição incremental da aba `jobs` em `Training`: bloco da aba extraído para `apps/frontend-service/src/pages/training/components/training-jobs-tab-content.tsx`, mantendo `Training.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- Decomposição incremental da aba `auto-learning` em `Training`: bloco da aba extraído para `apps/frontend-service/src/pages/training/components/training-auto-learning-tab-content.tsx`, mantendo `Training.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- Decomposição incremental da aba `data` em `Training`: bloco da aba extraído para `apps/frontend-service/src/pages/training/components/training-data-tab-content.tsx`, mantendo `Training.tsx` como composition root de estado/mutações, preservando governança de review em lote e reduzindo acoplamento da mega-página sem alterar contratos de API.
- Decomposição incremental da aba `bulk-import` em `Training`: bloco da aba extraído para `apps/frontend-service/src/pages/training/components/training-bulk-import-tab-content.tsx`, mantendo `Training.tsx` como composition root de estado/mutações, preservando validação Zod e fluxo de ingestão em lote sem alterar contratos de API.
- Decomposição incremental da aba `multimodal` em `Training`: bloco da aba extraído para `apps/frontend-service/src/pages/training/components/training-multimodal-tab-content.tsx`, mantendo `Training.tsx` como composition root de estado/mutações e preservando upload/processamento/promoção multimodal sem alterar contratos de API.
- Decomposição incremental do diálogo `on-demand run` em `Training`: diálogo extraído para `apps/frontend-service/src/pages/training/components/training-on-demand-run-dialog.tsx`, mantendo `Training.tsx` como composition root de estado/mutações e preservando fluxo manual de execução sem alterar contratos de API.
- Decomposição incremental do diálogo `batch review` em `Training`: diálogo extraído para `apps/frontend-service/src/pages/training/components/training-batch-review-dialog.tsx`, mantendo `Training.tsx` como composition root de estado/mutações e preservando confirmação/review em lote sem alterar contratos de API.
- Decomposição incremental do diálogo `review` em `Training`: diálogo extraído para `apps/frontend-service/src/pages/training/components/training-review-dialog.tsx`, mantendo `Training.tsx` como composition root de estado/mutações e preservando aprovação/rejeição com override de escopo sem alterar contratos de API.
- Decomposição incremental do diálogo `resolve scope` em `Training`: diálogo extraído para `apps/frontend-service/src/pages/training/components/training-resolve-scope-dialog.tsx`, mantendo `Training.tsx` como composition root de estado/mutações e preservando relink de escopo/quarentena sem alterar contratos de API.
- Decomposição incremental do diálogo `promote` em `Training`: diálogo extraído para `apps/frontend-service/src/pages/training/components/training-promote-dialog.tsx`, mantendo `Training.tsx` como composition root de estado/mutações e preservando o fluxo de promoção sem alterar contratos de API.
- Decomposição incremental do diálogo `rollback` em `Training`: diálogo extraído para `apps/frontend-service/src/pages/training/components/training-rollback-dialog.tsx`, mantendo `Training.tsx` como composition root de estado/mutações e preservando validação de motivo/auditoria sem alterar contratos de API.
- Decomposição incremental do diálogo `post-training` em `Training`: diálogo extraído para `apps/frontend-service/src/pages/training/components/training-post-training-dialog.tsx`, mantendo `Training.tsx` como composition root de estado/mutações e preservando retorno ao chat sem alterar contratos de API.
- Decomposição incremental do componente `TrainingDataCard` em `Training`: card de dataset extraído para `apps/frontend-service/src/pages/training/components/training-data-card.tsx`, mantendo `Training.tsx` como composition root de estado/mutações e preservando seleção/review/relink sem alterar contratos de API.
- Decomposição incremental do componente `TrainingJobCard` em `Training`: card de job extraído para `apps/frontend-service/src/pages/training/components/training-job-card.tsx`, mantendo `Training.tsx` como composition root de estado/mutações e preservando ações de promoção/aprovação/rollback sem alterar contratos de API.
- Decomposição incremental do componente `TrainingJobDetailModal` em `Training`: modal de detalhe de job extraído para `apps/frontend-service/src/pages/training/components/training-job-detail-modal.tsx`, mantendo stream SSE de progresso e trilha de auditoria sem alterar contratos de API.
- Decomposição incremental do componente `TrainingCreateJobDialog` em `Training`: diálogo de criação de job extraído para `apps/frontend-service/src/pages/training/components/training-create-job-dialog.tsx`, mantendo validação Zod e envio idempotente por `X-Idempotency-Key` sem alterar contratos de API.
- Governança de utilitários de requisição em `Training`: geração de idempotency key, fingerprint estável e hint de `retry-after` centralizados em `apps/frontend-service/src/pages/training/training-request-utils.ts`, reduzindo duplicação no container `Training.tsx`.
- Decomposição incremental dos utilitários de exibição de `Trading`: badges e formatadores (`SIGNAL_TYPES`, `SignalTypeBadge`, `OrderStatusBadge`, `formatDecisionSummary`) extraídos para `apps/frontend-service/src/components/trading/TradingDisplayUtils.tsx` e reexportados em `apps/frontend-service/src/components/trading/index.ts`, reduzindo densidade do container `Trading.tsx` sem alterar contratos de API.
- Decomposição incremental da configuração de sinais de `Trading`: catálogos e defaults (`SIGNAL_INDICATOR_OPTIONS`, `TRADING_TECHNIQUE_OPTIONS`, `AUTO_SIGNAL_MODE_OPTIONS`, `AUTO_SIGNAL_ALL_MODES`, `DEFAULT_*`) extraídos para `apps/frontend-service/src/components/trading/TradingSignalConfig.ts` e reexportados em `apps/frontend-service/src/components/trading/index.ts`, reduzindo densidade do container `Trading.tsx` sem alterar contratos de API.
- Decomposição incremental da navegação/workspaces de `Trading`: tipos e catálogos (`TradingTabKey`, `TradingWorkspaceKey`, `TRADING_TAB_DESCRIPTORS`, `TRADING_WORKSPACE_TABS`, `TRADING_WORKSPACE_LABELS`, `findWorkspaceForTradingTab`) extraídos para `apps/frontend-service/src/components/trading/TradingNavigationConfig.ts` e reexportados em `apps/frontend-service/src/components/trading/index.ts`, reduzindo densidade do container `Trading.tsx` sem alterar contratos de API.
- Decomposição incremental dos utilitários de página de `Trading`: helpers puros (`getQuoteCurrencyFromSymbol`, `getBaseCurrencyFromSymbol`, `formatDurationMinutes`) extraídos para `apps/frontend-service/src/components/trading/TradingPageUtils.ts` e reexportados em `apps/frontend-service/src/components/trading/index.ts`, reduzindo densidade do container `Trading.tsx` sem alterar contratos de API.
- Decomposição incremental dos contratos de domínio de `Trading`: tipos de payload/conta/sinal/ordem, guards de margem (`isMarginCrossAccount`, `isMarginIsolatedAccount`) e presets de animação extraídos para `apps/frontend-service/src/components/trading/TradingDomainTypes.ts` e reexportados em `apps/frontend-service/src/components/trading/index.ts`, reduzindo `Trading.tsx` de 3649 para 3320 linhas sem alteração de contratos de API.
- Decomposição incremental dos defaults de formulários de `Trading`: factories tipadas de inicialização/reset (`createDefault*`, `create*FromConfig`) extraídas para `apps/frontend-service/src/components/trading/TradingFormDefaults.ts` e aplicadas no container, reduzindo `Trading.tsx` para 3232 linhas sem alterar contratos de API.
- Decomposição incremental do hook de perfil de sinais em `Trading`: estado/updaters/reconciliação de arbitragem do `signalProfile` extraídos para `apps/frontend-service/src/components/trading/useTradingSignalProfileState.ts`, mantendo `Trading.tsx` como composition root e reduzindo o container para 3178 linhas sem alterar contratos de API.
- Decomposição incremental do hook de presets de notícias em `Trading`: query/mutações e regras de seleção/criação/atualização/remoção de presets extraídas para `apps/frontend-service/src/components/trading/useTradingNewsPresets.ts`, mantendo `Trading.tsx` como composition root e reduzindo o container para 3080 linhas sem alterar contratos de API.
- Decomposição incremental do hook de histórico de ordens em `Trading`: estado, paginação, seleção em lote e exclusão de histórico extraídos para `apps/frontend-service/src/components/trading/useTradingOrderHistory.ts`, mantendo `Trading.tsx` como composition root e reduzindo o container para 3006 linhas sem alterar contratos de API.
- Decomposição incremental da navegação de workspaces/tabs em `Trading`: estado e handlers (`activeTab`, `activeWorkspace`, troca de tabs/workspaces e reconciliação automática) extraídos para `apps/frontend-service/src/components/trading/useTradingWorkspaceNavigation.ts` e integrados ao barrel `apps/frontend-service/src/components/trading/index.ts`, mantendo `Trading.tsx` como composition root e reduzindo o container para 2987 linhas sem alterar contratos de API.
- Decomposição incremental de ações residuais de workspace em `Trading`: handlers de refresh/execução/abertura e mutações de histórico (`OCO`, `positions`, `signals-auto`, `history`, `postmortems`, `risk/review dialogs`) extraídos para `apps/frontend-service/src/components/trading/useTradingWorkspaceActionHandlers.ts`, mantendo `Trading.tsx` como composition root e reduzindo callbacks inline residuais sem alterar contratos de API.
- Decomposição incremental de refresh handlers em `WisePayments`: `apps/frontend-service/src/pages/wise-payments/use-wise-refresh-actions.ts` expandido para expor handlers de refetch por domínio (`account-details`, `profiles`, `users`, `cards`, `card-orders`, `spend-controls`, `disputes`, `kyc`), removendo wrappers inline equivalentes em `WisePayments.tsx` sem alterar contratos de API.
- Decomposição incremental dos estados de acesso do wrapper de `Trading`: telas de `loading/auth required/forbidden` extraídas para `apps/frontend-service/src/components/trading/TradingAccessStates.tsx` e integradas ao wrapper em `apps/frontend-service/src/pages/Trading.tsx`, reduzindo duplicação de markup sem alterar contratos de API.
- Decomposição incremental do shell/status de `WisePayments`: navegação de workspaces/tabs extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-payments-tabs-shell.tsx` e estados de serviço (`loading/not configured`) extraídos para `apps/frontend-service/src/pages/wise-payments/components/wise-payments-status-states.tsx`, reduzindo densidade do container `WisePayments.tsx` sem alterar contratos de API.
- Decomposição incremental dos estados de serviço de `Trading`: estados de `loading/error/unavailable/not configured/tenant required` extraídos para `apps/frontend-service/src/components/trading/TradingServiceStates.tsx` e integrados ao container `Trading.tsx`, reduzindo densidade da composition root sem alterar contratos de API.
- Decomposição incremental de métricas derivadas de `Trading`: cálculos de contagem de posições abertas, resumos de conta (`futures/spot/margin`) e variação de preço extraídos para `apps/frontend-service/src/components/trading/TradingDerivedMetrics.ts` e integrados ao container `Trading.tsx`, reduzindo lógica inline sem alterar contratos de API.
- Decomposição incremental dos utilitários de rota/sources do `Chat`: roteamento/workspaces/date filters e parsing de fontes (`message sources`) extraídos para `apps/frontend-service/src/pages/Chat/chat-page-routing.ts` e `apps/frontend-service/src/pages/Chat/chat-message-sources.ts`, reduzindo `Chat/index.tsx` para 2975 linhas sem alterar contratos de API.
- Decomposição incremental dos utilitários de gravação de `Chat`: normalização de MIME, encode WAV, conversão e preparo de arquivo de gravação extraídos para `apps/frontend-service/src/pages/Chat/chat-recording-utils.ts`, reduzindo `Chat/index.tsx` para 2833 linhas sem alterar contratos de API.
- Decomposição incremental dos hooks de `Chat` para auto-scroll e seleção: comportamento de scroll e seleção em lote/range extraídos para `apps/frontend-service/src/pages/Chat/useChatAutoScroll.ts` e `apps/frontend-service/src/pages/Chat/useChatSelectionState.ts`, reduzindo `Chat/index.tsx` para 2459 linhas sem alterar contratos de API.

**Workspace de Chat ativo em `apps/frontend-service/src/pages/Chat/index.tsx`:**

| Workspace | Contexto principal |
|-----------|--------------------|
| `Todos` | visão completa sem ocultação de controles |
| `Conversa` | foco em mensagens e contexto da conversa ativa |
| `Operações` | ações operacionais (`training batch`, seleção de mensagens, exclusão) |
| `Governança` | políticas de aprovação e roteamento de agentes |
| `Diagnóstico` | controles técnicos de stream para troubleshooting |

**Resultado esperado (enterprise):**
- redução de carga cognitiva na operação diária de chat;
- separação explícita entre governança, operação e diagnóstico;
- previsibilidade de estado React com render condicional por contexto.
- mutações de governança LLM com bind de ator autenticado (HMAC + role `admin/super_admin`) para eliminar spoofing de identidade em aprovações/ativações.
- chamadas service-to-service ao LLM Gateway com HMAC preferencial no client compartilhado, reduzindo dependência do secret estático legado.
- propagação de `traceparent`/`x-correlation-id`/`x-request-id` no client compartilhado do LLM Gateway para rastreabilidade fim a fim entre serviços.
- unificação de autorização interna no Observability Service por marca de autenticação validada (`res.locals.internalAuthValidated`) para manter consistência entre HMAC e secret legado.
- adoção de `createCorrelationMiddleware` no Observability Service para manter continuidade de tracing distribuído no mesmo padrão dos demais microsserviços.

---

## 6. Visão de Runtime

### 6.1 Fluxo de Chat com LLM (Gate 2)

```mermaid
sequenceDiagram
    autonumber
    participant U as Usuário
    participant WS as WebSocket Handler
    participant RC as Response Cache
    participant RAG as RAG Service
    participant LLM as LLM (texto - Qwen3 8B)
    participant DB as PostgreSQL
    
    U->>WS: Mensagem via WebSocket
    WS->>DB: Salvar mensagem do usuário
    WS->>RC: Verificar cache (Greetings Gate)
    
    alt Saudação detectada
        RC-->>WS: Resposta cacheada
        WS-->>U: Stream resposta
    else Mensagem complexa
        WS->>RAG: Buscar contexto semântico
        RAG-->>WS: Chunks relevantes
        WS->>LLM: Generate (system + context + user)
        loop Streaming
            LLM-->>WS: Token
            WS-->>U: Stream token
        end
        WS->>DB: Salvar resposta assistente
    end
```

### 6.2 Fluxo de Trading via Chat

```mermaid
sequenceDiagram
    autonumber
    participant U as Usuário
    participant Chat as Chat Service
    participant Parser as Trading Parser
    participant Orch as Trading Orchestrator
    participant KuCoin as KuCoin Service
    participant API as KuCoin API
    participant DB as PostgreSQL
    
    U->>Chat: "compre 0.5 BTC a 50000"
    Chat->>Parser: parseTradingCommand(text)
    Parser-->>Chat: {type: 'buy', amount: 0.5, price: 50000}
    Chat->>Orch: Verificar modo (alice/manual)
    
    alt Modo Alice (automático)
        Orch->>KuCoin: placeOrder(order)
        KuCoin->>API: POST /api/v1/orders
        API-->>KuCoin: Order ID
        KuCoin->>DB: Salvar ordem + audit log
        KuCoin-->>Chat: Order placed
        Chat-->>U: "Ordem de compra executada ✅"
    else Modo Manual
        Orch-->>Chat: "Trading em modo manual"
        Chat-->>U: "Assuma controle via painel"
    end
```

#### 6.2.1 Notícias (SearXNG) em Sinais e Análises

As notícias usadas nos **Sinais IA** e na **Análise Técnica** são coletadas via **SearXNG interno**.  
A configuração é persistida por tenant no perfil `trading_analysis_profiles.news_config` e exposta na UI.

**Configurações suportadas (perfil):**
- `engines`: lista de engines (atalhos SearXNG). Vazio = engines padrão da instância.
- `categories`: categoria SearXNG (ex: `general`).
- `language`: idioma (ex: `pt-BR`).
- `safesearch`: nível de SafeSearch (`0`, `1`, `2`).
- `timeRange`: janela temporal para engines que suportam filtro (day/week/month/year).
- `dateFrom` / `dateTo`: datas opcionais (YYYY-MM-DD) para compor templates.
- `queryTemplates`: templates com `{symbol}`, `{marketType}` e `{terms}`.
- `extraTerms`: termos adicionais para enriquecer a consulta.
- `maxResults`: limite de resultados retornados (1 a 10).

**Consulta padrão:**
```
{symbol} {marketType} news {terms}
```

### 6.2.2 Fluxo Demo Trading + Post-Mortem

O ecossistema Demo Trading integra simulação enterprise com análise pós-fechamento automática e geração de datasets para treinamento.

**Componentes:**

| Módulo | Arquivo | Descrição |
|--------|---------|-----------|
| Demo Trading Engine | `demo-trading-engine.ts` | Balances, ordens, posições, PnL simulado |
| Post-Mortem Engine | `postmortem-engine.ts` | Pipeline two-phase (CPU → LLM) |
| Post-Mortem Worker | `postmortem-worker.ts` | Fila Redis com retry/DLQ |
| Snapshot Store | `snapshot-store.ts` | Snapshots de mercado (6 kinds) |
| Dataset Generator | `dataset-generator.ts` | Geração de datasets de treinamento |

**Pipeline:**

```
Posição Fechada (real ou demo)
    → Snapshot Store (market_exit + evidence_pack)
    → Redis Queue (Sorted Set)
    → Post-Mortem Worker processa
        → Phase 1 (CPU): classificação determinística
        → Phase 2 (LLM): motivadores + citedValues
            → LoRA Adapter: resolveModelWithAdapter() verifica adapter global ativo
            → RAG Context: queryPostMortemRAGContext() enriquece prompt com learnings anteriores
        → Fingerprint idempotente (SHA-256)
    → Feedback Loop: indexPostMortemLearnings() indexa resultado no RAG namespace trading
    → Dataset Generator (status: pending)
    → Training Page (aprovação manual → ativar adapter LoRA)
```

**Mercados Demo suportados:** Spot, Futures (com leverage), Margin.

**Sinais IA → Demo:** botão "Aprovar Demo" na aba Sinais IA converte sinal em ordem Demo (complementar ao "Aprovar" que cria ordem Real).

**Snapshot Store — Detalhes Técnicos:**

| Kind | Descrição | Dados Capturados |
|------|-----------|------------------|
| `market_entry` | Snapshot na abertura | Ticker (preço, bid/ask, volume, change24h) |
| `market_exit` | Snapshot no fechamento | Ticker atualizado |
| `candles` | Candles históricos | 1m, 3m, 5m, 15m, 1h recentes |
| `orderbook_top` | Top do orderbook | Top N bids e asks |
| `news` | Notícias relevantes | Via SearXNG (quando habilitado) |
| `evidence_pack` | Pacote consolidado | Agregação de entry + exit + candles + orderbook |

- Armazenamento: JSONB com compressão TOAST automática do PostgreSQL.
- Referências: posições mantêm `entrySnapshotId` e `exitSnapshotId` para rastreabilidade completa.
- Captura: `captureEntrySnapshot()` e `captureExitSnapshot()` em `snapshot-store.ts`.

**Dataset Generator — Schema Padronizado:**

Datasets gerados a partir de post-mortems completos seguem o schema:

```json
{
  "marketContext": { "symbol", "marketType", "snapshots": { "entry", "exit" }, "regime": { "trend", "volatility", "liquidity" } },
  "tradeExecution": { "position": { "side", "leverage", "entryPrice", "exitPrice", "durationSec", "pnl", "pnlPct" }, "executionModel": { "slippageBps", "feeBps" } },
  "autoAnnotation": { "classification", "motivators[]", "successFactors[]", "failureFactors[]", "lessons": { "repeat[]", "avoid[]" } },
  "prompt": { "system": "...", "user": "..." },
  "expected_response_schema": { "action", "confidence", "entry", "risk", "invalidations" }
}
```

- `sourceType`: `postmortem` com `sourceMetadata` contendo `isDemo`, `fingerprint`, `engineVersions`.
- `status`: `pending` para aprovação manual na página Training.
- `semhash`: hash semântico para deduplicação automática.

### 6.2.3 Ecossistema LLM (LoRA + RAG + Feedback Loop)

O ecossistema LLM integra adapters LoRA, RAG contextual e feedback loop para evolução contínua da inteligência de trading.

**Componentes:**

| Módulo | Arquivo | Descrição |
|--------|---------|-----------|
| LoRA Adapter Resolver | `lora-adapter-resolver.ts` | Resolução do modelo com cache Redis (TTL 60s) + fallback training-service |
| Trading RAG Client | `trading-rag-client.ts` | Consulta RAG contextual (sinais, post-mortems) + indexação de learnings |
| LoRA Job Manager | `lora-job-manager.ts` | Ativação/desativação de adapters + cópia de arquivos |

**Fluxo de Dados:**

```
┌─────────────────────────────────────────────────────┐
│                 CICLO DE EVOLUÇÃO                    │
│                                                      │
│  1. Geração de Sinais IA                             │
│     → resolveModelWithAdapter (LoRA se disponível)   │
│     → queryTradingRAGContext (learnings + docs)       │
│     → LLM gera sinal com contexto enriquecido        │
│                                                      │
│  2. Execução (Real ou Demo)                          │
│     → Posição aberta/fechada                         │
│                                                      │
│  3. Post-Mortem Automático                           │
│     → resolveModelWithAdapter (LoRA se disponível)   │
│     → queryPostMortemRAGContext (learnings anteriores)│
│     → LLM analisa com contexto acumulado             │
│                                                      │
│  4. Feedback Loop (automático)                       │
│     → indexPostMortemLearnings → RAG namespace        │
│     → Próximos sinais/post-mortems usam learnings    │
│                                                      │
│  5. Training (aprovação manual)                      │
│     → Dataset aprovado → QLoRA → Adapter por escopo  │
│     → activateLoraAdapter(namespace|agent)            │
│     → Próximos fluxos LLM usam adapter do contexto    │
└─────────────────────────────────────────────────────┘
```

**LoRA Adapter:**
- Escopo por **namespace** com override opcional por **agent**
- Treinado via QLoRA no gpu-trainer local
- Carregado dinamicamente no vLLM (`--enable-lora`, `--max-lora-rank 64`)
- Paths:
  - `/opt/alice/data/lora-adapters/namespaces/{namespaceId}`
  - `/opt/alice/data/lora-adapters/agents/{agentId}`
- Cache Redis contextual:
  - `alice:lora:active-adapter:{tenant}:{namespace}:{agent}` (integrations-service)
  - `alice:chat:lora:active-adapter:{tenant}:{namespace}:{agent}` (chat-service)

**RAG Contextual:**
- Consulta documentos/learnings do namespace do agente trading
- Sinais IA: estratégias, regras de mercado, indicadores preferidos
- Post-Mortems: análises anteriores de trades similares (símbolo, estilo, archetype)
- Indexação automática de post-mortems completados (feedback loop)

**Métricas Prometheus:**
- `alice_lora_resolve_total{result}` — resolução de modelo (adapter/base/error)
- `alice_lora_resolve_duration_seconds` — latência de resolução
- `alice_lora_cache_total{status}` — cache hit/miss/error
- `alice_trading_rag_query_total{type,result}` — consultas RAG (signal/postmortem)
- `alice_trading_rag_index_total{result}` — indexação de learnings

### 6.3 Fluxo de Embeddings (GPU Dedicada 24/7)

```mermaid
sequenceDiagram
    autonumber
    participant U as Usuário
    participant RAG as RAG Service
    participant Queue as Redis Queue
    participant Worker as Embedding Worker
    participant GPU as GPU Manager (Hetzner GEX44)
    participant Qdrant as Qdrant
    participant WS as WebSocket
    
    U->>RAG: Upload documento
    RAG->>RAG: Chunking (1000 chars)
    RAG->>Queue: Enqueue job {chunks, jobId}
    RAG-->>U: jobId (202 Accepted)
    
    loop Worker Background
        Worker->>Queue: Dequeue job
        Worker->>GPU: POST /embeddings (batch)
        Note over GPU: GPU dedicada 24/7
        GPU-->>Worker: Embeddings 1024 dim
        Worker->>Qdrant: Upsert vectors
        Worker->>WS: Notify completion
    end
    
    WS-->>U: "Documento indexado ✅"
```

---

## 7. Visão de Deployment

### 7.1 Diagrama de Deployment

```mermaid
C4Deployment
    title Alice Platform - Deployment View

    Deployment_Node(hetzner, "Hetzner Cloud", "Nuremberg, Germany") {
        Deployment_Node(vm, "GEX44 GPU Server", "Intel i5-13500 14 Core, 64GB DDR4, 2x 1.92TB NVMe RAID 1, RTX 4000 Ada 20GB") {
            Deployment_Node(docker, "Docker 29.1.2") {
                Container(caddy, "Caddy", "API Gateway")
                Container(services, "Alice Services", "7 containers")
                Container(obs, "Observability", "13 containers")
                Container(backup, "pgBackRest", "Backup")
            }
        }
        Deployment_Node(gpuServices, "GPU Services (Gate 2 - budget 20GB VRAM)", "Local GPU Services - SIMULTÂNEOS") {
            Container(gpuManager, "GPU Manager Service", "Fila priorizada, VRAM monitoring")
            Container(llm, "Qwen3 8B (AWQ)", "LLM texto (~6GB budget)")
            Container(qwen, "Qwen3-Embedding-0.6B INT8", "1024 dim (~3GB budget)")
        }
    }
    System_Ext(openai, "OpenAI APIs", "Vision (gpt-4.1) + Imagens (gpt-image-1) + ASR (gpt-4o-transcribe)")
    
    Rel(caddy, services, "HTTP")
    Rel(services, gpuServices, "HTTP", "GPU Inference (local)")
    Rel(services, openai, "HTTPS", "Vision e geração de imagens")
```

### 7.2 Estrutura de Volumes

```
/mnt/alice-data/                    # Volume Hetzner 100GB
├── data/                           # Dados persistentes
│   ├── postgresql/                 # PostgreSQL + pgvector
│   └── redis/                      # Cache persistente
├── uploads/                        # Mídia multimodal
│   ├── {tenantId}/                 # Isolamento por tenant
│   │   ├── image/
│   │   ├── audio/
│   │   └── document/
│   └── {tenantId}/                 # Uploads por tenant
├── backups/                        # Backups enterprise
│   ├── postgresql/                 # pgBackRest (WAL, PITR)
│   └── manifests/                  # Metadados JSON
└── logs/                           # Logs de serviços
```

### 7.3 Pipeline CI/CD Unificada (27/12/2025)

```mermaid
flowchart LR
    subgraph Development
        A[Git Push] --> B[GitHub Actions CI]
    end
    
    subgraph CI
        B --> C[Lint + Type Check]
        C --> D[Unit Tests]
        D --> E[Build Docker Images]
        E --> F[Push to GHCR]
    end
    
    subgraph CD
        F --> G[Create Release]
        G --> H[Deploy Hetzner]
        H --> I[Deploy Production Server]
        I --> J[Health Checks]
        J --> K[Rollback if failed]
    end
    
    subgraph Production
        K --> L[49 Containers Hetzner GEX44]
        L --> M[GPU Manager Service + 3 GPU Services (local)]
        M --> N[Prometheus Monitoring]
    end
```

> **Pipeline Enterprise (27/12/2025):** Deploy Server (CPX32 - 4 vCPU AMD EPYC, 8GB RAM) com Runner Enterprise Hardening (kernel tuning, Docker daemon, limits, systemd) + Production Server (GEX44 GPU). Todos os serviços GPU rodam localmente no servidor único, eliminando latência de rede.

> **Otimização CI Performance (27/12/2025):** Composite action `.github/actions/setup-node-pnpm` elimina duplicação de setup (14 execuções → 1x). Versões Node.js/pnpm calculadas uma vez no job `detect-changes` e passadas via outputs. Jobs que não precisam de Node.js (compliance-checks, trigger-release) não fazem setup. Economia estimada: ~6-10 minutos por run de CI.

> **Server GPU Optimizations (28/12/2025):** Servidor de produção Hetzner GEX44 otimizado para máxima performance GPU. **Docker daemon:** default-runtime nvidia (GPU como runtime padrão), live-restore true, BuildKit GC 20GB. **NVIDIA:** Persistence Mode ENABLED (GPU sempre ativa, sem cold start), CDI configurado em /etc/cdi/nvidia.yaml (Container Device Interface - best practice 2025), Container Toolkit 1.18.1. **Kernel sysctl:** vm.swappiness=10 (prioriza RAM), vm.dirty_ratio=40 (I/O throughput), kernel.shmmax=64GB (CUDA shared memory), net.core.rmem_max=16MB (buffers rede), fs.file-max=2M. **Hardware:** RTX 4000 Ada 20GB, Driver 580.95.05, CUDA 13.0. Servidor 100% limpo, 1.7TB disponível.

> **Pipeline Enterprise Pente Fino (10/02/2026):** Refatoração completa dos 3 workflows (ci.yml, release.yml, deploy-stack-modular.yml). **Funções Compartilhadas:** `scripts/release-functions.sh` (should_build, image_exists, retag_image, decide_build_or_retag — usadas por Build Microservices e Build GPU) e `infra/scripts/deploy-functions.sh` (verify_docker_credentials, pull_with_retry, pull_if_needed — usadas pelos 5 deploy jobs). Eliminação de ~660 linhas de duplicação (CLAUDE.md Regra 2). **Release:** 16 imagens Docker (13 microservices + 3 GPU), build condicional, smoke test com trap cleanup, release notes dinâmicas. **Deploy:** Smart Pull com detecção de retag via `built_images` da Release, retry consistente em todos os paths (5 tentativas, backoff progressivo 15/30/60/90/120s desde 11/02/2026). **CI:** Compliance unificado com gpu-manager-service incluído.

> **Deploy Enterprise Hardening (02/01/2026):** Workflow de deploy com validações enterprise completas. **Smoke Tests Pós-Deploy:** PostgreSQL (pg_isready), pgvector (operação vetorial real `SELECT '[1,2,3]'::vector <-> '[4,5,6]'::vector`), Redis (PING), Caddy (HTTP 80/443), GPU Manager (health endpoint), conectividade inter-serviços (Chat→GPU Manager via rede Docker). **Persistência de Logs:** Todos os logs de deploy salvos em `/opt/alice/logs/deploy-YYYYMMDD-HHMMSS.log` para troubleshooting futuro. **Validação pgBackRest:** Verifica existência do repositório, permissões (70:70 Alpine) via SSOT e corrige automaticamente se necessário. **pgBackRest Stanza Fix:** `pgbackrest-init` agora cria stanza sem precisar de `pg_control` (passa configs via CLI sem `pg1-*`), sincronizada após PostgreSQL iniciar. **Caddy Healthcheck:** Melhorado para verificar HTTP (portas 80/443) além de admin API (porta 2019). **SSOT Permissions (09/01/2026):** Permissões centralizadas em `infra/scripts/permissions-config.sh` para eliminar duplicação e inconsistências.

---

## 8. Conceitos Transversais

### 8.1 Segurança

#### 8.1.1 Autenticação Multi-Protocolo

```mermaid
flowchart TB
    subgraph External
        A[Google] --> OAuth
        B[GitHub] --> OAuth
        C[Azure AD] --> SAML
        D[Okta] --> SAML
    end
    
    subgraph Alice Auth
        OAuth --> E[Auth Service]
        SAML --> E
        E --> F[Session Redis]
        E --> G[JWT Token]
    end
    
    subgraph SSO
        E --> H[OIDC Provider]
        H --> J[Grafana]
    end
```

#### 8.1.2 RBAC - 6 Níveis de Acesso

| Role | Descrição | Exemplos de Permissão |
|------|-----------|----------------------|
| `super_admin` | Acesso total | Tudo |
| `admin` | Admin tenant | users:*, agents:*, training:* |
| `manager` | Gerente | conversations:*, reports:* |
| `operator` | Operador | conversations:read, trading:read |
| `viewer` | Visualizador | conversations:read, dashboard:read |
| `guest` | Convidado | public:read |

**Governança do Core e Gestão Administrativa (2026):**
- **Core da Alice**: edição protegida por `admin:alice_core:write` (prompts centrais).
- **Permissões**: CRUD de permissões e atribuição por role via painel administrativo.
- **Grupos organizacionais**: associação usuário↔grupo para organização interna (sem impacto direto em RBAC).
- **Onboarding seguro**: novos usuários entram como `guest` e criação de contas é admin-only.

#### 8.1.3 Row Level Security (RLS)

```sql
-- Exemplo de RLS policy para isolamento multi-tenant
CREATE POLICY "tenant_isolation" ON conversations
    USING (tenant_id = current_tenant_id());

-- Tabelas com RLS ativo (17/12/2025):
-- conversations, messages, agents, documents, embeddings,
-- training_data, fine_tuning_jobs, trading_signals,
-- trading_orders, trading_positions, trading_risk_config,
-- trading_audit_log, trading_dataset, lora_jobs,
-- trading_control_history
```

#### 8.1.4 Security Hardening

| Medida | Cobertura | Status |
|--------|-----------|--------|
| `no-new-privileges` | 49/49 containers | ✅ 100% |
| `read_only: true` | 25/49 containers | ✅ Onde aplicável |
| Resource limits | 49/49 containers | ✅ 100% |
| SHA256 digests | 26 imagens | ✅ 100% |
| Healthchecks | 38/38 containers | ✅ 100% |

### 8.2 Observabilidade

#### 8.2.1 Stack Completo

```mermaid
flowchart TB
    subgraph Applications
        A[Alice Services] --> B[Prometheus Metrics]
        A --> C[Pino Logs]
        A --> D[OpenTelemetry Traces]
    end
    
    subgraph Collection
        B --> E[Prometheus]
        C --> F[Promtail]
        D --> G[OTel Collector]
    end
    
    subgraph Storage
        E --> H[Prometheus TSDB]
        F --> I[Loki]
        G --> J[Jaeger]
    end
    
    subgraph Visualization
        H --> K[Grafana]
        I --> K
        J --> K
    end
    
    subgraph Alerting
        K --> L[Grafana Alerting]
        L --> M[Email SMTP]
    end
    
    subgraph LLM Specific
        A --> N[Langfuse]
        N --> O[LLM Analytics]
    end
```

#### 8.2.2 Métricas Prometheus

| Categoria | Métricas | Labels |
|-----------|----------|--------|
| **HTTP** | `alice_http_request_duration_seconds` | method, route, status |
| **LLM** | `alice_llm_inference_duration_seconds` | model, tenant_id |
| **RAG** | `alice_rag_search_duration_seconds` | namespace |
| **Trading** | `alice_trading_orders_total` | type, status |
| **Cache** | `alice_response_cache_hits_total` | tenant_id |
| **Circuit Breaker** | `alice_circuit_breaker_state` | name |

### 8.3 Resiliência

#### 8.3.1 Circuit Breakers

```typescript
// Presets enterprise definidos em circuit-breaker.ts
const PRESETS = {
  default: { threshold: 5, timeout: 30000, resetTimeout: 30000 },
  kucoinFutures: { threshold: 3, timeout: 10000, resetTimeout: 60000 },
  embeddingsGPU: { threshold: 3, timeout: 60000, resetTimeout: 120000 },
  whisper: { threshold: 3, timeout: 120000, resetTimeout: 180000 },
};
```

#### 8.3.2 Retry Policies

| Serviço | Max Retries | Backoff | Timeout |
|---------|-------------|---------|---------|
| LLM Inference | 3 | Exponential | 60s |
| Embeddings GPU | 3 | Exponential | 60s |
| KuCoin API | 3 | Linear | 10s |
| Stripe Webhooks | 5 | Exponential | 30s |

### 8.4 Performance

#### 8.4.1 Caching Strategy

```mermaid
flowchart LR
    subgraph L1 [L1 Cache - In-Process]
        A[Node.js Memory]
    end
    
    subgraph L2 [L2 Cache - Distributed]
        B[Redis]
    end
    
    subgraph L3 [L3 Cache - Response]
        C[Greetings Gate]
    end
    
    subgraph Source [Source of Truth]
        D[PostgreSQL]
        E[Qdrant]
    end
    
    Request --> L1
    L1 -->|Miss| L2
    L2 -->|Miss| L3
    L3 -->|Miss| Source
```

#### 8.4.2 Connection Pooling

| Recurso | Pool Size | Timeout |
|---------|-----------|---------|
| PostgreSQL | 20 | 30s |
| Redis | 10 | 10s |
| HTTP Clients | 100 | 30s |

### 8.5 Logging

#### 8.5.1 Structured Logging (Pino)

```typescript
// Padrão de log enterprise
logger.info({
  correlationId: req.headers['x-correlation-id'],
  tenantId: req.tenantId,
  userId: req.userId,
  method: req.method,
  path: req.path,
  statusCode: res.statusCode,
  latencyMs: Date.now() - startTime,
}, 'Request completed');
```

#### 8.5.2 Log Levels

| Ambiente | Level | Destination |
|----------|-------|-------------|
| Development | `debug` | Console (pino-pretty) |
| Production | `info` | JSON → Promtail → Loki |

---

## 9. Decisões Arquiteturais (ADRs)

### ADR-001: Gate 2 - LLM local + Vision via OpenAI

| Aspecto | Decisão |
|---------|---------|
| **Status** | Aceito (Atualizado 16/01/2026) |
| **Contexto** | Necessidade de LLM local com orçamento de 20GB VRAM e visão confiável para análise de imagens sem manter VLM local |
| **Decisão** | Manter **LLM (texto)** local via GPU Manager e mover **Vision/Imagens** para OpenAI (Responses + Images APIs) |
| **Alternativas** | VLM local dedicado (maior VRAM, maior complexidade operacional) |
| **Consequências** | + VRAM liberada para LLM/Embeddings/Training, + menor complexidade GPU local, + evolução rápida de visão, - dependência de API externa para visão/imagens |

### ADR-002: Arquitetura de Embeddings

| Aspecto | Decisão |
|---------|---------|
| **Status** | Aceito |
| **Contexto** | Embeddings de alta qualidade para RAG e Trading |
| **Decisão** | Qwen3-Embedding-0.6B (1024 dim) → Qdrant; imagens usam OpenAI Vision (descrição textual, sem embeddings de imagem) |
| **Alternativas** | Outros modelos 1024 dim com restrições de licença/uso comercial (avaliar caso a caso) |
| **Consequências** | + Dimensão consistente (1024) em toda a plataforma, + storage menor, + compatível com budgets de VRAM |

### ADR-003: Multi-Tenancy com RLS

| Aspecto | Decisão |
|---------|---------|
| **Status** | Aceito |
| **Contexto** | Isolamento de dados entre tenants |
| **Decisão** | Row Level Security (RLS) no PostgreSQL |
| **Alternativas** | Schema por tenant, Database por tenant |
| **Consequências** | + Simplicidade, + Performance, - Complexidade de queries |

### ADR-004: GPU Dedicada 24/7 (Hetzner GEX44)

| Aspecto | Decisão |
|---------|---------|
| **Status** | Aceito (atualizado 26/12/2025) |
| **Contexto** | Gerenciamento de requisições GPU no servidor dedicado |
| **Decisão** | GPU Manager Service com fila priorizada (Redis) + Monitoramento VRAM + GPU dedicada 24/7 (sem cold start) |
| **Alternativas** | Sem gerenciamento centralizado |
| **Consequências** | + Otimização de VRAM, + Priorização de requisições, + Latência mínima (local), + Sem cold start |

### ADR-005: Response Cache (Greetings Gate)

| Aspecto | Decisão |
|---------|---------|
| **Status** | Aceito (17/12/2025) |
| **Contexto** | Mensagens simples ativavam GPU desnecessariamente |
| **Decisão** | Cache Redis para saudações (TTL 24h, respostas pré-definidas) |
| **Alternativas** | Sempre usar LLM, Modelo local pequeno |
| **Consequências** | + Economia GPU ~5-10%, + Latência < 10ms para saudações |

### ADR-006: Trading Architecture

| Aspecto | Decisão |
|---------|---------|
| **Status** | Aceito |
| **Contexto** | Trading BTC Futures via chat com IA |
| **Decisão** | Parser NLP + Orchestrator (handover/takeover) + KuCoin Client |
| **Alternativas** | UI-only trading, Webhooks automáticos |
| **Consequências** | + UX natural, + Controle IA/Manual, - Complexidade de parsing |

### ADR-009: Técnicas de Trading + Ensemble + Arbitragem Triangular

| Aspecto | Decisão |
|---------|---------|
| **Status** | Aceito (02/02/2026) |
| **Contexto** | Sinais IA e Análise determinística precisavam usar múltiplas técnicas, com ranking de confiança e comparação direta entre LLM (GPU) e código (CPU). Arbitragem triangular requer validação explícita de custos (taxas + slippage) e timeframes curtos. |
| **Decisão** | Adotar um **conjunto enterprise de técnicas** (scalping, day_trade, swing, position, trend, mean_reversion, breakout, range, momentum, arbitrage_triangular). Implementar **ensemble_top3** com `topN` configurável, retornando sinal consolidado + top 3 contribuições. **Configurações idênticas** nas abas Sinais IA e Análise (diferença apenas no modo de execução). Arbitragem triangular **apenas Spot/Margin**, com validação obrigatória de taxas, slippage e edge mínimo; exchange selector exibido com **KuCoin** (preparado para multi-exchange futuro). |
| **Consequências** | + Sinal consolidado com ranking transparente; + Comparação IA vs determinístico com mesmas configs; + Arbitragem segura com validações de custo; - Mais parâmetros na UI; - Necessidade de dados de order book sempre atualizados. |

### ADR-007: Arquitetura Multi-Stack Modular (05/01/2026)

| Aspecto | Decisão |
|---------|---------|
| **Status** | Aceito |
| **Data** | 05 de Janeiro de 2026 |
| **Alternativas** | (1) Kubernetes com namespaces - rejeitado por complexidade excessiva para 49 containers; (2) Docker Swarm stacks - rejeitado por falta de GPU support nativo; (3) Manter monolítico - rejeitado pelo problema de rollback total |

**Arquivos Criados:**
- `infra/docker/stacks/docker-compose.base.yml` - Networks e volumes compartilhados
- `infra/docker/stacks/docker-compose.infra.yml` - Stack de infraestrutura (10 containers)
- `infra/docker/stacks/docker-compose.alice.yml` - Stack Alice + GPU (8 + 5 containers)
- `infra/docker/stacks/docker-compose.observability.yml` - Stack de observabilidade (13 containers)
- `infra/docker/stacks/docker-compose.backup.yml` - Stack de backup (2 containers: pgbackrest + pgbackrest-exporter)
- `.github/workflows/deploy-stack.yml` - Workflow para deploy/rollback por stack

**Ordem de Deploy:**
1. INFRA (obrigatório primeiro)
2. Drizzle push (migrações)
3. ALICE + OBSERVABILITY (paralelos)
5. BACKUP (após postgres healthy)

**Histórico de Versões:**
- Cada stack mantém `/opt/alice/versions/{stack}.current` e `{stack}.previous`
- Rollback usa versão anterior automaticamente

### ADR-008: Release Consolidado (06/01/2026) - ATUALIZADO

| Aspecto | Decisão |
|---------|---------|
| **Status** | **Revertido/Atualizado** |
| **Data** | 06 de Janeiro de 2026 |
| **Contexto** | O workflow `release-modular.yml` com Matrix Strategy foi experimentado mas apresentou complexidade excessiva e problemas de coordenação entre jobs. A abordagem consolidada (`release.yml`) provou ser mais robusta e confiável. |
| **Decisão** | Manter o workflow **consolidado** (`release.yml`) com build sequencial otimizado (retag inteligente). O `release-modular.yml` foi **REMOVIDO** do repositório. |
| **Alternativas** | Matrix Strategy experimental foi testada mas removida por complexidade |
| **Consequências** | + Simplicidade e confiabilidade; + Menos coordenação entre jobs; + Disparo automático de deploy funciona 100%; - Build sequencial (mas otimizado com retag inteligente) |

**Arquitetura Release Consolidado:**

```yaml
# release.yml - Jobs principais
create-release:
  # Cria tag Git, gera changelog
  
build-images:
  needs: create-release
  # Build 16 imagens (13 microservices + 3 GPU)
  # Retag inteligente via scripts/release-functions.sh (só builda o que mudou)
  
trigger-deploy:
  needs: build-images
  # Dispara deploy-stack-modular.yml automaticamente
```

**Características:**
1. **create-release**: Cria tag Git, gera changelog automático
2. **build-images**: Build condicional com diff analysis, retag inteligente
3. **smoke-test**: PostgreSQL + pgvector (detecta SIGILL/AVX-512)
4. **trigger-deploy**: Dispara `deploy-stack-modular.yml` via `workflow_dispatch`

**Performance:**
- Build sequencial otimizado: ~5-10min (retag inteligente economiza tempo)
- Deploy modular: ~10min (5 stacks em paralelo)

**Workflow File:** `.github/workflows/release.yml`

### ADR-009: Deploy Modular com Jobs Independentes (06/01/2026)

| Aspecto | Decisão |
|---------|---------|
| **Status** | Aceito |
| **Data** | 06 de Janeiro de 2026 |
| **Contexto** | Deploy workflow v2 (`deploy-stack.yml`) tinha um único job "deploy-all" com 5 stacks deployados **sequencialmente** via SSH (~30min). Rollback automático só funcionava se TODOS os stacks falhassem. Rollback manual exigia `workflow_dispatch` separado. Violava best practices para pipelines modulares enterprise. |
| **Alternativas** | (1) Manter monolítico com bash case - rejeitado por impossibilitar paralelização e rollback cirúrgico; (2) Matrix strategy para stacks - rejeitado por não permitir dependências condicionais entre stacks; (3) Separate workflows por stack - rejeitado por duplicação de código |
| **Consequências** | + 66% mais rápido (~10min vs ~30min); + Rollback cirúrgico (só stack com falha); + Produção parcial real; + Paralelização de 4 stacks após infra; + Logs isolados por stack; + Rollback manual integrado; + Health checks completos (49 containers); - Maior número de jobs (15 vs 1); - Maior complexidade de `needs` e condições |

**Arquitetura Jobs Independentes:**

```yaml
deploy-alice:
  needs: [validate, prepare, drizzle-push]
  if: |
    (needs.validate.outputs.deploy_alice == 'true') &&
    (needs.drizzle-push.result == 'success' || needs.drizzle-push.result == 'skipped')
  # Deploy alice stack

health-alice:
  needs: [deploy-alice]
  if: needs.deploy-alice.result == 'success'
  # Health check: alice-frontend, alice-auth, alice-chat, alice-rag, alice-training, alice-integrations, alice-observability, gpu-manager-service

rollback-alice:
  needs: [deploy-alice, health-alice]
  if: failure() && needs.deploy-alice.result == 'success' && needs.health-alice.result == 'failure'
  # Rollback automático
```

**Características Enterprise:**
1. **Isolamento Docker Compose**: Cada stack usa `-p alice-{stack}` (project name único)
2. **External Networks/Volumes**: Recursos compartilhados via `docker-compose.base.yml` preservados entre deploys/rollbacks
3. **Health Checks Robustos**: Retry logic 30-45x, logs detalhados
4. **Rollback Modes**:
   - **Automático**: Dispara se health check FALHAR após deploy SUCCESS
   - **Manual**: `rollback: true` + `rollback_version: vX.Y.Z` via `workflow_dispatch`
5. **Race Condition Free**: `IMAGE_TAG` passado direto via env var (não modifica `.env.prod`)
6. **Validação Completa**: Checa `rollback_version` format, external volumes, drizzle-push dependencies

**Ordem de Deploy (Paralelo):**
```
prepare → deploy-infra → health-infra → drizzle-push
                                           ↓
                        ┌──────────────────┼──────────────────┬──────────────┐
                        │                  │                  │              │
                        │                  │                  │              │
                        └──────────────────┴──────────────────┴──────────────┘
                                           ↓
                                        notify
```

**Performance:**
- v2 (sequencial): 5 stacks x ~6min/cada = ~30min

**Workflow File:** `.github/workflows/deploy-stack-modular.yml`

**Bugs Corrigidos na v3:**
- ✅ `$GITHUB_OUTPUT` em SSH scripts (não funciona no servidor remoto)
- ✅ Race condition em rollbacks paralelos (sed modificando `.env.prod`)
- ✅ Missing `drizzle-push` job (migrations não rodavam em fresh deploys)
- ✅ Dependency `jq` não instalado (trocado por pure-bash `urlencode`)
- ✅ External volumes não criados (faltava `-f docker-compose.base.yml`)
- ✅ Rollback manual não funcionava (inputs ignorados)
- ✅ UTF-8 encoding incorreto (`urlencode` sem `LC_ALL=C`)
- ✅ 14 bugs críticos adicionais identificados e corrigidos

### ADR-010: Single Source of Truth para Versões de Imagens Docker (07/01/2026)

| Aspecto | Decisão |
|---------|---------|
| **Status** | Aceito |
| **Data** | 07 de Janeiro de 2026 |
| **Contexto** | Versões de imagens Docker públicas estavam hardcoded em múltiplos docker-compose files, causando: (1) inconsistência entre versões declaradas e deployadas; (2) dificuldade de atualização (modificar 30+ lugares); (3) falhas de deploy por imagens descontinuadas (ex: MinIO Docker Hub); (4) impossibilidade de validação automática antes do deploy. Violava Regra 6 (PROIBIDO hardcoded) e Regra 11 (seguir docs oficiais). |
| **Decisão** | Centralizar TODAS as versões de imagens públicas em `infra/versions.env` (Single Source of Truth - SSOT). Docker-compose files usam `${VAR:-default}` para referenciar. Deploy workflow valida existência das imagens ANTES do deploy. Atualizações feitas manualmente via processo quinzenal documentado em CLAUDE.md. |
| **Alternativas** | (1) Manter hardcoded - rejeitado por violar Regra 6; (2) Usar apenas Dependabot - rejeitado por não resolver validação pré-deploy; (3) Versões no .env.prod apenas - rejeitado por não ser versionado no Git |
| **Consequências** | + Consistência total entre docker-compose e deploy; + Validação automática de imagens públicas; + Git history completo de mudanças de versão; + Atualizações manuais controladas e testadas; + Fallbacks robustos `${VAR:-default}`; - Mais variáveis no versions.env (28+); - Dependência de arquivo externo em docker-compose |

**Arquitetura SSOT:**

```
infra/versions.env (SSOT - 28 variáveis)
        ↓
docker-compose.*.yml (usa ${VAR:-default})
        ↓
deploy-stack-modular.yml (valida imagens via SSOT)
        ↓
generate-env-prod.sh (gera .env.prod com versões)
        ↓
.env.prod (produção - com todas as versões)
```

**Categorias de Versões (versions.env):**

| Stack | Variáveis | Quantidade |
|-------|-----------|------------|
| INFRA | `REDIS_ALICE_VERSION`, `QDRANT_VERSION`, `SEARXNG_VERSION`, `MINIO_*` | 8 |
| OBSERVABILITY | `PROMETHEUS_VERSION`, `GRAFANA_VERSION`, `LOKI_VERSION`, `LANGFUSE_*`, etc | 14 |
| Utilities | `BUSYBOX_VERSION`, `PGVECTOR_TAG` | 3 |

**Validação de Imagens Públicas:**
- Step `Validar imagens públicas (Docker Hub + Quay.io)` no job `prepare`
- Usa `docker manifest inspect` para verificar existência
- Fail-fast: detecta imagens inexistentes no CI, não no servidor
- Evita falhas de deploy por imagens descontinuadas

**Atualização Manual de Versões (07/01/2026):**
- Estratégia migrada para atualizações manuais quinzenais
- Security alerts via GitHub continuam ativos automaticamente
- Processo documentado em `CLAUDE.md` seção "Atualização de Dependências"
- Critérios: CVE CRITICAL/HIGH (imediato), Major (quando necessário), Minor/Patch (quinzenal)

**Workflow File:** `.github/workflows/deploy-stack-modular.yml` (step: `validate-public-images`)

### ADR-011: Smart Deploy - Deploy Inteligente com Detecção de Stacks Healthy (09/01/2026)

| Aspecto | Decisão |
|---------|---------|
| **Status** | Aceito |
| **Data** | 09 de Janeiro de 2026 |
| **Contexto** | Deploy modular executava TODOS os stacks selecionados independentemente do estado atual no servidor. Se INFRA e BACKUP estivessem healthy mas ALICE falhasse, próximo deploy re-deployava os 3 desnecessariamente. Isso: (1) desperdiçava tempo (~5-10min por stack healthy); (2) arriscava desestabilizar stacks funcionais; (3) não aproveitava vantagem real do design modular. |
| **Decisão** | Implementar `smart_deploy` que detecta estado de cada stack no servidor via SSH e pula stacks healthy. Fluxo: (1) `smart_deploy=false` comportamento tradicional; (2) `smart_deploy=true + stack=all` verifica servidor, pula healthy; (3) `smart_deploy=true + stack=X` força deploy do X mesmo se healthy. |
| **Alternativas** | (1) Manter deploy tradicional - rejeitado por desperdício; (2) Cache local de estado - rejeitado por inconsistência; (3) Detectar apenas via Docker API - rejeitado por não capturar health real |
| **Consequências** | + Economia de tempo (pula stacks healthy); + Preservação de dados (não re-deploya funcionais); + Deploy cirúrgico (apenas problemáticos); + Produção parcial real; - Complexidade do workflow (detecção via SSH); - Depende de SSH funcional para detecção |

**Funcionamento Smart Deploy:**

```
deploy-stack-modular.yml (v3.1.0)
        ↓
[smart_deploy=true?]
        ↓ SIM
step server-health (SSH)
        ↓
Detecta containers por stack
        ↓
Verifica health (healthy/unhealthy/missing)
        ↓
step capture-health (SCP download status)
        ↓
step parse-health (propaga outputs)
        ↓
[Stack healthy?] → PULA deploy
        ↓ NÃO
[Stack unhealthy/missing?] → EXECUTA deploy
```

**Cenários de Uso:**

| Cenário | Comando | Comportamento |
|---------|---------|---------------|
| Deploy tradicional | `stack=all smart_deploy=false` | Deploya todos os 5 stacks |
| Deploy inteligente | `stack=all smart_deploy=true` | Pula stacks healthy |
| Forçar stack | `stack=alice smart_deploy=true` | Deploya alice mesmo se healthy |
| Após falha parcial | `stack=all smart_deploy=true` | Deploya apenas os que falharam |

**Bug Fixes PR#96 (09/01/2026):**

| Bug | Causa Raiz | Solução |
|-----|-----------|---------|
| pgBackRest SSH | `PGBACKREST_PG1_HOST` forçava SSH | Usar variáveis libpq (PGHOST, PGPORT) |
| Vector healthcheck | Alpine não tem bash | Usar `nc -z` (netcat) |
| Smart Deploy outputs | `server-health` não produz outputs | Usar `parse-health` |
| Rollback validation | Docker filter não suporta regex | Usar grep com regex |

**Arquitetura Redis Enterprise:**

| Stack | Container | Versão | Propósito |
|-------|-----------|--------|-----------|
| INFRA | `alice-redis` | 7.4.7-alpine | Cache Alice, Rate limiting |


**Workflow File:** `.github/workflows/deploy-stack-modular.yml` (v3.1.0)

---

### ADR-012: SSOT para Gestão de Permissões (09/01/2026)

**Status:** ✅ Aceito

**Contexto:**
O deploy em produção falhava consistentemente na validação de permissões porque dois scripts (`prepare-production-server.sh` e `fix-production-permissions.sh`) gerenciavam as mesmas permissões com valores DIFERENTES:
- langfuse-db: 755 vs 700
- caddy: 700 vs 755
- backups/postgresql: 750 vs 755

Isso violava as Regras 2 (Não duplicar) e 6 (Enterprise-grade) do CLAUDE.md.

**Decisão:**
Implementar SSOT (Single Source of Truth) para permissões:

1. **Arquivo Central**: `infra/scripts/permissions-config.sh` define TODOS os UIDs/GIDs/permissões
2. **Scripts Derivados**: Ambos os scripts fazem `source` do SSOT ao invés de valores hardcoded
3. **Delegação**: `prepare-production-server.sh` delega TODA lógica de permissões para `fix-production-permissions.sh`

**Arquitetura:**
```
permissions-config.sh (SSOT)
         ↓
    ┌────────────────────────────┬──────────────────────────────────┐
    ↓                            ↓                                  ↓
prepare-production-server.sh  fix-production-permissions.sh  (scripts futuros)
```

**Benefícios:**
- ✅ Zero duplicação de valores de permissões
- ✅ Consistência garantida entre scripts
- ✅ Manutenção simplificada (alterar em um lugar atualiza tudo)
- ✅ Validação recursiva com detecção de bits especiais (setgid/setuid/sticky)
- ✅ chmod 0xxx (com prefixo 0) para garantir remoção de bits especiais

**Permissões Críticas:**
| Serviço | UID | Permissão | Justificativa |
|---------|-----|-----------|---------------|
| PostgreSQL | 70 | 700 | Alpine UID, security hardening obrigatório |
| Langfuse DB | 70 | 700 | PostgreSQL strict mode |
| Caddy | 1000 | 755 | Web server, serve certificados públicos |
| Backups | 70 | 755 | pgBackRest Alpine, root deve poder ler |

**Documentação:** `docs/operations/permissions.md`

**REF:** CLAUDE.md Regra 2 (Não duplicar), Regra 6 (Enterprise-grade), Regra 7 (Causa raiz)

---

### ADR-013: Jaeger Healthcheck - Alpine vs Distroless (07/01/2026)

**Status:** ✅ Aceito - NENHUMA AÇÃO NECESSÁRIA

**Contexto:**
Investigação detalhada da imagem Docker `jaegertracing/jaeger:2.13.0` para determinar se era necessário migrar para variante `-debug`.

**Descobertas:**
1. ✅ **Imagem v2 é Alpine Linux 3.22** (não distroless/scratch)
2. ✅ **wget está disponível** (busybox wget)
3. ✅ **Healthcheck funciona perfeitamente** (testado e validado)
4. ❌ **Tag `-debug` NÃO EXISTE** para versão 2.13.0

**Análise Técnica:**
```bash
$ docker run --rm --entrypoint /bin/sh jaegertracing/jaeger:2.13.0 -c "cat /etc/os-release"
NAME="Alpine Linux"
VERSION_ID=3.22.2
```

**Por que v2 é diferente de v1:**
- **Jaeger v1** (EOL 31/12/2025): tinha variantes all-in-one, agent, collector separados com opções distroless
- **Jaeger v2** (atual): unificou tudo em uma **única imagem baseada em Alpine**

**Healthcheck Atual (CORRETO):**
```yaml
healthcheck:
  test: ["CMD", "wget", "--spider", "-q", "http://localhost:16686/"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 60s
```

**Decisão:** Manter configuração atual. Nenhuma mudança necessária.

**REF:** `infra/docker/stacks/docker-compose.observability.yml`

---

### ADR-014: Tarball Deploy para Scripts SSOT (09/01/2026)

**Status:** ✅ Aceito

**Contexto:**
O deploy em produção falhava porque os scripts SSOT (`permissions-config.sh`, `fix-production-permissions.sh`) não eram transferidos para o servidor antes da execução de `prepare-production-server.sh`.

**Problema:**
- `prepare-production-server.sh` era baixado do GitHub via curl usando tag da release
- Mas a tag não existe durante o deploy (é criada após)
- Resultado: curl falhava e scripts dependentes não eram encontrados

**Alternativas Consideradas:**

| Alternativa | Prós | Contras |
|-------------|------|---------|
| **Curl do GitHub** | Simples | Tag não existe durante deploy |
| **Rsync incremental** | Eficiente para mudanças pequenas | Complexo, não garante atomicidade |
| **SCP direto** | Simples | 3 transferências separadas, pode falhar parcialmente |
| **Tarball + SCP** | Atômico, comprimido | Requer extração |

**Decisão:** Tarball + SCP (transferência atômica)

**Implementação:**
```yaml
# Step 1: No GitHub Runner (local)
- Validar que scripts existem
- tar czf /tmp/alice-scripts.tar.gz scripts/
- scp tarball para servidor:/tmp/

# Step 2: No Servidor Produção
- tar xzf alice-scripts.tar.gz
- chmod +x scripts/*.sh
- Validar todos os scripts presentes
- sudo bash prepare-production-server.sh
```

**Benefícios:**
- ✅ **Atômico**: Tudo ou nada (sem estado parcial)
- ✅ **Independente de tag**: Usa arquivos do checkout local
- ✅ **Comprimido**: Gzip reduz tempo de transferência
- ✅ **Validação dupla**: Antes de empacotar E antes de executar
- ✅ **Enterprise-grade**: Padrão industrial para distribuição

**REF:** CLAUDE.md Regra 6 (Enterprise-grade), Regra 9 (Validação contínua)

### ADR-015: Ecossistema LLM - LoRA + RAG + Feedback Loop para Trading (09/02/2026)

**Status:** ✅ Aceito

**Contexto:**
A geração de sinais IA e análise post-mortem usavam apenas o modelo base (Qwen3 8B) sem aproveitar o ecossistema de aprendizado da plataforma (agentes especializados, RAG, fine-tuning). Cada chamada LLM era isolada, sem contexto de trades anteriores ou conhecimento acumulado.

**Problema:**
- Sinais IA não consideravam learnings de trades anteriores
- Post-mortems não usavam conhecimento acumulado para melhorar análises
- Adapters LoRA treinados não eram aplicados na inferência de trading
- Não havia ciclo de feedback entre post-mortems e futuras gerações

**Alternativas Consideradas:**

| Alternativa | Prós | Contras |
|-------------|------|---------|
| **LoRA per-tenant** | Personalização por cliente | Fragmentação, custo de storage, complexidade |
| **LoRA global** | Compartilhamento de learnings, simplicidade | Menos personalização por tenant |
| **RAG only (sem LoRA)** | Simples, imediato | Sem melhoria do modelo base |
| **LoRA + RAG + Feedback** | Evolução contínua, ciclo fechado | Mais complexo, requer orquestração |

**Decisão:** LoRA global + RAG contextual + Feedback Loop automático

**Implementação:**
1. `lora-adapter-resolver.ts` — Resolve modelo com cache Redis + fallback HTTP ao training-service
2. `trading-rag-client.ts` — Consulta RAG contextual + indexação de learnings
3. `lora-job-manager.ts` — Gestão de adapters (ativar/desativar/copiar)
4. vLLM configurado com `--enable-lora --max-lora-rank 64`
5. Métricas Prometheus para LoRA resolution, RAG queries e feedback indexing

**Benefícios:**
- ✅ **Evolução contínua**: Cada trade melhora a inteligência futura
- ✅ **Ciclo fechado**: Sinal → Execução → Post-Mortem → RAG → Sinal melhorado
- ✅ **Fallback seguro**: Se adapter ou RAG indisponível, usa modelo base
- ✅ **Observabilidade**: Métricas Prometheus + dashboards Grafana dedicados
- ✅ **Enterprise-grade**: Cache Redis, retry logic, circuit breakers

**REF:** CLAUDE.md Regra 6 (Enterprise-grade), Regra 11 (Best practices 2025), vLLM LoRA documentation

### ADR-016: Funções Compartilhadas na Pipeline CI/CD (10/02/2026)

**Status:** ✅ Aceito

**Contexto:**
Os 3 workflows da pipeline (ci.yml, release.yml, deploy-stack-modular.yml) continham lógica duplicada em larga escala: funções de build/retag repetidas 2x no release, funções de pull/credentials repetidas 5x no deploy (uma por stack), e arrays de serviços duplicados no CI. Violava Regra 2 (Não Duplicar) e Regra 6 (Enterprise-grade).

**Problema:**
- ~660 linhas de código duplicado nos workflows
- Bug em `pull_if_needed()` com retry inconsistente (paths com e sem retry)
- `BUILD_PATTERN` usando IMAGE ao invés de CONTEXT para GPU services (qwen-trainer)
- `write_docker_auth()` vulnerável a injection via interpolação bash
- Código morto: changelog duplicado, Compliance Summary cosmético, dead case entries

**Alternativas Consideradas:**

| Alternativa | Prós | Contras |
|-------------|------|---------|
| **Composite Actions** | Reutilizável, versionável | Overhead de manutenção, limites de outputs |
| **Reusable Workflows** | Completo, compartilhável | Complexidade de inputs/outputs, requer repo |
| **Scripts externos (.sh)** | Simples, source direto, testável localmente | Requer cópia para servidor |

**Decisão:** Scripts externos bash com `source` (approach mais simples e enterprise)

**Implementação:**
1. `scripts/release-functions.sh` — `should_build()`, `image_exists()`, `retag_image()`, `decide_build_or_retag()`, `CHANGED_FILES`
2. `infra/scripts/deploy-functions.sh` — `verify_docker_credentials()`, `pull_with_retry()`, `pull_if_needed()`
3. Deploy copia `deploy-functions.sh` para `/opt/alice/scripts/` no job `prepare`
4. Cada deploy job faz `source /opt/alice/scripts/deploy-functions.sh`

**Benefícios:**
- ✅ **Regra 2 cumprida**: ~660 linhas de duplicação eliminadas
- ✅ **Retry consistente**: `pull_with_retry()` com 5 tentativas + backoff progressivo 15/30/60/90/120s em TODOS os paths (11/02/2026)
- ✅ **Testável**: Scripts podem ser executados e testados independentemente
- ✅ **Manutenível**: Correção em 1 lugar propaga para todos os consumidores
- ✅ **Seguro**: `write_docker_auth()` usa env vars Python ao invés de interpolação bash

**REF:** CLAUDE.md Regra 2 (Não Duplicar), Regra 6 (Enterprise-grade), Regra 7 (Mudanças Cirúrgicas)

---

## 10. Aderência às 18 Regras

### Mapeamento Completo

| # | Regra | Implementação | Status |
|---|-------|---------------|--------|
| 1 | **LER ANTES DE AGIR** | Workflow de diagnóstico em todas as features | ✅ |
| 2 | **NÃO DUPLICAR** | `packages/shared-utils` para código comum; `scripts/release-functions.sh` e `infra/scripts/deploy-functions.sh` para CI/CD | ✅ |
| 3 | **WORKFLOW ESTRUTURADO** | Diagnóstico → Plano → Aprovação → Implementação | ✅ |
| 4 | **APROVAÇÃO OBRIGATÓRIA** | PR review obrigatório para changes grandes | ✅ |
| 5 | **NÃO MENTIR** | Logs estruturados, métricas reais | ✅ |
| 6 | **SEM SOLUÇÕES TEMPORÁRIAS** | Zero mocks em produção, PostgreSQL para tudo | ✅ |
| 7 | **MUDANÇAS CIRÚRGICAS** | Commits atômicos, rollback automático | ✅ |
| 8 | **QUALIDADE OBRIGATÓRIA** | TypeScript strict, zero `any`, Pino | ✅ |
| 9 | **VALIDAÇÃO CONTÍNUA** | CI/CD com tests, linting, type-check | ✅ |
| 10 | **DOCUMENTAÇÃO PT-BR** | Toda documentação em português | ✅ |
| 11 | **SEGUIR DOCS OFICIAIS** | Versões latest, best practices 2025 | ✅ |
| 12 | **PRODUÇÃO HETZNER** | Deploy automático via GitHub Actions | ✅ |
| 13 | **INTERNACIONALIZAÇÃO** | i18n PT-BR primário, EN secundário | ✅ |
| 14 | **VERIFICAR SECRETS** | GitHub Secrets, secrets em arquivo | ✅ |
| 15 | **MICROSSERVIÇOS** | `apps/` para serviços, `packages/` compartilhado | ✅ |
| 16 | **MELHORES PRÁTICAS** | Circuit breakers, health checks, rate limiting | ✅ |
| 17 | **REVIEW ANTES DO COMMIT** | Review automático Cursor, commits consolidados | ✅ |
| 18 | **COMMITS CONSOLIDADOS** | Commits enterprise com múltiplas mudanças | ✅ |

---

## 11. 12-Factor App Compliance

### Mapeamento Completo

| # | Fator | Implementação | Status |
|---|-------|---------------|--------|
| 1 | **Codebase** | Monorepo Git, branches por feature | ✅ |
| 2 | **Dependencies** | `pnpm-lock.yaml`, versions pinadas | ✅ |
| 3 | **Config** | Environment variables, Zod validation | ✅ |
| 4 | **Backing Services** | PostgreSQL, Redis, Qdrant como attached resources | ✅ |
| 5 | **Build, Release, Run** | CI → GHCR → Deploy separados | ✅ |
| 6 | **Processes** | Stateless Node.js, state em Redis/PostgreSQL | ✅ |
| 7 | **Port Binding** | Express exporta via porta configurável | ✅ |
| 8 | **Concurrency** | Horizontal scaling via replicas Docker | ✅ |
| 9 | **Disposability** | Graceful shutdown, fast startup | ✅ |
| 10 | **Dev/Prod Parity** | Docker Compose em ambos ambientes | ✅ |
| 11 | **Logs** | Pino → stdout → Promtail → Loki | ✅ |
| 12 | **Admin Processes** | Migrations, seeds como scripts separados | ✅ |

---

## 12. Riscos e Dívida Técnica

### 12.1 Riscos Identificados

| Risco | Probabilidade | Impacto | Mitigação |
|-------|---------------|---------|-----------|
| GPU GEX44 indisponível | Baixa | Alto | GPU Manager Service com circuit breakers, monitoramento VRAM |
| KuCoin API rate limit | Média | Médio | Rate limiting local, backoff |
| PostgreSQL disk full | Baixa | Alto | Alertas, backup rotation |
| Token limit LLM excedido | Média | Baixo | Truncation, context management |

### 12.2 Cobertura de Testes

A plataforma possui uma **suite de testes unitários completa** usando **Vitest**:

| Categoria | Arquivos | Cobertura |
|-----------|----------|-----------|
| **Services** | 7 | auth, chat, rag, training, integrations, observability, learning-orchestrator |
| **Processors** | 3 | image, audio, document |
| **Packages** | 2 | database, shutdown-manager |
| **Security** | 3 | security-fixes, rbac-validation, rbac-cache |
| **Config/Schema** | 3 | config-validation, schema-validation, feature-flags |
| **Health** | 1 | health-endpoints (6 microsserviços) |
| **Logger** | 2 | frontend-logger, logger-proxy |
| **TOTAL** | **24 arquivos** | **~1286 casos de teste** |

**Configuração Enterprise:**
- **Framework**: Vitest 3.2+ com coverage v8
- **Thresholds mínimos**: 50% (statements, branches, functions, lines)
- **Setup global**: `tests/setup.ts` com Pino logger
- **Execução**: `pnpm test` ou `pnpm test:coverage`

### 12.3 Dívida Técnica

| Item | Prioridade | Esforço | Status |
|------|------------|---------|--------|
| Testes E2E (Playwright/Cypress) | Alta | Grande | Planejado |
| Load testing (k6/Artillery) | Média | Médio | Planejado |
| Disaster recovery drill | Alta | Grande | Planejado |
| Documentação API (OpenAPI) | - | - | ✅ **Completo** |

**Nota**: A cobertura OpenAPI está padronizada nos serviços HTTP Node via `@alice/shared-utils/openapi` e no `biometrics-service` via OpenAPI nativa do FastAPI (`/openapi.json` e `/docs`).

---

## 13. Glossário

| Termo | Definição |
|-------|-----------|
| **ADR** | Architecture Decision Record - registro de decisões arquiteturais |
| **C4 Model** | Context, Container, Component, Code - framework de diagramação |
| **arc42** | Template de documentação de arquitetura |
| **LLM** | Large Language Model |
| **MoE** | Mixture of Experts - arquitetura de modelo |
| **RAG** | Retrieval-Augmented Generation |
| **RLS** | Row Level Security |
| **vLLM** | Biblioteca para serving de LLMs |
| **AWQ** | Activation-aware Weight Quantization |
| **OIDC** | OpenID Connect - protocolo de autenticação |
| **RBAC** | Role-Based Access Control |
| **OTel** | OpenTelemetry - observabilidade |

---

*Documento criado seguindo arc42 + C4 Model + ADR best practices 2025*

*Autor: Fillipe Guerra*  
*Data: 10 de Março de 2026*
*Versão: 3.9.316 - Hardening P0 consolidado com status oficial no tracking canônico*
*Stack: Express 5.2, Vite 7.3, Tailwind CSS 4.1, HTTP/3 via Caddy*
*LLM: Qwen3 8B (AWQ) via GPU Manager Service (Hetzner GEX44) - Gate 2*
*Embeddings: Qwen3-Embedding-0.6B INT8 (1024 dim) + OpenAI Vision (descrição textual, sem embeddings de imagem)*
*Performance: HTTP Compression, HNSW m=24, SHA Pinning 95%+*
*GPU: Serviços simultâneos (20GB VRAM budget), QLoRA fine-tuning semanal, zero latência de troca*
*Framework: arc42 + C4 Model + ADRs*  
*Compliance: 18 Regras CLAUDE.md ✅ | 12-Factor App ✅*
