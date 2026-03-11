#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
# release-functions.sh - Funções compartilhadas de build/retag enterprise
# ═══════════════════════════════════════════════════════════════════════
# Autor: Fillipe Guerra
# Data: 10 de Fevereiro de 2026
#
# Contém funções reutilizadas por ambos os steps "Build Microservices"
# e "Build GPU Services" no release.yml para eliminar duplicação
# (CLAUDE.md Regra 2).
#
# USO:
#   export VERSION="v1.0.0"
#   export PREVIOUS_TAG="v0.9.0"       # ou "" se primeiro release
#   export IMAGE_PREFIX="ghcr.io/owner/alice"  # já definido como env no workflow
#   source scripts/release-functions.sh
#   # Usa: should_build, image_exists, retag_image, CHANGED_FILES
#
# REF: CLAUDE.md Regra 2 (Não duplicar), Regra 6 (Enterprise-grade)
# ═══════════════════════════════════════════════════════════════════════

# Verificar que este script está sendo sourced, não executado diretamente
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  echo "❌ ERRO: Este script deve ser sourced, não executado diretamente."
  echo "   Uso correto: source scripts/release-functions.sh"
  exit 1
fi

# Validar variáveis obrigatórias
if [ -z "${VERSION:-}" ]; then
  echo "❌ ERRO: VERSION não definida. Exporte antes de source."
  return 1
fi

if [ -z "${IMAGE_PREFIX:-}" ]; then
  echo "❌ ERRO: IMAGE_PREFIX não definida. Exporte antes de source."
  return 1
fi

# ═══════════════════════════════════════════════════════════════════════
# Determinar arquivos alterados para builds condicionais
# ═══════════════════════════════════════════════════════════════════════
# Se PREVIOUS_TAG existe → git diff para detectar mudanças
# Se não → marca como __NO_PREVIOUS_TAG__ (força rebuild de tudo)
# ═══════════════════════════════════════════════════════════════════════
CHANGED_FILES=""
if [ -n "${PREVIOUS_TAG:-}" ]; then
  CHANGED_FILES=$(git diff --name-only "$PREVIOUS_TAG..$VERSION" || true)
else
  CHANGED_FILES="__NO_PREVIOUS_TAG__"
fi

# ═══════════════════════════════════════════════════════════════════════
# should_build() - Verifica se padrão de arquivo mudou
# ═══════════════════════════════════════════════════════════════════════
should_build() {
  local pattern="$1"
  echo "$CHANGED_FILES" | grep -qE "$pattern"
}

# ═══════════════════════════════════════════════════════════════════════
# image_exists() - Verifica se imagem existe no registry
# ═══════════════════════════════════════════════════════════════════════
image_exists() {
  local img="$1"
  local max_attempts="${2:-3}"
  local delay=5
  local attempt=1
  local inspect_output=""

  while [ "$attempt" -le "$max_attempts" ]; do
    inspect_output="$(timeout 30 docker manifest inspect "$img" 2>&1)" && return 0

    # Erro determinístico de inexistência: não adianta retry
    if echo "$inspect_output" | grep -Eqi "manifest unknown|name unknown|repository does not exist|no such manifest|not found"; then
      return 1
    fi

    # Erro determinístico de auth/permissão: falha explícita para troubleshooting
    if echo "$inspect_output" | grep -Eqi "unauthorized|authentication required|insufficient_scope|denied|forbidden|no basic auth credentials"; then
      echo "❌ ERRO de autenticação ao verificar imagem no registry: $img" >&2
      echo "   Detalhe: ${inspect_output:0:240}" >&2
      return 1
    fi

    if [ "$attempt" -lt "$max_attempts" ]; then
      echo "⚠️ Falha transitória ao verificar imagem '$img' (tentativa ${attempt}/${max_attempts}). Retry em ${delay}s..." >&2
      sleep "$delay"
      delay=$((delay * 2))
    fi
    attempt=$((attempt + 1))
  done

  echo "⚠️ Não foi possível confirmar existência da imagem '$img' após ${max_attempts} tentativas." >&2
  return 1
}

# ═══════════════════════════════════════════════════════════════════════
# retag_image() - Retag de imagem no registry (sem rebuild)
# ═══════════════════════════════════════════════════════════════════════
# ENTERPRISE: 1 operação única para atualizar a tag de release + 'latest'
# (reduz chamadas ao registry e acelera o workflow sem perder rastreabilidade)
# ═══════════════════════════════════════════════════════════════════════
retag_image() {
  local image_name="$1"
  local from_tag="$2"
  local to_tag="$3"
  local full_from="${IMAGE_PREFIX}-${image_name}:${from_tag}"
  local full_to="${IMAGE_PREFIX}-${image_name}:${to_tag}"
  local max_attempts=3
  local delay=10
  local attempt=1
  local retag_output=""

  echo "Retagging $image_name: $from_tag -> $to_tag"
  while [ "$attempt" -le "$max_attempts" ]; do
    retag_output="$(docker buildx imagetools create \
      -t "$full_to" \
      -t "${IMAGE_PREFIX}-${image_name}:latest" \
      "$full_from" 2>&1)" && {
      echo "$retag_output"
      return 0
    }

    # Erro determinístico de auth/permissão: abortar imediatamente
    if echo "$retag_output" | grep -Eqi "unauthorized|authentication required|insufficient_scope|denied|forbidden|no basic auth credentials"; then
      echo "❌ ERRO de autenticação ao retaggear $image_name (${from_tag} -> ${to_tag})" >&2
      echo "   Detalhe: ${retag_output:0:240}" >&2
      return 1
    fi

    if [ "$attempt" -lt "$max_attempts" ]; then
      echo "⚠️ Falha transitória ao retaggear $image_name (tentativa ${attempt}/${max_attempts}). Retry em ${delay}s..." >&2
      sleep "$delay"
      delay=$((delay * 2))
    fi
    attempt=$((attempt + 1))
  done

  echo "❌ Falha ao retaggear $image_name após ${max_attempts} tentativas" >&2
  return 1
}

# ═══════════════════════════════════════════════════════════════════════
# decide_build_or_retag() - Decisão enterprise: BUILD ou RETAG
# ═══════════════════════════════════════════════════════════════════════
# Retorna via variável NEEDS_BUILD: 1 = build, 0 = retag
#
# Guard FORCE_FULL_REBUILD (23/02/2026):
# Se FORCE_FULL_REBUILD=true (release anterior sem manifesto de imagens),
# sempre faz build para garantir integridade das imagens. Isso previne
# retag de imagens potencialmente incompletas de releases parcialmente
# com falha. REF: CLAUDE.md Regra 6 (Enterprise-grade).
# ═══════════════════════════════════════════════════════════════════════
decide_build_or_retag() {
  local image="$1"
  local build_pattern="$2"

  NEEDS_BUILD=1  # default: build

  # Guard: release anterior sem manifesto de imagens → rebuild forçado
  # Previne retag de imagens de release com falha parcial (CLAUDE.md Regra 6)
  if [ "${FORCE_FULL_REBUILD:-false}" = "true" ]; then
    return
  fi

  if [ -n "${PREVIOUS_TAG:-}" ] && ! should_build "$build_pattern"; then
    # Sem mudanças relevantes: tentar retag do release anterior
    local from_img="${IMAGE_PREFIX}-${image}:${PREVIOUS_TAG}"
    if image_exists "$from_img"; then
      NEEDS_BUILD=0
    fi
  fi
}
