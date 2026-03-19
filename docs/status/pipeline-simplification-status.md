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
- `node --check scripts/verify-enterprise-focus.mjs`
- `node --check scripts/resolve-toolchain.mjs`
- `node --check scripts/verify-node-service-hardening.mjs`
- `node ./scripts/resolve-toolchain.mjs`
- `bash ./scripts/verify-enterprise-focus.sh 5`
- `node ./scripts/verify-node-service-hardening.mjs`

## Observacao operacional

- O `ESLint` do repositorio travou mesmo em execucao isolada para os arquivos desta rodada, inclusive com timeout e `stdin`. Como os scripts novos vivem fora do escopo normalmente varrido pela configuracao atual, a validacao estrutural deles foi fechada com `node --check` e testes/execucao funcional direta.
