# Training, Calibration e Promotion Path

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026
**Status:** ativo
**Tipo:** ssot

## Objetivo

Documentar a trilha operacional auditavel que conecta um sinal de Trading a dataset curation, calibracao, handoff demo e elegibilidade real.

## Artefatos persistidos

- `trading_signal_promotions`
- `trading_signal_promotion_events`
- `trading_signals.metadata.promotion`

## Lifecycle vigente

1. `candidate_evidence_captured`
2. `dataset_candidate`
3. `approved_dataset_version`
4. `calibration_result`
5. `demo_eligible`
6. `real_eligible`

## Contracts ativos

- `GET /api/integrations/trading/signals/:id/promotion-path`
- `POST /api/integrations/trading/signals/:id/promote-real-eligibility`
- `POST /api/integrations/trading/datasets/from-signal`
- `POST /api/integrations/demo-trading/orders/from-signal`

## Regras operacionais

### Demo eligibility

- O sinal precisa ser direcional.
- `validationState` precisa estar em `validated`.
- O caminho precisa ter dataset aprovado e `calibrationId`.

### Real eligibility

- Exige promocao explicita por usuario autorizado.
- Exige justificativa (`reason`).
- Exige `validationState`, `datasetVersionId` e `calibrationId`.

## Auditoria e lineage

- Eventos em `trading_signal_promotion_events` registram ator, estagio, razao e fonte de evidencia.
- `training_lineage_events` recebe os eventos de dataset candidate, demo handoff e real eligibility.
- O snapshot em `trading_signals.metadata.promotion` deve refletir o estado consolidado mais recente.

## Relacao com validacao, release e deploy

- Validacao de codigo e escopo incremental nao vivem neste documento; usar [../../engineering/validation-monorepo.md](../../engineering/validation-monorepo.md).
- `Release` e `Deploy` seguem os SSOTs gerais de plataforma, sem regras especiais de Trading aqui.

## Referencias

- [../product/ai-signals-cockpit.md](../product/ai-signals-cockpit.md)
- [../architecture/domain-map.md](../architecture/domain-map.md)
- [../runbooks/operacao-testes.md](../runbooks/operacao-testes.md)
