# Plano de Execução Codex Enterprise
Author: Fillipe Guerra
Data de criação: 2026-03-10
Última atualização: 2026-03-10

## Objetivo
Executar o backlog técnico enterprise do monorepo Alice com rastreabilidade canônica, validação real e aderência integral ao `CLAUDE.md` e às regras operacionais desta governança.

## Regras operacionais resumidas
- Executar somente um bloco por rodada, mediante autorização explícita.
- Não alterar gatilhos (`on:`) de workflows.
- Não usar mocks, stubs, placeholders, workarounds, hardcoded ou lógica in-memory.
- Reutilizar padrões existentes do monorepo e não inventar arquitetura.
- Validar de forma serial e registrar resultados reais no tracking.
- Manter documentação e histórico cumulativo em Português Brasileiro.
- Realizar um único commit consolidado por rodada, em inglês, sem push automático.

## Status global do backlog
- `P0-ROOT-01`: Concluído
- `P0-CONFIG-02`: Não iniciado
- `P0-BOOT-03`: Não iniciado
- `P0-GATEWAY-AUTH-04`: Não iniciado
- `P0-CORE-SERVICES-05`: Não iniciado
- `P0-EXT-GPU-06`: Não iniciado
- `P0-DOCS-07`: Não iniciado
- `P1-API-01`: Não iniciado
- `P1-AUTH-02`: Não iniciado
- `P1-CHAT-03`: Não iniciado
- `P1-RAG-04`: Não iniciado
- `P1-TRAINING-05`: Não iniciado
- `P1-INTEGRATIONS-06`: Não iniciado
- `P1-GPU-LLM-07`: Não iniciado
- `P1-OBS-08`: Não iniciado
- `P1-FRONT-09`: Não iniciado
- `P1-CONTRACTS-10`: Não iniciado
- `P1-BIOMETRICS-11`: Não iniciado
- `P1-DOCS-12`: Não iniciado
- `P2-HYGIENE-01`: Não iniciado
- `P2-CI-02`: Não iniciado
- `P2-INFRA-03`: Não iniciado
- `P2-OTEL-04`: Não iniciado
- `P2-TSCONFIG-05`: Não iniciado
- `P2-DOCS-06`: Não iniciado

## Bloco atual
`P0-ROOT-01` (Concluído)

## Histórico de rodadas

### Rodada 0
- Data: 2026-03-10
- Bloco executado: Nenhum (pré-inicialização do tracking)
- Objetivo: Criar arquivo canônico obrigatório de tracking.
- Diagnóstico: Governança recebida sem BLOCO_ALVO explícito na ocasião; arquivo de tracking inexistente.
- Arquivos lidos: `CLAUDE.md` (linhas 1-100), listagem da raiz do repositório, listagem de `docs/`.
- Arquivos alterados: `docs/PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md`.
- Validações executadas: Não aplicável (sem alteração de código).
- Resultado das validações: Não aplicável.
- Documentação atualizada: Tracking canônico criado.
- Commit realizado: `docs: initialize codex enterprise execution tracking`.
- Pendências: Definir BLOCO_ALVO explícito para execução técnica.
- Riscos ou bloqueios: Sem BLOCO_ALVO explícito, risco de execução fora de escopo.
- Próximo bloco recomendado: Aguardando instrução explícita do autor da solicitação.

### Rodada 1
- Data: 2026-03-10
- Bloco executado: `P0-ROOT-01`
- Objetivo: Consolidar fonte canônica de schema, reduzir drift legado e migrar consumidores críticos para a fonte correta.
- Diagnóstico: Existiam duas trilhas de schema (`shared/schema.ts` e `packages/shared/src/schema.ts`) com drift funcional relevante (37 tabelas vs 129 tabelas e diferenças em enums/tipos), além de consumidores ainda apontando para `@shared/schema`.
- Arquivos lidos: `CLAUDE.md` (1-120), `package.json`, `packages/shared/src/schema.ts` (regiões relevantes incluindo topo e bloco de tipos/exports), `shared/schema.ts` (arquivo completo em chunks), `server/db.ts`, `server/index-dev.ts`, `server/index-prod.ts`, `server/replitAuth.ts`, `server/routes.ts`, `server/services/llm-client.ts`, `server/storage.ts`, `apps/training-service/src/auto-learning-scheduler.ts`, `apps/chat-service/src/trading-orchestrator.ts`, `apps/chat-service/src/conversation-orchestrator.ts`, `apps/auth-service/src/oidc/jwks.ts`, `apps/auth-service/src/oidc/configuration.ts`, `apps/auth-service/src/oidc/adapter.ts`, `apps/integrations-service/src/trading/core/types.ts`, `tests/unit/schema-validation.test.ts`.
- Arquivos alterados: `shared/schema.ts`, `server/db.ts`, `server/storage.ts`, `tests/unit/schema-validation.test.ts`, `packages/shared-utils/src/feature-flags-storage.ts`, `docs/PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md`.
- Validações executadas:
  - `pnpm --filter @alice/shared typecheck` (executado via `npx -y pnpm@10.26.2 --filter @alice/shared typecheck`)
  - `pnpm --filter @alice/shared lint` (executado via `npx -y pnpm@10.26.2 --filter @alice/shared lint`)
  - `pnpm --filter @alice/shared build` (executado via `npx -y pnpm@10.26.2 --filter @alice/shared build`)
  - `pnpm --filter @alice/database typecheck` (executado via `npx -y pnpm@10.26.2 --filter @alice/database typecheck`)
  - `pnpm --filter @alice/database lint` (executado via `npx -y pnpm@10.26.2 --filter @alice/database lint`)
  - `pnpm --filter @alice/database build` (executado via `npx -y pnpm@10.26.2 --filter @alice/database build`)
  - `pnpm test` (executado via `npx -y pnpm@10.26.2 test`)
  - `pnpm lint` (executado via `npx -y pnpm@10.26.2 lint`)
  - `pnpm build` (executado via `npx -y pnpm@10.26.2 build`)
- Resultado das validações:
  - Todas as validações obrigatórias aprovadas ao final.
  - Houve 1 falha inicial em `pnpm test` após migração para schema canônico (expectativa antiga do enum `trainingDataStatusEnum` sem `reserved`), corrigida no escopo e revalidada com sucesso.
  - Observação de ambiente: binário global `pnpm` estava quebrado nesta sessão; execução foi feita com `npx -y pnpm@10.26.2` mantendo os mesmos comandos lógicos exigidos.
- Documentação atualizada: Tracking canônico atualizado com histórico cumulativo e status completo do backlog.
- Commit realizado: `refactor: consolidate canonical schema and retire legacy drift paths`.
- Pendências:
  - Validar posteriormente no ambiente do usuário a reinstalação/correção do binário global `pnpm` para evitar dependência de `npx`.
- Riscos ou bloqueios:
  - `shared/schema.ts` foi mantido como bridge explícita de compatibilidade para evitar quebra imediata de import legado eventual fora do mapeamento detectado.
- Próximo bloco recomendado: `P0-CONFIG-02`.

## Pendências abertas
- Correção do binário global `pnpm` no ambiente local (fora do escopo deste bloco).

## Riscos e bloqueios
- Sem bloqueio ativo para continuação do backlog.
- Risco residual controlado: existência de bridge compatível em `shared/schema.ts` para proteger integrações legadas não mapeadas em tempo de descoberta.

## Próximos blocos permitidos
- `P0-CONFIG-02`
- `P0-BOOT-03`
- `P0-GATEWAY-AUTH-04`
- `P0-CORE-SERVICES-05`
- `P0-EXT-GPU-06`
- `P0-DOCS-07`
