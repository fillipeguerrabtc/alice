# ==============================================================================
# Alice Enterprise Platform - API Gateway (Node.js - Dev Only)
# Documentação em PT-BR (Regra 10 CLAUDE.md)
# ==============================================================================
FROM node:22-alpine3.21 AS builder

WORKDIR /app

# pnpm v10+: permitir execução automática de scripts de build de dependências
# DURANTE o build da imagem (evita warning de `approve-builds` no Docker build).
# Não afeta o desenvolvimento local (fora do container).
ENV NPM_CONFIG_DANGEROUSLY_ALLOW_ALL_BUILDS=true

# Habilitar corepack para pnpm (Best Practice 2025)
# Usa packageManager field do package.json (pnpm@10.26.2)
RUN npm config set update-notifier false && corepack enable

# Copiar arquivos de configuração do workspace (INCLUIR .npmrc!)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./

# Copiar package.json de cada pacote interno
COPY packages/shared/package.json ./packages/shared/
COPY packages/shared-utils/package.json ./packages/shared-utils/
COPY packages/config/package.json ./packages/config/
COPY packages/logger/package.json ./packages/logger/
COPY packages/database/package.json ./packages/database/

# Copiar package.json do serviço
COPY apps/api-gateway/package.json ./apps/api-gateway/

# Instalar dependências
RUN pnpm install --frozen-lockfile

# Copiar código fonte
COPY packages/ ./packages/
COPY apps/api-gateway/ ./apps/api-gateway/

# Compilar pacotes internos primeiro (ordem de dependências)
RUN pnpm run build:packages

# Build do serviço
RUN pnpm --filter @alice/api-gateway build

# Stage final
FROM node:22-alpine3.21

WORKDIR /app

# Usuário não-root por segurança
RUN addgroup -S nodejs && adduser -S nodejs -G nodejs
USER nodejs

# Copiar bundle e node_modules necessários
COPY --from=builder /app/apps/api-gateway/dist ./dist
COPY --from=builder /app/apps/api-gateway/node_modules ./node_modules

# Health check (Regra 16)
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

EXPOSE 3000

CMD ["node", "dist/bundle.js"]
