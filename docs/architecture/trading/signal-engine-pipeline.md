# Arquitetura do Signal Engine Pipeline (Rodada 7)

Author: Fillipe Guerra  
Data: 2026-03-13

## Objetivo
Decompor a geração de sinais de Trading em estágios explícitos, testáveis e sustentáveis, preservando compatibilidade externa com os handlers e consumers atuais.

## Escopo da decomposição
A refatoração introduz uma camada interna de pipeline com separação por responsabilidade:

1. `feature_extraction`
- Responsável por montar `analysisMatrix`, `primaryAnalysis`, `consensus`, `techniqueScores`, `ensembleResult` e snapshots de arbitragem.
- A partir da Rodada 8 também monta `techniqueCapabilities` com specialist family + support level + minimum data requirements.
- Baseado em `buildTradingSignalAnalysisContext`.

2. `candidate_generation`
- Responsável por montar contexto operacional (`ragContext`, `orderBookSnapshot`, `newsSummary`, `trainingSummary`, `tradePlan`).
- Inclui `candidateSummary` estruturado (`candidateCount`, `directionalBias`, `expectedState`, `reasonCode`).
- Baseado em `buildTradingSignalOperationalContext`.

3. `llm_arbitration`
- Responsável por `systemPrompt`, `prompt budget`, chamada ao LLM, parse e normalização do sinal inicial.
- Mantém parse resiliente e validação de payload via schemas existentes.

4. `risk_shaping`
- Responsável por aplicar override determinístico quando necessário.
- Mantém lógica de proteção contra over-neutralização em cenários de consenso forte.

5. `persistence`
- Responsável por persistir sinal e metadata de auditoria do pipeline.

6. `validation_finalize`
- Responsável por validação/calibração final (`validateAndPersist`) e atualização de `validationStatus`.

## Módulos introduzidos
- `apps/integrations-service/src/trading-signal-engine-types.ts`
- `apps/integrations-service/src/trading-signal-engine-pipeline-service.ts`

## Serviço público preservado
- `apps/integrations-service/src/trading-llm-signal-generation-service.ts`
- Continua expondo `generateTradingSignalFromLlm(...)` para os mesmos consumers.
- A mudança é interna: agora delega a execução para o pipeline.

## Compatibilidade externa
- Contrato da rota `POST /api/integrations/trading/signals/generate` preservado.
- Sem mudança de payload de entrada/saída para frontend.
- Sem alteração de wiring de workflows/triggers.

## Fail-closed e guardrails preservados
- `TRADING_SCOPE_REQUIRED` continua fail-closed via contexto operacional.
- Dataset aprovado de Trading continua obrigatório.
- Bloqueio de arbitragem triangular em `futures` preservado.
- Fluxo legado institucional continua possível via gate já existente.
- Techniques sem requisitos mínimos passam a `blocked`/`not_supported_for_current_context` com reason codes explícitos.

## Observability adicionada no pipeline
Eventos estruturados por estágio:
- `trading.signal.pipeline.stage`
- `trading.signal.pipeline.completed`

Campos principais:
- `stage`
- `durationMs`
- `symbol`
- `candidateSummary`
- `validationStatus`

## Testabilidade
- Cada estágio foi isolado em métodos do pipeline.
- `candidate generation` possui função pura (`buildSignalCandidateSummary`) com testes unitários dedicados.
- Capability matrix e suporte por technique possuem testes unitários dedicados.
