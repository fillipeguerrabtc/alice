# ==============================================================================
# Alice Enterprise Platform - Auth Service
# Documentação em PT-BR (Regra 10 replit.md)
# ==============================================================================

FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat python3 make g++ curl
WORKDIR /app

# ==============================================================================
# Stage: deps - Instalar todas as dependências do monorepo
# ==============================================================================
FROM base AS deps
WORKDIR /app

# Copiar todos os package.json para npm workspaces
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/config/package.json ./packages/config/
COPY packages/logger/package.json ./packages/logger/
COPY packages/database/package.json ./packages/database/
COPY apps/auth-service/package.json ./apps/auth-service/

# Instalar dependências usando workspaces
RUN npm ci

# ==============================================================================
# Stage: builder - Compilar todos os pacotes
# ==============================================================================
FROM base AS builder
WORKDIR /app

# Copiar node_modules instalados
COPY --from=deps /app/node_modules ./node_modules

# Copiar código fonte completo
COPY package.json tsconfig.json ./
COPY packages ./packages
COPY shared ./shared
COPY apps/auth-service ./apps/auth-service

# Compilar pacotes na ordem de dependências
WORKDIR /app/packages/shared
RUN npm run build 2>/dev/null || npx tsc --skipLibCheck

WORKDIR /app/packages/config
RUN npm run build 2>/dev/null || npx tsc --skipLibCheck

WORKDIR /app/packages/logger
RUN npm run build 2>/dev/null || npx tsc --skipLibCheck

WORKDIR /app/packages/database
RUN npm run build 2>/dev/null || npx tsc --skipLibCheck

# Compilar auth-service
WORKDIR /app/apps/auth-service
RUN npm run build 2>/dev/null || npx tsc --skipLibCheck --outDir dist

# ==============================================================================
# Stage: runner - Imagem final de produção
# ==============================================================================
FROM base AS runner
ENV NODE_ENV=production
ENV SERVICE_NAME=auth-service

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 alice

WORKDIR /app

# Copiar estrutura completa do monorepo com pacotes compilados
COPY --from=builder --chown=alice:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=alice:nodejs /app/packages ./packages
COPY --from=builder --chown=alice:nodejs /app/shared ./shared
COPY --from=builder --chown=alice:nodejs /app/apps/auth-service ./apps/auth-service
COPY --from=builder --chown=alice:nodejs /app/package.json ./

# Definir diretório de trabalho do serviço
WORKDIR /app/apps/auth-service

USER alice
EXPOSE 3001
CMD ["node", "--experimental-specifier-resolution=node", "--import=tsx", "src/index.ts"]
