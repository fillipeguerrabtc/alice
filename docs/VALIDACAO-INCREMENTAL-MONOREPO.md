# Validação Incremental do Monorepo

**Author:** Fillipe Guerra  
**Data:** 17 de Março de 2026

## Objetivo

Definir o uso operacional do fluxo incremental por workspace e suite para `typecheck`, `lint`, `test` e `build`, preservando gates full oficiais para `main` e release.

## Comandos Locais

### Padrão local

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`

Os quatro comandos acima executam somente nos workspaces ou suites afetadas por padrão, com expansão transitiva quando necessário.

### Comandos explícitos changed-only

- `pnpm typecheck:changed`
- `pnpm lint:changed`
- `pnpm test:changed`
- `pnpm build:changed`

São aliases explícitos do mesmo comportamento incremental do fluxo local padrão.

### Gates full oficiais

- `pnpm typecheck:full`
- `pnpm lint:full`
- `pnpm test:full`
- `pnpm build:full`
- `pnpm validate:enterprise`

`validate:enterprise` mantém o gate enterprise oficial usando sempre os comandos full.

## Como o Escopo é Resolvido

O resolvedor fica em:

- `scripts/workspace-scope.mjs`
- `scripts/run-scoped-task.mjs`
- `scripts/test-scope.mjs`
- `scripts/run-scoped-test.mjs`

### Fonte de verdade do escopo

- `git diff` + arquivos untracked no fluxo local
- grafo real de dependências dos workspaces via `package.json`
- fail-safe para full quando houver incerteza

### Regras por task

- `typecheck`: workspace alterado + dependentes impactados
- `build`: workspace alterado + dependentes impactados
- `lint`: somente workspaces diretamente alterados
- `test`: suites que referenciam os workspaces afetados + testes alterados diretamente

### Casos que forçam full

- mudanças em configuração global crítica
- caminhos não classificados com segurança
- alterações no resolvedor de escopo
- diferenças de `package.json`, `pnpm-lock.yaml`, `turbo.json`, `eslint.config.mjs` ou bases TypeScript globais

## Logs Esperados

Os comandos locais registram:

- arquivos alterados
- workspaces diretos
- workspaces selecionados
- motivo do modo `scoped` ou `full`

Exemplo resumido:

```text
[alice-scope] Task: build
[alice-scope] Reason: Escopo incremental resolvido por git diff e grafo de dependências
[alice-scope] Changed files (1):
  - apps/auth-service/src/index.ts
[alice-scope] Direct workspaces (1): @alice/auth-service
[alice-scope] Selected workspaces (1):
  - @alice/auth-service (direto)
```

## CI e Governance

### Pull Request

- `typecheck`, `lint` e `build` usam escopo incremental
- `test` também usa escopo incremental por suite/workspace afetado
- o resolvedor recebe `origin/<base_ref>` e `github.sha`

### Push em `main`

- `typecheck:full`
- `test`
- `lint:full`
- `build:full`

### Release

- gate full obrigatório antes de criar tag
- release executa `pnpm validate:enterprise`

## Cache

### Turbo

- diretório: `.cache/turbo`

### TypeScript

- diretório: `.cache/typescript/...`
- fora de `node_modules`
- separado por workspace

## Benchmark Inicial

### Baseline full medido antes da refatoração

| Comando | Tempo |
|---|---:|
| `pnpm typecheck` | 1m13.45s |
| `pnpm test` | 10m10.90s |
| `pnpm lint` | 1m26.79s |
| `pnpm build` | 5m40.19s |

### Execução incremental validada com alteração isolada em `@alice/auth-service`

| Comando | Tempo | Escopo |
|---|---:|---|
| `pnpm typecheck` | 54.30s | `@alice/auth-service` |
| `pnpm test` | 37.46s | 4 arquivos de teste ligados a `@alice/auth-service` |
| `pnpm lint` | 57.54s | `@alice/auth-service` |
| `pnpm build` | 7.89s | `@alice/auth-service` + upstream em cache |

## Observações Operacionais

- O primeiro hit incremental ainda pode reconstruir dependências upstream se o cache local estiver vazio.
- Se um workspace afetado não tiver mapeamento confiável de testes, `pnpm test` cai automaticamente para full.
- Quando o detector estiver inseguro, ele executa full por design.
- Nenhum fluxo local comum depende mais de `eslint .`, de `tsc --noEmit` no repositório inteiro ou de `vitest run` full para mudanças isoladas seguras.
- O grafo formal do `@alice/frontend-service` passa a declarar `@alice/shared` e `@alice/shared-utils` como dependências reais de workspace.
- Os imports do frontend para pacotes compartilhados ficam restritos a subpaths públicos, sem alias genérico para `packages/*/src`.
- O `build` do frontend fica limitado ao `vite build`; a validação de tipos continua separada em `typecheck` para evitar retrabalho local.
- O `lint` do frontend passa a usar cache próprio do ESLint em `.cache/eslint/frontend-service/`.
