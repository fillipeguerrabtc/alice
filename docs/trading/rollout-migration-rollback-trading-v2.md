# Rollout, Migration e Rollback da Trading Workspace V2

Author: Fillipe Guerra  
Data: 2026-03-13

## Estratégia de rollout
- Rollout controlado por feature flag (`tradingWorkspaceV2Enabled` com compatibilidade de leitura legada).
- Fallback imediato para caminho legacy quando a flag estiver desabilitada.
- Sem alteração de triggers, bindings ou wiring de workflows durante esta etapa.

## Migration notes
- Rodada 10 não introduziu mudança de schema nem migration SQL.
- Migration de dados da rodada anterior (`0110_trading_signal_promotion_path.sql`) permanece válida e compatível com os adapters da rodada final.
- Evolution path orientado a compatibilidade de contract para evitar quebra de consumidores antigos.

## Rollback notes
- Rollback funcional: desabilitar feature flag para voltar ao mount legacy sem rollback de banco.
- Rollback de contract: manter aliases de rota/API ativos durante período de estabilidade.
- Rollback de UI: componentes V2 continuam isolados e podem ser desativados por configuração sem remover código de domínio.

## Guardrails operacionais
- Preservar isolamento entre `demo execution` e `live execution`.
- Preservar auth, permission e validações de borda.
- Preservar semântica explícita de estados `blocked` e `no_trade`.

## Janela de descontinuação do legado
- Monitorar uso de aliases e incidência de erro por consumer.
- Planejar remoção somente após estabilidade operacional comprovada.
- Executar remoção em etapas curtas, cada uma com typecheck, testes, lint e build completos.
