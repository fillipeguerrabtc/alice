# Decommission ERPNext em Producao (One-Shot)

## 1) Objetivo

Este runbook define o fluxo unico de decommission completo do legado ERPNext/Frappe em producao, sem alterar os workflows atuais de CI/Release/Deploy da Alice.

Workflow oficial (unico):

- `.github/workflows/decommission-erpnext-prod-oneshot.yml`

## 2) O que o workflow one-shot faz

Em uma unica execucao manual, ele faz:

1. Inventario dos recursos alvo (containers, redes, volumes, imagens).
2. Remocao de containers alvo.
3. Remocao de redes alvo.
4. Remocao de imagens alvo.
5. Remocao de volumes alvo (destrutivo).
6. Pos-check com fail-fast.

Selecao de alvo:

- Label de projeto Compose: `com.docker.compose.project=erpnext`
- Prefixo de nome: `erpnext-`

## 3) Checklist pre-execucao (obrigatorio)

1. Janela de mudanca aprovada por negocio e SRE.
2. Confirmacao de que ERPNext nao e dependencia ativa.
3. Backup do legado concluido e validado:
   - dump logico do banco legado
   - snapshot/backup de volumes legados
   - evidencia com timestamp e local de armazenamento
4. Procedimento de restore testado (homologacao ou equivalente).
5. Segredos de producao no GitHub Actions:
   - `HETZNER_VM_HOST`
   - `HETZNER_VM_USER`
   - `HETZNER_SSH_PRIVATE_KEY`
6. Aprovacao de compliance para remocao destrutiva de volumes.

## 4) Ordem exata de execucao

1. Abrir GitHub Actions.
2. Selecionar `Decommission ERPNext (Production - One Shot)`.
3. Clicar em `Run workflow`.
4. Preencher:
   - `confirm_phrase=DECOMMISSION ERPNext PROD ONE SHOT`
   - `project_label=erpnext`
   - `name_prefix=erpnext-`
5. Executar e aguardar status `success`.
6. Rodar verificacoes pos-workflow no servidor.

## 5) Criterios de rollback

Rollback obrigatorio se ocorrer qualquer condicao:

1. Qualquer container da Alice (nao legado) ficar `unhealthy`, `restarting` ou `exited`.
2. Falha de conectividade de borda (Caddy/API) apos remocao.
3. Remocao acidental de recurso fora do escopo legado.

Acoes:

1. P1 (impacto Alice): interromper imediatamente e executar deploy da ultima versao estavel da Alice.
2. P2 (somente legado): restaurar legado a partir de backup/snapshot e compose correspondente.

## 6) Comandos de verificacao pos-workflow

Execute no servidor de producao:

```bash
# 1) Containers legados (esperado: sem saida)
docker ps -a --format '{{.Names}} {{.Image}}' | grep -E 'erpnext|frappe|mariadb|mariabackup' || true

# 2) Redes legadas (esperado: sem saida)
docker network ls --format '{{.Name}}' | grep -E 'erpnext|frappe|mariadb' || true

# 3) Volumes legados (esperado: sem saida)
docker volume ls --format '{{.Name}}' | grep -E 'erpnext|frappe|mariadb' || true

# 4) Imagens legadas (esperado: sem saida)
docker images --format '{{.Repository}}:{{.Tag}}' | grep -E 'erpnext|frappe|mariadb' || true

# 5) Projetos Compose ativos (esperado: sem projeto "erpnext")
docker compose ls

# 6) Saude da Alice
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
```
