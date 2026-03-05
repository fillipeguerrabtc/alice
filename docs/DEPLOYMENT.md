# Alice Enterprise Platform - Guia de Deploy

**Autor:** Fillipe Guerra  
**Data:** 11 de Fevereiro de 2026  
**Versão:** 11.17 - Docker daemon overlay (GHCR/Docker docs) + wait pós-restart

## Visão geral

Este guia descreve o deploy enterprise da plataforma Alice em produção (Hetzner GEX44), com pipeline CI/CD totalmente automatizado, rollback cirúrgico por stack e validações fail-fast.



## Timezone (padrão enterprise)

- **Host e containers:** UTC para consistência de logs, métricas e tracing.
- **UI e Chat:** timezone do usuário (dashboard) com fallback em `America/Sao_Paulo`.
- **Motivo:** UTC evita ambiguidades (DST/offsets) e facilita correlação entre stacks.

### Arquitetura multi-stack (SSOT)

| Stack | Containers | Descrição | Docker Compose |
| --- | --- | --- | --- |
| **INFRA** | 11 | PostgreSQL, PgBouncer, Redis, Qdrant, Caddy, MinIO, SearXNG, Tor | `infra/docker/stacks/docker-compose.infra.yml` |
| **ALICE** | 10 + GPU | Microsserviços core (incl. Biometrics, LLM Gateway) + GPU Manager + serviços GPU | `infra/docker/stacks/docker-compose.alice.yml` |
| **OBSERVABILITY** | 13 | Prometheus, Grafana, Loki, Jaeger, Langfuse, ClickHouse | `infra/docker/stacks/docker-compose.observability.yml` |
| **BACKUP** | 1 | pgBackRest enterprise | `infra/docker/stacks/docker-compose.backup.yml` |

## Workflows oficiais

- **Release & Tag:** `.github/workflows/release.yml`
- **Deploy Modular:** `.github/workflows/deploy-stack-modular.yml`

### Ordem de deploy (automática)

```text
prepare
  ↓
deploy-infra + health-infra
  ↓
drizzle-push (executa somente quando há diff real)
  ↓
  ↓
health-{stack} + rollback-{stack} (se necessário)
```

### Migrações obrigatórias (próximo deploy)

No próximo deploy, **garantir** a aplicação da migration:

- `migrations/0043_trading_symbol_preferences.sql`

Esta migration cria a tabela de preferências de símbolos (favoritos/destaques) por usuário/mercado. O deploy modular já executa `drizzle-push` e migrations SQL quando há diff real; valide que o arquivo está presente e que o passo de migrations foi executado com sucesso no job de deploy.

### Healthchecks condicionados ao deploy bem-sucedido

Os jobs de health check rodam **somente quando o job de deploy do stack termina com sucesso** (`needs.deploy-<stack>.result == 'success'`). Este é o mesmo padrão usado por INFRA e ALICE, evitando skips incorretos causados por outputs transitórios e garantindo execução consistente após deploy bem-sucedido.

### Builds Docker e warning do pnpm (`approve-builds`)

Durante o build das imagens, o `pnpm` pode emitir aviso de **scripts ignorados** se `NPM_CONFIG_DANGEROUSLY_ALLOW_ALL_BUILDS` não estiver definido no **build stage** do Dockerfile.  
Para evitar esse warning e manter o build determinístico, todos os Dockerfiles Node.js devem exportar:

```bash
ENV NPM_CONFIG_DANGEROUSLY_ALLOW_ALL_BUILDS=true
```

Isso **não afeta o desenvolvimento local**, apenas o ambiente do build da imagem.



- Configurações sincronizadas: `apps.txt` e `common_site_config.json`.



- **Causa raiz típica:** `node: not found` durante `bench build --production`.
- **Correção aplicada:** validação explícita de `node` + `nvm use` quando necessário.
- **Resultado:** assets gerados de forma determinística e sem dependência de login shell.

### Disparo manual (quando necessário)

```bash
# Deploy de um stack específico
gh workflow run deploy-stack-modular.yml -f stack=alice -f version=v1.0.0

# Deploy de todos os stacks
gh workflow run deploy-stack-modular.yml -f stack=all -f version=v1.0.0

# Dry run (validação sem deploy)
gh workflow run deploy-stack-modular.yml -f stack=observability -f version=v1.0.0 -f dry_run=true

# Rollback manual de um stack específico
```

### Rollback automático e cleanup (INFRA)

- Em falha de primeiro deploy (sem versão anterior), o rollback entra em modo **cleanup**.
- O cleanup remove **containers**, **volumes** e **imagens** do stack INFRA.
- Redes compartilhadas são removidas **somente** quando não há containers anexados.
- Outros stacks não são removidos, mas podem perder dependências se INFRA for limpo.

## Primeiro deploy (servidor limpo)

### Pré-requisitos do servidor

| Item | Validação | Como verificar |
| --- | --- | --- |
| IP correto | 178.63.41.108 | `hostname -I \| grep -w 178.63.41.108` |
| GPU disponível | NVIDIA RTX 4000 Ada | `nvidia-smi` |
| Docker | 29.1.3+ | `docker --version` |
| Docker Compose | 5.0.0+ | `docker compose version` |
| NVIDIA Container Toolkit | Instalado | `docker run --rm --gpus all nvidia/cuda:12.0.0-base-ubuntu22.04 nvidia-smi` |
| Disco disponível | Mínimo 200GB livre | `df -h /opt/alice` |
| Memória RAM | 64GB | `free -h` |

### Preparação automática do servidor

O workflow executa o script idempotente `infra/scripts/prepare-production-server.sh` no job `prepare`, **na mesma sessão SSH** usada para extrair os scripts SSOT (reduz conexões e evita timeouts).

**O que o script faz:**

- Valida IP/GPU/Docker
- Cria estrutura `/opt/alice`
- Configura permissões via SSOT
- Cria networks externas no job `prepare-infrastructure` (sem passo SSH separado)
- Valida permissões do PostgreSQL (fail-fast)

**Execução manual (opcional):**

```bash
ssh root@178.63.41.108
sudo /opt/alice/app/infra/scripts/prepare-production-server.sh
```

## Matriz de mudanças (auto-deploy vs manual)

### Auto-deploy (aplica no próximo deploy)

| Item | Local | Aplicação | Observações |
| --- | --- | --- | --- |
| Persistência de logs de deploy | `.github/workflows/deploy-stack-modular.yml` | Automática | Logs ficam em `/opt/alice/logs/deploy-<stack>-<run_id>-<run_attempt>.log`. |
| Fail-fast de sysctl em container | `.github/workflows/deploy-stack-modular.yml` | Automática | Bloqueia `sysctl vm.*` no `docker-compose.infra.yml` do servidor. |
| Sync do compose/infra | Workflow + rsync | Automática | Garante `/opt/alice/app/infra/docker/stacks` atualizado antes do deploy. |
| Parâmetros de serviços | `infra/docker/stacks/*.yml` | Automática | Entra no próximo deploy sem ação manual. |
| Parâmetros GPU | `docker/gpu/*` + `docker-compose.alice.yml` | Automática | vLLM/embeddings via imagem + env vars. |
| Volume LoRA Adapters | `infra/scripts/permissions-config.sh` | Automática | `/opt/alice/data/lora-adapters` criado com 0:0:755 pelo prepare-infrastructure. |

### Variáveis opcionais de treino (Alice stack)

As seguintes variáveis de ambiente são opcionais e possuem defaults (documentadas em `docs/TRAINING.md` e `docs/TREINAMENTO-LIMITES-E-BOAS-PRATICAS.md`):

| Variável | Container | Default | Descrição |
| --- | --- | --- | --- |
| `DOCUMENT_MAX_CHUNKS` | alice-rag | 50 | Máximo de chunks por documento |
| `TRAINING_DOC_MAX_SAMPLES` | alice-rag | 50 | Máximo de chunks selecionados por doc para treino |
| `TRAINING_CONVERSATION_MAX_MESSAGES` | alice-chat | 50 | Máximo de mensagens por conversa para treino |
| `CONVERSATION_SLICE_SIZE` | alice-chat | 10 | Tamanho das janelas de fatiamento de conversas longas |
| `MIN_ONDEMAND_DATASET_SIZE` | alice-training | 10 | Mínimo de exemplos para treino on-demand |

Configure em `docker-compose.alice.yml` ou via `.env.prod` quando necessário (ex.: livros grandes, ajuste de fatiamento).

### LoRA Adapters — Volume e Permissões

O diretório `/opt/alice/data/lora-adapters` armazena adapters LoRA treinados via QLoRA. Ele é:

- **Criado automaticamente** pelo job `prepare-infrastructure` do workflow de deploy.
- **Permissões**: `root:root` (0:0), modo `755` — configurado em `infra/scripts/permissions-config.sh`.
- **Montado como read-only** no container `gpu-llm`: `/opt/alice/data/lora-adapters:/opt/alice/data/lora-adapters:ro`.
- **Escrito pelo training-service** via path do host (`/opt/alice/data/lora-adapters/trading-global`).
- **Lido pelo vLLM** que detecta adapters e os carrega dinamicamente em runtime.

```bash
# Verificar adapter ativo no servidor
ls -la /opt/alice/data/lora-adapters/trading-global/

# Verificar se vLLM detectou o adapter
docker logs alice-gpu-llm 2>&1 | grep -i lora
```

### Manual (executar no servidor)

| Item | Local | Como aplicar | Observações |
| --- | --- | --- | --- |
| `vm.overcommit_memory=1` | `/etc/sysctl.d/99-alice.conf` | `sudo /opt/alice/app/infra/scripts/setup-hetzner-gpu.sh` | Obrigatório para Redis. Nunca via compose. |
| `vm.swappiness=10` | `/etc/sysctl.d/99-alice.conf` | `sudo /opt/alice/app/infra/scripts/setup-hetzner-gpu.sh` | Reduz swap agressivo. |
| `net.core.somaxconn=65535` | `/etc/sysctl.d/99-alice.conf` | `sudo /opt/alice/app/infra/scripts/setup-hetzner-gpu.sh` | Backlog de conexões. |
| `net.core.rmem_max=16777216` | `/etc/sysctl.d/99-alice.conf` | `sudo /opt/alice/app/infra/scripts/setup-hetzner-gpu.sh` | Buffer máximo de recepção. |
| `net.core.wmem_max=16777216` | `/etc/sysctl.d/99-alice.conf` | `sudo /opt/alice/app/infra/scripts/setup-hetzner-gpu.sh` | Buffer máximo de envio. |
| `net.ipv4.tcp_max_syn_backlog=65535` | `/etc/sysctl.d/99-alice.conf` | `sudo /opt/alice/app/infra/scripts/setup-hetzner-gpu.sh` | SYN backlog alto volume. |
| `net.ipv4.ip_local_port_range=1024 65535` | `/etc/sysctl.d/99-alice.conf` | `sudo /opt/alice/app/infra/scripts/setup-hetzner-gpu.sh` | Portas efêmeras. |
| `fs.file-max=2097152` | `/etc/sysctl.d/99-alice.conf` | `sudo /opt/alice/app/infra/scripts/setup-hetzner-gpu.sh` | FD global do host. |
| `fs.inotify.max_user_watches=524288` | `/etc/sysctl.d/99-alice.conf` | `sudo /opt/alice/app/infra/scripts/setup-hetzner-gpu.sh` | Watchers de arquivos. |
| `nofile=1048576` | `/etc/security/limits.d/alice.conf` | `sudo /opt/alice/app/infra/scripts/setup-hetzner-gpu.sh` | Limites por usuário (observability/ClickHouse). |
| `nproc=65535` | `/etc/security/limits.d/alice.conf` | `sudo /opt/alice/app/infra/scripts/setup-hetzner-gpu.sh` | Limite de processos por usuário. |
| THP `enabled/defrag=never` | `/etc/systemd/system/disable-thp.service` | `sudo /opt/alice/app/infra/scripts/setup-hetzner-gpu.sh` | Recomendado para Redis/PostgreSQL. |
| Swap 4GB (se ausente) | `/swapfile` | `sudo /opt/alice/app/infra/scripts/setup-hetzner-gpu.sh` | Criado apenas se não existir. |

**Atalho Windows (PowerShell):**

- Chave: `C:\Users\filli\.ssh\alice-deploy`
- Config: `C:\Users\filli\.ssh\config` (alias `alice-prod`)
- Comando direto: `ssh -i C:\Users\filli\.ssh\alice-deploy root@178.63.41.108`

### Checklist essencial

- [ ] Secrets configurados no GitHub (`docs/SECRETS.md`)
- [ ] Chave SSH válida para `root@178.63.41.108`
- [ ] Release criada e publicada em GHCR
- [ ] Deploy disparado via workflow
- [ ] Health checks passaram para todos os stacks

### Preflight obrigatório (secrets + compose)

Antes de qualquer `docker compose up`, execute o preflight fail-fast:

```bash
# Linux/macOS (na pasta do repo)
bash infra/scripts/preflight-secrets.sh --stack alice --env-file infra/docker/.env.prod --compose-file infra/docker/stacks/docker-compose.base.yml --compose-file infra/docker/stacks/docker-compose.alice.yml

# Windows PowerShell
powershell -ExecutionPolicy Bypass -File infra/scripts/preflight-secrets.ps1 -Stack alice -EnvFile infra/docker/.env.prod -ComposeFile infra/docker/stacks/docker-compose.base.yml,infra/docker/stacks/docker-compose.alice.yml
```

No pipeline oficial (`deploy-stack-modular.yml`), esse preflight também roda de forma automática por stack imediatamente antes do `compose up`.

### Validações operacionais pós-deploy (enterprise)

```bash
# DR game day (dry-run)
bash infra/scripts/run-dr-game-day.sh --backup-id <backup-id>

# Fine-tuning real em GPU (validação)
bash infra/scripts/validate-gpu-fine-tuning.sh --auth-token "$ADMIN_BEARER_TOKEN" --tenant-id <tenant-uuid>

# SLO burn-rate por jornada (Prometheus)
bash infra/scripts/validate-slo-burn-rates.sh --prometheus-url https://metrics.yesyoudeserve.duckdns.org
```

## Secrets obrigatórios (referência)

Consulte `docs/SECRETS.md` para a lista completa. O deploy é fail-fast se secrets críticos estiverem ausentes.

**Secret adicional (opcional):**

- `PGBACKREST_ALLOW_STANZA_RESET` = `true`  
  Permite reset controlado de stanza em caso de mismatch entre banco e repositório pgBackRest.

**ACME resiliente (ZeroSSL + Let's Encrypt):**

- O Caddy usa **ZeroSSL como emissor primário** e **Let's Encrypt como fallback**.
- Secrets obrigatórios: `ZEROSSL_EAB_KID` e `ZEROSSL_EAB_HMAC_KEY` (EAB).

## pgBackRest (stanza)

### Criação padrão

O init container `alice-pgbackrest-init` cria a stanza após o PostgreSQL estar healthy, usando `--no-online`.

### Stanza inconsistente (mismatch de system-id)

**Sintoma:**

- `ERROR: [028]: backup and archive info files exist but do not match the database`
- `ERROR: [103]: ArchiveMismatchError ... system-id ... do not match repo1 stanza ...`

**Causa:**

O PostgreSQL foi reinitializado, mas o repositório de backup contém metadados antigos.

**Solução controlada:**

1. Reexecutar o deploy com input `pgbackrest_allow_stanza_reset=true`.

**Via GitHub CLI:**

```bash
gh workflow run deploy-stack-modular.yml \
  -f stack=infra \
  -f version=v1.0.0 \
  -f pgbackrest_allow_stanza_reset=true
```

**Via GitHub UI:**

- Actions → Deploy - Production (Modular) → Run workflow
- Marcar checkbox `pgbackrest_allow_stanza_reset`

**Observação:** O reset remove metadados de backups anteriores da stanza. Use apenas quando o reinit do banco for intencional.

**Comportamento seguro adicional:**

- Se o repositório **não possui backups** para a stanza (`/var/lib/pgbackrest/backup/<stanza>` vazio), o init container executa **reset automático** para destravar a criação da stanza.
- Se **existirem backups**, o reset **continua bloqueado** e exige `PGBACKREST_ALLOW_STANZA_RESET=true`.

### DR e Game Day

O procedimento operacional de restore (com metas de RTO/RPO e evidências obrigatórias) está em:

- `docs/DR-RUNBOOK.md`

## Troubleshooting rápido

### pgBackRest init falha por cipher pass ausente

- Verificar secret `BACKUP_CIPHER_PASS` em GitHub.
- Verificar `.env.prod` no servidor.

```bash
docker logs alice-pgbackrest-init --tail 50
grep BACKUP_CIPHER_PASS /opt/alice/app/infra/docker/.env.prod | wc -c
```

### MinIO não inicializa ou bucket não é criado

```bash
docker logs alice-minio --tail 100
docker logs alice-minio-init --tail 50
```


**Sintoma:** páginas abrem com HTML sem estilos/scripts e `/assets/*` retorna 404.  
**Causa raiz:** `assets.json` desatualizado em relação aos bundles reais.  

### Logs de falha por stack (rollback imediato)

**Sintoma:** rollback executa logo após falha e os containers podem sumir.  
**Correção aplicada:** um diagnóstico rápido (tail) é impresso na tela e os logs completos são compactados no servidor e enviados como artifact do GitHub Actions quando o deploy falha.

**Onde encontrar:** Artifacts por stack no job de deploy:

- `infra-deploy-logs-<run_id>-<run_attempt>`
- `alice-deploy-logs-<run_id>-<run_attempt>`
- `observability-deploy-logs-<run_id>-<run_attempt>`
- `backup-deploy-logs-<run_id>-<run_attempt>`

### Docker Hub rate limit

Configure `DOCKERHUB_USERNAME` e `DOCKERHUB_TOKEN` nos secrets do GitHub.

### Smart Pull de Imagens Docker (14/02/2026 — Atualizado)

O workflow `deploy-stack-modular.yml` utiliza **pull inteligente com detecção de retag** para evitar downloads desnecessários de imagens Docker que já existem no servidor de produção.

**Arquitetura Enterprise — Funções Compartilhadas:**


Funções disponíveis:
- **`verify_docker_credentials()`** — Valida presença de `~/.docker/config.json` com credenciais ativas
- **`pull_with_retry()`** — Pull com 5 tentativas e backoff progressivo (15s, 30s, 60s, 90s, 120s) — usada por TODOS os paths; tolera timeouts intermitentes do GHCR (11/02/2026)
- **`extract_service_name()`** — Extrai nome do serviço de uma imagem (ex: `alice-auth` → `auth`)
- **`pull_if_needed(SERVICE_NAME, IMAGE_FULL, BUILT_IMAGES)`** — Pull inteligente com detecção de retag via lista de imagens buildadas da Release

De forma similar, o workflow `release.yml` centraliza funções de build/retag em **`scripts/release-functions.sh`**:
- **`should_build()`** / **`image_exists()`** / **`retag_image()`** — Lógica condicional de build
- **`decide_build_or_retag()`** — Decisão enterprise: BUILD ou RETAG

**Login Único (prepare job):** Autenticação no GHCR e Docker Hub é feita **uma única vez** no job `prepare`, com credenciais escritas diretamente em `~/.docker/config.json` via função `write_docker_auth()` (usa env vars Python para evitar injection). Os 5 deploy jobs apenas verificam se credenciais existem.

**Comunicação Release → Deploy:** O `release.yml` rastreia quais imagens foram **buildadas** vs **retagged**. A lista (`built_images`) é passada como input para o `deploy-stack-modular.yml` via `workflow_dispatch`. Quando TUDO é retagged, a Release envia `__NONE__` (sentinela) para diferenciar de deploy manual (string vazia).

**Função `pull_if_needed(SERVICE_NAME, IMAGE_FULL, BUILT_IMAGES)` — 4 Casos:**

| Caso | Condição | Ação | Tempo |
|------|----------|------|-------|
| **1** | Tag exata existe localmente | SKIP | ~0s |
| **2** | Imagem Docker Hub/Quay (terceiros) | `pull_with_retry()` | ~2-30s |
| **3** | GHCR com info Release (build ou retag) | Retag local ou `pull_with_retry()` | ~0.1s ou ~2-30s |
| **4** | Deploy manual (sem info Release) | `pull_with_retry()` | ~2-30s |

**Exemplo de uso:**
```bash
# Extrair nome do serviço da imagem
SERVICE_NAME=$(extract_service_name "$img")
# Pull inteligente passando lista de buildadas
pull_if_needed "$SERVICE_NAME" "$img" "$BUILT_IMAGES"
```

**Benefícios:**
- **PARÂMETROS EXPLÍCITOS** — Não depende de variável de ambiente oculta (mais testável e maintainável)
- **ELIMINADO** `docker manifest inspect` (frágil com manifest lists, timeout 15s/imagem)
- **ELIMINADO** fallback `docker login` nos deploy jobs (login único no prepare)
- **ELIMINADO** retry inconsistente (todos os paths usam `pull_with_retry()` com 5 tentativas e backoff progressivo)
- **ELIMINADO** duplicação (~610 linhas) — funções centralizadas em script compartilhado
- Release informa explicitamente quais imagens foram buildadas → detecção 100% precisa
- Deploys subsequentes com retag: ~30s ao invés de ~10min

**Secrets utilizados:**
- `GH_PAT` — Token para GHCR (GitHub Container Registry)
- `DOCKERHUB_USERNAME` + `DOCKERHUB_TOKEN` — Conta Pro Docker Hub (5000 pulls/dia)

### Docker daemon overlay (GHCR/Docker docs oficiais — 11/02/2026)

O job `prepare` aplica um **overlay idempotente** em `/etc/docker/daemon.json` para aderência às documentações oficiais Docker e GHCR, reduzindo timeouts em pulls do GHCR.

**Arquivo overlay:** `infra/scripts/daemon-registry-overlay.json`

| Parâmetro | Valor | Justificativa (Docker docs) |
|-----------|-------|----------------------------|
| `max-concurrent-downloads` | 3 | Default oficial — reduz contenção e timeouts GHCR |
| `max-download-attempts` | 10 | Aumenta resiliência (default 5) para pulls lentos |

**Comportamento idempotente:**
- Merge via `jq -s '.[0] * .[1]'` (config atual × overlay)
- Restart **somente** quando `daemon.json` foi alterado
- Aguarda Docker ficar pronto (`docker info` OK) antes de prosseguir (até 60s)
- Evita falhas em jobs sucessivos (rsync, docker compose up) por restart em andamento

**REF:** [Docker dockerd reference](https://docs.docker.com/reference/cli/dockerd/) — `--max-concurrent-downloads`, `--max-download-attempts`

## Validações pós-deploy

```bash
docker ps --format "table {{.Names}}\t{{.Status}}"
docker exec alice-postgres pg_isready
docker exec alice-pgbouncer pgbouncer -V
docker logs alice-caddy --tail 50
```

## Troubleshooting — 403 "Use o gateway Caddy" em endpoints `/api/*`

### Sintoma

Páginas do frontend (ex.: **Trading**, **Trading Demo**) exibem erros de carregamento.
Na aba **Network** do navegador, chamadas como:

```
GET /api/trading/portfolios          → 403
GET /api/trading/candidates?...      → 403
GET /api/trading/rebalances?...      → 403
POST /internal/trading/enqueue/...  → 403
```

retornam o body:

```json
{"error":"Acesso direto à API não permitido. Use o gateway Caddy.","hint":"Requisições /api devem passar pelo Caddy em produção."}
```

### Causa raiz

O container `alice-frontend` (nginx) bloqueia intencionalmente qualquer requisição cujo
path começa com `/api` ou `/ws` — esse é o comportamento correto de segurança.

O problema ocorre quando o **Caddyfile não possui uma regra `handle`** para a rota em
questão. Sem a regra, a requisição cai no bloco `handle` de fallback que roteia para
`alice-frontend:8080`, que então responde 403 para `/api/*`.

### Solução

Adicionar o bloco `handle` correspondente no `infra/docker/Caddyfile` **antes** do
fallback `handle { reverse_proxy alice-frontend:8080 }`, apontando para o serviço correto.

Exemplo (já aplicado em 22/02/2026):

```caddy
handle /api/trading/* {
    reverse_proxy alice-integrations:3005 {
        import proxy_headers
    }
}

handle /internal/trading/* {
    reverse_proxy alice-integrations:3005 {
        import proxy_headers
    }
}
```

### Validação em produção

```bash
# 1. Verificar se Caddy está escutando nas portas 80 e 443
docker exec alice-caddy ss -tlnp | grep -E '80|443'

# 2. Testar roteamento de um endpoint (substituir <HOST> e <COOKIE>)
curl -si -H "Cookie: <COOKIE>" https://<HOST>/api/trading/portfolios

# Esperado: {"success":true,"data":[...]} — NOT {"error":"Acesso direto..."}

# 3. Validar sem autenticação (deve retornar 401, não 403)
curl -si https://<HOST>/api/trading/portfolios | head -5

# 4. Inspecionar logs do Caddy para ver upstream usado
docker logs alice-caddy --tail 100 | grep "trading"
```

### Mapeamento de rotas → upstreams (referência SSOT)

| Prefixo de rota                   | Upstream               | Observações                                   |
|-----------------------------------|------------------------|-----------------------------------------------|
| `/api/auth/*`                     | `alice-auth:3001`      |                                               |
| `/api/users*`                     | `alice-auth:3001`      |                                               |
| `/api/audit/*`                    | `alice-auth:3001`      |                                               |
| `/api/chat/*`                     | `alice-chat:3002`      | `/api/chat/stream` com timeouts estendidos    |
| `/api/namespaces*`                | `alice-chat:3002`      |                                               |
| `/api/agents*`                    | `alice-chat:3002`      |                                               |
| `/api/rag/*`                      | `alice-rag:3003`       |                                               |
| `/api/media*`                     | `alice-rag:3003`       |                                               |
| `/api/training/*`                 | `alice-training:3004`  |                                               |
| `/api/trading/*`               | `alice-integrations:3005` | ✅ Adicionado 22/02/2026                   |
| `/internal/trading/*`          | `alice-integrations:3005` | ✅ Adicionado 22/02/2026                   |
| `/api/integrations/*`             | `alice-integrations:3005` |                                            |
| `/webhook/*`                      | `alice-integrations:3005` |                                            |
| `/api/observability/*`            | `alice-observability:3007` |                                           |
| `/ws/*`                           | `alice-chat:3002`      | WebSocket com headers específicos             |
| `*` (fallback)                    | `alice-frontend:8080`  | SPA React — bloqueia `/api/*` e `/ws/*`       |

> **Regra enterprise:** sempre que um endpoint de API retornar 403 com a mensagem
> "Use o gateway Caddy", verificar primeiro se existe um bloco `handle` correspondente
> no `infra/docker/Caddyfile`. Adicionar a regra antes do fallback e fazer novo deploy
> do stack INFRA.

## Documentação relacionada

- `docs/ARQUITETURA.md`
- `docs/ARQUITETURA-GPU-MANAGER.md`
- `docs/OBSERVABILITY.md`
- `docs/PERMISSIONS.md`
- `docs/SECRETS.md`
- `docs/STATUS-REAL-ATUAL.md`
