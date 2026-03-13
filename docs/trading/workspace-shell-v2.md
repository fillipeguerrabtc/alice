# Shared Trading Workspace Shell V2 (Rodadas 3 e 4)

Author: Fillipe Guerra  
Data: 2026-03-12

## Objetivo
Estabelecer uma shell compartilhada de workspace para Trading Real e Demo Trading, com quatro modos primários de operação, sem quebrar o fluxo legado e com rollout controlado por feature flag.

## Escopo implementado
- Criação do domínio `apps/frontend-service/src/components/trading-v2/`.
- Componentes base:
- `TradingWorkspaceShell.tsx`
- `TradingWorkspaceTopBar.tsx`
- `TradingWorkspaceSidebar.tsx`
- `TradingWorkspaceBottomTray.tsx`
- `TradingWorkspaceOperateMode.tsx`
- `TradingWorkspaceOperateStatusCard.tsx`
- `TradingWorkspaceCompactOrderTicket.tsx`
- Tipos compartilhados em `types.ts`.
- Integração em `TradingContent.tsx` (Real) e `DemoTrading.tsx` (Demo) condicionada a `featureFlags.tradingWorkspaceV2Enabled`.

## Modo de operação por ambiente
### Trading Real
- `operate`: `overview`, `orders`, `positions`
- `ai-signals`: `signals-auto`, `signals`, `analysis`
- `portfolio-auto`: `portfolio-auto`
- `post-trade`: `history`

### Demo Trading
- `operate`: `overview`, `orders`
- `ai-signals`: `postmortems`
- `portfolio-auto`: `positions`
- `post-trade`: `history`

## Progressive Disclosure aplicado
- Itens avançados removidos da navegação principal e expostos por painel lateral e painel inferior colapsável:
- risk/account
- research
- governance
- advanced order book
- postmortem detail

## Modo Operar (Rodada 4)
- O modo `operate` passou a ser uma experiência dedicada dentro da Shell V2, sem alterar contratos de backend.
- Primeira dobra prioriza execução com blocos explícitos:
- `main chart area`
- `compact order ticket`
- `open positions panel`
- `open orders panel`
- `status card` com `websocket`, `engine health`, `risk mode` e `circuit breaker`.
- Progressive disclosure para detalhes avançados:
- Real: account/risk/order book avançado.
- Demo: account snapshot + atalhos operacionais de pós-trade.
- Integração de dados reaproveitada:
- Real mantém hooks/queries e presenters já usados na tela legada.
- Demo mantém execução simulada e passa a reutilizar feed real de market/klines no modo `operate`.

## Estratégia de compatibilidade
- Caminho legado permanece íntegro e ativo quando a feature flag estiver desligada.
- Caminho V2 entra apenas quando `tradingWorkspaceV2Enabled` estiver ligado.
- Não houve alteração de contrato de API nesta rodada.

## Observações de UX
- Sem scroll horizontal de tabs no caminho V2.
- Navegação principal orientada por quatro modos explícitos.
- Áreas secundárias movidas para disclosure progressivo, reduzindo poluição visual.
