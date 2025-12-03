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
Alice employs a microservices architecture with 26 containerized services orchestrated by Traefik API Gateway, emphasizing data privacy, scalability, and resilience.

**Core Architectural Components:**
- **Infrastructure Core**: Docker Socket Proxy, Traefik Init, Traefik API Gateway, PostgreSQL (with pgvector for semantic search and RLS for multi-tenancy).
- **Alice Microservices (8 serviços)**:
    - **Frontend**: React 18, Vite 5, shadcn/ui, i18n PT-BR.
    - **Auth Service**: OAuth 2.0, SAML 2.0, OIDC Provider, 6-level RBAC, PostgreSQL sessions.
    - **Chat Service**: Real-time LLM token streaming via WebSockets.
    - **RAG Service**: Retrieval-Augmented Generation with embeddings and pgvector.
    - **Training Service**: Fine-tuning and self-learning scheduler.
    - **Integrations Service**: Handles external APIs (Stripe, Wise, Twilio, Resend).
    - **Observability Service**: Prometheus, Grafana, Jaeger for metrics, dashboards, and tracing.
    - **CLIP Inference**: Multimodal embeddings for images using CLIP ViT-L/14 (Python, PyTorch).
- **ERPNext Stack**: Includes MariaDB, Redis, Frappe Bench services, and NGINX frontend for comprehensive ERP functionalities.
- **Backup & Logs**: pgBackRest for PostgreSQL backups and Vector for log aggregation.

**Shared Packages (`packages/`):**
- `config`: Centralized configurations.
- `database`: Drizzle ORM, PostgreSQL schemas.
- `logger`: Pino structured logging.
- `shared`: Shared TypeScript types.
- `shared-utils`: Utilities like shutdown manager, circuit breaker, cache adapter.

**UI/UX Decisions:**
The frontend utilizes React 18, TypeScript 5, Vite 5, shadcn/ui, and Tailwind CSS, with PT-BR as the primary language. Key features include an AI Dashboard for performance metrics and a Takeover/Handover Panel for human intervention.

**Technical Implementations:**
- **Authentication**: Robust enterprise authentication (OAuth 2.0, SAML 2.0, 6-level RBAC, HMAC-SHA256 for S2S).
- **Real-time Communication**: WebSockets for LLM token streaming with rate limiting.
- **AI/ML**: RAG backend, image generation (FLUX.1 Schnell), and multimodal embeddings (CLIP ViT-L/14) are all self-hosted on Salad Cloud.
- **CI/CD**: Automated GitHub Actions: CI (auto) → Release (auto) → Deploy (auto). Pipeline 100% automático.
- **Code Quality**: Strict TypeScript, Pino logging, health checks.
- **Resilience & Performance**: Connection pooling, Circuit Breaker pattern, WebSocket rate limiting, graceful shutdowns.
- **Security Hardening**: PostgreSQL RLS, `sslmode=prefer`, `tenant_id` indices, pgAudit, Docker Non-Root, Redis ACL, CSP, input validation (Zod), and image scanning.
- **Caching**: Distributed cache adapter (Redis in production) for performance, including RBAC permission caching.
- **Secrets Management**: Secrets handled via chmod 600 files in `/tmp/alice-secrets/` and environment variables.
- **Feature Flags**: Enterprise-grade feature flag system with PostgreSQL persistence and TTL caching.
- **Identity Provisioning**: Automatic user propagation between Alice, Grafana, and ERPNext via Outbox Pattern.
- **Monorepo Management**: `pnpm overrides` for dependency deduplication.
- **RBAC API**: Dual API for permission checking (`checkPermission()` for cached, `checkPermissionDirect()` for direct).
- **API Security**: Rejects unsigned headers, `req.user` or HMAC-signed headers for authentication context.

**System Design Choices:**
- **Multi-tenant Isolation**: Achieved using PostgreSQL Row Level Security (RLS) with `tenant_id` policies.
- **API Security**: OWASP API3 compliance, with critical authentication routes utilizing Zod for input validation.

## External Dependencies
- **LLM**: Llama 4 Maverick (400B params) on Salad Cloud.
- **Embeddings**: text-embedding-3-small on Salad Cloud.
- **Image Generation**: FLUX.1 Schnell on Salad Cloud.
- **CLIP Inference**: CLIP ViT-L/14 on Salad Cloud.
- **Payments**: Stripe, Wise.
- **CRM/ERP**: ERPNext.
- **Communication**: Twilio (WhatsApp, SMS), Resend (transactional emails).
- **Database**: PostgreSQL with pgvector extension.
- **Observability**: Prometheus 3.0, Grafana OSS 11.3, Jaeger 1.62, OpenTelemetry Collector, Langfuse 2.x.
- **API Gateway**: Traefik v3.3.
- **CI/CD**: GitHub Actions.
- **Object Storage**: Hetzner Object Storage (S3-compatible).

## Recent Changes (Dec 2025)

### Security Hardening - Production Audit

| Fase | Implementação | Status |
|------|---------------|--------|
| **FASE 1** | Content-Security-Policy (CSP) header no Traefik middleware | Completo |
| **FASE 2** | Healthchecks em 4 ERPNext workers (scheduler, short, default, long) | Completo |
| **FASE 3** | `security_opt: no-new-privileges:true` em TODOS 26 containers | Completo |
| **FASE 4** | Imagens pinadas com SHA256 digests 2024/2025 | Completo |
| **FASE 5** | `read_only: true` + tmpfs em TODOS 26 containers (Docker 2025 Best Practices) | Completo |

### Image Versions (SHA256 Pinned)

| Imagem | Versão | Digest |
|--------|--------|--------|
| Traefik | v3.3 | sha256:b8bded... |
| PostgreSQL | pg16 (pgvector) | sha256:d836eb... |
| MariaDB | 10.11 | sha256:dc249c... |
| Redis | 7-alpine | sha256:e600a2... |
| ERPNext | v15.88.0 | sha256:158d31... |
| Vector | 0.43.1-alpine | sha256:ffa011... |
| pgBackRest | 2.54.2-alpine | sha256:8d74fa... |
| Docker Socket Proxy | latest | sha256:2f92c6... |
| BusyBox | 1.36 | sha256:2376a0... |

### Compliance Verification (100% COMPLETO)

- **26 containers** = **26 security_opt entries** (100% coverage)
- **26 containers** = **26 read_only: true entries** (100% coverage)
- **26 containers** = **26 resource limits entries** (100% coverage)
- **18 imagens externas** = **18 SHA256 digests** (100% coverage)
- **24 containers** = **24 healthchecks** (init containers excluídos)
- **CSP Headers**: OWASP 2025 compliant (unsafe-inline/eval required for React/ERPNext)
- **TLS Forçado**: HTTP→HTTPS redirect via Traefik entrypoints
- **Circuit Breakers**: 4 circuit breakers no auth-service (OAuth, SAML, DB lookup, upsert)
- **Backup State**: Persistido em PostgreSQL (Regra 6 - sem in-memory)
- **CI/CD Compliance**: Removidos skip_tests/skip_approval (Regra 4/6)
- **TypeScript**: Zero erros (strict mode, noImplicitAny)
- **Immutable Infrastructure**: Todos containers com filesystem read-only + tmpfs

### CI/CD Disk Space Fix (Dezembro 2025)

| Problema | Solução | Status |
|----------|---------|--------|
| `[Errno 28] No space left on device` durante pip install | Adicionado "Free disk space before install" step | Completo |
| `trivy-results.sarif` não existia quando Trivy falhava | Adicionado "Ensure SARIF file exists" fallback | Completo |
| PyTorch (~2GB) consumia muito espaço | `pip install --no-cache-dir` + limpeza prévia | Completo |

### Trivy Scan Fix (03/12/2025)

| Problema | Solução | Status |
|----------|---------|--------|
| Trivy scan abortava no primeiro erro | `continue-on-error: true` + IDs para verificação | Completo |
| SARIF não filtrava por severidade | `limit-severities-for-sarif: true` | Completo |
| Scan falho permitia deploy | Step agregador verifica outcomes + vulnerabilidades | Completo |
| Upload SARIF falha sem Advanced Security | Verificação via API antes do upload | Completo |

### Code Scanning Fix (03/12/2025)

| Problema | Solução | Status |
|----------|---------|--------|
| `upload-sarif` falha em repos privados sem GHAS | Verificar via API se Code Scanning está habilitado | Completo |
| Erro "Resource not accessible by integration" | Condicional `if: steps.check-code-scanning.outputs.enabled == 'true'` | Completo |
| SARIFs não salvos para debug | Upload como artifact independente do Code Scanning | Completo |

**Nota:** GitHub Advanced Security (GHAS) é necessário para Code Scanning em repositórios privados. Repos públicos têm Code Scanning gratuito. A verificação via API detecta automaticamente a disponibilidade do recurso.

**Fluxo Trivy Enterprise:**
1. Scans com `exit-code: '1'` + `continue-on-error: true` (executa todos)
2. `limit-severities-for-sarif: true` filtra apenas CRITICAL/HIGH no SARIF
3. Fallback SARIF com marcador `_scanFailed` se scan não executar
4. Upload de SARIFs para GitHub Security tab
5. Step agregador verifica:
   - Se algum scan falhou tecnicamente (marcador `_scanFailed`)
   - Se há vulnerabilidades CRITICAL/HIGH (`"level": "error"`)
6. Pipeline **bloqueia** deploy se encontrar problemas

**Steps adicionados ao CI/CD:**
- `sudo apt-get clean` - limpa cache APT
- `rm -rf ~/.cache/pip ~/.npm ~/.pnpm-store` - limpa caches de package managers
- `sudo rm -rf /usr/share/dotnet /opt/ghc /usr/local/share/boost` - remove ferramentas pré-instaladas (~5GB)

### CI/CD Automation (Dezembro 2025)

| Etapa | Trigger | Automático? | Descrição |
|-------|---------|-------------|-----------|
| **CI - Build & Test** | Push para `main` | ✅ Sim | TypeScript, ESLint, builds, security scan |
| **Release & Tag** | CI passa | ✅ Sim | Versão incremental (v1.0.X++), Docker images |
| **Deploy Production** | Release passa | ✅ Sim | Deploy 100% automático (sem aprovação) |

**Fluxo 100% Automático:**
```
Push → CI (auto) → Release (auto) → Deploy (auto)
```

Pipeline totalmente automático: push para `main` vai direto para produção após CI, Release e Security Scan passarem.

**Benefícios:**
- Pipeline 100% automático (push → produção)
- Versionamento semântico automático
- Imagens Docker sempre prontas para deploy
- Rollback automático se health checks falharem
- Zero intervenção humana no deploy

### Docker Images Security Fix (03/12/2025)

| Serviço | Imagem Antiga | Imagem Nova |
|---------|---------------|-------------|
| Node.js services (6) | node:22-alpine | gcr.io/distroless/nodejs22-debian12 |
| frontend-service | nginx:stable-alpine | nginx:1.27-alpine |

**Motivo:** Trivy encontrou CVEs CRITICAL/HIGH nas imagens Alpine. Google Distroless tem ZERO CVEs (sem shell, sem package manager, sem utilitários).

### Google Distroless Migration (03/12/2025)

| Aspecto | Alpine | Distroless |
|---------|--------|------------|
| CVEs típicos | 10-20 | 0-2 |
| Shell | ✅ Tem | ❌ Não tem |
| Package Manager | ✅ apk | ❌ Não tem |
| Tamanho | ~150MB | ~100MB |
| Debug | Fácil | Difícil |
| Segurança | Boa | Enterprise |

**Serviços migrados para Distroless:**
- auth-service
- chat-service
- rag-service
- training-service
- integrations-service
- observability-service

**Serviços que permanecem com Alpine:**
- frontend-service (nginx não tem versão Distroless)
- clip-inference-service (Python/PyTorch não tem Distroless adequado)

**Health Checks Distroless:**
```dockerfile
# Distroless não tem shell, então usamos exec form diretamente
HEALTHCHECK CMD ["/nodejs/bin/node", "-e", "require('http').get(...)"]
```

### Docker Best Practices (03/12/2025)

| Correção | Serviço | Descrição |
|----------|---------|-----------|
| **PEP 668 Compliance** | clip-inference-service | Virtual environment (`/opt/venv`) para Ubuntu 24.04 |
| **GAP-GHACTIONS-002** | release.yml | `github.token` para GHCR (OIDC nativo, mais seguro que PAT) |

**Detalhes PEP 668:**
- Ubuntu 24.04 marca Python como "externally managed"
- Solução: criar venv em `/opt/venv` e configurar `ENV PATH`
- Mais seguro que `--break-system-packages`

### Docker Platform Fix (03/12/2025)

| Problema | Solução | Containers Afetados |
|----------|---------|---------------------|
| Imagens multi-arch puxando ARM64 no servidor AMD64 | `platform: linux/amd64` em TODOS os containers | 26 containers (100%) |

**Erro Original:**
```
postgres The requested image's platform (linux/arm64) does not match 
the detected host platform (linux/amd64/v3)
```

**Solução Enterprise:**
Adicionar `platform: linux/amd64` após cada `image:` em TODOS os 26 containers para garantir arquitetura correta no Hetzner (x86_64).

### Deploy Cleanup Fix (03/12/2025)

| Problema | Solução | Impacto |
|----------|---------|---------|
| Containers em restart loop não eram removidos | Limpeza agressiva pré-deploy | Zero sujeira |
| Rollback em 1º deploy deixava sujeira | Limpeza completa mesmo sem rollback | Servidor limpo |

**Limpeza Pré-Deploy (4 passos):**
1. Parar TODOS containers alice-* e erpnext-*
2. Remover TODOS containers (não apenas órfãos)
3. Limpar recursos órfãos (prune)
4. Verificar e forçar remoção se necessário

**Limpeza em Rollback Impossível (5 passos):**
1. Parar containers Alice
2. Parar containers ERPNext
3. Remover todos containers
4. Remover volumes órfãos
5. Remover imagens não utilizadas

### Docker Build Cache Otimizado (03/12/2025)

| Estratégia | Descrição | Benefício |
|------------|-----------|-----------|
| **Registry Cache** | `cache-from: type=registry,ref=...:cache` | Cache no GHCR (sem limite de tamanho) |
| **Mode Max** | `cache-to: type=registry,...,mode=max` | Salva todas as layers intermediárias |
| **Por Serviço** | Cada serviço tem sua própria imagem `:cache` | Cache isolado por microsserviço |

**Vantagem do Registry Cache sobre GHA Cache:**
- NÃO é branch-specific (compartilha entre tags e branches)
- Releases (tags) e Deploys (main) compartilham o mesmo cache
- Sem limite de 10GB do GitHub Actions cache

**Como Funciona:**
1. Docker calcula hash SHA256 de cada arquivo
2. Compara com hash do cache no GHCR
3. Se igual → usa cache (segundos)
4. Se diferente → rebuilda a partir dessa layer

**Segurança do Cache:**
- Hash criptográfico invalida cache automaticamente
- `pnpm-lock.yaml` garante versões exatas
- Trivy escaneia imagem FINAL (não cache)
- Rebuild forçado: Deletar imagem `:cache` no GHCR

**Performance Esperada:**
| Cenário | Tempo Sem Cache | Tempo Com Cache |
|---------|-----------------|-----------------|
| Rebuild completo | ~45 min | ~45 min |
| Mudança em 1 serviço | ~45 min | ~7 min |
| Nenhuma mudança | ~45 min | ~3 min |

### Servidor Hetzner - Conexão SSH (03/12/2025)

**Configuração SSH Local** (`~/.ssh/config`):
```
Host alice-hetzner
    HostName 46.224.46.93
    User root
    IdentityFile ~/.ssh/alice-deploy
```

**Comandos de Conexão:**
```bash
# Usando alias (recomendado)
ssh alice-hetzner

# Conexão direta
ssh -i ~/.ssh/alice-deploy root@46.224.46.93
```

**Especificações do Servidor (verificado 03/12/2025):**

| Recurso | Valor |
|---------|-------|
| **SO** | Ubuntu 24.04.3 LTS |
| **Docker** | 29.0.4 |
| **Docker Compose** | v2.40.3 |
| **CPU** | 8 vCPUs (AMD EPYC) |
| **RAM** | 16GB |
| **Disco** | 160GB NVMe SSD |
| **IP** | 46.224.46.93 |

**⚠️ IMPORTANTE:** Nunca executar comandos manuais no servidor. Todo deploy é 100% automático via GitHub Actions.

---

*Autor: Fillipe Guerra*
*Documentação em Português Brasileiro*
*Versão 3.7 - 03 de Dezembro de 2025*
*Tecnologias: Node.js 22 LTS, pnpm 10.24.0, TypeScript 5.9.3, Google Distroless*
*Total de Containers: 26 (4 infraestrutura + 8 Alice + 12 ERPNext + 2 backup/logs)*
*Servidor: Ubuntu 24.04.3 LTS, Docker 29.0.4, Docker Compose v2.40.3*