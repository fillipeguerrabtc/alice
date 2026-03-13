# Plano Canônico de Refatoração do Domínio Trading

Author: Fillipe Guerra  
Data: 2026-03-13

## 1. Objetivo da refatoração
Executar uma refatoração progressiva e production-grade do domínio Trading da Alice, cobrindo Frontend, Backend, UX, observability, state model, Signal Engine, integração com Training e Demo Trading, sem quebrar a arquitetura real do monorepo.

## 2. Escopo
- Trading Real (`apps/frontend-service/src/pages/Trading.tsx` + `TradingContent.tsx`)
- Demo Trading (`apps/frontend-service/src/pages/DemoTrading.tsx`)
- APIs e pipelines de Trading no `integrations-service`
- Auto Engine e processamento assíncrono no `training-service`
- Contratos compartilhados em `packages/`
- Documentação operacional em `docs/trading/`

## 3. Premissas e guardrails
- Sem mudança funcional de produto na Rodada 1 (baseline).
- Sem alterar gatilhos/triggers/bindings/wiring de workflows nesta rodada.
- Sem stubs, mocks, placeholders, hardcoded, in-memory ou workaround.
- Reuso de patterns reais existentes no monorepo.
- `blocked` e `no_trade` devem permanecer estados explícitos e auditáveis.
- Telemetria estruturada e logging com padrões reais da plataforma.
- Diretriz adicional do usuário (2026-03-12): evitar stack paralela `legacy + v2`; evolução deve manter trilha única e limpa, com cleanup contínuo.

## 4. Estado atual resumido
- Trading Real e Demo Trading já possuem base robusta com hooks especializados e integração com APIs reais.
- Auto Engine já opera por filas e persistência em `trading_auto_runs`, `trading_auto_run_steps` e `trading_auto_decisions`.
- Signal Generation já expõe estados de sucesso e no-trade via `trading_signals` e metadata.
- Baseline de feature flag e state model já foi concluída; a Shell V2 compartilhada já está montável em Real e Demo com fallback legacy por flag.
- O modo `operate` da Workspace V2 já está ativo no caminho V2 para Real e Demo, com primeira dobra focada em execução e progressive disclosure para detalhes avançados.
- O modo `ai-signals` da Workspace V2 já está ativo com cockpit dedicado, classificação explícita de estados e reason codes em dois níveis.
- A Demo Trading já converge para a shell V2 em todos os quatro modos no caminho com flag ativa, incluindo handoff explícito de sinal para paper execution.
- A Rodada 10 foi concluída com cleanup controlado, adapters de compatibilidade, testes críticos adicionais e documentação final de rollout/migration/rollback.

## 5. Plano por rodadas
1. Baseline, Feature Flag, Domain Map e Plano Canônico.
2. State Model e Observability do Auto Engine.
3. Shared Trading Workspace Shell V2.
4. Modo Operar na Workspace V2.
5. AI Signals Cockpit V2.
6. Convergência da Demo Trading para Workspace V2.
7. Decomposição do Signal Engine.
8. Strategy Specialists e Data Requirements.
9. Training, Calibration e Promotion Path.
10. Cleanup, Compatibility Layer, Tests e Documentação Final.

## 6. Status de cada rodada
- Rodada 1: Concluída
- Rodada 2: Concluída
- Rodada 3: Concluída
- Rodada 4: Concluída
- Rodada 5: Concluída
- Rodada 6: Concluída
- Rodada 7: Concluída
- Rodada 8: Concluída
- Rodada 9: Concluída
- Rodada 10: Concluída

## 7. Arquivos impactados por rodada
### Rodada 1
- `apps/frontend-service/src/lib/tradingTelemetry.ts` (novo)
- `apps/frontend-service/src/components/trading/useTradingSignalMutations.ts`
- `apps/frontend-service/src/components/trading/useTradingPipelineActions.ts`
- `apps/frontend-service/src/components/trading/useTradingWorkspaceNavigation.ts`
- `apps/frontend-service/src/pages/TradingContent.tsx`
- `apps/frontend-service/src/pages/DemoTrading.tsx`
- `apps/frontend-service/src/components/trading/TradingDomainTypes.ts`
- `apps/integrations-service/src/routes/trading-websocket-routes.ts`
- `apps/integrations-service/src/routes/trading-signal-generation-routes.ts`
- `packages/shared-utils/src/feature-flags.ts`
- `tests/unit/feature-flags.test.ts`
- `docs/trading/plano-refatoracao-trading.md` (novo)
- `docs/trading/domain-map-trading.md` (novo)

### Rodada 2
- `packages/shared/src/schema.ts`
- `migrations/0109_trading_auto_run_terminal_states.sql` (novo)
- `apps/training-service/src/index.ts`
- `apps/integrations-service/src/routes/trading-automation-routes.ts`
- `apps/frontend-service/src/services/api/trading.ts`
- `apps/frontend-service/src/components/trading/useTradingSetupQueries.ts`
- `apps/frontend-service/src/pages/TradingContent.tsx`
- `apps/frontend-service/src/pages/DemoTrading.tsx`
- `docs/trading/domain-map-trading.md`
- `docs/trading/auto-engine-state-model.md` (novo)
- `docs/trading/auto-engine-contracts-observability.md` (novo)
- `docs/trading/plano-refatoracao-trading.md`

### Rodada 3
- `apps/frontend-service/src/components/trading-v2/types.ts` (novo)
- `apps/frontend-service/src/components/trading-v2/TradingWorkspaceTopBar.tsx` (novo)
- `apps/frontend-service/src/components/trading-v2/TradingWorkspaceSidebar.tsx` (novo)
- `apps/frontend-service/src/components/trading-v2/TradingWorkspaceBottomTray.tsx` (novo)
- `apps/frontend-service/src/components/trading-v2/TradingWorkspaceShell.tsx` (novo)
- `apps/frontend-service/src/components/trading-v2/index.ts` (novo)
- `apps/frontend-service/src/pages/TradingContent.tsx`
- `apps/frontend-service/src/pages/DemoTrading.tsx`
- `docs/trading/workspace-shell-v2.md` (novo)
- `docs/trading/domain-map-trading.md`
- `docs/trading/plano-refatoracao-trading.md`

### Rodada 4
- `apps/frontend-service/src/components/trading-v2/TradingWorkspaceOperateMode.tsx` (novo)
- `apps/frontend-service/src/components/trading-v2/TradingWorkspaceOperateStatusCard.tsx` (novo)
- `apps/frontend-service/src/components/trading-v2/TradingWorkspaceCompactOrderTicket.tsx` (novo)
- `apps/frontend-service/src/components/trading-v2/index.ts`
- `apps/frontend-service/src/pages/TradingContent.tsx`
- `apps/frontend-service/src/pages/DemoTrading.tsx`
- `docs/trading/workspace-shell-v2.md`
- `docs/trading/domain-map-trading.md`
- `docs/trading/plano-refatoracao-trading.md`

### Rodada 5
- `apps/frontend-service/src/components/trading-v2/TradingWorkspaceAiSignalsCockpitMode.tsx` (novo)
- `apps/frontend-service/src/components/trading-v2/index.ts`
- `apps/frontend-service/src/pages/TradingContent.tsx`
- `apps/frontend-service/src/lib/tradingTelemetry.ts`
- `apps/frontend-service/src/components/trading/useTradingSignalMutations.ts`
- `apps/integrations-service/src/routes/trading-signal-generation-routes.ts`
- `docs/trading/ai-signals-cockpit-v2.md` (novo)
- `docs/trading/workspace-shell-v2.md`
- `docs/trading/domain-map-trading.md`
- `docs/trading/auto-engine-contracts-observability.md`
- `docs/trading/plano-refatoracao-trading.md`

### Rodada 6
- `apps/frontend-service/src/components/trading-v2/TradingWorkspaceDemoAiSignalsMode.tsx` (novo)
- `apps/frontend-service/src/components/trading-v2/TradingWorkspaceDemoPortfolioAutoMode.tsx` (novo)
- `apps/frontend-service/src/components/trading-v2/TradingWorkspaceDemoPostTradeMode.tsx` (novo)
- `apps/frontend-service/src/components/trading-v2/index.ts`
- `apps/frontend-service/src/lib/tradingDemoSchemas.ts`
- `apps/frontend-service/src/services/api/tradingDemo.ts`
- `apps/frontend-service/src/pages/DemoTrading.tsx`
- `docs/trading/convergencia-demo-workspace-v2.md` (novo)
- `docs/trading/demo-isolation-guarantees.md` (novo)
- `docs/trading/workspace-shell-v2.md`
- `docs/trading/domain-map-trading.md`
- `docs/trading/plano-refatoracao-trading.md`

### Rodada 7
- `apps/integrations-service/src/trading-signal-engine-types.ts` (novo)
- `apps/integrations-service/src/trading-signal-engine-pipeline-service.ts` (novo)
- `apps/integrations-service/src/trading-llm-signal-generation-service.ts`
- `tests/unit/services/trading-signal-engine-pipeline.test.ts` (novo)
- `docs/trading/signal-engine-pipeline.md` (novo)
- `docs/trading/domain-map-trading.md`
- `docs/trading/plano-refatoracao-trading.md`

### Rodada 8
- `packages/shared/src/schema.ts`
- `apps/integrations-service/src/trading-technique-capability-service.ts` (novo)
- `apps/integrations-service/src/technical-indicators.ts`
- `apps/integrations-service/src/trading-analysis-consensus-service.ts`
- `apps/integrations-service/src/trading-technical-analysis-service.ts`
- `apps/integrations-service/src/trading-signal-analysis-orchestration-service.ts`
- `apps/integrations-service/src/trading-signal-engine-pipeline-service.ts`
- `apps/integrations-service/src/trading-signal-engine-types.ts`
- `apps/integrations-service/src/trading-llm-signal-persistence-service.ts`
- `apps/integrations-service/src/routes/trading-analysis-routes.ts`
- `apps/frontend-service/src/components/trading/TradingDomainTypes.ts`
- `apps/frontend-service/src/components/trading/TradingSignalsProfileConfigurationSection.tsx`
- `apps/frontend-service/src/components/trading/TradingSignalsTabContent.tsx`
- `apps/frontend-service/src/components/trading/useTradingSetupQueries.ts`
- `apps/frontend-service/src/components/trading/TechnicalAnalysisPanel.tsx`
- `apps/frontend-service/src/pages/TradingContent.tsx`
- `tests/unit/services/trading-technique-capability-service.test.ts` (novo)
- `tests/unit/services/trading-signal-engine-pipeline.test.ts`
- `docs/trading/strategy-specialists-data-requirements.md` (novo)
- `docs/trading/domain-map-trading.md`
- `docs/trading/signal-engine-pipeline.md`
- `docs/trading/plano-refatoracao-trading.md`

### Rodada 9
- `packages/shared/src/schema.ts`
- `migrations/0110_trading_signal_promotion_path.sql` (novo)
- `apps/integrations-service/src/trading-signal-promotion-service.ts` (novo)
- `apps/integrations-service/src/routes/trading-signal-promotion-routes.ts` (novo)
- `apps/integrations-service/src/routes/demo-trading-routes.ts`
- `apps/integrations-service/src/routes/trading-dataset-routes.ts`
- `apps/integrations-service/src/openapi-specs.ts`
- `apps/integrations-service/src/index.ts`
- `apps/frontend-service/src/services/api/trading.ts`
- `apps/frontend-service/src/components/trading-v2/TradingWorkspaceAiSignalsCockpitMode.tsx`
- `docs/trading/training-calibration-promotion-path.md` (novo)
- `docs/trading/ai-signals-cockpit-v2.md`
- `docs/trading/domain-map-trading.md`
- `docs/trading/plano-refatoracao-trading.md`

### Rodada 10
- `apps/frontend-service/src/components/trading-v2/workspace-rollout-adapter.ts` (novo)
- `apps/frontend-service/src/components/trading-v2/ai-signals-cockpit-state-adapter.ts` (novo)
- `apps/frontend-service/src/components/trading-v2/ai-signals-demo-handoff-adapter.ts` (novo)
- `apps/frontend-service/src/components/trading-v2/TradingWorkspaceAiSignalsCockpitMode.tsx`
- `apps/frontend-service/src/components/trading-v2/index.ts`
- `apps/frontend-service/src/pages/TradingContent.tsx`
- `apps/frontend-service/src/pages/DemoTrading.tsx`
- `apps/frontend-service/src/services/api/trading.ts`
- `apps/integrations-service/src/routes/trading-signal-promotion-routes.ts`
- `tests/unit/frontend/trading-workspace-rollout-adapter.test.ts` (novo)
- `tests/unit/frontend/trading-signals-cockpit-state-adapter.test.ts` (novo)
- `tests/unit/frontend/trading-signal-demo-handoff-adapter.test.ts` (novo)
- `tests/unit/services/trading-signal-promotion-service-helpers.test.ts` (novo)
- `docs/trading/arquitetura-compatibilidade-trading-v2.md` (novo)
- `docs/trading/rollout-migration-rollback-trading-v2.md` (novo)
- `docs/trading/operacao-testes-trading-v2.md` (novo)
- `docs/trading/plano-refatoracao-trading.md`

## 8. Migrations criadas
- Rodada 1: Nenhuma.
- Rodada 2:
- `0109_trading_auto_run_terminal_states.sql` (enum `trading_auto_run_status` com `no_trade` e `blocked`, coluna `terminal_reason_code`, índice parcial por reason code).
- Rodada 3: Nenhuma.
- Rodada 4: Nenhuma.
- Rodada 5: Nenhuma.
- Rodada 6: Nenhuma.
- Rodada 7: Nenhuma.
- Rodada 8: Nenhuma.
- Rodada 9:
- `0110_trading_signal_promotion_path.sql` (novos enums de promotion path + tabelas `trading_signal_promotions` e `trading_signal_promotion_events` + índices de consulta/auditoria).
- Rodada 10: Nenhuma.

## 9. Testes executados
- Rodada 1:
- Comando: `pnpm test`
- Resultado: `129` arquivos de teste aprovados, `1385` testes aprovados, `0` falhas.
- Rodada 2:
- Comando: `pnpm test`
- Resultado: `129` arquivos de teste aprovados, `1385` testes aprovados, `0` falhas.
- Rodada 3:
- Comando: `pnpm test`
- Resultado: `129` arquivos de teste aprovados, `1385` testes aprovados, `0` falhas.
- Rodada 4:
- Comando: `pnpm test`
- Resultado: `129` arquivos de teste aprovados, `1385` testes aprovados, `0` falhas.
- Rodada 5:
- Comando: `pnpm test`
- Resultado: `129` arquivos de teste aprovados, `1385` testes aprovados, `0` falhas.
- Rodada 6:
- Comando: `pnpm test`
- Resultado: `129` arquivos de teste aprovados, `1385` testes aprovados, `0` falhas.
- Rodada 7:
- Comando: `pnpm test`
- Resultado: `130` arquivos de teste aprovados, `1388` testes aprovados, `0` falhas.
- Rodada 8:
- Comando: `pnpm test`
- Resultado: `131` arquivos de teste aprovados, `1395` testes aprovados, `0` falhas.
- Rodada 9:
- Comando: `pnpm test`
- Resultado: `131` arquivos de teste aprovados, `1395` testes aprovados, `0` falhas.
- Rodada 10:
- Comando: `pnpm test -- --reporter=dot`
- Resultado: `135` arquivos de teste aprovados, `1415` testes aprovados, `0` falhas.

## 10. Resultados de Typecheck
- Rodada 1:
- Comando: `pnpm typecheck`
- Resultado: sucesso, sem erros.
- Rodada 2:
- Comando: `pnpm typecheck`
- Resultado: sucesso, sem erros.
- Rodada 3:
- Comando: `pnpm typecheck`
- Resultado: sucesso, sem erros.
- Rodada 4:
- Comando: `pnpm typecheck`
- Resultado: sucesso, sem erros.
- Rodada 5:
- Comando: `pnpm typecheck`
- Resultado: sucesso, sem erros.
- Rodada 6:
- Comando: `pnpm typecheck`
- Resultado: sucesso, sem erros.
- Rodada 7:
- Comando: `pnpm typecheck`
- Resultado: sucesso, sem erros.
- Rodada 8:
- Comando: `pnpm typecheck`
- Resultado: sucesso, sem erros.
- Rodada 9:
- Comando: `pnpm typecheck`
- Resultado: sucesso, sem erros.
- Rodada 10:
- Comando: `pnpm typecheck`
- Resultado: sucesso, sem erros.

## 11. Resultados de ESLint
- Rodada 1:
- Comando: `pnpm lint`
- Resultado: sucesso, sem warnings e sem errors.
- Rodada 2:
- Comando: `pnpm lint`
- Resultado: sucesso, sem warnings e sem errors.
- Rodada 3:
- Comando: `pnpm lint`
- Resultado: sucesso, sem warnings e sem errors.
- Rodada 4:
- Comando: `pnpm lint`
- Resultado: sucesso, sem warnings e sem errors.
- Rodada 5:
- Comando: `pnpm lint`
- Resultado: sucesso, sem warnings e sem errors.
- Rodada 6:
- Comando: `pnpm lint`
- Resultado: sucesso, sem warnings e sem errors.
- Rodada 7:
- Comando: `pnpm lint`
- Resultado: sucesso, sem warnings e sem errors.
- Rodada 8:
- Comando: `pnpm lint`
- Resultado: sucesso, sem warnings e sem errors.
- Rodada 9:
- Comando: `pnpm lint`
- Resultado: sucesso, sem warnings e sem errors.
- Rodada 10:
- Comando: `pnpm lint`
- Resultado: sucesso, sem warnings e sem errors.

## 12. Resultados de Build
- Rodada 1:
- Comando: `pnpm --filter @alice/shared-utils build`
- Resultado: sucesso.
- Comando: `pnpm --filter @alice/integrations-service build`
- Resultado: sucesso.
- Comando: `pnpm --filter @alice/frontend-service build`
- Resultado: sucesso.
- Rodada 2:
- Comando: `pnpm --filter @alice/shared build`
- Resultado: sucesso.
- Comando: `pnpm --filter @alice/integrations-service build`
- Resultado: sucesso.
- Comando: `pnpm --filter @alice/training-service build`
- Resultado: sucesso.
- Comando: `pnpm --filter @alice/frontend-service build`
- Resultado: sucesso.
- Rodada 3:
- Comando: `pnpm --filter @alice/frontend-service build`
- Resultado: sucesso.
- Rodada 4:
- Comando: `pnpm exec tsc -b` (em `apps/frontend-service`)
- Resultado: sucesso.
- Comando: `pnpm exec vite build` (em `apps/frontend-service`)
- Resultado: sucesso.
- Rodada 5:
- Comando: `pnpm --filter @alice/integrations-service build`
- Resultado: sucesso.
- Comando: `pnpm exec tsc -b` (em `apps/frontend-service`)
- Resultado: sucesso.
- Comando: `pnpm exec vite build` (em `apps/frontend-service`)
- Resultado: sucesso.
- Rodada 6:
- Comando: `pnpm --filter frontend-service build`
- Resultado: sucesso (`tsc -b && vite build`).
- Rodada 7:
- Comando: `pnpm --filter @alice/integrations-service build`
- Resultado: sucesso.
- Rodada 8:
- Comando: `pnpm --filter @alice/shared build`
- Resultado: sucesso.
- Comando: `pnpm --filter @alice/integrations-service build`
- Resultado: sucesso.
- Comando: `pnpm --filter @alice/frontend-service build`
- Resultado: sucesso (`tsc -b && vite build`).
- Rodada 9:
- Comando: `pnpm --filter @alice/shared build`
- Resultado: sucesso.
- Comando: `pnpm --filter @alice/integrations-service build`
- Resultado: sucesso.
- Comando: `pnpm --filter @alice/frontend-service build`
- Resultado: sucesso (`tsc -b && vite build`).
- Rodada 10:
- Comando: `pnpm --filter @alice/integrations-service build`
- Resultado: sucesso.
- Comando: `pnpm --filter @alice/frontend-service build`
- Resultado: sucesso (`tsc -b && vite build`).

## 13. Riscos conhecidos
- Acoplamento alto em páginas grandes (`TradingContent.tsx`, `DemoTrading.tsx`) exige mudanças muito cirúrgicas por rodada.
- Auto Engine depende de múltiplos serviços (`integrations-service`, `training-service`) e qualquer regressão de contract pode impactar filas.
- Observability ainda distribuída entre camadas; sem taxonomia única consolidada para todos eventos do domínio.
- Migração de enum em PostgreSQL é aditiva e sem rollback direto de valores; rollback deve ser por comportamento de aplicação.
- A convergência final para remover o shell legacy exige rollout gradual por flag para evitar regressão de UX em produção.
- O promotion path depende de sincronização periódica para refletir imediatamente mudanças externas de dataset/calibration em todos os consumers.
- A camada de compatibilidade de contracts deve ser monitorada para remover aliases legados sem quebrar consumers externos.

## 14. Pendências
- Nenhuma pendência crítica aberta para conclusão da refatoração em 10 rodadas.
- Pendência operacional contínua: monitorar rollout por flag e planejar remoção progressiva de aliases de compatibilidade após janela segura.

## 15. Decisões arquiteturais registradas
- Feature flag `trading_workspace_v2_enabled` adicionada como baseline de rollout controlado.
- Telemetria mínima da rodada implementada sem mudança funcional de UX/fluxo.
- Evolução com trilha única de código, evitando convivência prolongada `legacy + v2` paralelos.
- State model do Auto Engine atualizado para terminal states explícitos (`succeeded`, `no_trade`, `blocked`, `failed`).
- `terminal_reason_code` adicionado em `trading_auto_runs` para classificação queryável e auditável de estado terminal.
- Shell V2 compartilhada criada em `components/trading-v2` e integrada em Trading Real e Demo Trading com quatro modos primários e progressive disclosure para áreas avançadas.
- Modo `operate` implementado na V2 com blocos de execução reutilizando data sources reais existentes e mantendo separação explícita entre execução Real e Demo.
- AI Signals Cockpit V2 implementado como trilha dedicada no modo `ai-signals`, com estados de produto explícitos e reason codes em dois níveis (machine-readable e user-readable).
- Contract de geração de sinal atualizado com bloco `signalGeneration` (`stateCategory`, `reasonCode`, `reasonHuman`) para consumo auditável no frontend.
- Convergência da Demo para a shell V2 concluída no caminho com flag ativa, removendo dependência operacional dos `TabsContent` legados para `ai-signals`, `portfolio-auto` e `post-trade`.
- Handoff explícito de sinal IA para demo execution padronizado via `POST /api/integrations/demo-trading/orders/from-signal`.
- Garantias de isolamento Demo vs Live documentadas com evidências de rota, persistência e scoping por tenant.
- Signal Engine decomposto em pipeline interno com estágios explícitos (`feature_extraction`, `candidate_generation`, `llm_arbitration`, `risk_shaping`, `persistence`, `validation_finalize`).
- Tipos compartilhados do pipeline centralizados em `trading-signal-engine-types.ts`, reduzindo acoplamento e duplicação no gerador principal.
- Compatibilidade externa preservada no serviço/rota de geração de sinal, com observability estruturada por estágio (`trading.signal.pipeline.stage`, `trading.signal.pipeline.completed`).
- Capability matrix por `technique` introduzida com specialist families e minimum data requirements explícitos.
- Técnicas subimplementadas deixaram de produzir inferência neutral fake e agora retornam `blocked`/`not_supported_for_current_context` com `reasonCode` e `reasonHuman`.
- Contracts de `analysis-profile` e `analysis/:symbol` passam a expor `techniqueCapabilities[]` para elegibilidade real por technique em API e UI.
- Metadata de sinais persiste `techniqueCapabilities` para auditabilidade de suporte no momento da geração.
- Promotion path enterprise de sinais introduzido com lifecycle explícito (`candidate_evidence_captured` até `real_eligible`) e trilha auditável por evento.
- Handoff para Demo agora valida elegibilidade (`assertSignalDemoEligibility`) antes da execução e registra lineage pós-ordem.
- Handoff para Training via `datasets/from-signal` passou a operar como fluxo first-class do Cockpit V2, com atualização do snapshot de promotion em metadata.
- Contract API atualizado com `GET /signals/:id/promotion-path` e `POST /signals/:id/promote-real-eligibility`, mantendo compatibilidade de rota legada.
- Rodada 10 consolidou adapters explícitos de compatibilidade para rollout controlado (`workspace-rollout-adapter`, aliases de API frontend e aliases de rota backend) sem quebrar consumers legados.
- A lógica de state mapping e handoff do Cockpit V2 foi extraída para adapters reutilizáveis, reduzindo acoplamento no componente principal e facilitando remoção segura do legado.
- Testes críticos de rendering, terminal state mapping, blocked/no_trade UX, demo handoff e lineage helpers foram adicionados para sustentar cleanup com segurança.

## 16. Próximos passos
1. Executar rollout controlado da V2 em produção com monitoramento de erros, uso de aliases e regressões de UX.
2. Após janela operacional estável, descontinuar aliases legados de API/feature flag com plano de comunicação e remoção faseada.
3. Manter checklist sequencial de validação e documentação para qualquer mudança incremental pós-refatoração.
