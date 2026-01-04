# Troubleshooting de Deploy - Containers Unhealthy

## Índice
1. [Diagnóstico Rápido](#diagnóstico-rápido)
2. [Containers Unhealthy](#containers-unhealthy)
3. [Timeouts Comuns](#timeouts-comuns)
4. [Comandos Úteis](#comandos-úteis)
5. [Casos Específicos](#casos-específicos)

## Diagnóstico Rápido

### Verificar Status Geral
```bash
# Ver todos os containers com health status
docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.State}}"

# Ver apenas containers unhealthy
docker ps --filter "health=unhealthy" --format "table {{.Names}}\t{{.Status}}"

# Ver apenas containers em starting
docker ps --filter "health=starting" --format "table {{.Names}}\t{{.Status}}"
```

### Capturar Logs de Containers Problemáticos
```bash
# Logs de um container específico
docker logs --tail=500 <container_name>

# Logs em tempo real (follow)
docker logs -f <container_name>

# Logs desde um timestamp específico
docker logs --since="2026-01-04T19:00:00" <container_name>
```

## Containers Unhealthy

### O que são Containers Unhealthy?
Containers unhealthy são aqueles que:
- **Status**: `running` (container está executando)
- **Health**: `unhealthy` (healthcheck está falhando)
- **Sintoma**: "(sem logs disponíveis)" nos relatórios de falha

### Por que ocorrem?
1. **Healthcheck muito restritivo**: Timeout muito curto ou start_period insuficiente
2. **Serviço ainda inicializando**: Container rodando mas serviço interno não pronto
3. **Dependências não disponíveis**: Redis, PostgreSQL, MariaDB não prontos
4. **Configuração incorreta**: Variáveis de ambiente faltando ou incorretas

### Como Diagnosticar

#### 1. Ver Estado do Healthcheck
```bash
# Ver JSON completo do healthcheck
docker inspect <container_name> --format='{{json .State.Health}}' | jq .

# Ver apenas o status
docker inspect <container_name> --format='{{.State.Health.Status}}'

# Ver últimas tentativas de healthcheck
docker inspect <container_name> --format='{{range .State.Health.Log}}Exit={{.ExitCode}} Output={{.Output}}{{"\n"}}{{end}}' | tail -5
```

#### 2. Executar Healthcheck Manualmente
```bash
# Entrar no container e testar healthcheck
docker exec -it <container_name> /bin/sh

# Exemplo: ERPNext worker
python3 -c "import os,redis; r=redis.Redis(host='erpnext-redis-queue',port=6379,password=os.environ.get('REDIS_QUEUE_PASSWORD','')); r.ping()"

# Exemplo: Alice frontend
wget --spider -q http://localhost:8080/health && echo "OK" || echo "FAIL"

# Exemplo: Vector
wget --spider -q http://localhost:8686/health && echo "OK" || echo "FAIL"
```

#### 3. Verificar Dependências
```bash
# Verificar se Redis está acessível
docker exec <container_name> nc -zv erpnext-redis-queue 6379

# Verificar se PostgreSQL está acessível
docker exec <container_name> nc -zv alice-postgres 5432

# Verificar se MariaDB está acessível
docker exec <container_name> nc -zv erpnext-mariadb 3306
```

## Timeouts Comuns

### Thresholds por Serviço

| Serviço | start_period | timeout | retries | Tempo Total Max |
|---------|--------------|---------|---------|-----------------|
| **alice-frontend** | 120s | 25s | 5 | 120s + (25s × 5) = 245s (~4min) |
| **alice-vector** | 180s | 10s | 5 | 180s + (10s × 5) = 230s (~4min) |
| **erpnext-backend** | 420s | 20s | 15 | 420s + (20s × 15) = 720s (~12min) |
| **erpnext-workers** | 480s | 15s | 10 | 480s + (15s × 10) = 630s (~10min) |
| **erpnext-scheduler** | 480s | 15s | 10 | 480s + (15s × 10) = 630s (~10min) |

### Interpretação
- **start_period**: Tempo de "graça" antes do healthcheck começar a contar falhas
- **timeout**: Tempo máximo para o healthcheck executar
- **retries**: Número de falhas consecutivas antes de marcar como unhealthy
- **interval**: Tempo entre healthchecks (padrão: 30s)

### Quando Ajustar Timeouts

#### Primeiro Deploy
- Pode levar **10-15 minutos** total
- Inclui: pull de imagens, criação de site ERPNext, migrations
- **Não ajustar** timeouts sem evidência clara

#### Deploys Subsequentes
- Mais rápidos (imagens já em cache)
- **3-5 minutos** típico
- Timeouts atuais já consideram margem de segurança

#### Sinais de Timeout Insuficiente
```bash
# Healthcheck falhou mas serviço está OK
docker logs <container_name> | tail -20
# Mostra serviço funcionando normalmente

# Healthcheck output mostra timeout
docker inspect <container_name> --format='{{range .State.Health.Log}}{{.Output}}{{end}}'
# Mostra "timeout" ou "connection refused" temporário
```

## Comandos Úteis

### Restart de Container Específico
```bash
# Restart sem perder logs
docker restart <container_name>

# Ver se ficou healthy após restart
watch -n 5 'docker ps --filter "name=<container_name>" --format "table {{.Names}}\t{{.Status}}"'
```

### Reiniciar Serviço Inteiro
```bash
cd /opt/alice/app/infra/docker

# Parar todos
docker compose -f docker-compose.prod.yml --env-file .env.prod down

# Iniciar apenas ERPNext
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d \
  erpnext-mariadb erpnext-redis-cache erpnext-redis-queue \
  erpnext-backend erpnext-frontend erpnext-websocket erpnext-scheduler \
  erpnext-worker-default erpnext-worker-short erpnext-worker-long

# Iniciar apenas Alice
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d \
  alice-postgres alice-redis alice-frontend alice-auth alice-chat \
  alice-rag alice-training alice-integrations
```

### Ver Métricas de Resources
```bash
# Ver uso de CPU/RAM de todos containers
docker stats --no-stream

# Ver uso de um container específico
docker stats --no-stream <container_name>

# Ver processos dentro do container
docker exec <container_name> ps aux
```

## Casos Específicos

### ERPNext Workers Unhealthy

**Sintomas**:
- Container rodando, mas health=unhealthy
- Logs mostram: "Redis connection refused" ou timeout

**Causas Comuns**:
1. Redis Queue não pronto ainda (aguardar start_period)
2. Senha Redis incorreta (verificar REDIS_QUEUE_PASSWORD)
3. Site ERPNext não criado ainda (aguardar erpnext-create-site)

**Diagnóstico**:
```bash
# 1. Verificar se Redis Queue está healthy
docker ps --filter "name=erpnext-redis-queue"

# 2. Testar conexão Redis manualmente
docker exec erpnext-worker-default python3 -c \
  "import os,redis; r=redis.Redis(host='erpnext-redis-queue',port=6379,password=os.environ.get('REDIS_QUEUE_PASSWORD','')); print(r.ping())"

# 3. Verificar se site foi criado
docker exec erpnext-worker-default ls -la /home/frappe/frappe-bench/sites/
```

**Solução**:
- Aguardar **start_period de 480s** (~8 minutos)
- Se persistir após 10 minutos, verificar logs do erpnext-create-site
- Verificar senha Redis no .env.prod

### Alice Frontend Unhealthy

**Sintomas**:
- nginx rodando, mas health=unhealthy
- Logs mostram: "wget: can't connect" ou "connection refused"

**Causas Comuns**:
1. nginx ainda processando assets (primeiro deploy)
2. Porta 8080 não aberta ou mapeamento incorreto
3. Endpoint /health não existe ou retorna erro

**Diagnóstico**:
```bash
# 1. Verificar se nginx está ouvindo na porta 8080
docker exec alice-frontend netstat -tlnp | grep 8080

# 2. Testar endpoint /health manualmente
docker exec alice-frontend wget -O- http://localhost:8080/health

# 3. Verificar configuração do nginx
docker exec alice-frontend cat /etc/nginx/conf.d/default.conf | grep 8080
```

**Solução**:
- Aguardar **start_period de 120s** (~2 minutos)
- Healthcheck tem 3-tier fallback: /health → / → TCP check
- Se todos falham, verificar nginx.conf

### Alice Vector Unhealthy

**Sintomas**:
- Vector rodando, mas health=unhealthy
- Logs mostram: "API not enabled" ou "connection refused 8686"

**Causas Comuns**:
1. API health endpoint não habilitado no vector.toml
2. Pipeline Vector ainda conectando ao Loki
3. Configuração TOML incorreta

**Diagnóstico**:
```bash
# 1. Verificar se API está habilitada
docker exec alice-vector cat /etc/vector/vector.toml | grep -A 5 "\[api\]"

# 2. Testar endpoint health manualmente
docker exec alice-vector wget -O- http://localhost:8686/health

# 3. Ver logs de inicialização
docker logs alice-vector | grep -i "api\|health\|enabled"
```

**Solução**:
- Aguardar **start_period de 180s** (~3 minutos)
- Verificar se `api.enabled = true` no vector.toml
- Verificar se porta 8686 está mapeada

### ERPNext Backend Unhealthy

**Sintomas**:
- Frappe bench rodando, mas health=unhealthy
- Logs mostram: "ImportError" ou "Database not ready"

**Causas Comuns**:
1. Migrations ainda executando (primeiro deploy)
2. MariaDB não pronto
3. Site ERPNext não criado ou corrupto

**Diagnóstico**:
```bash
# 1. Verificar se MariaDB está healthy
docker ps --filter "name=erpnext-mariadb"

# 2. Testar endpoint /api/method/ping manualmente
docker exec erpnext-backend curl -s http://localhost:8000/api/method/ping

# 3. Ver logs de migrations
docker logs erpnext-backend | grep -i "migrat\|error\|fail"

# 4. Verificar se site foi criado
docker exec erpnext-backend ls -la /home/frappe/frappe-bench/sites/
```

**Solução**:
- Aguardar **start_period de 420s** (~7 minutos)
- Primeiro deploy pode levar até 12 minutos (migrations)
- Verificar logs do erpnext-create-site para erros

## Escalação

### Quando Reportar Bug
Se após seguir este guia:
1. ✅ Aguardou timeouts completos
2. ✅ Verificou logs não mostram erros
3. ✅ Testou healthcheck manualmente (funciona)
4. ✅ Container permanece unhealthy por >15 minutos

**Informações a Incluir**:
```bash
# Capturar estado completo
docker ps -a > /tmp/containers-status.txt
docker inspect <container_name> > /tmp/container-inspect.json
docker logs --tail=1000 <container_name> > /tmp/container-logs.txt

# Anexar:
# - containers-status.txt
# - container-inspect.json
# - container-logs.txt
# - Versão do deploy (git tag)
```

## Referências
- [Docker Compose Healthchecks](https://docs.docker.com/compose/compose-file/05-services/#healthcheck)
- [ERPNext Installation](https://frappeframework.com/docs/user/en/installation)
- [Vector Health API](https://vector.dev/docs/administration/management/)
- [Troubleshooting Docker](https://docs.docker.com/config/daemon/troubleshoot/)

---
*Última atualização: 04/01/2026*
*Autor: Fillipe Guerra*
