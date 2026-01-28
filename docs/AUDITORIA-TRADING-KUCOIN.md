# Auditoria Trading KuCoin — Gaps e Mudanças Necessárias
**Author:** Fillipe Guerra  
**Data:** 28 de Janeiro de 2026

## Objetivo
Consolidar gaps e inconsistências entre a documentação oficial da KuCoin (Spot/Futures/Margin/WebSocket) e a implementação atual (backend, agentic e UI), além de listar mudanças necessárias de forma enterprise-grade.

## Escopo avaliado
- Backend: `integrations-service`, `chat-service`, `shared/schema`, `tradingBroadcast`.
- Frontend: `Trading.tsx`, componentes de Trading, `useKucoinWebSocket`.
- Módulos KuCoin: **Futures**, **Spot**, **Margin**, **WebSocket**.

## Matriz de cobertura (alto nível)
> **Legenda:** ✅ Implementado | ⚠️ Parcial | ❌ Ausente

### KuCoin Futures (REST)
- **Market/Ticker/Contracts**: ✅ (`/trading/market/:symbol`, `getContractInfo`, `getActiveContracts`)
- **Account Overview**: ✅ (`/trading/account`, `getAccountOverview`)
- **Positions**: ✅ leitura (`/trading/positions`, `getAllPositions`)
- **Orders (market/limit)**: ✅ (`/trading/orders`, `createOrder`)
- **Stop Orders**: ✅ (`/trading/stop-orders`, `createStopOrder`)
- **Order History**: ✅ (`/trading/orders/history`)
- **Funding/Mark Price**: ✅ (`/trading/funding-rate/:symbol`, `/trading/mark-price/:symbol`)
- **Klines/Orderbook/Trades**: ✅ (`/trading/klines/:symbol`, `/trading/orderbook/:symbol`, `/trading/trades/:symbol`)

### KuCoin Futures (WebSocket)
- **Ticker/Orderbook/Trades**: ✅ (`kucoinWebSocket.ts`)
- **Klines**: ✅ (`kucoinWebSocket.ts`) — **UI ainda usa REST para klines**
- **Orders/Positions/Balance privados**: ✅ (`kucoinWebSocket.ts`)
- **Endpoints WS subscribe/unsubscribe**: ✅ (`/api/integrations/trading/ws/subscribe`, `/api/integrations/trading/ws/unsubscribe`)
- **UI realtime via WS**: ⚠️ **Parcial** (Ticker/Orderbook/Trades via WS; klines permanecem REST; fallback ativo)

### KuCoin Spot (REST/WS)
- **Conta, ordens, stop orders, trades**: ✅ (REST implementado)
- **WebSocket**: ❌ (não implementado)

### KuCoin Margin (REST/WS)
- **Conta, ordens, stop orders**: ✅ (REST implementado)
- **Borrow/Repay**: ❌ (não implementado)
- **WebSocket**: ❌ (não implementado)

### Outros módulos KuCoin
- **Transfers/Sub-accounts/Fees/Deposits/Withdrawals**: ❌ (não implementado)

## Gaps e inconsistências identificados
### P0 — Quebras funcionais diretas (Status)
1. **Payload de controle inconsistente (handover/takeover)**: ✅ Corrigido  
2. **Endpoint ausente para `close_position`**: ✅ Corrigido  
3. **Broadcast de controle não disparado**: ✅ Corrigido  
4. **Stop Loss/Take Profit no `createOrder` (UI e chat)**: ✅ Corrigido (stop orders separados)

### P1 — Inconsistências de domínio e UX (Status)
5. **Tamanho de ordem (size) não alinhado ao conceito de contratos**: ✅ Corrigido  
6. **Símbolos hardcoded na UI**: ✅ Corrigido (símbolos via API)  
7. **Realtime no Trading UI não utilizado**: ⚠️ Parcial (WS ativo para ticker/orderbook/trades; klines seguem REST)

### P2 — Cobertura incompleta de módulos KuCoin (Status)
8. **Spot/Margin ausentes**: ✅ Corrigido (REST + UI para Spot/Margin)  
9. **Credenciais por tenant no `trading_risk_config`**: ⚠️ **Pendente** (execução segue via env)

## Mudanças necessárias (proposta de implementação)
### P0 (alta prioridade)
- **Compatibilizar payload de controle**  
  Aceitar `action` no backend **ou** ajustar o chat-service para enviar `mode`.  
- **Criar endpoint `DELETE /trading/positions`**  
  Implementar fechamento de posição por símbolo (ou todas se omitido).  
- **Publicar `publishControlChange` no `/trading/control`**  
  Broadcast imediato para UI/serviços.  
- **Separar stop orders do createOrder**  
  - UI/Chat: enviar stop orders via `/trading/stop-orders` após ordem principal;  
  - Backend: manter validação explícita (sem campos extras em `/trading/orders`).

### P1 (médio)
- **Normalizar `size` por contratos**  
  - UI: validação de inteiro;  
  - Chat: converter quantidade para contratos usando `multiplier` + `contractInfo`;  
  - Exibir ajuda contextual (contratos vs BTC).
- **Lista de símbolos dinâmica**  
  - Backend: endpoint para contratos ativos;  
  - UI: carregar símbolos da API, remover hardcoded.
- **WS no Trading UI**  
  - Integrar `useKucoinWebSocket` para ticker/orderbook/klines;  
  - Manter fallback via REST quando WS indisponível.

### P2 (baixo / roadmap)
- **Credenciais por tenant**  
  - Se multi-tenant real: persistir credenciais com segurança e chaveamento;  
  - Se single-tenant: remover campos do schema para evitar inconsistência.
- **Módulos KuCoin adicionais**  
  - Transfers/Sub-accounts/Fees/Deposits/Withdrawals (não implementados).

## Testes e validações obrigatórias
- **Backend**: typecheck, lint, testes de integração das rotas `trading/control`, `trading/positions`, `trading/orders`, `trading/stop-orders`.  
- **Chat-service**: testes de comandos `takeover/handback`, `close_position`, `buy/sell` com SL/TP.  
- **Frontend**: validação de formulário de ordem, estados de handover, atualização WS.  
- **Observability**: logs e métricas de controle, ordens e posições.

## Observações finais
Atualmente a implementação cobre **Futures + Spot + Margin (REST/UI)** e utiliza **WS para ticker/orderbook/trades em Futures** com fallback REST. Permanecem pendentes: **WS completo para klines**, **credenciais por tenant** (se multi-tenant real) e módulos adicionais da KuCoin (Transfers/Sub-accounts/Fees/Deposits/Withdrawals). As correções P0 e a maior parte das P1/P2 já foram implementadas e estabilizadas.
