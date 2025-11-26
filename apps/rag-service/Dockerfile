FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY shared ./shared
COPY packages ./packages
COPY apps/rag-service ./apps/rag-service

WORKDIR /app/apps/rag-service
RUN npx tsc --skipLibCheck --outDir dist 2>&1 || true

FROM base AS runner
ENV NODE_ENV=production
ENV SERVICE_NAME=rag-service

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 alice

WORKDIR /app

COPY --from=deps --chown=alice:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=alice:nodejs /app/packages ./packages
COPY --from=builder --chown=alice:nodejs /app/shared ./shared
COPY --from=builder --chown=alice:nodejs /app/apps/rag-service/dist ./dist
COPY --from=builder --chown=alice:nodejs /app/apps/rag-service/src ./src
COPY --from=builder --chown=alice:nodejs /app/apps/rag-service/package.json ./

USER alice
EXPOSE 3003
CMD ["node", "--experimental-specifier-resolution=node", "--loader", "tsx/esm", "src/index.ts"]
