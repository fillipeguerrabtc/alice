# Decommission ERPNext em Produção (Runbook Enterprise)

## 1) Objetivo e escopo

Este runbook define a remoção controlada do stack legado ERPNext/Frappe em produção, sem interferir no pipeline de deploy atual da Alice.

Escopo do decommission:

- Containers do stack legado (`com.docker.compose.project=erpnext` e/ou prefixo `erpnext-`)
- Redes do stack legado
- Imagens do stack legado (opcional)
- Volumes do stack legado (opcional, destrutivo)

Fora de escopo:

- Alteração em gatilhos dos workflows de CI/Release/Deploy existentes
- Limpeza destrutiva global (`docker system prune --volumes`) em produção

## 2) Princípios de segurança (Enterprise)

- Processo manual e aprovado (`workflow_dispatch`)
- Fail-fast em validações de entrada e conectividade
- Dry-run obrigatório antes da execução destrutiva
- Evidência antes/depois (inventário de recursos)
- Sem comandos globais destrutivos
- Rollback com critérios explícitos de go/no-go

## 2.1) Modo simples (one-shot)

Se você quer uma única execução automática, use o workflow:

- `.github/workflows/decommission-erpnext-prod-oneshot.yml`

Ele executa em sequência:

1. Inventário
2. Remoção de containers alvo
3. Remoção de redes alvo
4. Remoção de imagens alvo
5. Remoção de volumes alvo (destrutivo)
6. Pós-check com fail-fast

Entradas mínimas:

- `confirm_phrase=DECOMMISSION ERPNext PROD ONE SHOT`
- `project_label=erpnext`
- `name_prefix=erpnext-`

## 3) Checklist pré-execução (obrigatório)

1. Janela de mudança aprovada com owner de negócio e SRE.
2. Confirmação de que ERPNext não é mais dependência ativa da Alice.
3. Backup dos dados legados concluído e validado:
   - Dump lógico do banco legado
   - Snapshot/backup de volumes legados relevantes
   - Evidência com timestamp e local de armazenamento
4. Procedimento de restore testado (pelo menos em ambiente de homologação).
5. Segredos de produção válidos no GitHub Actions:
   - `HETZNER_VM_HOST`
   - `HETZNER_VM_USER`
   - `HETZNER_SSH_PRIVATE_KEY`
6. Execução inicial em `dry_run=true` revisada e aprovada.
7. Comunicação de change freeze durante execução.

## 4) Ordem exata de execução

### Fase A — Planejamento e validação

1. Executar workflow `Decommission ERPNext (Production)` com:
   - `dry_run=true`
   - `remove_networks=false`
   - `remove_images=false`
   - `remove_volumes=false`
2. Revisar inventário detectado (containers/redes/volumes/imagens).
3. Confirmar que somente recursos legados foram selecionados.

Go/No-Go:

- GO: inventário contém apenas legado ERPNext esperado.
- NO-GO: recursos não legados detectados na seleção.

### Fase B — Remoção operacional (não destrutiva de dados)

4. Reexecutar workflow com:
   - `dry_run=false`
   - `remove_networks=true`
   - `remove_images=false`
   - `remove_volumes=false`
5. Validar que nenhum container legado permaneceu ativo/parado.
6. Validar que redes legadas foram removidas (sem afetar `alice-network`).

Go/No-Go:

- GO: containers e redes legadas zerados; Alice saudável.
- NO-GO: qualquer impacto em stack Alice.

### Fase C — Limpeza de imagens (higiene)

7. Reexecutar workflow com:
   - `dry_run=false`
   - `remove_networks=true`
   - `remove_images=true`
   - `remove_volumes=false`
8. Validar que não há imagens legadas em uso.

Go/No-Go:

- GO: imagens legadas removidas sem impacto.
- NO-GO: conflito com imagens em uso.

### Fase D — Limpeza de volumes (destrutiva, opcional)

9. Somente após retenção legal aprovada, executar:
   - `dry_run=false`
   - `remove_networks=true`
   - `remove_images=true`
   - `remove_volumes=true`
10. Validar remoção total de volumes legados.

Go/No-Go:

- GO: política de retenção atendida e backup validado.
- NO-GO: qualquer dúvida de compliance/restauração.

### Fase E — Encerramento

11. Rodar verificação final no host:
   - `docker ps -a | grep -E 'erpnext|frappe|mariadb'` deve retornar vazio
   - `docker network ls | grep erpnext` deve retornar vazio
   - `docker volume ls | grep erpnext` deve retornar vazio (se fase D executada)
12. Arquivar evidências do change e anexar ao ticket de produção.

## 5) Critérios de rollback

Rollback é obrigatório se qualquer condição abaixo ocorrer durante o decommission:

1. Qualquer container da Alice (não legado) ficar `unhealthy`, `restarting` ou `exited`.
2. Falha de conectividade de borda (Caddy/API) após remoção.
3. Remoção acidental de rede/volume fora do escopo legado.
4. Erro de seleção de recursos detectado em runtime.

Ações de rollback por severidade:

1. P1 (impacto Alice): interromper decommission imediatamente e executar deploy da última versão estável da Alice via pipeline oficial.
2. P2 (somente legado afetado): restaurar stack legado a partir dos backups/snapshots e compose correspondente.
3. P3 (apenas limpeza parcial): corrigir seleção e rerun do workflow em modo controlado.

## 6) Observações operacionais

- Este processo não altera os workflows de deploy existentes.
- O decommission é intencionalmente separado do deploy para evitar risco sistêmico.
- Recomendação: proteger este workflow com approvals em `Environment` de produção.

## 7) Comandos de verificação pós-workflow

Execute no servidor de produção:

```bash
# 1) Contêineres legados (deve retornar vazio)
docker ps -a --format '{{.Names}} {{.Image}}' | grep -E 'erpnext|frappe|mariadb|mariabackup' || true

# 2) Redes legadas (deve retornar vazio)
docker network ls --format '{{.Name}}' | grep -E 'erpnext|frappe|mariadb' || true

# 3) Volumes legados (deve retornar vazio)
docker volume ls --format '{{.Name}}' | grep -E 'erpnext|frappe|mariadb' || true

# 4) Projetos Compose ativos (não deve haver projeto "erpnext")
docker compose ls

# 5) Saúde da Alice (todos healthy/up conforme esperado)
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
```
