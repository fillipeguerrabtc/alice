# ==============================================================================
# Alice Enterprise Platform - Chat Service
# Build sem npm workspaces - compila pacotes manualmente
# Documentação em PT-BR (Regra 10 replit.md)
# ==============================================================================

FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat python3 make g++ curl
WORKDIR /app

# ==============================================================================
# Stage: deps - Instalar dependências do root
# ==============================================================================
FROM base AS deps
WORKDIR /app

# Copiar package.json do root (sem workspaces) e instalar
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts || npm install --ignore-scripts

# ==============================================================================
# Stage: builder - Compilar todos os pacotes
# ==============================================================================
FROM base AS builder
WORKDIR /app

# Copiar node_modules do root
COPY --from=deps /app/node_modules ./node_modules

# Copiar código fonte completo
COPY package.json tsconfig.json ./
COPY packages ./packages
COPY shared ./shared
COPY apps/chat-service ./apps/chat-service

# Instalar dependências específicas de cada pacote interno
WORKDIR /app/packages/shared
RUN npm install --ignore-scripts 2>/dev/null || true

WORKDIR /app/packages/config
RUN npm install --ignore-scripts 2>/dev/null || true

WORKDIR /app/packages/logger
RUN npm install --ignore-scripts 2>/dev/null || true

WORKDIR /app/packages/database
RUN npm install --ignore-scripts 2>/dev/null || true

# Compilar pacotes na ordem de dependências
WORKDIR /app/packages/shared
RUN npx tsc --skipLibCheck 2>/dev/null || true

WORKDIR /app/packages/config
RUN npx tsc --skipLibCheck 2>/dev/null || true

WORKDIR /app/packages/logger
RUN npx tsc --skipLibCheck 2>/dev/null || true

WORKDIR /app/packages/database
RUN npx tsc --skipLibCheck 2>/dev/null || true

# Criar links simbólicos em node_modules/@alice
WORKDIR /app
RUN mkdir -p node_modules/@alice && \
    ln -sf ../../packages/shared node_modules/@alice/shared && \
    ln -sf ../../packages/config node_modules/@alice/config && \
    ln -sf ../../packages/logger node_modules/@alice/logger && \
    ln -sf ../../packages/database node_modules/@alice/database

# Instalar dependências do chat-service
WORKDIR /app/apps/chat-service
RUN npm install --ignore-scripts 2>/dev/null || true

# Compilar chat-service (opcional - usamos tsx em runtime)
RUN npx tsc --skipLibCheck --outDir dist 2>/dev/null || true

# ==============================================================================
# Stage: runner - Imagem final de produção
# ==============================================================================
FROM base AS runner
ENV NODE_ENV=production
ENV SERVICE_NAME=chat-service

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 alice

WORKDIR /app

# Copiar estrutura completa com pacotes compilados
COPY --from=builder --chown=alice:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=alice:nodejs /app/packages ./packages
COPY --from=builder --chown=alice:nodejs /app/shared ./shared
COPY --from=builder --chown=alice:nodejs /app/apps/chat-service ./apps/chat-service

# Recriar symlinks no runner (COPY não preserva symlinks)
RUN mkdir -p node_modules/@alice && \
    rm -rf node_modules/@alice/* && \
    ln -sf ../../packages/shared node_modules/@alice/shared && \
    ln -sf ../../packages/config node_modules/@alice/config && \
    ln -sf ../../packages/logger node_modules/@alice/logger && \
    ln -sf ../../packages/database node_modules/@alice/database

# Definir diretório de trabalho do serviço
WORKDIR /app/apps/chat-service

USER alice
EXPOSE 3002
CMD ["node", "--experimental-specifier-resolution=node", "--import=tsx", "src/index.ts"]
