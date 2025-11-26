# Guia Completo de Configuração de Secrets

## Alice Enterprise Platform - Deploy para Hetzner Cloud

Este guia explica **TODOS** os secrets necessários e **ONDE** configurar cada um.

---

## Visão Geral

| Local de Configuração | O que vai lá |
|----------------------|--------------|
| **GitHub Secrets** | Secrets usados pelo CI/CD durante o deploy |
| **Hetzner .env.prod** | Criado automaticamente pelo CI/CD a partir dos GitHub Secrets |
| **Replit Secrets** | Apenas para desenvolvimento local (NÃO usado em produção) |

---

## Passo 1: GitHub Secrets (OBRIGATÓRIO)

### Como acessar:
1. Acesse: https://github.com/fillipeguerrabtc/alice/settings/secrets/actions
2. Clique em "New repository secret"
3. Adicione cada secret abaixo

---

### 1.1 Secrets de Infraestrutura (SSH + Registry)

| Secret | Descrição | Como Obter |
|--------|-----------|------------|
| `HETZNER_VM_HOST` | IP do servidor | `46.224.46.93` |
| `HETZNER_VM_USER` | Usuário SSH | `root` |
| `HETZNER_SSH_PRIVATE_KEY` | Chave SSH privada | Ver instruções abaixo |
| `GH_PAT` | GitHub Personal Access Token | Criar em github.com/settings/tokens |

#### Como criar o GH_PAT:
1. Acesse: https://github.com/settings/tokens?type=beta
2. Clique "Generate new token (Fine-grained)"
3. Nome: `alice-deploy`
4. Expiration: 90 days (ou mais)
5. Repository access: "Only select repositories" → selecione `alice`
6. Permissions:
   - **Contents**: Read and write
   - **Packages**: Read and write
   - **Metadata**: Read-only
7. Copie o token gerado e adicione como `GH_PAT` nos GitHub Secrets

---

### 1.2 Secrets do Banco de Dados

| Secret | Descrição | Valor Recomendado |
|--------|-----------|-------------------|
| `POSTGRES_PASSWORD` | Senha do PostgreSQL | Gere uma senha forte (32+ chars) |
| `SESSION_SECRET` | Chave de sessão | Gere uma string aleatória (64+ chars) |

#### Gerar senhas seguras:
```bash
# No terminal (Linux/Mac):
openssl rand -hex 32
```

---

### 1.3 Secrets OAuth (Autenticação)

| Secret | Descrição | Onde Obter |
|--------|-----------|------------|
| `GOOGLE_CLIENT_ID` | OAuth Google | console.cloud.google.com |
| `GOOGLE_CLIENT_SECRET` | OAuth Google | console.cloud.google.com |
| `OAUTH_GITHUB_CLIENT_ID` | OAuth GitHub | github.com/settings/developers |
| `OAUTH_GITHUB_CLIENT_SECRET` | OAuth GitHub | github.com/settings/developers |

#### Configurar Google OAuth:
1. Acesse: https://console.cloud.google.com/apis/credentials
2. Crie um projeto ou use existente
3. Configure "OAuth consent screen"
4. Crie "OAuth 2.0 Client ID" (Web application)
5. Authorized redirect URIs:
   - `https://yesyoudeserve.duckdns.org/api/auth/callback/google`
6. Copie Client ID e Client Secret

#### Configurar GitHub OAuth:
1. Acesse: https://github.com/settings/developers
2. Clique "New OAuth App"
3. Application name: `Alice Enterprise`
4. Homepage URL: `https://yesyoudeserve.duckdns.org`
5. Authorization callback URL: `https://yesyoudeserve.duckdns.org/api/auth/callback/github`
6. Copie Client ID e Client Secret

---

### 1.4 Secrets Salad Cloud (LLM)

| Secret | Descrição | Onde Obter |
|--------|-----------|------------|
| `SALAD_API_KEY` | API Key Salad Cloud | portal.salad.com |
| `SALAD_ORGANIZATION_ID` | Organization ID | portal.salad.com |

#### Configurar Salad Cloud:
1. Acesse: https://portal.salad.com
2. Crie uma conta ou faça login
3. Vá em "API Keys" → "Create API Key"
4. Copie a API Key
5. Organization ID está no URL ou em Settings

---

### 1.5 Secrets Stripe (Pagamentos)

| Secret | Descrição | Onde Obter |
|--------|-----------|------------|
| `STRIPE_SECRET_KEY` | Chave secreta | dashboard.stripe.com/apikeys |
| `STRIPE_PUBLISHABLE_KEY` | Chave pública | dashboard.stripe.com/apikeys |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing | dashboard.stripe.com/webhooks |

#### Configurar Stripe:
1. Acesse: https://dashboard.stripe.com
2. Vá em Developers → API Keys
3. Copie "Secret key" e "Publishable key"
4. Vá em Developers → Webhooks
5. Adicione endpoint: `https://yesyoudeserve.duckdns.org/api/integrations/stripe/webhook`
6. Selecione eventos:
   - `checkout.session.completed`
   - `invoice.paid`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
7. Copie "Signing secret"

---

### 1.6 Secrets Twilio (WhatsApp/SMS) - OPCIONAL

| Secret | Descrição | Onde Obter |
|--------|-----------|------------|
| `TWILIO_ACCOUNT_SID` | Account SID | console.twilio.com |
| `TWILIO_AUTH_TOKEN` | Auth Token | console.twilio.com |
| `TWILIO_WHATSAPP_NUMBER` | Número WhatsApp | console.twilio.com/whatsapp |

---

### 1.7 Secrets Resend (Email) - OPCIONAL

| Secret | Descrição | Onde Obter |
|--------|-----------|------------|
| `RESEND_API_KEY` | API Key | resend.com/api-keys |

---

### 1.8 Secrets ERPNext (roda localmente no Hetzner)

O ERPNext roda no **mesmo servidor Hetzner** e é acessível via:
- **URL:** `https://erp.yesyoudeserve.duckdns.org`

#### ERPNext Database (OBRIGATÓRIO para ERPNext):
| Secret | Descrição | Valor |
|--------|-----------|-------|
| `ERPNEXT_MYSQL_ROOT_PASSWORD` | Senha root MySQL | Gere senha forte |
| `ERPNEXT_DB_PASSWORD` | Senha do banco ERPNext | Gere senha forte |

#### ERPNext API (para integrations-service sincronizar vendas):
| Secret | Descrição | Valor |
|--------|-----------|-------|
| `ERPNEXT_API_KEY` | API Key | Gerar no ERPNext após primeiro deploy |
| `ERPNEXT_API_SECRET` | API Secret | Gerar no ERPNext após primeiro deploy |

**Nota:** A URL do ERPNext (`https://erp.yesyoudeserve.duckdns.org`) já está configurada automaticamente no workflow. Você só precisa gerar as API Keys após o ERPNext estar rodando.

#### Como gerar API Keys do ERPNext (após primeiro deploy):
1. Acesse: `https://erp.yesyoudeserve.duckdns.org`
2. Faça login como Administrator
3. Vá em: Settings → My Settings → API Access
4. Clique "Generate Keys"
5. Adicione as keys nos GitHub Secrets

---

## Passo 2: Verificar Secrets no GitHub

### Secrets por Prioridade

#### FASE 1: Deploy Mínimo Funcional (OBRIGATÓRIOS)
Estes são necessários para o deploy funcionar:

```
✅ HETZNER_VM_HOST          = 46.224.46.93
✅ HETZNER_VM_USER          = root
✅ HETZNER_SSH_PRIVATE_KEY  = (chave SSH privada completa)
✅ GH_PAT                   = (GitHub Personal Access Token com write:packages)
✅ POSTGRES_PASSWORD        = (senha forte 32+ chars)
✅ SESSION_SECRET           = (string aleatória 64+ chars)
```

#### FASE 2: Autenticação (mínimo 1 provider)
Para usuários fazerem login:

```
⬜ GOOGLE_CLIENT_ID         = (console.cloud.google.com)
⬜ GOOGLE_CLIENT_SECRET     = (console.cloud.google.com)
-- OU --
⬜ OAUTH_GITHUB_CLIENT_ID     = (github.com/settings/developers)
⬜ OAUTH_GITHUB_CLIENT_SECRET = (github.com/settings/developers)
```

#### FASE 3: Chat com IA (para LLM funcionar)
```
⬜ SALAD_API_KEY            = (portal.salad.com)
⬜ SALAD_ORGANIZATION_ID    = (portal.salad.com)
```

#### FASE 4: Pagamentos (para Stripe funcionar)
```
⬜ STRIPE_SECRET_KEY        = (dashboard.stripe.com/apikeys)
⬜ STRIPE_PUBLISHABLE_KEY   = (dashboard.stripe.com/apikeys)
⬜ STRIPE_WEBHOOK_SECRET    = (dashboard.stripe.com/webhooks)
```

#### FASE 5: ERPNext (roda localmente - pode configurar depois)
```
⬜ ERPNEXT_MYSQL_ROOT_PASSWORD = (gere senha forte)
⬜ ERPNEXT_DB_PASSWORD         = (gere senha forte)
⬜ ERPNEXT_API_KEY             = (gerar após ERPNext rodar)
⬜ ERPNEXT_API_SECRET          = (gerar após ERPNext rodar)
```

#### FASE 6: Opcionais (configurar quando precisar)
```
⬜ TWILIO_ACCOUNT_SID       = (WhatsApp/SMS)
⬜ TWILIO_AUTH_TOKEN        = (WhatsApp/SMS)
⬜ TWILIO_WHATSAPP_NUMBER   = (WhatsApp)
⬜ RESEND_API_KEY           = (Email)
```

---

## Passo 3: Após Configurar Secrets

1. **Fazer push do código:**
   ```bash
   git add -A
   git commit -m "fix: usar GH_PAT para git clone no Hetzner"
   git push origin main
   ```

2. **O GitHub Actions vai:**
   - Buildar as imagens Docker
   - Fazer push para GitHub Container Registry
   - Conectar no Hetzner via SSH
   - Criar .env.prod automaticamente com os secrets
   - Fazer deploy com Docker Compose

3. **Verificar deploy:**
   - Acesse: https://github.com/fillipeguerrabtc/alice/actions
   - Aguarde o workflow "Deploy to Production" completar
   - Teste: https://yesyoudeserve.duckdns.org

---

## Troubleshooting

### Erro: "could not read Username for 'https://github.com'"
**Causa:** GH_PAT não configurado ou inválido
**Solução:** Verificar se GH_PAT está nos GitHub Secrets e tem permissões corretas

### Erro: "permission_denied: write_package"
**Causa:** GH_PAT sem permissão de Packages
**Solução:** Recriar GH_PAT com permissão "Packages: Read and write"

### Erro: "Connection refused" no SSH
**Causa:** Chave SSH incorreta
**Solução:** Verificar HETZNER_SSH_PRIVATE_KEY (copiar chave completa incluindo BEGIN/END)

---

## Contato

Se tiver problemas, verifique os logs do GitHub Actions para mensagens de erro específicas.
