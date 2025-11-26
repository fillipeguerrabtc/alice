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
COPY apps/integrations-service ./apps/integrations-service

WORKDIR /app/apps/integrations-service
RUN npx tsc --skipLibCheck --outDir dist 2>&1 || true

FROM base AS runner
ENV NODE_ENV=production
ENV SERVICE_NAME=integrations-service

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 alice

WORKDIR /app

COPY --from=deps --chown=alice:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=alice:nodejs /app/packages ./packages
COPY --from=builder --chown=alice:nodejs /app/shared ./shared
COPY --from=builder --chown=alice:nodejs /app/apps/integrations-service/dist ./dist
COPY --from=builder --chown=alice:nodejs /app/apps/integrations-service/src ./src
COPY --from=builder --chown=alice:nodejs /app/apps/integrations-service/package.json ./

USER alice
EXPOSE 3005
CMD ["node", "--experimental-specifier-resolution=node", "--loader", "tsx/esm", "src/index.ts"]
