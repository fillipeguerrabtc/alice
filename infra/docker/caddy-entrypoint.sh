#!/bin/sh
# =============================================================================
# Caddy Entrypoint - Simplified Startup
# =============================================================================
# Autor: Fillipe Guerra
# Data: 03/01/2026
#
# Entrypoint simplificado para startup rápido do Caddy.
# Validação mínima para garantir fail-fast sem atrasar inicialização.
#
# Referência: https://caddyserver.com/docs/command-line#caddy-validate
# =============================================================================

set -e

echo "🚀 Starting Caddy $(caddy version | head -1 | cut -d' ' -f1)"

# =================================================================
# Ajuste de permissões (root -> caddy) antes do drop de privilégios
# =================================================================
if [ "$(id -u)" = "0" ]; then
    mkdir -p /data /config /var/log/caddy
    chown -R caddy:caddy /data /config /var/log/caddy
    chmod 755 /var/log/caddy
fi

# =================================================================
# Validação Rápida do Caddyfile
# =================================================================
if ! caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
    echo "❌ ERROR: Invalid Caddyfile configuration"
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1
    exit 1
fi

echo "✅ Configuration valid"

# =================================================================
# Pré-check DNS público (ACME) com retry/backoff
# =================================================================
# Objetivo: evitar tentativa de emissão ACME quando DNS público está intermitente.
# Isso reduz falhas de emissão após limpeza total do servidor.
# =================================================================
DNS_PRECHECK_ENABLED="${ACME_DNS_PRECHECK_ENABLED:-true}"
DNS_PRECHECK_MAX_ATTEMPTS="${ACME_DNS_PRECHECK_MAX_ATTEMPTS:-60}"
DNS_PRECHECK_INTERVAL_SECONDS="${ACME_DNS_PRECHECK_INTERVAL_SECONDS:-10}"
DNS_PRECHECK_TIMEOUT_SECONDS="${ACME_DNS_PRECHECK_TIMEOUT_SECONDS:-5}"
DNS_PRECHECK_RESOLVERS="${ACME_DNS_PRECHECK_RESOLVERS:-https://cloudflare-dns.com/dns-query https://dns.google/dns-query}"
DNS_PRECHECK_REQUIRE_ALL_RESOLVERS="${ACME_DNS_PRECHECK_REQUIRE_ALL_RESOLVERS:-false}"

get_caddy_hosts() {
    awk '
      /^[[:space:]]*#/ { next }
      /^[^[:space:]][^[:space:]]*[[:space:]]*{/ {
        host=$1
        if (host ~ /^:/) next
        if (host ~ /\./) print host
      }
    ' /etc/caddy/Caddyfile | sort | uniq
}

check_dns_doh() {
    host="$1"
    resolver="$2"
    response="$(wget -qO- --header='accept: application/dns-json' --timeout="$DNS_PRECHECK_TIMEOUT_SECONDS" --tries=1 "$resolver?name=$host&type=A" || true)"
    echo "$response" | grep -q '"Status":0' || return 1
    echo "$response" | grep -q '"type":1' || return 1
    return 0
}

if [ "$DNS_PRECHECK_ENABLED" = "true" ]; then
    DNS_PRECHECK_HOSTS="${ACME_DNS_PRECHECK_HOSTS:-$(get_caddy_hosts)}"
    if [ -z "$DNS_PRECHECK_HOSTS" ]; then
        echo "⚠️  WARNING: Nenhum host encontrado para pré-check DNS (ACME)."
    else
        echo "🔎 ACME DNS precheck ativado (hosts: $DNS_PRECHECK_HOSTS)"
        attempt=1
        while [ "$attempt" -le "$DNS_PRECHECK_MAX_ATTEMPTS" ]; do
            all_ok=true
            for host in $DNS_PRECHECK_HOSTS; do
                if [ "$DNS_PRECHECK_REQUIRE_ALL_RESOLVERS" = "true" ]; then
                    host_ok=true
                    for resolver in $DNS_PRECHECK_RESOLVERS; do
                        if ! check_dns_doh "$host" "$resolver"; then
                            host_ok=false
                        fi
                    done
                else
                    host_ok=false
                    for resolver in $DNS_PRECHECK_RESOLVERS; do
                        if check_dns_doh "$host" "$resolver"; then
                            host_ok=true
                            break
                        fi
                    done
                fi
                if [ "$host_ok" != "true" ]; then
                    echo "⚠️  DNS ainda instável para $host (tentativa $attempt/$DNS_PRECHECK_MAX_ATTEMPTS)"
                    all_ok=false
                fi
            done
            if [ "$all_ok" = "true" ]; then
                echo "✅ DNS público estável para ACME"
                break
            fi
            if [ "$attempt" -ge "$DNS_PRECHECK_MAX_ATTEMPTS" ]; then
                echo "❌ DNS público instável após $DNS_PRECHECK_MAX_ATTEMPTS tentativas. Abortando start do Caddy."
                exit 1
            fi
            attempt=$((attempt + 1))
            sleep "$DNS_PRECHECK_INTERVAL_SECONDS"
        done
    fi
fi

# =================================================================
# Verificar ACME_EMAIL (warning apenas, não bloqueia startup)
# =================================================================
if [ -z "${ACME_EMAIL}" ]; then
    echo "⚠️  WARNING: ACME_EMAIL not set - using fallback email"
fi

echo "🌐 Starting Caddy server..."

# Usar exec para substituir o shell pelo processo Caddy
# Isso garante que o Caddy receba sinais (SIGTERM, etc) corretamente
if [ "$(id -u)" = "0" ]; then
    exec su-exec caddy:caddy caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
fi

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
