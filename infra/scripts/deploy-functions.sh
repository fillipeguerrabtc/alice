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

# =============================================================================
# AUTO-DETECÇÃO DE MANIFESTO DE IMAGENS (23/02/2026)
# =============================================================================
# O manifesto é gerado pelo release.yml e transferido pelo prepare job do
# deploy para /opt/alice/manifests/images-manifest.json no servidor de produção.
#
# A comparação de digest garante que pull ocorre APENAS quando o conteúdo
# da imagem local difere do esperado pelo Release, prevenindo:
#   - Deploy com imagens stale (retag local de versão antiga)
#   - Produção em estado inconsistente após release com falha parcial
#
# Se o manifesto não existir (primeiro deploy, deploy manual, prerelease),
# o comportamento cai para a lógica legada baseada em built_images.
#
# REF: CLAUDE.md Regra 6 (Enterprise-grade), Regra 7 (Mudanças cirúrgicas)
# =============================================================================
if [ -z "${MANIFEST_FILE:-}" ]; then
  _MANIFEST_DEFAULT="/opt/alice/manifests/images-manifest.json"
  if [ -f "$_MANIFEST_DEFAULT" ] && command -v jq >/dev/null 2>&1; then
    MANIFEST_FILE="$_MANIFEST_DEFAULT"
    _MANIFEST_VERSION=$(jq -r '.version // "?"' "$MANIFEST_FILE" 2>/dev/null || echo "?")
    _MANIFEST_COUNT=$(jq '.images | length' "$MANIFEST_FILE" 2>/dev/null || echo "0")
    echo "ℹ️  Manifesto de imagens detectado: $MANIFEST_FILE"
    echo "   Versão: $_MANIFEST_VERSION | Imagens: $_MANIFEST_COUNT"
  fi
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
# pull_with_retry() - Pull com retry, backoff progressivo e fail-fast de auth
# ═══════════════════════════════════════════════════════════════════════
# Retries: 5 tentativas com backoff 15/30/60/90/120s para tolerar timeouts
# intermitentes do GHCR (context deadline exceeded, Client.Timeout).
# Fail-fast: erros de autenticação (401/403/unauthorized) abortam imediatamente
# sem retries, pois retry não resolve ausência de credenciais.
# REF: CLAUDE.md Regra 6 (Enterprise-grade), Regra 9 (Validação contínua)
# REF: 11/02/2026 - Aumentado para 5 tentativas após falhas em produção
# REF: 22/02/2026 - Fail-fast em erros de autenticação
# ═══════════════════════════════════════════════════════════════════════
pull_with_retry() {
  local img="$1"
  local delays="15 30 60 90 120"
  local attempt=1
  local pull_output pull_rc
  for delay in $delays; do
    pull_output=$(docker pull "$img" 2>&1) && pull_rc=0 || pull_rc=$?
    printf '%s\n' "$pull_output"
    if [ "$pull_rc" -eq 0 ]; then
      return 0
    fi
    # Fail-fast em erros de autenticação (retry não resolve falta de credenciais)
    if echo "$pull_output" | grep -Eiq "unauthorized|denied|authentication required|403|401|access denied|no basic auth credentials"; then
      echo "   ❌ ERRO DE AUTENTICAÇÃO ao fazer pull de $img (tentativa ${attempt}/5)"
      echo "   💡 Causa provável: ~/.docker/config.json ausente ou sem credenciais GHCR no servidor de produção."
      echo "   💡 Verifique se o job 'prepare' transferiu o config.json corretamente via SCP."
      return 1
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
# try_local_retag() - Retag local puramente local (zero chamadas ao registry)
# ═══════════════════════════════════════════════════════════════════════
# Faz retag local usando a tag mais recente disponível localmente.
# NÃO faz chamadas ao registry (sem manifest inspect, sem pull).
# Retorna 0 se retag OK (ou tag já existe), 1 se não há imagem local.
# REF: CLAUDE.md Regra 6 (Enterprise-grade), Regra 7 (Cirúrgico)
# ═══════════════════════════════════════════════════════════════════════
try_local_retag() {
  local image="$1"
  local repo="${image%:*}"
  local tag="${image##*:}"

  # Tag exata já existe localmente → nada a fazer
  if docker image inspect "$image" >/dev/null 2>&1; then
    echo "   ⏩ SKIP (tag $tag já existe localmente)"
    return 0
  fi

  # Verificar se existe alguma tag local do mesmo repo (excluindo <none>)
  local existing_tags
  existing_tags=$(docker images "$repo" --format '{{.Tag}}' 2>/dev/null | grep -v '^<none>$' || true)
  if [ -z "$existing_tags" ]; then
    return 1  # sem nenhuma tag local → retag não é possível
  fi

  # Escolher melhor tag fonte: preferir semantic version (v*), fallback para qualquer tag
  local source_tag=""
  source_tag=$(echo "$existing_tags" | grep -E '^v[0-9]+(\.[0-9]+)*$' | sort -V | tail -1)
  if [ -z "$source_tag" ]; then
    source_tag=$(echo "$existing_tags" | head -1)
  fi

  if [ -n "$source_tag" ]; then
    echo "   🏷️ RETAG LOCAL ($source_tag → $tag, puramente local, zero chamadas ao registry)"
    docker tag "${repo}:${source_tag}" "$image"
    return 0
  fi

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
# find_local_ref_by_digest() - Busca tag local com digest esperado (mesmo repo)
# Usado pela lógica de manifesto quando a tag de destino ainda não existe.
# Retorna via stdout um repo:tag local que já aponta para expected_digest.
find_local_ref_by_digest() {
  local repo="$1"
  local expected_digest="$2"
  local refs=""

  refs=$(docker images "$repo" --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | \
    grep -v ':<none>$' | sort -u || true)
  if [ -z "$refs" ]; then
    return 1
  fi

  while IFS= read -r ref; do
    [ -z "$ref" ] && continue
    local repo_digests=""
    repo_digests=$(docker image inspect "$ref" --format '{{join .RepoDigests "\n"}}' 2>/dev/null || true)
    if [ -n "$repo_digests" ] && echo "$repo_digests" | grep -Fq "@${expected_digest}"; then
      echo "$ref"
      return 0
    fi
  done <<< "$refs"

  return 1
}

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

  # ─── MANIFESTO: Comparação de digest enterprise-safe ───────────────────────
  # Quando manifesto disponível (gerado pelo release.yml) e imagem é GHCR custom:
  #   - Digest local == manifesto → SKIP (conteúdo correto, zero rede)
  #   - Digest diferente ou imagem ausente → PULL (garante conteúdo correto)
  #
  # Isso previne o bug de retag stale: se release anterior falhou parcialmente
  # e a tag local é de versão mais antiga, o digest difere → pull correto.
  #
  # NOTA: RepoDigests é populado apenas em imagens pulled do registry (não
  # imagens built localmente). Para imagens sem RepoDigests, digest fica vazio
  # → pull conservativo (correto por design).
  #
  # REF: CLAUDE.md Regra 6 (Enterprise-grade), Regra 7 (Mudanças cirúrgicas)
  # ───────────────────────────────────────────────────────────────────────────
  local _manifest_file="${MANIFEST_FILE:-}"
  if [ -n "$_manifest_file" ] && [ -f "$_manifest_file" ] && \
     echo "$repo" | grep -q "ghcr.io" && command -v jq >/dev/null 2>&1; then
    local expected_digest
    expected_digest=$(jq -r --arg svc "$service_name" \
      '.images[]? | select(.name == $svc) | .digest' \
      "$_manifest_file" 2>/dev/null || echo "")

    if [ -n "$expected_digest" ] && [ "$expected_digest" != "null" ]; then
      # Verificar digest local da tag de destino (quando ja existe).
      local local_digest=""
      local local_repo_digests=""
      if docker image inspect "$image" >/dev/null 2>&1; then
        local_repo_digests=$(docker image inspect "$image" \
          --format '{{join .RepoDigests "\n"}}' 2>/dev/null || echo "")
        if [ -n "$local_repo_digests" ] && echo "$local_repo_digests" | grep -Fq "@$expected_digest"; then
          echo "   SKIP (digest OK: ${expected_digest:0:19}...)"
          return 0
        fi
        local_digest=$(echo "$local_repo_digests" | head -1 | sed 's/.*@//' || echo "")
      fi

      # Se a tag alvo ainda nao existe, procurar outra tag local do mesmo repo
      # com o digest esperado e retaggear localmente (sem download).
      local matching_ref=""
      matching_ref=$(find_local_ref_by_digest "$repo" "$expected_digest" || true)
      if [ -n "$matching_ref" ]; then
        if [ "$matching_ref" = "$image" ]; then
          echo "   SKIP (digest OK: ${expected_digest:0:19}...)"
        else
          echo "   RETAG LOCAL (digest OK em $matching_ref -> $tag)"
          docker tag "$matching_ref" "$image"
        fi
        return 0
      fi

      if [ -n "$local_digest" ]; then
        echo "   PULL (digest local ${local_digest:0:19}... != manifesto ${expected_digest:0:19}...)"
      else
        echo "   PULL (sem digest local; esperado: ${expected_digest:0:19}...)"
      fi
      pull_with_retry "$image"
      return $?
    fi
    # Serviço não encontrado no manifesto → cai na lógica legada abaixo
  fi

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
  # built_images="__NONE__" = Release rodou, tudo retag → retag local obrigatório
  # built_images="auth,chat,..." = Release buildou essas → pull seletivo
  if [ -n "$built_images" ]; then
    # __NONE__ = Release confirmou que NADA foi buildado (tudo retag)
    if [ "$built_images" = "__NONE__" ]; then
      echo "   🏷️  Release 100% retag - tentando retag local (zero chamadas ao registry)..."
      if try_local_retag "$image"; then
        return 0
      fi
      # FAIL FAST: release 100% retag mas imagem local não encontrada
      echo "   ❌ ERRO: Imagem local não encontrada para retag: $image"
      echo "   💡 Causa: release 100% retag mas imagem local ausente (retenção insuficiente, primeiro deploy, ou limpeza indevida)."
      echo "   💡 Solução: execute deploy com built_images vazio (deploy manual) para forçar pull."
      return 1
    fi

    # Verificar se este serviço específico foi buildado na Release
    # Usar service_name passado como parâmetro ao invés de extrair do repo
    if echo ",$built_images," | grep -q ",$service_name,"; then
      # Foi buildado → pull real necessário (conteúdo novo)
      echo "   🔨 $service_name foi buildado no Release - fazendo pull"
      pull_with_retry "$image"
      return $?
    else
      # NÃO foi buildado → foi retagged → retag local obrigatório (zero chamadas ao registry)
      echo "   🏷️  $service_name foi retagged - tentando retag local (zero chamadas ao registry)..."
      if try_local_retag "$image"; then
        return 0
      fi
      # FAIL FAST: retag-only service mas imagem local não encontrada
      echo "   ❌ ERRO: Imagem local não encontrada para retag: $image"
      echo "   💡 Causa: $service_name foi retagged na Release mas imagem local ausente."
      echo "   💡 Solução: execute deploy com built_images vazio (deploy manual) para forçar pull."
      return 1
    fi
  fi

  # ─── CASO 4: Sem info de Release (deploy manual) → pull com retry ───
  # Docker pull com layer caching: se imagem é retag, apenas
  # baixa manifest (~1KB) e reutiliza layers locais (~2-5s).
  echo "   📥 PULL (deploy manual, sem info de build/retag)"
  pull_with_retry "$image"
  return $?
}
