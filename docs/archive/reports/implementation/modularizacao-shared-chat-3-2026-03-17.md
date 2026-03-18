# Modularizacao Inicial de `@alice/shared` e `@alice/shared-utils`

**Author:** Fillipe Guerra  
**Data:** 17 de Março de 2026

## Objetivo

Registrar a primeira fase segura de modularização dos dois maiores choke points compartilhados do monorepo:

- `packages/shared/src/schema.ts`
- `packages/shared-utils/src/index.ts`

Esta rodada preserva comportamento externo e evita migração ampla de consumidores.

## Findings principais

- O grafo incremental deixado pelo Chat 2 está confiável para estes pacotes.
- `scripts/run-scoped-task.mjs` e `scripts/test-scope.mjs` constroem o escopo a partir dos `package.json` reais dos workspaces e expandem dependentes para `build`, `typecheck` e `test`.
- Os commits `a80d9986` e `a514ea90` fecharam duas lacunas objetivas que afetavam diretamente `@alice/shared` e `@alice/shared-utils`: inclusão correta no grafo de workspace e guard de release para `packages/tsconfig.base.json`.
- `packages/shared/src/schema.ts` continua sendo o principal choke point estrutural do monorepo, mas a sua parte mais segura para extração já estava isolada conceitualmente: custom types de pgvector/bytea e contratos Zod/JSONB puros.
- `packages/shared-utils/src/index.ts` concentrava múltiplos domínios independentes em um único barrel raiz; a extração segura de maior retorno nesta rodada era interna, por domínio, sem alterar imports dos serviços.

## Mapa do que foi modularizado

### `@alice/shared`

Foram criados módulos internos em `packages/shared/src/schema/`:

- `custom-types.ts`
  - centraliza `textVector`, `vector`, `trainingVector1024`, `biometricsVector128` e `bytea`
- `jsonb-contracts.ts`
  - centraliza contratos Zod/JSONB reutilizados por múltiplas tabelas
  - inclui contratos de tenant, namespace profile, mensagens, integrações, training, webhook, escalation, media e sessão

`packages/shared/src/schema.ts`:

- permanece como facade pública canônica
- passou a importar custom types e contratos dos módulos internos
- continua responsável por tabelas Drizzle, relations, insert schemas e inferências
- teve o comentário inicial atualizado para refletir o estado real da modularização parcial

### `@alice/shared-utils`

Foram criados barrels internos por domínio:

- `src/agentic/index.ts`
- `src/llm/index.ts`
- `src/observability/index.ts`
- `src/platform/index.ts`
- `src/runtime/index.ts`
- `src/trading/index.ts`
- `src/training/index.ts`

`packages/shared-utils/src/index.ts`:

- continua sendo a API pública raiz
- passou a reexportar domínios internos em vez de listar cada módulo pesado individualmente
- preserva os exports explícitos de RBAC e os contratos públicos já utilizados pelos serviços

## Limites deliberados desta fase

- Nenhuma tabela Drizzle foi movida de `schema.ts` nesta rodada.
- Nenhuma relation, `insertSchema` ou `type infer` foi redistribuído para módulos de domínio ainda.
- Nenhum serviço consumidor foi migrado para novos barrels internos de `shared-utils`.
- Não houve alteração de bundling, deploy, workflows ou contratos externos de runtime.

## Próximo passo recomendado para o Chat 4

- Em `@alice/shared`, extrair domínios de tabela com dependência controlada, começando por blocos de baixo acoplamento e alto volume de edição.
- Em `@alice/shared-utils`, decidir quais barrels internos devem virar subpaths públicos estáveis antes de migrar consumidores gradualmente.
