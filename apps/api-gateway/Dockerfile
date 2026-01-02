# ==============================================================================
# Alice Enterprise Platform - API Gateway (Node.js - Dev Only)
# Documentação em PT-BR (Regra 10 CLAUDE.md)
# ==============================================================================
FROM node:22-alpine3.21 AS builder

WORKDIR /app

# Instalar pnpm
RUN npm install -g pnpm@10.26.2

# Copiar arquivos de configuração do workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api-gateway/package.json ./apps/api-gateway/
COPY packages/shared-utils/package.json ./packages/shared-utils/
COPY packages/config/package.json ./packages/config/
COPY packages/logger/package.json ./packages/logger/

# Instalar dependências
RUN pnpm install --frozen-lockfile

# Copiar código fonte
COPY apps/api-gateway ./apps/api-gateway
COPY packages ./packages

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
