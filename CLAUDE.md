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
Alice employs a microservices architecture with 43 containerized services orchestrated by Traefik API Gateway, emphasizing data privacy, scalability, and resilience.

**Core Architectural Components:**
- **Infrastructure Core (7 serviços)**: Docker Socket Proxy, Traefik Init, Traefik API Gateway, PostgreSQL (with pgvector for image embeddings and RLS for multi-tenancy), Alice Redis (dedicated cache), **SearXNG (metabusca interna para Web Search)**, **Qdrant (banco vetorial para texto 4096 dim)**.
- **Alice Microservices (8 serviços)**:
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
- **Observability Stack (13 serviços)**: Langfuse Web (LLM observability), **Langfuse Worker (processamento assíncrono v3)**, Langfuse DB (PostgreSQL), Prometheus (métricas), Grafana (dashboards), Loki (logs), Promtail (coleta de logs), Jaeger (tracing), Vector (agregação de logs), Alertmanager (alertas), OTel Collector (instrumentação), Node Exporter (métricas do host), cAdvisor (métricas de containers).
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
- **Docker**: 29.1.2, Docker Compose v5.0.0
- **Pipeline**: Push → CI (auto) → Release (auto) → Deploy (auto)

## URLs de Produção
| Serviço | URL |
|---------|-----|
| Alice Frontend | https://yesyoudeserve.duckdns.org |
| Alice Chat | https://yesyoudeserve.duckdns.org/chat |
| ERPNext | https://erp.yesyoudeserve.duckdns.org |
| Grafana | https://observability.yesyoudeserve.duckdns.org |
| Prometheus | https://prometheus.yesyoudeserve.duckdns.org |
| Jaeger | https://tracing.yesyoudeserve.duckdns.org |

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
├── uploads/                        # Uploads multimodais (750) - DUAS estruturas
│   ├── {tenantId}/                 # Uploads gerais de usuários (isolamento por tenant)
│   │   ├── image/                  # Imagens enviadas via /api/media/upload
│   │   ├── audio/                  # Áudios enviados via /api/media/upload
│   │   ├── video/                  # Vídeos enviados via /api/media/upload
│   │   └── document/               # Documentos enviados via /api/media/upload
│   ├── tts/                        # Outputs de jobs TTS (Salad) - output-{jobId}.wav
│   ├── lip-sync/                   # Outputs de jobs lip-sync (Salad) - output-{jobId}.mp4
│   ├── talking-head/               # Outputs de jobs talking-head (Salad) - output-{jobId}.mp4
│   ├── long-video/                 # Outputs de jobs long-video (Salad) - output-{jobId}.mp4
│   └── media/                      # Outros arquivos multimodais (reservado)
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
| `docs/PLANO-100%-BASE.md` | Plano de gaps e correções |
| `docs/DEPLOYMENT.md` | Guia de deploy para produção |
| `docs/SECRETS.md` | Guia de secrets e webhooks |
| `docs/SISTEMA-APRENDIZADO.md` | Sistema de auto-aprendizado |

## Contas Administrativas (Acesso Inicial)
- **Alice/Auth (admin global)**: `ADMIN_USER` + `ADMIN_PWD` (semeados no auth-service; role `super_admin`).
- **Grafana**: `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD` (por padrão herdam `ADMIN_USER/ADMIN_PWD` via CI).
- **ERPNext**: usuário fixo `Administrator` + `ERPNEXT_ADMIN_PASSWORD` (pode usar a mesma senha do admin global).
- Provisionamento: `.github/workflows/deploy-production.yml` falha se `ADMIN_USER`/`ADMIN_PWD` ausentes; secrets de Grafana/ERPNext recebem fallback seguro.

## Security Hardening (14 de Dezembro de 2025)
- **43 containers** = 100% com `security_opt: no-new-privileges` ✅ COMPLETO
- **24 containers** = 100% com `read_only: true` + tmpfs (apenas onde não há escrita necessária)
- **43 containers** = 100% com resource limits ✅ COMPLETO
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
- **Frontend**: React 18, TypeScript 5.9.3, Vite 5, shadcn/ui, Tailwind CSS 4
- **Backend**: Node.js (versão LTS automática via API + fallback .nvmrc), Express 4.22, pnpm (versão automática via package.json)
- **Database**: PostgreSQL 16 + pgvector, Drizzle ORM
- **Python**: Python 3.13 (via .python-version - fonte primária para garantir compatibilidade), PyTorch 2.9.1 (versão mais recente - Nov 2025, corrige CVE-2025-32434)
- **CI/CD**: GitHub Actions (100% automático)
- **Atualização Periódica**: Workflows automáticos para dependências npm/pnpm (semanal) e pacotes do sistema Hetzner (semanal)
- **pnpm (build scripts)**: Em **CI/deploy**, definimos `NPM_CONFIG_DANGEROUSLY_ALLOW_ALL_BUILDS=true` para permitir execução automática de scripts (sem `approve-builds`). Para builds Docker, os `Dockerfile` dos serviços exportam essa variável **somente no build stage** (onde roda `pnpm install`). Em desenvolvimento local, a proteção padrão permanece.

---
*Autor: Fillipe Guerra*
*Versão: 3.94 - 17 de Dezembro de 2025*
*Total de Containers: 43 (7 infra + 7 Alice + 15 ERPNext + 13 observability + 1 backup)*
*GitHub Secrets: 50 configurados (SALAD_PROJECT_ID adicionado 17/12/2025)*
*Storage: Volume Hetzner 100GB local (/opt/alice) - SEM S3 externo*
*Backup API: disk-usage, cleanup, delete endpoints (100% Enterprise)*
*Trading: Schema completo (9 tabelas) + API REST (22 endpoints) + LoRA Dataset + Scalping (1m/3m/5m candles) + RBAC Permissões*
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
