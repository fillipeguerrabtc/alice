#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
# deploy-functions.sh - Funções compartilhadas de deploy enterprise
# ═══════════════════════════════════════════════════════════════════════
# Autor: Fillipe Guerra
# Data: 14 de Fevereiro de 2026 (Atualizado)
#
# Contém funções reutilizadas por TODOS os 5 deploy jobs (INFRA, ALICE,
# OBSERVABILITY, ERPNEXT, BACKUP) para eliminar duplicação (CLAUDE.md Regra 2).
#
# USO:
#   BUILT_IMAGES="auth,chat,rag"  # ou "__NONE__" ou ""
#   source /opt/alice/scripts/deploy-functions.sh
#   pull_if_needed "auth" "ghcr.io/user/alice-auth:v1.0.0" "$BUILT_IMAGES"
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
# verify_docker_credentials() - Valida config + auth GHCR
# ═══════════════════════════════════════════════════════════════════════
# Verifica que ~/.docker/config.json existe, contém auth para GHCR
# e testa autenticação ativa via docker manifest inspect.
# Diferencia erro de credencial (401/403) de erro transitório de rede.
# Credenciais são escritas pelo job 'prepare' (login único).
# ═══════════════════════════════════════════════════════════════════════
verify_docker_credentials() {
  local probe_image="${1:-}"
  local ghcr_required=true
  if [ "${BUILT_IMAGES:-}" = "__NONE__" ]; then
    ghcr_required=false
  fi

  if [ ! -f ~/.docker/config.json ]; then
    if [ "$ghcr_required" = true ]; then
      echo "❌ ERRO: ~/.docker/config.json não encontrado!"
      echo "   O job 'prepare' deveria ter escrito credenciais."
      echo "   Verifique se o job anterior executou corretamente."
      return 1
    fi
    echo "⚠️ ~/.docker/config.json não encontrado, seguindo sem validação de auth (release 100% retag)"
    return 0
  fi

  local auths
  auths=$(grep -c '"auth"' ~/.docker/config.json 2>/dev/null || echo "0")
  if [ "$auths" -eq 0 ]; then
    if [ "$ghcr_required" = true ]; then
      echo "❌ ERRO: config.json existe mas sem credenciais de registry!"
      return 1
    fi
    echo "⚠️ config.json sem credenciais, seguindo sem validação de auth (release 100% retag)"
    return 0
  fi

  if ! grep -q '"ghcr.io"' ~/.docker/config.json; then
    if [ "$ghcr_required" = true ]; then
      echo "❌ ERRO: config.json sem credenciais de GHCR (ghcr.io)!"
      return 1
    fi
    echo "⚠️ config.json sem credenciais GHCR, seguindo sem validação de auth (release 100% retag)"
    return 0
  fi

  # Probe ativo opcional para validar autenticação GHCR.
  # Se falhar por rede (timeout), segue com warning.
  # Se falhar por auth (401/403), falha imediatamente.
  if [ -n "$probe_image" ]; then
    local probe_attempt=1
    local probe_ok=false
    while [ $probe_attempt -le 3 ]; do
      local probe_output
      probe_output=$(timeout 20 docker manifest inspect "$probe_image" 2>&1) && probe_ok=true || true

      if [ "$probe_ok" = true ]; then
        echo "✅ GHCR auth validada via probe: $probe_image"
        break
      fi

      if echo "$probe_output" | grep -Eiq "unauthorized|denied|authentication required|403|401"; then
        if [ "$ghcr_required" = true ]; then
          echo "❌ ERRO: Autenticação GHCR inválida (probe falhou)"
          echo "   Probe image: $probe_image"
          echo "   Detalhe: $probe_output"
          return 1
        fi
        echo "⚠️ Probe GHCR sem auth válida, mas release está em modo 100% retag local"
        break
      fi

      if [ $probe_attempt -lt 3 ]; then
        echo "⚠️ Probe GHCR com falha transitória de rede (tentativa ${probe_attempt}/3)"
        sleep $((probe_attempt * 5))
      fi
      probe_attempt=$((probe_attempt + 1))
    done

    if [ "$probe_ok" != true ]; then
      echo "⚠️ Não foi possível validar GHCR por rede no probe, mas credenciais existem no config.json"
      echo "   Deploy seguirá e o pull com retry decidirá por sucesso/falha."
    fi
  fi

  echo "✅ Docker credentials OK ($auths registries em config.json, GHCR presente, ghcr_required=$ghcr_required)"
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
  existing_tags=$(docker images "$repo" --format '{{.Tag}}' 2>/dev/null)
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
    local fallback_tag=""
    fallback_tag=$(echo "$existing_tags" | grep -E '^v[0-9]+(\.[0-9]+)*$' | sort -V | tail -1)
    if [ -z "$fallback_tag" ]; then
      fallback_tag=$(echo "$existing_tags" | grep -v '^<none>$' | head -1)
    fi
    if [ -n "$fallback_tag" ]; then
      echo "   🏷️ RETAG LOCAL FALLBACK ($fallback_tag → $tag, sem dependência de rede/registry)"
      docker tag "${repo}:${fallback_tag}" "$image"
      return 0
    fi
    echo "   ⚠️ manifest inspect falhou e não há tag local elegível para fallback"
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
# extract_service_name() - Extrai nome do serviço de uma imagem
# ═══════════════════════════════════════════════════════════════════════
# Extrai o nome do serviço de uma imagem Docker para usar na lógica de
# pull inteligente. Suporta imagens GHCR (alice-*) e imagens externas.
#
# PARÂMETROS:
#   $1 = IMAGE: Imagem completa (ex: "ghcr.io/.../alice-auth:v1.0.0")
#
# RETORNO:
#   Nome do serviço (ex: "auth" para "alice-auth")
#   ou nome completo para imagens externas (ex: "redis" para "redis:7.4.7-alpine")
#
# EXEMPLOS:
#   extract_service_name "ghcr.io/fillipeguerrabtc/alice-auth:v1.0.0"  # → auth
#   extract_service_name "ghcr.io/fillipeguerrabtc/alice-postgres:v1.0.0"  # → postgres
#   extract_service_name "redis:7.4.7-alpine"  # → redis
#   extract_service_name "quay.io/minio/minio:latest"  # → minio
# ═══════════════════════════════════════════════════════════════════════
extract_service_name() {
  local image="$1"
  local repo="${image%:*}"
  
  # Para imagens GHCR (alice-*), extrair nome após "alice-"
  if echo "$repo" | grep -q "alice-"; then
    echo "$repo" | sed 's/.*alice-//'
  else
    # Para imagens externas, usar nome do repositório
    basename "$repo"
  fi
}

# ═══════════════════════════════════════════════════════════════════════
# pull_if_needed() - Pull inteligente com detecção de retag
# ═══════════════════════════════════════════════════════════════════════
# ARQUITETURA ENTERPRISE (14/02/2026 - Refatorado para parâmetros explícitos):
# Release informa quais imagens foram BUILD vs RETAG via parâmetro
# BUILT_IMAGES. Deploy passa essa info explicitamente para decidir
# pull vs retag. Retag local SEMPRE verifica identidade de conteúdo
# via config digest (previne tag stale).
#
# PARÂMETROS:
#   $1 = SERVICE_NAME: Nome do serviço (ex: "auth", "chat", "postgres")
#   $2 = IMAGE_FULL: Imagem completa (ex: "ghcr.io/.../alice-auth:v1.0.0")
#   $3 = BUILT_IMAGES (opcional): Lista de serviços buildados (ex: "auth,chat")
#                                  ou "__NONE__" (tudo retag)
#                                  ou "" (deploy manual)
#
# CASOS:
#   CASO 1: Tag exata existe localmente → SKIP (zero rede)
#   CASO 2: Imagem Docker Hub/Quay (terceiros) → pull com retry
#   CASO 3: Imagem GHCR com info Release → verificar + RETAG local ou pull
#   CASO 4: Sem info de Release (manual) → pull com retry
#
# EXEMPLOS:
#   pull_if_needed "auth" "ghcr.io/.../alice-auth:v1.0.0" "auth,chat,rag"
#   pull_if_needed "auth" "ghcr.io/.../alice-auth:v1.0.0" "__NONE__"
#   pull_if_needed "auth" "ghcr.io/.../alice-auth:v1.0.0" ""
#
# REF: CLAUDE.md Regra 6 (Enterprise-grade), Regra 7 (Cirúrgico)
# ═══════════════════════════════════════════════════════════════════════
pull_if_needed() {
  local service_name="$1"
  local image="$2"
  local built_images="${3:-}"
  local repo="${image%:*}"
  local tag="${image##*:}"

  # ─── CASO 1: Tag exata já existe localmente → SKIP ───
  if docker image inspect "$image" >/dev/null 2>&1; then
    echo "   ⏩ SKIP (tag $tag já existe localmente)"
    return 0
  fi

  # ─── CASO 2: Imagem Docker Hub/Quay (terceiros) → pull com retry ───
  # built_images só se aplica a imagens GHCR (nossas custom images)
  # Docker Hub/Quay images (redis, qdrant, grafana, minio, etc.) = pull direto
  if ! echo "$repo" | grep -q "ghcr.io"; then
    echo "   📥 PULL (imagem externa - Docker Hub/Quay)"
    pull_with_retry "$image"
    return $?
  fi

  # ─── CASO 3: Release informou built_images → detecção precisa ───
  # built_images="" = deploy manual (sem info) → cai no CASO 4
  # built_images="__NONE__" = Release rodou, tudo retag → tentar retag local
  # built_images="auth,chat,..." = Release buildou essas → pull seletivo
  if [ -n "$built_images" ]; then
    # __NONE__ = Release confirmou que NADA foi buildado (tudo retag)
    if [ "$built_images" = "__NONE__" ]; then
      # Tentar retag local COM verificação de identidade
      echo "   🏷️  Release fez 100% retag - tentando retag local..."
      if try_local_retag "$image"; then
        return 0
      fi
      # Sem tag local ou conteúdo difere → pull necessário
      echo "   📥 PULL (retag geral mas sem imagem local compatível)"
      pull_with_retry "$image"
      return $?
    fi

    # Verificar se este serviço específico foi buildado na Release
    # Usar service_name passado como parâmetro ao invés de extrair do repo
    if echo ",$built_images," | grep -q ",$service_name,"; then
      # Foi buildado → pull real necessário (conteúdo novo)
      echo "   🔨 $service_name foi buildado no Release - fazendo pull"
      pull_with_retry "$image"
      return $?
    else
      # NÃO foi buildado → foi retagged → tentar retag local COM verificação
      echo "   🏷️  $service_name foi retagged - tentando retag local..."
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
