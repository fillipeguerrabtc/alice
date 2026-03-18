# Relatório de Correção do Frontend: CI + Trading

**Author:** Fillipe Guerra  
**Data:** 15 de Março de 2026

## Objetivo

Registrar a causa raiz e a correção aplicada para dois problemas do frontend:

- falha de CI no `build` do `@alice/frontend-service`;
- erro em produção ao abrir a página `/trading`.

## Problema 1: CI quebrando no build do frontend

### Sintoma

O CI falhava no step `@alice/frontend-service:build` com:

```text
TS6310: Referenced project '.../apps/frontend-service/tsconfig.node.json' may not disable emit
```

### Causa raiz

O script de build do frontend usava:

```text
tsc -b --noEmit && vite build
```

Essa combinação usa TypeScript Build Mode com `--noEmit` sobre um projeto com `references`, incluindo `tsconfig.node.json`. Em ambiente Linux/CI, isso dispara `TS6310`.

### Correção aplicada

- `build` passou a usar `pnpm run typecheck && vite build`
- `typecheck` passou a validar separadamente:
  - `tsconfig.json`
  - `tsconfig.node.json`

Resultado: o frontend continua validando app + `vite.config.ts`, sem depender de `tsc -b --noEmit`.

## Problema 2: `/trading` quebrando em produção

### Evidências coletadas no servidor

- `curl -I https://yesyoudeserve.duckdns.org/trading` retornou `HTTP/2 200`
- logs do container `alice-frontend` mostraram entrega normal dos bundles de `/trading`
- isso confirmou que a falha era client-side e não de roteamento/infraestrutura

### Causa raiz

Em `apps/frontend-service/src/pages/TradingContent.tsx`, alguns `useMemo` do shell V2 ficavam abaixo dos early returns de status/loading.

Isso quebrava a ordem de hooks quando o estado da página transitava entre loading e pronto, resultando em erro React minificado em produção.

### Correção aplicada

- os `useMemo` de:
  - `visibleTabValues`
  - `v2SidebarSections`
  - `v2BottomTraySections`

foram movidos para cima dos early returns de `statusGuardNode` e `status`.

Resultado: a ordem de hooks fica estável entre renders.

## Guardrails adicionados

- teste de governança para garantir que o frontend não volte a usar `tsc -b --noEmit` no build
- teste de governança para garantir que os `useMemo` críticos do Trading permaneçam acima dos early returns

## Validação executada

- `pnpm exec vitest run tests/unit/frontend/trading-frontend-governance.test.ts`
- `pnpm --filter @alice/frontend-service typecheck`
- `pnpm --filter @alice/frontend-service lint`
- `pnpm --filter @alice/frontend-service build`
