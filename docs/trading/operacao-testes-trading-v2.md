# Notas Operacionais e de Testes da Trading Workspace V2

Author: Fillipe Guerra  
Data: 2026-03-13

## Operação diária
- A trilha V2 opera com fallback seguro por feature flag.
- Handoff de sinais para Demo e Training permanece first-class no cockpit.
- Estados terminais continuam auditáveis com reason codes machine-readable e explicações user-readable.

## Testes críticos adicionados na rodada final
- `tests/unit/frontend/trading-workspace-rollout-adapter.test.ts`
- `tests/unit/frontend/trading-signals-cockpit-state-adapter.test.ts`
- `tests/unit/frontend/trading-signal-demo-handoff-adapter.test.ts`
- `tests/unit/services/trading-signal-promotion-service-helpers.test.ts`

## Cobertura funcional alvo
- Workspace rendering com fallback por flag.
- Terminal state mapping (`blocked`/`no_trade`/`failed`/`executed`).
- UX explícita para cenários sem trade e bloqueios.
- Validação de handoff Demo para sinais direcionais.
- Integridade de helpers de lineage/promotion.

## Validação executada no fechamento da rodada
- Typecheck: `pnpm typecheck` (sucesso).
- Testes: `pnpm test -- --reporter=dot` (sucesso, `135` arquivos, `1415` testes).
- ESLint: `pnpm lint` (sucesso, zero warnings e zero errors).
- Build:
- `pnpm --filter @alice/integrations-service build` (sucesso).
- `pnpm --filter @alice/frontend-service build` (sucesso).

## Observação operacional
- A camada de compatibilidade deve ser tratada como transitória.
- A remoção de aliases só deve ocorrer após evidência operacional de não uso por consumidores legados.
