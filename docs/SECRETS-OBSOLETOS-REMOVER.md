# Lista de Secrets Obsoletos - Remover do GitHub

**Autor:** Fillipe Guerra  
**Data:** 25 de Dezembro de 2025  
**Versão:** 1.0

## 🗑️ Secrets Obsoletos do Salad Cloud (REMOVER)

Estes secrets devem ser **removidos completamente** do GitHub Secrets, pois a plataforma migrou para Hetzner GPU GEX44 com GPU Manager Service local.

### Secrets Obrigatórios para Remoção:

| Secret | Descrição | Status |
|--------|-----------|--------|
| `SALAD_API_KEY` | API Key do Salad Cloud | ❌ **REMOVER** |
| `SALAD_ORGANIZATION_ID` | Organization ID do Salad Cloud | ❌ **REMOVER** |
| `SALAD_PROJECT_ID` | Project ID do Salad Cloud | ❌ **REMOVER** |
| `SALAD_API_URL` | URL base da API Salad Cloud | ❌ **REMOVER** |
| `SALAD_MIXTRAL_URL` | URL do serviço Mixtral no Salad Cloud | ❌ **REMOVER** |
| `SALAD_FLUX_URL` | URL do serviço FLUX no Salad Cloud | ❌ **REMOVER** |
| `SALAD_WHISPER_URL` | URL do serviço Whisper/ASR no Salad Cloud | ❌ **REMOVER** |
| `SALAD_ASR_URL` | URL do serviço ASR no Salad Cloud | ❌ **REMOVER** |
| `SALAD_EMBEDDINGS_URL` | URL do serviço Embeddings no Salad Cloud | ❌ **REMOVER** |
| `SALAD_MEDIA_PROJECT` | Nome do projeto de mídia no Salad Cloud | ❌ **REMOVER** |
| `SALAD_GPU_CLASS` | Classe de GPU do Salad Cloud (rtx4090, etc.) | ❌ **REMOVER** |
| `EMBEDDINGS_GPU_URL` | URL do serviço Embeddings GPU (se apontava para Salad) | ⚠️ **VERIFICAR** - Se apontava para Salad, remover. Se for local, manter. |

### Como Remover:

1. Acesse: `https://github.com/fillipeguerrabtc/alice/settings/secrets/actions`
2. Para cada secret listado acima:
   - Clique no secret
   - Clique em **"Delete"**
   - Confirme a remoção

### ⚠️ Importante:

- **NÃO remova** `EMBEDDINGS_GPU_URL` se ele apontar para `http://gpu-embeddings:8000` (serviço local)
- Todos os serviços GPU agora rodam localmente no Hetzner GPU GEX44
- GPU Manager Service gerencia todas as requisições GPU localmente

---

## ✅ Secrets Novos Necessários (ADICIONAR)

### Para Arquitetura com Deploy Server Separado:

| Secret | Valor | Descrição | Obrigatório? |
|--------|-------|-----------|--------------|
| `PRODUCTION_SERVER_HOST` | `46.224.46.93` | IP do Production Server (GPU Server GEX44) | ✅ **SIM** |
| `PRODUCTION_SERVER_USER` | `alice-deploy` | Usuário SSH dedicado no Production Server | ✅ **SIM** |
| `PRODUCTION_SERVER_SSH_PRIVATE_KEY` | Chave SSH privada completa | Chave SSH para Deploy Server acessar Production Server | ✅ **SIM** |

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
ssh-copy-id -i ~/.ssh/id_ed25519_prod.pub alice-deploy@46.224.46.93

# Copiar chave privada completa para GitHub Secret
cat ~/.ssh/id_ed25519_prod
# Copiar TODO o conteúdo (incluindo -----BEGIN e -----END)
```

### ⚠️ Nota sobre HETZNER_VM_* (Legado):

Os secrets `HETZNER_VM_HOST`, `HETZNER_VM_USER` e `HETZNER_SSH_PRIVATE_KEY` são mantidos apenas para **compatibilidade** (fallback SSH se o runner não estiver disponível). Podem ser removidos após validar que o Deploy Server está funcionando corretamente.

---

## 📋 Checklist de Remoção

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
- [ ] Verificar `EMBEDDINGS_GPU_URL` (remover se apontava para Salad)

## 📋 Checklist de Adição

- [ ] Adicionar `PRODUCTION_SERVER_HOST`
- [ ] Adicionar `PRODUCTION_SERVER_USER`
- [ ] Adicionar `PRODUCTION_SERVER_SSH_PRIVATE_KEY`
- [ ] Validar que Deploy Server consegue acessar Production Server via SSH
- [ ] Testar deploy completo

---

**Autor:** Fillipe Guerra  
**Data:** 25 de Dezembro de 2025

