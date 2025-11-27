# Observability Health Checker - Alice Enterprise Platform
# 
# Imagem leve para health check do stack de observabilidade.
#
# Documentação PT-BR (Regra 10 replit.md)

FROM node:20-alpine AS builder

WORKDIR /app

# Copiar arquivos de dependências
COPY package.json ./

# Instalar dependências
RUN npm install

# Copiar código fonte
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# ============================================================================
# Imagem de produção
# ============================================================================

FROM node:20-alpine

WORKDIR /app

# Copiar apenas produção
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

# Instalar apenas dependências de produção
RUN npm install --production && npm cache clean --force

# Usuário não-root para segurança
RUN addgroup -g 1001 -S nodejs && \
    adduser -S observability -u 1001 -G nodejs

USER observability

# Variáveis de ambiente
ENV PORT=3007
ENV NODE_ENV=production

EXPOSE 3007

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3007/health || exit 1

CMD ["node", "dist/index.js"]
