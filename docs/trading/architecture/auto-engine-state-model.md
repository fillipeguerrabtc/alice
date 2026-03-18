# State Model do Auto Engine

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026

## Objetivo

Formalizar os estados de `trading_auto_runs` de forma semantica, auditavel e consistente entre banco, backend, frontend e observability.

## Estados vigentes

- `queued`: run criada e aguardando worker.
- `running`: processamento em andamento.
- `succeeded`: execucao terminou com resultado persistido e elegivel como sucesso.
- `no_trade`: execucao terminou sem oportunidade segura de trade.
- `blocked`: execucao foi encerrada por guardrail, configuracao ou contexto invalido.
- `failed`: execucao falhou por motivo tecnico real.
- `cancelled`: cancelamento operacional.

## Regras semanticas

- `no_trade` nao deve ser colapsado em `succeeded`.
- `blocked` nao e erro tecnico e nao deve ser tratado como `failed`.
- `failed` fica restrito a falhas reais de execucao, persistencia ou integracao.
- `terminal_reason_code` e a ancora machine-readable para troubleshooting e UX.

## Persistencia

- Enum: `trading_auto_run_status`
- Tabela principal: `trading_auto_runs`
- Campo de apoio: `terminal_reason_code`
- A migracao de base que introduziu os estados e o campo foi `migrations/0109_trading_auto_run_terminal_states.sql`.

## Impacto em consumers

- APIs de listagem e detalhe de auto run devem aceitar todos os estados vigentes.
- Frontend deve encerrar polling em qualquer estado terminal explicito.
- Observability e dashboards devem distinguir `blocked` de `failed`.

## Compatibilidade

- Consumers legados ainda podem encontrar historico antigo com `succeeded` acompanhado por motivo de no-trade.
- A leitura atual deve preferir `status` explicito e usar fallback historico apenas quando necessario.

## Referencias

- [auto-engine-contracts-observability.md](auto-engine-contracts-observability.md)
- [domain-map.md](domain-map.md)
- [../runbooks/operacao-testes.md](../runbooks/operacao-testes.md)
