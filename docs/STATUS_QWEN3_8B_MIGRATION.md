# STATUS QWEN3-8B MIGRATION

**Author:** Fillipe Guerra  
**Data:** 11 de Marco de 2026

## Rodada Atual
- Rodada: 2
- Status: Concluída

## Objetivo
Criar persistência durável para estado e eventos de runtime GPU com auditoria operacional no banco PostgreSQL.

## Premissas
- Persistência durável deve ser SSOT para estado operacional de runtime GPU.
- Tabelas alvo desta rodada:
  - `gpu_runtime_state`
  - `gpu_runtime_events`
- Escopo restrito a schema + migration + camada de leitura/escrita no `gpu-manager-service`.
- Sem alterações de transição real de containers, UI ou workflows.

## Escopo da Rodada
- Adicionar entidades no schema compartilhado (`packages/shared/src/schema.ts`).
- Criar migration SQL real com próximo número disponível em `migrations/`.
- Incluir índices e constraints para operação e auditoria.
- Implementar camada de acesso no `gpu-manager-service` para leitura/escrita do estado durável.
- Cobrir com testes do escopo.

## Alterações
- `packages/shared/src/schema.ts`:
  - Novos enums de runtime GPU: `gpu_runtime_mode`, `gpu_orchestrator_state`, `gpu_orchestration_mode`, `gpu_runtime_event_type`, `gpu_runtime_trigger_source`, `gpu_runtime_event_outcome`.
  - Novas entidades duráveis: `gpu_runtime_state` e `gpu_runtime_events`.
  - Índices operacionais e de auditoria para leitura de estado atual, histórico temporal e filtros por `requestId`/`correlationId`.
  - Relations e tipos exportados para uso seguro no ecossistema.
- `migrations/0106_gpu_runtime_state_and_events.sql`:
  - Migration real com criação de enums, tabelas, constraints e índices.
  - Constraints de integridade para evitar chaves vazias e garantir formato JSON válido (`array`/`object`) nos campos críticos.
  - Índice parcial para erros (`idx_gpu_runtime_events_failed_only`) visando troubleshooting operacional.
- `apps/gpu-manager-service/src/gpu-runtime-state-store.ts`:
  - Nova camada de acesso durável com transação única para snapshot + evento.
  - Leitura do estado corrente com histórico (`getCurrentStateWithEvents`) e escrita auditável (`recordSnapshot`).
  - Mapeamento de estado do orquestrador para modo de runtime e serviços ativos.
- `apps/gpu-manager-service/src/index.ts`:
  - Integração da persistência em pontos críticos:
    - startup (`state_snapshot`);
    - preempção por fila (`switch_requested`, `switch_completed`, `switch_failed`);
    - restore manual (`manual_restore_requested`, `manual_restore_completed`, `manual_restore_failed`);
    - endpoint de estado com seed inicial quando necessário.
  - Normalização defensiva de `actorUserId`/`actorTenantId` (UUID) e captura de `correlationId`.
- `tests/unit/services/gpu-runtime-persistence-guards.test.ts`:
  - Guardas para schema, migration, caminho transacional e integração no `gpu-manager-service`.
- `apps/gpu-manager-service/package.json` + `pnpm-lock.yaml`:
  - Inclusão de `@alice/database` no serviço para resolver build e garantir linking correto no workspace.

## Inventário de Acoplamentos Qwen2.5 (Contexto)
- Sem alterações nesta rodada.
- Mantida a estratégia de compatibilidade histórica definida na Rodada 1 (leitura de legados Qwen2.5 via camada SSOT de modelos).

## Validações
Executadas em sequência, sem paralelização:
1. `typecheck` (`cmd.exe /c pnpm typecheck`) -> OK
2. `testes` (`cmd.exe /c pnpm test`) -> OK (121 arquivos, 1356 testes)
3. `eslint` (`cmd.exe /c pnpm lint`) -> OK
4. `build` (`cmd.exe /c pnpm build`) -> OK

## Riscos
- Introdução de persistência durável no caminho do `gpu-manager-service` exige tratamento fail-safe para não degradar fluxo crítico de fila.
- Ainda falta, em rodadas futuras, conectar essa persistência a uma FSM completa de transição de runtime e a notificações de chat/frontend.

## Próximo Passo
Aguardar prompt da próxima rodada para iniciar FSM de orquestração GPU e integração de interrupção/restauração com fluxos de chat/training.
