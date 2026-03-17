# Relatorio de Reducao de Monolitos - Chat 4

**Author:** Fillipe Guerra  
**Data:** 17 de Marco de 2026

## Objetivo da rodada
Executar a primeira rodada segura de reducao de monolitos em:

- `apps/chat-service`
- `apps/training-service`
- `apps/integrations-service`

Sem revisar bundling, sem tocar em workflows/triggers e sem reabrir `shared/schema` ou `shared-utils` fora do estritamente necessario.

## Verificacao previa da base compartilhada
Antes das extracoes, foi verificado que a base compartilhada estava utilizavel para refatoracao incremental:

- `packages/shared` e `packages/shared-utils` possuem exports organizados e artefatos `dist/` gerados.
- Os logs locais em `packages/shared/.turbo/turbo-typecheck.log` e `packages/shared-utils/.turbo/turbo-typecheck.log` indicavam execucao limpa de `tsc --noEmit`.
- Nao foi identificado bloqueio estrutural que impedisse extracoes cirurgicas nos servicos.

## Extracoes seguras realizadas

### 1. Chat Service
Foi criado o modulo `apps/chat-service/src/chat-operational-routes.ts`.

Responsabilidades movidas do `index.ts`:

- runtime e validacao de `ws-token`
- rotas operacionais de `health`, `version`, `live` e `ready`

Resultado:

- `index.ts` ficou mais orientado a composicao/bootstrap
- o runtime de WebSocket continua reutilizando o mesmo contrato de `verifyWsToken` e `consumeWsTokenNonce`
- comportamento funcional foi preservado

### 2. Training Service
Foi criado o registrador `apps/training-service/src/training-route-registration.ts`.

Responsabilidades movidas do `index.ts`:

- sequenciamento de registro das rotas ja modularizadas do servico

Resultado:

- o `index.ts` deixou de ser o ponto que lista diretamente todos os `register*Routes(...)`
- a orquestracao de rotas ficou centralizada em um modulo dedicado
- nenhuma regra de negocio foi alterada

### 3. Integrations Service
Foi criado o modulo `apps/integrations-service/src/integrations-wise-routes.ts`.

Responsabilidades movidas do `index.ts`:

- composicao completa do dominio `Wise`
- helpers de auth/contexto e persistencia auxiliar usados apenas por esse dominio
- registro das rotas `Wise` especializadas

Resultado:

- a primeira extracao por dominio foi concluida sem tocar no dominio `KuCoin`
- o `index.ts` ficou menos concentrador no bloco `Wise`
- o comportamento externo das rotas foi preservado

## Validacoes executadas

### Typecheck
- `pnpm --filter @alice/chat-service run typecheck`
- `pnpm --filter @alice/training-service run typecheck`
- `pnpm --filter @alice/integrations-service run typecheck`

Resultado final: todos concluidos com sucesso.

### Testes
Nao foi possivel executar testes especificos do escopo alterado com comando dedicado, por ausencia de cobertura local nos tres pacotes:

- os `package.json` de `chat-service`, `training-service` e `integrations-service` nao expõem script `test`
- a busca por `*.spec.ts` e `*.test.ts` dentro desses tres servicos nao retornou arquivos

### ESLint
- `pnpm --filter @alice/chat-service run lint`
- `pnpm --filter @alice/training-service run lint`
- `pnpm --filter @alice/integrations-service run lint`

Resultado final: zero erros e zero warnings.

### Build
- `pnpm --filter @alice/chat-service run build`
- `pnpm --filter @alice/training-service run build`
- `pnpm --filter @alice/integrations-service run build`

Resultado final: todos concluidos com sucesso.

## Limites e continuidade para o Chat 5

- `chat-service`: ainda permanece com grande volume de rotas e regras de dominio no `index.ts`; a rodada atual atacou apenas a fatia operacional mais segura.
- `training-service`: a rodada atual removeu a listagem direta das rotas do `index.ts`, mas ainda restam blocos extensos de workers e runtime no arquivo principal.
- `integrations-service`: apenas o dominio `Wise` foi extraido nesta rodada; `Trading/KuCoin`, `Twilio` e startup global continuam no `index.ts`.
- bundling, deploy, workflows e mudancas amplas em shared ficaram fora do escopo desta rodada.
