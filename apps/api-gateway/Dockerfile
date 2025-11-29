# ==============================================================================
# Alice Enterprise Platform - API Gateway (Traefik)
# Documentação em PT-BR (Regra 10 replit.md)
# SEGURANÇA: Traefik v3.3+ com configurações hardened
# ==============================================================================
FROM traefik:v3.3

# Copiar configurações do Traefik
COPY apps/api-gateway/config/traefik.yml /etc/traefik/traefik.yml
COPY apps/api-gateway/config/dynamic /etc/traefik/dynamic

# Criar diretório para certificados Let's Encrypt com permissões seguras
RUN mkdir -p /letsencrypt && \
    chmod 700 /letsencrypt

# NOTA: Traefik requer root para portas < 1024 (80, 443)
# Em produção, usar CAP_NET_BIND_SERVICE via docker-compose
# ou executar Traefik atrás de load balancer em porta alta

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD traefik healthcheck || exit 1

EXPOSE 80 443 8080 9090

CMD ["traefik"]
