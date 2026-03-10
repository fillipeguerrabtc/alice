# Alice - Plataforma Enterprise de IA Autônoma

**Autor:** Fillipe Guerra  
**Data:** 10 de Março de 2026  
**Versão:** 10.63 - Hardening pós-plano (security deps + idempotência mandatory + redução de monólitos)

<div align="center">

![Alice Logo](https://img.shields.io/badge/Alice-IA%20Enterprise-blue?style=for-the-badge&logo=robot&logoColor=white)
![Version](https://img.shields.io/badge/versão-10.63-green?style=for-the-badge)
![License](https://img.shields.io/badge/licença-Proprietária-red?style=for-the-badge)
![LLM](https://img.shields.io/badge/LLM-Qwen2.5%207B-purple?style=for-the-badge)

**Plataforma de IA autônoma multimodal 100% self-hosted com LLM próprio**

[Documentação](#documentação) | [Início Rápido](#início-rápido) | [Arquitetura](#arquitetura) | [Deploy](#deploy)

</div>

---

## Visão Geral

**Alice** é uma plataforma enterprise de IA autônoma pronta para produção, **especializada em Finanças, Trading e Gestão Financeira**. Utiliza o LLM **Qwen2.5 7B (vLLM AWQ)** hospedado em infraestrutura própria (Hetzner GPU Server GEX44 - RTX 4000 Ada 20GB), com Vision e geração de imagens via OpenAI.

### Capacidades Principais

| Capacidade | Descrição |
|------------|-----------|
| **IA 100% Autônoma** | LLM próprio (Qwen2.5 7B vLLM AWQ) hospedado em servidor Hetzner GPU GEX44 (RTX 4000 Ada 20GB) |
| **Chat em Tempo Real** | Conversação via WebSocket com streaming de tokens |
| **Roteamento de Agentes** | Seleção automática ou manual de agentes por conversa |
| **Análise de Imagens** | OpenAI Vision (gpt-4.1) para gráficos, documentos, screenshots |
| **Deduplicação Semântica** | SemHash para filtragem de dados duplicados no treinamento |
| **Multi-tenant** | Suporte a múltiplas organizações com agentes IA especializados |
| **RAG Agentic** | Busca híbrida (interna + SearXNG) com classificador inteligente |
| **Stack Ops** | Deploy/rollback via GitHub Actions com governança |
| **Enterprise RBAC** | Controle de acesso granular com 6 roles hierárquicas |
| **Gestão de Usuários/Grupos/Permissões** | Painel dedicado com CRUD, criação admin-only e atribuição por role |
| **Governança do Core** | Permissão `admin:alice_core:write` para editar prompts centrais |
| **Observabilidade LLM** | Prometheus, Grafana, Jaeger, Langfuse para métricas específicas |
| **Auto-aprendizado** | QLoRA semanal (domingo 3:00 AM) com dados aprovados |
| **Trading BTC Futures** | KuCoin Perpetuals com realtime WS (ticker/orderbook/klines), indicadores técnicos determinísticos e validação anti-alucinação |
| **Trading Demo** | Simulação enterprise com dados reais (Spot/Futures/Margin), balances auditáveis, slippage e fees realistas |
| **Post-Mortem Auto-Motivator** | Análise automática de posições fechadas (real + demo) via pipeline CPU → LLM com motivadores, lições e citedValues |
| **Dataset Generator** | Geração automática de datasets de treinamento a partir de post-mortems completos, com schema padronizado |
| **Ecossistema LLM** | LoRA adapters globais (QLoRA) + RAG contextual + Feedback Loop automático para evolução contínua de sinais IA e post-mortems |

### Diferenciais

| Benefício | Descrição |
|-----------|-----------|
| **Autonomia Total** | Controle completo sobre modelo e inferência |
| **Privacidade** | Dados nunca saem da sua infraestrutura |
| **Custo Previsível** | LLM local sem cobrança por token; Vision/Imagens via OpenAI |
| **Customização** | Fine-tuning específico para cada cliente |
| **Disponibilidade** | LLM local resiliente; Vision depende de API OpenAI |

## Documentação principal (SSOT)

- Índice e escopo dos documentos: `docs/INDEX.md`
- Arquitetura completa: `docs/ARQUITETURA.md`
- GPU (Gate 2): `docs/ARQUITETURA-GPU-MANAGER.md`
- Deploy/CI/CD: `docs/DEPLOYMENT.md`
- Observabilidade: `docs/OBSERVABILITY.md`
- Status real atual: `docs/STATUS-REAL-ATUAL.md`
- Secrets e permissões: `docs/SECRETS.md`, `docs/PERMISSIONS.md`

## Atualização incremental mais recente (10/03/2026)

- Hardening de dependências produtivas aplicado no SSOT (`package.json` + `pnpm-lock.yaml`) com `pnpm.overrides` para `minimatch`, `underscore`, `lodash`, `qs` e `undici`; validação de segurança concluída com `pnpm audit --prod --audit-level high` em status **No known vulnerabilities found**.
- Training com idempotência mandatory por default: `TRAINING_RUN_START_REQUIRE_IDEMPOTENCY_KEY` atualizado para `true` em `apps/training-service/src/index.ts`, reforçando fail-closed em criação/start de run sem `x-idempotency-key`.
- Redução incremental dos monólitos críticos sem alteração funcional:
  - `apps/chat-service/src/runtime-config.ts` criado para centralizar bootstrap/runtime config (env parsing, OpenAI proxy/dispatcher e service URLs), reduzindo `apps/chat-service/src/index.ts` de 21169 para 21027 linhas;
  - `apps/training-service/src/training-job-stream.ts` criado para centralizar fingerprint/lifecycle de stream, reduzindo `apps/training-service/src/index.ts` de 4161 para 4098 linhas.
- Fechamento das pendências de validação pós-refactor: 7 testes de guardas estáticas (Chat/Trading/Auth/Training/Integrations) foram atualizados para os novos boundaries modulares, preservando os controles enterprise e restaurando a suíte para **120/120 arquivos e 1352/1352 testes** em status OK.
- Rebase/squash não-interativo concluído sobre `origin/main` com backup da linha pré-consolidação em `backup/pre-squash-20260310-1`.
- Governança contínua ativada no fluxo padrão com scripts `verify:enterprise-focus`, `verify:enterprise-focus:full` e `validate:enterprise` (enforcement real com `ENFORCE_FAILURE=true`).
- Consolidação técnica adicional no frontend: `wise-payments` reduzido para 176 arquivos TS/TSX e 13.976 linhas (arquivos `<40` linhas reduzidos para 16), `TradingContent.tsx` reduzido para 1321 linhas e `useChatPageLayoutController.ts` para 591 linhas.
- Correção dos 4 itens finais de review: WisePayments teve consolidação de wrappers redundantes em `apps/frontend-service/src/pages/wise-payments/use-wise-page-composition.ts` com redução de 193 para 187 arquivos TS/TSX (14.245 -> 14.155 linhas); `TradingContent.tsx` e `useChatPageLayoutController.ts` tiveram redução incremental de densidade.
- Governança operacional: novo script `scripts/verify-enterprise-focus.sh` para monitorar churn documental, concentração de foco por domínio e densidade/fragmentação de frontend em janelas de commits.
- Plano enterprise por blocos: fechamento formal com conclusão dos blocos remanescentes (P0/P1/P2) e consolidação do status em 100% no SSOT `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`.
- Frontend Trading: `apps/frontend-service/src/pages/TradingContent.tsx` recebeu cleanup final da orquestração de `section-props` com montagem explícita por domínio (`primaryTabsOptions`, `operationalTabsOptions`, `dialogsOptions`, `layoutOptions`) sem alteração funcional.
- Frontend Chat: `apps/frontend-service/src/pages/Chat/useChatPageLayoutController.ts` recebeu cleanup final do layout controller (remoção de wrappers inline residuais e normalização de handlers/flags de composição) sem alteração funcional.
- Frontend Trading: `apps/frontend-service/src/pages/TradingContent.tsx` recebeu redução de densidade na composição de `section-props/options` com contextos compartilhados (`locale/t/timezone` e `selected market context`), preservando contratos de UI/API.
- Frontend Chat: `apps/frontend-service/src/pages/Chat/useChatPageLayoutController.ts` recebeu cleanup de orquestração (callbacks nomeados e remoção de wrappers inline redundantes) sem alteração de comportamento, API ou RBAC.
- Auditoria anti-fragmentação (últimos 400 commits): identificado hotspot de fragmentação em `apps/frontend-service/src/pages/wise-payments` (193 arquivos TS/TSX, 14.245 linhas); execução ajustada para priorizar fechamento de residuais críticos sem criar novos micro-boundaries fora de necessidade objetiva.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/components/wise-catalog-params-fields.tsx` passou a atuar como composition root fino, delegando campos para `wise-catalog-path-param-inputs.tsx` e `wise-catalog-query-param-controls.tsx`.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/components/wise-balances-header.tsx` passou a atuar como composition root fino, delegando o fluxo modal de criação para `wise-balances-new-balance-dialog.tsx` e `wise-balances-new-balance-form-fields.tsx`, sem alteração de API/RBAC.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/components/wise-sca-tab-content.tsx` passou a atuar como composition root fino de UI, delegando blocos para `wise-sca-toolbar.tsx` e `wise-sca-payload-card.tsx`, com contratos compartilhados em `wise-sca-tab-types.ts`.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/components/wise-simulations-operation-card.tsx` passou a delegar blocos para `wise-simulations-operation-select.tsx`, `wise-simulations-operation-fields.tsx` e `wise-simulations-operation-response.tsx`, preservando payloads e fluxos operacionais sem alteração de API/RBAC.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/components/wise-webhooks-tab-content.tsx` passou a atuar como composition root fino de UI, delegando blocos para `wise-webhooks-toolbar.tsx`, `wise-webhooks-create-card.tsx`, `wise-webhooks-delete-card.tsx` e `wise-webhooks-response-card.tsx`, com contratos compartilhados em `wise-webhooks-tab-types.ts`.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/components/wise-card-orders-actions-card.tsx` passou a delegar blocos operacionais para `wise-card-orders-order-reference-row.tsx`, `wise-card-orders-json-action-block.tsx` e `wise-card-orders-actions-footer.tsx`, com contratos centralizados em `wise-card-orders-actions-card-types.ts`.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/components/wise-exchange-quote-form-card.tsx` passou a delegar seções para `wise-exchange-quote-form-fields.tsx` e `wise-exchange-quote-result-card.tsx`, preservando fluxo de quote/execute sem alteração de API/RBAC.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/components/wise-spend-limits-tab-content.tsx` passou a atuar como composition root fino, delegando seções para `wise-spend-limits-fetch-controls.tsx`, `wise-spend-limits-update-panels.tsx` e `wise-spend-limits-response-panels.tsx`, com contratos compartilhados em `wise-spend-limits-tab-types.ts`.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/components/wise-kyc-tab-content.tsx` passou a atuar como composition root fino e delegar seções para `wise-kyc-toolbar.tsx`, `wise-kyc-evidences-card.tsx`, `wise-kyc-upload-card.tsx` e `wise-kyc-reviews-card.tsx`, com contratos compartilhados em `wise-kyc-tab-types.ts`.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/components/wise-simulations-tab-content.tsx` passou a atuar como composition root fino e delegar seções para `wise-simulations-toolbar.tsx` e `wise-simulations-operation-card.tsx`, com contratos compartilhados em `wise-simulations-tab-types.ts`, preservando fluxos de operação/payload/resposta sem alteração de API/RBAC.
- Frontend Trading: early-returns de status/configuração/tenant foram extraídos de `apps/frontend-service/src/pages/TradingContent.tsx` para `apps/frontend-service/src/components/trading/TradingStatusGate.tsx`, com `resolveTradingStatusGate(...)` reutilizável e sem alteração de API/RBAC.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/components/wise-quotes-tab-content.tsx` passou a atuar como composition root fino e delegar apresentação para `wise-quotes-form-card.tsx` e `wise-quotes-result-card.tsx`, com contratos compartilhados em `wise-quotes-tab-types.ts`, preservando fluxo de cotação sem alteração de API/RBAC.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/components/wise-statements-tab-content.tsx` passou a atuar como composition root fino e delegar apresentação para `wise-statements-filter-card.tsx` e `wise-statements-result-card.tsx`, com contratos compartilhados em `wise-statements-tab-types.ts`, preservando filtros/listagem de extrato sem alteração de API/RBAC.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/components/wise-cards-tab-content.tsx` passou a atuar como composition root fino de UI e delegar blocos para `wise-cards-toolbar.tsx` e `wise-cards-list-card.tsx`.
- Frontend Wise: contratos tipados compartilhados da tab de cards foram centralizados em `apps/frontend-service/src/pages/wise-payments/components/wise-cards-tab-types.ts`.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/components/wise-card-transactions-tab-content.tsx` passou a atuar como composition root fino e delegar blocos para `wise-card-transactions-toolbar.tsx` e `wise-card-transactions-fetch-card.tsx`, com contratos compartilhados em `wise-card-transactions-tab-types.ts`, preservando fluxos de consulta por transaction id sem alteração de API/RBAC.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/components/wise-account-details-tab-content.tsx` passou a atuar como composition root fino de UI e delegar blocos para `wise-account-details-toolbar.tsx`, `wise-account-details-create-card.tsx`, `wise-account-details-list-card.tsx`, `wise-account-details-orders-card.tsx` e `wise-recipient-requirements-card.tsx`.
- Frontend Wise: contratos tipados compartilhados da tab de account-details foram centralizados em `apps/frontend-service/src/pages/wise-payments/components/wise-account-details-tab-types.ts`.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/components/wise-catalog-tab-content.tsx` passou a atuar como composition root fino e delegar blocos para `wise-catalog-operation-config.tsx`, `wise-catalog-params-fields.tsx` e `wise-catalog-execution-panel.tsx`, com contratos compartilhados em `wise-catalog-tab-types.ts`, preservando fluxos de operação/payload/execução sem alteração de API/RBAC.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/components/wise-transfers-tab-content.tsx` passou a atuar como composition root fino de UI e delegar blocos para `wise-transfers-header.tsx`, `wise-transfers-list-card.tsx` e `wise-transfers-actions-card.tsx`.
- Frontend Wise: contratos tipados compartilhados da tab de transfers foram centralizados em `apps/frontend-service/src/pages/wise-payments/components/wise-transfers-tab-types.ts`, removendo duplicação local de tipos no container da tab.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/components/wise-exchange-tab-content.tsx` passou a atuar como composition root fino e delegar blocos para `wise-exchange-quote-form-card.tsx` e `wise-exchange-rates-card.tsx`, com contratos compartilhados em `wise-exchange-tab-types.ts`, preservando fluxos de quote/execute/rates sem alteração de API/RBAC.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/components/wise-balances-tab-content.tsx` passou a atuar como composition root fino de UI e delegar blocos para `wise-balances-header.tsx`, `wise-balances-grid.tsx`, `wise-balance-capacity-card.tsx` e `wise-total-funds-card.tsx`.
- Frontend Wise: contratos tipados compartilhados da tab de balances foram centralizados em `apps/frontend-service/src/pages/wise-payments/components/wise-balances-tab-types.ts`, removendo duplicação local de tipos no container da tab.
- Frontend Wise: comportamento funcional e `data-testid` dos fluxos de criação/listagem/remoção de balances e consultas `balance-capacity/total-funds` foram preservados sem alteração de API/RBAC.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/components/wise-disputes-tab-content.tsx` passou a atuar como composition root fino, delegando blocos para `wise-disputes-toolbar.tsx`, `wise-dispute-reasons-card.tsx`, `wise-dispute-flow-card.tsx`, `wise-dispute-upload-card.tsx`, `wise-dispute-status-update-card.tsx` e `wise-disputes-list-card.tsx`.
- Frontend Wise: contratos tipados de `disputes tab` foram centralizados em `apps/frontend-service/src/pages/wise-payments/components/wise-disputes-tab-types.ts`.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/components/wise-spend-controls-tab-content.tsx` passou a atuar como composition root fino, delegando blocos para `wise-spend-controls-toolbar.tsx`, `wise-spend-controls-create-card.tsx`, `wise-spend-controls-assign-card.tsx`, `wise-spend-controls-delete-card.tsx` e `wise-spend-controls-list-card.tsx`.
- Frontend Wise: contratos tipados de `spend-controls tab` foram centralizados em `apps/frontend-service/src/pages/wise-payments/components/wise-spend-controls-tab-types.ts`.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/components/wise-recipients-tab-content.tsx` passou a atuar como composition root fino, delegando blocos para `wise-recipients-header.tsx`, `wise-recipients-list-card.tsx`, `wise-card-permissions-card.tsx` e `wise-card-secure-card.tsx`.
- Frontend Wise: contratos tipados de `recipients tab` foram centralizados em `apps/frontend-service/src/pages/wise-payments/components/wise-recipients-tab-types.ts`.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/components/wise-card-orders-tab-content.tsx` passou a atuar como composition root fino de UI, delegando blocos para `wise-card-orders-toolbar.tsx`, `wise-card-orders-create-card.tsx`, `wise-card-orders-actions-card.tsx` e `wise-card-orders-list-card.tsx`.
- Frontend Wise: contratos tipados de `card-orders tab` foram centralizados em `apps/frontend-service/src/pages/wise-payments/components/wise-card-orders-tab-types.ts`.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-order-mutations.ts` passou a atuar como composition root fino de mutações, delegando subdomínios para `use-wise-account-details-order-mutation.ts`, `use-wise-card-order-write-mutations.ts` e `use-wise-card-order-read-mutations.ts`.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-actions.ts` passou a consumir `use-wise-account-card-dispute-state.ts` para centralizar estado local de account/card/dispute, reduzindo densidade do orchestration hook.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/use-wise-page-composition.ts` passou a atuar como composition root mais fino, delegando suites dedicadas de orquestração.
- Frontend Wise: nova suite `apps/frontend-service/src/pages/wise-payments/use-wise-actions-suite.ts` centraliza composição de ações (reference/catalog/recipient/card-spend/transfer/webhook/account-dispute/user-activity/balance-exchange).
- Frontend Wise: nova suite `apps/frontend-service/src/pages/wise-payments/use-wise-refresh-derived.ts` centraliza composição de `refreshActions` + `derivedData`.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/use-wise-card-spend-actions.ts` foi reduzido para composition root fino de estado + mutações + wiring.
- Frontend Wise: handlers de `card status/spend controls` foram desacoplados para `apps/frontend-service/src/pages/wise-payments/use-wise-card-spend-control-handlers.ts`.
- Frontend Wise: handlers de `spend limits` (profile/card/delete) foram desacoplados para `apps/frontend-service/src/pages/wise-payments/use-wise-card-spend-limits-handlers.ts`.
- Frontend Wise: contratos compartilhados de catálogo (`WiseCatalogOperation`, `WiseCatalogParamKey` e `WiseCatalogParams`) foram centralizados em `apps/frontend-service/src/pages/wise-payments/wise-catalog-types.ts`.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/use-wise-catalog-workbench.ts` passou a consumir tipos compartilhados e removeu duplicação de contratos locais.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/components/wise-catalog-tab-content.tsx` passou a consumir tipos compartilhados do domínio de catálogo, mantendo contrato de UI inalterado.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/use-wise-tab-props.ts` passou a atuar como composition root fino, delegando montagem para `build-wise-tab-profile-props.ts` e `build-wise-tab-operational-props.ts`.
- Frontend Wise: contratos tipados de composição das tabs foram centralizados em `apps/frontend-service/src/pages/wise-payments/wise-tab-props-types.ts` e `build-wise-profile-scoped-tab-props.ts`.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/wise-payments-constants.tsx` passou a atuar como barrel de constants, com segmentação por domínio em `wise-catalog-operations.ts`, `wise-currency-options.ts` e `wise-status-badge.tsx`.
- Frontend Wise: composição de props profile-scoped foi segmentada em `apps/frontend-service/src/pages/wise-payments/build-wise-profile-core-tabs-props.ts` e `apps/frontend-service/src/pages/wise-payments/build-wise-profile-compliance-tabs-props.ts`.
- Frontend Wise: tipos compartilhados das tabs profile-scoped foram centralizados em `apps/frontend-service/src/pages/wise-payments/wise-profile-tabs-props-types.ts`.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/build-wise-profile-tabs-props.ts` passou a atuar como composition root fino para os builders `core` e `compliance`.
- Frontend Wise: composição de props operacionais de tabs foi segmentada em `apps/frontend-service/src/pages/wise-payments/build-wise-operational-finance-tabs-props.ts` e `apps/frontend-service/src/pages/wise-payments/build-wise-operational-admin-tabs-props.ts`.
- Frontend Wise: tipos compartilhados do domínio operacional foram centralizados em `apps/frontend-service/src/pages/wise-payments/wise-operational-tabs-props-types.ts`.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/build-wise-operational-tabs-props.ts` passou a atuar como composition root fino, agregando os builders por domínio.
- Frontend Wise: handlers de `account details/card orders/card transactions` foram desacoplados para `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-order-action-handlers.ts`.
- Frontend Wise: handlers de `dispute status/flow/upload` e `kyc uploads/evidences` foram desacoplados para `apps/frontend-service/src/pages/wise-payments/use-wise-dispute-kyc-action-handlers.ts`.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-actions.ts` passou a atuar como composition root fino de estado + wiring de handlers e mutações.
- Frontend Wise: mutações de `dispute status/flow/upload` foram desacopladas para `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-flow-mutations.ts`.
- Frontend Wise: mutações de `kyc required evidences/upload document/upload additional` foram desacopladas para `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-kyc-mutations.ts`.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-dispute-kyc-mutations.ts` passou a atuar como composition root fino dos subdomínios `dispute` e `kyc`.
- Frontend Wise: mutações de `account details` e `card orders` foram desacopladas para `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-order-mutations.ts`.
- Frontend Wise: mutação de `card transaction details` foi desacoplada para `apps/frontend-service/src/pages/wise-payments/use-wise-card-transaction-mutation.ts`.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-card-order-mutations.ts` passou a atuar como composition root fino, compondo os dois subdomínios sem alterar contrato público.
- Frontend Wise: mutações de `account/card orders/card transactions` foram consolidadas no subdomínio `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-card-order-mutations.ts`.
- Frontend Wise: mutações de `dispute flow/upload/status` e `kyc evidences/upload` foram consolidadas no subdomínio `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-dispute-kyc-mutations.ts`.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-mutations.ts` passou a atuar como composition root fino, agregando ambos os submódulos sem alterar o contrato consumido por `use-wise-account-card-dispute-actions.ts`.
- Frontend Wise: mutações de webhooks foram desacopladas para `apps/frontend-service/src/pages/wise-payments/use-wise-webhook-mutations.ts` (`list/create/delete`) com gestão de resposta/notificações dedicada.
- Frontend Wise: mutações de simulação foram desacopladas para `apps/frontend-service/src/pages/wise-payments/use-wise-simulation-mutations.ts` (`transfer/profile/balance/card/kyc/bank`) com validações por operação dedicadas.
- Frontend Wise: mutações de SCA foram desacopladas para `apps/frontend-service/src/pages/wise-payments/use-wise-sca-mutations.ts` (`POST/DELETE`) e `use-wise-webhook-simulation-sca-mutations.ts` passou a atuar como composition root fino.
- Frontend Wise: mutação de status de cartão foi desacoplada para `apps/frontend-service/src/pages/wise-payments/use-wise-card-status-mutations.ts`.
- Frontend Wise: mutações de spend-controls foram desacopladas para `apps/frontend-service/src/pages/wise-payments/use-wise-spend-control-mutations.ts` (`create/assign/unassign/delete`).
- Frontend Wise: mutações de spend-limits foram desacopladas para `apps/frontend-service/src/pages/wise-payments/use-wise-spend-limits-mutations.ts` e `use-wise-card-spend-mutations.ts` passou a atuar como composition root fino.
- Frontend Wise: operações de transferências (`fund/cancel`) foram desacopladas para `apps/frontend-service/src/pages/wise-payments/use-wise-transfer-operations.ts`.
- Frontend Wise: operações de permissões/secure de cartão foram desacopladas para `apps/frontend-service/src/pages/wise-payments/use-wise-card-permission-secure-operations.ts`.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/use-wise-transfer-and-card-operations.ts` passou a atuar como composition root fino, compondo os dois submódulos sem alterar contrato.
- Frontend Wise: queries globais foram desacopladas para `apps/frontend-service/src/pages/wise-payments/use-wise-global-data-queries.ts`, centralizando `balances/transfers/recipients/batch/profiles/users me`.
- Frontend Wise: queries profile-scoped foram desacopladas para `apps/frontend-service/src/pages/wise-payments/use-wise-profile-scoped-data-queries.ts`, centralizando `cards/spend-controls/disputes/kyc/card-orders/dispute-reasons/account-details`.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/use-wise-data-queries.ts` passou a atuar como composition root de guard/estado/erro agregado, mantendo contrato público inalterado para `useWisePageComposition`.
- Frontend Wise: contratos de `transfer/card actions` foram centralizados em `apps/frontend-service/src/pages/wise-payments/wise-transfer-and-card-types.ts`.
- Frontend Wise: operações de transferências e cartões (fund/cancel, permissions e secure endpoints) foram desacopladas para `apps/frontend-service/src/pages/wise-payments/use-wise-transfer-and-card-operations.ts`.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/use-wise-transfer-and-card-actions.ts` passou a focar em estado e composição, delegando fluxo operacional ao módulo dedicado sem alterar contratos.
- Frontend Wise: contratos/defaults do fluxo de saldo/câmbio/extrato foram centralizados em `apps/frontend-service/src/pages/wise-payments/wise-balance-exchange-statement-types.ts`.
- Frontend Wise: mutações de quote, balances, exchange e statement foram desacopladas para `apps/frontend-service/src/pages/wise-payments/use-wise-balance-exchange-statement-mutations.ts`.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/use-wise-balance-exchange-statement-actions.ts` passou a focar em estado e handlers, delegando IO/mutações ao módulo dedicado sem alterar contratos.
- Frontend Wise: contratos e defaults de webhook/simulation/SCA foram centralizados em `apps/frontend-service/src/pages/wise-payments/wise-webhook-simulation-sca-types.ts`.
- Frontend Wise: mutações de webhooks, simulações e SCA foram desacopladas para `apps/frontend-service/src/pages/wise-payments/use-wise-webhook-simulation-sca-mutations.ts`.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/use-wise-webhook-simulation-sca-actions.ts` passou a focar em estado e handlers, delegando IO/mutações para o módulo dedicado sem alterar contratos.
- Frontend Wise: contratos e estados-base de spend/card foram centralizados em `apps/frontend-service/src/pages/wise-payments/wise-card-spend-types.ts`.
- Frontend Wise: mutações de card status, spend-controls e spend-limits foram desacopladas para `apps/frontend-service/src/pages/wise-payments/use-wise-card-spend-mutations.ts`.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/use-wise-card-spend-actions.ts` passou a focar em estado e handlers de UI, delegando IO/mutações ao módulo dedicado sem alterar contratos.
- Frontend Wise: novo módulo `apps/frontend-service/src/pages/wise-payments/use-wise-query-hooks.ts` centraliza hooks reutilizáveis de consulta (`useWiseApiQuery` e `useWiseProfileScopedQuery`) para endpoints globais e profile-scoped.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/use-wise-data-queries.ts` passou a consumir os hooks reutilizáveis e removeu duplicação de blocos `useQuery`/`queryFn`, preservando contratos de payload, paginação e filtros.
- Frontend Trading: `apps/frontend-service/src/pages/TradingContent.tsx` foi introduzido como módulo dedicado para toda a orquestração de hooks/queries/handlers/render da página de Trading.
- Frontend Trading: `apps/frontend-service/src/pages/Trading.tsx` passou a atuar estritamente como wrapper fino de autenticação e autorização (`useAuth` + `useTradingPermissionsQuery`), montando `TradingContent` somente após os guards.
- Frontend Trading: composição da página ficou explicitamente separada em `guard boundary` (`Trading.tsx`) e `feature composition` (`TradingContent.tsx`), reduzindo acoplamento residual da mega-página sem alterar contratos de API/RBAC.

- Frontend Chat: orquestração de hooks/handlers/queries da página foi desacoplada para `apps/frontend-service/src/pages/Chat/useChatPageLayoutController.ts`.
- Frontend Chat: `apps/frontend-service/src/pages/Chat/index.tsx` passou a atuar como composition root fino, consumindo apenas `useChatPageLayoutController()` e renderizando `ChatPageLayout`.
- Frontend Trading: composição agregada de `primary/operational/dialogs/layout section-props` foi desacoplada para `apps/frontend-service/src/components/trading/TradingPageSectionProps.ts`.
- Frontend Trading: `apps/frontend-service/src/pages/Trading.tsx` passou a consumir `buildTradingPageSectionProps(...)` como boundary único para assembly de props de render, removendo chamadas diretas repetidas aos builders de seção.
- Frontend Trading: `apps/frontend-service/src/components/trading/index.ts` passou a exportar `buildTradingPageSectionProps`, mantendo consumo centralizado via barrel.
- Frontend Wise: mutações de account details/card orders/disputes/KYC foram desacopladas para `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-mutations.ts`.
- Frontend Wise: contratos tipados compartilhados do fluxo account/card/dispute foram centralizados em `apps/frontend-service/src/pages/wise-payments/wise-account-card-dispute-types.ts`.
- Frontend Wise: `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-actions.ts` passou a atuar como composition root de estado e handlers, delegando mutações para o módulo dedicado.
- Frontend Trading: mutações de execução de ordens foram desacopladas para `apps/frontend-service/src/components/trading/useTradingOrderExecutionMutations.ts` (create/cancel/sync).
- Frontend Trading: mutações/ações de risco e controle foram desacopladas para `apps/frontend-service/src/components/trading/useTradingRiskControlActions.ts` (`updateRiskConfig`, `handleModeChange`, `handleTradingToggle`) com tipos compartilhados em `apps/frontend-service/src/components/trading/trading-control-order-types.ts`.
- Frontend Trading: `apps/frontend-service/src/components/trading/useTradingControlOrderMutations.ts` foi reduzido para composition root de mutações, preservando o contrato consumido por `useTradingControlOrderActionSuite`.
- Frontend Trading: novos type guards de domínio para payloads de conta/posição foram adicionados em `apps/frontend-service/src/components/trading/TradingDomainTypes.ts` (`isFuturesPositionArray`, `isSpotAccountArray`, `isFuturesAccountOverview`, `isMarginCrossOverview`, `isMarginIsolatedOverview`).
- Frontend Trading: `apps/frontend-service/src/pages/Trading.tsx` e `apps/frontend-service/src/components/trading/useTradingAccountPositionState.ts` passaram a consumir os type guards, removendo casts de payload (`as Position[]`, `as SpotAccount[]`, `as FuturesAccountOverview`, etc.).
- Frontend Chat: composição final de props do container de página foi desacoplada para `apps/frontend-service/src/pages/Chat/chat-page-layout-props-builder.ts`.
- Frontend Chat: `apps/frontend-service/src/pages/Chat/index.tsx` passou a montar `ChatPageLayout` via `buildChatPageLayoutProps(...)`, reduzindo acoplamento do composition root e removendo cast de workspace.
- Integrations: fluxo principal de geração de sinal por LLM (`generateTradingSignalFromLlm`) foi desacoplado para `apps/integrations-service/src/trading-llm-signal-generation-service.ts`.
- Integrations: `apps/integrations-service/src/index.ts` passou a manter apenas wrapper fino para `generateTradingSignalFromLlmCore`, removendo a orquestração inline equivalente e preservando contratos.
- Frontend Trading: composição de handlers de interação/mutação foi desacoplada para `apps/frontend-service/src/components/trading/useTradingCompositeActionHandlers.ts`.
- Frontend Trading: `apps/frontend-service/src/pages/Trading.tsx` passou a consumir `useTradingCompositeActionHandlers(...)`, removendo bloco inline equivalente de orquestração de handlers e reduzindo densidade do container.
- Integrations: contexto operacional de geração de sinal (RAG, orderbook, notícias, dataset aprovado, risk config e trade plan) foi desacoplado para `apps/integrations-service/src/trading-signal-context-service.ts`.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `buildTradingSignalOperationalContext(...)`, removendo bloco inline equivalente no `generateTradingSignalFromLlm` e preservando contratos.
- Integrations: orquestração de análise de sinal (`analysisMatrix`, consenso, arbitragem triangular e ensemble) foi desacoplada para `apps/integrations-service/src/trading-signal-analysis-orchestration-service.ts`.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `buildTradingSignalAnalysisContext(...)`, removendo bloco inline equivalente no `generateTradingSignalFromLlm` e preservando contratos.
- Integrations: composição de prompt multi-timeframe com orçamento de tokens e redução progressiva de notícias foi desacoplada para `buildTradingSignalPromptBudget` em `apps/integrations-service/src/trading-llm-prompt-service.ts`.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `buildTradingSignalPromptBudget(...)`, removendo bloco inline equivalente no `generateTradingSignalFromLlm` e preservando contratos.
- Integrations: montagem/persistência do payload final do sinal LLM (`createSignal` com metadata completa de técnicas/consenso/arbitragem/analysisMatrix) foi desacoplada para `apps/integrations-service/src/trading-llm-signal-persistence-service.ts`.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `createTradingLlmSignalPersistenceService`, removendo bloco inline equivalente de persistência no `generateTradingSignalFromLlm`.
- Integrations: etapa final de validação/persistência de sinal LLM (seleção de snapshot para validação, `validateAndPersist`, atualização de metadata com `validationSummary`) foi desacoplada para `apps/integrations-service/src/trading-llm-validation-finalize-service.ts`.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `createTradingLlmValidationFinalizeService`, removendo bloco inline equivalente de validação e update final do sinal.
- Integrations: etapa de pós-processamento de sinal LLM (promoção direcional por consenso multi-timeframe e registro de override determinístico) foi desacoplada para `apps/integrations-service/src/trading-llm-signal-post-processing-service.ts`.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `createTradingLlmSignalPostProcessingService` no fluxo `generateTradingSignalFromLlm`, removendo bloco inline equivalente de override.
- Integrations: execução de inferência para geração de sinais (timeout/retries/backoff, gateway vs GPU Manager, validação de adapter LoRA ativo e structured output) foi desacoplada para `apps/integrations-service/src/trading-llm-execution-service.ts`.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `createTradingLlmExecutionService` no fluxo `generateTradingSignalFromLlm`, removendo o bloco inline equivalente de orquestração GPU/LLM.
- Integrations: fluxo legacy institucional de geração de sinais (`portfolio_auto` e seleção por candidatos do universo) foi desacoplado para `apps/integrations-service/src/trading-legacy-institutional-signal-service.ts`.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `createTradingLegacyInstitutionalSignalService` e delegar o branch legado de `generateTradingSignalFromLlm`, reduzindo acoplamento no composition root sem alterar contratos.
- Integrations: análise técnica de trading com persistência de indicadores foi desacoplada para `apps/integrations-service/src/trading-technical-analysis-service.ts`, centralizando cálculo técnico, ensemble e gravação em `tradingTechnicalIndicators`.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `createTradingTechnicalAnalysisService` e remover `calculateAndPersistTechnicalAnalysis` inline do composition root, preservando contratos de rotas e geração de sinais.
- Integrations: orquestração de criação de dataset de trading foi desacoplada para `apps/integrations-service/src/trading-dataset-orchestration-service.ts`, centralizando fluxos completos de `signal` e `order`.
- Integrations: `apps/integrations-service/src/index.ts` passou a inicializar `createTradingDatasetOrchestrationService` e delegar criação de datasets para o módulo dedicado, reduzindo significativamente o tamanho do composition root.
- Integrations: resolução de namespace para datasets de trading foi desacoplada para `apps/integrations-service/src/trading-dataset-namespace-service.ts`, centralizando validação de candidatos e inferência segura.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `createTradingDatasetNamespaceService` nos fluxos de dataset por signal e order, removendo duplicação de lógica e reduzindo risco de drift.
- Integrations: montagem de seed de dataset por sinal foi desacoplada para `apps/integrations-service/src/trading-dataset-seed-service.ts`, centralizando `buildTradingDatasetSeedFromSignal`.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `createTradingDatasetSeedService` com tipagem compatível aos contratos reais de consenso/prompt.
- Integrations: helpers core de dataset de trading foram desacoplados para `apps/integrations-service/src/trading-dataset-core-service.ts`, centralizando embedding, deduplicação semântica, score de qualidade, ação derivada de ordem e prompt de execução.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `createTradingDatasetCoreService`, removendo funções inline equivalentes e preservando contratos de criação de datasets por signal/order.
- Integrations: runtime de verificação de integridade do ledger imutável foi desacoplado para `apps/integrations-service/src/integrations-immutable-audit-runtime-service.ts`, centralizando estado, execução on-demand e scheduler start/stop.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `createIntegrationsImmutableAuditRuntimeService` e delegar shutdown para `stopIntegrationsImmutableAuditIntegrityScheduler`, removendo bloco inline equivalente.
- Integrations: runtime de métricas de trading foi desacoplado para `apps/integrations-service/src/trading-metrics-runtime-service.ts`, centralizando refresh de PnL/ordens/indicadores e lifecycle de scheduler.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `createTradingMetricsRuntimeService` e delegar shutdown para `stopTradingMetricsScheduler`, removendo bloco inline equivalente de métricas operacionais.
- Integrations: estado de integridade do ledger imutável passou a ser atualizado in-place (`Object.assign`) em `apps/integrations-service/src/index.ts`, preservando referência viva compartilhada nas rotas de health/audit.
- Integrations: hardening elimina risco de estado stale em `registerIntegrationCoreRoutes` ao evitar reatribuição do objeto `integrationsImmutableAuditIntegrityState`.
- Integrations: observabilidade de chamadas externas foi desacoplada para `apps/integrations-service/src/integration-call-observer-service.ts`, centralizando classificação de erro, latência e contadores de sucesso/falha por integração/operação.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `createIntegrationCallObserverService`, removendo funções inline equivalentes (`classifyIntegrationError`, `updateIntegrationMetrics`, `observeIntegrationCall`) e preservando contratos de métricas.
- Integrations: runtime de schedulers de sinais e análise foi desacoplado para `apps/integrations-service/src/trading-scheduler-runtime-service.ts`, centralizando poll, lock otimista, execução e persistência de status.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `createTradingSchedulerRuntimeService` e agora executa `stopTradingSignalScheduler` e `stopTradingAnalysisScheduler` no graceful shutdown, removendo controle inline de intervalos e reforçando hardening operacional.
- Integrations: resolução de namespace Trading, resumo de datasets aprovados, validação de namespace por tenant e criação idempotente de perfil (`analysis`/`signal`) foram desacopladas para `apps/integrations-service/src/trading-scope-profile-service.ts`.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `createTradingScopeProfileService`, removendo funções inline equivalentes (`resolveTradingNamespaceId`, `fetchTradingDatasetSummary`, `validateTenantNamespace`, `getOrCreateTradingProfile`) e preservando contratos de API/RBAC.
- Integrations: construção de prompt multi-timeframe e orçamento de tokens do LLM foi desacoplada para `apps/integrations-service/src/trading-llm-prompt-service.ts`.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `createTradingLlmPromptService` para `buildMultiTimeframePrompt` e `resolveMaxTokensForPrompt`, removendo constantes/funções inline equivalentes.
- Integrations: normalização/validação do payload de sinal LLM foi desacoplada para `apps/integrations-service/src/trading-llm-signal-normalizer-service.ts`.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `createTradingLlmSignalNormalizerService` para `buildLlmSignalFromPartial`, removendo funções inline equivalentes de normalização numérica/cited values e montagem segura do sinal.
- Integrations: bloco determinístico de planejamento de sinal/trade foi desacoplado para `apps/integrations-service/src/trading-signal-plan-service.ts`.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir funções dedicadas de sinal/plano (`resolveSignalTypeFromAnalysis`, `buildAnalysisMotivators`, `buildTradePlanFromAnalysis`, `formatDurationLabel`), removendo implementações inline equivalentes.
- Integrations: contexto de agente/scheduler de trading foi desacoplado para `apps/integrations-service/src/trading-agent-context-service.ts`.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `createTradingAgentContextService` para `getAgenticSettingsOrDefault`, `resolveTradingAgentContext`, `resolveSchedulerUserId` e `buildTradingSignalSystemPrompt`, removendo funções inline equivalentes.
- Integrations: fluxo de arbitragem triangular (snapshot de order book + cálculo multi-leg) foi desacoplado para `apps/integrations-service/src/trading-arbitrage-service.ts`.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `createTradingArbitrageService`, removendo funções inline equivalentes e mantendo compatibilidade de contratos com suporte a `feePctByExchange` por exchange.
- Integrations: parsing/normalização de perfil de trading (timeframes, indicadores, técnicas, arbitragem e perfil consolidado) foi desacoplado para `apps/integrations-service/src/trading-profile-config-service.ts`.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `createTradingProfileConfigService` e `TradingConfigError`, removendo funções inline equivalentes.
- Integrations: cálculo de consenso majoritário, scores por técnica e resultado de ensemble foram desacoplados para `apps/integrations-service/src/trading-analysis-consensus-service.ts`.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir o módulo dedicado, removendo funções inline equivalentes de consenso/ensemble.
- Integrations: helpers de suporte de sinal (split de símbolo, derivação de ativos intermediários, erro amigável e símbolo padrão por mercado) foram desacoplados para `apps/integrations-service/src/trading-signal-support-service.ts`.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `createTradingSignalSupportService`, removendo funções inline equivalentes do composition root.
- Integrations: normalização e consulta de notícias de trading via RAG web-search foram desacopladas para `apps/integrations-service/src/trading-news-service.ts`.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `createTradingNewsService`, removendo funções inline equivalentes de configuração/query/fetch de notícias.
- Integrations: composição de market context para dataset/sinais foi desacoplada para `apps/integrations-service/src/trading-market-context-service.ts`.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `createTradingMarketContextService`, removendo funções inline equivalentes de candles/indicadores/contexto de mercado.
- Integrations: cálculo/cache de trade fees e network fees KuCoin foi desacoplado para `apps/integrations-service/src/kucoin-trading-fee-service.ts`.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `createKucoinTradingFeeService`, removendo funções inline equivalentes de arbitragem/fees e persistência de cache por tenant.
- Integrations: catálogo de símbolos e preferências de trading foi desacoplado para `apps/integrations-service/src/trading-symbol-catalog-service.ts`.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `createTradingSymbolCatalogService`, removendo funções inline equivalentes de seleção/normalização de símbolos e resolução de venues para auto-signals.
- Integrations: resolução de tenant para eventos privados do WS KuCoin foi desacoplada para `apps/integrations-service/src/kucoin-private-ws-tenant-service.ts`.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `createResolveKucoinTenantIdForPrivateWs`, removendo função inline equivalente.
- Integrations: request resolvers de trading foram desacoplados para `apps/integrations-service/src/trading-request-resolver-service.ts`.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `createTradingRequestResolver`, removendo funções inline equivalentes de resolução/validação de request de trading.
- Integrations: wiring de métricas WS KuCoin foi desacoplado para `apps/integrations-service/src/kucoin-ws-metrics-service.ts`.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `createKucoinWsMetricsWiring`, removendo bloco inline equivalente de mapeamento/registro de métricas WS.
- Integrations: handlers de market data (`klines` e `orderbook`) foram desacoplados para `apps/integrations-service/src/trading-market-data-handlers.ts`.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `createTradingMarketDataHandlers`, removendo funções inline equivalentes de market data.
- Integrations: bloco de configuração WS KuCoin (depths, intervals e registry de tópicos Spot/Margin) foi desacoplado para `apps/integrations-service/src/kucoin-ws-config-service.ts`.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir helpers de `kucoin-ws-config-service`, removendo funções inline equivalentes de configuração/registry WS.
- Integrations: orchestration de startup (bootstrap de integrações + inicialização de caches) foi desacoplada para `apps/integrations-service/src/integration-startup-service.ts`.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `createIntegrationStartupOrchestrator`, removendo bloco inline equivalente de startup operacional.
- Integrations: resolução de contexto auth Wise foi desacoplada para `apps/integrations-service/src/wise-auth-context-service.ts`.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `getWiseAuthContextFromRequest`, removendo função inline equivalente de validação de tenant no fluxo Wise.
- Integrations: bootstrap de Gmail SMTP e Stripe foi desacoplado para `apps/integrations-service/src/integrations-bootstrap-service.ts`.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `initializeGmailTransporter` e `initializeStripeClient`, removendo bloco inline equivalente de startup dos canais externos.
- Integrations: utilitários de chamadas externas (`createExecuteStripeCall`) e timeout (`withTimeout`) foram desacoplados para `apps/integrations-service/src/integration-external-call-service.ts`.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `createExecuteStripeCall` e `withTimeout`, removendo funções inline equivalentes e mantendo contratos de rotas/clientes externos.
- Integrations: parser/reparo de resposta LLM para sinais de trading foi desacoplado para `apps/integrations-service/src/trading-llm-signal-parser.ts`.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `createLlmSignalResponseParser`, removendo bloco inline equivalente de parsing/normalização/reparo JSON e mantendo contratos existentes.
- Integrations: idempotência de webhook foi desacoplada para `apps/integrations-service/src/webhook-idempotency-service.ts`.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `checkWebhookIdempotency`/`markWebhookProcessed` via wrapper com logger, removendo implementação inline.
- Integrations: health checks de integrações foram desacoplados para `apps/integrations-service/src/integration-health-service.ts`.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `createIntegrationHealthRefresher`, reduzindo o bloco inline de diagnóstico operacional (Stripe/Wise/Twilio/Email/OpenAI/Trading).
- Integrations: bloco de persistência Wise (`upserts` + evento de webhook) foi desacoplado para `apps/integrations-service/src/wise-storage-service.ts`.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir funções de `wise-storage-service`, removendo funções inline de alto volume na composição principal.
- Integrations: fluxo de WhatsApp para LLM e mídia RAG foi desacoplado para `apps/integrations-service/src/twilio-chat-media-service.ts`.
- Integrations: `apps/integrations-service/src/index.ts` passou a consumir `buildProcessMessageWithLLM` e `buildProcessWhatsAppMediaForRAG`, removendo funções inline de alto acoplamento no composition root.
- Chat: mutação principal de streaming foi desacoplada para `apps/frontend-service/src/pages/Chat/useChatSendMessageMutation.ts`.
- Chat: `apps/frontend-service/src/pages/Chat/index.tsx` passou a consumir `useChatSendMessageMutation`, removendo wrappers inline de `sendMessage.mutate(...)` na composição de hooks (`composer`, `recording`, `message sync`, `quick reply`).
- WisePayments: composição de queries `profile scoped` foi padronizada com helper dedicado `apps/frontend-service/src/pages/wise-payments/wise-query-builders.ts`.
- WisePayments: `apps/frontend-service/src/pages/wise-payments/use-wise-data-queries.ts` passou a consumir `fetchWiseProfileScopedJson`, removendo duplicação de montagem de URL/query string para `cards`, `spend-controls`, `disputes`, `kyc`, `card-orders`, `dispute-reasons` e `account-details`.
- Trading: invalidação de queries de conta (`['account']`) foi desacoplada para `apps/frontend-service/src/components/trading/useTradingAccountInvalidation.ts`.
- Trading: `apps/frontend-service/src/pages/Trading.tsx` passou a consumir `useTradingAccountInvalidation` na orquestração de `useTradingWorkspaceActionHandlers`, removendo callback inline equivalente.
- Trading: callback de invalidação de klines foi desacoplado para `apps/frontend-service/src/components/trading/useTradingKlineInvalidation.ts`.
- Trading: callback de redirect de login do wrapper foi desacoplado para `apps/frontend-service/src/components/trading/useTradingAuthRedirect.ts`; `apps/frontend-service/src/pages/Trading.tsx` removeu os callbacks inline equivalentes.
- Chat: bindings residuais do container (`workspaceOptions`, `fallbackMessageUser`, `handleApprovalPolicyChange`, `handleConfirmDeleteTarget` e `focus sync`) foram desacoplados para `apps/frontend-service/src/pages/Chat/useChatContainerBindings.ts`.
- Chat: `apps/frontend-service/src/pages/Chat/index.tsx` passou a consumir `useChatContainerBindings` e removeu `useMemo/useCallback/useEffect` inline equivalentes, mantendo contratos inalterados.
- WisePayments: composição de props das tabs foi desacoplada em builders dedicados `apps/frontend-service/src/pages/wise-payments/build-wise-profile-tabs-props.ts` e `apps/frontend-service/src/pages/wise-payments/build-wise-operational-tabs-props.ts`.
- WisePayments: `apps/frontend-service/src/pages/wise-payments/use-wise-tab-props.ts` passou a operar como composition root fino, consumindo builders por domínio (`profile scoped` e operacional) sem alteração de contratos.
- Trading: wrappers operacionais de apresentação (`criticalApiError`, `renderOrderStatusBadge`, `renderSignalTypeBadge`, `wsHealthy`) foram desacoplados para `apps/frontend-service/src/components/trading/useTradingOperationalPresentationWrappers.tsx`.
- Trading: sincronização de `schedulerConfig` -> `schedulerForm` foi desacoplada para `apps/frontend-service/src/components/trading/useTradingSchedulerFormSync.ts`; `apps/frontend-service/src/pages/Trading.tsx` passou a consumir o hook dedicado, removendo `useEffect` inline equivalente.
- Trading: side-effect de subscribe/unsubscribe de quotes de posições futures foi desacoplado para `apps/frontend-service/src/components/trading/useTradingFuturesQuoteSubscription.ts`.
- Trading: `apps/frontend-service/src/pages/Trading.tsx` passou a consumir `useTradingFuturesQuoteSubscription`, removendo `useEffect` inline equivalente sem alteração de contratos.
- Trading: handlers de eventos realtime (`onError`, `onTicker`, `onOrderUpdate`, `onPositionUpdate`, `onBalance`) foram desacoplados para `apps/frontend-service/src/components/trading/useTradingRealtimeEventHandlers.ts`.
- Trading: `apps/frontend-service/src/pages/Trading.tsx` passou a consumir `useTradingRealtimeEventHandlers`, removendo handlers inline equivalentes sem alteração de contratos.
- Trading: derivados de `topTradingCandidates` e `signalProfilePayload` foram desacoplados para `apps/frontend-service/src/components/trading/useTradingDerivedPayloadState.ts`.
- Trading: `apps/frontend-service/src/pages/Trading.tsx` passou a consumir `useTradingDerivedPayloadState`, removendo memoizações inline equivalentes sem alteração de contratos.
- Trading: estado derivado de conexão realtime (`symbol`, `request`, `wsEnabled`, `wsChannels`) foi desacoplado para `apps/frontend-service/src/components/trading/useTradingRealtimeConnectionState.ts`.
- Trading: `apps/frontend-service/src/pages/Trading.tsx` passou a consumir `useTradingRealtimeConnectionState`, removendo composição inline equivalente sem alteração de contratos.
- Trading: memoizações e callbacks de navegação/opções (`workspaces`, `tabs`, `modes`, `indicators`, `techniques`) foram desacoplados para `apps/frontend-service/src/components/trading/useTradingNavigationPresentation.ts`.
- Trading: `apps/frontend-service/src/pages/Trading.tsx` passou a consumir `useTradingNavigationPresentation`, removendo composição inline equivalente sem alteração de contratos.
- Trading: estado local de UI/forms/dialogs/execução e refs de autosave foi desacoplado para `apps/frontend-service/src/components/trading/useTradingLocalState.ts`.
- Trading: `apps/frontend-service/src/pages/Trading.tsx` passou a consumir `useTradingLocalState`, removendo declarações inline equivalentes de `useState/useRef` sem alteração de contratos.
- Chat: estado local de UI/stream/diálogos/áudio do container foi desacoplado para `apps/frontend-service/src/pages/Chat/useChatLocalState.ts`.
- Chat: `apps/frontend-service/src/pages/Chat/index.tsx` passou a consumir `useChatLocalState`, removendo declarações inline de `useState/useRef` e preservando contratos de API/RBAC.
- Chat: shell principal de layout da página foi desacoplado para `apps/frontend-service/src/pages/Chat/components/ChatPageLayout.tsx`.
- Chat: `apps/frontend-service/src/pages/Chat/index.tsx` passou a consumir `ChatPageLayout`, mantendo o container focado em estado/queries/handlers e removendo composição inline equivalente.
- Chat: seção de workspace do chat foi desacoplada para `apps/frontend-service/src/pages/Chat/components/ChatWorkspaceSection.tsx`.
- Chat: seção de composer (form + `ChatInput`) foi desacoplada para `apps/frontend-service/src/pages/Chat/components/ChatComposerSection.tsx`.
- Chat: `apps/frontend-service/src/pages/Chat/index.tsx` passou a consumir `ChatWorkspaceSection` e `ChatComposerSection`, removendo blocos inline equivalentes sem alteração de contratos.
- Chat: sidebar de conversas (drawer mobile + sidebar desktop animada) foi desacoplada para `apps/frontend-service/src/pages/Chat/components/ChatConversationsSidebar.tsx`.
- Chat: `apps/frontend-service/src/pages/Chat/index.tsx` passou a consumir `ChatConversationsSidebar`, removendo bloco inline equivalente da lateral de conversas sem alteração de contratos.
- Chat: header responsivo (desktop/mobile, governança e ações) foi desacoplado para `apps/frontend-service/src/pages/Chat/components/ChatHeaderSection.tsx`.
- Chat: `apps/frontend-service/src/pages/Chat/index.tsx` passou a consumir `ChatHeaderSection`, removendo bloco inline equivalente do header sem alteração de contratos.
- Trading: seções principais da página (alertas, header, métricas, tabs e dialogs) foram desacopladas para `apps/frontend-service/src/components/trading/TradingPageSections.tsx`.
- Trading: `apps/frontend-service/src/pages/Trading.tsx` passou a consumir `TradingPageSections`, removendo bloco inline equivalente de render sem alteração de contratos.
- Chat: viewport de mensagens (scroll, seleção, hints/banners e diagnóstico) foi desacoplado para `apps/frontend-service/src/pages/Chat/components/ChatMessagesViewport.tsx`.
- Chat: `apps/frontend-service/src/pages/Chat/index.tsx` passou a consumir `ChatMessagesViewport`, removendo bloco inline equivalente de render/scroll/seleção sem alteração de contratos.
- Chat: query de mensagens por conversa (`/api/chat/conversations/:id/messages`) foi centralizada em `apps/frontend-service/src/pages/Chat/useChatQueryState.ts`, removendo callback inline de fetch no container.
- Chat: `apps/frontend-service/src/pages/Chat/index.tsx` passou a consumir `useChatQueryState` apenas com `conversationId`, eliminando acoplamento residual de query e import não utilizado.
- Chat: queries de conversas (fetch paginado, cursores e derivação de conversa ativa) foram desacopladas para `apps/frontend-service/src/pages/Chat/useChatConversationsQueryState.ts`.
- Chat: `apps/frontend-service/src/pages/Chat/index.tsx` passou a consumir `useChatConversationsQueryState`, removendo bloco inline equivalente de `useInfiniteQuery` e derivação de `activeConversation`.
- WisePayments: orquestração de composição da página foi desacoplada para `apps/frontend-service/src/pages/wise-payments/use-wise-page-composition.ts`, centralizando queries, actions, refresh e `tabsContentProps`.
- WisePayments: `apps/frontend-service/src/pages/WisePayments.tsx` passou a consumir `useWisePageComposition`, removendo composição inline equivalente e mantendo contratos de API/RBAC sem alterações.
- Trading: composição tipada de layout (`operational alerts`, `header`, `stats primary`, `stats secondary` e `tabs shell`) foi desacoplada para `buildTradingLayoutSectionProps` em `apps/frontend-service/src/components/trading/TradingSectionPropsBuilders.ts`.
- Trading: `apps/frontend-service/src/pages/Trading.tsx` passou a consumir `buildTradingLayoutSectionProps`, removendo blocos inline equivalentes de assembly de seções de render sem alteração de contratos de API/RBAC.
- Trading: composição tipada de `analysis/lab/orders/overview/portfolio-auto/positions/signals-auto/signals` foi desacoplada para `buildTradingPrimaryTabsSectionProps` em `apps/frontend-service/src/components/trading/TradingSectionPropsBuilders.ts`.
- Trading: `apps/frontend-service/src/pages/Trading.tsx` passou a consumir `buildTradingPrimaryTabsSectionProps` e removeu blocos inline equivalentes de assembly de props das abas primárias, sem alteração de contratos de API/RBAC.
- Chat: composição tipada de `conversationsList`, `chatActionsMenu`, `chatGovernanceControls` e `chatDialogsSection` foi desacoplada para `apps/frontend-service/src/pages/Chat/useChatSectionProps.ts`.
- Chat: `apps/frontend-service/src/pages/Chat/index.tsx` passou a consumir `useChatSectionProps`, removendo blocos inline equivalentes de assembly de props e mantendo contratos de API/RBAC sem alterações.
- Trading: composição das `operational tabs` e dos `dialogs` foi desacoplada para `apps/frontend-service/src/components/trading/TradingSectionPropsBuilders.ts`, com builders tipados por `ComponentProps`.
- Trading: `apps/frontend-service/src/pages/Trading.tsx` passou a consumir `buildTradingOperationalTabsSectionProps` e `buildTradingDialogsSectionProps`, removendo blocos inline equivalentes e reduzindo densidade do composition root sem alterar contratos de API/RBAC.
- Trading: derivação de conta/posições e resumo operacional (`accountMode`, `spot/margin positions`, `openPositionsCount`, `futures/spot/margin summaries` e `quoteCurrency`) foi desacoplada para `apps/frontend-service/src/components/trading/useTradingAccountPositionState.ts`.
- Trading: `apps/frontend-service/src/pages/Trading.tsx` passou a consumir `useTradingAccountPositionState`, removendo bloco inline equivalente de derivação de conta/posições e simplificando o composition root sem alterar contratos de API/RBAC.
- Chat: queries e estado derivado de dados (`conversationMessages`, `approvalPolicy`, `version`, `assistant settings`, `namespaces`, `agents`) foram desacoplados para `apps/frontend-service/src/pages/Chat/useChatQueryState.ts`.
- Chat: `apps/frontend-service/src/pages/Chat/index.tsx` passou a consumir `useChatQueryState`, removendo blocos inline de `useQuery` e simplificando o container sem alterar contratos de API/RBAC.
- Trading: coleções derivadas de símbolos (ordenação por destaque/favoritos + itens de seleção agrupados) e top candidates foram desacopladas para `apps/frontend-service/src/components/trading/useTradingSymbolCandidateViewState.ts` + composição dedicada no container.
- Trading: `apps/frontend-service/src/pages/Trading.tsx` passou a consumir `useTradingSymbolCandidateViewState`, removendo blocos inline de derivação de símbolos sem alterar contratos de API/RBAC.
- Trading: estado derivado de apresentação de sinais/mercado (interval options, fontes de sinais, validação de arbitragem, wsInterval/granularity e depths de orderbook) foi desacoplado para `apps/frontend-service/src/components/trading/useTradingSignalPresentationState.ts`.
- Trading: `apps/frontend-service/src/pages/Trading.tsx` passou a consumir `useTradingSignalPresentationState`, removendo blocos inline de `useMemo`/derivações de apresentação sem alterar contratos de API/RBAC.
- Chat: estado derivado de apresentação/workspaces (workspace hint, opções de agentes, badge de versão e flags de controles) foi desacoplado para `apps/frontend-service/src/pages/Chat/useChatWorkspacePresentation.ts`.
- Chat: `apps/frontend-service/src/pages/Chat/index.tsx` passou a consumir `useChatWorkspacePresentation`, removendo blocos inline de `useMemo`/derivações de UI sem alterar contratos de API/RBAC.
- Chat: sincronização de mensagens carregadas da conversa e flush de envio pendente pós-streaming foram desacoplados para `apps/frontend-service/src/pages/Chat/useChatMessageSyncEffects.ts`.
- Chat: `apps/frontend-service/src/pages/Chat/index.tsx` passou a consumir `useChatMessageSyncEffects`, removendo dois `useEffect`s inline de sincronização de estado sem alterar contratos de API/RBAC.
- Trading: sincronização de bootstrap de estado (default portfolio, auto-mix/all modes, símbolo/intervalo padrão e fee efetivo de arbitragem) foi desacoplada para `apps/frontend-service/src/components/trading/useTradingBootstrapStateSync.ts`.
- Trading: `apps/frontend-service/src/pages/Trading.tsx` passou a consumir `useTradingBootstrapStateSync`, removendo seis `useEffect`s inline de sincronização inicial sem alterar contratos de API/RBAC.
- Trading: composição da série de `klines` (WS/REST), deduplicação por assinatura e fallback de continuidade visual foram desacoplados para `apps/frontend-service/src/components/trading/useTradingKlineSeriesState.ts`.
- Trading: `apps/frontend-service/src/pages/Trading.tsx` passou a consumir `useTradingKlineSeriesState`, removendo estado/efeitos inline de série de candles sem alterar contratos de API/RBAC.
- Trading: queries realtime de `klines` e `orderbook` foram desacopladas para `apps/frontend-service/src/components/trading/useTradingMarketRealtimeQueries.ts`.
- Trading: query de permissões RBAC do wrapper foi desacoplada para `apps/frontend-service/src/components/trading/useTradingPermissionsQuery.ts`.
- Trading: `apps/frontend-service/src/pages/Trading.tsx` passou a operar sem `useQuery` inline, consumindo somente hooks dedicados para queries.
- Trading: queries de `symbols` e `auto assets catalog` foram desacopladas para `apps/frontend-service/src/components/trading/useTradingSymbolAssetQueries.ts`.
- Trading: `apps/frontend-service/src/pages/Trading.tsx` passou a consumir `useTradingSymbolAssetQueries`, centralizando derivação de `availableSymbols/favoriteSymbols/featuredSymbols` e `autoSignalAssetMap/autoSignalAssetOptions` sem alterar contratos.
- Trading: queries de setup e automação (`status`, `portfolios`, `candidates`, `rebalances`, `auto runs`, `intervals`, `analysis-profile` e `arbitrage catalog`) foram desacopladas para `apps/frontend-service/src/components/trading/useTradingSetupQueries.ts`.
- Trading: `apps/frontend-service/src/pages/Trading.tsx` passou a consumir `useTradingSetupQueries` como boundary único de bootstrap, reaproveitando `statusIsConfigured/statusRequiresTenant` em hooks downstream sem alterar contratos.
- Trading: queries operacionais de `ws status`, `risk-config` e `control-history` foram desacopladas para `apps/frontend-service/src/components/trading/useTradingOperationalQueries.ts`.
- Trading: `apps/frontend-service/src/pages/Trading.tsx` passou a consumir `useTradingOperationalQueries`, centralizando `wsStatusData`, `riskConfigData` e `controlHistoryData` sem alterar contratos.
- Trading: queries de post-mortem real, namespaces ativos e verificação de datasets já enviados para treinamento foram desacopladas para `apps/frontend-service/src/components/trading/useTradingPostmortemTrainingQueries.ts`.
- Trading: `apps/frontend-service/src/pages/Trading.tsx` passou a consumir `useTradingPostmortemTrainingQueries` para centralizar `postmortems`, `availableNamespaces` e `postmortemIdsSentToTraining` sem alterar contratos.
- WisePayments: renderização de todas as tabs foi desacoplada para `apps/frontend-service/src/pages/wise-payments/components/wise-payments-tabs-content.tsx`, com tipagem de props por `ComponentProps`.
- WisePayments: `apps/frontend-service/src/pages/WisePayments.tsx` passou a consumir `WisePaymentsTabsContent`, reduzindo acoplamento de apresentação no container sem alterar contratos.
- WisePayments: composição tipada de props das tabs foi desacoplada para `apps/frontend-service/src/pages/wise-payments/use-wise-tab-props.ts`, com contrato exportado em `apps/frontend-service/src/pages/wise-payments/components/wise-payments-tabs-content.tsx` (`WisePaymentsTabsContentProps`).
- WisePayments: `apps/frontend-service/src/pages/WisePayments.tsx` passou a centralizar domínios em bundles (`dataQueries`, `referenceActions`, `refreshActions`, etc.) e delegar o assembly final para `tabsContentProps`, reduzindo densidade do composition root sem alterar contratos de API/RBAC.
- Trading: sincronização de `signalProfileResponse` e auto-save debounced de payload completo foram desacoplados para `apps/frontend-service/src/components/trading/useTradingSignalProfileAutoSave.ts`.
- Trading: `apps/frontend-service/src/pages/Trading.tsx` passou a consumir `useTradingSignalProfileAutoSave`, removendo efeitos inline de hidratação + debounce de persistência de perfil sem alterar contratos de API/RBAC.
- Trading: sincronização de `riskConfig` (form de risco + defaults de mercado) e abertura do diálogo de review de ordem foram desacopladas para `apps/frontend-service/src/components/trading/useTradingRiskReviewState.ts`.
- Trading: `apps/frontend-service/src/pages/Trading.tsx` passou a consumir `useTradingRiskReviewState`, removendo `useEffect` e callback inline de risco/review sem alterar contratos de API/RBAC.
- Trading: derivação de `market`, `orderBookData` e `orderBookPrecision`, junto com invalidação de klines por contexto de símbolo/intervalo, foram desacopladas para `apps/frontend-service/src/components/trading/useTradingMarketOrderBookState.ts`.
- Trading: `apps/frontend-service/src/pages/Trading.tsx` passou a consumir `useTradingMarketOrderBookState`, removendo bloco inline de derivação/invalidação sem alterar contratos de API/RBAC.
- Chat: handlers de interação de UI (drawer/sidebar, seleção, diagnóstico de stream, diálogos de treino/exclusão e quick-reply) foram desacoplados para `apps/frontend-service/src/pages/Chat/useChatUiInteractionHandlers.ts`.
- Chat: `apps/frontend-service/src/pages/Chat/index.tsx` passou a consumir `useChatUiInteractionHandlers`, removendo callbacks inline de orquestração de UI sem alterar contratos de API/RBAC.
- Trading: queries de sinais (`/signals`) e scheduler (`/signal-scheduler`) foram desacopladas para `apps/frontend-service/src/components/trading/useTradingSignalSchedulerQueries.ts`, incluindo reconciliação de `selectedSignalId` e `schedulerConfig`.
- Trading: `apps/frontend-service/src/pages/Trading.tsx` passou a consumir `useTradingSignalSchedulerQueries` como boundary único para sinais/scheduler, reduzindo acoplamento no container sem alterar contratos.
- Trading: queries centrais de mercado/conta/posições/ordens foram desacopladas para `apps/frontend-service/src/components/trading/useTradingMarketAccountQueries.ts`, mantendo contratos e refetch intervals.
- Trading: `apps/frontend-service/src/pages/Trading.tsx` passou a consumir `useTradingMarketAccountQueries` e a reaproveitar `marketQueryString` no fluxo de klines/orderbook, reduzindo densidade da composition root.
- Chat: os diálogos operacionais (treinamento, excluir conversa atual, excluir selecionadas e excluir todas) foram desacoplados para `apps/frontend-service/src/pages/Chat/components/ChatDialogsSection.tsx`, com integração única no `apps/frontend-service/src/pages/Chat/index.tsx` via `chatDialogsSectionProps`.
- Chat: o `apps/frontend-service/src/pages/Chat/index.tsx` passou a centralizar handlers nomeados de abertura/submissão de treinamento e fechamento de diálogo de exclusão, reduzindo densidade do container sem alterar contratos de API/RBAC.
- Trading: composição do `primaryTabsSectionProps`, `operationalTabsSectionProps` e `dialogsSectionProps` foi reorganizada em props nomeados por aba/seção no `apps/frontend-service/src/pages/Trading.tsx` (`analysisTabProps`, `ordersTabProps`, `signalsTabProps`, `chartTabProps`, `historyTabProps`, `newOrderDialogProps`, etc.), reduzindo densidade do composition root.
- Trading: mapeamentos inline de opções de sinais foram desacoplados para memoizações dedicadas no `apps/frontend-service/src/pages/Trading.tsx` (`autoModeOptions`, `signalIndicatorOptions`, `signalIntervalOptions`, `signalTechniqueOptions`), reduzindo densidade no `primaryTabsSectionProps`.
- Chat: controles de governança (approval policy, routing mode, badge de origem e seleção manual de agentes) foram desacoplados para `apps/frontend-service/src/pages/Chat/components/ChatGovernanceControls.tsx`, unificando render desktop/mobile com variante `compact`.
- Chat: `apps/frontend-service/src/pages/Chat/index.tsx` passou a compartilhar `chatGovernanceControlsProps` para evitar duplicação dos blocos de governança no header, mantendo o mesmo comportamento de política/roteamento.
- Trading: composição residual das seções de render (`operationalAlerts`, `header`, `stats primary`, `stats secondary` e `tabs shell`) foi centralizada em objetos nomeados no `apps/frontend-service/src/pages/Trading.tsx`, com consumo por spread tipado.
- Trading: renderers de badges reutilizados (`renderOrderStatusBadge`, `renderSignalTypeBadge`) foram unificados via callbacks compartilhados em `apps/frontend-service/src/pages/Trading.tsx`, removendo lambdas duplicadas entre tabs.
- WisePayments: composição residual de props das tabs operacionais (`balances`, `exchange`, `transfers`, `recipients`, `quotes`, `batch`, `statements`, `profiles`, `users`, `activities`, `spend-limits`, `catalog`) foi centralizada em objetos nomeados no `apps/frontend-service/src/pages/WisePayments.tsx`, com consumo por spread tipado.
- Chat: menu de ações (desktop/mobile) foi desacoplado para `apps/frontend-service/src/pages/Chat/components/ChatActionsMenu.tsx`, removendo duplicação de dropdown e centralizando os handlers de seleção/treinamento/diagnóstico/exclusão.
- Chat: `apps/frontend-service/src/pages/Chat/index.tsx` passou a centralizar handlers compartilhados (`handleQuickReply`, toggle de sidebar/drawer, toggle de seleção/diagnóstico) e composição única de props da lista de conversas (`conversationsListProps`) consumida por mobile e desktop.
- WisePayments: composição de props operacionais das tabs de escopo de perfil foi centralizada em objetos nomeados no `apps/frontend-service/src/pages/WisePayments.tsx` (`accountDetailsTabProps`, `cardsTabProps`, `cardOrdersTabProps`, `cardTransactionsTabProps`, `spendControlsTabProps`, `disputesTabProps`, `kycTabProps`, `webhooksTabProps`, `simulationsTabProps`, `scaTabProps`), com consumo por spread tipado.
- WisePayments: composição de navegação/workspace foi desacoplada para `apps/frontend-service/src/pages/wise-payments/use-wise-navigation-presentation.ts`, centralizando `wiseWorkspaceOptions`, `wiseTabOptions` e `handleWiseWorkspaceSelectionChange`.
- WisePayments: `apps/frontend-service/src/pages/WisePayments.tsx` passou a usar `profileScopedTabProps` para compartilhar `profileFilter/profiles/setProfileFilter` entre tabs de escopo de perfil, reduzindo repetição de filtros no container sem alterar contratos de API/RBAC.
- Trading: orquestração de mutações/handlers de controle e ordens foi desacoplada para `apps/frontend-service/src/components/trading/useTradingControlOrderActionSuite.ts`, compondo `useTradingControlOrderMutations`, `useTradingReviewOrderHandlers` e `useTradingMutationActionHandlers` com contratos tipados.
- Trading: `apps/frontend-service/src/pages/Trading.tsx` passou a consumir `useTradingControlOrderActionSuite`, reduzindo acoplamento do container no bloco de mutações e handlers de review/order-control sem alterar contratos de API/RBAC.
- Trading: composição de `props` das seções de tabs/dialogs foi desacoplada em objetos nomeados (`primaryTabsSectionProps`, `operationalTabsSectionProps`, `dialogsSectionProps`) no `apps/frontend-service/src/pages/Trading.tsx`, reduzindo acoplamento visual do trecho de render sem alterar contratos de API/RBAC.
- Trading: consumo de `TradingPrimaryTabsSection`, `TradingOperationalTabsSection` e `TradingDialogsSection` foi padronizado para spread tipado (`{...sectionProps}`), mantendo `Trading.tsx` mais previsível como composition root.

- Trading: handlers de configuração de sinais/presets (`apply/change/create/delete/update preset`, `generate`, `save profile`, `save scheduler`, `ensemble topN`) foram desacoplados para `apps/frontend-service/src/components/trading/useTradingSignalProfileActionHandlers.ts`, removendo callbacks inline de maior impacto em `signalsTabProps` no `apps/frontend-service/src/pages/Trading.tsx`.
- Trading: wrappers de ações de mutação recorrentes (`approve/cancel/reject/sync/deactivate/open generated signal`) foram desacoplados para `apps/frontend-service/src/components/trading/useTradingMutationActionHandlers.ts`, removendo callbacks inline repetidos entre abas de `apps/frontend-service/src/pages/Trading.tsx`.
- Trading: handlers de scheduler (`enabled`, `intervalMinutes`, `maxSignalsPerRun`, `symbols`) foram desacoplados para `apps/frontend-service/src/components/trading/useTradingSchedulerFormHandlers.ts`, removendo callbacks inline residuais em `signalsTabProps` do `apps/frontend-service/src/pages/Trading.tsx`.
- WisePayments: sincronização de moeda padrão de spend-control foi desacoplada para `apps/frontend-service/src/pages/wise-payments/use-wise-spend-control-default-currency.ts`, removendo `useEffect` inline residual no `apps/frontend-service/src/pages/WisePayments.tsx`.
- Trading: handlers residuais de dialogs/forms (nova ordem, risco, novo sinal e quick-order) foram desacoplados para `apps/frontend-service/src/components/trading/useTradingDialogFormHandlers.ts`, removendo callbacks inline repetidos no `apps/frontend-service/src/pages/Trading.tsx`.
- WisePayments: mudança de filtros de activities foi desacoplada para `handleActivityFilterChange` em `apps/frontend-service/src/pages/wise-payments/use-wise-user-activity-actions.ts`, eliminando callback inline residual no `apps/frontend-service/src/pages/WisePayments.tsx`.
- Trading: handlers residuais do fluxo de envio de post-mortem para treinamento (`open`, `cancel`, `onOpenChange`, `submit`) foram desacoplados para `apps/frontend-service/src/components/trading/useTradingPostmortemTrainingHandlers.ts`, reduzindo orquestração inline no `apps/frontend-service/src/pages/Trading.tsx`.
- Trading: payload de perfil de sinais foi desacoplado para `apps/frontend-service/src/components/trading/TradingSignalProfilePayload.ts` (builder + validação de completude), removendo duplicação de validação inline no `apps/frontend-service/src/pages/Trading.tsx`.
- Trading: handlers residuais de revisão de ordens (`approve`, `save adjustments`, `field updates`) foram desacoplados para `apps/frontend-service/src/components/trading/useTradingReviewOrderHandlers.ts`, reduzindo lógica de mutação inline no `apps/frontend-service/src/pages/Trading.tsx`.
- WisePayments: composição residual de refresh e dados derivados foi desacoplada para `apps/frontend-service/src/pages/wise-payments/use-wise-refresh-actions.ts` e `apps/frontend-service/src/pages/wise-payments/use-wise-derived-data.ts`, reduzindo acoplamento de queries/filtros no `apps/frontend-service/src/pages/WisePayments.tsx`.
- Trading: bloco residual de mutações de ordens/controle foi extraído para `apps/frontend-service/src/components/trading/useTradingControlOrderMutations.ts`, com `Trading.tsx` atuando mais como composition root.
- Trading: mutações de sinais (`create/generate/auto-run/scheduler/deactivate`) foram extraídas para `apps/frontend-service/src/components/trading/useTradingSignalMutations.ts`, reduzindo `Trading.tsx` de 2700 para 2538 linhas sem alterar contratos.
- Trading: orquestração de pipeline/enqueue (`enqueueTradingMutation`, `enqueueTrading`, `runPortfolioAutoPipeline`) foi extraída para `apps/frontend-service/src/components/trading/useTradingPipelineActions.ts`, reduzindo `Trading.tsx` de 2538 para 2424 linhas sem alterar contratos.
- Trading: preferências de símbolos (`updateSymbolPrefs`, `toggleFavorite`, `toggleFeatured`) foram extraídas para `apps/frontend-service/src/components/trading/useTradingSymbolPreferences.ts`, reduzindo `Trading.tsx` de 2424 para 2397 linhas sem alterar contratos.
- Trading: mutações residuais de `updateSignalProfile` e `sendPostMortemToTraining` foram extraídas para `apps/frontend-service/src/components/trading/useTradingProfilePostmortemMutations.ts`, reduzindo `Trading.tsx` de 2397 para 2350 linhas sem alterar contratos.
- WisePayments: composição de queries/filtros foi extraída para `apps/frontend-service/src/pages/wise-payments/use-wise-data-queries.ts` e contratos de tipos centralizados em `apps/frontend-service/src/pages/wise-payments/wise-payments-types.ts`.
- WisePayments: constantes de catálogo, lista de moedas e renderer de status badge foram extraídos para `apps/frontend-service/src/pages/wise-payments/wise-payments-constants.tsx`, reduzindo `WisePayments.tsx` de 1231 para 999 linhas sem alterar contratos.
- Chat: lifecycle de conversas (create/delete/bulk/delete-all), atualização de approval policy e handlers de sidebar/foco foram extraídos para `apps/frontend-service/src/pages/Chat/useChatConversationLifecycle.ts`.
- Chat: ações de treinamento por conversa/mensagens e feedback multimodal (mensagem/imagem) foram extraídas para `apps/frontend-service/src/pages/Chat/useChatTrainingFeedbackActions.ts`, reduzindo `Chat/index.tsx` de 2375 para 2263 linhas sem alterar contratos.
- Chat: ações de gravação/transcrição de áudio (`start`, `stop review`, `send now`, polling de transcrição e fallback de MIME) foram extraídas para `apps/frontend-service/src/pages/Chat/useChatRecordingActions.ts`, reduzindo `Chat/index.tsx` de 2263 para 2045 linhas sem alterar contratos.
- Chat: ações de anexos de mídia (`upload`, `remove`, `clear`) foram extraídas para `apps/frontend-service/src/pages/Chat/useChatMediaAttachmentActions.ts`, reduzindo `Chat/index.tsx` de 2045 para 1929 linhas sem alterar contratos.
- Chat: orquestração de diagnóstico de stream (`resolve status`, `push event`, `create status event`) foi extraída para `apps/frontend-service/src/pages/Chat/useChatStreamDiagnostics.ts`, reduzindo `Chat/index.tsx` de 1929 para 1889 linhas sem alterar contratos.
- Chat: composição de filtros de conversa por querystring (`routeContextFromQuery`, date-range filter e clear action) foi extraída para `apps/frontend-service/src/pages/Chat/useChatConversationFilters.ts`, reduzindo `Chat/index.tsx` de 1889 para 1857 linhas sem alterar contratos.
- Chat: ações do composer (`handleRegenerate`, `handleStopStreaming`, `handleSend`, `handleSubmit`) foram extraídas para `apps/frontend-service/src/pages/Chat/useChatComposerActions.ts`, reduzindo `Chat/index.tsx` de 1857 para 1811 linhas sem alterar contratos.
- Chat: estado/sincronização de roteamento de agentes (modo, agentes selecionados, source/debug e validação de seleção) foi extraído para `apps/frontend-service/src/pages/Chat/useChatRoutingState.ts`, reduzindo `Chat/index.tsx` de 1811 para 1772 linhas sem alterar contratos.
- Chat: side-effects de lifecycle/sincronização de refs (drawer mobile, reset de sync, cleanup de gravação e estado de `recordingStarting`) foram extraídos para `apps/frontend-service/src/pages/Chat/useChatPageLifecycle.ts`, reduzindo `Chat/index.tsx` de 1772 para 1751 linhas sem alterar contratos.
- Chat: mutação principal de stream SSE (`sendMessage`) foi extraída para `apps/frontend-service/src/pages/Chat/chat-stream-mutation.ts` (com contrato tipado de routing/debug), reduzindo `Chat/index.tsx` de 1751 para 1231 linhas sem alterar contratos.
- Trading: handlers residuais de interação (`prefillSellOrderFromAsset`, `handleIntervalChange`, `openReviewDialogById`) foram extraídos para `apps/frontend-service/src/components/trading/useTradingPageInteractionHandlers.ts`, reduzindo `Trading.tsx` de 2350 para 2324 linhas sem alterar contratos.
- WisePayments: navegação de workspace/tabs e parser JSON seguro foram extraídos para `apps/frontend-service/src/pages/wise-payments/use-wise-navigation-state.ts` e `apps/frontend-service/src/pages/wise-payments/use-wise-json-parser.ts`, reduzindo `WisePayments.tsx` de 1000 para 968 linhas sem alterar contratos.

## Arquitetura (resumo)

- **Gate 2**: LLM local (Qwen2.5 7B) + Vision/Imagens via OpenAI.
- **GPU local**: LLM + Embeddings (always-on) e Training sob demanda; ASR via OpenAI.
- **LoRA Adapters**: Adapters globais treinados via QLoRA, carregados dinamicamente no vLLM para inferência melhorada.
- **RAG Trading**: Consulta contextual a documentos/learnings de trading para enriquecer sinais IA e post-mortems.
- **Feedback Loop**: Post-mortems completados são automaticamente indexados no RAG, criando ciclo de evolução contínua.
- **Demo Trading**: Página `/demo-trading` com simulação enterprise (Spot/Futures/Margin), balances auditáveis e scheduler automático.
- **Snapshot Store**: Evidências de mercado (entry/exit/candles/orderbook) em JSONB comprimido para rastreabilidade completa.
- **Aprovar Demo**: Botão na aba "Sinais IA" da página Trading converte sinais em ordens Demo (complementar ao "Aprovar" Real).
- **RBAC**: painel de usuários/grupos/permissões e controle de Core via `admin:alice_core:write`.
- **Onboarding seguro**: novos usuários entram como `guest` e criação é restrita a administradores.
- **Deploy**: multi-stack modular com rollback cirúrgico.
- **Frontend Workspaces (P2)**: páginas operacionais com segmentação por contexto (incluindo Chat com `Conversa`, `Operações`, `Governança` e `Diagnóstico`) para reduzir carga cognitiva sem alterar contratos backend.
- **Padrões UI compartilhados (P2)**: `WorkspaceFilterBar` e `EmptyState` centralizados em `apps/frontend-service/src/components/ui/` e reutilizados em `Trading`, `WisePayments`, `Training`, `Chat`, `Documents`, `Agents`, `Namespaces`, `UsersAdmin` e `DemoTrading`, incluindo expansão de empty states críticos em `DemoTrading`, `Trading`, `UsersAdmin` e `Documents` para reduzir duplicação e divergência visual.
- **Tabela vazia padronizada (P2)**: `TableEmptyRow` centralizado em `apps/frontend-service/src/components/ui/table-empty-row.tsx` e adotado no `UsersAdmin` para estados sem dados nas tabelas de usuários, permissões e permissões customizadas.
- **Diálogo de usuários mais consistente (P2)**: estado sem grupos disponíveis no diálogo de `UsersAdmin` passou a usar `EmptyState`, alinhando comportamento visual com os demais fluxos de vazio.
- **Decomposição incremental de mega-página (P2)**: abas `users`, `groups`, `roles` e `permissions` de `UsersAdmin` foram extraídas para `apps/frontend-service/src/pages/users-admin/components/users-tab-content.tsx`, `apps/frontend-service/src/pages/users-admin/components/groups-tab-content.tsx`, `apps/frontend-service/src/pages/users-admin/components/roles-tab-content.tsx` e `apps/frontend-service/src/pages/users-admin/components/permissions-tab-content.tsx`, reduzindo acoplamento do container principal sem alterar contratos de API/RBAC.
- **Decomposição incremental de dialogs (P2)**: diálogo de permissões de role customizada do `UsersAdmin` foi extraído para `apps/frontend-service/src/pages/users-admin/components/custom-role-permissions-dialog.tsx`, mantendo debounce/save queue de permissões no container e reduzindo complexidade do entrypoint.
- **Decomposição incremental do diálogo de usuário (P2)**: seções `profile`, `roles`, `customRoles` e `groups` do diálogo principal de `UsersAdmin` foram extraídas para `apps/frontend-service/src/pages/users-admin/components/user-dialog-profile-section.tsx`, `user-dialog-roles-section.tsx`, `user-dialog-custom-roles-section.tsx` e `user-dialog-groups-section.tsx`, mantendo `UsersAdmin.tsx` como container de estado/mutações e reduzindo complexidade cognitiva sem alterar contratos de API/RBAC.
- **Decomposição incremental de Documents (P2)**: conteúdos das tabs `documents` e `media` foram extraídos para `apps/frontend-service/src/pages/documents/components/documents-tab-content.tsx` e `apps/frontend-service/src/pages/documents/components/media-tab-content.tsx`, mantendo `apps/frontend-service/src/pages/Documents.tsx` como container de estado/mutações/render callbacks sem alterar contratos de API.
- **Decomposição incremental de dialogs operacionais em Documents (P2)**: dialogs de upload, confirmação de exclusão e envio de mídia para treinamento foram extraídos para `apps/frontend-service/src/pages/documents/components/upload-dialog.tsx`, `delete-confirm-dialog.tsx` e `media-send-training-dialog.tsx`, mantendo `Documents.tsx` como orchestrator de estado/mutações sem alterar contratos.
- **Decomposição incremental de upload zone em Documents (P2)**: componente de dropzone/upload foi extraído para `apps/frontend-service/src/pages/documents/components/upload-zone.tsx`, removendo implementação inline de `Documents.tsx` e mantendo o fluxo de envio real sem alteração de contrato.
- **Decomposição incremental de viewer em Documents (P2)**: diálogo de visualização/edição de documento foi extraído para `apps/frontend-service/src/pages/documents/components/document-viewer-dialog.tsx`, mantendo `Documents.tsx` como orchestrator de estado/mutações e preservando contratos de API.
- **Decomposição incremental de cards em Documents (P2)**: componentes de apresentação `DocumentCard` e `MediaCard` foram extraídos para `apps/frontend-service/src/pages/documents/components/document-card.tsx` e `apps/frontend-service/src/pages/documents/components/media-card.tsx`, reduzindo o acoplamento visual do container sem alterar contratos de API.
- **Decomposição incremental de workspace header em Documents (P2)**: cabeçalho operacional (título, badges de métricas, filtros de workspace e tabs) foi extraído para `apps/frontend-service/src/pages/documents/components/documents-workspace-header.tsx`, mantendo `Documents.tsx` focado em estado/mutações.
- **Decomposição incremental de types/config em Documents (P2)**: contratos e configuração de workspace/tabs/status foram extraídos para `apps/frontend-service/src/pages/documents/types.ts` e `apps/frontend-service/src/pages/documents/config.ts`, reduzindo densidade estrutural do container e preservando comportamento.
- **Decomposição incremental de formulários em UsersAdmin (P2)**: dialogs de formulário de grupos, roles customizadas e permissões foram extraídos para `apps/frontend-service/src/pages/users-admin/components/group-form-dialog.tsx`, `custom-role-form-dialog.tsx` e `permission-form-dialog.tsx`; schemas/helpers e tipos de domínio foram centralizados em `apps/frontend-service/src/pages/users-admin/form-schemas.ts` e `apps/frontend-service/src/pages/users-admin/types.ts`.
- **Decomposição incremental de gestão de membros em UsersAdmin (P2)**: diálogo de gestão de membros de grupo foi extraído para `apps/frontend-service/src/pages/users-admin/components/group-members-dialog.tsx`, mantendo `UsersAdmin.tsx` como container de estado/mutações e preservando contratos de API/RBAC.
- **Decomposição incremental de orquestração de permissões em UsersAdmin (P2)**: debounce/save queue de permissões por role e custom role foi extraído para `apps/frontend-service/src/pages/users-admin/hooks/use-role-permission-orchestration.ts`, reduzindo densidade do container e preservando contratos de API/RBAC.
- **Decomposição incremental de lifecycle de usuário em UsersAdmin (P2)**: fluxos de criação/edição/salvamento/status de usuário foram extraídos para `apps/frontend-service/src/pages/users-admin/hooks/use-user-management.ts`, mantendo validações/toasts/mutações existentes e reduzindo acoplamento do container principal.
- **Decomposição incremental de mutações em Documents (P2)**: mutações de upload, exclusão, envio para treinamento e reprocessamento foram extraídas para `apps/frontend-service/src/pages/documents/hooks/use-documents-mutations.ts`, reduzindo densidade do container e preservando contratos de API.
- **Decomposição incremental de orquestração de dialogs em Documents (P2)**: handlers de abertura/fechamento/confirmação dos dialogs de exclusão e envio para treinamento foram extraídos para `apps/frontend-service/src/pages/documents/hooks/use-documents-dialog-orchestration.ts`, mantendo `Documents.tsx` como composition root e reduzindo acoplamento de estado transiente.
- **Decomposição incremental de estado derivado/filtros em Documents (P2)**: filtros, stats, namespace map e listas derivadas de documentos/mídias foram extraídos para `apps/frontend-service/src/pages/documents/hooks/use-documents-derived-state.ts`, reduzindo lógica inline no container sem alterar contratos de API.
- **Decomposição incremental da aba de ordens em Trading (P2)**: a aba `orders` foi extraída para `apps/frontend-service/src/components/trading/TradingOrdersTabContent.tsx`, mantendo `Trading.tsx` como composition root e reduzindo acoplamento visual/operacional da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba portfolio-auto em Trading (P2)**: a aba `portfolio-auto` foi extraída para `apps/frontend-service/src/components/trading/TradingPortfolioAutoTabContent.tsx`, mantendo `Trading.tsx` como composition root e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba signals-auto em Trading (P2)**: a aba `signals-auto` foi extraída para `apps/frontend-service/src/components/trading/TradingSignalsAutoTabContent.tsx`, mantendo `Trading.tsx` como composition root e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba lab em Trading (P2)**: a aba `lab` foi extraída para `apps/frontend-service/src/components/trading/TradingLabTabContent.tsx`, mantendo `Trading.tsx` como composition root e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental das abas control/account em Trading (P2)**: as abas `control` e `account` foram extraídas para `apps/frontend-service/src/components/trading/TradingControlTabContent.tsx` e `apps/frontend-service/src/components/trading/TradingAccountTabContent.tsx`, mantendo `Trading.tsx` como composition root e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba positions em Trading (P2)**: a aba `positions` foi extraída para `apps/frontend-service/src/components/trading/TradingPositionsTabContent.tsx`, mantendo `Trading.tsx` como composition root e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental das abas history/postmortems em Trading (P2)**: as abas `history` e `postmortems` foram extraídas para `apps/frontend-service/src/components/trading/TradingHistoryTabContent.tsx` e `apps/frontend-service/src/components/trading/TradingPostMortemsTabContent.tsx`, mantendo `Trading.tsx` como composition root e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da seção de resultados de signals em Trading (P2)**: o bloco de detalhe/lista/aprovação da aba `signals` foi extraído para `apps/frontend-service/src/components/trading/TradingSignalsResultsSection.tsx`, mantendo `Trading.tsx` como composition root e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da seção de scheduler de signals em Trading (P2)**: o bloco de configuração/status/salvamento do scheduler da aba `signals` foi extraído para `apps/frontend-service/src/components/trading/TradingSignalsSchedulerSection.tsx`, mantendo `Trading.tsx` como composition root e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da seção de configuração de perfil de signals em Trading (P2)**: o bloco de timeframes/indicadores/técnicas/ensemble/arbitragem/fontes da aba `signals` foi extraído para `apps/frontend-service/src/components/trading/TradingSignalsProfileConfigurationSection.tsx`, mantendo `Trading.tsx` como composition root e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da seção de news/actions de signals em Trading (P2)**: o bloco de `NewsConfigEditor` e ações operacionais (`save profile`, `generate now`, `create/update preset`) da aba `signals` foi extraído para `apps/frontend-service/src/components/trading/TradingSignalsNewsAndActionsSection.tsx`, mantendo `Trading.tsx` como composition root e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental do diálogo de criação de signals em Trading (P2)**: o diálogo de novo sinal da aba `signals` foi extraído para `apps/frontend-service/src/components/trading/TradingNewSignalDialog.tsx`, mantendo `Trading.tsx` como composition root de estado/mutações e reduzindo acoplamento visual sem alterar contratos de API.
- **Decomposição incremental do diálogo de envio de post-mortem em Trading (P2)**: o diálogo de envio para treinamento foi extraído para `apps/frontend-service/src/components/trading/TradingPostmortemTrainingDialog.tsx`, mantendo `Trading.tsx` como composition root de estado/mutações e reduzindo acoplamento visual sem alterar contratos de API.
- **Decomposição incremental do diálogo de revisão de ordem em Trading (P2)**: o diálogo de revisão/aprovação de ordens pendentes foi extraído para `apps/frontend-service/src/components/trading/TradingReviewOrderDialog.tsx`, mantendo `Trading.tsx` como composition root de estado/mutações e reduzindo acoplamento visual sem alterar contratos de API.
- **Decomposição incremental do diálogo de configuração de risco em Trading (P2)**: o diálogo de limites/defaults de risco foi extraído para `apps/frontend-service/src/components/trading/TradingRiskConfigDialog.tsx`, mantendo `Trading.tsx` como composition root de estado/mutações e reduzindo acoplamento visual sem alterar contratos de API.
- **Decomposição incremental do diálogo de nova ordem em Trading (P2)**: o diálogo operacional de criação de ordens (resumo, conversão contratos/USDT, leverage e SL/TP) foi extraído para `apps/frontend-service/src/components/trading/TradingNewOrderDialog.tsx`, mantendo `Trading.tsx` como composition root de estado/mutações e reduzindo acoplamento visual sem alterar contratos de API.
- **Decomposição incremental das abas analysis/chart/orderbook em Trading (P2)**: os blocos inline dessas abas foram extraídos para `apps/frontend-service/src/components/trading/TradingAnalysisTabContent.tsx`, `TradingChartTabContent.tsx` e `TradingOrderBookTabContent.tsx`, mantendo `Trading.tsx` como composition root de estado/mutações e reduzindo densidade residual da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba overview em Trading (P2)**: o bloco operacional da aba `overview` (quick trade, resumo de conta, sinais recentes e ordens recentes) foi extraído para `apps/frontend-service/src/components/trading/TradingOverviewTabContent.tsx`, mantendo `Trading.tsx` como composition root de estado/mutações e reduzindo densidade residual da mega-página sem alterar contratos de API.
- **Decomposição incremental das linhas de métricas em Trading (P2)**: os cards de métricas de mercado/conta e status operacional foram extraídos para `apps/frontend-service/src/components/trading/TradingStatsRows.tsx` (`TradingStatsPrimaryRow` e `TradingStatsSecondaryRow`), removendo helpers inline de `Trading.tsx` e reduzindo densidade residual sem alterar contratos de API.
- **Decomposição incremental do header operacional em Trading (P2)**: o bloco de título/status, seletores de mercado/símbolo, ações de favoritos/destaques, indicador WS e acesso a risco foi extraído para `apps/frontend-service/src/components/trading/TradingHeaderSection.tsx`, mantendo `Trading.tsx` como composition root de estado/mutações e reduzindo densidade residual sem alterar contratos de API.
- **Decomposição incremental de alertas operacionais em Trading (P2)**: os alertas de erro crítico de upstream e de trading desabilitado foram extraídos para `apps/frontend-service/src/components/trading/TradingOperationalAlerts.tsx`, removendo lógica de apresentação inline de `Trading.tsx` e mantendo contratos de API sem alteração.
- **Decomposição incremental do shell de navegação de tabs em Trading (P2)**: a estrutura compartilhada de `Tabs + WorkspaceFilterBar + TabsList/TabsTrigger` foi extraída para `apps/frontend-service/src/components/trading/TradingTabsShell.tsx`, mantendo `Trading.tsx` focado em estado/orquestração e preservando contratos de API.
- **Decomposição incremental da aba signals em Trading (P2)**: a aba operacional de sinais (`perfil + news/actions + scheduler + resultados`) foi extraída para `apps/frontend-service/src/components/trading/TradingSignalsTabContent.tsx`, mantendo `Trading.tsx` como composition root de estado/mutações e reduzindo densidade residual sem alterar contratos de API.
- **Decomposição incremental da seção de dialogs em Trading (P2)**: o bloco de dialogs operacionais (`nova ordem`, `OCO`, `review`, `risk config`, `post-mortem->training`, `novo sinal`) foi extraído para `apps/frontend-service/src/components/trading/TradingDialogsSection.tsx`, mantendo `Trading.tsx` como composition root de estado/mutações e reduzindo densidade residual sem alterar contratos de API.
- **Decomposição incremental das abas operacionais residuais em Trading (P2)**: as abas `history`, `postmortems`, `chart`, `orderbook`, `control` e `account` foram agrupadas em `apps/frontend-service/src/components/trading/TradingOperationalTabsSection.tsx`, mantendo `Trading.tsx` como composition root de estado/mutações e reduzindo densidade residual sem alterar contratos de API.
- **Decomposição incremental das abas primárias em Trading (P2)**: as abas `overview`, `portfolio-auto`, `signals-auto`, `lab`, `orders`, `positions`, `signals` e `analysis` foram agrupadas em `apps/frontend-service/src/components/trading/TradingPrimaryTabsSection.tsx`, mantendo `Trading.tsx` como composition root de estado/mutações e reduzindo densidade residual sem alterar contratos de API.
- **Decomposição incremental da aba balances em WisePayments (P2)**: a aba `balances` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-balances-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba exchange em WisePayments (P2)**: a aba `exchange` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-exchange-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba transfers em WisePayments (P2)**: a aba `transfers` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-transfers-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba recipients em WisePayments (P2)**: a aba `recipients` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-recipients-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba quotes em WisePayments (P2)**: a aba `quotes` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-quotes-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba batch em WisePayments (P2)**: a aba `batch` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-batch-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba profiles em WisePayments (P2)**: a aba `profiles` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-profiles-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba users em WisePayments (P2)**: a aba `users` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-users-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba activities em WisePayments (P2)**: a aba `activities` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-activities-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba statements em WisePayments (P2)**: a aba `statements` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-statements-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba account-details em WisePayments (P2)**: a aba `account-details` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-account-details-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba cards em WisePayments (P2)**: a aba `cards` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-cards-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba card-orders em WisePayments (P2)**: a aba `card-orders` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-card-orders-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba card-transactions em WisePayments (P2)**: a aba `card-transactions` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-card-transactions-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba spend-limits em WisePayments (P2)**: a aba `spend-limits` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-spend-limits-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba spend-controls em WisePayments (P2)**: a aba `spend-controls` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-spend-controls-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba disputes em WisePayments (P2)**: a aba `disputes` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-disputes-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba kyc em WisePayments (P2)**: a aba `kyc` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-kyc-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba webhooks em WisePayments (P2)**: a aba `webhooks` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-webhooks-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba simulations em WisePayments (P2)**: a aba `simulations` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-simulations-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba sca em WisePayments (P2)**: a aba `sca` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-sca-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba catalog em WisePayments (P2)**: a aba `catalog` foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-catalog-tab-content.tsx`, mantendo `WisePayments.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da navegação/workspaces em WisePayments (P2)**: catálogo de tabs, mapeamento de workspaces e tipos (`WiseTabKey`/`WiseWorkspaceKey`) foram extraídos para `apps/frontend-service/src/pages/wise-payments/wise-payments-navigation.ts`, reduzindo `WisePayments.tsx` para 3183 linhas sem alterar contratos de API.
- **Decomposição incremental do guard de queries em WisePayments (P2)**: bloqueio temporário de queries após `401/429` e tratamento centralizado de erro foram extraídos para `apps/frontend-service/src/pages/wise-payments/use-wise-query-guard.ts` e aplicados em `WisePayments.tsx`, reduzindo o container para 3133 linhas sem alterar contratos de API.
- **Decomposição incremental dos handlers de referência em WisePayments (P2)**: estados e handlers operacionais de `balanceCapacity`, `totalFunds`, `rates` e `recipientRequirements` foram extraídos para `apps/frontend-service/src/pages/wise-payments/use-wise-reference-actions.ts` e aplicados em `WisePayments.tsx`, reduzindo o container para 3070 linhas sem alterar contratos de API.
- **Decomposição incremental dos handlers de transferência/cartões em WisePayments (P2)**: estados e handlers de `fund/cancel transfer`, permissões de cartão e fluxos `card secure` foram extraídos para `apps/frontend-service/src/pages/wise-payments/use-wise-transfer-and-card-actions.ts` e aplicados em `WisePayments.tsx`, reduzindo o container para 2949 linhas sem alterar contratos de API.
- **Decomposição incremental do upload de arquivos em WisePayments (P2)**: estado e handlers de upload para disputas/KYC (`dispute`, `kyc document`, `kyc additional`) foram extraídos para `apps/frontend-service/src/pages/wise-payments/use-wise-file-upload-state.ts` e aplicados em `WisePayments.tsx`, reduzindo o container para 2900 linhas sem alterar contratos de API.
- **Decomposição incremental do catalog workbench em WisePayments (P2)**: estado/efeitos/handler de execução do catálogo (`catalogOperationId`, `catalogParams`, `handleRunCatalogOperation`) foram extraídos para `apps/frontend-service/src/pages/wise-payments/use-wise-catalog-workbench.ts` e aplicados em `WisePayments.tsx`, reduzindo o container para 2829 linhas sem alterar contratos de API.
- **Decomposição incremental dos fluxos webhooks/simulations/sca em WisePayments (P2)**: estado e mutações de `webhooks`, `simulations` e `sca` foram extraídos para `apps/frontend-service/src/pages/wise-payments/use-wise-webhook-simulation-sca-actions.ts` e aplicados em `WisePayments.tsx`, reduzindo o container para 2586 linhas sem alterar contratos de API.
- **Decomposição incremental dos fluxos account-details/card-orders/disputes em WisePayments (P2)**: estado, mutações e handlers de `account-details`, `card-orders`, `card-transactions`, `disputes` e `kyc` foram extraídos para `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-actions.ts` e aplicados em `WisePayments.tsx`, reduzindo o container para 2076 linhas sem alterar contratos de API.
- **Decomposição incremental dos fluxos users/activities em WisePayments (P2)**: estado, mutações e handlers de `users` e `activities` foram extraídos para `apps/frontend-service/src/pages/wise-payments/use-wise-user-activity-actions.ts` e aplicados em `WisePayments.tsx`, reduzindo o container para 2025 linhas sem alterar contratos de API.
- **Decomposição incremental dos fluxos balances/quotes/exchange/statements em WisePayments (P2)**: estado, mutações e handlers de `balances`, `quotes`, `exchange` e `statements` foram extraídos para `apps/frontend-service/src/pages/wise-payments/use-wise-balance-exchange-statement-actions.ts` e aplicados em `WisePayments.tsx`, reduzindo o container para 1826 linhas sem alterar contratos de API.
- **Decomposição incremental dos fluxos cards/spend-controls/spend-limits em WisePayments (P2)**: estado, mutações e handlers de `cards`, `spend-controls` e `spend-limits` foram extraídos para `apps/frontend-service/src/pages/wise-payments/use-wise-card-spend-actions.ts` e aplicados em `WisePayments.tsx`, reduzindo o container para 1518 linhas sem alterar contratos de API.
- **Decomposição incremental dos fluxos recipients em WisePayments (P2)**: estado/transições de diálogo e deleção de recipient foram extraídos para `apps/frontend-service/src/pages/wise-payments/use-wise-recipient-actions.ts` e aplicados em `WisePayments.tsx`, reduzindo o container para 1503 linhas sem alterar contratos de API.
- **Decomposição incremental da aba jobs em Training (P2)**: a aba `jobs` foi extraída para `apps/frontend-service/src/pages/training/components/training-jobs-tab-content.tsx`, mantendo `Training.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba auto-learning em Training (P2)**: a aba `auto-learning` foi extraída para `apps/frontend-service/src/pages/training/components/training-auto-learning-tab-content.tsx`, mantendo `Training.tsx` como composition root de estado/mutações e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba data em Training (P2)**: a aba `data` foi extraída para `apps/frontend-service/src/pages/training/components/training-data-tab-content.tsx`, mantendo `Training.tsx` como composition root de estado/mutações, preservando handlers de review em lote e reduzindo acoplamento da mega-página sem alterar contratos de API.
- **Decomposição incremental da aba bulk-import em Training (P2)**: a aba `bulk-import` foi extraída para `apps/frontend-service/src/pages/training/components/training-bulk-import-tab-content.tsx`, mantendo `Training.tsx` como composition root de estado/mutações, preservando validação Zod + fluxo de importação em lote sem alterar contratos de API.
- **Decomposição incremental da aba multimodal em Training (P2)**: a aba `multimodal` foi extraída para `apps/frontend-service/src/pages/training/components/training-multimodal-tab-content.tsx`, mantendo `Training.tsx` como composition root de estado/mutações e preservando upload/processamento/promoção multimodal sem alterar contratos de API.
- **Decomposição incremental do diálogo on-demand em Training (P2)**: o diálogo `on-demand run` foi extraído para `apps/frontend-service/src/pages/training/components/training-on-demand-run-dialog.tsx`, mantendo `Training.tsx` como composition root de estado/mutações e preservando fluxo de execução manual sem alterar contratos de API.
- **Decomposição incremental do diálogo de review em lote em Training (P2)**: o diálogo `batch review` foi extraído para `apps/frontend-service/src/pages/training/components/training-batch-review-dialog.tsx`, mantendo `Training.tsx` como composition root de estado/mutações e preservando confirmação de aprovação/rejeição em lote sem alterar contratos de API.
- **Decomposição incremental do diálogo de review individual em Training (P2)**: o diálogo `review` foi extraído para `apps/frontend-service/src/pages/training/components/training-review-dialog.tsx`, mantendo `Training.tsx` como composition root de estado/mutações e preservando o fluxo de aprovação/rejeição com override de escopo sem alterar contratos de API.
- **Decomposição incremental do diálogo de resolução de escopo em Training (P2)**: o diálogo `resolve scope` foi extraído para `apps/frontend-service/src/pages/training/components/training-resolve-scope-dialog.tsx`, mantendo `Training.tsx` como composition root de estado/mutações e preservando fluxo de relink/criação de namespace sugerido sem alterar contratos de API.
- **Decomposição incremental do diálogo de promoção em Training (P2)**: o diálogo `promote` foi extraído para `apps/frontend-service/src/pages/training/components/training-promote-dialog.tsx`, mantendo `Training.tsx` como composition root de estado/mutações e preservando o fluxo de promoção sem alterar contratos de API.
- **Decomposição incremental do diálogo de rollback em Training (P2)**: o diálogo `rollback` foi extraído para `apps/frontend-service/src/pages/training/components/training-rollback-dialog.tsx`, mantendo `Training.tsx` como composition root de estado/mutações e preservando validação de motivo/auditoria sem alterar contratos de API.
- **Decomposição incremental do diálogo pós-treinamento em Training (P2)**: o diálogo `post-training` foi extraído para `apps/frontend-service/src/pages/training/components/training-post-training-dialog.tsx`, mantendo `Training.tsx` como composition root de estado/mutações e preservando o fluxo de retorno ao chat sem alterar contratos de API.
- **Decomposição incremental do card de dados em Training (P2)**: o componente `TrainingDataCard` foi extraído para `apps/frontend-service/src/pages/training/components/training-data-card.tsx`, mantendo `Training.tsx` como composition root de estado/mutações e preservando seleção/review/relink de datasets sem alterar contratos de API.
- **Decomposição incremental do card de job em Training (P2)**: o componente `TrainingJobCard` foi extraído para `apps/frontend-service/src/pages/training/components/training-job-card.tsx`, mantendo `Training.tsx` como composition root de estado/mutações e preservando ações de promoção/aprovação/rollback sem alterar contratos de API.
- **Decomposição incremental do modal de detalhe de job em Training (P2)**: o componente `TrainingJobDetailModal` foi extraído para `apps/frontend-service/src/pages/training/components/training-job-detail-modal.tsx`, mantendo stream SSE + trilha de auditoria sem alterar contratos de API.
- **Decomposição incremental do diálogo de criação de job em Training (P2)**: o componente `TrainingCreateJobDialog` foi extraído para `apps/frontend-service/src/pages/training/components/training-create-job-dialog.tsx`, mantendo validação Zod e idempotência por `X-Idempotency-Key` sem alterar contratos de API.
- **Governança de utilitários de requisição de training (P2)**: funções de idempotência e `retry-after hint` foram centralizadas em `apps/frontend-service/src/pages/training/training-request-utils.ts`, reduzindo duplicação no container `Training.tsx`.
- **Decomposição incremental dos utilitários de exibição de Trading (P2)**: badges e formatadores (`SIGNAL_TYPES`, `SignalTypeBadge`, `OrderStatusBadge`, `formatDecisionSummary`) foram extraídos para `apps/frontend-service/src/components/trading/TradingDisplayUtils.tsx` e reexportados no barrel `components/trading/index.ts`, reduzindo densidade do container `Trading.tsx` sem alterar contratos de API.
- **Decomposição incremental da configuração de sinais de Trading (P2)**: catálogos e defaults (`SIGNAL_INDICATOR_OPTIONS`, `TRADING_TECHNIQUE_OPTIONS`, `AUTO_SIGNAL_MODE_OPTIONS`, `DEFAULT_*`) foram extraídos para `apps/frontend-service/src/components/trading/TradingSignalConfig.ts` e reexportados no barrel `components/trading/index.ts`, reduzindo densidade do container `Trading.tsx` sem alterar contratos de API.
- **Decomposição incremental da navegação de Trading (P2)**: tipos e catálogos de navegação/workspace (`TradingTabKey`, `TradingWorkspaceKey`, `TRADING_TAB_DESCRIPTORS`, `TRADING_WORKSPACE_*`, `findWorkspaceForTradingTab`) foram extraídos para `apps/frontend-service/src/components/trading/TradingNavigationConfig.ts` e reexportados no barrel `components/trading/index.ts`, reduzindo densidade do container `Trading.tsx` sem alterar contratos de API.
- **Decomposição incremental dos utilitários de página de Trading (P2)**: helpers puros de símbolo/duração (`getQuoteCurrencyFromSymbol`, `getBaseCurrencyFromSymbol`, `formatDurationMinutes`) foram extraídos para `apps/frontend-service/src/components/trading/TradingPageUtils.ts` e reexportados no barrel `components/trading/index.ts`, reduzindo densidade do container `Trading.tsx` sem alterar contratos de API.
- **Decomposição incremental dos contratos de domínio de Trading (P2)**: tipos de payload/conta/sinal/ordem, guards de margem (`isMarginCrossAccount`, `isMarginIsolatedAccount`) e presets de animação foram extraídos para `apps/frontend-service/src/components/trading/TradingDomainTypes.ts` e reexportados no barrel `components/trading/index.ts`, reduzindo o container `Trading.tsx` de 3649 para 3320 linhas sem alterar contratos de API.
- **Decomposição incremental dos defaults de formulários de Trading (P2)**: factories tipadas de inicialização/reset (`createDefault*`, `create*FromConfig`) foram extraídas para `apps/frontend-service/src/components/trading/TradingFormDefaults.ts` e aplicadas em `Trading.tsx`, removendo duplicação de estado e reduzindo o container para 3232 linhas sem alterar contratos de API.
- **Decomposição incremental do hook de perfil de sinais em Trading (P2)**: estado/updaters/reconciliação de arbitragem do `signalProfile` foram extraídos para `apps/frontend-service/src/components/trading/useTradingSignalProfileState.ts` e aplicados em `Trading.tsx`, reduzindo o container para 3178 linhas sem alterar contratos de API.
- **Decomposição incremental do hook de sizing de ordens em Trading (P2)**: cálculo de preço corrente/`contractMultiplier` e handlers de conversão (`size` <-> `usdtAmount`) foram extraídos para `apps/frontend-service/src/components/trading/useTradingOrderSizing.ts` e aplicados em `Trading.tsx`, reduzindo o container para 3137 linhas sem alterar contratos de API.
- **Decomposição incremental dos cálculos de resumo de ordem em Trading (P2)**: validação de submit e estimativas de PnL (`canSubmitOrder`, preço efetivo, leverage e SL/TP) foram extraídos para `apps/frontend-service/src/components/trading/TradingOrderSummary.ts` e aplicados em `Trading.tsx`, reduzindo o container para 3116 linhas sem alterar contratos de API.
- **Decomposição incremental do hook de presets de notícias em Trading (P2)**: query/mutações e regras de seleção/criação/atualização/remoção de presets de notícias foram extraídas para `apps/frontend-service/src/components/trading/useTradingNewsPresets.ts` e aplicadas em `Trading.tsx`, reduzindo o container para 3080 linhas sem alterar contratos de API.
- **Decomposição incremental do hook de histórico de ordens em Trading (P2)**: estado, paginação, seleção em lote e exclusão de histórico foram extraídos para `apps/frontend-service/src/components/trading/useTradingOrderHistory.ts` e aplicados em `Trading.tsx`, reduzindo o container para 3006 linhas sem alterar contratos de API.
- **Decomposição incremental da navegação de workspaces/tabs em Trading (P2)**: estado e handlers de navegação (`activeTab`, `activeWorkspace`, troca de tabs/workspaces e reconciliação automática) foram extraídos para `apps/frontend-service/src/components/trading/useTradingWorkspaceNavigation.ts` e aplicados em `Trading.tsx`, reduzindo o container para 2987 linhas sem alterar contratos de API.
- **Decomposição incremental da normalização de mensagens no Chat (P2)**: normalização de payload servidor, mapeamento de anexos legados e snapshot de usuário foram extraídos para `apps/frontend-service/src/pages/Chat/chat-message-normalization.ts` e aplicados em `Chat/index.tsx`, reduzindo o container para 2737 linhas sem alterar contratos de API.
- **Decomposição incremental da lista de conversas no Chat (P2)**: `ConversationsList` foi extraída para `apps/frontend-service/src/pages/Chat/components/ConversationsList.tsx` e integrada ao container principal, reduzindo `Chat/index.tsx` para 2558 linhas sem alterar contratos de API.
- **Decomposição incremental do hook mobile no Chat (P2)**: detecção de viewport mobile foi extraída para `apps/frontend-service/src/pages/Chat/useIsMobileViewport.ts` e aplicada em `Chat/index.tsx`, reduzindo o container para 2536 linhas sem alterar contratos de API.
- **Decomposição incremental dos hooks de auto-scroll e seleção no Chat (P2)**: comportamento de scroll e seleção em lote/range foi extraído para `apps/frontend-service/src/pages/Chat/useChatAutoScroll.ts` e `apps/frontend-service/src/pages/Chat/useChatSelectionState.ts`, reduzindo `Chat/index.tsx` para 2459 linhas sem alterar contratos de API.
- **Decomposição incremental dos utilitários de rota/sources do Chat (P2)**: roteamento/workspaces/date filters e parsing de `message sources` foram extraídos para `apps/frontend-service/src/pages/Chat/chat-page-routing.ts` e `apps/frontend-service/src/pages/Chat/chat-message-sources.ts`, reduzindo `Chat/index.tsx` de 3075 para 2975 linhas sem alterar contratos de API.
- **Decomposição incremental dos utilitários de gravação de Chat (P2)**: MIME normalization, encoding WAV, conversão e preparo de arquivo de gravação foram extraídos para `apps/frontend-service/src/pages/Chat/chat-recording-utils.ts` e aplicados em `Chat/index.tsx`, reduzindo o container para 2833 linhas sem alterar contratos de API.
- **Decomposição incremental dos utilitários de anexos de mídia do Chat (P2)**: conversão base64 de upload/URL (`fileToBase64` e `mediaAttachmentToBase64`) foi extraída para `apps/frontend-service/src/pages/Chat/chat-media-attachments.ts` e aplicada em `Chat/index.tsx`, reduzindo o container para 2784 linhas sem alterar contratos de API.
- **Decomposição incremental das ações de treinamento/feedback no Chat (P2)**: mutações de envio para treinamento (conversa/mensagens), abertura de dialogs e feedback multimodal (mensagem/imagem) foram extraídas para `apps/frontend-service/src/pages/Chat/useChatTrainingFeedbackActions.ts`, reduzindo `Chat/index.tsx` de 2375 para 2263 linhas sem alterar contratos de API.
- **Decomposição incremental de ações residuais de workspace em Trading (P2)**: handlers de refresh/execução/abertura e mutações de histórico (`OCO`, `positions`, `signals-auto`, `history`, `postmortems`, `risk/review dialogs`) foram extraídos para `apps/frontend-service/src/components/trading/useTradingWorkspaceActionHandlers.ts` e aplicados em `Trading.tsx`, reduzindo callbacks inline sem alterar contratos de API.
- **Decomposição incremental de refresh handlers em WisePayments (P2)**: `use-wise-refresh-actions.ts` passou a expor handlers dedicados de refetch (`account-details`, `profiles`, `users`, `cards`, `card-orders`, `spend-controls`, `disputes`, `kyc`) e `WisePayments.tsx` removeu wrappers inline de refresh, preservando contratos de API.
- **Decomposição incremental dos estados de acesso do wrapper de Trading (P2)**: telas de `loading/auth required/forbidden` do wrapper foram extraídas para `apps/frontend-service/src/components/trading/TradingAccessStates.tsx`, com `Trading.tsx` usando composição explícita de guard states e remoção de markup duplicado sem alterar contratos de API.
- **Decomposição incremental do shell/status de WisePayments (P2)**: navegação de workspaces/tabs foi extraída para `apps/frontend-service/src/pages/wise-payments/components/wise-payments-tabs-shell.tsx` e estados de serviço (`loading/not configured`) para `apps/frontend-service/src/pages/wise-payments/components/wise-payments-status-states.tsx`, reduzindo densidade do container `WisePayments.tsx` sem alterar contratos de API.
- **Decomposição incremental dos estados de serviço de Trading (P2)**: estados de `loading/error/unavailable/not configured/tenant required` foram extraídos para `apps/frontend-service/src/components/trading/TradingServiceStates.tsx` e integrados ao `Trading.tsx`, reduzindo densidade do container principal sem alterar contratos de API.
- **Decomposição incremental de métricas derivadas de Trading (P2)**: cálculos de contagem de posições abertas, resumos de conta (futures/spot/margin) e variação de preço foram extraídos para `apps/frontend-service/src/components/trading/TradingDerivedMetrics.ts`, reduzindo lógica inline no `Trading.tsx` sem alterar contratos de API.
- **Decomposição incremental da composição de props em Trading (P2)**: `apps/frontend-service/src/pages/Trading.tsx` passou a centralizar `props` de tabs/dialogs em objetos nomeados (`primaryTabsSectionProps`, `operationalTabsSectionProps`, `dialogsSectionProps`) consumidos por spread tipado, reduzindo densidade no bloco de render sem alterar contratos de API.
- **Decomposição incremental da orquestração de mutações controle/ordens em Trading (P2)**: `apps/frontend-service/src/components/trading/useTradingControlOrderActionSuite.ts` foi adicionado para compor mutações e handlers de review/order-control, com consumo no `apps/frontend-service/src/pages/Trading.tsx` e reexport no barrel `apps/frontend-service/src/components/trading/index.ts`.
- **Decomposição incremental da navegação e filtros compartilhados em WisePayments (P2)**: `apps/frontend-service/src/pages/wise-payments/use-wise-navigation-presentation.ts` foi adicionado para centralizar opções de tabs/workspaces e `apps/frontend-service/src/pages/WisePayments.tsx` passou a compartilhar `profileFilter/profiles/setProfileFilter` via `profileScopedTabProps` nas tabs de escopo de perfil, reduzindo repetição no container.
- **Decomposição incremental da composição de props operacionais em WisePayments (P2)**: `apps/frontend-service/src/pages/WisePayments.tsx` passou a centralizar a composição de props das tabs de perfil (`account-details/cards/card-orders/card-transactions/spend-controls/disputes/kyc/webhooks/simulations/sca`) em objetos nomeados consumidos por spread tipado, reduzindo densidade da seção de render sem alterar contratos de API.
- **Decomposição incremental de menu de ações e handlers compartilhados em Chat (P2)**: novo componente `apps/frontend-service/src/pages/Chat/components/ChatActionsMenu.tsx` centraliza ações operacionais/diagnóstico para desktop e mobile, enquanto `apps/frontend-service/src/pages/Chat/index.tsx` passou a compartilhar `conversationsListProps` entre sidebar fixa e drawer, além de desacoplar `handleQuickReply` e toggles de UI/seleção para callbacks nomeados.
- **Decomposição incremental da composição de props residuais em WisePayments (P2)**: `apps/frontend-service/src/pages/WisePayments.tsx` passou a centralizar também os props das tabs operacionais não-perfil (`balances`, `exchange`, `transfers`, `recipients`, `quotes`, `batch`, `statements`, `profiles`, `users`, `activities`, `spend-limits`, `catalog`) em objetos nomeados com consumo por spread tipado, reduzindo densidade final de render do container.
- **Decomposição incremental da composição de seções residuais em Trading (P2)**: `apps/frontend-service/src/pages/Trading.tsx` passou a centralizar `props` de `TradingOperationalAlerts`, `TradingHeaderSection`, `TradingStatsPrimaryRow`, `TradingStatsSecondaryRow` e `TradingTabsShell` em objetos nomeados (`operationalAlertsSectionProps`, `headerSectionProps`, `statsPrimarySectionProps`, `statsSecondarySectionProps`, `tabsShellSectionProps`) e a reutilizar `renderOrderStatusBadge`/`renderSignalTypeBadge` compartilhados, reduzindo densidade final do composition root sem alterar contratos.
- **Decomposição incremental dos controles de governança em Chat (P2)**: novo componente `apps/frontend-service/src/pages/Chat/components/ChatGovernanceControls.tsx` passou a concentrar approval policy + routing controls para desktop/mobile; `apps/frontend-service/src/pages/Chat/index.tsx` agora compartilha `chatGovernanceControlsProps` e remove duplicação de markup/handlers no header.
- **Decomposição incremental de memoizações de opções em Trading (P2)**: `apps/frontend-service/src/pages/Trading.tsx` passou a centralizar em memoizações dedicadas (`autoModeOptions`, `signalIndicatorOptions`, `signalIntervalOptions`, `signalTechniqueOptions`) os mapeamentos de opções antes definidos inline no `primaryTabsSectionProps.signalsAutoTabProps/signalsTabProps`, reduzindo repetição e acoplamento de configuração.
- **Decomposição incremental da composição por aba/seção em Trading (P2)**: `apps/frontend-service/src/pages/Trading.tsx` passou a separar props por aba/seção (`analysis/lab/orders/overview/portfolio-auto/positions/signals-auto/signals`, `account/chart/control/history/orderbook/postmortems` e dialogs) antes de montar `primaryTabsSectionProps`, `operationalTabsSectionProps` e `dialogsSectionProps`, melhorando legibilidade e manutenção sem alterar contratos.
- **Governança LLM com trust interno forte (P1)**: mutações em `/api/llm/governance/*` exigem identidade HMAC autenticada com role `admin/super_admin` e bind obrigatório do ator (`payload actor` deve coincidir com usuário autenticado), reduzindo spoofing em aprovações/ativações.
- **Client LLM Gateway com autenticação/tracing enterprise (P1)**: `@alice/shared-utils` agora assina chamadas ao gateway com `generateInternalAuthHeaders` quando há contexto de usuário/tenant, propaga `traceparent`/`x-correlation-id`/`x-request-id` e mantém fallback legado por `X-Internal-Api-Secret` apenas quando não há actor assinável.
- **Observability internal trust hardening (P1)**: `observability-service` passou a marcar autenticação interna validada (HMAC ou secret legado) e reutilizar essa marca nos guards RBAC de leitura/admin/logs, evitando divergência de tratamento entre métodos internos.
- **Training promotion gates ponta a ponta (P1)**: `TRAINING_PROMOTION_REQUIRE_APPROVAL_GATES` passou a integrar o SSOT de `system_config`; promoção manual agora respeita gate explícito de quórum e a auto-promoção agendada é bloqueada quando gates de aprovação estão ativos, mantendo o job em estado candidato até aprovação formal.
- **Tracing distribuído no Observability Service (P1)**: `observability-service` passou a usar `createCorrelationMiddleware` para propagar `traceparent`, `x-correlation-id` e `x-request-id` entre serviços, alinhando o serviço de observabilidade ao padrão de tracing dos demais microsserviços.
- **DR offsite criptografado com verificação operacional (P1)**: `apps/observability-service/src/backup-orchestrator.ts` passou a versionar artefatos por `backupId` (`artifacts/<backupId>`), sincronizar cópia offsite criptografada (OpenSSL AES-256-CBC) quando `BACKUP_OFFSITE_DIR` está configurado e enriquecer `POST /api/backup/verify/:id` com prontidão de restore (checks locais/offsite + pgBackRest verify).

### Modularização P0 do Integrations Service (07/03/2026)

- `apps/integrations-service/src/index.ts` mantém papel de composition root e registro de módulos.
- Rotas já extraídas para `apps/integrations-service/src/routes/`:
  - `postmortem-routes.ts`
  - `demo-trading-routes.ts`
  - `grafana-github-routes.ts`
  - `email-routes.ts`
  - `stripe-routes.ts`
  - `integration-core-routes.ts`
  - `integration-registry-routes.ts`
  - `health-probe-routes.ts`
  - `wise-account-details-routes.ts`
  - `wise-balance-and-quotes-routes.ts`
  - `wise-card-management-routes.ts`
  - `wise-card-orders-routes.ts`
  - `wise-card-secure-routes.ts`
  - `wise-disputes-routes.ts`
  - `wise-spend-controls-routes.ts`
  - `wise-spend-limits-routes.ts`
  - `wise-sca-routes.ts`
  - `wise-simulation-routes.ts`
  - `wise-verification-kyc-routes.ts`
  - `wise-webhook-management-routes.ts`
  - `wise-oauth-routes.ts`
  - `wise-recipients-transfers-routes.ts`
  - `wise-reference-routes.ts`
  - `wise-webhook-routes.ts`
  - `twilio-operational-routes.ts`
  - `twilio-webhook-routes.ts`
  - `trading-account-management-routes.ts`
  - `trading-analysis-routes.ts`
  - `trading-analysis-history-routes.ts`
  - `trading-automation-routes.ts`
  - `trading-control-routes.ts`
  - `trading-dataset-routes.ts`
  - `trading-futures-routes.ts`
  - `trading-margin-routes.ts`
  - `trading-market-data-routes.ts`
  - `trading-market-risk-routes.ts`
  - `trading-order-governance-routes.ts`
  - `trading-scheduler-news-routes.ts`
  - `trading-signal-action-routes.ts`
  - `trading-signal-generation-routes.ts`
  - `trading-signal-history-routes.ts`
  - `trading-spot-routes.ts`
  - `trading-stop-order-routes.ts`
  - `trading-symbol-routes.ts`
  - `trading-validation-routes.ts`
  - `trading-websocket-routes.ts`
- Serviço de canal Twilio extraído para `apps/integrations-service/src/twilio-channel-service.ts` (validação de assinatura + envio WhatsApp), reduzindo lógica de transporte no `index.ts`.
- Rotas de automação de trading (`/api/trading/portfolios`, `/api/trading/candidates`, `/api/trading/rebalances`, `/internal/trading/enqueue/*`, `/api/trading/auto/*`) extraídas para `apps/integrations-service/src/routes/trading-automation-routes.ts`, preservando governança de fila assíncrona e rastreabilidade de auto-runs.
- Rotas de leitura e governança de histórico de sinais (`/api/integrations/trading/signals`, `/api/integrations/trading/signals/history*`) extraídas para `apps/integrations-service/src/routes/trading-signal-history-routes.ts`, preservando filtros avançados, soft-delete/purge e controles de escopo admin/self.
- Rotas de ação de sinais (`POST /api/integrations/trading/signals`, `DELETE /api/integrations/trading/signals/:id`, `POST /api/integrations/trading/signals/:id/approve`, `POST /api/integrations/trading/signals/:id/reject`) extraídas para `apps/integrations-service/src/routes/trading-signal-action-routes.ts`, preservando governança de aprovação training-only (`neutral/hold`) com auditoria e geração de dataset.
- Rotas de governança de ordens (`/api/integrations/trading/orders*`, `/api/integrations/trading/orders/history*`, `/api/integrations/trading/audit/:entityType/:id`, `POST /api/integrations/trading/stop-orders`) consolidadas em `apps/integrations-service/src/routes/trading-order-governance-routes.ts`, preservando review/approve/reject, histórico com cursor/soft-delete, sincronização com geração de dataset e verificação de integridade do audit ledger imutável.
- Rotas de consulta/cancelamento de stop orders (`GET /api/integrations/trading/stop-orders` e `DELETE /api/integrations/trading/stop-orders/:id`) extraídas para `apps/integrations-service/src/routes/trading-stop-order-routes.ts`, preservando validações por mercado, resolução de símbolo e guardrails de configuração KuCoin.
- Rota de geração LLM de sinais (`POST /api/integrations/trading/signals/generate`) extraída para `apps/integrations-service/src/routes/trading-signal-generation-routes.ts`, preservando scan de universo, validações de mercado Spot/Margin/Futures, governança de erro `TRADING_SCOPE_REQUIRED` e payload de validação retornado ao frontend.
- Rotas de datasets de trading (`GET /api/integrations/trading/datasets*`, `POST /api/integrations/trading/datasets/from-signal`, `PATCH /api/integrations/trading/datasets/:id/review`) extraídas para `apps/integrations-service/src/routes/trading-dataset-routes.ts`, preservando governança de qualidade, deduplicação e validação de escopo de namespace.
- Rotas de scheduler/presets de notícias (`/api/integrations/trading/signal-scheduler`, `/api/integrations/trading/analysis-scheduler`, `/api/integrations/trading/news-presets*`) extraídas para `apps/integrations-service/src/routes/trading-scheduler-news-routes.ts`, preservando validações de mercado, governança de arbitragem e aplicação de presets no perfil de análise/sinal.
- Rotas Futures (`/api/integrations/trading/futures/*` e alias legado `/api/integrations/trading/positions/history`) extraídas para `apps/integrations-service/src/routes/trading-futures-routes.ts`, preservando cobertura completa de mercado/ordens/posição/funding e hardening de autenticação KuCoin.
- Rotas Spot (`/api/integrations/trading/spot/*`) extraídas para `apps/integrations-service/src/routes/trading-spot-routes.ts`, preservando cobertura de ticker/ordens/OCO/stop/fills/mercado e guardrails de autenticação/configuração KuCoin.
- Rotas Margin (`/api/integrations/trading/margin/*`) extraídas para `apps/integrations-service/src/routes/trading-margin-routes.ts`, preservando cobertura de ordens/OCO/borrow/repay/juros/risk-limit/market data e guardrails de autenticação/configuração KuCoin.
- Rotas de market data (`/api/integrations/trading/klines*`, `/orderbook*`, `/funding-rate/:symbol`, `/mark-price/:symbol`, `/trades/:symbol`) extraídas para `apps/integrations-service/src/routes/trading-market-data-routes.ts`, preservando hardening de autenticação KuCoin, resolução de símbolo e contratos de erro já existentes.
- Rotas de controle operacional (`GET /api/integrations/trading/control-history` e `POST /api/integrations/trading/control`) extraídas para `apps/integrations-service/src/routes/trading-control-routes.ts`, preservando governança de handover/takeover, persistência auditável no histórico e broadcast de mudança de controle.
- Rotas de validação LLM (`GET /api/integrations/trading/validations` e `GET /api/integrations/trading/validations/diagnostics`) extraídas para `apps/integrations-service/src/routes/trading-validation-routes.ts`, preservando agregações SQL, filtros por período e execução com `withTenantContext` para compatibilidade RLS em pool transacional.
- Rotas de histórico de análise (`GET /api/integrations/trading/analysis/history`, `POST /api/integrations/trading/analysis/history/delete`, `POST /api/integrations/trading/analysis/history/purge`) extraídas para `apps/integrations-service/src/routes/trading-analysis-history-routes.ts`, preservando paginação por cursor, filtros por período/técnica e governança de exclusão lógica/definitiva por escopo.
- Rotas de análise operacional (`GET/PUT /api/integrations/trading/analysis-profile`, `GET /api/integrations/trading/arbitrage/catalog` e `GET /api/integrations/trading/analysis/:symbol`) extraídas para `apps/integrations-service/src/routes/trading-analysis-routes.ts`, preservando perfil multi-timeframe, catálogo de arbitragem e pipeline determinístico completo (consenso, técnicas, arbitragem e trade plan).
- Guardrails de contrato OpenAPI/RBAC reforçados em `apps/integrations-service/src/openapi-specs.ts` e `tests/unit/services/integrations-openapi-*.test.ts` para cobrir scheduler, governança de datasets, análise técnica, market data, controle operacional e validações LLM, reduzindo risco de drift entre contrato e handlers reais.
- Imports de módulos de rota consolidados no topo de `apps/integrations-service/src/index.ts`, eliminando imports espalhados no meio do arquivo.
- Objetivo: reduzir acoplamento, facilitar testes de contrato e manter boundaries auditáveis por contexto.

### Modularização P0 do Auth Service (07/03/2026)

- `apps/auth-service/src/index.ts` mantém papel de composition root e registro de módulos.
- Rotas já extraídas para `apps/auth-service/src/routes/`:
  - `rbac-admin-routes.ts`
  - `user-management-routes.ts`
  - `auth-system-routes.ts`
  - `auth-provider-routes.ts`
  - `auth-password-routes.ts`
  - `auth-biometrics-routes.ts`
  - `auth-registration-routes.ts`
- Objetivo: separar concerns de sistema, providers, credenciais locais e cadastro administrativo para reduzir risco de regressão cruzada.

### Modularização P0 do Training Service (07/03/2026)

- `apps/training-service/src/index.ts` segue como composition root e passou a registrar módulo dedicado de plataforma.
- Rotas de plataforma extraídas para `apps/training-service/src/routes/training-platform-routes.ts`:
  - health/probes: `GET /api/training/health`, `GET /live`, `GET /ready`
  - enqueue interno trading: `POST /internal/trading/enqueue/*`
  - auto-runs internos: `POST /internal/trading/auto/portfolio-run`, `POST /internal/trading/auto/signal-run`
  - system-config: `GET/PATCH /api/training/system-config`
- Objetivo: reduzir acoplamento do `index.ts` de treinamento mantendo semântica assíncrona das filas de trading, governança de configuração e observabilidade operacional.
- Rotas de auditoria extraídas para `apps/training-service/src/routes/training-audit-routes.ts`:
  - `GET /api/training/audit/integrity`
  - `GET /api/training/audit/high-risk`
- Objetivo adicional: isolar consultas de auditoria imutável de governança em módulo dedicado, mantendo validação de tenant/autorização e filtros de action/limit.
- Rotas de LoRA + GPU Orchestrator extraídas para `apps/training-service/src/routes/training-lora-orchestrator-routes.ts`:
  - `POST /api/training/lora/activate/:jobId`
  - `GET/DELETE /api/training/lora/active`
  - `GET /api/training/gpu-orchestrator/state`
  - `POST /api/training/gpu-orchestrator/return`
- Objetivo adicional: separar operação de adapters LoRA e proxy de orquestrador GPU do composition root principal, mantendo governança de escopo/tenant e contratos HTTP existentes.
- Rotas de runtime operacional extraídas para `apps/training-service/src/routes/training-runtime-routes.ts`:
  - `GET /api/training/auto-learning/status`
  - `GET /api/training/execution-modes`
  - `GET /api/training/stats`
  - `GET /api/training/queue/status`
- Objetivo adicional: concentrar visão operacional de runtime/governança em módulo dedicado, mantendo contratos de monitoramento e policy gates sem alteração funcional.
- Rotas de execução de runs extraídas para `apps/training-service/src/routes/training-run-management-routes.ts`:
  - `GET /api/training/run/status`
  - `GET /api/training/run/history`
  - `DELETE /api/training/run/cancel`
- Objetivo adicional: separar lifecycle operacional de runs (status/histórico/cancelamento) em módulo dedicado, mantendo governança de tenant, contratos de erro e semântica de cancelamento.
- Rotas de schedule extraídas para `apps/training-service/src/routes/training-schedule-routes.ts`:
  - `POST /api/training/schedule/configure`
- Objetivo adicional: separar configuração de agendamento automático em módulo dedicado, mantendo reconciliação de escopo, cálculo de próxima execução e contratos de resposta.
- Rotas de revisão de dados extraídas para `apps/training-service/src/routes/training-data-review-routes.ts`:
  - `POST /api/training/data/approve-batch`
- Objetivo adicional: separar aprovação em lote em módulo dedicado, mantendo regras de governança (quarentena/namespace/tenant) e telemetria de revisão.
- Rotas de ingestão em lote extraídas para `apps/training-service/src/routes/training-bulk-import-routes.ts`:
  - `POST /api/training/bulk-import`
- Objetivo adicional: separar pipeline de bulk-import (validação de escopo, deduplicação semântica, quality gate e enqueue de embedding/dedupe) em módulo dedicado.
- Rotas de webhook extraídas para `apps/training-service/src/routes/training-webhook-routes.ts`:
  - `POST /api/training/webhook`
- Objetivo adicional: separar autenticação/integração de webhook (assinatura, digest, nonce anti-replay e coleta multi-tenant) em módulo dedicado.
- Rotas de dados de treinamento extraídas para `apps/training-service/src/routes/training-data-routes.ts`:
  - `POST /api/training/data`
  - `GET /api/training/data`
  - `PATCH /api/training/data/:id/status`
  - `PATCH /api/training/data/:id/resolve-scope`
- Objetivo adicional: separar ingestão/listagem/governança de escopo de `training_data` em boundary dedicado, preservando auditoria e métricas de review/override.
- Rotas de consulta de jobs extraídas para `apps/training-service/src/routes/training-job-query-routes.ts`:
  - `GET /api/training/jobs`
  - `GET /api/training/jobs/:id`
  - `GET /api/training/jobs/:id/stream`
  - `GET /api/training/jobs/:id/promotion-approvals`
  - `GET /api/training/jobs/:id/audit-trail`
- Objetivo adicional: separar leitura operacional/governança de jobs em boundary dedicado, preservando stream SSE, trilha imutável e políticas de tenant.
- Rotas de cancelamento de jobs extraídas para `apps/training-service/src/routes/training-job-cancel-routes.ts`:
  - `DELETE /api/training/jobs/:id`
- Objetivo adicional: separar cancelamento transacional de jobs em boundary dedicado, preservando contratos de erro e governança de cancelamento do LoRA vinculado.
- Rota de aprovação de promoção extraída para `apps/training-service/src/routes/training-job-promotion-approval-routes.ts`:
  - `POST /api/training/jobs/:id/promotion-approval`
- Objetivo adicional: separar aprovação de promoção com lock de concorrência e trilha de auditoria em boundary dedicado.
- Rota de rollback extraída para `apps/training-service/src/routes/training-job-rollback-routes.ts`:
  - `POST /api/training/jobs/:id/rollback`
- Objetivo adicional: separar rollback governado por escopo/model version em boundary dedicado, preservando lock de concorrência e trilha de auditoria.
- Rota de promoção extraída para `apps/training-service/src/routes/training-job-promote-routes.ts`:
  - `POST /api/training/jobs/:id/promote`
- Objetivo adicional: separar promoção governada (gates de aprovação/eval, lock por escopo e ativação de adapter) em boundary dedicado.
- Rota on-demand extraída para `apps/training-service/src/routes/training-run-start-routes.ts`:
  - `POST /api/training/run/start`
- Objetivo adicional: separar início de run on-demand com idempotência, lock e trilha de auditoria em boundary dedicado.
- Rota de criação de jobs extraída para `apps/training-service/src/routes/training-job-create-routes.ts`:
  - `POST /api/training/jobs`
- Objetivo adicional: separar criação governada de jobs customizados (idempotência, lock de concorrência, seleção de dataset, enqueue assíncrono e trilha de auditoria) em boundary dedicado, removendo o último endpoint `/api/training*` inline do composition root.
- Serviços de governança de treinamento extraídos para módulos dedicados:
  - `apps/training-service/src/training-governance-audit.ts`
  - `apps/training-service/src/training-promotion-approvals.ts`
- Objetivo adicional: separar catálogo de ações + persistência de auditoria imutável e resumo de aprovações de promoção do composition root, reduzindo acoplamento e duplicação de responsabilidade no `index.ts`.
- Serviço de lifecycle de jobs extraído para módulo dedicado:
  - `apps/training-service/src/training-job-lifecycle.ts`
- Objetivo adicional: separar retomada de jobs pendentes pós-restart e cancelamento governado de fine-tuning/LoRA do composition root, mantendo semântica assíncrona e contratos de erro existentes.
- Serviço de idempotência de run-start extraído para módulo dedicado:
  - `apps/training-service/src/training-run-start-idempotency.ts`
- Objetivo adicional: separar leitura/validação de header idempotente, fingerprint determinístico, lookup/store em Redis e resposta de erro padronizada dos fluxos `POST /api/training/jobs` e `POST /api/training/run/start`.

Para detalhes completos de arquitetura, pipeline e deploy, utilize os documentos SSOT acima.

## Início Rápido

### Pré-requisitos

- Node.js 22 LTS
- PostgreSQL 16+ com pgvector
- pnpm 10.26.1+
- Docker (para produção)

### Desenvolvimento (Cursor IDE)

> **Padronização de Edição (Enterprise 2025):** O repositório usa `.gitattributes` + `.editorconfig` para padronizar line endings (**LF** para texto; **CRLF** apenas para scripts Windows) e evitar diffs ruidosos.

```bash
# 1. Instalar dependências
pnpm install

# 2. Iniciar em modo desenvolvimento
pnpm run dev
```

O servidor iniciará automaticamente em `http://localhost:5000`.

### Credenciais de Administrador (3 Sistemas Independentes)

A plataforma possui **3 sistemas independentes** que requerem credenciais de admin **obrigatórias e separadas**:

| Sistema | Username | Secret da Senha | Requisitos |
|---------|----------|-----------------|------------|
| **Alice Auth Service** | `ADMIN_USER` (email obrigatório) | `ADMIN_PWD` | Email válido (ex: admin@dominio.com), senha mín. 8 chars |
| **Grafana 12** | `GRAFANA_ADMIN_USER` (qualquer string) | `GRAFANA_ADMIN_PASSWORD` | Username customizável, senha recomendada 8+ chars |

### SSO 100% Automatizado (31/12/2025)

O deploy configura SSO automaticamente - **não é necessário nenhum passo manual**:

| Secret Pré-Definido | Propósito |
|---------------------|-----------|
| `GRAFANA_OAUTH_CLIENT_SECRET` | OAuth para Grafana → Alice IdP |

**Fluxo pós-deploy:**
1. ✅ Grafana exibe botão "Login com Alice Enterprise" automaticamente
3. ✅ Admins locais funcionam como fallback de emergência

### Variáveis de Ambiente

Consulte [docs/SECRETS.md](docs/SECRETS.md) para a lista completa de secrets necessários.

---

## Deploy

### Ambientes

| Ambiente | Plataforma | Descrição |
|----------|------------|-----------|
| **Desenvolvimento** | Cursor IDE | IDE, hot reload, debugging, AI-assisted |
| **Produção** | Hetzner Cloud GEX44 | Intel Core i5-13500 14 Core, 64GB DDR4 RAM, 2x 1.92TB NVMe SSD (RAID 1) |

### Volume Persistente (alice-data)

| Diretório | Propósito |
|-----------|-----------|
| `/opt/alice/uploads` | Uploads RAG (imagens, áudios e documentos) |

### Pipeline CI/CD Enterprise Modular v3.0.0 (06/01/2026)

**Arquitetura completa seguindo melhores práticas oficiais GitHub Actions 2025:**

```
┌────────────────────────────────────────────────────────────────────┐
│ FASE 1: CI (Validação)                                             │
│  Push → Typecheck + ESLint + Build + Security Scan (Trivy)        │
│  Tempo: ~3min                                                      │
└───────────────────────────────┬────────────────────────────────────┘
                                │ Se passar
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│ FASE 2: RELEASE MODULAR (Matrix Strategy)                         │
│                                                                    │
│  ┌──────────────┐    ┌─────────────────────────────────────────┐ │
│  │  validate    │───→│  analyze-changes (diff desde tag ant.) │ │
│  └──────────────┘    └──────────────┬──────────────────────────┘ │
│                                     │                             │
│                      ┌──────────────┴───────────────┐             │
│                      │                              │             │
│            ┌─────────▼────────┐          ┌─────────▼────────┐    │
│            │ build-microservices│          │   build-gpu      │    │
│            │ Matrix (12 jobs)  │          │ Matrix (5 jobs)  │    │
│            │ Paralelo 5-7min   │          │ Paralelo 5-7min  │    │
│            └─────────┬────────┘          └─────────┬────────┘    │
│                      └──────────┬───────────────────┘             │
│                                 ▼                                 │
│                        ┌────────────────┐                         │
│                        │  smoke-test    │                         │
│                        │ PostgreSQL+pgv │                         │
│                        └────────┬───────┘                         │
│                                 ▼                                 │
│                        ┌────────────────┐                         │
│                        │publish-release │                         │
│                        │ GitHub Release │                         │
│                        └────────┬───────┘                         │
│                                 ▼                                 │
│                        ┌────────────────┐                         │
│                        │ trigger-deploy │                         │
│                        └────────────────┘                         │
│  Tempo total: ~5-7min (vs ~34min v2)                             │
└───────────────────────────────┬────────────────────────────────────┘
                                │
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│ FASE 3: DEPLOY MODULAR (Jobs Individuais)                         │
│                                                                    │
│  ┌──────────────┐    ┌────────────────┐                           │
│  │   validate   │───→│    prepare     │                           │
│  └──────────────┘    └────────┬───────┘                           │
│                               │                                   │
│                        ┌──────▼─────────┐                         │
│                        │ deploy-infra   │                         │
│                        │ health-infra   │                         │
│                        └──────┬─────────┘                         │
│                               │                                   │
│                        ┌──────▼─────────┐                         │
│                        │ drizzle-push   │ (migrations)            │
│                        └──────┬─────────┘                         │
│                               │                                   │
│             ┌─────────────────┼─────────────────┬─────────────┐   │
│             │                 │                 │             │   │
│      ┌──────▼──────┐   ┌──────▼──────┐   ┌──────▼──────┐   ┌▼┐  │
│      │rollback-alie│   │rollback-obs │   │rollback-erpnx│   │C│  │
│      └─────────────┘   └─────────────┘   └─────────────┘   └─┘  │
│                                                                    │
│      PARALELO: 4 stacks independentes após infra healthy         │
│                                                                    │
│  Tempo: ~10min (vs ~30min v2)                                    │
│  Rollback: Cirúrgico (só stack com falha)                        │
└────────────────────────────────────────────────────────────────────┘
```

**Workflows Enterprise:**

| Workflow | Arquivo | Descrição | Tempo |
|----------|---------|-----------|-------|
| **CI** | `ci.yml` | Validação (typecheck, lint, build, trivy) | ~3min |
| **Release** | `release.yml` | Build imagens + Tag + GitHub Release | ~5-10min |
| **Deploy** | `deploy-stack-modular.yml` | Deploy modular (5 stacks independentes) | **~10min** |

**Características Enterprise Release (`release.yml`):**
- ✅ **Build Condicional**: Diff analysis (só builda o que mudou desde tag anterior)
- ✅ **Retag Inteligente**: Imagens sem alterações são retagged (economiza tempo)
- ✅ **Cache GHCR**: Registry cache por imagem (máxima eficiência BuildKit)
- ✅ **Smoke Test**: PostgreSQL + pgvector (detecta SIGILL/AVX-512 antes do deploy)
- ✅ **17 Imagens**: 14 do job build (11 microsserviços Alice + postgres + pgbackrest + caddy) + 3 GPU
- ✅ **Disparo Automático**: Deploy disparado automaticamente após sucesso

**Características Enterprise Deploy Modular (`deploy-stack-modular.yml`):**
- ✅ **Rollback Cirúrgico**: Só reverte stack com falha (outros continuam)
- ✅ **Isolamento**: Docker Compose projects (`-p alice-{stack}`)
- ✅ **External Volumes/Networks**: Dados compartilhados preservados entre deploys/rollbacks
- ✅ **Health Checks**: 50 containers verificados com retry logic (30-45x)

**Performance Pipeline Enterprise:**

| Métrica | Descrição | Tempo |
|---------|-----------|-------|
| CI | Validação (typecheck, lint, trivy) | ~3min |
| Release | Build 16 imagens + GitHub Release | ~5-10min |
| Deploy ALICE | Stack com GPU images | **~20-25min** |
| Rollback | Stack específico | **Cirúrgico** 🎯 |

> **OTIMIZAÇÃO COMPLETA (12/01/2026):** **TODAS AS 3 IMAGENS GPU** migradas de `pytorch-devel` para `pytorch-runtime`:
> - **embeddings-gpu**: 17.6GB → ~11GB (-6GB)
> - **lora-trainer**: 17GB → ~11GB (-6GB)
> 
> **Resultado:** Economia total de **18GB (-35%)**, download **50x mais rápido**, Deploy ALICE reduzido de **~40min para ~20-25min**. Timeout configurado: command_timeout=45m (margem), job timeout=50m.

**Versionamento Semântico Automático:**
- Conventional Commits (BREAKING→MAJOR, feat→MINOR, fix→PATCH)
- Tags criadas automaticamente pelo `release.yml`
- Changelog gerado automaticamente com classificação de commits
- Retag inteligente (só builda imagens com código alterado) — funções centralizadas em `scripts/release-functions.sh`

**Single Source of Truth (SSOT) - Versões de Imagens:**
- Todas as versões de imagens públicas centralizadas em `infra/versions.env`
- Docker-compose files usam variáveis `${VAR:-default}` do SSOT
- Deploy valida existência de imagens públicas ANTES do deploy
- Dependabot monitora e atualiza versões automaticamente

| Stack | Variáveis Principais |
|-------|---------------------|
| INFRA | `REDIS_ALICE_VERSION`, `QDRANT_VERSION`, `SEARXNG_VERSION`, `MINIO_*` |
| OBSERVABILITY | `PROMETHEUS_VERSION`, `GRAFANA_VERSION`, `LANGFUSE_VERSION`, etc |

**GPU Manager Service (v4.0.0):**
- Arquitetura simplificada: todos os serviços GPU rodam simultaneamente (15GB de 20GB VRAM)
- Gerenciamento centralizado de requisições GPU (LLM, Embeddings, Training)
- Fila priorizada (Redis) com monitoramento VRAM em tempo real (nvidia-smi)
- Circuit breakers, retry logic e métricas Prometheus
- Zero latência de troca (sem orquestração dinâmica)
- Guia completo: [docs/ARQUITETURA-GPU-MANAGER.md](docs/ARQUITETURA-GPU-MANAGER.md)

### Acesso SSH à Hetzner (Produção)

**Arquitetura de 2 Servidores (26/12/2025):**

| Servidor | Alias SSH | IP | Função |
|----------|-----------|-----|--------|
| **Deploy Server** | `alice-hetzner` | 46.224.46.93 | GitHub Actions Runner (CPX32) |
| **Production Server** | `alice-prod` | 178.63.41.108 | Aplicação + GPU |

**Configuração SSH** (`~/.ssh/config`):

```
Host alice-hetzner
    HostName 46.224.46.93
    User root
    IdentityFile ~/.ssh/alice-deploy

Host alice-prod
    HostName 178.63.41.108
    User root
    IdentityFile ~/.ssh/alice-deploy
```

- Conexão Deploy Server: `ssh alice-hetzner`
- Conexão Production Server: `ssh alice-prod`
- Permissões da chave: `chmod 600 ~/.ssh/alice-deploy`
 - Windows (PowerShell): chave em `C:\Users\filli\.ssh\alice-deploy` e config em `C:\Users\filli\.ssh\config`
 - Windows (comando direto): `ssh -i C:\Users\filli\.ssh\alice-deploy root@178.63.41.108`

### URLs de Produção

| Serviço | URL | Descrição |
|---------|-----|-----------|
| **Alice Frontend** | https://yesyoudeserve.duckdns.org | SPA React principal |
| **Alice Chat** | https://yesyoudeserve.duckdns.org/chat | Interface de chat (SPA route) |
| **Alice Dashboard** | https://yesyoudeserve.duckdns.org/dashboard | Painel administrativo |
| **Alice Trading** | https://yesyoudeserve.duckdns.org/trading | Interface trading BTC |
| **Alice WebSocket** | wss://yesyoudeserve.duckdns.org/ws | Streaming em tempo real |
| **Grafana** | https://observability.yesyoudeserve.duckdns.org | Dashboards e alertas |
| **Prometheus** | https://metrics.yesyoudeserve.duckdns.org | Métricas e consultas |
| **Jaeger** | https://traces.yesyoudeserve.duckdns.org | Distributed tracing |
| **Langfuse** | https://langfuse.yesyoudeserve.duckdns.org | LLM observability |

Consulte [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) para instruções detalhadas.

---

## Estrutura do Projeto

```
alice/
├── apps/                           # Microserviços independentes
│   ├── frontend-service/           # React 18 + Vite 7.3 SPA
│   ├── api-gateway/                # Node.js gateway (dev only - Caddy 2.8 em prod)
│   ├── auth-service/               # OAuth/SAML/Local + RBAC
│   ├── biometrics-service/        # Biometria facial (Python FastAPI, /metrics Prometheus)
│   ├── chat-service/               # LLM Proxy + WebSocket
│   ├── llm-gateway-service/        # Gateway LLM único (rota/contexto namespace/agente, /metrics)
│   ├── gpu-manager-service/        # Gerenciamento centralizado GPU (filas, VRAM, circuit breakers)
│   ├── rag-service/                # Embeddings + pgvector
│   ├── training-service/           # SemHash + Fine-tuning
│   ├── integrations-service/       # Stripe, Wise, Twilio, Gmail SMTP, Trading/KuCoin
│   └── observability-service/      # Prometheus, Grafana, Jaeger, Langfuse
│
├── packages/                       # Código compartilhado
│   ├── shared/                     # Schema Drizzle ORM
│   ├── database/                   # PostgreSQL + pgvector
│   ├── shared-utils/               # Logger singleton, ShutdownManager, Express hardening
│   ├── config/                     # Validação Zod
│   └── logger/                     # Pino singleton
│
├── infra/                          # Infraestrutura
│   ├── docker/                     # Docker Compose
│   └── scripts/                    # Scripts de setup
│
├── docs/                           # Documentação
│   ├── DEPLOYMENT.md               # Guia de deploy
│   ├── SECRETS.md                  # Guia de secrets
│   └── SISTEMA-APRENDIZADO.md      # Sistema de auto-aprendizado
│
├── .github/
│   ├── actions/                    # Composite actions reutilizáveis
│   │   └── setup-node-pnpm/        # Setup Node.js + pnpm (elimina duplicação)
│   └── workflows/                  # CI/CD (3 workflows Enterprise)
│       ├── ci.yml                  # Validação de código (dispara release.yml)
│       ├── release.yml             # Build imagens + Tag + GitHub Release
│       └── deploy-stack-modular.yml # Deploy modular (5 stacks independentes)
│
├── scripts/
│   └── release-functions.sh        # Funções compartilhadas de build/retag (Regra 2)
│
├── infra/scripts/
│   └── deploy-functions.sh         # Funções compartilhadas de deploy (pull_if_needed, Regra 2)
│
└── server/
    └── index-dev.ts                # Gateway de desenvolvimento (integrações reais - sem preview/mocks)
```

---

## Tecnologias

### Frontend
- React 19.2, TypeScript 5.9.3, Vite 7.3
- TanStack Query 5.90, Wouter 3.9
- shadcn/ui, Tailwind CSS 4.1, Framer Motion 12
- react-i18next 16.5, i18next 25.7

### Backend
- Node.js 22 LTS (versão automática via API + fallback .nvmrc), Express 5.2
- TypeScript 5.9.3, pnpm 10.26.1 (versão automática via package.json)
- Drizzle ORM, PostgreSQL 16 + pgvector
- WebSocket (ws), Pino (logging estruturado)
- Passport.js, openid-client
- HTTP Compression (gzip level 6)

### Infraestrutura
- Docker, **Caddy 2.10.0** (SSL automático + HTTP/3 nativo)
- **Node.js 22 Alpine 3.21** (microserviços)
- nginx:1.27-alpine3.21 (frontend)
- GitHub Actions CI/CD (95%+ SHA pinning, composite actions reutilizáveis)
- Hetzner Cloud (Nuremberg)

### Observabilidade
- Prometheus 3.8.1 (métricas)
- Grafana OSS 12.3.2 (dashboards)
- Jaeger 2.13.0 (tracing distribuído)
- Loki 3.6.3, Promtail 3.6.3 (logs)
- OpenTelemetry Collector 0.142.0 (instrumentação)
- Langfuse 3.85.0 (métricas LLM)

---

## Documentação

Consulte `docs/INDEX.md` para o mapa completo de SSOT e links oficiais.

---

## Padrões de Código

```typescript
// Logging - Logger Singleton com child loggers (console.* proibido)
import { createLogger } from '@alice/shared-utils';
const logger = createLogger('meu-servico');
logger.info({ userId }, 'Usuário autenticado');

// Graceful Shutdown
import { registerShutdownCallback, ShutdownPriority } from '@alice/shared-utils';
registerShutdownCallback('database', closeDatabasePool, { priority: ShutdownPriority.DATABASE });

// TypeScript strict - zero any
interface User { id: string; email: string; role: UserRole; }
```

---

## Licença

Proprietário - Todos os direitos reservados.

---

---

*Performance: HTTP Compression (gzip), HTTP/3 (Caddy), SHA Pinning 95%+*
*PostgreSQL: HNSW indexes + 10 índices compostos + 12 tabelas Trading com RLS*
*Storage: Servidor GEX44 1.92TB interno (/opt/alice) - SEM S3 externo*
*ARQUITETURA ENTERPRISE: Texto 1024 dim Qwen3-Embedding-0.6B (Qdrant) | Imagem: OpenAI Vision → descrição textual (sem embeddings de imagem)*
*Trading BTC Futures: KuCoin Perpetuals + WS realtime (ticker/orderbook/klines) + Indicadores Técnicos Determinísticos + Validação Cruzada Anti-Alucinação*
*LLM: Qwen2.5 7B (vLLM AWQ) via Hetzner GPU Server GEX44 (RTX 4000 Ada 20GB) - Texto*
*GPU Services (Gate 2): LLM (Qwen2.5 7B) e Embeddings Qwen3-Embedding-0.6B INT8 (1024 dim) gerenciados pelo GPU Manager Service; Training sob demanda. ASR/Vision via OpenAI.*
*Pipeline Enterprise (06/01/2026): Release (`release.yml`) → Deploy Modular (`deploy-stack-modular.yml` - 5 stacks independentes ~10min)*
*Rollback Cirúrgico: Só reverte stack com falha, outros continuam funcionando 100%*

</div>

<!-- Teste CI/CD 30/12/2025 - verificando se apenas CI inicia ou se Deploy também dispara -->
