# ==============================================================================
# Alice Enterprise Platform - Training Service
# Dockerfile Enterprise usando pnpm deploy --filter (padrão oficial pnpm.io)
# Documentação em PT-BR (Regra 10 replit.md)
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

# Copiar package.json de cada pacote interno
COPY packages/shared/package.json ./packages/shared/
COPY packages/shared-utils/package.json ./packages/shared-utils/
COPY packages/config/package.json ./packages/config/
COPY packages/logger/package.json ./packages/logger/
COPY packages/database/package.json ./packages/database/

# Copiar package.json do serviço alvo
COPY apps/training-service/package.json ./apps/training-service/

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

# Compilar TODOS os pacotes na ordem correta de dependências
# Usa pnpm workspace recursivo para garantir ordem de build
RUN pnpm run build:packages

# Compilar o serviço
RUN pnpm --filter @alice/training-service run build

# Usar pnpm deploy para extrair apenas produção (padrão oficial)
RUN pnpm --filter @alice/training-service deploy --prod /prod/training-service

# ==============================================================================
# Stage: runner - Imagem final de produção (mínima)
# ==============================================================================
FROM node:20-slim AS runner
ENV NODE_ENV=production
ENV SERVICE_NAME=training-service
ENV PORT=3004

# Criar usuário não-root para segurança
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs alice

WORKDIR /app

# Copiar apenas o resultado do pnpm deploy (dependências de produção + código compilado)
COPY --from=builder --chown=alice:nodejs /prod/training-service ./

USER alice
EXPOSE 3004

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3004/api/training/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["node", "dist/index.js"]
