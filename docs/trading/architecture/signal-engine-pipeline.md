# Arquitetura do Signal Engine Pipeline

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026

## Objetivo

Descrever o pipeline interno de geracao de sinais de Trading, preservando o contrato externo da rota publica e deixando explicitos os estagios responsaveis por analise, decisao, persistencia e validacao.

## Estagios vigentes

1. `feature_extraction`
   - monta `analysisMatrix`, `primaryAnalysis`, `consensus`, `techniqueScores`, `ensembleResult` e `techniqueCapabilities`
2. `candidate_generation`
   - monta contexto operacional e `candidateSummary`
3. `llm_arbitration`
   - prepara prompt, chama o LLM e normaliza o sinal inicial
4. `risk_shaping`
   - aplica overrides deterministicos e guardrails finais
5. `persistence`
   - persiste sinal e metadata de auditoria
6. `validation_finalize`
   - executa validacao/calibracao final e atualiza `validationStatus`

## Modulos de codigo

- `apps/integrations-service/src/trading-signal-engine-types.ts`
- `apps/integrations-service/src/trading-signal-engine-pipeline-service.ts`
- `apps/integrations-service/src/trading-llm-signal-generation-service.ts`

## Contrato externo preservado

- Rota publica: `POST /api/integrations/trading/signals/generate`
- O frontend continua consumindo a mesma superficie funcional.
- A decomposicao e interna e nao exige wiring especial de pipeline ou workflow.

## Guardrails preservados

- `TRADING_SCOPE_REQUIRED` continua fail-closed.
- Dataset aprovado de Trading continua obrigatorio.
- Arbitragem triangular em `futures` continua bloqueada.
- Tecnicas sem requisitos minimos suficientes retornam `blocked` ou `not_supported_for_current_context`.

## Observability

- `trading.signal.pipeline.stage`
- `trading.signal.pipeline.completed`

Campos relevantes:

- `stage`
- `durationMs`
- `symbol`
- `candidateSummary`
- `validationStatus`

## Referencias

- [domain-map.md](domain-map.md)
- [../product/strategy-specialists-data-requirements.md](../product/strategy-specialists-data-requirements.md)
- [../product/ai-signals-cockpit.md](../product/ai-signals-cockpit.md)
