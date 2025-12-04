# ==============================================================================
# Alice Enterprise Platform - Auth Service
# Dockerfile Enterprise com Google Distroless para ZERO CVEs
# Documentação em PT-BR (Regra 10 replit.md)
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
COPY apps/auth-service/package.json ./apps/auth-service/

# Copiar script de build
COPY scripts/build-service.mjs ./scripts/

# Instalar TODAS as dependências
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install

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

# Usar pnpm deploy para extrair dependências de produção (--legacy para pnpm v10)
# O bundle.js já contém @alice/*, então precisamos apenas das deps externas
RUN pnpm --filter @alice/auth-service deploy --prod --legacy /prod/auth-service

# ==============================================================================
# Stage: runner - Google Distroless para ZERO CVEs em produção
# SEGURANÇA ENTERPRISE: Sem shell, sem package manager, sem utilitários
# Referência: https://github.com/GoogleContainerTools/distroless
# ==============================================================================
FROM gcr.io/distroless/nodejs22-debian12 AS runner

# Variáveis de ambiente (Distroless suporta ENV)
ENV NODE_ENV=production
ENV SERVICE_NAME=auth-service
ENV PORT=3001

WORKDIR /app

# Copiar dependências de produção extraídas pelo pnpm deploy
# NOTA: Distroless roda como nonroot (uid 65532) por padrão
COPY --from=pruner /prod/auth-service/node_modules ./node_modules

# Copiar bundle compilado (com @alice/* inline)
COPY --from=builder /app/apps/auth-service/dist/bundle.js ./dist/bundle.js
COPY --from=builder /app/apps/auth-service/dist/bundle.js.map ./dist/bundle.js.map

# Distroless já roda como nonroot por padrão (uid 65532)
USER nonroot

EXPOSE 3001

# Health check compatível com Distroless (usa node diretamente, não shell)
# NOTA: Distroless não tem shell, então usamos node -e diretamente
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD ["/nodejs/bin/node", "-e", "require('http').get('http://localhost:3001/ready', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"]

# Entrypoint do Distroless nodejs já é /nodejs/bin/node
CMD ["dist/bundle.js"]
