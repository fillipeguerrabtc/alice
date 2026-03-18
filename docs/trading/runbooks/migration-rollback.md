# Runbook de Rollout e Rollback da Trading Workspace

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026
**Status:** ativo
**Tipo:** runbook

## Objetivo

Descrever o procedimento funcional de rollout, smoke check e rollback da Trading Workspace sem duplicar a governanca geral de `release` e `deploy`.

## Antes de expor a Workspace

- Confirmar auth, `csrfReady` e `GET /api/integrations/trading/status`.
- Confirmar leitura da flag canonica `tradingWorkspaceV2Enabled`.
- Confirmar que aliases legados de rota e flag continuam disponiveis caso existam consumers antigos.

## Smoke checks minimos

1. Abrir Trading Real e Demo Trading com usuario autenticado.
2. Validar bootstrap sem queries prematuras e sem erro de auth.
3. Validar `operate`, `ai-signals`, `portfolio-auto` e `post-trade`.
4. Validar `POST /api/integrations/trading/signals/generate`.
5. Validar leitura de `promotion-path` para um sinal existente.
6. Validar handoff para demo em paper trading.

## Rollback funcional

1. Desabilitar a flag canonica `tradingWorkspaceV2Enabled`.
2. Confirmar retorno ao caminho legado sem rollback de banco.
3. Preservar aliases e contracts legados enquanto houver consumer dependente.
4. Reexecutar os smoke checks minimos no caminho legado.

## O que este runbook nao cobre

- Processo geral de `Release`
- Processo geral de `Deploy`
- Gate de validacao de monorepo

Para esses itens, usar os SSOTs gerais:

- [../../operations/release.md](../../operations/release.md)
- [../../operations/deploy.md](../../operations/deploy.md)
- [../../engineering/validation-monorepo.md](../../engineering/validation-monorepo.md)
