# =============================================================================
# Alice Enterprise Platform - GPU Manager Service
# =============================================================================
# Dockerfile para GPU Manager Service (gerenciamento centralizado de GPU)
# 
# Autor: Fillipe Guerra
# Data: 25 de Dezembro de 2025
# =============================================================================

FROM node:22-alpine AS builder

WORKDIR /app

# Copiar arquivos de dependências
COPY package.json pnpm-lock.yaml* ./
COPY packages/ ./packages/
COPY apps/gpu-manager-service/package.json ./apps/gpu-manager-service/
COPY tsconfig.json tsconfig.base.json ./

# Instalar dependências
# Determinismo: usar a mesma versão do workspace (packageManager em package.json)
RUN corepack enable && corepack prepare pnpm@10.26.1 --activate
RUN pnpm install --frozen-lockfile

# Copiar código fonte
COPY apps/gpu-manager-service/ ./apps/gpu-manager-service/

# Build
WORKDIR /app/apps/gpu-manager-service
RUN pnpm build

# =============================================================================
# Production
# =============================================================================

FROM node:22-alpine

WORKDIR /app

# Instalar curl para healthchecks
RUN apk add --no-cache curl

# Copiar node_modules e código compilado
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/gpu-manager-service/dist ./dist
COPY --from=builder /app/apps/gpu-manager-service/package.json ./

# Criar usuário não-root
RUN addgroup -g 1000 gpu-manager && \
    adduser -D -u 1000 -G gpu-manager gpu-manager && \
    chown -R gpu-manager:gpu-manager /app

USER gpu-manager

EXPOSE 3010

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3010/health || exit 1

CMD ["node", "dist/index.js"]

