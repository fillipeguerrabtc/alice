FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

FROM base AS deps
WORKDIR /app

COPY apps/frontend-service/package.json ./apps/frontend-service/
COPY packages/shared/package.json ./packages/shared/

WORKDIR /app/packages/shared
RUN npm install

WORKDIR /app/apps/frontend-service
RUN npm install

FROM base AS builder
WORKDIR /app

COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/apps/frontend-service/node_modules ./apps/frontend-service/node_modules

COPY packages/shared ./packages/shared
COPY apps/frontend-service ./apps/frontend-service

WORKDIR /app/packages/shared
RUN npm run build

WORKDIR /app/apps/frontend-service
RUN npm run build

FROM nginx:alpine AS runner
COPY --from=builder /app/apps/frontend-service/dist /usr/share/nginx/html
COPY apps/frontend-service/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
