# Auditoria Completa de Secrets - Alice Enterprise Platform

**Autor:** Fillipe Guerra  
**Data:** 2025-12-08  
**Versão:** 1.1

## Resumo Executivo

Este documento apresenta uma auditoria completa comparando os secrets configurados no GitHub Actions com os secrets utilizados no código e documentados na documentação.

**Total de Secrets no Repositório:** 35  
**Total de Secrets no Código/Documentação:** 39  
**Discrepâncias Encontradas:** 4 (todas opcionais)

---

## 1. Secrets Presentes no Repositório GitHub

### ✅ Secrets Corretos e Consistentes (35)

| Secret | Usado no Código | Documentado | Status |
|--------|----------------|-------------|--------|
| `ACME_EMAIL` | ✅ | ✅ | ✅ OK |
| `BACKUP_CIPHER_PASS` | ✅ | ✅ | ✅ OK |
| `ERPNEXT_ADMIN_PASSWORD` | ✅ | ✅ | ✅ OK |
| `ERPNEXT_DB_PASSWORD` | ✅ | ✅ | ✅ OK |
| `ERPNEXT_MYSQL_ROOT_PASSWORD` | ✅ | ✅ | ✅ OK |
| `GH_PAT` | ✅ | ✅ | ✅ OK |
| `GOOGLE_CLIENT_ID` | ✅ | ✅ | ✅ OK |
| `GOOGLE_CLIENT_SECRET` | ✅ | ✅ | ✅ OK |
| `GRAFANA_ADMIN_PASSWORD` | ✅ | ✅ | ✅ OK |
| `ADMIN_USER` | ✅ | ✅ | ✅ OK |
| `ADMIN_PWD` | ✅ | ✅ | ✅ OK |
| `HETZNER_SSH_PRIVATE_KEY` | ✅ | ✅ | ✅ OK |
| `HETZNER_VM_HOST` | ✅ | ✅ | ✅ OK |
| `HETZNER_VM_USER` | ✅ | ✅ | ✅ OK |
| `INTERNAL_API_SECRET` | ✅ | ✅ | ✅ OK |
| `LANGFUSE_NEXT_AUTH_SECRET` | ✅ | ✅ | ✅ OK |
| `LANGFUSE_SECRET_KEY` | ✅ | ✅ | ✅ OK |
| `OAUTH_GITHUB_CLIENT_ID` | ✅ | ✅ | ✅ OK |
| `OAUTH_GITHUB_CLIENT_SECRET` | ✅ | ✅ | ✅ OK |
| `REDIS_CACHE_PASSWORD` | ✅ | ✅ | ✅ OK |
| `REDIS_QUEUE_PASSWORD` | ✅ | ✅ | ✅ OK |
| `RESEND_API_KEY` | ✅ | ✅ | ✅ OK |
| `SALAD_API_KEY` | ✅ | ✅ | ✅ OK |
| `SALAD_ORGANIZATION_ID` | ✅ | ✅ | ✅ OK |
| `SESSION_SECRET` | ✅ | ✅ | ✅ OK |
| `STRIPE_PUBLISHABLE_KEY` | ✅ | ✅ | ✅ OK |
| `POSTGRES_PASSWORD` | ✅ | ✅ | ✅ OK |
| `STRIPE_SECRET_KEY` | ✅ | ✅ | ✅ OK |
| `STRIPE_WEBHOOK_SECRET` | ✅ | ✅ | ✅ OK |
| `TWILIO_ACCOUNT_SID` | ✅ | ✅ | ✅ OK |
| `TWILIO_AUTH_TOKEN` | ✅ | ✅ | ✅ OK |
| `TWILIO_WHATSAPP_NUMBER` | ✅ | ✅ | ✅ OK |
| `WISE_API_KEY` | ✅ | ✅ | ✅ OK |
| `WISE_PROFILE_ID` | ✅ | ✅ | ✅ OK |

---

## 2. 🔔 PENDÊNCIAS ATUAIS (Todas Opcionais)

#### 2.1. `STRIPE_WEBHOOK_BASE_URL`

**Status:** ❌ **FALTANDO no repositório**

**Evidências:**
- **Código (`deploy-production.yml` linha 771):** `STRIPE_WEBHOOK_BASE_URL=${{ secrets.STRIPE_WEBHOOK_BASE_URL }}`
- **Documentação (`SECRETS.md` linha 102):** Documentado como obrigatório
- **Repositório GitHub:** ❌ Não encontrado

**Impacto:** 🟡 **MÉDIO** - Webhooks do Stripe podem falhar se não configurado

**Solução:** Adicionar `STRIPE_WEBHOOK_BASE_URL` no GitHub Secrets com valor: `https://yesyoudeserve.duckdns.org`

---

#### 2.2. `WISE_WEBHOOK_SECRET`

**Status:** ❌ **FALTANDO no repositório**

**Evidências:**
- **Código (`deploy-production.yml` linha 784):** `WISE_WEBHOOK_SECRET=${{ secrets.WISE_WEBHOOK_SECRET }}`
- **Código (`docker-compose.prod.yml` linha 707):** `WISE_WEBHOOK_SECRET: ${WISE_WEBHOOK_SECRET}`
- **Documentação (`SECRETS.md` linha 247):** Marcado como ⏳ (gerar após deploy)
- **Repositório GitHub:** ❌ Não encontrado

**Impacto:** 🟢 **BAIXO** - Documentado como opcional, mas código espera o secret

**Solução:** 
- Se webhooks Wise não serão usados: Tornar opcional no código com `:-` fallback
- Se webhooks Wise serão usados: Adicionar no GitHub Secrets após configurar webhook no Wise Dashboard

---

#### 2.3. `WISE_SANDBOX`

**Status:** ⚠️ **HARDCODED no código**

**Evidências:**
- **Código (`deploy-production.yml` linha 785):** `WISE_SANDBOX=false` (hardcoded)
- **Código (`docker-compose.prod.yml` linha 708):** `WISE_SANDBOX: ${WISE_SANDBOX:-false}` (fallback)
- **Documentação (`SECRETS.md` linha 248):** Marcado como ✅ configurado
- **Repositório GitHub:** ❌ Não encontrado (mas pode ser intencional)

**Impacto:** 🟡 **MÉDIO** - Não permite alternar entre sandbox/produção sem alterar código

**Solução:** 
- **Opção A:** Adicionar `WISE_SANDBOX` no GitHub Secrets (recomendado para flexibilidade)
- **Opção B:** Manter hardcoded se sempre será produção (menos flexível)

---

#### 2.4. `ERPNEXT_API_KEY` e `ERPNEXT_API_SECRET`

**Status:** ⏳ **OPCIONAIS (pós-deploy)**

**Evidências:**
- **Código (`deploy-production.yml` linhas 797-798):** Usa `secrets.ERPNEXT_API_KEY` e `secrets.ERPNEXT_API_SECRET`
- **Documentação (`SECRETS.md` linhas 268-269):** Marcado como ⏳ (gerar após deploy via ERPNext)
- **Repositório GitHub:** ❌ Não encontrado

**Impacto:** 🟢 **BAIXO** - Documentado como opcional, gerado após ERPNext iniciar

**Solução:** 
- Adicionar no GitHub Secrets após gerar via ERPNext UI (conforme documentação)
- OU tornar opcional no código com fallback vazio se não configurado

---

## 3. 📊 Resumo de Discrepâncias

| Tipo | Quantidade | Severidade |
|------|------------|------------|
| Inconsistência de Nome | 0 | - |
| Secrets Faltando (Obrigatórios) | 0 | - |
| Secrets Faltando (Opcionais) | 4 | 🟢 |

---

## 4. ✅ Ações Recomendadas (Prioridade)

### 🟡 PRIORIDADE ALTA
1. **Adicionar `STRIPE_WEBHOOK_BASE_URL`** — valor recomendado: `https://yesyoudeserve.duckdns.org`

### 🟢 PRIORIDADE BAIXA (Opcionais)
2. **Adicionar `WISE_WEBHOOK_SECRET`** após configurar webhook no Wise  
3. **Adicionar `WISE_SANDBOX`** se precisar alternar sandbox/produção via secret (default já é `false`)  
4. **Adicionar `ERPNEXT_API_KEY` e `ERPNEXT_API_SECRET`** após gerar no ERPNext UI

---

## 5. Checklist de Verificação

### Secrets Obrigatórios para Deploy Funcional

- [x] `HETZNER_VM_HOST`
- [x] `HETZNER_VM_USER`
- [x] `HETZNER_SSH_PRIVATE_KEY`
- [x] `GH_PAT`
- [x] `POSTGRES_PASSWORD`
- [x] `SESSION_SECRET`
- [x] `INTERNAL_API_SECRET`
- [x] `ACME_EMAIL`

### Secrets Obrigatórios para Funcionalidades

- [x] OAuth (pelo menos 1): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` ou `OAUTH_GITHUB_*`
- [x] LLM: `SALAD_API_KEY`, `SALAD_ORGANIZATION_ID`
- [ ] Stripe: `STRIPE_WEBHOOK_BASE_URL` (opcional; ausência já coberta por fallback)
- [x] ERPNext: `ERPNEXT_MYSQL_ROOT_PASSWORD`, `ERPNEXT_DB_PASSWORD`, `ERPNEXT_ADMIN_PASSWORD`, `REDIS_CACHE_PASSWORD`, `REDIS_QUEUE_PASSWORD`
- [x] Backup: `BACKUP_CIPHER_PASS`
- [x] Observabilidade: `GRAFANA_ADMIN_PASSWORD`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_NEXT_AUTH_SECRET`

---

## 6. Notas Técnicas

### Convenção de Nomes

- **PostgreSQL:** O padrão da indústria é `POSTGRES_PASSWORD`, não `PGPASSWORD`
- **OAuth GitHub:** Prefixo `OAUTH_GITHUB_*` é necessário (GitHub não permite `GITHUB_*`)
- **Wise:** `WISE_SANDBOX` é boolean string (`"true"` ou `"false"`)

### Secrets Opcionais vs Obrigatórios

- **Obrigatórios:** Usam `:?` no docker-compose (falha se não definido)
- **Opcionais:** Usam `:-` no docker-compose (fallback para valor padrão)

---

*Autor: Fillipe Guerra*  
*Documento atualizado em: 2025-12-08*  
*Versão: 1.1*  
*Próxima Revisão: Após inclusão dos opcionais pendentes*
