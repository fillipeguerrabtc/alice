# Guia Completo de Secrets - Alice Enterprise Platform

**Autor:** Fillipe Guerra  
**Data:** 18 de Janeiro de 2026  
**Versão:** 7.6 - Callback OAuth configurável

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
| `QDRANT_API_KEY` | API key do Qdrant (também usado pelo scrape Prometheus) | ✅ |

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

## Secrets de integrações

| Secret | Descrição | Obrigatório |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | Stripe API Key | ✅ |
| `STRIPE_PUBLISHABLE_KEY` | Stripe Publishable | ✅ |
| `STRIPE_WEBHOOK_SECRET` | Stripe Webhook | ✅ |
| `WISE_API_KEY` | Wise API | ✅ |
| `WISE_PROFILE_ID` | Wise Profile ID | ✅ |
| `WISE_WEBHOOK_SECRET` | Wise Webhook | ✅ |
| `TWILIO_ACCOUNT_SID` | Twilio Account SID | ✅ |
| `TWILIO_AUTH_TOKEN` | Twilio Auth Token | ✅ |
| `TWILIO_WHATSAPP_NUMBER` | Twilio WhatsApp | ✅ |
| `KUCOIN_PRO_API_KEY` | KuCoin API Key | ✅ |
| `KUCOIN_PRO_API_SECRET` | KuCoin API Secret | ✅ |
| `KUCOIN_PRO_API_PASSPHRASE` | KuCoin API Passphrase | ✅ |
| `KUCOIN_PRO_BASE_URL` | Base URL KuCoin | ✅ |

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
| `OIDC_COOKIE_KEYS` | Cookies OIDC | ✅ |
| `GRAFANA_OAUTH_CLIENT_SECRET` | OAuth Grafana | ✅ |
| `ERPNEXT_OAUTH_CLIENT_SECRET` | OAuth ERPNext | ✅ |

## Variáveis opcionais (não secret)

| Secret | Descrição |
| --- | --- |
| `BASE_URL` | Base URL pública da plataforma (OAuth callbacks) |
| `OAUTH_CALLBACK_URL` | URL pública de callback OAuth para Google (ex: `https://dominio/api/auth/google/callback`) |
| `PGBACKREST_ALLOW_STANZA_RESET` | `true` permite reset controlado de stanza em mismatch de system-id (input do workflow) |
| `DOCKERHUB_USERNAME` | Evita rate limit Docker Hub |
| `DOCKERHUB_TOKEN` | Token Docker Hub |
| `HUGGINGFACE_TOKEN` | Token HF (se necessário) |
| `SEARXNG_SECRET_KEY` | Secret do SearXNG |
| `ERPNEXT_MYSQL_EXPORTER_USER` | Usuário do mysqld_exporter (default: `erpnext_exporter`) |
| `OPENAI_PROXY` | Proxy dedicado para chamadas OpenAI (ex: `http://proxy:3128`) |
| `HTTP_PROXY` | Proxy global (fallback para OpenAI se `OPENAI_PROXY` não existir) |
| `HTTPS_PROXY` | Proxy global TLS (fallback para OpenAI se `OPENAI_PROXY` não existir) |
| `NO_PROXY` | Hosts que não devem usar proxy (ex: `api.openai.com,.openai.com`) |
| `OPENAI_VISION_MAX_BYTES` | Limite de payload (bytes) para Vision via OpenAI |

## Geração recomendada

```bash
openssl rand -hex 32
openssl rand -hex 64
```

## Referências

- <https://console.cloud.google.com/apis/credentials>
- <https://github.com/settings/developers>
- <https://hub.docker.com/settings/security>
