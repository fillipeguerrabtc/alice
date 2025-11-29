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
    pnpm install

# ==============================================================================
# Stage: builder - Compilar pacotes e serviço
# ==============================================================================
FROM base AS builder
WORKDIR /app

# Copiar todo o código fonte
COPY . .

# Instalar dependências (com cache)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install

# Compilar TODOS os pacotes na ordem correta de dependências
# Usa pnpm workspace recursivo para garantir ordem de build
RUN pnpm run build:packages

# Compilar o frontend (gera assets estáticos)
RUN pnpm --filter @alice/frontend-service run build

# ==============================================================================
# Stage: runner - Nginx para servir assets estáticos
# SEGURANÇA: Non-root container (Docker 2025 + OWASP Container Security)
# ==============================================================================
FROM nginx:alpine AS runner
ENV SERVICE_NAME=frontend-service

# SEGURANÇA: Configurar nginx para rodar como non-root
# 1. Remover diretiva 'user' do nginx.conf principal (requer root para setuid)
# 2. Ajustar permissões de diretórios necessários
RUN sed -i 's/user  nginx;/#user  nginx;/' /etc/nginx/nginx.conf && \
    mkdir -p /var/cache/nginx/client_temp && \
    mkdir -p /var/cache/nginx/proxy_temp && \
    mkdir -p /var/cache/nginx/fastcgi_temp && \
    mkdir -p /var/cache/nginx/uwsgi_temp && \
    mkdir -p /var/cache/nginx/scgi_temp && \
    chown -R nginx:nginx /var/cache/nginx && \
    chown -R nginx:nginx /var/log/nginx && \
    chown -R nginx:nginx /etc/nginx/conf.d && \
    touch /var/run/nginx.pid && \
    chown nginx:nginx /var/run/nginx.pid && \
    chown -R nginx:nginx /usr/share/nginx/html

# Copiar assets compilados para Nginx
COPY --from=builder --chown=nginx:nginx /app/apps/frontend-service/dist /usr/share/nginx/html

# Copiar configuração Nginx customizada
COPY --chown=nginx:nginx apps/frontend-service/nginx.conf /etc/nginx/conf.d/default.conf

# SEGURANÇA: Mudar para usuário non-root (nginx já existe na imagem base)
USER nginx

# Health check (porta 8080 para non-root)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
