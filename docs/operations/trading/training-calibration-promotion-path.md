# Training, Calibration e Promotion Path (Rodada 9)

Author: Fillipe Guerra  
Data: 2026-03-13

## Objetivo
Estabelecer um lifecycle enterprise e auditável para sinais de Trading, cobrindo o caminho completo:

1. candidate evidence captured
2. dataset candidate
3. approved dataset version
4. calibration result
5. demo eligible
6. real eligible

## Arquitetura implementada
### Novas entidades persistidas
- `trading_signal_promotions`
- `trading_signal_promotion_events`

### Novos enums de domínio
- `trading_signal_promotion_stage`
- `trading_signal_eligibility_status`
- `trading_signal_promotion_validation_state`

### Migration
- `migrations/0110_trading_signal_promotion_path.sql`

## Lifecycle e semântica de elegibilidade
### Estados de lifecycle
- `candidate_evidence_captured`: evidência inicial do sinal registrada.
- `dataset_candidate`: sinal roteado para dataset curation.
- `approved_dataset_version`: dataset version aprovado contém a evidência do sinal.
- `calibration_result`: calibração estatística vinculada ao contexto do sinal.
- `demo_eligible`: handoff para Demo foi executado com sucesso.
- `real_eligible`: promoção explícita para elegibilidade real concluída.

### Regras de demo eligibility
- Signal precisa ser direcional (`entry_long` ou `entry_short`).
- `validationState` precisa ser `validated`.
- Precisa existir `datasetCandidate` aprovado.
- Precisa existir `datasetVersion` contendo a evidência.
- Precisa existir `calibrationId`.

### Regras de real eligibility
- Promoção explícita por usuário autorizado.
- `validationState` obrigatório em `validated`.
- `datasetVersionId` obrigatório.
- `calibrationId` obrigatório.
- Signal direcional obrigatório.

## Contracts e rotas
### Promotion path
- `GET /api/integrations/trading/signals/:id/promotion-path`
- `POST /api/integrations/trading/signals/:id/promote-real-eligibility`

### Handoff Training
- `POST /api/integrations/trading/datasets/from-signal`
- `namespaceId` passou a ser opcional no contract (resolução por domínio quando ausente).

### Handoff Demo
- `POST /api/integrations/demo-trading/orders/from-signal`
- A rota valida demo eligibility antes da execução e registra lineage/handoff após criação da ordem.

## Lineage e approval metadata
### Auditoria de promotion
- Cada transição relevante gera evento em `trading_signal_promotion_events` com:
- `actor_user_id`
- `lifecycle_stage`
- `reason`
- `evidence_source_type`
- `evidence_source_id`
- `metadata`

### Eventos de lineage
- `training_lineage_events` recebe eventos explícitos:
- `trading_signal_dataset_candidate`
- `trading_signal_demo_handoff`
- `trading_signal_real_eligibility_promoted`

### Snapshot no signal metadata
- `trading_signals.metadata.promotion` passa a espelhar estado consolidado:
- stage atual
- status de elegibilidade demo/real
- reason codes
- marcações de promotedAt/promotedBy

## Notas operacionais (handoff Training e Demo)
### Send to Training (Cockpit V2)
- Aciona rota real de dataset curation.
- Atualiza lineage e promotion path sem bypass de guardrails.

### Send to Demo (Cockpit V2)
- Exige sinal direcional e eligibility válida.
- Exibe bloqueio com reason code quando não elegível.
- Registra `demoOrderId` no promotion path após handoff.

### Promotion para Real
- Exige justificativa explícita (`reason`) no endpoint.
- Registra ator, timestamp e motivo para auditabilidade completa.

## Observability e riscos residuais
### Cobertura adicionada
- reason codes de elegibilidade ficam queryáveis no banco.
- lifecycle fica consultável por endpoint dedicado.
- lineage de handoff para Training e Demo fica explicitamente rastreável.

### Riscos conhecidos
- Avanço de estágio baseado em sincronização de leitura (query/sync) pode depender de chamadas periódicas para refletir mudanças externas imediatamente.
- Falhas transientes de banco após criação de ordem demo podem exigir reconciliação operacional do evento de handoff.

## Rollback e segurança de migração
- Migration é aditiva (novos enums/tabelas/índices), sem quebra de contract legado.
- Rollback recomendado por aplicação:
1. Desabilitar uso das novas rotas/flows de promotion.
2. Manter tabelas para preservação de trilha auditável já gravada.
3. Evitar remoção física dos artefatos de lineage em produção.
