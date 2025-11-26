FROM traefik:v3.0

COPY config/traefik.yml /etc/traefik/traefik.yml
COPY config/dynamic /etc/traefik/dynamic

RUN mkdir -p /letsencrypt

EXPOSE 80 443 8080 9090

CMD ["traefik"]
