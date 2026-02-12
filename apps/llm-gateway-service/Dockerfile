# ==============================================================================
# Alice Enterprise Platform - LLM Gateway Service
# Dockerfile Enterprise com Node.js Alpine (seguro, sem CVEs conhecidos)
#
# Ponto único de entrada para chamadas LLM. Resolve namespace/agente por rota,
# aplica adaptador LoRA, registra fallbacks e encaminha para GPU Manager.
#
# Plano Enterprise - Agentes Especializados por Namespace
#
# Author: Fillipe Guerra
# Data: 11 de Fevereiro de 2026
# ==============================================================================

FROM node:22-alpine3.21 AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NPM_CONFIG_DANGEROUSLY_ALLOW_ALL_BUILDS=true

RUN set -e; \
    ver="$(cat /etc/alpine-release 2>/dev/null | cut -d. -f1,2 || true)"; \
    if [ -z "$ver" ]; then ver="3.20"; fi; \
    { echo "https://dl-cdn.alpinelinux.org/alpine/v${ver}/main"; \
      echo "https://dl-cdn.alpinelinux.org/alpine/v${ver}/community"; } > /etc/apk/repositories; \
    apk update && apk upgrade --no-cache && \
    npm config set update-notifier false && corepack enable

FROM base AS builder
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/shared-utils/package.json ./packages/shared-utils/
COPY packages/config/package.json ./packages/config/
COPY packages/logger/package.json ./packages/logger/
COPY packages/database/package.json ./packages/database/
COPY apps/llm-gateway-service/package.json ./apps/llm-gateway-service/
COPY scripts/build-service.mjs ./scripts/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install

COPY packages/ ./packages/
COPY apps/llm-gateway-service/ ./apps/llm-gateway-service/

RUN pnpm run build:packages
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @alice/llm-gateway-service run build

FROM builder AS pruner
WORKDIR /app
RUN pnpm --filter @alice/llm-gateway-service deploy --prod --legacy /prod/llm-gateway-service

FROM node:22-alpine3.21 AS runner
ENV NODE_ENV=production
ENV SERVICE_NAME=llm-gateway-service
ENV PORT=3011

RUN apk update && apk upgrade --no-cache && rm -rf /var/cache/apk/*

WORKDIR /app
COPY --from=pruner --chown=node:node /prod/llm-gateway-service/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/apps/llm-gateway-service/dist/bundle.js ./dist/bundle.js
COPY --from=builder --chown=node:node /app/apps/llm-gateway-service/dist/bundle.js.map ./dist/bundle.js.map

USER node
EXPOSE 3011

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD node -e "const r=require('http').get('http://localhost:3011/live',{timeout:5000},(res)=>{res.resume();process.exit(res.statusCode===200?0:1)});r.on('error',()=>process.exit(1));r.on('timeout',()=>{r.destroy();process.exit(1)})"

CMD ["node", "dist/bundle.js"]
