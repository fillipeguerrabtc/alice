# Validacao Incremental do Monorepo

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026
**Status:** ativo
**Tipo:** ssot

## Objetivo

Documentar como o monorepo resolve escopo incremental para `typecheck`, `lint`, `test` e `build`, com `CI` como gate oficial e fallback seguro para full.

## Comandos locais padrao

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`

Esses comandos sao changed-only por padrao.

## Aliases explicitos

- `pnpm typecheck:changed`
- `pnpm lint:changed`
- `pnpm test:changed`
- `pnpm build:changed`

## Gates full disponiveis

- `pnpm typecheck:full`
- `pnpm lint:full`
- `pnpm test:full`
- `pnpm build:full`
- `pnpm validate:enterprise`

## Fonte de verdade do escopo

- [`scripts/workspace-scope.mjs`](../../scripts/workspace-scope.mjs)
- [`scripts/run-scoped-task.mjs`](../../scripts/run-scoped-task.mjs)
- [`scripts/test-scope.mjs`](../../scripts/test-scope.mjs)
- [`scripts/run-scoped-test.mjs`](../../scripts/run-scoped-test.mjs)

## Como o escopo e resolvido

### Entradas

- `git diff` entre base e head, quando o `CI` tem referencia segura
- arquivos untracked no fluxo local
- grafo real de workspaces em `apps/*/package.json` e `packages/*/package.json`

### Regras de exclusao

- documentacao nao entra como escopo de codigo
- caminhos `pipeline-only` nao tornam o commit `release-eligible`
- caminhos seguros ignorados, como `attached_assets/` e `tests/`, seguem regra propria do resolvedor

### Regras por task

| Task | Regra |
| --- | --- |
| `typecheck` | workspace alterado + dependentes impactados |
| `build` | workspace alterado + dependentes impactados |
| `lint` | workspaces diretamente alterados |
| `test` | suites e testes que referenciam workspaces afetados |

## Casos que forcam `full`

- diff sem base segura
- mudanca em arquivos globais criticos
- alteracao no proprio resolvedor
- caminhos nao classificados com seguranca

## Arquivos globais criticos

- `.nvmrc`
- `eslint.config.mjs`
- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `packages/tsconfig.base.json`
- `scripts/build-service.mjs`
- `turbo.json`
- `tsconfig.build.json`

## Uso no `CI`

- Quando `scope_mode=scoped`, o `CI` roda os comandos padrao incrementais.
- Quando `scope_mode=full`, o `CI` roda `typecheck:full`, `test:full`, `lint:full` e `build:full`.
- `docs-only` e `pipeline-only` nao executam os gates de codigo da aplicacao.

## Observacoes operacionais

- O fallback para `full` e intencional e fail-safe.
- O cache de `Turbo` vive em `.cache/turbo`.
- O cache incremental de TypeScript vive em `.cache/typescript/...`.
- O fluxo normal de `Release` nao deve substituir o papel deste resolvedor; ele so consome um commit ja aprovado pelo `CI`.

## Referencias

- [docs/engineering/pipeline-overview.md](pipeline-overview.md)
- [docs/operations/release.md](../operations/release.md)
