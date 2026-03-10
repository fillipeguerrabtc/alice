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
- `P0-CONFIG-02`: Concluído
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
`P0-CONFIG-02` (Concluído)

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

### Rodada 2
- Data: 2026-03-10
- Bloco executado: `P0-CONFIG-02`
- Objetivo: Transformar `@alice/config` na fonte principal de configuração de runtime para serviços core do escopo, reduzir leitura direta de `process.env` e remover defaults/fallbacks inseguros no boot principal.
- Diagnóstico: A base tinha parsing/configuração distribuídos entre serviços e utilitários, com múltiplas leituras diretas de `process.env` e validações de URL/CORS não centralizadas no pacote de configuração.
- Arquivos lidos: `CLAUDE.md` (1-120), `package.json`, `packages/config/src/index.ts`, `packages/shared-utils/src/config.ts`, `packages/shared-utils/src/session-auth.ts`, `apps/api-gateway/src/index.ts`, `apps/auth-service/src/index.ts`, `apps/auth-service/src/routes/auth-registration-routes.ts`, `apps/chat-service/src/index.ts`, `apps/chat-service/src/runtime-config.ts`, `apps/rag-service/src/index.ts`, `apps/training-service/src/index.ts`, `apps/integrations-service/src/index.ts`, `apps/gpu-manager-service/src/index.ts`, `apps/llm-gateway-service/src/index.ts`, `apps/observability-service/src/index.ts`, `docs/PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md`, além de arquivos adicionais detectados por busca de `process.env` no escopo de `apps/` e `packages/`.
- Arquivos alterados: `packages/config/src/index.ts`, `packages/shared-utils/src/config.ts`, `packages/shared-utils/src/session-auth.ts`, `packages/shared-utils/package.json`, `packages/shared-utils/tsconfig.json`, `apps/chat-service/src/runtime-config.ts`, `apps/rag-service/src/index.ts`, `apps/training-service/src/index.ts`, `apps/integrations-service/src/index.ts`, `docs/PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md`.
- Validações executadas:
  - `pnpm --filter @alice/config typecheck` (executado via `npx -y pnpm@10.26.2 --filter @alice/config typecheck`)
  - `pnpm --filter @alice/config lint` (executado via `npx -y pnpm@10.26.2 --filter @alice/config lint`)
  - `pnpm --filter @alice/config build` (executado via `npx -y pnpm@10.26.2 --filter @alice/config build`)
  - `pnpm --filter @alice/shared-utils typecheck` (executado via `npx -y pnpm@10.26.2 --filter @alice/shared-utils typecheck`)
  - `pnpm --filter @alice/shared-utils lint` (executado via `npx -y pnpm@10.26.2 --filter @alice/shared-utils lint`)
  - `pnpm --filter @alice/shared-utils build` (executado via `npx -y pnpm@10.26.2 --filter @alice/shared-utils build`)
  - `pnpm --filter @alice/chat-service typecheck` (executado via `npx -y pnpm@10.26.2 --filter @alice/chat-service typecheck`)
  - `pnpm --filter @alice/chat-service lint` (executado via `npx -y pnpm@10.26.2 --filter @alice/chat-service lint`)
  - `pnpm --filter @alice/chat-service build` (executado via `npx -y pnpm@10.26.2 --filter @alice/chat-service build`)
  - `pnpm --filter @alice/rag-service typecheck` (executado via `npx -y pnpm@10.26.2 --filter @alice/rag-service typecheck`)
  - `pnpm --filter @alice/rag-service lint` (executado via `npx -y pnpm@10.26.2 --filter @alice/rag-service lint`)
  - `pnpm --filter @alice/rag-service build` (executado via `npx -y pnpm@10.26.2 --filter @alice/rag-service build`)
  - `pnpm --filter @alice/training-service typecheck` (executado via `npx -y pnpm@10.26.2 --filter @alice/training-service typecheck`)
  - `pnpm --filter @alice/training-service lint` (executado via `npx -y pnpm@10.26.2 --filter @alice/training-service lint`)
  - `pnpm --filter @alice/training-service build` (executado via `npx -y pnpm@10.26.2 --filter @alice/training-service build`)
  - `pnpm --filter @alice/integrations-service typecheck` (executado via `npx -y pnpm@10.26.2 --filter @alice/integrations-service typecheck`)
  - `pnpm --filter @alice/integrations-service lint` (executado via `npx -y pnpm@10.26.2 --filter @alice/integrations-service lint`)
  - `pnpm --filter @alice/integrations-service build` (executado via `npx -y pnpm@10.26.2 --filter @alice/integrations-service build`)
  - `pnpm test` (executado via `npx -y pnpm@10.26.2 test`)
  - `pnpm lint` (executado via `npx -y pnpm@10.26.2 lint`)
  - `pnpm build` (executado via `npx -y pnpm@10.26.2 build`)
- Resultado das validações:
  - Todas as validações obrigatórias do bloco foram aprovadas ao final.
  - Durante a rodada houve falha inicial em `pnpm test` por regressão de compatibilidade de defaults em `packages/shared-utils/src/config.ts`; o comportamento compatível foi restaurado no escopo, seguido de revalidação e aprovação.
  - Observação de ambiente: binário global `pnpm` permanece quebrado; os comandos foram executados com `npx -y pnpm@10.26.2`, preservando os comandos lógicos exigidos.
- Documentação atualizada: Tracking canônico atualizado com histórico factual da Rodada 2.
- Commit realizado: `refactor: centralize runtime configuration across core services`.
- Pendências:
  - Existem leituras diretas de `process.env` remanescentes em áreas fora do núcleo de boot/config alterado nesta rodada e em blocos futuros; não houve expansão de escopo para modularização ampla.
  - Validar posteriormente no ambiente do usuário a correção do binário global `pnpm`.
- Riscos ou bloqueios:
  - Sem bloqueio ativo para continuação; risco residual controlado por manter compatibilidade explícita em `packages/shared-utils/src/config.ts` onde exigido por testes/governança já existentes.
- Próximo bloco recomendado: `P0-BOOT-03`.

## Pendências abertas
- Correção do binário global `pnpm` no ambiente local (fora do escopo deste bloco).
- Reduzir leituras diretas de `process.env` remanescentes fora do escopo autorizado desta rodada, seguindo próximos blocos.

## Riscos e bloqueios
- Sem bloqueio ativo para continuação do backlog.
- Risco residual controlado: existência de bridge compatível em `shared/schema.ts` para proteger integrações legadas não mapeadas em tempo de descoberta.
- Risco residual controlado: parte das leituras de `process.env` permanece em áreas não tratadas neste bloco para evitar refatoração ampla fora do escopo autorizado.

## Próximos blocos permitidos
- `P0-BOOT-03`
- `P0-GATEWAY-AUTH-04`
- `P0-CORE-SERVICES-05`
- `P0-EXT-GPU-06`
- `P0-DOCS-07`
