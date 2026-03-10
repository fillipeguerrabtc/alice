# Alice Enterprise Platform - STATUS REAL ATUAL

**Autor:** Fillipe Guerra  
**Data:** 10 de Março de 2026  
**Método:** Verificação direta do código-fonte + revisão sistemática completa  
**Versão:** 15.15 - Plano enterprise 100% concluído com fechamento residual de frontend

---

- **Fechamento de pendências de validação (10/03/2026):** correção dos 7 testes falhos pós-refactor (guards de Chat/Trading/Auth/Training/Integrations) com atualização de asserts para os novos boundaries modulares; suíte voltou para **120/120 arquivos e 1352/1352 testes** em status OK.
- **Consolidação histórica concluída (10/03/2026):** rebase/squash não-interativo finalizado sobre `origin/main`, com backup preservado em `backup/pre-squash-20260310-1` e normalização objetiva dos indicadores de governança de commits.
- **Guardrails operacionais em enforcement real (10/03/2026):** scripts `verify:enterprise-focus`, `verify:enterprise-focus:full` e `validate:enterprise` ativados no `package.json` com `ENFORCE_FAILURE=true`.
- **Métricas pós-consolidação (10/03/2026):** janela 418 com churn documental em 8,76% e foco Wise em 0,87%; janela 50 com churn documental em 4,85% e foco Wise em 0,00% (todos os checks em status OK).
- **Redução adicional de fragmentação/densidade no frontend (10/03/2026):** domínio `wise-payments` reduzido para 176 arquivos TS/TSX e 13.976 linhas; arquivos `<40` linhas reduzidos para 16; `TradingContent.tsx` reduzido para 1321 linhas e `useChatPageLayoutController.ts` para 591 linhas.
- **Correção objetiva dos 4 itens finais de review (10/03/2026):** consolidado em `apps/frontend-service/src/pages/wise-payments/use-wise-page-composition.ts` com remoção de 6 wrappers redundantes (`use-wise-tab-props.ts`, `build-wise-profile-scoped-tab-props.ts`, `build-wise-operational-tabs-props.ts`, `build-wise-tab-profile-props.ts`, `build-wise-tab-operational-props.ts` e `wise-tab-props-types.ts`), reduzindo o domínio Wise de 193 para 187 arquivos TS/TSX e de 14.245 para 14.155 linhas.
- **Governança anti-churn e anti-desbalanceamento (10/03/2026):** novo guardrail operacional `scripts/verify-enterprise-focus.sh` adiciona checagens de churn documental, concentração de foco por domínio e densidade/fragmentação de frontend para evitar regressão em próximas rodadas.
- **Densidade de containers reduzida (10/03/2026):** `apps/frontend-service/src/pages/TradingContent.tsx` foi reduzido de 1387 para 1331 linhas e `apps/frontend-service/src/pages/Chat/useChatPageLayoutController.ts` de 612 para 597 linhas sem alteração de comportamento, contratos de API ou RBAC.
- **Fechamento formal do plano enterprise em 100% (10/03/2026):** status dos blocos P0/P1/P2 consolidado como concluído em `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md` após fechamento dos residuais críticos de frontend e varredura final cruzada.
- **Cleanup final de residual em Trading/Chat (10/03/2026):** `apps/frontend-service/src/pages/TradingContent.tsx` recebeu composição explícita por domínio para `section-props` (`primaryTabsOptions`, `operationalTabsOptions`, `dialogsOptions`, `layoutOptions`) e `apps/frontend-service/src/pages/Chat/useChatPageLayoutController.ts` recebeu normalização final de handlers/flags com remoção de wrappers inline residuais, sem alteração de API/RBAC.
- **Cleanup residual de composição em Trading/Chat (10/03/2026):** `apps/frontend-service/src/pages/TradingContent.tsx` recebeu redução de densidade da composição de `section-props/options` via contextos compartilhados (i18n + seleção de mercado/símbolo), e `apps/frontend-service/src/pages/Chat/useChatPageLayoutController.ts` recebeu cleanup de orquestração (callbacks nomeados e remoção de wrappers inline redundantes), sem alteração de API/RBAC.
- **Auditoria anti-fragmentação dos últimos 400 commits (10/03/2026):** análise objetiva de churn confirmou hotspot em `apps/frontend-service/src/pages/wise-payments` com 193 arquivos TS/TSX e 14.245 linhas; execução ajustada para não abrir novos micro-boundaries fora de necessidade crítica até fechamento do P2.
- **Decomposição incremental de catalog params/balances header em WisePayments (10/03/2026):** `apps/frontend-service/src/pages/wise-payments/components/wise-catalog-params-fields.tsx` passou a atuar como composition root fino e delegar campos para `apps/frontend-service/src/pages/wise-payments/components/wise-catalog-path-param-inputs.tsx` e `wise-catalog-query-param-controls.tsx`; `apps/frontend-service/src/pages/wise-payments/components/wise-balances-header.tsx` passou a delegar o fluxo modal de criação para `wise-balances-new-balance-dialog.tsx` e `wise-balances-new-balance-form-fields.tsx`, sem alteração de API/RBAC.
- **Decomposição incremental de SCA/simulations operation em WisePayments (10/03/2026):** `apps/frontend-service/src/pages/wise-payments/components/wise-sca-tab-content.tsx` passou a atuar como composition root fino de UI, delegando seções para `apps/frontend-service/src/pages/wise-payments/components/wise-sca-toolbar.tsx` e `wise-sca-payload-card.tsx`, com contratos tipados em `wise-sca-tab-types.ts`; `apps/frontend-service/src/pages/wise-payments/components/wise-simulations-operation-card.tsx` passou a delegar blocos para `wise-simulations-operation-select.tsx`, `wise-simulations-operation-fields.tsx` e `wise-simulations-operation-response.tsx`, sem alteração de API/RBAC.
- **Decomposição incremental de webhooks/card-orders actions em WisePayments (10/03/2026):** `apps/frontend-service/src/pages/wise-payments/components/wise-webhooks-tab-content.tsx` passou a atuar como composition root fino de UI, delegando seções para `apps/frontend-service/src/pages/wise-payments/components/wise-webhooks-toolbar.tsx`, `wise-webhooks-create-card.tsx`, `wise-webhooks-delete-card.tsx` e `wise-webhooks-response-card.tsx`, com contratos tipados em `wise-webhooks-tab-types.ts`; `apps/frontend-service/src/pages/wise-payments/components/wise-card-orders-actions-card.tsx` passou a delegar blocos para `wise-card-orders-order-reference-row.tsx`, `wise-card-orders-json-action-block.tsx` e `wise-card-orders-actions-footer.tsx`, com contratos tipados em `wise-card-orders-actions-card-types.ts`, sem alteração de API/RBAC.
- **Decomposição incremental de exchange quote/spend-limits em WisePayments (10/03/2026):** `apps/frontend-service/src/pages/wise-payments/components/wise-exchange-quote-form-card.tsx` passou a delegar seções para `apps/frontend-service/src/pages/wise-payments/components/wise-exchange-quote-form-fields.tsx` e `wise-exchange-quote-result-card.tsx`; `apps/frontend-service/src/pages/wise-payments/components/wise-spend-limits-tab-content.tsx` passou a atuar como composition root fino delegando seções para `wise-spend-limits-fetch-controls.tsx`, `wise-spend-limits-update-panels.tsx` e `wise-spend-limits-response-panels.tsx`, com contratos tipados em `wise-spend-limits-tab-types.ts`, sem alteração de API/RBAC.
- **Decomposição incremental das tabs de kyc/simulations em WisePayments (10/03/2026):** `apps/frontend-service/src/pages/wise-payments/components/wise-kyc-tab-content.tsx` passou a atuar como composition root fino delegando seções para `apps/frontend-service/src/pages/wise-payments/components/wise-kyc-toolbar.tsx`, `wise-kyc-evidences-card.tsx`, `wise-kyc-upload-card.tsx` e `wise-kyc-reviews-card.tsx`, com contratos tipados em `wise-kyc-tab-types.ts`; `apps/frontend-service/src/pages/wise-payments/components/wise-simulations-tab-content.tsx` passou a atuar como composition root fino delegando seções para `wise-simulations-toolbar.tsx` e `wise-simulations-operation-card.tsx`, com contratos tipados em `wise-simulations-tab-types.ts`, sem alteração de API/RBAC.
- **Decomposição incremental do gate de status em Trading (10/03/2026):** early-returns de loading/erro/not-configured/tenant-required foram extraídos de `apps/frontend-service/src/pages/TradingContent.tsx` para `apps/frontend-service/src/components/trading/TradingStatusGate.tsx` via `resolveTradingStatusGate(...)`, com export em `apps/frontend-service/src/components/trading/index.ts`, sem alteração de API/RBAC.
- **Decomposição incremental das tabs de quotes/statements em WisePayments (10/03/2026):** `apps/frontend-service/src/pages/wise-payments/components/wise-quotes-tab-content.tsx` passou a atuar como composition root fino delegando seções para `apps/frontend-service/src/pages/wise-payments/components/wise-quotes-form-card.tsx` e `wise-quotes-result-card.tsx`, com contratos tipados em `wise-quotes-tab-types.ts`; `apps/frontend-service/src/pages/wise-payments/components/wise-statements-tab-content.tsx` passou a atuar como composition root fino delegando seções para `wise-statements-filter-card.tsx` e `wise-statements-result-card.tsx`, com contratos tipados em `wise-statements-tab-types.ts`, sem alteração de API/RBAC.
- **Decomposição incremental das tabs de cards/card-transactions em WisePayments (10/03/2026):** `apps/frontend-service/src/pages/wise-payments/components/wise-cards-tab-content.tsx` passou a atuar como composition root fino de UI, delegando seções para `apps/frontend-service/src/pages/wise-payments/components/wise-cards-toolbar.tsx` e `wise-cards-list-card.tsx`, com contratos tipados em `wise-cards-tab-types.ts`; `apps/frontend-service/src/pages/wise-payments/components/wise-card-transactions-tab-content.tsx` passou a atuar como composition root fino delegando seções para `wise-card-transactions-toolbar.tsx` e `wise-card-transactions-fetch-card.tsx`, com contratos tipados em `wise-card-transactions-tab-types.ts`, sem alteração de API/RBAC.
- **Decomposição incremental das tabs de account-details/catalog em WisePayments (10/03/2026):** `apps/frontend-service/src/pages/wise-payments/components/wise-account-details-tab-content.tsx` passou a atuar como composition root fino de UI, delegando seções para `apps/frontend-service/src/pages/wise-payments/components/wise-account-details-toolbar.tsx`, `wise-account-details-create-card.tsx`, `wise-account-details-list-card.tsx`, `wise-account-details-orders-card.tsx` e `wise-recipient-requirements-card.tsx`, com contratos tipados em `wise-account-details-tab-types.ts`; `apps/frontend-service/src/pages/wise-payments/components/wise-catalog-tab-content.tsx` passou a atuar como composition root fino delegando seções para `wise-catalog-operation-config.tsx`, `wise-catalog-params-fields.tsx` e `wise-catalog-execution-panel.tsx`, com contratos tipados em `wise-catalog-tab-types.ts`, sem alteração de API/RBAC.
- **Decomposição incremental das tabs de transfers/exchange em WisePayments (10/03/2026):** `apps/frontend-service/src/pages/wise-payments/components/wise-transfers-tab-content.tsx` passou a atuar como composition root fino de UI, delegando seções para `apps/frontend-service/src/pages/wise-payments/components/wise-transfers-header.tsx`, `wise-transfers-list-card.tsx` e `wise-transfers-actions-card.tsx`, com contratos tipados em `wise-transfers-tab-types.ts`; `apps/frontend-service/src/pages/wise-payments/components/wise-exchange-tab-content.tsx` passou a atuar como composition root fino delegando seções para `wise-exchange-quote-form-card.tsx` e `wise-exchange-rates-card.tsx`, com contratos tipados em `wise-exchange-tab-types.ts`, sem alteração de API/RBAC.
- **Decomposição incremental da tab de balances em WisePayments (10/03/2026):** `apps/frontend-service/src/pages/wise-payments/components/wise-balances-tab-content.tsx` passou a atuar como composition root fino de UI, delegando seções para `apps/frontend-service/src/pages/wise-payments/components/wise-balances-header.tsx`, `wise-balances-grid.tsx`, `wise-balance-capacity-card.tsx` e `wise-total-funds-card.tsx`; contratos tipados compartilhados foram centralizados em `apps/frontend-service/src/pages/wise-payments/components/wise-balances-tab-types.ts`, sem alteração de API/RBAC.
- **Decomposição incremental da tab de disputes em WisePayments (10/03/2026):** `apps/frontend-service/src/pages/wise-payments/components/wise-disputes-tab-content.tsx` passou a atuar como composition root fino de UI, delegando seções para `apps/frontend-service/src/pages/wise-payments/components/wise-disputes-toolbar.tsx`, `wise-dispute-reasons-card.tsx`, `wise-dispute-flow-card.tsx`, `wise-dispute-upload-card.tsx`, `wise-dispute-status-update-card.tsx` e `wise-disputes-list-card.tsx`; contratos tipados compartilhados foram centralizados em `apps/frontend-service/src/pages/wise-payments/components/wise-disputes-tab-types.ts`, sem alteração de API/RBAC.
- **Decomposição incremental da tab de spend-controls em WisePayments (10/03/2026):** `apps/frontend-service/src/pages/wise-payments/components/wise-spend-controls-tab-content.tsx` passou a atuar como composition root fino de UI, delegando seções para `apps/frontend-service/src/pages/wise-payments/components/wise-spend-controls-toolbar.tsx`, `wise-spend-controls-create-card.tsx`, `wise-spend-controls-assign-card.tsx`, `wise-spend-controls-delete-card.tsx` e `wise-spend-controls-list-card.tsx`; contratos tipados compartilhados foram centralizados em `apps/frontend-service/src/pages/wise-payments/components/wise-spend-controls-tab-types.ts`, sem alteração de API/RBAC.
- **Decomposição incremental da tab de recipients em WisePayments (10/03/2026):** `apps/frontend-service/src/pages/wise-payments/components/wise-recipients-tab-content.tsx` passou a atuar como composition root fino de UI, delegando seções para `apps/frontend-service/src/pages/wise-payments/components/wise-recipients-header.tsx`, `wise-recipients-list-card.tsx`, `wise-card-permissions-card.tsx` e `wise-card-secure-card.tsx`; contratos tipados compartilhados foram centralizados em `apps/frontend-service/src/pages/wise-payments/components/wise-recipients-tab-types.ts`, sem alteração de API/RBAC.
- **Decomposição incremental da tab de card orders em WisePayments (10/03/2026):** `apps/frontend-service/src/pages/wise-payments/components/wise-card-orders-tab-content.tsx` passou a atuar como composition root fino de UI, delegando seções para `apps/frontend-service/src/pages/wise-payments/components/wise-card-orders-toolbar.tsx`, `wise-card-orders-create-card.tsx`, `wise-card-orders-actions-card.tsx` e `wise-card-orders-list-card.tsx`; contratos tipados compartilhados foram centralizados em `apps/frontend-service/src/pages/wise-payments/components/wise-card-orders-tab-types.ts`, sem alteração de API/RBAC.
- **Decomposição incremental de mutações account/card orders em WisePayments (10/03/2026):** `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-order-mutations.ts` passou a atuar como composition root fino e delegar mutações para `apps/frontend-service/src/pages/wise-payments/use-wise-account-details-order-mutation.ts`, `apps/frontend-service/src/pages/wise-payments/use-wise-card-order-write-mutations.ts` e `apps/frontend-service/src/pages/wise-payments/use-wise-card-order-read-mutations.ts`, sem alteração de API/RBAC.
- **Decomposição incremental de estado local account/card/dispute em WisePayments (10/03/2026):** novo hook `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-state.ts` centraliza estado e setters; `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-actions.ts` passou a focar em orchestration de mutações/handlers sem alterar contratos de API/RBAC.
- **Decomposição incremental do composition root de WisePayments (10/03/2026):** `apps/frontend-service/src/pages/wise-payments/use-wise-page-composition.ts` passou a atuar como composition root mais fino, delegando a suite `apps/frontend-service/src/pages/wise-payments/use-wise-actions-suite.ts` (wiring de ações por domínio) e a suite `apps/frontend-service/src/pages/wise-payments/use-wise-refresh-derived.ts` (refresh + dados derivados), sem alteração de API/RBAC.
- **Decomposição incremental de handlers de spend/card em WisePayments (10/03/2026):** `apps/frontend-service/src/pages/wise-payments/use-wise-card-spend-actions.ts` passou a atuar como composition root fino, com extração de handlers para `apps/frontend-service/src/pages/wise-payments/use-wise-card-spend-control-handlers.ts` (card status/spend-controls) e `apps/frontend-service/src/pages/wise-payments/use-wise-card-spend-limits-handlers.ts` (spend-limits profile/card), sem alteração de API/RBAC.
- **Decomposição incremental de contratos de catálogo em WisePayments (10/03/2026):** tipos compartilhados de catálogo (`WiseCatalogOperation`, `WiseCatalogParamKey`, `WiseCatalogParams`) foram centralizados em `apps/frontend-service/src/pages/wise-payments/wise-catalog-types.ts`; `apps/frontend-service/src/pages/wise-payments/use-wise-catalog-workbench.ts` e `apps/frontend-service/src/pages/wise-payments/components/wise-catalog-tab-content.tsx` passaram a consumir esse contrato único, removendo duplicações locais sem alteração de API/RBAC.
- **Decomposição incremental da composição final de tabs/constants em WisePayments (10/03/2026):** `apps/frontend-service/src/pages/wise-payments/use-wise-tab-props.ts` passou a atuar como composition root fino e delegar montagem para `build-wise-tab-profile-props.ts` e `build-wise-tab-operational-props.ts`; contratos foram centralizados em `apps/frontend-service/src/pages/wise-payments/wise-tab-props-types.ts` e `build-wise-profile-scoped-tab-props.ts`; `apps/frontend-service/src/pages/wise-payments/wise-payments-constants.tsx` passou a atuar como barrel com segmentação por domínio em `wise-catalog-operations.ts`, `wise-currency-options.ts` e `wise-status-badge.tsx`, sem alteração de API/RBAC.
- **Decomposição incremental das props profile-scoped de tabs por domínio (10/03/2026):** novos módulos `apps/frontend-service/src/pages/wise-payments/build-wise-profile-core-tabs-props.ts` e `apps/frontend-service/src/pages/wise-payments/build-wise-profile-compliance-tabs-props.ts` passaram a centralizar montagem de tabs profile-scoped por contexto; `apps/frontend-service/src/pages/wise-payments/wise-profile-tabs-props-types.ts` centralizou contratos tipados e `apps/frontend-service/src/pages/wise-payments/build-wise-profile-tabs-props.ts` passou a atuar como composition root fino sem alteração de API/RBAC.
- **Decomposição incremental das props operacionais de tabs por domínio (10/03/2026):** novos módulos `apps/frontend-service/src/pages/wise-payments/build-wise-operational-finance-tabs-props.ts` e `apps/frontend-service/src/pages/wise-payments/build-wise-operational-admin-tabs-props.ts` passaram a centralizar montagem de tabs operacionais por contexto; `apps/frontend-service/src/pages/wise-payments/wise-operational-tabs-props-types.ts` centralizou contratos tipados e `apps/frontend-service/src/pages/wise-payments/build-wise-operational-tabs-props.ts` passou a atuar como composition root fino sem alteração de API/RBAC.
- **Decomposição incremental de handlers account/dispute/KYC por subdomínio (10/03/2026):** novos módulos `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-order-action-handlers.ts` e `apps/frontend-service/src/pages/wise-payments/use-wise-dispute-kyc-action-handlers.ts` passaram a centralizar callbacks de ação por domínio; `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-actions.ts` passou a atuar como composition root fino de estado + wiring sem alteração de API/RBAC.
- **Decomposição incremental das mutações dispute/KYC por subdomínio (10/03/2026):** novos módulos `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-flow-mutations.ts` e `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-kyc-mutations.ts` passaram a centralizar mutações de `dispute status/flow/upload` e `kyc required evidences/uploads`; `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-dispute-kyc-mutations.ts` passou a atuar como composition root fino sem alteração de API/RBAC.
- **Decomposição incremental das mutações account/card order por subdomínio (10/03/2026):** novos módulos `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-order-mutations.ts` e `apps/frontend-service/src/pages/wise-payments/use-wise-card-transaction-mutation.ts` passaram a centralizar mutações de `account details/card orders` e `card transaction details`; `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-card-order-mutations.ts` passou a atuar como composition root fino sem alteração de API/RBAC.
- **Decomposição incremental das operações transfer/card por subdomínio (10/03/2026):** novos módulos `apps/frontend-service/src/pages/wise-payments/use-wise-transfer-operations.ts` e `apps/frontend-service/src/pages/wise-payments/use-wise-card-permission-secure-operations.ts` passaram a centralizar operações de transferências e operações de cartões (permissions + secure endpoints); `apps/frontend-service/src/pages/wise-payments/use-wise-transfer-and-card-operations.ts` passou a atuar como composition root fino sem alteração de API/RBAC.
- **Decomposição incremental das mutações card/spend por subdomínio (10/03/2026):** novos módulos `apps/frontend-service/src/pages/wise-payments/use-wise-card-status-mutations.ts`, `apps/frontend-service/src/pages/wise-payments/use-wise-spend-control-mutations.ts` e `apps/frontend-service/src/pages/wise-payments/use-wise-spend-limits-mutations.ts` passaram a centralizar os fluxos de `card status`, `spend-controls` e `spend-limits`; `apps/frontend-service/src/pages/wise-payments/use-wise-card-spend-mutations.ts` passou a atuar como composition root fino sem alteração de API/RBAC.
- **Decomposição incremental das mutações webhook/simulation/SCA por subdomínio (10/03/2026):** novos módulos `apps/frontend-service/src/pages/wise-payments/use-wise-webhook-mutations.ts`, `apps/frontend-service/src/pages/wise-payments/use-wise-simulation-mutations.ts` e `apps/frontend-service/src/pages/wise-payments/use-wise-sca-mutations.ts` passaram a centralizar operações por domínio; `apps/frontend-service/src/pages/wise-payments/use-wise-webhook-simulation-sca-mutations.ts` passou a atuar como composition root fino, sem alteração de API/RBAC.
- **Decomposição incremental das queries de dados Wise por escopo (10/03/2026):** novo módulo `apps/frontend-service/src/pages/wise-payments/use-wise-global-data-queries.ts` centraliza queries globais (`balances`, `transfers`, `recipients`, `batch groups`, `profiles` e `users me`) e novo módulo `apps/frontend-service/src/pages/wise-payments/use-wise-profile-scoped-data-queries.ts` centraliza queries profile-scoped (`cards`, `spend-controls`, `disputes`, `kyc`, `card-orders`, `dispute-reasons`, `account-details`); `apps/frontend-service/src/pages/wise-payments/use-wise-data-queries.ts` passou a focar em guard/estado/erro agregado, sem alteração de API/RBAC.
- **Decomposição incremental das mutações account/card/dispute em WisePayments por subdomínio (10/03/2026):** os fluxos de `account details`, `card orders` e `card transactions` foram desacoplados para `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-card-order-mutations.ts`, enquanto os fluxos de `dispute flow/upload/status` e `kyc upload/evidences` foram desacoplados para `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-dispute-kyc-mutations.ts`; `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-mutations.ts` passou a atuar como composition root fino agregando os submódulos sem alteração de API/RBAC.
- **Decomposição incremental das ações de transfer/card em WisePayments (10/03/2026):** novos módulos `apps/frontend-service/src/pages/wise-payments/wise-transfer-and-card-types.ts` e `apps/frontend-service/src/pages/wise-payments/use-wise-transfer-and-card-operations.ts` passaram a centralizar contratos e execução operacional de transferências/cartões; `apps/frontend-service/src/pages/wise-payments/use-wise-transfer-and-card-actions.ts` passou a focar em estado/composição sem alterar API/RBAC.
- **Decomposição incremental das ações de balance/exchange/statement em WisePayments (10/03/2026):** novos módulos `apps/frontend-service/src/pages/wise-payments/wise-balance-exchange-statement-types.ts` e `apps/frontend-service/src/pages/wise-payments/use-wise-balance-exchange-statement-mutations.ts` passaram a centralizar contratos/defaults e mutações de `quote`, `balances`, `exchange` e `statement`; `apps/frontend-service/src/pages/wise-payments/use-wise-balance-exchange-statement-actions.ts` passou a focar em estado/handlers e delegar IO ao boundary dedicado, sem alteração de API/RBAC.
- **Decomposição incremental das ações de webhook/simulation/SCA em WisePayments (10/03/2026):** novos módulos `apps/frontend-service/src/pages/wise-payments/wise-webhook-simulation-sca-types.ts` e `apps/frontend-service/src/pages/wise-payments/use-wise-webhook-simulation-sca-mutations.ts` passaram a centralizar contratos/defaults e mutações de webhook/simulação/SCA; `apps/frontend-service/src/pages/wise-payments/use-wise-webhook-simulation-sca-actions.ts` passou a focar em estado/handlers e delegar IO ao boundary dedicado, sem alteração de API/RBAC.
- **Decomposição incremental das ações de spend/card em WisePayments (10/03/2026):** novos módulos `apps/frontend-service/src/pages/wise-payments/wise-card-spend-types.ts` e `apps/frontend-service/src/pages/wise-payments/use-wise-card-spend-mutations.ts` passaram a centralizar contratos e mutações de `card status`, `spend-controls` e `spend-limits`; `apps/frontend-service/src/pages/wise-payments/use-wise-card-spend-actions.ts` passou a focar em estado/handlers e delegar IO de mutações ao boundary dedicado, sem alteração de API/RBAC.
- **Decomposição incremental da composição de queries em WisePayments (10/03/2026):** novo módulo `apps/frontend-service/src/pages/wise-payments/use-wise-query-hooks.ts` passou a centralizar hooks reutilizáveis de consulta (`useWiseApiQuery` e `useWiseProfileScopedQuery`), e `apps/frontend-service/src/pages/wise-payments/use-wise-data-queries.ts` passou a consumir esses boundaries para reduzir duplicação de `useQuery/queryFn`, preservando contratos de filtros (`profileFilter`) e paginação (`cardOrdersPage`) sem alteração de API/RBAC.
- **Decomposição incremental do composition root de Trading (10/03/2026):** novo módulo `apps/frontend-service/src/pages/TradingContent.tsx` passou a centralizar toda a orquestração de `state/queries/handlers/render` da página; `apps/frontend-service/src/pages/Trading.tsx` passou a operar como wrapper fino de autenticação/autorização e monta `TradingContent` somente após validação de sessão/permissão, sem alteração de contratos de API ou RBAC.
- **Decomposição incremental do controller de layout em Chat (09/03/2026):** novo módulo `apps/frontend-service/src/pages/Chat/useChatPageLayoutController.ts` passou a centralizar a orquestração de hooks de `state`, `queries`, `routing`, `streaming`, `handlers` e composição final de `chatPageLayoutProps`; `apps/frontend-service/src/pages/Chat/index.tsx` passou a atuar como composition root fino, consumindo o controller dedicado e renderizando `ChatPageLayout`, sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da composição de section-props em Trading (09/03/2026):** novo módulo `apps/frontend-service/src/components/trading/TradingPageSectionProps.ts` passou a centralizar a composição agregada de `primaryTabsSectionProps`, `operationalTabsSectionProps`, `dialogsSectionProps` e `layout section-props`; `apps/frontend-service/src/pages/Trading.tsx` passou a consumir `buildTradingPageSectionProps(...)` como boundary único de assembly e `apps/frontend-service/src/components/trading/index.ts` passou a exportar o novo builder, sem alteração de contratos de API ou RBAC.
- **Decomposição incremental das mutações account/card/dispute em WisePayments (09/03/2026):** novo módulo `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-mutations.ts` passou a centralizar mutações de `account details`, `card orders`, `card transactions`, `dispute flow/upload/status` e `kyc upload/evidences`; `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-actions.ts` passou a atuar como composition root de estado/handlers e delegar a camada de mutation para o módulo dedicado, com contratos tipados compartilhados em `apps/frontend-service/src/pages/wise-payments/wise-account-card-dispute-types.ts`, sem alteração de contratos de API ou RBAC.
- **Decomposição incremental das mutações de controle em Trading (09/03/2026):** novos módulos `apps/frontend-service/src/components/trading/useTradingOrderExecutionMutations.ts` e `apps/frontend-service/src/components/trading/useTradingRiskControlActions.ts` passaram a centralizar blocos de execução de ordens e risco/handover; `apps/frontend-service/src/components/trading/useTradingControlOrderMutations.ts` passou a atuar como composition root fino dessas mutações, com tipos compartilhados em `apps/frontend-service/src/components/trading/trading-control-order-types.ts`, sem alteração de contratos de API ou RBAC.
- **Hardening incremental de tipagem em Trading (09/03/2026):** `apps/frontend-service/src/components/trading/TradingDomainTypes.ts` recebeu novos guards de domínio (`isFuturesPositionArray`, `isSpotAccountArray`, `isFuturesAccountOverview`, `isMarginCrossOverview`, `isMarginIsolatedOverview`); `apps/frontend-service/src/pages/Trading.tsx` e `apps/frontend-service/src/components/trading/useTradingAccountPositionState.ts` passaram a consumir esses guards para remover casts de payload de conta/posição sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da composição final de layout no Chat (09/03/2026):** novo módulo `apps/frontend-service/src/pages/Chat/chat-page-layout-props-builder.ts` passou a centralizar o assembly tipado de props de `ChatPageLayout` em blocos (`state`, `sections`, `viewport` e `handlers`); `apps/frontend-service/src/pages/Chat/index.tsx` passou a consumir `buildChatPageLayoutProps(...)`, removendo bloco inline equivalente e eliminando cast de workspace sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da geração LLM de sinais em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/trading-llm-signal-generation-service.ts` passou a centralizar a orquestração principal de `generateTradingSignalFromLlm` (governança de profile, análise/consenso, contexto operacional, prompt budget, execução LLM, persistência e validação final); `apps/integrations-service/src/index.ts` passou a delegar para `generateTradingSignalFromLlmCore` com wrapper fino sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da composição de handlers em Trading (09/03/2026):** novo hook `apps/frontend-service/src/components/trading/useTradingCompositeActionHandlers.ts` passou a centralizar orquestração de handlers de interação/mutação (`page interactions`, `postmortem training`, `dialog forms`, `scheduler`, `signal profile` e `workspace actions` com invalidação de conta); `apps/frontend-service/src/pages/Trading.tsx` passou a consumir esse boundary único e remover bloco inline equivalente sem alteração de contratos de API ou RBAC.
- **Decomposição incremental do contexto operacional de sinal em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/trading-signal-context-service.ts` passou a centralizar contexto RAG, snapshot de orderbook, notícias via web-search, validação de dataset aprovado de Trading e montagem de `tradePlan`; `apps/integrations-service/src/index.ts` passou a consumir `buildTradingSignalOperationalContext` e remover bloco inline equivalente sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da orquestração de análise de sinal em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/trading-signal-analysis-orchestration-service.ts` passou a centralizar `analysisMatrix`, consenso majoritário, agregação de técnicas, enriquecimento de arbitragem triangular e cálculo de ensemble; `apps/integrations-service/src/index.ts` passou a consumir `buildTradingSignalAnalysisContext` e remover bloco inline equivalente sem alteração de contratos de API ou RBAC.
- **Decomposição incremental do orçamento de prompt LLM em Integrations (09/03/2026):** `apps/integrations-service/src/trading-llm-prompt-service.ts` passou a centralizar `buildTradingSignalPromptBudget` para composição de prompt multi-timeframe, cálculo de budget e redução progressiva de notícias com preservação de limites de contexto; `apps/integrations-service/src/index.ts` passou a consumir esse boundary único e remover bloco inline equivalente sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da persistência de sinal LLM em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/trading-llm-signal-persistence-service.ts` passou a centralizar montagem/persistência do payload final de `createSignal` (metadata completa com técnicas, consenso, arbitragem e `analysisMatrix`); `apps/integrations-service/src/index.ts` passou a consumir `createTradingLlmSignalPersistenceService` e remover bloco inline equivalente sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da validação final de sinal LLM em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/trading-llm-validation-finalize-service.ts` passou a centralizar seleção de snapshot para validação, execução de `validateAndPersist` e atualização de metadata com `validationSummary`; `apps/integrations-service/src/index.ts` passou a consumir `createTradingLlmValidationFinalizeService` e remover bloco inline equivalente sem alteração de contratos de API ou RBAC.
- **Decomposição incremental do pós-processamento de sinal LLM em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/trading-llm-signal-post-processing-service.ts` passou a centralizar promoção direcional por consenso multi-timeframe, atualização de `operationType/suggestedSize` e geração de `deterministicOverride`; `apps/integrations-service/src/index.ts` passou a consumir `createTradingLlmSignalPostProcessingService` e remover bloco inline equivalente sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da execução GPU/LLM de sinais em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/trading-llm-execution-service.ts` passou a centralizar timeout/retries/backoff, fallback gateway/GPU Manager, validação de adapter LoRA ativo e extração de conteúdo do structured output para geração de sinais; `apps/integrations-service/src/index.ts` passou a consumir `createTradingLlmExecutionService` e remover bloco inline equivalente sem alteração de contratos de API ou RBAC.
- **Decomposição incremental do fluxo legacy institucional de sinais em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/trading-legacy-institutional-signal-service.ts` passou a centralizar o branch legado de `generateTradingSignalFromLlm` (`portfolio_auto` e fallback por candidatos do universo) com persistência de sinal e guardrails institucionais; `apps/integrations-service/src/index.ts` passou a consumir `createTradingLegacyInstitutionalSignalService` e remover bloco inline equivalente sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da análise técnica persistida em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/trading-technical-analysis-service.ts` passou a centralizar cálculo técnico, composição de `techniqueScores/ensembleResult` e persistência de indicadores em `tradingTechnicalIndicators`; `apps/integrations-service/src/index.ts` passou a consumir `createTradingTechnicalAnalysisService` e removeu a função inline `calculateAndPersistTechnicalAnalysis` sem alteração de contratos de API ou RBAC.
- **Decomposição incremental de prompt/token budget LLM em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/trading-llm-prompt-service.ts` passou a centralizar construção de prompt multi-timeframe e cálculo de orçamento de tokens (`buildMultiTimeframePrompt`, `resolveMaxTokensForPrompt`); `apps/integrations-service/src/index.ts` passou a consumir `createTradingLlmPromptService` e removeu constantes/funções inline equivalentes sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da orquestração de dataset em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/trading-dataset-orchestration-service.ts` passou a centralizar criação de datasets por `signal`/`order` com lineage e métricas; `apps/integrations-service/src/index.ts` passou a inicializar `createTradingDatasetOrchestrationService` e delegar os fluxos de criação sem alteração de contratos de API ou RBAC.
- **Decomposição incremental de namespace de dataset em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/trading-dataset-namespace-service.ts` passou a centralizar validação de candidatos e inferência de namespace para datasets de trading; `apps/integrations-service/src/index.ts` passou a consumir `createTradingDatasetNamespaceService` nos fluxos de signal/order sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da seed de dataset por sinal em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/trading-dataset-seed-service.ts` passou a centralizar `buildTradingDatasetSeedFromSignal`; `apps/integrations-service/src/index.ts` passou a consumir `createTradingDatasetSeedService` com tipagem compatível aos contratos de análise/consenso/prompt sem alteração de contratos de API ou RBAC.
- **Decomposição incremental de core de dataset de trading em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/trading-dataset-core-service.ts` passou a centralizar embedding, deduplicação semântica, score de qualidade e helpers de ação/prompt de execução de ordem; `apps/integrations-service/src/index.ts` passou a consumir `createTradingDatasetCoreService` e removeu funções inline equivalentes sem alteração de contratos de API ou RBAC.
- **Decomposição incremental de runtime de integridade imutável em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/integrations-immutable-audit-runtime-service.ts` passou a centralizar estado, execução on-demand e scheduler da verificação de cadeia imutável; `apps/integrations-service/src/index.ts` passou a consumir `createIntegrationsImmutableAuditRuntimeService` e delegar shutdown para `stopIntegrationsImmutableAuditIntegrityScheduler` sem alteração de contratos de API ou RBAC.
- **Decomposição incremental de runtime de métricas de trading em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/trading-metrics-runtime-service.ts` passou a centralizar refresh de métricas de PnL/ordens/indicadores e lifecycle do scheduler; `apps/integrations-service/src/index.ts` passou a consumir `createTradingMetricsRuntimeService` e delegar shutdown para `stopTradingMetricsScheduler` sem alteração de contratos de API ou RBAC.
- **Hardening incremental de estado de integridade imutável em Integrations (09/03/2026):** `apps/integrations-service/src/index.ts` passou a atualizar `integrationsImmutableAuditIntegrityState` in-place (`Object.assign`) em vez de reatribuir referência, eliminando risco de estado stale nos endpoints `/api/integrations/health` e `/api/integrations/trading/audit/integrity` sem alteração de contratos de API ou RBAC.
- **Decomposição incremental de observabilidade de chamadas em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/integration-call-observer-service.ts` passou a centralizar classificação de erro e observabilidade de chamadas (`updateIntegrationMetrics`, `observeIntegrationCall`); `apps/integrations-service/src/index.ts` passou a consumir `createIntegrationCallObserverService` e removeu funções inline equivalentes sem alteração de contratos de API ou RBAC.
- **Decomposição incremental de runtime de schedulers em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/trading-scheduler-runtime-service.ts` passou a centralizar execução de schedulers de sinais/análise (poll, lock otimista, persistência de status e tratamento de erro); `apps/integrations-service/src/index.ts` passou a consumir `createTradingSchedulerRuntimeService`, removendo bloco inline equivalente e adicionando parada explícita de scheduler de análise no graceful shutdown sem alteração de contratos de API ou RBAC.
- **Decomposição incremental de escopo/perfil de trading em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/trading-scope-profile-service.ts` passou a centralizar resolução de namespace Trading, resumo de datasets aprovados, validação de namespace por tenant e criação idempotente de perfil (`analysis`/`signal`); `apps/integrations-service/src/index.ts` passou a consumir `createTradingScopeProfileService` e removeu funções inline equivalentes sem alteração de contratos de API ou RBAC.
- **Decomposição incremental de normalização de sinal LLM em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/trading-llm-signal-normalizer-service.ts` passou a centralizar normalização numérica/cited values e montagem validada do payload de sinal LLM (`buildLlmSignalFromPartial`); `apps/integrations-service/src/index.ts` passou a consumir `createTradingLlmSignalNormalizerService` e removeu funções inline equivalentes sem alteração de contratos de API ou RBAC.
- **Decomposição incremental de trade-plan determinístico em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/trading-signal-plan-service.ts` passou a centralizar resolução de signal type, motivadores, razões de invalidação, cálculos de operação/duração, SL/TP e montagem do plano de trade; `apps/integrations-service/src/index.ts` passou a consumir funções dedicadas e removeu implementações inline equivalentes sem alteração de contratos de API ou RBAC.
- **Decomposição incremental de contexto de agente/scheduler em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/trading-agent-context-service.ts` passou a centralizar resolução de settings agentic por tenant, resolução de agente/namespace Trading, resolução de usuário do scheduler e montagem do system prompt de sinais; `apps/integrations-service/src/index.ts` passou a consumir `createTradingAgentContextService` e removeu funções inline equivalentes sem alteração de contratos de API ou RBAC.
- **Decomposição incremental de arbitragem triangular em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/trading-arbitrage-service.ts` passou a centralizar snapshot de order book, resolução de legs de conversão e cálculo de arbitragem triangular com suporte a fee por exchange (`feePctByExchange`) e network fees por ativo; `apps/integrations-service/src/index.ts` passou a consumir `createTradingArbitrageService` e removeu funções inline equivalentes sem alteração de contratos de API ou RBAC.
- **Decomposição incremental de config de perfil em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/trading-profile-config-service.ts` passou a centralizar parse/normalização de perfil de trading, validação de arbitragem e classe `TradingConfigError`; `apps/integrations-service/src/index.ts` passou a consumir `createTradingProfileConfigService` e removeu funções/classes inline equivalentes sem alteração de contratos de API ou RBAC.
- **Decomposição incremental de consenso/ensemble em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/trading-analysis-consensus-service.ts` passou a centralizar consenso majoritário, agregação de technique scores e cálculo de ensemble result; `apps/integrations-service/src/index.ts` passou a consumir o módulo dedicado e removeu funções inline equivalentes sem alteração de contratos de API ou RBAC.
- **Decomposição incremental de suporte de sinal em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/trading-signal-support-service.ts` passou a centralizar split de símbolo, derivação de ativos intermediários, mapeamento de erro amigável e símbolo padrão por mercado; `apps/integrations-service/src/index.ts` passou a consumir `createTradingSignalSupportService` e removeu funções inline equivalentes sem alteração de contratos de API ou RBAC.
- **Decomposição incremental do serviço de notícias de trading em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/trading-news-service.ts` passou a centralizar normalização de config, montagem de query e consulta de notícias via RAG web-search; `apps/integrations-service/src/index.ts` passou a consumir `createTradingNewsService` e removeu funções inline equivalentes sem alteração de contratos de API ou RBAC.
- **Decomposição incremental do serviço de market context em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/trading-market-context-service.ts` passou a centralizar fetch de candles, snapshot de indicadores e composição de contexto de mercado para datasets/sinais; `apps/integrations-service/src/index.ts` passou a consumir `createTradingMarketContextService` e removeu funções inline equivalentes sem alteração de contratos de API ou RBAC.
- **Decomposição incremental do serviço de fees KuCoin em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/kucoin-trading-fee-service.ts` passou a centralizar cálculo/cache de trade fees, resolução/persistência de network fees e fallback por tenant para arbitragem; `apps/integrations-service/src/index.ts` passou a consumir `createKucoinTradingFeeService` e removeu funções inline equivalentes sem alteração de contratos de API ou RBAC.
- **Decomposição incremental do catálogo de símbolos de trading em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/trading-symbol-catalog-service.ts` passou a centralizar normalização/listagem de símbolos, seleção por universo de candidatos, resolução de venues conectadas e carregamento de auto-assets por venue; `apps/integrations-service/src/index.ts` passou a consumir `createTradingSymbolCatalogService` e removeu funções inline equivalentes sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da resolução de tenant WS privado KuCoin em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/kucoin-private-ws-tenant-service.ts` passou a centralizar `createResolveKucoinTenantIdForPrivateWs`; `apps/integrations-service/src/index.ts` passou a consumir o módulo dedicado e removeu função inline equivalente de resolução de tenant WS privado sem alteração de contratos de API ou RBAC.
- **Decomposição incremental dos request resolvers de trading em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/trading-request-resolver-service.ts` passou a centralizar `respondKucoinNotConfigured`, `resolveTradingSymbolOrRespond`, `resolveMarketTypeParam`, `resolveSymbolFromQuery` e `resolveTradingIntervalGranularity`; `apps/integrations-service/src/index.ts` passou a consumir `createTradingRequestResolver` e removeu funções inline equivalentes sem alteração de contratos de API ou RBAC.
- **Decomposição incremental das métricas WS KuCoin em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/kucoin-ws-metrics-service.ts` passou a centralizar mapeamento de estado e wiring único de métricas WS public/private (`createKucoinWsMetricsWiring`); `apps/integrations-service/src/index.ts` passou a consumir o módulo dedicado e removeu bloco inline equivalente sem alteração de contratos de API ou RBAC.
- **Decomposição incremental dos handlers de market data em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/trading-market-data-handlers.ts` passou a centralizar `handleTradingKlinesRequest` e `handleTradingOrderBookRequest`; `apps/integrations-service/src/index.ts` passou a consumir `createTradingMarketDataHandlers` e removeu funções inline equivalentes sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da configuração WS KuCoin em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/kucoin-ws-config-service.ts` passou a centralizar depths REST/WS, parsing/validação de intervalos e registry de tópicos Spot/Margin; `apps/integrations-service/src/index.ts` passou a consumir o módulo dedicado e removeu funções inline equivalentes sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da startup orchestration em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/integration-startup-service.ts` passou a centralizar bootstrap de integrações por tenant e inicialização de caches (`createIntegrationStartupOrchestrator`); `apps/integrations-service/src/index.ts` passou a consumir o módulo dedicado e removeu bloco inline equivalente sem alteração de contratos de API ou RBAC.
- **Decomposição incremental do auth context Wise em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/wise-auth-context-service.ts` passou a centralizar `getWiseAuthContextFromRequest`; `apps/integrations-service/src/index.ts` passou a consumir o módulo dedicado (wrapper `getWiseAuthContext`) e removeu função inline equivalente de validação de tenant sem alteração de contratos de API ou RBAC.
- **Decomposição incremental do bootstrap de canais externos em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/integrations-bootstrap-service.ts` passou a centralizar `initializeGmailTransporter` e `initializeStripeClient`; `apps/integrations-service/src/index.ts` passou a consumir o módulo dedicado e removeu bloco inline equivalente de startup de Gmail/Stripe sem alteração de contratos de API ou RBAC.
- **Decomposição incremental das chamadas externas/timeout em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/integration-external-call-service.ts` passou a centralizar `createExecuteStripeCall` e `withTimeout`; `apps/integrations-service/src/index.ts` passou a consumir esse boundary dedicado para Stripe/Grafana/GitHub/Health checks e removeu funções inline equivalentes sem alteração de contratos de API ou RBAC.
- **Decomposição incremental do parser LLM de sinais em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/trading-llm-signal-parser.ts` passou a centralizar parsing, normalização e repair de resposta LLM para sinais de trading (incluindo fallback `jsonrepair`); `apps/integrations-service/src/index.ts` passou a consumir `createLlmSignalResponseParser` via injeção de dependências e removeu bloco inline equivalente sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da idempotência de webhook em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/webhook-idempotency-service.ts` passou a centralizar `checkWebhookIdempotency` e `markWebhookProcessed`; `apps/integrations-service/src/index.ts` passou a consumir o módulo dedicado com wrapper de logger e removeu implementação inline equivalente sem alteração de contratos de API ou RBAC.
- **Decomposição incremental de health checks em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/integration-health-service.ts` passou a centralizar checks de Stripe/Wise/Twilio/Email/OpenAI/Trading e refresh de métricas de saúde; `apps/integrations-service/src/index.ts` passou a consumir `createIntegrationHealthRefresher` e removeu funções inline equivalentes (`check*Health`, `collectIntegrationHealthStatuses`, `refreshIntegrationHealthMetrics`) sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da persistência Wise em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/wise-storage-service.ts` passou a centralizar os `upserts` de dados Wise e `insertWiseWebhookEvent`; `apps/integrations-service/src/index.ts` passou a consumir o módulo dedicado e removeu funções inline equivalentes de alto volume no composition root sem alteração de contratos de API ou RBAC.
- **Decomposição incremental do fluxo Twilio/WhatsApp em Integrations (09/03/2026):** novo módulo `apps/integrations-service/src/twilio-chat-media-service.ts` passou a centralizar `buildProcessMessageWithLLM` (mensagem WhatsApp -> Chat Service) e `buildProcessWhatsAppMediaForRAG` (mídia WhatsApp -> RAG); `apps/integrations-service/src/index.ts` passou a consumir os builders e removeu funções inline equivalentes de alto acoplamento no composition root sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da mutação de stream em Chat (09/03/2026):** novo hook `apps/frontend-service/src/pages/Chat/useChatSendMessageMutation.ts` passou a centralizar a mutação principal de streaming (`useMutation(createChatStreamMutationConfig(...))`); `apps/frontend-service/src/pages/Chat/index.tsx` passou a consumir esse boundary único e removeu wrappers inline de `sendMessage.mutate(...)` nos fluxos de composer, gravação, sync de mensagens e quick reply sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da composição de queries/filtros em WisePayments (09/03/2026):** novo módulo `apps/frontend-service/src/pages/wise-payments/wise-query-builders.ts` passou a centralizar montagem de URL `profile scoped` (`profileId` + parâmetros adicionais) e fetch JSON tipado; `apps/frontend-service/src/pages/wise-payments/use-wise-data-queries.ts` passou a consumir `fetchWiseProfileScopedJson` para `cards`, `spend-controls`, `disputes`, `kyc-reviews`, `card-orders`, `dispute-reasons`, `account-details` e `account-details/orders`, removendo duplicação de `queryFn` sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da invalidação de queries de conta em Trading (09/03/2026):** `apps/frontend-service/src/components/trading/useTradingAccountInvalidation.ts` passou a centralizar a invalidação de `['account']`; `apps/frontend-service/src/pages/Trading.tsx` passou a consumir esse boundary único dentro de `useTradingWorkspaceActionHandlers` e removeu callback inline equivalente sem alteração de contratos de API ou RBAC.
- **Decomposição incremental dos callbacks residuais de Trading (09/03/2026):** `apps/frontend-service/src/components/trading/useTradingKlineInvalidation.ts` passou a centralizar a invalidação de `klines` e `apps/frontend-service/src/components/trading/useTradingAuthRedirect.ts` passou a centralizar o redirect de autenticação no wrapper; `apps/frontend-service/src/pages/Trading.tsx` passou a consumir ambos os boundaries e removeu callbacks inline equivalentes sem alteração de contratos de API ou RBAC.
- **Decomposição incremental dos bindings residuais de Chat (09/03/2026):** `apps/frontend-service/src/pages/Chat/useChatContainerBindings.ts` passou a centralizar `workspaceOptions`, `fallbackMessageUser`, callbacks de `approval policy`/confirmação de exclusão e sync de foco por conversa; `apps/frontend-service/src/pages/Chat/index.tsx` passou a consumir esse boundary único e removeu `useMemo/useCallback/useEffect` inline equivalentes sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da composição de tabs em WisePayments (09/03/2026):** `apps/frontend-service/src/pages/wise-payments/use-wise-tab-props.ts` passou a operar como composition root fino e delegar o assembly para dois builders dedicados por domínio: `build-wise-profile-tabs-props.ts` (tabs com `profile scope`) e `build-wise-operational-tabs-props.ts` (tabs operacionais); contratos de API/RBAC mantidos sem alteração.
- **Decomposição incremental dos wrappers operacionais de apresentação em Trading (09/03/2026):** `apps/frontend-service/src/components/trading/useTradingOperationalPresentationWrappers.tsx` passou a centralizar `criticalApiError`, `renderOrderStatusBadge`, `renderSignalTypeBadge` e `wsHealthy`; `apps/frontend-service/src/pages/Trading.tsx` passou a consumir esse boundary único e removeu composição inline equivalente sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da sincronização de scheduler em Trading (09/03/2026):** `apps/frontend-service/src/components/trading/useTradingSchedulerFormSync.ts` passou a centralizar a hidratação de `schedulerForm` a partir de `schedulerConfig`; `apps/frontend-service/src/pages/Trading.tsx` passou a consumir esse boundary único e removeu `useEffect` inline equivalente sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da subscription futures de quotes em Trading (09/03/2026):** `apps/frontend-service/src/components/trading/useTradingFuturesQuoteSubscription.ts` passou a centralizar o side-effect de subscribe/unsubscribe de tickers para posições futures abertas; `apps/frontend-service/src/pages/Trading.tsx` passou a consumir esse boundary único e removeu `useEffect` inline equivalente sem alteração de contratos de API ou RBAC.
- **Decomposição incremental dos handlers realtime de Trading (09/03/2026):** `apps/frontend-service/src/components/trading/useTradingRealtimeEventHandlers.ts` passou a centralizar handlers de eventos (`onError`, `onTicker`, `onOrderUpdate`, `onPositionUpdate`, `onBalance`) com invalidação de queries e atualização de quotes em tempo real; `apps/frontend-service/src/pages/Trading.tsx` passou a consumir esse boundary único e removeu handlers inline equivalentes sem alteração de contratos de API ou RBAC.
- **Decomposição incremental dos derivados de payload/candidatos de Trading (09/03/2026):** `apps/frontend-service/src/components/trading/useTradingDerivedPayloadState.ts` passou a centralizar `topTradingCandidates`, `signalProfilePayload` e `isSignalProfilePayloadComplete`; `apps/frontend-service/src/pages/Trading.tsx` passou a consumir esse boundary único e removeu memoizações inline equivalentes sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da conexão realtime de Trading (09/03/2026):** `apps/frontend-service/src/components/trading/useTradingRealtimeConnectionState.ts` passou a centralizar estado derivado de `symbol` sanitizado, validação de símbolo por mercado, `requestSymbol`, `wsEnabled` e `wsChannels`; `apps/frontend-service/src/pages/Trading.tsx` passou a consumir esse boundary único e removeu composição inline equivalente sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da navegação/opções de Trading (09/03/2026):** `apps/frontend-service/src/components/trading/useTradingNavigationPresentation.ts` passou a centralizar memoizações/callbacks de navegação e opções (`workspaces`, `tabs`, `modes`, `indicators`, `techniques`); `apps/frontend-service/src/pages/Trading.tsx` passou a consumir esse boundary único e removeu composição inline equivalente sem alteração de contratos de API ou RBAC.
- **Decomposição incremental do estado local de Trading (09/03/2026):** `apps/frontend-service/src/components/trading/useTradingLocalState.ts` passou a centralizar estado local de UI/forms/dialogs/execução e refs de autosave (`useState/useRef`); `apps/frontend-service/src/pages/Trading.tsx` passou a consumir esse boundary único e removeu declarações inline equivalentes sem alteração de contratos de API ou RBAC.
- **Decomposição incremental do estado local de Chat (09/03/2026):** `apps/frontend-service/src/pages/Chat/useChatLocalState.ts` passou a centralizar estado local de UI/stream/diálogos/áudio e refs de orquestração (`useState/useRef`); `apps/frontend-service/src/pages/Chat/index.tsx` passou a consumir esse boundary único e removeu declarações inline equivalentes sem alteração de contratos de API ou RBAC.
- **Decomposição incremental do shell de layout em Chat (09/03/2026):** `apps/frontend-service/src/pages/Chat/components/ChatPageLayout.tsx` passou a centralizar sidebar, header, workspace, viewport, composer e dialogs; `apps/frontend-service/src/pages/Chat/index.tsx` passou a consumir esse boundary único e remover composição inline equivalente sem alteração de contratos de API ou RBAC.
- **Decomposição incremental de workspace e composer em Chat (09/03/2026):** `apps/frontend-service/src/pages/Chat/components/ChatWorkspaceSection.tsx` e `apps/frontend-service/src/pages/Chat/components/ChatComposerSection.tsx` passaram a centralizar o filtro de workspace e o bloco de envio (form + `ChatInput`); `apps/frontend-service/src/pages/Chat/index.tsx` passou a consumir esses boundaries e removeu blocos inline equivalentes sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da sidebar de conversas em Chat (09/03/2026):** `apps/frontend-service/src/pages/Chat/components/ChatConversationsSidebar.tsx` passou a centralizar drawer mobile e sidebar desktop animada da lista de conversas; `apps/frontend-service/src/pages/Chat/index.tsx` passou a consumir esse boundary único e removeu bloco inline equivalente sem alteração de contratos de API ou RBAC.
- **Decomposição incremental do header responsivo de Chat (09/03/2026):** `apps/frontend-service/src/pages/Chat/components/ChatHeaderSection.tsx` passou a centralizar o header desktop/mobile com governança e ações; `apps/frontend-service/src/pages/Chat/index.tsx` passou a consumir esse boundary único e removeu bloco inline equivalente sem alteração de contratos de API ou RBAC.
- **Decomposição incremental das seções principais de Trading (09/03/2026):** `apps/frontend-service/src/components/trading/TradingPageSections.tsx` passou a centralizar alertas, header, métricas, tabs e dialogs; `apps/frontend-service/src/pages/Trading.tsx` passou a consumir esse boundary único e removeu bloco inline equivalente sem alteração de contratos de API ou RBAC.
- **Decomposição incremental do viewport de mensagens do Chat (09/03/2026):** `apps/frontend-service/src/pages/Chat/components/ChatMessagesViewport.tsx` passou a centralizar renderização de mensagens com `ScrollArea`, seleção, hints/banners e diagnóstico de stream; `apps/frontend-service/src/pages/Chat/index.tsx` passou a consumir esse boundary único e removeu bloco inline equivalente sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da query de mensagens do Chat (09/03/2026):** `apps/frontend-service/src/pages/Chat/useChatQueryState.ts` passou a centralizar também o `queryFn` de mensagens (`/api/chat/conversations/:id/messages`); `apps/frontend-service/src/pages/Chat/index.tsx` passou a consumir o hook apenas com `conversationId` e removeu callback inline equivalente sem alteração de contratos de API ou RBAC.
- **Decomposição incremental das queries de conversas do Chat (09/03/2026):** novo hook `apps/frontend-service/src/pages/Chat/useChatConversationsQueryState.ts` centralizou `fetchConversations` paginado com cursor, `useInfiniteQuery` e derivação de `conversations/activeConversation`; `apps/frontend-service/src/pages/Chat/index.tsx` passou a consumir o hook dedicado e removeu bloco inline equivalente sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da composição de WisePayments (09/03/2026):** novo hook `apps/frontend-service/src/pages/wise-payments/use-wise-page-composition.ts` centralizou a orquestração de navegação, queries, actions, `derivedData`, `refreshActions` e `tabsContentProps`; `apps/frontend-service/src/pages/WisePayments.tsx` passou a consumir o hook dedicado e removeu composição inline equivalente sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da composição de layout em Trading (09/03/2026):** `buildTradingLayoutSectionProps` foi adicionado em `apps/frontend-service/src/components/trading/TradingSectionPropsBuilders.ts` para centralizar o assembly tipado de `operationalAlertsSectionProps`, `headerSectionProps`, `statsPrimarySectionProps`, `statsSecondarySectionProps` e `tabsShellSectionProps`; `apps/frontend-service/src/pages/Trading.tsx` passou a consumir o novo builder e removeu blocos inline equivalentes sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da composição de abas primárias em Trading (09/03/2026):** `buildTradingPrimaryTabsSectionProps` foi adicionado em `apps/frontend-service/src/components/trading/TradingSectionPropsBuilders.ts` para centralizar o assembly tipado das props de `analysis/lab/orders/overview/portfolio-auto/positions/signals-auto/signals`; `apps/frontend-service/src/pages/Trading.tsx` passou a consumir o novo builder e removeu blocos inline equivalentes sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da composição de seções do Chat (09/03/2026):** novo hook `apps/frontend-service/src/pages/Chat/useChatSectionProps.ts` centralizou o assembly tipado de `conversationsListProps`, `chatActionsMenuProps`, `chatGovernanceControlsProps` e `chatDialogsSectionProps`; `apps/frontend-service/src/pages/Chat/index.tsx` passou a consumir o hook dedicado e removeu blocos inline equivalentes sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da composição de abas operacionais/dialogs em Trading (09/03/2026):** novo módulo `apps/frontend-service/src/components/trading/TradingSectionPropsBuilders.ts` centralizou os builders `buildTradingOperationalTabsSectionProps` e `buildTradingDialogsSectionProps` com tipagem por `ComponentProps`; `apps/frontend-service/src/pages/Trading.tsx` passou a consumir os builders e removeu blocos inline equivalentes de composição de `props` sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da derivação de conta/posições em Trading (09/03/2026):** novo hook `apps/frontend-service/src/components/trading/useTradingAccountPositionState.ts` centralizou estado derivado de conta/posições e resumos operacionais (`accountMode`, `spot/margin positions`, `openPositionsCount`, `futures/spot/margin summaries` e `quoteCurrency`); `apps/frontend-service/src/pages/Trading.tsx` passou a consumir o hook dedicado e removeu bloco inline equivalente sem alteração de contratos de API ou RBAC.
- **Decomposição incremental das queries de Chat (09/03/2026):** novo hook `apps/frontend-service/src/pages/Chat/useChatQueryState.ts` centralizou consultas e estado derivado de dados (`conversationMessages`, `approvalPolicy`, `version`, `assistant settings`, `namespaces` e `agents`); `apps/frontend-service/src/pages/Chat/index.tsx` passou a consumir o hook dedicado e removeu blocos inline equivalentes de `useQuery` sem alteração de contratos de API ou RBAC.
- **Decomposição incremental das coleções de símbolos/candidatos em Trading (09/03/2026):** novo hook `apps/frontend-service/src/components/trading/useTradingSymbolCandidateViewState.ts` centralizou derivação de `symbolOptions` (destaques/favoritos/restante) e `symbolSelectItems` agrupados; `apps/frontend-service/src/pages/Trading.tsx` passou a consumir o hook dedicado e removeu blocos inline equivalentes sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da apresentação de sinais em Trading (09/03/2026):** novo hook `apps/frontend-service/src/components/trading/useTradingSignalPresentationState.ts` centralizou estado derivado de apresentação (`intervalOptions`, `signalIntervalOptions`, `signalSourceOptions`, `selectedSignalSources`, validação de arbitragem e derivação de `wsInterval`/`granularity`/depths de orderbook); `apps/frontend-service/src/pages/Trading.tsx` passou a consumir o hook dedicado e removeu blocos inline equivalentes sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da apresentação de workspaces em Chat (09/03/2026):** novo hook `apps/frontend-service/src/pages/Chat/useChatWorkspacePresentation.ts` centralizou estado derivado de apresentação (`workspaceHint`, `agentOptions`, `modelBadgeLabel`, `approvalPolicyOptions` e flags de visibilidade de controles); `apps/frontend-service/src/pages/Chat/index.tsx` passou a consumir o hook dedicado e removeu blocos inline equivalentes sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da sincronização de mensagens em Chat (09/03/2026):** novo hook `apps/frontend-service/src/pages/Chat/useChatMessageSyncEffects.ts` centralizou o sync de mensagens carregadas da conversa e o flush de envio pendente quando o streaming encerra; `apps/frontend-service/src/pages/Chat/index.tsx` passou a consumir o hook dedicado e removeu dois `useEffect`s inline equivalentes sem alteração de contratos de API ou RBAC.
- **Decomposição incremental do bootstrap de estado em Trading (09/03/2026):** novo hook `apps/frontend-service/src/components/trading/useTradingBootstrapStateSync.ts` centralizou sincronizações de bootstrap (`default portfolio`, normalização de `autoMix/all modes`, defaults de `symbol/interval` e fee efetivo de arbitragem via catálogo); `apps/frontend-service/src/pages/Trading.tsx` passou a consumir o hook dedicado e removeu seis `useEffect`s inline equivalentes sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da série de klines em Trading (09/03/2026):** novo hook `apps/frontend-service/src/components/trading/useTradingKlineSeriesState.ts` centralizou a composição da série de candles (preferência WS com fallback REST, deduplicação por assinatura e continuidade visual por `lastKlines`); `apps/frontend-service/src/pages/Trading.tsx` passou a consumir o hook dedicado e removeu estado/efeitos inline equivalentes sem alteração de contratos de API ou RBAC.
- **Decomposição incremental dos handlers de interação de UI em Chat (09/03/2026):** novo hook `apps/frontend-service/src/pages/Chat/useChatUiInteractionHandlers.ts` centralizou callbacks de drawer/sidebar, seleção, diagnóstico de stream, diálogos de treino/exclusão e quick-reply; `apps/frontend-service/src/pages/Chat/index.tsx` passou a consumir o hook dedicado e removeu callbacks inline equivalentes sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da derivação de market/orderbook em Trading (09/03/2026):** novo hook `apps/frontend-service/src/components/trading/useTradingMarketOrderBookState.ts` centralizou derivação de `market`, `orderBookData`, `orderBookPrecision` e a invalidação de klines por mudança de contexto; `apps/frontend-service/src/pages/Trading.tsx` passou a consumir o hook dedicado e removeu bloco inline equivalente sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da sincronização de risco/review em Trading (09/03/2026):** novo hook `apps/frontend-service/src/components/trading/useTradingRiskReviewState.ts` centralizou a hidratação de `riskConfig` (form de risco + defaults de `marketType/marginMode`) e o callback de abertura do diálogo de review; `apps/frontend-service/src/pages/Trading.tsx` passou a consumir o hook dedicado e removeu `useEffect`/handler inline equivalentes sem alteração de contratos de API ou RBAC.
- **Decomposição incremental do auto-save de signal profile em Trading (09/03/2026):** novo hook `apps/frontend-service/src/components/trading/useTradingSignalProfileAutoSave.ts` centralizou hidratação de `signalProfileResponse` (normalização + defaults) e persistência debounced de payload completo; `apps/frontend-service/src/pages/Trading.tsx` passou a consumir o hook dedicado e removeu efeitos inline equivalentes sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da composição tipada de tabs em WisePayments (09/03/2026):** novo hook `apps/frontend-service/src/pages/wise-payments/use-wise-tab-props.ts` centralizou o assembly de contratos para `WisePaymentsTabsContent`, com `WisePaymentsTabsContentProps` exportado em `apps/frontend-service/src/pages/wise-payments/components/wise-payments-tabs-content.tsx`; `apps/frontend-service/src/pages/WisePayments.tsx` passou a delegar a composição final ao hook, reduzindo densidade do container sem alteração de contratos de API ou RBAC.
- **Decomposição incremental das queries realtime/permissões em Trading (09/03/2026):** as queries de `klines` e `orderbook` foram extraídas para `apps/frontend-service/src/components/trading/useTradingMarketRealtimeQueries.ts` e a query RBAC de permissões do wrapper foi extraída para `apps/frontend-service/src/components/trading/useTradingPermissionsQuery.ts`; `apps/frontend-service/src/pages/Trading.tsx` passou a operar sem `useQuery` inline, sem alteração de contratos de API ou RBAC.
- **Decomposição incremental das queries de símbolos/assets em Trading (09/03/2026):** as queries de `symbols` e `auto assets catalog`, com derivação de `availableSymbols/favoriteSymbols/featuredSymbols` e `autoSignalAssetMap/autoSignalAssetOptions`, foram extraídas para `apps/frontend-service/src/components/trading/useTradingSymbolAssetQueries.ts`; `apps/frontend-service/src/pages/Trading.tsx` passou a consumir o novo hook dedicado sem alteração de contratos de API ou RBAC.
- **Decomposição incremental das queries de setup em Trading (09/03/2026):** as queries de bootstrap/automação (`status`, `portfolios`, `candidates`, `rebalances`, `auto runs`, `intervals`, `analysis-profile` e `arbitrage catalog`) foram extraídas para `apps/frontend-service/src/components/trading/useTradingSetupQueries.ts`; `apps/frontend-service/src/pages/Trading.tsx` passou a consumir o novo hook dedicado e a reaproveitar `statusIsConfigured/statusRequiresTenant` no encadeamento de hooks sem alteração de contratos de API ou RBAC.
- **Decomposição incremental das queries operacionais em Trading (09/03/2026):** as queries de `ws status`, `risk-config` e `control-history` foram extraídas para `apps/frontend-service/src/components/trading/useTradingOperationalQueries.ts`; `apps/frontend-service/src/pages/Trading.tsx` passou a consumir o novo hook dedicado sem alteração de contratos de API ou RBAC.
- **Decomposição incremental das queries de post-mortem/training em Trading (09/03/2026):** as queries de post-mortem real, namespaces ativos e rastreio de post-mortems já enviados para treinamento foram extraídas para `apps/frontend-service/src/components/trading/useTradingPostmortemTrainingQueries.ts`; `apps/frontend-service/src/pages/Trading.tsx` passou a consumir o novo hook dedicado sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da renderização de tabs em WisePayments (09/03/2026):** o bloco de render de tabs foi extraído para `apps/frontend-service/src/pages/wise-payments/components/wise-payments-tabs-content.tsx` com tipagem de contratos via `ComponentProps`; `apps/frontend-service/src/pages/WisePayments.tsx` passou a consumir o novo boundary e reduziu acoplamento de apresentação sem alteração de contratos de API ou RBAC.
- **Decomposição incremental das queries de sinais/scheduler em Trading (09/03/2026):** as queries de sinais e scheduler, incluindo reconciliação de `selectedSignalId` e composição de `schedulerConfig`, foram extraídas para `apps/frontend-service/src/components/trading/useTradingSignalSchedulerQueries.ts`; `apps/frontend-service/src/pages/Trading.tsx` passou a consumir o hook dedicado sem alteração de contratos de API ou RBAC.
- **Decomposição incremental das queries centrais em Trading (09/03/2026):** as queries de mercado/conta/posições/ordens foram extraídas para `apps/frontend-service/src/components/trading/useTradingMarketAccountQueries.ts`; `apps/frontend-service/src/pages/Trading.tsx` passou a consumir o hook dedicado e reaproveitar `marketQueryString` para klines/orderbook, reduzindo densidade do container sem alteração de contratos de API ou RBAC.
- **Decomposição incremental dos diálogos operacionais em Chat (09/03/2026):** os blocos inline de `Dialog`/`AlertDialog` (treinamento por conversa/mensagens, exclusão de conversa atual, exclusão em lote e exclusão total) foram extraídos para `apps/frontend-service/src/pages/Chat/components/ChatDialogsSection.tsx`; `apps/frontend-service/src/pages/Chat/index.tsx` passou a compor `chatDialogsSectionProps` com handlers nomeados (`handleTrainingDialogOpenChange`, `handleSubmitTraining`, `handleDeleteTargetOpenChange`) e a consumir uma única seção de diálogos, reduzindo densidade do container sem alteração de contratos de API ou RBAC.
- **Decomposição incremental de signal profile action handlers em Trading (08/03/2026):** `Trading.tsx` passou a consumir `useTradingSignalProfileActionHandlers.ts` para isolar handlers de configuração de sinais/presets (`apply/change/create/delete/update preset`, `generate`, `save profile`, `save scheduler`, `ensemble topN`), removendo callbacks inline de maior densidade em `signalsTabProps` sem alteração de contratos de API ou RBAC.
- **Decomposição incremental de access states no wrapper de Trading (08/03/2026):** estados de acesso (`loading`, `auth required`, `forbidden`) do wrapper foram extraídos para `apps/frontend-service/src/components/trading/TradingAccessStates.tsx`; `apps/frontend-service/src/pages/Trading.tsx` passou a consumir os componentes extraídos e helper `resolveTradingLoadingMessage`, removendo markup duplicado sem alteração de contratos de API ou RBAC.
- **Decomposição incremental do shell/status de WisePayments (08/03/2026):** shell de navegação (`Tabs + WorkspaceFilterBar`) foi extraído para `apps/frontend-service/src/pages/wise-payments/components/wise-payments-tabs-shell.tsx` e estados de serviço (`loading/not configured`) foram extraídos para `apps/frontend-service/src/pages/wise-payments/components/wise-payments-status-states.tsx`; `apps/frontend-service/src/pages/WisePayments.tsx` passou a consumir os componentes extraídos, removendo composição duplicada sem alteração de contratos de API ou RBAC.
- **Decomposição incremental dos estados de serviço de Trading (08/03/2026):** estados de `loading/error/unavailable/not configured/tenant required` do `TradingContent` foram extraídos para `apps/frontend-service/src/components/trading/TradingServiceStates.tsx`; `apps/frontend-service/src/pages/Trading.tsx` passou a consumir os estados extraídos, removendo markup inline e reduzindo densidade da composition root sem alteração de contratos de API ou RBAC.
- **Decomposição incremental de métricas derivadas de Trading (08/03/2026):** cálculos de contagem de posições abertas, resumos de conta (`futures/spot/margin`) e variação de preço foram extraídos para `apps/frontend-service/src/components/trading/TradingDerivedMetrics.ts`; `apps/frontend-service/src/pages/Trading.tsx` passou a consumir os utilitários extraídos, reduzindo lógica inline sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da composição de props em Trading (09/03/2026):** `apps/frontend-service/src/pages/Trading.tsx` passou a centralizar a composição de `props` em objetos nomeados (`primaryTabsSectionProps`, `operationalTabsSectionProps`, `dialogsSectionProps`) e consumir `TradingPrimaryTabsSection`, `TradingOperationalTabsSection` e `TradingDialogsSection` via spread tipado, reduzindo densidade do bloco de render sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da orquestração de mutações controle/ordens em Trading (09/03/2026):** `apps/frontend-service/src/components/trading/useTradingControlOrderActionSuite.ts` foi adicionado para consolidar mutações e handlers de review/order-control; `apps/frontend-service/src/pages/Trading.tsx` passou a consumir esse hook de composição e o barrel `apps/frontend-service/src/components/trading/index.ts` recebeu reexport dedicado, reduzindo acoplamento sem alteração de contratos de API ou RBAC.
- **Decomposição incremental de navegação e filtros compartilhados em WisePayments (09/03/2026):** `apps/frontend-service/src/pages/wise-payments/use-wise-navigation-presentation.ts` foi adicionado para centralizar mapeamento de tabs/workspaces e `apps/frontend-service/src/pages/WisePayments.tsx` passou a compartilhar `profileFilter/profiles/setProfileFilter` via `profileScopedTabProps` nas tabs de escopo de perfil, reduzindo repetição no container sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da composição de props operacionais em WisePayments (09/03/2026):** `apps/frontend-service/src/pages/WisePayments.tsx` passou a centralizar em objetos nomeados a composição de props das tabs de escopo de perfil (`account-details/cards/card-orders/card-transactions/spend-controls/disputes/kyc/webhooks/simulations/sca`), consumidas via spread tipado, reduzindo densidade de render sem alteração de contratos de API ou RBAC.
- **Decomposição incremental de menu de ações e handlers compartilhados em Chat (09/03/2026):** `apps/frontend-service/src/pages/Chat/components/ChatActionsMenu.tsx` foi adicionado para unificar as ações de treino/seleção/diagnóstico/exclusão entre desktop e mobile; `apps/frontend-service/src/pages/Chat/index.tsx` passou a compartilhar `conversationsListProps` entre sidebar/drawer e a usar callbacks nomeados (`handleQuickReply`, toggles de sidebar/seleção/diagnóstico), reduzindo duplicação sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da composição de props residuais em WisePayments (09/03/2026):** `apps/frontend-service/src/pages/WisePayments.tsx` passou a centralizar em objetos nomeados a composição residual das tabs operacionais não-perfil (`balances`, `exchange`, `transfers`, `recipients`, `quotes`, `batch`, `statements`, `profiles`, `users`, `activities`, `spend-limits`, `catalog`), consumidas via spread tipado, reduzindo densidade final de render sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da composição de seções residuais em Trading (09/03/2026):** `apps/frontend-service/src/pages/Trading.tsx` passou a centralizar em objetos nomeados as props de `TradingOperationalAlerts`, `TradingHeaderSection`, `TradingStatsPrimaryRow`, `TradingStatsSecondaryRow` e `TradingTabsShell`, além de reutilizar `renderOrderStatusBadge` e `renderSignalTypeBadge` como callbacks compartilhados entre tabs, reduzindo densidade de render sem alteração de contratos de API ou RBAC.
- **Decomposição incremental dos controles de governança em Chat (09/03/2026):** `apps/frontend-service/src/pages/Chat/components/ChatGovernanceControls.tsx` foi adicionado para centralizar approval policy + routing controls nos layouts desktop e mobile; `apps/frontend-service/src/pages/Chat/index.tsx` passou a compartilhar `chatGovernanceControlsProps`, removendo duplicação de markup/handlers no header sem alteração de contratos de API ou RBAC.
- **Decomposição incremental de memoizações de opções em Trading (09/03/2026):** `apps/frontend-service/src/pages/Trading.tsx` passou a centralizar os mapeamentos de opções em memoizações dedicadas (`autoModeOptions`, `signalIndicatorOptions`, `signalIntervalOptions`, `signalTechniqueOptions`), removendo mapeamentos inline residuais de `signalsAutoTabProps` e `signalsTabProps` sem alteração de contratos de API ou RBAC.
- **Decomposição incremental da composição por aba/seção em Trading (09/03/2026):** `apps/frontend-service/src/pages/Trading.tsx` passou a separar props nomeados por aba/seção (`analysis/lab/orders/overview/portfolio-auto/positions/signals-auto/signals`, `account/chart/control/history/orderbook/postmortems` e dialogs) antes da montagem de `primaryTabsSectionProps`, `operationalTabsSectionProps` e `dialogsSectionProps`, reduzindo densidade de composição sem alteração de contratos de API ou RBAC.
- **Decomposição incremental de workspace actions em Trading + refresh handlers em WisePayments (08/03/2026):** `Trading.tsx` passou a consumir `useTradingWorkspaceActionHandlers.ts` para isolar ações residuais de refresh/execução/abertura e mutações de histórico (`OCO`, `positions`, `signals-auto`, `history`, `postmortems`, `risk/review dialogs`); `WisePayments.tsx` passou a consumir handlers dedicados de refetch expostos por `use-wise-refresh-actions.ts`, removendo wrappers inline de refresh (`account-details`, `profiles`, `users`, `cards`, `card-orders`, `spend-controls`, `disputes`, `kyc`) sem alteração de contratos de API ou RBAC.
- **Decomposição incremental de mutation action handlers em Trading (08/03/2026):** `Trading.tsx` passou a consumir `useTradingMutationActionHandlers.ts` para isolar wrappers de ações recorrentes (`approve`, `cancel`, `reject`, `sync`, `deactivate`, `open generated signal`) e navegação auxiliar (`open analysis/lab/signals`), removendo callbacks inline repetidos entre `orders`, `overview`, `portfolio-auto`, `signals-auto` e `signals`. Sem alterações de contratos de API ou RBAC.
- **Decomposição incremental de scheduler handlers em Trading + default currency hook em WisePayments (08/03/2026):** `Trading.tsx` passou a consumir `useTradingSchedulerFormHandlers.ts` para isolar handlers de atualização do scheduler de sinais (`enabled`, `intervalMinutes`, `maxSignalsPerRun`, `symbols`), removendo callbacks inline residuais em `signalsTabProps`; `WisePayments.tsx` passou a consumir `use-wise-spend-control-default-currency.ts` para isolar a sincronização de moeda padrão de spend-control, removendo `useEffect` inline residual no container principal. Sem alterações de contratos de API ou RBAC.
- **Decomposição incremental de dialogs/forms em Trading + filtro de activities em WisePayments (08/03/2026):** `Trading.tsx` passou a consumir `useTradingDialogFormHandlers.ts` para isolar handlers de abertura/fechamento, patch e submit de nova ordem, risco e novo sinal, além de `quick-order`; `WisePayments.tsx` passou a consumir `handleActivityFilterChange` de `use-wise-user-activity-actions.ts`, removendo callback inline residual de activities. Sem alterações de contratos de API ou RBAC.
- **Decomposição incremental de handlers de post-mortem training em Trading (08/03/2026):** `Trading.tsx` passou a consumir `useTradingPostmortemTrainingHandlers.ts` para isolar o fluxo de abertura, cancelamento, controle de `open` e submissão do diálogo de envio de post-mortem para treinamento, removendo orquestração inline duplicada entre `postMortemsTabProps` e `postmortemTrainingDialogProps` sem alterar contratos de API ou RBAC.
- **Decomposição incremental de payload/review em Trading + refresh/dados derivados em WisePayments (08/03/2026):** `Trading.tsx` passou a consumir `TradingSignalProfilePayload.ts` (builder + validação de completude) e `useTradingReviewOrderHandlers.ts` (approve/save/update de revisão de ordem), removendo payload/handlers inline residuais de maior impacto; `WisePayments.tsx` passou a consumir `use-wise-refresh-actions.ts` e `use-wise-derived-data.ts`, consolidando refresh condicional por `profileFilter` e mapeamento tipado de coleções sem alterar contratos de API ou RBAC.
- **Configurações do Sistema editáveis via UI:** Página Configurações do Sistema (menu lateral) permite alterar limites de treinamento em tempo real. Valores gravados no PostgreSQL (tabela `system_config`) têm precedência sobre variáveis de ambiente. Chaves: DOCUMENT_MAX_CHUNKS, TRAINING_DOC_MAX_SAMPLES, TRAINING_CONVERSATION_MAX_MESSAGES, CONVERSATION_SLICE_SIZE, MIN_ONDEMAND_DATASET_SIZE, maxSeqLen. Cache 60s invalidado no save; alterações aplicadas imediatamente nos serviços (RAG, Chat, Training). API GET/PATCH `/api/training/system-config` com RBAC (`config:system:read` / `config:system:write`). (11/02/2026)
- **Hardening DR offsite no Observability Service (07/03/2026):** `apps/observability-service/src/backup-orchestrator.ts` passou a gerar artefatos versionados por `backupId` em `artifacts/<backupId>` (Redis/Qdrant + metadata PostgreSQL), sincronizar cópia offsite criptografada via OpenSSL (`BACKUP_OFFSITE_DIR`, `BACKUP_OFFSITE_REQUIRED`, `BACKUP_OFFSITE_ENCRYPTION_REQUIRED`) e validar integridade de restore em `POST /api/backup/verify/:id` com checagem local/offsite + `pgbackrest verify`.
- **Gates de promoção ponta a ponta no Training Service (07/03/2026):** nova chave SSOT `TRAINING_PROMOTION_REQUIRE_APPROVAL_GATES` incluída em `packages/database/src/system-config.ts` e consumida por `apps/training-service/src/training-governance.ts`, `training-runner.ts` e rotas de promoção/runtime. Promoção manual agora exige quórum quando gates estão ativos e auto-promoção agendada passa a registrar `waiting_approvals` em vez de ativar modelo sem aprovação explícita.
- **Guardrails de testes de Training alinhados com modularização (07/03/2026):** testes de contrato e segurança passaram a ler composição real de `index.ts` + `routes/*` + módulos de governança via helper `tests/unit/services/helpers/training-source.ts`, eliminando falso-negativo por leitura de entrypoint monolítico.
- **Tracing distribuído no Observability Service (07/03/2026):** `apps/observability-service/src/index.ts` passou a usar `createCorrelationMiddleware({ serviceName: 'observability-service' })`, propagando `traceparent`, `x-correlation-id` e `x-request-id` de forma consistente com os demais microsserviços.
- **Hardening de autenticação interna no Observability Service (07/03/2026):** `apps/observability-service/src/index.ts` passou a marcar `res.locals.internalAuthValidated` quando a autenticação interna é validada (HMAC ou `X-Internal-Api-Secret`) e usar essa marca nos guards `requireObservabilityRead/Admin/LogsWrite`, unificando autorização de chamadas internas sem depender de verificação fragmentada por header.
- **Client compartilhado do LLM Gateway com HMAC + trace context (07/03/2026):** `packages/shared-utils/src/llm/llm-gateway-client.ts` passou a gerar headers assinados (`x-internal-signature`, `x-internal-timestamp`, `x-internal-user-id`, etc.) quando há contexto de actor (`userId`/`tenantId`), propagar `traceparent`, `x-correlation-id` e `x-request-id` via `getContextHeaders()`, e usar fallback legado por `X-Internal-Api-Secret` somente quando não há identidade para assinatura. Cobertura unitária ampliada em `tests/unit/llm-gateway-client-auth.test.ts`.
- **Hardening de trust interno no LLM Gateway (07/03/2026):** mutações em `/api/llm/governance/*` passaram a exigir ator autenticado por HMAC com role `admin/super_admin`, além de bind de identidade (se `createdBy`/`evaluatedBy`/`approverUserId`/`approvedBy` vier no payload, precisa coincidir com o usuário autenticado). Fluxos de criação, avaliação, aprovação e ativação de prompts/tool policies agora executam com actor canônico do contexto autenticado.
- **Workspace de Chat por contexto (07/03/2026):** a página `apps/frontend-service/src/pages/Chat/index.tsx` passou a expor workspaces explícitos (`Todos`, `Conversa`, `Operações`, `Governança`, `Diagnóstico`), com segmentação de controles para reduzir carga cognitiva: políticas de aprovação/roteamento ficam no contexto de governança, ações de treinamento/seleção/exclusão no contexto operacional e toggles técnicos de stream no diagnóstico. Fluxo de conversa foi preservado sem mudança de contrato backend.
- **Decomposição incremental dos utilitários de anexos de mídia do Chat (08/03/2026):** as funções de conversão base64 de arquivo/upload/URL (`fileToBase64` e `mediaAttachmentToBase64`) foram extraídas para `apps/frontend-service/src/pages/Chat/chat-media-attachments.ts` e integradas ao `apps/frontend-service/src/pages/Chat/index.tsx`, reduzindo o container principal de 2833 para 2784 linhas sem alterar contratos de API.
- **Decomposição incremental do hook de sizing de ordens em Trading (08/03/2026):** cálculo de preço corrente e `contractMultiplier`, junto com handlers de conversão (`size` <-> `usdtAmount`), foram extraídos para `apps/frontend-service/src/components/trading/useTradingOrderSizing.ts` e integrados ao `apps/frontend-service/src/pages/Trading.tsx`, reduzindo o container principal de 3178 para 3137 linhas sem alterar contratos de API.
- **Decomposição incremental dos cálculos de resumo de ordem em Trading (08/03/2026):** validações de submissão e estimativas de PnL (preço efetivo, leverage, SL/TP e `canSubmitOrder`) foram extraídas para `apps/frontend-service/src/components/trading/TradingOrderSummary.ts` e integradas ao `apps/frontend-service/src/pages/Trading.tsx`, reduzindo o container principal de 3137 para 3116 linhas sem alterar contratos de API.
- **Decomposição incremental do hook de presets de notícias em Trading (08/03/2026):** query/mutações e regras de seleção/criação/atualização/remoção de presets de notícias foram extraídas para `apps/frontend-service/src/components/trading/useTradingNewsPresets.ts` e integradas ao `apps/frontend-service/src/pages/Trading.tsx`, reduzindo o container principal de 3116 para 3080 linhas sem alterar contratos de API.
- **Decomposição incremental do hook de histórico de ordens em Trading (08/03/2026):** estado, paginação, seleção em lote e exclusão de histórico foram extraídos para `apps/frontend-service/src/components/trading/useTradingOrderHistory.ts` e integrados ao `apps/frontend-service/src/pages/Trading.tsx`, reduzindo o container principal de 3080 para 3006 linhas sem alterar contratos de API.
- **Decomposição incremental da navegação de workspaces/tabs em Trading (08/03/2026):** estado e handlers (`activeTab`, `activeWorkspace`, troca de tabs/workspaces e reconciliação automática) foram extraídos para `apps/frontend-service/src/components/trading/useTradingWorkspaceNavigation.ts` e integrados ao `apps/frontend-service/src/pages/Trading.tsx`, reduzindo o container principal de 3006 para 2987 linhas sem alterar contratos de API.
- **Decomposição incremental das mutações de ordens/controle em Trading (08/03/2026):** mutações de ordens e governança de controle (`create/cancel/approve/reject/update/sync/risk` + `handleModeChange` e `handleTradingToggle`) foram extraídas para `apps/frontend-service/src/components/trading/useTradingControlOrderMutations.ts`, integradas ao `apps/frontend-service/src/pages/Trading.tsx`, com redução do container principal de 2987 para 2700 linhas sem alterar contratos de API.
- **Decomposição incremental das mutações de sinais em Trading (08/03/2026):** mutações de `create/generate signal`, `signal auto run`, `signal scheduler` e `deactivate signal` foram extraídas para `apps/frontend-service/src/components/trading/useTradingSignalMutations.ts`, integradas ao `apps/frontend-service/src/pages/Trading.tsx`, com redução do container principal de 2700 para 2538 linhas sem alterar contratos de API.
- **Decomposição incremental da orquestração de pipeline em Trading (08/03/2026):** `enqueueTradingMutation`, `enqueueTrading` e `runPortfolioAutoPipeline` foram extraídos para `apps/frontend-service/src/components/trading/useTradingPipelineActions.ts`, integrados ao `apps/frontend-service/src/pages/Trading.tsx`, com redução do container principal de 2538 para 2424 linhas sem alterar contratos de API.
- **Decomposição incremental das preferências de símbolos em Trading (08/03/2026):** `updateSymbolPrefs`, `toggleFavorite` e `toggleFeatured` foram extraídos para `apps/frontend-service/src/components/trading/useTradingSymbolPreferences.ts`, integrados ao `apps/frontend-service/src/pages/Trading.tsx`, com redução do container principal de 2424 para 2397 linhas sem alterar contratos de API.
- **Decomposição incremental das mutações de perfil/post-mortem em Trading (08/03/2026):** `updateSignalProfile` e `sendPostMortemToTraining` foram extraídos para `apps/frontend-service/src/components/trading/useTradingProfilePostmortemMutations.ts`, integrados ao `apps/frontend-service/src/pages/Trading.tsx`, com redução do container principal de 2397 para 2350 linhas sem alterar contratos de API.
- **Decomposição incremental da navegação/workspaces em WisePayments (08/03/2026):** catálogo de tabs, mapeamento de workspaces e tipos (`WiseTabKey`/`WiseWorkspaceKey`) foram extraídos para `apps/frontend-service/src/pages/wise-payments/wise-payments-navigation.ts` e integrados ao `apps/frontend-service/src/pages/WisePayments.tsx`, reduzindo o container principal de 3263 para 3183 linhas sem alterar contratos de API.
- **Decomposição incremental do guard de queries em WisePayments (08/03/2026):** política de bloqueio temporário para respostas `401/429`, controle de janela de bloqueio e tratamento centralizado de erro foram extraídos para `apps/frontend-service/src/pages/wise-payments/use-wise-query-guard.ts` e integrados ao `apps/frontend-service/src/pages/WisePayments.tsx`, reduzindo o container principal de 3183 para 3133 linhas sem alterar contratos de API.
- **Decomposição incremental dos handlers de referência em WisePayments (08/03/2026):** estados e handlers operacionais de `balanceCapacity`, `totalFunds`, `rates` e `recipientRequirements` foram extraídos para `apps/frontend-service/src/pages/wise-payments/use-wise-reference-actions.ts` e integrados ao `apps/frontend-service/src/pages/WisePayments.tsx`, reduzindo o container principal de 3133 para 3070 linhas sem alterar contratos de API.
- **Decomposição incremental dos handlers de transferência/cartões em WisePayments (08/03/2026):** estados e handlers de `fund/cancel transfer`, permissões de cartão e fluxos `card secure` foram extraídos para `apps/frontend-service/src/pages/wise-payments/use-wise-transfer-and-card-actions.ts` e integrados ao `apps/frontend-service/src/pages/WisePayments.tsx`, reduzindo o container principal de 3070 para 2949 linhas sem alterar contratos de API.
- **Decomposição incremental de upload de arquivos em WisePayments (08/03/2026):** estado e handlers de upload para disputas/KYC (`dispute`, `kyc document`, `kyc additional`) foram extraídos para `apps/frontend-service/src/pages/wise-payments/use-wise-file-upload-state.ts` e integrados ao `apps/frontend-service/src/pages/WisePayments.tsx`, reduzindo o container principal de 2949 para 2900 linhas sem alterar contratos de API.
- **Decomposição incremental do catalog workbench em WisePayments (08/03/2026):** estado, efeitos de reset/sincronização de parâmetros e handler de execução de operações de catálogo foram extraídos para `apps/frontend-service/src/pages/wise-payments/use-wise-catalog-workbench.ts` e integrados ao `apps/frontend-service/src/pages/WisePayments.tsx`, reduzindo o container principal de 2900 para 2829 linhas sem alterar contratos de API.
- **Decomposição incremental dos fluxos webhooks/simulations/sca em WisePayments (08/03/2026):** estado e mutações operacionais de `webhooks`, `simulations` e `sca` foram extraídos para `apps/frontend-service/src/pages/wise-payments/use-wise-webhook-simulation-sca-actions.ts` e integrados ao `apps/frontend-service/src/pages/WisePayments.tsx`, reduzindo o container principal de 2829 para 2586 linhas sem alterar contratos de API.
- **Decomposição incremental dos fluxos account-details/card-orders/disputes em WisePayments (08/03/2026):** estado, mutações e handlers operacionais de `account-details`, `card-orders`, `card-transactions`, `disputes` e `kyc` foram extraídos para `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-actions.ts` e integrados ao `apps/frontend-service/src/pages/WisePayments.tsx`, reduzindo o container principal de 2586 para 2076 linhas sem alterar contratos de API.
- **Decomposição incremental dos fluxos users/activities em WisePayments (08/03/2026):** estado, mutações e handlers operacionais de `users` e `activities` foram extraídos para `apps/frontend-service/src/pages/wise-payments/use-wise-user-activity-actions.ts` e integrados ao `apps/frontend-service/src/pages/WisePayments.tsx`, reduzindo o container principal de 2076 para 2025 linhas sem alterar contratos de API.
- **Decomposição incremental dos fluxos balances/quotes/exchange/statements em WisePayments (08/03/2026):** estado, mutações e handlers operacionais de `balances`, `quotes`, `exchange` e `statements` foram extraídos para `apps/frontend-service/src/pages/wise-payments/use-wise-balance-exchange-statement-actions.ts` e integrados ao `apps/frontend-service/src/pages/WisePayments.tsx`, reduzindo o container principal de 2025 para 1826 linhas sem alterar contratos de API.
- **Decomposição incremental dos fluxos cards/spend-controls/spend-limits em WisePayments (08/03/2026):** estado, mutações e handlers operacionais de `cards`, `spend-controls` e `spend-limits` foram extraídos para `apps/frontend-service/src/pages/wise-payments/use-wise-card-spend-actions.ts` e integrados ao `apps/frontend-service/src/pages/WisePayments.tsx`, reduzindo o container principal de 1826 para 1518 linhas sem alterar contratos de API.
- **Decomposição incremental dos fluxos recipients em WisePayments (08/03/2026):** estado/transições de diálogo e deleção de recipient foram extraídos para `apps/frontend-service/src/pages/wise-payments/use-wise-recipient-actions.ts` e integrados ao `apps/frontend-service/src/pages/WisePayments.tsx`, reduzindo o container principal de 1518 para 1503 linhas sem alterar contratos de API.
- **Decomposição incremental da composição de queries/filtros em WisePayments (08/03/2026):** carregamento de dados, guard de erro, `profileFilter` e paginação de `cardOrders` foram extraídos para `apps/frontend-service/src/pages/wise-payments/use-wise-data-queries.ts`, com contratos de tipo centralizados em `apps/frontend-service/src/pages/wise-payments/wise-payments-types.ts` e integração no `apps/frontend-service/src/pages/WisePayments.tsx`, reduzindo o container principal de 1503 para 1231 linhas sem alterar contratos de API.
- **Decomposição incremental das constantes/status em WisePayments (08/03/2026):** catálogo de operações, lista de moedas e renderer de status badge foram extraídos para `apps/frontend-service/src/pages/wise-payments/wise-payments-constants.tsx` e integrados ao `apps/frontend-service/src/pages/WisePayments.tsx`, reduzindo o container principal de 1231 para 999 linhas sem alterar contratos de API.
- **Decomposição incremental da normalização de mensagens no Chat (08/03/2026):** normalização de payload do servidor, mapeamento de anexos legados e snapshot de usuário foram extraídos para `apps/frontend-service/src/pages/Chat/chat-message-normalization.ts` e integrados ao `apps/frontend-service/src/pages/Chat/index.tsx`, reduzindo o container principal de 2784 para 2737 linhas sem alterar contratos de API.
- **Decomposição incremental da lista de conversas no Chat (08/03/2026):** o componente `ConversationsList` foi extraído para `apps/frontend-service/src/pages/Chat/components/ConversationsList.tsx` e integrado ao `apps/frontend-service/src/pages/Chat/index.tsx`, reduzindo o container principal de 2737 para 2558 linhas sem alterar contratos de API.
- **Decomposição incremental do hook mobile no Chat (08/03/2026):** a detecção de viewport mobile foi extraída para `apps/frontend-service/src/pages/Chat/useIsMobileViewport.ts` e integrada ao `apps/frontend-service/src/pages/Chat/index.tsx`, reduzindo o container principal de 2558 para 2536 linhas sem alterar contratos de API.
- **Decomposição incremental dos hooks de auto-scroll e seleção no Chat (08/03/2026):** comportamentos de scroll automático e seleção em lote/range foram extraídos para `apps/frontend-service/src/pages/Chat/useChatAutoScroll.ts` e `apps/frontend-service/src/pages/Chat/useChatSelectionState.ts`, reduzindo o container principal de 2536 para 2459 linhas sem alterar contratos de API.
- **Decomposição incremental do lifecycle de conversas no Chat (08/03/2026):** mutações de `create/delete/bulk-delete/delete-all`, atualização de `approval policy` e handlers de sidebar/foco foram extraídos para `apps/frontend-service/src/pages/Chat/useChatConversationLifecycle.ts` e integrados ao `apps/frontend-service/src/pages/Chat/index.tsx`, reduzindo o container principal de 2459 para 2375 linhas sem alterar contratos de API.
- **Decomposição incremental das ações de treinamento/feedback no Chat (08/03/2026):** mutações de envio para treinamento (`conversation`/`messages`), abertura de dialogs e feedback multimodal (`rate message`/`rate image`) foram extraídos para `apps/frontend-service/src/pages/Chat/useChatTrainingFeedbackActions.ts` e integrados ao `apps/frontend-service/src/pages/Chat/index.tsx`, reduzindo o container principal de 2375 para 2263 linhas sem alterar contratos de API.
- **Decomposição incremental das ações de gravação/transcrição no Chat (08/03/2026):** start/stop/send de gravação, polling de transcrição, upload JSON e fallback de MIME foram extraídos para `apps/frontend-service/src/pages/Chat/useChatRecordingActions.ts` e integrados ao `apps/frontend-service/src/pages/Chat/index.tsx`, reduzindo o container principal de 2263 para 2045 linhas sem alterar contratos de API.
- **Decomposição incremental das ações de anexos de mídia no Chat (08/03/2026):** upload/remoção/limpeza de mídia pendente foram extraídos para `apps/frontend-service/src/pages/Chat/useChatMediaAttachmentActions.ts` e integrados ao `apps/frontend-service/src/pages/Chat/index.tsx`, reduzindo o container principal de 2045 para 1929 linhas sem alterar contratos de API.
- **Decomposição incremental do diagnóstico de stream no Chat (08/03/2026):** resolução de status de stream, append de eventos e criação de status event foram extraídos para `apps/frontend-service/src/pages/Chat/useChatStreamDiagnostics.ts` e integrados ao `apps/frontend-service/src/pages/Chat/index.tsx`, reduzindo o container principal de 1929 para 1889 linhas sem alterar contratos de API.
- **Decomposição incremental dos filtros de conversa no Chat (08/03/2026):** parsing de querystring para contexto/filtro por data e ação de limpeza foram extraídos para `apps/frontend-service/src/pages/Chat/useChatConversationFilters.ts` e integrados ao `apps/frontend-service/src/pages/Chat/index.tsx`, reduzindo o container principal de 1889 para 1857 linhas sem alterar contratos de API.
- **Decomposição incremental das ações do composer no Chat (08/03/2026):** handlers de `regenerate`, `stop streaming`, `send` e `submit` foram extraídos para `apps/frontend-service/src/pages/Chat/useChatComposerActions.ts` e integrados ao `apps/frontend-service/src/pages/Chat/index.tsx`, reduzindo o container principal de 1857 para 1811 linhas sem alterar contratos de API.
- **Decomposição incremental do roteamento de agentes no Chat (08/03/2026):** estado/sincronização de `routing mode`, agentes selecionados, source/debug e validação de seleção manual foram extraídos para `apps/frontend-service/src/pages/Chat/useChatRoutingState.ts` e integrados ao `apps/frontend-service/src/pages/Chat/index.tsx`, reduzindo o container principal de 1811 para 1772 linhas sem alterar contratos de API.
- **Decomposição incremental do lifecycle de página no Chat (08/03/2026):** side-effects de drawer mobile, sincronização de refs (`input`/`pendingMedia`), reset de sincronização por conversa e cleanup de gravação foram extraídos para `apps/frontend-service/src/pages/Chat/useChatPageLifecycle.ts` e integrados ao `apps/frontend-service/src/pages/Chat/index.tsx`, reduzindo o container principal de 1772 para 1751 linhas sem alterar contratos de API.
- **Decomposição incremental da stream mutation no Chat (08/03/2026):** mutação principal de `sendMessage` (stream SSE, parsing de eventos, atualização incremental de conteúdo, integração de routing/debug e fallback de erro) foi extraída para `apps/frontend-service/src/pages/Chat/chat-stream-mutation.ts` e integrada ao `apps/frontend-service/src/pages/Chat/index.tsx`, reduzindo o container principal de 1751 para 1231 linhas sem alterar contratos de API.
- **Decomposição incremental de handlers residuais em Trading (08/03/2026):** callbacks de prefill de ordem (`prefillSellOrderFromAsset`), troca de intervalo (`handleIntervalChange`) e abertura de review por id (`openReviewDialogById`) foram extraídos para `apps/frontend-service/src/components/trading/useTradingPageInteractionHandlers.ts` e integrados ao `apps/frontend-service/src/pages/Trading.tsx`, reduzindo o container principal de 2350 para 2324 linhas sem alterar contratos de API.
- **Decomposição incremental de navegação/parser em WisePayments (08/03/2026):** estado de navegação de workspace/tabs e parser JSON seguro foram extraídos para `apps/frontend-service/src/pages/wise-payments/use-wise-navigation-state.ts` e `apps/frontend-service/src/pages/wise-payments/use-wise-json-parser.ts` e integrados ao `apps/frontend-service/src/pages/WisePayments.tsx`, reduzindo o container principal de 1000 para 968 linhas sem alterar contratos de API.
- **Padronização de filtros e estados vazios no Frontend P2 (07/03/2026):** criado `WorkspaceFilterBar` (`apps/frontend-service/src/components/ui/workspace-filter-bar.tsx`) e aplicado em `Trading`, `WisePayments`, `Training`, `Chat`, `Documents`, `Agents`, `Namespaces`, `UsersAdmin` e `DemoTrading`; criado `EmptyState` (`apps/frontend-service/src/components/ui/empty-state.tsx`) e aplicado nos estados vazios críticos de `DemoTrading`, `Trading`, `UsersAdmin` e `Documents`, reduzindo duplicação, drift visual e carga de manutenção.
- **Padronização de tabelas vazias no Frontend P2 (07/03/2026):** criado `TableEmptyRow` (`apps/frontend-service/src/components/ui/table-empty-row.tsx`) e aplicado em `apps/frontend-service/src/pages/UsersAdmin.tsx` para cenários sem dados nas tabelas de usuários, permissões e permissões customizadas, reduzindo repetição de markup e inconsistência de layout.
- **Padronização de estado vazio em diálogo no Frontend P2 (07/03/2026):** o diálogo de usuário em `apps/frontend-service/src/pages/UsersAdmin.tsx` passou a usar `EmptyState` quando não há grupos disponíveis para vincular, alinhando UX de vazio entre tabelas, cards e formulários.
- **Decomposição incremental do UsersAdmin iniciada no Frontend P2 (07/03/2026):** a aba `users` foi extraída para `apps/frontend-service/src/pages/users-admin/components/users-tab-content.tsx`, mantendo `apps/frontend-service/src/pages/UsersAdmin.tsx` como container de estado/mutações e reduzindo acoplamento estrutural da mega-página sem alterar contratos de API/RBAC.
- **Decomposição incremental do UsersAdmin avançada no Frontend P2 (07/03/2026):** a aba `groups` foi extraída para `apps/frontend-service/src/pages/users-admin/components/groups-tab-content.tsx`, mantendo `UsersAdmin.tsx` como composition root de estado/mutações e reduzindo o bloco inline da tela sem alterar contratos de API/RBAC.
- **Decomposição incremental do UsersAdmin evoluída no Frontend P2 (07/03/2026):** a aba `roles` foi extraída para `apps/frontend-service/src/pages/users-admin/components/roles-tab-content.tsx`, mantendo `UsersAdmin.tsx` como composition root de estado/mutações e reduzindo o bloco inline da tela sem alterar contratos de API/RBAC.
- **Decomposição incremental do UsersAdmin consolidada nas abas principais no Frontend P2 (07/03/2026):** a aba `permissions` foi extraída para `apps/frontend-service/src/pages/users-admin/components/permissions-tab-content.tsx`, mantendo `UsersAdmin.tsx` como composition root de estado/mutações e preservando o fluxo de toggle de permissões com debounce/save queue sem alterar contratos de API/RBAC.
- **Decomposição incremental de dialog no UsersAdmin no Frontend P2 (07/03/2026):** o diálogo de permissões de role customizada foi extraído para `apps/frontend-service/src/pages/users-admin/components/custom-role-permissions-dialog.tsx`, mantendo `UsersAdmin.tsx` como composition root de estado/mutações e preservando o fluxo assíncrono de toggle/debounce sem alterar contratos de API/RBAC.
- **Decomposição incremental do diálogo principal de usuário no Frontend P2 (07/03/2026):** as seções `profile`, `roles`, `customRoles` e `groups` do diálogo de usuário em `apps/frontend-service/src/pages/UsersAdmin.tsx` foram extraídas para `apps/frontend-service/src/pages/users-admin/components/user-dialog-profile-section.tsx`, `user-dialog-roles-section.tsx`, `user-dialog-custom-roles-section.tsx` e `user-dialog-groups-section.tsx`, mantendo `UsersAdmin.tsx` como composition root de estado/mutações e preservando contratos de API/RBAC.
- **Decomposição incremental de tabs do Documents no Frontend P2 (07/03/2026):** os blocos de conteúdo das tabs `documents` e `media` de `apps/frontend-service/src/pages/Documents.tsx` foram extraídos para `apps/frontend-service/src/pages/documents/components/documents-tab-content.tsx` e `apps/frontend-service/src/pages/documents/components/media-tab-content.tsx`, mantendo o container principal responsável por estado/mutações/render callbacks e preservando contratos de API.
- **Decomposição incremental de dialogs operacionais do Documents no Frontend P2 (07/03/2026):** os dialogs de upload, confirmação de exclusão e envio de mídia para treinamento foram extraídos para `apps/frontend-service/src/pages/documents/components/upload-dialog.tsx`, `delete-confirm-dialog.tsx` e `media-send-training-dialog.tsx`, mantendo `apps/frontend-service/src/pages/Documents.tsx` como orchestrator de estado/mutações e preservando contratos de API.
- **Decomposição incremental do upload zone no Documents no Frontend P2 (07/03/2026):** o componente de dropzone/upload foi extraído para `apps/frontend-service/src/pages/documents/components/upload-zone.tsx`, removendo implementação inline de `Documents.tsx` e preservando fluxo de upload real e validações existentes.
- **Decomposição incremental do viewer dialog no Documents no Frontend P2 (07/03/2026):** o diálogo de visualização/edição de documentos foi extraído para `apps/frontend-service/src/pages/documents/components/document-viewer-dialog.tsx`, mantendo `Documents.tsx` como orchestrator de estado/mutações e preservando contratos de API.
- **Decomposição incremental de cards no Documents no Frontend P2 (07/03/2026):** os componentes de apresentação `DocumentCard` e `MediaCard` foram extraídos para `apps/frontend-service/src/pages/documents/components/document-card.tsx` e `apps/frontend-service/src/pages/documents/components/media-card.tsx`, mantendo `Documents.tsx` como container de estado/mutações.
- **Decomposição incremental do workspace header no Documents no Frontend P2 (07/03/2026):** o cabeçalho operacional (título, métricas, filtros de workspace e tabs) foi extraído para `apps/frontend-service/src/pages/documents/components/documents-workspace-header.tsx`, mantendo `Documents.tsx` focado em estado/mutações.
- **Decomposição incremental de types/config no Documents no Frontend P2 (07/03/2026):** contratos de tipos e configuração de workspace/tabs/status foram extraídos para `apps/frontend-service/src/pages/documents/types.ts` e `apps/frontend-service/src/pages/documents/config.ts`, mantendo `Documents.tsx` focado em orquestração de estado/mutações.
- **Decomposição incremental de formulários no UsersAdmin no Frontend P2 (07/03/2026):** os dialogs de grupos, role customizada e permissões foram extraídos para `apps/frontend-service/src/pages/users-admin/components/group-form-dialog.tsx`, `custom-role-form-dialog.tsx` e `permission-form-dialog.tsx`; schemas/helpers e tipos foram centralizados em `apps/frontend-service/src/pages/users-admin/form-schemas.ts` e `apps/frontend-service/src/pages/users-admin/types.ts`.
- **Decomposição incremental de gestão de membros no UsersAdmin no Frontend P2 (07/03/2026):** o diálogo de membros de grupo foi extraído para `apps/frontend-service/src/pages/users-admin/components/group-members-dialog.tsx`, mantendo `apps/frontend-service/src/pages/UsersAdmin.tsx` como composition root de estado/mutações e preservando contratos de API/RBAC.
- **Decomposição incremental de orquestração de permissões no UsersAdmin no Frontend P2 (07/03/2026):** debounce/save queue de permissões de role e custom role foi extraído para `apps/frontend-service/src/pages/users-admin/hooks/use-role-permission-orchestration.ts`, reduzindo densidade de `apps/frontend-service/src/pages/UsersAdmin.tsx` sem alterar contratos de API/RBAC.
- **Decomposição incremental de lifecycle de usuário no UsersAdmin no Frontend P2 (07/03/2026):** os fluxos de criação/edição/salvamento/status de usuário foram extraídos para `apps/frontend-service/src/pages/users-admin/hooks/use-user-management.ts`, preservando validações e mutações originais e reduzindo densidade de `apps/frontend-service/src/pages/UsersAdmin.tsx`.
- **Decomposição incremental de mutações em Documents no Frontend P2 (07/03/2026):** mutações de upload, exclusão, reprocessamento e envio para treinamento foram extraídas para `apps/frontend-service/src/pages/documents/hooks/use-documents-mutations.ts`, preservando contratos de API e reduzindo densidade de `apps/frontend-service/src/pages/Documents.tsx`.
- **Decomposição incremental de orquestração de dialogs em Documents no Frontend P2 (07/03/2026):** handlers de abertura/fechamento/confirmação dos dialogs de exclusão e envio para treinamento foram extraídos para `apps/frontend-service/src/pages/documents/hooks/use-documents-dialog-orchestration.ts`, preservando contratos de API e reduzindo densidade de estado transiente de `apps/frontend-service/src/pages/Documents.tsx`.
- **Decomposição incremental de estado derivado/filtros em Documents no Frontend P2 (07/03/2026):** filtros de busca/status, stats, namespace map e listas derivadas de documentos/mídias foram extraídos para `apps/frontend-service/src/pages/documents/hooks/use-documents-derived-state.ts`, preservando contratos de API e reduzindo lógica inline de `apps/frontend-service/src/pages/Documents.tsx`.
- **Decomposição incremental da aba de ordens em Trading no Frontend P2 (07/03/2026):** o conteúdo da aba `orders` foi extraído para `apps/frontend-service/src/components/trading/TradingOrdersTabContent.tsx` (exportado em `apps/frontend-service/src/components/trading/index.ts`), mantendo `apps/frontend-service/src/pages/Trading.tsx` como composition root e reduzindo acoplamento visual/operacional sem alterar contratos de API.
- **Decomposição incremental da aba portfolio-auto em Trading no Frontend P2 (07/03/2026):** o conteúdo da aba `portfolio-auto` foi extraído para `apps/frontend-service/src/components/trading/TradingPortfolioAutoTabContent.tsx` (exportado em `apps/frontend-service/src/components/trading/index.ts`), mantendo `apps/frontend-service/src/pages/Trading.tsx` como composition root e reduzindo acoplamento visual/operacional sem alterar contratos de API.
- **Decomposição incremental da aba signals-auto em Trading no Frontend P2 (07/03/2026):** o conteúdo da aba `signals-auto` foi extraído para `apps/frontend-service/src/components/trading/TradingSignalsAutoTabContent.tsx` (exportado em `apps/frontend-service/src/components/trading/index.ts`), mantendo `apps/frontend-service/src/pages/Trading.tsx` como composition root e reduzindo acoplamento visual/operacional sem alterar contratos de API.
- **Decomposição incremental da aba lab em Trading no Frontend P2 (07/03/2026):** o conteúdo da aba `lab` foi extraído para `apps/frontend-service/src/components/trading/TradingLabTabContent.tsx` (exportado em `apps/frontend-service/src/components/trading/index.ts`), mantendo `apps/frontend-service/src/pages/Trading.tsx` como composition root e reduzindo acoplamento visual/operacional sem alterar contratos de API.
- **Decomposição incremental das abas control/account em Trading no Frontend P2 (07/03/2026):** os conteúdos das abas `control` e `account` foram extraídos para `apps/frontend-service/src/components/trading/TradingControlTabContent.tsx` e `apps/frontend-service/src/components/trading/TradingAccountTabContent.tsx` (exportados em `apps/frontend-service/src/components/trading/index.ts`), mantendo `apps/frontend-service/src/pages/Trading.tsx` como composition root e reduzindo acoplamento visual/operacional sem alterar contratos de API.
- **Decomposição incremental da aba positions em Trading no Frontend P2 (07/03/2026):** o conteúdo da aba `positions` foi extraído para `apps/frontend-service/src/components/trading/TradingPositionsTabContent.tsx` (exportado em `apps/frontend-service/src/components/trading/index.ts`), mantendo `apps/frontend-service/src/pages/Trading.tsx` como composition root e reduzindo acoplamento visual/operacional sem alterar contratos de API.
- **Decomposição incremental das abas history/postmortems em Trading no Frontend P2 (07/03/2026):** os conteúdos das abas `history` e `postmortems` foram extraídos para `apps/frontend-service/src/components/trading/TradingHistoryTabContent.tsx` e `apps/frontend-service/src/components/trading/TradingPostMortemsTabContent.tsx` (exportados em `apps/frontend-service/src/components/trading/index.ts`), mantendo `apps/frontend-service/src/pages/Trading.tsx` como composition root e reduzindo acoplamento visual/operacional sem alterar contratos de API.
- **Decomposição incremental da seção de resultados de signals em Trading no Frontend P2 (07/03/2026):** o bloco de detalhe/lista/aprovação da aba `signals` foi extraído para `apps/frontend-service/src/components/trading/TradingSignalsResultsSection.tsx` (exportado em `apps/frontend-service/src/components/trading/index.ts`), mantendo `apps/frontend-service/src/pages/Trading.tsx` como composition root e reduzindo acoplamento visual/operacional sem alterar contratos de API.
- **Decomposição incremental da seção de scheduler de signals em Trading no Frontend P2 (07/03/2026):** o bloco de configuração/status/salvamento do scheduler da aba `signals` foi extraído para `apps/frontend-service/src/components/trading/TradingSignalsSchedulerSection.tsx` (exportado em `apps/frontend-service/src/components/trading/index.ts`), mantendo `apps/frontend-service/src/pages/Trading.tsx` como composition root e reduzindo acoplamento visual/operacional sem alterar contratos de API.
- **Decomposição incremental da seção de configuração de perfil de signals em Trading no Frontend P2 (07/03/2026):** o bloco de timeframes/indicadores/técnicas/ensemble/arbitragem/fontes da aba `signals` foi extraído para `apps/frontend-service/src/components/trading/TradingSignalsProfileConfigurationSection.tsx` (exportado em `apps/frontend-service/src/components/trading/index.ts`), mantendo `apps/frontend-service/src/pages/Trading.tsx` como composition root e reduzindo acoplamento visual/operacional sem alterar contratos de API.
- **Decomposição incremental da seção de news/actions de signals em Trading no Frontend P2 (07/03/2026):** o bloco de `NewsConfigEditor` e ações operacionais (`save profile`, `generate now`, `create/update preset`) da aba `signals` foi extraído para `apps/frontend-service/src/components/trading/TradingSignalsNewsAndActionsSection.tsx` (exportado em `apps/frontend-service/src/components/trading/index.ts`), mantendo `apps/frontend-service/src/pages/Trading.tsx` como composition root e reduzindo acoplamento visual/operacional sem alterar contratos de API.
- **Decomposição incremental do diálogo de criação de signals em Trading no Frontend P2 (07/03/2026):** o diálogo de novo sinal da aba `signals` foi extraído para `apps/frontend-service/src/components/trading/TradingNewSignalDialog.tsx` (exportado em `apps/frontend-service/src/components/trading/index.ts`), mantendo `apps/frontend-service/src/pages/Trading.tsx` como composition root de estado/mutações e reduzindo acoplamento visual sem alterar contratos de API.
- **Decomposição incremental do diálogo de envio de post-mortem em Trading no Frontend P2 (07/03/2026):** o diálogo de envio de post-mortem para treinamento foi extraído para `apps/frontend-service/src/components/trading/TradingPostmortemTrainingDialog.tsx` (exportado em `apps/frontend-service/src/components/trading/index.ts`), mantendo `apps/frontend-service/src/pages/Trading.tsx` como composition root de estado/mutações e reduzindo acoplamento visual sem alterar contratos de API.
- **Decomposição incremental do diálogo de revisão de ordem em Trading no Frontend P2 (07/03/2026):** o diálogo de revisão/aprovação de ordens pendentes foi extraído para `apps/frontend-service/src/components/trading/TradingReviewOrderDialog.tsx` (exportado em `apps/frontend-service/src/components/trading/index.ts`), mantendo `apps/frontend-service/src/pages/Trading.tsx` como composition root de estado/mutações e reduzindo acoplamento visual sem alterar contratos de API.
- **Decomposição incremental do diálogo de configuração de risco em Trading no Frontend P2 (07/03/2026):** o diálogo de limites/defaults de risco foi extraído para `apps/frontend-service/src/components/trading/TradingRiskConfigDialog.tsx` (exportado em `apps/frontend-service/src/components/trading/index.ts`), mantendo `apps/frontend-service/src/pages/Trading.tsx` como composition root de estado/mutações e reduzindo acoplamento visual sem alterar contratos de API.
- **Decomposição incremental do diálogo de nova ordem em Trading no Frontend P2 (07/03/2026):** o diálogo operacional de criação de ordens (resumo, conversão contratos/USDT, leverage e SL/TP) foi extraído para `apps/frontend-service/src/components/trading/TradingNewOrderDialog.tsx` (exportado em `apps/frontend-service/src/components/trading/index.ts`), mantendo `apps/frontend-service/src/pages/Trading.tsx` como composition root de estado/mutações e reduzindo acoplamento visual sem alterar contratos de API.
- **Decomposição incremental das abas analysis/chart/orderbook em Trading no Frontend P2 (08/03/2026):** os blocos inline dessas abas foram extraídos para `apps/frontend-service/src/components/trading/TradingAnalysisTabContent.tsx`, `TradingChartTabContent.tsx` e `TradingOrderBookTabContent.tsx` (exportados em `apps/frontend-service/src/components/trading/index.ts`), mantendo `apps/frontend-service/src/pages/Trading.tsx` como composition root de estado/mutações e reduzindo densidade residual sem alterar contratos de API.
- **Decomposição incremental da aba overview em Trading no Frontend P2 (08/03/2026):** o bloco operacional da aba `overview` (quick trade, resumo de conta, sinais recentes e ordens recentes) foi extraído para `apps/frontend-service/src/components/trading/TradingOverviewTabContent.tsx` (exportado em `apps/frontend-service/src/components/trading/index.ts`), mantendo `apps/frontend-service/src/pages/Trading.tsx` como composition root de estado/mutações e reduzindo densidade residual sem alterar contratos de API.
- **Decomposição incremental das linhas de métricas em Trading no Frontend P2 (08/03/2026):** os cards de métricas de mercado/conta e status operacional foram extraídos para `apps/frontend-service/src/components/trading/TradingStatsRows.tsx` (`TradingStatsPrimaryRow` e `TradingStatsSecondaryRow`, exportados em `apps/frontend-service/src/components/trading/index.ts`), removendo helpers inline do `apps/frontend-service/src/pages/Trading.tsx` e reduzindo densidade residual sem alterar contratos de API.
- **Decomposição incremental do header operacional em Trading no Frontend P2 (08/03/2026):** o bloco de título/status, seletores de mercado/símbolo, ações de favoritos/destaques, indicador WS e acesso a risco foi extraído para `apps/frontend-service/src/components/trading/TradingHeaderSection.tsx` (exportado em `apps/frontend-service/src/components/trading/index.ts`), removendo densidade operacional do `apps/frontend-service/src/pages/Trading.tsx` e mantendo contratos de API sem alteração.
- **Decomposição incremental de alertas operacionais em Trading no Frontend P2 (08/03/2026):** os alertas de erro crítico de upstream e trading desabilitado foram extraídos para `apps/frontend-service/src/components/trading/TradingOperationalAlerts.tsx` (exportado em `apps/frontend-service/src/components/trading/index.ts`), removendo lógica de apresentação inline de `apps/frontend-service/src/pages/Trading.tsx` e mantendo contratos de API sem alteração.
- **Decomposição incremental do shell de tabs em Trading no Frontend P2 (08/03/2026):** a estrutura compartilhada de navegação (`Tabs + WorkspaceFilterBar + TabsList/TabsTrigger`) foi extraída para `apps/frontend-service/src/components/trading/TradingTabsShell.tsx` (exportado em `apps/frontend-service/src/components/trading/index.ts`), removendo boilerplate de UI do `apps/frontend-service/src/pages/Trading.tsx` e mantendo contratos de API sem alteração.
- **Decomposição incremental da aba signals em Trading no Frontend P2 (08/03/2026):** o bloco operacional de sinais (`perfil + news/actions + scheduler + resultados`) foi extraído para `apps/frontend-service/src/components/trading/TradingSignalsTabContent.tsx` (exportado em `apps/frontend-service/src/components/trading/index.ts`), reduzindo densidade residual do `apps/frontend-service/src/pages/Trading.tsx` e mantendo contratos de API sem alteração.
- **Decomposição incremental da seção de dialogs em Trading no Frontend P2 (08/03/2026):** o bloco de dialogs operacionais (`nova ordem`, `OCO`, `review`, `risk config`, `post-mortem->training`, `novo sinal`) foi extraído para `apps/frontend-service/src/components/trading/TradingDialogsSection.tsx` (exportado em `apps/frontend-service/src/components/trading/index.ts`), reduzindo densidade residual do `apps/frontend-service/src/pages/Trading.tsx` e mantendo contratos de API sem alteração.
- **Decomposição incremental das abas operacionais residuais em Trading no Frontend P2 (08/03/2026):** as abas `history`, `postmortems`, `chart`, `orderbook`, `control` e `account` foram agrupadas em `apps/frontend-service/src/components/trading/TradingOperationalTabsSection.tsx` (exportado em `apps/frontend-service/src/components/trading/index.ts`), reduzindo densidade residual do `apps/frontend-service/src/pages/Trading.tsx` e mantendo contratos de API sem alteração.
- **Decomposição incremental das abas primárias em Trading no Frontend P2 (08/03/2026):** as abas `overview`, `portfolio-auto`, `signals-auto`, `lab`, `orders`, `positions`, `signals` e `analysis` foram agrupadas em `apps/frontend-service/src/components/trading/TradingPrimaryTabsSection.tsx` (exportado em `apps/frontend-service/src/components/trading/index.ts`), reduzindo densidade residual do `apps/frontend-service/src/pages/Trading.tsx` e mantendo contratos de API sem alteração.
- **Decomposição incremental da aba balances em WisePayments no Frontend P2 (08/03/2026):** a aba `balances` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-balances-tab-content.tsx`, mantendo `apps/frontend-service/src/pages/WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba exchange em WisePayments no Frontend P2 (08/03/2026):** a aba `exchange` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-exchange-tab-content.tsx`, mantendo `apps/frontend-service/src/pages/WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba transfers em WisePayments no Frontend P2 (08/03/2026):** a aba `transfers` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-transfers-tab-content.tsx`, mantendo `apps/frontend-service/src/pages/WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba recipients em WisePayments no Frontend P2 (08/03/2026):** a aba `recipients` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-recipients-tab-content.tsx`, mantendo `apps/frontend-service/src/pages/WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba quotes em WisePayments no Frontend P2 (08/03/2026):** a aba `quotes` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-quotes-tab-content.tsx`, mantendo `apps/frontend-service/src/pages/WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba batch em WisePayments no Frontend P2 (08/03/2026):** a aba `batch` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-batch-tab-content.tsx`, mantendo `apps/frontend-service/src/pages/WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba profiles em WisePayments no Frontend P2 (08/03/2026):** a aba `profiles` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-profiles-tab-content.tsx`, mantendo `apps/frontend-service/src/pages/WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba users em WisePayments no Frontend P2 (08/03/2026):** a aba `users` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-users-tab-content.tsx`, mantendo `apps/frontend-service/src/pages/WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba activities em WisePayments no Frontend P2 (08/03/2026):** a aba `activities` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-activities-tab-content.tsx`, mantendo `apps/frontend-service/src/pages/WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba statements em WisePayments no Frontend P2 (08/03/2026):** a aba `statements` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-statements-tab-content.tsx`, mantendo `apps/frontend-service/src/pages/WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba account-details em WisePayments no Frontend P2 (08/03/2026):** a aba `account-details` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-account-details-tab-content.tsx`, mantendo `apps/frontend-service/src/pages/WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba cards em WisePayments no Frontend P2 (08/03/2026):** a aba `cards` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-cards-tab-content.tsx`, mantendo `apps/frontend-service/src/pages/WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba card-orders em WisePayments no Frontend P2 (08/03/2026):** a aba `card-orders` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-card-orders-tab-content.tsx`, mantendo `apps/frontend-service/src/pages/WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba card-transactions em WisePayments no Frontend P2 (08/03/2026):** a aba `card-transactions` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-card-transactions-tab-content.tsx`, mantendo `apps/frontend-service/src/pages/WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba spend-limits em WisePayments no Frontend P2 (08/03/2026):** a aba `spend-limits` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-spend-limits-tab-content.tsx`, mantendo `apps/frontend-service/src/pages/WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba spend-controls em WisePayments no Frontend P2 (08/03/2026):** a aba `spend-controls` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-spend-controls-tab-content.tsx`, mantendo `apps/frontend-service/src/pages/WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba disputes em WisePayments no Frontend P2 (08/03/2026):** a aba `disputes` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-disputes-tab-content.tsx`, mantendo `apps/frontend-service/src/pages/WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba kyc em WisePayments no Frontend P2 (08/03/2026):** a aba `kyc` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-kyc-tab-content.tsx`, mantendo `apps/frontend-service/src/pages/WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba webhooks em WisePayments no Frontend P2 (08/03/2026):** a aba `webhooks` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-webhooks-tab-content.tsx`, mantendo `apps/frontend-service/src/pages/WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba simulations em WisePayments no Frontend P2 (08/03/2026):** a aba `simulations` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-simulations-tab-content.tsx`, mantendo `apps/frontend-service/src/pages/WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba sca em WisePayments no Frontend P2 (08/03/2026):** a aba `sca` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-sca-tab-content.tsx`, mantendo `apps/frontend-service/src/pages/WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba catalog em WisePayments no Frontend P2 (08/03/2026):** a aba `catalog` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-catalog-tab-content.tsx`, mantendo `apps/frontend-service/src/pages/WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba jobs em Training no Frontend P2 (08/03/2026):** a aba `jobs` foi extraída para `apps/frontend-service/src/pages/training/components/training-jobs-tab-content.tsx`, mantendo `apps/frontend-service/src/pages/Training.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba auto-learning em Training no Frontend P2 (08/03/2026):** a aba `auto-learning` foi extraída para `apps/frontend-service/src/pages/training/components/training-auto-learning-tab-content.tsx`, mantendo `apps/frontend-service/src/pages/Training.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba data em Training no Frontend P2 (08/03/2026):** a aba `data` foi extraída para `apps/frontend-service/src/pages/training/components/training-data-tab-content.tsx`, mantendo `apps/frontend-service/src/pages/Training.tsx` como composition root de estado/mutações, preservando seleção/review em lote e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba bulk-import em Training no Frontend P2 (08/03/2026):** a aba `bulk-import` foi extraída para `apps/frontend-service/src/pages/training/components/training-bulk-import-tab-content.tsx`, mantendo `apps/frontend-service/src/pages/Training.tsx` como composition root de estado/mutações, preservando validação Zod e fluxo de importação em lote sem alterar contratos de API.
- **Decomposição incremental da aba multimodal em Training no Frontend P2 (08/03/2026):** a aba `multimodal` foi extraída para `apps/frontend-service/src/pages/training/components/training-multimodal-tab-content.tsx`, mantendo `apps/frontend-service/src/pages/Training.tsx` como composition root de estado/mutações e preservando upload/processamento/promoção multimodal sem alterar contratos de API.
- **Decomposição incremental do diálogo on-demand em Training no Frontend P2 (08/03/2026):** o diálogo de execução manual foi extraído para `apps/frontend-service/src/pages/training/components/training-on-demand-run-dialog.tsx`, mantendo `apps/frontend-service/src/pages/Training.tsx` como composition root de estado/mutações e preservando o fluxo de start on-demand sem alterar contratos de API.
- **Decomposição incremental do diálogo batch review em Training no Frontend P2 (08/03/2026):** o diálogo de aprovação/rejeição em lote foi extraído para `apps/frontend-service/src/pages/training/components/training-batch-review-dialog.tsx`, mantendo `apps/frontend-service/src/pages/Training.tsx` como composition root de estado/mutações e preservando o fluxo de confirmação em lote sem alterar contratos de API.
- **Decomposição incremental do diálogo review em Training no Frontend P2 (08/03/2026):** o diálogo de aprovação/rejeição individual foi extraído para `apps/frontend-service/src/pages/training/components/training-review-dialog.tsx`, mantendo `apps/frontend-service/src/pages/Training.tsx` como composition root de estado/mutações e preservando o fluxo de override de escopo sem alterar contratos de API.
- **Decomposição incremental do diálogo resolve scope em Training no Frontend P2 (08/03/2026):** o diálogo de relink/resolução de escopo foi extraído para `apps/frontend-service/src/pages/training/components/training-resolve-scope-dialog.tsx`, mantendo `apps/frontend-service/src/pages/Training.tsx` como composition root de estado/mutações e preservando criação de namespace sugerido e confirmação de resolução sem alterar contratos de API.
- **Decomposição incremental do diálogo promote em Training no Frontend P2 (08/03/2026):** o diálogo de promoção foi extraído para `apps/frontend-service/src/pages/training/components/training-promote-dialog.tsx`, mantendo `apps/frontend-service/src/pages/Training.tsx` como composition root de estado/mutações e preservando o fluxo de promoção sem alterar contratos de API.
- **Decomposição incremental do diálogo rollback em Training no Frontend P2 (08/03/2026):** o diálogo de rollback foi extraído para `apps/frontend-service/src/pages/training/components/training-rollback-dialog.tsx`, mantendo `apps/frontend-service/src/pages/Training.tsx` como composition root de estado/mutações e preservando validação de motivo e auditoria sem alterar contratos de API.
- **Decomposição incremental do diálogo post-training em Training no Frontend P2 (08/03/2026):** o diálogo pós-treinamento foi extraído para `apps/frontend-service/src/pages/training/components/training-post-training-dialog.tsx`, mantendo `apps/frontend-service/src/pages/Training.tsx` como composition root de estado/mutações e preservando retorno automático/manual ao chat sem alterar contratos de API.
- **Decomposição incremental do componente TrainingDataCard em Training no Frontend P2 (08/03/2026):** o card de dataset foi extraído para `apps/frontend-service/src/pages/training/components/training-data-card.tsx`, mantendo `apps/frontend-service/src/pages/Training.tsx` como composition root de estado/mutações e preservando seleção, review e relink de escopo sem alterar contratos de API.
- **Decomposição incremental do componente TrainingJobCard em Training no Frontend P2 (08/03/2026):** o card de job foi extraído para `apps/frontend-service/src/pages/training/components/training-job-card.tsx`, mantendo `apps/frontend-service/src/pages/Training.tsx` como composition root de estado/mutações e preservando ações de promoção/aprovação/rollback sem alterar contratos de API.
- **Decomposição incremental do componente TrainingJobDetailModal em Training no Frontend P2 (08/03/2026):** o modal de detalhe de job foi extraído para `apps/frontend-service/src/pages/training/components/training-job-detail-modal.tsx`, mantendo stream SSE e trilha de auditoria sem alterar contratos de API.
- **Decomposição incremental do componente TrainingCreateJobDialog em Training no Frontend P2 (08/03/2026):** o diálogo de criação de job foi extraído para `apps/frontend-service/src/pages/training/components/training-create-job-dialog.tsx`, mantendo validação Zod e idempotência por header sem alterar contratos de API.
- **Centralização de utilitários de requisição em Training no Frontend P2 (08/03/2026):** `buildTrainingIdempotencyFingerprint`, `generateTrainingIdempotencyKey` e `getRetryAfterHint` foram centralizados em `apps/frontend-service/src/pages/training/training-request-utils.ts`, reduzindo duplicação no container `Training.tsx`.
- **Decomposição incremental dos utilitários de exibição em Trading no Frontend P2 (08/03/2026):** `SIGNAL_TYPES`, `SignalTypeBadge`, `OrderStatusBadge` e `formatDecisionSummary` foram extraídos para `apps/frontend-service/src/components/trading/TradingDisplayUtils.tsx` e reexportados em `apps/frontend-service/src/components/trading/index.ts`, reduzindo densidade do container `Trading.tsx` sem alterar contratos de API.
- **Decomposição incremental da configuração de sinais em Trading no Frontend P2 (08/03/2026):** catálogos e defaults (`SIGNAL_INDICATOR_OPTIONS`, `TRADING_TECHNIQUE_OPTIONS`, `AUTO_SIGNAL_MODE_OPTIONS`, `AUTO_SIGNAL_ALL_MODES` e `DEFAULT_*`) foram extraídos para `apps/frontend-service/src/components/trading/TradingSignalConfig.ts` e reexportados em `apps/frontend-service/src/components/trading/index.ts`, reduzindo densidade do container `Trading.tsx` sem alterar contratos de API.
- **Decomposição incremental da navegação/workspaces em Trading no Frontend P2 (08/03/2026):** tipos e catálogos de navegação (`TradingTabKey`, `TradingWorkspaceKey`, `TRADING_TAB_DESCRIPTORS`, `TRADING_WORKSPACE_TABS`, `TRADING_WORKSPACE_LABELS`, `findWorkspaceForTradingTab`) foram extraídos para `apps/frontend-service/src/components/trading/TradingNavigationConfig.ts` e reexportados em `apps/frontend-service/src/components/trading/index.ts`, reduzindo densidade do container `Trading.tsx` sem alterar contratos de API.
- **Decomposição incremental dos utilitários de página em Trading no Frontend P2 (08/03/2026):** helpers puros de símbolo/duração (`getQuoteCurrencyFromSymbol`, `getBaseCurrencyFromSymbol`, `formatDurationMinutes`) foram extraídos para `apps/frontend-service/src/components/trading/TradingPageUtils.ts` e reexportados em `apps/frontend-service/src/components/trading/index.ts`, reduzindo densidade do container `Trading.tsx` sem alterar contratos de API.
- **Decomposição incremental dos contratos de domínio em Trading no Frontend P2 (08/03/2026):** tipos de payload/conta/sinal/ordem, guards de margem (`isMarginCrossAccount`, `isMarginIsolatedAccount`) e presets de animação (`containerVariants`, `itemVariants`) foram extraídos para `apps/frontend-service/src/components/trading/TradingDomainTypes.ts` e reexportados em `apps/frontend-service/src/components/trading/index.ts`, reduzindo `Trading.tsx` de 3649 para 3320 linhas sem alterar contratos de API.
- **Decomposição incremental dos defaults de formulários em Trading no Frontend P2 (08/03/2026):** factories tipadas de inicialização/reset (`createDefault*`, `create*FromConfig`) foram extraídas para `apps/frontend-service/src/components/trading/TradingFormDefaults.ts` e aplicadas em `Trading.tsx`, reduzindo duplicação de estado e o container para 3232 linhas sem alterar contratos de API.
- **Decomposição incremental do hook de perfil de sinais em Trading no Frontend P2 (08/03/2026):** estado/updaters/reconciliação de arbitragem do `signalProfile` foram extraídos para `apps/frontend-service/src/components/trading/useTradingSignalProfileState.ts` e aplicados em `Trading.tsx`, reduzindo o container para 3178 linhas sem alterar contratos de API.
- **Decomposição incremental dos utilitários de rota/sources em Chat no Frontend P2 (08/03/2026):** roteamento/workspaces/date filters e parsing de fontes de mensagem foram extraídos para `apps/frontend-service/src/pages/Chat/chat-page-routing.ts` e `apps/frontend-service/src/pages/Chat/chat-message-sources.ts`, reduzindo `Chat/index.tsx` para 2975 linhas sem alterar contratos de API.
- **Decomposição incremental dos utilitários de gravação em Chat no Frontend P2 (08/03/2026):** normalização de MIME, encode WAV, conversão e preparo de arquivo de gravação foram extraídos para `apps/frontend-service/src/pages/Chat/chat-recording-utils.ts` e aplicados em `Chat/index.tsx`, reduzindo o container para 2833 linhas sem alterar contratos de API.
- **Decomposição de rotas de sistema do Auth Service (07/03/2026):** endpoints de health/probes (`/api/auth/health`, `/live`, `/ready`) e usuário atual (`/api/auth/user`) foram extraídos para `apps/auth-service/src/routes/auth-system-routes.ts`, mantendo o `index.ts` do auth-service como composition root para continuidade da modularização P0.
- **Decomposição de rotas de providers do Auth Service (07/03/2026):** endpoints OAuth/SAML (`/api/auth/google*`, `/api/auth/github*`, `/api/auth/saml*`) foram extraídos para `apps/auth-service/src/routes/auth-provider-routes.ts`, reduzindo acoplamento direto de providers no `index.ts`.
- **Decomposição de rotas de credenciais locais do Auth Service (07/03/2026):** endpoints de login/senha (`/api/auth/login`, `/api/auth/verify-password`, `/api/auth/change-password`) foram extraídos para `apps/auth-service/src/routes/auth-password-routes.ts`, isolando autenticação local do composition root principal.
- **Decomposição de rotas de biometria do Auth Service (07/03/2026):** endpoints de biometria (`/api/auth/biometrics/login`, `/status`, `/enroll`, `/verify`) foram extraídos para `apps/auth-service/src/routes/auth-biometrics-routes.ts`, mantendo integração com serviço interno de biometria via boundaries explícitas.
- **Decomposição de rota de registro do Auth Service (07/03/2026):** endpoint administrativo de cadastro (`/api/auth/register`) foi extraído para `apps/auth-service/src/routes/auth-registration-routes.ts`, preservando RBAC de admin e fluxo assíncrono de provisioning de identidade.
- **Decomposição de rotas WebSocket/Status do Trading no Integrations Service (07/03/2026):** endpoints de status e ciclo de subscriptions KuCoin (`/api/integrations/trading/status`, `/api/integrations/trading/ws/status`, `/api/integrations/trading/intervals`, `/api/integrations/trading/ws/subscribe`, `/api/integrations/trading/ws/unsubscribe`) foram extraídos para `apps/integrations-service/src/routes/trading-websocket-routes.ts`, reduzindo acoplamento do composition root.
- **Decomposição de rotas de símbolos do Trading no Integrations Service (07/03/2026):** endpoints de catálogo/preferências (`/api/integrations/trading/symbols` e `/api/integrations/trading/symbol-preferences` GET/PUT) foram extraídos para `apps/integrations-service/src/routes/trading-symbol-routes.ts`, mantendo governança por tenant/usuário e persistência em `trading_symbol_preferences`.
- **Decomposição de rotas de mercado/conta/posições/risco do Trading no Integrations Service (07/03/2026):** endpoints `/api/integrations/trading/market*`, `/account`, `/positions*` e `/risk-config` foram extraídos para `apps/integrations-service/src/routes/trading-market-risk-routes.ts`, mantendo validações Zod, regras de mercado Futures/Spot/Margin e contratos de erro.
- **Decomposição de rotas de account management de Trading no Integrations Service (07/03/2026):** endpoints avançados de `/api/integrations/trading/account/*` (summary, ledgers, sub-accounts, depósitos, withdrawals, transferências e fees) foram extraídos para `apps/integrations-service/src/routes/trading-account-management-routes.ts`, reduzindo acoplamento do composition root com operações financeiras de conta.
- **Decomposição de rotas de automação de Trading no Integrations Service (07/03/2026):** endpoints `/api/trading/portfolios`, `/api/trading/candidates`, `/api/trading/rebalances`, `/internal/trading/enqueue/*` e `/api/trading/auto/*` foram extraídos para `apps/integrations-service/src/routes/trading-automation-routes.ts`, mantendo semântica assíncrona com idempotency key e rastreabilidade de runs.
- **Decomposição de rotas de histórico de sinais no Integrations Service (07/03/2026):** endpoints `/api/integrations/trading/signals` e `/api/integrations/trading/signals/history*` foram extraídos para `apps/integrations-service/src/routes/trading-signal-history-routes.ts`, preservando filtros avançados, paginação, estatísticas e governança de exclusão lógica/definitiva por escopo.
- **Decomposição de rotas de ação de sinais no Integrations Service (07/03/2026):** endpoints `POST /api/integrations/trading/signals`, `DELETE /api/integrations/trading/signals/:id`, `POST /api/integrations/trading/signals/:id/approve` e `POST /api/integrations/trading/signals/:id/reject` foram extraídos para `apps/integrations-service/src/routes/trading-signal-action-routes.ts`, mantendo aprovação training-only (`neutral/hold`) com geração de dataset e auditoria.
- **Decomposição de rotas de governança de ordens no Integrations Service (07/03/2026):** endpoints de ordens (`/api/integrations/trading/orders*`), auditoria (`/api/integrations/trading/audit/:entityType/:id`) e criação de stop-order (`POST /api/integrations/trading/stop-orders`) foram extraídos para `apps/integrations-service/src/routes/trading-order-governance-routes.ts`, preservando fluxo de revisão/aprovação/rejeição, sync de ordens e integridade do ledger imutável.
- **Decomposição de rota de geração de sinais no Integrations Service (07/03/2026):** endpoint `POST /api/integrations/trading/signals/generate` foi extraído para `apps/integrations-service/src/routes/trading-signal-generation-routes.ts`, mantendo scan de universo de ativos, validações por mercado e resposta padronizada de validação LLM.
- **Decomposição de rotas de datasets no Integrations Service (07/03/2026):** endpoints `GET /api/integrations/trading/datasets*`, `POST /api/integrations/trading/datasets/from-signal` e `PATCH /api/integrations/trading/datasets/:id/review` foram extraídos para `apps/integrations-service/src/routes/trading-dataset-routes.ts`, preservando validação de escopo tenant/namespace, governança de revisão e rastreabilidade de deduplicação.
- **Decomposição de rotas de scheduler/presets no Integrations Service (07/03/2026):** endpoints `/api/integrations/trading/signal-scheduler`, `/api/integrations/trading/analysis-scheduler` e `/api/integrations/trading/news-presets*` foram extraídos para `apps/integrations-service/src/routes/trading-scheduler-news-routes.ts`, preservando validação de mercado, guardrails de arbitragem e aplicação de preset no profile de análise/sinal.
- **Decomposição de rotas Futures no Integrations Service (07/03/2026):** endpoints `/api/integrations/trading/futures/*` e alias legado `/api/integrations/trading/positions/history` foram extraídos para `apps/integrations-service/src/routes/trading-futures-routes.ts`, preservando cobertura completa de ordens, posições, risco, índices e funding com hardening de autenticação KuCoin.
- **Decomposição de rotas Spot no Integrations Service (07/03/2026):** endpoints `/api/integrations/trading/spot/*` foram extraídos para `apps/integrations-service/src/routes/trading-spot-routes.ts`, preservando cobertura de ordens/OCO/stop/fills/mercado e guardrails de configuração KuCoin.
- **Decomposição de rotas Margin no Integrations Service (07/03/2026):** endpoints `/api/integrations/trading/margin/*` foram extraídos para `apps/integrations-service/src/routes/trading-margin-routes.ts`, preservando cobertura de ordens/OCO/borrow/repay/juros/risk-limit/mercado e guardrails de configuração KuCoin.
- **Decomposição de rotas de controle no Integrations Service (07/03/2026):** endpoints de handover/takeover (`GET /api/integrations/trading/control-history` e `POST /api/integrations/trading/control`) foram extraídos para `apps/integrations-service/src/routes/trading-control-routes.ts`, preservando persistência em `trading_control_history` e broadcast de mudança de controle em tempo real.
- **Decomposição de rotas de stop orders no Integrations Service (07/03/2026):** endpoints `GET /api/integrations/trading/stop-orders` e `DELETE /api/integrations/trading/stop-orders/:id` foram extraídos para `apps/integrations-service/src/routes/trading-stop-order-routes.ts`, preservando validações de mercado/símbolo, hardening de configuração KuCoin e semântica de erro existente.
- **Decomposição de rotas de market data no Integrations Service (07/03/2026):** endpoints de `klines`, `orderbook`, `funding-rate`, `mark-price` e `trades` foram extraídos para `apps/integrations-service/src/routes/trading-market-data-routes.ts`, preservando compatibilidade de rotas legadas, resolução de símbolo e hardening de autenticação/configuração KuCoin.
- **Consolidação de histórico de ordens no Integrations Service (07/03/2026):** endpoints `GET /api/integrations/trading/orders/history` e `POST /api/integrations/trading/orders/history/delete` foram removidos do composition root e consolidados em `apps/integrations-service/src/routes/trading-order-governance-routes.ts`, preservando paginação por cursor e exclusão lógica por escopo (`self/tenant`).
- **Decomposição de rotas de validação LLM no Integrations Service (07/03/2026):** endpoints `GET /api/integrations/trading/validations` e `GET /api/integrations/trading/validations/diagnostics` foram extraídos para `apps/integrations-service/src/routes/trading-validation-routes.ts`, preservando filtros por período, agregações SQL e execução com `withTenantContext` para compatibilidade de RLS com PgBouncer.
- **Decomposição de rotas de histórico de análises no Integrations Service (07/03/2026):** endpoints `GET /api/integrations/trading/analysis/history`, `POST /api/integrations/trading/analysis/history/delete` e `POST /api/integrations/trading/analysis/history/purge` foram extraídos para `apps/integrations-service/src/routes/trading-analysis-history-routes.ts`, preservando paginação por cursor, filtros operacionais e governança de exclusão lógica/definitiva.
- **Decomposição de rotas principais de análise no Integrations Service (07/03/2026):** endpoints `GET/PUT /api/integrations/trading/analysis-profile`, `GET /api/integrations/trading/arbitrage/catalog` e `GET /api/integrations/trading/analysis/:symbol` foram extraídos para `apps/integrations-service/src/routes/trading-analysis-routes.ts`, removendo os últimos handlers inline de análise do composition root e mantendo o pipeline determinístico (consenso, técnicas, arbitragem e trade plan).
- **Decomposição de rotas de plataforma no Training Service (07/03/2026):** endpoints `GET /api/training/health`, `/live`, `/ready`, `POST /internal/trading/enqueue/*`, `POST /internal/trading/auto/*` e `GET/PATCH /api/training/system-config` foram extraídos para `apps/training-service/src/routes/training-platform-routes.ts`, mantendo idempotência de fila, governança de configuração e observabilidade operacional.
- **Decomposição de rotas de auditoria no Training Service (07/03/2026):** endpoints `GET /api/training/audit/integrity` e `GET /api/training/audit/high-risk` foram extraídos para `apps/training-service/src/routes/training-audit-routes.ts`, mantendo verificação de integridade de trilha imutável, validação de tenant/autorização e filtros de governança (`action`, `limit`).
- **Decomposição de rotas LoRA/Orchestrator no Training Service (07/03/2026):** endpoints `POST /api/training/lora/activate/:jobId`, `GET/DELETE /api/training/lora/active`, `GET /api/training/gpu-orchestrator/state` e `POST /api/training/gpu-orchestrator/return` foram extraídos para `apps/training-service/src/routes/training-lora-orchestrator-routes.ts`, preservando governança por tenant/escopo e contratos de proxy com o GPU Manager.
- **Decomposição de rotas de runtime no Training Service (07/03/2026):** endpoints `GET /api/training/auto-learning/status`, `GET /api/training/execution-modes`, `GET /api/training/stats` e `GET /api/training/queue/status` foram extraídos para `apps/training-service/src/routes/training-runtime-routes.ts`, preservando indicadores operacionais, políticas de governança e telemetria de filas.
- **Decomposição de rotas de run management no Training Service (07/03/2026):** endpoints `GET /api/training/run/status`, `GET /api/training/run/history` e `DELETE /api/training/run/cancel` foram extraídos para `apps/training-service/src/routes/training-run-management-routes.ts`, preservando governança de tenant, contratos de erro e semântica de cancelamento de jobs.
- **Decomposição de rotas de schedule no Training Service (07/03/2026):** endpoint `POST /api/training/schedule/configure` foi extraído para `apps/training-service/src/routes/training-schedule-routes.ts`, preservando reconciliação por escopo, cálculo de próxima execução e governança de configuração automática.
- **Decomposição de rotas de data review no Training Service (07/03/2026):** endpoint `POST /api/training/data/approve-batch` foi extraído para `apps/training-service/src/routes/training-data-review-routes.ts`, preservando regras de quarentena, validação de escopo tenant/namespace e métricas de revisão.
- **Decomposição de rotas de bulk import no Training Service (07/03/2026):** endpoint `POST /api/training/bulk-import` foi extraído para `apps/training-service/src/routes/training-bulk-import-routes.ts`, preservando validação de escopo tenant/namespace/agent, deduplicação semântica, quality gate e enqueue assíncrono de dedupe/embedding.
- **Decomposição de rotas de webhook no Training Service (07/03/2026):** endpoint `POST /api/training/webhook` foi extraído para `apps/training-service/src/routes/training-webhook-routes.ts`, preservando validação de assinatura (v1/v2), digest do body, nonce anti-replay (Redis/memory fail-closed) e validação de tenant/usuário interno.
- **Decomposição de rotas de dados no Training Service (07/03/2026):** endpoints `POST/GET /api/training/data`, `PATCH /api/training/data/:id/status` e `PATCH /api/training/data/:id/resolve-scope` foram extraídos para `apps/training-service/src/routes/training-data-routes.ts`, preservando governança de escopo, auditoria de mudanças e métricas de review/override.
- **Decomposição de rotas de consulta de jobs no Training Service (07/03/2026):** endpoints `GET /api/training/jobs`, `GET /api/training/jobs/:id`, `GET /api/training/jobs/:id/stream`, `GET /api/training/jobs/:id/promotion-approvals` e `GET /api/training/jobs/:id/audit-trail` foram extraídos para `apps/training-service/src/routes/training-job-query-routes.ts`, preservando stream SSE, governança de aprovações e trilha imutável por tenant.
- **Decomposição de rota de cancelamento de jobs no Training Service (07/03/2026):** endpoint `DELETE /api/training/jobs/:id` foi extraído para `apps/training-service/src/routes/training-job-cancel-routes.ts`, preservando validação de estado terminal, governança de tenant e cancelamento do LoRA vinculado.
- **Decomposição de rota de aprovação de promoção no Training Service (07/03/2026):** endpoint `POST /api/training/jobs/:id/promotion-approval` foi extraído para `apps/training-service/src/routes/training-job-promotion-approval-routes.ts`, preservando lock de concorrência, trilha de auditoria de governança e resumo de aprovações por tenant.
- **Decomposição de rota de rollback no Training Service (07/03/2026):** endpoint `POST /api/training/jobs/:id/rollback` foi extraído para `apps/training-service/src/routes/training-job-rollback-routes.ts`, preservando lock de concorrência, validação de promoção ativa por escopo e trilha de auditoria de rollback.
- **Decomposição de rota de promoção no Training Service (07/03/2026):** endpoint `POST /api/training/jobs/:id/promote` foi extraído para `apps/training-service/src/routes/training-job-promote-routes.ts`, preservando gates de avaliação/aprovação, lock de concorrência por escopo e trilha de auditoria de promoção.
- **Decomposição de rota run/start on-demand no Training Service (07/03/2026):** endpoint `POST /api/training/run/start` foi extraído para `apps/training-service/src/routes/training-run-start-routes.ts`, preservando idempotência por chave, lock de concorrência, enqueue assíncrono e auditoria de governança de início de treino.
- **Decomposição de rota de criação de jobs no Training Service (07/03/2026):** endpoint `POST /api/training/jobs` foi extraído para `apps/training-service/src/routes/training-job-create-routes.ts`, preservando idempotência por chave, lock de concorrência, seleção de dataset, enqueue assíncrono e auditoria de governança, removendo o último endpoint `/api/training*` inline do composition root.
- **Extração de serviços de governança no Training Service (07/03/2026):** responsabilidades de auditoria e aprovações de promoção foram extraídas para `apps/training-service/src/training-governance-audit.ts` e `apps/training-service/src/training-promotion-approvals.ts`, reduzindo acoplamento do composition root e mantendo trilha imutável + métricas de risco sem regressão.
- **Extração de serviço de lifecycle no Training Service (07/03/2026):** responsabilidades de retomada de jobs pendentes pós-restart e cancelamento governado de fine-tuning/LoRA foram extraídas para `apps/training-service/src/training-job-lifecycle.ts`, reduzindo acoplamento do composition root e preservando contratos de erro/concorrência.
- **Extração de serviço de idempotência run-start no Training Service (07/03/2026):** responsabilidades de validação de header idempotente, fingerprint determinístico, lookup/store em Redis e respostas padronizadas de erro foram extraídas para `apps/training-service/src/training-run-start-idempotency.ts`, reduzindo duplicação entre os fluxos `POST /api/training/jobs` e `POST /api/training/run/start`.
- **Hardening de contratos OpenAPI/RBAC no Integrations Service (07/03/2026):** documentação OpenAPI e testes de contrato foram ampliados para cobrir endpoints críticos recém-modularizados de scheduler (`signal/analysis`) e datasets de trading (`stats/list/from-signal/review`), garantindo sincronização entre spec e handlers reais.
- **Ampliação da cobertura OpenAPI/RBAC no Integrations Service (07/03/2026):** contratos e guardrails automatizados passaram a cobrir também rotas críticas remanescentes de `analysis-profile`, `arbitrage/catalog`, `stop-orders`, `market data` (`klines/orderbook/funding-rate/mark-price/trades`), `control/control-history`, `analysis/{symbol}`, `analysis/history/purge` e `validations/diagnostics`, incluindo validação de permissão por método para endpoints GET/PUT no mesmo path.
- **Higienização de imports do Integrations Service (07/03/2026):** imports de módulos de rota e componentes auxiliares foram centralizados no topo de `apps/integrations-service/src/index.ts`, removendo imports espalhados no meio do arquivo e reforçando padrão de composition root auditável.
- **Sincronização documental SSOT (06/03/2026):** revisão detalhada do `README.md` e dos documentos `docs/ARQUITETURA.md`, `docs/INDEX.md`, `docs/SISTEMA-APRENDIZADO.md` e `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md` para refletir a decomposição atual do integrations-service e remover inconsistências de versão/status legados.
- **Decomposição modular do Integrations Service (07/03/2026):** `apps/integrations-service/src/index.ts` foi reduzido para composition root com registro de módulos de rotas (`postmortem`, `demo-trading`, `grafana-github`, `email`, `stripe`, `integration-core`, `integration-registry`, `health-probe`, `wise-account-details`, `wise-balance-and-quotes`, `wise-recipients-transfers`, `wise-card-management`, `wise-card-orders`, `wise-card-secure`, `wise-disputes`, `wise-spend-controls`, `wise-spend-limits`, `wise-verification-kyc`, `wise-sca`, `wise-webhook-management`, `wise-simulation`, `wise-oauth`, `wise-reference`, `wise-webhook`, `twilio-operational`, `twilio-webhook`, `trading-websocket`, `trading-symbol`, `trading-market-risk`, `trading-account-management`, `trading-automation`, `trading-signal-history`, `trading-signal-action`, `trading-order-governance`, `trading-signal-generation`, `trading-dataset`, `trading-scheduler-news`, `trading-futures`, `trading-spot` e `trading-margin`). Helpers de canal Twilio também foram extraídos para `twilio-channel-service.ts` (assinatura + envio). Contratos críticos OpenAPI/RBAC continuam validados por testes de guardrail em `tests/unit/services/integrations-*`.
- **Roteamento Híbrido Enterprise (06/03/2026):** implementado modelo híbrido com política versionável (`system_config` + override por tenant), thresholds (`autoAccept`/`humanReview`), exceções explícitas (`force_namespace`, `require_human_review`, `bypass_transversal_default`) e fila de revisão humana (`/api/llm/hybrid-review-queue`). UI de Namespaces agora exibe a fila de revisão com ação direta de classificação por namespace para fechamento operacional. Fallback clusters retornam `confidence`, recomendação de ação (`auto_tag_candidate` ou `human_review`) e thresholds aplicados. Conhecimento transversal foi formalizado no namespace `default` com bypass por domínio quando necessário.
- **Training Queue Stall Root Cause + Fix (06/03/2026):** investigação completa em produção confirmou que o run não ficava apenas "na fila"; o `gpu-manager` falhava ao subir `gpu-trainer` com `docker compose` por `permission denied` no `.env.prod`. Causa complementar real: o fallback sem `--env-file` ainda parseava `docker-compose.alice.yml` e tentava ler `../.env.prod` por causa de `env_file` de outros serviços. Correção cirúrgica no `gpu-orchestrator`: manter tentativa principal com `--env-file`, fallback sem `--env-file` e fallback final com compose dedicado do trainer (`docker-compose.gpu-training.yml`) quando o erro de permissão persiste. Inclui teste unitário de regressão para garantir retry controlado e sem fallback indevido em erros não relacionados.
- **Training on-demand Threshold Fix (06/03/2026):** correção cirúrgica da causa raiz de `400` no endpoint `POST /api/training/run/start`. O fluxo on-demand estava avaliando dataset com limiar de schedule (`MIN_SCHEDULED_DATASET_SIZE_*`, ex.: full=200) em vez do limiar on-demand (`MIN_ONDEMAND_DATASET_SIZE`, ex.: 10/20). Resultado: requests válidos com dataset suficiente para on-demand eram rejeitados como “Dados insuficientes”. Ajuste aplicado no `training-service` para usar `minOndemandDatasetSize` na avaliação do on-demand, mantendo as regras de schedule inalteradas.
- **Dashboard React #31 Fix (06/03/2026):** causa raiz real identificada no contrato de `/api/audit/recent`: backend passou a retornar `user` como objeto (`{ id, name }`) e tempo em `timestamp`, enquanto o frontend do Dashboard esperava `user`/`time` como string. Isso causava crash global com `Minified React error #31` ao renderizar “Atividade Recente”. Correção cirúrgica no `frontend-service`: normalização defensiva do payload (`user` objeto/string, `timestamp`/`time`, `type`) antes da renderização, preservando compatibilidade com formatos antigo e novo sem alterar workflows de deploy.
- **Hardening Chat/Trading (23/02/2026):** Autenticação interna HMAC unificada entre serviços, GPU trainer sob demanda via profile `gpu-training`, chat sem login não abre WebSocket e exibe aviso, métricas de erro SSE + auto-runs e latência do LLM Gateway observadas em Prometheus.
- **Training Embedding/Dedupe (02/03/2026):** correção da causa raiz de falha no import JSONL com worker assíncrono: escrita de embedding em `training_data` agora usa literal vetorial SQL (`toSql`) com cast correto (`halfvec`/`vector`) e resolução dinâmica do tipo da coluna. Migração `0091_training_data_embedding_1024_halfvec.sql` alinha `training_data.embedding` para `halfvec(1024)` e força reprocessamento assíncrono de embeddings antigos/incompatíveis.
- **Trading Auto Signal Enterprise (03/03/2026):** Auto Engine agora suporta seleção universal de ativos por venue/mercado (multi-seleção + todos os ativos), catálogo dinâmico via `GET /api/trading/auto/assets`, payload normalizado de `autoMix` para análise completa (`scope=all`, todas as modalidades, todos os ativos), e filtro de candidatos por mercado/ativo/intent com métricas de decisão detalhadas. Fluxos `no-trade` deixam de ser classificados como falha operacional.
- **Consolidação total Trading (03/03/2026):** eliminação completa da dualidade `Trading`/`Trading V2` na superfície ativa da plataforma. APIs padronizadas em `/api/trading/*`, rotas internas em `/internal/trading/*`, módulos backend renomeados para `trading/`, filas Redis padronizadas (`alice:trading:*`), client frontend unificado em `services/api/trading.ts`, suíte de testes migrada para `tests/trading/` e migração `0094a_rename_trading_factor_snapshots.sql` para remover sufixo legado `_v2` no snapshot store.
- **Training on-demand Hardening (03/03/2026):** correção de duas causas raiz: (1) frontend de Training passa a enviar sempre `epochs/batch/lr` efetivos para criação de job (valor digitado não é mais ignorado sem `advancedOverride`); (2) start sob demanda do `gpu-trainer` corrigido com `DOCKER_SOCKET_GID` configurável no compose/env, removendo hardcode de grupo e eliminando falha `fetch failed` por indisponibilidade do orquestrador Docker.
- **Chat Runtime Governado por Namespace Profile (02/03/2026):** remoção da lógica legada de perfil hardcoded em SLA/history/routing no `chat-service`. Fluxos `sync`, `stream`, `websocket`, `websocket-media` e `external-channel` agora resolvem knobs em tempo de execução a partir de `namespace_profiles.config` (SLA por canal, orçamento de prompt, threshold de roteamento, prioridade GPU, memória e histórico), com fallback seguro somente quando não houver namespace.
- **Hardening Auto-collect + Guardrails (02/03/2026):** corrigidos três desvios críticos de governança: (1) perfil de corrupção volta a ativar modo `trading` usando detector oficial de comandos de trading (evita falso-positivo em respostas numéricas válidas); (2) sampling determinístico com `conversationId` agora normaliza seed não-hex com SHA-256 antes da projeção para `[0..1]`, preservando a taxa configurada; (3) caps diários com rollback transacional no `chat-service` (tenant/namespace/user) e proteção no helper para não acumular contador acima do limite quando o cap é excedido.

---

## Resumo executivo

- Arquitetura multi-stack modular com 5 stacks independentes e rollback cirúrgico.
- GPU local dedicada ao LLM, embeddings e training; ASR e Vision via OpenAI.
- CI/CD 100% automático (Push → CI → Release → Deploy) com versionamento e cache enterprise.
- Observabilidade completa com Prometheus, Grafana, Loki, Jaeger e Langfuse.
- **Demo Trading enterprise** com simulação realista (Spot/Futures/Margin), balances auditáveis e dados reais de mercado.
- **Post-Mortem Auto-Motivator** automático para posições reais e demo (pipeline CPU → LLM com citedValues).
- **Dataset Generator** automático: post-mortems completos geram datasets de treinamento com status pending.
- **Snapshot Store** para evidências de mercado (entry/exit/candles/orderbook/news) em JSONB comprimido.
- **Botão "Aprovar Demo"** na aba Sinais IA permite converter sinais em ordens Demo (complementar ao "Aprovar" Real).
- **Realtime Trading/Demo**: normalização de chave de assinatura WS para Futures (`marginMode` consistente) no frontend e chat-service, eliminando mismatch de entrega de broadcast.
- **Demo Futures Lifecycle**: endpoints para ajuste de SL/TP, adição de tamanho e fechamento parcial/total, com validação robusta de proteções versus preço de entrada.
- **Demo Trading Multi-ativo**: saldos por moeda via API dedicada (`/api/integrations/demo-trading/balances`) e contabilização por ativo para Spot/Margin (compra/venda com débito/crédito correto por base/quote).
- **Venda por Ativo (Real + Demo)**: ação direta “Vender” a partir da lista de ativos para pré-preencher ticket de ordem sem retrabalho operacional.
- **Ecossistema LLM completo**: LoRA adapters globais (QLoRA) + RAG contextual + Feedback Loop automático para evolução contínua.
- **Segregação enterprise de Training/LoRA por escopo**: inferência automática de `namespace/agent/domain` em todas as fontes, quarentena automática por baixa confiança e trilha de auditoria de overrides.
- **Pipeline universal de Training (sem rota Trading separada)**: endpoint especializado `/api/training/jobs/trading` removido; criação de jobs centralizada em `/api/training/jobs` e on-demand/scheduler unificados por namespace.
- **Binding obrigatório de adapter por contexto**: resolução contextual `agent -> namespace -> base` com política estrita (`LORA_STRICT_BINDING`) em fluxos LLM de integrações e chat.
- **Governança de fallback expandida**: `llm_fallback_logs` enriquecida (serviço, chamada, motivo, namespace/agent, modelo base/resolvido, adapter encontrado), novos endpoints de eventos e clusters semânticos para ação em Namespace.
- **Trading fail-closed obrigatório**: geração de sinais/análises exige `namespace=trading` ativo, agente ativo, dataset aprovado e adapter LoRA ativo; sem fallback para modelo geral em operações de Trading.
- **Training governado por escopo**: aprovação com override controlado (motivo obrigatório), resolução manual de quarentena e seleção inteligente de exemplos por perfil semântico.
- **Observabilidade de governança de escopo**: métricas de quarentena, overrides e resolução manual publicadas no training-service para monitoramento contínuo.
- **Observabilidade LoRA no chat**: métricas `alice_chat_lora_*` integradas em dashboard LLM e alertas de erro/cache para detectar falhas de binding por escopo.
- **Hardening de isolamento de escopo**: suíte de testes unitários cobre isolamento de cache keys e nomes/caminhos de adapters por `namespace/agent` para evitar contaminação cross-scope.
- Status de Integrações no Dashboard/Integrações usa SSOT Prometheus via observability-service.
- OpenAI Vision (Responses API) exibida com status operacional na página Integrações.
- Prepare Infrastructure: preparação SSOT consolidada em sessão SSH única (menos conexões e menos timeouts).
- Página Módulos removida (UI + rotas + claims OIDC).
- Trading API: endpoints `/market`, `/klines` e `/orderbook` aceitam `symbol` via query e usam fallback de símbolo padrão quando ausente.
- Grafana: execução com `user: 472:472` para manter ownership correto em `/opt/alice/data/grafana`.
- Segurança enterprise com hardening de containers, RLS no PostgreSQL e validação Zod em APIs.
- Integração KuCoin auditada e corrigida conforme docs oficiais (auth HMAC v2/v3, time sync, stop orders, WS broadcast via Redis).
- **Order Dialog Enterprise** (Trading Demo + Trading Real): cotação ao vivo com badge “Ao Vivo”, inputs duais (quantidade e USDT com conversão automática bidirecional via contract multiplier), resumo detalhado da ordem antes de confirmar (símbolo, direção, tipo, preço, valor estimado, margem requerida, leverage, SL/TP). UX alinhada com exchanges reais (KuCoin).
- Trading UI: chamadas REST bloqueadas quando símbolo não está definido (evita 404 e tela “Algo deu errado”).
- Trading UI: histórico de ordens evita chamadas duplicadas e loop de retry ao alternar para a aba Histórico.
- Integrações UI: tipagem i18n alinhada para interpolação (build frontend sem erro TS2554).
- Trading multi‑timeframe: perfis persistidos (analysis/signal), consenso por maioria, seleção dinâmica de indicadores e fontes.
- Suporte/Resistência explícito na UI com toggle e explicação detalhada por timeframe.
- Sinais IA exibem contexto multi‑timeframe, consenso e explicações (inclui dataset pronto para aprovação).
- Sinais IA agora exibem tipo de operação, duração, TP/SL, RR, motivadores e invalidações (resumo executivo no UI).
- Análise técnica passa a retornar plano determinístico com operação, duração, TP/SL, RR e motivadores no painel.
- Geração de sinais com LLM usa orçamento seguro de tokens (prompt truncado e max_tokens ajustado ao contexto).
- Sinais com notícias: estimativa de tokens mais conservadora (regex + densidade) evita overflow de contexto.
- Trading: dados de mercado (ticker/orderbook/klines/trades) 100% real-time via WebSocket — sem polling REST (Regra 6).
- Trading: budget de prompt com margem conservadora evita erro 400 por contexto > 4096 tokens.
- Chat/Trading: WebSocket do frontend alinhado com `/ws/chat` (rota correta no chat-service).
- Trading: reparo de JSON mais robusto (aspas internas + string incompleta) evita falhas na geração de sinais.
- Sinais IA: normalização de chaves JSON do LLM (sem aspas) reduz falhas de parse.
- Sinais IA: reparo adicional para respostas YAML-like (linhas com "- key:") evita erro de parse.
- Sinais IA: reparo extra para YAML-like sem chaves (blocos key: value) garante JSON válido sem retry.
- Trading: arbitragem triangular agora suporta multi‑exchange com top 3 rotas e network fees por ativo.
- Trading: catálogo de arbitragem fornece exchanges, ativos intermediários e feePct efetivo via API KuCoin.
- Trading: UI de arbitragem com dropdown multi‑select (exchanges/ativos) + limite de 30 ativos.
- Trading: seleções múltiplas (timeframes/indicadores/técnicas/fontes) agora usam dropdown com scroll nas abas Análise e Sinais IA.
- Sinais IA: histórico inline com paginação, ordenação e filtros por data/tipo/status (validação/aprovação).
- Build Frontend: correção de referências ausentes em Sinais IA e Arbitragem evita falha no release.
- Sinais IA: correção de i18n no histórico (removida duplicidade de chaves).
- Trading: dropdown multi‑select mantém seleção aberta e salva automaticamente.
- Trading: limpar seleção permite zerar timeframes/indicadores/técnicas para reconfigurar do zero.
- Sinais IA: reparo JSON mais robusto (valores single‑quote/bare) no parser LLM.
- Trading: guarda contra símbolo inválido ao trocar marketType (evita 400 em market/klines/orderbook).
- Trading: histórico de Sinais IA e Análises agora abre detalhe completo ao clicar na linha.
- Sinais IA: resposta LLM agora é normalizada com base em análise determinística quando faltam campos críticos.
- Análises: histórico suporta marketType/marginMode (Spot/Margin) sem erro 400.
- Trading: feePct é automático (maior entre exchanges) e aplicado em análise/sinal.
- Proxy (Caddy): timeout dedicado para `/api/integrations/trading/analysis*` evita 502 em arbitragem pesada.
- API Gateway (dev): timeouts long‑running para trading/LLM alinhados com Caddy e integrations-service.
- Análise: rota `/analysis/history` não conflita com `/analysis/:symbol` (sem “history” como símbolo).
- Trading: timeout do integrations-service ajustado para 180s (reduz 502 por EOF em sinais longos).
- Trading: histórico com purge definitivo admin (limpa sinais/análises + validações e desvincula ordens/schedulers).
- Análise: guard explícito evita erro com “history” e bloqueia lista vermelha na UI.
- Presets de notícias: edição completa e salvamento ao lado de Salvar/Gerar (Análise + Sinais IA).
- Deploy: migration `0049_trading_llm_validation_details.sql` agora calcula contagem de chaves JSONB via `jsonb_object_keys` (compatível com PostgreSQL).
- Sinais IA: reparo de chaves JSON não-quotadas agora aceita qualquer key (inclui `citedValues`) e reduz falhas de parse.
- Sinais IA: diagnóstico de validações LLM usa contagem de chaves JSONB compatível com PostgreSQL.
- Observability: limites de Prometheus/ClickHouse/OTel ajustados para usar melhor CPU/RAM e evitar throttling.
- SearXNG: engines ahmia/torch removidas para eliminar ruído; Tor mantido para deep web sob demanda.
- Chat: correção do upgrade WS evita crash por double handleUpgrade.
- Timezone: configuração regional do usuário persiste no PostgreSQL e UI usa timezone do perfil (fallback America/Sao_Paulo).
- Trading: histórico de sinais evita loop de render e re-fetch contínuo em filtros/paginação.
- Observability: logs do frontend enviados com JSON válido (sendBeacon com content-type correto).
- Trading: histórico de análise evita loop de render em filtros/paginação (dedupe + guards).
- Trading: WS orderbook usa depth mínimo disponível e dedupe por sequência.
- Trading: WS ticker dedupado por assinatura (menos re-render).
- Trading: REST orderbook limitado a depth 20 (limite oficial KuCoin); WS mantém máximo 50.
- Trading: extração de JSON balanceada evita truncamento por chaves em texto.
- Trading: logging explícito de notícias confirma uso de SearXNG na análise.
- Trading: presets de notícias com CRUD (criar, editar e excluir) direto nas abas Análise e Sinais IA.
- Chat: headers SSE enviados antes de qualquer `res.write` (corrige ERR_HTTP_HEADERS_SENT no modo agentic).
- Proxy (Caddy): timeouts dedicados para `/api/chat/stream` e `signals/generate` evitam 502 em LLM lento.
- Trading: notícias usadas exibidas na Análise (consulta + links) quando habilitado.
- Trading: detalhes do Sinal IA agora exibem notícias usadas na geração quando habilitado.
- Sinais IA: parsing robusto de JSON do LLM com reparo seguro e prompt de saída estrito.
- Roteamento de agentes: gatilhos configuráveis no Modo Agentic (manual/auto) por tenant.
- Chat: seleção manual de agentes no UI com persistência por conversa e envio no stream.
- Roteamento agentic: normalização de comandos (acentos/@) e detecção consistente no WebSocket.
- Roteamento stream: validação defensiva do insert do assistente evita messageId indefinido.
- LLM Trading: erros de validação sem duplicação de prefixo (mensagem mais limpa).
- Roteamento WS: comando manual aparece no chat sem refresh.
- LLM Trading: mensagens pós-reparo sem duplicação de prefixo.
- Roteamento manual: match de agentes evita falsos positivos por substring.
- Roteamento manual: slugs normalizados vazios são ignorados no lookup.
- Notícias Trading: configuração de termos/engines do SearXNG persistida em perfil e editável na UI (Sinais + Análise).
- RAG Web Search: suporte a engines, categorias, idioma e SafeSearch por requisição (integração SearXNG ajustável).
- Presets de notícias: presets principais salvos no banco e aplicáveis no perfil de Sinais/Análise.
- Notícias Trading: time range configurável (day/week/month/year) e datas opcionais em templates.
- Notícias Trading: seleção rápida para última hora/24h e modo personalizado.
- Notícias Trading: normalização de templates evita array vazio e crash em runtime.
- Training: datasets de trading com aprovação dedicada e fluxo manual via sinal → dataset.
- Trading: correção da ordem de hooks para evitar React error #310 na página de Trading.
- Modo Agentic: criação de `conversation_states` agora é UPSERT idempotente (elimina erro 23505).
- Chat streaming: resposta de erro clara quando falha antes de enviar headers (evita 502 silencioso).
- Agentic settings: detectores default persistidos quando `detectors` está vazio no banco.
- LLM Trading: normalização de campos numéricos e arrays reduz falhas de parse e validação.
- Training: webhook com deduplicação semântica (semhash + cosine) e auditoria de duplicados.
- CI: reordenação de enums/schemas de trading evita uso antes da declaração.
- Lint: remoção de import não usado na página Trading (zero warnings).
- Trading Chart: novo renderer com lightweight-charts (visual moderno e performance).
- Trading multi‑market: favoritos/destaques por usuário, pares em destaque no seletor e troca de símbolo no gráfico.
- Trading Chart: timeframes responsivos sem overflow horizontal e gráfico com layout estável (sem distorção).
- Trading Chart: troca de intervalo limpa klines e recarrega histórico via REST (dados real-time via WS, sem polling).
- SearXNG News: integração corrigida com headers internos assinados (401 removido em Sinais IA e Análise).
- Trading Risk Config: normalização de valores decimais (vírgula → ponto) e payload consistente para evitar erro "Dados inválidos" ao salvar.
- Agentic Trading: prompts com exemplos e boas práticas no Modo Agentic; parser de chat agora reconhece análise técnica e sinais IA com timeframes e fontes de dados.
- Trading UI: painéis de Sinais IA e Análise unificados (perfil + execução + scheduler) e scheduler usa timeframes do perfil multi-timeframe.
- KuCoin rate limit: retry/backoff respeita `Retry-After` e `gw-ratelimit-reset` (ms) conforme docs oficiais.
- Deploy: migration `0043_trading_symbol_preferences.sql` deve ser aplicada no próximo deploy.
- Trading i18n: chaves de `trading.symbols` alinhadas entre PT-BR e EN (labels corretos no seletor).

---

## Visão geral da plataforma

- Arquitetura: Multi-Stack Modular (5 stacks independentes).
- Servidor: Hetzner GEX44 (Intel Core i5-13500 14 Core, 64GB DDR4 RAM, 2x 1.92TB NVMe SSD RAID 1, RTX 4000 Ada 20GB).
- SO: Ubuntu 24.04.3 LTS.
- Docker: 29.1.3 + Compose v5.0.0.
- Domínio: yesyoudeserve.duckdns.org.
- IP produção: 178.63.41.108.
- LLM (texto): Qwen2.5 7B Instruct (AWQ) via GPU Manager.
- Vision (análise de imagens): OpenAI Responses API (`gpt-4.1`).
- Geração de imagens: OpenAI Images API (`gpt-image-1`).
- Storage: Volume local Hetzner (sem S3 externo).

---

## Arquitetura Gate 2 (GPU + OpenAI)

- GPU local: LLM (texto) e embeddings (texto) always-on; training sob demanda.
- Vision e geração de imagens: OpenAI (sem VLM local).
- GPU Manager Service: fila priorizada, monitoramento VRAM, circuit breakers e métricas Prometheus.
- Budget VRAM: 20GB com serviços simultâneos.

---

## Stacks e serviços

### Stack INFRA

- PostgreSQL 16 + pgvector.
- PgBouncer.
- Redis (cache).
- Qdrant (texto 1024 dim).
- Caddy (API Gateway + SSL + HTTP/3).
- MinIO (S3 interno para Langfuse).
- SearXNG + Tor (JSON habilitado para integração Agentic).

### Stack ALICE

- Frontend (React + Vite).
- Auth Service (OAuth, SAML, OIDC).
- Biometrics Service (login/enroll/verify).
- Chat Service (WebSocket + streaming LLM).
- LLM Gateway Service (rota/contexto namespace/agente; opcional quando `LLM_GATEWAY_URL` configurado).
- RAG Service (pgvector + embeddings).
- Training Service (auto-learning + fine-tuning).
- Integrations Service (Stripe, Wise, Twilio, Gmail SMTP, KuCoin, OpenAI Vision status).
- Observability Service (health + backups).
- GPU Manager Service.

### Stack GPU (local)

- `gpu-llm`: Qwen2.5 7B (vLLM).
- `gpu-embeddings`: Qwen3-Embedding-0.6B INT8 (texto).
- `gpu-trainer`: QLoRA sob demanda (profile).

### Stack OBSERVABILITY

- Prometheus, Grafana (Alerting), Loki, Jaeger, Langfuse, ClickHouse, OTel Collector, Vector, Node Exporter, cAdvisor.



### Stack BACKUP

- pgBackRest (PITR, incremental, AES-256).
- pgBackRest Exporter (métricas Prometheus porta 9854).

---

## Serviços Alice (apps/)

- `frontend-service`: React 19 + Vite 7.3 + i18n PT-BR/EN.
- `auth-service`: OAuth 2.0, SAML 2.0, OIDC Provider, RBAC 6 níveis, sessões PostgreSQL.
- `biometrics-service`: biometria (login, enroll, verify).
- `chat-service`: WebSocket, streaming LLM, RAG client, takeover/handover, comandos de trading.
- `llm-gateway-service`: gateway LLM (resolução rota/contexto namespace/agente; chat e integrations podem usar quando `LLM_GATEWAY_URL` configurado).
- `rag-service`: upload multimodal, embeddings texto GPU, fila assíncrona, WebSocket de embeddings.
- `training-service`: scheduler, fine-tuning QLoRA, SemHash.
- `observability-service`: health checker, backup orchestrator, métricas.
- `api-gateway` Node.js: apenas dev local (Caddy em produção).

---

## Banco de dados (PostgreSQL 16 + pgvector)

### Schema Core

- `sessions`, `tenants`, `users`, `permissions`, `role_permissions`, `oauth_clients`, `oauth_authorization_codes`, `oauth_tokens`, `oidc_payloads`, `oidc_jwks`, `feature_flags`, `assistant_settings`.

### Schema Chat

- `conversations`, `messages`, `conversation_states`, `conversation_participants`, `conversation_escalations`.

### Schema RAG

- `namespaces`, `agents`, `documents`, `document_chunks`.

### Schema Training

- `training_data`, `fine_tuning_jobs`, `model_versions`, `auto_learning_schedule`.

### Schema Integrations


### Schema Media

- `generated_images`, `media_uploads`.

### Schema Trading

- `trading_signals`, `trading_orders`, `trading_positions`, `trading_risk_config`, `trading_audit_log`, `trading_market_data`, `trading_dataset`, `lora_jobs`.

### Schema Demo Trading + Post-Mortem (migration 0056)

- `demo_balances` — saldo simulado por tenant (USDT, auditável).
- `demo_fund_history` — histórico de adição de fundos e créditos/débitos de PnL.
- `demo_orders` — ordens simuladas (market/limit/stop) com metadata JSONB (SL/TP).
- `demo_positions` — posições demo com margem, leverage e PnL calculado.
- `trading_snapshots` — snapshots de mercado (kinds: market_entry, market_exit, candles, orderbook_top, news, evidence_pack) com dados comprimidos.
- `trading_postmortems` — análises pós-fechamento com classificação CPU + motivadores LLM, fingerprint idempotente.
- `trading_dataset` — datasets gerados a partir de post-mortems completos, com status 'pending' para aprovação.

---

## Demo Trading

- **Mercados suportados**: Spot, Futures (com leverage), Margin.
- **Execução simulada** usando dados reais de mercado via KuCoin API.
- **Fees realistas**: maker 0.02%, taker 0.06%, slippage 3 bps.
- **Balances auditáveis**: histórico completo de adição de fundos e PnL.
- **Scheduler automático**: verifica ordens limit/stop e posições para auto-close (SL/TP/liquidação).
- **Integração Post-Mortem**: toda posição fechada gera post-mortem automaticamente.
- **Frontend**: página `/demo-trading` com abas (Visão Geral, Ordens, Posições, Histórico, Post-Mortems).
- **Sinais IA**: botão "Aprovar Demo" na aba Sinais IA converte sinal em ordem Demo.

## Post-Mortem Auto-Motivator

- **Trigger automático**: executa no fechamento de TODA posição (real e demo).
- **Pipeline two-phase**:
  - Phase 1 (CPU): classificação determinística — tradeStyle, archetype, strategy, techniqueScores, evidence pack.
  - Phase 2 (LLM): motivadores explicativos com citedValues, fatores de sucesso/falha, lições aprendidas.
- **Idempotência**: fingerprint SHA-256 de positionId + timestamps + fillsHash + engineVersions.
- **Fila Redis**: Sorted Set com retry exponencial (3 tentativas), DLQ para falhas persistentes.
- **Quotas**: limites diários de chamadas LLM por tenant (Phase 2).
- **Métricas Prometheus**: `alice_postmortem_jobs_total`, `alice_postmortem_job_duration_seconds`, `alice_postmortem_queue_size`, `alice_postmortem_dlq_size`.

## Dataset Generator

- Geração automática de datasets de treinamento a partir de post-mortems completos (status=completed + snapshots).
- Schema padronizado: marketContext, tradeExecution, autoAnnotation, prompt (system + user), expected response.
- Datasets criados com status 'pending' para aprovação manual na página Training.
- sourceType: 'postmortem' com sourceMetadata detalhado (isDemo, fingerprint, engineVersions).

## Ecossistema LLM (LoRA + RAG + Feedback Loop)

- **LoRA Adapters Globais**: Adapter trading único (`trading-global`) treinado via QLoRA, compartilhado entre tenants.
  - Ativação automática após aprovação de job de treinamento.
  - vLLM v0.12.0+ com suporte AWQ + LoRA (`--enable-lora`, `--max-lora-rank 16`).
  - Adapter armazenado em `/opt/alice/data/lora-adapters/trading-global` (volume Docker read-only).
  - Cache Redis com TTL 60s para resolver modelo com/sem adapter ativo.
  - Fallback para modelo base (`Qwen/Qwen2.5-7B-Instruct-AWQ`) quando adapter não disponível.
- **RAG Contextual para Trading**: Busca semântica em documentos de estratégia e learnings anteriores.
  - Enriquece geração de sinais IA com contexto de namespace do agente trading.
  - Enriquece post-mortem Phase 2 com learnings de trades similares.
  - Threshold de similaridade 0.6, máximo 3 documentos por query.
  - Non-blocking: falha no RAG não bloqueia geração de sinal nem post-mortem.
- **Feedback Loop Automático**: Post-mortems completos são indexados automaticamente no namespace RAG.
  - Documento estruturado com motivadores, lições, fatores de sucesso/falha.
  - Dedup por source (`postmortem:{id}`), 409 tratado como sucesso.
  - Futuras gerações de sinais e post-mortems se beneficiam dos learnings acumulados.
- **Métricas Prometheus**:
  - `alice_lora_resolve_total{result}`: resoluções de modelo (adapter/base/error).
  - `alice_lora_resolve_duration_seconds`: latência de resolução.
  - `alice_lora_cache_total{status}`: cache Redis hit/miss/error.
  - `alice_trading_rag_query_total{type,result}`: consultas RAG (signal/postmortem).
  - `alice_trading_rag_query_duration_seconds{type}`: latência de consultas RAG.
  - `alice_trading_rag_index_total{result}`: indexação de learnings (success/error).
- **API Training Service**:
  - `POST /api/training/lora/activate/:jobId`: ativa adapter de job treinado.
  - `GET /api/training/lora/active`: consulta adapter ativo.
  - `DELETE /api/training/lora/active`: desativa adapter ativo.
- **Dashboard Grafana**: Painéis no Trading Dashboard para LoRA (resolução, latência, cache) e RAG (consultas, feedback loop).

## Snapshot Store

- **Tabela**: `trading_snapshots` com JSONB comprimido via TOAST automático do PostgreSQL.
- **Kinds suportados**: `market_entry`, `market_exit`, `candles`, `orderbook_top`, `news`, `evidence_pack`.
- **Captura automática**: `captureEntrySnapshot()` na abertura e `captureExitSnapshot()` no fechamento.
- **Dados capturados**: ticker (preço, bid/ask, volume), orderbook top (bids/asks), candles recentes (1m, 3m, 5m, 15m, 1h).
- **Referências**: posições demo e reais mantêm `entrySnapshotId` e `exitSnapshotId` para rastreabilidade.

## API Endpoints — Demo Trading + Post-Mortem

### Demo Trading (integrations-service)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `GET` | `/api/integrations/demo-trading/balance` | Balance atual do tenant |
| `POST` | `/api/integrations/demo-trading/funds` | Adicionar fundos auditáveis |
| `GET` | `/api/integrations/demo-trading/funds/history` | Histórico de movimentações |
| `POST` | `/api/integrations/demo-trading/orders` | Criar ordem (market/limit/stop) |
| `POST` | `/api/integrations/demo-trading/orders/from-signal` | Criar ordem a partir de sinal IA |
| `GET` | `/api/integrations/demo-trading/orders` | Listar ordens |
| `DELETE` | `/api/integrations/demo-trading/orders/:id` | Cancelar ordem pendente |
| `GET` | `/api/integrations/demo-trading/positions` | Listar posições |
| `POST` | `/api/integrations/demo-trading/positions/:id/close` | Fechar posição |

### Post-Mortem (integrations-service)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `GET` | `/api/integrations/postmortem/:positionId` | Post-mortem por posição |
| `GET` | `/api/integrations/postmortem` | Listar post-mortems (filtro `isDemo`) |
| `GET` | `/api/integrations/postmortem/queue/stats` | Estatísticas da fila Redis |
| `POST` | `/api/integrations/postmortem/queue/retry/:jobId` | Reprocessar job da DLQ |
| `GET` | `/api/integrations/postmortem/snapshots/:positionId` | Snapshots de uma posição |
| `POST` | `/api/integrations/postmortem/send-to-training` | Enviar post-mortem para dataset |
| `POST` | `/api/integrations/postmortem/send-to-training/batch` | Enviar batch para dataset |

### Sinais IA (integrations-service)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `POST` | `/api/integrations/trading/signals/generate` | Gerar sinal via LLM (com RAG + LoRA) |
| `GET` | `/api/integrations/trading/signals` | Sinais pendentes |
| `POST` | `/api/integrations/trading/signals/:id/approve` | Aprovar sinal (ordem real) |
| `POST` | `/api/integrations/trading/signals/:id/reject` | Rejeitar sinal |
| `GET` | `/api/integrations/trading/signals/history` | Histórico de sinais |
| `POST` | `/api/integrations/trading/datasets/from-signal` | Criar dataset a partir de sinal |

### LoRA Adapter Management (training-service)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `POST` | `/api/training/lora/activate/:jobId` | Ativar adapter de job concluído |
| `GET` | `/api/training/lora/active` | Consultar adapter ativo |
| `DELETE` | `/api/training/lora/active` | Desativar adapter ativo |

---

## Observabilidade

- Prometheus 3.8.1 e Grafana 12.3.2 com Grafana Alerting (Alertmanager removido).
- Dashboards principais: Home, Services, LLM Metrics, RAG Metrics, Integrations, Infrastructure, Training, Training Pipeline, Backup, **Demo Trading + Post-Mortem**, **LoRA + RAG Ecosystem**.
- Dashboard Demo Trading: ordens por tipo de mercado, posições profit/loss, fila post-mortem, DLQ, latência P50/P95/P99.
- Loki/Promtail 3.6.3 e Jaeger 2.13.0 (OTLP habilitado).
- Langfuse v3 com worker e ClickHouse 25.12-alpine.

---

## CI/CD

- Pipeline: Push → CI → Release → Deploy.
- Workflows: `ci.yml`, `release.yml`, `deploy-stack-modular.yml`.
- Funções compartilhadas: `scripts/release-functions.sh` (build/retag) e `infra/scripts/deploy-functions.sh` (pull/credentials) — CLAUDE.md Regra 2.
- CI valida todos os 8 microsserviços Node.js incluindo gpu-manager-service (express hardening + server timeouts).
- Release: 16 imagens Docker (13 microservices + 3 GPU), build condicional com retag inteligente, smoke test PostgreSQL + pgvector com trap cleanup.
- Deploy: Smart Pull com `pull_if_needed()` centralizada e `pull_with_retry()` consistente (5 tentativas, backoff progressivo 15/30/60/90/120s; Redis com connectTimeout 10s e 10 tentativas de reconexão — 11/02/2026).
- Cache enterprise: BuildKit/registry cache, pnpm cache e pip cache.
- Rollback cirúrgico por stack.
- Versionamento semântico automático via Conventional Commits.

---

## Segurança

- Hardening de containers: `no-new-privileges`, `read_only` quando aplicável, limits em 100% dos serviços.
- Validação Zod em endpoints e parâmetros críticos.
- RLS aplicado nas tabelas de trading.
- Secrets obrigatórios validados no deploy (fail-fast).
- TLS automático via Caddy (ZeroSSL primário + Let's Encrypt fallback).

---

## Capacidades de IA

- Chat e trading via LLM local (Qwen2.5 7B AWQ).
- Vision e geração de imagens via OpenAI (gpt-4.1 / gpt-image-1).
- Embeddings texto: Qwen3-Embedding-0.6B INT8 (1024 dim) → Qdrant.
- Imagem: OpenAI Vision (descrição textual, sem embeddings de imagem).
- ASR: OpenAI gpt-4o-transcribe.
- Busca de imagens na web via SearXNG (sem embeddings de imagem; armazenamento no RAG com descrição textual).

---

## Limites de mídia e compatibilidade OpenAI

- Upload de imagem (RAG/chat): **10 MB** por arquivo.
- Upload de áudio (ASR): **25 MB** por arquivo.
- Upload de documento (RAG): **50 MB** por arquivo.
- Busca de imagens web (download externo): **8 MB** por imagem.
- OpenAI Vision (gpt-4.1): aceita até **50 MB** de payload total por request (limite interno é 10 MB por imagem).
- OpenAI ASR (gpt-4o-transcribe): **25 MB** por arquivo (limite interno alinhado).
- Geração de imagens (gpt-image-1): prompt textual (sem imagem de entrada). Saída armazenada no RAG com anexos e descrição via Vision.

---

## Backups

- PostgreSQL: pgBackRest (full + incremental + WAL).
- Redis: RDB snapshots.
- Manifestos JSON por job.

### Schedule padrão

```text
Full Backup:        0 3 * * 0
Incremental Backup: 0 3 * * 1-6
Retenção Full:      15 dias
Retenção Incremental: 7 dias
Retenção Arquivo:   30 dias
```

---

## Atualizações recentes (resumo)

- Trading Sinais: orçamento de tokens mais conservador para prompts com notícias (evita erro 4096).
- Trading Sinais: parsing robusto do JSON do LLM com reparo seguro de strings inválidas.
- Agentic Routing: termos manual/auto configuráveis no Modo Agentic (`detectors.agentRouting.*`).
- Agentic Routing (stream): validação do insert do assistente antes de atualizar contadores.
- LLM Trading: mensagem de erro de schema sem duplicação de prefixo.
- Agentic Routing (WS): envio da mensagem do usuário no fluxo command-only.
- LLM Trading: erro pós-reparo sem duplicação de prefixo.
- Agentic Routing: match por palavra inteira evita slug curto (ex.: "ai") em palavras maiores.
- Agentic Routing: slugs inválidos não entram no mapa de lookup.
- Users Admin: modal de criação/edição com altura fixa e scroll interno garantido.
- Galeria de Imagens: download usa extensão correta conforme MIME/URL da imagem.
- UI: modais com conteúdo já rolável agora usam um único scroll interno (sem conflito entre áreas).
- Galeria de Imagens: listagem unificada inclui imagens geradas e uploads (inclui web search).
- Conversas: mensagens com imagens/anexos não aparecem na página de histórico/seleção.
- Chat Service: endpoint `/api/chat/images` agora consolida geração + uploads de imagem.
- Configurações: fuso horário persistido aparece corretamente no seletor.
- UI: diálogos com altura máxima e scroll consistente em todas as páginas.
- Conversas: conversa ativa destacada e mensagens normalizadas na página `/conversations`.
- Dashboard: cards clicáveis para navegação direta às páginas relacionadas.
- Imagens: galeria com fallback de preview e tratamento de erro de listagem.
- Dashboard: SLA metrics resilientes a timestamps retornados como string.
- Trading: modal de Configurações de Risco com scroll funcional em toda a altura.
- Conversas: nova página `/conversations` com filtros por período e seleção em lote.
- Conversas: envio para treino por conversa inteira ou por mensagens selecionadas.
- Chat: seleção de mensagens com envio em lote via training batch.
- Dashboard: clique no gráfico semanal redireciona para `/conversations` filtrado por dia.
- Dashboard: tokens de LLM agora persistidos em mensagens (stats/usage com valores reais).
- Dashboard: clique no gráfico semanal abre chat filtrado por data.
- Chat: admins veem conversas de todos os usuários do tenant; super_admin global liberado.
- Chat: envio para training aceita namespace da conversa quando não selecionado.
- Agentic: detectores configuráveis por tenant (keywords/regex) no Modo Agentic.
- ASR: normalização de MIME para evitar erro `unsupported_format` em `audio/webm;codecs=opus`.
- ASR: gravação converte áudio para WAV quando formato não é aceito pelo OpenAI.
- ASR: retry automático sem stream quando OpenAI falha com stream (transcrição estável).
- Vision: logs detalhados de erro da OpenAI para diagnóstico preciso.
- Imagens: mensagens recuperam imagens geradas via metadata (evita mensagem vazia no chat).
- Imagens: resposta de geração agora inclui conteúdo padrão para não exibir bolha vazia.
- Web: busca de imagens na web via SearXNG com envio direto no chat (sem embeddings de imagem).
- Dashboard: takeover/SLA/circuit breakers/conversas semanais agora com dados reais do backend.
- Users Admin: modal de edição com rolagem, senha redefinível e colunas de grupos/nome preferido.
- Namespaces: contagem real de agentes/docs e detalhes clicáveis no card.
- Observability: alertas Grafana com fallback de no-data para evitar falsos positivos (LLM/RAG/GPU).
- Observability: histogram_quantile protegido contra NaN (filtro de buckets) para evitar DatasourceNoData.
- Chat: efeito de digitação agora avança 1 caractere por tick e suporta até 400ms.
- Frontend: correção de build (variável não utilizada em AliceConfig).
- Frontend Trading: correção de build (statusData antes de uso, ticker via market/ws, intervalOptions no painel técnico).
- Frontend Trading: modal de Configurações de Risco com scroll habilitado (altura fixa no dialog + ScrollArea com altura total).
- Chat: UX de digitação incremental com "Pensando..." i18n e velocidade configurável imediata.
- Frontend: formatação numérica e monetária agora respeita o locale do usuário em cards e tabelas.
- Trading: preços/volume/ordens usam locale do usuário (OrderBook e Candles incluídos).
- Frontend: correção de build para timestamp numérico e escopo de locale/timezone no Training.
- Frontend: JobCard recebe locale/timezone para evitar erro de build no Training.
- Auth: novos usuários OAuth/SAML/registro local agora entram como `guest` (Convidado).
- Users Admin: criação de usuário via dashboard (admin-only) com dados obrigatórios e roles iniciais.
- Users Admin: edição completa com preferências, roles, grupos e validação obrigatória de perfil.
- RBAC: admin/super_admin podem editar outros usuários; usuários comuns apenas a si mesmos.
- Auth: registro local protegido por CSRF + admin-only (sem cadastro público).
- Auth: evento de provisioning SAML agora usa fallback `guest` (consistente com OAuth/local).
- RBAC: resolveHighestRole não usa fallback quando roles existem (permite downgrade).
- Stack Ops: validação de versão persistida no histórico da conversa (mensagem salva + contadores).
- Agentic: confirmação respeita approvalPolicy novamente (sem bypass).
- Deploy: diagnóstico rápido (tail) é exibido na tela antes do artifact.
- Integrations: variáveis KuCoin orderbook (WS/REST) exigidas quando KuCoin ativo.
- Timezone: containers em UTC; UI/Chat usam timezone do usuário com default `America/Sao_Paulo`.
- Users Admin: atualização de roles/grupos agora é transacional (sem perda parcial).
- Auth: buildAuthContext propaga customRoleId para headers internos.
- Chat: fallback de role agora usa `guest` (evita ROLE_HIERARCHY inválido).
- Frontend: corrigidos erros de build (AgenticConfig null-safe, ordem de dependências no Chat, Checkbox UI e Users Admin).
- Frontend: Tabs de Usuários agora tipam corretamente o onValueChange.
- UX: textos didáticos reforçados em Dashboard, Integrações, Trading, Observability e Agentic.
- Agentic: fallback determinístico quando busca web falha mesmo com request explícito.
- Stack Ops: operações via GitHub Actions exigem confirmação explícita (action_requests).
- Modo Agentic: configuração por tenant (toggles + links) com persistência PostgreSQL.
- GitHub Actions: disparo de deploy/rollback via integrations-service com token seguro.
- Chat: foco persistente no input ao abrir novas conversas e selecionar histórico.
- Caddy: ACME resiliente com DNS precheck, DNS-01 DuckDNS e fallback ZeroSSL.
- Caddy: emissor ACME ajustado para sintaxe compatível no Caddyfile (dir + email global + eab inline).
- Grafana: regras de alerta ajustadas para evitar `DatasourceNoData` falso (bool + fallback 0/1).
- Grafana: alerta de restart filtrado por containers Docker Compose (sem slices do host).
- DB: migration `action_requests` agora aplica FKs completos (tenant/conversation/user/agent/resolved_by).
- OAuth GitHub: suporte a OAUTH_GITHUB_\* e fallback para GITHUB_\* legado.
- Docs: `SECRETS.md` atualizado com Redis cache/queue, MinIO e CORS.
- Frontend: normalização de line endings (CRLF → LF) em componentes de mídia do chat.
- Chat UI: mensagens somente com mídia agora ficam realmente sem fundo (bg transparente).
- Métricas: LLM tokens (prompt/gerados) instrumentados no chat-service.
- Métricas: relevância RAG emitida no chat-service por tenant quando há fontes.
- Grafana: UIDs de dashboards ajustados para não conflitar com folderUid.
- OAuth Google: callbackURL alinhado com config e suporte a path com trailing slash.
- OpenAI Images: payload padronizado (gpt-image-1 + output_format=png) com retorno `b64_json`.
- Agentic: política de aprovação por conversa (sempre confirmar / aprovar tudo neste chat).
- Agentic: confirmação persistida para ações críticas de trading (action_requests).
- Admin: formulário de roles customizadas aceita slug vazio e gera automaticamente.
- Chat: confirmação de nome ignora negativas explícitas do usuário.
- Chat UI: paste de imagem (Ctrl+V) anexa automaticamente no input.
- Chat UI: avatar do usuário maior e cores de mensagens alinhadas às da Alice.
- Chat UI: remoção dos cartões de sugestão no “Novo Chat”.
- Chat mídia: preview imediato preserva blob URL até upload confirmar.
- Chat mídia: limpeza de blob URL após upload concluído (media_uploaded).
- Configurações regionais: timezone, idioma da Alice e local (país/cidade) configuráveis no dashboard e persistidos em PostgreSQL.
- Chat: SERVER_TIME agora usa timezone do usuário em todos os fluxos (REST, stream e WebSocket).
- Frontend: datas e horários agora respeitam idioma/timezone do usuário em listas e cards.
- RAG: timeout configurável por env (RAG_REQUEST_TIMEOUT_MS).
- Agentic web: busca web forçada quando o usuário pedir explicitamente (sem aprovação).
- Web/Deepweb: SearXNG com Tor via Ahmia habilitado; engine Torch desabilitado explicitamente para evitar falha na imagem atual.
- Web: cliente de busca agora envia `X-Forwarded-For`/`X-Real-IP` internos para evitar bloqueio do SearXNG (bot detection).
- Docs: `GUIA-CONFIGURACAO-INICIAL.md` expandido com passo a passo e exemplos para Agents, Agentic, Namespaces, System Prompt e Training.
- Docs: seção didática sobre funcionamento dos agentes no chat (roteamento, WhatsApp, handover) + prompts completos dos 7 pilares.
- Docs: configuração end-to-end por pilar (namespaces, agentes, toggles e treino) com exemplos prontos.
- Docs: exemplos completos de namespace + agente (payloads) para 8 pilares (inclui Fiscal).
- Web Search: headers de encaminhamento e user-agent interno no rag-service; SearXNG mantido como instância interna (public_instance=false) para evitar Valkey/limiter obrigatório.
- ASR: streaming OpenAI desabilitado por padrão e logging enriquecido para erros de transcrição.
- Prompt: instruções PT-BR para idioma, capacidades e SERVER_TIME.
- DB: nova tabela action_requests + enums para auditoria de ações.

- Pipeline modular enterprise e SSOT de versões.
- Healthchecks reais para todos os serviços.
- OpenAPI atualizado para geração de imagens via OpenAI.
- Remoção definitiva de VLM/FLUX local.
- Persistência completa do chat via streaming (conversas e mensagens salvas).
- Página enterprise de Configuração da Alice (system prompt, comportamento e humor).
- Validação do SSE `/api/chat/stream` antes de iniciar o streaming (evita erro de headers enviados).
- Observabilidade: scrape Prometheus corrigido (node-exporter via bridge, Qdrant com API key, Vector com exporter dedicado, Jaeger com métricas em 8888).
- GPU Manager: métricas de VRAM total/usada no fallback quando `nvidia-smi` não está disponível.
- Upload multimodal no streaming com análise de imagens via OpenAI e SSE `media_uploaded`.
- Headers internos para upload de mídia no RAG e geração de imagem via OpenAI (auth service-to-service).
- OpenAI Images: validação estrita de retorno `b64_json` (sem fallback por URL).
- OpenAI Vision: logs com `status` e `x-request-id` para diagnóstico real.
- Suporte enterprise a proxy (`OPENAI_PROXY`, `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`).
- Limite configurável de payload para Vision (`OPENAI_VISION_MAX_BYTES`).
- Build de microsserviços: serviços Alice reinstalam dependências após build de packages para injetar `dist/` dos workspaces.
- Incremento atômico de `totalMensagens` em streams concorrentes (evita perda de contagem).
- Upsert atômico em `/api/assistant-settings` para evitar conflito em concorrência.
- OpenAPI Chat: unificação do path `/api/chat/conversations/{id}` (GET + DELETE soft delete sem chave duplicada).
- Chat Sidebar: botão de excluir conversa visível via `group-hover` com classe `group` no item.
- Streaming de imagem: guarda defensiva quando `parsed.message` não é enviado no SSE de `generated_image`.
- Chat Service: exclusões (individual, lote, tudo) agora são transacionais para evitar perda de mensagens com conversa ainda ativa.
- Sidebar Desktop: colapso real ajusta largura e libera espaço do conteúdo.
- Chat Input: componente unificado com UX mobile-first e mesmas ações do input atual.
- Áudio no Chat: gravação com duas opções (revisar transcrição ou enviar direto).
- ASR OpenAI: gravação usa transcrição gpt-4o-transcribe via RAG (sem GPU local).
- Áudio no Chat: polling de transcrição encerra quando mídia é removida/enviada (sem texto fantasma).
- RBAC: resolver combina DB + PERMISSION_MAP para evitar 403 em permissões não seedadas.
- RBAC: roles customizadas inativas não concedem permissões no resolver.
- RBAC UI: fechamento do diálogo de permissões salva pendências (debounce flush).
- Auth API: endpoint de permissões ignora roles customizadas inativas.
- RBAC UI: busca no diálogo de permissões customizadas isolada da aba principal.
- Auth: resolver inclui PERMISSION_MAP + admin:alice_core:write (alinhado ao endpoint).
- Auth: PATCH custom-role valida tenant da role contra tenant do usuário alvo.
- Chat/Integrations: resolver inclui PERMISSION_MAP + admin:alice_core:write.
- Chat: CHAT_HISTORY_MIN_MESSAGES_* aceita 0 (inteiro >= 0) sem crash em produção.
- Chat: resposta de imagem não expõe provider e exibe apenas a imagem.
- Chat: pedidos explícitos de web retornam resposta determinística quando busca está indisponível.
- RBAC: roles customizadas por tenant (departamentos/funções) com permissões próprias.
- RBAC: usuários podem ter role base + role customizada simultaneamente.
- RBAC UI: criação de permissões guiada por módulo/recurso/ação (menos erro humano).
- Auth: CRUD de permissões limpa cache global (evita permissões stale entre tenants).
- Chat: fullscreen de imagem usa a mesma URL resolvida do thumbnail.
- Usuários: formulários de grupos e permissões resetam ao trocar o item editado.
- RBAC UI: toggles de permissões evitam overwrite em cliques rápidos.
- RBAC UI: fila sequencial e debounce evitam race em atualizações de permissões.
- Gateway: rota `/api/users*` encaminhada ao auth-service para gestão de usuários.
- Usuários: reset de formulário ao reabrir diálogo evita estado pendente.
- Chat: download usa URL resolvida (thumbnail ou original) para evitar HTML.
- UI: colapso da sidebar aplica largura ícone e elimina espaço vazio.
- Auth: callback Google respeita `OAUTH_CALLBACK_URL` e rota compatível.
- Auth: callback GitHub aceita override via `OAUTH_GITHUB_CALLBACK_URL` (baseado em `BASE_URL`).
- Observability: config do Jaeger usa exporter prometheus suportado.
- Auth: valida `OAUTH_CALLBACK_URL` para Google e aplica fallback seguro.
- Observability: telemetry metrics usa host/port inline no reader.
- Observability: dashboards corrigidos para queries unicas e semantica correta.
- Observability: backups sucesso/falha agora usam metricas reais do PostgreSQL.
- Observability: painel Similarity Score (Top-K) exibe K real (unidade e thresholds).
- UI: sidebar da dashboard colapsa totalmente sem autocollapse.
- Chat: streaming exibe apenas texto construindo em tempo real (sem status).
- Chat: velocidade do efeito de digitação configurável na Alice Config.
- Agentic: URL do SearXNG normalizada para garantir chamadas /search no web search.
- Namespaces: ajustes de tipos no formulário de configurações para build do frontend.
- Frontend build: ordem de handlers de gravação e avatar corrigida (evita TS2448/TS2454).
- Dark Mode: paleta preta/cinza para experiência similar ao ChatGPT.
- Avatar do Chat: GIF dinâmico (packman pensando, gato após resposta) com tamanho ajustado.
- pgBackRest: reset controlado quando `archive.info` existe sem `backup.info`.
- pgBackRest: captura stderr+stdout no stanza-create para detectar mismatch.
- pgBackRest: stanza-delete com `--force --force` no reset controlado.
- pgBackRest: stop file + limpeza de metadados no reset automático.
- TLS Caddy: ACME_EMAIL agora é obrigatório (fail-fast no deploy).
- Permissions-Policy: microfone liberado apenas para `self` (Caddy + Nginx).
- Alice Config: tratamento de erro de carregamento com UI estável e labels corretos.
- Chat streaming: status duplicado removido e sincronização de mensagens durante stream.
- Avatar do Chat: packman mantém estado durante streaming inicial sem flicker.
- Detecção de prompts de imagem ampliada (PT/EN + regex robusto).
- Branding: logo responsivo com `object-contain` e favicons ampliados.
- Sidebar desktop: auto-colapso após seleção + expansão por hover.
- Chat: avatar do assistente ampliado para melhor legibilidade.
- Namespaces: rotas do gateway ajustadas para o chat-service.
- Alice Config: refs de erro resetadas para permitir novos toasts após retry.
- Chat: input sempre ativo, botão Stop e opção de câmera no anexo.
- Permissions-Policy: câmera liberada para `self` no gateway e Nginx.
- Chat: Enter cria nova linha; envio via botão ou Alt+Enter.
- Chat: anexos clicáveis no input e mensagens com preview.
- Chat: sincronização de mensagens aguarda refetch após streaming (evita overwrite).
- Chat: auto-scroll respeita leitura e permite navegar toda a conversa.
- Chat: consulta web/deepweb habilitada para perguntas atuais (classificação agentic + contexto web).
- Chat: deepweb via SearXNG engine `ahmia` com Tor (`socks5h://alice-tor:9050`).
- Chat: comandos de trading executáveis via conversa (parser + execução direta).
- Chat: comando "gerar sinal" aciona LLM do Agente Trading com validação cruzada (sem exigir trading habilitado).
- Trading: toggle de habilitação sincroniza cache do risco em tempo real.
- Trading: geração de sinais LLM on-demand + scheduler por marketType (futures/spot/margin) com validação determinística.
- Trading: scheduler persistido em `trading_signal_schedulers` e worker automático no integrations-service.
- Trading: scheduler determinístico da aba Análise (CPU) com configuração própria e timeframe selecionável.
- Trading: análise não executa ao trocar o intervalo; roda apenas por botão "Executar análise agora" ou scheduler.
- Jaeger: telemetry metrics com endpoint Prometheus compatível (0.0.0.0:8888).
- Chat: gravação de áudio com fallback de MIME type ao enviar/transcrever.
- Auth: BASE_URL definido para OAuth Google (evita redirect_uri_mismatch).
- Sidebar: colapso desktop reduz largura real (flex-basis).
- Chat: geração de imagens finaliza SSE com [DONE] em caso de erro.
- Chat: detecção de pedidos de imagem ampliada (logo/banner/avatar/etc).
- Chat: retry controlado na análise OpenAI Vision (erros transitórios).
- Chat: fallback automático quando OpenAI rejeita response_format.
- Build frontend: removido tipo não utilizado no schema compartilhado (TS6133).
- Caddy: entrypoint ajusta permissões de /data e /config antes de iniciar (certificados OK).
- Jaeger v2: telemetry metrics migrada para readers + exporter prometheus (sem restart loop).
- Permissões: Redis com GID 1000 alinhado ao usuário `redis` nas imagens Alpine 7.x.
- RBAC: nova permissão `admin:alice_core:write` para edição do Core da Alice.
- Auth: CRUD de permissões e atribuição por role via API.
- Auth: grupos organizacionais com membros por tenant.
- Frontend: página de gestão de usuários/grupos/permissões com filtros e ações.
- Alice Config: edição do core bloqueada sem permissão (somente leitura).
- Chat: regex de geração de imagem exige verbo de ação (evita falso positivo).
- Trading: cache de risk-config sincroniza via queryClient.
- UsersAdmin: queries dinâmicas corrigidas para membros de grupo e permissões por role.
- RBAC: cache global de permissões limpo ao atualizar roles (evita permissões stale).

---

## Tuning seguro (aplicação + servidor)

### Flags de aplicação (defaults atuais)

#### Chat Service (tokens + histórico)

- `LLM_MIN_OUTPUT_TOKENS=256`
- `LLM_DYNAMIC_PROMPT_T1=1600`
- `LLM_DYNAMIC_PROMPT_T2=2200`
- `LLM_DYNAMIC_PROMPT_T3=2800`
- `LLM_DYNAMIC_PROMPT_T4=3600`
- `LLM_DYNAMIC_MAX_TOKENS_T1=1536`
- `LLM_DYNAMIC_MAX_TOKENS_T2=1024`
- `LLM_DYNAMIC_MAX_TOKENS_T3=768`
- `LLM_DYNAMIC_MAX_TOKENS_T4=512`
- `CHAT_HISTORY_FETCH_LIMIT=10`
- `CHAT_HISTORY_ALWAYS_INCLUDE_TRADING=6`
- `CHAT_HISTORY_ALWAYS_INCLUDE_GENERAL=4`
- `CHAT_HISTORY_MIN_MESSAGES_TRADING=0`
- `CHAT_HISTORY_MIN_MESSAGES_GENERAL=0`
- `CHAT_HISTORY_RELEVANCE_THRESHOLD_TRADING=0.08`
- `CHAT_HISTORY_RELEVANCE_THRESHOLD_GENERAL=0.12`
- `CHAT_HISTORY_FALLBACK_ENABLED=false`
- `CHAT_HISTORY_SEARCH_LIMIT=200`
- `CHAT_HISTORY_SEARCH_TOKEN_BUDGET=1200`
- `CHAT_HISTORY_SEARCH_CONVERSATIONS_LIMIT=20`
- `CHAT_MEMORY_RELEVANCE_THRESHOLD=0.10`

#### RAG Service (Top-K adaptativo)

- `RAG_ADAPTIVE_K_ENABLED=false`
- `RAG_ADAPTIVE_K_MIN_RESULTS=2`
- `RAG_ADAPTIVE_K_MIN_THRESHOLD=0.55`
- `RAG_ADAPTIVE_K_FALLBACK_DELTA=0.10`
- `RAG_ADAPTIVE_K_SHORT_QUERY=200`
- `RAG_ADAPTIVE_K_MEDIUM_QUERY=600`

#### GPU Client (timeouts/retries)

- `GPU_REQUEST_TIMEOUT_MS=60000`
- `GPU_REQUEST_MAX_RETRIES=3`
- `GPU_REQUEST_FETCH_TIMEOUT_MS=30000`
- `GPU_REQUEST_POLL_INTERVAL_MS=500`
- `GPU_REQUEST_POLL_FETCH_TIMEOUT_MS=5000`

### Tuning de servidor (manual, sem pipeline)

#### sysctl (arquivo `/etc/sysctl.d/99-alice.conf`)

- `vm.swappiness=10`
- `vm.overcommit_memory=1`
- `fs.file-max=2097152`
- `fs.inotify.max_user_watches=524288`
- `net.core.rmem_max=16777216`
- `net.core.wmem_max=16777216`

#### limits (arquivo `/etc/security/limits.d/99-alice.conf`)

- `* soft nofile 1048576`
- `* hard nofile 1048576`
- `* soft nproc 65535`
- `* hard nproc 65535`

#### Docker runtime (arquivo `/etc/docker/daemon.json`)

- `log-driver: json-file`
- `log-opts: { max-size: "100m", max-file: "5" }`
- `max-concurrent-downloads: 3` (overlay GHCR — aderência Docker docs, reduz timeouts)
- `max-download-attempts: 10` (overlay — resilência pulls lentos)
- `max-concurrent-uploads: 10`
- `live-restore: true`

Overlay aplicado idempotentemente pelo job `prepare` via `infra/scripts/daemon-registry-overlay.json` (merge sem sobrescrever configs existentes).

#### GPU runtime (manual)

- `nvidia-persistenced` habilitado
- runtime NVIDIA configurado como padrão
- CDI NVIDIA ativo (`/etc/cdi/nvidia.yaml`)

#### Storage/IO (manual)

- Limpeza segura de logs antigos em `/opt/alice/logs/`
- Remoção de volumes órfãos (`docker volume prune`) sob janela de manutenção

---

## Qualidade e conformidade

- TypeScript strict e ESLint 9 com zero warnings.
- Vitest com suite de testes atualizada para Gate 2.
- Observância às 18 regras do `CLAUDE.md`.
- Princípios 12-Factor App atendidos.

---

## Backlog (não bloqueante)

- Cobertura de testes 80%.
- Documentação OpenAPI ampliada para endpoints restantes.

---

## Changelog recente

### v10.93 - 08 de Fevereiro de 2026

**pgBackRest Exporter Unhealthy - 3 Causas Raiz**

Container `alice-pgbackrest-exporter` unhealthy (FailingStreak 4863, falhando desde deploy).

- **Causa raiz #1 - CIPHER PASS faltando**: Exporter executava `pgbackrest info --output=json` mas NÃO tinha variável `PGBACKREST_REPO1_CIPHER_PASS`. Repositório usa criptografia AES-256-CBC; sem a cipher pass, o comando falha com exit status 37 "info command requires option: repo1-cipher-pass". **Solução**: adicionadas `PGBACKREST_REPO1_CIPHER_TYPE` e `PGBACKREST_REPO1_CIPHER_PASS` (mesma variável `${BACKUP_CIPHER_PASS}` do container pgbackrest).
- **Causa raiz #2 - Hex errado no healthcheck**: Comentário e healthcheck usavam `0x268E` (= 9870 decimal) mas porta real é 9854 (= `0x267E`). `grep` nunca encontrava match. **Solução**: corrigido de `:268E` para `:267E`.
- **Causa raiz #3 - IPv6 only**: Exporter escuta em IPv6 (`/proc/net/tcp6`) mas healthcheck verificava apenas IPv4 (`/proc/net/tcp`). **Solução**: healthcheck verifica ambos `/proc/net/tcp` e `/proc/net/tcp6` com fallback.

Diagnóstico via SSH em produção (`docker inspect`, logs, env vars, `/proc/net/tcp`, `/proc/net/tcp6`, `pgbackrest info`).

**Arquivos modificados:** `infra/docker/stacks/docker-compose.backup.yml` (environment + healthcheck), `docs/ARQUITETURA.md`, `docs/STATUS-REAL-ATUAL.md`.

---

## Referências internas

- `docs/ARQUITETURA.md`
- `docs/ARQUITETURA-GPU-MANAGER.md`
- `docs/DEPLOYMENT.md`
- `docs/OBSERVABILITY.md`
- `docs/SECRETS.md`
