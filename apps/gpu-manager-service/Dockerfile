# ==============================================================================
# Alice Enterprise Platform - GPU Manager Service
# Dockerfile Enterprise com Node.js Alpine (seguro, sem CVEs conhecidos)
# 
# CORREÇÃO 31/12/2025: Migrado de gcr.io/distroless/nodejs22-debian12 para node:22-alpine
# MOTIVO: CVE-2023-45853 (CRITICAL) em zlib1g do Debian 12 - status "will_not_fix"
# Alpine Linux usa zlib 1.3.1+ que já corrigiu esta vulnerabilidade.
#
# SEGURANÇA:
# - Non-root container (usuário 'node')
# - Alpine Linux com zlib corrigido (CVE-2023-45853 resolvido)
# - Imagem mínima (~50MB vs ~200MB)
# - read_only filesystem em produção (via docker-compose)
# 
# Author: Fillipe Guerra
# Data: 31 de Dezembro de 2025
# Documentação em PT-BR (Regra 10 CLAUDE.md)
# ==============================================================================

# ==============================================================================
# Stage: base - Node.js Alpine para build (tem shell para pnpm/npm)
# ==============================================================================
# CORREÇÃO CVE-2023-45853 (31/12/2025): Alpine 3.21 usa zlib 1.3.1+ (sem CVE)
FROM node:22-alpine3.21 AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# pnpm v10+: permitir execução automática de scripts de build de dependências
ENV NPM_CONFIG_DANGEROUSLY_ALLOW_ALL_BUILDS=true

# Atualizar pacotes do sistema e habilitar corepack para pnpm
RUN set -e; \
    ver="$(cat /etc/alpine-release 2>/dev/null | cut -d. -f1,2 || true)"; \
    if [ -z "$ver" ]; then ver="3.20"; fi; \
    { \
      echo "https://dl-cdn.alpinelinux.org/alpine/v${ver}/main"; \
      echo "https://dl-cdn.alpinelinux.org/alpine/v${ver}/community"; \
      echo "http://dl-4.alpinelinux.org/alpine/v${ver}/main"; \
      echo "http://dl-4.alpinelinux.org/alpine/v${ver}/community"; \
    } > /etc/apk/repositories; \
    success=0; \
    for i in 1 2 3; do \
      if apk update && apk upgrade --no-cache; then success=1; break; fi; \
      echo "apk retry $i"; sleep $((5*i)); \
    done; \
    if [ "$success" -ne 1 ]; then echo "apk update/upgrade failed after retries"; exit 1; fi; \
    npm config set update-notifier false && corepack enable

# ==============================================================================
# Stage: builder - Compilar pacotes e criar bundle (determinístico)
# ==============================================================================
FROM base AS builder
WORKDIR /app

# Copiar arquivos de configuração do workspace (INCLUIR .npmrc!)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./

# Copiar package.json de cada pacote interno
COPY packages/shared/package.json ./packages/shared/
COPY packages/shared-utils/package.json ./packages/shared-utils/
COPY packages/config/package.json ./packages/config/
COPY packages/logger/package.json ./packages/logger/
COPY packages/database/package.json ./packages/database/

# Copiar package.json do serviço
COPY apps/gpu-manager-service/package.json ./apps/gpu-manager-service/

# Copiar script de build
COPY scripts/build-service.mjs ./scripts/

# Instalar TODAS as dependências
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install

# Copiar código fonte dos pacotes e serviço
COPY packages/ ./packages/
COPY apps/gpu-manager-service/ ./apps/gpu-manager-service/

# Compilar pacotes internos primeiro (ordem de dependências)
RUN pnpm run build:packages

# Reinstalar para injetar dist dos pacotes workspace (inject-workspace-packages)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Criar bundle com esbuild (inclui @alice/* inline)
RUN pnpm --filter @alice/gpu-manager-service run build

# ==============================================================================
# Stage: pruner - Extrair apenas dependências de produção do serviço
# Usa pnpm deploy para extrair produção (determinístico via lockfile original)
# ==============================================================================
FROM builder AS pruner
WORKDIR /app

# Usar pnpm deploy para extrair dependências de produção (--legacy para pnpm v10)
# O bundle.js inclui @alice/* inline, então precisamos apenas das deps externas
RUN pnpm --filter @alice/gpu-manager-service deploy --prod --legacy /prod/gpu-manager-service

# ==============================================================================
# Stage: runner - Node.js Alpine para produção (SEGURO - sem CVE-2023-45853)
#
# CORREÇÃO 31/12/2025: Migrado de gcr.io/distroless/nodejs22-debian12 para node:22-alpine
# MOTIVO: CVE-2023-45853 (CRITICAL) em zlib1g do Debian 12 - "will_not_fix"
# Alpine Linux usa zlib 1.3.1+ que já tem a correção aplicada.
#
# SEGURANÇA:
# - Imagem oficial Node.js Alpine (mantida, patches regulares)
# - Usuário non-root (node, uid 1000)
# - zlib 1.3.1+ (CVE-2023-45853 corrigido)
# - Imagem mínima (~50MB vs ~200MB)
# - CA certificates já inclusos no Alpine
# ==============================================================================
FROM node:22-alpine3.21 AS runner

# Variáveis de ambiente
ENV NODE_ENV=production
ENV SERVICE_NAME=gpu-manager-service
ENV PORT=3010

# CORREÇÃO 31/12/2025: Alpine já inclui ca-certificates por padrão
# Apenas garantir que o sistema está atualizado com últimos patches de segurança
RUN apk update && apk upgrade --no-cache && rm -rf /var/cache/apk/*

WORKDIR /app

# Copiar dependências de produção extraídas pelo pnpm deploy
# Usando --chown para garantir que o usuário node tenha acesso
COPY --from=pruner --chown=node:node /prod/gpu-manager-service/node_modules ./node_modules

# Copiar bundle compilado (com @alice/* inline)
COPY --from=builder --chown=node:node /app/apps/gpu-manager-service/dist/bundle.js ./dist/bundle.js
COPY --from=builder --chown=node:node /app/apps/gpu-manager-service/dist/bundle.js.map ./dist/bundle.js.map

# Mudar para usuário non-root (segurança)
USER node

EXPOSE 3010

# Health check com handlers de erro e timeout
# /live verifica se processo está vivo (liveness probe)
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD node -e "const r=require('http').get('http://localhost:3010/live',{timeout:5000},(res)=>{res.resume();process.exit(res.statusCode===200?0:1)});r.on('error',()=>process.exit(1));r.on('timeout',()=>{r.destroy();process.exit(1)})"

CMD ["node", "dist/bundle.js"]
