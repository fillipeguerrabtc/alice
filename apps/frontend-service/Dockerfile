# ==============================================================================
# Alice Enterprise Platform - Frontend Service
# Dockerfile Enterprise com nginx:1.27-alpine para servir SPA React
# Documentação em PT-BR (Regra 10 CLAUDE.md)
# NOTA: Frontend usa nginx para servir arquivos estáticos (não há Distroless nginx)
# SEGURANÇA: Non-root container + Alpine hardened
# ==============================================================================

# ==============================================================================
# Stage: base - Node.js Alpine para build (tem shell para pnpm/npm)
# ==============================================================================
# CORREÇÃO CVE-2023-45853 (31/12/2025): Alpine 3.21 usa zlib 1.3.1+ (sem CVE)
FROM node:22-alpine3.21 AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# pnpm v10+: permitir execução automática de scripts de build de dependências
# DURANTE o build da imagem (evita warning de `approve-builds` no Docker build).
# Não afeta o desenvolvimento local (fora do container).
ENV NPM_CONFIG_DANGEROUSLY_ALLOW_ALL_BUILDS=true

# Atualizar pacotes do sistema e habilitar corepack para pnpm
# NOTA: Não atualizamos npm global pois usamos APENAS pnpm via corepack
# Suprimir aviso de update do npm (determinismo, Regra 6) e tornar apk resiliente (mirrors + retry com fail-fast)
RUN set -e; \
    ver="$(cat /etc/alpine-release 2>/dev/null | cut -d. -f1,2 || true)"; \
    if [ -z "$ver" ]; then ver="3.20"; fi; \
    { \
      echo "https://dl-cdn.alpinelinux.org/alpine/v${ver}/main"; \
      echo "https://dl-cdn.alpinelinux.org/alpine/v${ver}/community"; \
      echo "http://dl-4.alpinelinux.org/alpine/v${ver}/main"; \
      echo "http://dl-4.alpinelinux.org/alpine/v${ver}/community"; \
    } > /etc/apk/repositories; \
    success=0; \
    for i in 1 2 3; do \
      if apk update && apk upgrade --no-cache; then success=1; break; fi; \
      echo "apk retry $i"; sleep $((5*i)); \
    done; \
    if [ "$success" -ne 1 ]; then echo "apk update/upgrade failed after retries"; exit 1; fi; \
    npm config set update-notifier false && corepack enable

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
# NOTA: Não existe Distroless nginx, então usamos nginx:1.27-alpine (hardened)
# ==============================================================================
# CORREÇÃO CVE-2023-45853 (31/12/2025): Alpine 3.21 usa zlib 1.3.1+ (sem CVE)
FROM nginx:1.27-alpine3.21 AS runner
ENV SERVICE_NAME=frontend-service

# SEGURANÇA: Atualizar pacotes e configurar nginx para rodar como non-root
# 1. Atualizar pacotes do sistema para eliminar CVEs conhecidos
# 2. Remover diretiva 'user' do nginx.conf principal (requer root para setuid)
# 3. Ajustar permissões de diretórios necessários
# 4. Remover pacotes desnecessários para reduzir superfície de ataque
RUN apk update && apk upgrade --no-cache && \
    sed -i 's/user  nginx;/#user  nginx;/' /etc/nginx/nginx.conf && \
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
    chown -R nginx:nginx /usr/share/nginx/html && \
    rm -rf /var/cache/apk/*

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
