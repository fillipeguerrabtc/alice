# Pull Inteligente - Fluxo de Decisão

**Autor:** Fillipe Guerra  
**Data:** 14 de Fevereiro de 2026  
**Versão:** 1.0

## Overview

Este documento descreve o fluxo de decisão da função `pull_if_needed()` implementada em `infra/scripts/deploy-functions.sh`, que otimiza o download de imagens Docker durante o deploy.

## Arquitetura

```
Release Workflow (release.yml)
    ↓
build-images job
    ↓
Análise de mudanças (git diff)
    ├─ Código mudou → BUILD
    └─ Código igual → RETAG
    ↓
build-summary step
    ├─ Concatena builds (microservices + GPU)
    ├─ Se nada buildado → "__NONE__"
    └─ Output: built_images
        ↓
trigger-deploy job
    ↓
workflow_dispatch para deploy-stack-modular.yml
    ├─ stack: "all"
    ├─ version: "v1.0.0"
    └─ built_images: "auth,chat,rag" (ou "__NONE__" ou "")
        ↓
Deploy Workflow (deploy-stack-modular.yml)
    ↓
Job: prepare
    └─ Recebe built_images como input
        ↓
Jobs: deploy-{infra,alice,observability,erpnext,backup}
    ├─ Export BUILT_IMAGES="${{ github.event.inputs.built_images }}"
    ├─ Source /opt/alice/scripts/deploy-functions.sh
    └─ Loop em cada imagem:
        ├─ SERVICE_NAME=$(extract_service_name "$img")
        └─ pull_if_needed "$SERVICE_NAME" "$img" "$BUILT_IMAGES"
```

## Fluxo de Decisão - pull_if_needed()

```
┌─────────────────────────────────────────────────────────────────┐
│ pull_if_needed(SERVICE_NAME, IMAGE_FULL, BUILT_IMAGES)         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
                    ┌─────────────────┐
                    │ CASO 1:         │
                    │ Tag existe      │───→ ⏩ SKIP (0s)
                    │ localmente?     │
                    └────────┬────────┘
                             │ não
                             ↓
                    ┌─────────────────┐
                    │ CASO 2:         │
                    │ Imagem externa  │───→ 📥 PULL com retry (2-30s)
                    │ (Docker Hub)?   │
                    └────────┬────────┘
                             │ não (GHCR)
                             ↓
                    ┌─────────────────┐
                    │ BUILT_IMAGES    │
                    │ definido?       │───→ não → CASO 4 (deploy manual)
                    └────────┬────────┘              ↓
                             │ sim               📥 PULL com retry
                             ↓
              ┌──────────────┴──────────────┐
              │                             │
    ┌─────────▼─────────┐      ┌───────────▼──────────┐
    │ BUILT_IMAGES =    │      │ SERVICE_NAME         │
    │ "__NONE__"?       │      │ está na lista?       │
    └─────────┬─────────┘      └───────────┬──────────┘
              │ sim                         │
              ↓                   ┌─────────┴─────────┐
    ┌─────────────────┐           │ sim              │ não
    │ try_local_retag │           ↓                  ↓
    └────────┬────────┘  ┌────────────────┐  ┌─────────────────┐
             │ OK        │ 🔨 BUILD       │  │ 🏷️ RETAG        │
             ↓           │ na Release     │  │ na Release      │
    🏷️ RETAG OK (0.1s)  └────────┬───────┘  └────────┬────────┘
             │                    │                   │
             │                    ↓                   ↓
             │           📥 PULL com retry   try_local_retag
             │                    │           ┌──────┴──────┐
             │                    │           │ OK         │ falha
             │                    │           ↓            ↓
             │                    │   🏷️ RETAG OK   📥 PULL
             │                    │           │            │
             └────────────────────┴───────────┴────────────┘
                                  ↓
                          return 0 (sucesso)
                             ou
                          return 1 (falha)
```

## Casos de Uso

### Caso 1: Tag Existe Localmente

**Entrada:**
- SERVICE_NAME: "auth"
- IMAGE_FULL: "ghcr.io/.../alice-auth:v1.0.0"
- BUILT_IMAGES: "auth,chat"

**Condição:** `docker image inspect` retorna sucesso

**Saída:**
```
   ⏩ SKIP (tag v1.0.0 já existe localmente)
```

**Tempo:** ~0s (zero rede)

---

### Caso 2: Imagem Externa (Docker Hub/Quay)

**Entrada:**
- SERVICE_NAME: "redis"
- IMAGE_FULL: "redis:7.4.7-alpine"
- BUILT_IMAGES: "auth,chat"

**Condição:** Imagem não é GHCR (não contém "ghcr.io")

**Saída:**
```
   📥 PULL (imagem externa - Docker Hub/Quay)
   [pull_with_retry com 5 tentativas]
```

**Tempo:** ~2-30s (depende da rede e cache de layers)

---

### Caso 3a: Release 100% Retag (MODO CONFIANÇA ✨)

**Entrada:**
- SERVICE_NAME: "auth"
- IMAGE_FULL: "ghcr.io/.../alice-auth:v1.0.0"
- BUILT_IMAGES: "__NONE__"

**Condição:** Release não buildou nada (tudo foi retag)

**Saída:**
```
   🏷️  Release fez 100% retag - retag local com CONFIANÇA TOTAL
   🏷️  RETAG LOCAL RÁPIDO (latest → v1.0.0, confiança 100% em Release)
   
   Se não tem tags locais (primeira vez):
      📥 PULL (primeira vez que baixa esta imagem)
```

**Tempo:** ~0.1s (retag OK, ZERO rede ⚡) ou ~2-30s (primeira vez)

**IMPORTANTE:** Modo confiança não faz `manifest inspect` do registry remoto.
Confia 100% no sinal da Release → economiza 15s/imagem × 16 imagens = 4 minutos!

---

### Caso 3b: Serviço Foi Buildado

**Entrada:**
- SERVICE_NAME: "auth"
- IMAGE_FULL: "ghcr.io/.../alice-auth:v1.0.0"
- BUILT_IMAGES: "auth,chat,rag"

**Condição:** "auth" está na lista de buildadas

**Saída:**
```
   🔨 auth foi buildado no Release - fazendo pull
   [pull_with_retry com 5 tentativas]
```

**Tempo:** ~2-30s (conteúdo novo, pull necessário)

---

### Caso 3c: Serviço Foi Retagged (MODO CONFIANÇA ✨)

**Entrada:**
- SERVICE_NAME: "frontend"
- IMAGE_FULL: "ghcr.io/.../alice-frontend:v1.0.0"
- BUILT_IMAGES: "auth,chat,rag"

**Condição:** "frontend" NÃO está na lista (foi retagged)

**Saída:**
```
   🏷️  frontend foi retagged - retag local com CONFIANÇA
   🏷️  RETAG LOCAL RÁPIDO (latest → v1.0.0, confiança 100% em Release)
   
   Se não tem tags locais (primeira vez):
      📥 PULL (primeira vez que baixa esta imagem)
```

**Tempo:** ~0.1s (retag OK, ZERO rede ⚡) ou ~2-30s (primeira vez)

**IMPORTANTE:** Modo confiança não faz `manifest inspect` do registry remoto.
Confia 100% no sinal da Release → economiza 15s/imagem!

---

### Caso 4: Deploy Manual (Sem Release)

**Entrada:**
- SERVICE_NAME: "auth"
- IMAGE_FULL: "ghcr.io/.../alice-auth:v1.0.0"
- BUILT_IMAGES: "" (vazio)

**Condição:** Deploy manual via GitHub Actions UI (sem Release)

**Saída:**
```
   📥 PULL (deploy manual, sem info de build/retag)
   [pull_with_retry com 5 tentativas]
```

**Tempo:** ~2-30s (sem info de Release, pull seguro)

---

## Funções Auxiliares

### extract_service_name()

Extrai o nome do serviço de uma imagem Docker.

**Exemplos:**

| Entrada | Saída |
|---------|-------|
| `ghcr.io/.../alice-auth:v1.0.0` | `auth` |
| `ghcr.io/.../alice-gpu-embeddings:v1.0.0` | `gpu-embeddings` |
| `redis:7.4.7-alpine` | `redis` |
| `quay.io/minio/minio:latest` | `minio` |

**Implementação:**
```bash
extract_service_name() {
  local image="$1"
  local repo="${image%:*}"
  
  if echo "$repo" | grep -q "alice-"; then
    echo "$repo" | sed 's/.*alice-//'
  else
    basename "$repo"
  fi
}
```

---

### try_local_retag()

Tenta criar tag local reutilizando imagem existente com **dois modos de operação**.

**Modo Confiança (`trust_retag=true`):**
- Release confirmou 100% retag → confia totalmente
- Faz retag local IMEDIATO sem verificar registry remoto
- **ZERO chamadas de rede, ZERO latência**
- Prioriza tags 'latest' ou 'vX.Y.Z' disponíveis localmente
- Usado quando `built_images="__NONE__"` ou serviço foi retagged

**Modo Verificação (`trust_retag=false`, default):**
- Deploy manual → não confia cegamente
- Compara config digest remoto (Image ID) com IDs locais
- Só retag se conteúdo for IDÊNTICO
- Previne tag apontando para conteúdo errado/stale
- Usado em deploys manuais sem informação de Release

**Parâmetros:**
- `$1` - image: Imagem completa (ex: "ghcr.io/.../alice-auth:v1.0.0")
- `$2` - trust_retag: "true" (confiança) ou "false" (verificação, default)

**Retorno:**
- `0` - Retag OK (imagem local compatível encontrada)
- `1` - Precisa pull (sem tag local ou conteúdo difere)

**Implementação:**
```bash
try_local_retag() {
  local image="$1"
  local trust_retag="${2:-false}"
  
  # Se trust_retag=true:
  #   1. Buscar tags locais (latest, vX.Y.Z)
  #   2. Fazer retag IMEDIATO (sem verificação remota)
  #   3. Return 0 ou 1
  
  # Se trust_retag=false (default):
  #   1. Buscar config digest remoto via manifest inspect
  #   2. Comparar com Image IDs locais
  #   3. Se match → docker tag
  #   4. Se não match ou erro → return 1
}
```

---

### pull_with_retry()

Pull com retry e backoff progressivo.

**Configuração:**
- **Tentativas:** 5
- **Backoff:** 15s, 30s, 60s, 90s, 120s
- **Tolerância:** Timeouts intermitentes do GHCR

**Uso:**
```bash
if ! pull_with_retry "$IMAGE_FULL"; then
  echo "❌ ERRO: Falha no pull após 5 tentativas"
  exit 1
fi
```

---

## Métricas de Economia

### Deploy Normal (sem mudanças) - MODO CONFIANÇA ✨

**Antes (bug - manifest inspect sempre):**
- 50 imagens × (15s timeout manifest inspect + 30s pull fallback) = **~22 minutos**
- Se GHCR lento: 50 imagens × 15s timeout = **12.5 minutos** apenas esperando timeouts
- Pull desnecessário: ~5GB de download

**Depois (fix - modo confiança):**
- Release envia `__NONE__`
- Todas fazem retag local IMEDIATO (sem verificação remota)
- 50 imagens × 0.1s = **5 segundos**
- **ZERO** chamadas de rede, **ZERO** download

**Economia:** ~22 minutos → 5 segundos = **99.6% mais rápido** 🚀🚀🚀

**Cenário Crítico (GHCR indisponível):**
- Antes: 50 imagens × 15s timeout = 12.5min + 10-15min pull = **~25 minutos de falha**
- Depois: 5 segundos de retag local = **FUNCIONA** mesmo com GHCR offline ✅

---

### Deploy Misto (3 builds + 47 retags)

**Antes (pull sempre):**
- 50 imagens × 30s média = **25 minutos**

**Depois (pull inteligente):**
- 3 buildadas: 3 × 30s = 90s
- 47 retagged: 47 × 0.1s = 4.7s
- **Total:** ~95 segundos (~1.5 minutos)

**Economia:** ~23.5 minutos (93.6% mais rápido) 🚀

---

## Troubleshooting

### Logs Importantes

| Log | Significado | Ação |
|-----|-------------|------|
| `⏩ SKIP` | Tag existe | ✅ OK - Zero rede |
| `📥 PULL (imagem externa)` | Docker Hub/Quay | ✅ OK - Pull normal |
| `🔨 buildado no Release` | Conteúdo novo | ✅ OK - Pull necessário |
| `🏷️ retagged` | Conteúdo igual | ✅ OK - Retag local |
| `❌ FALHOU` | Pull falhou | 🔴 Erro - Ver logs GHCR |

### Debug

Para debug, adicionar `set -x` antes do source:

```bash
set -x  # Debug mode
source /opt/alice/scripts/deploy-functions.sh
pull_if_needed "auth" "$IMAGE" "$BUILT_IMAGES"
set +x  # Desligar debug
```

---

## Referências

- **CLAUDE.md Regra 2:** Não duplicar (funções centralizadas)
- **CLAUDE.md Regra 6:** Enterprise-grade (retry logic, verificação de identidade)
- **CLAUDE.md Regra 7:** Mudanças cirúrgicas (refatoração sem quebrar compatibilidade)
- **CLAUDE.md Regra 9:** Validação contínua (testes automatizados)
- **DEPLOYMENT.md:** Documentação completa do deploy
- **release.yml:** Workflow de Release com build summary
- **deploy-stack-modular.yml:** Workflow de Deploy modular

---

**Fim do Documento**
