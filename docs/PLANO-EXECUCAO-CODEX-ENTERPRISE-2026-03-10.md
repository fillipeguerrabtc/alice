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
- `P0-BOOT-03`: Concluído
- `P0-GATEWAY-AUTH-04`: Concluído
- `P0-CORE-SERVICES-05`: Concluído
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
`P0-CORE-SERVICES-05` (Concluído)

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

### Rodada 3
- Data: 2026-03-10
- Bloco executado: `P0-BOOT-03`
- Objetivo: Isolar encerramento forçado de processo para entrypoints dos serviços, removendo `process.exit()` de bibliotecas/utilitários compartilhados e preservando fail-fast com logs e rastreabilidade.
- Diagnóstico: Foram identificados `process.exit()` em utilitários compartilhados (`session-auth`, `gpu-client`, `rbac/middleware`, `shutdown-manager`) e em módulos de suporte de serviços fora de entrypoint (`runtime-config`, `oidc/configuration`, `integrations-bootstrap-service`, `rag` processors, `gpu-client` local). Também havia pontos de shutdown por signal/exception que encerravam processo diretamente dentro de utilitário compartilhado.
- Arquivos lidos: `CLAUDE.md` (1-120), `package.json`, `packages/shared-utils/src/session-auth.ts`, `packages/shared-utils/src/gpu-client.ts`, `packages/shared-utils/src/rbac/middleware.ts`, `packages/shared-utils/src/shutdown-manager.ts`, `apps/api-gateway/src/index.ts`, `apps/auth-service/src/index.ts`, `apps/chat-service/src/index.ts`, `apps/gpu-manager-service/src/index.ts`, `apps/integrations-service/src/index.ts`, `apps/llm-gateway-service/src/index.ts`, `apps/observability-service/src/index.ts`, `apps/rag-service/src/index.ts`, `apps/training-service/src/index.ts`, `apps/auth-service/src/oidc/configuration.ts`, `apps/integrations-service/src/integrations-bootstrap-service.ts`, `apps/rag-service/src/image-processor.ts`, `apps/rag-service/src/audio-processor.ts`, `apps/gpu-manager-service/src/gpu-client.ts`, `apps/chat-service/src/runtime-config.ts`, `docs/PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md`.
- Arquivos alterados: `packages/shared-utils/src/session-auth.ts`, `packages/shared-utils/src/gpu-client.ts`, `packages/shared-utils/src/rbac/middleware.ts`, `packages/shared-utils/src/shutdown-manager.ts`, `apps/chat-service/src/runtime-config.ts`, `apps/chat-service/src/index.ts`, `apps/auth-service/src/oidc/configuration.ts`, `apps/auth-service/src/index.ts`, `apps/rag-service/src/image-processor.ts`, `apps/rag-service/src/audio-processor.ts`, `apps/rag-service/src/index.ts`, `apps/gpu-manager-service/src/gpu-client.ts`, `apps/integrations-service/src/integrations-bootstrap-service.ts`, `apps/integrations-service/src/index.ts`, `docs/STATUS-REAL-ATUAL.md`, `docs/PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md`.
- Validações executadas:
  - `pnpm --filter @alice/shared-utils typecheck` (executado via `npx -y pnpm@10.26.2 --filter @alice/shared-utils typecheck`)
  - `pnpm --filter @alice/shared-utils lint` (executado via `npx -y pnpm@10.26.2 --filter @alice/shared-utils lint`)
  - `pnpm --filter @alice/shared-utils build` (executado via `npx -y pnpm@10.26.2 --filter @alice/shared-utils build`)
  - `pnpm --filter @alice/auth-service typecheck` (executado via `npx -y pnpm@10.26.2 --filter @alice/auth-service typecheck`)
  - `pnpm --filter @alice/auth-service lint` (executado via `npx -y pnpm@10.26.2 --filter @alice/auth-service lint`)
  - `pnpm --filter @alice/auth-service build` (executado via `npx -y pnpm@10.26.2 --filter @alice/auth-service build`)
  - `pnpm --filter @alice/chat-service typecheck` (executado via `npx -y pnpm@10.26.2 --filter @alice/chat-service typecheck`)
  - `pnpm --filter @alice/chat-service lint` (executado via `npx -y pnpm@10.26.2 --filter @alice/chat-service lint`)
  - `pnpm --filter @alice/chat-service build` (executado via `npx -y pnpm@10.26.2 --filter @alice/chat-service build`)
  - `pnpm --filter @alice/rag-service typecheck` (executado via `npx -y pnpm@10.26.2 --filter @alice/rag-service typecheck`)
  - `pnpm --filter @alice/rag-service lint` (executado via `npx -y pnpm@10.26.2 --filter @alice/rag-service lint`)
  - `pnpm --filter @alice/rag-service build` (executado via `npx -y pnpm@10.26.2 --filter @alice/rag-service build`)
  - `pnpm --filter @alice/integrations-service typecheck` (executado via `npx -y pnpm@10.26.2 --filter @alice/integrations-service typecheck`)
  - `pnpm --filter @alice/integrations-service lint` (executado via `npx -y pnpm@10.26.2 --filter @alice/integrations-service lint`)
  - `pnpm --filter @alice/integrations-service build` (executado via `npx -y pnpm@10.26.2 --filter @alice/integrations-service build`)
  - `pnpm --filter @alice/gpu-manager-service typecheck` (executado via `npx -y pnpm@10.26.2 --filter @alice/gpu-manager-service typecheck`)
  - `pnpm --filter @alice/gpu-manager-service lint` (executado via `npx -y pnpm@10.26.2 --filter @alice/gpu-manager-service lint`)
  - `pnpm --filter @alice/gpu-manager-service build` (executado via `npx -y pnpm@10.26.2 --filter @alice/gpu-manager-service build`)
  - `pnpm test` (executado via `npx -y pnpm@10.26.2 test`)
  - `pnpm lint` (executado via `npx -y pnpm@10.26.2 lint`)
  - `pnpm build` (executado via `npx -y pnpm@10.26.2 build`)
- Resultado das validações:
  - Todas as validações obrigatórias do bloco foram aprovadas.
  - Verificação pós-implementação confirmou ausência de `process.exit()` fora de entrypoints em `apps/` e `packages/` (desconsiderando Dockerfiles de healthcheck).
  - Observação de ambiente: binário global `pnpm` permanece quebrado; os comandos foram executados com `npx -y pnpm@10.26.2`, preservando os comandos lógicos exigidos.
- Documentação atualizada: `docs/STATUS-REAL-ATUAL.md` e tracking canônico atualizados com mudança de convenção de fail-fast/shutdown e evidências factuais da rodada.
- Commit realizado: `refactor: isolate process termination to service entrypoints`.
- Pendências:
  - Validar posteriormente no ambiente do usuário a correção do binário global `pnpm`.
- Riscos ou bloqueios:
  - Sem bloqueio ativo para continuação.
- Risco residual controlado: módulos de processamento multimodal do RAG (`image-processor`/`audio-processor`) permanecem sem `process.exit()` e dependem de validação/falha no boot/execução via entrypoint para impedir operação sem `OPENAI_API_KEY` em produção.
- Próximo bloco recomendado: `P0-GATEWAY-AUTH-04`.

### Rodada 4
- Data: 2026-03-10
- Bloco executado: `P0-GATEWAY-AUTH-04`
- Objetivo: Harden cirúrgico de `api-gateway` e `auth-service` para consolidar descoberta de serviços, `base URL`, callbacks, `origins/CORS` e configurações correlatas em configuração tipada central, removendo hardcodes operacionais e defaults frágeis.
- Diagnóstico: Foram encontrados hardcodes e leitura direta de `process.env` em pontos críticos de gateway/auth (`CORS`, callbacks OAuth, domínio default de tenant, fallback de `GRAFANA_URL`, issuer OIDC), com acoplamento operacional a domínio legado e validações distribuídas fora do padrão central.
- Arquivos lidos: `CLAUDE.md` (1-120), `package.json`, `packages/config/src/index.ts`, `packages/shared-utils/src/config.ts`, `apps/api-gateway/src/index.ts`, `apps/auth-service/src/index.ts`, `apps/auth-service/src/routes/auth-registration-routes.ts`, `apps/auth-service/src/routes/auth-provider-routes.ts`, `apps/auth-service/src/routes/auth-system-routes.ts`, `apps/auth-service/src/oidc/index.ts`, `apps/auth-service/src/oidc/configuration.ts`, `ARCHITECTURE-AUTH-FLOW.md`, `docs/PERMISSIONS.md`, `docs/ARQUITETURA.md`, `docs/STATUS-REAL-ATUAL.md`, `docs/PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md`.
- Arquivos alterados: `packages/config/src/index.ts`, `apps/api-gateway/src/index.ts`, `apps/auth-service/src/index.ts`, `apps/auth-service/src/routes/auth-registration-routes.ts`, `apps/auth-service/src/oidc/configuration.ts`, `apps/auth-service/src/oidc/index.ts`, `docs/STATUS-REAL-ATUAL.md`, `docs/PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md`.
- Validações executadas:
  - `pnpm exec tsc -p apps/api-gateway/tsconfig.json --noEmit` (executado via `npx -y pnpm@10.26.2 exec tsc -p apps/api-gateway/tsconfig.json --noEmit`)
  - `pnpm exec eslint apps/api-gateway/src/` (executado via `npx -y pnpm@10.26.2 exec eslint apps/api-gateway/src/`)
  - `pnpm --filter @alice/api-gateway build` (executado via `npx -y pnpm@10.26.2 --filter @alice/api-gateway build`)
  - `pnpm --filter @alice/auth-service typecheck` (executado via `npx -y pnpm@10.26.2 --filter @alice/auth-service typecheck`)
  - `pnpm --filter @alice/auth-service lint` (executado via `npx -y pnpm@10.26.2 --filter @alice/auth-service lint`)
  - `pnpm --filter @alice/auth-service build` (executado via `npx -y pnpm@10.26.2 --filter @alice/auth-service build`)
  - `pnpm --filter @alice/config typecheck` (executado via `npx -y pnpm@10.26.2 --filter @alice/config typecheck`)
  - `pnpm --filter @alice/config lint` (executado via `npx -y pnpm@10.26.2 --filter @alice/config lint`)
  - `pnpm --filter @alice/config build` (executado via `npx -y pnpm@10.26.2 --filter @alice/config build`)
  - `pnpm test` (executado via `npx -y pnpm@10.26.2 test`)
  - `pnpm lint` (executado via `npx -y pnpm@10.26.2 lint`)
  - `pnpm build` (executado via `npx -y pnpm@10.26.2 build`)
  - Reexecução final após ajuste textual em `apps/api-gateway/src/index.ts`: `pnpm exec tsc -p apps/api-gateway/tsconfig.json --noEmit`, `pnpm exec eslint apps/api-gateway/src/`, `pnpm --filter @alice/api-gateway build` (todos executados via `npx -y pnpm@10.26.2 ...`).
- Resultado das validações:
  - Todas as validações obrigatórias do bloco foram aprovadas ao final.
  - Houve 1 falha inicial em `pnpm exec tsc -p apps/api-gateway/tsconfig.json --noEmit` por tipagem de export recém-adicionado em `@alice/config` ainda não materializada em `dist`; após `@alice/config build`, a validação foi reexecutada e aprovada.
  - Observação de ambiente: binário global `pnpm` permanece quebrado; os comandos foram executados com `npx -y pnpm@10.26.2`, preservando os comandos lógicos exigidos.
- Documentação atualizada: `docs/STATUS-REAL-ATUAL.md` e tracking canônico atualizados com o hardening de runtime config/callbacks/origins no bloco gateway/auth.
- Commit realizado: `refactor: harden gateway and auth runtime configuration`.
- Pendências:
  - Validar posteriormente no ambiente do usuário a correção do binário global `pnpm`.
- Riscos ou bloqueios:
  - Sem bloqueio ativo para continuação.
  - Hardening introduziu fail-fast explícito em produção para variáveis críticas (`BASE_URL`/`PRODUCTION_DOMAIN` para domínio de tenant, `OIDC_ISSUER` ou `APP_BASE_URL` para issuer OIDC, `GRAFANA_URL` para seed de cliente OAuth), exigindo configuração consistente no ambiente produtivo.
- Próximo bloco recomendado: `P0-CORE-SERVICES-05`.

### Rodada 5
- Data: 2026-03-10
- Bloco executado: `P0-CORE-SERVICES-05`
- Objetivo: Hardening cirúrgico de Chat, RAG e Training com foco em consumo de configuração, validação de borda e previsibilidade de boot sem alterar invariantes assíncronas de filas/jobs.
- Diagnóstico: Foi identificado uso direto de `process.env` em pontos críticos de runtime nos três serviços, um hardcode operacional de domínio no web crawler do RAG e lacuna de validação de payload no endpoint `POST /api/rag/classify`; a arquitetura de filas/idempotência/retries já estava preservada e não exigia refatoração estrutural.
- Arquivos lidos: `CLAUDE.md` (1-120), `package.json`, `packages/config/src/index.ts`, `packages/shared-utils/src/config.ts`, `packages/shared-utils/src/training-queues.ts`, `apps/chat-service/src/index.ts` (chunks), `apps/chat-service/src/openapi-specs.ts`, `apps/chat-service/src/runtime-config.ts`, `apps/chat-service/src/rag-client.ts`, `apps/chat-service/src/lora-adapter-resolver.ts`, `apps/chat-service/src/response-cache.ts`, `apps/rag-service/src/index.ts` (chunks), `apps/rag-service/src/openapi-specs.ts`, `apps/rag-service/src/workers/web-crawl-worker.ts`, `apps/rag-service/src/workers/learning-worker.ts`, `apps/training-service/src/index.ts` (chunks), `apps/training-service/src/openapi-specs.ts`, `apps/training-service/src/training-config.ts`, `apps/training-service/src/routes/training-webhook-routes.ts`, `docs/STATUS-REAL-ATUAL.md`, `docs/PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md`.
- Arquivos alterados: `apps/chat-service/src/rag-client.ts`, `apps/chat-service/src/lora-adapter-resolver.ts`, `apps/chat-service/src/response-cache.ts`, `apps/rag-service/src/index.ts`, `apps/rag-service/src/workers/web-crawl-worker.ts`, `apps/training-service/src/index.ts`, `docs/STATUS-REAL-ATUAL.md`, `docs/PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md`.
- Validações executadas:
  - `pnpm --filter @alice/chat-service typecheck` (executado via `npx -y pnpm@10.26.2 --filter @alice/chat-service typecheck`)
  - `pnpm --filter @alice/chat-service lint` (executado via `npx -y pnpm@10.26.2 --filter @alice/chat-service lint`)
  - `pnpm --filter @alice/chat-service build` (executado via `npx -y pnpm@10.26.2 --filter @alice/chat-service build`)
  - `pnpm --filter @alice/rag-service typecheck` (executado via `npx -y pnpm@10.26.2 --filter @alice/rag-service typecheck`)
  - `pnpm --filter @alice/rag-service lint` (executado via `npx -y pnpm@10.26.2 --filter @alice/rag-service lint`)
  - `pnpm --filter @alice/rag-service build` (executado via `npx -y pnpm@10.26.2 --filter @alice/rag-service build`)
  - `pnpm --filter @alice/training-service typecheck` (executado via `npx -y pnpm@10.26.2 --filter @alice/training-service typecheck`)
  - `pnpm --filter @alice/training-service lint` (executado via `npx -y pnpm@10.26.2 --filter @alice/training-service lint`)
  - `pnpm --filter @alice/training-service build` (executado via `npx -y pnpm@10.26.2 --filter @alice/training-service build`)
  - `pnpm test` (executado via `npx -y pnpm@10.26.2 test`)
  - `pnpm lint` (executado via `npx -y pnpm@10.26.2 lint`)
  - `pnpm build` (executado via `npx -y pnpm@10.26.2 build`)
- Resultado das validações:
  - Todas as validações obrigatórias do bloco foram aprovadas ao final.
  - Nenhuma regressão de fila, retry, idempotência ou boot foi detectada nas validações executadas.
  - Observação de ambiente: binário global `pnpm` permanece quebrado; os comandos foram executados com `npx -y pnpm@10.26.2`, preservando os comandos lógicos exigidos.
- Documentação atualizada: `docs/STATUS-REAL-ATUAL.md` e tracking canônico atualizados com os fatos da Rodada 5.
- Commit realizado: `refactor: harden runtime boundaries for chat rag and training`.
- Pendências:
  - Validar posteriormente no ambiente do usuário a correção do binário global `pnpm`.
- Riscos ou bloqueios:
  - Sem bloqueio ativo para continuação.
  - Compatibilidade local mantida para `GPU_MANAGER_URL` no `training-service` via fallback restrito a desenvolvimento; em produção o serviço passa a falhar deterministicamente quando a variável não estiver configurada.
- Próximo bloco recomendado: `P0-EXT-GPU-06`.

## Pendências abertas
- Correção do binário global `pnpm` no ambiente local (fora do escopo deste bloco).
- Reduzir leituras diretas de `process.env` remanescentes fora do escopo autorizado desta rodada, seguindo próximos blocos.

## Riscos e bloqueios
- Sem bloqueio ativo para continuação do backlog.
- Risco residual controlado: existência de bridge compatível em `shared/schema.ts` para proteger integrações legadas não mapeadas em tempo de descoberta.
- Risco residual controlado: parte das leituras de `process.env` permanece em áreas não tratadas neste bloco para evitar refatoração ampla fora do escopo autorizado.
- Risco residual controlado: módulos de suporte multimodal do RAG dependem de fail-fast no entrypoint/execução para bloquear operação sem `OPENAI_API_KEY` em produção.

## Próximos blocos permitidos
- `P0-EXT-GPU-06`
- `P0-DOCS-07`
