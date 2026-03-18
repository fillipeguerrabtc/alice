# Convergência da Demo Trading para Workspace V2 (Rodada 6)

Author: Fillipe Guerra  
Data: 2026-03-12

## Objetivo
Convergir a Demo Trading para a mesma Trading Workspace V2 do produto principal, eliminando dependência operacional da UX paralela gigante no caminho V2 e mantendo fallback seguro por feature flag.

## Escopo entregue
- A Demo passa a usar a shared shell V2 com os quatro modos:
- `operate`
- `ai-signals`
- `portfolio-auto`
- `post-trade`
- O modo `operate` mantém os blocos de execução compacta já consolidados na rodada anterior.
- Os modos `ai-signals`, `portfolio-auto` e `post-trade` ganham trilhas V2 dedicadas, sem depender dos `TabsContent` legados quando a flag V2 está ativa.

## Handoff de sinal para Demo
- Foi ativado handoff explícito de sinais IA para execução demo via:
- `POST /api/integrations/demo-trading/orders/from-signal`
- A UI de `ai-signals` na Demo:
- lista sinais direcionais (`entry_long` / `entry_short`)
- valida elegibilidade de execução (exige `suggestedSize > 0`)
- executa em paper trading isolado
- invalida caches de ordens/posições/saldos demo após execução

## Preservação de fallback e rollout
- Com `featureFlags.tradingWorkspaceV2Enabled = false`, o caminho legado da Demo continua íntegro.
- Com `featureFlags.tradingWorkspaceV2Enabled = true`, a Demo usa os modos V2 e reduz dependência da estrutura antiga.
- Não houve alteração de wiring de workflows.

## Resultado funcional
- Demo e Real passam a se apresentar como o mesmo produto no shell V2.
- Diferenças de ambiente permanecem explícitas:
- saldos demo
- paper execution
- trilha de post-mortem automático
- isolamento de live execution
