# Trading Platform Institucional V2

## Objetivo
Evoluir o fluxo de trading para uma plataforma auditável de portfólio multi-asset, com decisões orientadas por risco, custo e robustez estatística.

## Princípios obrigatórios
- O sistema **não promete lucro**.
- **No-trade** é resultado válido quando risco/custo supera edge.
- Custos (fees, slippage, spread e funding/borrow quando disponível) entram no PnL e na decisão.
- Overfitting é tratado com validações purgadas, embargo temporal, DSR e PBO.
- LLM atua como camada de sanity-check e explicação, não como motor principal de cálculo.

## Por que purge/embargo
Em séries temporais financeiras há vazamento de informação quando treino e teste compartilham janelas muito próximas. Purge e embargo reduzem esse viés, aumentando qualidade de OOS.

## Por que DSR/PBO
Múltiplos testes elevam chance de falso positivo estatístico. DSR reduz Sharpe inflado por seleção de estratégias; PBO mede probabilidade de overfitting por ranking in-sample vs out-of-sample.

## Por que calibração
Confiança bruta não é probabilidade calibrada. Calibração (Platt/Isotonic) melhora interpretação probabilística para alocação e guardrails operacionais.

## Por que LLM não recebe candles brutos
Para reduzir custo, latência e risco de alucinação, o LLM recebe apenas Decision Packet resumido com evidências e guardrails já calculados por motores determinísticos.

## Fluxo operacional resumido
1. Universe scan assíncrono (Redis queue).
2. Backtest walk-forward com purge/embargo e custo explícito.
3. Controle de múltiplos testes (DSR/PBO).
4. Calibração de confiança.
5. Construção de portfólio (correlação, alocação, execução planejada).
6. Monitoramento de risco de modelo (drift, decay, kill-switch).

## Observabilidade
Métricas adicionadas:
- `trading_universe_scan_seconds`
- `trading_backtest_seconds`
- `trading_calibration_seconds`
- `trading_portfolio_rebalance_seconds`
- `trading_model_risk_events_total`
- `trading_candidate_count`
- `trading_prompt_tokens_estimate`
