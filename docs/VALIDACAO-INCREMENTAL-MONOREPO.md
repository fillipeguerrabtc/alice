# Validação Incremental do Monorepo

**Author:** Fillipe Guerra  
**Data:** 15 de Março de 2026

## Objetivo

Definir o uso operacional do fluxo incremental por workspace para `typecheck`, `lint` e `build`, preservando gates full oficiais para `main` e release.

## Comandos Locais

### Padrão local

- `pnpm typecheck`
- `pnpm lint`
- `pnpm build`

Os três comandos acima executam somente nos workspaces afetados por padrão, com expansão transitiva quando necessário.

### Comandos explícitos changed-only

- `pnpm typecheck:changed`
- `pnpm lint:changed`
- `pnpm build:changed`

São aliases explícitos do mesmo comportamento incremental do fluxo local padrão.

### Gates full oficiais

- `pnpm typecheck:full`
- `pnpm lint:full`
- `pnpm build:full`
- `pnpm validate:enterprise`

`validate:enterprise` mantém o gate enterprise oficial usando sempre os comandos full.

## Como o Escopo é Resolvido

O resolvedor fica em:

- `scripts/workspace-scope.mjs`
- `scripts/run-scoped-task.mjs`

### Fonte de verdade do escopo

- `git diff` + arquivos untracked no fluxo local
- grafo real de dependências dos workspaces via `package.json`
- fail-safe para full quando houver incerteza

### Regras por task

- `typecheck`: workspace alterado + dependentes impactados
- `build`: workspace alterado + dependentes impactados
- `lint`: somente workspaces diretamente alterados

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
- `test` continua full
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
| `pnpm lint` | 1m26.79s |
| `pnpm build` | 5m40.19s |

### Execução incremental validada com alteração isolada em `@alice/auth-service`

| Comando | Tempo | Escopo |
|---|---:|---|
| `pnpm typecheck` | 54.30s | `@alice/auth-service` |
| `pnpm lint` | 57.54s | `@alice/auth-service` |
| `pnpm build` | 7.89s | `@alice/auth-service` + upstream em cache |

## Observações Operacionais

- O primeiro hit incremental ainda pode reconstruir dependências upstream se o cache local estiver vazio.
- Quando o detector estiver inseguro, ele executa full por design.
- Nenhum fluxo local comum depende mais de `eslint .` ou de `tsc --noEmit` no repositório inteiro.
