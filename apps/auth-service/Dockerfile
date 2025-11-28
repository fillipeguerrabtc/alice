# ==============================================================================
# Alice Enterprise Platform - Auth Service
# Dockerfile Enterprise com esbuild bundling para pacotes @alice/*
# Documentação em PT-BR (Regra 10 replit.md)
# ==============================================================================

FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ==============================================================================
# Stage: builder - Compilar pacotes e criar bundle
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
COPY apps/auth-service/package.json ./apps/auth-service/

# Copiar script de build
COPY scripts/build-service.mjs ./scripts/

# Instalar TODAS as dependências (incluindo devDependencies para build)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Copiar código fonte dos pacotes e serviço
COPY packages/ ./packages/
COPY apps/auth-service/ ./apps/auth-service/

# Compilar pacotes internos primeiro (ordem de dependências)
RUN pnpm run build:packages

# Criar bundle com esbuild (inclui @alice/* inline)
RUN pnpm --filter @alice/auth-service run build

# ==============================================================================
# Stage: deps - Instalar apenas dependências de produção
# ==============================================================================
FROM base AS deps
WORKDIR /app

# Instalar jq para manipulação JSON (ESM-compatible)
RUN apt-get update && apt-get install -y --no-install-recommends jq && rm -rf /var/lib/apt/lists/*

# Copiar package.json e lockfile do serviço
COPY apps/auth-service/package.json ./package.json.original
COPY pnpm-lock.yaml ./

# Remover dependências @alice/* do package.json usando jq (ESM-compatible)
RUN jq 'del(.dependencies[] | select(startswith("@alice/"))) | del(.dependencies | to_entries[] | select(.key | startswith("@alice/"))) | .dependencies = (.dependencies // {} | with_entries(select(.key | startswith("@alice/") | not)))' package.json.original > package.json

# Instalar apenas dependências de produção externas (determinístico)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile

# ==============================================================================
# Stage: runner - Imagem final de produção (mínima)
# ==============================================================================
FROM node:20-slim AS runner
ENV NODE_ENV=production
ENV SERVICE_NAME=auth-service
ENV PORT=3001

# Criar usuário não-root para segurança
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs alice

WORKDIR /app

# Copiar dependências de produção
COPY --from=deps --chown=alice:nodejs /app/node_modules ./node_modules

# Copiar bundle compilado
COPY --from=builder --chown=alice:nodejs /app/apps/auth-service/dist/bundle.js ./dist/bundle.js
COPY --from=builder --chown=alice:nodejs /app/apps/auth-service/dist/bundle.js.map ./dist/bundle.js.map

USER alice
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/api/auth/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["node", "dist/bundle.js"]
