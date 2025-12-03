# ==============================================================================
# Alice Enterprise Platform - Integrations Service
# Dockerfile Enterprise com esbuild bundling para pacotes @alice/*
# Documentação em PT-BR (Regra 10 replit.md)
# ==============================================================================

# Usar Node.js 22 LTS Alpine para reduzir vulnerabilidades (menor superfície de ataque)
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# Atualizar pacotes do sistema para eliminar CVEs conhecidos
RUN apk update && apk upgrade --no-cache && corepack enable

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
COPY apps/integrations-service/package.json ./apps/integrations-service/

# Copiar script de build
COPY scripts/build-service.mjs ./scripts/

# Instalar TODAS as dependências
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install

# Copiar código fonte dos pacotes e serviço
COPY packages/ ./packages/
COPY apps/integrations-service/ ./apps/integrations-service/

# Compilar pacotes internos primeiro (ordem de dependências)
RUN pnpm run build:packages

# Criar bundle com esbuild (inclui @alice/* inline)
RUN pnpm --filter @alice/integrations-service run build

# ==============================================================================
# Stage: pruner - Extrair apenas dependências de produção do serviço
# Usa pnpm deploy para extrair produção (determinístico via lockfile original)
# ==============================================================================
FROM builder AS pruner
WORKDIR /app

# Usar pnpm deploy para extrair dependências de produção (--legacy para pnpm v10)
# O bundle.js já contém @alice/*, então precisamos apenas das deps externas
RUN pnpm --filter @alice/integrations-service deploy --prod --legacy /prod/integrations-service

# ==============================================================================
# Stage: runner - Imagem final de produção (mínima)
# ==============================================================================
# Usar Node.js 22 LTS Alpine para imagem final (mínima e segura)
FROM node:22-alpine AS runner
ENV NODE_ENV=production
ENV SERVICE_NAME=integrations-service
ENV PORT=3005

# Atualizar pacotes do sistema e criar usuário não-root
RUN apk update && apk upgrade --no-cache && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs alice

WORKDIR /app

# Copiar dependências de produção extraídas pelo pnpm deploy
COPY --from=pruner --chown=alice:nodejs /prod/integrations-service/node_modules ./node_modules

# Copiar bundle compilado (com @alice/* inline)
COPY --from=builder --chown=alice:nodejs /app/apps/integrations-service/dist/bundle.js ./dist/bundle.js
COPY --from=builder --chown=alice:nodejs /app/apps/integrations-service/dist/bundle.js.map ./dist/bundle.js.map

USER alice
EXPOSE 3005

# Health check - usa /ready para verificar dependências (Regra 16 - Kubernetes Best Practices 2025)
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3005/ready', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["node", "dist/bundle.js"]
