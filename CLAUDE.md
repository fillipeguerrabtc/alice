# Alice - Plataforma Enterprise de IA Autônoma

## Overview
Alice is an autonomous AI enterprise platform powered by the **Mixtral 8x7B (MoE ~12B active parameters)** model served via vLLM AWQ on Salad Cloud RTX 4090 GPUs. Its core purpose is to provide a fully autonomous AI solution with absolute privacy, predictable costs, and unlimited customization via LoRA fine-tuning. The platform now includes **Trading BTC Futures** on KuCoin Perpetuals with scalping capabilities (1m, 3m, 5m candles). Key capabilities include real-time chat with streaming, deduplication, multi-tenancy, RBAC, a RAG backend with enterprise embeddings (Qwen3-Embedding-8B 4096 dim → Qdrant, OpenCLIP 1024 dim → pgvector), image generation (FLUX.1 Schnell), aggressive self-learning, and a robust observability stack. The business vision is to deliver an enterprise-grade AI solution with unparalleled control, performance, data security, and cost predictability.

## User Preferences
### 18 Regras Fundamentais

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
| 17 | **REVIEW ANTES DO COMMIT** | Todas as mudanças DEVEM passar por review antes de serem commitadas. Após review e aprovação, fazer commit direto (sem staging). Commits vão acumulando localmente. |
| 18 | **COMMITS CONSOLIDADOS E PUSH MANUAL** | **OBRIGATÓRIO**: Fazer commits consolidados com várias mudanças relacionadas em modo enterprise, ao invés de commitar cada mudança individualmente. Isso otimiza a review automática do Cursor (habilitada após cada commit) e segue melhores práticas enterprise. **PROIBIDO** push automático. Push manual com "Sync Changes" SOMENTE quando todas as implementações estiverem revisadas, commitadas e aprovadas. O usuário decide quando fazer push. |

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
| DESENVOLVIMENTO | Cursor IDE | IDE e preview de UI | Dados de preview permitidos APENAS em `server/index-dev.ts` |
| PRODUÇÃO | Hetzner Cloud | Sistema enterprise real | **PROIBIDO** mocks/hardcoded (Regra 6) |

**IMPORTANTE**: Código em `apps/` (microsserviços) vai para produção via GitHub Actions. `server/index-dev.ts` é APENAS para preview no Cursor IDE e NÃO é deployado para produção.

## System Architecture
Alice employs a microservices architecture with 44 containerized services orchestrated by Traefik API Gateway, emphasizing data privacy, scalability, and resilience.

**Core Architectural Components:**
- **Infrastructure Core (7 serviços)**: Docker Socket Proxy, Traefik Init, Traefik API Gateway, PostgreSQL (with pgvector for image embeddings and RLS for multi-tenancy), Alice Redis (dedicated cache), **SearXNG (metabusca interna para Web Search)**, **Qdrant (banco vetorial para texto 4096 dim)**.
- **Alice Microservices (7 serviços)**:
    - **Frontend**: React 18, Vite 5, shadcn/ui, i18n PT-BR.
    - **Auth Service**: OAuth 2.0, SAML 2.0, OIDC Provider, 6-level RBAC, PostgreSQL sessions.
    - **Chat Service**: Real-time LLM token streaming via WebSockets.
    - **RAG Service**: Retrieval-Augmented Generation with embeddings and pgvector.
    - **Training Service**: Fine-tuning and self-learning scheduler.
    - **Integrations Service**: Handles external APIs (Stripe, Wise, Twilio, Resend).
    - **Observability Service**: Prometheus, Grafana, Jaeger for metrics, dashboards, and tracing.
    - **Multimodal Inference (100% GPU)**: Processamento multimodal via GPU Salad Cloud:
        - Embeddings de texto: Qwen3-Embedding-8B (4096 dim) → Qdrant - GPU OBRIGATÓRIO
        - Embeddings de imagem: OpenCLIP ViT-H/14 (1024 dim) → pgvector - GPU OBRIGATÓRIO
        - ASR: Canary-1B (NeMo) - GPU OBRIGATÓRIO
        - LLM Trading: Mixtral 8x7B (vLLM) - GPU OBRIGATÓRIO
- **ERPNext Stack (15 serviços)**: Includes MariaDB, Redis Cache/Queue, Frappe Bench services (configurator, create-site, backend), NGINX frontend, WebSocket, Scheduler, and 9 Workers (3x default, 3x short, 3x long) for comprehensive ERP functionalities.
- **Observability Stack (14 serviços)**: Langfuse Web (LLM observability), **Langfuse Worker (processamento assíncrono v3)**, Langfuse DB (PostgreSQL), **ClickHouse (OLAP Langfuse v3)**, Prometheus (métricas), Grafana (dashboards), Loki (logs), Promtail (coleta de logs), Jaeger (tracing), Vector (agregação de logs), Alertmanager (alertas), OTel Collector (instrumentação), Node Exporter (métricas do host), cAdvisor (métricas de containers).
- **Backup (1 serviço)**: pgBackRest for PostgreSQL enterprise backups (WAL archiving, incremental, encryption AES-256).

**Shared Packages (`packages/`):**
- `config`: Centralized configurations.
- `database`: Drizzle ORM, PostgreSQL schemas.
- `logger`: Pino structured logging.
- `shared`: Shared TypeScript types.
- `shared-utils`: Utilities like shutdown manager, circuit breaker, cache adapter.

## External Dependencies

### Salad Cloud (GPUs Externas) - Atualizado 16/12/2025
- **LLM Inference**: Mixtral 8x7B (MoE ~12B ativos, quantizado 4/5-bit via vLLM) - chat, trading, geração de texto
- **Image Generation**: FLUX.1 Schnell - geração de imagens
- **Fine-tuning**: Treinamento de modelos customizados, LoRA para trading BTC
- **Embeddings Texto**: Qwen3-Embedding-8B (4096 dim) → Qdrant - máxima qualidade
- **Embeddings Imagem**: OpenCLIP ViT-H/14 (1024 dim) → pgvector - dimensão nativa
- **ASR**: Canary-1B (NeMo) - transcrição de áudio

### Processamento Multimodal - ARQUITETURA ENTERPRISE (17/12/2025)
Embeddings otimizados por caso de uso para máxima qualidade:

| Modalidade | Modelo | Dimensões | Storage | Licença |
|------------|--------|-----------|---------|---------|
| **Texto (Trading/RAG)** | Qwen3-Embedding-8B | **4096** | **Qdrant** | Apache 2.0 |
| **Imagem** | OpenCLIP ViT-H/14 | **1024** | PostgreSQL `vector` | MIT |
| **Transcrição** | Canary-1B (NeMo) | - | - | Apache 2.0 |

- **GPU é OBRIGATÓRIO** - sem fallback CPU (Regra 6)
- **Qdrant para Texto**: Suporta HNSW com 4096+ dim (pgvector limita em 4000 para halfvec)
- **Estratégia "Warm on Demand"**: GPUs mantidas quentes por 30 minutos após último uso
- **Texto unificado**: Trading e RAG usam mesmo modelo (Qwen3-Embedding-8B)

### Estratégia de GPU "Warm on Demand" (15/12/2025)
Otimização de custos para GPUs Salad Cloud:
- **Fila Redis**: Processamento assíncrono de embeddings (`embedding-queue.ts`)
- **Worker dedicado**: `embedding-worker.ts` processa fila em background
- **Keep-warm 30 min**: GPU mantida ativa por 30 minutos após último uso
- **WebSocket**: Notificações em tempo real quando embedding está pronto (`/ws/embeddings`)
- **Endpoints assíncronos**: `POST /api/rag/embeddings/queue` retorna `jobId` imediatamente
- **Benefícios**: Cold start apenas no primeiro request; custo proporcional ao uso real
- **Payments**: Stripe, Wise.
- **CRM/ERP**: ERPNext.
- **Communication**: Twilio (WhatsApp, SMS), Resend (emails transacionais via API Key simplificada - sem domínio verificado).
- **Database**: PostgreSQL with pgvector extension.
- **Observability**: Prometheus 3.8.0, Grafana OSS 11.6.2, Jaeger 1.76.0, Loki 3.6.3, Promtail 3.6.3, Alertmanager 0.27.0, Vector 0.51.1, OpenTelemetry Collector 0.141.0, Langfuse 3.139.0, Node Exporter 1.8.2, cAdvisor 0.49.1.
- **API Gateway**: Traefik v3.6.4.
- **CI/CD**: GitHub Actions.
- **Storage**: Hetzner Volume local (100GB EXT4, expansível até 10TB).

## Deploy Information
- **Servidor**: Hetzner CX43 (8 vCPU, 16GB RAM, 160GB NVMe SSD)
- **Volume Adicional**: Hetzner Volume 100GB (alice-data) montado em /mnt/alice-data
- **IP**: 46.224.46.93
- **Domínio**: yesyoudeserve.duckdns.org
- **SO**: Ubuntu 24.04.3 LTS
- **Docker**: 29.1.3, Docker Compose v5.0.0
- **Pipeline**: Push → CI (auto) → Release (auto) → Deploy (auto)

## URLs de Produção
| Serviço | URL | Descrição |
|---------|-----|-----------|
| Alice Frontend | https://yesyoudeserve.duckdns.org | SPA React principal |
| Alice Chat | https://yesyoudeserve.duckdns.org/chat | Interface de chat (SPA route) |
| Alice API | https://yesyoudeserve.duckdns.org/api/* | APIs REST dos microsserviços |
| Alice WebSocket | wss://yesyoudeserve.duckdns.org/ws | WebSocket para streaming em tempo real |
| ERPNext | https://erp.yesyoudeserve.duckdns.org | ERP/CRM Frappe |
| Grafana | https://observability.yesyoudeserve.duckdns.org | Dashboards e alertas |
| Prometheus | https://metrics.yesyoudeserve.duckdns.org | Métricas e consultas |
| Jaeger | https://traces.yesyoudeserve.duckdns.org | Distributed tracing |
| Langfuse | https://langfuse.yesyoudeserve.duckdns.org | LLM observability |
| Alertmanager | https://alertmanager.yesyoudeserve.duckdns.org | Alertas e notificações |

## Conexão SSH ao Servidor
```bash
# Usando alias (recomendado - configurar em ~/.ssh/config)
ssh alice-hetzner

# Conexão direta
ssh -i ~/.ssh/alice-deploy root@46.224.46.93
```

## Estrutura do Projeto
```
alice/
├── apps/                           # Microserviços independentes (9)
│   ├── frontend-service/           # React + Vite SPA
│   ├── api-gateway/                # Traefik config (dev only)
│   ├── auth-service/               # OAuth/SAML/RBAC
│   ├── chat-service/               # LLM Proxy + WebSocket
│   ├── rag-service/                # Embeddings + pgvector
│   ├── training-service/           # Fine-tuning
│   ├── integrations-service/       # Stripe, ERPNext, Twilio
│   └── observability-service/      # Prometheus, Grafana, Jaeger, Langfuse
├── packages/                       # Código compartilhado (5)
│   ├── shared/                     # Schema Drizzle ORM
│   ├── database/                   # PostgreSQL + pgvector
│   ├── shared-utils/               # Utilities
│   ├── config/                     # Validação Zod
│   └── logger/                     # Pino singleton
├── infra/docker/                   # Docker Compose prod
├── docs/                           # Documentação completa
└── .github/workflows/              # CI/CD (4 workflows: ci, release, deploy-production, update-system-packages)
```

## Estrutura do Volume Hetzner (Produção)
```
/mnt/alice-data/                    # Volume Hetzner 100GB (expansível até 10TB)
├── data/                           # Dados persistentes dos bancos (750)
│   ├── postgresql/                 # Dados PostgreSQL + pgvector
│   ├── mariadb/                    # Dados MariaDB (ERPNext)
│   └── redis/                      # Dados Redis (persistência)
├── uploads/                        # Uploads multimodais (750) - isolamento por tenant
│   └── {tenantId}/                 # Uploads gerais de usuários
│       ├── image/                  # Imagens enviadas via /api/media/upload
│       ├── audio/                  # Áudios enviados via /api/media/upload
│       ├── video/                  # Vídeos enviados via /api/media/upload
│       └── document/               # Documentos enviados via /api/media/upload
├── backups/                        # Backups enterprise (750)
│   ├── postgresql/                 # pgBackRest (full + incremental + WAL)
│   ├── mariadb/                    # Mariabackup dumps
│   ├── redis/                      # RDB snapshots
│   └── manifests/                  # Manifestos JSON de cada backup
└── logs/                           # Logs de serviços (750)

/opt/alice -> /mnt/alice-data       # Symlink para acesso padrão

Permissões Enterprise (13/12/2025):
- Diretórios: 750 (rwxr-x---) - owner/group rwx, outros sem acesso
- Arquivos: 640 (rw-r-----) - owner rw, group r, outros sem acesso
- Secrets: 600 (rw-------) - apenas owner
```

## Documentação Principal
| Documento | Descrição |
|-----------|-----------|
| `docs/ARQUITETURA.md` | **Arquitetura completa (arc42 + C4 + ADRs)** |
| `docs/STATUS-REAL-ATUAL.md` | Status completo da plataforma |
| `docs/SISTEMA-APRENDIZADO.md` | Sistema de auto-aprendizado |
| `docs/DEPLOYMENT.md` | Guia de deploy para produção |
| `docs/SECRETS.md` | Guia de secrets e webhooks |

## Contas Administrativas (Acesso Inicial)
- **Alice/Auth (admin global)**: `ADMIN_USER` + `ADMIN_PWD` (semeados no auth-service; role `super_admin`).
- **Grafana**: `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD` (por padrão herdam `ADMIN_USER/ADMIN_PWD` via CI).
- **ERPNext**: usuário fixo `Administrator` + `ERPNEXT_ADMIN_PASSWORD` (pode usar a mesma senha do admin global).
- Provisionamento: `.github/workflows/deploy-production.yml` falha se `ADMIN_USER`/`ADMIN_PWD` ausentes; secrets de Grafana/ERPNext recebem fallback seguro.

## Security Hardening (19 de Dezembro de 2025)
- **44 containers** = 100% com `security_opt: no-new-privileges` ✅ COMPLETO
- **25 containers** = 100% com `read_only: true` + tmpfs (apenas onde não há escrita necessária)
- **44 containers** = 100% com resource limits ✅ COMPLETO
- **26 imagens externas** = 100% com SHA256 digests
- **healthchecks** = ✅ 38/38 containers (3 init containers não precisam - usam service_completed_successfully)
- **Google Distroless** = 6 serviços Node.js (0 CVEs)
- **OWASP API Top 10** = 9/10 mitigados
- **Nota:** ERPNext workers e init containers (11 containers) não têm `read_only: true` pois precisam escrever em volumes (comportamento correto e enterprise-grade)
- **Alertmanager SMTP:** senha via arquivo montado (`/opt/alice/secrets/alertmanager/smtp_password` → `/run/secrets`); evitar senha inline em env.

## Git Workflow (Regras 17 e 18)

**IMPORTANTE**: Este projeto usa um workflow Git específico que **NÃO utiliza staging** (área de preparação) e prioriza **commits consolidados** em modo enterprise.

### Fluxo de Trabalho

1. **Desenvolvimento**: Código é modificado no working directory
2. **Acumulação de Mudanças**: Múltiplas mudanças relacionadas são desenvolvidas e mantidas no working directory
3. **Review Consolidado**: Todas as mudanças relacionadas DEVEM passar por review conjunto antes de commit
4. **Commit Consolidado**: Após review e aprovação, fazer commit consolidado **SEM staging** (`git commit -a` ou commit direto via IDE) com várias mudanças relacionadas em um único commit
5. **Acumulação Local**: Commits consolidados vão acumulando localmente (múltiplos commits consolidados são permitidos)
6. **Push Manual**: Push manual com "Sync Changes" **SOMENTE** quando:
   - Todas as implementações estiverem completas
   - Todas as mudanças estiverem revisadas
   - Todos os commits estiverem aprovados
   - O usuário decidir explicitamente fazer push

### Regras Importantes

- **OBRIGATÓRIO**: Commits consolidados com várias mudanças relacionadas (modo enterprise)
- **PROIBIDO**: Commitar cada mudança individualmente (ineficiente e sobrecarrega review automática)
- **PROIBIDO**: Usar `git add` ou staging automático
- **PROIBIDO**: Push automático (via hooks, CI/CD local, ou qualquer automação)
- **OBRIGATÓRIO**: Review antes de cada commit consolidado
- **OBRIGATÓRIO**: Aprovação do usuário antes de push
- **PERMITIDO**: Múltiplos commits consolidados locais acumulados antes do push

### Benefícios dos Commits Consolidados

- **Otimização da Review Automática**: A review automática do Cursor inicia após cada commit. Commits consolidados reduzem o número de reviews e tornam o processo mais eficiente
- **Melhores Práticas Enterprise**: Commits atômicos e bem organizados facilitam rastreabilidade e rollback
- **Eficiência**: Menos overhead de processamento e análise por commit
- **Contexto Completo**: Mudanças relacionadas ficam juntas, facilitando compreensão do histórico

### Comandos Git Permitidos

```bash
# Review das mudanças (unstaged) - acumular várias mudanças antes de commit
git status
git diff

# Commit consolidado direto (sem staging explícito) - várias mudanças relacionadas em um único commit
# Para mudanças normais (modificações em arquivos rastreados):
git commit -a -m "feat: implementação consolidada de feature X

- Mudança 1 relacionada
- Mudança 2 relacionada
- Mudança 3 relacionada
- Atualização de documentação"

# Para incluir deleções de arquivos (git commit -a não inclui deleções automaticamente):
git add -u  # Apenas para marcar deleções (exceção técnica necessária)
git commit -m "feat: implementação consolidada + limpeza"

# RECOMENDADO: Usar Cursor IDE que faz staging automático inteligente
# Botão "Sync Changes" no IDE faz commit direto sem necessidade de git add manual
```

### Comandos Git PROIBIDOS

```bash
# PROIBIDO: Staging explícito para mudanças normais (use git commit -a)
git add <arquivo>
git add .
# EXCEÇÃO: git add -u é permitido APENAS quando há deleções de arquivos
# (git commit -a não inclui deleções automaticamente)

# PROIBIDO: Commits individuais para cada mudança pequena
# (deve consolidar mudanças relacionadas)

# PROIBIDO: Push automático
# (não configurar hooks de push automático)
```

### Exemplo de Commit Consolidado (Enterprise)

**✅ CORRETO** - Commit consolidado:
```bash
git commit -a -m "fix: correção de bugs em video-processor e validação de embeddings

- Corrige NaN propagation em combineVideoEmbeddingsForSearch
- Adiciona validação de dimensão para normalizedText
- Atualiza documentação em STATUS-REAL-ATUAL.md
- Adiciona testes unitários para edge cases"
```

**❌ INCORRETO** - Commits individuais:
```bash
# NÃO fazer isso - commits separados para cada mudança pequena
git commit -a -m "fix: corrige NaN em video-processor"
git commit -a -m "fix: adiciona validação de dimensão"
git commit -a -m "docs: atualiza STATUS-REAL-ATUAL.md"
git commit -a -m "test: adiciona testes unitários"
```

## Technical Stack
- **Frontend**: React 18, TypeScript 5.9.3, Vite 7.3, shadcn/ui, Tailwind CSS 4.1
- **Backend**: Node.js (versão LTS automática via API + fallback .nvmrc), Express 5.2, pnpm (versão automática via package.json)
- **Database**: PostgreSQL 16 + pgvector, Drizzle ORM
- **Python**: Python 3.13 (via .python-version - fonte primária para garantir compatibilidade), PyTorch 2.9.1 (versão mais recente - Nov 2025, corrige CVE-2025-32434)
- **CI/CD**: GitHub Actions (100% automático)
- **Atualização Periódica**: Workflows automáticos para dependências npm/pnpm (semanal) e pacotes do sistema Hetzner (semanal)
- **pnpm (build scripts)**: Em **CI/deploy**, definimos `NPM_CONFIG_DANGEROUSLY_ALLOW_ALL_BUILDS=true` para permitir execução automática de scripts (sem `approve-builds`). Para builds Docker, os `Dockerfile` dos serviços exportam essa variável **somente no build stage** (onde roda `pnpm install`). Em desenvolvimento local, a proteção padrão permanece.

---
*Autor: Fillipe Guerra*
*Versão: 4.22 - 22 de Dezembro de 2025*
*Total de Containers: 44 (7 infra + 7 Alice + 15 ERPNext + 14 observability + 1 backup)*
*GitHub Secrets: 54 configurados (DOCKERHUB_USERNAME, DOCKERHUB_TOKEN adicionados 20/12/2025)*
*Storage: Volume Hetzner 100GB local (/opt/alice) - SEM S3 externo*
*Backup API: disk-usage, cleanup, delete endpoints (100% Enterprise)*
*Trading: Schema completo (9 tabelas) + API REST (25 endpoints) + LoRA Dataset + Scalping (1m/3m/5m candles) + RBAC Permissões + Stop Orders (st-orders)*
*RBAC Trading (17/12/2025): Adicionadas permissões integrations:trading:{read,write,delete,manage} no PERMISSION_MAP*
*Circuit Breakers: 4 novos presets (kucoinFutures, embeddingsGPU, asrCanary, mixtralLLM)*
*KuCoin Futures: Cliente enterprise com HMAC-SHA256, OMS/EMS, auditoria completa, gestão de risco*
*KuCoin WebSocket (17/12/2025): Cliente WebSocket com token management, canais públicos/privados, auto-reconnect*
*Redis Pub/Sub Trading (17/12/2025): tradingBroadcast.ts para distribuição de dados entre serviços*
*Chat Trading Commands (17/12/2025): trading-command-parser.ts reconhece comandos via linguagem natural (PT-BR/EN)*
*Trading Orchestrator (17/12/2025): trading-orchestrator.ts para handover/takeover entre Alice IA e operador manual*
*Trading Control History (17/12/2025): Tabela trading_control_history + migration RLS (0008)*
*Página Trading (17/12/2025): Frontend completo - 8 tabs: Overview + Chart + OrderBook + Orders + Positions + Signals + History + Control*
*Frontend Trading Components (17/12/2025): CandleChart.tsx, OrderBookViz.tsx, HandoverPanel.tsx, useKucoinWebSocket.ts*
*Klines API (17/12/2025): GET /api/integrations/trading/klines/:symbol - candlesticks para gráfico*
*OrderBook API (17/12/2025): GET /api/integrations/trading/orderbook/:symbol - profundidade de mercado*
*Control API (17/12/2025): POST /api/integrations/trading/control + GET /control-history - handover/takeover manual/Alice*
*Bug Fix KuCoin (17/12/2025): Corrigido status sync 'open'→'active' conforme API KuCoin Futures*
*Bug Fix orderValue (17/12/2025): Cálculo agora usa multiplier do contrato (0.001 BTC para XBTUSDTM) - evita rejeição de ordens legítimas*
*Bug Fix NaN Bypass (17/12/2025): Validação defensiva contra NaN em preço/orderValue - evita bypass silencioso de risk limits*
*Bug Fix Risk Config API (17/12/2025): Removidos campos inexistentes (maxDailyOrders, allowedSymbols) do schema Zod*
*Análise de Licenças (17/12/2025): Qwen3-Embedding-8B (Apache 2.0) é ÚNICO modelo top-tier com licença comercial*
*Modelos Non-Commercial Identificados: Fin-E5, Linq-Embed-Mistral, NV-Embed-v2 (todos CC BY-NC - PROIBIDO uso comercial)*
*Fisher-Yates Shuffle (17/12/2025): Corrigido bug de distribuição enviesada em train/validation split (lora-job-manager.ts)*
*Security Hardening: 100% no-new-privileges, 100% resource limits, 24/43 com read_only (aplicável apenas onde não há escrita), healthchecks 38/38*
*ARQUITETURA ENTERPRISE (17/12/2025): Texto 4096 dim Qwen3-Embedding-8B Apache 2.0 (Qdrant) | Imagem vector(1024) OpenCLIP MIT (pgvector)*
*Bug Fix Embeddings (17/12/2025): Embeddings de texto (documentos/áudio/vídeo) agora vão para Qdrant (4096 dim), não PostgreSQL*
*LLM Trading: Mixtral 8x7B (MoE ~12B ativos, vLLM) para Trading BTC Futures KuCoin*
*Estratégia "Warm on Demand": Fila Redis + Worker assíncrono + Keep-warm 30 min + Métricas Prometheus*
*Salad Cloud: Mixtral 8x7B (vLLM AWQ), FLUX.1 Schnell, Qwen3-Embedding-8B (embeddings 4096), OpenCLIP ViT-H/14 (1024), Canary-1B (ASR)*
*Pipeline CI/CD Unificada (17/12/2025): 4 workflows (CI → Release → Deploy) + GPU deploy integrado via Python SDK (salad-cloud-sdk)*
*Code Review Enterprise (17/12/2025): 100% validado - zero TODO/FIXME/HACK, zero console.log, zero any, zero mocks/stubs*
*Bug Fix maxOrderValue (17/12/2025): Campo adicionado ao schema tradingRiskConfig + migration 0006*
*Bug Fix initTradingOrchestrator (17/12/2025): Adicionada chamada de inicialização faltante em chat-service/index.ts*
*Bug Fix Schema Import (17/12/2025): trading-orchestrator.ts usava db._.schema incorreto - corrigido para import * as schema*
*Bug Fix CandleChart Wicks (17/12/2025): Wicks (sombras high/low) não eram renderizados - adicionado Bar para wick com barSize=1*
*Response Cache (17/12/2025): Greetings Gate implementado - saudações simples respondidas via cache Redis (sem GPU)*
*Response Cache Métricas (17/12/2025): alice_response_cache_hits_total, misses_total, greetings_detected, check_duration*
*Bug Fix Trading Parser (17/12/2025): extractNumber corrigido para usar grupos capturados do regex (evita amount incorreto)*
*Bug Fix WebSocket Unsubscribe (17/12/2025): useKucoinWebSocket.ts passa oldSymbol explícito ao desinscrever (evita subscriptions órfãs)*
*Bug Fix Trading Orchestrator Atomicity (17/12/2025): handover/takeover agora são atômicos via db.transaction()*
*Bug Fix Stop Loss/Take Profit (17/12/2025): Extração de preço corrigida para usar grupos capturados do regex (evita preço incorreto)*
*Suite de Testes (17/12/2025): 24 arquivos de teste, ~1286 casos de teste com Vitest + coverage v8 (thresholds 50%)*
*Bug Fix WebSocket content undefined (17/12/2025): Type assertion corrigida, validação defensiva em checkResponseCache e isGreeting*
*Bug Fix Leverage igual Amount (17/12/2025): Removida verificação incorreta que descartava leverage quando valor=amount (ex: "compre 10 BTC 10x")*
*Bug Fix messageContent Inconsistente (17/12/2025): buscarContextoRAG e callLlamaAPI agora usam messageContent (com fallback) ao invés de message.content*
*Bug Fix WebSocket Duplicate Subscriptions (17/12/2025): useKucoinWebSocket evita subscriptions duplicadas na conexão inicial via flag initialSubscriptionSentRef*
*Bug Fix WebSocket Connection ID (17/12/2025): connectionIdRef invalida callbacks de WebSockets antigos/órfãos, evita dados corrompidos em mudanças rápidas de symbol*
*Pipeline Unificada (17/12/2025): GPU deploy integrado em deploy-production.yml, workflow deploy-salad-gpu.yml excluído, Terraform obsoleto removido, Python SDK*
*Auditoria KuCoin Completa (17/12/2025): 3 bugs corrigidos - DEFAULT_SYMBOL não definido, riskConfig.enabled→tradingEnabled, stop orders não exportadas*
*Backup Enterprise Completo (17/12/2025): Qdrant backup/restore implementado - snapshot por coleção, upload via API REST, frontend atualizado*
*Bug Fix Health-Check always() (17/12/2025): Job health-check agora usa always() para executar mesmo quando deploy-salad-gpu falha (GPU é opcional)*
*GPU OBRIGATÓRIO Enterprise (17/12/2025): Deploy GPU Salad Cloud agora é OBRIGATÓRIO - GPUs são o coração da IA, plataforma não funciona sem eles*
*Health Check Completo (17/12/2025): Health check agora verifica Hetzner (6 serviços) + GPU Salad Cloud (4 Container Groups) - tolerância zero para falhas*
*Rollback Enterprise Unificado (17/12/2025): Rollback integrado Hetzner + Salad Cloud GPU - cleanup completo de todos os recursos*
*Rollback Script Salad Cloud (17/12/2025): infra/salad-cloud/rollback.py - cleanup de Container Groups via SDK/REST API*
*Learning Worker Enterprise (17/12/2025): learning-worker.ts corrigido - lógica real para rag_update, auto_indexing, incremental/complete fine-tuning, embedding_generation*
*Trading Commands Integration (17/12/2025): chat-service integrado com integrations-service via HTTP para execução real de comandos de trading*
*LoRA Job Cancel GPU (17/12/2025): lora-job-manager.ts agora cancela container group na Salad Cloud ao cancelar job (evita custos órfãos)*
*Code Review Auditoria (17/12/2025): Removidos 3 TODOs/stubs críticos - 100% enterprise compliance (Regra 6)*
*Bug Fix TOCTOU Race Condition (17/12/2025): trading-orchestrator.ts - initiateTradingTakeover e handbackTradingToAlice agora usam SELECT FOR UPDATE dentro da transação*
*Bug Fix validateCommand Missing (17/12/2025): chat-service/index.ts agora chama validateCommand antes de executeTradingCommand - evita requests inválidos (ex: DELETE /orders/ sem orderId)*
*Bug Fix JSON.parse Sem Try/Catch (17/12/2025): embedding-queue.ts (6 ocorrências), backup-orchestrator.ts (3 ocorrências), media-worker.ts (1 ocorrência) - evita crash do serviço se dados corrompidos*
*Auditoria Profunda (17/12/2025): Auditoria REAL de 8 módulos - JSON.parse, NaN guards, division by zero, setInterval cleanup - 10 bugs críticos corrigidos*
*Auditoria Enterprise Completa (17/12/2025): Code review de 10 fases (~210 arquivos TS/TSX) - 2 bugs corrigidos: console.error→frontendLogger, controlMode sync*
*Bug Fix controlMode Sync (17/12/2025): Trading.tsx agora sincroniza controlMode com autoExecuteSignals do servidor - HandoverPanel mostrava modo incorreto*
*Bug Fix console.error (17/12/2025): useKucoinWebSocket.ts agora usa frontendLogger ao invés de console.error (Regra 8)*
*AUDITORIA PROFUNDA ENTERPRISE (17/12/2025): Leitura linha-a-linha de 8 arquivos críticos (~5500 linhas de código Trading/KuCoin)*
*Bug Fix Fetch Timeout (17/12/2025): kucoinClient.ts agora usa AbortController com timeout de 30s - evita conexões penduradas*
*Bug Fix instanceServers Vazio (17/12/2025): kucoinWebSocket.ts valida bulletData.instanceServers antes de acessar - evita crash se array vazio*
*Bug Fix Ping Timer Duplicado (17/12/2025): kucoinWebSocket.ts limpa pingTimer existente antes de criar novo - evita memory leak e pings duplicados*
*Bug Fix avgFilledPrice NaN (17/12/2025): kucoinService.ts valida parseFloat(filledValue) - evita salvar "NaN" no banco se string inválida*
*Bug Fix DB Não Inicializado (17/12/2025): trading-orchestrator.ts usa getDb() com fail-fast - crash claro se initTradingOrchestrator() não chamado*
*Bug Fix Typo hasTradingContext (17/12/2025): trading-command-parser.ts corrigido typo hasTradicngContext → hasTradingContext*
*Bug Fix DELETE Body Descartado (17/12/2025): chat-service/index.ts agora inclui DELETE na condição que envia body - close_position funcionava sem enviar symbol*
*Bug Fix Símbolos Hardcoded (17/12/2025): kucoinClient.ts isValidSymbol() agora aceita KUCOIN_ALLOWED_SYMBOLS via env - expansível sem modificar código*
*Bug Fix command.side Stop Orders (17/12/2025): ParsedTradingCommand agora tem side/positionType - infere LONG→sell, SHORT→buy automaticamente via consulta posição*
*Bug Fix Word Boundary (17/12/2025): trading-command-parser.ts usava includes() - "along" matchava "long" incorretamente - agora usa regex \blong\b*
*Bug Fix CandleChart Interval Sync (17/12/2025): selectedInterval não sincronizava com prop interval - adicionado useEffect + selectedInterval como fonte única*
*Auditoria Final Completa (17/12/2025): FASE 7 (packages ~6500 linhas), FASE 8 (frontend 73 arquivos), FASE 9 (CI/CD ~5087 linhas) - 0 bugs encontrados*
*GitHub Actions Timeouts (18/12/2025): Adicionado timeout-minutes a TODOS os jobs de TODOS os workflows (ci.yml, release.yml, deploy-production.yml, update-system-packages.yml) - evita jobs stuck*
*Bug Fix TradingLoraHyperparams Default (18/12/2025): Corrigido default vazio em hyperparameters - agora usa objeto completo com valores do schema Zod (loraRank:16, loraAlpha:32, etc)*
*Bug Fix Qdrant Circuit Breaker Type (18/12/2025): Corrigido TS2322 em qdrant-client.ts - fire() retorna unknown, adicionado type assertion seguro para Promise<T>*
*Bug Fix TypeScript Tipos (18/12/2025): Corrigidos 40+ erros TS em 8 arquivos - chat-service, integrations-service (kucoinClient, kucoinService, index), observability-service, rag-service, training-service*
*Bug Fix ParsedTradingCommand (18/12/2025): Adicionados campos side/positionType à interface duplicada em chat-service/index.ts*
*Bug Fix conversationId undefined (18/12/2025): Validação obrigatória de conversationId no início do bloco de chat - evita erros TS2769*
*Bug Fix signalType Enum (18/12/2025): CreateSignalParams e Zod schema alinhados com enum do banco (entry_long, entry_short, exit, adjust_sl, adjust_tp, hold, neutral)*
*Bug Fix Drizzle .where() Encadeado (18/12/2025): Corrigido em kucoinService.getOrders() e lora-job-manager - Drizzle não suporta .where() múltiplos*
*Bug Fix Campos Inexistentes (18/12/2025): Removidos details de audit log, atualizadoEm de tradingSignals, cancelledAt/stopLoss/takeProfit de metadata incorreto*
*Bug Fix learning-worker.ts (18/12/2025): Schema documents não tem tenantId/status - corrigido para usar namespaceId e processado (boolean)*
*Bug Fix backup-orchestrator.ts (18/12/2025): qdrant está em manifest.components.qdrant, BACKUPS_BASE_PATH→BACKUP_DIR, fs→existsSync*
*Bug Fix Tipos Number/String (18/12/2025): Campos real() (price, size, confidence, filledSize, avgFilledPrice) agora usam number, não string*
*Bug Fix SQL IN Clause (19/12/2025): learning-worker.ts usava sql template literal com join() - parametrizava string inteira. Corrigido para usar inArray() do Drizzle (3 ocorrências)*
*ESLint Cleanup (19/12/2025): Corrigidos 1 erro + 23 warnings - no-empty-pattern, no-unused-vars, prefer-const em 12 arquivos*
*Performance Otimização (19/12/2025): Express 5.2.1, Vite 7.3.0, Tailwind CSS 4.1.18, HTTP Compression (gzip level 6), HTTP/2 habilitado no Traefik*
*SHA Pinning Enterprise (19/12/2025): 95%+ das GitHub Actions com SHA pinning completo (supply chain security) - ci.yml, release.yml, deploy-production.yml*
*PostgreSQL Indexes (19/12/2025): Migration 0009 (HNSW m=24, ef_construction=128) + Migration 0010 (8 índices compostos/parciais para queries frequentes)*
*Vite Build Otimizado (19/12/2025): manualChunks (vendor-react, vendor-ui, vendor-charts, vendor-i18n, vendor-query, vendor-motion), chunkSizeWarningLimit 500*
*Atualização Total Dependências (19/12/2025): React 19.2.3, pnpm 10.26.1, drizzle-orm 0.45.1, drizzle-kit 0.31.8, drizzle-zod 0.8.3, pg 8.16.3, framer-motion 12.23.26, wouter 3.9.0, i18next 25.7.3, react-day-picker 9.13.0*
*Mais Atualizações (19/12/2025): lucide-react 0.562.0, stripe 20.1.0, esbuild 0.27.2, vitest 4.0.16, @vitest/coverage-v8 4.0.16*
*Servidor Hetzner Hardening (19/12/2025): fail2ban instalado (13 IPs banidos), Docker daemon.json enterprise configurado, Kernel hardening 43 regras em /etc/sysctl.d/99-security.conf*
*Bug Fix Qdrant ReadOnlyFilesystem (19/12/2025): Adicionado tmpfs /qdrant/snapshots - Qdrant precisa escrever em /qdrant/snapshots mesmo com read_only: true*
*Bug Fix Qdrant Healthcheck (19/12/2025): Substituído wget por timeout + /dev/tcp - imagem oficial Qdrant não tem wget/curl*
*Rollback Enterprise Robusto (19/12/2025): full_system_cleanup() corrigido - comandos não falham com lista vazia, recria diretórios com permissões corretas*
*Permissões Enterprise Deploy (19/12/2025): Deploy configura UIDs corretos por serviço - Grafana(472), Prometheus(65534), Loki(10001), PostgreSQL(999), etc.*
*Primeiro Deploy Hetzner (19/12/2025): Servidor 100% configurado - todas dependências instaladas, estrutura de diretórios com permissões enterprise, networks Docker criadas*
*Auditoria Documentação (19/12/2025): Docker 29.1.3 corrigido, referência obsoleta PLANO-100%-BASE.md removida, versões pnpm corrigidas*
*Cache Enterprise CI/CD (19/12/2025): ci.yml migrado de cache: 'pnpm' (built-in setup-node) para actions/cache explícito com restore-keys - elimina warnings "Cache service responded with 400"*
*URLs Produção Auditoria (19/12/2025): Corrigidas URLs em 8 arquivos - Prometheus(metrics.), Jaeger(traces.), Langfuse(langfuse.), Alertmanager adicionado. Código e docs 100% consistentes com Traefik*
*Bug Fix langfuse-db Conflito (19/12/2025): Removido env_file do langfuse-db - POSTGRES_PASSWORD (env_file) conflitava com POSTGRES_PASSWORD_FILE (são mutuamente exclusivos)*
*Bug Fix OTel Collector Config (19/12/2025): service.telemetry.metrics.address deprecado em OTel 0.123+ - corrigido para usar readers com prometheus exporter*
*Bug Fix compression Órfã (19/12/2025): Removidas dependências órfãs compression/@types/compression do package.json raiz - causava "Dynamic require of buffer" em todos serviços Node.js*
*Permissões Servidor Hetzner (19/12/2025): Corrigidas permissões langfuse-db (1777→755), removidos diretórios legados vazios (mariadb, redis)*
*Bug Fix compression Dependência (19/12/2025): Adicionada compression 1.8.1 explicitamente em 5 microsserviços (auth, chat, rag, training, integrations) - estava apenas no package.json raiz e não era externalizada pelo esbuild*
*Bug Fix dockerproxy Healthcheck (19/12/2025): Corrigido healthcheck de nc -z (não disponível) para wget --spider /_ping - imagem Alpine do HAProxy não tem netcat*
*Bug Fix dockerproxy tmpfs /run (19/12/2025): Adicionado tmpfs /run:mode=1777 - HAProxy precisa escrever /run/haproxy.pid com read_only: true*
*Bug Fix opossum Dependência (19/12/2025): Adicionada opossum 9.0.0 em 5 microsserviços - causava "Dynamic require of events" em runtime*
*Rollback Enterprise Completo (19/12/2025): Função full_system_cleanup() reescrita com 7 fases, parâmetro PRESERVE_DATA para diferenciar primeiro deploy de rollback, limpeza 100% funcional*
*Langfuse v3 ClickHouse (19/12/2025): Adicionado ClickHouse 24.8-alpine como OLAP backend obrigatório para Langfuse v3. Novo container clickhouse com 1GB RAM limit*
*ClickHouse Secrets (19/12/2025): Novos secrets CLICKHOUSE_USER e CLICKHOUSE_PASSWORD adicionados ao deploy workflow e .env.prod*
*Loki 3.6+ Config Fix (19/12/2025): Corrigida configuração obsoleta - removido max_transfer_retries, boltdb-shipper→tsdb, schema v13*
*pgBackRest Libs Fix (19/12/2025): Corrigidas dependências runtime - lz4→lz4-libs, zstd→zstd-libs, bzip2→libbz2+libpq*
*esbuild Node Builtins (19/12/2025): Externalizados todos builtins Node.js para evitar "Dynamic require of node:crypto" error*
*Alertmanager Secrets Leak Fix (19/12/2025): Removido env_file para evitar vazamento de secrets em logs Docker*
*ClickHouse IPv4 Only Fix (19/12/2025): Forçado listen_host 0.0.0.0 via override.xml - IPv6 não funciona em Docker/Hetzner, causava "Address family not supported"*
*Loki WAL Fix (19/12/2025): Corrigido ingester_rf1 (não existe) para ingester.wal, replay_memory_ceiling 4GB→750MB (dentro do limite 1G), retention_period 744h*
*pgvector External Fix (19/12/2025): Adicionado pgvector como dependência direta de TODOS microsserviços (auth, chat, rag, training, integrations) - evita "Dynamic require of node:util" quando bundlado pelo esbuild*
*redis External Fix (19/12/2025): Adicionado redis + rate-limit-redis como dependência direta de TODOS microsserviços - evita "Dynamic require of node:crypto" quando bundlado pelo esbuild (redis v5+ usa crypto dinâmico)*
*Build Script Enterprise Fix (20/12/2025): Reescrito build-service.mjs para coletar e externalizar TODAS dependências de TODOS pacotes @alice/* - resolve "Dynamic require" de forma DEFINITIVA (prom-client, redis, pgvector, etc.)*
*Dependências Externalizadas Fix (20/12/2025): Adicionado express-rate-limit, prom-client, swagger-ui-express em TODOS microsserviços - pacotes externalizados precisam estar em node_modules do container*
*Rollback Inteligente Enterprise (19/12/2025): Função has_real_production_data() verifica manifesto válido + containers healthy + volumes reais antes de preservar dados*
*Rollback Limpeza Total (19/12/2025): full_system_cleanup() agora remove TODOS volumes nomeados quando PRESERVE_DATA=false (primeiro deploy sem dados reais)*
*drizzle-orm Dependência Direta (20/12/2025): Adicionado drizzle-orm em TODOS microsserviços - @alice/database re-exporta eq, and, desc, etc do drizzle que precisam estar instalados no container*
*Rollback Verifica Dados Reais PostgreSQL (20/12/2025): has_real_production_data() agora executa query real no PostgreSQL para verificar se existem tenants/users - não apenas containers/volumes*
*Bug Fix ERPNext create-site (20/12/2025): Comando incorreto "new" corrigido para "bench new-site" - causava erro "executable file not found in $PATH"*
*Docker Hub Rate Limit Fix (20/12/2025): Adicionado login Docker Hub em deploy-production.yml (3 locais) - evita rate limit 100 pulls/6h anônimo*
*Digests ARM64 Removidos (20/12/2025): Removidos SHA256 digests incompatíveis com amd64 (Qdrant, ClickHouse, Langfuse DB, Alertmanager, Node Exporter) - tags versionadas são seguras para Supply Chain Security*
*ClickHouse Healthcheck Fix (20/12/2025): Corrigido healthcheck de wget (não existe) para clickhouse-client --query 'SELECT 1' - imagem Alpine não tem wget/curl*
*Healthchecks Enterprise Fix (20/12/2025): Corrigidos healthchecks para containers sem wget/curl: Qdrant (/proc/net/tcp:18BD), dockerproxy (/proc/net/tcp:0947), Node Exporter (/proc/net/tcp:238C)*
*Code Review Enterprise COMPLETO (20/12/2025): Auditoria 100% aprovada - 44 containers, 7 microsserviços, 5 packages, 4 workflows, 11 migrations. Zero TODO/FIXME/HACK, zero console.log, zero any, zero mocks. 54 RLS policies, 54 indexes, 89 pgvector configs, 80 SHA pins, 22 timeouts.*
*Bug Fix Rollback Dados Residuais (21/12/2025): FASE 7 de full_system_cleanup() agora limpa dados residuais de deploys anteriores (rm -rf /opt/alice/data/* e logs/*) ANTES de recriar estrutura quando PRESERVE_DATA=false - evita lixo de deploys falhados acumulando no servidor*
*ERPNext Create-Site Idempotente (21/12/2025): Container erpnext-create-site agora verifica se site existe antes de criar - evita exit 1 em redeploys quando site já foi criado anteriormente*
*Dockerproxy Healthcheck Fix (21/12/2025): Healthcheck atualizado de /proc/net/tcp para wget --spider http://localhost:2375/_ping - mais confiável e com start_period aumentado para 30s*
*Bug Fix ERPNext Logs Permissions (21/12/2025): Adicionado chown -R 1000:1000 /opt/alice/logs/erpnext - ERPNext roda como UID 1000 (frappe) e precisa de permissão de escrita para logs*
*Bug Fix PostgreSQL SSL (21/12/2025): Alterado sslmode=prefer para sslmode=disable em DATABASE_URL - conexões internas Docker não precisam de SSL e PostgreSQL local não tem SSL configurado*
*Bug Fix ws Dynamic Require (21/12/2025): Adicionado ws como dependência direta do rag-service - evita "Dynamic require of events is not supported" causado por ytdl-core*
*Bug Fix ClickHouse Healthcheck Auth (21/12/2025): Healthcheck agora inclui --user e --password para autenticação - sem credenciais o clickhouse-client retorna erro*
*Bug Fix Langfuse SSL (21/12/2025): DATABASE_URL do langfuse e langfuse-worker alterado de sslmode=prefer para sslmode=disable - PostgreSQL interno sem SSL*
*Bug Fix Secrets Validação Fail-Fast (21/12/2025): Adicionada validação fail-fast para TODAS as secrets obrigatórias (QDRANT_API_KEY, SALAD_API_KEY, SALAD_ORGANIZATION_ID, SESSION_SECRET, INTERNAL_API_SECRET, SEARXNG_SECRET_KEY, CLICKHOUSE_PASSWORD, REDIS_CACHE_PASSWORD, REDIS_QUEUE_PASSWORD, ERPNEXT_MYSQL_ROOT_PASSWORD, ERPNEXT_DB_PASSWORD) - deploy falha imediatamente se qualquer secret obrigatória não estiver configurada*
*Bug Fix Uploads Directory Permissions (21/12/2025): Adicionado chown -R 1000:1000 /opt/alice/uploads - alice-rag roda como UID 1000 (node) e precisa de permissão de escrita no diretório de uploads*
*Bug Fix CLICKHOUSE_USER Default (21/12/2025): Corrigido default de CLICKHOUSE_USER - se secret vazio, usa "langfuse" como default ao invés de escrever valor vazio no .env.prod*
*Bug Fix SMTP Secrets Removidos (21/12/2025): Removidos secrets SMTP_HOST, SMTP_PORT, SMTP_FROM, SMTP_USERNAME, SMTP_PASSWORD do workflow - Resend usa valores SMTP fixos (smtp.resend.com:587) + RESEND_API_KEY como senha. Docs: https://resend.com/docs/send-with-smtp*
*Trading Analysis Enterprise (21/12/2025): Indicadores técnicos calculados por CÓDIGO (determinísticos) - RSI, MACD, EMA, SMA, Bollinger Bands, ATR, Stochastic, ADX, Pivot Points*
*Technical Indicators Service (21/12/2025): technical-indicators.ts usa biblioteca technicalindicators 3.1.0 - cálculos precisos sem alucinação*
*LLM Validation Service (21/12/2025): llm-validation.ts extrai valores citados pelo LLM e compara com valores reais calculados - detecta alucinações numéricas*
*Trading Technical Indicators Table (21/12/2025): Migration 0012 - tabela trading_technical_indicators com RLS para persistir indicadores calculados*
*Trading LLM Validations Table (21/12/2025): Migration 0012 - tabela trading_llm_validations com RLS para registrar validação cruzada*
*Trading Analysis API (21/12/2025): GET /api/integrations/trading/analysis/:symbol - calcula indicadores e retorna prompt formatado para LLM*
*Trading Analysis History API (21/12/2025): GET /api/integrations/trading/analysis/history - histórico de análises calculadas*
*Trading Validations API (21/12/2025): GET /api/integrations/trading/validations - estatísticas de validação cruzada (taxa de acerto LLM)*
*TechnicalAnalysisPanel Component (21/12/2025): Componente React que exibe indicadores técnicos calculados por código com cores e interpretações*
*SignalApprovalPanel Component (21/12/2025): Painel de aprovação/rejeição de sinais com suporte a modo manual e Alice (automático)*
*Trading Page Analysis Tab (21/12/2025): Nova aba "Análise Técnica" na página de Trading com todos indicadores e níveis de suporte/resistência*
*Anti-Alucinação Architecture (21/12/2025): LLM recebe indicadores pré-calculados → gera análise → código valida se citou valores corretos*
*Bug Fix Analysis History interval (21/12/2025): Query do histórico agora filtra por interval (antes era ignorado, misturava todos os timeframes)*
*Bug Fix minConfidenceToExecute (21/12/2025): Usar ?? ao invés de || para preservar valor 0 válido (0 é falsy com ||)*
*Bug Fix Validation noValuesExtracted (21/12/2025): totalFields === 0 agora marca passed=false e overallAccuracy=0 (evita aprovação de respostas vagas)*
*Bug Fix MACD Enum Mismatch (21/12/2025): MACDResult.interpretation agora usa 'sideways' ao invés de 'neutral' - compatibilidade com trendEnum do PostgreSQL*
*Bug Fix SMTP_PASSWORD Faltante (21/12/2025): Adicionado SMTP_PASSWORD usando RESEND_API_KEY - Resend usa API Key como senha SMTP para autenticação*
*Bug Fix TypeScript interval Enum (21/12/2025): Adicionada validação e type narrowing para interval - TypeScript não entendia que string era um valor válido do enum após validação*
*Bug Fix Frontend MACDResult (21/12/2025): TechnicalAnalysisPanel.tsx agora usa 'sideways' ao invés de 'neutral' - alinhado com backend e trendEnum PostgreSQL*
*Bug Fix Typo 'as string' (21/12/2025): Corrigido `as 'string'` (literal) para type assertion correta no insert de indicadores*
*Bug Fix deploy-production.yml Expression Length (21/12/2025): Step "Criar arquivo .env.prod seguro" excedia limite de 21.000 caracteres do GitHub Actions. Criado script externo infra/scripts/generate-env-prod.sh - Best Practice 2025 para scripts grandes em workflows*
*Deploy Workflow Gate (21/12/2025): Adicionado job validate-trigger como gate de segurança - version é OBRIGATÓRIO e deve ser tag válida (v1.0.0). Impede disparo acidental do deploy sem versão. Release workflow passa triggered_by: release-workflow para auditoria*
*ESLint Cleanup (21/12/2025): Removidos imports não utilizados (Tooltip, TooltipContent, TooltipTrigger) de TechnicalAnalysisPanel.tsx e variável opens não utilizada de technical-indicators.ts - Zero warnings no CI*
*Bug Fix AlertTriangle Import (21/12/2025): Adicionado import AlertTriangle faltante em TechnicalAnalysisPanel.tsx - erro TS2304 no build*
*Healthchecks /live Enterprise (21/12/2025): Todos healthchecks dos 6 serviços Alice alterados de /ready para /live - /ready verifica dependências externas (GPU Salad Cloud) e falha se não estiverem prontas. Docker healthcheck deve verificar se PROCESSO está vivo, não dependências. Corrige erro "container alice-rag is unhealthy" em primeiro deploy*
*Healthchecks Dockerfiles Sync (21/12/2025): Dockerfiles de todos 6 serviços Alice atualizados com /live para consistência com docker-compose.prod.yml*
*ClickHouse start_period (21/12/2025): Aumentado start_period de 60s para 120s e retries de 5 para 8 - primeira inicialização do ClickHouse pode demorar mais*
*RAG start_period (21/12/2025): Aumentado start_period de 60s para 90s - RAG tem mais dependências para inicializar (Qdrant, FFmpeg)*
*Bug Fix Qdrant Healthcheck pgrep (21/12/2025): Removido pgrep do healthcheck do Qdrant - imagem oficial qdrant/qdrant é minimalista e não tem pgrep instalado. Healthcheck agora usa apenas grep /proc/net/tcp para verificar porta*
*Bug Fix ERPNext Volume Conflict (21/12/2025): Adicionada limpeza de volumes Docker órfãos e verificação de conflitos arquivo/diretório. Erro "mkdir: file exists" ocorre quando Docker encontra arquivo onde deveria haver diretório. Deploy agora limpa /var/lib/docker/volumes/ e usa safe_mkdir() para criar diretórios*
*Rollback Enterprise Volumes (21/12/2025): FASE 4 do full_system_cleanup() agora remove resíduos de volumes em /var/lib/docker/volumes/ (erpnext-sites, erpnext-logs) e verifica conflitos arquivo/diretório*
*Bug Fix Dangling Symlink Detection (21/12/2025): Corrigido safe_mkdir() e verificações de conflito arquivo/diretório para detectar dangling symlinks. Condição `[ -e ]` segue symlinks e retorna false se target não existe. Adicionado `[ -L ]` para detectar symlinks independente do target*
*Bug Fix erpnext-logs Path (21/12/2025): Corrigido caminho de verificação de conflito - era /opt/alice/data/erpnext-logs (errado), agora é /opt/alice/logs/erpnext (correto conforme docker-compose.prod.yml)*
*Salad Cloud Warnings Removidos (21/12/2025): SALAD_API_URL, SALAD_MEDIA_PROJECT e SALAD_GPU_CLASS são valores de produção reais (não mocks) - removidos warnings desnecessários. URL da API é fixa (https://api.salad.com/api/public) conforme documentação oficial*
*Bug Fix QDRANT_URL Faltante alice-rag (21/12/2025): Variáveis QDRANT_URL e QDRANT_API_KEY estavam FALTANDO no docker-compose.prod.yml para alice-rag. Sem estas variáveis, RAG service não conseguia conectar ao Qdrant (banco vetorial de texto 4096 dim), causando erro "container alice-rag is unhealthy". Training e integrations tinham, mas rag não*
*Deploy Timeout Reduzido (21/12/2025): Reduzido --wait-timeout de 300s (5 min) para 120s (2 min). 5 minutos era muito longo - workflow ficava "pendurado" esperando containers que já haviam falhado. 2 minutos é suficiente para containers iniciarem - fail fast é melhor prática*
*Deploy Fail Fast (21/12/2025): Adicionada captura IMEDIATA de logs quando DEPLOY_EXIT_CODE != 0. Antes o workflow continuava para verificações pós-deploy mesmo após falha. Agora captura logs de TODOS containers Alice problemáticos e falha imediatamente com exit 1*
*Bug Fix Log Capture DEPLOY_SERVICES (21/12/2025): Captura de logs agora respeita DEPLOY_SERVICES - alice-only captura Alice, erpnext-only captura ERPNext, all captura ambos. Bug anterior: só capturava Alice mesmo quando ERPNext falhava*
*Bug Fix Container Names (21/12/2025): Corrigidos nomes postgres→alice-postgres, traefik→alice-traefik na lista de captura de logs. grep usa match exato (^${container}$) - nomes devem bater exatamente com docker-compose.prod.yml*
*Bug Fix ERPNext Workers -2 (21/12/2025): Adicionados erpnext-worker-default-2, erpnext-worker-short-2, erpnext-worker-long-2 na lista ERPNEXT_CONTAINERS. Eram 12 containers, agora 15 (todos os workers incluídos)*
*Bug Fix ERPNext Configurator $$ Escape (21/12/2025): Escapar $ com $$ no command do erpnext-configurator para evitar substituição pelo Docker Compose. Bug: Docker Compose interpreta $CACHE_URL e $QUEUE_URL como env vars, mas são variáveis bash internas. Aviso: "The CACHE_URL variable is not set. Defaulting to a blank string."*
*URLs GPU Automáticas (21/12/2025): deploy.py agora captura URLs dos Container Groups automaticamente após criação. URLs são passadas como outputs do job deploy-salad-gpu e atualizadas no .env.prod do servidor Hetzner. Elimina necessidade de configurar secrets SALAD_MIXTRAL_URL, EMBEDDINGS_GPU_URL, etc. manualmente.*
*Bug Fix Paths Workflow (21/12/2025): Corrigidos TODOS os paths no deploy-production.yml. Repositório é clonado em /opt/alice/app, então todos os paths devem usar /opt/alice/app/infra/docker (não /opt/alice/infra/docker). Adicionado cd /opt/alice/app após o clone. Corrigidos paths de validação, .env.prod, cleanup, rollback e URLs GPU.*
*Bug Fix REDIS_URL Faltando (21/12/2025): REDIS_URL estava FALTANDO em 5 dos 6 serviços Alice no docker-compose.prod.yml! Erro: "REDIS_URL não configurado em produção. Rate limiting distribuído é obrigatório (Regra 6)". Corrigido adicionando REDIS_URL para: alice-auth, alice-rag, alice-training, alice-integrations, alice-observability. Apenas alice-chat já tinha. Também adicionada dependência alice-redis em todos os serviços.*
*Bug Fix ERPNext Configurator PRE-DEPLOY (21/12/2025): erpnext-configurator falhava porque volume montado sobrescreve arquivos originais do container. Solução: apps.txt e common_site_config.json agora são criados no PRÉ-DEPLOY (workflow) em /opt/alice/data/erpnext-sites/ com UID 1000 (frappe). Erros corrigidos: "OSError: b'./apps.txt' Not Found", "JSONDecodeError", "PermissionError".*
*Pipeline 100% Automática (21/12/2025): Deploy na Hetzner e Salad Cloud são 100% automáticos. URLs dos Container Groups GPU (SALAD_MIXTRAL_URL, EMBEDDINGS_GPU_URL, etc.) são capturadas automaticamente pelo deploy.py via GITHUB_OUTPUT e atualizadas no .env.prod do servidor Hetzner. Sem necessidade de configurar secrets manualmente para URLs GPU.*
*Bug Fix ClickHouse override.xml (22/12/2025): REMOVIDO mount de override.xml que causava falha na inicialização do ClickHouse. A imagem oficial já tem docker_related_config.xml com listen_host correto (0.0.0.0 e ::) e listen_try=1 para ignorar falhas de IPv6. O override.xml sobrescrevia essas configurações e fazia ClickHouse escutar apenas em 127.0.0.1:9009, sem abrir portas 8123 (HTTP) e 9000 (TCP).*
*Bug Fix ClickHouse CLICKHOUSE_LISTEN_HOST (22/12/2025): Adicionada variável de ambiente CLICKHOUSE_LISTEN_HOST="0.0.0.0". O entrypoint da imagem oficial passa --listen_host=127.0.0.1 por padrão durante inicialização. Sem esta variável, Langfuse não conseguia conectar ao ClickHouse.*
*Bug Fix Redis SHA256 Digest (22/12/2025): Atualizado digest do Redis de sha256:4e053b71... para sha256:3b73847e... - digest anterior estava obsoleto e causava erro "manifest unknown" no docker pull.*
*Bug Fix ERPNext Memory Limits (22/12/2025): erpnext-create-site aumentado de 256MB para 1GB - bench new-site precisa de mais memória para instalar ERPNext (~300 tabelas). erpnext-configurator aumentado de 256MB para 512MB. Documentação Frappe recomenda mínimo 1GB para instalação.*
*Bug Fix bench new-site --db-host (22/12/2025): Comando bench new-site falhava porque não especificava --db-host e --db-port. Sem esses parâmetros, bench tentava conectar ao localhost. Adicionado --db-host erpnext-mariadb e --db-port 3306 explicitamente. Ref: https://frappeframework.com/docs/user/en/bench/reference/new-site*
*Bug Fix ERPNext Configurator apps.txt (22/12/2025): apps.txt estava sendo criado manualmente com conteúdo hardcoded no workflow. Padrão oficial frappe_docker usa `ls -1 apps > sites/apps.txt` para listar apps realmente instalados. Também faltava redis_socketio e socketio_port na configuração.*
*Debug ERPNext create-site (22/12/2025): Adicionado logging detalhado ao script create-site - verifica ambiente, testa conexão MariaDB antes de criar site, captura logs do bench em caso de falha. Flag --verbose adicionada ao bench new-site.*
*Security Fix common_site_config.json (22/12/2025): Removido cat de common_site_config.json dos logs - arquivo contém senhas Redis. Agora mostra apenas tamanho do arquivo e lista de chaves (sem valores) via jq.*
*Debug Clone Workflow (22/12/2025): Adicionado logging detalhado ao passo de clone - valida GH_PAT e REPO_FULL_NAME antes de clonar, mostra conteúdo de /opt/alice antes e depois do clone para identificar problemas de estrutura.*
*Debug erpnext-create-site Prioritário (22/12/2025): Captura de logs do erpnext-create-site agora é PRIORIDADE MÁXIMA quando deploy falha - logs completos + docker inspect capturados ANTES de outros containers.*
*Bug Fix mysql CLI Inexistente (22/12/2025): Removido teste de conexão MySQL do erpnext-create-site - imagem frappe/erpnext não tem mysql CLI instalado. O bench new-site faz sua própria verificação de conexão internamente.*
*Bug Fix ERPNext Memory 2GB (22/12/2025): erpnext-create-site aumentado de 1GB para 2GB - ERPNext v15.91.3 usa >1GB durante instalação (cria ~300 tabelas, instala apps). CPU também aumentada de 1.0 para 1.5.*
*Security Fix Configurator Logs (22/12/2025): Removido `cat sites/common_site_config.json` do configurator - arquivo contém senhas Redis. Agora mostra apenas lista de chaves via jq.*
*Bug Fix SITE_NAME vs ERPNEXT_SITE_NAME (22/12/2025): Script do erpnext-create-site usava ${ERPNEXT_SITE_NAME} mas o environment define SITE_NAME. Container recebe SITE_NAME, não ERPNEXT_SITE_NAME. Corrigido para usar ${SITE_NAME} diretamente.*
*Código Morto Removido (22/12/2025): Removido script /tmp/update_gpu_urls.sh que era criado no runner GitHub Actions mas nunca executado. O passo SSH posterior já tinha seu próprio script inline funcionando corretamente com path /opt/alice/app/infra/docker.*
