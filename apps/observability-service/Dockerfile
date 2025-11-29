# ==============================================================================
# Alice Enterprise Platform - Observability Service
# Dockerfile Enterprise - Serviço simples sem dependências @alice/*
# Health Checker para stack de observabilidade (Prometheus, Grafana, Jaeger)
# Documentação PT-BR (Regra 10 replit.md)
# ==============================================================================

FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ==============================================================================
# Stage: builder - Compilar serviço
# ==============================================================================
FROM base AS builder
WORKDIR /app

# Copiar apenas o necessário para o observability-service
COPY apps/observability-service/package.json ./package.json
COPY apps/observability-service/tsconfig.json ./tsconfig.json
COPY apps/observability-service/src ./src

# Instalar dependências
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install

# Compilar TypeScript
RUN pnpm run build

# ==============================================================================
# Stage: deps - Apenas dependências de produção
# ==============================================================================
FROM base AS deps
WORKDIR /app

COPY apps/observability-service/package.json ./package.json

# Instalar apenas dependências de produção
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --prod --no-frozen-lockfile

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

# Copiar dependências de produção
COPY --from=deps --chown=alice:nodejs /app/node_modules ./node_modules

# Copiar código compilado
COPY --from=builder --chown=alice:nodejs /app/dist ./dist

USER alice
EXPOSE 3007

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3007/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["node", "dist/index.js"]
