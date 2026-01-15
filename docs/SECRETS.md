# Guia Completo de Secrets - Alice Enterprise Platform

**Autor:** Fillipe Guerra  
**Data:** 15 de Janeiro de 2026  
**Versão:** 6.1 - Hardening Auth Híbrida (WS4)

## Visão Geral

Este documento contém a lista completa de todos os secrets necessários para a plataforma Alice Enterprise, incluindo instruções de configuração para webhooks e OAuth.

**Total de Secrets:** ~50 configurados no repositório GitHub (verificado em 11/01/2026)
**Arquitetura:** Deploy Server (CPX32 - 4 vCPU, 8GB RAM) + Production Server (GEX44 GPU)
**Arquitetura Multi-Stack:** 5 stacks independentes (INFRA, ALICE, OBSERVABILITY, ERPNEXT, BACKUP)
**Total de Containers:** 50 em produção (10 infra + 8 Alice + 5 GPU + 13 observability + 15 ERPNext + 1 backup)
**Redis Alice:** Container dedicado para cache distribuído (segregação enterprise do ERPNext)
**LLM (Gate 2):** Mistral 7B Instruct AWQ (texto) + Qwen2.5-VL 7B AWQ (visão) via GPU Manager Service (Hetzner GPU)
**Trading:** KuCoin Futures BTC Perpetuals (XBTUSDTM)
**URL de Produção:** `https://yesyoudeserve.duckdns.org`
**URL ERPNext:** `https://erp.yesyoudeserve.duckdns.org`
**IP:** 178.63.41.108

> **ATUALIZAÇÃO 05/01/2026:** Arquitetura refatorada para 5 stacks independentes com deploy/rollback modular. Workflow `.github/workflows/deploy-stack.yml` (**Deploy - Production (Stacks)**) permite deploy individual por stack.

> Atualização 21/12/2025: Fluxo CI deduplicado (push somente em `main` + PR em `main`) e correções de tipos no frontend destravando Release & Tag.

### Serviços que Utilizam Secrets

| Categoria | Serviços | Secrets Relacionados |
|-----------|----------|----------------------|
| **Infraestrutura** | postgres, caddy, alice-redis | POSTGRES_PASSWORD, REDIS_PASSWORD, ACME_EMAIL |
| **Alice Auth** | alice-auth | SESSION_SECRET, GOOGLE_*, OAUTH_GITHUB_* |
| **Alice Chat** | alice-chat | GPU_MANAGER_URL (opcional, default: http://alice-gpu-manager:3010) |
| **Alice RAG (GPU + Web Search)** | alice-rag | GPU_MANAGER_URL, SEARXNG_URL |
| **GPU Manager Service** | gpu-manager-service | INTERNAL_API_SECRET, REDIS_URL |
| **Alice Integrations** | alice-integrations | STRIPE_*, WISE_*, TWILIO_*, GMAIL_*, KUCOIN_* |
| **Alice Trading** | alice-integrations | KUCOIN_PRO_API_KEY, KUCOIN_PRO_API_SECRET, KUCOIN_PRO_API_PASSPHRASE, KUCOIN_PRO_BASE_URL |
| **Alice Observability** | alice-observability, langfuse, langfuse-db | GRAFANA_*, LANGFUSE_*, LANGFUSE_DB_USER, LANGFUSE_DB_PASSWORD, LANGFUSE_DB_NAME |
| **Web Search (SearXNG)** | alice-searxng | SEARXNG_SECRET_KEY |
| **ERPNext** | erpnext-* | ERPNEXT_*, REDIS_CACHE_PASSWORD, REDIS_QUEUE_PASSWORD |
| **Deploy** | GitHub Actions | HETZNER_*, GH_PAT |

---

## Onde Configurar

| Local | O que vai lá | Observação |
|-------|--------------|------------|
| **GitHub Secrets** | Todos os secrets de produção | CI/CD cria `.env.prod` automaticamente |
| **Variáveis de Ambiente Local** | Apenas para desenvolvimento (`.env`) | NÃO usado em produção |
| **Hetzner .env.prod** | Criado automaticamente | Gerado pelo GitHub Actions |

---

## Secrets por Fase de Deploy

### FASE 1: Deploy Mínimo Funcional (OBRIGATÓRIOS)

Estes são necessários para o deploy funcionar:

| Secret | Valor | Descrição | Status |
|--------|-------|-----------|--------|
| `HETZNER_VM_HOST` | `178.63.41.108` | IP do Production Server (GPU Server GEX44) | ✅ **OBRIGATÓRIO** |
| `HETZNER_VM_USER` | `root` | Usuário SSH do Production Server | ✅ **OBRIGATÓRIO** |
| `HETZNER_SSH_PRIVATE_KEY` | Chave SSH privada completa | Chave SSH (incluir `-----BEGIN...-----END` com newlines reais) | ✅ **OBRIGATÓRIO** |
| `GH_PAT` | Token GitHub | Personal Access Token com `repo`, `write:packages`, `workflow` | ✅ **OBRIGATÓRIO** |

> **🚨 CRÍTICO - DISTINÇÃO ENTRE SERVIDORES (28/12/2025):**
>
> | Servidor | IP | Função | GPU |
> |----------|-----|--------|-----|
> | **Production Server (GEX44)** | `178.63.41.108` | Hospeda containers de produção | ✅ RTX 4000 Ada 20GB |
> | **Deploy Server (CPX32)** | `46.224.46.93` | Runner para CI/CD GitHub Actions | ❌ Sem GPU |
>
> **O secret `HETZNER_VM_HOST` DEVE ser `178.63.41.108` (Production Server com GPU)!**
>
> Se configurado com `46.224.46.93` (Deploy Server), o deploy falhará porque:
> - `nvidia-smi` não existe no Deploy Server
> - Containers GPU não podem iniciar sem NVIDIA runtime
> - Erro típico: "nvidia-smi não encontrado" ou "container alice-gpu-manager is unhealthy"
>
> **Validação fail-fast no workflow (28/12/2025):**
> - O workflow valida o **IP público** do host remoto e compara com `HETZNER_VM_HOST` (fonte de verdade).
> - O workflow valida GPU obrigatória via `nvidia-smi` **e** via Docker com `docker run --gpus all ... nvidia-smi`.
> - Se qualquer validação falhar, o deploy é abortado imediatamente (evita sujeira e deploy no host errado).
>
> Para verificar qual servidor está sendo usado, observe os logs do deploy:
> - Se mostra GPU info (ex: "RTX 4000 Ada") → servidor correto (Production)
> - Se mostra "nvidia-smi não encontrado" → servidor errado (Deploy)

> **IMPORTANTE (27/12/2025):** A chave SSH no GitHub Secrets DEVE ter **newlines reais**, não literais `\n`. Ao colar no GitHub Secrets, a chave deve aparecer com múltiplas linhas visíveis, não uma linha só. Se a chave tem ~400 chars e aparece em 1 linha, está errada.

> **ENTERPRISE-GRADE (28/12/2025):** Arquitetura com Deploy Server separado (CPX32 - 4 vCPU AMD EPYC, 8GB RAM) como Runner e Production Server (GEX44 GPU) para containers. Runner com Enterprise Hardening (kernel tuning, Docker daemon, limits, systemd). Deploy usa `HETZNER_VM_HOST`, `HETZNER_VM_USER` e `HETZNER_SSH_PRIVATE_KEY` para SSH direto ao Production Server. Scripts `deploy-remote.sh` e `deploy-local.sh` foram REMOVIDOS (28/12/2025) - workflow usa script inline no SSH action (mais auditável).
| `POSTGRES_PASSWORD` | Senha forte 32+ chars | `openssl rand -hex 32` |
| `REDIS_PASSWORD` | Senha Redis Alice (obrigatório) | `openssl rand -hex 32` |
| `SESSION_SECRET` | String aleatória 64+ chars (mínimo) | `openssl rand -hex 64` |
| `INTERNAL_API_SECRET` | Secret para comunicação S2S | `openssl rand -hex 32` |
| `GRAFANA_ADMIN_USER` | Username admin Grafana 12 (ex: admin ou email) | Definir username |
| `GRAFANA_ADMIN_PASSWORD` | Senha admin Grafana 12 (mín. 8 chars recomendado) | Definir forte e exclusiva |
| `ERPNEXT_ADMIN_PASSWORD` | Senha admin ERPNext 15 (mín. 8 chars) - Username fixo "Administrator" | Definir forte e exclusiva |
| `DOCKERHUB_USERNAME` | Username Docker Hub | Evita rate limit (100 pulls/6h anônimo) |
| `DOCKERHUB_TOKEN` | Access Token Docker Hub | [hub.docker.com/settings/security](https://hub.docker.com/settings/security) |

> **ARQUITETURA ADMIN 2025 (31/12/2025):**
>
> | Sistema | Username Admin | Pode Mudar? | Secret da Senha |
> |---------|---------------|-------------|-----------------|
> | **Alice Auth** | Email obrigatório (ex: admin@dominio.com) | ✅ Sim | `ADMIN_PWD` (mín. 8 chars) |
> | **Grafana 12** | Customizável (default: `admin`) | ✅ Sim | `GRAFANA_ADMIN_PASSWORD` |
> | **ERPNext 15** | `Administrator` (fixo) | ❌ Não | `ERPNEXT_ADMIN_PASSWORD` |
>
> **Nota:** Todos os 3 sistemas são **OBRIGATÓRIOS** e **INDEPENDENTES**. Não existe fallback entre sistemas.

---

## Break-glass (acesso de emergência) — WS4

Este procedimento existe para evitar **downtime operacional** quando o SSO (OIDC) estiver indisponível (ex.: `alice-auth` down, problema de DNS/certificado), mantendo um caminho de acesso **local** e **auditável**.

### Grafana (stack OBSERVABILITY)

- **Conta local**: usar `GRAFANA_ADMIN_USER` + `GRAFANA_ADMIN_PASSWORD`.
- **Pré-condição**: **não** desabilitar o login form local (ou seja, `GF_AUTH_DISABLE_LOGIN_FORM` deve permanecer **unset** ou **false**).
- **Acesso**:
  - Abrir a tela de login e usar o login local (não “Login com Alice Enterprise”) quando o OIDC estiver fora.
- **Se o botão de login local não aparecer**:
  - Ajustar a configuração do stack OBSERVABILITY via CI/CD (não editar manualmente em produção) para garantir que o login form local esteja habilitado.

### ERPNext (stack ERPNEXT)

- **Conta local obrigatória**: `Administrator` (fixo) com senha `ERPNEXT_ADMIN_PASSWORD`.
- **Acesso**:
  - Usar login local como `Administrator` quando SSO estiver indisponível.

### Alice Auth (stack ALICE)

- **Conta admin (plataforma)**: `ADMIN_USER` + `ADMIN_PWD` (obrigatórios em produção).
- **Nota**: esta conta é o “break-glass” do **IdP** (Alice Auth). Para Grafana/ERPNext o break-glass é **local** (acima).

### FASE 1.5: SSO OAuth (Deploy 100% Automatizado - 31/12/2025)

Secrets pré-definidos para SSO funcionar automaticamente no primeiro deploy:

| Secret | Descrição | Status |
|--------|-----------|--------|
| `GRAFANA_OAUTH_CLIENT_SECRET` | Secret OAuth para grafana-sso | ✅ **CONFIGURADO** |
| `ERPNEXT_OAUTH_CLIENT_SECRET` | Secret OAuth para erpnext-sso | ✅ **CONFIGURADO** |
| `OIDC_COOKIE_KEYS` | Chaves para cookies OIDC | ✅ **CONFIGURADO** |

#### Variáveis OIDC (Configuração) — Obrigatórias em Produção (WS4)

Estas variáveis **não são secrets**, mas são **obrigatórias em produção** para autenticação híbrida (Sessão + JWT OIDC com validação local via JWKS):

| Variável | Exemplo | Obrigatória? | Descrição |
|----------|---------|--------------|-----------|
| `OIDC_ISSUER` | `https://auth.alice.yesyoudeserve.duckdns.org` | ✅ Produção | Issuer do OIDC Provider (Alice Auth). Usado para discovery/JWKS e validação do `iss` em JWT. |
| `OIDC_API_AUDIENCE` | `alice-api` | ✅ Produção | Audience esperado para tokens Bearer aceitos pelos microsserviços (validação local via JWKS). Evita aceitar tokens emitidos para outro client. |

> **WS4 (Auth híbrida) - IMPORTANTE:** Para RBAC em SSO (Grafana/ERPNext) e para Bearer JWT nos microsserviços, o escopo **`alice`** deve ser solicitado pelos RPs. Sem ele, claims customizados (ex.: `role`, `tenant_id`, `modules`) podem não estar presentes no `/oauth/userinfo` e/ou no access token.

> **SSO 100% AUTOMATIZADO:**
> - Os secrets acima são usados pelo seed-oidc.ts que roda automaticamente
> - Grafana e ERPNext já vêm configurados para usar Alice como IdP
> - Botão "Login com Alice Enterprise" aparece automaticamente
> - Não é necessário nenhum passo manual pós-deploy
>
> **Gerado em:** 31/12/2025 - Secrets criados e configurados no repositório

### FASE 2: Autenticação (mínimo 1 provider)

**Google OAuth:**

| Secret | Onde Obter |
|--------|------------|
| `GOOGLE_CLIENT_ID` | [console.cloud.google.com](https://console.cloud.google.com/apis/credentials) |
| `GOOGLE_CLIENT_SECRET` | [console.cloud.google.com](https://console.cloud.google.com/apis/credentials) |

**Configuração:**
1. Acesse Google Cloud Console → APIs & Services → Credentials
2. Crie OAuth 2.0 Client ID (Web application)
3. Authorized redirect URIs: `https://yesyoudeserve.duckdns.org/api/auth/callback/google`
4. Authorized JavaScript origins: `https://yesyoudeserve.duckdns.org`

**GitHub OAuth:**

| Secret | Onde Obter |
|--------|------------|
| `OAUTH_GITHUB_CLIENT_ID` | [github.com/settings/developers](https://github.com/settings/developers) |
| `OAUTH_GITHUB_CLIENT_SECRET` | [github.com/settings/developers](https://github.com/settings/developers) |

**Configuração:**
1. Settings → Developer settings → OAuth Apps → New OAuth App
2. Homepage URL: `https://yesyoudeserve.duckdns.org`
3. Authorization callback URL: `https://yesyoudeserve.duckdns.org/api/auth/callback/github`

⚠️ **IMPORTANTE:** O GitHub NÃO permite secrets começando com `GITHUB_`. Use `OAUTH_GITHUB_` como prefixo.

### FASE 3: GPU Manager Service (Gerenciamento Centralizado de Requisições GPU)

**ARQUITETURA 100% DOCKER HUB (28/12/2025):** Todos os containers GPU usam imagens públicas - SEM AUTENTICAÇÃO NGC.

| Secret | Onde Obter | Descrição | Obrigatório? |
|--------|------------|-----------|--------------|
| `HUGGINGFACE_TOKEN` | [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) → New token → Read (sem write) | Token de acesso read-only do HuggingFace (obrigatório para download de modelos) | ✅ **SIM** |
| `GPU_MANAGER_URL` | Opcional (default: `http://alice-gpu-manager:3010`) | URL do GPU Manager Service (usado internamente pelos serviços - não precisa de secret) | ⏳ **Opcional** |
| `INTERNAL_API_SECRET` | Gerar com `openssl rand -hex 32` | Secret para comunicação segura entre serviços (já configurado na FASE 1) | ✅ **SIM** |

**Containers GPU (Gate 2 - 15/01/2026) - TODOS 100% PÚBLICOS:**

| Container | Imagem | Origem | Autenticação |
|-----------|--------|--------|--------------|
| **llm-mistral** | `vllm/vllm-openai:v0.12.0` | Docker Hub | ❌ Não precisa |
| **qwen-vl (VLM)** | `vllm/vllm-openai:v0.12.0` | Docker Hub | ❌ Não precisa |
| **asr-canary** | `pytorch/pytorch:2.7.1-cuda12.8-cudnn9-devel` + NeMo pip | Docker Hub | ❌ Não precisa |
| **embeddings-gpu** | `pytorch/pytorch:2.7.1-cuda12.8-cudnn9-devel` | Docker Hub | ❌ Não precisa |
| **qwen-trainer** | `pytorch/pytorch:2.7.1-cuda12.8-cudnn9-devel` | Docker Hub | ❌ Não precisa |

> **Gate 2:** LLM (texto) e VLM (visão) são serviços separados. Alice **analisa** imagens (VLM) mas **não gera** imagens.

**NOTA:** NGC_API_KEY foi **REMOVIDO** - Personal API Key do NGC não funciona para containers públicos (retorna 403 Forbidden). Todos os containers agora usam Docker Hub que é 100% público e gratuito.

**NOTA:** O GPU Manager Service gerencia automaticamente:
- Fila priorizada de requisições (chat > trading > embeddings > outros)
- Monitoramento de VRAM em tempo real (nvidia-smi)
- Circuit breakers por serviço GPU
- Retry logic com backoff exponencial
- Métricas Prometheus (latência, fila, VRAM, erros)

> **IMPORTANTE (Gate 2):** Não são necessários secrets para URLs dos serviços GPU (LLM/VLM/Embeddings/ASR) — todos rodam localmente no servidor Hetzner GEX44 e são gerenciados pelo GPU Manager Service. URLs são internas (Docker network) e não precisam de secrets. Arquitetura simplificada: serviços GPU rodam simultaneamente dentro do budget de 20GB VRAM (fonte de verdade = métricas + `nvidia-smi`).

### FASE 4: Pagamentos Stripe (receber EUR/SEPA)

| Secret | Onde Obter |
|--------|------------|
| `STRIPE_SECRET_KEY` | [dashboard.stripe.com/apikeys](https://dashboard.stripe.com/apikeys) |
| `STRIPE_PUBLISHABLE_KEY` | dashboard.stripe.com/apikeys |
| `STRIPE_WEBHOOK_SECRET` | dashboard.stripe.com/webhooks |
| `STRIPE_WEBHOOK_BASE_URL` | Base URL para webhooks (opcional, default: `https://yesyoudeserve.duckdns.org`) |

**Configuração de Webhook:**
1. Stripe Dashboard → Developers → Webhooks → Add endpoint
2. Endpoint URL: `https://yesyoudeserve.duckdns.org/webhook/stripe`
3. Eventos:
   - `customer.created`, `customer.updated`, `customer.deleted`
   - `payment_intent.succeeded`, `payment_intent.payment_failed`
   - `invoice.paid`, `invoice.payment_failed`
   - `checkout.session.completed`
   - `subscription.created`, `subscription.updated`, `subscription.deleted`
4. Copie o Signing Secret (começa com `whsec_`)

### FASE 5: Pagamentos Wise (enviar globalmente)

| Secret | Onde Obter |
|--------|------------|
| `WISE_API_KEY` | [wise.com/settings](https://wise.com/settings) → API Tokens |
| `WISE_PROFILE_ID` | URL: `wise.com/user/account/XXXXX` |
| `WISE_WEBHOOK_SECRET` | wise.com/settings → Webhooks (opcional, gerado após configurar webhook) |
| `WISE_SANDBOX` | `true` para sandbox, `false` para produção (opcional, default: `false`) |

**Configuração:**
1. Wise Business → Settings → API Tokens → Add new token
2. Permissões: `Read balances`, `Read transfers`, `Create transfers`
3. Profile ID está na URL quando você acessa sua conta

**Nota:** Use `WISE_SANDBOX=false` em produção.

### FASE 5b: Trading KuCoin Futures (BTC Perpetuals)

| Secret | Onde Obter |
|--------|------------|
| `KUCOIN_PRO_API_KEY` | [kucoin.com/account/api](https://www.kucoin.com/account/api) |
| `KUCOIN_PRO_API_SECRET` | kucoin.com/account/api (mostrado apenas 1 vez ao criar) |
| `KUCOIN_PRO_API_PASSPHRASE` | Definido por você ao criar a API Key |
| `KUCOIN_PRO_BASE_URL` | Opcional. Default: `https://api-futures.kucoin.com` |
| `KUCOIN_SANDBOX_MODE` | `true` para sandbox, `false` para produção (default: `false`) |

#### Variáveis KuCoin (Configuração) — Não são secrets

Estas variáveis são **configuração** (não secrets) e podem ser definidas via GitHub Actions (variables) ou `.env` local:

| Variável | Exemplo | Obrigatória? | Descrição |
|----------|---------|--------------|-----------|
| `KUCOIN_ALLOWED_SYMBOLS` | `XBTUSDTM,XBTUSDM` | ⏳ Opcional | Lista de símbolos permitidos. Evita hardcode e permite expansão controlada. |
| `KUCOIN_DEFAULT_SYMBOL` | `XBTUSDTM` | ⏳ Opcional | Símbolo default. Em produção, se definido e não estiver em `KUCOIN_ALLOWED_SYMBOLS`, o serviço falha (fail-fast). |

**Configuração:**
1. KuCoin → Profile → API Management → Create API
2. Permissions necessárias: `Futures Trading`, `General`
3. IP Whitelist: Adicionar IP do servidor Hetzner (178.63.41.108)
4. Importante: **Guarde o API Secret imediatamente** - só é mostrado 1 vez

**Sandbox para Testes:**
- URL: `https://api-sandbox-futures.kucoin.com`
- Criar conta separada em sandbox: [sandbox-futures.kucoin.com](https://sandbox-futures.kucoin.com)
- Definir `KUCOIN_SANDBOX_MODE=true` para usar sandbox

**Endpoints Implementados (integrations-service):**
- `/api/integrations/trading/status` - Status do serviço
- `/api/integrations/trading/market/:symbol` - Dados de mercado
- `/api/integrations/trading/account` - Saldo da conta
- `/api/integrations/trading/orders` - Gerenciamento de ordens
- `/api/integrations/trading/signals` - Sinais do Qwen2.5-VL LLM

### FASE 5c: Qdrant - Banco Vetorial para Texto (Gate 2: 1024 dimensões)

| Secret | Onde Obter |
|--------|------------|
| `QDRANT_API_KEY` | Gerar com `openssl rand -hex 32` |

**Configuração:**
1. Gerar API Key: `openssl rand -hex 32`
2. Adicionar como GitHub Secret: `QDRANT_API_KEY`
3. O container `alice-qdrant` usa esta key para autenticação

**Arquitetura de Embeddings:**
- **Qdrant (1024 dim):** Qwen3-Embedding-0.6B para texto (Trading + RAG)
- **PostgreSQL pgvector (1024 dim):** OpenCLIP ViT-H/14 para imagens

**Por que Qdrant para Trading/RAG:**
- Banco vetorial dedicado (HNSW, filtros/metadata, escalabilidade e isolamento operacional)
- Mantém pgvector focado em embeddings de imagem (OpenCLIP) e queries relacionais
- Gate 2 padroniza embeddings de texto em **1024 dim** (Qwen3-Embedding-0.6B), mantendo SSOT entre código e docs

**Portas:**
- `6333`: REST API (usada pelo integrations-service)
- `6334`: gRPC (não exposta externamente)

### FASE 6: Comunicação (WhatsApp/SMS/Email)

**Twilio:**

| Secret | Onde Obter |
|--------|------------|
| `TWILIO_ACCOUNT_SID` | [console.twilio.com](https://console.twilio.com) |
| `TWILIO_AUTH_TOKEN` | console.twilio.com |
| `TWILIO_WHATSAPP_NUMBER` | console.twilio.com/whatsapp |

**Configuração de Webhook:**
1. Messaging → Settings → WhatsApp sandbox settings
2. When a message comes in: `https://yesyoudeserve.duckdns.org/api/integrations/twilio/webhook/whatsapp`
3. Status callback URL: `https://yesyoudeserve.duckdns.org/api/integrations/twilio/webhook/status`

**Gmail SMTP (Grafana Alerting - Emails de Alerta):**

> **NOTA 01/01/2026**: Alertmanager foi removido. Grafana Alerting agora gerencia todas as notificações.

| Secret | Onde Obter |
|--------|------------|
| `GMAIL_USER` | Seu email Gmail completo (ex: seuemail@gmail.com) |
| `GMAIL_APP_PASSWORD` | [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) |

**Configuração Gmail App Password:**
1. Acesse [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
2. Selecione app "Mail" e dispositivo "Other (Custom name)"
3. Digite um nome (ex: "Alice Grafana Alerting")
4. Copie a senha de 16 caracteres gerada (sem espaços)
5. Adicione como secret `GMAIL_APP_PASSWORD`

**Vantagens Gmail SMTP vs Resend:**
- ✅ Pode enviar para QUALQUER email (clientes, equipe, vendas)
- ✅ 500 emails/dia (conta pessoal) ou 2000/dia (Google Workspace)
- ✅ Remetente é seu próprio email (profissional)
- ✅ Gratuito e sem necessidade de verificar domínio

**Importante - Grafana Alerting usa Gmail SMTP (01/01/2026):**
- Host: `smtp.gmail.com:587` (via `GF_SMTP_HOST`)
- Username: `GMAIL_USER` (via `GF_SMTP_USER`)
- Password: `GMAIL_APP_PASSWORD` (via `GF_SMTP_PASSWORD`)
- TLS obrigatório (`GF_SMTP_STARTTLS_POLICY: MandatoryStartTLS`)

### FASE 6.1: CORS (origens frontend) — OBRIGATÓRIO EM PRODUÇÃO

| Secret | Valor Esperado | Descrição |
|--------|----------------|-----------|
| `CORS_ORIGIN` | `https://yesyoudeserve.duckdns.org` (ou domínio final) | Origin principal usado pelo `auth-service` |
| `CORS_ORIGINS` | Lista separada por vírgula, sem espaços. Ex: `https://yesyoudeserve.duckdns.org,https://admin.yesyoudeserve.duckdns.org` | Usado por chat, integrations, rag, training, observability |
| `WEBSOCKET_ALLOWED_ORIGINS` | Lista separada por vírgula, alinhada ao CORS | Necessário para handshake WebSocket do chat-service |

> Defina pelo menos um dos dois. Se apenas `CORS_ORIGINS` estiver setado, o workflow derivará `CORS_ORIGIN` a partir do primeiro item.

### FASE 7: ERPNext (CRM/ERP)

**🔴 OBRIGATÓRIOS para Deploy** (deploy FALHA sem eles):

| Secret | Descrição | Como Obter |
|--------|-----------|------------|
| `ERPNEXT_MYSQL_ROOT_PASSWORD` | Senha root MariaDB | `openssl rand -base64 24` |
| `ERPNEXT_DB_PASSWORD` | Senha usuário ERPNext no DB | `openssl rand -base64 24` |
| `ERPNEXT_ADMIN_PASSWORD` | Senha admin do site ERPNext | `openssl rand -base64 24` |
| `REDIS_CACHE_PASSWORD` | Senha Redis Cache (ACL) | `openssl rand -hex 32` ⚠️ **OBRIGATÓRIO HEX** |
| `REDIS_QUEUE_PASSWORD` | Senha Redis Queue (ACL) | `openssl rand -hex 32` ⚠️ **OBRIGATÓRIO HEX** |

**⚠️ IMPORTANTE - Senhas Redis (Atualizado 22/12/2025):**
- As senhas Redis **DEVEM** ser geradas com `openssl rand -hex 32` (hexadecimal)
- **NÃO USE** `openssl rand -base64` para senhas Redis!
- Motivo: Base64 produz caracteres `+`, `/`, `=` que quebram URLs Redis
- Erro típico: `ValueError: Port could not be cast to integer value`
- Hexadecimal (0-9, a-f) é 100% URL-safe

**🟢 OPCIONAIS** (podem ser configurados após ERPNext rodando):

| Secret | Descrição | Como Obter |
|--------|-----------|------------|
| `ERPNEXT_API_KEY` | API Key para integrations-service | ERPNext → User → API Access → Generate Keys |
| `ERPNEXT_API_SECRET` | API Secret para integrations-service | Gerado junto com API Key |

**Nota:** Os secrets obrigatórios usam `:?` no docker-compose (required). Os opcionais usam `:-` (fallback vazio).

### FASE 8: Observabilidade (Métricas LLM)

| Secret | Descrição | Como Obter |
|--------|-----------|------------|
| `LANGFUSE_SECRET_KEY` | Chave secreta Langfuse | `openssl rand -hex 32` com prefixo `sk-lf-` |
| `LANGFUSE_NEXT_AUTH_SECRET` | Chave de autenticação | `openssl rand -hex 32` |
| `LANGFUSE_SALT` | **OBRIGATÓRIO v3** - Salt para hashing | `openssl rand -base64 16` |
| `LANGFUSE_ENCRYPTION_KEY` | **OBRIGATÓRIO v3** - Chave 256-bit hex | `openssl rand -hex 32` |
| `GRAFANA_ADMIN_USER` | Usuário admin Grafana 12 (obrigatório) | Ex: admin, email, ou username customizado |
| `GRAFANA_ADMIN_PASSWORD` | Senha admin Grafana 12 (obrigatório, mín. 8 chars recomendado) | Senha forte e exclusiva |
| `GMAIL_USER` | **Email Gmail** para SMTP do Grafana Alerting | Ex: seuemail@gmail.com |
| `GMAIL_APP_PASSWORD` | **App Password do Gmail** (16 caracteres) | [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) |

**⚠️ IMPORTANTE - Langfuse v3 + ClickHouse (Atualizado 19/12/2025):**
- Langfuse foi atualizado para v3.140.0 que requer novas variáveis obrigatórias:
  - `LANGFUSE_SALT`: String aleatória para hashing (gerar com `openssl rand -base64 16`)
  - `LANGFUSE_ENCRYPTION_KEY`: Chave 256-bit hex (gerar com `openssl rand -hex 32`)
- Nova arquitetura v3 inclui container `langfuse-worker` para processamento assíncrono
- **ClickHouse 25.12** é backend OLAP obrigatório para Langfuse v3:
  - `CLICKHOUSE_USER`: Usuário do ClickHouse (ex: `langfuse`)
  - `CLICKHOUSE_PASSWORD`: Senha segura (gerar com `openssl rand -base64 32`)

**Observação sobre Grafana Alerting + Gmail SMTP (Atualizado 01/01/2026):**
- Alertmanager foi **removido** em 01/01/2026
- **Grafana Alerting** agora gerencia alertas via Gmail SMTP (`smtp.gmail.com:587`)
- Configuração via variáveis `GF_SMTP_*` no docker-compose.prod.yml
- Contact Points e Notification Policies configuráveis via UI do Grafana
- Pode enviar para **qualquer email** (clientes, equipe, vendas)
- O arquivo de senha é montado em `/run/secrets/smtp_password` no container

**Observação:** Langfuse usa PostgreSQL dedicado na porta 5433 (separado do banco principal).

### FASE 8b: MinIO - Object Storage (S3 para Langfuse v3)

| Secret | Descrição | Como Obter |
|--------|-----------|------------|
| `MINIO_ROOT_PASSWORD` | **OBRIGATÓRIO** - Senha do MinIO (S3 para Langfuse v3) | `openssl rand -base64 32` |

**Configuração:**
1. Gerar senha segura: `openssl rand -base64 32`
2. Adicionar no GitHub Secrets como `MINIO_ROOT_PASSWORD`
3. **Importante:** Usar caracteres URL-safe (evitar `+`, `/`, `=` se possível)
4. Mínimo: 8 caracteres (recomendado: 32+)

**Arquitetura (01/01/2026):**
- MinIO é **OBRIGATÓRIO** para Langfuse v3 (armazenamento S3 de eventos)
- Roda como container `alice-minio` na porta 9000 (API) e 9001 (Console)
- Container `alice-minio-init` cria bucket `langfuse-events` automaticamente
- Langfuse Web e Worker dependem do MinIO estar healthy antes de iniciar

**Troubleshooting:**
```bash
# Verificar status do MinIO
docker logs alice-minio --tail 100

# Verificar se bucket foi criado
docker logs alice-minio-init --tail 50

# Acessar console MinIO (apenas rede interna)
# URL: http://localhost:9001 (via port-forward se necessário)
```

### FASE 9: Backup (pgBackRest)

| Secret | Descrição | Requisitos | Como Obter |
|--------|-----------|------------|------------|
| `BACKUP_CIPHER_PASS` | Senha para criptografia AES-256-CBC dos backups | **OBRIGATÓRIO**, mínimo 32 caracteres | `openssl rand -hex 32` (gera 64 chars) |
| `PGBACKREST_STANZA` | (Opcional) Override da stanza; default: `alice_prod` | Definir somente se for usar stanza diferente | Manual |

**Uso:** Criptografa repositório de backups do PostgreSQL via pgBackRest. Obrigatório para PITR (Point-in-Time Recovery) seguro.

**IMPORTANTE (02/01/2026):** O deploy **FALHARÁ** se `BACKUP_CIPHER_PASS` não estiver configurado ou tiver menos de 32 caracteres. A validação acontece em 3 pontos:
1. `generate-env-prod.sh` - validação fail-fast antes de gerar `.env.prod`
2. Workflow runner - validação do `.env.prod` gerado
3. Servidor Hetzner - validação após transferência SCP

### FASE 10: Web Search (SearXNG)
| Secret | Descrição | Como Obter |
|--------|-----------|------------|
| `SEARXNG_SECRET_KEY` | Chave secreta da instância SearXNG (protege endpoints internos) | `openssl rand -hex 64` e adicionar no GitHub Secrets |

### Domínio e SSL

| Secret | Descrição |
|--------|-----------|
| `ACME_EMAIL` | Email para certificados Let's Encrypt |

---

## 🗑️ Secrets Obsoletos - REMOVIDOS (26/12/2025)

**ARQUITETURA GPU DEDICADA 24/7:** Todos os serviços GPU rodam no servidor Hetzner GEX44 dedicado. Os seguintes secrets já foram **removidos do GitHub Secrets** (não são mais necessários):

| Secret | Status | Como Remover |
|--------|--------|--------------|
| `SALAD_API_KEY` | ❌ **REMOVER** | GitHub → Settings → Secrets → Delete |
| `SALAD_ORGANIZATION_ID` | ❌ **REMOVER** | GitHub → Settings → Secrets → Delete |
| `SALAD_PROJECT_ID` | ❌ **REMOVER** | GitHub → Settings → Secrets → Delete |
| `SALAD_API_URL` | ❌ **REMOVER** | GitHub → Settings → Secrets → Delete |
| `SALAD_WHISPER_URL` | ❌ **REMOVER** | GitHub → Settings → Secrets → Delete |
| `SALAD_ASR_URL` | ❌ **REMOVER** | GitHub → Settings → Secrets → Delete |

> **NOTA v4.0.0:** SALAD_MIXTRAL_URL e SALAD_FLUX_URL foram REMOVIDOS - agora usamos GPU local com Qwen2.5-VL (sem geração de imagens).
| `SALAD_EMBEDDINGS_URL` | ❌ **REMOVER** | GitHub → Settings → Secrets → Delete |
| `SALAD_MEDIA_PROJECT` | ❌ **REMOVER** | GitHub → Settings → Secrets → Delete |
| `SALAD_GPU_CLASS` | ❌ **REMOVER** | GitHub → Settings → Secrets → Delete |
| `EMBEDDINGS_GPU_URL` | ❌ **REMOVER** | Remover completamente - tem fallback para URL interna (`http://gpu-embeddings:8000` ou `http://localhost:8001`) |

> **NOTA (26/12/2025):** Todos estes secrets foram removidos. GPU Manager Service (Hetzner GEX44) usa comunicação interna via rede Docker, sem necessidade de secrets externos.

---

## Checklist de Verificação

> **Status atualizado em:** 20 de Dezembro de 2025  
> **Resumo:** 54 secrets de produção ✅ configurados no repositório. Pendentes opcionais pós-deploy: `ERPNEXT_API_KEY`, `ERPNEXT_API_SECRET`, `WISE_WEBHOOK_SECRET`.

### Infraestrutura

| Secret | Status |
|--------|--------|
| `HETZNER_VM_HOST` | ✅ |
| `HETZNER_VM_USER` | ✅ |
| `HETZNER_SSH_PRIVATE_KEY` | ✅ |
| `GH_PAT` | ✅ |
| `POSTGRES_PASSWORD` | ✅ |
| `REDIS_PASSWORD` | ✅ |
| `SESSION_SECRET` | ✅ |
| `INTERNAL_API_SECRET` | ✅ |

### Docker Hub (Rate Limit)

| Secret | Status |
|--------|--------|
| `DOCKERHUB_USERNAME` | ✅ (adicionado 20/12/2025) |
| `DOCKERHUB_TOKEN` | ✅ (adicionado 20/12/2025) |

### OAuth (pelo menos 1)

| Secret | Status |
|--------|--------|
| `GOOGLE_CLIENT_ID` | ✅ |
| `GOOGLE_CLIENT_SECRET` | ✅ |
| `OAUTH_GITHUB_CLIENT_ID` | ✅ |
| `OAUTH_GITHUB_CLIENT_SECRET` | ✅ |

### GPU Manager Service (Hetzner GPU GEX44)

| Secret | Status | Obrigatório? |
|--------|--------|--------------|
| `HUGGINGFACE_TOKEN` | ✅ | ✅ **SIM** (obrigatório para downloads de modelos - Qwen2.5-VL, Qwen3-Embedding, OpenCLIP, Canary) |

> **NOTA (26/12/2025):** GPU dedicada Hetzner GEX44 (24/7) - containers Docker rodam continuamente. URLs dos serviços GPU são internas via rede Docker e não precisam de secrets.

### Stripe (Pagamentos)

| Secret | Status |
|--------|--------|
| `STRIPE_SECRET_KEY` | ✅ |
| `STRIPE_PUBLISHABLE_KEY` | ✅ |
| `STRIPE_WEBHOOK_SECRET` | ✅ |
| `STRIPE_WEBHOOK_BASE_URL` | ⏳ Opcional (hoje ausente; fallback `https://yesyoudeserve.duckdns.org`) |

### Wise (Transferências)

| Secret | Status |
|--------|--------|
| `WISE_API_KEY` | ✅ |
| `WISE_PROFILE_ID` | ✅ |
| `WISE_WEBHOOK_SECRET` | ⏳ Opcional (gerar após configurar webhook no Wise Dashboard) |
| `WISE_SANDBOX` | ⏳ Opcional (default aplicado: `false`) |

### KuCoin Futures (Trading BTC)

| Secret | Status |
|--------|--------|
| `KUCOIN_PRO_API_KEY` | ✅ |
| `KUCOIN_PRO_API_SECRET` | ✅ |
| `KUCOIN_PRO_API_PASSPHRASE` | ✅ |
| `KUCOIN_PRO_BASE_URL` | ✅ |
| `KUCOIN_SANDBOX_MODE` | ⏳ Opcional (default: `false`) |

### Comunicação

| Secret | Status |
|--------|--------|
| `TWILIO_ACCOUNT_SID` | ✅ |
| `TWILIO_AUTH_TOKEN` | ✅ |
| `TWILIO_WHATSAPP_NUMBER` | ✅ |
| `GMAIL_USER` | ✅ (adicionado 30/12/2025) |
| `GMAIL_APP_PASSWORD` | ✅ (adicionado 30/12/2025) |

### CORS (Origens Frontend) — OBRIGATÓRIO

| Secret | Status |
|--------|--------|
| `CORS_ORIGINS` | ✅ (criado em 10/12/2025) |

### ERPNext

| Secret | Status | Obrigatório |
|--------|--------|-------------|
| `ERPNEXT_MYSQL_ROOT_PASSWORD` | ✅ | 🔴 Sim |
| `ERPNEXT_DB_PASSWORD` | ✅ | 🔴 Sim |
| `ERPNEXT_ADMIN_PASSWORD` | ✅ | 🔴 Sim |
| `REDIS_CACHE_PASSWORD` | ✅ | 🔴 Sim |
| `REDIS_QUEUE_PASSWORD` | ✅ | 🔴 Sim |
| `ERPNEXT_API_KEY` | ⏳ (gerar após deploy via ERPNext) | 🟢 Não |
| `ERPNEXT_API_SECRET` | ⏳ (gerar após deploy via ERPNext) | 🟢 Não |

### Observabilidade

| Secret | Status |
|--------|--------|
| `LANGFUSE_SECRET_KEY` | ✅ |
| `LANGFUSE_NEXT_AUTH_SECRET` | ✅ |
| `LANGFUSE_SALT` | ✅ **OBRIGATÓRIO v3** |
| `LANGFUSE_ENCRYPTION_KEY` | ✅ **OBRIGATÓRIO v3** |
| `GMAIL_USER` | ✅ (email Gmail para SMTP do Grafana Alerting) |
| `GMAIL_APP_PASSWORD` | ✅ (App Password 16 chars) |
| `LANGFUSE_DB_USER` | ✅ |
| `LANGFUSE_DB_PASSWORD` | ✅ **NÃO use caracteres especiais** (`@:/?#%[]`) - libpq não suporta encoding automático em connection strings. Workflow valida e rejeita (fail-fast) |
| `LANGFUSE_DB_NAME` | ✅ |
| `GRAFANA_ADMIN_USER` | ✅ |
| `GRAFANA_ADMIN_PASSWORD` | ✅ |
| `ACME_EMAIL` | ✅ |

### ClickHouse (Langfuse v3 OLAP Backend)

| Secret | Status |
|--------|--------|
| `CLICKHOUSE_USER` | ✅ **OBRIGATÓRIO Langfuse v3** (adicionado 19/12/2025) |
| `CLICKHOUSE_PASSWORD` | ✅ **OBRIGATÓRIO Langfuse v3** (adicionado 19/12/2025) |
| `MINIO_ROOT_PASSWORD` | ✅ **OBRIGATÓRIO Langfuse v3** (adicionado 01/01/2026) |

### Web Search (SearXNG)

| Secret | Status |
|--------|--------|
| `SEARXNG_SECRET_KEY` | ✅ |

### Backup (pgBackRest)

| Secret | Status |
|--------|--------|
| `BACKUP_CIPHER_PASS` | ✅ |

### Qdrant (Banco Vetorial Texto 1024 dim - Gate 2)

| Secret | Status |
|--------|--------|
| `QDRANT_API_KEY` | ✅ |

---

## URLs de Callback e Webhook

### OAuth Callbacks

| Provedor | URL de Callback |
|----------|-----------------|
| Google | `https://yesyoudeserve.duckdns.org/api/auth/callback/google` |
| GitHub | `https://yesyoudeserve.duckdns.org/api/auth/callback/github` |

### Webhooks

| Provedor | URL do Webhook |
|----------|----------------|
| Stripe | `https://yesyoudeserve.duckdns.org/webhook/stripe` |
| Twilio WhatsApp | `https://yesyoudeserve.duckdns.org/api/integrations/twilio/webhook/whatsapp` |
| Twilio Status | `https://yesyoudeserve.duckdns.org/api/integrations/twilio/webhook/status` |
| Wise | `https://yesyoudeserve.duckdns.org/api/integrations/wise/webhook` |

---

## Como Adicionar Secrets no GitHub

1. Acesse o repositório → **Settings**
2. Menu lateral → **Secrets and variables** → **Actions**
3. Para **adicionar novo:** Clique **"New repository secret"**
4. Para **atualizar:** Clique no secret → **"Update"**
5. Digite/atualize o valor
6. Clique **"Add secret"** ou **"Update secret"**

---

## Geradores de Senhas Seguras

```bash
# Senha 64 caracteres hexadecimais (RECOMENDADO - URL-safe)
# Use para: REDIS_PASSWORD, REDIS_CACHE_PASSWORD, REDIS_QUEUE_PASSWORD
openssl rand -hex 32

# Senha 128 caracteres hexadecimais (para secrets longos)
openssl rand -hex 64

# Senha base64 (24 caracteres) - para secrets que NÃO são usados em URLs
# NÃO use para senhas Redis! Base64 produz +, /, = que quebram URLs
openssl rand -base64 24
```

**⚠️ Regra de Ouro para Senhas Redis:**
- Sempre use `openssl rand -hex 32` para senhas que serão usadas em URLs
- Hexadecimal (0-9, a-f) é 100% URL-safe
- Base64 (+, /, =) causa `ValueError: Port could not be cast to integer value`

---

## Segurança - Boas Práticas

- ✅ Secrets criptografados em repouso no GitHub
- ✅ Valores mascarados automaticamente nos logs do CI/CD
- ✅ Arquivo `.env.prod` gerado automaticamente e NUNCA commitado
- ✅ Sempre use HTTPS para webhooks
- ✅ Valide assinaturas de webhook (Stripe, Twilio)
- ✅ Rotacione chaves periodicamente
- ✅ Use secrets diferentes para dev e prod

---

## Suporte dos Provedores

| Provedor | Documentação |
|----------|--------------|
| Stripe | https://stripe.com/docs/webhooks |
| Google OAuth | https://developers.google.com/identity/protocols/oauth2 |
| GitHub OAuth | https://docs.github.com/en/developers/apps/building-oauth-apps |
| Twilio | https://www.twilio.com/docs/usage/webhooks |
| Gmail SMTP | https://support.google.com/accounts/answer/185833 |
| Wise | https://docs.wise.com/ |
| GPU Manager Service | Local (Hetzner GEX44) |

---

*Autor: Fillipe Guerra*  
*Documento atualizado em: 30 de Dezembro de 2025*
*Versão: 9.0 - Gmail SMTP Enterprise (Resend removido)*
*Total de Secrets: ~50 no GitHub + opcionais pós-deploy (ERPNEXT_API_KEY, ERPNEXT_API_SECRET, WISE_WEBHOOK_SECRET)*  
*Total de Containers: 51 (8 infra + 7 Alice + 15 ERPNext + 14 observability + 6 GPU + 1 backup)*  
*Backup: Servidor GEX44 1.92TB interno (/opt/alice/backups)*  
*Redis Alice: Container dedicado para cache distribuído (segregação enterprise)*  
*GPU Manager Service (25/12/2025): Todos os serviços GPU migrados para Hetzner GPU GEX44 - GPU Manager Service gerencia requisições localmente*  
*Arquitetura Deploy (27/12/2025): Deploy Server (CPX32 - 4 vCPU, 8GB RAM) com Runner Enterprise Hardening + Production Server (GEX44 GPU) - isolamento completo CI/CD e produção*  
*ARQUITETURA ENTERPRISE (Gate 2): Qwen3-Embedding-0.6B (1024 dim → Qdrant) | OpenCLIP (1024 dim → pgvector)*
*GPU Dedicada 24/7 (26/12/2025): Servidor Hetzner GEX44 - todos os secrets do Salad Cloud removidos permanentemente*  
*Secrets PRODUCTION_SERVER_* removidos (28/12/2025): Scripts deploy-remote.sh e deploy-local.sh foram removidos. Workflow usa HETZNER_VM_* diretamente via appleboy/ssh-action.*  
*LANGFUSE v3: LANGFUSE_SALT e LANGFUSE_ENCRYPTION_KEY obrigatórios + langfuse-worker container*
*Docker Hub (20/12/2025): DOCKERHUB_USERNAME e DOCKERHUB_TOKEN adicionados - evita rate limit 100 pulls/6h anônimo*
