# Overview da Pipeline

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026
**Status:** ativo
**Tipo:** ssot

## Objetivo

Definir o comportamento vigente da esteira da Alice, separando validacao, publicacao e implantacao sem duplicar gates entre `CI`, `Release` e `Deploy`.

## Workflows oficiais

| Etapa | Workflow | Papel |
| --- | --- | --- |
| `CI` | [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) | validar codigo, seguranca e governanca do commit elegivel |
| `Release` | [`.github/workflows/release.yml`](../../.github/workflows/release.yml) | publicar artefatos aprovados |
| `Deploy` | [`.github/workflows/deploy-stack-modular.yml`](../../.github/workflows/deploy-stack-modular.yml) | implantar artefatos publicados |

## Contrato da esteira

- `CI` valida.
- `Release` publica.
- `Deploy` implanta.
- `Release` nao repete o gate de qualidade do `CI`.
- `Release` exige `CI` bem-sucedido para o mesmo commit alvo.
- `docs-only` e `pipeline-only` nao seguem automaticamente para `Release` ou `Deploy`.

## Classificacao de mudanca

### `docs-only`

O `CI` considera `docs-only=true` quando todos os arquivos alterados sao documentacao, inclusive Markdown fora de `docs/`.

Efeito:

- nao roda checks de codigo da aplicacao
- nao dispara `Release`
- a validacao esperada e documental

### `pipeline-only`

Arquivos em:

- `.github/workflows/`
- `.github/actions/`
- `.github/.workflow-test`

Efeito:

- nao ha `release-eligible`
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
4. `build-and-check` e `security-and-compliance` so rodam quando `release_eligible=true`.
5. O job `trigger-release` so roda em push para `main`, com `release_eligible=true` e sucesso dos jobs obrigatorios.

### Governanca de churn documental

- O guardrail `verify:enterprise-focus` bloqueia o `CI` pelo delta do evento atual, nunca por ruído acumulado da branch principal.
- Em `pull_request`, a comparacao usa `base.sha...head.sha`.
- Em `push`, a comparacao usa `before..after`, com fallback para o commit atual quando o push cria a referencia.
- A janela historica de 50 commits continua existindo apenas como telemetria e pode gerar `WARN`, mas nao deve bloquear merges validos por churn documental preexistente.

## Fluxo do `Release`

1. `validate-ci-status` confirma um run bem-sucedido do `CI` para o mesmo commit.
2. `create-release` valida a versao e cria a tag.
3. `build-images` decide `build` versus `retag`.
4. `publish-release` publica notas e assets.
5. `trigger-deploy` dispara o workflow de deploy para releases normais.

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
