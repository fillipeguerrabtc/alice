# Alice Enterprise Platform - Arquitetura de Software

> **Autor:** Fillipe Guerra  
> **Data:** 23 de Janeiro de 2026  
> **Versão:** 3.4.0 - Modo Agentic Enterprise  
> **Framework:** arc42 + C4 Model + ADRs  
> **Idioma:** Português Brasileiro (termos técnicos em inglês)
> 
> **Notas de atualização:** detalhes de CI/CD, Smart Deploy e troubleshooting ficam em `docs/DEPLOYMENT.md` (SSOT).

---

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
- **Autonomia**: LLM próprio (Qwen2.5 7B Instruct AWQ) com Vision e geração de imagens via OpenAI - **Gate 2 (LLM local + OpenAI Vision)**
- **Customização**: Fine-tuning específico via QLoRA para cada domínio (especializado em finanças/matemática)
- **Custo Previsível**: LLM local sem cobrança por token; Vision/Imagens via OpenAI
- **Compliance**: LGPD, GDPR, SOC 2 ready

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
│   ├── chat-service/        # Chat + LLM + Trading
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
│   └── scripts/             # Automação
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
| **ERPNext** | ERP/CRM | REST | OAuth 2.0 SSO |
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
        ContainerDb(redis, "Redis", "Redis 7.4 (Alice) / 6.2 (ERPNext)", "Cache, Pub/Sub")
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

#### Microsserviços Alice (7)

| # | Container | Tecnologia | Porta | Responsabilidade |
|---|-----------|------------|-------|------------------|
| 8 | `alice-frontend` | React 18 + Vite 7.3 | 5000 | SPA, UI/UX |
| 9 | `alice-auth` | Node.js | 3001 | OAuth, SAML, RBAC |
| 10 | `alice-chat` | Node.js | 3002 | WebSocket, LLM, Trading |
| 11 | `alice-rag` | Node.js | 3003 | RAG, Embeddings |
| 12 | `alice-training` | Node.js | 3004 | Fine-tuning, Auto-learning |
| 13 | `alice-integrations` | Node.js | 3005 | Stripe, KuCoin, Twilio |
| 14 | `alice-observability` | Node.js | 3007 | Health, Backup |

#### ERPNext Stack (15)

| # | Container | Descrição |
|---|-----------|-----------|
| 15-29 | ERPNext | MariaDB, Redis 6.2 x2 (cache+queue), Backend, Frontend, WebSocket, Scheduler, 9 Workers |

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

- Router de tools para web search, ERPNext (read/write), pagamentos e stack ops.
- Ações críticas registradas em `action_requests` com aprovação explícita (financeiro).
- Configuração por tenant persistida em `agentic_settings` (links, escopo e políticas).
- Streaming de eventos agentic em tempo real (SSE/WS) com payload redigido.

### 5.2 RAG Service - Componentes

```mermaid
C4Component
    title RAG Service - Component Diagram

    Container_Boundary(rag, "RAG Service") {
        Component(docProc, "Document Processor", "Chunking", "PDF, DOCX, TXT")
        Component(audioProc, "Audio Processor", "OpenAI ASR", "Transcrição de áudio")
        Component(imageProc, "Image Processor", "OpenAI Vision", "Descrição + embeddings OpenAI (imagem)")
        Component(embQueue, "Embedding Queue", "Redis", "Processamento assíncrono")
        Component(embWorker, "Embedding Worker", "Background", "GPU dedicada 24/7")
        Component(vectorSearch, "Vector Search", "Qdrant", "Busca semântica")
    }
    
    ComponentDb(postgres, "PostgreSQL", "Documentos, Metadados")
    ComponentDb(qdrant, "Qdrant", "Embeddings 1024 dim (texto) + 1536 dim (imagem)")
    
    System_Ext(gpuManager, "GPU Manager Service", "GPU Processing (Hetzner GEX44)")
    
    Rel(docProc, embQueue, "Enqueue")
    Rel(embWorker, gpuManager, "Generate embeddings")
    Rel(embWorker, qdrant, "Store vectors")
    Rel(vectorSearch, qdrant, "Query")
```

### 5.3 Auth Service - Componentes

```mermaid
C4Component
    title Auth Service - Component Diagram

    Container_Boundary(auth, "Auth Service") {
        Component(oauth, "OAuth Handler", "Passport.js", "Google, GitHub")
        Component(saml, "SAML Handler", "passport-saml", "Azure AD, Okta")
        Component(oidc, "OIDC Provider", "oidc-provider", "SSO para ERPNext, Grafana")
        Component(rbac, "RBAC Engine", "6 roles", "Permissões granulares")
        Component(sessions, "Session Manager", "Redis", "Sessões distribuídas")
        Component(provisioning, "Identity Provisioning", "REST", "Sync ERPNext, Grafana")
    }
    
    ComponentDb(postgres, "PostgreSQL", "Users, Tenants, Permissions")
    ComponentDb(redis, "Redis", "Sessions")
    
    Rel(oauth, sessions, "Create session")
    Rel(saml, sessions, "Create session")
    Rel(rbac, postgres, "Check permissions")
    Rel(oidc, provisioning, "Sync identity")
```

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
    participant LLM as LLM (texto - Qwen2.5 7B)
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
                Container(erpnext, "ERPNext", "15 containers")
                Container(obs, "Observability", "13 containers")
                Container(backup, "pgBackRest", "Backup")
            }
        }
        Deployment_Node(gpuServices, "GPU Services (Gate 2 - budget 20GB VRAM)", "Local GPU Services - SIMULTÂNEOS") {
            Container(gpuManager, "GPU Manager Service", "Fila priorizada, VRAM monitoring")
            Container(llm, "Qwen2.5 7B Instruct (AWQ)", "LLM texto (~6GB budget)")
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
│   ├── mariadb/                    # ERPNext
│   └── redis/                      # Cache persistente
├── uploads/                        # Mídia multimodal
│   ├── {tenantId}/                 # Isolamento por tenant
│   │   ├── image/
│   │   ├── audio/
│   │   └── document/
│   └── {tenantId}/                 # Uploads por tenant
├── backups/                        # Backups enterprise
│   ├── postgresql/                 # pgBackRest (WAL, PITR)
│   ├── mariadb/                    # ERPNext dumps
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
        H --> I[ERPNext]
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

#### 8.1.3 Row Level Security (RLS)

```sql
-- Exemplo de RLS policy para isolamento multi-tenant
CREATE POLICY "tenant_isolation" ON conversations
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- Tabelas com RLS ativo (17/12/2025):
-- conversations, messages, agents, documents, embeddings,
-- training_data, fine_tuning_jobs, trading_signals,
-- trading_orders, trading_positions, trading_risk_config,
-- trading_audit_log, trading_dataset, trading_lora_jobs,
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

### ADR-007: Arquitetura Multi-Stack Modular (05/01/2026)

| Aspecto | Decisão |
|---------|---------|
| **Status** | Aceito |
| **Data** | 05 de Janeiro de 2026 |
| **Contexto** | Deploy monolítico de 49 containers causava rollback total quando ERPNext falhava, derrubando Alice e Grafana que funcionavam. Pipeline era "all-or-nothing" sem possibilidade de produção parcial. |
| **Decisão** | Separar a plataforma em **5 stacks independentes** (INFRA, ALICE, OBSERVABILITY, ERPNEXT, BACKUP) com Docker Compose files separados e workflow de deploy modular (`deploy-stack.yml`). |
| **Alternativas** | (1) Kubernetes com namespaces - rejeitado por complexidade excessiva para 49 containers; (2) Docker Swarm stacks - rejeitado por falta de GPU support nativo; (3) Manter monolítico - rejeitado pelo problema de rollback total |
| **Consequências** | + Produção parcial (Alice funciona se ERPNext falhar); + Rollback cirúrgico por stack; + Deploy independente; + Isolamento de falhas; - Maior complexidade de orquestração; - Necessidade de manter dependências entre stacks |

**Arquivos Criados:**
- `infra/docker/stacks/docker-compose.base.yml` - Networks e volumes compartilhados
- `infra/docker/stacks/docker-compose.infra.yml` - Stack de infraestrutura (10 containers)
- `infra/docker/stacks/docker-compose.alice.yml` - Stack Alice + GPU (8 + 5 containers)
- `infra/docker/stacks/docker-compose.observability.yml` - Stack de observabilidade (13 containers)
- `infra/docker/stacks/docker-compose.erpnext.yml` - Stack ERPNext (15 containers)
- `infra/docker/stacks/docker-compose.backup.yml` - Stack de backup (1 container)
- `.github/workflows/deploy-stack.yml` - Workflow para deploy/rollback por stack

**Ordem de Deploy:**
1. INFRA (obrigatório primeiro)
2. Drizzle push (migrações)
3. ALICE + OBSERVABILITY (paralelos)
4. ERPNEXT (independente)
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
  # Build 17 imagens (12 microservices + 5 GPU)
  # Retag inteligente (só builda o que mudou)
  
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
| **Decisão** | Refatorar para **Deploy Modular v3** (`deploy-stack-modular.yml`) com **15 jobs independentes**: `validate`, `prepare`, `deploy-infra`, `health-infra`, `rollback-infra`, `drizzle-push`, `deploy-alice`, `health-alice`, `rollback-alice`, `deploy-observability`, `health-observability`, `rollback-observability`, `deploy-erpnext`, `health-erpnext`, `rollback-erpnext`, `deploy-backup`, `health-backup`, `rollback-backup`, `notify`. |
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
                  deploy-alice    deploy-observability  deploy-erpnext  deploy-backup
                  health-alice    health-observability  health-erpnext  health-backup
                 rollback-alice*  rollback-observability* rollback-erpnext* rollback-backup*
                        │                  │                  │              │
                        └──────────────────┴──────────────────┴──────────────┘
                                           ↓
                                        notify
```

**Performance:**
- v2 (sequencial): 5 stacks x ~6min/cada = ~30min
- v3 (paralelo): infra (~4min) + max(alice, observability, erpnext, backup) (~6min) = **~10min** ⚡

**Workflow File:** `.github/workflows/deploy-stack-modular.yml`

**Bugs Corrigidos na v3:**
- ✅ `$GITHUB_OUTPUT` em SSH scripts (não funciona no servidor remoto)
- ✅ Race condition em rollbacks paralelos (sed modificando `.env.prod`)
- ✅ Health checks incompletos (ERPNext 5/10, Observability 6/13, INFRA sem Tor/SearXNG)
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
| ERPNEXT | `ERPNEXT_VERSION`, `MARIADB_VERSION`, `REDIS_ERPNEXT_VERSION` | 3 |
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
| ERPNEXT | `erpnext-redis-cache` | 6.2.21-alpine | Cache ERPNext (Frappe) |
| ERPNEXT | `erpnext-redis-queue` | 6.2.21-alpine | Filas ERPNext (Frappe) |

> **Nota:** Redis 6.x para ERPNext é OBRIGATÓRIO por compatibilidade com Frappe Framework.

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

**Documentação:** `docs/PERMISSIONS.md`

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

---

## 10. Aderência às 18 Regras

### Mapeamento Completo

| # | Regra | Implementação | Status |
|---|-------|---------------|--------|
| 1 | **LER ANTES DE AGIR** | Workflow de diagnóstico em todas as features | ✅ |
| 2 | **NÃO DUPLICAR** | `packages/shared-utils` para código comum | ✅ |
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

**Nota**: Documentação OpenAPI está 100% implementada em todos os microsserviços via `@alice/shared-utils/openapi`.

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
*Data: 28 de Dezembro de 2025*
*Versão: 1.11.0 - Server GPU Optimizations Enterprise*
*Total de Containers: 50 (8 infra + 7 Alice + 15 ERPNext + 14 observability + 4 GPU + 1 backup + 1 trainer on-demand)*
*Stack: Express 5.2, Vite 7.3, Tailwind CSS 4.1, HTTP/2*
*LLM: Qwen2.5 7B Instruct (AWQ) via GPU Manager Service (Hetzner GEX44) - Gate 2*
*Embeddings: Qwen3-Embedding-0.6B INT8 (1024 dim) + OpenAI Vision + OpenAI Embeddings (imagem, 1536 dim)*
*Performance: HTTP Compression, HNSW m=24, SHA Pinning 95%+*
*GPU: Todos serviços simultâneos (15GB/20GB VRAM), QLoRA fine-tuning semanal, Zero latência de troca*
*Framework: arc42 + C4 Model + ADRs*  
*Compliance: 18 Regras CLAUDE.md ✅ | 12-Factor App ✅*
*Otimização CI (27/12/2025): Composite action reutilizável elimina duplicação de setup (14x → 1x), economia de ~6-10min por run*