# DR Runbook - Backup and Restore Game Day

Data: 2026-03-05  
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
  - `infra/scripts/preflight-secrets.sh --stack all --env-file .env --compose-file infra/docker/docker-compose.yml`
  - `infra/scripts/preflight-secrets.ps1 -Stack all -EnvFile .env -ComposeFile infra/docker/docker-compose.yml`
- Acesso operacional aos endpoints:
  - `POST /api/backup/restore`
  - `GET /api/backup/status`
  - `GET /api/backup/history`

## 3. Procedimento de Game Day
1. Registrar baseline:
   - status dos serviços;
   - latência API crítica;
   - integridade de ledger imutável.
2. Selecionar backup alvo (id e timestamp).
3. Rodar simulação (dry run):
   - `POST /api/backup/restore` com `dryRun=true`.
4. Validar plano de restore gerado e aprovar execução.
5. Rodar restore real:
   - `POST /api/backup/restore` com `confirm=true`.
6. Validar pós-restore:
   - health de serviços;
   - leitura/escrita em PostgreSQL;
   - conectividade Redis;
   - coleções Qdrant acessíveis;
   - smoke test de chat/trading/training/rag.
7. Validar métricas e auditoria:
   - duração total;
   - sucesso/falha;
   - trilha de auditoria da operação.

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
- Logs de auditoria da execução.
- Resultado de smoke tests.

## 6. Plano de rollback de DR test
1. Se restore falhar, manter sistema em modo restrito.
2. Reexecutar com backup imediatamente anterior.
3. Acionar incidente e abrir RCA com causa raiz.
4. Atualizar este runbook com ações corretivas permanentes.
