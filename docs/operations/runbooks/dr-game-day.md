# Runbook de DR e Game Day

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026
**Status:** ativo
**Tipo:** runbook

## Objetivo

Validar recuperacao ponta a ponta da plataforma com evidencia operacional, cobrindo restore, verificacao offsite e smoke tests pos-recuperacao.

## SLOs de recuperacao

- `RTO` alvo: 60 minutos
- `RPO` alvo: 15 minutos
- frequencia minima do ensaio: mensal

## Preconditions

- janela de manutencao aprovada
- manifesto de backup valido em `/opt/alice/backups/manifests`
- preflight de secrets e compose concluido
- acesso aos endpoints de backup e restore
- `BACKUP_CIPHER_PASS` valido quando houver copia offsite criptografada

## Preparacao

```bash
bash infra/scripts/preflight-secrets.sh \
  --stack backup \
  --env-file infra/docker/.env.prod \
  --compose-file infra/docker/stacks/docker-compose.base.yml \
  --compose-file infra/docker/stacks/docker-compose.backup.yml
```

## Procedimento

1. Registrar baseline operacional:
   - status dos servicos
   - latencia de APIs criticas
   - integridade de dados essenciais
2. Selecionar o `backup_id` alvo.
3. Executar dry run de restore.
4. Executar `verify` para validar copia local, copia offsite e `pgbackrest verify`.
5. Revisar o plano de restore e aprovar a execucao.
6. Executar restore real com confirmacao explicita.
7. Validar pos-restore:
   - PostgreSQL
   - Redis
   - Qdrant
   - smoke tests de chat, trading, training e RAG
8. Registrar evidencias, duracao e resultado final.

## Automacao recomendada

```bash
bash infra/scripts/run-dr-game-day.sh \
  --base-url https://yesyoudeserve.duckdns.org \
  --auth-token "$ADMIN_BEARER_TOKEN" \
  --backup-id "<backup-id>"
```

## Evidencias minimas

- `backup_id`
- horario de inicio e fim
- duracao total
- resultado por componente
- validacao offsite, quando aplicavel
- logs e auditoria da execucao
- resultado dos smoke tests

## Criterio de sucesso

- restore concluido sem erro critico
- `RTO` e `RPO` dentro da meta
- sem violacao de isolamento multi-tenant
- evidencias anexadas ao registro operacional

## Saida em caso de falha

1. manter sistema em modo restrito
2. tentar o backup imediatamente anterior
3. abrir incidente com RCA
4. atualizar o runbook apenas com regra permanente, nao com historico de execucao

## Referencias

- [../observability.md](../observability.md)
- [../deploy.md](../deploy.md)
