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
COPY apps/auth-service/package.json ./apps/auth-service/

# Copiar script de build
COPY scripts/build-service.mjs ./scripts/

# Instalar TODAS as dependências (determinístico via frozen-lockfile)
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
# Stage: pruner - Extrair apenas dependências de produção do serviço
# Usa pnpm deploy para extrair produção (determinístico via lockfile original)
# ==============================================================================
FROM builder AS pruner
WORKDIR /app

# Usar pnpm deploy para extrair dependências de produção
# O bundle.js já contém @alice/*, então precisamos apenas das deps externas
RUN pnpm --filter @alice/auth-service deploy --prod /prod/auth-service

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

# Copiar dependências de produção extraídas pelo pnpm deploy
COPY --from=pruner --chown=alice:nodejs /prod/auth-service/node_modules ./node_modules

# Copiar bundle compilado (com @alice/* inline)
COPY --from=builder --chown=alice:nodejs /app/apps/auth-service/dist/bundle.js ./dist/bundle.js
COPY --from=builder --chown=alice:nodejs /app/apps/auth-service/dist/bundle.js.map ./dist/bundle.js.map

USER alice
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/api/auth/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["node", "dist/bundle.js"]
