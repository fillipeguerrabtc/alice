# ==============================================================================
# Alice Enterprise Platform - GPU Manager Service
# Dockerfile Enterprise com Google Distroless para ZERO CVEs
# Documentação em PT-BR (Regra 10 CLAUDE.md)
# ==============================================================================

# ==============================================================================
# Stage: base - Node.js Alpine para build (tem shell para pnpm/npm)
# ==============================================================================
FROM node:22-alpine AS base
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

# Copiar arquivos de configuração do workspace
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

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

# Criar bundle com esbuild (inclui @alice/* inline)
RUN pnpm --filter @alice/gpu-manager-service run build

# ==============================================================================
# Stage: pruner - Extrair apenas dependências de produção do serviço
# Usa pnpm deploy para extrair produção (determinístico via lockfile original)
# ==============================================================================
FROM builder AS pruner
WORKDIR /app

# Usar pnpm deploy para extrair dependências de produção (--legacy para pnpm v10)
# O bundle.js já contém @alice/*, então precisamos apenas das deps externas
RUN pnpm --filter @alice/gpu-manager-service deploy --prod --legacy /prod/gpu-manager-service

# ==============================================================================
# Stage: runner - Google Distroless para ZERO CVEs em produção
# SEGURANÇA ENTERPRISE: Sem shell, sem package manager, sem utilitários
# Referência: https://github.com/GoogleContainerTools/distroless
# ==============================================================================
FROM gcr.io/distroless/nodejs22-debian12 AS runner

# Variáveis de ambiente (Distroless suporta ENV)
ENV NODE_ENV=production
ENV SERVICE_NAME=gpu-manager-service
ENV PORT=3010

WORKDIR /app

# Copiar dependências de produção extraídas pelo pnpm deploy
# NOTA: Distroless roda como nonroot (uid 65532) por padrão
COPY --from=pruner /prod/gpu-manager-service/node_modules ./node_modules

# Copiar bundle compilado (com @alice/* inline)
COPY --from=builder /app/apps/gpu-manager-service/dist/bundle.js ./dist/bundle.js
COPY --from=builder /app/apps/gpu-manager-service/dist/bundle.js.map ./dist/bundle.js.map

# Distroless já roda como nonroot por padrão (uid 65532)
USER nonroot

EXPOSE 3010

# Health check compatível com Distroless (usa node diretamente, não shell)
# /live verifica se processo está vivo (liveness probe)
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD ["/nodejs/bin/node", "-e", "require('http').get('http://localhost:3010/live', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"]

# Entrypoint do Distroless nodejs já é /nodejs/bin/node
CMD ["dist/bundle.js"]
