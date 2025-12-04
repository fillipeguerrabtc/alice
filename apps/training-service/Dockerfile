# ==============================================================================
# Alice Enterprise Platform - Training Service
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

# Atualizar pacotes do sistema, npm para versão específica (determinismo), e habilitar corepack
# ORDEM CRÍTICA: npm upgrade ANTES de corepack (corepack cria shims que interceptam npm)
RUN apk update && apk upgrade --no-cache && npm install -g npm@11.6.4 && corepack enable

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
COPY apps/training-service/package.json ./apps/training-service/

# Copiar script de build
COPY scripts/build-service.mjs ./scripts/

# Instalar TODAS as dependências
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install

# Copiar código fonte dos pacotes e serviço
COPY packages/ ./packages/
COPY apps/training-service/ ./apps/training-service/

# Compilar pacotes internos primeiro (ordem de dependências)
RUN pnpm run build:packages

# Criar bundle com esbuild (inclui @alice/* inline)
RUN pnpm --filter @alice/training-service run build

# ==============================================================================
# Stage: pruner - Extrair apenas dependências de produção do serviço
# Usa pnpm deploy para extrair produção (determinístico via lockfile original)
# ==============================================================================
FROM builder AS pruner
WORKDIR /app

# Usar pnpm deploy para extrair dependências de produção (--legacy para pnpm v10)
# O bundle.js já contém @alice/*, então precisamos apenas das deps externas
RUN pnpm --filter @alice/training-service deploy --prod --legacy /prod/training-service

# ==============================================================================
# Stage: runner - Google Distroless para ZERO CVEs em produção
# SEGURANÇA ENTERPRISE: Sem shell, sem package manager, sem utilitários
# Referência: https://github.com/GoogleContainerTools/distroless
# ==============================================================================
FROM gcr.io/distroless/nodejs22-debian12 AS runner

# Variáveis de ambiente (Distroless suporta ENV)
ENV NODE_ENV=production
ENV SERVICE_NAME=training-service
ENV PORT=3004

WORKDIR /app

# Copiar dependências de produção extraídas pelo pnpm deploy
COPY --from=pruner /prod/training-service/node_modules ./node_modules

# Copiar bundle compilado (com @alice/* inline)
COPY --from=builder /app/apps/training-service/dist/bundle.js ./dist/bundle.js
COPY --from=builder /app/apps/training-service/dist/bundle.js.map ./dist/bundle.js.map

# Distroless já roda como nonroot por padrão (uid 65532)
USER nonroot

EXPOSE 3004

# Health check compatível com Distroless (usa node diretamente, não shell)
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD ["/nodejs/bin/node", "-e", "require('http').get('http://localhost:3004/ready', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"]

# Entrypoint do Distroless nodejs já é /nodejs/bin/node
CMD ["dist/bundle.js"]
