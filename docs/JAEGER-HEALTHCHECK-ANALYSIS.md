# Análise: Jaeger Healthcheck - Nenhuma Mudança Necessária

**Data:** 07/01/2026  
**Autor:** GitHub Copilot / Fillipe Guerra  
**Status:** ✅ HEALTHCHECK FUNCIONANDO - NENHUMA AÇÃO NECESSÁRIA

---

## Resumo Executivo

A análise detalhada da imagem Docker `jaegertracing/jaeger:2.13.0` revelou que:

1. ✅ **Imagem é Alpine Linux 3.22** (não distroless/scratch)
2. ✅ **wget está disponível** (busybox wget)
3. ✅ **Healthcheck funciona perfeitamente** (testado e validado)
4. ❌ **Tag `-debug` NÃO EXISTE** para versão 2.13.0

**CONCLUSÃO:** Nenhuma mudança é necessária. O healthcheck atual está correto e funcional.

---

## Investigação Detalhada

### 1. Estrutura da Imagem Atual

```bash
$ docker run --rm --entrypoint /bin/sh jaegertracing/jaeger:2.13.0 -c "cat /etc/os-release"
NAME="Alpine Linux"
ID=alpine
VERSION_ID=3.22.2
PRETTY_NAME="Alpine Linux v3.22"
```

**Componentes Disponíveis:**
- Shell: `/bin/sh` (ash via busybox)
- wget: `/usr/bin/wget` (busybox wget)
- Ferramentas: cat, ls, ps, grep, curl, etc.

### 2. Teste de Healthcheck

#### Configuração Testada
```yaml
healthcheck:
  test: ["CMD", "wget", "--spider", "-q", "http://localhost:16686/"]
  interval: 10s
  timeout: 5s
  retries: 3
  start_period: 15s
```

#### Resultado do Teste
```bash
$ docker inspect tmp-jaeger-test-1 | jq '.[0].State.Health'
{
  "Status": "healthy",
  "FailingStreak": 0,
  "Log": [
    {
      "Start": "2026-01-07T04:28:45Z",
      "End": "2026-01-07T04:28:45Z",
      "ExitCode": 0,
      "Output": ""
    }
  ]
}
```

**✅ Container reporta como "healthy" em ~20 segundos**

### 3. Tags Disponíveis no Docker Hub

```bash
$ curl -s "https://hub.docker.com/v2/namespaces/jaegertracing/repositories/jaeger/tags" | jq -r '.results[].name'
latest
2.14.1
2.14.0
2.13.0  ← ATUAL
2.12.0
2.11.0
...
```

**❌ NÃO EXISTE:** Nenhuma variante `-debug`, `-alpine`, ou `-distroless` para v2.x

### 4. Por Que a Confusão?

A documentação Jaeger v1 mencionava imagens "production" (distroless) vs "debug" (Alpine), mas:

- **Jaeger v1** (EOL 31/12/2025): tinha variantes all-in-one, agent, collector separados
- **Jaeger v2** (atual): unificou tudo em uma **única imagem baseada em Alpine**

A imagem v2 já inclui shell e ferramentas básicas para troubleshooting, eliminando a necessidade de variante debug.

---

## Recomendações

### ✅ Manter Configuração Atual

**Arquivo:** `infra/docker/stacks/docker-compose.observability.yml`

```yaml
jaeger:
  image: jaegertracing/jaeger:${JAEGER_VERSION:-2.13.0}  # ← CORRETO
  healthcheck:
    test: ["CMD", "wget", "--spider", "-q", "http://localhost:16686/"]
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 60s
```

### ❌ NÃO Usar Tag Inexistente

```yaml
# ❌ ERRADO - TAG NÃO EXISTE
image: jaegertracing/jaeger:${JAEGER_VERSION:-2.13.0-debug}
```

### 📋 Troubleshooting em Produção

Como a imagem já é Alpine-based, troubleshooting é possível:

```bash
# Acessar shell do container
docker exec -it jaeger /bin/sh

# Verificar conectividade
wget --spider -q http://localhost:16686/ && echo "OK" || echo "FAIL"

# Ver logs
docker logs jaeger --tail 100

# Verificar portas
netstat -tlnp | grep jaeger
```

---

## Referências

1. **Jaeger v2 Release Notes:**  
   https://www.jaegertracing.io/docs/latest/deployment/

2. **Docker Hub Jaeger:**  
   https://hub.docker.com/r/jaegertracing/jaeger

3. **Jaeger v1 → v2 Migration:**  
   https://www.jaegertracing.io/docs/latest/migration-to-v2/

4. **Teste Local Realizado:**  
   ```bash
   # Container ficou healthy em 20s com healthcheck wget
   docker compose up -d jaeger
   docker inspect jaeger | grep -A5 Health
   # Status: "healthy"
   ```

---

## Histórico de Decisões

| Data | Decisão | Justificativa |
|------|---------|---------------|
| 07/01/2026 | **Manter configuração atual** | Imagem 2.13.0 já é Alpine com wget. Healthcheck funciona. Tag `-debug` não existe. |

---

**Assinatura:** GitHub Copilot  
**Revisado por:** Fillipe Guerra  
**Status Final:** ✅ NENHUMA AÇÃO NECESSÁRIA
