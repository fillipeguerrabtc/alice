# Status da Simplificacao da Pipeline

**Author:** Fillipe Guerra
**Data:** 19 de Marco de 2026
**Atualizado:** 19 de Marco de 2026
**Status:** ativo
**Tipo:** status

## Objetivo

Registrar a rodada de simplificacao da pipeline para reduzir governanca artesanal, manter o papel claro de `CI`, `Release` e `Deploy` e alinhar a esteira com melhores praticas enterprise atuais.

## Plano executivo aprovado

1. Remover o bloqueio rigido baseado em thresholds ad hoc de arquivos especificos.
2. Tornar a resolucao de `Node.js` e `pnpm` deterministica a partir do repositorio.
3. Eliminar fallback automatico para mirror publico de npm no setup compartilhado.
4. Tirar verificacoes grandes de compliance do YAML inline e centraliza-las em scripts versionados.
5. Marcar `Release` e `Deploy` com ambientes GitHub explicitos sem alterar triggers.

## Implementado nesta rodada

- `verify:enterprise-focus` virou telemetria advisory e deixou de bloquear a esteira por thresholds hardcoded de arquivos especificos.
- A telemetria foi reescrita para observar churn documental, churn de pipeline e hotspots de arquivos fonte alterados.
- A resolucao de toolchain foi centralizada em `scripts/resolve-toolchain.mjs`, usando `.nvmrc` e `packageManager`.
- A action `setup-node-pnpm` deixou de trocar para mirror publico e passou a usar apenas o registry oficial do npm com retries.
- A verificacao de hardening/timeouts dos servicos Node foi movida para `scripts/verify-node-service-hardening.mjs`.
- `Release` e `Deploy` agora usam ambientes GitHub explicitos (`release` e `production`).
- O lint passou a cobrir tambem arquivos raiz de tooling com `scripts/run-root-lint.mjs`, fechando o gap de scripts `.mjs` e testes raiz fora do escopo do Turbo.

## Gaps ainda mapeados

- O encadeamento `CI -> Release -> Deploy` ainda depende de `workflow_dispatch` com `GH_PAT`.
- O workflow `deploy-stack-modular.yml` continua grande e candidato a uma refatoracao posterior por reusable workflows ou actions compostas.
- Parte da validacao de compliance ainda e heuristica textual; o proximo nivel enterprise seria migrar para regras baseadas em AST ou testes estruturais por servico.

## Resultado esperado

- Menos falsos bloqueios por regras artesanais.
- Menos dependencia de rede externa para descobrir versoes de toolchain.
- Menor complexidade inline nos workflows.
- Melhor base para evoluir a esteira sem reintroduzir gates ad hoc.

## Validacoes desta rodada

- `pnpm exec vitest run tests/unit/enterprise-focus-governance.test.ts`
- `pnpm exec eslint --no-ignore eslint.config.mjs scripts/verify-enterprise-focus.mjs scripts/resolve-toolchain.mjs scripts/verify-node-service-hardening.mjs scripts/run-root-lint.mjs tests/unit/enterprise-focus-governance.test.ts`
- `node --check scripts/verify-enterprise-focus.mjs`
- `node --check scripts/resolve-toolchain.mjs`
- `node --check scripts/verify-node-service-hardening.mjs`
- `node --check scripts/run-root-lint.mjs`
- `node ./scripts/resolve-toolchain.mjs`
- `bash ./scripts/verify-enterprise-focus.sh 5`
- `node ./scripts/verify-node-service-hardening.mjs`
- `node ./scripts/run-root-lint.mjs`

## Observacao operacional

- O `ESLint` nao estava em deadlock; a investigacao mostrou bootstrap frio de aproximadamente 11 segundos para carregar `eslint.config.mjs` e o stack `typescript-eslint`, enquanto o lint efetivo do arquivo levava menos de 200 ms. O outro gap era estrutural: o lint incremental via `Turbo` nao cobria arquivos raiz de tooling, e o config ignorava `.mjs` por padrao. A rodada atual fechou esse ponto com lint raiz dedicado e uso explicito de `--no-ignore`.
