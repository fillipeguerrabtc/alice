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
- `P0-EXT-GPU-06`: Concluído
- `P0-DOCS-07`: Concluído
- `P1-API-01`: Concluído
- `P1-AUTH-02`: Concluído
- `P1-CHAT-03`: Concluído
- `P1-RAG-04`: Concluído
- `P1-TRAINING-05`: Concluído
- `P1-INTEGRATIONS-06`: Concluído
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
`P1-INTEGRATIONS-06` (Concluído)

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

### Rodada 6
- Data: 2026-03-10
- Bloco executado: `P0-EXT-GPU-06`
- Objetivo: Hardening cirúrgico de integrações externas, `gpu-manager-service` e `llm-gateway-service` com foco em config tipada, URLs, timeouts e previsibilidade de boot/runtime.
- Diagnóstico: O escopo tinha leitura direta de `process.env` em módulos críticos de integração externa (`kucoinClient`, `kucoinRequest`, `kucoinUnifiedWebSocket`, `wiseService`, `wiseClient`) e nos entrypoints de `gpu-manager-service`/`llm-gateway-service`, além de constantes de timeout hardcoded em pontos operacionais.
- Arquivos lidos: `CLAUDE.md` (1-120), `package.json`, `packages/config/src/index.ts`, `packages/shared-utils/src/config.ts`, `apps/integrations-service/src/index.ts` (chunks), `apps/integrations-service/src/kucoinService.ts` (chunks), `apps/integrations-service/src/kucoinClient.ts` (chunks), `apps/integrations-service/src/kucoinUnifiedWebSocket.ts` (chunks), `apps/integrations-service/src/wiseService.ts` (chunks), `apps/gpu-manager-service/src/index.ts` (chunks), `apps/llm-gateway-service/src/index.ts` (chunks), `apps/llm-gateway-service/src/governance.ts`, `apps/integrations-service/src/kucoinRequest.ts`, `apps/integrations-service/src/wiseClient.ts`, `apps/integrations-service/src/runtime-config.ts`, `apps/gpu-manager-service/src/gpu-orchestrator.ts`, `docs/PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md`.
- Arquivos alterados: `apps/integrations-service/src/index.ts`, `apps/integrations-service/src/kucoinClient.ts`, `apps/integrations-service/src/kucoinRequest.ts`, `apps/integrations-service/src/kucoinUnifiedWebSocket.ts`, `apps/integrations-service/src/wiseClient.ts`, `apps/integrations-service/src/wiseService.ts`, `apps/gpu-manager-service/src/index.ts`, `apps/gpu-manager-service/package.json`, `apps/llm-gateway-service/src/index.ts`, `pnpm-lock.yaml`, `docs/STATUS-REAL-ATUAL.md`, `docs/PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md`.
- Validações executadas:
  - `pnpm --filter @alice/integrations-service typecheck` (executado via `npx -y pnpm@10.26.2 --filter @alice/integrations-service typecheck`)
  - `pnpm --filter @alice/integrations-service lint` (executado via `npx -y pnpm@10.26.2 --filter @alice/integrations-service lint`)
  - `pnpm --filter @alice/integrations-service build` (executado via `npx -y pnpm@10.26.2 --filter @alice/integrations-service build`)
  - `pnpm --filter @alice/gpu-manager-service typecheck` (executado via `npx -y pnpm@10.26.2 --filter @alice/gpu-manager-service typecheck`)
  - `pnpm --filter @alice/gpu-manager-service lint` (executado via `npx -y pnpm@10.26.2 --filter @alice/gpu-manager-service lint`)
  - `pnpm --filter @alice/gpu-manager-service build` (executado via `npx -y pnpm@10.26.2 --filter @alice/gpu-manager-service build`)
  - `pnpm --filter @alice/llm-gateway-service typecheck` (executado via `npx -y pnpm@10.26.2 --filter @alice/llm-gateway-service typecheck`)
  - `pnpm --filter @alice/llm-gateway-service lint` (executado via `npx -y pnpm@10.26.2 --filter @alice/llm-gateway-service lint`)
  - `pnpm --filter @alice/llm-gateway-service build` (executado via `npx -y pnpm@10.26.2 --filter @alice/llm-gateway-service build`)
  - `pnpm test` (executado via `npx -y pnpm@10.26.2 test`)
  - `pnpm lint` (executado via `npx -y pnpm@10.26.2 lint`)
  - `pnpm build` (executado via `npx -y pnpm@10.26.2 build`)
- Resultado das validações:
  - Todas as validações obrigatórias da rodada foram aprovadas ao final.
  - Houve 1 falha inicial em `pnpm --filter @alice/gpu-manager-service typecheck` por ausência de link local de `@alice/config` após alteração de dependência do workspace; correção aplicada com `npx -y pnpm@10.26.2 install --filter @alice/gpu-manager-service --no-frozen-lockfile` e revalidação completa aprovada.
  - Observação de ambiente: binário global `pnpm` permanece quebrado; os comandos foram executados com `npx -y pnpm@10.26.2`, preservando os comandos lógicos exigidos.
- Documentação atualizada: `docs/STATUS-REAL-ATUAL.md` e tracking canônico atualizados com os fatos da Rodada 6.
- Commit realizado: `refactor: harden external integrations gpu and llm runtime settings`.
- Pendências:
  - Validar posteriormente no ambiente do usuário a correção do binário global `pnpm`.
  - Permanecem leituras diretas de `process.env` em módulos fora do escopo autorizado da rodada.
- Riscos ou bloqueios:
  - Sem bloqueio ativo para continuação.
  - Novos parâmetros tipados com defaults operacionais (`WISE_API_TIMEOUT_MS`, `EXTERNAL_API_TIMEOUT_MS`) exigem alinhamento explícito no ambiente caso valores customizados sejam necessários.
- Próximo bloco recomendado: `P0-DOCS-07`.

### Rodada 7
- Data: 2026-03-10
- Bloco executado: `P0-DOCS-07`
- Objetivo: Atualizar documentação canônica após execução do P0, consolidando arquitetura, status real, fontes de verdade e alinhamento factual entre docs principais e tracking.
- Diagnóstico: Os docs canônicos tinham divergência de fonte de verdade para status de execução (incluindo referências históricas de conclusão global) e não destacavam explicitamente o tracking de rounds como autoridade para estado do backlog atual.
- Arquivos lidos: `CLAUDE.md` (1-120), `README.md` (chunks), `docs/INDEX.md` (completo em chunks), `docs/ARQUITETURA.md` (regiões relevantes em chunks), `docs/STATUS-REAL-ATUAL.md` (completo em chunks), `docs/SECRETS.md`, `docs/PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md`.
- Arquivos alterados: `README.md`, `docs/INDEX.md`, `docs/ARQUITETURA.md`, `docs/STATUS-REAL-ATUAL.md`, `docs/PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md`.
- Validações executadas:
  - `pnpm lint` (executado via `npx -y pnpm@10.26.2 lint`)
  - `pnpm build` (executado via `npx -y pnpm@10.26.2 build`)
  - Reexecução final após ajuste de consistência no rodapé de `docs/ARQUITETURA.md`: `pnpm lint` e `pnpm build` (executados via `npx -y pnpm@10.26.2 ...`).
- Resultado das validações:
  - Todas as validações obrigatórias da rodada foram aprovadas.
  - As validações foram aprovadas em duas passagens consecutivas (validação inicial e revalidação final pós-ajuste documental).
  - Observação de ambiente: binário global `pnpm` permanece quebrado; os comandos foram executados com `npx -y pnpm@10.26.2`, preservando os comandos lógicos exigidos.
- Documentação atualizada: `README.md`, `docs/INDEX.md`, `docs/ARQUITETURA.md`, `docs/STATUS-REAL-ATUAL.md` e tracking canônico com fechamento factual do P0.
- Commit realizado: `docs: update canonical architecture and status after p0 hardening`.
- Pendências:
  - Validar posteriormente no ambiente do usuário a correção do binário global `pnpm`.
- Riscos ou bloqueios:
  - Sem bloqueio ativo para continuação.
  - Risco residual controlado: documentação histórica extensa permanece por rastreabilidade temporal; para status de execução do backlog prevalece o tracking canônico.
- Próximo bloco recomendado: `P1-API-01`.

### Rodada 8
- Data: 2026-03-10
- Bloco executado: `P1-API-01`
- Objetivo: Modularizar `apps/api-gateway/src/index.ts` extraindo bootstrap, config, health checks, registro de proxies e tratamento de erros, preservando comportamento funcional do gateway.
- Diagnóstico: `apps/api-gateway/src/index.ts` concentrava bootstrap/config/middlewares/health/proxy/errors/shutdown em um único arquivo com 566 linhas e sem módulos internos em `src/`, reduzindo legibilidade e testabilidade.
- Arquivos lidos: `CLAUDE.md` (1-120), `package.json`, `apps/api-gateway/src/index.ts` (1-566 em chunks), `apps/api-gateway/package.json`, `apps/api-gateway/tsconfig.json`, `docs/ARQUITETURA.md`, `docs/STATUS-REAL-ATUAL.md`, `docs/PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md`.
- Arquivos alterados: `apps/api-gateway/src/index.ts`, `apps/api-gateway/src/bootstrap.ts`, `apps/api-gateway/src/runtime-config.ts`, `apps/api-gateway/src/services.ts`, `apps/api-gateway/src/middleware.ts`, `apps/api-gateway/src/health.ts`, `apps/api-gateway/src/proxy.ts`, `apps/api-gateway/src/error-handlers.ts`, `apps/api-gateway/src/shutdown.ts`, `apps/api-gateway/src/types.ts`, `docs/PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md`.
- Validações executadas:
  - `pnpm exec tsc -p apps/api-gateway/tsconfig.json --noEmit` (executado via `npx -y pnpm@10.26.2 exec tsc -p apps/api-gateway/tsconfig.json --noEmit`)
  - `pnpm exec eslint apps/api-gateway/src/` (executado via `npx -y pnpm@10.26.2 exec eslint apps/api-gateway/src/`)
  - `pnpm --filter @alice/api-gateway build` (executado via `npx -y pnpm@10.26.2 --filter @alice/api-gateway build`)
  - `pnpm lint` (executado via `npx -y pnpm@10.26.2 lint`)
  - `pnpm build` (executado via `npx -y pnpm@10.26.2 build`)
- Resultado das validações:
  - Todas as validações obrigatórias da rodada foram aprovadas.
  - `apps/api-gateway/src/index.ts` foi reduzido de 566 para 96 linhas, mantendo os mesmos endpoints de health/probes/métricas e o mesmo registro de proxies.
  - Observação de ambiente: binário global `pnpm` permanece quebrado; os comandos foram executados com `npx -y pnpm@10.26.2`, preservando os comandos lógicos exigidos.
- Documentação atualizada: tracking canônico atualizado com evidências factuais da Rodada 8.
- Commit realizado: `refactor: modularize api gateway bootstrap and contracts`.
- Pendências:
  - Avaliar cobertura OpenAPI específica do gateway no bloco `P1-CONTRACTS-10`; nesta rodada não foi criado contrato novo por se tratar de endpoints operacionais de health/proxy já existentes.
  - Validar posteriormente no ambiente do usuário a correção do binário global `pnpm`.
- Riscos ou bloqueios:
  - Sem bloqueio ativo para continuação.
  - Risco residual controlado: a modularização foi restrita ao gateway sem alteração de responsabilidades de auth nem mudança de contratos públicos.
- Próximo bloco recomendado: `P1-AUTH-02`.

### Rodada 9
- Data: 2026-03-10
- Bloco executado: `P1-AUTH-02`
- Objetivo: Quebrar o monólito de `apps/auth-service/src/index.ts`, separando bootstrap, middlewares, registro de rotas, providers de auth, wiring de RBAC e health checks sem alterar contratos.
- Diagnóstico: O `index.ts` do `auth-service` concentrava bootstrap, middlewares, providers OAuth/SAML/local, wiring de health/system routes, RBAC/admin routes, registro de rotas e shutdown em um único arquivo com 1895 linhas, reduzindo legibilidade e testabilidade.
- Arquivos lidos: `CLAUDE.md` (1-120), `package.json`, `apps/auth-service/src/index.ts` (1-1895 em chunks), `apps/auth-service/src/openapi-specs.ts` (chunks), `apps/auth-service/src/oidc/index.ts` (chunks), `apps/auth-service/src/identity-provisioning/index.ts`, `apps/auth-service/src/rbac/permission-catalog.ts`, `apps/auth-service/src/rbac/role-assignments.ts`, `apps/auth-service/src/routes/auth-provider-routes.ts`, `apps/auth-service/src/routes/auth-password-routes.ts`, `apps/auth-service/src/routes/auth-biometrics-routes.ts`, `apps/auth-service/src/routes/auth-registration-routes.ts`, `apps/auth-service/src/routes/auth-system-routes.ts`, `apps/auth-service/src/routes/rbac-admin-routes.ts` (chunks), `apps/auth-service/src/routes/user-management-routes.ts` (chunks), `apps/auth-service/package.json`, `apps/auth-service/tsconfig.json`, `docs/PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md`.
- Arquivos alterados: `apps/auth-service/src/index.ts`, `apps/auth-service/src/auth-middlewares.ts`, `apps/auth-service/src/auth-providers.ts`, `apps/auth-service/src/auth-routes.ts`, `apps/auth-service/src/bootstrap.ts`, `docs/PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md`.
- Validações executadas:
  - `pnpm --filter @alice/auth-service typecheck` (executado via `npx -y pnpm@10.26.2 --filter @alice/auth-service typecheck`)
  - `pnpm --filter @alice/auth-service lint` (executado via `npx -y pnpm@10.26.2 --filter @alice/auth-service lint`)
  - `pnpm --filter @alice/auth-service build` (executado via `npx -y pnpm@10.26.2 --filter @alice/auth-service build`)
  - `pnpm lint` (executado via `npx -y pnpm@10.26.2 lint`)
  - `pnpm build` (executado via `npx -y pnpm@10.26.2 build`)
- Resultado das validações:
  - Todas as validações obrigatórias da rodada foram aprovadas ao final.
  - Houve 1 falha inicial em `pnpm --filter @alice/auth-service typecheck` por incompatibilidade de tipagem `Application` vs `Express` e assinatura de lifecycle de `stopIdentityProvisioning`; ajustes cirúrgicos aplicados nos novos módulos e revalidação completa aprovada.
  - `apps/auth-service/src/index.ts` foi reduzido de 1895 para 662 linhas com preservação dos contratos e do comportamento funcional.
  - Observação de ambiente: binário global `pnpm` permanece quebrado; os comandos foram executados com `npx -y pnpm@10.26.2`, preservando os comandos lógicos exigidos.
- Documentação atualizada: tracking canônico atualizado com evidências factuais da Rodada 9.
- Commit realizado: `refactor: split auth service composition root`.
- Pendências:
  - Validar posteriormente no ambiente do usuário a correção do binário global `pnpm`.
- Riscos ou bloqueios:
  - Sem bloqueio ativo para continuação.
- Risco residual controlado: `auth-providers.ts` permaneceu volumoso para preservar lógica de negócio e contratos existentes sem refatoração estrutural ampla além do escopo cirúrgico autorizado.
- Próximo bloco recomendado: `P1-CHAT-03`.

### Rodada 10
- Data: 2026-03-10
- Bloco executado: `P1-CHAT-03`
- Objetivo: Decompor `apps/chat-service/src/index.ts`, extraindo bootstrap, registro de rotas por domínio e runtime de WebSocket/handlers sem alterar contratos ou comportamento funcional.
- Diagnóstico: O `index.ts` do `chat-service` concentrava bootstrap, WebSocket principal e de agentes, notificações de takeover e rotas de imagens no mesmo arquivo; mesmo após extrações iniciais, o arquivo ainda estava acima de 20 mil linhas e com responsabilidades acopladas.
- Arquivos lidos: `CLAUDE.md` (1-120), `package.json`, `apps/chat-service/src/index.ts` (lido em múltiplos chunks ao longo de todo o arquivo), `apps/chat-service/src/openapi-specs.ts`, `apps/chat-service/src/trading-command-parser.ts`, `apps/chat-service/src/lora-adapter-resolver.ts`, `apps/chat-service/src/user-name-utils.ts`, `apps/chat-service/src/stream-corruption-heuristics.ts`, `apps/chat-service/src/training-utils.ts`, `apps/chat-service/src/chat-websocket-runtime.ts`, `apps/chat-service/src/chat-bootstrap.ts`, `docs/PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md`.
- Arquivos alterados: `apps/chat-service/src/index.ts`, `apps/chat-service/src/chat-websocket-runtime.ts`, `apps/chat-service/src/chat-bootstrap.ts`, `apps/chat-service/src/chat-agent-websocket.ts`, `apps/chat-service/src/chat-image-routes.ts`, `docs/PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md`.
- Validações executadas:
  - `pnpm --filter @alice/chat-service typecheck` (executado via `npx -y pnpm@10.26.2 --filter @alice/chat-service typecheck`)
  - `pnpm --filter @alice/chat-service lint` (executado via `npx -y pnpm@10.26.2 --filter @alice/chat-service lint`)
  - `pnpm --filter @alice/chat-service build` (executado via `npx -y pnpm@10.26.2 --filter @alice/chat-service build`)
  - `pnpm lint` (executado via `npx -y pnpm@10.26.2 lint`)
  - `pnpm build` (executado via `npx -y pnpm@10.26.2 build`)
- Resultado das validações:
  - Todas as validações obrigatórias da rodada foram aprovadas ao final.
  - Houve 1 warning inicial em `@alice/chat-service lint` por import não utilizado (`WebSocketServer`) após extração de runtime de agentes; o warning foi corrigido no escopo e o lint foi reexecutado com sucesso.
  - `apps/chat-service/src/index.ts` foi reduzido de 20644 para 19822 linhas, com extração de runtime de `ws/agent` e domínio de rotas de imagens para módulos dedicados.
  - Observação de ambiente: binário global `pnpm` permanece quebrado; os comandos foram executados com `npx -y pnpm@10.26.2`, preservando os comandos lógicos exigidos.
- Documentação atualizada: tracking canônico atualizado com evidências factuais da Rodada 10.
- Commit realizado: `refactor: decompose chat service composition root`.
- Pendências:
  - Validar posteriormente no ambiente do usuário a correção do binário global `pnpm`.
  - Decomposição adicional de outros domínios internos do `chat-service` permanece para blocos futuros de modularização (`P1-*`) sem expandir escopo desta rodada.
- Riscos ou bloqueios:
  - Sem bloqueio ativo para continuação.
- Risco residual controlado: `index.ts` permanece volumoso em função de múltiplos domínios ainda concentrados, porém com redução de acoplamento nas áreas extraídas (bootstrap/ws-agent/imagens) sem alteração de contratos.
- Próximo bloco recomendado: `P1-RAG-04`.

### Rodada 11
- Data: 2026-03-10
- Bloco executado: `P1-RAG-04`
- Objetivo: Decompor `apps/rag-service/src/index.ts`, separando bootstrap, rotas de documentos, retrieval, governança e jobs, preservando contratos e filas existentes.
- Diagnóstico: `apps/rag-service/src/index.ts` concentrava responsabilidades de composição root (boot/shutdown) e registro de múltiplos domínios HTTP no mesmo arquivo, com acoplamento direto entre lifecycle, rotas de documentos/retrieval/jobs e rotas de fila de embeddings.
- Arquivos lidos: `CLAUDE.md` (1-120), `package.json`, `apps/rag-service/src/index.ts` (chunks sequenciais até o fim), `apps/rag-service/src/openapi-specs.ts` (arquivo completo em chunks), `apps/rag-service/src/storage.ts`, `apps/rag-service/src/image-processor.ts`, `apps/rag-service/src/workers/embedding-worker.ts`, `apps/rag-service/src/embedding-websocket.ts`, `apps/rag-service/src/audio-processor.ts`, `apps/rag-service/src/document-processor.ts`, `apps/rag-service/src/web-search.ts`, `apps/rag-service/src/web-sanitize.ts`, `apps/rag-service/src/learning-orchestrator.ts`, `apps/rag-service/src/workers/learning-worker.ts`, `apps/rag-service/src/workers/web-crawl-worker.ts`, `apps/rag-service/src/training-chunk-selection.ts`, `docs/PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md`.
- Arquivos alterados: `apps/rag-service/src/index.ts`, `apps/rag-service/src/rag-bootstrap.ts`, `apps/rag-service/src/rag-document-routes.ts`, `apps/rag-service/src/rag-retrieval-routes.ts`, `apps/rag-service/src/rag-learning-routes.ts`, `apps/rag-service/src/rag-embedding-routes.ts`, `docs/PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md`.
- Validações executadas:
  - `pnpm --filter @alice/rag-service typecheck` (executado via `npx -y pnpm@10.26.2 --filter @alice/rag-service typecheck`)
  - `pnpm --filter @alice/rag-service lint` (executado via `npx -y pnpm@10.26.2 --filter @alice/rag-service lint`)
  - `pnpm --filter @alice/rag-service build` (executado via `npx -y pnpm@10.26.2 --filter @alice/rag-service build`)
  - `pnpm lint` (executado via `npx -y pnpm@10.26.2 lint`)
  - `pnpm build` (executado via `npx -y pnpm@10.26.2 build`)
- Resultado das validações:
  - Todas as validações obrigatórias da rodada foram aprovadas.
  - A decomposição foi aplicada com preservação dos endpoints existentes nos domínios extraídos e sem alteração de contratos de fila/jobs já existentes.
  - `apps/rag-service/src/index.ts` foi reduzido de 5436 para 4450 linhas, com extração de bootstrap e rotas por domínio para módulos dedicados.
  - Observação de ambiente: binário global `pnpm` permanece quebrado; os comandos foram executados com `npx -y pnpm@10.26.2`, preservando os comandos lógicos exigidos.
- Documentação atualizada: tracking canônico atualizado com evidências factuais da Rodada 11.
- Commit realizado: `refactor: decompose rag service composition root`.
- Pendências:
  - Validar posteriormente no ambiente do usuário a correção do binário global `pnpm`.
  - A decomposição do domínio de criação/upload de documentos ainda permanece parcialmente no `index.ts` para continuidade no próximo bloco de modularização (`P1-TRAINING-05`) sem expansão de escopo nesta rodada.
- Riscos ou bloqueios:
  - Sem bloqueio ativo para continuação.
- Risco residual controlado: o `index.ts` do `rag-service` ainda permanece volumoso em áreas não extraídas nesta rodada, apesar da redução material de responsabilidade no composition root.
- Próximo bloco recomendado: `P1-TRAINING-05`.

### Rodada 12
- Data: 2026-03-10
- Bloco executado: `P1-TRAINING-05`
- Objetivo: Decompor `apps/training-service/src/index.ts` e alinhar a orquestração de training separando bootstrap, lifecycle de dataset, lineage e execução assíncrona de jobs sem alterar contratos.
- Diagnóstico: `apps/training-service/src/index.ts` concentrava bootstrap/startup/shutdown, setup de workers/schedulers e lifecycle de coleta de dados de treinamento no mesmo arquivo; havia acoplamento alto entre composition root, governança e dataset lifecycle.
- Arquivos lidos: `CLAUDE.md` (1-120), `package.json`, `apps/training-service/src/index.ts` (1-4103 em chunks de 200-300 linhas), `apps/training-service/src/lora-job-manager.ts`, `apps/training-service/src/openapi-specs.ts`, `apps/training-service/src/auto-learning-scheduler.ts`, `apps/training-service/src/scope-resolver.ts`, `apps/training-service/src/routes/training-data-routes.ts`, `apps/training-service/src/routes/training-bulk-import-routes.ts`, `apps/training-service/src/routes/training-webhook-routes.ts`, `apps/training-service/src/routes/training-job-promotion-approval-routes.ts`, `apps/training-service/src/routes/training-job-promote-routes.ts`, `apps/training-service/src/routes/training-job-rollback-routes.ts`, `apps/training-service/src/routes/training-run-start-routes.ts`, `apps/training-service/src/routes/training-job-create-routes.ts`, `docs/PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md`.
- Arquivos alterados: `apps/training-service/src/index.ts`, `apps/training-service/src/training-bootstrap.ts`, `apps/training-service/src/training-data-lifecycle.ts`, `docs/PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md`.
- Validações executadas:
  - `pnpm --filter @alice/training-service typecheck` (falhou por binário global `pnpm` quebrado no ambiente)
  - `npx -y pnpm@10.26.2 --filter @alice/training-service typecheck`
  - `npx -y pnpm@10.26.2 --filter @alice/training-service lint`
  - `npx -y pnpm@10.26.2 --filter @alice/training-service lint` (reexecução após correção de imports não usados)
  - `npx -y pnpm@10.26.2 --filter @alice/training-service build`
  - `npx -y pnpm@10.26.2 lint`
  - `npx -y pnpm@10.26.2 build`
- Resultado das validações:
  - Todas as validações obrigatórias da rodada foram aprovadas ao final.
  - Houve falhas intermediárias no typecheck por incompatibilidade de assinaturas entre módulos extraídos e código existente (`findNamespaceByIdInTenant`, `resolveScope`, retorno de `processScheduledJobs`) e 2 warnings de lint por imports não utilizados; ajustes cirúrgicos aplicados e revalidados com sucesso.
  - `apps/training-service/src/index.ts` foi reduzido de 4103 para 3328 linhas, com extração de bootstrap/runtime (`training-bootstrap.ts`) e dataset lifecycle/lineage (`training-data-lifecycle.ts`).
  - Observação de ambiente: binário global `pnpm` permanece quebrado; execução realizada com `npx -y pnpm@10.26.2`, preservando os comandos lógicos exigidos.
- Documentação atualizada: tracking canônico atualizado com evidências factuais da Rodada 12.
- Commit realizado: `refactor: decompose training service orchestration`
- Pendências:
  - Validar posteriormente no ambiente do usuário a correção do binário global `pnpm`.
- Riscos ou bloqueios:
  - Sem bloqueio ativo para continuação.
- Risco residual controlado: o `index.ts` do `training-service` permanece volumoso em domínios de auto-run/decisão de sinal e registro de rotas, apesar da separação de bootstrap e lifecycle.
- Próximo bloco recomendado: `P1-INTEGRATIONS-06`.

### Rodada 13
- Data: 2026-03-10
- Bloco executado: `P1-INTEGRATIONS-06`
- Objetivo: Decompor `apps/integrations-service` separando bootstrap, rotas, adapters externos, clients, parsers, risk gates e orquestração sem alterar lógica de negócio.
- Diagnóstico: `apps/integrations-service/src/index.ts` ainda concentrava schemas de validação Wise, composição inline de adapter de conta KuCoin e lifecycle de bootstrap/shutdown HTTP, enquanto `kucoinService.ts` mantinha o risk gate acoplado ao arquivo monolítico.
- Arquivos lidos: `CLAUDE.md` (1-120), `package.json`, `apps/integrations-service/src/index.ts` (1-2745 em chunks de 200-300 linhas), `apps/integrations-service/src/kucoinService.ts` (regiões relevantes em chunks), `apps/integrations-service/src/kucoinClient.ts` (chunk inicial), `apps/integrations-service/src/kucoinUnifiedWebSocket.ts` (chunk inicial), `apps/integrations-service/src/kucoinSpotClient.ts` (chunk inicial), `apps/integrations-service/src/kucoinMarginClient.ts` (chunk inicial), `apps/integrations-service/src/wiseService.ts` (chunk inicial), `apps/integrations-service/src/demo-trading-engine.ts` (chunk inicial), `apps/integrations-service/src/openapi-specs.ts` (chunk inicial), `apps/integrations-service/src/routes/trading-account-management-routes.ts`, `docs/PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md`.
- Arquivos alterados: `apps/integrations-service/src/index.ts`, `apps/integrations-service/src/kucoinService.ts`, `apps/integrations-service/src/wise-route-schemas.ts`, `apps/integrations-service/src/kucoin-account-client-adapter.ts`, `apps/integrations-service/src/integrations-lifecycle.ts`, `apps/integrations-service/src/trading-risk-gate.ts`, `docs/PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md`.
- Validações executadas:
  - `pnpm --filter @alice/integrations-service typecheck` (executado via `npx -y pnpm@10.26.2 --filter @alice/integrations-service typecheck`)
  - `pnpm --filter @alice/integrations-service typecheck` (reexecução após ajuste de tipagem em `trading-risk-gate.ts`, executado via `npx -y pnpm@10.26.2 --filter @alice/integrations-service typecheck`)
  - `pnpm --filter @alice/integrations-service lint` (executado via `npx -y pnpm@10.26.2 --filter @alice/integrations-service lint`)
  - `pnpm --filter @alice/integrations-service build` (executado via `npx -y pnpm@10.26.2 --filter @alice/integrations-service build`)
  - `pnpm lint` (executado via `npx -y pnpm@10.26.2 lint`)
  - `pnpm build` (executado via `npx -y pnpm@10.26.2 build`)
- Resultado das validações:
  - Todas as validações obrigatórias da rodada foram aprovadas ao final.
  - Houve 1 falha inicial em `@alice/integrations-service typecheck` por incompatibilidade de nulabilidade no contrato do novo módulo `trading-risk-gate.ts` (`tradingEnabled` nullable no schema real); correção aplicada no escopo e revalidação aprovada.
  - Observação de ambiente: binário global `pnpm` permanece quebrado; os comandos foram executados com `npx -y pnpm@10.26.2`, preservando os comandos lógicos exigidos.
- Documentação atualizada: tracking canônico atualizado com evidências factuais da Rodada 13.
- Commit realizado: `refactor: decompose integrations service adapters and composition`
- Pendências:
  - Validar posteriormente no ambiente do usuário a correção do binário global `pnpm`.
  - `apps/integrations-service/src/index.ts` permanece volumoso em domínios de registro de rotas de trading/wise, apesar da extração de parsers, lifecycle e adapter.
- Riscos ou bloqueios:
  - Sem bloqueio ativo para continuação.
  - Risco residual controlado: a decomposição foi restrita a composição e boundary modules para não alterar estratégia de trading nem contratos já existentes.
- Próximo bloco recomendado: `P1-GPU-LLM-07`.

## Pendências abertas
- Correção do binário global `pnpm` no ambiente local (fora do escopo deste bloco).
- Reduzir leituras diretas de `process.env` remanescentes fora do escopo autorizado, seguindo próximos blocos.

## Riscos e bloqueios
- Sem bloqueio ativo para continuação do backlog.
- Risco residual controlado: existência de bridge compatível em `shared/schema.ts` para proteger integrações legadas não mapeadas em tempo de descoberta.
- Risco residual controlado: parte das leituras de `process.env` permanece em áreas não tratadas neste bloco para evitar refatoração ampla fora do escopo autorizado.
- Risco residual controlado: módulos de suporte multimodal do RAG dependem de fail-fast no entrypoint/execução para bloquear operação sem `OPENAI_API_KEY` em produção.
- Risco residual controlado: documentação histórica volumosa pode conter contexto de planos anteriores; status atual de execução do backlog governado deve sempre ser consultado no tracking canônico.

## Próximos blocos permitidos
- `P1-GPU-LLM-07`
