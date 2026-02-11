#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
# deploy-functions.sh - Funções compartilhadas de deploy enterprise
# ═══════════════════════════════════════════════════════════════════════
# Autor: Fillipe Guerra
# Data: 10 de Fevereiro de 2026
#
# Contém funções reutilizadas por TODOS os 5 deploy jobs (INFRA, ALICE,
# OBSERVABILITY, ERPNEXT, BACKUP) para eliminar duplicação (CLAUDE.md Regra 2).
#
# USO:
#   export BUILT_IMAGES="auth,chat,rag"  # ou "__NONE__" ou ""
#   source /opt/alice/scripts/deploy-functions.sh
#   pull_if_needed "ghcr.io/user/alice-chat:v1.0.0"
#
# REF: CLAUDE.md Regra 2 (Não duplicar), Regra 6 (Enterprise-grade)
# ═══════════════════════════════════════════════════════════════════════

# Verificar que este script está sendo sourced, não executado diretamente
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  echo "❌ ERRO: Este script deve ser sourced, não executado diretamente."
  echo "   Uso correto: source /opt/alice/scripts/deploy-functions.sh"
  exit 1
fi

# ═══════════════════════════════════════════════════════════════════════
# verify_docker_credentials() - Valida presença de config.json
# ═══════════════════════════════════════════════════════════════════════
# Verifica que ~/.docker/config.json existe com pelo menos 1 registry.
# Credenciais são escritas pelo job 'prepare' (login único).
# ═══════════════════════════════════════════════════════════════════════
verify_docker_credentials() {
  if [ ! -f ~/.docker/config.json ]; then
    echo "❌ ERRO: ~/.docker/config.json não encontrado!"
    echo "   O job 'prepare' deveria ter escrito credenciais."
    echo "   Verifique se o job anterior executou corretamente."
    return 1
  fi

  local auths
  auths=$(grep -c '"auth"' ~/.docker/config.json 2>/dev/null || echo "0")
  if [ "$auths" -eq 0 ]; then
    echo "❌ ERRO: config.json existe mas sem credenciais de registry!"
    return 1
  fi

  echo "✅ Docker credentials OK ($auths registries em config.json)"
  return 0
}

# ═══════════════════════════════════════════════════════════════════════
# pull_with_retry() - Pull com retry e backoff progressivo
# ═══════════════════════════════════════════════════════════════════════
# Retries: 5 tentativas com backoff 15/30/60/90/120s para tolerar timeouts
# intermitentes do GHCR (context deadline exceeded, Client.Timeout).
# REF: CLAUDE.md Regra 6 (Enterprise-grade), Regra 9 (Validação contínua)
# REF: 11/02/2026 - Aumentado para 5 tentativas após falhas em produção
# ═══════════════════════════════════════════════════════════════════════
pull_with_retry() {
  local img="$1"
  local delays="15 30 60 90 120"
  local attempt=1
  for delay in $delays; do
    if docker pull "$img" 2>&1; then
      return 0
    fi
    if [ $attempt -lt 5 ]; then
      echo "   ⚠️ Retry $attempt/5 (aguardando ${delay}s)..."
      sleep "$delay"
    fi
    attempt=$((attempt + 1))
  done
  return 1
}

# ═══════════════════════════════════════════════════════════════════════
# try_local_retag() - Retag local com verificação de identidade
# ═══════════════════════════════════════════════════════════════════════
# Compara config digest remoto (Image ID) com Image IDs locais.
# Só retag se conteúdo for IDÊNTICO (previne tag apontando para
# conteúdo errado quando servidor tem imagem antiga/stale).
# Retorna 0 se retag OK, 1 se não foi possível (precisa pull).
# REF: CLAUDE.md Regra 6 (Enterprise-grade), Regra 7 (Cirúrgico)
# ═══════════════════════════════════════════════════════════════════════
try_local_retag() {
  local image="$1"
  local repo="${image%:*}"
  local tag="${image##*:}"

  # Verificar se existe alguma tag local do mesmo repo
  local existing_tags
  existing_tags=$(docker images "$repo" --format '{{.Tag}}' 2>/dev/null | head -10)
  if [ -z "$existing_tags" ]; then
    return 1  # sem nenhuma tag local → precisa pull
  fi

  # Obter config digest remoto (= Image ID) via manifest inspect
  local remote_cfg=""
  remote_cfg=$(timeout 15 docker manifest inspect "$image" 2>/dev/null \
    | grep -A4 '"config"' | grep '"digest"' | head -1 \
    | sed 's/.*"\(sha256:[a-f0-9]*\)".*/\1/') || remote_cfg=""

  # Fallback: verbose mode (para manifest lists / OCI index)
  if [ -z "$remote_cfg" ]; then
    remote_cfg=$(timeout 15 docker manifest inspect -v "$image" 2>/dev/null \
      | grep -A4 '"config"' | grep '"digest"' | head -1 \
      | sed 's/.*"\(sha256:[a-f0-9]*\)".*/\1/') || remote_cfg=""
  fi

  # Sem digest remoto = não é possível verificar → precisa pull
  if [ -z "$remote_cfg" ]; then
    echo "   ⚠️ manifest inspect falhou - não é possível verificar identidade"
    return 1
  fi

  # Comparar com cada tag local do mesmo repo
  for etag in $existing_tags; do
    local local_id
    local_id=$(docker image inspect "${repo}:${etag}" --format '{{.Id}}' 2>/dev/null) || continue
    if [ "$local_id" = "$remote_cfg" ]; then
      echo "   🏷️ RETAG LOCAL ($etag → $tag, conteúdo idêntico verificado)"
      docker tag "${repo}:${etag}" "$image"
      return 0
    fi
  done

  # Nenhuma tag local tem o mesmo conteúdo → precisa pull
  echo "   ⚠️ Imagens locais existem mas conteúdo difere do remoto"
  return 1
}

# ═══════════════════════════════════════════════════════════════════════
# pull_if_needed() - Pull inteligente com detecção de retag
# ═══════════════════════════════════════════════════════════════════════
# ARQUITETURA ENTERPRISE (10/02/2026):
# Release informa quais imagens foram BUILD vs RETAG via variável
# BUILT_IMAGES (deve estar exportada antes do source). Deploy usa
# essa info para decidir pull vs retag. Retag local SEMPRE verifica
# identidade de conteúdo via config digest (previne tag stale).
#
#   CASO 1: Tag exata existe localmente → SKIP (zero rede)
#   CASO 2: Imagem Docker Hub/Quay (terceiros) → pull com retry
#   CASO 3: Imagem GHCR com info Release → verificar + RETAG local ou pull
#   CASO 4: Sem info de Release (manual) → pull com retry
#
# REF: CLAUDE.md Regra 6 (Enterprise-grade), Regra 7 (Cirúrgico)
# ═══════════════════════════════════════════════════════════════════════
pull_if_needed() {
  local image="$1"
  local repo="${image%:*}"
  local tag="${image##*:}"

  # ─── CASO 1: Tag exata já existe localmente → SKIP ───
  if docker image inspect "$image" >/dev/null 2>&1; then
    echo "   ⏩ SKIP (tag $tag já existe localmente)"
    return 0
  fi

  # ─── CASO 2: Imagem Docker Hub/Quay (terceiros) → pull com retry ───
  # BUILT_IMAGES só se aplica a imagens GHCR (nossas custom images)
  # Docker Hub/Quay images (redis, qdrant, grafana, minio, etc.) = pull direto
  if ! echo "$repo" | grep -q "ghcr.io"; then
    echo "   📥 PULL (imagem externa)"
    pull_with_retry "$image"
    return $?
  fi

  # ─── Extrair nome do serviço GHCR (ex: ghcr.io/.../alice-chat → chat) ───
  local svc_name=""
  svc_name=$(echo "$repo" | sed 's/.*alice-//')

  # ─── CASO 3: Release informou built_images → detecção precisa ───
  # BUILT_IMAGES="" = deploy manual (sem info) → cai no CASO 4
  # BUILT_IMAGES="__NONE__" = Release rodou, tudo retag → tentar retag local
  # BUILT_IMAGES="auth,chat,..." = Release buildou essas → pull seletivo
  if [ -n "${BUILT_IMAGES:-}" ]; then
    # __NONE__ = Release confirmou que NADA foi buildado (tudo retag)
    if [ "${BUILT_IMAGES}" = "__NONE__" ]; then
      # Tentar retag local COM verificação de identidade
      if try_local_retag "$image"; then
        return 0
      fi
      # Sem tag local ou conteúdo difere → pull necessário
      echo "   📥 PULL (retag geral mas sem imagem local compatível)"
      pull_with_retry "$image"
      return $?
    fi

    # Verificar se esta imagem específica foi buildada na Release
    if echo ",$BUILT_IMAGES," | grep -q ",$svc_name,"; then
      # Foi buildada → pull real necessário (conteúdo novo)
      echo "   📥 PULL (build na Release)"
      pull_with_retry "$image"
      return $?
    else
      # NÃO foi buildada → foi retagged → tentar retag local COM verificação
      if try_local_retag "$image"; then
        return 0
      fi
      # Sem tag local compatível → pull necessário
      echo "   📥 PULL (retag mas sem imagem local compatível)"
      pull_with_retry "$image"
      return $?
    fi
  fi

  # ─── CASO 4: Sem info de Release (deploy manual) → pull com retry ───
  # Docker pull com layer caching: se imagem é retag, apenas
  # baixa manifest (~1KB) e reutiliza layers locais (~2-5s).
  echo "   📥 PULL (deploy manual, sem info de build/retag)"
  pull_with_retry "$image"
  return $?
}
