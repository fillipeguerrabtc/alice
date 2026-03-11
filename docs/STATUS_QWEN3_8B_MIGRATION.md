# STATUS QWEN3-8B MIGRATION

**Author:** Fillipe Guerra  
**Data:** 11 de Marco de 2026

## Rodada Atual
- Rodada: 3
- Status: Concluída

## Rodada 3 - Início

### Objetivo
Implementar a FSM canônica de orquestração GPU no `gpu-manager-service` com endpoints operacionais e integração com persistência durável.

### Premissas
- Estados canônicos obrigatórios:
  - `serving_ready`
  - `serving_draining`
  - `training_starting`
  - `training_active`
  - `training_finishing`
  - `serving_restoring`
  - `error`
- Runtime mutuamente exclusivo:
  - serving = `gpu-llm` + `gpu-embeddings`
  - training = `gpu-trainer`
- Manter compatibilidade com integrações internas existentes.
- Ainda sem avisos de chat e sem alterações de UI Training nesta rodada.

### Escopo
- Refatorar `apps/gpu-manager-service/src/gpu-orchestrator.ts` para FSM canônica.
- Expor endpoints:
  - `GET /api/gpu/orchestrator/state`
  - `POST /api/gpu/orchestrator/prepare-training`
  - `POST /api/gpu/orchestrator/restore-serving`
- Manter `POST /api/gpu/orchestrator/return` como alias legado compatível.
- Integrar FSM com persistência durável criada na rodada anterior.
- Adicionar auth interna e autorização para controle de orquestração.
- Incluir métricas e logs de transição.
- Atualizar OpenAPI.

## Rodada 3 - Conclusão

### Alterações
- `apps/gpu-manager-service/src/gpu-orchestrator.ts`:
  - Implementada FSM canônica com transições explícitas e listener de transição.
  - Novas ações canônicas:
    - `prepareTrainingRuntime()`
    - `restoreServingRuntime()`
  - Sem retorno automático por timeout/idle.
  - Mantidos aliases legados:
    - `switchToTraining()`
    - `switchToLlmEmbeddings()`
- `apps/gpu-manager-service/src/index.ts`:
  - Integração da FSM com persistência durável em transições manuais e por fila.
  - Endpoints canônicos adicionados:
    - `GET /api/gpu/orchestrator/state`
    - `POST /api/gpu/orchestrator/prepare-training`
    - `POST /api/gpu/orchestrator/restore-serving`
  - Alias legado mantido:
    - `POST /api/gpu/orchestrator/return` (com header de depreciação).
  - Adicionado middleware de autorização para controle de orquestração com RBAC (`admin`/`super_admin`/`superadmin`) mantendo compatibilidade para chamadas internas legadas sem contexto de usuário.
  - Registro de transições da FSM em métricas e trilha de auditoria durável.
- `apps/gpu-manager-service/src/gpu-runtime-state-store.ts`:
  - Mapeamentos atualizados para os novos estados canônicos e serviços ativos.
- `apps/gpu-manager-service/src/gpu-metrics.ts`:
  - Novas métricas:
    - `gpu_orchestrator_transitions_total`
    - `gpu_orchestrator_transition_duration_seconds`
    - `gpu_orchestrator_state`
- `apps/gpu-manager-service/src/openapi-specs.ts`:
  - Contratos OpenAPI dos endpoints canônicos adicionados.
  - Alias `/return` marcado como legado/deprecated.
- `packages/shared/src/schema.ts`:
  - Enum `gpu_orchestrator_state` expandido com estados canônicos e preservação dos estados legados para compatibilidade histórica.
  - Default de `gpu_runtime_state.orchestrator_state` atualizado para `serving_ready`.
- `migrations/0107_gpu_orchestrator_fsm_states.sql`:
  - Migration para adicionar estados canônicos no enum PostgreSQL.
  - Backfill de valores legados para equivalentes canônicos em `gpu_runtime_state` e `gpu_runtime_events`.
  - Default de `orchestrator_state` ajustado para `serving_ready`.
- `tests/unit/gpu-orchestrator-compose-fallback.test.ts`:
  - Ajustado para nova sequência de comandos e estado final `training_active`.
- `tests/unit/gpu-orchestrator-fsm.test.ts`:
  - Novos testes cobrindo transições principais de sucesso e erro da FSM.

### Inventário de Acoplamentos Qwen2.5
- Sem novos acoplamentos introduzidos na Rodada 3.
- Compatibilidade histórica com registros legados permanece suportada via enums e resolução de estado/modelo definida nas rodadas anteriores.

### Validações
Executadas em sequência, sem paralelização:
1. `typecheck` (`cmd.exe /c pnpm typecheck`) -> OK
2. `testes` (`cmd.exe /c pnpm test`) -> OK (122 arquivos, 1359 testes)
3. `eslint` (`cmd.exe /c pnpm lint`) -> OK
4. `build` (`cmd.exe /c pnpm build`) -> OK

### Riscos
- A estratégia de autorização preserva compatibilidade para chamadas internas sem contexto de usuário; endurecimento total (bloqueio estrito sem contexto RBAC) deve ser planejado com rollout coordenado para não quebrar integrações atuais.
- Notificação de interrupção/restauração para chats ativos ainda pendente para rodada futura.

### Próximo Passo
Aguardar prompt da próxima rodada para integração de notificação de chat, fluxo de UI Training e demais etapas de orquestração fim-a-fim.
