# ==============================================================================
# Alice Enterprise Platform - Frontend Service
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

# Copiar package.json do serviço alvo
COPY apps/frontend-service/package.json ./apps/frontend-service/

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

# Compilar o frontend (gera assets estáticos)
RUN pnpm --filter @alice/frontend-service run build

# ==============================================================================
# Stage: runner - Nginx para servir assets estáticos
# ==============================================================================
FROM nginx:alpine AS runner
ENV SERVICE_NAME=frontend-service

# Copiar assets compilados para Nginx
COPY --from=builder /app/apps/frontend-service/dist /usr/share/nginx/html

# Copiar configuração Nginx customizada
COPY apps/frontend-service/nginx.conf /etc/nginx/conf.d/default.conf

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:80/health || exit 1

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
