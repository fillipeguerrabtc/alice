# DR Runbook - Backup and Restore Game Day

Autor: Fillipe Guerra  
Data: 07 de Março de 2026  
Escopo: Alice Platform (PostgreSQL, Redis, Qdrant, services)  
Objetivo: validar recuperação ponta a ponta com evidência operacional

## 1. SLO de recuperação
- RTO alvo (produção): 60 minutos.
- RPO alvo (produção): 15 minutos.
- Ambiente de ensaio: execução mensal obrigatória.

## 2. Pré-requisitos
- Janela de manutenção aprovada.
- Backup manifesto válido disponível em `/opt/alice/backups/manifests`.
- Secrets e compose validados antes do início:
  - `infra/scripts/preflight-secrets.sh --stack backup --env-file .env --compose-file infra/docker/stacks/docker-compose.base.yml --compose-file infra/docker/stacks/docker-compose.backup.yml`
  - `infra/scripts/preflight-secrets.ps1 -Stack backup -EnvFile .env -ComposeFile infra/docker/stacks/docker-compose.base.yml,infra/docker/stacks/docker-compose.backup.yml`
- Acesso operacional aos endpoints:
  - `POST /api/backup/verify/:id`
  - `POST /api/backup/restore`
  - `GET /api/backup/status`
  - `GET /api/backup/history`
- Se `BACKUP_OFFSITE_DIR` estiver habilitado:
  - `BACKUP_CIPHER_PASS` válido no ambiente;
  - manifesto de verificação em `<BACKUP_OFFSITE_DIR>/<backup-id>/offsite-verification.json`.

## 3. Procedimento de Game Day
1. Registrar baseline:
   - status dos serviços;
   - latência API crítica;
   - integridade de ledger imutável.
2. Selecionar backup alvo (id e timestamp).
3. Rodar simulação (dry run):
   - `POST /api/backup/restore` com `dryRun=true`.
4. Rodar verificação operacional:
   - `POST /api/backup/verify/:id` para validar integridade local/offsite + `pgbackrest verify`.
5. Validar plano de restore gerado e aprovar execução.
6. Rodar restore real:
   - `POST /api/backup/restore` com `confirm=true`.
7. Validar pós-restore:
   - health de serviços;
   - leitura/escrita em PostgreSQL;
   - conectividade Redis;
   - coleções Qdrant acessíveis;
   - smoke test de chat/trading/training/rag.
8. Validar métricas e auditoria:
   - duração total;
   - sucesso/falha;
   - trilha de auditoria da operação.

### Automação recomendada
```bash
bash infra/scripts/run-dr-game-day.sh \
  --base-url https://yesyoudeserve.duckdns.org \
  --auth-token "$ADMIN_BEARER_TOKEN" \
  --backup-id "<backup-id>"
```

## 4. Critérios de sucesso
- Restore concluído sem erro crítico.
- RTO dentro da meta definida.
- RPO dentro da meta definida.
- Sem violação de isolamento multi-tenant.
- Evidências anexadas ao relatório de operação.

## 5. Evidências mínimas
- Backup ID usado.
- Horário de início/fim.
- Duração total.
- Resultado por componente (PostgreSQL/Redis/Qdrant).
- Evidência de verificação offsite (quando habilitado).
- Logs de auditoria da execução.
- Resultado de smoke tests.

## 6. Plano de rollback de DR test
1. Se restore falhar, manter sistema em modo restrito.
2. Reexecutar com backup imediatamente anterior.
3. Acionar incidente e abrir RCA com causa raiz.
4. Atualizar este runbook com ações corretivas permanentes.
