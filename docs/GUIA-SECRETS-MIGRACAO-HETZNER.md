# Guia de Migração de Secrets - Hetzner GPU

**Autor:** Fillipe Guerra  
**Data:** 25 de Dezembro de 2025  
**Versão:** 1.0

## 📋 Resumo Executivo

Este guia lista **todos os secrets obsoletos** que devem ser **removidos** do GitHub e **todos os secrets novos** que devem ser **criados** para a nova arquitetura com Deploy Server (CX11) e Production Server (GEX44 GPU).

---

## 🗑️ SECRETS OBSOLETOS - REMOVER DO GITHUB

**ARQUITETURA ATUALIZADA (25/12/2025):** Todos os serviços GPU migraram para Hetzner GPU GEX44. Os seguintes secrets do Salad Cloud devem ser **removidos completamente** do GitHub Secrets.

### Lista Completa de Secrets a Remover:

| # | Secret | Status | Ação |
|---|--------|--------|------|
| 1 | `SALAD_API_KEY` | ❌ **REMOVER** | Delete no GitHub |
| 2 | `SALAD_ORGANIZATION_ID` | ❌ **REMOVER** | Delete no GitHub |
| 3 | `SALAD_PROJECT_ID` | ❌ **REMOVER** | Delete no GitHub |
| 4 | `SALAD_API_URL` | ❌ **REMOVER** | Delete no GitHub |
| 5 | `SALAD_MIXTRAL_URL` | ❌ **REMOVER** | Delete no GitHub |
| 6 | `SALAD_FLUX_URL` | ❌ **REMOVER** | Delete no GitHub |
| 7 | `SALAD_WHISPER_URL` | ❌ **REMOVER** | Delete no GitHub |
| 8 | `SALAD_ASR_URL` | ❌ **REMOVER** | Delete no GitHub |
| 9 | `SALAD_EMBEDDINGS_URL` | ❌ **REMOVER** | Delete no GitHub |
| 10 | `SALAD_MEDIA_PROJECT` | ❌ **REMOVER** | Delete no GitHub |
| 11 | `SALAD_GPU_CLASS` | ❌ **REMOVER** | Delete no GitHub |
| 12 | `EMBEDDINGS_GPU_URL` | ❌ **REMOVER** | Remover completamente - tem fallback para URL interna (`http://gpu-embeddings:8000` ou `http://localhost:8001`) |

**Total:** 12 secrets a remover

### Como Remover:

1. Acesse: `https://github.com/fillipeguerrabtc/alice/settings/secrets/actions`
2. Para cada secret listado acima:
   - Clique no secret
   - Clique em **"Delete"**
   - Confirme a remoção

> **NOTA:** Todos os serviços GPU agora rodam localmente no servidor Hetzner GPU GEX44. Não são necessários secrets externos para GPU.

---

## ✅ SECRETS NOVOS - CRIAR NO GITHUB

**ARQUITETURA ENTERPRISE (25/12/2025):** Nova arquitetura com Deploy Server separado (CX11) e Production Server (GEX44 GPU).

### Para Arquitetura com Deploy Server Separado:

| # | Secret | Valor | Descrição | Obrigatório? |
|---|--------|-------|-----------|--------------|
| 1 | `PRODUCTION_SERVER_HOST` | `178.63.41.108` | IP do Production Server (GPU Server GEX44) | ✅ **SIM** |
| 2 | `PRODUCTION_SERVER_USER` | `alice-deploy` | Usuário SSH dedicado no Production Server | ✅ **SIM** |
| 3 | `PRODUCTION_SERVER_SSH_PRIVATE_KEY` | Chave SSH privada completa | Chave SSH para Deploy Server acessar Production Server (incluir `-----BEGIN...-----END`) | ✅ **SIM** |

**Total:** 3 secrets novos obrigatórios

### Como Adicionar:

1. Acesse: `https://github.com/fillipeguerrabtc/alice/settings/secrets/actions`
2. Clique em **"New repository secret"**
3. Para cada secret acima:
   - **Name:** Nome do secret (ex: `PRODUCTION_SERVER_HOST`)
   - **Secret:** Valor do secret
   - Clique em **"Add secret"**

### Gerar Chave SSH para PRODUCTION_SERVER_SSH_PRIVATE_KEY:

```bash
# No Deploy Server (CX11)
ssh-keygen -t ed25519 -C "alice-deploy-runner" -f ~/.ssh/id_ed25519_prod

# Copiar chave pública para Production Server
ssh-copy-id -i ~/.ssh/id_ed25519_prod.pub alice-deploy@178.63.41.108

# Copiar chave privada completa para GitHub Secret
cat ~/.ssh/id_ed25519_prod
# Copiar TODO o conteúdo (incluindo -----BEGIN e -----END)
```

### ⚠️ Nota sobre HETZNER_VM_* (Legado):

Os secrets `HETZNER_VM_HOST`, `HETZNER_VM_USER` e `HETZNER_SSH_PRIVATE_KEY` são mantidos apenas para **compatibilidade** (fallback SSH se o runner não estiver disponível). Podem ser removidos após validar que o Deploy Server está funcionando corretamente.

---

## 📊 Checklist de Migração

### Fase 1: Remover Secrets Obsoletos

- [ ] Remover `SALAD_API_KEY`
- [ ] Remover `SALAD_ORGANIZATION_ID`
- [ ] Remover `SALAD_PROJECT_ID`
- [ ] Remover `SALAD_API_URL`
- [ ] Remover `SALAD_MIXTRAL_URL`
- [ ] Remover `SALAD_FLUX_URL`
- [ ] Remover `SALAD_WHISPER_URL`
- [ ] Remover `SALAD_ASR_URL`
- [ ] Remover `SALAD_EMBEDDINGS_URL`
- [ ] Remover `SALAD_MEDIA_PROJECT`
- [ ] Remover `SALAD_GPU_CLASS`
- [ ] Remover `EMBEDDINGS_GPU_URL` (tem fallback para URL interna - não precisa de secret)

### Fase 2: Criar Secrets Novos

- [ ] Provisionar Deploy Server (CX11) na Hetzner
- [ ] Provisionar Production Server (GEX44 GPU) na Hetzner
- [ ] Criar usuário `alice-deploy` no Production Server
- [ ] Gerar chave SSH no Deploy Server
- [ ] Copiar chave pública para Production Server
- [ ] Adicionar `PRODUCTION_SERVER_HOST` no GitHub
- [ ] Adicionar `PRODUCTION_SERVER_USER` no GitHub
- [ ] Adicionar `PRODUCTION_SERVER_SSH_PRIVATE_KEY` no GitHub
- [ ] Validar que Deploy Server consegue acessar Production Server via SSH
- [ ] Testar deploy completo

### Fase 3: Validação (Opcional - Remover Legados)

- [ ] Validar que Deploy Server está funcionando corretamente
- [ ] Remover `HETZNER_VM_HOST` (se não for mais necessário)
- [ ] Remover `HETZNER_VM_USER` (se não for mais necessário)
- [ ] Remover `HETZNER_SSH_PRIVATE_KEY` (se não for mais necessário)

---

## 🏗️ Arquitetura dos Servidores

### Deploy Server (CX11)
- **Especificações:** 2 vCPU, 4GB RAM
- **Função:** Executa GitHub Actions Self-Hosted Runner
- **Custo:** ~€5/mês
- **Localização:** Hetzner Cloud

### Production Server (GEX44 GPU)
- **Especificações:** 
  - GPU: RTX 4000 SFF Ada (20GB VRAM)
  - CPU: Intel Core i5-13500 14 Core
  - RAM: 64GB DDR4
  - Storage: 2x 1.92TB NVMe SSD (RAID 1 = 1.92TB utilizável)
- **Função:** Hospeda todos os 50 containers (8 infra + 8 Alice + 15 ERPNext + 14 observability + 4 GPU + 1 backup)
- **Custo:** ~€184/mês
- **Localização:** Hetzner Cloud (Dedicated GPU Server)

---

## 🔐 Segurança

### Boas Práticas:

1. **Chave SSH:**
   - Use `ed25519` (mais seguro que RSA)
   - Permissões corretas: `chmod 600 ~/.ssh/id_ed25519_prod`
   - Nunca commite chaves privadas no repositório

2. **Secrets no GitHub:**
   - Use GitHub Secrets (não variáveis de ambiente)
   - Rotacione secrets periodicamente
   - Use senhas fortes (mín. 32 caracteres)

3. **Usuário SSH:**
   - Crie usuário dedicado `alice-deploy` (não use `root`)
   - Configure sudo apenas para comandos necessários
   - Desabilite login por senha (apenas chave SSH)

---

## 📚 Referências

- [Guia Completo de Secrets](docs/SECRETS.md)
- [Guia de Provisionamento Hetzner GPU](docs/GUIA-PROVISIONAMENTO-HETZNER-GPU.md)
- [Plano de Implementação Deploy Server](docs/PLANO-IMPLEMENTACAO-DEPLOY-SERVER.md)
- [Arquitetura Enterprise Deploy](docs/ANALISE-ENTERPRISE-DEPLOY-2025.md)

---

**Autor:** Fillipe Guerra  
**Data:** 25 de Dezembro de 2025  
**Versão:** 1.0


