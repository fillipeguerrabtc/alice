# ==============================================================================
# Alice Enterprise Platform - Observability Service
# Dockerfile Enterprise usando pnpm deploy --filter (padrão oficial pnpm.io)
# Health Checker para stack de observabilidade (Prometheus, Grafana, Jaeger)
# Documentação PT-BR (Regra 10 replit.md)
# ==============================================================================

FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ==============================================================================
# Stage: deps - Copiar package.jsons para cache de dependências
# ==============================================================================
FROM base AS deps
WORKDIR /app

# Copiar arquivos de configuração do workspace
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Copiar package.json de cada pacote interno (observability não usa muitos)
COPY packages/shared/package.json ./packages/shared/
COPY packages/shared-utils/package.json ./packages/shared-utils/

# Copiar package.json do serviço alvo
COPY apps/observability-service/package.json ./apps/observability-service/

# Instalar todas as dependências (aproveitando cache)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ==============================================================================
# Stage: builder - Compilar pacotes e serviço
# ==============================================================================
FROM base AS builder
WORKDIR /app

# Copiar todo o código fonte
COPY . .

# Instalar dependências (com cache)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Compilar pacotes internos na ordem de dependências
RUN pnpm --filter @alice/shared run build
RUN pnpm --filter @alice/shared-utils run build

# Compilar o serviço
RUN pnpm --filter @alice/observability-service run build

# Usar pnpm deploy para extrair apenas produção (padrão oficial)
RUN pnpm --filter @alice/observability-service deploy --prod /prod/observability-service

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

# Copiar apenas o resultado do pnpm deploy (dependências de produção + código compilado)
COPY --from=builder --chown=alice:nodejs /prod/observability-service ./

USER alice
EXPOSE 3007

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3007/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["node", "dist/index.js"]
