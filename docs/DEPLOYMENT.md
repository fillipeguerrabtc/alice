# Alice Enterprise Platform - Guia de Deploy

**Autor:** Fillipe Guerra  
**Data:** 09 de Fevereiro de 2026  
**Versão:** 11.15 - LoRA Adapters Volume + Demo Trading

## Visão geral

Este guia descreve o deploy enterprise da plataforma Alice em produção (Hetzner GEX44), com pipeline CI/CD totalmente automatizado, rollback cirúrgico por stack e validações fail-fast.

## Atualização ERPNext/Frappe

- **ERPNext** atualizado para `v15.95.2` via SSOT (`infra/versions.env`).
- **docker-compose.erpnext.yml** mantém fallback alinhado com a SSOT para evitar drift.

## Timezone (padrão enterprise)

- **Host e containers:** UTC para consistência de logs, métricas e tracing.
- **UI e Chat:** timezone do usuário (dashboard) com fallback em `America/Sao_Paulo`.
- **Motivo:** UTC evita ambiguidades (DST/offsets) e facilita correlação entre stacks.

### Arquitetura multi-stack (SSOT)

| Stack | Containers | Descrição | Docker Compose |
| --- | --- | --- | --- |
| **INFRA** | 11 | PostgreSQL, PgBouncer, Redis, Qdrant, Caddy, MinIO, SearXNG, Tor | `infra/docker/stacks/docker-compose.infra.yml` |
| **ALICE** | 8 + GPU | Microsserviços core + GPU Manager + serviços GPU | `infra/docker/stacks/docker-compose.alice.yml` |
| **OBSERVABILITY** | 13 | Prometheus, Grafana, Loki, Jaeger, Langfuse, ClickHouse | `infra/docker/stacks/docker-compose.observability.yml` |
| **ERPNEXT** | 15 | MariaDB, Redis Cache/Queue, Backend, Workers | `infra/docker/stacks/docker-compose.erpnext.yml` |
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
deploy-alice + deploy-observability + deploy-erpnext + deploy-backup (paralelo)
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

## ERPNext - sincronização de assets e configs

O `erpnext-configurator` sincroniza **assets completos** e arquivos de configuração para o volume `erpnext_sites` sem remover diretórios internos do container. Isso evita falhas por mountpoints gerados pelo próprio image (`VOLUME` em `/home/frappe/frappe-bench/sites` e `/home/frappe/frappe-bench/sites/assets`).

- Origem dos assets: `/home/frappe/frappe-bench/sites/assets` (imagem).
- Destino: `/mnt/erpnext-sites/assets` (volume persistente).
- Configurações sincronizadas: `apps.txt` e `common_site_config.json`.

### ERPNext - build de assets com Node (NVM)

O `erpnext-create-site` executa `bench build --production` para gerar bundles CSS/JS. A imagem oficial do ERPNext já inclui Node via **NVM**, mas **login shell** (`bash -l`) pode sobrescrever `PATH` e quebrar a detecção do `node`. Para evitar isso, o build roda com `bash -c` preservando o `PATH` do container e faz bootstrap do NVM quando necessário (sem instalação runtime).

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
gh workflow run deploy-stack-modular.yml -f stack=erpnext -f version=v1.0.0 -f rollback=true -f rollback_version=v0.9.0
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

### ERPNext sem CSS/JS (assets 404)

**Sintoma:** páginas abrem com HTML sem estilos/scripts e `/assets/*` retorna 404.  
**Causa raiz:** `assets.json` desatualizado em relação aos bundles reais.  
**Correção aplicada:** `erpnext-configurator` sincroniza `assets.json` da imagem oficial para o volume `erpnext_sites` (sem depender de Node), ajusta permissões do volume e executa `bench` com `setpriv --keep-groups` (necessário com `no-new-privileges` para evitar erro de `setgroups`).

### Logs de falha por stack (rollback imediato)

**Sintoma:** rollback executa logo após falha e os containers podem sumir.  
**Correção aplicada:** um diagnóstico rápido (tail) é impresso na tela e os logs completos são compactados no servidor e enviados como artifact do GitHub Actions quando o deploy falha.

**Onde encontrar:** Artifacts por stack no job de deploy:

- `infra-deploy-logs-<run_id>-<run_attempt>`
- `alice-deploy-logs-<run_id>-<run_attempt>`
- `observability-deploy-logs-<run_id>-<run_attempt>`
- `erpnext-deploy-logs-<run_id>-<run_attempt>`
- `backup-deploy-logs-<run_id>-<run_attempt>`

### Docker Hub rate limit

Configure `DOCKERHUB_USERNAME` e `DOCKERHUB_TOKEN` nos secrets do GitHub.

### Smart Pull de Imagens Docker (10/02/2026)

O workflow `deploy-stack-modular.yml` utiliza **pull inteligente com detecção de retag** para evitar downloads desnecessários de imagens Docker que já existem no servidor de produção.

**Arquitetura Enterprise — Funções Compartilhadas:**

As funções de deploy são centralizadas em **`infra/scripts/deploy-functions.sh`** (CLAUDE.md Regra 2 — não duplicar). O script é copiado para `/opt/alice/scripts/deploy-functions.sh` no servidor pelo job `prepare` e importado via `source` pelos 5 deploy jobs (INFRA, ALICE, OBSERVABILITY, ERPNEXT, BACKUP).

Funções disponíveis:
- **`verify_docker_credentials()`** — Valida presença de `~/.docker/config.json` com credenciais ativas
- **`pull_with_retry()`** — Pull com 3 retries e backoff linear (10s, 20s, 30s) — usada por TODOS os paths
- **`pull_if_needed()`** — Pull inteligente com detecção de retag via `BUILT_IMAGES` da Release

De forma similar, o workflow `release.yml` centraliza funções de build/retag em **`scripts/release-functions.sh`**:
- **`should_build()`** / **`image_exists()`** / **`retag_image()`** — Lógica condicional de build
- **`decide_build_or_retag()`** — Decisão enterprise: BUILD ou RETAG

**Login Único (prepare job):** Autenticação no GHCR e Docker Hub é feita **uma única vez** no job `prepare`, com credenciais escritas diretamente em `~/.docker/config.json` via função `write_docker_auth()` (usa env vars Python para evitar injection). Os 5 deploy jobs apenas verificam se credenciais existem.

**Comunicação Release → Deploy:** O `release.yml` rastreia quais imagens foram **buildadas** vs **retagged**. A lista (`built_images`) é passada como input para o `deploy-stack-modular.yml` via `workflow_dispatch`. Quando TUDO é retagged, a Release envia `__NONE__` (sentinela) para diferenciar de deploy manual (string vazia).

**Função `pull_if_needed()` — 4 Casos:**

| Caso | Condição | Ação | Tempo |
|------|----------|------|-------|
| **1** | Tag exata existe localmente | SKIP | ~0s |
| **2** | Imagem Docker Hub/Quay (terceiros) | `pull_with_retry()` | ~2-30s |
| **3** | GHCR com info Release (build ou retag) | Retag local ou `pull_with_retry()` | ~0.1s ou ~2-30s |
| **4** | Deploy manual (sem info Release) | `pull_with_retry()` | ~2-30s |

**Benefícios:**
- **ELIMINADO** `docker manifest inspect` (frágil com manifest lists, timeout 15s/imagem)
- **ELIMINADO** fallback `docker login` nos deploy jobs (login único no prepare)
- **ELIMINADO** retry inconsistente (todos os paths usam `pull_with_retry()` com 3 tentativas)
- **ELIMINADO** duplicação (~610 linhas) — funções centralizadas em script compartilhado
- Release informa explicitamente quais imagens foram buildadas → detecção 100% precisa
- Deploys subsequentes com retag: ~30s ao invés de ~10min

**Secrets utilizados:**
- `GH_PAT` — Token para GHCR (GitHub Container Registry)
- `DOCKERHUB_USERNAME` + `DOCKERHUB_TOKEN` — Conta Pro Docker Hub (5000 pulls/dia)

## Validações pós-deploy

```bash
docker ps --format "table {{.Names}}\t{{.Status}}"
docker exec alice-postgres pg_isready
docker exec alice-pgbouncer pgbouncer -V
docker logs alice-caddy --tail 50
```

## Documentação relacionada

- `docs/ARQUITETURA.md`
- `docs/ARQUITETURA-GPU-MANAGER.md`
- `docs/OBSERVABILITY.md`
- `docs/PERMISSIONS.md`
- `docs/SECRETS.md`
- `docs/STATUS-REAL-ATUAL.md`
