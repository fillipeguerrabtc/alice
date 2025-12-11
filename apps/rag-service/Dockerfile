# ==============================================================================
# Alice Enterprise Platform - RAG Service
# Dockerfile Enterprise com Node.js Bookworm Slim + FFmpeg
# 
# NOTA: Este serviço usa node:22-bookworm-slim em vez de Distroless porque
# precisa de FFmpeg para processamento de vídeos. A imagem bookworm-slim é
# mantida pelo time oficial do Node.js e é segura para produção.
#
# SEGURANÇA:
# - Non-root container (usuário 'node')
# - Apenas dependências necessárias instaladas
# - read_only filesystem em produção (via docker-compose)
# 
# Documentação em PT-BR (Regra 10 CLAUDE.md)
# ==============================================================================

# ==============================================================================
# Stage: base - Node.js Alpine para build (tem shell para pnpm/npm)
# ==============================================================================
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# Atualizar pacotes do sistema e habilitar corepack para pnpm
# NOTA: Não atualizamos npm global pois usamos APENAS pnpm via corepack
# Suprimir aviso de update do npm (determinismo, Regra 6) e tornar apk resiliente (mirrors + retry com fail-fast)
RUN set -e; \
    ver="$(cat /etc/alpine-release 2>/dev/null | cut -d. -f1,2 || true)"; \
    if [ -z "$ver" ]; then ver="3.20"; fi; \
    echo "https://dl-cdn.alpinelinux.org/alpine/v${ver}/main" > /etc/apk/repositories; \
    echo "https://dl-cdn.alpinelinux.org/alpine/v${ver}/community" >> /etc/apk/repositories; \
    success=0; \
    for i in 1 2 3; do \
      if apk update && apk upgrade --no-cache; then success=1; break; fi; \
      echo "apk retry $i"; sleep $((5*i)); \
    done; \
    if [ "$success" -ne 1 ]; then echo "apk update/upgrade failed after retries"; exit 1; fi; \
    npm config set update-notifier false && corepack enable

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
COPY apps/rag-service/package.json ./apps/rag-service/

# Copiar script de build
COPY scripts/build-service.mjs ./scripts/

# Instalar TODAS as dependências
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install

# Copiar código fonte dos pacotes e serviço
COPY packages/ ./packages/
COPY apps/rag-service/ ./apps/rag-service/

# Compilar pacotes internos primeiro (ordem de dependências)
RUN pnpm run build:packages

# Criar bundle com esbuild (inclui @alice/* inline)
RUN pnpm --filter @alice/rag-service run build

# ==============================================================================
# Stage: pruner - Extrair apenas dependências de produção do serviço
# Usa pnpm deploy para extrair produção (determinístico via lockfile original)
# ==============================================================================
FROM builder AS pruner
WORKDIR /app

# Usar pnpm deploy para extrair dependências de produção (--legacy para pnpm v10)
# O bundle.js já contém @alice/*, então precisamos apenas das deps externas
RUN pnpm --filter @alice/rag-service deploy --prod --legacy /prod/rag-service

# ==============================================================================
# Stage: runner - Node.js Bookworm Slim + FFmpeg para produção
# 
# NOTA: Usamos bookworm-slim em vez de Distroless porque este serviço precisa
# de FFmpeg para processamento de vídeos. A imagem é segura e mantida.
# 
# SEGURANÇA:
# - Imagem oficial Node.js (mantida, patches de segurança regulares)
# - Usuário non-root (node, uid 1000)
# - Apenas FFmpeg instalado (mínimo necessário)
# - apt cache limpo após instalação
# ==============================================================================
FROM node:22-bookworm-slim AS runner

# Variáveis de ambiente
ENV NODE_ENV=production
ENV SERVICE_NAME=rag-service
ENV PORT=3003

# Instalar FFmpeg para processamento de vídeo
# FFmpeg é necessário para:
# - Extração de áudio de vídeos (para transcrição Whisper)
# - Extração de frames para CLIP embeddings
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ffmpeg \
        ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    apt-get clean

WORKDIR /app

# Copiar dependências de produção extraídas pelo pnpm deploy
# Usando --chown para garantir que o usuário node tenha acesso
COPY --from=pruner --chown=node:node /prod/rag-service/node_modules ./node_modules

# Copiar bundle compilado (com @alice/* inline)
COPY --from=builder --chown=node:node /app/apps/rag-service/dist/bundle.js ./dist/bundle.js
COPY --from=builder --chown=node:node /app/apps/rag-service/dist/bundle.js.map ./dist/bundle.js.map

# Mudar para usuário non-root (segurança)
USER node

EXPOSE 3003

# Health check com handlers de erro e timeout (mesmo padrão do docker-compose.prod.yml)
# IMPORTANTE: Usa /ready que verifica PostgreSQL + embeddings (não /health que sempre retorna 200)
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD node -e "const r=require('http').get('http://localhost:3003/ready',{timeout:5000},(res)=>{res.resume();process.exit(res.statusCode===200?0:1)});r.on('error',()=>process.exit(1));r.on('timeout',()=>{r.destroy();process.exit(1)})"

CMD ["node", "dist/bundle.js"]
