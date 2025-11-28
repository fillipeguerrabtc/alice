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
COPY apps/auth-service ./apps/auth-service

WORKDIR /app/apps/auth-service
RUN npx tsc --skipLibCheck --outDir dist 2>&1 || true
RUN ls -la dist/ 2>/dev/null || echo "Dist vazio, copiando src"
RUN if [ ! -f "dist/index.js" ]; then mkdir -p dist && cp -r src/* dist/ 2>/dev/null || true; fi

FROM base AS runner
ENV NODE_ENV=production
ENV SERVICE_NAME=auth-service

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 alice

WORKDIR /app

COPY --from=deps --chown=alice:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=alice:nodejs /app/packages ./packages
COPY --from=builder --chown=alice:nodejs /app/shared ./shared
COPY --from=builder --chown=alice:nodejs /app/apps/auth-service/dist ./dist
COPY --from=builder --chown=alice:nodejs /app/apps/auth-service/src ./src
COPY --from=builder --chown=alice:nodejs /app/apps/auth-service/package.json ./

USER alice
EXPOSE 3001
CMD ["node", "--experimental-specifier-resolution=node", "--import=tsx", "src/index.ts"]
