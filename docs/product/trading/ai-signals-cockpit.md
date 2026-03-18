# AI Signals Cockpit V2 (Rodada 5)

Author: Fillipe Guerra  
Data: 2026-03-13

## Objetivo
Substituir a experiência anterior de Sinais IA por um cockpit orientado a estados de produto explícitos, com leitura auditável de motivo terminal e handoff operacional para Demo e Training.

## Estados de produto adotados
O cockpit passa a usar categorias explícitas:
- `blocked`
- `no_trade`
- `signal_generated`
- `executed`
- `failed`

### Regras de leitura
- `blocked`: execução bloqueada por guardrail/configuração.
- `no_trade`: run válido sem oportunidade segura de trade.
- `signal_generated`: sinal gerado, ainda não executado/aprovado.
- `executed`: sinal com aprovação de execução registrada.
- `failed`: falha técnica real no processamento.

## Estrutura de UX do cockpit
O modo `ai-signals` da Workspace V2 agora compõe:
- `Control Panel`
- `Latest Run`
- `Latest Signal`
- `Blocked / No-trade Explanation`
- `Evidence Summary`
- `Lineage Summary`
- `CTA Actions`
- `Run History`
- `Governança avançada de sinais` (collapsible)

## Reason codes em dois níveis
### machine-readable
- Lidos de `terminalReasonCode` (auto-run) e/ou `noTradeReasonCode` (entry payload / metadata).

### user-readable
- Lidos de `noTradeReasonHuman` quando disponível.
- Fallback por tabela de reason codes (ex.: `UNVALIDATED`, `NO_EDGE`, `TRADING_SCOPE_REQUIRED`).

## Contracts atualizados (Signal Generation)
Rota afetada:
- `POST /api/integrations/trading/signals/generate`

Novo bloco no response:
- `signalGeneration.stateCategory`
- `signalGeneration.reasonCode`
- `signalGeneration.reasonHuman`

### Comportamento
- Sucesso com sinal operacional: `stateCategory=signal_generated`.
- Sucesso sem trade (`hold`/`neutral` ou `noTradeReasonCode`): `stateCategory=no_trade`.
- Bloqueio por configuração/guardrail: `stateCategory=blocked`.
- Falha técnica: `stateCategory=failed`.

## Handoff para Demo e Training
### Estado até Rodada 8
- CTAs encaminhavam para o fluxo de governança (`SignalApprovalPanel`) sem bypass.

### Estado após Rodada 9
- CTAs passaram a executar handoff first-class no backend real:
- `Enviar para Demo`: valida demo eligibility e registra lineage no promotion path.
- `Enviar para Training dataset`: cria dataset candidate e atualiza lifecycle do sinal.
- `Re-run com ajustes de escopo`: mantém trilha operacional existente.
- Painel continua exibindo governança avançada (`SignalApprovalPanel`) via progressive disclosure para operações detalhadas.

## Promotion path no Cockpit
- O cockpit passa a consultar:
- `GET /api/integrations/trading/signals/:id/promotion-path`
- Exibe no `Lineage Summary`:
- `lifecycleStage`
- status de `datasetCandidate`
- status de `demoEligibility` e `realEligibility`
- total de eventos de lineage (`promotion events`)
- `Enviar para Demo` respeita eligibility explícita e mostra reason code/reason human quando bloqueado.

## Observações operacionais
- `neutral` e `hold` não são apresentados como directional signal útil.
- Estados `blocked` e `no_trade` não ficam escondidos atrás de erro genérico.
- O painel avançado de governança permanece acessível por progressive disclosure para não poluir a primeira dobra.
