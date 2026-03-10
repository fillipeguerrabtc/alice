# Plano de Implementação Enterprise por Blocos

**Autor:** Fillipe Guerra  
**Data:** 10 de Março de 2026

## Regras de execução
- Cada bloco termina com validação sequencial individual: `typecheck` -> `test` -> `eslint` -> `build`.
- Cada bloco concluído gera commit consolidado em inglês.
- Sem push automático.

## Rodada de Consolidação Histórica e Governança (Concluído em 10/03/2026)
### Escopo fechado nesta rodada
- **Passo 1 (Histórico):** rebase/squash não-interativo concluído com consolidação dos commits locais em base `origin/main` (backup preservado em `backup/pre-squash-20260310-1`).
- **Passo 2 (Operacional):** baseline de foco/churn normalizado após consolidação de histórico, com métricas reavaliadas via guardrail.
- **Passo 3 (Técnico Frontend):** redução adicional de fragmentação em Wise por consolidação de componentes/constantes e remoção de arquivos redundantes; redução incremental de densidade em Trading/Chat.
- **Passo 4 (Governança):** enforcement contínuo ativado no fluxo padrão via scripts de `package.json`:
  - `verify:enterprise-focus`
  - `verify:enterprise-focus:full`
  - `validate:enterprise`

### Evidência objetiva pós-rodada
- Guardrail (janela 418): `docs+README` **8,76%**, foco Wise **0,87%**, status **OK**.
- Guardrail (janela 50): `docs+README` **4,85%**, foco Wise **0,00%**, status **OK**.
- `apps/frontend-service/src/pages/wise-payments`: **176 arquivos TS/TSX** (antes 187) e **13.976 linhas** (antes 14.155).
- Arquivos Wise `<40 linhas`: **16** (antes 29).
- `TradingContent.tsx`: **1321 linhas** (antes 1331).
- `useChatPageLayoutController.ts`: **591 linhas** (antes 597).

## Rodada de Correção - Itens da Review Final (Concluído em 10/03/2026)
### Escopo fechado nesta rodada
- **Item 1 (Alta) - Fragmentação WisePayments:** consolidação de wrappers redundantes em `apps/frontend-service/src/pages/wise-payments/use-wise-page-composition.ts` com remoção de 6 arquivos de passthrough:
  - `use-wise-tab-props.ts`
  - `build-wise-profile-scoped-tab-props.ts`
  - `build-wise-operational-tabs-props.ts`
  - `build-wise-tab-profile-props.ts`
  - `build-wise-tab-operational-props.ts`
  - `wise-tab-props-types.ts`
- **Item 2 (Média) - Churn documental:** adição de governança operacional via `scripts/verify-enterprise-focus.sh` para monitorar ratio de churn documental por janela e evitar regressão nas próximas rodadas.
- **Item 3 (Média) - Desbalanceamento de foco:** adição de métrica operacional no mesmo guardrail para acompanhar concentração de commits por domínio (ex.: Wise) e forçar correção de rota quando necessário.
- **Item 4 (Baixa) - Containers grandes:** redução de densidade com cleanup estrutural em:
  - `apps/frontend-service/src/pages/TradingContent.tsx` (1387 -> 1331 linhas)
  - `apps/frontend-service/src/pages/Chat/useChatPageLayoutController.ts` (612 -> 597 linhas)

### Evidência objetiva pós-correção
- `apps/frontend-service/src/pages/wise-payments`: **193 -> 187** arquivos TS/TSX.
- `apps/frontend-service/src/pages/wise-payments`: **14245 -> 14155** linhas TS/TSX.
- Guardrail criado: `scripts/verify-enterprise-focus.sh` (executável).

### Observação de governança histórica
- Os percentuais históricos de churn/foco da janela de 418 commits são fatos já gravados no histórico Git e **não podem ser reduzidos sem reescrita de histórico**. O conserto aplicado nesta rodada foi preventivo e mensurável para as próximas rodadas.

## Bloco 1 - Foundations P0 (Concluído)
### Escopo
- Governança central de config e service URLs (`@alice/config`).
- Hardening de autenticação interna (HMAC + compatibilidade legada controlada).
- Correções de segurança em backup orchestration.
- `system-config` como SSOT com validação forte de `NAMESPACE_PROFILE_DEFAULT_CONFIG_JSON`.
- Correção de numbering de migration duplicada `0094_*`.

### Validação executada
1. `npx -y pnpm@10.26.2 lint`
2. `npx -y pnpm@10.26.2 typecheck`
3. `npx -y pnpm@10.26.2 test`
4. `npx -y pnpm@10.26.2 build`

### Commit
- `021d1328 chore(platform): harden config governance, internal auth, and async queue reliability`

## Bloco 2 - Chat/Training/RAG P0 (Concluído)
### Escopo
- Padronização de URLs internas no chat/rag/integrations via `getServiceUrl()`.
- Eliminação de parse duplicado de namespace profile defaults (fonte única em `@alice/database/system-config`).
- Hardening de filas RAG para evitar silent loss por TTL em jobs ativos.
- Ajuste de `use-auth` no frontend para remover side-effect durante render.

### Validação executada
1. `npx -y pnpm@10.26.2 lint`
2. `npx -y pnpm@10.26.2 typecheck`
3. `npx -y pnpm@10.26.2 test`
4. `npx -y pnpm@10.26.2 build`

### Commit
- Consolidado no commit `021d1328`.

## Bloco 3 - Integrations/Auth P0 (Concluído)
### Escopo entregue nesta rodada
- Extração de runtime config de trading/integrity para módulo dedicado (`apps/integrations-service/src/runtime-config.ts`).
- Extração de clientes externos dedicados (`Grafana` e `GitHub Actions`) para reduzir acoplamento do `index.ts`.
- Refactor de RBAC no auth-service com módulos separados para `role assignments` e `permission catalog`.
- Decomposição adicional do `auth-service` com modularização de rotas:
  - `apps/auth-service/src/routes/rbac-admin-routes.ts`
  - `apps/auth-service/src/routes/user-management-routes.ts`
  - `apps/auth-service/src/index.ts` convertido para composition root mais fino nessa camada.
- Extração das rotas de sistema do auth-service para módulo dedicado:
  - `apps/auth-service/src/routes/auth-system-routes.ts`
  - `apps/auth-service/src/index.ts` passou a registrar health/probes/usuário atual via composition root (`registerAuthSystemRoutes`)
- Extração das rotas de providers do auth-service para módulo dedicado:
  - `apps/auth-service/src/routes/auth-provider-routes.ts`
  - `apps/auth-service/src/index.ts` passou a registrar OAuth/SAML via composition root (`registerAuthProviderRoutes`)
- Extração das rotas de credenciais locais do auth-service para módulo dedicado:
  - `apps/auth-service/src/routes/auth-password-routes.ts`
  - `apps/auth-service/src/index.ts` passou a registrar login/validação/troca de senha via composition root (`registerAuthPasswordRoutes`)
- Extração das rotas de biometria do auth-service para módulo dedicado:
  - `apps/auth-service/src/routes/auth-biometrics-routes.ts`
  - `apps/auth-service/src/index.ts` passou a registrar login/status/enroll/verify de biometria via composition root (`registerAuthBiometricsRoutes`)
- Extração da rota de registro administrativo do auth-service para módulo dedicado:
  - `apps/auth-service/src/routes/auth-registration-routes.ts`
  - `apps/auth-service/src/index.ts` passou a registrar `/api/auth/register` via composition root (`registerAuthRegistrationRoutes`)
- Extração das rotas de status/WebSocket de trading no integrations-service para módulo dedicado:
  - `apps/integrations-service/src/routes/trading-websocket-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar status e lifecycle de subscriptions WS via composition root (`registerTradingWebsocketRoutes`)
- Extração das rotas de catálogo/preferências de símbolos no integrations-service para módulo dedicado:
  - `apps/integrations-service/src/routes/trading-symbol-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar endpoints de símbolos/preferências via composition root (`registerTradingSymbolRoutes`)
- Extração das rotas de mercado/conta/posições/risco no integrations-service para módulo dedicado:
  - `apps/integrations-service/src/routes/trading-market-risk-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar endpoints de market/account/positions/risk via composition root (`registerTradingMarketRiskRoutes`)
- Extração das rotas de account management no integrations-service para módulo dedicado:
  - `apps/integrations-service/src/routes/trading-account-management-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar endpoints avançados de conta via composition root (`registerTradingAccountManagementRoutes`)
- Extração das rotas de automação de trading no integrations-service para módulo dedicado:
  - `apps/integrations-service/src/routes/trading-automation-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar portfolios/candidates/rebalances, enqueue interno (`/internal/trading/enqueue/*`) e lifecycle de auto-runs (`/api/trading/auto/*`) via composition root (`registerTradingAutomationRoutes`)
- Extração das rotas de leitura/histórico de sinais no integrations-service para módulo dedicado:
  - `apps/integrations-service/src/routes/trading-signal-history-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar listagem de sinais ativos e histórico com filtros/paginação/stats + soft-delete/purge via composition root (`registerTradingSignalHistoryRoutes`)
- Extração das rotas de ação de sinais no integrations-service para módulo dedicado:
  - `apps/integrations-service/src/routes/trading-signal-action-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar criação/desativação/aprovação/rejeição de sinais via composition root (`registerTradingSignalActionRoutes`)
  - aprovação `training_only` para sinais `neutral/hold` (dataset + auditoria) preservada sem regressão funcional
- Extração das rotas de governança de ordens no integrations-service para módulo dedicado:
  - `apps/integrations-service/src/routes/trading-order-governance-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar ciclo de ordens (`list/review/approve/reject/create/cancel/sync`), trilha de auditoria e `POST /api/integrations/trading/stop-orders` via composition root (`registerTradingOrderGovernanceRoutes`)
  - integração de sync com geração de dataset e verificação de integridade do ledger imutável preservadas
- Extração da rota de geração de sinais LLM no integrations-service para módulo dedicado:
  - `apps/integrations-service/src/routes/trading-signal-generation-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar `POST /api/integrations/trading/signals/generate` via composition root (`registerTradingSignalGenerationRoutes`)
  - governança de scan de universo + mapeamento de erro `TRADING_SCOPE_REQUIRED` preservados
- Extração das rotas de datasets de trading no integrations-service para módulo dedicado:
  - `apps/integrations-service/src/routes/trading-dataset-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar `GET /api/integrations/trading/datasets*`, `POST /api/integrations/trading/datasets/from-signal` e `PATCH /api/integrations/trading/datasets/:id/review` via composition root (`registerTradingDatasetRoutes`)
  - governança de qualidade/deduplicação e validação de escopo tenant/namespace preservadas
- Extração das rotas de scheduler/presets de trading no integrations-service para módulo dedicado:
  - `apps/integrations-service/src/routes/trading-scheduler-news-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar `signal-scheduler`, `analysis-scheduler` e `news-presets*` via composition root (`registerTradingSchedulerNewsRoutes`)
  - validações de mercado/arbitragem e aplicação de preset no profile preservadas
- Extração das rotas Futures de trading no integrations-service para módulo dedicado:
  - `apps/integrations-service/src/routes/trading-futures-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar `/api/integrations/trading/futures/*` e alias legado de histórico via composition root (`registerTradingFuturesRoutes`)
  - cobertura de ordens/posições/risco/funding preservada com guardrails de autenticação KuCoin
- Extração das rotas Spot de trading no integrations-service para módulo dedicado:
  - `apps/integrations-service/src/routes/trading-spot-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar `/api/integrations/trading/spot/*` via composition root (`registerTradingSpotRoutes`)
  - cobertura de ordens/OCO/stop/fills/market data e guardrails de autenticação KuCoin preservados
- Extração das rotas Margin de trading no integrations-service para módulo dedicado:
  - `apps/integrations-service/src/routes/trading-margin-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar `/api/integrations/trading/margin/*` via composition root (`registerTradingMarginRoutes`)
  - cobertura de ordens/OCO/borrow/repay/juros/risk-limit/market data e guardrails de autenticação KuCoin preservados
- Atualização dos guardrails de contrato OpenAPI/Auth para considerar rotas modularizadas sem relaxar checagens:
  - `tests/unit/services/auth-openapi-sync.test.ts`
  - `tests/unit/services/auth-openapi-rbac-sync.test.ts`
- Extração das rotas de post-mortem de `apps/integrations-service/src/index.ts` para módulo dedicado:
  - `apps/integrations-service/src/routes/postmortem-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar as rotas via composition root (`registerPostMortemRoutes`)
- Extração das rotas de demo trading de `apps/integrations-service/src/index.ts` para módulo dedicado:
  - `apps/integrations-service/src/routes/demo-trading-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar as rotas via composition root (`registerDemoTradingRoutes`)
- Extração das rotas de Grafana/GitHub Deploy de `apps/integrations-service/src/index.ts` para módulo dedicado:
  - `apps/integrations-service/src/routes/grafana-github-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar as rotas via composition root (`registerGrafanaAndGithubRoutes`)
- Extração das rotas de Email (Gmail SMTP) de `apps/integrations-service/src/index.ts` para módulo dedicado:
  - `apps/integrations-service/src/routes/email-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar as rotas via composition root (`registerEmailRoutes`)
- Extração das rotas Stripe (checkout, portal, products, payment intent e webhook) para módulo dedicado:
  - `apps/integrations-service/src/routes/stripe-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar as rotas via composition root (`registerStripeRoutes`)
- Extração das rotas core de integrações (health, stats e auditoria de trading) para módulo dedicado:
  - `apps/integrations-service/src/routes/integration-core-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar as rotas via composition root (`registerIntegrationCoreRoutes`)
- Extração das rotas de registry de integrações (`GET/POST /api/integrations`) para módulo dedicado:
  - `apps/integrations-service/src/routes/integration-registry-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar as rotas via composition root (`registerIntegrationRegistryRoutes`)
- Extração das probes de plataforma (`/live` e `/ready`) para módulo dedicado:
  - `apps/integrations-service/src/routes/health-probe-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar as probes via composition root (`registerHealthProbeRoutes`)
- Extração das rotas operacionais Twilio (`/twilio/send` e `/twilio/status`) para módulo dedicado:
  - `apps/integrations-service/src/routes/twilio-operational-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar essas rotas via composition root (`registerTwilioOperationalRoutes`)
- Extração das rotas de webhook Twilio (`/twilio/webhook/whatsapp` e `/twilio/webhook/status`) para módulo dedicado:
  - `apps/integrations-service/src/routes/twilio-webhook-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar essas rotas via composition root (`registerTwilioWebhookRoutes`)
- Extração dos helpers de canal Twilio para serviço dedicado:
  - `apps/integrations-service/src/twilio-channel-service.ts`
  - `apps/integrations-service/src/index.ts` passou a compor assinatura/envio via factory (`buildValidateTwilioSignature`, `buildSendWhatsAppMessage`)
- Extração das rotas OAuth/status do Wise para módulo dedicado:
  - `apps/integrations-service/src/routes/wise-oauth-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar essas rotas via composition root (`registerWiseOAuthRoutes`)
- Extração da rota de webhook do Wise para módulo dedicado:
  - `apps/integrations-service/src/routes/wise-webhook-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar essa rota via composition root (`registerWiseWebhookRoutes`)
- Extração das rotas de referência do Wise para módulo dedicado:
  - `apps/integrations-service/src/routes/wise-reference-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar essas rotas via composition root (`registerWiseReferenceRoutes`)
- Higienização do `index.ts` do integrations-service:
  - imports de módulos de rota e auxiliares centralizados no topo do arquivo
  - remoção de imports espalhados no meio do composition root
- Extração das rotas de account details do Wise para módulo dedicado:
  - `apps/integrations-service/src/routes/wise-account-details-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar essas rotas via composition root (`registerWiseAccountDetailsRoutes`)
- Extração das rotas de gestão de cartões do Wise para módulo dedicado:
  - `apps/integrations-service/src/routes/wise-card-management-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar essas rotas via composition root (`registerWiseCardManagementRoutes`)
- Extração das rotas de transações/dados sensíveis de cartões do Wise para módulo dedicado:
  - `apps/integrations-service/src/routes/wise-card-secure-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar essas rotas via composition root (`registerWiseCardSecureRoutes`)
- Extração das rotas de card orders do Wise para módulo dedicado:
  - `apps/integrations-service/src/routes/wise-card-orders-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar essas rotas via composition root (`registerWiseCardOrdersRoutes`)
- Extração das rotas de spend controls do Wise para módulo dedicado:
  - `apps/integrations-service/src/routes/wise-spend-controls-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar essas rotas via composition root (`registerWiseSpendControlsRoutes`)
- Extração das rotas de spend limits do Wise para módulo dedicado:
  - `apps/integrations-service/src/routes/wise-spend-limits-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar essas rotas via composition root (`registerWiseSpendLimitsRoutes`)
- Extração das rotas de disputas do Wise para módulo dedicado:
  - `apps/integrations-service/src/routes/wise-disputes-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar essas rotas via composition root (`registerWiseDisputesRoutes`)
- Extração das rotas de verificação/KYC do Wise para módulo dedicado:
  - `apps/integrations-service/src/routes/wise-verification-kyc-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar essas rotas via composition root (`registerWiseVerificationKycRoutes`)
- Extração das rotas SCA do Wise para módulo dedicado:
  - `apps/integrations-service/src/routes/wise-sca-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar essas rotas via composition root (`registerWiseScaRoutes`)
- Extração das rotas de gestão de webhooks do Wise para módulo dedicado:
  - `apps/integrations-service/src/routes/wise-webhook-management-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar essas rotas via composition root (`registerWiseWebhookManagementRoutes`)
- Extração das rotas de simulação do Wise para módulo dedicado:
  - `apps/integrations-service/src/routes/wise-simulation-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar essas rotas via composition root (`registerWiseSimulationRoutes`)
- Extração das rotas de saldos/cotações do Wise para módulo dedicado:
  - `apps/integrations-service/src/routes/wise-balance-and-quotes-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar essas rotas via composition root (`registerWiseBalanceAndQuotesRoutes`)
- Extração das rotas de recipients/transfers do Wise para módulo dedicado:
  - `apps/integrations-service/src/routes/wise-recipients-transfers-routes.ts`
  - `apps/integrations-service/src/index.ts` passou a registrar essas rotas via composition root (`registerWiseRecipientsTransfersRoutes`)
- Atualização documental SSOT para refletir arquitetura/código atuais:
  - `README.md`
  - `docs/INDEX.md`
  - `docs/ARQUITETURA.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/SISTEMA-APRENDIZADO.md`
  - `docs/RELATORIO-CODE-REVIEW-ENTERPRISE.md` (nota de snapshot histórico)
- Atualização dos guardrails de contrato do integrations para suportar modularização de rotas sem enfraquecer cobertura:
  - `tests/unit/services/helpers/integrations-source.ts`
  - `tests/unit/services/integrations-openapi-sync.test.ts`
  - `tests/unit/services/integrations-openapi-rbac-sync.test.ts`
  - `tests/unit/services/integrations-tenant-context-hardening.test.ts`
  - `tests/unit/services/integrations-auth-guards.test.ts`
  - `tests/unit/services/integrations-audit-trail-integrity-guards.test.ts`
  - `tests/unit/services/integrations-immutable-audit-monitoring-guards.test.ts`
  - `tests/unit/services/integrations-training-only-audit-guards.test.ts`
- Expansão de contratos OpenAPI/RBAC para rotas críticas recém-modularizadas:
  - `apps/integrations-service/src/openapi-specs.ts` agora documenta `signal-scheduler`, `analysis-scheduler` e governança de `datasets` (`stats/list/from-signal/review`)
  - `tests/unit/services/integrations-openapi-sync.test.ts` e `tests/unit/services/integrations-openapi-rbac-sync.test.ts` ampliados para validar presença/handler/permissão desses endpoints
- Cobertura contratual adicional para rotas críticas remanescentes de trading ainda no composition root:
  - `apps/integrations-service/src/openapi-specs.ts` expandido para `analysis-profile`, `arbitrage/catalog`, `stop-orders`, `klines/orderbook/funding-rate/mark-price/trades`, `control/control-history`, `analysis/{symbol}`, `analysis/history/purge` e `validations/diagnostics`
  - `tests/unit/services/integrations-openapi-sync.test.ts` ampliado para validar presença + handler real dessas rotas
  - `tests/unit/services/integrations-openapi-rbac-sync.test.ts` evoluído para validar `x-required-permission` por método (fallback para path-level) em endpoints com GET/PUT no mesmo path
- Nova extração de bounded context de controle operacional de trading:
  - `apps/integrations-service/src/routes/trading-control-routes.ts` criado para concentrar `GET /api/integrations/trading/control-history` e `POST /api/integrations/trading/control`
  - `apps/integrations-service/src/index.ts` atualizado para registrar `registerTradingControlRoutes`, removendo handlers inline e reduzindo acoplamento do composition root
- Nova extração de bounded context de stop orders de trading:
  - `apps/integrations-service/src/routes/trading-stop-order-routes.ts` criado para concentrar `GET /api/integrations/trading/stop-orders` e `DELETE /api/integrations/trading/stop-orders/:id`
  - `apps/integrations-service/src/index.ts` atualizado para registrar `registerTradingStopOrderRoutes`, removendo handlers inline e preservando validações por mercado/símbolo
- Nova extração de bounded context de market data de trading:
  - `apps/integrations-service/src/routes/trading-market-data-routes.ts` criado para concentrar `klines`, `orderbook`, `funding-rate`, `mark-price` e `trades`
  - `apps/integrations-service/src/index.ts` atualizado para registrar `registerTradingMarketDataRoutes`, removendo handlers inline e preservando compatibilidade de rotas legadas
- Consolidação adicional no módulo de governança de ordens:
  - `apps/integrations-service/src/routes/trading-order-governance-routes.ts` passou a concentrar também `GET /api/integrations/trading/orders/history` e `POST /api/integrations/trading/orders/history/delete`
  - `apps/integrations-service/src/index.ts` removido desses handlers inline, reduzindo acoplamento sem alterar semântica de cursor/soft-delete por escopo
- Nova extração de bounded context de validação LLM:
  - `apps/integrations-service/src/routes/trading-validation-routes.ts` criado para concentrar `/api/integrations/trading/validations*`
  - `apps/integrations-service/src/index.ts` removido do bloco de validações, preservando agregações SQL e execução com `withTenantContext` para RLS
- Nova extração de bounded context de histórico de análise:
  - `apps/integrations-service/src/routes/trading-analysis-history-routes.ts` criado para concentrar `analysis/history`, `analysis/history/delete` e `analysis/history/purge`
  - `apps/integrations-service/src/index.ts` removido desses handlers inline, preservando filtros, paginação por cursor e governança de exclusão por escopo
- Nova extração de bounded context de análise operacional:
  - `apps/integrations-service/src/routes/trading-analysis-routes.ts` criado para concentrar `GET/PUT /api/integrations/trading/analysis-profile`, `GET /api/integrations/trading/arbitrage/catalog` e `GET /api/integrations/trading/analysis/:symbol`
  - `apps/integrations-service/src/index.ts` atualizado para registrar `registerTradingAnalysisRoutes`, removendo os últimos handlers inline de análise e mantendo `index.ts` como composition root fino
  - pipeline determinístico preservado (consenso multi-timeframe, técnica/arbitragem, news/orderbook/training sources e trade plan)
- Nova extração de bounded context de plataforma no training-service:
  - `apps/training-service/src/routes/training-platform-routes.ts` criado para concentrar health/probes (`/api/training/health`, `/live`, `/ready`), enqueue/auto-run interno de trading e `GET/PATCH /api/training/system-config`
  - `apps/training-service/src/index.ts` atualizado para registrar `registerTrainingPlatformRoutes`, removendo handlers inline dessas rotas e mantendo composition root do treinamento mais fino
  - semântica assíncrona/idempotente preservada para filas internas (`enqueue/*` e `auto/*`) com uso dos mesmos schemas e `buildTradingIdempotencyKey`
- Nova extração de bounded context de auditoria no training-service:
  - `apps/training-service/src/routes/training-audit-routes.ts` criado para concentrar `GET /api/training/audit/integrity` e `GET /api/training/audit/high-risk`
  - `apps/training-service/src/index.ts` atualizado para registrar `registerTrainingAuditRoutes`, removendo handlers inline dessas rotas e mantendo composition root mais fino
  - governança de auditoria imutável preservada com validação de tenant/autorização e filtros por `action`/`limit`
- Nova extração de bounded context de LoRA + GPU orchestrator no training-service:
  - `apps/training-service/src/routes/training-lora-orchestrator-routes.ts` criado para concentrar `POST /api/training/lora/activate/:jobId`, `GET/DELETE /api/training/lora/active`, `GET /api/training/gpu-orchestrator/state` e `POST /api/training/gpu-orchestrator/return`
  - `apps/training-service/src/index.ts` atualizado para registrar `registerTrainingLoraOrchestratorRoutes`, removendo handlers inline dessas rotas e mantendo composition root mais fino
  - governança de escopo/tenant para adapters LoRA e proxy de orquestrador GPU preservada sem alteração de contratos
- Nova extração de bounded context de runtime operacional no training-service:
  - `apps/training-service/src/routes/training-runtime-routes.ts` criado para concentrar `GET /api/training/auto-learning/status`, `GET /api/training/execution-modes`, `GET /api/training/stats` e `GET /api/training/queue/status`
  - `apps/training-service/src/index.ts` atualizado para registrar `registerTrainingRuntimeRoutes`, removendo handlers inline dessas rotas e mantendo composition root mais fino
  - governança operacional de métricas/status/filas preservada com os mesmos policy gates e contratos de resposta
- Nova extração de bounded context de run management no training-service:
  - `apps/training-service/src/routes/training-run-management-routes.ts` criado para concentrar `GET /api/training/run/status`, `GET /api/training/run/history` e `DELETE /api/training/run/cancel`
  - `apps/training-service/src/index.ts` atualizado para registrar `registerTrainingRunManagementRoutes`, removendo handlers inline dessas rotas e mantendo composition root mais fino
  - governança de cancelamento e visibilidade operacional de runs preservada com os mesmos contratos de erro e escopo tenant
- Nova extração de bounded context de schedule no training-service:
  - `apps/training-service/src/routes/training-schedule-routes.ts` criado para concentrar `POST /api/training/schedule/configure`
  - `apps/training-service/src/index.ts` atualizado para registrar `registerTrainingScheduleRoutes`, removendo handler inline e mantendo composition root mais fino
  - reconciliação de escopo e cálculo de próxima execução preservados com os mesmos contratos de resposta
- Nova extração de bounded context de data review no training-service:
  - `apps/training-service/src/routes/training-data-review-routes.ts` criado para concentrar `POST /api/training/data/approve-batch`
  - `apps/training-service/src/index.ts` atualizado para registrar `registerTrainingDataReviewRoutes`, removendo handler inline e mantendo composition root mais fino
  - governança de aprovação (quarentena/namespace/tenant) e telemetria de revisão preservadas
- Nova extração de bounded context de bulk import no training-service:
  - `apps/training-service/src/routes/training-bulk-import-routes.ts` criado para concentrar `POST /api/training/bulk-import`
  - `apps/training-service/src/index.ts` atualizado para registrar `registerTrainingBulkImportRoutes`, removendo handler inline e mantendo composition root mais fino
  - validação de escopo tenant/namespace/agent, dedupe semântico, quality gate e enqueue assíncrono preservados
- Nova extração de bounded context de webhook no training-service:
  - `apps/training-service/src/routes/training-webhook-routes.ts` criado para concentrar `POST /api/training/webhook`
  - `apps/training-service/src/index.ts` atualizado para registrar `registerTrainingWebhookRoutes`, removendo handler inline e mantendo composition root mais fino
  - hardening de assinatura/digest/nonce anti-replay e validação tenant/usuário interno preservados
- Nova extração de bounded context de dados de treinamento no training-service:
  - `apps/training-service/src/routes/training-data-routes.ts` criado para concentrar `POST/GET /api/training/data`, `PATCH /api/training/data/:id/status` e `PATCH /api/training/data/:id/resolve-scope`
  - `apps/training-service/src/index.ts` atualizado para registrar `registerTrainingDataRoutes`, removendo handlers inline e mantendo composition root mais fino
  - governança de escopo/auditoria de override e métricas de review/resolução preservadas
- Nova extração de bounded context de consulta de jobs no training-service:
  - `apps/training-service/src/routes/training-job-query-routes.ts` criado para concentrar `GET /api/training/jobs`, `GET /api/training/jobs/:id`, `GET /api/training/jobs/:id/stream`, `GET /api/training/jobs/:id/promotion-approvals` e `GET /api/training/jobs/:id/audit-trail`
  - `apps/training-service/src/index.ts` atualizado para registrar `registerTrainingJobQueryRoutes`, removendo handlers inline de leitura/governança de jobs e mantendo composition root mais fino
  - stream SSE, consulta de aprovações e trilha de auditoria imutável preservados por tenant
- Nova extração de bounded context de cancelamento de jobs no training-service:
  - `apps/training-service/src/routes/training-job-cancel-routes.ts` criado para concentrar `DELETE /api/training/jobs/:id`
  - `apps/training-service/src/index.ts` atualizado para registrar `registerTrainingJobCancelRoutes`, removendo handler inline de cancelamento e mantendo composition root mais fino
  - governança de estado terminal e cancelamento do LoRA vinculado preservados
- Nova extração de bounded context de aprovação de promoção no training-service:
  - `apps/training-service/src/routes/training-job-promotion-approval-routes.ts` criado para concentrar `POST /api/training/jobs/:id/promotion-approval`
  - `apps/training-service/src/index.ts` atualizado para registrar `registerTrainingJobPromotionApprovalRoutes`, removendo handler inline e mantendo composition root mais fino
  - lock de concorrência, trilha de auditoria e resumo de aprovações preservados
- Nova extração de bounded context de rollback no training-service:
  - `apps/training-service/src/routes/training-job-rollback-routes.ts` criado para concentrar `POST /api/training/jobs/:id/rollback`
  - `apps/training-service/src/index.ts` atualizado para registrar `registerTrainingJobRollbackRoutes`, removendo handler inline e mantendo composition root mais fino
  - lock de concorrência, validação de escopo e trilha de auditoria de rollback preservados
- Nova extração de bounded context de promoção no training-service:
  - `apps/training-service/src/routes/training-job-promote-routes.ts` criado para concentrar `POST /api/training/jobs/:id/promote`
  - `apps/training-service/src/index.ts` atualizado para registrar `registerTrainingJobPromoteRoutes`, removendo handler inline e mantendo composition root mais fino
  - gates de avaliação/aprovação, lock por escopo e trilha de auditoria de promoção preservados
- Nova extração de bounded context de run/start on-demand no training-service:
  - `apps/training-service/src/routes/training-run-start-routes.ts` criado para concentrar `POST /api/training/run/start`
  - `apps/training-service/src/index.ts` atualizado para registrar `registerTrainingRunStartRoutes`, removendo handler inline e mantendo composition root mais fino
  - idempotência por chave, lock de concorrência, enqueue assíncrono e trilha de auditoria preservados
- Nova extração de bounded context de criação de jobs no training-service:
  - `apps/training-service/src/routes/training-job-create-routes.ts` consolidado como boundary dedicado de `POST /api/training/jobs`
  - `apps/training-service/src/index.ts` atualizado para registrar `registerTrainingJobCreateRoutes`, removendo o último handler `/api/training*` inline e mantendo composition root fino
  - idempotência por chave, lock de concorrência, seleção de dataset, enqueue assíncrono e trilha de auditoria preservados
- Extração de serviços de governança do training-service:
  - `apps/training-service/src/training-governance-audit.ts` criado para centralizar catálogo de ações auditáveis e persistência de trilha imutável com suporte transacional
  - `apps/training-service/src/training-promotion-approvals.ts` criado para centralizar resumo de aprovações de promoção por tenant/job
  - `apps/training-service/src/index.ts` passou a consumir esses serviços em vez de manter lógica inline, reduzindo acoplamento do composition root
- Extração de serviço de lifecycle de jobs do training-service:
  - `apps/training-service/src/training-job-lifecycle.ts` criado para centralizar retomada de jobs pendentes pós-restart e cancelamento governado de fine-tuning/LoRA
  - `apps/training-service/src/index.ts` passou a consumir esse serviço em `registerTrainingRunManagementRoutes`, `registerTrainingJobCancelRoutes` e bootstrap de retomada periódica
  - semântica assíncrona de reenfileiramento e contratos de erro transacionais preservados
- Extração de serviço de idempotência run-start do training-service:
  - `apps/training-service/src/training-run-start-idempotency.ts` criado para centralizar validação de header idempotente, fingerprint determinístico, lookup/store Redis e respostas de erro padronizadas
  - `apps/training-service/src/index.ts` passou a consumir esse serviço nos módulos `registerTrainingJobCreateRoutes` e `registerTrainingRunStartRoutes`
  - governança de idempotência e semântica de retry/conflict preservadas sem duplicação de lógica no composition root

### Critério de aceite
- Menor acoplamento em `index.ts`.
- Fronteiras de contexto auditáveis.
- Contratos OpenAPI/RBAC continuam validados por teste automatizado.

### Validação executada
1. `npx -y pnpm@10.26.2 typecheck`
2. `npx -y pnpm@10.26.2 test`
3. `npx -y pnpm@10.26.2 lint`
4. `npx -y pnpm@10.26.2 build`

### Commits
- `7c0eeb40 refactor(auth): modularize admin and user route registration`
- `582b9e98 refactor(integrations): modularize postmortem routes and stabilize contract guards`
- `1c6437af refactor(integrations): modularize demo trading routes and thin composition root`
- `c121f60c refactor(integrations): extract grafana and github deploy route modules`
- `6ecffd3f refactor(integrations): extract email route module and preserve smtp observability`
- `e4d3e6b2 refactor(integrations): extract stripe route module and preserve webhook idempotency`
- `2b926e1b refactor(integrations): extract core health and audit route module`
- `fcfbd386 refactor(integrations): extract integration registry route module`
- `aeedff64 refactor(integrations): extract liveness and readiness probe routes`
- `e0a4f283 refactor(integrations): extract twilio operational route module`
- `d1d75b1b refactor(integrations): extract twilio webhook route module and sync ssot documentation`
- `0f475882 refactor(integrations): extract twilio channel helpers and synchronize ssot docs`
- `0df3f13a refactor(integrations): extract wise oauth routes and keep thin composition root`
- `8baac7e0 refactor(integrations): extract wise webhook route module with idempotent processing`
- `a42293ec refactor(integrations): extract wise reference routes and centralize composition imports`
- `f0685163 refactor(integrations): extract wise account details routes into dedicated module`
- `41e85d6c refactor(integrations): extract wise card management routes into dedicated module`
- `a04dee57 refactor(integrations): extract wise card secure routes into dedicated module`
- `332a422f refactor(integrations): extract wise card orders routes into dedicated module`
- `ec47a7a3 refactor(integrations): extract wise spend controls routes into dedicated module`
- `e28ec307 refactor(integrations): extract wise spend limits routes into dedicated module`
- `f0026d00 refactor(integrations): extract wise disputes routes into dedicated module`
- `5f2bdc59 refactor(integrations): extract wise verification and kyc routes into dedicated module`
- `9e85b449 refactor(integrations): extract wise sca routes into dedicated module`
- `ea8f4050 refactor(integrations): extract wise webhook management routes into dedicated module`
- `269296a7 refactor(integrations): extract wise simulation routes into dedicated module`
- `fb658108 refactor(integrations): extract wise balance and quotes routes into dedicated module`
- `0f32caa9 refactor(integrations): extract wise recipients and transfers routes into dedicated module`
- `6b38ee29 refactor(auth): extract auth system routes into dedicated module`
- `381a3eaf refactor(auth): extract auth provider routes into dedicated module`
- `9e054822 refactor(auth): extract auth password routes into dedicated module`
- `26432bbd refactor(auth): extract auth biometrics routes into dedicated module`
- `c56fef79 refactor(auth): extract auth registration route into dedicated module`
- `e86b7476 refactor(integrations): extract trading websocket and status routes into dedicated module`
- `5779ccde refactor(integrations): extract trading symbol preference routes into dedicated module`
- `0d2630b1 refactor(integrations): extract trading market, account, position, and risk routes into dedicated module`
- `37856a8b refactor(integrations): extract trading account management routes into dedicated module`
- `1a50e425 refactor(integrations): extract trading automation routes and sync enterprise docs`
- `2121433e refactor(integrations): extract trading signal history routes and preserve governance`
- `7fe8bfb5 refactor(integrations): extract trading signal action routes and keep approval governance`
- `659ad2cd refactor(integrations): extract trading order governance routes and preserve audit integrity`
- `b66a3af7 refactor(integrations): extract trading signal generation route with scope error governance`
- `618f84f3 refactor(integrations): extract trading dataset routes and sync ssot docs`
- `68c3862b refactor(integrations): extract trading scheduler and news preset routes`
- `3175c84c refactor(integrations): extract futures trading routes and preserve kucoin guards`
- `c6aeac2c refactor(integrations): extract spot trading routes and keep kucoin safeguards`
- `bd754dc7 refactor(integrations): extract margin trading routes and preserve kucoin safeguards`
- `5972bd75 refactor(integrations): harden openapi and rbac contracts for scheduler and dataset routes`
- `ada4a86b refactor(integrations): expand openapi and rbac guardrails for trading analysis and control routes`
- `be0ab43e refactor(integrations): extract trading control routes into dedicated module`
- `76b4bb17 refactor(integrations): extract stop-order routes and keep kucoin safeguards`
- `784c6144 refactor(integrations): extract market-data routes and preserve kucoin guards`
- `8ee7543d refactor(integrations): consolidate order history routes into governance module`
- `59092d2f refactor(integrations): extract llm validation routes and preserve rls-safe diagnostics`
- `d9b28d84 refactor(integrations): extract analysis history routes into dedicated module`
- `d2e3ec17 refactor(integrations): extract trading analysis routes and preserve deterministic pipeline boundaries`
- `ed645ed2 refactor(training): extract platform routes and preserve queue and config governance boundaries`
- `1fb5f218 refactor(training): extract audit routes and preserve immutable governance visibility`
- `ccb5a845 refactor(training): extract lora and orchestrator routes while preserving scoped governance`
- `35ae2b48 refactor(training): extract runtime status routes and preserve governance visibility`
- `f9ac27eb refactor(training): extract run management routes and preserve cancellation governance`
- `fe1a901a refactor(training): extract schedule routes and preserve scope reconciliation`
- `4c7a03cc refactor(training): extract data review routes and preserve approval governance`
- `250aa959 refactor(training): extract bulk import routes and preserve semantic ingest governance`
- `ea05c4f6 refactor(training): extract webhook routes and preserve security validation boundaries`
- `c044b44d refactor(training): extract data routes and preserve scope governance boundaries`
- `d6036050 refactor(training): extract job query routes and preserve audit stream governance`
- `0fba82ef refactor(training): extract job cancel route and preserve cancellation governance`
- `e6c966b4 refactor(training): extract promotion approval route and preserve approval governance`
- `639d7738 refactor(training): extract rollback route and preserve rollback governance`
- `ebd8a72a refactor(training): extract promote route and preserve promotion governance`
- `refactor(training): extract run start route and preserve idempotent launch governance` (commit desta rodada)
- `refactor(training): register job creation route module and remove remaining inline training endpoint` (commit desta rodada)
- `refactor(training): extract governance audit and promotion summary services` (commit desta rodada)
- `refactor(training): extract job lifecycle service and keep restart recovery governance` (commit desta rodada)
- `refactor(training): extract run start idempotency service and reuse across routes` (commit desta rodada)

### Próximo foco (Bloco 3)
- Bloco de bounded contexts Spot/Futures/Margin concluído no `integrations-service`; seguir com hardening residual de contratos/testes e cobertura operacional cross-service.
- Avançar blocos P1/P2 pendentes (governança AI/observabilidade/frontend) mantendo validação sequencial e SSOT atualizado a cada rodada.

## Bloco 4 - Governance/Observability P1 (Concluído)
### Escopo entregue nesta rodada
- Adição de prompt registry e audit trail de execução LLM no schema:
  - `prompt_templates`
  - `llm_execution_audit`
- Nova migration `0102_prompt_registry_and_llm_execution_audit.sql`.
- Instrumentação de audit de execução no `llm-gateway-service` para `/api/llm/complete` e `/api/llm/stream`.
- Endpoints internos de prompt registry no `llm-gateway-service`:
  - `GET /api/llm/governance/prompt-templates`
  - `POST /api/llm/governance/prompt-templates`
  - `POST /api/llm/governance/prompt-templates/:templateId/activate`
- Validação de escopo (tenant/namespace/agent) para `alice_prompt_template_id` antes da inferência.
- Registry de tool policy com governança por escopo:
  - tabela `tool_policies` + migration `0103_tool_policy_registry_and_scope_enforcement.sql`
  - endpoints internos:
    - `GET /api/llm/governance/tool-policies`
    - `POST /api/llm/governance/tool-policies`
    - `POST /api/llm/governance/tool-policies/:policyId/activate`
  - enforcement de `tool_policy_key` no `llm-gateway` com fallback governado por `namespace_profiles.config.llmGovernance`
  - auditoria de versão/política efetiva em `llm_execution_audit.metadata`
- Model registry governance no `llm-gateway`:
  - resolução de `modelVersionId` por hints (`alice_model_version_id`) + defaults de namespace profile
  - validação fail-closed de escopo/status (`active + isActive`) para `model_versions`
  - fallback controlado para `config.model`/`DEFAULT_LLM_MODEL` quando não há versão ativa elegível
  - persistência de `modelVersionId` no `llm_execution_audit` para rastreabilidade de inferência
- Prompt activation gates com avaliação/aprovação:
  - nova migration `0104_prompt_template_eval_and_approval_gates.sql`
  - `prompt_templates` com `evaluation_status`, `evaluation_score`, `evaluation_report`, `min_approvals`, `require_dual_control`
  - nova trilha `prompt_template_approvals` (upsert por aprovador/template)
  - novos endpoints internos:
    - `POST /api/llm/governance/prompt-templates/:templateId/evaluate`
    - `POST /api/llm/governance/prompt-templates/:templateId/approval`
    - `GET /api/llm/governance/prompt-templates/:templateId/approvals`
  - gate fail-closed em `activatePromptTemplate` exigindo:
    - avaliação `passed`
    - aprovador explícito
    - dual-control (quando `require_dual_control=true`)
    - quórum mínimo (`min_approvals`)
- Tool policy activation gates com aprovação auditável:
  - nova migration `0105_tool_policy_approval_gates.sql`
  - `tool_policies` com `min_approvals` + `require_dual_control`
  - nova trilha `tool_policy_approvals` (upsert por aprovador/policy)
  - novos endpoints internos:
    - `POST /api/llm/governance/tool-policies/:policyId/approval`
    - `GET /api/llm/governance/tool-policies/:policyId/approvals`
  - gate fail-closed em `activateToolPolicy` exigindo:
    - aprovador explícito
    - dual-control (quando habilitado)
    - quórum mínimo de aprovação
- Hardening de trust interno em mutações de governança no `llm-gateway-service`:
  - novo módulo `apps/llm-gateway-service/src/governance-auth.ts` com política de ator canônico (`admin/super_admin` + HMAC obrigatório)
  - mutações `POST /api/llm/governance/*` passaram a bloquear `actor mismatch` (`createdBy`/`evaluatedBy`/`approverUserId`/`approvedBy` divergente do usuário autenticado)
  - actor efetivo agora é derivado do contexto autenticado para criação/avaliação/aprovação/ativação de prompt templates e tool policies
  - cobertura unitária adicionada em `tests/unit/llm-gateway-governance-auth.test.ts`
- Hardening complementar no client compartilhado do LLM Gateway:
  - `packages/shared-utils/src/llm/llm-gateway-client.ts` passou a priorizar `generateInternalAuthHeaders` (HMAC) quando há contexto assinável
  - headers de observabilidade distribuída (`traceparent`, `x-correlation-id`, `x-request-id`) passaram a ser propagados junto da chamada ao gateway
  - fallback legado por `X-Internal-Api-Secret` mantido somente quando não há actor assinável, reduzindo trust implícito em secret estático
  - cobertura unitária adicionada/ampliada em `tests/unit/llm-gateway-client-auth.test.ts`
- Hardening de trust interno no `observability-service`:
  - autenticação interna validada (HMAC ou secret legado) agora marca `res.locals.internalAuthValidated`
  - guards RBAC (`requireObservabilityRead/Admin/LogsWrite`) passaram a usar a marca centralizada para autorização interna consistente
  - cobertura de guardrail mantida com `tests/unit/services/observability-auth-guards.test.ts`
- Gates de promoção ponta a ponta no `training-service`:
  - nova chave SSOT `TRAINING_PROMOTION_REQUIRE_APPROVAL_GATES` adicionada em `packages/database/src/system-config.ts` (known keys + validação + default)
  - `apps/training-service/src/training-governance.ts` passou a expor `requireApprovalGatesForPromotion` e aplicar gate de quórum em `canPromoteFineTuningJob`
  - `apps/training-service/src/routes/training-job-promote-routes.ts` passou a exigir gate explícito de aprovação (além de avaliação/dual-control)
  - `apps/training-service/src/training-runner.ts` passou a bloquear auto-promoção agendada quando gates de aprovação estão ativos, registrando `promotion.status=waiting_approvals`
  - `apps/training-service/src/routes/training-runtime-routes.ts` e `apps/training-service/src/openapi-specs.ts` passaram a expor `requireApprovalGatesForPromotion` nas respostas de governança
  - cobertura unitária ampliada em `tests/unit/training-governance.test.ts`
- Fortalecimento de tracing distribuído no `observability-service`:
  - middleware `createCorrelationMiddleware({ serviceName: 'observability-service' })` adicionado em `apps/observability-service/src/index.ts`
  - propagação de `traceparent` + `x-correlation-id` + `x-request-id` alinhada ao padrão dos demais microsserviços
- Hardening dos guardrails de testes de arquitetura modular no `training-service`:
  - novo helper `tests/unit/services/helpers/training-source.ts` para compor `index.ts` + `routes/*` + módulos de governança
  - testes OpenAPI/RBAC/security/tenant-context/audit atualizados para evitar falso-negativo por leitura monolítica do `index.ts`
- Hardening de DR offsite no `observability-service`:
  - `apps/observability-service/src/backup-orchestrator.ts` passou a versionar artefatos por `backupId` (`artifacts/<backupId>`) para restore determinístico de Redis/Qdrant + metadata PostgreSQL
  - sincronização offsite criptografada implementada com OpenSSL (`BACKUP_OFFSITE_DIR`, `BACKUP_OFFSITE_REQUIRED`, `BACKUP_OFFSITE_ENCRYPTION_REQUIRED`, `BACKUP_CIPHER_PASS`) e manifesto de verificação (`offsite-verification.json`)
  - `POST /api/backup/verify/:id` passou a validar prontidão operacional de restore (integridade local/offsite + `pgbackrest verify`) com resposta estruturada de readiness
  - restore de Qdrant ajustado para resolver snapshots por artefato versionado com fallback legado, eliminando dependência de path incorreto `BACKUP_DIR/<backupId>/qdrant`
  - restore de Redis passa a reportar readiness baseado em artefato rastreável (sem ativar execução destrutiva automática em runtime)

### Próximo foco
- Consolidar padronização de tracing/métricas por serviço no mesmo baseline de governança.
- Encerrar pendências P2 de UX/UI (padronização de empty states, filtros, dialogs e redução residual de mega-páginas).

### Validação executada nesta rodada (sequencial)
1. `npx -y pnpm@10.26.2 --filter @alice/database typecheck`
2. `npx -y pnpm@10.26.2 --filter @alice/database test`
3. `npx -y pnpm@10.26.2 --filter @alice/database lint`
4. `npx -y pnpm@10.26.2 --filter @alice/database build`
5. `npx -y pnpm@10.26.2 --filter @alice/training-service typecheck`
6. `npx -y pnpm@10.26.2 exec vitest run tests/unit/training-governance.test.ts tests/unit/services/training-openapi-sync.test.ts tests/unit/services/training-openapi-rbac-sync.test.ts tests/unit/services/training-security-guards.test.ts tests/unit/services/training-tenant-context-hardening.test.ts tests/unit/services/training-audit-trail-integrity-guards.test.ts tests/unit/services/training-immutable-audit-guards.test.ts tests/unit/services/training-immutable-audit-monitoring-guards.test.ts tests/unit/services/observability-auth-guards.test.ts`
7. `npx -y pnpm@10.26.2 --filter @alice/training-service lint`
8. `npx -y pnpm@10.26.2 --filter @alice/training-service build`
9. `npx -y pnpm@10.26.2 --filter @alice/observability-service exec tsc --noEmit`
10. `npx -y pnpm@10.26.2 exec vitest run tests/unit/services/observability-auth-guards.test.ts`
11. `npx -y pnpm@10.26.2 --filter @alice/observability-service exec eslint src/`
12. `npx -y pnpm@10.26.2 --filter @alice/observability-service build`

### Validação executada nesta rodada (continuação DR offsite)
1. `npx -y pnpm@10.26.2 --filter @alice/observability-service exec tsc --noEmit`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/backup-restore-game-day.test.ts tests/unit/services/observability-service.test.ts tests/unit/services/observability-auth-guards.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/observability-service exec eslint src/`
4. `npx -y pnpm@10.26.2 --filter @alice/observability-service build`

## Bloco 5 - Frontend UX P2 (Concluído)
### Escopo entregue nesta rodada
- Trading workspace navigation:
  - introdução de filtros de workspace (`Todos`, `Automação`, `Execução`, `Mercado`, `Conta & risco`, `Governança`)
  - tabs operacionais renderizadas por descritor centralizado (menos duplicação e menor carga cognitiva)
  - sincronização entre aba ativa e workspace para preservar navegação por ações internas sem regressão funcional
- Training workspace navigation:
  - introdução de filtros de workspace (`Todos`, `Operações`, `Automação`, `Ingestão`)
  - tabs renderizadas por descritor centralizado com labels dinâmicos (contagem de datasets/jobs)
  - sincronização entre workspace e aba ativa para reduzir dispersão cognitiva sem quebrar fluxos existentes
- WisePayments workspace navigation:
  - substituição de 22 tabs hardcoded por descritor centralizado de abas e render dinâmico
  - filtros de workspace (`Todos`, `Tesouraria`, `Pagamentos`, `Cartões`, `Compliance`, `Operações`)
  - sincronização de contexto entre workspace e aba ativa para manter fluxos de operação e troubleshooting
- DemoTrading workspace navigation:
  - tabs migradas para descritor centralizado com render dinâmico e scroll horizontal mobile-first
  - filtros de workspace (`Todos`, `Execução`, `Operações`, `Análises`)
  - sincronização workspace/aba ativa para priorizar fluxos de execução sem perder acesso a histórico e post-mortems
- UsersAdmin workspace navigation:
  - tabs de administração migradas para descritor centralizado com render dinâmico
  - filtros de workspace (`Todos`, `Identidade`, `Acesso & RBAC`)
  - segmentação operacional entre gestão de identidade (`users/groups`) e governança de acesso (`roles/permissions`)
- Agents workspace navigation:
  - formulário multi-aba de criação/edição migrado para descritor centralizado
  - filtros de workspace (`Todos`, `Identidade`, `Comportamento`, `Runtime`)
  - isolamento de contexto entre definição de identidade, engenharia de prompt/capacidades e parâmetros de runtime
- Namespaces workspace navigation:
  - introdução de filtros de workspace (`Todos`, `Operações`, `Governança`, `Triage`)
  - separação entre gestão operacional de namespaces (cards e CRUD) e governança híbrida/triagem de fallback
  - redução de sobrecarga cognitiva ao isolar painéis de policy (`hybridRouting`) dos alertas operacionais
- Documents workspace navigation:
  - introdução de filtros de workspace (`Todos`, `Conhecimento`, `Mídia`)
  - tabs (`documents`/`media`) migradas para descritor centralizado com render dinâmico
  - sincronização workspace/aba para reduzir navegação redundante mantendo paridade funcional
- Chat workspace navigation:
  - introdução de filtros de workspace (`Todos`, `Conversa`, `Operações`, `Governança`, `Diagnóstico`)
  - controles de governança (approval policy + routing) condicionados por workspace para reduzir ruído operacional
  - ações operacionais e diagnósticas (training batch, seleção/exclusão, stream diagnostics) isoladas por contexto sem regressão funcional

### Próximo foco
- Redução progressiva de mega-páginas em workspaces por tarefa.
- Padronização de estados vazios/filtros/dialogs/fluxos operacionais.

### Critério de aceite
- Redução de carga cognitiva e maior previsibilidade de estado React.

### Escopo entregue nesta rodada (continuação 07/03/2026)
- Componentização de filtros de workspace:
  - novo componente `apps/frontend-service/src/components/ui/workspace-filter-bar.tsx`
  - aplicação em `Trading`, `WisePayments`, `Training`, `Chat`, `Documents`, `Agents`, `Namespaces`, `UsersAdmin` e `DemoTrading`
  - preservação de callbacks, `data-testid` e sincronização workspace/aba já existentes
- Padronização de empty states:
  - novo componente `apps/frontend-service/src/components/ui/empty-state.tsx`
  - aplicação inicial em `DemoTrading` (posições, saldos, ordens, post-mortems e histórico)
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`

### Validação executada nesta rodada (sequencial)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec tsc --noEmit`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts tests/unit/services/demo-trading-engine-validation.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec eslint src/`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado
- Expandir `EmptyState` para os demais workspaces P2 com maior inconsistência (Trading/UsersAdmin/Documents).
- Iniciar quebra incremental de mega-páginas por seções (`overview/list/detail/config/operations/audit`) sem regressão funcional.

### Escopo entregue nesta rodada (continuação 2 - 07/03/2026)
- Expansão de `EmptyState` em páginas P2 adicionais:
  - `apps/frontend-service/src/pages/Trading.tsx`: estados vazios de candidates, histórico de runs e ordem selecionada
  - `apps/frontend-service/src/pages/UsersAdmin.tsx`: estados vazios de grupos e roles customizadas
- Preservação de contratos funcionais:
  - sem alteração de payloads/calls de API
  - sem alteração de filtros, permissões ou fluxo de mutações
  - foco exclusivo em padronização visual e redução de duplicação
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`

### Validação executada nesta rodada (sequencial - continuação 2)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec tsc --noEmit`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts tests/unit/services/demo-trading-engine-validation.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec eslint src/`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 2)
- Expandir `EmptyState` para `Documents` e pontos restantes de `UsersAdmin`/`Trading` com baixa legibilidade.
- Iniciar fatiamento de mega-páginas por sub-workspaces orientados a tarefa (`overview/list/detail/config/operations/audit`).

### Escopo entregue nesta rodada (continuação 3 - 07/03/2026)
- Expansão de `EmptyState` em `apps/frontend-service/src/pages/Documents.tsx`:
  - estado vazio de documentos (`documents.empty.*`)
  - estado vazio de mídias (`documents.media.empty*`)
  - preservação de ícones existentes (`FileText`/`ImageIcon`) e textos i18n já aprovados
- Consistência de UX:
  - redução de divergência visual entre `Documents`, `DemoTrading`, `Trading` e `UsersAdmin`
  - manutenção de animações e layout sem alterar contratos backend/frontend
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`

### Validação executada nesta rodada (sequencial - continuação 3)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec tsc --noEmit`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts tests/unit/services/demo-trading-engine-validation.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec eslint src/`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 3)
- Padronizar dialogs e estados vazios remanescentes em `UsersAdmin` (tabelas/dialogs de permissões).
- Iniciar decomposição incremental das mega-páginas por submódulos de workspace (começando por `Documents` e `UsersAdmin`).

### Escopo entregue nesta rodada (continuação 4 - 07/03/2026)
- Padronização de tabelas vazias em `UsersAdmin`:
  - novo componente `apps/frontend-service/src/components/ui/table-empty-row.tsx`
  - adoção em tabelas de usuários (`users.empty`), permissões (`permissions.empty`) e permissões customizadas
  - remoção de duplicação de `TableRow/TableCell` vazios com `colSpan` hardcoded espalhado
- Consistência visual de dialogs/tabelas:
  - alinhamento do estado vazio de tabelas com os padrões já aplicados em cards/listas (`EmptyState`)
  - manutenção de comportamento de loading e mutações sem alteração de contrato
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`

### Validação executada nesta rodada (sequencial - continuação 4)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec tsc --noEmit`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts tests/unit/services/demo-trading-engine-validation.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec eslint src/`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 4)
- Padronizar estados vazios remanescentes em dialogs do `UsersAdmin` (listas internas de grupos/permissões).
- Iniciar decomposição incremental das mega-páginas por submódulos de workspace (prioridade: `UsersAdmin` e `Documents`).

### Escopo entregue nesta rodada (continuação 5 - 07/03/2026)
- Padronização de vazio no diálogo de usuário (`UsersAdmin`):
  - `apps/frontend-service/src/pages/UsersAdmin.tsx` passou a usar `EmptyState` quando não há grupos disponíveis para atribuição
  - remoção de mensagem inline ad-hoc para alinhamento com padrão visual P2
- Continuidade do hardening de UX:
  - consistência entre estados vazios de tabelas (`TableEmptyRow`) e estados vazios de formulários/dialogs (`EmptyState`)
  - sem alteração de mutações, payloads ou comportamento de RBAC
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`

### Validação executada nesta rodada (sequencial - continuação 5)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec tsc --noEmit`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts tests/unit/services/demo-trading-engine-validation.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec eslint src/`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 5)
- Iniciar decomposição incremental de `UsersAdmin` e `Documents` por submódulos (`overview/list/detail/config/operations/audit`).
- Padronizar dialogs remanescentes com componentes compartilhados sem regressão de fluxo.

### Escopo entregue nesta rodada (continuação 6 - 07/03/2026)
- Conclusão da padronização de vazio no diálogo de usuário (`UsersAdmin`):
  - `apps/frontend-service/src/pages/UsersAdmin.tsx`: lista de grupos no diálogo de usuário agora usa `EmptyState` (remoção de mensagem inline ad-hoc)
  - alinhamento total com o padrão compartilhado já aplicado em tabelas/cards (`TableEmptyRow` + `EmptyState`)
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`

### Validação executada nesta rodada (sequencial - continuação 6)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec tsc --noEmit`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts tests/unit/services/demo-trading-engine-validation.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec eslint src/`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 6)
- Iniciar decomposição incremental de `UsersAdmin` e `Documents` por submódulos (`overview/list/detail/config/operations/audit`).
- Padronizar dialogs remanescentes com componentes compartilhados sem regressão de fluxo.

### Escopo entregue nesta rodada (continuação 7 - 07/03/2026)
- Início da decomposição incremental de `UsersAdmin`:
  - novo submódulo `apps/frontend-service/src/pages/users-admin/components/users-tab-content.tsx` criado para isolar a aba de usuários (`users`) com tipagem estrita
  - `apps/frontend-service/src/pages/UsersAdmin.tsx` atualizado para consumir `UsersTabContent`, removendo bloco inline monolítico da aba e preservando contratos de mutação (`create/edit/status`)
  - handlers de ação de usuário (`create`, `edit`, `toggle status`) centralizados no container para manter responsabilidade clara entre composição e apresentação
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de mantenibilidade da página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`

### Validação executada nesta rodada (sequencial - continuação 7)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec tsc --noEmit`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts tests/unit/services/demo-trading-engine-validation.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec eslint src/`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 7)
- Continuar decomposição incremental de `UsersAdmin` (abas `groups`, `roles` e `permissions`) em submódulos de apresentação.
- Iniciar decomposição incremental de `Documents` para separar listagem, detalhe e operações em boundaries de workspace.

### Escopo entregue nesta rodada (continuação 8 - 07/03/2026)
- Continuidade da decomposição incremental de `UsersAdmin`:
  - novo submódulo `apps/frontend-service/src/pages/users-admin/components/groups-tab-content.tsx` criado para isolar a aba de grupos (`groups`) com tipagem estrita
  - `apps/frontend-service/src/pages/UsersAdmin.tsx` atualizado para consumir `GroupsTabContent`, removendo bloco inline monolítico da aba
  - ações de grupo (`create`, `edit`, `manage members`, `delete`) centralizadas em handlers no container para preservar boundary entre apresentação e orquestração
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`

### Validação executada nesta rodada (sequencial - continuação 8)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec tsc --noEmit`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts tests/unit/services/demo-trading-engine-validation.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec eslint src/`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 8)
- Continuar decomposição incremental de `UsersAdmin` (abas `roles` e `permissions`) em submódulos de apresentação.
- Iniciar decomposição incremental de `Documents` para separar listagem, detalhe e operações em boundaries de workspace.

### Escopo entregue nesta rodada (continuação 9 - 07/03/2026)
- Continuidade da decomposição incremental de `UsersAdmin`:
  - novo submódulo `apps/frontend-service/src/pages/users-admin/components/roles-tab-content.tsx` criado para isolar a aba de roles (`roles`) com tipagem estrita
  - `apps/frontend-service/src/pages/UsersAdmin.tsx` atualizado para consumir `RolesTabContent`, removendo bloco inline monolítico da aba
  - ações de roles (`create`, `edit`, `manage permissions`, `delete`) e transição de role base para aba de permissões centralizadas em handlers do container
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`

### Validação executada nesta rodada (sequencial - continuação 9)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec tsc --noEmit`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts tests/unit/services/demo-trading-engine-validation.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec eslint src/`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 9)
- Continuar decomposição incremental de `UsersAdmin` (aba `permissions`) em submódulo de apresentação.
- Iniciar decomposição incremental de `Documents` para separar listagem, detalhe e operações em boundaries de workspace.

### Escopo entregue nesta rodada (continuação 10 - 07/03/2026)
- Continuidade da decomposição incremental de `UsersAdmin`:
  - novo submódulo `apps/frontend-service/src/pages/users-admin/components/permissions-tab-content.tsx` criado para isolar a aba de permissões (`permissions`) com tipagem estrita
  - `apps/frontend-service/src/pages/UsersAdmin.tsx` atualizado para consumir `PermissionsTabContent`, removendo bloco inline monolítico da aba
  - ações de permissões (`create`, `edit`, `delete`, `toggle role access`) centralizadas em handlers do container, preservando debounce/save queue de role permissions
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`

### Validação executada nesta rodada (sequencial - continuação 10)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec tsc --noEmit`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts tests/unit/services/demo-trading-engine-validation.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec eslint src/`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 10)
- Iniciar decomposição incremental de `Documents` para separar listagem, detalhe e operações em boundaries de workspace.
- Revisar remanescentes de mega-componentes de `UsersAdmin` (dialogs grandes) para fatiamento por submódulos reutilizáveis.

### Escopo entregue nesta rodada (continuação 11 - 07/03/2026)
- Continuidade da decomposição incremental de `UsersAdmin` (dialogs):
  - novo submódulo `apps/frontend-service/src/pages/users-admin/components/custom-role-permissions-dialog.tsx` criado para isolar o diálogo de permissões de role customizada
  - `apps/frontend-service/src/pages/UsersAdmin.tsx` atualizado para consumir `CustomRolePermissionsDialog`, removendo bloco inline de dialog/tabela
  - fluxo de toggle de permissões customizadas preservado via handlers no container com debounce/save queue assíncrona inalterada
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`

### Validação executada nesta rodada (sequencial - continuação 11)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec tsc --noEmit`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts tests/unit/services/demo-trading-engine-validation.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec eslint src/`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 11)
- Iniciar decomposição incremental de `Documents` para separar listagem, detalhe e operações em boundaries de workspace.
- Fatiar o diálogo de usuário (`UsersAdmin`) em subcomponentes de seções (`profile`, `roles`, `customRoles`, `groups`) mantendo fluxos atuais.

### Escopo entregue nesta rodada (continuação 12 - 07/03/2026)
- Continuidade da decomposição incremental de `UsersAdmin` (dialog principal de usuário):
  - novos submódulos `apps/frontend-service/src/pages/users-admin/components/user-dialog-profile-section.tsx`, `user-dialog-roles-section.tsx`, `user-dialog-custom-roles-section.tsx` e `user-dialog-groups-section.tsx` criados para isolar seções `profile`, `roles`, `customRoles` e `groups`
  - `apps/frontend-service/src/pages/UsersAdmin.tsx` atualizado para consumir os submódulos e manter o container como boundary de estado/mutações
  - handlers de atualização do formulário centralizados no container para preservar responsabilidade única e contratos existentes
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`

### Validação executada nesta rodada (sequencial - continuação 12)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec tsc --noEmit`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts tests/unit/services/demo-trading-engine-validation.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec eslint src/`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 12)
- Iniciar decomposição incremental de `Documents` para separar listagem, detalhe e operações em boundaries de workspace.
- Seguir fatiamento de remanescentes de `UsersAdmin` com maior densidade (dialog wrappers/form boundaries) sem alterar contratos.

### Escopo entregue nesta rodada (continuação 13 - 07/03/2026)
- Início da decomposição incremental de `Documents` por boundaries de workspace:
  - novo submódulo `apps/frontend-service/src/pages/documents/components/documents-tab-content.tsx` criado para isolar o conteúdo da aba `documents`
  - novo submódulo `apps/frontend-service/src/pages/documents/components/media-tab-content.tsx` criado para isolar o conteúdo da aba `media`
  - `apps/frontend-service/src/pages/Documents.tsx` atualizado para consumir os submódulos com callbacks de render (`renderDocumentCard` e `renderMediaCard`) e manter o container como boundary de estado/mutações
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`

### Validação executada nesta rodada (sequencial - continuação 13)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec tsc --noEmit`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts tests/unit/services/demo-trading-engine-validation.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec eslint src/`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 13)
- Seguir decomposição incremental de `Documents` para isolar dialogs/operations boundaries (`upload`, `delete`, `send-to-training`) sem alterar contratos.
- Revisar remanescentes de mega-componentes em `UsersAdmin` e `Documents` para conclusão do bloco P2.

### Escopo entregue nesta rodada (continuação 14 - 07/03/2026)
- Continuidade da decomposição incremental de `Documents` em boundaries de operação/dialog:
  - novo submódulo `apps/frontend-service/src/pages/documents/components/upload-dialog.tsx` criado para isolar o fluxo de upload
  - novo submódulo `apps/frontend-service/src/pages/documents/components/delete-confirm-dialog.tsx` criado para consolidar confirmação de exclusão
  - novo submódulo `apps/frontend-service/src/pages/documents/components/media-send-training-dialog.tsx` criado para isolar envio de mídia para treinamento
  - `apps/frontend-service/src/pages/Documents.tsx` atualizado para consumir os submódulos, mantendo handlers de estado/mutações no container (`handleConfirmDelete*`, `handleConfirmSendToTraining`, `handleSendTrainingDialog*`)
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`

### Validação executada nesta rodada (sequencial - continuação 14)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec tsc --noEmit`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts tests/unit/services/demo-trading-engine-validation.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec eslint src/`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 14)
- Seguir redução de remanescentes monolíticos em `Documents.tsx` e `UsersAdmin.tsx` (boundaries de viewer/detail/operations) até estabilizar P2.
- Avançar revisão final de pendências dos blocos P1/P2 para fechamento do plano.

### Escopo entregue nesta rodada (continuação 15 - 07/03/2026)
- Continuidade da decomposição incremental de `Documents` com extração de componente utilitário de upload:
  - novo submódulo `apps/frontend-service/src/pages/documents/components/upload-zone.tsx` criado para isolar drag-and-drop, seleção de arquivo e estado visual de envio
  - `apps/frontend-service/src/pages/Documents.tsx` atualizado para consumir `UploadZone` compartilhado e remover implementação inline da dropzone
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`

### Validação executada nesta rodada (sequencial - continuação 15)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec tsc --noEmit`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts tests/unit/services/demo-trading-engine-validation.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec eslint src/`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 15)
- Seguir redução de remanescentes monolíticos em `Documents.tsx` e `UsersAdmin.tsx` (viewer/detail boundaries) até estabilizar P2.
- Avançar revisão final de pendências dos blocos P1/P2 para fechamento do plano.

### Escopo entregue nesta rodada (continuação 16 - 07/03/2026)
- Continuidade da decomposição incremental de `Documents` com extração de boundary de viewer/detail:
  - novo submódulo `apps/frontend-service/src/pages/documents/components/document-viewer-dialog.tsx` criado para isolar o diálogo de visualização/edição de documento
  - `apps/frontend-service/src/pages/Documents.tsx` atualizado para consumir `DocumentViewerDialog`, removendo bloco inline monolítico de viewer e mantendo o container como boundary de estado/mutações
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`

### Validação executada nesta rodada (sequencial - continuação 16)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec tsc --noEmit`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts tests/unit/services/demo-trading-engine-validation.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec eslint src/`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 16)
- Seguir redução de remanescentes monolíticos em `Documents.tsx` (`DocumentCard`/`MediaCard`) com extração por submódulos de apresentação.
- Fechar revisão das pendências P2 de frontend (workspaces + dialogs) para preparar fechamento formal do bloco.

### Escopo entregue nesta rodada (continuação 17 - 07/03/2026)
- Continuidade da decomposição incremental de `Documents` com extração de boundaries de apresentação:
  - novo submódulo `apps/frontend-service/src/pages/documents/components/document-card.tsx` criado para isolar renderização/ações do card de documento
  - novo submódulo `apps/frontend-service/src/pages/documents/components/media-card.tsx` criado para isolar renderização/ações do card de mídia
  - `apps/frontend-service/src/pages/Documents.tsx` atualizado para consumir `DocumentCard`/`MediaCard`, removendo blocos inline monolíticos e mantendo o container como boundary de estado/mutações
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`

### Validação executada nesta rodada (sequencial - continuação 17)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec tsc --noEmit`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts tests/unit/services/demo-trading-engine-validation.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec eslint src/`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 17)
- Seguir decomposição de remanescentes monolíticos em `Documents.tsx` (actions/search/filter boundaries) para reduzir densidade do container.
- Encerrar revisão das pendências P2 no frontend e preparar fechamento formal do bloco no plano.

### Escopo entregue nesta rodada (continuação 18 - 07/03/2026)
- Continuidade da decomposição incremental de `Documents` com extração de header operacional:
  - novo submódulo `apps/frontend-service/src/pages/documents/components/documents-workspace-header.tsx` criado para isolar título, badges de métricas, filtro de workspace e tabs (`documents`/`media`)
  - `apps/frontend-service/src/pages/Documents.tsx` atualizado para consumir `DocumentsWorkspaceHeader`, removendo bloco inline de layout/topbar e mantendo o container focado em estado/mutações
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`

### Validação executada nesta rodada (sequencial - continuação 18)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec tsc --noEmit`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts tests/unit/services/demo-trading-engine-validation.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec eslint src/`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 18)
- Seguir decomposição de remanescentes de estado/mutações em `Documents.tsx` para reduzir densidade do container (handlers e filtros com alta concentração).
- Avançar pendências P2 de `UsersAdmin`/`Documents` até fechamento formal do bloco.

### Escopo entregue nesta rodada (continuação 19 - 07/03/2026)
- Continuidade da decomposição incremental de `Documents` com extração de SSOT interno da página:
  - novo módulo `apps/frontend-service/src/pages/documents/types.ts` criado para centralizar tipos (`Document`, `MediaUpload`, `Namespace`, respostas de API e tipos de workspace/tab/status)
  - novo módulo `apps/frontend-service/src/pages/documents/config.ts` criado para centralizar `DOCUMENTS_WORKSPACE_OPTIONS`, `DOCUMENTS_TAB_CONFIG` e helper `getDocumentProcessingStatus`
  - `apps/frontend-service/src/pages/Documents.tsx` atualizado para consumir `types/config` e reduzir densidade estrutural do container sem alteração de contratos
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`

### Validação executada nesta rodada (sequencial - continuação 19)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec tsc --noEmit`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts tests/unit/services/demo-trading-engine-validation.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec eslint src/`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 19)
- Seguir decomposição de handlers/mutações em `Documents.tsx` para reduzir densidade residual do container.
- Avançar pendências P2 remanescentes em `UsersAdmin` e fechar checklist do bloco com revisão final de UX operacional.

### Escopo entregue nesta rodada (continuação 20 - 07/03/2026)
- Continuidade da decomposição incremental de `UsersAdmin` com extração de formulários críticos:
  - novos submódulos `apps/frontend-service/src/pages/users-admin/components/group-form-dialog.tsx`, `custom-role-form-dialog.tsx` e `permission-form-dialog.tsx` criados para isolar dialogs de criação/edição de grupos, roles customizadas e permissões
  - `apps/frontend-service/src/pages/UsersAdmin.tsx` atualizado para consumir os submódulos, removendo blocos inline de formulários e mantendo o container como boundary de estado/mutações
  - `apps/frontend-service/src/pages/users-admin/form-schemas.ts` criado para centralizar schemas/helpers de formulários (`parse/build permission code`, payload builders e slug normalization)
  - `apps/frontend-service/src/pages/users-admin/types.ts` criado para centralizar tipos de domínio do workspace (`Role`, `UserItem`, `GroupItem`, `PermissionItem`, etc.)
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`

### Validação executada nesta rodada (sequencial - continuação 20)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec tsc --noEmit`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts tests/unit/services/demo-trading-engine-validation.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec eslint src/`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 20)
- Seguir decomposição do `UsersAdmin.tsx` com extração do `GroupMembersDialog` e helpers remanescentes.
- Voltar para `Documents.tsx` para reduzir densidade residual de handlers/mutações e concluir checklist P2 do frontend.

### Escopo entregue nesta rodada (continuação 21 - 07/03/2026)
- Continuidade da decomposição incremental de `UsersAdmin` com extração de gestão de membros:
  - novo submódulo `apps/frontend-service/src/pages/users-admin/components/group-members-dialog.tsx` criado para isolar o diálogo de membros de grupo (`GET/POST/DELETE /api/auth/groups/:id/users*`) com tipagem estrita
  - `apps/frontend-service/src/pages/UsersAdmin.tsx` atualizado para consumir `GroupMembersDialog`, removendo bloco inline monolítico e mantendo o container como boundary de estado/mutações
  - helper de nome de usuário e imports órfãos removidos do container para reduzir acoplamento e manter lint/typecheck limpos
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`

### Validação executada nesta rodada (sequencial - continuação 21)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec tsc --noEmit`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts tests/unit/services/demo-trading-engine-validation.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec eslint src/`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 21)
- Seguir decomposição residual de `UsersAdmin.tsx` em boundaries de estado/mutação com maior densidade (permission orchestration e user lifecycle handlers).
- Voltar para `Documents.tsx` para fatiar handlers/mutações remanescentes e fechar checklist P2 com revisão final de UX operacional.

### Escopo entregue nesta rodada (continuação 22 - 07/03/2026)
- Continuidade da decomposição incremental de `UsersAdmin` com extração da orquestração de permissões:
  - novo submódulo `apps/frontend-service/src/pages/users-admin/hooks/use-role-permission-orchestration.ts` criado para concentrar debounce/save queue de permissões por role e custom role, incluindo invalidação de cache e toasts operacionais
  - `apps/frontend-service/src/pages/UsersAdmin.tsx` atualizado para consumir o hook e remover blocos inline de estado/ref/effects/mutações de orquestração de permissões
  - `UsersAdmin.tsx` reduzido de 1147 para 1007 linhas sem alteração de contratos (`PUT /api/auth/roles/:role/permissions` e `PUT /api/auth/custom-roles/:id/permissions`)
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`

### Validação executada nesta rodada (sequencial - continuação 22)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec tsc --noEmit`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts tests/unit/services/demo-trading-engine-validation.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec eslint src/`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 22)
- Seguir decomposição residual de `UsersAdmin.tsx` com extração de boundary de lifecycle de usuário (criação/edição/atribuições) para reduzir densidade restante do container.
- Voltar para `Documents.tsx` para fatiar handlers/mutações remanescentes e fechar checklist P2 com revisão final de UX operacional.

### Escopo entregue nesta rodada (continuação 23 - 07/03/2026)
- Continuidade da decomposição incremental de `UsersAdmin` com extração de lifecycle de usuário:
  - novo submódulo `apps/frontend-service/src/pages/users-admin/hooks/use-user-management.ts` criado para centralizar mutações/validações/toasts de criação, edição, salvamento e atualização de status de usuário
  - helper `createInitialUserDialogForm()` centralizado no mesmo hook para eliminar duplicação de estado inicial do diálogo de usuário
  - `apps/frontend-service/src/pages/UsersAdmin.tsx` atualizado para consumir `useUserManagement`, removendo bloco inline monolítico de mutações e reduzindo acoplamento do container
  - `UsersAdmin.tsx` reduzido de 1007 para 829 linhas sem alteração de contratos (`/api/auth/register`, `/api/users/:id*`)
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`

### Validação executada nesta rodada (sequencial - continuação 23)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec tsc --noEmit`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts tests/unit/services/demo-trading-engine-validation.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec eslint src/`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 23)
- Voltar para `Documents.tsx` para fatiar handlers/mutações remanescentes em hook/boundary dedicado e concluir checklist P2 do frontend.
- Executar revisão final de pendências dos blocos 3/4/5 para fechamento formal do plano com status consolidado.

### Escopo entregue nesta rodada (continuação 24 - 07/03/2026)
- Continuidade da decomposição incremental de `Documents` com extração de mutações operacionais:
  - novo submódulo `apps/frontend-service/src/pages/documents/hooks/use-documents-mutations.ts` criado para centralizar mutações de upload, exclusão, envio para treinamento e reprocessamento
  - `apps/frontend-service/src/pages/Documents.tsx` atualizado para consumir `useDocumentsMutations`, removendo bloco inline de mutações e mantendo contratos de API existentes
  - `Documents.tsx` reduzido de 581 para 486 linhas sem alteração de comportamento operacional (`/api/rag/documents*` e `/api/media/uploads*`)
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`

### Validação executada nesta rodada (sequencial - continuação 24)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec tsc --noEmit`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts tests/unit/services/demo-trading-engine-validation.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec eslint src/`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 24)
- Fechar pendências residuais de P2 (`Documents.tsx`) com extração de handlers/dialog orchestration restantes para reduzir ainda mais a densidade do container.
- Executar revisão consolidada de status dos blocos 3/4/5 para definir fechamento formal do plano e pendências finais objetivas.

### Escopo entregue nesta rodada (continuação 25 - 07/03/2026)
- Continuidade da decomposição incremental de `Documents` com extração de orquestração de dialogs:
  - novo submódulo `apps/frontend-service/src/pages/documents/hooks/use-documents-dialog-orchestration.ts` criado para centralizar handlers de confirmação/abertura/fechamento de dialogs (`delete document`, `delete media`, `send-to-training`) e helper de namespace do upload
  - `apps/frontend-service/src/pages/Documents.tsx` atualizado para consumir `useDocumentsDialogOrchestration`, removendo handlers inline remanescentes de orchestration e mantendo contratos de API existentes
  - `Documents.tsx` reduzido de 486 para 453 linhas sem alteração de comportamento operacional (`/api/rag/documents*` e `/api/media/uploads*`)
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`

### Validação executada nesta rodada (sequencial - continuação 25)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec tsc --noEmit`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts tests/unit/services/demo-trading-engine-validation.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec eslint src/`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 25)
- Seguir redução residual de `Documents.tsx` com extração de derived state/filtros para hook dedicado e fechamento formal do checklist P2.
- Executar revisão consolidada dos blocos 3/4/5 para declarar status final de pendências objetivas no plano.

### Escopo entregue nesta rodada (continuação 26 - 07/03/2026)
- Continuidade da decomposição incremental de `Documents` com extração de estado derivado/filtros:
  - novo submódulo `apps/frontend-service/src/pages/documents/hooks/use-documents-derived-state.ts` criado para centralizar filtros de busca/status, stats, namespace map e listas derivadas de documentos/mídias
  - `apps/frontend-service/src/pages/Documents.tsx` atualizado para consumir `useDocumentsDerivedState`, removendo lógica inline residual de derivação e mantendo contratos de API existentes
  - `Documents.tsx` reduzido de 453 para 426 linhas sem alteração de comportamento operacional (`/api/rag/documents*` e `/api/media/uploads*`)
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`

### Validação executada nesta rodada (sequencial - continuação 26)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec tsc --noEmit`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts tests/unit/services/demo-trading-engine-validation.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec eslint src/`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 26)
- Executar revisão consolidada dos blocos 3/4/5 para fechar checklist P2 e declarar pendências finais objetivas.
- Endurecer eventuais lacunas residuais de observabilidade/tracing cross-service identificadas na revisão final.

### Escopo entregue nesta rodada (continuação 27 - 07/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração da aba de ordens:
  - novo submódulo `apps/frontend-service/src/components/trading/TradingOrdersTabContent.tsx` criado para isolar o conteúdo operacional da aba `orders` (sync, ações, tabela, review/approve/reject/cancel)
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar `TradingOrdersTabContent`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o novo componente e manter o container como composition root de estado/mutações
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`

### Validação executada nesta rodada (sequencial - continuação 27)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec tsc --noEmit`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts tests/unit/services/demo-trading-engine-validation.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec eslint src/`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 27)
- Seguir fatiamento incremental de `Trading.tsx` (abas `portfolio-auto` e `signals-auto`) para reduzir a densidade residual da mega-página.
- Executar revisão consolidada dos blocos 3/4/5 para fechar pendências objetivas restantes no plano.

### Escopo entregue nesta rodada (continuação 28 - 07/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração da aba `portfolio-auto`:
  - novo submódulo `apps/frontend-service/src/components/trading/TradingPortfolioAutoTabContent.tsx` criado para isolar o conteúdo operacional da aba (`seleção de portfólio`, `enqueue pipeline`, `status de run`, `top candidates`, `rebalance/execution reports`)
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar `TradingPortfolioAutoTabContent`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o novo componente e manter o container como composition root de estado/mutações
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`

### Validação executada nesta rodada (sequencial - continuação 28)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec tsc --noEmit`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts tests/unit/services/demo-trading-engine-validation.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec eslint src/`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 28)
- Seguir fatiamento incremental de `Trading.tsx` com extração da aba `signals-auto` para reduzir a densidade residual da mega-página.
- Executar revisão consolidada dos blocos 3/4/5 para fechar pendências objetivas restantes no plano.

### Escopo entregue nesta rodada (continuação 29 - 07/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração da aba `signals-auto`:
  - novo submódulo `apps/frontend-service/src/components/trading/TradingSignalsAutoTabContent.tsx` criado para isolar o conteúdo operacional da aba (`auto-mix`, escopo/ativos/modos, histórico de auto-runs, detalhe de decisão e navegação para sinal gerado)
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar `TradingSignalsAutoTabContent`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o novo componente e manter o container como composition root de estado/mutações
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`

### Validação executada nesta rodada (sequencial - continuação 29)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec tsc --noEmit`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts tests/unit/services/demo-trading-engine-validation.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec eslint src/`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 29)
- Seguir fatiamento incremental de `Trading.tsx` com extração da aba `lab` e revisão dos blocos remanescentes de `positions/account/control`.
- Executar revisão consolidada dos blocos 3/4/5 para fechar pendências objetivas restantes no plano.

### Escopo entregue nesta rodada (continuação 30 - 07/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração da aba `lab`:
  - novo submódulo `apps/frontend-service/src/components/trading/TradingLabTabContent.tsx` criado para isolar o conteúdo operacional da aba (`alerta de overfitting`, enqueue de jobs assíncronos e navegação para análise manual)
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar `TradingLabTabContent`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o novo componente e manter o container como composition root de estado/mutações
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`

### Validação executada nesta rodada (sequencial - continuação 30)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec tsc --noEmit`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts tests/unit/services/demo-trading-engine-validation.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec eslint src/`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 30)
- Seguir fatiamento incremental de `Trading.tsx` com extração das abas `positions`, `account` e `control` para reduzir densidade residual da mega-página.
- Executar revisão consolidada dos blocos 3/4/5 para fechar pendências objetivas restantes no plano.

### Escopo entregue nesta rodada (continuação 31 - 07/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração das abas `control` e `account`:
  - novo submódulo `apps/frontend-service/src/components/trading/TradingControlTabContent.tsx` criado para isolar o conteúdo operacional da aba `control` (handover/takeover, toggle de trading e histórico de controle)
  - novo submódulo `apps/frontend-service/src/components/trading/TradingAccountTabContent.tsx` criado para isolar o conteúdo operacional da aba `account` (overview, depósitos/withdrawals, transferências, sub-contas, ledgers e trade fees)
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar os novos módulos
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir os novos componentes e manter o container como composition root de estado/mutações
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`

### Validação executada nesta rodada (sequencial - continuação 31)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec tsc --noEmit`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts tests/unit/services/demo-trading-engine-validation.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec eslint src/`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 31)
- Seguir fatiamento incremental de `Trading.tsx` com extração da aba `positions` (maior densidade residual) para concluir o núcleo da mega-página.
- Executar revisão consolidada dos blocos 3/4/5 para fechar pendências objetivas restantes no plano.

### Escopo entregue nesta rodada (continuação 32 - 07/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração da aba `positions`:
  - novo submódulo `apps/frontend-service/src/components/trading/TradingPositionsTabContent.tsx` criado para isolar o conteúdo operacional da aba (futuros com cotação WS e ações de posição, saldos spot, posições margin cross/isolated e painel de margin debit)
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar `TradingPositionsTabContent`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o novo componente e manter o container como composition root de estado/mutações
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`

### Validação executada nesta rodada (sequencial - continuação 32)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec tsc --noEmit`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts tests/unit/services/demo-trading-engine-validation.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec eslint src/`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 32)
- Seguir fatiamento incremental de `Trading.tsx` nas abas de maior densidade remanescente (`signals`, `history` e `postmortems`) para conclusão do P2 no módulo.
- Executar revisão consolidada dos blocos 3/4/5 para fechar pendências objetivas restantes no plano.

### Escopo entregue nesta rodada (continuação 33 - 07/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração das abas `history` e `postmortems`:
  - novo submódulo `apps/frontend-service/src/components/trading/TradingHistoryTabContent.tsx` criado para isolar o conteúdo operacional da aba `history` (seleção em lote, exclusão por escopo, tabela de ordens e paginação incremental)
  - novo submódulo `apps/frontend-service/src/components/trading/TradingPostMortemsTabContent.tsx` criado para isolar o conteúdo operacional da aba `postmortems` (refresh, cards de qualidade/confiança e ação de envio para treinamento)
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar os novos módulos
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir os novos componentes e manter o container como composition root de estado/mutações
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`

### Validação executada nesta rodada (sequencial - continuação 33)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec tsc --noEmit`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts tests/unit/services/demo-trading-engine-validation.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec eslint src/`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 33)
- Seguir fatiamento incremental de `Trading.tsx` na aba `signals` (maior densidade remanescente) para conclusão do P2 no módulo.
- Executar revisão consolidada dos blocos 3/4/5 para fechar pendências objetivas restantes no plano.

### Escopo entregue nesta rodada (continuação 34 - 07/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração da seção de resultados da aba `signals`:
  - novo submódulo `apps/frontend-service/src/components/trading/TradingSignalsResultsSection.tsx` criado para isolar o conteúdo operacional de detalhe/lista/aprovação de sinais (card de detalhe, tabela de sinais, seleção e ação de desativação)
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar `TradingSignalsResultsSection`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o novo componente e manter o container como composition root de estado/mutações
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 34)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts tests/unit/services/demo-trading-engine-validation.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec eslint src/`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 34)
- Seguir fatiamento incremental de `Trading.tsx` na aba `signals` (configuração/perfil/execução) para conclusão do P2 no módulo.
- Executar revisão consolidada dos blocos 3/4/5 para fechar pendências objetivas restantes no plano.

### Escopo entregue nesta rodada (continuação 35 - 07/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração da seção de scheduler da aba `signals`:
  - novo submódulo `apps/frontend-service/src/components/trading/TradingSignalsSchedulerSection.tsx` criado para isolar o conteúdo operacional de configuração/status/salvamento do scheduler (timeframes, intervalo, símbolos, limite por run, enable/disable e status operacional)
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar `TradingSignalsSchedulerSection`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o novo componente e manter o container como composition root de estado/mutações
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 35)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts tests/unit/services/demo-trading-engine-validation.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec eslint src/`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 35)
- Seguir fatiamento incremental de `Trading.tsx` na aba `signals` (perfil/configuração restante) para conclusão do P2 no módulo.
- Executar revisão consolidada dos blocos 3/4/5 para fechar pendências objetivas restantes no plano.

### Escopo entregue nesta rodada (continuação 36 - 07/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração da seção de configuração de perfil da aba `signals`:
  - novo submódulo `apps/frontend-service/src/components/trading/TradingSignalsProfileConfigurationSection.tsx` criado para isolar o conteúdo operacional de timeframes, indicadores, técnicas, ensemble, arbitragem e fontes
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar `TradingSignalsProfileConfigurationSection`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o novo componente e manter o container como composition root de estado/mutações
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 36)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts tests/unit/services/demo-trading-engine-validation.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec eslint src/`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 36)
- Seguir fatiamento incremental de `Trading.tsx` na aba `signals` (news config/actions remanescentes) para conclusão do P2 no módulo.
- Executar revisão consolidada dos blocos 3/4/5 para fechar pendências objetivas restantes no plano.

### Escopo entregue nesta rodada (continuação 37 - 07/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração da seção de news/actions da aba `signals`:
  - novo submódulo `apps/frontend-service/src/components/trading/TradingSignalsNewsAndActionsSection.tsx` criado para isolar `NewsConfigEditor` e ações operacionais (`save profile`, `generate now`, `create/update preset`)
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar `TradingSignalsNewsAndActionsSection`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o novo componente e manter o container como composition root de estado/mutações
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 37)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts tests/unit/services/demo-trading-engine-validation.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service exec eslint src/`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 37)
- Seguir fatiamento incremental residual de `Trading.tsx` na aba `signals` (diálogo de criação e handlers remanescentes) para conclusão do P2 no módulo.
- Executar revisão consolidada dos blocos 3/4/5 para fechar pendências objetivas restantes no plano.

### Escopo entregue nesta rodada (continuação 38 - 07/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração do diálogo de criação de sinal da aba `signals`:
  - novo submódulo `apps/frontend-service/src/components/trading/TradingNewSignalDialog.tsx` criado para isolar o modal de criação manual de sinal (tipo, confiança e reasoning)
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar `TradingNewSignalDialog`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o novo componente e manter o container como composition root de estado/mutações
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 38)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 38)
- Seguir fatiamento incremental residual de `Trading.tsx` (diálogos operacionais remanescentes) para reduzir densidade do composition root no bloco P2.
- Executar revisão consolidada dos blocos 3/4/5 para fechar pendências objetivas restantes no plano.

### Escopo entregue nesta rodada (continuação 39 - 07/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração do diálogo de envio de post-mortem para treinamento:
  - novo submódulo `apps/frontend-service/src/components/trading/TradingPostmortemTrainingDialog.tsx` criado para isolar o modal operacional de seleção de namespace e confirmação de envio
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar `TradingPostmortemTrainingDialog`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o novo componente e manter o container como composition root de estado/mutações
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 39)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 39)
- Seguir fatiamento incremental residual de `Trading.tsx` (diálogos operacionais de ordem/risco) para reduzir densidade do composition root no bloco P2.
- Executar revisão consolidada dos blocos 3/4/5 para fechar pendências objetivas restantes no plano.

### Escopo entregue nesta rodada (continuação 40 - 07/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração do diálogo de revisão/aprovação de ordem:
  - novo submódulo `apps/frontend-service/src/components/trading/TradingReviewOrderDialog.tsx` criado para isolar o modal operacional de revisão de parâmetros e aprovação de execução
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar `TradingReviewOrderDialog`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o novo componente e manter o container como composition root de estado/mutações
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 40)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 40)
- Seguir fatiamento incremental residual de `Trading.tsx` (diálogos operacionais de criação de ordem e configuração de risco) para reduzir densidade do composition root no bloco P2.
- Executar revisão consolidada dos blocos 3/4/5 para fechar pendências objetivas restantes no plano.

### Escopo entregue nesta rodada (continuação 41 - 07/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração do diálogo de configuração de risco:
  - novo submódulo `apps/frontend-service/src/components/trading/TradingRiskConfigDialog.tsx` criado para isolar o modal operacional de limites/defaults de risco
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar `TradingRiskConfigDialog`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o novo componente e manter o container como composition root de estado/mutações
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 41)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 41)
- Seguir fatiamento incremental residual de `Trading.tsx` com extração do diálogo operacional de criação de ordem para reduzir densidade do composition root no bloco P2.
- Executar revisão consolidada dos blocos 3/4/5 para fechar pendências objetivas restantes no plano.

### Escopo entregue nesta rodada (continuação 42 - 07/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração do diálogo de nova ordem:
  - novo submódulo `apps/frontend-service/src/components/trading/TradingNewOrderDialog.tsx` criado para isolar o modal operacional de criação de ordens (resumo, conversão contratos/USDT, leverage e SL/TP)
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar `TradingNewOrderDialog`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o novo componente e manter o container como composition root de estado/mutações
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 42)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 42)
- Executar revisão consolidada dos blocos 3/4/5 e fechar pendências objetivas remanescentes no plano enterprise.
- Avançar no cleanup final (redução de densidade residual e revisão de documentação transversal) antes da etapa de fechamento total.

### Escopo entregue nesta rodada (continuação 43 - 08/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração de abas residuais de mercado/análise:
  - novo submódulo `apps/frontend-service/src/components/trading/TradingAnalysisTabContent.tsx` criado para isolar a aba `analysis` (alerta de contexto + `TechnicalAnalysisPanel`)
  - novo submódulo `apps/frontend-service/src/components/trading/TradingChartTabContent.tsx` criado para isolar a aba `chart` (boundary de `ErrorBoundary` + `CandleChart`)
  - novo submódulo `apps/frontend-service/src/components/trading/TradingOrderBookTabContent.tsx` criado para isolar a aba `orderbook` (boundary de `ErrorBoundary` + `OrderBookViz`)
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar os novos módulos
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir os novos componentes e manter o container como composition root de estado/mutações
  - `Trading.tsx` reduzido de 4808 para 4778 linhas sem alteração de contratos de API
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 43)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 43)
- Executar revisão consolidada dos blocos 3/4/5 com fechamento formal de pendências objetivas no plano enterprise.
- Avançar no cleanup final de densidade residual de `Trading.tsx` (boundaries de overview/handlers de orquestração) antes da etapa de fechamento total.

### Escopo entregue nesta rodada (continuação 44 - 08/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração da aba `overview`:
  - novo submódulo `apps/frontend-service/src/components/trading/TradingOverviewTabContent.tsx` criado para isolar quick trade, resumo de conta, sinais recentes e ordens recentes
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar `TradingOverviewTabContent`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o novo componente e manter o container como composition root de estado/mutações
  - dados de conta para `futures/spot/margin` passaram a ser derivados no container e enviados por props tipadas ao componente de overview
  - `Trading.tsx` reduzido de 4778 para 4438 linhas sem alteração de contratos de API
- Revisão consolidada objetiva dos blocos 3/4/5 (snapshot técnico desta rodada):
  - `apps/auth-service/src/index.ts`, `apps/training-service/src/index.ts` e `apps/integrations-service/src/index.ts` sem handlers inline `/api/*` no composition root (registro delegando para módulos de rota)
  - baseline de tracing distribuído ativo nos serviços críticos via `createCorrelationMiddleware` (`auth`, `chat`, `rag`, `training`, `integrations`, `llm-gateway`, `observability`, `gpu-manager`)
  - bloco P2 de frontend segue em fechamento com redução progressiva da mega-página de trading
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 44)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 44)
- Seguir cleanup final de densidade residual em `Trading.tsx` (boundaries de header/stats/handlers de orquestração) até estabilizar fechamento do bloco P2.
- Fechar revisão consolidada dos blocos 3/4/5 com declaração formal de pendências finais e critério objetivo de “plano 100% concluído”.

### Escopo entregue nesta rodada (continuação 45 - 08/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração das linhas de métricas (stats cards):
  - novo submódulo `apps/frontend-service/src/components/trading/TradingStatsRows.tsx` criado para isolar os cards de métricas de mercado/conta e status operacional (`TradingStatsPrimaryRow` e `TradingStatsSecondaryRow`)
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar `TradingStatsPrimaryRow` e `TradingStatsSecondaryRow`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o novo componente e manter o container como composition root de estado/mutações
  - helpers inline `PriceDisplay`, `StatCard` e `CircuitBreakerStatus` removidos do container principal e movidos para boundary dedicado
  - `Trading.tsx` reduzido de 4438 para 4191 linhas sem alteração de contratos de API
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 45)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 45)
- Seguir cleanup final de densidade residual em `Trading.tsx` (boundary de header e handlers de orquestração) até estabilizar fechamento do bloco P2.
- Fechar revisão consolidada dos blocos 3/4/5 com declaração formal de pendências finais e critério objetivo de “plano 100% concluído”.

### Escopo entregue nesta rodada (continuação 46 - 08/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração do header operacional:
  - novo submódulo `apps/frontend-service/src/components/trading/TradingHeaderSection.tsx` criado para isolar título/status, seletores de mercado/símbolo, ações de favoritos/destaques, indicador de conectividade WS e acesso à configuração de risco
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar `TradingHeaderSection`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o novo componente e manter o container como composition root de estado/mutações
  - `Trading.tsx` reduzido de 4191 para 4050 linhas sem alteração de contratos de API
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 46)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 46)
- Seguir cleanup final de densidade residual em `Trading.tsx` (handlers de orquestração e boundaries restantes) até estabilizar fechamento do bloco P2.
- Fechar revisão consolidada dos blocos 3/4/5 com declaração formal de pendências finais e critério objetivo de “plano 100% concluído”.

### Escopo entregue nesta rodada (continuação 47 - 08/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração de alertas operacionais:
  - novo submódulo `apps/frontend-service/src/components/trading/TradingOperationalAlerts.tsx` criado para isolar alerta de erro crítico de upstream e alerta de trading desabilitado
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar `TradingOperationalAlerts`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o novo componente e manter o container como composition root de estado/mutações
  - `Trading.tsx` reduzido de 4050 para 4018 linhas sem alteração de contratos de API
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 47)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 47)
- Seguir cleanup final de densidade residual em `Trading.tsx` (handlers de orquestração e boundaries restantes) até estabilizar fechamento do bloco P2.
- Fechar revisão consolidada dos blocos 3/4/5 com declaração formal de pendências finais e critério objetivo de “plano 100% concluído”.

### Escopo entregue nesta rodada (continuação 48 - 08/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração do shell de navegação de tabs:
  - novo submódulo `apps/frontend-service/src/components/trading/TradingTabsShell.tsx` criado para isolar a estrutura compartilhada `Tabs + WorkspaceFilterBar + TabsList/TabsTrigger`
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar `TradingTabsShell`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o novo componente e manter o container como composition root de estado/mutações
  - `Trading.tsx` reduzido de 4018 para 4011 linhas sem alteração de contratos de API
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 48)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 48)
- Seguir cleanup final de densidade residual em `Trading.tsx` (handlers de orquestração e boundaries restantes) até estabilizar fechamento do bloco P2.
- Fechar revisão consolidada dos blocos 3/4/5 com declaração formal de pendências finais e critério objetivo de “plano 100% concluído”.

### Escopo entregue nesta rodada (continuação 49 - 08/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração da aba `signals`:
  - novo submódulo `apps/frontend-service/src/components/trading/TradingSignalsTabContent.tsx` criado para isolar o bloco operacional de sinais (`perfil + news/actions + scheduler + resultados`)
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar `TradingSignalsTabContent`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o novo componente e manter o container como composition root de estado/mutações
  - `Trading.tsx` reduzido de 4011 para 3975 linhas sem alteração de contratos de API
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 49)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 49)
- Seguir cleanup final de densidade residual em `Trading.tsx` (handlers de orquestração e boundaries restantes) até estabilizar fechamento do bloco P2.
- Fechar revisão consolidada dos blocos 3/4/5 com declaração formal de pendências finais e critério objetivo de “plano 100% concluído”.

### Escopo entregue nesta rodada (continuação 50 - 08/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração da seção consolidada de dialogs:
  - novo submódulo `apps/frontend-service/src/components/trading/TradingDialogsSection.tsx` criado para isolar os dialogs operacionais (`nova ordem`, `OCO`, `review`, `risk config`, `post-mortem->training`, `novo sinal`)
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar `TradingDialogsSection`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o novo componente e manter o container como composition root de estado/mutações
  - props de dialogs foram agrupadas por boundary tipada (`ComponentProps<typeof ...>`) para reduzir ruído de wiring no container sem alterar contratos de API
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 50)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 50)
- Seguir cleanup final de densidade residual em `Trading.tsx` (handlers de orquestração e boundaries restantes) até estabilizar fechamento do bloco P2.
- Fechar revisão consolidada dos blocos 3/4/5 com declaração formal de pendências finais e critério objetivo de “plano 100% concluído”.

### Escopo entregue nesta rodada (continuação 51 - 08/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração das abas operacionais residuais:
  - novo submódulo `apps/frontend-service/src/components/trading/TradingOperationalTabsSection.tsx` criado para isolar as abas `history`, `postmortems`, `chart`, `orderbook`, `control` e `account`
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar `TradingOperationalTabsSection`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o novo componente e manter o container como composition root de estado/mutações
  - montagem das props por boundary tipada (`ComponentProps<typeof ...>`) aplicada para reduzir ruído de wiring no container sem alterar contratos de API
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 51)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 51)
- Seguir cleanup final de densidade residual em `Trading.tsx` (handlers de orquestração e boundaries restantes) até estabilizar fechamento do bloco P2.
- Fechar revisão consolidada dos blocos 3/4/5 com declaração formal de pendências finais e critério objetivo de “plano 100% concluído”.

### Escopo entregue nesta rodada (continuação 52 - 08/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração das abas primárias:
  - novo submódulo `apps/frontend-service/src/components/trading/TradingPrimaryTabsSection.tsx` criado para isolar as abas `overview`, `portfolio-auto`, `signals-auto`, `lab`, `orders`, `positions`, `signals` e `analysis`
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar `TradingPrimaryTabsSection`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o novo componente e manter o container como composition root de estado/mutações
  - montagem de props por boundary tipada (`ComponentProps<typeof ...>`) aplicada para reduzir ruído de wiring no container sem alterar contratos de API
  - `Trading.tsx` reduzido de 3940 para 3905 linhas sem alteração de contratos de API
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de payloads, apenas redução de acoplamento e melhoria de legibilidade/manutenibilidade da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 52)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 52)
- Seguir cleanup final de densidade residual em `Trading.tsx` (handlers de orquestração e boundaries restantes) até estabilizar fechamento do bloco P2.
- Fechar revisão consolidada dos blocos 3/4/5 com declaração formal de pendências finais e critério objetivo de “plano 100% concluído”.

### Escopo entregue nesta rodada (continuação 53 - 08/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com extração da aba `balances`:
  - novo submódulo `apps/frontend-service/src/pages/wise-payments/components/wise-balances-tab-content.tsx` criado para isolar o fluxo de saldo (criação/exclusão/listagem, balance capacity e total funds)
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir `WiseBalancesTabContent` e manter o container como composition root de estado/mutações
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `WisePayments.tsx` reduzido de 5569 para 5404 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de acoplamento da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 53)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 53)
- Seguir decomposição incremental de `WisePayments.tsx` (próximas abas de Tesouraria/Pagamentos) até reduzir acoplamento estrutural da página.
- Fechar revisão consolidada dos blocos 3/4/5 com declaração formal de pendências finais e critério objetivo de “plano 100% concluído”.

### Escopo entregue nesta rodada (continuação 54 - 08/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com extração da aba `exchange`:
  - novo submódulo `apps/frontend-service/src/pages/wise-payments/components/wise-exchange-tab-content.tsx` criado para isolar o fluxo de câmbio (quote/execute + rates lookup)
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir `WiseExchangeTabContent` e manter o container como composition root de estado/mutações
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `WisePayments.tsx` reduzido de 5404 para 5263 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de acoplamento da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 54)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 54)
- Seguir decomposição incremental de `WisePayments.tsx` (próximas abas de Tesouraria/Pagamentos) até reduzir acoplamento estrutural da página.
- Fechar revisão consolidada dos blocos 3/4/5 com declaração formal de pendências finais e critério objetivo de “plano 100% concluído”.

### Escopo entregue nesta rodada (continuação 55 - 08/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com extração da aba `transfers`:
  - novo submódulo `apps/frontend-service/src/pages/wise-payments/components/wise-transfers-tab-content.tsx` criado para isolar o fluxo de listagem/ações de transferências (fund/cancel)
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir `WiseTransfersTabContent` e manter o container como composition root de estado/mutações
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `WisePayments.tsx` reduzido de 5263 para 5198 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de acoplamento da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 55)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 55)
- Seguir decomposição incremental de `WisePayments.tsx` (próximas abas de Tesouraria/Pagamentos) até reduzir acoplamento estrutural da página.
- Fechar revisão consolidada dos blocos 3/4/5 com declaração formal de pendências finais e critério objetivo de “plano 100% concluído”.

### Escopo entregue nesta rodada (continuação 56 - 08/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com extração da aba `recipients`:
  - novo submódulo `apps/frontend-service/src/pages/wise-payments/components/wise-recipients-tab-content.tsx` criado para isolar o fluxo de beneficiários + permissões/secure cards
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir `WiseRecipientsTabContent` e manter o container como composition root de estado/mutações
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `WisePayments.tsx` reduzido de 5198 para 5015 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de acoplamento da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 56)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 56)
- Seguir decomposição incremental de `WisePayments.tsx` (próximas abas de Tesouraria/Pagamentos) até reduzir acoplamento estrutural da página.
- Fechar revisão consolidada dos blocos 3/4/5 com declaração formal de pendências finais e critério objetivo de “plano 100% concluído”.

### Escopo entregue nesta rodada (continuação 57 - 08/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com extração da aba `quotes`:
  - novo submódulo `apps/frontend-service/src/pages/wise-payments/components/wise-quotes-tab-content.tsx` criado para isolar o fluxo de cotações (input, request e resumo de resultado)
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir `WiseQuotesTabContent` e manter o container como composition root de estado/mutações
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `WisePayments.tsx` reduzido de 5015 para 4911 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de acoplamento da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 57)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 57)
- Seguir decomposição incremental de `WisePayments.tsx` (próximas abas de Tesouraria/Pagamentos) até reduzir acoplamento estrutural da página.
- Fechar revisão consolidada dos blocos 3/4/5 com declaração formal de pendências finais e critério objetivo de “plano 100% concluído”.

### Escopo entregue nesta rodada (continuação 58 - 08/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com extração da aba `batch`:
  - novo submódulo `apps/frontend-service/src/pages/wise-payments/components/wise-batch-tab-content.tsx` criado para isolar o fluxo de batch groups
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir `WiseBatchTabContent` e manter o container como composition root de estado/mutações
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `WisePayments.tsx` reduzido de 4911 para 4872 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de acoplamento da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 58)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 58)
- Seguir decomposição incremental de `WisePayments.tsx` (próximas abas de Tesouraria/Pagamentos) até reduzir acoplamento estrutural da página.
- Fechar revisão consolidada dos blocos 3/4/5 com declaração formal de pendências finais e critério objetivo de “plano 100% concluído”.

### Escopo entregue nesta rodada (continuação 59 - 08/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com extração da aba `profiles`:
  - novo submódulo `apps/frontend-service/src/pages/wise-payments/components/wise-profiles-tab-content.tsx` criado para isolar o fluxo de listagem/refresh de perfis
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir `WiseProfilesTabContent` e manter o container como composition root de estado/mutações
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `WisePayments.tsx` reduzido de 4872 para 4835 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de acoplamento da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 59)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 59)
- Seguir decomposição incremental de `WisePayments.tsx` (próximas abas de Tesouraria/Pagamentos) até reduzir acoplamento estrutural da página.
- Fechar revisão consolidada dos blocos 3/4/5 com declaração formal de pendências finais e critério objetivo de “plano 100% concluído”.

### Escopo entregue nesta rodada (continuação 60 - 08/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com extração da aba `users`:
  - novo submódulo `apps/frontend-service/src/pages/wise-payments/components/wise-users-tab-content.tsx` criado para isolar o fluxo de consulta de usuário (`me` + busca por id)
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir `WiseUsersTabContent` e manter o container como composition root de estado/mutações
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `WisePayments.tsx` reduzido de 4835 para 4799 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de acoplamento da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 60)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 60)
- Seguir decomposição incremental de `WisePayments.tsx` (próximas abas de Tesouraria/Pagamentos) até reduzir acoplamento estrutural da página.
- Fechar revisão consolidada dos blocos 3/4/5 com declaração formal de pendências finais e critério objetivo de “plano 100% concluído”.

### Escopo entregue nesta rodada (continuação 61 - 08/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com extração da aba `activities`:
  - novo submódulo `apps/frontend-service/src/pages/wise-payments/components/wise-activities-tab-content.tsx` criado para isolar o fluxo de filtros e listagem de atividades
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir `WiseActivitiesTabContent` e manter o container como composition root de estado/mutações
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `WisePayments.tsx` reduzido de 4799 para 4733 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de acoplamento da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 61)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 61)
- Seguir decomposição incremental de `WisePayments.tsx` (próximas abas de Tesouraria/Pagamentos) até reduzir acoplamento estrutural da página.
- Fechar revisão consolidada dos blocos 3/4/5 com declaração formal de pendências finais e critério objetivo de “plano 100% concluído”.

### Escopo entregue nesta rodada (continuação 62 - 08/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com extração da aba `statements`:
  - novo submódulo `apps/frontend-service/src/pages/wise-payments/components/wise-statements-tab-content.tsx` criado para isolar o fluxo de filtros e listagem de extrato por saldo
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir `WiseStatementsTabContent` e manter o container como composition root de estado/mutações
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `WisePayments.tsx` reduzido de 4733 para 4621 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de acoplamento da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 62)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 62)
- Seguir decomposição incremental de `WisePayments.tsx` (próximas abas de Tesouraria/Pagamentos) até reduzir acoplamento estrutural da página.
- Fechar revisão consolidada dos blocos 3/4/5 com declaração formal de pendências finais e critério objetivo de “plano 100% concluído”.

### Escopo entregue nesta rodada (continuação 63 - 08/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com extração da aba `account-details`:
  - novo submódulo `apps/frontend-service/src/pages/wise-payments/components/wise-account-details-tab-content.tsx` criado para isolar criação/listagem de account details, listagem de orders e recipient requirements
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir `WiseAccountDetailsTabContent` e manter o container como composition root de estado/mutações
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `WisePayments.tsx` reduzido de 4621 para 4488 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de acoplamento da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 63)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 63)
- Seguir decomposição incremental de `WisePayments.tsx` (próximas abas de Tesouraria/Pagamentos) até reduzir acoplamento estrutural da página.
- Fechar revisão consolidada dos blocos 3/4/5 com declaração formal de pendências finais e critério objetivo de “plano 100% concluído”.

### Escopo entregue nesta rodada (continuação 64 - 08/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com extração da aba `cards`:
  - novo submódulo `apps/frontend-service/src/pages/wise-payments/components/wise-cards-tab-content.tsx` criado para isolar listagem de cartões e atualização de status
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir `WiseCardsTabContent` e manter o container como composition root de estado/mutações
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `WisePayments.tsx` reduzido de 4488 para 4418 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de acoplamento da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 64)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 64)
- Seguir decomposição incremental de `WisePayments.tsx` (próximas abas de Tesouraria/Pagamentos) até reduzir acoplamento estrutural da página.
- Fechar revisão consolidada dos blocos 3/4/5 com declaração formal de pendências finais e critério objetivo de “plano 100% concluído”.

### Escopo entregue nesta rodada (continuação 65 - 08/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com extração da aba `card-orders`:
  - novo submódulo `apps/frontend-service/src/pages/wise-payments/components/wise-card-orders-tab-content.tsx` criado para isolar criação/listagem de card orders e ações de detalhes/requirements/status/pin/availability
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir `WiseCardOrdersTabContent` e manter o container como composition root de estado/mutações
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `WisePayments.tsx` reduzido de 4418 para 4274 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de acoplamento da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 65)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 65)
- Seguir decomposição incremental de `WisePayments.tsx` (próximas abas de Tesouraria/Pagamentos) até reduzir acoplamento estrutural da página.
- Fechar revisão consolidada dos blocos 3/4/5 com declaração formal de pendências finais e critério objetivo de “plano 100% concluído”.

### Escopo entregue nesta rodada (continuação 66 - 08/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com extração da aba `card-transactions`:
  - novo submódulo `apps/frontend-service/src/pages/wise-payments/components/wise-card-transactions-tab-content.tsx` criado para isolar consulta de transação por `transactionId`
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir `WiseCardTransactionsTabContent` e manter o container como composition root de estado/mutações
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `WisePayments.tsx` reduzido de 4274 para 4245 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de acoplamento da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 66)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 66)
- Seguir decomposição incremental de `WisePayments.tsx` (próximas abas de Tesouraria/Pagamentos) até reduzir acoplamento estrutural da página.
- Fechar revisão consolidada dos blocos 3/4/5 com declaração formal de pendências finais e critério objetivo de “plano 100% concluído”.

### Escopo entregue nesta rodada (continuação 67 - 08/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com extração da aba `spend-limits`:
  - novo submódulo `apps/frontend-service/src/pages/wise-payments/components/wise-spend-limits-tab-content.tsx` criado para isolar operações de leitura/atualização/exclusão de spend limits
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir `WiseSpendLimitsTabContent` e manter o container como composition root de estado/mutações
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `WisePayments.tsx` reduzido de 4245 para 4175 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de acoplamento da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 67)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 67)
- Seguir decomposição incremental de `WisePayments.tsx` (próximas abas de Tesouraria/Pagamentos) até reduzir acoplamento estrutural da página.
- Fechar revisão consolidada dos blocos 3/4/5 com declaração formal de pendências finais e critério objetivo de “plano 100% concluído”.

### Escopo entregue nesta rodada (continuação 68 - 08/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com extração da aba `spend-controls`:
  - novo submódulo `apps/frontend-service/src/pages/wise-payments/components/wise-spend-controls-tab-content.tsx` criado para isolar operações de criação/atribuição/desatribuição/exclusão de spend controls e listagem de regras
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir `WiseSpendControlsTabContent` e manter o container como composition root de estado/mutações
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `WisePayments.tsx` reduzido de 4175 para 3987 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de acoplamento da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 68)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 68)
- Seguir decomposição incremental de `WisePayments.tsx` (próximas abas de Tesouraria/Pagamentos) até reduzir acoplamento estrutural da página.
- Fechar revisão consolidada dos blocos 3/4/5 com declaração formal de pendências finais e critério objetivo de “plano 100% concluído”.

### Escopo entregue nesta rodada (continuação 69 - 08/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com extração da aba `disputes`:
  - novo submódulo `apps/frontend-service/src/pages/wise-payments/components/wise-disputes-tab-content.tsx` criado para isolar operações de flow step/submit, upload de evidências, atualização de status e listagem de disputas
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir `WiseDisputesTabContent` e manter o container como composition root de estado/mutações
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `WisePayments.tsx` reduzido de 3987 para 3810 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de acoplamento da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 69)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 69)
- Seguir decomposição incremental de `WisePayments.tsx` (próximas abas de Tesouraria/Pagamentos) até reduzir acoplamento estrutural da página.
- Fechar revisão consolidada dos blocos 3/4/5 com declaração formal de pendências finais e critério objetivo de “plano 100% concluído”.

### Escopo entregue nesta rodada (continuação 70 - 08/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com extração da aba `kyc`:
  - novo submódulo `apps/frontend-service/src/pages/wise-payments/components/wise-kyc-tab-content.tsx` criado para isolar operações de evidências obrigatórias, uploads de KYC e listagem de reviews
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir `WiseKycTabContent` e manter o container como composition root de estado/mutações
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `WisePayments.tsx` reduzido de 3810 para 3701 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de acoplamento da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 70)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 70)
- Seguir decomposição incremental de `WisePayments.tsx` (próximas abas de Tesouraria/Pagamentos) até reduzir acoplamento estrutural da página.
- Fechar revisão consolidada dos blocos 3/4/5 com declaração formal de pendências finais e critério objetivo de “plano 100% concluído”.

### Escopo entregue nesta rodada (continuação 71 - 08/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com extração da aba `webhooks`:
  - novo submódulo `apps/frontend-service/src/pages/wise-payments/components/wise-webhooks-tab-content.tsx` criado para isolar operações de list/create/delete de webhooks e visualização de response
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir `WiseWebhooksTabContent` e manter o container como composition root de estado/mutações
  - validações de payload/ID e parse JSON permaneceram no container (`handleCreateWebhook` e `handleDeleteWebhook`) sem alteração de contrato
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `WisePayments.tsx` reduzido de 3701 para 3633 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de acoplamento da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 71)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 71)
- Seguir decomposição incremental de `WisePayments.tsx` (próximas abas de Tesouraria/Pagamentos) até reduzir acoplamento estrutural da página.
- Fechar revisão consolidada dos blocos 3/4/5 com declaração formal de pendências finais e critério objetivo de “plano 100% concluído”.

### Escopo entregue nesta rodada (continuação 72 - 08/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com extração da aba `simulations`:
  - novo submódulo `apps/frontend-service/src/pages/wise-payments/components/wise-simulations-tab-content.tsx` criado para isolar operação de simulações, parâmetros de entrada e visualização de resposta
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir `WiseSimulationsTabContent` e manter o container como composition root de estado/mutações
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `WisePayments.tsx` reduzido de 3633 para 3535 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de acoplamento da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 72)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 72)
- Seguir decomposição incremental de `WisePayments.tsx` (próximas abas de Tesouraria/Pagamentos) até reduzir acoplamento estrutural da página.
- Fechar revisão consolidada dos blocos 3/4/5 com declaração formal de pendências finais e critério objetivo de “plano 100% concluído”.

### Escopo entregue nesta rodada (continuação 73 - 08/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com extração da aba `sca`:
  - novo submódulo `apps/frontend-service/src/pages/wise-payments/components/wise-sca-tab-content.tsx` criado para isolar payload JOSE e ações operacionais de SCA (`one-time-token`, `sessions`, `pin`, `device-fingerprint`, `facemap`)
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir `WiseScaTabContent` e manter o container como composition root de estado/mutações
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `WisePayments.tsx` reduzido de 3535 para 3461 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de acoplamento da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 73)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 73)
- Seguir decomposição incremental de `WisePayments.tsx` (próximas abas de Tesouraria/Pagamentos) até reduzir acoplamento estrutural da página.
- Fechar revisão consolidada dos blocos 3/4/5 com declaração formal de pendências finais e critério objetivo de “plano 100% concluído”.

### Escopo entregue nesta rodada (continuação 74 - 08/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com extração da aba `catalog`:
  - novo submódulo `apps/frontend-service/src/pages/wise-payments/components/wise-catalog-tab-content.tsx` criado para isolar operação catalogada/custom, parâmetros dinâmicos de path/query, payload e visualização de resposta
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir `WiseCatalogTabContent` e manter o container como composition root de estado/mutações
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `WisePayments.tsx` reduzido de 3461 para 3263 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de acoplamento da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 74)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 74)
- Revisar pendências residuais do P2 fora de `WisePayments` e declarar fechamento objetivo do bloco após checklist final de aderência.
- Fechar revisão consolidada dos blocos 3/4/5 com declaração formal de pendências finais e critério objetivo de “plano 100% concluído”.

### Escopo entregue nesta rodada (continuação 75 - 08/03/2026)
- Continuidade da decomposição incremental de `Training` com extração da aba `jobs`:
  - novo submódulo `apps/frontend-service/src/pages/training/components/training-jobs-tab-content.tsx` criado para isolar estado visual de loading/empty/listagem, seção de ativos por escopo e agrupamento de jobs em progresso/histórico
  - `apps/frontend-service/src/pages/Training.tsx` atualizado para consumir `TrainingJobsTabContent` e manter o container como composition root de estado/mutações
  - `JobCard` foi preservado no container com callbacks tipados genéricos (`TJob`) para manter contratos e evitar regressão de comportamento
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `Training.tsx` reduzido de 5367 para 5286 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de acoplamento da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 75)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 75)
- Seguir decomposição incremental de `Training.tsx` (tabs `data` e `auto-learning`) para reduzir densidade residual do container.
- Fechar revisão consolidada dos blocos 3/4/5 com declaração formal de pendências finais e critério objetivo de “plano 100% concluído”.

### Escopo entregue nesta rodada (continuação 76 - 08/03/2026)
- Continuidade da decomposição incremental de `Training` com extração da aba `auto-learning`:
  - novo submódulo `apps/frontend-service/src/pages/training/components/training-auto-learning-tab-content.tsx` criado para isolar status de auto-learning, configuração de schedule e governança de filas
  - `apps/frontend-service/src/pages/Training.tsx` atualizado para consumir `TrainingAutoLearningTabContent` e manter o container como composition root de estado/mutações
  - callbacks de formatação/scope (`formatScheduleDate`, `resolveScheduleScopeLabel`) mantidos no container para preservar contratos e semântica de i18n/locale
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `Training.tsx` reduzido de 5286 para 5078 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de acoplamento da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 76)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 76)
- Seguir decomposição incremental da aba `data` de `Training.tsx` para reduzir densidade residual do container.
- Fechar revisão consolidada dos blocos 3/4/5 com declaração formal de pendências finais e critério objetivo de “plano 100% concluído”.

### Escopo entregue nesta rodada (continuação 77 - 08/03/2026)
- Continuidade da decomposição incremental de `Training` com extração da aba `data`:
  - novo submódulo `apps/frontend-service/src/pages/training/components/training-data-tab-content.tsx` criado para isolar filtros, toolbar de seleção/review em lote, alerta de aprovação e estados visuais de loading/empty/grid
  - `apps/frontend-service/src/pages/Training.tsx` atualizado para consumir `TrainingDataTabContent` e manter o container como composition root de estado/mutações
  - renderização dos cards foi preservada por callback tipado (`renderDataCard`) para manter contratos e handlers de aprovação/rejeição/resolve scope sem regressão funcional
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `Training.tsx` reduzido de 5078 para 4899 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de acoplamento da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 77)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 77)
- Seguir redução da densidade residual de `Training.tsx` (blocos de `bulk-import` e `multimodal`) para fechar a decomposição das abas críticas do workspace.
- Fechar revisão consolidada dos blocos 3/4/5 com declaração formal de pendências finais e critério objetivo de “plano 100% concluído”.

### Escopo entregue nesta rodada (continuação 78 - 08/03/2026)
- Continuidade da decomposição incremental de `Training` com extração da aba `bulk-import`:
  - novo submódulo `apps/frontend-service/src/pages/training/components/training-bulk-import-tab-content.tsx` criado para isolar upload em lote (drag-and-drop), validação/parse (`json`/`jsonl`), preview e envio para API
  - `apps/frontend-service/src/pages/Training.tsx` atualizado para consumir `TrainingBulkImportTabContent` e manter o container como composition root de estado/mutações
  - interfaces locais de bulk import e lógica de validação Zod foram movidas para o submódulo, preservando comportamento funcional e endpoints
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `Training.tsx` reduzido de 4899 para 4326 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de acoplamento da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 78)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 78)
- Seguir decomposição incremental de `Training.tsx` com extração da aba `multimodal` para fechar o bloco residual de ingestão.
- Fechar revisão consolidada dos blocos 3/4/5 com declaração formal de pendências finais e critério objetivo de “plano 100% concluído”.

### Escopo entregue nesta rodada (continuação 79 - 08/03/2026)
- Continuidade da decomposição incremental de `Training` com extração da aba `multimodal`:
  - novo submódulo `apps/frontend-service/src/pages/training/components/training-multimodal-tab-content.tsx` criado para isolar upload/processamento multimodal, listagem de documentos/mídias e promoção explícita para treinamento
  - `apps/frontend-service/src/pages/Training.tsx` atualizado para consumir `TrainingMultimodalTabContent` e manter o container como composition root de estado/mutações
  - interfaces de mídia/documento (`MediaUpload`, `MediaUploadResult`, `RagDocumentItem`) e lógica operacional da aba foram movidas para o submódulo sem alterar contratos de API
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `Training.tsx` reduzido de 4326 para 3336 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de acoplamento da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 79)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 79)
- Fechar revisão consolidada das pendências residuais dos blocos 3/4/5 com checklist objetivo de conclusão 100% do plano.
- Seguir decomposição incremental de mega-páginas remanescentes que ainda concentram múltiplos fluxos operacionais no mesmo container.

### Escopo entregue nesta rodada (continuação 80 - 08/03/2026)
- Continuidade da decomposição incremental de `Training` com extração do diálogo `on-demand run`:
  - novo submódulo `apps/frontend-service/src/pages/training/components/training-on-demand-run-dialog.tsx` criado para isolar o fluxo de configuração e disparo de treino manual
  - `apps/frontend-service/src/pages/Training.tsx` atualizado para consumir `TrainingOnDemandRunDialog` e manter o container como composition root de estado/mutações
  - payload de execução (`trainingType`, `namespace`, `priority`, `includeImages`, `description`) e comportamento de abertura/fechamento preservados sem regressão
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `Training.tsx` reduzido de 3336 para 3270 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de acoplamento da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 80)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 80)
- Seguir decomposição incremental dos dialogs residuais de `Training.tsx` (`batch review`, `review`, `resolve scope`) para reduzir densidade estrutural remanescente.
- Fechar revisão consolidada das pendências residuais dos blocos 3/4/5 com checklist objetivo de conclusão 100% do plano.

### Escopo entregue nesta rodada (continuação 81 - 08/03/2026)
- Continuidade da decomposição incremental de `Training` com extração do diálogo `batch review`:
  - novo submódulo `apps/frontend-service/src/pages/training/components/training-batch-review-dialog.tsx` criado para isolar confirmação de aprovação/rejeição em lote e notas de revisão
  - `apps/frontend-service/src/pages/Training.tsx` atualizado para consumir `TrainingBatchReviewDialog` e manter o container como composition root de estado/mutações
  - comportamento de abertura/fechamento, reset de notas, contador de selecionados e estado de loading/salvamento preservados sem regressão
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `Training.tsx` reduzido de 3270 para 3236 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de acoplamento da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 81)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 81)
- Seguir decomposição incremental dos dialogs residuais de `Training.tsx` (`review`, `resolve scope`) para reduzir densidade estrutural remanescente.
- Fechar revisão consolidada das pendências residuais dos blocos 3/4/5 com checklist objetivo de conclusão 100% do plano.

### Escopo entregue nesta rodada (continuação 82 - 08/03/2026)
- Continuidade da decomposição incremental de `Training` com extração do diálogo `review`:
  - novo submódulo `apps/frontend-service/src/pages/training/components/training-review-dialog.tsx` criado para isolar aprovação/rejeição individual com notas e override de escopo auditável
  - `apps/frontend-service/src/pages/Training.tsx` atualizado para consumir `TrainingReviewDialog` e manter o container como composition root de estado/mutações
  - comportamento de abertura/fechamento, reset de override, validações de aprovação e estado de loading/salvamento preservados sem regressão
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `Training.tsx` reduzido de 3236 para 3163 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de acoplamento da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 82)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 82)
- Seguir decomposição incremental dos dialogs residuais de `Training.tsx` (`resolve scope`) para reduzir densidade estrutural remanescente.
- Fechar revisão consolidada das pendências residuais dos blocos 3/4/5 com checklist objetivo de conclusão 100% do plano.

### Escopo entregue nesta rodada (continuação 83 - 08/03/2026)
- Continuidade da decomposição incremental de `Training` com extração do diálogo `resolve scope`:
  - novo submódulo `apps/frontend-service/src/pages/training/components/training-resolve-scope-dialog.tsx` criado para isolar relink de escopo, criação de namespace sugerido e confirmação de resolução
  - `apps/frontend-service/src/pages/Training.tsx` atualizado para consumir `TrainingResolveScopeDialog` e manter o container como composition root de estado/mutações
  - comportamento de abertura/fechamento, reset de entrada selecionada, placeholders dinâmicos e estados de loading (resolve/create namespace) preservados sem regressão
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `Training.tsx` reduzido de 3163 para 3093 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de acoplamento da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 83)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 83)
- Fechar revisão consolidada das pendências residuais dos blocos 3/4/5 com checklist objetivo de conclusão 100% do plano.
- Seguir decomposição incremental de mega-páginas remanescentes que ainda concentram múltiplos fluxos operacionais no mesmo container.

### Escopo entregue nesta rodada (continuação 84 - 08/03/2026)
- Continuidade da decomposição incremental de `Training` com extração de 3 diálogos residuais críticos:
  - novo submódulo `apps/frontend-service/src/pages/training/components/training-promote-dialog.tsx` criado para isolar confirmação de promoção
  - novo submódulo `apps/frontend-service/src/pages/training/components/training-rollback-dialog.tsx` criado para isolar rollback com validação de motivo
  - novo submódulo `apps/frontend-service/src/pages/training/components/training-post-training-dialog.tsx` criado para isolar retorno ao chat pós-treino
  - `apps/frontend-service/src/pages/Training.tsx` atualizado para consumir os 3 submódulos e manter o container como composition root de estado/mutações
  - comportamento de abertura/fechamento, reset de estado e execução de mutações (`promote`, `rollback`, `returnOrchestrator`) preservados sem regressão
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `Training.tsx` reduzido de 3093 para 3028 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de acoplamento da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 84)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 84)
- Consolidar revisão objetiva das pendências residuais dos blocos 3/4/5 com checklist de “100% concluído”.
- Seguir decomposição incremental das mega-páginas remanescentes com maior densidade estrutural no frontend, mantendo validação sequencial e SSOT atualizado ao final de cada rodada.

### Escopo entregue nesta rodada (continuação 85 - 08/03/2026)
- Continuidade da decomposição incremental de `Training` com extração do card operacional de datasets:
  - novo submódulo `apps/frontend-service/src/pages/training/components/training-data-card.tsx` criado para isolar renderização/ação de cards de treinamento (seleção, aprovação/rejeição, relink de escopo, mensagens, duplicidade e metadados)
  - helper de badge de status de dataset movido junto ao componente, removendo lógica visual duplicada do container
  - `apps/frontend-service/src/pages/Training.tsx` atualizado para consumir `TrainingDataCard` por composição, mantendo estado/mutações no container principal
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `Training.tsx` reduzido de 3028 para 2810 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de acoplamento da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 85)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 85)
- Seguir decomposição incremental dos blocos residuais de `Training.tsx` (ex.: `JobCard`, `JobDetailModal` e `CreateJobDialog`) para manter o container apenas como composition root.
- Consolidar checklist objetivo de pendências remanescentes dos blocos 3/4/5 com status rastreável de conclusão.

### Escopo entregue nesta rodada (continuação 86 - 08/03/2026)
- Continuidade da decomposição incremental de `Training` com extração do card operacional de jobs:
  - novo submódulo `apps/frontend-service/src/pages/training/components/training-job-card.tsx` criado para isolar status, timeline, métricas e ações de job (`approve/reject promotion`, `promote`, `rollback`)
  - helper de badge de status de job foi centralizado no módulo (`getTrainingJobStatusBadge`) e reutilizado no `JobDetailModal`
  - `apps/frontend-service/src/pages/Training.tsx` atualizado para consumir `TrainingJobCard` por composição e remover bloco inline do card de jobs
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `Training.tsx` reduzido de 2810 para 2566 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de acoplamento da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 86)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 86)
- Seguir decomposição incremental dos blocos residuais de `Training.tsx` (principalmente `JobDetailModal` e `CreateJobDialog`) para manter o container estritamente como composition root.
- Consolidar checklist objetivo das pendências remanescentes dos blocos 3/4/5 com status de conclusão rastreável por serviço.

### Escopo entregue nesta rodada (continuação 87 - 08/03/2026)
- Continuidade da decomposição incremental de `Training` com extração dos blocos residuais críticos:
  - novo submódulo `apps/frontend-service/src/pages/training/components/training-job-detail-modal.tsx` criado para isolar detalhe operacional de job (stream SSE + trilha de auditoria)
  - novo submódulo `apps/frontend-service/src/pages/training/components/training-create-job-dialog.tsx` criado para isolar criação de job com validação Zod e idempotência por header
  - novo utilitário compartilhado `apps/frontend-service/src/pages/training/training-request-utils.ts` criado para centralizar fingerprint/idempotency key/retry-after hint
  - `apps/frontend-service/src/pages/Training.tsx` atualizado para consumir os submódulos extraídos e manter o container como composition root de estado/mutações
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `Training.tsx` reduzido de 2566 para 1879 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução adicional de acoplamento da mega-página
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 87)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 87)
- Consolidar checklist objetivo das pendências remanescentes dos blocos 3/4/5 com status de conclusão rastreável por serviço.
- Seguir decomposição incremental das mega-páginas remanescentes no frontend (fora de `Training`) mantendo validação sequencial e SSOT atualizado ao final de cada rodada.

### Escopo entregue nesta rodada (continuação 88 - 08/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração de utilitários de exibição:
  - novo submódulo `apps/frontend-service/src/components/trading/TradingDisplayUtils.tsx` criado para isolar `SIGNAL_TYPES`, `SignalTypeBadge`, `OrderStatusBadge` e `formatDecisionSummary`
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para reexportar os utilitários extraídos via barrel oficial de trading
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir utilitários extraídos e remover blocos inline de badges/formatadores
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de densidade do container principal de trading
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 88)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 88)
- Seguir decomposição incremental das mega-páginas remanescentes no frontend (principalmente `Trading.tsx`, `WisePayments.tsx` e `Chat/index.tsx`) mantendo validação sequencial e SSOT atualizado.
- Consolidar checklist objetivo das pendências remanescentes dos blocos 3/4/5 com status de conclusão rastreável por serviço.

### Escopo entregue nesta rodada (continuação 89 - 08/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração de catálogo/configuração de sinais:
  - novo submódulo `apps/frontend-service/src/components/trading/TradingSignalConfig.ts` criado para isolar catálogos e defaults (`SIGNAL_INDICATOR_OPTIONS`, `TRADING_TECHNIQUE_OPTIONS`, `AUTO_SIGNAL_MODE_OPTIONS`, `AUTO_SIGNAL_ALL_MODES`, `DEFAULT_*`, `FALLBACK_INTERVAL_MINUTES`, `MAX_ARBITRAGE_ASSETS`, `AUTO_SAVE_DEBOUNCE_MS`)
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para reexportar o novo módulo via barrel oficial de trading
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o módulo extraído e remover blocos inline de configuração
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de densidade do container principal de trading
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 89)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 89)
- Seguir decomposição incremental das mega-páginas remanescentes no frontend (principalmente `Trading.tsx`, `WisePayments.tsx` e `Chat/index.tsx`) mantendo validação sequencial e SSOT atualizado.
- Consolidar checklist objetivo das pendências remanescentes dos blocos 3/4/5 com status de conclusão rastreável por serviço.

### Escopo entregue nesta rodada (continuação 90 - 08/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração da navegação/workspaces:
  - novo submódulo `apps/frontend-service/src/components/trading/TradingNavigationConfig.ts` criado para isolar tipos e catálogos (`TradingTabKey`, `TradingWorkspaceKey`, `TRADING_TAB_DESCRIPTORS`, `TRADING_WORKSPACE_TABS`, `TRADING_WORKSPACE_LABELS`, `findWorkspaceForTradingTab`)
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para reexportar o novo módulo via barrel oficial de trading
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o módulo extraído e remover blocos inline de configuração de navegação
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de densidade do container principal de trading
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 90)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 90)
- Seguir decomposição incremental das mega-páginas remanescentes no frontend (principalmente `Trading.tsx`, `WisePayments.tsx` e `Chat/index.tsx`) mantendo validação sequencial e SSOT atualizado.
- Consolidar checklist objetivo das pendências remanescentes dos blocos 3/4/5 com status de conclusão rastreável por serviço.

### Escopo entregue nesta rodada (continuação 91 - 08/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração de utilitários de página:
  - novo submódulo `apps/frontend-service/src/components/trading/TradingPageUtils.ts` criado para isolar helpers puros (`getQuoteCurrencyFromSymbol`, `getBaseCurrencyFromSymbol`, `formatDurationMinutes`)
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para reexportar o novo módulo via barrel oficial de trading
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir os helpers extraídos e remover definições inline locais
  - comportamento original preservado (parsing de símbolo por `split('-')` e semântica de formatação de duração)
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de densidade do container principal de trading
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 91)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 91)
- Seguir decomposição incremental das mega-páginas remanescentes no frontend (principalmente `Trading.tsx`, `WisePayments.tsx` e `Chat/index.tsx`) mantendo validação sequencial e SSOT atualizado.
- Consolidar checklist objetivo das pendências remanescentes dos blocos 3/4/5 com status de conclusão rastreável por serviço.

### Escopo entregue nesta rodada (continuação 92 - 08/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração dos contratos de domínio:
  - novo submódulo `apps/frontend-service/src/components/trading/TradingDomainTypes.ts` criado para isolar tipos de payload/conta/sinal/ordem, type guards de margem e presets de animação
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para reexportar contratos/guards/presets via barrel oficial de trading
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o módulo extraído e remover definições inline locais
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `Trading.tsx` reduzido de 3649 para 3320 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de densidade e acoplamento do container principal de trading
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 92)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 92)
- Seguir decomposição incremental das pendências remanescentes de `Trading.tsx` priorizando extração de estados/form defaults e hooks de orquestração para reduzir o container sem alterar contratos.
- Após estabilizar o próximo sub-bloco de `Trading`, avançar para os sub-blocos de `Chat/index.tsx` e ajustes residuais em `WisePayments.tsx` mantendo validação sequencial e SSOT atualizado.

### Escopo entregue nesta rodada (continuação 93 - 08/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração de defaults de formulários/estado:
  - novo submódulo `apps/frontend-service/src/components/trading/TradingFormDefaults.ts` criado para isolar factories tipadas de inicialização/reset (`createDefault*`) e mapeamentos de config (`create*FromConfig`)
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para reexportar o módulo via barrel oficial de trading
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir factories no `useState` e em resets/mapeamentos operacionais (`order`, `risk`, `scheduler`, `review`, `signal`, `signalProfile`)
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural e redução de duplicação
  - `Trading.tsx` reduzido de 3320 para 3232 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de acoplamento e repetição de estado no container principal de trading
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 93)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 93)
- Seguir decomposição incremental das pendências remanescentes de `Trading.tsx` priorizando extração de handlers/efeitos de orquestração (`signal profile`, `scheduler`, `order conversions`) para reduzir o container sem alterar contratos.
- Em seguida avançar para os sub-blocos pendentes de `Chat/index.tsx` e validação de fechamento em `WisePayments.tsx`, mantendo validação sequencial e SSOT atualizado.

### Escopo entregue nesta rodada (continuação 94 - 08/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração da orquestração de perfil de sinais:
  - novo submódulo `apps/frontend-service/src/components/trading/useTradingSignalProfileState.ts` criado para isolar estado `signalProfile`, updaters e reconciliação automática de arbitragem
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para reexportar o novo hook via barrel oficial de trading
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o hook e remover bloco inline de orquestração do `signalProfile`
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `Trading.tsx` reduzido de 3232 para 3178 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de acoplamento do container principal de trading
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 94)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 94)
- Seguir decomposição incremental das pendências remanescentes de `Trading.tsx` priorizando extração de handlers de conversão de ordem e blocos de mutações com baixo acoplamento.
- Após estabilizar o próximo sub-bloco de `Trading`, avançar para os sub-blocos pendentes de `Chat/index.tsx` e fechamento residual de `WisePayments.tsx` mantendo validação sequencial e SSOT atualizado.

### Escopo entregue nesta rodada (continuação 95 - 08/03/2026)
- Continuidade da decomposição incremental de `Chat` com extração de utilitários de rota/sources:
  - novo submódulo `apps/frontend-service/src/pages/Chat/chat-page-routing.ts` criado para isolar `ChatWorkspaceKey`, `CHAT_WORKSPACES`, `normalizeRouteForContext` e `isIsoDateQueryParam`
  - novo submódulo `apps/frontend-service/src/pages/Chat/chat-message-sources.ts` criado para isolar parsing/normalização de fontes de mensagem (`parseMessageSources`)
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para consumir os submódulos extraídos e remover definições inline locais
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `Chat/index.tsx` reduzido de 3075 para 2975 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de densidade/acoplamento do container principal de chat
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 95)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 95)
- Seguir decomposição incremental das pendências remanescentes de `Trading.tsx` e `Chat/index.tsx` priorizando blocos de mutações/handlers com maior densidade e baixo risco de regressão.
- Em seguida avançar para fechamento residual de `WisePayments.tsx`, mantendo validação sequencial e SSOT atualizado.

### Escopo entregue nesta rodada (continuação 96 - 08/03/2026)
- Continuidade da decomposição incremental de `Chat` com extração de utilitários de gravação:
  - novo submódulo `apps/frontend-service/src/pages/Chat/chat-recording-utils.ts` criado para isolar normalização de MIME, encode WAV, conversão para WAV, erro tipado de preparação e `prepareRecordingFile`
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para consumir utilitário extraído e remover bloco inline de gravação
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `Chat/index.tsx` reduzido de 2975 para 2833 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de densidade/acoplamento do container principal de chat
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 96)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 96)
- Seguir decomposição incremental das pendências remanescentes de `Trading.tsx` e `Chat/index.tsx` priorizando extração de blocos de mutações/handlers com maior densidade e baixo risco.
- Em seguida avançar para fechamento residual de `WisePayments.tsx`, mantendo validação sequencial e SSOT atualizado.

### Escopo entregue nesta rodada (continuação 97 - 08/03/2026)
- Continuidade da decomposição incremental de `Chat` com extração de utilitários de anexos de mídia:
  - novo submódulo `apps/frontend-service/src/pages/Chat/chat-media-attachments.ts` criado para isolar conversão base64 e resolução de arquivos por upload/URL (`fileToBase64`, `mediaAttachmentToBase64`)
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para consumir utilitário extraído e remover bloco inline de conversão de anexos
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `Chat/index.tsx` reduzido de 2833 para 2784 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de densidade/acoplamento do container principal de chat
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 97)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 97)
- Seguir decomposição incremental das pendências remanescentes de `Trading.tsx` priorizando extração de handlers de conversão/mutações com maior densidade e baixo risco.
- Em seguida avançar para sub-blocos residuais de `Chat/index.tsx` e fechamento de `WisePayments.tsx`, mantendo validação sequencial e SSOT atualizado.

### Escopo entregue nesta rodada (continuação 98 - 08/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração de hook de sizing:
  - novo submódulo `apps/frontend-service/src/components/trading/useTradingOrderSizing.ts` criado para isolar cálculo de preço corrente/`contractMultiplier` e handlers de conversão (`handleOrderSizeChange`, `handleOrderUsdtChange`)
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para reexportar o hook e o helper `resolveTradingCurrentPrice` via barrel oficial de trading
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o hook extraído e remover duplicação inline de cálculo/conversão de ordens
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `Trading.tsx` reduzido de 3178 para 3137 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de densidade/acoplamento do container principal de trading
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 98)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 98)
- Seguir decomposição incremental das pendências remanescentes de `Trading.tsx` priorizando extração de blocos de mutações e orquestrações de histórico/ordens com baixo risco.
- Em seguida avançar para sub-blocos residuais de `Chat/index.tsx` e fechamento de `WisePayments.tsx`, mantendo validação sequencial e SSOT atualizado.

### Escopo entregue nesta rodada (continuação 99 - 08/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração dos cálculos de resumo de ordem:
  - novo submódulo `apps/frontend-service/src/components/trading/TradingOrderSummary.ts` criado para isolar validação de submissão e estimativas de PnL (`canSubmitOrder`, preço efetivo, leverage, SL/TP)
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para reexportar `buildTradingOrderSummary` via barrel oficial de trading
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir utilitário extraído e remover bloco inline de cálculos de resumo
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `Trading.tsx` reduzido de 3137 para 3116 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de densidade/acoplamento do container principal de trading
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 99)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 99)
- Seguir decomposição incremental das pendências remanescentes de `Trading.tsx` priorizando extração de orquestrações de histórico/review e blocos de mutações com baixo risco.
- Em seguida avançar para sub-blocos residuais de `Chat/index.tsx` e fechamento de `WisePayments.tsx`, mantendo validação sequencial e SSOT atualizado.

### Escopo entregue nesta rodada (continuação 100 - 08/03/2026)
- Continuidade da decomposição incremental de `Chat` com extração da normalização de mensagens:
  - novo submódulo `apps/frontend-service/src/pages/Chat/chat-message-normalization.ts` criado para isolar normalização de payload servidor, mapeamento de anexos legados e snapshot de usuário
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para consumir utilitário extraído em sincronização de histórico e eventos `web_image_results`, removendo blocos inline duplicados
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `Chat/index.tsx` reduzido de 2784 para 2737 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de densidade/acoplamento do container principal de chat
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 100)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 100)
- Seguir decomposição incremental das pendências remanescentes de `Trading.tsx` e `Chat/index.tsx` priorizando extração de blocos de mutações/handlers com maior densidade e baixo risco.
- Em seguida avançar para fechamento residual de `WisePayments.tsx`, mantendo validação sequencial e SSOT atualizado.

### Escopo entregue nesta rodada (continuação 101 - 08/03/2026)
- Continuidade da decomposição incremental de `Chat` com extração da lista de conversas:
  - novo componente `apps/frontend-service/src/pages/Chat/components/ConversationsList.tsx` criado para isolar renderização de sidebar, seleção em lote e paginação de conversas
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para consumir o componente extraído e remover bloco inline da lista de conversas
  - `apps/frontend-service/src/pages/Chat/components/index.ts` atualizado com export do novo componente
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `Chat/index.tsx` reduzido de 2737 para 2558 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de densidade/acoplamento do container principal de chat
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 101)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 101)
- Seguir decomposição incremental das pendências remanescentes de `Chat/index.tsx` priorizando extração de hooks de comportamento (mobile viewport/scroll/seleção) com baixo risco.
- Em seguida avançar em pendências residuais de `Trading.tsx` e fechamento de `WisePayments.tsx`, mantendo validação sequencial e SSOT atualizado.

### Escopo entregue nesta rodada (continuação 102 - 08/03/2026)
- Continuidade da decomposição incremental de `Chat` com extração do hook de viewport mobile:
  - novo hook `apps/frontend-service/src/pages/Chat/useIsMobileViewport.ts` criado para isolar detecção responsiva de mobile (`matchMedia`)
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para consumir o hook extraído e remover implementação inline
  - sem alteração de payloads, contratos de API ou mutações; somente desacoplamento estrutural
  - `Chat/index.tsx` reduzido de 2558 para 2536 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de densidade/acoplamento do container principal de chat
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 102)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 102)
- Seguir decomposição incremental das pendências remanescentes de `Chat/index.tsx` priorizando extração de blocos de seleção/scroll e handlers de mutação com baixo risco.
- Em seguida avançar em pendências residuais de `Trading.tsx` e fechamento de `WisePayments.tsx`, mantendo validação sequencial e SSOT atualizado.

### Escopo entregue nesta rodada (continuação 103 - 08/03/2026)
- Continuidade da decomposição incremental de `Chat` com extração dos hooks de scroll e seleção:
  - novo hook `apps/frontend-service/src/pages/Chat/useChatAutoScroll.ts` criado para isolar refs de viewport, auto-scroll condicional, listeners de scroll e observer de resize
  - novo hook `apps/frontend-service/src/pages/Chat/useChatSelectionState.ts` criado para isolar estado/handlers de seleção em lote (conversas) e seleção por range com `Shift` (mensagens)
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para consumir os hooks extraídos, removendo lógica inline de scroll e seleção sem alterar mutações/contratos
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
  - `Chat/index.tsx` reduzido de 2536 para 2459 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de densidade/acoplamento do container principal de chat
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 103)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 103)
- Avançar nas pendências residuais de `Trading.tsx`, priorizando extração dos blocos restantes de handlers/mutações com maior densidade e baixo risco de regressão.
- Na sequência, fechar o residual de `WisePayments.tsx` mantendo validação sequencial e atualização completa do SSOT ao fim do sub-bloco.

### Escopo entregue nesta rodada (continuação 104 - 08/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração da governança de presets de notícias:
  - novo hook `apps/frontend-service/src/components/trading/useTradingNewsPresets.ts` criado para isolar query/mutações de presets (`GET/POST/PUT/DELETE`), seleção ativa e regras de habilitação (`canCreatePreset`, `canUpdatePreset`)
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para reexportar o hook pelo barrel oficial de trading
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o hook extraído e remover bloco inline de query/mutações de presets
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
  - `Trading.tsx` reduzido de 3116 para 3080 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de densidade/acoplamento do container principal de trading
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 104)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 104)
- Avançar nas pendências residuais de `Trading.tsx`, priorizando extração dos blocos restantes de orquestração de histórico/review e handlers de mutação com baixo risco de regressão.
- Na sequência, avançar para o residual de `WisePayments.tsx` mantendo validação sequencial e atualização completa do SSOT ao fim do sub-bloco.

### Escopo entregue nesta rodada (continuação 105 - 08/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com extração da navegação/workspaces:
  - novo módulo `apps/frontend-service/src/pages/wise-payments/wise-payments-navigation.ts` criado para isolar catálogo de tabs, mapeamento de workspaces e tipos `WiseTabKey`/`WiseWorkspaceKey`
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir o módulo extraído e remover definições inline duplicadas
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
  - `WisePayments.tsx` reduzido de 3263 para 3183 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de densidade/acoplamento do container principal de WisePayments
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 105)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 105)
- Retomar pendências residuais de `Trading.tsx` priorizando blocos de orquestração de histórico/review com baixo risco.
- Em seguida avançar no próximo sub-bloco de `WisePayments.tsx` para reduzir handlers operacionais inline, mantendo validação sequencial e SSOT atualizado.

### Escopo entregue nesta rodada (continuação 106 - 08/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração do hook de histórico de ordens:
  - novo hook `apps/frontend-service/src/components/trading/useTradingOrderHistory.ts` criado para isolar estado de histórico, paginação com cursor, seleção em lote e exclusão (`self`/`tenant`)
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para reexportar o hook no barrel oficial
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o hook extraído e remover lógica inline de histórico/review operacional
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
  - `Trading.tsx` reduzido de 3080 para 3006 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de densidade/acoplamento do container principal de trading
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 106)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 106)
- Avançar no próximo residual de `WisePayments.tsx` priorizando extração de handlers operacionais de baixo risco.
- Em seguida retornar para os blocos residuais finais de `Trading.tsx`, mantendo validação sequencial e SSOT atualizado ao fim de cada sub-bloco.

### Escopo entregue nesta rodada (continuação 107 - 08/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com extração do guard de queries:
  - novo hook `apps/frontend-service/src/pages/wise-payments/use-wise-query-guard.ts` criado para isolar janela de bloqueio temporário de queries após respostas `401/429`
  - política de habilitação de queries (`wiseQueryEnabled`) e tratamento centralizado de erro (`handleWiseQueryError`) removidos do container e encapsulados no hook
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir o hook extraído e remover estado/efeitos inline de bloqueio de queries
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
  - `WisePayments.tsx` reduzido de 3183 para 3133 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de densidade/acoplamento do container principal de WisePayments
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 107)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 107)
- Avançar no próximo residual de `WisePayments.tsx` priorizando extração de handlers operacionais (`balanceCapacity/totalFunds/rates/recipientRequirements`) com baixo risco.
- Em seguida retornar para os blocos residuais finais de `Trading.tsx`, mantendo validação sequencial e SSOT atualizado ao fim de cada sub-bloco.

### Escopo entregue nesta rodada (continuação 108 - 08/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com extração de handlers operacionais de referência:
  - novo hook `apps/frontend-service/src/pages/wise-payments/use-wise-reference-actions.ts` criado para isolar estado e handlers de `balanceCapacity`, `totalFunds`, `rates` e `recipientRequirements`
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir o hook extraído e remover estado/handlers inline desses fluxos
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
  - `WisePayments.tsx` reduzido de 3133 para 3070 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de densidade/acoplamento do container principal de WisePayments
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 108)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 108)
- Avançar no residual de `WisePayments.tsx` priorizando extração dos handlers de ação de transferência/cartões (`fund/cancel transfer`, `card permissions`, `card secure`) com baixo risco.
- Em seguida retomar os blocos residuais finais de `Trading.tsx`, mantendo validação sequencial e SSOT atualizado ao fim de cada sub-bloco.

### Escopo entregue nesta rodada (continuação 109 - 08/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com extração de handlers de transferência/cartões:
  - novo hook `apps/frontend-service/src/pages/wise-payments/use-wise-transfer-and-card-actions.ts` criado para isolar estado e handlers de `fund/cancel transfer`, permissões de cartão e fluxos `card secure`
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir o hook extraído e remover estado/handlers inline desses fluxos
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
  - `WisePayments.tsx` reduzido de 3070 para 2949 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de densidade/acoplamento do container principal de WisePayments
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 109)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 109)
- Avançar no residual de `WisePayments.tsx` priorizando extração dos handlers de `disputes/kyc/webhooks/simulations/sca/catalog` com baixo risco.
- Em seguida retomar os blocos residuais finais de `Trading.tsx`, mantendo validação sequencial e SSOT atualizado ao fim de cada sub-bloco.

### Escopo entregue nesta rodada (continuação 110 - 08/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com extração de upload de arquivos (disputes/KYC):
  - novo hook `apps/frontend-service/src/pages/wise-payments/use-wise-file-upload-state.ts` criado para isolar estado e handlers de upload para `dispute`, `kyc document` e `kyc additional`
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir o hook extraído e remover lógica inline de leitura base64/atualização de payloads de arquivo
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
  - `WisePayments.tsx` reduzido de 2949 para 2900 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de densidade/acoplamento do container principal de WisePayments
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 110)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 110)
- Avançar no residual de `WisePayments.tsx` priorizando extração dos handlers de `webhooks/simulations/sca/catalog` com baixo risco.
- Em seguida retomar os blocos residuais finais de `Trading.tsx`, mantendo validação sequencial e SSOT atualizado ao fim de cada sub-bloco.

### Escopo entregue nesta rodada (continuação 111 - 08/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com extração do catalog workbench:
  - novo hook `apps/frontend-service/src/pages/wise-payments/use-wise-catalog-workbench.ts` criado para isolar estado/efeitos/handler do fluxo de catálogo (`catalogOperationId`, `catalogParams`, `catalogResponse`, `handleRunCatalogOperation`)
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir o hook extraído e remover estado/efeitos/handler inline de catálogo
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
  - `WisePayments.tsx` reduzido de 2900 para 2829 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de densidade/acoplamento do container principal de WisePayments
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 111)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 111)
- Avançar no residual de `WisePayments.tsx` priorizando extração dos handlers de `webhooks/simulations/sca` com baixo risco.
- Em seguida retomar os blocos residuais finais de `Trading.tsx`, mantendo validação sequencial e SSOT atualizado ao fim de cada sub-bloco.

### Escopo entregue nesta rodada (continuação 112 - 08/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com extração dos fluxos `webhooks/simulations/sca`:
  - novo hook `apps/frontend-service/src/pages/wise-payments/use-wise-webhook-simulation-sca-actions.ts` criado para isolar estado, mutações e handlers desses fluxos operacionais
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir o hook extraído e remover mutações/handlers inline de `webhooks`, `simulations` e `sca`
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
  - `WisePayments.tsx` reduzido de 2829 para 2586 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de densidade/acoplamento do container principal de WisePayments
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 112)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 112)
- Avançar no residual de `WisePayments.tsx` priorizando extração dos handlers de `account-details/card-orders/disputes` com baixo risco.
- Em seguida retomar os blocos residuais finais de `Trading.tsx`, mantendo validação sequencial e SSOT atualizado ao fim de cada sub-bloco.

### Escopo entregue nesta rodada (continuação 113 - 08/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com extração dos fluxos `account-details/card-orders/disputes`:
  - novo hook `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-actions.ts` criado para isolar estado, mutações e handlers de `account-details`, `card-orders`, `card-transactions`, `disputes` e `kyc`
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir o hook extraído e remover mutações/handlers inline desses fluxos operacionais
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
  - `WisePayments.tsx` reduzido de 2586 para 2076 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de densidade/acoplamento do container principal de WisePayments
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 113)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 113)
- Avançar no residual de `WisePayments.tsx` priorizando extração dos handlers de `balances/exchange/statements/profiles/users/activities` com baixo risco.
- Em seguida retomar os blocos residuais finais de `Trading.tsx`, mantendo validação sequencial e SSOT atualizado ao fim de cada sub-bloco.

### Escopo entregue nesta rodada (continuação 114 - 08/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com extração dos fluxos `users/activities`:
  - novo hook `apps/frontend-service/src/pages/wise-payments/use-wise-user-activity-actions.ts` criado para isolar estado, mutações e handlers operacionais de `users` e `activities`
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir o hook extraído e remover mutações/handlers inline desses fluxos
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
  - `WisePayments.tsx` reduzido de 2076 para 2025 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de densidade/acoplamento do container principal de WisePayments
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 114)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 114)
- Avançar no residual de `WisePayments.tsx` priorizando extração dos handlers de `balances/exchange/statements/profiles` com baixo risco.
- Em seguida retomar os blocos residuais finais de `Trading.tsx`, mantendo validação sequencial e SSOT atualizado ao fim de cada sub-bloco.

### Escopo entregue nesta rodada (continuação 115 - 08/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com extração dos fluxos `balances/quotes/exchange/statements`:
  - novo hook `apps/frontend-service/src/pages/wise-payments/use-wise-balance-exchange-statement-actions.ts` criado para isolar estado, mutações e handlers operacionais de `balances`, `quotes`, `exchange` e `statements`
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir o hook extraído e remover mutações/handlers inline desses fluxos
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
  - `WisePayments.tsx` reduzido de 2025 para 1826 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de densidade/acoplamento do container principal de WisePayments
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 115)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 115)
- Avançar no residual de `WisePayments.tsx` priorizando extração dos handlers de `profiles` e padronização de ações restantes de cartões/spend-controls com baixo risco.
- Em seguida retomar os blocos residuais finais de `Trading.tsx`, mantendo validação sequencial e SSOT atualizado ao fim de cada sub-bloco.

### Escopo entregue nesta rodada (continuação 116 - 08/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com extração dos fluxos `cards/spend-controls/spend-limits`:
  - novo hook `apps/frontend-service/src/pages/wise-payments/use-wise-card-spend-actions.ts` criado para isolar estado, mutações e handlers operacionais de `cards`, `spend-controls` e `spend-limits`
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir o hook extraído e remover mutações/handlers inline desses fluxos
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
  - `WisePayments.tsx` reduzido de 1826 para 1518 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de densidade/acoplamento do container principal de WisePayments
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 116)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 116)
- Avançar no residual de `WisePayments.tsx` priorizando extração de `profiles`/`recipients` e finalização do container com foco em composition root.
- Em seguida retomar os blocos residuais finais de `Trading.tsx`, mantendo validação sequencial e SSOT atualizado ao fim de cada sub-bloco.

### Escopo entregue nesta rodada (continuação 117 - 08/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com extração dos fluxos `recipients`:
  - novo hook `apps/frontend-service/src/pages/wise-payments/use-wise-recipient-actions.ts` criado para isolar estado/transições do diálogo de recipient e mutação de deleção
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir o hook extraído e remover mutação/handler inline de recipients
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
  - `WisePayments.tsx` reduzido de 1518 para 1503 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de densidade/acoplamento do container principal de WisePayments
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 117)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 117)
- Avançar para os resíduos finais de `WisePayments.tsx` (principalmente composição de queries e filtros), mantendo o container como composition root.
- Em seguida retomar os blocos residuais finais de `Trading.tsx`, mantendo validação sequencial e SSOT atualizado ao fim de cada sub-bloco.

### Escopo entregue nesta rodada (continuação 118 - 08/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração da navegação de workspaces/tabs:
  - novo hook `apps/frontend-service/src/components/trading/useTradingWorkspaceNavigation.ts` criado para isolar estado e handlers de `activeTab`/`activeWorkspace` e reconciliação automática de workspace por tab
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o hook extraído, removendo bloco inline de navegação
  - barrel `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar o novo hook
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
  - `Trading.tsx` reduzido de 3006 para 2987 linhas
- Continuidade de hardening UX P2:
  - nenhum contrato backend/RBAC alterado
  - sem mudança de comportamento funcional, apenas redução de densidade/acoplamento do container principal de Trading
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 118)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 118)
- Avançar nos resíduos finais de `Trading.tsx` priorizando extração de blocos de mutações de controle/ordens com baixo risco.
- Em paralelo, manter fechamento residual de `WisePayments.tsx` focado em composição de queries/filtros.

### Escopo entregue nesta rodada (continuação 119 - 08/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração do residual de mutações de ordens/controle:
  - novo hook `apps/frontend-service/src/components/trading/useTradingControlOrderMutations.ts` criado para isolar `create/cancel/approve/reject/update/sync/risk` e handlers de `handover toggle`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o hook e manter comportamento funcional original
  - barrel `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar o novo hook
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
  - `Trading.tsx` reduzido de 2987 para 2700 linhas
- Continuidade da decomposição incremental de `WisePayments` com fechamento da composição de queries/filtros:
  - novo hook `apps/frontend-service/src/pages/wise-payments/use-wise-data-queries.ts` criado para centralizar queries, guard de erro, `profileFilter`, paginação `cardOrders` e `refetch` operacional
  - novo arquivo `apps/frontend-service/src/pages/wise-payments/wise-payments-types.ts` criado para consolidar contratos tipados de domínio/respostas Wise
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir o hook e reduzir composição inline
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
  - `WisePayments.tsx` reduzido de 1503 para 1231 linhas
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 119)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 test tests/e2e/frontend-trading-realtime.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 119)
- Avançar nos resíduos finais de `Chat/index.tsx` (handlers, seleção e scroll) mantendo o container como composition root.
- Retomar resíduos finais de `Trading.tsx` não cobertos por esta rodada e seguir fechamento dos sub-blocos P2 restantes.

### Escopo entregue nesta rodada (continuação 120 - 08/03/2026)
- Continuidade da decomposição incremental de `Chat` com extração do lifecycle de conversas:
  - novo hook `apps/frontend-service/src/pages/Chat/useChatConversationLifecycle.ts` criado para isolar:
    - mutações `create conversation`, `delete conversation`, `bulk delete`, `delete all`
    - mutação de `approval policy`
    - handlers de `new chat`, `select conversation`, confirmação de deleções e fechamento de sidebar
    - controle de `focusNonce`/`bumpInputFocus`
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para consumir o hook extraído e remover mutações/handlers inline equivalentes
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
  - `Chat/index.tsx` reduzido de 2459 para 2375 linhas
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 120)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/chat-streaming-backpressure.test.ts tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 120)
- Avançar no próximo residual de maior impacto em `Chat/index.tsx`: extrair o bloco de ações de mensagem/treinamento/feedback para hook dedicado.
- Em seguida retomar residual de `Trading.tsx` com extração dos handlers de orquestração ainda inline.

### Escopo entregue nesta rodada (continuação 121 - 08/03/2026)
- Continuidade da decomposição incremental de `Chat` com extração das ações de treinamento/feedback:
  - novo hook `apps/frontend-service/src/pages/Chat/useChatTrainingFeedbackActions.ts` criado para isolar:
    - mutações de envio para treinamento por conversa e por seleção de mensagens
    - handlers de abertura de dialogs de treinamento (`conversation`/`messages`)
    - mutações e handlers de feedback multimodal (`rate message` e `rate image`)
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para consumir o hook extraído e remover mutações/handlers inline equivalentes
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
  - `Chat/index.tsx` reduzido de 2375 para 2263 linhas
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 121)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/chat-streaming-backpressure.test.ts tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 121)
- Avançar no próximo residual de maior impacto em `Trading.tsx`: extrair handlers de orquestração operacional ainda inline.
- Em seguida retomar resíduos finais de `Chat/index.tsx` (scroll/seleção/stream orchestration) e fechamento de `WisePayments`.

### Escopo entregue nesta rodada (continuação 122 - 08/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração das mutações de sinais:
  - novo hook `apps/frontend-service/src/components/trading/useTradingSignalMutations.ts` criado para isolar:
    - `create signal`
    - `generate signal`
    - `signal auto run`
    - `signal scheduler update`
    - `deactivate signal`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o hook extraído e remover mutações inline equivalentes
  - barrel `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar o novo hook
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
  - `Trading.tsx` reduzido de 2700 para 2538 linhas
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 122)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/chat-streaming-backpressure.test.ts tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 122)
- Avançar no próximo residual de maior impacto em `Trading.tsx`: extrair orquestração de pipeline/enqueue (`enqueueTrading`, `runPortfolioAutoPipeline`) para hook dedicado.
- Em seguida retomar resíduos finais de `Chat/index.tsx` (scroll/seleção/stream orchestration) e fechamento residual de `WisePayments`.

### Escopo entregue nesta rodada (continuação 123 - 08/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração da orquestração de pipeline/enqueue:
  - novo hook `apps/frontend-service/src/components/trading/useTradingPipelineActions.ts` criado para isolar:
    - mutação `enqueueTradingMutation`
    - callback `enqueueTrading`
    - callback `runPortfolioAutoPipeline`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o hook extraído e remover bloco inline equivalente
  - barrel `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar o novo hook
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
  - `Trading.tsx` reduzido de 2538 para 2424 linhas
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 123)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/chat-streaming-backpressure.test.ts tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 123)
- Avançar no próximo residual de maior impacto em `Trading.tsx`: extrair bloco de preferências de símbolos/favoritos (`updateSymbolPrefs`, `toggleFavorite`, `toggleFeatured`) para hook dedicado.
- Em seguida retomar resíduos finais de `Chat/index.tsx` (scroll/seleção/stream orchestration) e fechamento residual de `WisePayments`.

### Escopo entregue nesta rodada (continuação 124 - 08/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração das preferências de símbolos:
  - novo hook `apps/frontend-service/src/components/trading/useTradingSymbolPreferences.ts` criado para isolar:
    - mutação `updateSymbolPrefs`
    - callbacks `toggleFavorite` e `toggleFeatured`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o hook extraído e remover bloco inline equivalente
  - barrel `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar o novo hook
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
  - `Trading.tsx` reduzido de 2424 para 2397 linhas
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 124)
1. `npx -y pnpm@10.26.2 --filter @alice/frontend-service typecheck`
2. `npx -y pnpm@10.26.2 exec vitest run tests/e2e/chat-streaming-backpressure.test.ts tests/e2e/frontend-permission-gates.test.ts tests/e2e/frontend-trading-realtime.test.ts tests/unit/frontend-logger.test.ts`
3. `npx -y pnpm@10.26.2 --filter @alice/frontend-service lint`
4. `npx -y pnpm@10.26.2 --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 124)
- Avançar no próximo residual de maior impacto em `Chat/index.tsx`: extrair orchestration de scroll/seleção/stream handlers restantes para hook dedicado.
- Em seguida retomar fechamento residual final de `WisePayments` (micro-composição e limpeza de acoplamentos remanescentes).

### Escopo entregue nesta rodada (continuação 125 - 08/03/2026)
- Continuidade da decomposição incremental de `Chat` com extração das ações de gravação/transcrição:
  - novo hook `apps/frontend-service/src/pages/Chat/useChatRecordingActions.ts` criado para isolar:
    - resolução de MIME de gravação
    - upload/transcrição com polling (`/api/media/upload/json` + `/api/media/:uploadId`)
    - finalização de gravação (`review`/`direct`) com envio de mensagem e pending media
    - handlers `handleStartRecording`, `handleStopRecordingReview` e `handleSendRecordingNow`
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para consumir o hook extraído e remover blocos inline equivalentes
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
  - `Chat/index.tsx` reduzido de 2263 para 2045 linhas
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 125)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 125)
- Avançar no próximo residual de maior impacto em `Trading.tsx`: extrair mutações residuais de controle/ordens ainda inline e reduzir o container para composition root mais fino.
- Em seguida retomar fechamento residual final de `WisePayments` (micro-composição e limpeza de acoplamentos remanescentes), mantendo validação sequencial e SSOT atualizado.

### Escopo entregue nesta rodada (continuação 126 - 08/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração de mutações residuais de perfil/post-mortem:
  - novo hook `apps/frontend-service/src/components/trading/useTradingProfilePostmortemMutations.ts` criado para isolar:
    - mutação `sendPostMortemToTrainingMutation`
    - mutação `updateSignalProfileMutation`
    - governança de toasts, invalidation/refetch e contexto de auto-save
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o hook extraído e remover mutações inline equivalentes
  - barrel `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar o novo hook
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
  - `Trading.tsx` reduzido de 2397 para 2350 linhas
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 126)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 126)
- Avançar no fechamento residual de `WisePayments.tsx` com micro-composição dos blocos inline remanescentes para consolidar o container como composition root.
- Em seguida retomar o residual final de `Chat/index.tsx` (orquestração de scroll/seleção/stream handlers restantes), mantendo validação sequencial e SSOT atualizado.

### Escopo entregue nesta rodada (continuação 127 - 08/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com extração de constantes/status:
  - novo módulo `apps/frontend-service/src/pages/wise-payments/wise-payments-constants.tsx` criado para isolar:
    - catálogo `WISE_CATALOG_OPERATIONS`
    - lista `CURRENCIES`
    - renderer `getWiseStatusBadge`
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir o módulo extraído e remover blocos inline equivalentes
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
  - `WisePayments.tsx` reduzido de 1231 para 999 linhas
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 127)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 127)
- Avançar no residual final de `Chat/index.tsx`: extrair orchestration de stream/scroll/seleção restante para hook dedicado.
- Em seguida revisar resíduos finais de `Trading.tsx`/`WisePayments.tsx` para fechamento do bloco P2 com composition roots mais finos.

### Escopo entregue nesta rodada (continuação 128 - 08/03/2026)
- Continuidade da decomposição incremental de `Chat` com extração das ações de anexos de mídia:
  - novo hook `apps/frontend-service/src/pages/Chat/useChatMediaAttachmentActions.ts` criado para isolar:
    - upload e validação de mídia (`handleFileSelect`)
    - remoção de mídia pendente com cleanup de upload (`removePendingMedia`)
    - limpeza de anexos (`clearPendingMedia`)
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para consumir o hook extraído e remover blocos inline equivalentes
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
  - `Chat/index.tsx` reduzido de 2045 para 1929 linhas
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 128)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 128)
- Avançar no residual de maior impacto em `Chat/index.tsx`: extrair orchestration de stream/status/eventos para hook dedicado e reduzir o container final.
- Em seguida revisar resíduos finais de `Trading.tsx`/`WisePayments.tsx` para fechamento do bloco P2 com composition roots ainda mais finos.

### Escopo entregue nesta rodada (continuação 129 - 08/03/2026)
- Continuidade da decomposição incremental de `Chat` com extração do diagnóstico de stream:
  - novo hook `apps/frontend-service/src/pages/Chat/useChatStreamDiagnostics.ts` criado para isolar:
    - `resolveStreamStatus`
    - `pushStreamEvent`
    - `createStatusEvent`
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para consumir o hook extraído e remover bloco inline equivalente
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
  - `Chat/index.tsx` reduzido de 1929 para 1889 linhas
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 129)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 129)
- Avançar no residual final de `Chat/index.tsx` extraindo orchestration de envio/stream handler para hook dedicado.
- Em seguida revisar resíduos finais de `Trading.tsx`/`WisePayments.tsx` para fechamento do bloco P2 com composition roots ainda mais finos.

### Escopo entregue nesta rodada (continuação 130 - 08/03/2026)
- Continuidade da decomposição incremental de `Chat` com extração dos filtros de conversa:
  - novo hook `apps/frontend-service/src/pages/Chat/useChatConversationFilters.ts` criado para isolar:
    - `routeContextFromQuery`
    - `conversationFilter` e `conversationFilterLabel`
    - `clearConversationFilter`
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para consumir o hook extraído e remover bloco inline equivalente
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
  - `Chat/index.tsx` reduzido de 1889 para 1857 linhas
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 130)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 130)
- Avançar no residual final de `Chat/index.tsx` extraindo orchestration de envio/stream principal para hook dedicado.
- Em seguida revisar resíduos finais de `Trading.tsx`/`WisePayments.tsx` para fechamento do bloco P2 com composition roots ainda mais finos.

### Escopo entregue nesta rodada (continuação 131 - 08/03/2026)
- Continuidade da decomposição incremental de `Chat` com extração das ações do composer:
  - novo hook `apps/frontend-service/src/pages/Chat/useChatComposerActions.ts` criado para isolar:
    - `handleRegenerate`
    - `handleStopStreaming`
    - `handleSend`
    - `handleSubmit`
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para consumir o hook extraído e remover bloco inline equivalente
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
  - `Chat/index.tsx` reduzido de 1857 para 1811 linhas
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 131)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 131)
- Avançar no residual de maior impacto de `Chat/index.tsx` extraindo handlers restantes de scroll/seleção/side-effects para hooks dedicados.
- Em seguida retomar resíduos finais de `Trading.tsx` e composição de queries/filtros residuais de `WisePayments.tsx` para fechamento do bloco P2.

### Escopo entregue nesta rodada (continuação 132 - 08/03/2026)
- Continuidade da decomposição incremental de `Chat` com extração do estado de roteamento:
  - novo hook `apps/frontend-service/src/pages/Chat/useChatRoutingState.ts` criado para isolar:
    - estado por conversa de `routing mode` e `routingAgentIds`
    - sincronização de agente roteado (`activeConversation` + último assistant com agente)
    - governança de `routing source`/`routing debug`
    - validação de seleção manual (`ensureRoutingSelection`)
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para consumir o hook extraído e remover blocos inline equivalentes
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
  - `Chat/index.tsx` reduzido de 1811 para 1772 linhas
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 132)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 132)
- Avançar no residual final de `Chat/index.tsx` extraindo side-effects remanescentes de lifecycle/cleanup para hooks dedicados.
- Em seguida retomar o residual final de `Trading.tsx` e `WisePayments.tsx` para fechamento do bloco P2.

### Escopo entregue nesta rodada (continuação 133 - 08/03/2026)
- Continuidade da decomposição incremental de `Chat` com extração do lifecycle de página:
  - novo hook `apps/frontend-service/src/pages/Chat/useChatPageLifecycle.ts` criado para isolar:
    - fechamento automático do drawer mobile por mudança de conversa
    - sincronização de refs de `input` e `pendingMedia`
    - reset de `lastMessagesSyncRef` por troca de conversa
    - callback de `setRecordingStartingState`
    - cleanup de gravação no unmount (media recorder + stream tracks)
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para consumir o hook extraído e remover blocos inline equivalentes
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
  - `Chat/index.tsx` reduzido de 1772 para 1751 linhas
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 133)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 133)
- Avançar no residual final de `Chat/index.tsx` extraindo blocos remanescentes de stream mutation para hook dedicado.
- Em seguida retomar o residual final de `Trading.tsx` e `WisePayments.tsx` para fechamento do bloco P2.

### Escopo entregue nesta rodada (continuação 134 - 08/03/2026)
- Continuidade da decomposição incremental de `Chat` com extração da stream mutation:
  - novo módulo `apps/frontend-service/src/pages/Chat/chat-stream-mutation.ts` criado para isolar:
    - mutação principal de `sendMessage` (SSE stream parser, conteúdo incremental e `final_message`)
    - atualização de estados de `routing/source/debug` durante stream
    - tratamento de eventos multimodais (`generated_image`, `web_image_results`, `media_uploaded`, `action_result`)
    - governança de timeout/abort e `onError` com fallback padrão
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para consumir `createChatStreamMutationConfig(...)` e remover bloco inline equivalente
  - ajuste tipado em `apps/frontend-service/src/pages/Chat/useChatRoutingState.ts` com export de `RoutingMode`/`RoutingDebugData` para contrato compartilhado
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
  - `Chat/index.tsx` reduzido de 1751 para 1231 linhas
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 134)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 134)
- Retomar resíduos finais de composição em `Trading.tsx` (mutações e handlers remanescentes fora de módulos dedicados).
- Em seguida fechar composição residual de `WisePayments.tsx` para consolidar finalização do bloco P2.

### Escopo entregue nesta rodada (continuação 135 - 08/03/2026)
- Continuidade da decomposição incremental de `Trading` com extração de handlers residuais:
  - novo hook `apps/frontend-service/src/components/trading/useTradingPageInteractionHandlers.ts` criado para isolar:
    - `prefillSellOrderFromAsset` (prefill operacional de ordem de venda por ativo)
    - `handleIntervalChange` (troca de intervalo do gráfico)
    - `openReviewDialogById` (lookup + abertura de review por id)
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o hook extraído e remover callbacks inline equivalentes
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
  - `Trading.tsx` reduzido de 2350 para 2324 linhas
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 135)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 135)
- Avançar no residual final de composição em `WisePayments.tsx` (queries/filtros/handlers remanescentes) para fechamento P2.
- Em seguida retomar novos resíduos de maior impacto em `Trading.tsx` até estabilizar o fechamento completo do bloco.

### Escopo entregue nesta rodada (continuação 136 - 08/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com extração de navegação/parser:
  - novo hook `apps/frontend-service/src/pages/wise-payments/use-wise-navigation-state.ts` criado para isolar:
    - estado de `activeTab`/`activeWorkspace`
    - cálculo de `visibleTabs`
    - handlers `handleWiseWorkspaceChange` e `handleWiseTabChange`
  - novo hook `apps/frontend-service/src/pages/wise-payments/use-wise-json-parser.ts` criado para isolar parser JSON seguro com feedback padronizado
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir os hooks extraídos e remover blocos inline equivalentes
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
  - `WisePayments.tsx` reduzido de 1000 para 968 linhas
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 136)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 136)
- Retomar resíduos finais de maior impacto em `Trading.tsx` (orquestração/payloads de perfil e handlers ainda inline).
- Em seguida concluir limpeza residual de `WisePayments.tsx` para fechamento formal do P2.

### Escopo entregue nesta rodada (continuação 137 - 08/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco em payload/review residual:
  - novo módulo `apps/frontend-service/src/components/trading/TradingSignalProfilePayload.ts` criado para isolar:
    - builder tipado de payload de perfil de sinais (`buildTradingSignalProfilePayload`)
    - validação de completude para fluxos machine-consumed (`isTradingSignalProfilePayloadComplete`)
  - novo hook `apps/frontend-service/src/components/trading/useTradingReviewOrderHandlers.ts` criado para isolar:
    - `handleApproveReviewOrder`
    - `handleSaveReviewOrderAdjustments`
    - `handleReviewOrderFieldUpdate`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir os novos módulos e remover blocos inline equivalentes de payload/handlers
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar os novos módulos
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
- Continuidade da decomposição incremental de `WisePayments` com foco em queries/filtros residuais:
  - novo hook `apps/frontend-service/src/pages/wise-payments/use-wise-refresh-actions.ts` criado para isolar refresh consolidado e condicional por `profileFilter`
  - novo hook `apps/frontend-service/src/pages/wise-payments/use-wise-derived-data.ts` criado para isolar mapeamentos tipados de coleções derivadas
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir os hooks extraídos e remover blocos inline equivalentes
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 137)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 137)
- Retomar resíduos finais de maior impacto em `Trading.tsx` (orquestração operacional residual de dialogs/ações ainda inline).
- Em seguida concluir resíduos finais de composição em `WisePayments.tsx` (handlers de filtros/queries remanescentes) para fechamento formal do P2.

### Escopo entregue nesta rodada (continuação 138 - 08/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco em handlers residuais de post-mortem training:
  - novo hook `apps/frontend-service/src/components/trading/useTradingPostmortemTrainingHandlers.ts` criado para isolar:
    - `handleOpenPostmortemTrainingDialog`
    - `handleCancelPostmortemTrainingDialog`
    - `handlePostmortemTrainingDialogOpenChange`
    - `handleSubmitPostmortemTraining`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o hook extraído e remover blocos inline equivalentes em:
    - `postMortemsTabProps.onOpenSendToTraining`
    - `postmortemTrainingDialogProps.onCancel/onOpenChange/onSubmit`
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar o novo hook
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 138)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 138)
- Retomar resíduos finais de maior impacto em `Trading.tsx` (orquestração residual de dialogs/forms ainda inline).
- Em seguida concluir resíduos finais de composição em `WisePayments.tsx` (handlers de filtros/queries remanescentes) para fechamento formal do P2.

### Escopo entregue nesta rodada (continuação 139 - 08/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco em dialogs/forms residuais:
  - novo hook `apps/frontend-service/src/components/trading/useTradingDialogFormHandlers.ts` criado para isolar:
    - `handleOpenNewOrderDialog` / `handleCloseNewOrderDialog`
    - `handlePatchOrderForm` / `handleNewOrderSizeChange` / `handleSubmitNewOrder`
    - `handlePatchRiskForm` / `handleSubmitRiskConfig`
    - `handleOpenNewSignalDialog` / `handleSignalConfidenceChange` / `handleSignalReasoningChange` / `handleSignalTypeChange` / `handleSubmitSignal`
    - `handleQuickOrder`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o hook extraído e remover callbacks inline equivalentes em `overview/orders/signals` e `TradingDialogsSection`
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar o novo hook
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
- Continuidade da decomposição incremental de `WisePayments` com foco em filtro residual:
  - `apps/frontend-service/src/pages/wise-payments/use-wise-user-activity-actions.ts` atualizado para expor `handleActivityFilterChange`
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir handler extraído e remover callback inline equivalente
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 139)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 139)
- Retomar resíduos finais de maior impacto em `Trading.tsx` (orquestração residual de mutações/ações de tabs ainda inline).
- Em seguida concluir fechamento formal do P2 com revisão final de resíduos em `WisePayments.tsx` e evidências de conclusão do bloco.

### Escopo entregue nesta rodada (continuação 140 - 08/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco em scheduler residual:
  - novo hook `apps/frontend-service/src/components/trading/useTradingSchedulerFormHandlers.ts` criado para isolar:
    - `handleSchedulerEnabledChange`
    - `handleSchedulerIntervalMinutesChange`
    - `handleSchedulerMaxSignalsPerRunChange`
    - `handleSchedulerSymbolsChange`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o hook extraído e remover callbacks inline equivalentes em `signalsTabProps`
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar o novo hook
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
- Continuidade da decomposição incremental de `WisePayments` com foco em efeito residual:
  - novo hook `apps/frontend-service/src/pages/wise-payments/use-wise-spend-control-default-currency.ts` criado para isolar sincronização de moeda padrão de spend-control
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir o hook extraído e remover `useEffect` inline equivalente
  - `apps/frontend-service/src/pages/wise-payments/use-wise-user-activity-actions.ts` atualizado para expor `handleActivityFilterChange` e manter composição de filtro desacoplada
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 140)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 140)
- Retomar resíduos finais de maior impacto em `Trading.tsx` (ações/mutações residuais de tabs e governança de sinais ainda inline).
- Em seguida consolidar fechamento formal do P2 com revisão final de resíduos em `WisePayments.tsx`.

### Escopo entregue nesta rodada (continuação 141 - 08/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco em mutações/ações residuais de tabs:
  - novo hook `apps/frontend-service/src/components/trading/useTradingMutationActionHandlers.ts` criado para isolar:
    - `handleApproveReviewOrderById`
    - `handleCancelOrderById`
    - `handleRejectReviewOrderById`
    - `handleSyncOrdersNow`
    - `handleDeactivateSignalById`
    - `handleOpenGeneratedSignal`
    - `handleOpenSignalsPanel`
    - `handleOpenAnalysisPanel`
    - `handleOpenLabPanel`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o hook extraído e remover callbacks inline equivalentes em:
    - `labTabProps`
    - `ordersTabProps`
    - `overviewTabProps`
    - `portfolioAutoTabProps`
    - `signalsAutoTabProps`
    - `signalsTabProps`
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar o novo hook
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 141)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 141)
- Retomar resíduos finais de maior impacto em `Trading.tsx` (ações de configuração de sinais/presets ainda inline).
- Em seguida consolidar fechamento formal do P2 com revisão final de resíduos em `WisePayments.tsx`.

### Escopo entregue nesta rodada (continuação 142 - 08/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco em configuração de sinais/presets residual:
  - novo hook `apps/frontend-service/src/components/trading/useTradingSignalProfileActionHandlers.ts` criado para isolar:
    - `handleApplyNewsPreset`
    - `handleChangeNewsConfig`
    - `handleCreateNewsPreset`
    - `handleDeleteNewsPreset`
    - `handleEnsembleTopNChange`
    - `handleGenerateSignalNow`
    - `handleSaveSignalProfile`
    - `handleSaveSignalScheduler`
    - `handleUpdateNewsPreset`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o hook extraído e remover callbacks inline equivalentes em `signalsTabProps`
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar o novo hook
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 142)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 142)
- Retomar resíduos finais de maior impacto em `Trading.tsx` (wrappers de refetch/ações operacionais ainda inline em tabs).
- Em seguida consolidar fechamento formal do P2 com revisão final de resíduos em `WisePayments.tsx` (wrappers de refresh/refetch inline remanescentes).

### Escopo entregue nesta rodada (continuação 143 - 08/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco em ações residuais de workspace/tabs:
  - novo hook `apps/frontend-service/src/components/trading/useTradingWorkspaceActionHandlers.ts` criado para isolar:
    - `handleMarketTypeChange`
    - `handleOpenRiskConfigDialog` e `handleCancelRiskConfigDialog`
    - `handleOpenOcoOrderDialog` e `handleCloseReviewOrderDialog`
    - `handleRefreshPositions`, `handleRefreshKlines`, `handleRefreshAccount`, `handleRefreshPostmortems`
    - `handleRunAutoNow`
    - `handleDeleteAllMineHistory`, `handleDeleteAllTenantHistory`, `handleDeleteSelectedHistory`, `handleFetchOrderHistory`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o hook extraído e remover wrappers inline equivalentes em `TradingOperationalAlerts`, `TradingHeaderSection`, `TradingPrimaryTabsSection`, `TradingOperationalTabsSection` e `TradingDialogsSection`
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar o novo hook
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
- Continuidade da decomposição incremental de `WisePayments` com foco em refresh/refetch residual:
  - `apps/frontend-service/src/pages/wise-payments/use-wise-refresh-actions.ts` expandido para expor handlers dedicados:
    - `handleRefreshAccountDetails`
    - `handleRefreshAccountDetailsOrders`
    - `handleRefreshProfiles`
    - `handleRefreshWiseUserMe`
    - `handleRefreshCards`
    - `handleRefreshCardOrders`
    - `handleRefreshSpendControls`
    - `handleRefreshDisputes`
    - `handleRefreshKycReviews`
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir os handlers extraídos e remover wrappers inline equivalentes
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 143)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 143)
- Retomar resíduos finais de maior impacto em `Trading.tsx` (extração dos wrappers de autenticação/fallback e redução adicional do container).
- Em seguida consolidar fechamento formal do P2 com nova varredura de wrappers residuais em `WisePayments.tsx` e confirmação de ausência de callbacks inline de refetch.

### Escopo entregue nesta rodada (continuação 144 - 08/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco em wrappers de autenticação/fallback:
  - novo componente `apps/frontend-service/src/components/trading/TradingAccessStates.tsx` criado para isolar:
    - `TradingLoadingScreen`
    - `TradingAuthRequiredScreen`
    - `TradingForbiddenScreen`
    - `resolveTradingLoadingMessage`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir os componentes extraídos no wrapper de autenticação/permissão, removendo markup duplicado de loading/auth/forbidden
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar o novo módulo
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 144)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 144)
- Retomar resíduos finais de maior impacto em `Trading.tsx` e `WisePayments.tsx` com foco em redução adicional de densidade de composição do container.
- Em seguida executar varredura final de P2 para confirmação de fechamento dos blocos de frontend enterprise workspace.

### Escopo entregue nesta rodada (continuação 145 - 08/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com foco em shell e estados de serviço:
  - novo componente `apps/frontend-service/src/pages/wise-payments/components/wise-payments-tabs-shell.tsx` criado para isolar:
    - shell de navegação de tabs (`Tabs + WorkspaceFilterBar + TabsList/TabsTrigger`)
    - mapeamento visual de tabs com `icon/label/testId`
  - novo componente `apps/frontend-service/src/pages/wise-payments/components/wise-payments-status-states.tsx` criado para isolar:
    - `WisePaymentsLoadingState`
    - `WisePaymentsNotConfiguredState`
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir os componentes extraídos:
    - substituição de markup inline de loading/not configured
    - substituição do bloco inline de shell de navegação por `WisePaymentsTabsShell`
    - tipagem de callback de workspace (`handleWiseWorkspaceSelectionChange`) mantendo compatibilidade de tipos
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 145)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 145)
- Retomar resíduos finais de maior impacto em `Trading.tsx` com foco em extração da composição residual de estados de serviço/guards do container principal.
- Em seguida executar varredura final conjunta (`Trading` + `WisePayments`) para consolidar fechamento de pendências P2 de frontend workspaces.

### Escopo entregue nesta rodada (continuação 146 - 08/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco em estados residuais de serviço no `TradingContent`:
  - novo componente `apps/frontend-service/src/components/trading/TradingServiceStates.tsx` criado para isolar:
    - `TradingContentLoadingState`
    - `TradingStatusErrorState`
    - `TradingStatusUnavailableState`
    - `TradingNotConfiguredState`
    - `TradingTenantRequiredState`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir os estados extraídos:
    - substituição de markup inline de loading/error/unavailable/not-configured/tenant-required
    - remoção de imports locais residuais de UI/ícones usados apenas nesses estados
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar o novo módulo
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 146)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 146)
- Retomar resíduos finais de maior impacto em `Trading.tsx` com foco em desacoplamento de composição de props/tabs para reduzir densidade final da page container.
- Em seguida executar varredura final conjunta (`Trading` + `WisePayments`) para confirmação de fechamento das pendências P2 de frontend workspaces.

### Escopo entregue nesta rodada (continuação 147 - 08/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco em cálculos derivados residuais:
  - novo utilitário `apps/frontend-service/src/components/trading/TradingDerivedMetrics.ts` criado para isolar:
    - `resolveTradingOpenPositionsCount`
    - `buildTradingAccountSummaries`
    - `resolveTradingPriceChange`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir os utilitários extraídos:
    - substituição dos cálculos inline de contagem de posições abertas
    - substituição dos cálculos inline de resumos de conta (`futures/spot/margin`)
    - substituição dos cálculos inline de variação de preço
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar o novo módulo
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 147)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 147)
- Retomar resíduos finais de maior impacto em `Trading.tsx` com foco em desacoplamento da composição de `props` para seções de tabs/dialogs.
- Em seguida executar varredura final conjunta (`Trading` + `WisePayments`) para fechamento das pendências P2 de frontend workspaces.

### Escopo entregue nesta rodada (continuação 148 - 09/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco em composição residual de `props` no trecho de render:
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para centralizar composição em objetos nomeados:
    - `primaryTabsSectionProps`
    - `operationalTabsSectionProps`
    - `dialogsSectionProps`
  - consumo de seções padronizado para spread tipado:
    - `<TradingPrimaryTabsSection {...primaryTabsSectionProps} />`
    - `<TradingOperationalTabsSection {...operationalTabsSectionProps} />`
    - `<TradingDialogsSection {...dialogsSectionProps} />`
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 148)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 148)
- Retomar resíduos finais de maior impacto em `Trading.tsx` com foco em extração dos blocos residuais de mutações de controle/ordens ainda acoplados ao container.
- Em seguida avançar revisão final de composição de queries/filtros em `WisePayments.tsx` para fechamento das pendências P2 remanescentes.

### Escopo entregue nesta rodada (continuação 149 - 09/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco em mutações/handlers residuais de controle e ordens:
  - novo hook `apps/frontend-service/src/components/trading/useTradingControlOrderActionSuite.ts` criado para compor:
    - `useTradingControlOrderMutations`
    - `useTradingReviewOrderHandlers`
    - `useTradingMutationActionHandlers`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para consumir o hook composto (`useTradingControlOrderActionSuite`) e remover orquestração inline duplicada de:
    - mutações de controle/ordens (`approve/cancel/reject/sync/update/create`)
    - handlers de review (`approve/save adjustments/update field`)
    - handlers de ação por id e navegação auxiliar (`open analysis/lab/signals`)
  - `apps/frontend-service/src/components/trading/index.ts` atualizado com reexport do novo hook de composição
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural no composition root
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 149)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 149)
- Avançar revisão final de composição de queries/filtros em `WisePayments.tsx` (resíduos de `profileFilter/workspace` e callbacks de composição) para reduzir densidade restante do container.
- Em seguida executar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para confirmar pendências remanescentes até o plano atingir 100%.

### Escopo entregue nesta rodada (continuação 150 - 09/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com foco em composição residual de navegação/filtros:
  - novo hook `apps/frontend-service/src/pages/wise-payments/use-wise-navigation-presentation.ts` criado para isolar:
    - `wiseWorkspaceOptions`
    - `wiseTabOptions`
    - `handleWiseWorkspaceSelectionChange`
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para consumir o hook extraído e remover composição inline equivalente
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para compartilhar `profileFilter/profiles/setProfileFilter` via `profileScopedTabProps` nas tabs de escopo de perfil:
    - `WiseAccountDetailsTabContent`
    - `WiseCardsTabContent`
    - `WiseCardOrdersTabContent`
    - `WiseCardTransactionsTabContent`
    - `WiseSpendControlsTabContent`
    - `WiseDisputesTabContent`
    - `WiseKycTabContent`
    - `WiseWebhooksTabContent`
    - `WiseSimulationsTabContent`
    - `WiseScaTabContent`
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do container
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 150)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 150)
- Executar varredura final de `WisePayments.tsx` para identificar último residual de alta densidade (composição de props de tabs operacionais).
- Em seguida consolidar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mensurar pendências remanescentes até 100%.

### Escopo entregue nesta rodada (continuação 151 - 09/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com foco no último residual de alta densidade na renderização das tabs operacionais de perfil:
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para centralizar composição de props em objetos nomeados:
    - `accountDetailsTabProps`
    - `cardsTabProps`
    - `cardOrdersTabProps`
    - `cardTransactionsTabProps`
    - `spendControlsTabProps`
    - `disputesTabProps`
    - `kycTabProps`
    - `webhooksTabProps`
    - `simulationsTabProps`
    - `scaTabProps`
  - consumo das tabs operacionais padronizado via spread tipado:
    - `<WiseAccountDetailsTabContent {...accountDetailsTabProps} />`
    - `<WiseCardsTabContent {...cardsTabProps} />`
    - `<WiseCardOrdersTabContent {...cardOrdersTabProps} />`
    - `<WiseCardTransactionsTabContent {...cardTransactionsTabProps} />`
    - `<WiseSpendControlsTabContent {...spendControlsTabProps} />`
    - `<WiseDisputesTabContent {...disputesTabProps} />`
    - `<WiseKycTabContent {...kycTabProps} />`
    - `<WiseWebhooksTabContent {...webhooksTabProps} />`
    - `<WiseSimulationsTabContent {...simulationsTabProps} />`
    - `<WiseScaTabContent {...scaTabProps} />`
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de composição de props no container
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 151)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 151)
- Executar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear residuais objetivos restantes antes do fechamento de 100%.
- Priorizar próximo sub-bloco em `Chat` (handlers/scroll/seleção) para reduzir densidade restante do container principal.

### Escopo entregue nesta rodada (continuação 152 - 09/03/2026)
- Continuidade da decomposição incremental de `Chat` com foco em handlers/seleção e duplicação de render de ações:
  - novo componente `apps/frontend-service/src/pages/Chat/components/ChatActionsMenu.tsx` criado para unificar o dropdown de ações de conversa em desktop/mobile:
    - treinamento por conversa
    - toggle de seleção de mensagens
    - envio de mensagens selecionadas para treinamento
    - toggle de diagnóstico de stream
    - exclusão de conversa atual
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para consumir `ChatActionsMenu` no desktop e mobile (`compact`) com um único contrato de props (`chatActionsMenuProps`)
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para centralizar handlers nomeados:
    - `handleQuickReply`
    - `handleOpenMobileDrawer`
    - `handleToggleSidebar`
    - `handleToggleSelectionMode`
    - `handleToggleStreamDiagnostics`
    - `handleDeleteCurrentConversation`
    - `handleLoadMoreConversations`
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para compartilhar `conversationsListProps` entre sidebar fixa e drawer mobile, removendo duplicação de props/handlers da `ConversationsList`
  - `apps/frontend-service/src/pages/Chat/components/index.ts` atualizado para reexportar `ChatActionsMenu`
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 152)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 152)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear o último residual de alto impacto no frontend workspaces.
- Priorizar próximo sub-bloco em `Trading` para redução adicional de handlers residuais no container principal.

### Escopo entregue nesta rodada (continuação 153 - 09/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com foco na composição residual de props das tabs operacionais não-perfil:
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para centralizar composição de props em objetos nomeados:
    - `balancesTabProps`
    - `exchangeTabProps`
    - `transfersTabProps`
    - `recipientsTabProps`
    - `quotesTabProps`
    - `batchTabProps`
    - `statementsTabProps`
    - `profilesTabProps`
    - `usersTabProps`
    - `activitiesTabProps`
    - `spendLimitsTabProps`
    - `catalogTabProps`
  - consumo das tabs operacionais padronizado via spread tipado:
    - `<WiseBalancesTabContent {...balancesTabProps} />`
    - `<WiseExchangeTabContent {...exchangeTabProps} />`
    - `<WiseTransfersTabContent {...transfersTabProps} />`
    - `<WiseRecipientsTabContent {...recipientsTabProps} />`
    - `<WiseQuotesTabContent {...quotesTabProps} />`
    - `<WiseBatchTabContent {...batchTabProps} />`
    - `<WiseStatementsTabContent {...statementsTabProps} />`
    - `<WiseProfilesTabContent {...profilesTabProps} />`
    - `<WiseUsersTabContent {...usersTabProps} />`
    - `<WiseActivitiesTabContent {...activitiesTabProps} />`
    - `<WiseSpendLimitsTabContent {...spendLimitsTabProps} />`
    - `<WiseCatalogTabContent {...catalogTabProps} />`
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do container
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 153)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 153)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear os residuais objetivos finais até 100%.
- Priorizar próximo sub-bloco de maior impacto em `Trading.tsx` (handlers residuais ainda acoplados ao container principal).

### Escopo entregue nesta rodada (continuação 154 - 09/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco em seções residuais ainda acopladas ao trecho principal de render:
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para centralizar composição de props em objetos nomeados:
    - `operationalAlertsSectionProps`
    - `headerSectionProps`
    - `statsPrimarySectionProps`
    - `statsSecondarySectionProps`
    - `tabsShellSectionProps`
  - consumo das seções padronizado via spread tipado:
    - `<TradingOperationalAlerts {...operationalAlertsSectionProps} />`
    - `<TradingHeaderSection {...headerSectionProps} />`
    - `<TradingStatsPrimaryRow {...statsPrimarySectionProps} />`
    - `<TradingStatsSecondaryRow {...statsSecondarySectionProps} />`
    - `<TradingTabsShell {...tabsShellSectionProps}>`
  - renderers compartilhados de badge centralizados como callbacks reutilizáveis:
    - `renderOrderStatusBadge`
    - `renderSignalTypeBadge`
  - renderers reutilizados em `orders`, `overview`, `signals` e `history`, removendo lambdas duplicadas no container
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 154)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 154)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mensurar pendências objetivas finais antes do fechamento de 100%.
- Priorizar próximo residual de maior impacto em `Trading.tsx` (orquestração restante de handlers/memoizações ainda densas no container).

### Escopo entregue nesta rodada (continuação 155 - 09/03/2026)
- Continuidade da decomposição incremental de `Chat` com foco em governança duplicada entre desktop e mobile:
  - novo componente `apps/frontend-service/src/pages/Chat/components/ChatGovernanceControls.tsx` criado para centralizar:
    - aprovação de política de confirmação (`approval policy`)
    - modo de roteamento (`auto` / `manual`)
    - badge de origem/debug de roteamento
    - seleção manual de agentes via `MultiSelectDropdown`
  - suporte a duas variantes de layout sem duplicação de lógica:
    - padrão (desktop)
    - `compact` (mobile)
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para consumir:
    - `<ChatGovernanceControls {...chatGovernanceControlsProps} />`
    - `<ChatGovernanceControls compact {...chatGovernanceControlsProps} />`
  - `chatGovernanceControlsProps` centralizado no container para remover duplicação de markup/handlers de governança
  - `apps/frontend-service/src/pages/Chat/components/index.ts` atualizado com reexport de `ChatGovernanceControls`
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de apresentação/handlers no header do chat
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 155)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 155)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear residuais objetivos finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `Trading.tsx` (handlers/memoizações ainda acoplados ao composition root).

### Escopo entregue nesta rodada (continuação 156 - 09/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco em memoizações residuais de opções ainda inline no `primaryTabsSectionProps`:
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para centralizar mapeamentos de opções em memoizações dedicadas:
    - `autoModeOptions`
    - `signalIndicatorOptions`
    - `signalIntervalOptions`
    - `signalTechniqueOptions`
  - `signalsAutoTabProps` passou a consumir `autoModeOptions` (removendo `.map` inline de `AUTO_SIGNAL_MODE_OPTIONS`)
  - `signalsTabProps` passou a consumir:
    - `signalIndicatorOptions`
    - `signalIntervalOptions`
    - `signalTechniqueOptions`
  - removidos mapeamentos inline residuais de opções no `primaryTabsSectionProps`, mantendo o mesmo contrato e comportamento
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural/memoização no composition root
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 156)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 156)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear residuais objetivos finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `Trading.tsx` (composição restante de props/hook orchestration ainda densa no container).

### Escopo entregue nesta rodada (continuação 157 - 09/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco na densidade de composição dos blocos de tabs/dialogs:
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para separar props nomeados por aba/seção antes da montagem agregada:
    - `analysisTabProps`, `labTabProps`, `ordersTabProps`, `overviewTabProps`, `portfolioAutoTabProps`, `positionsTabProps`, `signalsAutoTabProps`, `signalsTabProps`
    - `accountTabProps`, `chartTabProps`, `controlTabProps`, `historyTabProps`, `orderBookTabProps`, `postMortemsTabProps`
    - `newOrderDialogProps`, `ocoOrderDialogProps`, `reviewOrderDialogProps`, `riskConfigDialogProps`, `postmortemTrainingDialogProps`, `newSignalDialogProps`
  - objetos agregadores preservados com o mesmo contrato:
    - `primaryTabsSectionProps`
    - `operationalTabsSectionProps`
    - `dialogsSectionProps`
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de composição no composition root
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 157)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 157)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear residuais objetivos finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `Trading.tsx` (extração incremental de orchestration de queries/handlers ainda densa no container).

### Escopo entregue nesta rodada (continuação 158 - 09/03/2026)
- Continuidade da decomposição incremental de `Chat` com foco no residual de diálogos operacionais ainda inline no container:
  - novo componente `apps/frontend-service/src/pages/Chat/components/ChatDialogsSection.tsx` integrado ao fluxo principal para centralizar:
    - diálogo de envio para treinamento (conversa/mensagens selecionadas)
    - confirmação de exclusão da conversa atual
    - confirmação de exclusão de conversas selecionadas
    - confirmação de exclusão total
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para:
    - remover blocos inline de `Dialog`/`AlertDialog`
    - centralizar handlers nomeados (`handleTrainingDialogOpenChange`, `handleSubmitTraining`, `handleDeleteTargetOpenChange`)
    - compor `chatDialogsSectionProps` e consumir `<ChatDialogsSection {...chatDialogsSectionProps} />`
  - `apps/frontend-service/src/pages/Chat/components/index.ts` atualizado com reexport de `ChatDialogsSection`
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de apresentação/handlers no composition root
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 158)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 158)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `Trading.tsx` (orquestração restante de mutações de controle/ordens ainda acoplada ao container), seguido de fechamento de composição residual de queries/filtros em `WisePayments.tsx`.

### Escopo entregue nesta rodada (continuação 159 - 09/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco no residual de queries centrais ainda acopladas ao container:
  - novo hook `apps/frontend-service/src/components/trading/useTradingMarketAccountQueries.ts` criado para centralizar:
    - query e refetch de market (`/api/integrations/trading/market/:symbol`)
    - query e refetch de account (`/api/integrations/trading/account`)
    - query e refetch de positions (`/api/integrations/trading/positions`)
    - query e refetch de orders (`/api/integrations/trading/orders`)
    - governança de `marketQueryString`/`ordersQueryString` por `marketType/marginMode`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para:
    - consumir `useTradingMarketAccountQueries` como boundary único das queries acima
    - remover blocos inline equivalentes de `useQuery` e builders de querystring
    - manter reaproveitamento de `marketQueryString` em klines/orderbook sem alterar comportamento
  - `apps/frontend-service/src/components/trading/index.ts` atualizado com reexport do novo hook
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 159)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 159)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `WisePayments.tsx` (composição residual de queries/filtros e boundary de props ainda no container), seguido de novo ciclo de redução no `Trading.tsx`.

### Escopo entregue nesta rodada (continuação 160 - 09/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco no residual de signals/scheduler ainda acoplado ao container:
  - novo hook `apps/frontend-service/src/components/trading/useTradingSignalSchedulerQueries.ts` criado para centralizar:
    - query de sinais (`/api/integrations/trading/signals`) com polling configurável
    - query de scheduler (`/api/integrations/trading/signal-scheduler`)
    - reconciliação de `selectedSignalId` com lista de sinais atual
    - seleção derivada de `selectedSignal` e composição de `schedulerConfig`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para:
    - consumir `useTradingSignalSchedulerQueries` como boundary único de sinais/scheduler
    - remover blocos inline equivalentes de `useQuery` + `useEffect`/`useMemo` para seleção/configuração
    - manter o fluxo de `setSchedulerForm(createSchedulerFormFromConfig(...))` sem alteração de comportamento
  - `apps/frontend-service/src/components/trading/index.ts` atualizado com reexport do novo hook
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 160)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 160)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `WisePayments.tsx` (composição residual de queries/filtros e boundary de props ainda no container), seguido de novo ciclo de redução no `Trading.tsx`.

### Escopo entregue nesta rodada (continuação 161 - 09/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com foco no residual de apresentação das tabs ainda inline no container:
  - novo componente `apps/frontend-service/src/pages/wise-payments/components/wise-payments-tabs-content.tsx` criado para centralizar o render de todas as tabs operacionais
  - tipagem explícita do contrato de cada aba via `ComponentProps<typeof TabContent>` no novo componente
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para:
    - remover render inline de todas as tabs dentro do `WisePaymentsTabsShell`
    - consumir `<WisePaymentsTabsContent ... />` com props nomeados já compostos no container
    - reduzir imports de apresentação direta das tabs no composition root
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural da camada de apresentação
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 161)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 161)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `WisePayments.tsx` (composição residual de queries/filtros e boundary de props ainda no container), seguido de novo ciclo de redução no `Trading.tsx`.

### Escopo entregue nesta rodada (continuação 162 - 09/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco no residual de queries de post-mortem/training ainda inline no container:
  - novo hook `apps/frontend-service/src/components/trading/useTradingPostmortemTrainingQueries.ts` criado para centralizar:
    - query de post-mortems reais (`/api/integrations/postmortem?isDemo=false`)
    - query de namespaces ativos (`/api/namespaces`)
    - query de rastreio de datasets já enviados para treinamento (`/api/integrations/trading/datasets?limit=200`)
    - derivação de `postmortemIdsSentToTraining` via `Set`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para:
    - consumir `useTradingPostmortemTrainingQueries` como boundary único desse domínio
    - remover queries inline equivalentes e composição local duplicada
  - `apps/frontend-service/src/components/trading/index.ts` atualizado com reexport do novo hook
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 162)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 162)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `WisePayments.tsx` (composição residual de queries/filtros e boundary de props ainda no container), seguido de novo ciclo de redução no `Trading.tsx`.

### Escopo entregue nesta rodada (continuação 163 - 09/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco no residual de queries operacionais ainda inline no container:
  - novo hook `apps/frontend-service/src/components/trading/useTradingOperationalQueries.ts` criado para centralizar:
    - query de status do WebSocket (`/api/integrations/trading/ws/status`)
    - query de configuração de risco (`/api/integrations/trading/risk-config`)
    - query de histórico de controle/handover (`/api/integrations/trading/control-history`)
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para:
    - consumir `useTradingOperationalQueries` como boundary único desse domínio
    - remover blocos inline equivalentes de `useQuery` para ws/risk/control
  - `apps/frontend-service/src/components/trading/index.ts` atualizado com reexport do novo hook
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 163)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 163)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `WisePayments.tsx` (composição residual de queries/filtros e boundary de props ainda no container), seguido de novo ciclo de redução no `Trading.tsx`.

### Escopo entregue nesta rodada (continuação 164 - 09/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco no residual de queries de setup/automação ainda inline no container:
  - novo hook `apps/frontend-service/src/components/trading/useTradingSetupQueries.ts` criado para centralizar:
    - query de status (`/api/integrations/trading/status`)
    - queries de portfolio/candidates/rebalances (`/api/trading/portfolios`, `/api/trading/candidates`, `/api/trading/rebalances`)
    - queries de auto-runs (`/api/trading/auto/runs` e detalhe de run ativo)
    - query de intervals (`/api/integrations/trading/intervals`)
    - query de signal profile (`/api/integrations/trading/analysis-profile?kind=signal`)
    - query de arbitrage catalog (`/api/integrations/trading/arbitrage/catalog`)
    - derivação de `statusIsConfigured` e `statusRequiresTenant` para encadeamento downstream
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para:
    - consumir `useTradingSetupQueries` como boundary único de bootstrap
    - remover blocos inline equivalentes de `useQuery` para setup/automação
    - reaproveitar `statusIsConfigured/statusRequiresTenant` nos hooks de market/scheduler/postmortem/operational
  - `apps/frontend-service/src/components/trading/index.ts` atualizado com reexport do novo hook
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 164)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 164)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `WisePayments.tsx` (composição residual de queries/filtros e boundary de props ainda no container), seguido de novo ciclo de redução no `Trading.tsx` (queries residuais de symbols/assets/orderbook/klines/permissões).

### Escopo entregue nesta rodada (continuação 165 - 09/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco no residual de queries de símbolos/assets ainda inline no container:
  - novo hook `apps/frontend-service/src/components/trading/useTradingSymbolAssetQueries.ts` criado para centralizar:
    - query de símbolos por market/margin (`/api/integrations/trading/symbols`)
    - query de catálogo de assets automáticos (`/api/trading/auto/assets`)
    - derivações de símbolos (`availableSymbols`, `favoriteSymbols`, `featuredSymbols`)
    - derivações de assets automáticos (`autoSignalAssetMap`, `autoSignalAssetOptions`)
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para:
    - consumir `useTradingSymbolAssetQueries` como boundary único de símbolos/assets
    - remover blocos inline equivalentes de `useQuery` e memoizações locais de assets
    - reaproveitar `statusIsConfigured/statusRequiresTenant` no gating de WS e queries downstream
  - `apps/frontend-service/src/components/trading/index.ts` atualizado com reexport do novo hook
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 165)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 165)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `WisePayments.tsx` (composição residual de queries/filtros e boundary de props ainda no container), seguido de novo ciclo de redução no `Trading.tsx` (queries residuais de orderbook/klines/permissões).

### Escopo entregue nesta rodada (continuação 166 - 09/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco nos últimos `useQuery` inline do container/wrapper:
  - novo hook `apps/frontend-service/src/components/trading/useTradingMarketRealtimeQueries.ts` criado para centralizar:
    - query de klines (`/api/integrations/trading/klines/:symbol`)
    - query de orderbook (`/api/integrations/trading/orderbook/:symbol`)
    - contratos de loading/error/refetch do bloco realtime
  - novo hook `apps/frontend-service/src/components/trading/useTradingPermissionsQuery.ts` criado para centralizar:
    - query RBAC de permissões (`/api/auth/rbac/permissions`) no wrapper `Trading`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para:
    - consumir `useTradingMarketRealtimeQueries` e remover blocos inline de `useQuery` para klines/orderbook
    - consumir `useTradingPermissionsQuery` no wrapper e remover `useQuery` inline de permissões
    - operar sem `useQuery` inline, mantendo `Trading.tsx` mais estritamente como composition root
  - `apps/frontend-service/src/components/trading/index.ts` atualizado com reexports dos novos hooks
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 166)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 166)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `WisePayments.tsx` (composição residual de queries/filtros e boundary de props ainda no container), seguido de novo ciclo de redução no `Trading.tsx` (residuais de composição de props/handlers não-query).

### Escopo entregue nesta rodada (continuação 167 - 09/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com foco no residual de assembly de props ainda distribuído no container:
  - novo hook `apps/frontend-service/src/pages/wise-payments/use-wise-tab-props.ts` criado para centralizar a composição tipada de contratos de tabs.
  - `apps/frontend-service/src/pages/wise-payments/components/wise-payments-tabs-content.tsx` atualizado para exportar `WisePaymentsTabsContentProps`, permitindo consumo tipado único do contrato de apresentação.
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para:
    - agrupar domínio em bundles nomeados (`dataQueries`, `referenceActions`, `refreshActions`, `derivedData`, etc.).
    - delegar o assembly final para `tabsContentProps` via `useWiseTabProps`.
    - reduzir densidade do composition root sem alterar payloads, contratos de API ou RBAC.
  - correção de wiring do novo hook para handlers de upload (`handleDisputeFileChange`, `handleKycDocumentChange`) usando `fileUploadState` como fonte canônica.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 167)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 167)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `Trading.tsx` (mutações/handlers residuais de controle e ordens ainda acoplados no container), seguido por novo ciclo de simplificação em `WisePayments.tsx` e fechamento de resíduos de `Chat` (scroll/seleção/handlers de alto acoplamento).

### Escopo entregue nesta rodada (continuação 168 - 09/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco no residual de efeitos de perfil de sinais ainda inline no container:
  - novo hook `apps/frontend-service/src/components/trading/useTradingSignalProfileAutoSave.ts` criado para centralizar:
    - hidratação de `signalProfileResponse` com normalização de `newsConfig` e defaults de `techniques`/`ensembleConfig`.
    - controle de auto-save debounced do payload de signal profile com proteção de completude (`timeframes/indicators/techniques`) e deduplicação por snapshot.
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para:
    - consumir `useTradingSignalProfileAutoSave` como boundary único para sincronização + persistência automática de signal profile.
    - remover efeitos inline equivalentes de hidratação e auto-save.
  - `apps/frontend-service/src/components/trading/index.ts` atualizado com reexport do novo hook.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 168)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 168)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `Trading.tsx` (sincronização de risco/review dialog e handlers de interação ainda no container), seguido por novo ciclo de simplificação em `Chat/index.tsx` (scroll/seleção/handlers residuais).

### Escopo entregue nesta rodada (continuação 169 - 09/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco no residual de sincronização de risco/review ainda inline no container:
  - novo hook `apps/frontend-service/src/components/trading/useTradingRiskReviewState.ts` criado para centralizar:
    - hidratação de `riskConfig` no `riskForm` com reset consistente de `controlMode`.
    - aplicação inicial de defaults de `marketType`/`marginMode` uma única vez por bootstrap.
    - callback `openReviewDialog` com derivação de `reviewOrderForm` e abertura do diálogo de revisão.
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para:
    - consumir `useTradingRiskReviewState` como boundary único para sincronização de risco/review.
    - remover `useEffect` e callback inline equivalentes.
  - `apps/frontend-service/src/components/trading/index.ts` atualizado com reexport do novo hook.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 169)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 169)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `Trading.tsx` (efeitos/handlers de interação e sync residual de status/market no container), seguido de fechamento de resíduos em `Chat/index.tsx` (scroll/seleção/handlers).

### Escopo entregue nesta rodada (continuação 170 - 09/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco no residual de derivação de market/orderbook e invalidação de klines ainda inline no container:
  - novo hook `apps/frontend-service/src/components/trading/useTradingMarketOrderBookState.ts` criado para centralizar:
    - invalidação de klines por mudança de contexto (`symbol/interval/market/margin`) quando trading está configurado.
    - derivação de `market`, `normalizedSymbol`, `orderBookData` (WS prioritário + fallback REST) e `orderBookPrecision`.
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para:
    - consumir `useTradingMarketOrderBookState` como boundary único desse domínio.
    - remover `useEffect` e bloco inline equivalentes de derivação/invalidação.
  - `apps/frontend-service/src/components/trading/index.ts` atualizado com reexport do novo hook.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 170)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 170)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `Trading.tsx` (efeitos/handlers de interação ainda no container) e, na sequência, fechamento de resíduos em `Chat/index.tsx` (scroll/seleção/handlers).

### Escopo entregue nesta rodada (continuação 171 - 09/03/2026)
- Continuidade da decomposição incremental de `Chat` com foco no residual de handlers de interação de UI ainda inline no container:
  - novo hook `apps/frontend-service/src/pages/Chat/useChatUiInteractionHandlers.ts` criado para centralizar:
    - abertura/alternância de drawer e sidebar.
    - carregamento incremental de conversas.
    - toggle de seleção de mensagens e diagnóstico de stream.
    - fluxo de exclusão atual + fechamento de diálogo.
    - fluxo de abertura/submissão do treinamento (conversation/messages) com validação de namespace.
    - quick-reply com guardrails de autenticação/streaming.
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para:
    - consumir `useChatUiInteractionHandlers` como boundary único desse domínio de UI.
    - remover callbacks inline equivalentes.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 171)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 171)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `Trading.tsx` (efeitos/handlers de interação restantes no container), seguido de fechamento de resíduos em `Chat/index.tsx` (scroll/seleção/estado derivado residual).

### Escopo entregue nesta rodada (continuação 172 - 09/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco no residual de composição da série de klines ainda inline no container:
  - novo hook `apps/frontend-service/src/components/trading/useTradingKlineSeriesState.ts` criado para centralizar:
    - composição da série de candles com prioridade para dados WS (`wsKlinesForChart`) e fallback para REST (`klinesData`).
    - reset de continuidade visual apenas quando o contexto estrutural muda (`symbol/market/margin`), preservando UX em troca de intervalo.
    - deduplicação de atualização por assinatura (`source + symbol + interval + market + margin + length + last.time`) para evitar `setState` redundante.
    - fallback final para `lastKlines` quando WS/REST ainda não retornaram novos dados.
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para:
    - consumir `useTradingKlineSeriesState` como boundary único da série de klines.
    - remover estado/refs/efeitos inline equivalentes (`lastKlines`, `lastKlinesSignatureRef`, `wsKlinesForChart` e `useEffect`s relacionados).
  - `apps/frontend-service/src/components/trading/index.ts` atualizado com reexport do novo hook.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 172)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 172)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `Trading.tsx` (mutações de controle/ordens e handlers de interação ainda acoplados no container), seguido do fechamento residual de composição de queries/filtros em `WisePayments.tsx` e dos resíduos finais de `Chat/index.tsx` (scroll/seleção/estado derivado).

### Escopo entregue nesta rodada (continuação 173 - 09/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco no residual de bootstrap/sincronização de estado ainda inline no container:
  - novo hook `apps/frontend-service/src/components/trading/useTradingBootstrapStateSync.ts` criado para centralizar:
    - default de `selectedPortfolioAutoId` com base em `tradingPortfolios`.
    - sincronização de `feePct` efetiva de arbitragem a partir do catálogo (`signalArbitrageCatalogResponse`).
    - normalização de `autoSelectedAssetKeys` contra `autoSignalAssetMap`.
    - enforcement de `autoMix` (forçando `autoUniverseScope=all`, `autoSelectAllAssets=true` e `allowedModes=AUTO_SIGNAL_ALL_MODES`).
    - fallback de `selectedSymbol` + `symbolReady` com prioridade em `symbolsData.defaultSymbol`, depois `statusData.defaultSymbol`, depois primeiro símbolo válido.
    - fallback de `selectedInterval` para default/lista de intervalos disponível.
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para:
    - consumir `useTradingBootstrapStateSync` como boundary único de sincronização de bootstrap.
    - remover seis `useEffect`s inline equivalentes do container.
  - `apps/frontend-service/src/components/trading/index.ts` atualizado com reexport do novo hook.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 173)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 173)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `Trading.tsx` (composição de props/estado derivado ainda densa no container), seguido de fechamento residual em `Chat/index.tsx` (scroll/seleção/estado derivado) e varredura final de `WisePayments.tsx`.

### Escopo entregue nesta rodada (continuação 174 - 09/03/2026)
- Continuidade da decomposição incremental de `Chat` com foco no residual de sincronização de mensagens/pendências ainda inline no container:
  - novo hook `apps/frontend-service/src/pages/Chat/useChatMessageSyncEffects.ts` criado para centralizar:
    - sincronização de mensagens carregadas (`conversationMessages`) para estado local com normalização (`normalizeServerMessage`) e guard por `conversationMessagesUpdatedAt`.
    - flush de `pendingSendRef` quando streaming encerra, disparando envio pendente em ordem e limpando o buffer.
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para:
    - consumir `useChatMessageSyncEffects` como boundary único desse domínio de sincronização.
    - remover dois `useEffect`s inline equivalentes do container.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 174)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 174)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `Trading.tsx` (composição de props/estado derivado ainda densa no container), seguido de fechamento residual em `Chat/index.tsx` (workspaces/estado derivado de apresentação) e varredura final de `WisePayments.tsx`.

### Escopo entregue nesta rodada (continuação 175 - 09/03/2026)
- Continuidade da decomposição incremental de `Chat` com foco no residual de estado derivado de apresentação/workspaces ainda inline no container:
  - novo hook `apps/frontend-service/src/pages/Chat/useChatWorkspacePresentation.ts` criado para centralizar:
    - resolução de `modelBadgeLabel` por versão (`versionData` + `appVersion`).
    - normalização de `approvalPolicyForSelect` + `approvalPolicyOptions`.
    - flags de visibilidade de controles por workspace (`showGovernanceControls`, `showOperationsControls`, `showDiagnosticsControls`, `showDesktopActionMenu`, `showConversationWorkspaceHint`).
    - `workspaceHint` por contexto (`conversation/operations/governance/diagnostics`).
    - mapeamento de `agentOptions` para seleção de roteamento.
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para:
    - consumir `useChatWorkspacePresentation` como boundary único desse domínio de apresentação.
    - remover blocos inline equivalentes de `useMemo` e derivações de UI.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 175)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 175)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `Trading.tsx` (composição de props/estado derivado ainda densa no container), seguido de varredura final de `WisePayments.tsx` e fechamento dos últimos resíduos de composição em `Chat/index.tsx`.

### Escopo entregue nesta rodada (continuação 176 - 09/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco no residual de estado derivado de apresentação de sinais/mercado ainda inline no container:
  - novo hook `apps/frontend-service/src/components/trading/useTradingSignalPresentationState.ts` criado para centralizar:
    - opções de intervalos de chart/sinais (`intervalOptions`, `signalIntervalOptions`).
    - fontes de sinais e seleção ativa (`signalSourceOptions`, `selectedSignalSources`).
    - catálogo derivado de arbitragem (`availableSignalArbitrageExchanges`, `availableSignalArbitrageAssets`).
    - validação de timeframes incompatíveis com arbitragem e mensagem de erro derivada (`isSignalArbitrageInvalid`, `signalArbitrageErrorMessage`).
    - derivação de `wsInterval`, `granularityValue`, `wsOrderBookDepth` e `restOrderBookDepth`.
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para:
    - consumir `useTradingSignalPresentationState` como boundary único desse domínio de apresentação.
    - remover blocos inline equivalentes de `useMemo`/derivação.
  - `apps/frontend-service/src/components/trading/index.ts` atualizado com reexport do novo hook.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 176)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 176)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `Trading.tsx` (composição de props por seções ainda densa), seguido de varredura final de `WisePayments.tsx` e fechamento residual de `Chat/index.tsx`.

### Escopo entregue nesta rodada (continuação 177 - 09/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco no residual de coleções derivadas de símbolos/candidatos ainda inline no container:
  - novo hook `apps/frontend-service/src/components/trading/useTradingSymbolCandidateViewState.ts` criado para centralizar:
    - derivação de `symbolOptions` com ordenação por grupos (`featured`, `favorites`, restante alfabético).
    - composição de `symbolSelectItems` agrupados para o seletor de símbolos.
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para:
    - consumir `useTradingSymbolCandidateViewState` como boundary único de derivação de coleções de símbolos.
    - remover blocos inline equivalentes de `useMemo`.
    - manter `topTradingCandidates` no container com ordenação tipada por `expectedEdge` para preservar contrato estrito da aba `portfolio-auto`.
  - `apps/frontend-service/src/components/trading/index.ts` atualizado com reexport do novo hook.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 177)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 177)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `Trading.tsx` (composição de props por seções ainda densa), seguido de varredura final de `WisePayments.tsx` e fechamento residual de `Chat/index.tsx`.

### Escopo entregue nesta rodada (continuação 178 - 09/03/2026)
- Continuidade da decomposição incremental de `Chat` com foco no residual de queries/estado derivado de dados ainda inline no container:
  - novo hook `apps/frontend-service/src/pages/Chat/useChatQueryState.ts` criado para centralizar:
    - query de mensagens da conversa (`/api/chat/conversations/:id/messages`).
    - query de approval policy (`/api/chat/conversations/:id/approval-policy`).
    - query de versão (`/api/chat/version`) e assistant settings (`/api/assistant-settings`), com derivação de `typingSpeedMs`.
    - query de namespaces (`/api/namespaces`) e agentes (`/api/agents`).
    - normalização de `approvalPolicy` com default seguro.
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para:
    - consumir `useChatQueryState` como boundary único de dados para esse domínio.
    - remover blocos inline equivalentes de `useQuery`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 178)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 178)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `Trading.tsx` (composição de props por seções ainda densa), seguido de varredura final de `WisePayments.tsx` e fechamento residual de `Chat/index.tsx`.

### Escopo entregue nesta rodada (continuação 179 - 09/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco no residual de derivação de conta/posições ainda inline no container:
  - novo hook `apps/frontend-service/src/components/trading/useTradingAccountPositionState.ts` criado para centralizar:
    - derivação de contexto de conta por mercado (`isSpotMarket`, `isMarginMarket`, `accountMode`).
    - derivação de posições por mercado (`spotPositions`, `marginCrossPositions`, `marginIsolatedPositions`) e cálculo consolidado de `openPositionsCount`.
    - composição de resumos de conta (`futuresAccountSummary`, `spotAccountSummary`, `marginAccountSummary`) com `buildTradingAccountSummaries`.
    - resolução de `quoteCurrency` e narrowing seguro de `futuresAccount` para consumo em métricas.
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para:
    - consumir `useTradingAccountPositionState` como boundary único de derivação de conta/posições.
    - remover bloco inline equivalente de derivação (`spot/margin account`, `spot/margin positions`, `openPositionsCount` e `account summaries`).
    - simplificar `statsPrimarySectionProps` usando `futuresAccount` narrow tipado no lugar de cast inline.
  - `apps/frontend-service/src/components/trading/index.ts` atualizado com reexport do novo hook.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 179)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 179)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `Trading.tsx` (composição de props por seções ainda densa), seguido de varredura final de `Chat/index.tsx` (scroll/seleção/estado derivado residual) e fechamento formal de `WisePayments.tsx`.

### Escopo entregue nesta rodada (continuação 180 - 09/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco no residual de composição de `props` de abas operacionais e dialogs ainda inline no container:
  - novo módulo `apps/frontend-service/src/components/trading/TradingSectionPropsBuilders.ts` criado para centralizar:
    - `buildTradingOperationalTabsSectionProps`, com composição tipada de `account/chart/control/history/orderbook/postmortems`.
    - `buildTradingDialogsSectionProps`, com composição tipada de `newOrder/oco/review/risk/postmortem-training/new-signal`.
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para:
    - consumir `buildTradingOperationalTabsSectionProps` e remover bloco inline equivalente de `operationalTabsSectionProps`.
    - consumir `buildTradingDialogsSectionProps` e remover bloco inline equivalente de `dialogsSectionProps`.
    - manter os mesmos handlers/mutações/contratos, apenas deslocando assembly de props para boundary dedicado.
  - `apps/frontend-service/src/components/trading/index.ts` atualizado com reexport dos novos builders.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 180)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 180)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `Trading.tsx` (composição das props das abas primárias ainda densa), seguido de fechamento residual de `Chat/index.tsx` (scroll/seleção/estado derivado) e validação final de `WisePayments.tsx`.

### Escopo entregue nesta rodada (continuação 181 - 09/03/2026)
- Continuidade da decomposição incremental de `Chat` com foco no residual de composição de seções ainda inline no container:
  - novo hook `apps/frontend-service/src/pages/Chat/useChatSectionProps.ts` criado para centralizar:
    - `conversationsListProps` com filtros, carregamento incremental, seleção e ações de exclusão.
    - `chatActionsMenuProps` com ações de treinamento, seleção de mensagens e diagnóstico de stream.
    - `chatGovernanceControlsProps` com `approval policy`, `routing mode` e seleção de agentes.
    - `chatDialogsSectionProps` com contratos dos diálogos de treinamento/exclusão e estado derivado de contadores.
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para:
    - consumir `useChatSectionProps` como boundary único de assembly de props das seções.
    - remover blocos inline equivalentes de composição de `conversationsListProps`, `chatActionsMenuProps`, `chatGovernanceControlsProps` e `chatDialogsSectionProps`.
    - manter comportamento/contratos existentes com handlers nomeados (`handleApprovalPolicyChange`, `handleConfirmDeleteTarget`) para composição explícita.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 181)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 181)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `Trading.tsx` (composição das props das abas primárias ainda densa), seguido de fechamento residual de `WisePayments.tsx` (queries/filtros remanescentes de composição) e validação final de resíduos em `Chat/index.tsx` (scroll/seleção).

### Escopo entregue nesta rodada (continuação 182 - 09/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco no residual de composição das abas primárias ainda inline no container:
  - `buildTradingPrimaryTabsSectionProps` adicionado em `apps/frontend-service/src/components/trading/TradingSectionPropsBuilders.ts` para centralizar o assembly tipado de:
    - `analysisTabProps`
    - `labTabProps`
    - `ordersTabProps`
    - `overviewTabProps`
    - `portfolioAutoTabProps`
    - `positionsTabProps`
    - `signalsAutoTabProps`
    - `signalsTabProps`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para:
    - consumir `buildTradingPrimaryTabsSectionProps` como boundary único de composição das abas primárias.
    - remover blocos inline equivalentes de montagem de `props` para as oito abas.
    - preservar contratos e comportamento existente com ajuste explícito de contratos (`onOpenReviewDialog` por objeto para `orders` e `onOpenReviewDialogById` para `overview`, além de `analysisIntervalOptions` e `signalIntervalOptions` separados).
  - `apps/frontend-service/src/components/trading/index.ts` atualizado com reexport de `buildTradingPrimaryTabsSectionProps`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 182)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 182)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `WisePayments.tsx` (queries/filtros remanescentes de composição), seguido de varredura final de resíduos em `Trading.tsx` e `Chat/index.tsx`.

### Escopo entregue nesta rodada (continuação 183 - 09/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco no residual de composição de layout ainda inline no container:
  - `buildTradingLayoutSectionProps` adicionado em `apps/frontend-service/src/components/trading/TradingSectionPropsBuilders.ts` para centralizar o assembly tipado de:
    - `operationalAlertsSectionProps`
    - `headerSectionProps`
    - `statsPrimarySectionProps`
    - `statsSecondarySectionProps`
    - `tabsShellSectionProps`
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para:
    - consumir `buildTradingLayoutSectionProps` como boundary único de composição de seções de layout.
    - remover blocos inline equivalentes de assembly para alertas/header/stats/tabs-shell.
    - manter comportamento e contratos existentes sem alteração de payload/API/RBAC.
  - `apps/frontend-service/src/components/trading/index.ts` atualizado com reexport de `buildTradingLayoutSectionProps`.
  - ajuste de tipagem explícita no builder para `TradingTabsShell` com `Omit<..., 'children'>`, mantendo `children` no JSX do container.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 183)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 183)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `WisePayments.tsx` (composição residual de domínio e filtros por perfil), seguido de varredura final de resíduos de composição em `Chat/index.tsx` e `Trading.tsx`.

### Escopo entregue nesta rodada (continuação 184 - 09/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com foco no residual de orquestração da página ainda inline no container:
  - novo hook `apps/frontend-service/src/pages/wise-payments/use-wise-page-composition.ts` criado para centralizar:
    - estado de navegação/workspace/tabs.
    - queries de dados (`useWiseDataQueries`).
    - suites de ações (`reference`, `recipient`, `card/spend`, `transfer/card`, `webhook/simulation/sca`, `account/card/dispute`, `user/activity`, `balance/exchange/statement`).
    - composição de `derivedData`, `refreshActions` e `tabsContentProps`.
    - sincronização de moeda padrão de spend-control no mesmo boundary de composição.
  - `apps/frontend-service/src/pages/WisePayments.tsx` atualizado para:
    - consumir `useWisePageComposition` como boundary único de composição.
    - remover composição inline equivalente de hooks e bundles transversais.
    - manter o container focado em render/guard de status/configuração e shell de tabs.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 184)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 184)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `Chat/index.tsx` (scroll/seleção e composição de queries de conversas), seguido de varredura final de resíduos em `Trading.tsx`.

### Escopo entregue nesta rodada (continuação 185 - 09/03/2026)
- Continuidade da decomposição incremental de `Chat` com foco no residual de queries de conversas ainda inline no container:
  - novo hook `apps/frontend-service/src/pages/Chat/useChatConversationsQueryState.ts` criado para centralizar:
    - fetch paginado de conversas com cursor (`updatedAt/id`) e filtros de período (`from/to`).
    - estado de paginação/loading via `useInfiniteQuery`.
    - derivação de `conversations` e `activeConversation`.
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para:
    - consumir `useChatConversationsQueryState` como boundary único desse domínio de queries.
    - remover bloco inline equivalente de `fetchConversations + useInfiniteQuery + activeConversation`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 185)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 185)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `Chat/index.tsx` (estado/handlers de scroll e seleção), seguido de varredura final de resíduos em `Trading.tsx`.

### Escopo entregue nesta rodada (continuação 186 - 09/03/2026)
- Continuidade da decomposição incremental de `Chat` com foco no residual de query de mensagens ainda acoplado ao container:
  - `apps/frontend-service/src/pages/Chat/useChatQueryState.ts` atualizado para centralizar também o `queryFn` de mensagens da conversa (`/api/chat/conversations/:id/messages`), mantendo o controle de `enabled` por `conversationId`.
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para:
    - remover o callback inline `fetchConversationMessages`.
    - consumir `useChatQueryState` apenas com `conversationId`.
    - remover import residual de `apiRequest` não mais necessário no container.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 186)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 186)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `Chat/index.tsx` (estado/handlers de scroll e seleção), seguido de varredura final de resíduos em `Trading.tsx` e `WisePayments.tsx`.

### Escopo entregue nesta rodada (continuação 187 - 09/03/2026)
- Continuidade da decomposição incremental de `Chat` com foco no residual de scroll/seleção e render de mensagens ainda inline no container:
  - novo componente `apps/frontend-service/src/pages/Chat/components/ChatMessagesViewport.tsx` criado para centralizar:
    - `ScrollArea` com refs de auto-scroll (`scrollAreaRef`, `messagesContainerRef`, `messagesEndRef`).
    - renderização de mensagens e seleção (`messageSelectionMode`, `selectedMessageIds`, `onToggleMessageSelection`).
    - exibição de hints/banners de workspace/login e fallback de resposta.
    - diagnóstico de stream na última mensagem (`showStreamDiagnostics`, `streamEvents`, `streamStatusLabel`).
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para:
    - consumir `ChatMessagesViewport` como boundary único de render do painel de mensagens.
    - remover bloco inline equivalente de scroll/seleção/banners/diagnóstico.
  - `apps/frontend-service/src/pages/Chat/components/index.ts` atualizado com reexport de `ChatMessagesViewport`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de UI/composição.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 187)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 187)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `Trading.tsx` (mutações/handlers de controle ainda densos), seguido de varredura final em `WisePayments.tsx`.

### Escopo entregue nesta rodada (continuação 188 - 09/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco no residual de layout principal ainda inline no container:
  - novo componente `apps/frontend-service/src/components/trading/TradingPageSections.tsx` criado para centralizar:
    - alertas operacionais;
    - header;
    - linhas de métricas primária/secundária;
    - shell de tabs com `TradingPrimaryTabsSection` + `TradingOperationalTabsSection`;
    - seção de dialogs.
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para:
    - consumir `TradingPageSections` como boundary único de render das seções principais.
    - remover bloco inline equivalente de composição/render.
  - `apps/frontend-service/src/components/trading/index.ts` atualizado com reexport de `TradingPageSections`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 188)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 188)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `Trading.tsx` (composição de props ainda extensa para tabs/dialogs), seguido de varredura final em `Chat/index.tsx`.

### Escopo entregue nesta rodada (continuação 189 - 09/03/2026)
- Continuidade da decomposição incremental de `Chat` com foco no residual de header responsivo ainda inline no container:
  - novo componente `apps/frontend-service/src/pages/Chat/components/ChatHeaderSection.tsx` criado para centralizar:
    - header desktop/mobile (toggle sidebar e abertura de drawer);
    - badge de modelo;
    - controles de governança (`ChatGovernanceControls`);
    - menu de ações (`ChatActionsMenu`) para desktop e variante compact mobile.
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para:
    - consumir `ChatHeaderSection` como boundary único de render do header.
    - remover bloco inline equivalente e imports residuais de ícones/UI.
  - `apps/frontend-service/src/pages/Chat/components/index.ts` atualizado com reexport de `ChatHeaderSection`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de UI/composição.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 189)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 189)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `Trading.tsx` (composição de props ainda extensa para tabs/dialogs), seguido de varredura final em `Chat/index.tsx`.

### Escopo entregue nesta rodada (continuação 190 - 09/03/2026)
- Continuidade da decomposição incremental de `Chat` com foco no residual de sidebar/lista de conversas ainda inline no container:
  - novo componente `apps/frontend-service/src/pages/Chat/components/ChatConversationsSidebar.tsx` criado para centralizar:
    - drawer mobile (`Sheet`) da lista de conversas;
    - sidebar desktop animada (`AnimatePresence` + `motion`);
    - render unificado de `ConversationsList` para os dois contextos.
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para:
    - consumir `ChatConversationsSidebar` como boundary único da lateral de conversas.
    - remover bloco inline equivalente de drawer/sidebar.
    - remover imports residuais não mais necessários.
  - `apps/frontend-service/src/pages/Chat/components/index.ts` atualizado com reexport de `ChatConversationsSidebar`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de UI/composição.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 190)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 190)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `Trading.tsx` (composição de props ainda extensa para tabs/dialogs), seguido de varredura final no shell/workspace de `Chat/index.tsx`.

### Escopo entregue nesta rodada (continuação 191 - 09/03/2026)
- Continuidade da decomposição incremental de `Chat` com foco nos residuais de workspace e composer ainda inline no container:
  - novo componente `apps/frontend-service/src/pages/Chat/components/ChatWorkspaceSection.tsx` criado para centralizar o `WorkspaceFilterBar` do Chat.
  - novo componente `apps/frontend-service/src/pages/Chat/components/ChatComposerSection.tsx` criado para centralizar o formulário de envio (`motion.form`) e o `ChatInput`.
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para:
    - consumir `ChatWorkspaceSection` e `ChatComposerSection` como boundaries únicos de UI.
    - remover blocos inline equivalentes de workspace/composer.
    - remover imports residuais não mais necessários.
  - `apps/frontend-service/src/pages/Chat/components/index.ts` atualizado com reexports dos novos componentes.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de UI/composição.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 191)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 191)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `Trading.tsx` (composição de props ainda extensa para tabs/dialogs), seguido de varredura final no container de `Chat/index.tsx` (orquestração de hooks/handlers).

### Escopo entregue nesta rodada (continuação 192 - 09/03/2026)
- Continuidade da decomposição incremental de `Chat` com foco no residual de composição de layout principal ainda no container:
  - novo componente `apps/frontend-service/src/pages/Chat/components/ChatPageLayout.tsx` criado para centralizar o shell visual da página:
    - sidebar de conversas;
    - header;
    - workspace section;
    - viewport de mensagens;
    - composer;
    - dialogs.
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para:
    - consumir `ChatPageLayout` como boundary único do render.
    - manter `index.tsx` focado em estado, queries e handlers.
  - `apps/frontend-service/src/pages/Chat/components/index.ts` atualizado com reexport de `ChatPageLayout`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de UI/composição.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 192)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 192)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `Trading.tsx` (composição de props ainda extensa para tabs/dialogs), seguido de varredura final em `Chat/index.tsx` para possíveis extrações de orquestração de hooks.

### Escopo entregue nesta rodada (continuação 193 - 09/03/2026)
- Continuidade da decomposição incremental de `Chat` com foco no residual de estado local ainda inline no container:
  - novo hook `apps/frontend-service/src/pages/Chat/useChatLocalState.ts` criado para centralizar:
    - estado local de UI/workspace/sidebar/dialogs/áudio/stream;
    - refs operacionais de gravação/stream/sync (`useRef`) usadas pelos fluxos de orquestração;
    - setters e contratos consumidos pelos hooks downstream já existentes.
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para:
    - consumir `useChatLocalState` como boundary único de estado local da página.
    - remover declarações inline equivalentes de `useState`/`useRef`.
    - manter o container focado em composição de hooks de domínio, queries e handlers.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 193)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 193)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `Trading.tsx` (mutações de controle/ordens e densidade de composição residual), seguido de fechamento da composição de queries/filtros restantes em `WisePayments.tsx`.

### Escopo entregue nesta rodada (continuação 194 - 09/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco no residual de estado local ainda inline no container:
  - novo hook `apps/frontend-service/src/components/trading/useTradingLocalState.ts` criado para centralizar:
    - estado local de UI/forms/dialogs/execução;
    - estado de seleção e parâmetros operacionais (`market`, `symbol`, `interval`, `portfolio`, `control mode`);
    - refs de autosave de signal profile (`enabled/timer/lastPayload/context`);
    - setters e contratos consumidos pelos hooks de composição já existentes.
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para:
    - consumir `useTradingLocalState` como boundary único de estado local da página.
    - remover declarações inline equivalentes de `useState`/`useRef`.
    - manter o container focado em composição de queries, mutações e sections.
  - `apps/frontend-service/src/components/trading/index.ts` atualizado com reexport de `useTradingLocalState`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 194)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 194)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `Trading.tsx` (orquestração de memoizações/handlers de apresentação residual), seguido de fechamento formal de pendências em `WisePayments.tsx` e revisão final de status.

### Escopo entregue nesta rodada (continuação 195 - 09/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco no residual de memoizações/callbacks de navegação/opções ainda inline no container:
  - novo hook `apps/frontend-service/src/components/trading/useTradingNavigationPresentation.ts` criado para centralizar:
    - seleção/visibilidade de tabs por workspace;
    - opções de workspaces e tabs para `WorkspaceFilterBar`;
    - opções de `auto mode`, `indicators` e `techniques`;
    - callback de seleção de workspace para integração com navegação de tabs.
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para:
    - consumir `useTradingNavigationPresentation` como boundary único de apresentação de navegação/opções.
    - remover memoizações/callbacks inline equivalentes.
  - `apps/frontend-service/src/components/trading/index.ts` atualizado com reexport de `useTradingNavigationPresentation`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 195)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 195)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `Trading.tsx` (memos/callbacks operacionais remanescentes e coesão de composição), seguido de revisão final de pendências em `WisePayments.tsx` para fechamento formal do bloco.

### Escopo entregue nesta rodada (continuação 196 - 09/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco no residual de estado derivado de conexão realtime ainda inline no container:
  - novo hook `apps/frontend-service/src/components/trading/useTradingRealtimeConnectionState.ts` criado para centralizar:
    - `selectedSymbol` sanitizado e validação de símbolo por mercado;
    - derivação de `requestSymbol` e `isFuturesMarket`;
    - gate de habilitação de websocket (`wsEnabled`);
    - composição de canais realtime (`wsChannels`) com inclusão condicional de `klines`.
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para:
    - consumir `useTradingRealtimeConnectionState` como boundary único desse domínio.
    - remover composição inline equivalente de estado derivado + `useMemo`.
  - `apps/frontend-service/src/components/trading/index.ts` atualizado com reexport de `useTradingRealtimeConnectionState`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 196)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 196)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `Trading.tsx` (estado derivado operacional/memoizações remanescentes), seguido de revisão final de `WisePayments.tsx` para fechamento formal das pendências de frontend.

### Escopo entregue nesta rodada (continuação 197 - 09/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco no residual de memoizações derivadas de candidatos/payload ainda inline no container:
  - novo hook `apps/frontend-service/src/components/trading/useTradingDerivedPayloadState.ts` criado para centralizar:
    - derivação e ordenação de `topTradingCandidates`;
    - composição de `signalProfilePayload`;
    - avaliação de completude (`isSignalProfilePayloadComplete`) para gates de autosave.
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para:
    - consumir `useTradingDerivedPayloadState` como boundary único desse domínio derivado.
    - remover memoizações inline equivalentes.
  - `apps/frontend-service/src/components/trading/index.ts` atualizado com reexport de `useTradingDerivedPayloadState`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 197)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 197)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `Trading.tsx` (callbacks/derived operational states remanescentes), seguido de revisão final de `WisePayments.tsx` para fechamento formal do bloco frontend.

### Escopo entregue nesta rodada (continuação 198 - 09/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco no residual de handlers realtime ainda inline no container:
  - novo hook `apps/frontend-service/src/components/trading/useTradingRealtimeEventHandlers.ts` criado para centralizar:
    - tratamento de erro de websocket (`onError`);
    - atualização de quotes por ticker (`onTicker`) com guardrails de futures;
    - invalidações de queries para eventos de ordens/posições/saldo.
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para:
    - consumir `useTradingRealtimeEventHandlers` como boundary único desse domínio.
    - remover handlers inline equivalentes do `useKucoinWebSocket`.
  - `apps/frontend-service/src/components/trading/index.ts` atualizado com reexport de `useTradingRealtimeEventHandlers`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 198)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 198)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `Trading.tsx` (callbacks e estados derivados operacionais remanescentes), seguido de revisão final de `WisePayments.tsx` para fechamento formal do bloco frontend.

### Escopo entregue nesta rodada (continuação 199 - 09/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco no residual de side-effect de subscription futures ainda inline no container:
  - novo hook `apps/frontend-service/src/components/trading/useTradingFuturesQuoteSubscription.ts` criado para centralizar:
    - subscribe de tickers por símbolo de posição futures aberta;
    - cleanup simétrico de unsubscribe por símbolo;
    - guards de execução por mercado/estado de conexão WS.
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para:
    - consumir `useTradingFuturesQuoteSubscription` como boundary único desse side-effect.
    - remover `useEffect` inline equivalente.
  - `apps/frontend-service/src/components/trading/index.ts` atualizado com reexport de `useTradingFuturesQuoteSubscription`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 199)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 199)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `Trading.tsx` (callbacks/derivações residuais de apresentação e wrappers), seguido de revisão final de `WisePayments.tsx` para fechamento formal do bloco frontend.

### Escopo entregue nesta rodada (continuação 200 - 09/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco no residual de callbacks/derivações de apresentação e wrappers ainda inline no container:
  - novo hook `apps/frontend-service/src/components/trading/useTradingOperationalPresentationWrappers.tsx` criado para centralizar:
    - derivação de erro crítico (`criticalApiError`) a partir do conjunto de falhas de queries;
    - wrappers de render de badges (`renderOrderStatusBadge` e `renderSignalTypeBadge`);
    - derivação de saúde de websocket (`wsHealthy`) para consumo em layout.
  - novo hook `apps/frontend-service/src/components/trading/useTradingSchedulerFormSync.ts` criado para centralizar:
    - sincronização de `schedulerConfig` para `schedulerForm`;
    - remoção de `useEffect` inline residual no container principal.
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para:
    - consumir ambos os hooks como boundaries únicos desses domínios;
    - remover composição inline equivalente, mantendo comportamento e contratos.
  - `apps/frontend-service/src/components/trading/index.ts` atualizado com reexports de `useTradingOperationalPresentationWrappers` e `useTradingSchedulerFormSync`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 200)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 200)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `WisePayments.tsx` (composição residual de queries/filtros e boundary de props), seguido de varredura final de `Trading.tsx`/`Chat/index.tsx` para fechamento formal do bloco frontend.

### Escopo entregue nesta rodada (continuação 201 - 09/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com foco no residual de composição de queries/filtros e boundary de props:
  - novo builder `apps/frontend-service/src/pages/wise-payments/build-wise-profile-tabs-props.ts` criado para centralizar o assembly das tabs com `profile scope` (`account-details/cards/card-orders/card-transactions/spend-controls/disputes/kyc/webhooks/simulations/sca`).
  - novo builder `apps/frontend-service/src/pages/wise-payments/build-wise-operational-tabs-props.ts` criado para centralizar o assembly das tabs operacionais (`balances/exchange/transfers/recipients/quotes/batch/statements/profiles/users/activities/spend-limits/catalog`).
  - `apps/frontend-service/src/pages/wise-payments/use-wise-tab-props.ts` atualizado para:
    - delegar o assembly para os builders por domínio;
    - manter somente o papel de composition root fino para as props finais.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural da composição de tabs.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 201)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 201)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `Trading.tsx` e `Chat/index.tsx` (varredura final de composição/handlers residuais), seguido de fechamento formal das pendências frontend.

### Escopo entregue nesta rodada (continuação 202 - 09/03/2026)
- Continuidade da decomposição incremental de `Chat` com foco no residual de composição/handlers ainda inline no container:
  - novo hook `apps/frontend-service/src/pages/Chat/useChatContainerBindings.ts` criado para centralizar:
    - `workspaceOptions`;
    - `fallbackMessageUser`;
    - callback de alteração de approval policy;
    - callback de confirmação de exclusão (`delete target`);
    - side-effect de sync de foco por troca de conversa.
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para:
    - consumir `useChatContainerBindings` como boundary único desses bindings;
    - remover `useMemo/useCallback/useEffect` inline equivalentes.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 202)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 202)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar próximo residual de maior impacto em `Trading.tsx` (invalidação/derivações operacionais remanescentes) e, na sequência, executar fechamento formal das pendências frontend.

### Escopo entregue nesta rodada (continuação 203 - 09/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco nos callbacks residuais ainda inline no container:
  - novo hook `apps/frontend-service/src/components/trading/useTradingKlineInvalidation.ts` criado para centralizar a invalidação de `klines`.
  - novo hook `apps/frontend-service/src/components/trading/useTradingAuthRedirect.ts` criado para centralizar o redirect de login do wrapper de autenticação.
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para:
    - consumir `useTradingKlineInvalidation` no fluxo de `useTradingMarketOrderBookState`;
    - consumir `useTradingAuthRedirect` no wrapper `Trading`;
    - remover callbacks inline equivalentes.
  - `apps/frontend-service/src/components/trading/index.ts` atualizado com reexports dos novos hooks.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 203)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 203)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar fechamento formal das pendências frontend com revisão final de acoplamentos residuais e checklist de conclusão do bloco.

### Escopo entregue nesta rodada (continuação 204 - 09/03/2026)
- Continuidade da decomposição incremental de `Trading` com foco no residual de invalidação de queries de conta ainda inline:
  - novo hook `apps/frontend-service/src/components/trading/useTradingAccountInvalidation.ts` criado para centralizar a invalidação de `['account']`.
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para:
    - consumir `useTradingAccountInvalidation` na composição de `useTradingWorkspaceActionHandlers`;
    - remover callback inline equivalente de invalidação de conta.
  - `apps/frontend-service/src/components/trading/index.ts` atualizado com reexport de `useTradingAccountInvalidation`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 204)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 204)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar checklist de fechamento do bloco frontend (revisão final de acoplamentos residuais e definição objetiva de pendências restantes).

### Escopo entregue nesta rodada (continuação 205 - 09/03/2026)
- Continuidade da decomposição incremental de `WisePayments` com foco no residual de composição de queries/filtros no domínio `profile scoped`:
  - novo módulo `apps/frontend-service/src/pages/wise-payments/wise-query-builders.ts` criado para centralizar:
    - montagem de path com `profileId` + query params adicionais;
    - fetch JSON tipado (`fetchWiseProfileScopedJson`) para queries de leitura.
  - `apps/frontend-service/src/pages/wise-payments/use-wise-data-queries.ts` atualizado para:
    - consumir `fetchWiseProfileScopedJson` em `cards`, `spend-controls`, `disputes`, `kyc-reviews`, `card-orders`, `dispute-reasons`, `account-details` e `account-details/orders`;
    - remover duplicação de montagem de URL/query string e padronizar `enabled` de queries `profile scoped`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural da composição de queries/filtros.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 205)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 205)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar checklist de fechamento formal do bloco frontend com declaração objetiva de pendências finais remanescentes.

### Escopo entregue nesta rodada (continuação 206 - 09/03/2026)
- Continuidade da decomposição incremental de `Chat` com foco no residual de mutação de stream ainda orquestrado no container:
  - novo hook `apps/frontend-service/src/pages/Chat/useChatSendMessageMutation.ts` criado para centralizar:
    - criação da mutação principal via `useMutation(createChatStreamMutationConfig(...))`;
    - função `sendMessage` dedicada para envio de payload de stream sem expor `mutate` inline no container.
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para:
    - consumir `useChatSendMessageMutation` como boundary único da mutação de stream;
    - remover wrappers inline de `sendMessage.mutate(...)` nos fluxos de `message sync`, `recording`, `composer` e `quick reply`.
  - `apps/frontend-service/src/pages/Chat/chat-stream-mutation.ts` atualizado para exportar `ChatStreamMutationOptions` e permitir composição tipada do novo hook.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 206)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 206)
- Retomar varredura conjunta de fechamento P2 (`Trading` + `WisePayments` + `Chat`) para mapear pendências objetivas finais rumo a 100%.
- Priorizar checklist de fechamento formal do bloco frontend e, na sequência, consolidar fechamento objetivo dos blocos 3/4/5.

### Escopo entregue nesta rodada (continuação 207 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco em reduzir acoplamento residual do `integrations-service` no domínio Twilio/WhatsApp:
  - novo módulo `apps/integrations-service/src/twilio-chat-media-service.ts` criado para centralizar:
    - `buildProcessMessageWithLLM` (mensagens WhatsApp -> Chat Service com auth interna, idempotency key e tratamento de escalação/human mode);
    - `buildProcessWhatsAppMediaForRAG` (download autenticado de mídia do Twilio, validação de MIME suportado, upload JSON para RAG e trilha de erro observável).
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir os builders `buildProcessMessageWithLLM` e `buildProcessWhatsAppMediaForRAG`;
    - remover funções inline equivalentes de alto acoplamento do composition root;
    - manter os mesmos contratos de dependência usados em `registerTwilioWebhookRoutes`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de bounded context Twilio/WhatsApp.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 207)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 207)
- Avançar na redução residual de acoplamento do `apps/integrations-service/src/index.ts` em bounded contexts críticos restantes para evoluir o status do Bloco 3 de “parcial” para “concluído”.
- Em paralelo, retomar checklist de fechamento formal do Bloco 5 e consolidação objetiva dos blocos 3/4/5 rumo a 100%.

### Escopo entregue nesta rodada (continuação 208 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de persistência Wise ainda inline no `integrations-service`:
  - novo módulo `apps/integrations-service/src/wise-storage-service.ts` criado para centralizar:
    - `upsertWiseProfiles`, `upsertWiseUsers`, `upsertWiseBalances`, `upsertWiseRecipients`, `upsertWiseQuotes`, `upsertWiseTransfers`;
    - `upsertWiseCards`, `upsertWiseCardOrders`, `upsertWiseCardTransactions`, `upsertWiseSpendControls`, `upsertWiseDisputes`;
    - `upsertWiseActivities`, `upsertWiseKycReviews`, `upsertWiseWebhookSubscriptions` e `insertWiseWebhookEvent`.
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir as funções de `wise-storage-service` como boundary único de persistência Wise;
    - remover funções inline equivalentes de alto volume no composition root;
    - manter os mesmos contratos de dependência injetados em `registerWise*Routes`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de bounded context Wise.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 208)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 208)
- Seguir redução residual de acoplamento no `apps/integrations-service/src/index.ts` para fechamento objetivo do Bloco 3.
- Após isso, retomar checklist de fechamento formal dos blocos 4/5 com critério explícito de conclusão 100% do plano.

### Escopo entregue nesta rodada (continuação 209 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de health checks ainda inline no `integrations-service`:
  - novo módulo `apps/integrations-service/src/integration-health-service.ts` criado para centralizar:
    - checks de saúde de `stripe`, `wise`, `twilio`, `email`, `openai_vision` e `trading`;
    - composição de status agregado e refresh de métricas de integração.
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir `createIntegrationHealthRefresher`;
    - remover funções inline equivalentes (`check*Health`, `collectIntegrationHealthStatuses`, `refreshIntegrationHealthMetrics`);
    - preservar contrato de `refreshIntegrationHealthMetrics` injetado em `registerIntegrationCoreRoutes`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de bounded context de health.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 209)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 209)
- Seguir redução residual de acoplamento no `apps/integrations-service/src/index.ts` com extrações cirúrgicas restantes para concluir objetivamente o Bloco 3.
- Na sequência, consolidar checklist formal de fechamento dos blocos 4/5 com critério explícito de conclusão 100% do plano.

### Escopo entregue nesta rodada (continuação 210 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de idempotência de webhook ainda inline no `integrations-service`:
  - novo módulo `apps/integrations-service/src/webhook-idempotency-service.ts` criado para centralizar:
    - `checkWebhookIdempotency`;
    - `markWebhookProcessed`.
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir o módulo dedicado via wrapper de logger (`checkWebhookIdempotencyWithLogger`);
    - remover implementação inline equivalente;
    - preservar contratos injetados em `registerStripeRoutes` e `registerWiseWebhookRoutes`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de bounded context de webhook governance.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 210)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 210)
- Continuar extrações residuais de alto impacto no `apps/integrations-service/src/index.ts` para concluir o Bloco 3 de forma objetiva.
- Em seguida, consolidar fechamento formal dos blocos 4/5 e declaração de conclusão 100% do plano.

### Escopo entregue nesta rodada (continuação 211 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de parsing/reparo LLM de sinais ainda inline no `integrations-service`:
  - novo módulo `apps/integrations-service/src/trading-llm-signal-parser.ts` criado para centralizar:
    - parsing de resposta LLM de sinais;
    - normalização de payload e `citedValues`;
    - pipeline de repair (`sanitize`, `yaml-like`, `json content repair`, `jsonrepair`) com validação por schema.
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir `createLlmSignalResponseParser` via injeção de dependências (`logger`, `computeSemHash`, `extractValuesFromLLMResponse`);
    - remover bloco inline equivalente de parsing/normalização/reparo;
    - preservar contrato de geração de sinais já consumido no fluxo de trading.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de bounded context LLM parser.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 211)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 211)
- Continuar redução residual de alto impacto no `apps/integrations-service/src/index.ts` para concluir objetivamente o Bloco 3.
- Na sequência, consolidar checklist formal de fechamento dos blocos 4/5 até declaração de conclusão 100% do plano.

### Escopo entregue nesta rodada (continuação 212 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de utilitários de chamadas externas e timeout ainda inline no `integrations-service`:
  - novo módulo `apps/integrations-service/src/integration-external-call-service.ts` criado para centralizar:
    - `createExecuteStripeCall` (wrapper de observabilidade para chamadas Stripe);
    - `withTimeout` (timeout seguro para chamadas externas).
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir `createExecuteStripeCall` e `withTimeout` via boundary dedicado;
    - remover funções inline equivalentes;
    - preservar contratos já usados em `registerStripeRoutes`, `createGrafanaClient`, `createGitHubActionsClient` e `createIntegrationHealthRefresher`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de bounded context de external calls.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 212)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 212)
- Seguir redução residual de alto impacto no `apps/integrations-service/src/index.ts` para aproximar fechamento objetivo do Bloco 3.
- Em seguida, retomar checklist de fechamento formal dos blocos 4/5 até conclusão 100% do plano.

### Escopo entregue nesta rodada (continuação 213 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de bootstrap de canais externos ainda inline no `integrations-service`:
  - novo módulo `apps/integrations-service/src/integrations-bootstrap-service.ts` criado para centralizar:
    - `initializeGmailTransporter`;
    - `initializeStripeClient`.
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir o módulo dedicado de bootstrap para inicialização de Gmail SMTP e Stripe;
    - remover bloco inline equivalente de startup;
    - preservar comportamento fail-fast em produção e logs de observabilidade.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de bounded context de bootstrap externo.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 213)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 213)
- Seguir redução residual de alto impacto no `apps/integrations-service/src/index.ts` para avançar fechamento objetivo do Bloco 3.
- Em seguida, consolidar checklist de fechamento formal dos blocos 4/5 até conclusão 100% do plano.

### Escopo entregue nesta rodada (continuação 214 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de auth context Wise ainda inline no `integrations-service`:
  - novo módulo `apps/integrations-service/src/wise-auth-context-service.ts` criado para centralizar:
    - `getWiseAuthContextFromRequest`;
    - tipo `WiseAuthContext`.
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir o módulo dedicado via wrapper `getWiseAuthContext`;
    - remover função inline equivalente;
    - preservar contratos injetados em todos os módulos `registerWise*Routes`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de bounded context de auth context Wise.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 214)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 214)
- Seguir redução residual de alto impacto no `apps/integrations-service/src/index.ts` para aproximar fechamento objetivo do Bloco 3.
- Em seguida, consolidar checklist de fechamento formal dos blocos 4/5 até conclusão 100% do plano.

### Escopo entregue nesta rodada (continuação 215 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de startup orchestration ainda inline no `integrations-service`:
  - novo módulo `apps/integrations-service/src/integration-startup-service.ts` criado para centralizar:
    - bootstrap de integrações por tenant (`buildIntegrationSeeds`, `ensureIntegrationSeeded`, `bootstrapIntegrationsForTenants`);
    - inicialização de caches (`initializeCaches`).
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir `createIntegrationStartupOrchestrator`;
    - remover bloco inline equivalente de startup;
    - preservar ordem/comportamento operacional de bootstrap e inicialização de cache.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de bounded context de startup.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 215)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 215)
- Seguir redução residual de alto impacto no `apps/integrations-service/src/index.ts` para fechamento objetivo do Bloco 3.
- Em seguida, consolidar checklist de fechamento formal dos blocos 4/5 até conclusão 100% do plano.

### Escopo entregue nesta rodada (continuação 216 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de configuração WS KuCoin ainda inline no `integrations-service`:
  - novo módulo `apps/integrations-service/src/kucoin-ws-config-service.ts` criado para centralizar:
    - depths REST/WS (`KUCOIN_REST_ORDERBOOK_DEPTHS`, `KUCOIN_WS_ORDERBOOK_DEPTHS`);
    - parsing/validação de intervalos (`parseTradingIntervalToMinutes`, `resolveTradingIntervals`, `getAllowedGranularitiesMinutes`, `isValidKucoinWsInterval`);
    - validações de depth (`resolveKucoinRestOrderBookDepth`, `resolveKucoinWsOrderBookDepth`);
    - registry de tópicos Spot/Margin (`registerSpotWsMarketType`, `unregisterSpotWsMarketType`, `getSpotMarketTypesForTopic`, `resolveSpotSymbolFromTopic`).
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir o módulo dedicado de configuração WS KuCoin;
    - remover funções inline equivalentes;
    - preservar contratos já usados em `registerTradingWebsocketRoutes`, handlers de eventos WS e endpoints de market data (`klines`/`orderbook`).
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de bounded context de configuração WS KuCoin.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 216)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 216)
- Seguir redução residual de alto impacto no `apps/integrations-service/src/index.ts` para fechamento objetivo do Bloco 3.
- Em seguida, consolidar checklist de fechamento formal dos blocos 4/5 até conclusão 100% do plano.

### Escopo entregue nesta rodada (continuação 217 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de handlers de market data ainda inline no `integrations-service`:
  - novo módulo `apps/integrations-service/src/trading-market-data-handlers.ts` criado para centralizar:
    - `handleTradingKlinesRequest`;
    - `handleTradingOrderBookRequest`.
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir `createTradingMarketDataHandlers` com dependências injetadas (`resolveMarketTypeParam`, `respondKucoinNotConfigured`, `sendKucoinErrorResponse`, `resolveTradingSymbolOrRespond`);
    - remover funções inline equivalentes de market data;
    - preservar contratos já usados em `registerTradingMarketDataRoutes`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de bounded context de market data handlers.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 217)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 217)
- Seguir redução residual de alto impacto no `apps/integrations-service/src/index.ts` para fechamento objetivo do Bloco 3.
- Em seguida, consolidar checklist de fechamento formal dos blocos 4/5 até conclusão 100% do plano.

### Escopo entregue nesta rodada (continuação 218 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de métricas WS KuCoin ainda inline no `integrations-service`:
  - novo módulo `apps/integrations-service/src/kucoin-ws-metrics-service.ts` criado para centralizar:
    - mapeamento de estado WS para métrica numérica;
    - wiring único de listeners public/private;
    - atualização de gauges/counters de estado, conexão, reconnect e erro.
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir `createKucoinWsMetricsWiring`;
    - remover bloco inline equivalente (`mapKucoinWsStateToNumber`, `kucoinWsMetricsWired`, `wireKucoinWebSocketMetrics`);
    - preservar contratos de inicialização/observabilidade do WS KuCoin.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de bounded context de observabilidade WS KuCoin.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 218)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 218)
- Seguir redução residual de alto impacto no `apps/integrations-service/src/index.ts` para fechamento objetivo do Bloco 3.
- Em seguida, consolidar checklist de fechamento formal dos blocos 4/5 até conclusão 100% do plano.

### Escopo entregue nesta rodada (continuação 219 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de request resolvers de trading ainda inline no `integrations-service`:
  - novo módulo `apps/integrations-service/src/trading-request-resolver-service.ts` criado para centralizar:
    - `respondKucoinNotConfigured`;
    - `resolveTradingSymbolOrRespond`;
    - `resolveMarketTypeParam`;
    - `resolveSymbolFromQuery`;
    - `resolveTradingIntervalGranularity`.
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir `createTradingRequestResolver` com `TRADING_INTERVAL_GRANULARITY`;
    - remover funções inline equivalentes;
    - preservar contratos já usados em módulos de rotas (`registerTrading*Routes`) e handlers internos.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de bounded context de request resolver.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 219)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 219)
- Seguir redução residual de alto impacto no `apps/integrations-service/src/index.ts` para fechamento objetivo do Bloco 3.
- Em seguida, consolidar checklist de fechamento formal dos blocos 4/5 até conclusão 100% do plano.

### Escopo entregue nesta rodada (continuação 220 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de resolução de tenant WS privado KuCoin ainda inline no `integrations-service`:
  - novo módulo `apps/integrations-service/src/kucoin-private-ws-tenant-service.ts` criado para centralizar:
    - `createResolveKucoinTenantIdForPrivateWs` (resolução dinâmica por integrações ativas + match por API key quando necessário).
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir `createResolveKucoinTenantIdForPrivateWs(logger)`;
    - remover função inline equivalente;
    - preservar comportamento/logs de fallback quando múltiplos tenants ativos impedem resolução determinística.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de bounded context de resolução de tenant WS privado.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 220)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 220)
- Seguir redução residual de alto impacto no `apps/integrations-service/src/index.ts` para fechamento objetivo do Bloco 3.
- Em seguida, consolidar checklist de fechamento formal dos blocos 4/5 até conclusão 100% do plano.

### Escopo entregue nesta rodada (continuação 221 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de catálogo de símbolos de trading ainda inline no `integrations-service`:
  - novo módulo `apps/integrations-service/src/trading-symbol-catalog-service.ts` criado para centralizar:
    - `normalizeSignalSymbols`;
    - `selectSymbolFromUniverseCandidates`;
    - `normalizeSymbolList`;
    - `resolveConnectedTradingVenues`;
    - `loadTradingAutoAssetsForVenue`;
    - `fetchTradingSymbolPreferences`.
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir `createTradingSymbolCatalogService(logger)`;
    - remover funções inline equivalentes;
    - preservar contratos já usados em rotas de trading e fluxos de auto-signals.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de bounded context de catálogo de símbolos.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 221)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 221)
- Seguir redução residual de alto impacto no `apps/integrations-service/src/index.ts` para fechamento objetivo do Bloco 3.
- Em seguida, consolidar checklist de fechamento formal dos blocos 4/5 até conclusão 100% do plano.

### Escopo entregue nesta rodada (continuação 222 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de fees KuCoin ainda inline no `integrations-service`:
  - novo módulo `apps/integrations-service/src/kucoin-trading-fee-service.ts` criado para centralizar:
    - cache Redis e cálculo de trade fees por mercado (`futures/spot/margin`);
    - fallback persistido por tenant para fees de arbitragem;
    - resolução e persistência de network fees por ativo.
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir `createKucoinTradingFeeService(logger)`;
    - remover funções inline equivalentes de fees/arbitragem/network fees;
    - preservar contratos já usados no fluxo de geração de sinais e cálculo de arbitragem.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de bounded context de fees KuCoin.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 222)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 222)
- Seguir redução residual de alto impacto no `apps/integrations-service/src/index.ts` para fechamento objetivo do Bloco 3.
- Em seguida, consolidar checklist de fechamento formal dos blocos 4/5 até conclusão 100% do plano.

### Escopo entregue nesta rodada (continuação 223 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de market context ainda inline no `integrations-service`:
  - novo módulo `apps/integrations-service/src/trading-market-context-service.ts` criado para centralizar:
    - `fetchRecentCandles` com resolução de granularity por intervalo;
    - snapshot de indicadores técnicos derivados;
    - composição de `marketContext` para datasets/sinais.
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir `createTradingMarketContextService({ resolveTradingIntervalGranularity })`;
    - remover funções inline equivalentes de candles/indicadores/contexto;
    - preservar contratos já usados em `buildTradingDatasetSeedFromSignal` e `createTradingDatasetFromSignalSource`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de bounded context de market context.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 223)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 223)
- Seguir redução residual de alto impacto no `apps/integrations-service/src/index.ts` para fechamento objetivo do Bloco 3.
- Em seguida, consolidar checklist de fechamento formal dos blocos 4/5 até conclusão 100% do plano.

### Escopo entregue nesta rodada (continuação 224 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de notícias de trading ainda inline no `integrations-service`:
  - novo módulo `apps/integrations-service/src/trading-news-service.ts` criado para centralizar:
    - normalização de `TradingProfileNewsConfig`;
    - montagem de query de notícias com limites/sanitização;
    - consulta de notícias via endpoint de web-search do RAG.
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir `createTradingNewsService`;
    - remover funções inline equivalentes de config/query/fetch de notícias;
    - preservar assinatura de `fetchNewsSummary` usada pelo fluxo de geração de sinais.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de bounded context de notícias de trading.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 224)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 224)
- Seguir redução residual de alto impacto no `apps/integrations-service/src/index.ts` para fechamento objetivo do Bloco 3.
- Em seguida, consolidar checklist de fechamento formal dos blocos 4/5 até conclusão 100% do plano.

### Escopo entregue nesta rodada (continuação 225 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de helpers de suporte de sinais ainda inline no `integrations-service`:
  - novo módulo `apps/integrations-service/src/trading-signal-support-service.ts` criado para centralizar:
    - `splitSymbolPair`;
    - `deriveIntermediateAssetsFromSymbols`;
    - `mapTradingErrorToUserMessage`;
    - `resolveDefaultSymbolForMarketType`.
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir `createTradingSignalSupportService()`;
    - remover funções inline equivalentes do composition root;
    - preservar contratos injetados em rotas de análise/sinal e no pipeline de geração de sinais.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de bounded context de suporte de sinais.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 225)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 225)
- Seguir redução residual de alto impacto no `apps/integrations-service/src/index.ts` para fechamento objetivo do Bloco 3.
- Em seguida, consolidar checklist de fechamento formal dos blocos 4/5 até conclusão 100% do plano.

### Escopo entregue nesta rodada (continuação 226 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de consenso/ensemble ainda inline no `integrations-service`:
  - novo módulo `apps/integrations-service/src/trading-analysis-consensus-service.ts` criado para centralizar:
    - `buildMajorityConsensus`;
    - `aggregateTechniqueScores`;
    - `buildEnsembleResult`.
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir funções do módulo dedicado;
    - remover funções inline equivalentes de consenso/ensemble;
    - preservar contratos já usados em rotas de análise e pipeline de geração de sinais.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de bounded context de consenso/ensemble.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 226)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 226)
- Seguir redução residual de alto impacto no `apps/integrations-service/src/index.ts` para fechamento objetivo do Bloco 3.
- Em seguida, consolidar checklist de fechamento formal dos blocos 4/5 até conclusão 100% do plano.

### Escopo entregue nesta rodada (continuação 227 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de config de perfil de trading ainda inline no `integrations-service`:
  - novo módulo `apps/integrations-service/src/trading-profile-config-service.ts` criado para centralizar:
    - `parseListParam`, `parseTimeframesParam`, `parseIndicatorsParam`, `parseTechniquesParam`;
    - `normalizeTradingTechniques`, `normalizeTradingEnsembleConfig`, `normalizeTradingArbitrageConfig`;
    - `assertArbitrageConfigForTechniques`, `normalizeTradingProfile`;
    - classe `TradingConfigError`.
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir `createTradingProfileConfigService(...)` e `TradingConfigError`;
    - remover funções/classes inline equivalentes;
    - preservar contratos já usados em rotas de análise/scheduler/sinais e no pipeline de geração de sinais.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de bounded context de config de perfil.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 227)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 227)
- Seguir redução residual de alto impacto no `apps/integrations-service/src/index.ts` para fechamento objetivo do Bloco 3.
- Em seguida, consolidar checklist de fechamento formal dos blocos 4/5 até conclusão 100% do plano.

### Escopo entregue nesta rodada (continuação 228 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de arbitragem triangular ainda inline no `integrations-service`:
  - novo módulo `apps/integrations-service/src/trading-arbitrage-service.ts` criado para centralizar:
    - `getOrderBookSnapshot`;
    - resolução de legs de conversão entre pares (`getConversionRate`);
    - `calculateTriangularArbitrage` com combinação de exchanges, network fees e suporte a `feePctByExchange`.
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir `createTradingArbitrageService`;
    - remover funções inline equivalentes (`getOrderBookSnapshot`, tipos/legs/network-fees e `calculateTriangularArbitrage`);
    - preservar contratos já usados em rotas de análise e pipeline de geração de sinais.
  - compatibilidade de tipagem reforçada para contratos reais de order book (Spot/Futures) sem alteração de payloads, contratos de API ou RBAC.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 228)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 228)
- Seguir redução residual de alto impacto no `apps/integrations-service/src/index.ts` para fechamento objetivo do Bloco 3.
- Em seguida, consolidar checklist de fechamento formal dos blocos 4/5 até conclusão 100% do plano.

### Escopo entregue nesta rodada (continuação 229 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de contexto de agente/scheduler de trading ainda inline no `integrations-service`:
  - novo módulo `apps/integrations-service/src/trading-agent-context-service.ts` criado para centralizar:
    - `getAgenticSettingsOrDefault`;
    - `resolveTradingAgentContext`;
    - `resolveSchedulerUserId`;
    - `buildTradingSignalSystemPrompt`.
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir `createTradingAgentContextService({ TradingConfigErrorCtor: TradingConfigError })`;
    - remover funções inline equivalentes do composition root;
    - preservar contratos já usados no pipeline de geração de sinais e no scheduler.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de bounded context de contexto de agente/scheduler.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 229)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 229)
- Seguir redução residual de alto impacto no `apps/integrations-service/src/index.ts` para fechamento objetivo do Bloco 3.
- Em seguida, consolidar checklist de fechamento formal dos blocos 4/5 até conclusão 100% do plano.

### Escopo entregue nesta rodada (continuação 230 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de trade-plan determinístico ainda inline no `integrations-service`:
  - novo módulo `apps/integrations-service/src/trading-signal-plan-service.ts` criado para centralizar:
    - `resolveSignalTypeFromAnalysis`;
    - `buildAnalysisMotivators`;
    - `buildAnalysisInvalidationReasons`;
    - `buildTradePlanFromAnalysis`;
    - `formatDurationLabel` (usado na persistência de metadata de sinal).
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir funções do módulo dedicado;
    - remover implementações inline equivalentes de planejamento determinístico de sinal/trade;
    - preservar contratos já usados nos fluxos de geração de sinais e análise.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de bounded context de trade-plan determinístico.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 230)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 230)
- Seguir redução residual de alto impacto no `apps/integrations-service/src/index.ts` para fechamento objetivo do Bloco 3.
- Em seguida, consolidar checklist de fechamento formal dos blocos 4/5 até conclusão 100% do plano.

### Escopo entregue nesta rodada (continuação 231 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de normalização de sinal LLM ainda inline no `integrations-service`:
  - novo módulo `apps/integrations-service/src/trading-llm-signal-normalizer-service.ts` criado para centralizar:
    - `normalizeNullableNumber`;
    - `normalizeCitedValues`;
    - `buildLlmSignalFromPartial` com validação por schema e guardrail de desvio de preço.
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir `createTradingLlmSignalNormalizerService({ logger, extractValuesFromLLMResponse })`;
    - remover funções inline equivalentes de normalização e montagem de payload LLM;
    - preservar contratos já usados no fluxo de geração de sinais.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de bounded context de normalização de sinal LLM.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 231)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 231)
- Seguir redução residual de alto impacto no `apps/integrations-service/src/index.ts` para fechamento objetivo do Bloco 3.
- Em seguida, consolidar checklist de fechamento formal dos blocos 4/5 até conclusão 100% do plano.

### Escopo entregue nesta rodada (continuação 232 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de prompt/token budget LLM ainda inline no `integrations-service`:
  - novo módulo `apps/integrations-service/src/trading-llm-prompt-service.ts` criado para centralizar:
    - `buildMultiTimeframePrompt`;
    - `resolveMaxTokensForPrompt`;
    - contratos de resumo de orderbook/news/training usados no prompt.
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir `createTradingLlmPromptService({ truncateText, formatAnalysisForLlm })`;
    - remover constantes/funções inline equivalentes de prompt e orçamento de tokens;
    - preservar contratos já usados em geração de sinais e geração de datasets de trading.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de bounded context de prompt/token budget LLM.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 232)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 232)
- Seguir redução residual de alto impacto no `apps/integrations-service/src/index.ts` para fechamento objetivo do Bloco 3.
- Em seguida, consolidar checklist de fechamento formal dos blocos 4/5 até conclusão 100% do plano.

### Escopo entregue nesta rodada (continuação 233 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de escopo/perfil de trading ainda inline no `integrations-service`:
  - novo módulo `apps/integrations-service/src/trading-scope-profile-service.ts` criado para centralizar:
    - `resolveTradingNamespaceId`;
    - `fetchTradingDatasetSummary`;
    - `getOrCreateTradingProfile`;
    - `validateTenantNamespace`.
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir `createTradingScopeProfileService({ truncateText, tradingSourceTypes: TRADING_SOURCE_TYPES })`;
    - remover funções inline equivalentes do composition root;
    - preservar contratos já usados nas rotas de análise/datasets/scheduler e no pipeline de geração de sinais.
  - tipagem de `sourceType` alinhada ao schema Drizzle para evitar drift de contrato no `inArray` de `training_data`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de bounded context de escopo/perfil de trading.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 233)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 233)
- Seguir redução residual de alto impacto no `apps/integrations-service/src/index.ts` para fechamento objetivo do Bloco 3.
- Em seguida, consolidar checklist de fechamento formal dos blocos 4/5 até conclusão 100% do plano.

### Escopo entregue nesta rodada (continuação 234 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de runtime de schedulers ainda inline no `integrations-service`:
  - novo módulo `apps/integrations-service/src/trading-scheduler-runtime-service.ts` criado para centralizar:
    - execução de schedulers de sinais (`runDueSignalSchedulers`);
    - execução de schedulers de análise (`runDueAnalysisSchedulers`);
    - ciclo de vida de polling (`start/stop`) para ambos os schedulers.
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir `createTradingSchedulerRuntimeService(...)`;
    - remover bloco inline equivalente de scheduler runtime;
    - integrar parada explícita de `stopTradingSignalScheduler` e `stopTradingAnalysisScheduler` no graceful shutdown.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de runtime e hardening operacional de shutdown.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 234)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 234)
- Seguir redução residual de alto impacto no `apps/integrations-service/src/index.ts` para fechamento objetivo do Bloco 3.
- Em seguida, consolidar checklist de fechamento formal dos blocos 4/5 até conclusão 100% do plano.

### Escopo entregue nesta rodada (continuação 235 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de observabilidade de chamadas externas ainda inline no `integrations-service`:
  - novo módulo `apps/integrations-service/src/integration-call-observer-service.ts` criado para centralizar:
    - `updateIntegrationMetrics`;
    - `observeIntegrationCall`;
    - classificação de erro por categoria operacional (`timeout`, `breaker_open`, `rate_limit`, `auth`, `not_found`, `http_error`).
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir `createIntegrationCallObserverService(...)`;
    - remover funções inline equivalentes do composition root;
    - preservar contratos já usados por health checks, Stripe/Grafana/GitHub e fluxos que observam métricas de integração.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de observabilidade de chamadas.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 235)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 235)
- Seguir redução residual de alto impacto no `apps/integrations-service/src/index.ts` para fechamento objetivo do Bloco 3.
- Em seguida, consolidar checklist de fechamento formal dos blocos 4/5 até conclusão 100% do plano.

### Escopo entregue nesta rodada (continuação 236 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco em hardening de consistência de estado operacional:
  - `apps/integrations-service/src/index.ts` atualizado para manter `integrationsImmutableAuditIntegrityState` como referência viva (`const`) e atualizar campos via `Object.assign(...)`.
  - eliminada a reatribuição de objeto que podia gerar estado stale nos consumidores de rota já registrados (`registerIntegrationCoreRoutes`), preservando contratos/payloads existentes.
  - sem alteração de payloads, contratos de API ou RBAC; somente hardening de consistência em runtime.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 236)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 236)
- Seguir redução residual de alto impacto no `apps/integrations-service/src/index.ts` para fechamento objetivo do Bloco 3.
- Em seguida, consolidar checklist de fechamento formal dos blocos 4/5 até conclusão 100% do plano.

### Escopo entregue nesta rodada (continuação 237 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de métricas operacionais de trading ainda inline no `integrations-service`:
  - novo módulo `apps/integrations-service/src/trading-metrics-runtime-service.ts` criado para centralizar:
    - `refreshTradingMetrics`;
    - `startTradingMetricsScheduler`;
    - `stopTradingMetricsScheduler`;
    - validação defensiva de `TRADING_METRICS_INTERVAL_MS` e `TRADING_PNL_WINDOW_HOURS`.
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir `createTradingMetricsRuntimeService(...)`;
    - remover bloco inline equivalente de métricas/scheduler;
    - delegar callback de shutdown para `stopTradingMetricsScheduler`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural e hardening operacional de scheduler.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 237)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 237)
- Seguir redução residual de alto impacto no `apps/integrations-service/src/index.ts` para fechamento objetivo do Bloco 3.
- Em seguida, consolidar checklist de fechamento formal dos blocos 4/5 até conclusão 100% do plano.

### Escopo entregue nesta rodada (continuação 238 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de verificação de cadeia imutável ainda inline no `integrations-service`:
  - novo módulo `apps/integrations-service/src/integrations-immutable-audit-runtime-service.ts` criado para centralizar:
    - estado compartilhado de integridade (`integrationsImmutableAuditIntegrityState`);
    - execução sob demanda (`runIntegrationsImmutableAuditIntegrityCheck`);
    - scheduler e lifecycle (`start/stopIntegrationsImmutableAuditIntegrityScheduler`).
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir `createIntegrationsImmutableAuditRuntimeService(...)`;
    - remover bloco inline equivalente de runtime de integridade;
    - delegar callback de shutdown para `stopIntegrationsImmutableAuditIntegrityScheduler`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural e hardening operacional de scheduler/state.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 238)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 238)
- Seguir redução residual de alto impacto no `apps/integrations-service/src/index.ts` para fechamento objetivo do Bloco 3.
- Em seguida, consolidar checklist de fechamento formal dos blocos 4/5 até conclusão 100% do plano.

### Escopo entregue nesta rodada (continuação 239 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual core de dataset de trading ainda inline no `integrations-service`:
  - novo módulo `apps/integrations-service/src/trading-dataset-core-service.ts` criado para centralizar:
    - `generateTradingDatasetEmbedding`;
    - `detectTradingDatasetDuplicate`;
    - `computeTradingDatasetQualityScore`;
    - `resolveActionTypeFromOrder`;
    - `buildOrderExecutionPrompt`.
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir `createTradingDatasetCoreService({ tradingSourceTypes, similarityThreshold })`;
    - remover funções inline equivalentes do composition root;
    - preservar contratos usados nos fluxos de criação de dataset por signal/order.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de core de dataset.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 239)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 239)
- Seguir redução residual de alto impacto no `apps/integrations-service/src/index.ts` para fechamento objetivo do Bloco 3.
- Em seguida, consolidar checklist de fechamento formal dos blocos 4/5 até conclusão 100% do plano.

### Escopo entregue nesta rodada (continuação 240 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de seed de dataset por sinal ainda inline no `integrations-service`:
  - novo módulo `apps/integrations-service/src/trading-dataset-seed-service.ts` criado para centralizar:
    - `buildTradingDatasetSeedFromSignal`.
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir `createTradingDatasetSeedService(...)`;
    - remover função inline equivalente do composition root;
    - preservar contratos dos fluxos de criação de dataset por signal.
  - alinhamento de tipagem em `apps/integrations-service/src/trading-llm-prompt-service.ts` com export de tipos de contrato (`TradingPromptMatrixEntry`, `TradingConsensusSummary`) para evitar drift entre módulos.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural e reforço de tipagem compartilhada.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 240)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 240)
- Seguir redução residual de alto impacto no `apps/integrations-service/src/index.ts` para fechamento objetivo do Bloco 3.
- Em seguida, consolidar checklist de fechamento formal dos blocos 4/5 até conclusão 100% do plano.

### Escopo entregue nesta rodada (continuação 241 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de resolução de namespace de dataset ainda duplicado no `integrations-service`:
  - novo módulo `apps/integrations-service/src/trading-dataset-namespace-service.ts` criado para centralizar:
    - `resolveDatasetNamespace` (validação de candidatos + fallback por inferência no namespace Trading).
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir `createTradingDatasetNamespaceService(...)`;
    - remover duplicação de lógica de namespace/inference dos fluxos de criação de dataset por signal e order.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural e redução de drift entre fluxos.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 241)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 241)
- Seguir redução residual de alto impacto no `apps/integrations-service/src/index.ts` para fechamento objetivo do Bloco 3.
- Em seguida, consolidar checklist de fechamento formal dos blocos 4/5 até conclusão 100% do plano.

### Escopo entregue nesta rodada (continuação 242 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de criação de dataset ainda inline no `integrations-service`:
  - novo módulo `apps/integrations-service/src/trading-dataset-orchestration-service.ts` criado para centralizar:
    - `createTradingDatasetFromSignalSource`;
    - `createTradingDatasetFromOrder`;
    - governança de lineage/métricas e atualização de status de sinal enviado para treinamento.
  - `apps/integrations-service/src/index.ts` atualizado para:
    - inicializar `createTradingDatasetOrchestrationService(...)` com callbacks de métricas;
    - delegar chamadas de criação de dataset ao módulo dedicado;
    - remover blocos inline equivalentes do composition root.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de orchestration de dataset.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 242)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 242)
- Seguir redução residual de alto impacto no `apps/integrations-service/src/index.ts` para fechamento objetivo do Bloco 3.
- Em seguida, consolidar checklist de fechamento formal dos blocos 4/5 até conclusão 100% do plano.

### Escopo entregue nesta rodada (continuação 243 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de análise técnica persistida ainda inline no `integrations-service`:
  - novo módulo `apps/integrations-service/src/trading-technical-analysis-service.ts` criado para centralizar:
    - `calculateAndPersistTechnicalAnalysis`;
    - cálculo técnico determinístico;
    - composição de `techniqueScores`/`ensembleResult`;
    - persistência de indicadores em `tradingTechnicalIndicators`.
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir `createTradingTechnicalAnalysisService(...)`;
    - remover a função inline equivalente do composition root;
    - preservar contratos usados em `registerTradingAnalysisRoutes` e no fluxo de `generateTradingSignalFromLlm`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de análise técnica persistida.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 243)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 243)
- Seguir redução residual de maior impacto no `apps/integrations-service/src/index.ts`, priorizando o desacoplamento do fluxo `generateTradingSignalFromLlm`.
- Em seguida, consolidar checklist objetivo de fechamento do Bloco 3 e revisar pendências remanescentes dos blocos 4/5 para aproximação do 100% do plano.

### Escopo entregue nesta rodada (continuação 244 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual legacy institucional ainda inline em `generateTradingSignalFromLlm`:
  - novo módulo `apps/integrations-service/src/trading-legacy-institutional-signal-service.ts` criado para centralizar:
    - branch legacy institucional (`portfolio_auto`);
    - fallback por candidatos de universo;
    - persistência de sinal com guardrails institucionais.
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir `createTradingLegacyInstitutionalSignalService(...)`;
    - delegar o branch legacy de `generateTradingSignalFromLlm` ao módulo dedicado;
    - remover bloco inline equivalente do composition root.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de geração legacy institucional.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 244)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 244)
- Seguir redução residual de maior impacto no `apps/integrations-service/src/index.ts`, priorizando o desacoplamento de blocos remanescentes em `generateTradingSignalFromLlm` (GPU request/orquestração LLM).
- Em seguida, consolidar checklist objetivo de fechamento do Bloco 3 e revisar pendências remanescentes dos blocos 4/5 para aproximação do 100% do plano.

### Escopo entregue nesta rodada (continuação 245 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de execução GPU/LLM ainda inline em `generateTradingSignalFromLlm`:
  - novo módulo `apps/integrations-service/src/trading-llm-execution-service.ts` criado para centralizar:
    - validação de adapter LoRA ativo por escopo (`tenant/namespace/agent`);
    - timeout/retries/backoff da inferência;
    - fallback gateway (`callGatewayComplete`) vs GPU Manager (`requestGpu`);
    - extração do conteúdo do structured output para uso no parser de sinais.
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir `createTradingLlmExecutionService(...)`;
    - delegar a orquestração de execução LLM para `requestTradingSignalCompletion(...)`;
    - remover bloco inline equivalente de GPU request/orquestração LLM.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural da execução LLM de sinais.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 245)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 245)
- Seguir redução residual de maior impacto no `apps/integrations-service/src/index.ts`, priorizando o desacoplamento do trecho remanescente de pós-processamento/persistência de `generateTradingSignalFromLlm`.
- Em seguida, consolidar checklist objetivo de fechamento do Bloco 3 e revisar pendências remanescentes dos blocos 4/5 para aproximação do 100% do plano.

### Escopo entregue nesta rodada (continuação 246 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de pós-processamento de sinal LLM ainda inline em `generateTradingSignalFromLlm`:
  - novo módulo `apps/integrations-service/src/trading-llm-signal-post-processing-service.ts` criado para centralizar:
    - promoção direcional por consenso multi-timeframe;
    - atualização de `operationType`, `suggestedSize`, `tradeSummary` e `reasoning` após override;
    - geração estruturada de `deterministicOverride`.
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir `createTradingLlmSignalPostProcessingService(...)`;
    - delegar a etapa de override para `applyDeterministicSignalOverride(...)`;
    - remover bloco inline equivalente no `generateTradingSignalFromLlm`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de pós-processamento de sinal.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 246)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 246)
- Seguir redução residual de maior impacto no `apps/integrations-service/src/index.ts`, priorizando o desacoplamento da etapa remanescente de persistência/validação final de sinal em `generateTradingSignalFromLlm`.
- Em seguida, consolidar checklist objetivo de fechamento do Bloco 3 e revisar pendências remanescentes dos blocos 4/5 para aproximação do 100% do plano.

### Escopo entregue nesta rodada (continuação 247 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de validação/persistência final de sinal LLM ainda inline em `generateTradingSignalFromLlm`:
  - novo módulo `apps/integrations-service/src/trading-llm-validation-finalize-service.ts` criado para centralizar:
    - seleção de snapshot de validação (`timeframeUsed`);
    - execução de `validateAndPersist`;
    - cálculo de `validationStatus`;
    - atualização de metadata do sinal com `validationSummary`.
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir `createTradingLlmValidationFinalizeService(...)`;
    - delegar a etapa final de validação/update para `finalizeTradingSignalValidation(...)`;
    - remover bloco inline equivalente do `generateTradingSignalFromLlm`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural da validação final de sinal.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 247)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 247)
- Seguir redução residual de maior impacto no `apps/integrations-service/src/index.ts`, priorizando o desacoplamento dos últimos blocos remanescentes de `generateTradingSignalFromLlm` (montagem/persistência final de payload de sinal).
- Em seguida, consolidar checklist objetivo de fechamento do Bloco 3 e revisar pendências remanescentes dos blocos 4/5 para aproximação do 100% do plano.

### Escopo entregue nesta rodada (continuação 248 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de montagem/persistência final de payload de sinal LLM ainda inline em `generateTradingSignalFromLlm`:
  - novo módulo `apps/integrations-service/src/trading-llm-signal-persistence-service.ts` criado para centralizar:
    - montagem do payload final de `createSignal` para sinais LLM;
    - composição de metadata completa (consenso, ensemble, técnicas, arbitragem, `analysisMatrix`, origem de geração);
    - persistência de sinal com validação de sucesso e erro explícito.
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir `createTradingLlmSignalPersistenceService(...)`;
    - delegar a etapa de persistência para `persistTradingLlmSignal(...)`;
    - remover bloco inline equivalente de `kucoinService.createSignal(...)` no `generateTradingSignalFromLlm`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural da persistência de sinal.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 248)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 248)
- Seguir redução residual de maior impacto no `apps/integrations-service/src/index.ts`, priorizando desacoplamento da composição de contexto/prompt multi-timeframe no `generateTradingSignalFromLlm`.
- Em seguida, consolidar checklist objetivo de fechamento do Bloco 3 e revisar pendências remanescentes dos blocos 4/5 para aproximação do 100% do plano.

### Escopo entregue nesta rodada (continuação 249 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de composição de prompt/token budget ainda inline em `generateTradingSignalFromLlm`:
  - `apps/integrations-service/src/trading-llm-prompt-service.ts` evoluído com novo boundary `buildTradingSignalPromptBudget(...)` para centralizar:
    - composição do prompt multi-timeframe de sinal;
    - cálculo de orçamento de tokens (`resolveMaxTokensForPrompt`);
    - redução progressiva de notícias para caber no contexto.
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir `buildTradingSignalPromptBudget(...)`;
    - remover bloco inline equivalente de `buildPromptWithNews`, loop de trimming de notícias e cálculo de budget;
    - manter apenas logs operacionais (`news reduction` e `prompt truncation`) e orquestração do fluxo.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de composição/budget do prompt LLM.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 249)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 249)
- Seguir redução residual de maior impacto no `apps/integrations-service/src/index.ts`, priorizando desacoplamento do bloco de análise/consenso/arbitragem no `generateTradingSignalFromLlm`.
- Em seguida, consolidar checklist objetivo de fechamento do Bloco 3 e revisar pendências remanescentes dos blocos 4/5 para aproximação do 100% do plano.

### Escopo entregue nesta rodada (continuação 250 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de análise/consenso/arbitragem ainda inline em `generateTradingSignalFromLlm`:
  - novo módulo `apps/integrations-service/src/trading-signal-analysis-orchestration-service.ts` criado para centralizar:
    - cálculo de `analysisMatrix` multi-timeframe com persistência técnica;
    - consenso majoritário + agregação de técnicas;
    - enriquecimento de arbitragem triangular com fees/network fees;
    - cálculo final de `ensembleResult`.
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir `buildTradingSignalAnalysisContext(...)`;
    - remover bloco inline equivalente de análise/consenso/arbitragem/ensemble no `generateTradingSignalFromLlm`;
    - preservar logs, payloads, contratos de API e RBAC.
  - sem alteração de comportamento funcional; apenas desacoplamento estrutural para composition root mais fino.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 250)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 250)
- Seguir redução residual de maior impacto no `apps/integrations-service/src/index.ts`, priorizando o desacoplamento da etapa de contexto de geração de sinal (RAG/news/training/orderbook/trade plan).
- Em seguida, consolidar checklist objetivo de fechamento do Bloco 3 e revisar pendências remanescentes dos blocos 4/5 para aproximação do 100% do plano.

### Escopo entregue nesta rodada (continuação 251 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de contexto operacional ainda inline em `generateTradingSignalFromLlm`:
  - novo módulo `apps/integrations-service/src/trading-signal-context-service.ts` criado para centralizar:
    - consulta de contexto RAG por símbolo/mercado;
    - snapshot de orderbook e consulta de notícias condicionadas por `dataSources`;
    - validação de dataset aprovado de Trading por namespace;
    - leitura de risk config e montagem de `tradePlan`.
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir `buildTradingSignalOperationalContext(...)`;
    - remover bloco inline equivalente de contexto operacional no `generateTradingSignalFromLlm`;
    - manter o composition root mais fino sem alterar contratos de API/RBAC.
  - sem alteração de comportamento funcional; apenas desacoplamento estrutural do contexto operacional de sinal.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 251)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 251)
- Seguir redução residual de maior impacto no `apps/integrations-service/src/index.ts`, priorizando extrações finais do fluxo de geração de sinal LLM e consolidação de fechamento do Bloco 3.
- Em seguida, retomar pendências dos blocos de Frontend (Trading/Chat/Wise) para convergir ao 100% do plano.

### Escopo entregue nesta rodada (continuação 252 - 09/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco no residual de maior densidade em `Trading.tsx`:
  - novo hook `apps/frontend-service/src/components/trading/useTradingCompositeActionHandlers.ts` criado para centralizar a orquestração de handlers de:
    - `page interactions`;
    - `postmortem training`;
    - `dialog forms`;
    - `scheduler form`;
    - `signal profile actions`;
    - `workspace actions` com invalidação de conta.
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para:
    - consumir `useTradingCompositeActionHandlers(...)`;
    - remover bloco inline equivalente de composição de handlers/mutações;
    - manter contratos de API/RBAC e comportamento visual/operacional.
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar o novo hook de composição.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 252)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 252)
- Seguir decomposição incremental das pendências residuais de `Trading.tsx`, priorizando extração dos próximos blocos de composição de props de tabs/layout com maior densidade e baixo risco.
- Em seguida, retomar residual de `Chat/index.tsx` (scroll/seleção/handlers) para fechamento objetivo das pendências P2.

### Escopo entregue nesta rodada (continuação 253 - 09/03/2026)
- Continuidade do Bloco 3 (`Integrations/Auth`) com foco no residual de maior impacto em `generateTradingSignalFromLlm`:
  - novo módulo `apps/integrations-service/src/trading-llm-signal-generation-service.ts` criado para centralizar a orquestração principal de geração de sinais LLM:
    - governança de profile/timeframes/indicators/técnicas e validações de arbitragem;
    - construção de contexto de análise e contexto operacional;
    - composição de prompt budget e chamada de inferência LLM;
    - parse/pós-processamento, persistência e validação final de sinal.
  - `apps/integrations-service/src/index.ts` atualizado para:
    - consumir `createTradingLlmSignalGenerationService(...)`;
    - delegar `generateTradingSignalFromLlm(...)` para `generateTradingSignalFromLlmCore(...)`;
    - remover bloco inline equivalente mantendo `index.ts` como composition root mais fino.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 253)
1. `npx pnpm --filter @alice/integrations-service typecheck`
2. `npx pnpm --filter @alice/integrations-service test`
3. `npx pnpm --filter @alice/integrations-service lint`
4. `npx pnpm --filter @alice/integrations-service build`

### Próximo foco atualizado (continuação 253)
- Retomar pendências residuais P2 de maior impacto em Frontend, começando por `Chat/index.tsx` (handlers/scroll/seleção) para reduzir densidade do composition root.
- Em seguida, seguir nos residuais restantes de `Trading.tsx` e fechamento de composição de queries/filtros em `WisePayments.tsx` até convergir ao 100% do plano.

### Escopo entregue nesta rodada (continuação 254 - 09/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco no residual de Chat (`handlers/scroll/seleção`) em `apps/frontend-service/src/pages/Chat/index.tsx`:
  - novo módulo `apps/frontend-service/src/pages/Chat/chat-page-layout-props-builder.ts` criado para centralizar composição tipada de `ChatPageLayout` por blocos:
    - `state` (estado de tela/composer/stream/drawer/workspace);
    - `sections` (props de sidebar/header/dialogs/workspace);
    - `viewport` (mensagens + refs de scroll + seleção);
    - `handlers` (ações de UI/composer/feedback/seleção/workspace).
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para:
    - consumir `buildChatPageLayoutProps(...)`;
    - remover bloco inline equivalente de montagem final do `ChatPageLayout`;
    - eliminar cast de workspace em `onWorkspaceChange`.
  - tipagem de workspace endurecida:
    - `apps/frontend-service/src/pages/Chat/components/ChatWorkspaceSection.tsx` atualizado para `ChatWorkspaceKey` em `activeWorkspace`, `onWorkspaceChange` e `workspaceOptions.value`;
    - `apps/frontend-service/src/pages/Chat/components/ChatPageLayout.tsx` atualizado para aceitar `onWorkspaceChange: (workspace: ChatWorkspaceKey) => void`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural e hardening de tipagem.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 254)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 254)
- Seguir no residual de maior impacto em `apps/frontend-service/src/pages/Trading.tsx`, priorizando nova redução do composition root nos blocos de mutações/controle ainda agregados.
- Na sequência, validar fechamento final dos residuais de Frontend (`Trading` e `WisePayments`) para aproximação do 100% do plano.

### Escopo entregue nesta rodada (continuação 255 - 09/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco no residual de hardening em `Trading`:
  - `apps/frontend-service/src/components/trading/TradingDomainTypes.ts` evoluído com novos guards de domínio:
    - `isFuturesPositionArray`
    - `isSpotAccountArray`
    - `isFuturesAccountOverview`
    - `isMarginCrossOverview`
    - `isMarginIsolatedOverview`
  - `apps/frontend-service/src/components/trading/useTradingAccountPositionState.ts` atualizado para:
    - consumir os guards novos para conta/posições;
    - remover casts inline (`as MarginCrossAccount`, `as MarginIsolatedAccount`, `as SpotAccount[]`, `as FuturesAccountOverview`).
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para:
    - consumir `isFuturesPositionArray(...)` na derivação de `futuresPositions`;
    - remover cast inline residual (`as Position[]`).
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar os novos guards via barrel.
  - sem alteração de payloads, contratos de API ou RBAC; somente hardening de tipagem e redução de risco de regressão silenciosa.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 255)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 255)
- Seguir redução residual de maior impacto no `apps/frontend-service/src/pages/Trading.tsx`, priorizando desacoplamento adicional de composições de props/mutações ainda extensas no composition root.
- Em seguida, consolidar fechamento final de pendências residuais de Frontend (`Trading` + conferência final de `WisePayments`) para convergência ao 100% do plano.

### Escopo entregue nesta rodada (continuação 256 - 09/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco no residual de mutações de controle/ordens em Trading:
  - novo módulo `apps/frontend-service/src/components/trading/trading-control-order-types.ts` criado para centralizar contratos tipados compartilhados de mutações (`UseTradingControlOrderMutationsOptions`, `ReviewOrderUpdates`, `TradingOrderExecutionMutationOptions`, `TradingRiskControlMutationOptions`).
  - novo módulo `apps/frontend-service/src/components/trading/useTradingOrderExecutionMutations.ts` criado para centralizar:
    - `createOrderMutation`
    - `cancelOrderMutation`
    - `syncOrdersMutation`
  - novo módulo `apps/frontend-service/src/components/trading/useTradingRiskControlActions.ts` criado para centralizar:
    - `updateRiskConfigMutation`
    - `handleModeChange`
    - `handleTradingToggle`
  - `apps/frontend-service/src/components/trading/useTradingControlOrderMutations.ts` atualizado para:
    - atuar como composition root fino;
    - delegar execução de ordens para `useTradingOrderExecutionMutations(...)`;
    - delegar controle/risco para `useTradingRiskControlActions(...)`;
    - preservar contrato consumido por `useTradingControlOrderActionSuite` e `Trading.tsx`.
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar os novos módulos e tipos compartilhados.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 256)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 256)
- Seguir com o próximo residual de maior impacto em `apps/frontend-service/src/pages/Trading.tsx`, priorizando nova redução do composition root na composição extensa de section-props.
- Em seguida, consolidar conferência final de pendências residuais em `WisePayments` e fechar checklist para convergência ao 100% do plano.

### Escopo entregue nesta rodada (continuação 257 - 09/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco no residual de mutações account/card/dispute em WisePayments:
  - novo módulo `apps/frontend-service/src/pages/wise-payments/wise-account-card-dispute-types.ts` criado para centralizar contratos tipados compartilhados:
    - `NotifyFn`, `ParseJsonFn`, `WiseFilePayload`;
    - `WiseDisputeStatusUpdate`, `WiseDisputeFlowForm`;
    - `UseWiseAccountCardDisputeActionsOptions` e `UseWiseAccountCardDisputeActionsResult`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-mutations.ts` criado para centralizar mutações operacionais de:
    - `account details` (`createAccountDetailsOrderMutation`);
    - `card orders` (`create/update/status/availability/details/requirements/validate/pin`);
    - `card transactions` (`getCardTransactionMutation`);
    - `disputes` (`flow step/flow submit/upload/status`);
    - `kyc` (`required evidences/upload document/upload additional`).
  - `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-actions.ts` atualizado para:
    - atuar como composition root fino de estado e handlers;
    - delegar a camada de IO/mutation para `useWiseAccountCardDisputeMutations(...)`;
    - preservar contratos consumidos por `useWisePageComposition` e `WisePayments.tsx`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural e hardening de tipagem.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 257)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 257)
- Seguir com o próximo residual de maior impacto em `apps/frontend-service/src/pages/Trading.tsx`, priorizando desacoplamento final da composição de section-props e handlers operacionais ainda densos no container.
- Em seguida, concluir varredura final de `WisePayments.tsx` e `Chat/index.tsx` para fechamento formal das pendências P2 rumo a 100% do plano.

### Escopo entregue nesta rodada (continuação 258 - 09/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco no residual de composição de section-props em `Trading.tsx`:
  - novo módulo `apps/frontend-service/src/components/trading/TradingPageSectionProps.ts` criado para centralizar composição agregada de:
    - `primaryTabsSectionProps`;
    - `operationalTabsSectionProps`;
    - `dialogsSectionProps`;
    - `layout section-props` (`header`, `operational alerts`, `stats` e `tabs shell`).
  - `apps/frontend-service/src/pages/Trading.tsx` atualizado para:
    - consumir `buildTradingPageSectionProps(...)` como boundary único de assembly de props de render;
    - remover chamadas diretas repetidas de `buildTradingPrimaryTabsSectionProps`, `buildTradingOperationalTabsSectionProps`, `buildTradingDialogsSectionProps` e `buildTradingLayoutSectionProps`;
    - manter o composition root focado em estado/queries/handlers sem alteração de contratos.
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar `buildTradingPageSectionProps` via barrel.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de composição.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 258)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 258)
- Seguir com o próximo residual de maior impacto em `apps/frontend-service/src/pages/Trading.tsx`, priorizando desacoplamento final de handlers/memoizações operacionais ainda distribuídos no container.
- Em seguida, retomar varredura final de `Chat/index.tsx` e `WisePayments.tsx` para fechamento formal das pendências P2 rumo a 100% do plano.

### Escopo entregue nesta rodada (continuação 259 - 09/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco no residual de composição/orquestração em `Chat/index.tsx`:
  - novo módulo `apps/frontend-service/src/pages/Chat/useChatPageLayoutController.ts` criado para centralizar:
    - orquestração de hooks de estado local, queries, routing, seleção, streaming e handlers;
    - composição final de `chatPageLayoutProps` com `buildChatPageLayoutProps(...)`.
  - `apps/frontend-service/src/pages/Chat/index.tsx` atualizado para:
    - atuar como composition root fino;
    - consumir `useChatPageLayoutController()` e renderizar `ChatPageLayout`;
    - remover orquestração inline equivalente de alta densidade.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural da página.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 259)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 259)
- Seguir com o próximo residual de maior impacto em `apps/frontend-service/src/pages/Trading.tsx`, priorizando desacoplamento final de handlers/memoizações operacionais ainda distribuídos no container.
- Em seguida, concluir varredura final de `WisePayments.tsx` e checklist objetivo de fechamento P2 rumo a 100% do plano.

### Escopo entregue nesta rodada (continuação 260 - 10/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco no residual estrutural de maior impacto em Trading:
  - novo módulo `apps/frontend-service/src/pages/TradingContent.tsx` criado para concentrar a composição completa da página (`state`, `queries`, `mutations`, `handlers` e render das seções/tabs/dialogs).
  - `apps/frontend-service/src/pages/Trading.tsx` reescrito como wrapper fino de autenticação/autorização:
    - mantém `useAuth`, `useTradingPermissionsQuery`, `hasPermission` e estados de `loading/auth forbidden`;
    - monta `TradingContent` somente após validação de sessão e permissão `integrations:trading:read`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do composition root.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 260)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 260)
- Seguir no próximo residual P2 de maior impacto em `WisePayments` para fechamento de composição final de queries/filtros e redução de acoplamento remanescente.
- Em seguida, executar varredura final cruzada (`Trading` + `Chat` + `WisePayments`) para convergência ao fechamento integral do plano.

### Escopo entregue nesta rodada (continuação 261 - 10/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco no residual de composição de queries/filtros em WisePayments:
  - novo módulo `apps/frontend-service/src/pages/wise-payments/use-wise-query-hooks.ts` criado para centralizar hooks reutilizáveis de consulta:
    - `useWiseApiQuery<TResponse>` para endpoints Wise globais;
    - `useWiseProfileScopedQuery<TResponse>` para endpoints profile-scoped com `profileFilter`, `queryKeyParts` e `queryParams`.
  - `apps/frontend-service/src/pages/wise-payments/use-wise-data-queries.ts` atualizado para:
    - consumir os hooks reutilizáveis e remover duplicação de blocos `useQuery`/`queryFn`;
    - manter contratos existentes de paginação (`cardOrdersPage`) e filtro (`profileFilter`) sem alteração funcional.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural e padronização de queries.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 261)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 261)
- Seguir com varredura final de residuais em `WisePayments` para identificar o próximo módulo de maior densidade (`use-wise-card-spend-actions.ts` ou `use-wise-webhook-simulation-sca-actions.ts`).
- Em seguida, consolidar checklist cruzado final de `Trading`, `Chat` e `WisePayments` para avanço ao fechamento integral do plano.

### Escopo entregue nesta rodada (continuação 262 - 10/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco no residual de maior densidade em `use-wise-card-spend-actions.ts`:
  - novo módulo `apps/frontend-service/src/pages/wise-payments/wise-card-spend-types.ts` criado para centralizar contratos e defaults do domínio spend/card (`NotifyFn`, `ParseJsonSafeFn`, `SpendControlForm`, `SpendControlAssignment`, options/result e constantes iniciais).
  - novo módulo `apps/frontend-service/src/pages/wise-payments/use-wise-card-spend-mutations.ts` criado para centralizar mutações de:
    - status de cartão;
    - spend-controls (create/assign/unassign/delete);
    - spend-limits (profile/card fetch/update/delete).
  - `apps/frontend-service/src/pages/wise-payments/use-wise-card-spend-actions.ts` atualizado para:
    - atuar como composition root fino de estado e handlers de UI;
    - delegar camada de mutation para `useWiseCardSpendMutations(...)`;
    - preservar contratos consumidos por `useWisePageComposition` e `WisePayments`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural e hardening de organização do domínio.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 262)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 262)
- Seguir para o próximo residual de maior impacto em WisePayments (`use-wise-webhook-simulation-sca-actions.ts`), mantendo o padrão de split em `types + mutations + actions`.
- Em seguida, consolidar varredura final de pendências P2 em `Trading`, `Chat` e `WisePayments` para aproximação do fechamento integral do plano.

### Escopo entregue nesta rodada (continuação 263 - 10/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco no residual de maior impacto em `use-wise-webhook-simulation-sca-actions.ts`:
  - novo módulo `apps/frontend-service/src/pages/wise-payments/wise-webhook-simulation-sca-types.ts` criado para centralizar contratos/defaults de webhook/simulation/SCA (`NotifyFn`, `JsonParser`, `WiseSimulation*`, options/result e estados iniciais).
  - novo módulo `apps/frontend-service/src/pages/wise-payments/use-wise-webhook-simulation-sca-mutations.ts` criado para centralizar mutações de:
    - webhooks (`list/create/delete`);
    - simulações Wise (`transfer/profile/card/kyc/bank import`);
    - SCA (`POST/DELETE` com payload JOSE opcional).
  - `apps/frontend-service/src/pages/wise-payments/use-wise-webhook-simulation-sca-actions.ts` atualizado para:
    - atuar como composition root fino de estado e handlers;
    - delegar IO/mutações para `useWiseWebhookSimulationScaMutations(...)`;
    - preservar contratos consumidos por `useWisePageComposition`/`useWiseTabProps`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural e padronização do domínio.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 263)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 263)
- Seguir para o próximo residual de maior densidade em WisePayments (provável `use-wise-balance-exchange-statement-actions.ts`), mantendo o padrão `types + mutations + actions`.
- Em seguida, consolidar varredura cruzada de fechamento dos residuais P2 em `Trading`, `Chat` e `WisePayments`.

### Escopo entregue nesta rodada (continuação 264 - 10/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco no residual de maior densidade em `use-wise-balance-exchange-statement-actions.ts`:
  - novo módulo `apps/frontend-service/src/pages/wise-payments/wise-balance-exchange-statement-types.ts` criado para centralizar contratos/defaults de `quote`, `exchange`, `statement` e `new balance`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/use-wise-balance-exchange-statement-mutations.ts` criado para centralizar mutações de:
    - quote (`/quotes`);
    - balances (`create/delete`);
    - exchange (`balance-quotes` e `balance-movements`);
    - statement (`GET /balances/:id/statement`).
  - `apps/frontend-service/src/pages/wise-payments/use-wise-balance-exchange-statement-actions.ts` atualizado para:
    - atuar como composition root fino de estado e handlers;
    - delegar camada de mutation para `useWiseBalanceExchangeStatementMutations(...)`;
    - preservar contratos consumidos por `useWisePageComposition` e tabs Wise.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural e padronização do domínio.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 264)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 264)
- Seguir para o próximo residual de maior densidade em WisePayments (`use-wise-transfer-and-card-actions.ts` ou `use-wise-account-card-dispute-actions.ts`) mantendo padrão de decomposição.
- Em seguida, consolidar varredura cruzada final para fechamento integral das pendências P2 em `Trading`, `Chat` e `WisePayments`.

### Escopo entregue nesta rodada (continuação 265 - 10/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco no residual de `use-wise-transfer-and-card-actions.ts`:
  - novo módulo `apps/frontend-service/src/pages/wise-payments/wise-transfer-and-card-types.ts` criado para centralizar contratos de `transfer/card actions`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/use-wise-transfer-and-card-operations.ts` criado para centralizar operações:
    - transferências (`fund`/`cancel`);
    - permissões de cartão (`fetch/update/bulk update`);
    - secure endpoints de cartão (`encryption-key`, `details`, `pin`).
  - `apps/frontend-service/src/pages/wise-payments/use-wise-transfer-and-card-actions.ts` atualizado para:
    - atuar como composition root de estado/composição;
    - delegar execução operacional ao módulo dedicado;
    - preservar contratos consumidos por `useWisePageComposition`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural e redução de densidade.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 265)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 265)
- Seguir para o próximo residual de maior densidade em WisePayments (`use-wise-account-card-dispute-actions.ts`) com padrão `types + mutations + actions` quando aplicável.
- Em seguida, consolidar nova varredura cruzada dos residuais P2 em `Trading`, `Chat` e `WisePayments`.

### Escopo entregue nesta rodada (continuação 266 - 10/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco no residual de `use-wise-account-card-dispute-mutations.ts`:
  - novo módulo `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-card-order-mutations.ts` criado para centralizar mutações de:
    - `account details`;
    - `card orders` (`create/update/availability/details/requirements/validate address/preset pin`);
    - `card transactions` (`get transaction`).
  - novo módulo `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-dispute-kyc-mutations.ts` criado para centralizar mutações de:
    - `dispute status`;
    - `dispute flow` (`step/submit`);
    - `dispute upload`;
    - `kyc required evidences` e `kyc uploads`.
  - `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-mutations.ts` atualizado para:
    - atuar como composition root fino;
    - compor `useWiseAccountCardDisputeCardOrderMutations(...)` + `useWiseAccountCardDisputeDisputeKycMutations(...)`;
    - preservar contrato consumido por `use-wise-account-card-dispute-actions.ts`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural por subdomínio.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 266)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 266)
- Seguir no próximo residual de maior impacto em WisePayments, priorizando redução de densidade em `use-wise-data-queries.ts` e `use-wise-webhook-simulation-sca-mutations.ts` por subdomínio.
- Em seguida, executar varredura cruzada final de `Trading`, `Chat` e `WisePayments` para fechamento formal das pendências residuais P2.

### Escopo entregue nesta rodada (continuação 267 - 10/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco no residual de `use-wise-data-queries.ts`:
  - novo módulo `apps/frontend-service/src/pages/wise-payments/use-wise-global-data-queries.ts` criado para centralizar queries globais:
    - `balances`;
    - `transfers`;
    - `recipients`;
    - `batch groups`;
    - `profiles`;
    - `users me`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/use-wise-profile-scoped-data-queries.ts` criado para centralizar queries profile-scoped:
    - `cards`;
    - `spend-controls`;
    - `disputes`;
    - `kyc reviews`;
    - `card-orders` (com `pageNumber/pageSize`);
    - `dispute-reasons`;
    - `account-details` e `account-details/orders`.
  - `apps/frontend-service/src/pages/wise-payments/use-wise-data-queries.ts` atualizado para:
    - atuar como composition root fino de estado (`profileFilter`, `cardOrdersPage`) e guard (`wiseQueryEnabled`);
    - delegar consultas globais/profile-scoped para os módulos dedicados;
    - manter tratamento agregado de erro e preservar contrato público consumido por `useWisePageComposition`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural por escopo de query.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 267)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 267)
- Seguir no próximo residual de maior impacto em WisePayments, priorizando a decomposição de `use-wise-webhook-simulation-sca-mutations.ts` por subdomínio operacional.
- Em seguida, consolidar varredura cruzada final de `Trading`, `Chat` e `WisePayments` para convergir ao fechamento formal das pendências P2.

### Escopo entregue nesta rodada (continuação 268 - 10/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco no residual de `use-wise-webhook-simulation-sca-mutations.ts`:
  - novo módulo `apps/frontend-service/src/pages/wise-payments/use-wise-webhook-mutations.ts` criado para centralizar mutações de webhook:
    - `list`;
    - `create`;
    - `delete`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/use-wise-simulation-mutations.ts` criado para centralizar mutações de simulação:
    - `transferState`;
    - `profileVerification`;
    - `balanceTopup`;
    - `cardTransaction/cardAuthorisation/cardRefund/cardProduction/cardRecent`;
    - `kycRequirements`;
    - `bankImport`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/use-wise-sca-mutations.ts` criado para centralizar mutações de SCA:
    - `runScaMutation` (`POST`);
    - `runScaDeleteMutation` (`DELETE`).
  - `apps/frontend-service/src/pages/wise-payments/use-wise-webhook-simulation-sca-mutations.ts` atualizado para:
    - atuar como composition root fino;
    - compor `useWiseWebhookMutations`, `useWiseSimulationMutations` e `useWiseScaMutations`;
    - preservar contrato consumido por `use-wise-webhook-simulation-sca-actions.ts`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural por subdomínio.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 268)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 268)
- Seguir no próximo residual de maior impacto em WisePayments, priorizando a decomposição de `use-wise-card-spend-mutations.ts` por subdomínio operacional.
- Em seguida, executar varredura cruzada final de `Trading`, `Chat` e `WisePayments` para fechamento formal das pendências P2.

### Escopo entregue nesta rodada (continuação 269 - 10/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco no residual de `use-wise-card-spend-mutations.ts`:
  - novo módulo `apps/frontend-service/src/pages/wise-payments/use-wise-card-status-mutations.ts` criado para centralizar `updateCardStatusMutation`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/use-wise-spend-control-mutations.ts` criado para centralizar:
    - `createSpendControlMutation`;
    - `assignSpendControlMutation`;
    - `deleteSpendControlMutation`;
    - `unassignSpendControlMutation`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/use-wise-spend-limits-mutations.ts` criado para centralizar:
    - `get/update spend limits` de profile;
    - `get/update/delete spend limits` de card.
  - `apps/frontend-service/src/pages/wise-payments/use-wise-card-spend-mutations.ts` atualizado para:
    - atuar como composition root fino;
    - compor os três módulos especializados (`card-status`, `spend-control`, `spend-limits`);
    - preservar contrato consumido por `use-wise-card-spend-actions.ts`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural por subdomínio.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 269)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 269)
- Seguir no próximo residual de maior impacto em WisePayments, priorizando redução de densidade de `use-wise-transfer-and-card-operations.ts` por subdomínios operacionais internos.
- Em seguida, executar varredura cruzada final de `Trading`, `Chat` e `WisePayments` para fechamento formal das pendências P2.

### Escopo entregue nesta rodada (continuação 270 - 10/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco no residual de `use-wise-transfer-and-card-operations.ts`:
  - novo módulo `apps/frontend-service/src/pages/wise-payments/use-wise-transfer-operations.ts` criado para centralizar:
    - `handleFundTransfer`;
    - `handleCancelTransfer`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/use-wise-card-permission-secure-operations.ts` criado para centralizar:
    - `handleFetchCardPermissions`;
    - `handleUpdateCardPermissions`;
    - `handleUpdateCardPermissionsBulk`;
    - `handleFetchCardSecureKey`;
    - `handleFetchCardSecureDetails`;
    - `handleFetchCardSecurePin`.
  - `apps/frontend-service/src/pages/wise-payments/use-wise-transfer-and-card-operations.ts` atualizado para:
    - atuar como composition root fino;
    - compor os dois submódulos de operações (`transfer` e `card permission/secure`);
    - preservar contrato consumido por `use-wise-transfer-and-card-actions.ts`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural por subdomínio operacional.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 270)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 270)
- Seguir com varredura residual de maior impacto no domínio WisePayments, priorizando redução de densidade em `use-wise-account-card-dispute-card-order-mutations.ts`.
- Em seguida, executar varredura cruzada final de `Trading`, `Chat` e `WisePayments` para fechamento formal das pendências P2.

### Escopo entregue nesta rodada (continuação 271 - 10/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco no residual de `use-wise-account-card-dispute-card-order-mutations.ts`:
  - novo módulo `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-order-mutations.ts` criado para centralizar mutações de:
    - `account details`;
    - `card orders` (`create/update/availability/details/requirements/validate address/preset pin`).
  - novo módulo `apps/frontend-service/src/pages/wise-payments/use-wise-card-transaction-mutation.ts` criado para centralizar mutação de:
    - `card transaction details` por `transactionId`.
  - `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-card-order-mutations.ts` atualizado para:
    - atuar como composition root fino;
    - compor os dois submódulos (`account/card-order` e `card-transaction`);
    - preservar contrato consumido por `use-wise-account-card-dispute-mutations.ts`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural por subdomínio.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 271)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 271)
- Seguir com varredura residual de maior impacto no domínio WisePayments, priorizando redução de densidade em `use-wise-account-card-dispute-dispute-kyc-mutations.ts`.
- Em seguida, executar varredura cruzada final de `Trading`, `Chat` e `WisePayments` para fechamento formal das pendências P2.

### Escopo entregue nesta rodada (continuação 272 - 10/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco no residual de `use-wise-account-card-dispute-dispute-kyc-mutations.ts`:
  - novo módulo `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-flow-mutations.ts` criado para centralizar mutações de:
    - `dispute status`;
    - `dispute flow` (`step/submit`);
    - `dispute upload`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-kyc-mutations.ts` criado para centralizar mutações de:
    - `kyc required evidences`;
    - `kyc upload document`;
    - `kyc upload additional evidences`.
  - `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-dispute-kyc-mutations.ts` atualizado para:
    - atuar como composition root fino;
    - compor os dois submódulos (`dispute flow` e `kyc`);
    - preservar contrato consumido por `use-wise-account-card-dispute-mutations.ts`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural por subdomínio.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 272)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 272)
- Executar varredura de fechamento de pendências residuais em `WisePayments` para identificar próximo hook de maior densidade e manter o padrão `composition root + subdomínios`.
- Em seguida, consolidar varredura cruzada final de `Trading`, `Chat` e `WisePayments` para fechamento formal das pendências P2.

### Escopo entregue nesta rodada (continuação 273 - 10/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco no residual de `use-wise-account-card-dispute-actions.ts`:
  - novo módulo `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-order-action-handlers.ts` criado para centralizar handlers de:
    - `account details`;
    - `card orders` (`create/update/details/requirements/availability/validate/pin`);
    - `card transaction details`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/use-wise-dispute-kyc-action-handlers.ts` criado para centralizar handlers de:
    - `dispute status`;
    - `dispute flow` (`step/submit`);
    - `dispute upload`;
    - `kyc required evidences` e uploads.
  - `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-actions.ts` atualizado para:
    - atuar como composition root fino de estado local;
    - delegar callbacks para os dois módulos de handlers;
    - preservar contrato consumido por `useWisePageComposition`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de handlers por subdomínio.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 273)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 273)
- Seguir com varredura residual de maior impacto em `WisePayments`, priorizando redução de densidade de `build-wise-operational-tabs-props.ts` e `build-wise-profile-tabs-props.ts`.
- Em seguida, consolidar varredura cruzada final de `Trading`, `Chat` e `WisePayments` para fechamento formal das pendências P2.

### Escopo entregue nesta rodada (continuação 274 - 10/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco no residual de `build-wise-operational-tabs-props.ts`:
  - novo módulo `apps/frontend-service/src/pages/wise-payments/build-wise-operational-finance-tabs-props.ts` criado para centralizar composição de props de tabs:
    - `balances`;
    - `exchange`;
    - `transfers`;
    - `recipients`;
    - `quotes`;
    - `batch`;
    - `statements`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/build-wise-operational-admin-tabs-props.ts` criado para centralizar composição de props de tabs:
    - `profiles`;
    - `users`;
    - `activities`;
    - `spend-limits`;
    - `catalog`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/wise-operational-tabs-props-types.ts` criado para centralizar contratos tipados compartilhados das tabs operacionais.
  - `apps/frontend-service/src/pages/wise-payments/build-wise-operational-tabs-props.ts` atualizado para:
    - atuar como composition root fino;
    - compor os dois builders por domínio (`finance` e `admin`);
    - preservar contrato consumido por `use-wise-tab-props.ts`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural da camada de composição.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 274)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 274)
- Seguir com varredura residual de maior impacto em `WisePayments`, priorizando decomposição de `build-wise-profile-tabs-props.ts`.
- Em seguida, consolidar varredura cruzada final de `Trading`, `Chat` e `WisePayments` para fechamento formal das pendências P2.

### Escopo entregue nesta rodada (continuação 275 - 10/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco no residual de `build-wise-profile-tabs-props.ts`:
  - novo módulo `apps/frontend-service/src/pages/wise-payments/build-wise-profile-core-tabs-props.ts` criado para centralizar composição de props de tabs:
    - `account-details`;
    - `cards`;
    - `card-orders`;
    - `card-transactions`;
    - `spend-controls`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/build-wise-profile-compliance-tabs-props.ts` criado para centralizar composição de props de tabs:
    - `disputes`;
    - `kyc`;
    - `webhooks`;
    - `simulations`;
    - `sca`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/wise-profile-tabs-props-types.ts` criado para centralizar contratos tipados compartilhados das tabs profile-scoped.
  - `apps/frontend-service/src/pages/wise-payments/build-wise-profile-tabs-props.ts` atualizado para:
    - atuar como composition root fino;
    - compor os dois builders por domínio (`core` e `compliance`);
    - preservar contrato consumido por `use-wise-tab-props.ts`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural da camada de composição.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 275)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 275)
- Seguir com varredura residual de fechamento em `WisePayments`, priorizando `use-wise-tab-props.ts` e `wise-payments-constants.tsx` para reduzir densidade final de composição.
- Em seguida, consolidar varredura cruzada final de `Trading`, `Chat` e `WisePayments` para fechamento formal das pendências P2.

### Escopo entregue nesta rodada (continuação 276 - 10/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco nos residuais `use-wise-tab-props.ts` e `wise-payments-constants.tsx`:
  - novo módulo `apps/frontend-service/src/pages/wise-payments/wise-tab-props-types.ts` criado para centralizar contratos tipados de composição de tabs Wise.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/build-wise-profile-scoped-tab-props.ts` criado para centralizar derivação profile-scoped (`profileFilter/profiles/setProfileFilter`).
  - novo módulo `apps/frontend-service/src/pages/wise-payments/build-wise-tab-profile-props.ts` criado para centralizar wiring do domínio profile-scoped.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/build-wise-tab-operational-props.ts` criado para centralizar wiring do domínio operacional.
  - `apps/frontend-service/src/pages/wise-payments/use-wise-tab-props.ts` atualizado para atuar como composition root fino, delegando montagem de tabs para os builders dedicados por escopo.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/wise-catalog-operations.ts` criado para centralizar catálogo/tipos de operações Wise.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/wise-currency-options.ts` criado para centralizar catálogo de moedas reutilizáveis.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/wise-status-badge.tsx` criado para centralizar renderização de badges de status Wise.
  - `apps/frontend-service/src/pages/wise-payments/wise-payments-constants.tsx` atualizado para atuar como barrel de constants tipadas por subdomínio.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural final da camada de composição/constants.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 276)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 276)
- Seguir com fechamento residual em `WisePayments`, priorizando redução de duplicação de contratos tipados em `use-wise-catalog-workbench.ts` e `components/wise-catalog-tab-content.tsx`.
- Em seguida, consolidar varredura cruzada final de `Trading`, `Chat` e `WisePayments` para fechamento formal das pendências P2.

### Escopo entregue nesta rodada (continuação 277 - 10/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco no residual de contratos de catálogo em `WisePayments`:
  - novo módulo `apps/frontend-service/src/pages/wise-payments/wise-catalog-types.ts` criado para centralizar contratos compartilhados:
    - `WiseCatalogOperation`;
    - `WiseCatalogParamKey`;
    - `WiseCatalogParams`.
  - `apps/frontend-service/src/pages/wise-payments/use-wise-catalog-workbench.ts` atualizado para:
    - consumir contratos compartilhados;
    - remover duplicação local de tipos de catálogo.
  - `apps/frontend-service/src/pages/wise-payments/components/wise-catalog-tab-content.tsx` atualizado para:
    - consumir contratos compartilhados;
    - remover duplicação local de tipos de catálogo na camada de apresentação.
  - sem alteração de payloads, contratos de API ou RBAC; somente centralização tipada e redução de drift entre hooks/componentes.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 277)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 277)
- Executar varredura residual final em `WisePayments` para identificar e eliminar duplicações tipadas remanescentes entre hooks/componentes, priorizando contratos com potencial de drift operacional.
- Em seguida, consolidar varredura cruzada final de `Trading`, `Chat` e `WisePayments` para fechamento formal das pendências P2.

### Escopo entregue nesta rodada (continuação 278 - 10/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco no residual de `use-wise-card-spend-actions.ts`:
  - novo módulo `apps/frontend-service/src/pages/wise-payments/use-wise-card-spend-control-handlers.ts` criado para centralizar handlers de:
    - `update card status`;
    - `create/assign/unassign/delete spend control`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/use-wise-card-spend-limits-handlers.ts` criado para centralizar handlers de:
    - `fetch/update spend limits profile`;
    - `fetch/update/delete spend limits card`.
  - `apps/frontend-service/src/pages/wise-payments/use-wise-card-spend-actions.ts` atualizado para:
    - atuar como composition root fino de estado + mutações + wiring de handlers por subdomínio;
    - preservar contrato consumido por `useWisePageComposition`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural dos handlers de domínio.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 278)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 278)
- Seguir com varredura residual de maior impacto em `WisePayments`, priorizando redução de densidade em `use-wise-page-composition.ts` e consolidação de contratos de composição entre hooks de actions.
- Em seguida, consolidar varredura cruzada final de `Trading`, `Chat` e `WisePayments` para fechamento formal das pendências P2.

### Escopo entregue nesta rodada (continuação 279 - 10/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco no residual de `use-wise-page-composition.ts`:
  - novo módulo `apps/frontend-service/src/pages/wise-payments/use-wise-actions-suite.ts` criado para centralizar wiring de ações por domínio:
    - `reference`;
    - `catalog`;
    - `recipient`;
    - `card-spend`;
    - `transfer/card`;
    - `webhook/simulation/sca`;
    - `account/dispute`;
    - `user activity`;
    - `balance/exchange`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/use-wise-refresh-derived.ts` criado para centralizar:
    - composição de `refreshActions`;
    - composição de `derivedData`.
  - `apps/frontend-service/src/pages/wise-payments/use-wise-page-composition.ts` atualizado para:
    - atuar como composition root mais fino;
    - delegar suites de actions e refresh/derived;
    - preservar contrato consumido por `apps/frontend-service/src/pages/WisePayments.tsx`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural do container de composição.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 279)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 279)
- Seguir com varredura residual de maior impacto em `WisePayments`, priorizando redução de densidade em `use-wise-account-card-dispute-actions.ts` e `use-wise-account-card-order-mutations.ts`.
- Em seguida, consolidar varredura cruzada final de `Trading`, `Chat` e `WisePayments` para fechamento formal das pendências P2.

### Escopo entregue nesta rodada (continuação 280 - 10/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco nos residuais `use-wise-account-card-order-mutations.ts` e `use-wise-account-card-dispute-actions.ts`:
  - novo módulo `apps/frontend-service/src/pages/wise-payments/use-wise-account-details-order-mutation.ts` criado para centralizar mutação de:
    - `account details orders`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/use-wise-card-order-write-mutations.ts` criado para centralizar mutações de:
    - `create card order`;
    - `update card order status`;
    - `validate card order address`;
    - `preset card order pin`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/use-wise-card-order-read-mutations.ts` criado para centralizar mutações de leitura de:
    - `card order availability`;
    - `card order details`;
    - `card order requirements`.
  - `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-order-mutations.ts` atualizado para:
    - atuar como composition root fino;
    - compor os três submódulos de mutações (`account details`, `card order write`, `card order read`);
    - preservar contrato consumido por `use-wise-account-card-dispute-card-order-mutations.ts`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-state.ts` criado para centralizar estado local de:
    - `account/card/dispute/kyc`.
  - `apps/frontend-service/src/pages/wise-payments/use-wise-account-card-dispute-actions.ts` atualizado para:
    - consumir o estado local via hook dedicado;
    - manter foco em orchestration de mutações e handlers;
    - preservar contrato consumido por `useWisePageComposition`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural de state/mutations por subdomínio.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 280)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 280)
- Seguir com varredura residual de maior impacto em `WisePayments`, priorizando redução de densidade em `components/wise-card-orders-tab-content.tsx` e `components/wise-recipients-tab-content.tsx`.
- Em seguida, consolidar varredura cruzada final de `Trading`, `Chat` e `WisePayments` para fechamento formal das pendências P2.

### Escopo entregue nesta rodada (continuação 281 - 10/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco no residual de `components/wise-card-orders-tab-content.tsx`:
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-card-orders-tab-types.ts` criado para centralizar contratos tipados compartilhados da tab:
    - `WiseProfileOption`;
    - `CardOrdersPageState`;
    - `WiseCardOrder`;
    - `WiseCardOrdersTabContentProps`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-card-orders-toolbar.tsx` criado para centralizar:
    - filtro de profile;
    - paginação (`page`/`pageSize`);
    - ação de refresh.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-card-orders-create-card.tsx` criado para centralizar:
    - formulário de criação de card order.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-card-orders-actions-card.tsx` criado para centralizar:
    - ações de consulta/atualização de order;
    - payloads de status/address/pin;
    - bloco de response.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-card-orders-list-card.tsx` criado para centralizar:
    - estados visuais (`missing profile`, `loading`, `empty`);
    - tabela de listagem de orders.
  - `apps/frontend-service/src/pages/wise-payments/components/wise-card-orders-tab-content.tsx` atualizado para:
    - atuar como composition root fino;
    - compor os subcomponentes de toolbar/create/actions/list;
    - preservar contrato consumido por `build-wise-profile-core-tabs-props.ts`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural da camada de UI por subdomínio.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 281)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 281)
- Seguir com varredura residual de maior impacto em `WisePayments`, priorizando redução de densidade em `components/wise-recipients-tab-content.tsx`.
- Em seguida, consolidar varredura cruzada final de `Trading`, `Chat` e `WisePayments` para fechamento formal das pendências P2.

### Escopo entregue nesta rodada (continuação 282 - 10/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco no residual de `components/wise-recipients-tab-content.tsx`:
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-recipients-tab-types.ts` criado para centralizar contratos tipados compartilhados da tab:
    - `CurrencyOption`;
    - `WiseRecipient`;
    - `WiseRecipientsTabContentProps`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-recipients-header.tsx` criado para centralizar:
    - header da tab;
    - diálogo de criação de recipient.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-recipients-list-card.tsx` criado para centralizar:
    - estados visuais (`loading`/`empty`);
    - tabela de recipients com ação de delete.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-card-permissions-card.tsx` criado para centralizar:
    - formulário e ações de `card permissions`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-card-secure-card.tsx` criado para centralizar:
    - formulário e ações de `card secure`.
  - `apps/frontend-service/src/pages/wise-payments/components/wise-recipients-tab-content.tsx` atualizado para:
    - atuar como composition root fino;
    - compor os subcomponentes de header/list/permissions/secure;
    - preservar contrato consumido por `build-wise-operational-finance-tabs-props.ts`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural da camada de UI por subdomínio.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 282)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 282)
- Seguir com varredura residual de maior impacto em `WisePayments`, priorizando redução de densidade em `components/wise-spend-controls-tab-content.tsx`.
- Em seguida, consolidar varredura cruzada final de `Trading`, `Chat` e `WisePayments` para fechamento formal das pendências P2.

### Escopo entregue nesta rodada (continuação 283 - 10/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco no residual de `components/wise-spend-controls-tab-content.tsx`:
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-spend-controls-tab-types.ts` criado para centralizar contratos tipados compartilhados da tab:
    - `WiseProfileOption`;
    - `WiseCurrencyOption`;
    - `WiseSpendControl`;
    - `WiseSpendControlForm`;
    - `WiseSpendControlAssignment`;
    - `WiseSpendControlsTabContentProps`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-spend-controls-toolbar.tsx` criado para centralizar:
    - filtro de profile;
    - ação de refresh.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-spend-controls-create-card.tsx` criado para centralizar:
    - formulário de criação de spend control.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-spend-controls-assign-card.tsx` criado para centralizar:
    - formulário e ações de assign/unassign.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-spend-controls-delete-card.tsx` criado para centralizar:
    - formulário e ação de delete.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-spend-controls-list-card.tsx` criado para centralizar:
    - estados visuais (`missing profile`, `loading`, `empty`);
    - tabela de listagem de regras.
  - `apps/frontend-service/src/pages/wise-payments/components/wise-spend-controls-tab-content.tsx` atualizado para:
    - atuar como composition root fino;
    - compor subcomponentes de toolbar/create/assign/delete/list;
    - preservar contrato consumido por `build-wise-profile-core-tabs-props.ts`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural da camada de UI por subdomínio.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 283)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 283)
- Seguir com varredura residual de maior impacto em `WisePayments`, priorizando redução de densidade em `components/wise-disputes-tab-content.tsx`.
- Em seguida, consolidar varredura cruzada final de `Trading`, `Chat` e `WisePayments` para fechamento formal das pendências P2.

### Escopo entregue nesta rodada (continuação 284 - 10/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco no residual de `components/wise-disputes-tab-content.tsx`:
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-disputes-tab-types.ts` criado para centralizar contratos tipados compartilhados da tab:
    - `WiseProfileOption`;
    - `WiseDispute`;
    - `WiseDisputeFlowForm`;
    - `WiseDisputeStatusUpdate`;
    - `WiseDisputesTabContentProps`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-disputes-toolbar.tsx` criado para centralizar:
    - filtro de profile;
    - ação de refresh.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-dispute-reasons-card.tsx` criado para centralizar:
    - visualização de dispute reasons.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-dispute-flow-card.tsx` criado para centralizar:
    - formulário e ações do fluxo de dispute (`step`/`submit`).
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-dispute-upload-card.tsx` criado para centralizar:
    - upload de arquivo de dispute.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-dispute-status-update-card.tsx` criado para centralizar:
    - atualização de status de dispute.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-disputes-list-card.tsx` criado para centralizar:
    - estados visuais (`missing profile`, `loading`, `empty`);
    - tabela de listagem de disputes.
  - `apps/frontend-service/src/pages/wise-payments/components/wise-disputes-tab-content.tsx` atualizado para:
    - atuar como composition root fino;
    - compor subcomponentes de toolbar/reasons/flow/upload/update/list;
    - preservar contrato consumido por `build-wise-profile-compliance-tabs-props.ts`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural da camada de UI por subdomínio.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 284)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 284)
- Seguir com varredura residual de maior impacto em `WisePayments`, priorizando redução de densidade em `components/wise-balances-tab-content.tsx`.
- Em seguida, consolidar varredura cruzada final de `Trading`, `Chat` e `WisePayments` para fechamento formal das pendências P2.

### Escopo entregue nesta rodada (continuação 285 - 10/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco no residual de `components/wise-balances-tab-content.tsx`:
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-balances-tab-types.ts` criado para centralizar contratos tipados compartilhados da tab:
    - `CurrencyOption`;
    - `NewBalanceForm`;
    - `WiseBalanceCard`;
    - `WiseBalancesTabContentProps`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-balances-header.tsx` criado para centralizar:
    - header da tab;
    - diálogo de criação de balance (`currency/type/name`);
    - ações de `save/cancel`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-balances-grid.tsx` criado para centralizar:
    - estados visuais (`loading`, `empty`, `grid`);
    - listagem de balances com ação de delete.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-balance-capacity-card.tsx` criado para centralizar:
    - formulário e consulta de `balance-capacity`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-total-funds-card.tsx` criado para centralizar:
    - formulário e consulta de `total-funds`.
  - `apps/frontend-service/src/pages/wise-payments/components/wise-balances-tab-content.tsx` atualizado para:
    - atuar como composition root fino;
    - compor subcomponentes `header/grid/balance-capacity/total-funds`;
    - preservar comportamento e `data-testid` dos fluxos existentes.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural da camada de UI por subdomínio.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 285)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 285)
- Seguir com varredura residual de maior impacto em `WisePayments`, priorizando redução de densidade em `components/wise-transfers-tab-content.tsx` e `components/wise-exchange-tab-content.tsx`.
- Em seguida, consolidar varredura cruzada final de `Trading`, `Chat` e `WisePayments` para fechamento formal das pendências P2.

### Escopo entregue nesta rodada (continuação 286 - 10/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco nos residuais `components/wise-transfers-tab-content.tsx` e `components/wise-exchange-tab-content.tsx`:
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-transfers-tab-types.ts` criado para centralizar contratos tipados compartilhados da tab de transfers:
    - `WiseTransfer`;
    - `WiseTransfersTabContentProps`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-transfers-header.tsx` criado para centralizar:
    - header da tab;
    - ação visual de criação de transfer.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-transfers-list-card.tsx` criado para centralizar:
    - estados visuais (`loading`, `empty`, `table`);
    - tabela de transfers com status/data formatados.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-transfers-actions-card.tsx` criado para centralizar:
    - ações operacionais de `fund/cancel` por `transferId`;
    - bloco de response operacional.
  - `apps/frontend-service/src/pages/wise-payments/components/wise-transfers-tab-content.tsx` atualizado para:
    - atuar como composition root fino;
    - compor subcomponentes `header/list/actions`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-exchange-tab-types.ts` criado para centralizar contratos tipados compartilhados da tab de exchange:
    - `CurrencyOption`;
    - `ExchangeForm`;
    - `RatesForm`;
    - `WiseQuote`;
    - `WiseExchangeTabContentProps`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-exchange-quote-form-card.tsx` criado para centralizar:
    - formulário de quote (`from/amount/to`);
    - visualização da quote;
    - ação de execução de exchange.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-exchange-rates-card.tsx` criado para centralizar:
    - formulário e consulta de rates (`source/target`).
  - `apps/frontend-service/src/pages/wise-payments/components/wise-exchange-tab-content.tsx` atualizado para:
    - atuar como composition root fino;
    - compor subcomponentes `quote-form` e `rates`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural da camada de UI por subdomínio.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 286)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 286)
- Seguir com varredura residual de maior impacto em `WisePayments`, priorizando redução de densidade em `components/wise-account-details-tab-content.tsx` e `components/wise-catalog-tab-content.tsx`.
- Em seguida, consolidar varredura cruzada final de `Trading`, `Chat` e `WisePayments` para fechamento formal das pendências P2.

### Escopo entregue nesta rodada (continuação 287 - 10/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco nos residuais `components/wise-account-details-tab-content.tsx` e `components/wise-catalog-tab-content.tsx`:
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-account-details-tab-types.ts` criado para centralizar contratos tipados compartilhados da tab de account-details:
    - `WiseProfileOption`;
    - `WiseAccountDetail`;
    - `RecipientRequirementsForm`;
    - `WiseAccountDetailsTabContentProps`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-account-details-toolbar.tsx` criado para centralizar:
    - filtro de profile;
    - ações de refresh de details/orders.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-account-details-create-card.tsx` criado para centralizar:
    - payload de criação de account detail order;
    - ação de criação;
    - bloco de response operacional.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-account-details-list-card.tsx` criado para centralizar:
    - estados visuais (`loading`, `empty`, `table`) de account details.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-account-details-orders-card.tsx` criado para centralizar:
    - estados visuais (`loading`, `empty`, `table`) de account detail orders.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-recipient-requirements-card.tsx` criado para centralizar:
    - formulário de recipient requirements (`source/target/amount`);
    - ação de consulta e response.
  - `apps/frontend-service/src/pages/wise-payments/components/wise-account-details-tab-content.tsx` atualizado para:
    - atuar como composition root fino;
    - compor subcomponentes `toolbar/create/list/orders/recipient-requirements`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-catalog-tab-types.ts` criado para centralizar contratos tipados compartilhados da tab de catalog.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-catalog-operation-config.tsx` criado para centralizar:
    - seleção de operação;
    - endpoint custom.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-catalog-params-fields.tsx` criado para centralizar:
    - parâmetros condicionais (`profileId/cardToken/disputeId/transferId/kycReviewId/subscriptionId/action/ruleId/application`).
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-catalog-execution-panel.tsx` criado para centralizar:
    - payload JSON;
    - execução de operação;
    - tratamento de erro;
    - response operacional.
  - `apps/frontend-service/src/pages/wise-payments/components/wise-catalog-tab-content.tsx` atualizado para:
    - atuar como composition root fino;
    - compor subcomponentes `operation-config/params-fields/execution-panel`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural da camada de UI por subdomínio.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 287)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 287)
- Seguir com varredura residual de maior impacto em `WisePayments`, priorizando redução de densidade em `components/wise-cards-tab-content.tsx` e `components/wise-card-transactions-tab-content.tsx`.
- Em seguida, consolidar varredura cruzada final de `Trading`, `Chat` e `WisePayments` para fechamento formal das pendências P2.

### Escopo entregue nesta rodada (continuação 288 - 10/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco nos residuais `components/wise-cards-tab-content.tsx` e `components/wise-card-transactions-tab-content.tsx`:
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-cards-tab-types.ts` criado para centralizar contratos tipados compartilhados da tab de cards:
    - `WiseProfileOption`;
    - `WiseCard`;
    - `WiseCardsTabContentProps`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-cards-toolbar.tsx` criado para centralizar:
    - filtro de profile;
    - ação de refresh.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-cards-list-card.tsx` criado para centralizar:
    - estados visuais (`missing profile`, `loading`, `empty`, `table`);
    - ação de update de status por card token.
  - `apps/frontend-service/src/pages/wise-payments/components/wise-cards-tab-content.tsx` atualizado para:
    - atuar como composition root fino;
    - compor subcomponentes `toolbar/list`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-card-transactions-tab-types.ts` criado para centralizar contratos tipados compartilhados da tab de card-transactions.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-card-transactions-toolbar.tsx` criado para centralizar:
    - filtro de profile da tab.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-card-transactions-fetch-card.tsx` criado para centralizar:
    - formulário de consulta por `transactionId`;
    - ação de fetch;
    - response operacional.
  - `apps/frontend-service/src/pages/wise-payments/components/wise-card-transactions-tab-content.tsx` atualizado para:
    - atuar como composition root fino;
    - compor subcomponentes `toolbar/fetch-card`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural da camada de UI por subdomínio.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 288)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 288)
- Seguir com varredura residual de maior impacto em `WisePayments`, priorizando redução de densidade em `components/wise-quotes-tab-content.tsx` e `components/wise-statements-tab-content.tsx`.
- Em seguida, consolidar varredura cruzada final de `Trading`, `Chat` e `WisePayments` para fechamento formal das pendências P2.

### Escopo entregue nesta rodada (continuação 289 - 10/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco nos residuais `components/wise-quotes-tab-content.tsx` e `components/wise-statements-tab-content.tsx`:
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-quotes-tab-types.ts` criado para centralizar contratos tipados compartilhados da tab de quotes:
    - `CurrencyOption`;
    - `QuoteForm`;
    - `WiseQuote`;
    - `WiseQuotesTabContentProps`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-quotes-form-card.tsx` criado para centralizar:
    - formulário de quote (`from/amount/to`);
    - ação de consulta.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-quotes-result-card.tsx` criado para centralizar:
    - apresentação de resultado da cotação (`rate/fee/receive/delivery`).
  - `apps/frontend-service/src/pages/wise-payments/components/wise-quotes-tab-content.tsx` atualizado para:
    - atuar como composition root fino;
    - compor subcomponentes `form-card/result-card`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-statements-tab-types.ts` criado para centralizar contratos tipados compartilhados da tab de statements.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-statements-filter-card.tsx` criado para centralizar:
    - filtros (`balance/currency/start/end`);
    - ação de consulta de extrato.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-statements-result-card.tsx` criado para centralizar:
    - estados visuais (`empty/table`);
    - listagem tabular de transações.
  - `apps/frontend-service/src/pages/wise-payments/components/wise-statements-tab-content.tsx` atualizado para:
    - atuar como composition root fino;
    - compor subcomponentes `filter-card/result-card`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural da camada de UI por subdomínio.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 289)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 289)
- Consolidar varredura cruzada final de P2 em `Trading`, `Chat` e `WisePayments` para mapear e fechar resíduos objetivos restantes até 100% do plano.

### Escopo entregue nesta rodada (continuação 290 - 10/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco no residual de densidade em `apps/frontend-service/src/pages/TradingContent.tsx`:
  - novo módulo `apps/frontend-service/src/components/trading/TradingStatusGate.tsx` criado para centralizar os early-returns de status:
    - loading;
    - erro de status;
    - indisponibilidade de payload;
    - not-configured;
    - tenant-required.
  - `apps/frontend-service/src/components/trading/index.ts` atualizado para exportar `resolveTradingStatusGate(...)`.
  - `apps/frontend-service/src/pages/TradingContent.tsx` atualizado para:
    - remover o bloco inline de early-returns de status;
    - consumir `resolveTradingStatusGate(...)` como boundary dedicado de status gate;
    - manter comportamento e contratos sem alteração de API/RBAC.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural da camada de UI.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 290)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 290)
- Seguir na varredura cruzada final de P2 com próximo residual de maior impacto em `apps/frontend-service/src/pages/TradingContent.tsx` (composição de props/options ainda densa), seguido da conferência final de `Chat` e `WisePayments` para convergir ao fechamento de 100% do plano.

### Escopo entregue nesta rodada (continuação 291 - 10/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco nos residuais `components/wise-kyc-tab-content.tsx` e `components/wise-simulations-tab-content.tsx`:
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-kyc-tab-types.ts` criado para centralizar contratos tipados compartilhados da tab de KYC.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-kyc-toolbar.tsx` criado para centralizar:
    - filtro de profile;
    - ação de refresh.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-kyc-evidences-card.tsx` criado para centralizar:
    - consulta de evidências;
    - bloco de response operacional.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-kyc-upload-card.tsx` criado para centralizar:
    - upload de documento;
    - upload adicional;
    - mapeamento de labels/testIds por tipo.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-kyc-reviews-card.tsx` criado para centralizar:
    - estados visuais (`missing profile`, `loading`, `empty`, `table`);
    - listagem tabular de reviews KYC.
  - `apps/frontend-service/src/pages/wise-payments/components/wise-kyc-tab-content.tsx` atualizado para:
    - atuar como composition root fino;
    - compor subcomponentes `toolbar/evidences/upload/reviews`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-simulations-tab-types.ts` criado para centralizar contratos tipados compartilhados da tab de simulations.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-simulations-toolbar.tsx` criado para centralizar:
    - filtro de profile.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-simulations-operation-card.tsx` criado para centralizar:
    - seleção de operação;
    - parâmetros de transferência/cartão/KYC;
    - payload JSON;
    - execução e response operacional.
  - `apps/frontend-service/src/pages/wise-payments/components/wise-simulations-tab-content.tsx` atualizado para:
    - atuar como composition root fino;
    - compor subcomponentes `toolbar/operation-card`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural da camada de UI por subdomínio.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 291)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 291)
- Executar varredura cruzada final de P2 em `TradingContent`, `Chat` e `WisePayments` para mapear e fechar resíduos objetivos restantes antes da declaração de 100% do plano.

### Escopo entregue nesta rodada (continuação 292 - 10/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco nos residuais `components/wise-exchange-quote-form-card.tsx` e `components/wise-spend-limits-tab-content.tsx`:
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-exchange-quote-form-fields.tsx` criado para centralizar:
    - formulário de quote de exchange (`from/amount/to`);
    - ação de quote com estado pendente.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-exchange-quote-result-card.tsx` criado para centralizar:
    - apresentação de resultado (`rate/fee/receive/expires`);
    - ação de execução de exchange com estado pendente.
  - `apps/frontend-service/src/pages/wise-payments/components/wise-exchange-quote-form-card.tsx` atualizado para:
    - atuar como composition root fino;
    - compor subcomponentes `form-fields/result-card`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-spend-limits-tab-types.ts` criado para centralizar contratos tipados da tab de spend-limits.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-spend-limits-fetch-controls.tsx` criado para centralizar:
    - filtros de profile/card;
    - ações de fetch profile/card.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-spend-limits-update-panels.tsx` criado para centralizar:
    - payloads profile/card;
    - ações update profile/card;
    - exclusão por card token.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-spend-limits-response-panels.tsx` criado para centralizar:
    - responses de profile/card.
  - `apps/frontend-service/src/pages/wise-payments/components/wise-spend-limits-tab-content.tsx` atualizado para:
    - atuar como composition root fino;
    - compor subcomponentes `fetch-controls/update-panels/response-panels`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural da camada de UI por subdomínio.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 292)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 292)
- Executar checklist objetivo de fechamento final do P2 em `TradingContent`, `Chat` e `WisePayments`, documentando residual remanescente com escopo executável para convergir ao 100% do plano.

### Escopo entregue nesta rodada (continuação 293 - 10/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco nos residuais `components/wise-webhooks-tab-content.tsx` e `components/wise-card-orders-actions-card.tsx`:
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-webhooks-tab-types.ts` criado para centralizar contratos tipados compartilhados da tab de webhooks.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-webhooks-toolbar.tsx` criado para centralizar:
    - filtros de profile/application;
    - ação de listagem de webhooks.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-webhooks-create-card.tsx` criado para centralizar:
    - payload de criação;
    - ação de criação de webhook.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-webhooks-delete-card.tsx` criado para centralizar:
    - entrada de subscription id;
    - ação de remoção de webhook.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-webhooks-response-card.tsx` criado para centralizar:
    - painel de resposta operacional da tab.
  - `apps/frontend-service/src/pages/wise-payments/components/wise-webhooks-tab-content.tsx` atualizado para:
    - atuar como composition root fino;
    - compor subcomponentes `toolbar/create/delete/response`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-card-orders-actions-card-types.ts` criado para centralizar contratos tipados compartilhados do card de ações.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-card-orders-order-reference-row.tsx` criado para centralizar:
    - captura de `orderId`;
    - ações de fetch de details/requirements.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-card-orders-json-action-block.tsx` criado para centralizar:
    - payload JSON + ação submit para status/address/pin.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-card-orders-actions-footer.tsx` criado para centralizar:
    - ação de availability;
    - painel de resposta agregado.
  - `apps/frontend-service/src/pages/wise-payments/components/wise-card-orders-actions-card.tsx` atualizado para:
    - atuar como composition root fino;
    - compor subcomponentes de referência, payloads JSON e footer operacional.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural da camada de UI por subdomínio.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 293)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 293)
- Retomar o residual de maior impacto em `apps/frontend-service/src/pages/TradingContent.tsx`, priorizando redução da composição densa de `section-props/options` no composition root.
- Em seguida executar novo ciclo de fechamento residual em `Chat/useChatPageLayoutController.ts` e checklist final cruzado de P2 (`TradingContent` + `Chat` + `WisePayments`).

### Escopo entregue nesta rodada (continuação 294 - 10/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco nos residuais `components/wise-sca-tab-content.tsx` e `components/wise-simulations-operation-card.tsx`:
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-sca-tab-types.ts` criado para centralizar contratos tipados compartilhados da tab de SCA.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-sca-toolbar.tsx` criado para centralizar:
    - subtítulo da tab;
    - seletor de profile.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-sca-action-buttons.tsx` criado para centralizar:
    - catálogo de ações SCA (`POST/DELETE`) com mapeamento de endpoint/label/testId.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-sca-payload-card.tsx` criado para centralizar:
    - payload JOSE;
    - botões de execução SCA;
    - response operacional.
  - `apps/frontend-service/src/pages/wise-payments/components/wise-sca-tab-content.tsx` atualizado para:
    - atuar como composition root fino;
    - compor subcomponentes `toolbar/payload-card`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-simulations-operation-select.tsx` criado para centralizar:
    - seleção da operação de simulação.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-simulations-operation-fields.tsx` criado para centralizar:
    - campos operacionais de transfer/card/kyc.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-simulations-operation-response.tsx` criado para centralizar:
    - ação de execução;
    - painel de response operacional.
  - `apps/frontend-service/src/pages/wise-payments/components/wise-simulations-operation-card.tsx` atualizado para:
    - atuar como composition root fino;
    - compor subcomponentes `operation-select/operation-fields/operation-response`.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural da camada de UI por subdomínio.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 294)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 294)
- Retomar o residual de maior impacto em `apps/frontend-service/src/pages/TradingContent.tsx`, priorizando redução da composição densa de `section-props/options` no composition root.
- Em seguida executar novo ciclo de fechamento residual em `apps/frontend-service/src/pages/Chat/useChatPageLayoutController.ts` e checklist final cruzado de P2 (`TradingContent` + `Chat` + `WisePayments`).

### Escopo entregue nesta rodada (continuação 295 - 10/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco nos residuais `components/wise-catalog-params-fields.tsx` e `components/wise-balances-header.tsx`:
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-catalog-path-param-inputs.tsx` criado para centralizar:
    - rendering tipado dos parâmetros de path/query (`profileId`, `cardToken`, `disputeId`, `transferId`, `kycReviewId`, `subscriptionId`, `action`, `ruleId`);
    - contrato único de labels/placeholders/testIds via mapping por chave.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-catalog-query-param-controls.tsx` criado para centralizar:
    - controle de query param `application` (yes/no).
  - `apps/frontend-service/src/pages/wise-payments/components/wise-catalog-params-fields.tsx` atualizado para:
    - atuar como composition root fino;
    - compor subcomponentes `path-param-inputs/query-param-controls`.
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-balances-new-balance-form-fields.tsx` criado para centralizar:
    - campos de criação de saldo (`currency`, `type`, `name`).
  - novo módulo `apps/frontend-service/src/pages/wise-payments/components/wise-balances-new-balance-dialog.tsx` criado para centralizar:
    - trigger/modal de criação;
    - ações de cancelar/salvar com estado pending.
  - `apps/frontend-service/src/pages/wise-payments/components/wise-balances-header.tsx` atualizado para:
    - atuar como composition root fino;
    - compor subcomponente de diálogo de criação.
  - sem alteração de payloads, contratos de API ou RBAC; somente desacoplamento estrutural da camada de UI por subdomínio.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 295)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 295)
- Retomar o residual de maior impacto em `apps/frontend-service/src/pages/TradingContent.tsx`, priorizando redução da composição densa de `section-props/options` no composition root.
- Em seguida executar novo ciclo de fechamento residual em `apps/frontend-service/src/pages/Chat/useChatPageLayoutController.ts` e checklist final cruzado de P2 (`TradingContent` + `Chat` + `WisePayments`).

### Escopo entregue nesta rodada (continuação 296 - 10/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com foco direto nos residuais críticos de `TradingContent` e `Chat` sem abertura de novos micro-módulos:
  - `apps/frontend-service/src/pages/TradingContent.tsx` atualizado para reduzir densidade de composição de `section-props/options` com contextos compartilhados reutilizáveis:
    - `sharedLocaleContext`
    - `sharedLocaleTimeContext`
    - `sharedMarketSelectionContext`
  - ajuste aplicado sem alteração de payloads, contratos de API, RBAC ou comportamento visual/operacional.
  - `apps/frontend-service/src/pages/Chat/useChatPageLayoutController.ts` atualizado para cleanup de orquestração:
    - callbacks nomeados para `delete conversation`, `approval policy` e `quick reply`;
    - remoção de wrappers inline redundantes nas mutações de envio para treinamento;
    - manutenção do fluxo existente de seleção/scroll/stream sem alteração de contrato.
- Auditoria anti-fragmentação dos últimos 400 commits (escopo solicitado):
  - janela analisada: `git log -n 400`.
  - hotspot confirmado em `apps/frontend-service/src/pages/wise-payments`:
    - 193 arquivos TS/TSX;
    - 14.245 linhas totais.
  - leitura de churn confirma predominância de micro-refactors recentes nesse domínio; execução foi reancorada para fechamento dos residuais críticos (`TradingContent` + `Chat`) antes de novos desdobramentos.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 296)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 296)
- Fechar checklist objetivo de residual em `apps/frontend-service/src/pages/TradingContent.tsx` com foco exclusivo em orquestração restante de alta densidade.
- Fechar checklist objetivo de residual em `apps/frontend-service/src/pages/Chat/useChatPageLayoutController.ts` com foco exclusivo em composição final do layout controller.
- Executar varredura final cruzada de P2 (`TradingContent` + `Chat` + `WisePayments`) para consolidar fechamento formal do Bloco 5 sem nova micro-fragmentação.

### Escopo entregue nesta rodada (continuação 297 - 10/03/2026)
- Continuidade do Bloco 5 (Frontend UX P2) com fechamento do residual crítico de maior impacto sem fragmentação adicional:
  - `apps/frontend-service/src/pages/TradingContent.tsx` atualizado para estruturar a composição de props por domínio:
    - `primaryTabsOptions`
    - `operationalTabsOptions`
    - `dialogsOptions`
    - `layoutOptions`
  - `apps/frontend-service/src/pages/Chat/useChatPageLayoutController.ts` atualizado para cleanup final do controller:
    - constante compartilhada `CHAT_ACCEPTED_MEDIA_TYPES`;
    - flags derivadas explícitas (`isRecordingDisabled`);
    - remoção de wrappers inline residuais na abertura de dialogs de exclusão.
  - sem criação de novos micro-módulos nesta rodada; somente ajuste cirúrgico nos dois residuais prioritários.
- Fechamento formal do plano:
  - Bloco 3 marcado como concluído.
  - Bloco 4 marcado como concluído.
  - Bloco 5 marcado como concluído.
  - Plano consolidado em 100% com SSOT atualizado.
- Atualização de SSOT documental desta rodada:
  - `README.md`
  - `docs/ARQUITETURA.md`
  - `docs/INDEX.md`
  - `docs/STATUS-REAL-ATUAL.md`
  - `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md`

### Validação executada nesta rodada (sequencial - continuação 297)
1. `npx pnpm --filter @alice/frontend-service typecheck`
2. `npx pnpm --filter @alice/frontend-service test`
3. `npx pnpm --filter @alice/frontend-service lint`
4. `npx pnpm --filter @alice/frontend-service build`

### Próximo foco atualizado (continuação 297)
- Plano enterprise concluído em 100%.
- Próximas evoluções passam a seguir backlog incremental pós-plano (fora do escopo deste fechamento), mantendo regra de não fragmentar excessivamente.
