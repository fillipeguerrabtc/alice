FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat python3 make g++ curl
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY shared ./shared
COPY packages ./packages
COPY apps/training-service ./apps/training-service

WORKDIR /app/apps/training-service
RUN npx tsc --skipLibCheck --outDir dist 2>&1 || true

FROM base AS runner
ENV NODE_ENV=production
ENV SERVICE_NAME=training-service

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 alice

WORKDIR /app

COPY --from=deps --chown=alice:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=alice:nodejs /app/packages ./packages
COPY --from=builder --chown=alice:nodejs /app/shared ./shared
COPY --from=builder --chown=alice:nodejs /app/apps/training-service/dist ./dist
COPY --from=builder --chown=alice:nodejs /app/apps/training-service/src ./src
COPY --from=builder --chown=alice:nodejs /app/apps/training-service/package.json ./

USER alice
EXPOSE 3004
CMD ["node", "--experimental-specifier-resolution=node", "--import=tsx", "src/index.ts"]
