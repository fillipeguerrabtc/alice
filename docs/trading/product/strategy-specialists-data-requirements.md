# Strategy Specialists e Data Requirements

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026
**Status:** ativo
**Tipo:** ssot

## Objetivo

Explicitar, por familia de especialista, quais tecnicas possuem suporte real no dominio Trading e quais dependem de dados ou capacidades ainda indisponiveis.

## Familias vigentes

### `directional_technical`

- Tecnicas principais: `scalping`, `day_trade`, `swing`, `position`, `trend`, `mean_reversion`, `breakout`, `range`, `momentum`
- Requisitos minimos: `ohlcv_candles`, `technical_indicators`
- Suporte atual: `supported`

### `cross_venue_arbitrage`

- Tecnica principal: `arbitrage_triangular`
- Requisitos minimos: `spot_or_margin_market`, `arbitrage_config`, `venue_quotes_and_fees`
- Suporte atual: depende de contexto de mercado e configuracao valida

### `intraday_microstructure`

- Tecnica principal: `grid_trading`
- Requisitos minimos: `orderbook_depth_snapshots`, `trade_ticks_aggregation`, `microstructure_features`
- Suporte atual: bloqueado ou nao suportado no contexto atual

### `basis_funding_carry`

- Tecnicas: `cash_and_carry`, `basis_trade`, `funding_arbitrage`
- Requisitos minimos: `spot_futures_basis_curve`, `funding_rate_series`, `carry_cost_model`
- Suporte atual: `not_supported_for_current_context`

### `inventory_spread_capture`

- Tecnica principal: `market_making`
- Requisitos minimos: `orderbook_depth_snapshots`, `inventory_state_model`, `queue_position_estimator`
- Suporte atual: depende de fontes e modelos ainda indisponiveis no pipeline vigente

## Contracts expostos

- `GET /api/integrations/trading/analysis-profile`
- `PUT /api/integrations/trading/analysis-profile`
- `GET /api/integrations/trading/analysis/:symbol`

Os contratos retornam `techniqueCapabilities[]` com suporte, razao e requisitos minimos.

## Regras de produto

- Tecnica sem requisito minimo nao deve fingir suporte com score generico.
- Razoes de `blocked` e `not_supported_for_current_context` devem permanecer explicitas em API e UI.
- A configuracao de sinais deve exibir capacidade real por tecnica, e nao aspiracao futura.

## Referencias

- [ai-signals-cockpit.md](ai-signals-cockpit.md)
- [../architecture/signal-engine-pipeline.md](../architecture/signal-engine-pipeline.md)
