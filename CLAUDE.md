# Alice - Plataforma Enterprise de IA Autônoma

## Overview
Alice is an autonomous AI enterprise platform powered by the Llama 4 Maverick (400B parameters) model, hosted on Salad Cloud. Its core purpose is to provide a fully autonomous AI solution with absolute privacy, predictable costs, and unlimited customization via fine-tuning. The platform aims to eliminate external API dependencies, mitigate privacy concerns, and offer an alternative to unpredictable token-based pricing. Key capabilities include real-time chat with streaming, deduplication, multi-tenancy, RBAC, a RAG backend, image generation, aggressive self-learning, and a robust observability stack. The business vision is to deliver an enterprise-grade AI solution with unparalleled control, performance, data security, and cost predictability.

## User Preferences
### 17 Regras Fundamentais

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
| 17 | **REVIEW ANTES DO PUSH** | Consolidar mudanças em commit único, aguardar Review automática do Cursor, e só fazer push após aprovação do usuário |

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
Alice employs a microservices architecture with 35 containerized services orchestrated by Traefik API Gateway, emphasizing data privacy, scalability, and resilience.

**Core Architectural Components:**
- **Infrastructure Core (5 serviços)**: Docker Socket Proxy, Traefik Init, Traefik API Gateway, PostgreSQL (with pgvector for semantic search and RLS for multi-tenancy), Alice Redis (dedicated cache).
- **Alice Microservices (8 serviços)**:
    - **Frontend**: React 18, Vite 5, shadcn/ui, i18n PT-BR.
    - **Auth Service**: OAuth 2.0, SAML 2.0, OIDC Provider, 6-level RBAC, PostgreSQL sessions.
    - **Chat Service**: Real-time LLM token streaming via WebSockets.
    - **RAG Service**: Retrieval-Augmented Generation with embeddings and pgvector.
    - **Training Service**: Fine-tuning and self-learning scheduler.
    - **Integrations Service**: Handles external APIs (Stripe, Wise, Twilio, Resend).
    - **Observability Service**: Prometheus, Grafana, Jaeger for metrics, dashboards, and tracing.
    - **CLIP Inference**: Multimodal embeddings for images using CLIP ViT-L/14 (Python, PyTorch).
- **ERPNext Stack (15 serviços)**: Includes MariaDB, Redis Cache/Queue, Frappe Bench services (configurator, create-site, backend), NGINX frontend, WebSocket, Scheduler, and 9 Workers (3x default, 3x short, 3x long) for comprehensive ERP functionalities.
- **Observability Stack (6 serviços)**: Langfuse (LLM observability), Prometheus (métricas), Grafana (dashboards), Loki (logs), Promtail (coleta de logs), Jaeger (tracing).
- **Backup (1 serviço)**: pgBackRest for PostgreSQL enterprise backups (WAL archiving, incremental, encryption AES-256).

**Shared Packages (`packages/`):**
- `config`: Centralized configurations.
- `database`: Drizzle ORM, PostgreSQL schemas.
- `logger`: Pino structured logging.
- `shared`: Shared TypeScript types.
- `shared-utils`: Utilities like shutdown manager, circuit breaker, cache adapter.

## External Dependencies
- **LLM**: Llama 4 Maverick (400B params) on Salad Cloud.
- **Embeddings**: text-embedding-3-small on Salad Cloud.
- **Image Generation**: FLUX.1 Schnell on Salad Cloud.
- **CLIP Inference**: CLIP ViT-L/14 on Salad Cloud.
- **Payments**: Stripe, Wise.
- **CRM/ERP**: ERPNext.
- **Communication**: Twilio (WhatsApp, SMS), Resend (transactional emails).
- **Database**: PostgreSQL with pgvector extension.
- **Observability**: Prometheus 3.8, Grafana OSS 11.3, Jaeger 1.76, Loki 3.6, Promtail 3.6, OpenTelemetry Collector, Langfuse 2.x.
- **API Gateway**: Traefik v3.6.
- **CI/CD**: GitHub Actions.
- **Storage**: Hetzner Volume local (100GB EXT4, expansível até 10TB).

## Deploy Information
- **Servidor**: Hetzner CX43 (8 vCPU, 16GB RAM, 160GB NVMe SSD)
- **Volume Adicional**: Hetzner Volume 100GB (alice-data) montado em /mnt/alice-data
- **IP**: 46.224.46.93
- **Domínio**: yesyoudeserve.duckdns.org
- **SO**: Ubuntu 24.04.3 LTS
- **Docker**: 29.0.4, Docker Compose v2.40.3
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
│   ├── observability-service/      # Prometheus, Grafana, Jaeger
│   └── clip-inference-service/     # Python/PyTorch CLIP
├── packages/                       # Código compartilhado (5)
│   ├── shared/                     # Schema Drizzle ORM
│   ├── database/                   # PostgreSQL + pgvector
│   ├── shared-utils/               # Utilities
│   ├── config/                     # Validação Zod
│   └── logger/                     # Pino singleton
├── infra/docker/                   # Docker Compose prod
├── docs/                           # Documentação completa
└── .github/workflows/              # CI/CD (3 workflows)
```

## Estrutura do Volume Hetzner (Produção)
```
/mnt/alice-data/                    # Volume Hetzner 100GB (expansível até 10TB)
├── data/                           # Dados persistentes dos bancos
│   ├── postgresql/                 # Dados PostgreSQL + pgvector
│   ├── mariadb/                    # Dados MariaDB (ERPNext)
│   └── redis/                      # Dados Redis (persistência)
├── uploads/                        # Uploads de mídia (RAG multimodal)
│   └── {tenantId}/                 # Isolamento por tenant
│       ├── image/                  # Imagens processadas
│       ├── audio/                  # Áudios processados
│       ├── video/                  # Vídeos processados
│       └── document/               # Documentos (PDF, DOCX, etc.)
└── backups/                        # Backups locais
    ├── postgresql/                 # pgBackRest (full + incremental + WAL)
    ├── mariadb/                    # Mariabackup dumps
    ├── redis/                      # RDB snapshots
    └── manifests/                  # Manifestos JSON de cada backup

/opt/alice -> /mnt/alice-data       # Symlink para acesso padrão
```

## Documentação Principal
| Documento | Descrição |
|-----------|-----------|
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

## Security Hardening (Dezembro 2025)
- **35 containers** = 100% com `security_opt: no-new-privileges` ✅ COMPLETO
- **21 containers** = 100% com `read_only: true` + tmpfs (apenas onde não há escrita necessária)
- **35 containers** = 100% com resource limits ✅ COMPLETO
- **26 imagens externas** = 100% com SHA256 digests
- **17 containers** = 100% com healthchecks (init excluídos)
- **Google Distroless** = 6 serviços Node.js (0 CVEs)
- **OWASP API Top 10** = 9/10 mitigados
- **Nota:** ERPNext workers e init containers (11 containers) não têm `read_only: true` pois precisam escrever em volumes (comportamento correto e enterprise-grade)

## Technical Stack
- **Frontend**: React 18, TypeScript 5.9.3, Vite 5, shadcn/ui, Tailwind CSS 4
- **Backend**: Node.js (versão LTS automática via API + fallback .nvmrc), Express 4.22, pnpm (versão automática via package.json)
- **Database**: PostgreSQL 16 + pgvector, Drizzle ORM
- **Python**: Python (versão estável automática via API + fallback .python-version), PyTorch 2.9.1 (CLIP service)
- **CI/CD**: GitHub Actions (100% automático)
- **Atualização Periódica**: Workflows automáticos para dependências npm/pnpm (semanal) e pacotes do sistema Hetzner (semanal)

---
*Autor: Fillipe Guerra*
*Versão: 3.23 - 09 de Dezembro de 2025*
*Total de Containers: 35 (5 infra + 8 Alice + 15 ERPNext + 6 observability + 1 backup)*
*Storage: Volume Hetzner 100GB local (/opt/alice) - SEM S3 externo*
*Backup API: disk-usage, cleanup, delete endpoints (100% Enterprise)*
*Versionamento Automático: 100% enterprise - Node.js LTS (API + .nvmrc), pnpm (package.json), componentes externos (GitHub API + fallback JSON)*
*Atualização Periódica: 100% automática - dependências npm/pnpm (PR automático semanal), pacotes do sistema Hetzner (issue automática semanal)*
*Security Hardening: 100% completo - 35/35 containers com no-new-privileges, 35/35 com resource limits, 21/35 com read_only (aplicável apenas onde não há escrita)*
*Última Revisão Completa: 09/12/2025 - Processo de atualização periódica implementado, workflows com SHA pinning, 17/17 regras em 100% compliance*
