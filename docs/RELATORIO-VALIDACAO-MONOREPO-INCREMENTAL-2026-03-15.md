# Relatório de Diagnóstico do Fluxo de Validação Incremental

**Author:** Fillipe Guerra  
**Data:** 15 de Março de 2026

## Objetivo

Registrar o baseline real do monorepo antes da refatoração do fluxo de validação local para escopo incremental por workspace.

## Baseline Atual

### Scripts root vigentes

- `pnpm typecheck` -> `tsc --noEmit`
- `pnpm lint` -> `eslint .`
- `pnpm build` -> `pnpm run build:microservices`
- `pnpm build:microservices` -> `pnpm -r --filter "./packages/*" --filter "./apps/*" run build`
- `pnpm test` -> `vitest run`
- `pnpm validate:enterprise` -> `pnpm typecheck && pnpm test && pnpm lint && pnpm build && pnpm verify:enterprise-focus`

### Tempos medidos em 15/03/2026

| Comando | Tempo total | Observações |
|---|---:|---|
| `pnpm typecheck` | 1m13.45s | Typecheck root inteiro via `tsc --noEmit` |
| `pnpm test` | 10m10.90s | 137 arquivos de teste, 1419 testes |
| `pnpm lint` | 1m26.79s | Varredura full do repositório via `eslint .` |
| `pnpm build` | 5m40.19s | Rebuild de 15 workspaces + frontend |

### Gargalos confirmados

- O typecheck local roda no repositório inteiro por padrão.
- O lint local depende de `eslint .`, o que amplia demais a área de análise.
- O build local recompila todos os `apps/*` e `packages/*`.
- O `turbo.json` existe, mas o binário `turbo` não está instalado e o fluxo principal não usa `turbo run`.
- Parte dos workspaces não expõe `typecheck` e `lint`, o que impede uma orquestração homogênea por workspace.

## Mapa de Workspaces

### Packages

- `@alice/logger`
- `@alice/shared`
- `@alice/config` -> depende de `@alice/logger`
- `@alice/database` -> depende de `@alice/logger`, `@alice/shared`
- `@alice/shared-utils` -> depende de `@alice/config`, `@alice/database`, `@alice/logger`

### Apps

- `@alice/frontend-service`
- `@alice/api-gateway` -> depende de `@alice/config`, `@alice/logger`, `@alice/shared-utils`
- `@alice/auth-service` -> depende de `@alice/config`, `@alice/database`, `@alice/logger`, `@alice/shared`, `@alice/shared-utils`
- `@alice/chat-service` -> depende de `@alice/config`, `@alice/database`, `@alice/logger`, `@alice/shared`, `@alice/shared-utils`
- `@alice/gpu-manager-service` -> depende de `@alice/config`, `@alice/database`, `@alice/logger`, `@alice/shared-utils`
- `@alice/integrations-service` -> depende de `@alice/config`, `@alice/database`, `@alice/logger`, `@alice/shared`, `@alice/shared-utils`
- `@alice/llm-gateway-service` -> depende de `@alice/config`, `@alice/database`, `@alice/logger`, `@alice/shared`, `@alice/shared-utils`
- `@alice/observability-service` -> depende de `@alice/database`, `@alice/logger`, `@alice/shared`, `@alice/shared-utils`
- `@alice/rag-service` -> depende de `@alice/config`, `@alice/database`, `@alice/logger`, `@alice/shared`, `@alice/shared-utils`
- `@alice/training-service` -> depende de `@alice/config`, `@alice/database`, `@alice/logger`, `@alice/shared`, `@alice/shared-utils`

## Scripts por Workspace

### Workspaces sem `typecheck` e `lint`

- `@alice/api-gateway`
- `@alice/observability-service`

### Padrão predominante

- Packages: `build` via `tsc -b`, `typecheck` via `tsc --noEmit`, `lint` via `eslint src/`
- Apps Node: `build` via `node ../../scripts/build-service.mjs <service>` ou `tsc`, `typecheck` via `tsc --noEmit`, `lint` via `eslint src/`
- Frontend: `build` via `tsc -b && vite build`, `typecheck` via `tsc --noEmit`, `lint` via `eslint src/`

## Estado Atual do Cache TypeScript

- Arquivos `.tsbuildinfo` encontrados em workspaces específicos:
  - `packages/logger/tsconfig.tsbuildinfo`
  - `packages/shared/tsconfig.tsbuildinfo`
  - `packages/config/tsconfig.tsbuildinfo`
  - `packages/database/tsconfig.tsbuildinfo`
  - `packages/shared-utils/tsconfig.tsbuildinfo`
  - `apps/frontend-service/tsconfig.tsbuildinfo`
  - `apps/frontend-service/tsconfig.node.tsbuildinfo`
  - `apps/integrations-service/tsconfig.tsbuildinfo`
- O `.gitignore` já ignora `*.tsbuildinfo`, mas ainda não existe diretório dedicado de cache TypeScript por workspace.

## Estratégia Definida

### Seleção de escopo

- Detector próprio baseado em `git diff` + arquivos untracked.
- Resolução do workspace dono por caminho alterado.
- Expansão transitiva por grafo de dependências quando a mudança atingir package compartilhado.
- Fail-safe para execução full quando a mudança atingir configuração global crítica ou quando o detector não conseguir classificar com segurança.

### Fluxo local

- `pnpm typecheck`, `pnpm lint` e `pnpm build` passam a ser changed-only por padrão local.
- Novos comandos `typecheck:full`, `lint:full` e `build:full` preservam os gates oficiais.
- Novos comandos `typecheck:changed`, `lint:changed` e `build:changed` expõem o fluxo incremental de forma explícita.

### Orquestração

- Uso de `turbo run` com filtros explícitos por workspace afetado.
- `build` e `typecheck` expandem dependentes impactados; `lint` permanece focado em workspaces diretamente alterados.
- Cache do Turbo centralizado fora de `node_modules`.
- Cache do TypeScript movido para diretório dedicado em `.cache/typescript/`.

## Fail-safe Proposto

Executar full automaticamente quando houver mudanças em pelo menos um dos grupos abaixo:

- `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`
- `eslint.config.mjs`
- `packages/tsconfig.base.json`, `tsconfig.build.json`
- scripts globais que alteram o resultado do build ou do escopo
- caminhos fora de `apps/`, `packages/`, `docs/`, `tests/` que não possam ser classificados com segurança

## Conclusão

O diagnóstico confirma que o monorepo já possui granularidade suficiente em `apps/` e `packages/` para suportar validação incremental por workspace, mas precisa:

- instalar e adotar `turbo` no fluxo principal;
- padronizar `typecheck` e `lint` em todos os workspaces;
- mover o cache TypeScript para um diretório dedicado;
- introduzir um resolvedor de escopo com fail-safe full;
- separar explicitamente comandos locais changed-only dos gates full de CI, merge e release.
