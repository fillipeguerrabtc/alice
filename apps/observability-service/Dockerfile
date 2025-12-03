# ==============================================================================
# Alice Enterprise Platform - Observability Service
# Dockerfile Enterprise com suporte a pacotes @alice/* via pnpm workspace
# Health Checker para stack de observabilidade (Prometheus, Grafana, Jaeger)
# Documentação PT-BR (Regra 10 replit.md)
# ==============================================================================

# Usar Node.js 22 LTS Alpine para reduzir vulnerabilidades (menor superfície de ataque)
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# Atualizar pacotes do sistema para eliminar CVEs conhecidos
RUN apk update && apk upgrade --no-cache && corepack enable

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
# Stage: runner - Imagem final de produção (mínima)
# ==============================================================================
# Usar Node.js 22 LTS Alpine para imagem final (mínima e segura)
FROM node:22-alpine AS runner
ENV NODE_ENV=production
ENV SERVICE_NAME=observability-service
ENV PORT=3007

# Atualizar pacotes do sistema e criar usuário não-root
RUN apk update && apk upgrade --no-cache && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs alice

WORKDIR /app

# Copiar dependências de produção extraídas pelo pnpm deploy
COPY --from=pruner --chown=alice:nodejs /prod/observability-service/node_modules ./node_modules

# Copiar código compilado
COPY --from=builder --chown=alice:nodejs /app/apps/observability-service/dist ./dist

USER alice
EXPOSE 3007

# Health check - usa /ready para verificar dependências (Regra 16 - Kubernetes Best Practices 2025)
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3007/ready', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["node", "dist/index.js"]
