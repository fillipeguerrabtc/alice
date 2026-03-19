# Overview da Pipeline

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 19 de Marco de 2026
**Status:** ativo
**Tipo:** ssot

## Objetivo

Definir o comportamento vigente da esteira da Alice, separando validacao, publicacao e implantacao sem duplicar gates entre `CI`, `Release` e `Deploy`.

## Workflows oficiais

| Etapa | Workflow | Papel |
| --- | --- | --- |
| `CI` | [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) | validar codigo, seguranca e governanca do commit em avaliacao |
| `Release` | [`.github/workflows/release.yml`](../../.github/workflows/release.yml) | publicar artefatos aprovados |
| `Deploy` | [`.github/workflows/deploy-stack-modular.yml`](../../.github/workflows/deploy-stack-modular.yml) | implantar artefatos publicados |

## Contrato da esteira

- `CI` valida.
- `Release` publica.
- `Deploy` implanta.
- `Release` nao repete o gate de qualidade do `CI`.
- `Release` opera sobre o `target_sha` aprovado e entregue pelo `CI`.
- `docs-only` e `pipeline-only` nao seguem automaticamente para `Release` ou `Deploy`.

## Classificacao de mudanca

### `docs-only`

O `CI` considera `docs-only=true` quando todos os arquivos alterados sao documentacao, inclusive Markdown fora de `docs/`.

Efeito:

- em `pull_request`, nao roda checks de codigo da aplicacao
- em `push` para `main`, os jobs principais da `CI` rodam para validar o commit publicado
- nao dispara `Release`
- a validacao esperada e documental

### `pipeline-only`

Arquivos em:

- `.github/workflows/`
- `.github/actions/`
- `.github/.workflow-test`

Efeito:

- nao ha `release-eligible`
- em `push` para `main`, os jobs principais da `CI` rodam para validar o commit publicado
- a esteira nao segue para `Release` ou `Deploy`
- a revisao se concentra no comportamento da propria pipeline

### `release-eligible`

Existe quando pelo menos um arquivo alterado nao e documentacao e nao pertence ao conjunto `pipeline-only`.

Efeito:

- o `CI` executa os gates aplicaveis
- push em `main` pode disparar `Release`
- `Release` normal pode disparar `Deploy`

## Fluxo do `CI`

1. `detect-changes` resolve:
   - `scope_mode`
   - `docs_only`
   - `release_eligible`
2. Se o diff for confiavel, o `CI` usa validacao incremental.
3. Se a base de comparacao nao puder ser resolvida com seguranca, o `CI` cai em `full` fallback.
4. Em `pull_request`, `build-and-check` e `security-and-compliance` so rodam quando `release_eligible=true`.
5. Em `push` para `main`, esses jobs sempre rodam para validar o commit efetivamente publicado.
6. A telemetria `verify:enterprise-focus` roda apenas quando o commit atual e `release_eligible=true`; `docs-only` e `pipeline-only` em `main` continuam passando pelos jobs principais sem herdar ruído indevido de churn documental.
7. O job `trigger-release` so roda em push para `main` quando existe `release_pending=true`.
8. `release_pending` considera tambem o backlog elegivel desde a ultima tag, para que um push apenas de pipeline ou documentacao ainda consiga publicar codigo que permaneceu pendente de release.
9. `trigger-release` usa `always()` porque depende de jobs que podem ficar `skipped` em `pull_request`, mas nao deve herdar `skipped` indevido no fluxo de `push` para `main`.

### Telemetria de foco e churn

- `verify:enterprise-focus` virou telemetria advisory e nao atua mais como blocker rigido por thresholds ad hoc de arquivo especifico.
- A medicao continua priorizando o delta do evento atual e usa a janela historica apenas como contexto auxiliar de telemetria.
- Em `pull_request`, a comparacao usa `base.sha...head.sha`.
- Em `push`, a comparacao usa `before..after`, com fallback para o commit atual quando o push cria a referencia.
- A telemetria atual observa churn documental, churn de pipeline e hotspots de arquivos fonte alterados, sem acoplar o gate a nomes de arquivo especificos.

### Toolchain e compliance

- A versao de `Node.js` usada na esteira passa a vir exclusivamente de [`.nvmrc`](../../.nvmrc).
- A versao de `pnpm` usada na esteira passa a vir exclusivamente de [`package.json`](../../package.json), via `packageManager`.
- O setup de dependencias usa apenas o registry oficial do npm, com retries, sem fallback automatico para mirrors publicos.
- A verificacao de hardening e timeouts dos servicos Node saiu do YAML inline e foi centralizada em script versionado para reduzir duplicacao e fragilidade.
- O lint passou a cobrir tambem arquivos raiz de tooling fora do escopo do Turbo, como `scripts/*.mjs`, `tests/unit/*.ts` e `eslint.config.mjs`.

## Fluxo do `Release`

1. `create-release` valida o `target_sha` recebido, fixa a tag nesse commit e valida a versao.
2. `build-images` decide `build` versus `retag`.
3. `publish-release` publica notas e assets.
4. `trigger-deploy` dispara o workflow de deploy para releases normais.

## Fluxo do `Deploy`

1. recebe `version` e, quando aplicavel, `built_images`
2. prepara servidor, compose files, manifesto e `.env.prod`
3. executa smart pull antes do `compose up`
4. implanta por stack
5. valida health e executa rollback cirurgico quando necessario

## Artefatos que conectam as etapas

| Artefato | Sai de | Entra em | Papel |
| --- | --- | --- | --- |
| commit aprovado | `CI` | `Release` | garante que o publish parte de um commit ja validado |
| tag semantica | `Release` | `Deploy` | ancora versao publicada |
| `built_images` | `Release` | `Deploy` | informa pull seletivo versus retag |
| `images-manifest.json` | `Release` | `Deploy` | habilita smart pull por digest |

## Referencias

- [docs/engineering/validation-monorepo.md](validation-monorepo.md)
- [docs/engineering/pull-inteligente-flow.md](pull-inteligente-flow.md)
- [docs/operations/release.md](../operations/release.md)
- [docs/operations/deploy.md](../operations/deploy.md)
