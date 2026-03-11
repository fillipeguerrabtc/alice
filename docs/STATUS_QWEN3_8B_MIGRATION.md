# STATUS QWEN3-8B MIGRATION

**Author:** Fillipe Guerra  
**Data:** 11 de Marco de 2026

## Rodada Atual
- Rodada: 5
- Status: Concluída

## Rodada 5 - Início

### Objetivo
Garantir preempção automática de serving no `training-service` para treinos on-demand e agendados, com restauração de serving ao concluir e vínculo auditável de intent/resultado por run/job.

### Premissas
- A orquestração canônica de runtime GPU já está disponível no `gpu-manager-service`:
  - `POST /api/gpu/orchestrator/prepare-training`
  - `POST /api/gpu/orchestrator/restore-serving`
  - alias legado `POST /api/gpu/orchestrator/return`
- Execução de treino deve permanecer assíncrona via fila/worker (sem treino no thread HTTP).
- Runtime em GPU única segue mutuamente exclusivo:
  - serving = `gpu-llm` + `gpu-embeddings`
  - training = `gpu-trainer`
- Idempotência e locks já existentes no `training-service` devem ser preservados.

### Escopo
- Acionar preparação automática do runtime de treino no início do processamento assíncrono de `fine_tuning_jobs`.
- Garantir restauração de serving ao final de execuções on-demand e scheduled.
- Persistir intent/resultado de orquestração vinculado a `runId`/`fineTuningJobId` para auditoria operacional.
- Ajustar rotas de orquestração expostas pelo `training-service` para semântica canônica, mantendo compatibilidade legada.
- Atualizar OpenAPI e este status.

## Rodada 5 - Conclusão

### Alterações
- `apps/training-service/src/training-gpu-orchestration.ts`:
  - Novo cliente compartilhado de orquestração com contrato tipado para:
    - `prepareTrainingRuntime()`
    - `restoreServingRuntime()`
  - Registro estruturado de tentativa/resultado (status HTTP, estado do orquestrador, erro, duração, run/job).
- `apps/training-service/src/training-runner.ts`:
  - Integração da preempção automática no fluxo assíncrono de worker:
    - prepara runtime de treino antes de `processLoraJob`;
    - restaura serving ao final da execução.
  - Persistência de intent e ledger operacional por tentativa em:
    - `fine_tuning_jobs.metrics.runner.orchestration`
    - `fine_tuning_jobs.config_snapshot.orchestration`
  - Vínculo explícito de auditoria operacional por `runId`, `idempotencyKey`, `tenantId` e `fineTuningJobId`.
  - Tratamento de falhas com preservação de estado recuperável e trilha auditável.
- `apps/training-service/src/index.ts`:
  - Injeção do cliente de orquestração no `runTrainingFineTuningJob`, mantendo execução assíncrona via fila.
- `apps/training-service/src/routes/training-lora-orchestrator-routes.ts`:
  - Rotas canônicas adicionadas:
    - `POST /api/training/gpu-orchestrator/prepare-training`
    - `POST /api/training/gpu-orchestrator/restore-serving`
  - Alias legado mantido:
    - `POST /api/training/gpu-orchestrator/return` (deprecado) apontando para semântica de restore.
- `apps/training-service/src/openapi-specs.ts`:
  - Contratos OpenAPI das rotas canônicas adicionados.
  - Alias `/return` marcado como legado (`deprecated`).
- Testes atualizados/adicionados:
  - `tests/unit/training-gpu-orchestration.test.ts` (novo).
  - `tests/unit/services/training-openapi-sync.test.ts`.
  - `tests/unit/services/training-openapi-rbac-sync.test.ts`.
  - `tests/unit/services/training-service.test.ts`.

### Inventário de Acoplamentos Qwen2.5
- Sem novos acoplamentos Qwen2.5 introduzidos na Rodada 5.
- Compatibilidade histórica de registros legados Qwen2.5 permanece preservada.

### Validações
Executadas em sequência, sem paralelização:
1. `typecheck` (`cmd.exe /c pnpm typecheck`) -> OK
2. `testes` (`cmd.exe /c pnpm test`) -> OK (124 arquivos, 1368 testes)
3. `eslint` (`cmd.exe /c pnpm lint`) -> OK
4. `build` (`cmd.exe /c pnpm build`) -> OK

### Riscos
- Falhas de restore após treino bem-sucedido passam a invalidar o run (status final `failed`) para sinalizar inconsistência operacional; integração com UX de aviso para operador/chat ainda pendente em rodadas futuras.
- A autorização de controle da orquestração no `gpu-manager` ainda mantém compatibilidade para chamadas internas legadas sem contexto completo assinado; endurecimento total depende de rollout coordenado entre serviços.

### Próximo Passo
Aguardar prompt da próxima rodada para integrar notificação de interrupção/restauração em chats ativos e evolução de UX/painel operacional de treinamento.

## Rodada 4 - Início

### Objetivo
Implementar drain gracioso e preempção real de serving para training no `gpu-manager-service`, com bloqueio de novas inferências/streams durante `serving_draining`.

### Premissas
- Runtime GPU permanece mutuamente exclusivo em GPU única (20GB):
  - serving = `gpu-llm` + `gpu-embeddings`
  - training = `gpu-trainer`
- Preempção deve ser previsível, com fase de drain observável e política de corte controlada.
- Não implementar nesta rodada UX de aviso no chat.
- Não expor detalhes sensíveis de infraestrutura nas respostas HTTP.

### Escopo
- Bloqueio de novas inferências/streams ao entrar em `serving_draining`.
- Rastreamento de inflight requests/streams e conclusão de drain por esvaziamento ou corte.
- Garantia de ordem operacional canônica:
  - `prepare-training`: parar serving, depois subir trainer.
  - `restore-serving`: parar trainer, depois subir serving.
- Expansão dos motivos de rejeição em `gpu-admission.ts`:
  - `transition_in_progress`
  - `serving_preempted_for_training`
- Persistência de eventos de transição/falha no ledger durável.
- Novas métricas:
  - `active_streams`
  - `forced_interruptions`
  - `drain_duration`

## Rodada 4 - Conclusão

### Alterações
- `apps/gpu-manager-service/src/gpu-orchestrator.ts`:
  - `prepareTrainingRuntime()` passou a suportar callback de drain (`waitForServingDrain`) antes do stop de serving.
  - Registro explícito do resultado do drain (duração, inflight inicial/final, interrupções forçadas e timeout).
- `apps/gpu-manager-service/src/index.ts`:
  - Implementado controle de drain gracioso com política de corte:
    - rastreamento de inflight de inferência;
    - rastreamento de streams ativos;
    - interrupção forçada de streams quando drain excede timeout;
    - persistência de snapshot de drain no ledger durável.
  - Bloqueio de novas inferências/streams durante preempção/transição via admission control.
  - Worker ajustado para permitir preempção de treinamento mesmo com lock ativo de serving.
  - Fluxo de lock mantido obrigatório para inferência regular, sem expor detalhes sensíveis na API.
- `apps/gpu-manager-service/src/gpu-admission.ts`:
  - Novos motivos de rejeição:
    - `transition_in_progress`
    - `serving_preempted_for_training`
  - Regras aplicadas apenas para inferência (LLM/embeddings), sem bloquear `training`.
- `apps/gpu-manager-service/src/gpu-metrics.ts`:
  - Novas métricas operacionais:
    - `gpu_manager_active_streams`
    - `gpu_manager_forced_interruptions_total`
    - `gpu_orchestrator_drain_duration_seconds`
- `tests/unit/gpu-orchestrator-fsm.test.ts`:
  - Cobertura de drain com sucesso, drain com timeout/corte forçado e falha no callback de drain.
- `tests/unit/gpu-admission.test.ts`:
  - Cobertura dos novos motivos de rejeição e garantia de exceção para requests de training.

### Inventário de Acoplamentos Qwen2.5
- Sem novos acoplamentos introduzidos na Rodada 4.
- Compatibilidade histórica de registros legados Qwen2.5 permanece preservada.

### Validações
Executadas em sequência, sem paralelização:
1. `typecheck` (`cmd.exe /c pnpm typecheck`) -> OK
2. `testes` (`cmd.exe /c pnpm test`) -> OK (123 arquivos, 1364 testes)
3. `eslint` (`cmd.exe /c pnpm lint`) -> OK
4. `build` (`cmd.exe /c pnpm build`) -> OK

### Riscos
- Preempção por treinamento em cenário de lock ativo privilegia avanço operacional do treinamento; em ambiente com múltiplas instâncias do `gpu-manager`, recomenda-se validação adicional de coordenação distribuída.
- UX de notificação para chats ativos durante preempção/restauração segue pendente para rodada futura.

### Próximo Passo
Aguardar prompt da próxima rodada para integrar aviso de indisponibilidade/restauração no chat e concluir o fluxo end-to-end de experiência do usuário.

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
