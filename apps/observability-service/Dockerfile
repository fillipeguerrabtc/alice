# ==============================================================================
# Alice Enterprise Platform - Observability Service
# Dockerfile Enterprise com Google Distroless para ZERO CVEs
# Health Checker para stack de observabilidade (Prometheus, Grafana, Jaeger)
# Documentação PT-BR (Regra 10 CLAUDE.md)
# SEGURANÇA: Distroless não tem shell, reduzindo superfície de ataque
# ==============================================================================

# ==============================================================================
# Stage: base - Node.js Alpine para build (tem shell para pnpm/npm)
# ==============================================================================
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# Atualizar pacotes do sistema e habilitar corepack para pnpm
# NOTA: Não atualizamos npm global pois usamos APENAS pnpm via corepack
# Suprimir aviso de update do npm (determinismo, Regra 6) e tornar apk resiliente (mirrors + retry com fail-fast)
RUN set -e; \
    ver="$(cat /etc/alpine-release 2>/dev/null | cut -d. -f1,2 || true)"; \
    if [ -z "$ver" ]; then ver="3.20"; fi; \
    echo "https://dl-cdn.alpinelinux.org/alpine/v${ver}/main" > /etc/apk/repositories; \
    echo "https://dl-cdn.alpinelinux.org/alpine/v${ver}/community" >> /etc/apk/repositories; \
    success=0; \
    for i in 1 2 3; do \
      if apk update && apk upgrade --no-cache; then success=1; break; fi; \
      echo "apk retry $i"; sleep $((5*i)); \
    done; \
    if [ "$success" -ne 1 ]; then echo "apk update/upgrade failed after retries"; exit 1; fi; \
    npm config set update-notifier false && corepack enable

# ==============================================================================
# Stage: builder - Compilar pacotes e serviço
# ==============================================================================
FROM base AS builder
WORKDIR /app

# Copiar arquivos de configuração do workspace
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Copiar package.json de cada pacote interno usado
COPY packages/shared/package.json ./packages/shared/
COPY packages/shared-utils/package.json ./packages/shared-utils/
COPY packages/config/package.json ./packages/config/
COPY packages/logger/package.json ./packages/logger/
COPY packages/database/package.json ./packages/database/

# Copiar package.json do serviço
COPY apps/observability-service/package.json ./apps/observability-service/

# Instalar TODAS as dependências
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install

# Copiar código fonte dos pacotes e serviço
COPY packages/ ./packages/
COPY apps/observability-service/ ./apps/observability-service/

# Copiar tsconfig base para compilação
COPY packages/tsconfig.base.json ./packages/

# Compilar pacotes internos primeiro (ordem de dependências)
RUN pnpm run build:packages

# Compilar serviço
RUN pnpm --filter @alice/observability-service run build

# ==============================================================================
# Stage: pruner - Extrair apenas dependências de produção do serviço
# Usa pnpm deploy para extrair produção (determinístico via lockfile original)
# ==============================================================================
FROM builder AS pruner
WORKDIR /app

# Usar pnpm deploy para extrair dependências de produção (--legacy para pnpm v10)
RUN pnpm --filter @alice/observability-service deploy --prod --legacy /prod/observability-service

# ==============================================================================
# Stage: runner - Google Distroless para ZERO CVEs em produção
# SEGURANÇA ENTERPRISE: Sem shell, sem package manager, sem utilitários
# Referência: https://github.com/GoogleContainerTools/distroless
# ==============================================================================
FROM gcr.io/distroless/nodejs22-debian12 AS runner

# Variáveis de ambiente (Distroless suporta ENV)
ENV NODE_ENV=production
ENV SERVICE_NAME=observability-service
ENV PORT=3007

WORKDIR /app

# Copiar dependências de produção extraídas pelo pnpm deploy
COPY --from=pruner /prod/observability-service/node_modules ./node_modules

# Copiar código compilado
COPY --from=builder /app/apps/observability-service/dist ./dist

# Distroless já roda como nonroot por padrão (uid 65532)
USER nonroot

EXPOSE 3007

# Health check compatível com Distroless (usa node diretamente, não shell)
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD ["/nodejs/bin/node", "-e", "require('http').get('http://localhost:3007/ready', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"]

# Entrypoint do Distroless nodejs já é /nodejs/bin/node
CMD ["dist/index.js"]
