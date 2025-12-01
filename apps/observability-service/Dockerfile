# ==============================================================================
# Alice Enterprise Platform - Observability Service
# Dockerfile Enterprise com suporte a pacotes @alice/* via pnpm workspace
# Health Checker para stack de observabilidade (Prometheus, Grafana, Jaeger)
# Documentação PT-BR (Regra 10 replit.md)
# ==============================================================================

FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

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
FROM node:20-slim AS runner
ENV NODE_ENV=production
ENV SERVICE_NAME=observability-service
ENV PORT=3007

# Criar usuário não-root para segurança
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs alice

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
