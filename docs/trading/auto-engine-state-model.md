# State Model do Auto Engine (Rodada 2)

Author: Fillipe Guerra  
Data: 2026-03-12

## Objetivo
Formalizar estados terminais do Auto Engine de forma semanticamente correta, explícita e queryável em schema, serviço e contratos.

## Estados de `trading_auto_runs`
- `queued`: run criada e aguardando worker.
- `running`: processamento ativo.
- `succeeded`: trade aprovado e persistido com sucesso.
- `no_trade`: execução concluída sem entrada válida (sem edge/candidatos aprovados).
- `blocked`: execução encerrada por bloqueio de segurança/configuração (não é falha técnica).
- `failed`: falha técnica real durante processamento.
- `cancelled`: cancelamento operacional.

## Regras semânticas aplicadas
- `no_trade` não é mais mascarado como `succeeded`.
- `blocked` não é mais exposto como erro genérico em `failed`.
- `failed` permanece restrito a falhas técnicas reais.

## Persistência e query
- Enum `trading_auto_run_status` recebeu os valores `no_trade` e `blocked`.
- Coluna `terminal_reason_code` adicionada em `trading_auto_runs` para reason code terminal queryável.
- Índice parcial criado para `terminal_reason_code` quando não nulo.

## Migration aplicada
- Arquivo: `migrations/0109_trading_auto_run_terminal_states.sql`
- Mudanças:
- `ALTER TYPE trading_auto_run_status ADD VALUE IF NOT EXISTS 'no_trade'`
- `ALTER TYPE trading_auto_run_status ADD VALUE IF NOT EXISTS 'blocked'`
- `ALTER TABLE trading_auto_runs ADD COLUMN terminal_reason_code varchar(64)`
- `CREATE INDEX idx_trading_auto_runs_terminal_reason_code`

## Notas de rollback
- PostgreSQL não permite remover valor de enum de forma direta e segura sem recriação de tipo.
- Rollback recomendado para esta rodada:
- manter enum expandido;
- reverter apenas comportamento de escrita para status legados, se necessário;
- preservar `terminal_reason_code` sem uso ativo até nova rodada.

## Compatibilidade
- Leituras legadas continuam válidas.
- Consumidores que filtram status receberam suporte aos novos valores.
- Eventos históricos com `succeeded` + `noTradeReasonCode` seguem interpretáveis por fallback.
