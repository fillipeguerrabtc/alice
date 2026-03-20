# Secrets e Variaveis Operacionais

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 19 de Marco de 2026
**Status:** ativo
**Tipo:** ssot

## Objetivo

Definir os conjuntos de secrets usados pela entrega operacional da Alice e explicar quais validacoes sao executadas em `Release` e `Deploy`.

## Fontes de verdade

| Assunto | Arquivo |
| --- | --- |
| inventario dos servidores e acesso SSH | `docs/operations/servers.md` |
| geracao fail-fast de `.env.prod` | `infra/scripts/generate-env-prod.sh` |
| preflight por stack | `infra/scripts/preflight-secrets.sh` |
| validacao complementar de secrets | `infra/scripts/validate-secrets.sh` |

## Onde ficam

| Local | Uso |
| --- | --- |
| GitHub Secrets | fonte primaria da pipeline de producao |
| `.env.prod` no servidor | consolidacao gerada pelo deploy; nao e origem de verdade |
| variaveis locais | desenvolvimento e troubleshooting assistido |

## Grupos principais

### Acesso e entrega

| Secret | Uso |
| --- | --- |
| `HETZNER_VM_HOST` | host SSH do servidor de producao |
| `HETZNER_VM_USER` | usuario SSH |
| `HETZNER_SSH_PRIVATE_KEY` | chave do host |
| `GH_PAT` | GHCR, API GitHub e disparo de workflows |

### Core da plataforma

| Secret | Uso |
| --- | --- |
| `POSTGRES_PASSWORD` | banco principal |
| `REDIS_CACHE_PASSWORD` | cache Redis |
| `REDIS_QUEUE_PASSWORD` | filas Redis |
| `SESSION_SECRET` | sessao e auth |
| `INTERNAL_API_SECRET` | trafego service-to-service |
| `QDRANT_API_KEY` | Qdrant e scraping associado |
| `OPENAI_API_KEY` | Vision e imagens via OpenAI |
| `SEARXNG_SECRET_KEY` | web search interna |
| `CORS_ORIGIN` | origem publica principal |

### Observabilidade

| Secret | Uso |
| --- | --- |
| `GRAFANA_ADMIN_USER` | admin do Grafana |
| `GRAFANA_ADMIN_PASSWORD` | admin do Grafana |
| `GMAIL_USER` | SMTP de notificacoes |
| `GMAIL_APP_PASSWORD` | SMTP de notificacoes |
| `LANGFUSE_DB_USER` / `LANGFUSE_DB_PASSWORD` / `LANGFUSE_DB_NAME` | persistencia do Langfuse |
| `CLICKHOUSE_USER` / `CLICKHOUSE_PASSWORD` | armazenamento do Langfuse |

### Backup e TLS

| Secret | Uso |
| --- | --- |
| `BACKUP_CIPHER_PASS` | cifragem de backup |
| `DUCKDNS_TOKEN` | DNS-01 do Caddy |
| `ZEROSSL_EAB_KID` | emissao ZeroSSL |
| `ZEROSSL_EAB_HMAC_KEY` | emissao ZeroSSL |

### Integracoes externas

| Grupo | Exemplos |
| --- | --- |
| pagamentos | `STRIPE_*`, `WISE_*` |
| mensageria | `TWILIO_*`, `GMAIL_*` |
| trading | `KUCOIN_*` |
| OAuth e SSO | `GOOGLE_*`, `OAUTH_GITHUB_*`, `OIDC_COOKIE_KEYS`, `GRAFANA_OAUTH_CLIENT_SECRET` |

## Variaveis nao secret relevantes

| Variavel | Papel |
| --- | --- |
| `BASE_URL` | URL publica principal |
| `WEB_CRAWL_REQUIRE_ALLOWLIST` | exige allowlist no crawl |
| `WEB_CRAWL_ALLOWED_DOMAINS` | dominios permitidos para crawl |
| `LLM_GATEWAY_URL` | URL interna do LLM Gateway |
| `TRAINING_SERVICE_URL` | URL interna do training-service |
| `OBSERVABILITY_SERVICE_URL` | URL interna do observability-service para leituras agregadas da home operacional |
| `DOCUMENT_MAX_CHUNKS` | limite operacional do RAG |
| `TRAINING_DOC_MAX_SAMPLES` | limite operacional do training |
| `TRAINING_CONVERSATION_MAX_MESSAGES` | limite operacional do training |
| `CONVERSATION_SLICE_SIZE` | janela de fatiamento de conversa |
| `MIN_ONDEMAND_DATASET_SIZE` | minimo de dataset on-demand |

## Como a pipeline valida

### `generate-env-prod.sh`

- monta `.env.prod`
- falha cedo quando secrets criticos nao existem
- valida obrigatoriedades de producao, versoes e combinacoes sensiveis

### `preflight-secrets.sh`

Validacao minima por stack antes do `compose up`:

| Stack | Conjunto minimo |
| --- | --- |
| `infra` | `POSTGRES_PASSWORD`, `REDIS_CACHE_PASSWORD`, `REDIS_QUEUE_PASSWORD`, `SESSION_SECRET`, `INTERNAL_API_SECRET`, `QDRANT_API_KEY` |
| `alice` | conjunto de `infra` + `OPENAI_API_KEY`, `SEARXNG_SECRET_KEY`, `CORS_ORIGIN` |
| `observability` | conjunto de `infra` + `GRAFANA_ADMIN_USER`, `GRAFANA_ADMIN_PASSWORD` |
| `backup` | conjunto de `infra` + `BACKUP_CIPHER_PASS` |

## Regras vigentes

- `CI` nao usa este documento para inventar secrets novos; ele valida o que ja existe no repositorio e nos scripts.
- `Release` publica artefatos aprovados, mas a montagem final de `.env.prod` continua sendo responsabilidade do `Deploy`.
- Em `pull_request`, mudancas `docs-only` nao disparam validacoes de codigo da aplicacao.
- O deploy deve falhar em modo fail-fast quando o conjunto obrigatorio estiver incompleto.

## Referencias

- [docs/operations/deploy.md](deploy.md)
- [docs/operations/deployment.md](deployment.md)
- [docs/operations/servers.md](servers.md)
- [docs/operations/permissions.md](permissions.md)
