# Strategy Specialists e Data Requirements (Rodada 8)

Author: Fillipe Guerra  
Data: 2026-03-13

## Objetivo
Parar de tratar todas as `techniques` como igualmente suportadas e explicitar, por família de especialista, quais requisitos mínimos de dados existem para execução segura.

## Capability Matrix por família
### 1) `directional_technical`
- Techniques:
- `scalping`, `day_trade`, `swing`, `position`, `trend`, `mean_reversion`, `breakout`, `range`, `momentum`
- Minimum data requirements:
- `ohlcv_candles`
- `technical_indicators`
- Support level atual:
- `supported`

### 2) `cross_venue_arbitrage`
- Techniques:
- `arbitrage_triangular`
- Minimum data requirements:
- `spot_or_margin_market`
- `arbitrage_config`
- `venue_quotes_and_fees`
- Support level atual:
- `supported` quando `marketType` é `spot|margin` e `arbitrageConfig` está presente.
- `blocked` com `ARBITRAGE_CONFIG_REQUIRED` quando configuração obrigatória não existe.
- `not_supported_for_current_context` com `ARBITRAGE_REQUIRES_SPOT_OR_MARGIN` em `futures`.

### 3) `intraday_microstructure`
- Techniques:
- `grid_trading`
- Minimum data requirements:
- `orderbook_depth_snapshots`
- `trade_ticks_aggregation`
- `microstructure_features`
- Support level atual:
- `blocked` com `ORDERBOOK_SOURCE_DISABLED` quando `orderBook` está desabilitado.
- `not_supported_for_current_context` com `MICROSTRUCTURE_PIPELINE_NOT_IMPLEMENTED` mesmo com `orderBook` habilitado (pipeline dedicado ainda não integrado).

### 4) `basis_funding_carry`
- Techniques:
- `cash_and_carry`, `basis_trade`, `funding_arbitrage`
- Minimum data requirements:
- `spot_futures_basis_curve`
- `funding_rate_series`
- `carry_cost_model`
- Support level atual:
- `not_supported_for_current_context` com `BASIS_FUNDING_DATA_UNAVAILABLE`.

### 5) `inventory_spread_capture`
- Techniques:
- `market_making`
- Minimum data requirements:
- `orderbook_depth_snapshots`
- `inventory_state_model`
- `queue_position_estimator`
- Support level atual:
- `blocked` com `ORDERBOOK_SOURCE_DISABLED` quando `orderBook` está desabilitado.
- `not_supported_for_current_context` com `INVENTORY_SPREAD_MODELS_UNAVAILABLE` no estado atual do pipeline.

## Contratos atualizados
### API `analysis-profile`
- `GET /api/integrations/trading/analysis-profile`
- `PUT /api/integrations/trading/analysis-profile`
- Agora retornam `data.techniqueCapabilities[]` com:
- `technique`
- `family`
- `supportLevel`
- `reasonCode`
- `reasonHuman`
- `minimumDataRequirements[]`

### API `analysis/:symbol`
- `GET /api/integrations/trading/analysis/:symbol`
- Agora retorna `techniqueCapabilities` no nível raiz e também em `profile.techniqueCapabilities`.
- `techniqueScores[]` passa a carregar metadados de capability (`family`, `supportLevel`, `reasonCode`, `reasonHuman`, `minimumDataRequirements`) para evitar neutral fake sem semântica.

### Metadata persistida de sinais
- `trading_signals.metadata.techniqueCapabilities` adicionado para auditabilidade do contexto de suporte usado na geração.

## Regras aplicadas na implementação
- Techniques sem requisitos mínimos não são mais tratadas como directional heuristics.
- `cash_and_carry`, `basis_trade`, `funding_arbitrage`, `grid_trading`, `market_making` deixaram de usar score fake baseado apenas em indicadores genéricos.
- Quando técnica não está elegível, o retorno é explícito (`blocked` ou `not_supported_for_current_context`) com `reasonCode` machine-readable e `reasonHuman` user-readable.

## Impacto de UX
- A configuração de Sinais IA exibe suporte atual por `technique` e razões de bloqueio/não suporte.
- Labels de técnicas na seleção passam a sinalizar estado (`bloqueada` / `não suportada`) quando aplicável.
