# Guia Completo de Secrets - Alice Enterprise Platform

**Author:** Fillipe Guerra  
**Data:** 30 de Janeiro de 2026  
**Versão:** 7.15 - Secrets Stripe/Wise opcionais documentados

## Visão geral

Este documento lista os secrets obrigatórios e opcionais usados no deploy enterprise da Alice. O pipeline falha imediatamente se secrets críticos estiverem ausentes.

## Onde configurar

| Local | O que vai lá | Observação |
| --- | --- | --- |
| **GitHub Secrets** | Secrets de produção | CI/CD gera `.env.prod` automaticamente |
| **Variáveis locais** | Apenas desenvolvimento | Não usado em produção |

## Secrets críticos de deploy

| Secret | Descrição | Obrigatório |
| --- | --- | --- |
| `HETZNER_VM_HOST` | IP do Production Server (GEX44) | ✅ |
| `HETZNER_VM_USER` | Usuário SSH (root) | ✅ |
| `HETZNER_SSH_PRIVATE_KEY` | Chave SSH privada com novas linhas reais | ✅ |
| `GH_PAT` | Token GitHub com `repo`, `write:packages`, `workflow` | ✅ |
| `POSTGRES_PASSWORD` | Senha PostgreSQL (32+ chars) | ✅ |
| `REDIS_PASSWORD` | Senha Redis Alice (32+ chars) | ✅ |
| `REDIS_CACHE_PASSWORD` | Senha Redis Cache (ERPNext) | ✅ |
| `REDIS_QUEUE_PASSWORD` | Senha Redis Queue (ERPNext) | ✅ |
| `SESSION_SECRET` | Secret de sessão (64+ chars) | ✅ |
| `INTERNAL_API_SECRET` | Secret S2S interno | ✅ |
| `OPENAI_API_KEY` | OpenAI (Vision + Images) | ✅ |
| `BACKUP_CIPHER_PASS` | Cifra pgBackRest (32+ chars) | ✅ |
| `ADMIN_USER` | Usuário admin Alice Auth | ✅ |
| `ADMIN_PWD` | Senha admin Alice Auth | ✅ |
| `GRAFANA_ADMIN_USER` | Usuário admin Grafana | ✅ |
| `GRAFANA_ADMIN_PASSWORD` | Senha admin Grafana | ✅ |
| `ERPNEXT_ADMIN_PASSWORD` | Senha admin ERPNext | ✅ |
| `ACME_EMAIL` | Email Let's Encrypt (Caddy TLS) | ✅ |
| `DUCKDNS_TOKEN` | Token DuckDNS (ACME DNS-01) | ✅ |
| `ZEROSSL_EAB_KID` | ZeroSSL EAB Key ID (fallback ACME) | ✅ |
| `ZEROSSL_EAB_HMAC_KEY` | ZeroSSL EAB HMAC Key (fallback ACME) | ✅ |
| `QDRANT_API_KEY` | API key do Qdrant (também usado pelo scrape Prometheus) | ✅ |
| `MINIO_ROOT_PASSWORD` | Senha root do MinIO (Langfuse v3 S3) | ✅ |

## Secrets de observabilidade

| Secret | Descrição | Obrigatório |
| --- | --- | --- |
| `LANGFUSE_SECRET_KEY` | Secret do Langfuse | ✅ |
| `LANGFUSE_NEXT_AUTH_SECRET` | Auth do Langfuse | ✅ |
| `LANGFUSE_SALT` | Salt do Langfuse | ✅ |
| `LANGFUSE_ENCRYPTION_KEY` | Encryption key Langfuse | ✅ |
| `LANGFUSE_DB_USER` | User DB Langfuse | ✅ |
| `LANGFUSE_DB_PASSWORD` | Password DB Langfuse | ✅ |
| `LANGFUSE_DB_NAME` | DB Langfuse | ✅ |
| `CLICKHOUSE_USER` | User ClickHouse | ✅ |
| `CLICKHOUSE_PASSWORD` | Password ClickHouse | ✅ |
| `GMAIL_USER` | SMTP Grafana (Gmail) | ✅ |
| `GMAIL_APP_PASSWORD` | App Password Gmail | ✅ |
| `GRAFANA_URL` | URL interna do Grafana (ex: `http://alice-grafana:3000`) | ✅ |
| `GRAFANA_API_KEY` | API key Grafana (opcional, substitui Basic Auth) | ⚠️ |

## ZeroSSL (EAB) - como gerar

1. Criar conta gratuita no ZeroSSL.
2. Acessar **Dashboard → Developer → Generate EAB Credentials**.
3. Copiar e salvar:
   - **EAB KID** → `ZEROSSL_EAB_KID`
   - **EAB HMAC Key** → `ZEROSSL_EAB_HMAC_KEY`

> As credenciais EAB não são exibidas novamente. Guarde em local seguro.

## Secrets de integrações

| Secret | Descrição | Obrigatório |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | Stripe API Key | ✅ |
| `STRIPE_PUBLISHABLE_KEY` | Stripe Publishable | ✅ |
| `STRIPE_WEBHOOK_SECRET` | Stripe Webhook | ✅ |
| `STRIPE_WEBHOOK_BASE_URL` | Base URL para webhooks Stripe | ⚠️ |
| `WISE_API_KEY` | Wise API | ✅ |
| `WISE_PROFILE_ID` | Wise Profile ID | ✅ |
| `WISE_WEBHOOK_SECRET` | Wise Webhook | ⚠️ |
| `WISE_SANDBOX` | Wise Sandbox (`true`/`false`) | ⚠️ |
| `TWILIO_ACCOUNT_SID` | Twilio Account SID | ✅ |
| `TWILIO_AUTH_TOKEN` | Twilio Auth Token | ✅ |
| `TWILIO_WHATSAPP_NUMBER` | Twilio WhatsApp | ✅ |
| `KUCOIN_PRO_API_KEY` | KuCoin API Key | ✅ |
| `KUCOIN_PRO_API_SECRET` | KuCoin API Secret | ✅ |
| `KUCOIN_PRO_API_PASSPHRASE` | KuCoin API Passphrase | ✅ |
| `KUCOIN_PRO_API_KEY_VERSION` | Versão da API Key KuCoin (1/2/3) | ⚠️ |
| `KUCOIN_PRO_BASE_URL` | Base URL KuCoin | ✅ |
| `KUCOIN_WS_ORDERBOOK_DEPTH` | Profundidade WS KuCoin (5 ou 50) | ✅ (se KuCoin ativo) |
| `KUCOIN_REST_ORDERBOOK_DEPTH` | Profundidade REST KuCoin (20 ou 100) | ✅ (se KuCoin ativo) |

> **Nota (27/01/2026):** `KUCOIN_TENANT_ID` foi removido. O tenant para eventos privados do KuCoin WS é resolvido dinamicamente no banco (`integrations`).
> **Nota (28/01/2026):** Se `KUCOIN_PRO_API_KEY` estiver configurada, `KUCOIN_WS_ORDERBOOK_DEPTH` e `KUCOIN_REST_ORDERBOOK_DEPTH` são obrigatórias para evitar crashloop do `integrations-service`.

## GitHub Actions (Stack Ops)

| Secret | Descrição | Obrigatório |
| --- | --- | --- |
| `GH_PAT` | Token para disparar workflows (repo:workflow) | ✅ |
| `GH_REPO` | Repositório no formato `owner/repo` | ✅ |
| `GH_API_URL` | API GitHub (default: `https://api.github.com`) | ⚠️ |

## ERPNext

| Secret | Descrição | Obrigatório |
| --- | --- | --- |
| `ERPNEXT_MYSQL_ROOT_PASSWORD` | Root DB ERPNext | ✅ |
| `ERPNEXT_MYSQL_EXPORTER_PASSWORD` | Exporter DB ERPNext | ✅ |
| `ERPNEXT_DB_PASSWORD` | Password DB ERPNext | ✅ |

## OAuth / SSO

| Secret | Descrição | Obrigatório |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | OAuth Google | ✅ |
| `GOOGLE_CLIENT_SECRET` | OAuth Google | ✅ |
| `OAUTH_GITHUB_CLIENT_ID` | OAuth GitHub | ✅ |
| `OAUTH_GITHUB_CLIENT_SECRET` | OAuth GitHub | ✅ |
| `GITHUB_CLIENT_ID` | OAuth GitHub (legado, aceito) | ⚠️ |
| `GITHUB_CLIENT_SECRET` | OAuth GitHub (legado, aceito) | ⚠️ |
| `OIDC_COOKIE_KEYS` | Cookies OIDC | ✅ |
| `GRAFANA_OAUTH_CLIENT_SECRET` | OAuth Grafana | ✅ |
| `ERPNEXT_OAUTH_CLIENT_SECRET` | OAuth ERPNext | ✅ |

> Preferir `OAUTH_GITHUB_CLIENT_ID` e `OAUTH_GITHUB_CLIENT_SECRET`. As chaves `GITHUB_*` existem apenas para compatibilidade.

## Variáveis opcionais (não secret)

| Secret | Descrição |
| --- | --- |
| `BASE_URL` | Base URL pública da plataforma (OAuth callbacks) |
| `OAUTH_CALLBACK_URL` | URL publica de callback OAuth para Google (URL completa ou path; ex: `https://dominio/api/auth/google/callback` ou `/api/auth/google/callback/`, deve casar exatamente com o redirect configurado no Google Cloud) |
| `OAUTH_GITHUB_CALLBACK_URL` | URL publica de callback OAuth para GitHub (URL completa ou path; ex: `https://dominio/api/auth/github/callback` ou `/api/auth/github/callback/`, deve casar exatamente com o redirect configurado no GitHub) |
| `PGBACKREST_ALLOW_STANZA_RESET` | `true` permite reset controlado de stanza em mismatch de system-id (input do workflow) |
| `DOCKERHUB_USERNAME` | Evita rate limit Docker Hub |
| `DOCKERHUB_TOKEN` | Token Docker Hub |
| `HUGGINGFACE_TOKEN` | Token HF (se necessário) |
| `CORS_ORIGINS` | Lista de origens CORS permitidas (CSV) |
| `SEARXNG_SECRET_KEY` | Secret do SearXNG |
| `ERPNEXT_MYSQL_EXPORTER_USER` | Usuário do mysqld_exporter (default: `erpnext_exporter`) |
| `OPENAI_PROXY` | Proxy dedicado para chamadas OpenAI (ex: `http://proxy:3128`) |
| `HTTP_PROXY` | Proxy global (fallback para OpenAI se `OPENAI_PROXY` não existir) |
| `HTTPS_PROXY` | Proxy global TLS (fallback para OpenAI se `OPENAI_PROXY` não existir) |
| `NO_PROXY` | Hosts que não devem usar proxy (ex: `api.openai.com,.openai.com`) |
| `OPENAI_VISION_MAX_BYTES` | Limite de payload (bytes) para Vision via OpenAI |
| `RAG_REQUEST_TIMEOUT_MS` | Timeout (ms) para chamadas ao RAG (context/classify/agentic) |
| `ACME_DNS_PRECHECK_ENABLED` | `true` ativa pré-check DNS ACME antes de subir o Caddy |
| `ACME_DNS_PRECHECK_MAX_ATTEMPTS` | Número máximo de tentativas do pré-check DNS |
| `ACME_DNS_PRECHECK_INTERVAL_SECONDS` | Intervalo (segundos) entre tentativas do pré-check DNS |
| `ACME_DNS_PRECHECK_TIMEOUT_SECONDS` | Timeout (segundos) por consulta DNS via DoH |
| `ACME_DNS_PRECHECK_RESOLVERS` | Lista de resolvers DoH (separada por espaço) |
| `ACME_DNS_PRECHECK_REQUIRE_ALL_RESOLVERS` | `true` exige sucesso em todos os resolvers DoH |
| `ACME_DNS_PRECHECK_HOSTS` | Lista de hosts para checagem (override do Caddyfile) |

## Geração recomendada

```bash
openssl rand -hex 32
openssl rand -hex 64
```

## Referências

- <https://console.cloud.google.com/apis/credentials>
- <https://github.com/settings/developers>
- <https://hub.docker.com/settings/security>
