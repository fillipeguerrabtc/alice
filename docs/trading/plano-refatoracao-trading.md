# Plano Canônico de Refatoração do Domínio Trading

Author: Fillipe Guerra  
Data: 2026-03-12

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
- Faltava baseline explícita de feature flag para Workspace V2 e telemetria mínima padronizada da rodada.

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
- Rodada 2: Pendente
- Rodada 3: Pendente
- Rodada 4: Pendente
- Rodada 5: Pendente
- Rodada 6: Pendente
- Rodada 7: Pendente
- Rodada 8: Pendente
- Rodada 9: Pendente
- Rodada 10: Pendente

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

## 8. Migrations criadas
- Rodada 1: Nenhuma.

## 9. Testes executados
- Rodada 1:
- Comando: `pnpm test`
- Resultado: `129` arquivos de teste aprovados, `1385` testes aprovados, `0` falhas.

## 10. Resultados de Typecheck
- Rodada 1:
- Comando: `pnpm typecheck`
- Resultado: sucesso, sem erros.

## 11. Resultados de ESLint
- Rodada 1:
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

## 13. Riscos conhecidos
- Acoplamento alto em páginas grandes (`TradingContent.tsx`, `DemoTrading.tsx`) exige mudanças muito cirúrgicas por rodada.
- Auto Engine depende de múltiplos serviços (`integrations-service`, `training-service`) e qualquer regressão de contract pode impactar filas.
- Observability ainda distribuída entre camadas; sem taxonomia única consolidada para todos eventos do domínio.

## 14. Pendências
- Receber prompt da Rodada 2 para iniciar próximas mudanças de domínio.

## 15. Decisões arquiteturais registradas
- Feature flag `trading_workspace_v2_enabled` adicionada como baseline de rollout controlado.
- Telemetria mínima da rodada implementada sem mudança funcional de UX/fluxo.
- Evolução com trilha única de código, evitando convivência prolongada `legacy + v2` paralelos.

## 16. Próximos passos
1. Iniciar Rodada 2 focando state model e observability do Auto Engine.
2. Manter evolução sem trilha paralela `legacy + v2`, com cleanup contínuo.
3. Repetir checklist sequencial de validação e atualização documental ao fechamento da próxima rodada.
