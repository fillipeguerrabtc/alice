# Alice Enterprise Platform - Arquitetura de Software

> **Autor:** Fillipe Guerra  
> **Data:** 31 de Dezembro de 2025  
> **Versão:** 1.12.0 - Gmail SMTP Enterprise (Resend removido)  
> **Framework:** arc42 + C4 Model + ADRs  
> **Idioma:** Português Brasileiro (termos técnicos em inglês)

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
- **Autonomia**: LLM próprio (Mixtral 8x7B) sem dependência de APIs externas
- **Customização**: Fine-tuning específico via LoRA para cada domínio
- **Custo Previsível**: Sem cobrança por token de terceiros
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
    
    System_Ext(gpuServer, "Hetzner GPU GEX44", "GPU Manager Service - LLM/Embeddings local")
    System_Ext(kucoin, "KuCoin Futures", "Trading BTC Perpetuals")
    System_Ext(stripe, "Stripe", "Pagamentos")
    System_Ext(twilio, "Twilio", "WhatsApp/SMS")
    System_Ext(gmail, "Gmail SMTP", "Email transacional")
    
    Rel(user, alice, "Chat, consultas, trading")
    Rel(admin, alice, "Configuração, monitoramento")
    Rel(alice, gpuServer, "Inferência LLM, Embeddings GPU (local)")
    Rel(alice, kucoin, "Ordens de trading")
    Rel(alice, stripe, "Webhooks de pagamento")
    Rel(alice, twilio, "Mensagens WhatsApp")
    Rel(alice, gmail, "Emails")
```

### 3.2 Integrações Externas

| Sistema | Propósito | Protocolo | Autenticação |
|---------|-----------|-----------|--------------|
| **Hetzner GPU GEX44** | GPU Manager Service local - LLM/Embeddings/FLUX/ASR | HTTP (localhost) | N/A (interno) |
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
        Container(traefik, "Traefik", "API Gateway", "Roteamento, SSL, Rate Limiting")
        Container(frontend, "Frontend", "React 18 + Vite 7.3", "SPA, shadcn/ui, i18n")
        Container(auth, "Auth Service", "Node.js", "OAuth, SAML, RBAC")
        Container(chat, "Chat Service", "Node.js", "WebSocket, LLM, Trading Commands")
        Container(rag, "RAG Service", "Node.js", "Embeddings, Busca Semântica")
        Container(training, "Training Service", "Node.js", "Fine-tuning, Auto-learning")
        Container(integrations, "Integrations", "Node.js", "Stripe, KuCoin, Twilio")
        Container(observability, "Observability", "Node.js", "Health, Backup")
        
        ContainerDb(postgres, "PostgreSQL", "PostgreSQL 16", "pgvector, RLS")
        ContainerDb(redis, "Redis", "Redis 7.4", "Cache, Pub/Sub")
        ContainerDb(qdrant, "Qdrant", "Vector DB", "Embeddings texto 4096 dim")
    }
    
    System_Ext(gpuManager, "GPU Manager Service", "Gerenciamento GPU local")
    
    Rel(user, traefik, "HTTPS")
    Rel(traefik, frontend, "HTTP")
    Rel(traefik, auth, "HTTP")
    Rel(traefik, chat, "HTTP/WS")
    Rel(traefik, rag, "HTTP")
    Rel(chat, gpuManager, "HTTP", "LLM Inference (local)")
    Rel(rag, gpuManager, "HTTP", "Embeddings (local)")
    Rel(chat, postgres, "TCP")
    Rel(rag, qdrant, "HTTP", "Vector Search")
    Rel(auth, redis, "TCP", "Sessions")
```

### 4.2 Catálogo de Containers (45 Total)

#### Infraestrutura Core (8)

| # | Container | Tecnologia | Porta | Responsabilidade |
|---|-----------|------------|-------|------------------|
| 1 | `dockerproxy` | Docker Socket Proxy | - | Acesso seguro à API Docker |
| 2 | `traefik-init` | Alpine | - | Inicialização SSL |
| 3 | `traefik` | Traefik v3.6.5 | 80,443 | API Gateway, SSL automático |
| 4 | `postgres` | PostgreSQL 16 | 5432 | Banco principal + pgvector |
| 5 | `alice-redis` | Redis 7.4 | 6379 | Cache distribuído |
| 6 | `alice-qdrant` | Qdrant | 6333 | Embeddings texto (4096 dim) |
| 7 | `alice-tor` | torproxy | 9050 | Proxy SOCKS5 Tor (.onion) |
| 8 | `alice-searxng` | SearXNG | 8080 | Metabusca interna |

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
| 15-29 | ERPNext | MariaDB, Redis x2, Backend, Frontend, WebSocket, Scheduler, 9 Workers |

#### Observability Stack (14)

| # | Container | Descrição |
|---|-----------|-----------|
| 30-43 | Observability | Prometheus, Grafana, Loki, Promtail, Jaeger, Langfuse x2, **ClickHouse**, Vector, Alertmanager, OTel, Node-Exporter, cAdvisor |

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
        Component(llmClient, "LLM Client", "HTTP Client", "Comunicação com Mixtral 8x7B")
        Component(ragClient, "RAG Client", "HTTP Client", "Busca contexto semântico")
        Component(imageGen, "Image Generator", "HTTP Client", "FLUX.1 Schnell")
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

### 5.2 RAG Service - Componentes

```mermaid
C4Component
    title RAG Service - Component Diagram

    Container_Boundary(rag, "RAG Service") {
        Component(docProc, "Document Processor", "Chunking", "PDF, DOCX, TXT")
        Component(audioProc, "Audio Processor", "Canary-1B", "Transcrição ASR")
        Component(imageProc, "Image Processor", "OpenCLIP", "Embeddings 1024 dim")
        Component(embQueue, "Embedding Queue", "Redis", "Processamento assíncrono")
        Component(embWorker, "Embedding Worker", "Background", "GPU dedicada 24/7")
        Component(vectorSearch, "Vector Search", "Qdrant", "Busca semântica")
    }
    
    ComponentDb(postgres, "PostgreSQL", "Documentos, Metadados")
    ComponentDb(qdrant, "Qdrant", "Embeddings 4096 dim")
    
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

### 6.1 Fluxo de Chat com LLM

```mermaid
sequenceDiagram
    autonumber
    participant U as Usuário
    participant WS as WebSocket Handler
    participant RC as Response Cache
    participant RAG as RAG Service
    participant LLM as LLM (Mixtral)
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
        GPU-->>Worker: Embeddings 4096 dim
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
                Container(traefik, "Traefik", "API Gateway")
                Container(services, "Alice Services", "7 containers")
                Container(erpnext, "ERPNext", "15 containers")
                Container(obs, "Observability", "13 containers")
                Container(backup, "pgBackRest", "Backup")
            }
        }
        Deployment_Node(gpuServices, "GPU Services", "Local GPU Services") {
            Container(gpuManager, "GPU Manager Service", "Fila priorizada, VRAM monitoring")
            Container(mixtral, "Mixtral 8x7B", "vLLM AWQ")
            Container(flux, "FLUX.1 Schnell", "Image Gen")
            Container(qwen, "Qwen3-Embedding", "4096 dim")
            Container(canary, "Canary-1B", "ASR")
        }
    }
    
    Rel(traefik, services, "HTTP")
    Rel(services, gpuServices, "HTTP", "GPU Inference (local)")
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
        K --> L[51 Containers Hetzner GEX44]
        L --> M[GPU Manager Service + 4 GPU Services (local)]
        M --> N[Prometheus Monitoring]
    end
```

> **Pipeline Enterprise (27/12/2025):** Deploy Server (CPX32 - 4 vCPU AMD EPYC, 8GB RAM) com Runner Enterprise Hardening (kernel tuning, Docker daemon, limits, systemd) + Production Server (GEX44 GPU). Todos os serviços GPU rodam localmente no servidor único, eliminando latência de rede.

> **Otimização CI Performance (27/12/2025):** Composite action `.github/actions/setup-node-pnpm` elimina duplicação de setup (14 execuções → 1x). Versões Node.js/pnpm calculadas uma vez no job `detect-changes` e passadas via outputs. Jobs que não precisam de Node.js (compliance-checks, trigger-release) não fazem setup. Economia estimada: ~6-10 minutos por run de CI.

> **Server GPU Optimizations (28/12/2025):** Servidor de produção Hetzner GEX44 otimizado para máxima performance GPU. **Docker daemon:** default-runtime nvidia (GPU como runtime padrão), live-restore true, BuildKit GC 20GB. **NVIDIA:** Persistence Mode ENABLED (GPU sempre ativa, sem cold start), CDI configurado em /etc/cdi/nvidia.yaml (Container Device Interface - best practice 2025), Container Toolkit 1.18.1. **Kernel sysctl:** vm.swappiness=10 (prioriza RAM), vm.dirty_ratio=40 (I/O throughput), kernel.shmmax=64GB (CUDA shared memory), net.core.rmem_max=16MB (buffers rede), fs.file-max=2M. **Hardware:** RTX 4000 Ada 20GB, Driver 580.95.05, CUDA 13.0. Servidor 100% limpo, 1.7TB disponível.

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
| `no-new-privileges` | 51/51 containers | ✅ 100% |
| `read_only: true` | 25/51 containers | ✅ Onde aplicável |
| Resource limits | 51/51 containers | ✅ 100% |
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
        H --> L[Alertmanager]
        L --> M[Email/Slack]
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
  asrCanary: { threshold: 3, timeout: 120000, resetTimeout: 180000 },
  mixtralLLM: { threshold: 3, timeout: 60000, resetTimeout: 120000 },
  imageGeneration: { threshold: 5, timeout: 30000, resetTimeout: 60000 },
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

### ADR-001: Escolha do LLM (Mixtral 8x7B)

| Aspecto | Decisão |
|---------|---------|
| **Status** | Aceito |
| **Contexto** | Necessidade de LLM enterprise 100% self-hosted |
| **Decisão** | Mixtral 8x7B (MoE ~12B ativos) via vLLM AWQ |
| **Alternativas** | Llama 3.3 70B (muito grande), GPT-4 (não self-hosted) |
| **Consequências** | + Custo fixo, + Privacidade, - Qualidade vs GPT-4 |

### ADR-002: Arquitetura de Embeddings

| Aspecto | Decisão |
|---------|---------|
| **Status** | Aceito |
| **Contexto** | Embeddings de alta qualidade para RAG e Trading |
| **Decisão** | Qwen3-Embedding-8B (4096 dim) → Qdrant, OpenCLIP (1024 dim) → pgvector |
| **Alternativas** | BGE-M3 (1024 dim), NV-Embed-v2 (Non-Commercial) |
| **Consequências** | + Qualidade máxima, + Licença Apache 2.0, - Maior storage |

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
*Total de Containers: 51 (8 infra + 7 Alice + 15 ERPNext + 14 observability + 6 GPU + 1 backup)*  
*Stack: Express 5.2, Vite 7.3, Tailwind CSS 4.1, HTTP/2*  
*LLM: Mixtral 8x7B (vLLM AWQ) via GPU Manager Service (Hetzner GEX44)*  
*Embeddings: Qwen3-Embedding-8B (4096 dim) + OpenCLIP (1024 dim)*  
*Performance: HTTP Compression, HNSW m=24, SHA Pinning 95%+*  
*Framework: arc42 + C4 Model + ADRs*  
*Compliance: 18 Regras CLAUDE.md ✅ | 12-Factor App ✅*
*Otimização CI (27/12/2025): Composite action reutilizável elimina duplicação de setup (14x → 1x), economia de ~6-10min por run*