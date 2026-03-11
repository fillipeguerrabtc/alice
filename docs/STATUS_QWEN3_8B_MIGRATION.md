# STATUS QWEN3-8B MIGRATION

**Author:** Fillipe Guerra  
**Data:** 11 de Marco de 2026

## Rodada Atual
- Rodada: 7
- Status: Concluída

## Rodada 7 - Início

### Objetivo
Transformar a página de Training em cockpit operacional com controle manual de runtime GPU, com RBAC estrito para `admin/superadmin` em ações críticas de treino e orquestração.

### Premissas
- A FSM canônica de runtime GPU e os endpoints de orquestração já estão disponíveis e persistidos de forma durável.
- A UI deve ser orientada ao estado de backend, sem suposições sobre transições internas.
- Em GPU única, preempção de inferência durante treino continua sendo o comportamento operacional oficial.
- Controles críticos de treinamento/orquestração devem ficar restritos a perfis `admin/superadmin`.

### Escopo
- Refatorar `apps/frontend-service/src/pages/Training.tsx` com extração de componentes de cockpit.
- Adicionar card de runtime com:
  - modo atual;
  - estado de transição;
  - motivo;
  - run vinculado;
  - disponibilidade de inferência.
- Adicionar controles manuais:
  - preparar GPU para treinamento;
  - restaurar inferência (interrompendo treino corrente).
- Incluir preflight explícito no modal on-demand sobre preempção de inferência.
- Restringir ações críticas de treino e orquestração para `admin/superadmin`.
- Atualizar i18n `pt-BR/en` e registrar inventário de acoplamentos legados Qwen2.5.

## Rodada 7 - Conclusão

### Alterações
- `apps/frontend-service/src/pages/Training.tsx`:
  - Integração de query canônica de estado do orquestrador via `GET /api/training/gpu-orchestrator/state` com validação Zod do payload.
  - Cockpit de runtime integrado no topo da página com:
    - card de estado operacional;
    - card de controles manuais (`prepare-training` e `restore-serving`);
    - banner orientado ao estado de inferência/transição.
  - RBAC de UI reforçado para ações críticas:
    - run on-demand;
    - criação de job avançado;
    - controle manual de runtime;
    - persistência de schedule (save).
  - Fluxo pós-treino ajustado para endpoint canônico `POST /api/training/gpu-orchestrator/restore-serving`.
- `apps/frontend-service/src/pages/training/components/training-runtime-card.tsx` (novo):
  - Card de runtime com modo atual, estado de transição, motivo, run vinculado e disponibilidade de inferência.
- `apps/frontend-service/src/pages/training/components/training-orchestrator-controls-card.tsx` (novo):
  - Card de operação manual com botões:
    - Preparar GPU para treinamento;
    - Restaurar inferência.
  - Estado de bloqueio por transição e restrição por RBAC.
- `apps/frontend-service/src/pages/training/components/training-runtime-banner.tsx` (novo):
  - Banner contextual para interrupção temporária de inferência e transições de runtime.
- `apps/frontend-service/src/pages/training/components/training-on-demand-run-dialog.tsx`:
  - Preflight explícito de preempção de inferência com confirmação obrigatória antes de iniciar run on-demand.
- `apps/frontend-service/src/pages/training/components/training-auto-learning-tab-content.tsx`:
  - Controles de schedule desabilitados para perfis sem privilégio (`admin/superadmin`), mantendo leitura.
- `apps/frontend-service/src/locales/pt-BR.json` e `apps/frontend-service/src/locales/en.json`:
  - Novas chaves i18n para:
    - cockpit de runtime;
    - controles manuais;
    - banners de interrupção/transição;
    - preflight de preempção no on-demand.

### Inventário de Acoplamentos Qwen2.5
- Referências históricas textuais a Qwen2.5 permanecem em mensagens descritivas legadas da UI de Training (sem impacto funcional).
- Nenhum novo acoplamento funcional a Qwen2.5 foi introduzido nesta rodada.
- Compatibilidade histórica com registros legados Qwen2.5 permanece preservada.

### Validações
Executadas em sequência, sem paralelização:
1. `typecheck` (`cmd.exe /c pnpm typecheck`) -> OK
2. `testes` (`cmd.exe /c pnpm test`) -> OK (125 arquivos, 1371 testes)
3. `eslint` (`cmd.exe /c pnpm lint`) -> OK
4. `build` (`cmd.exe /c pnpm build`) -> OK

### Riscos
- A restrição `admin/superadmin` aplicada nesta rodada está na camada de frontend; endurecimento complementar no backend para rotas de training schedule/run pode ser feito em rodada dedicada sem quebrar compatibilidade.
- Em falha temporária de leitura do estado do orquestrador, o cockpit mantém fallback seguro, mas pode mostrar estado parcial até o próximo polling.

### Próximo Passo
Aguardar prompt da próxima rodada para continuidade da migração.

## Rodada 6 - Início

### Objetivo
Implementar aviso de interrupção e restauração para chats ativos, com propagação por Redis para WebSocket e SSE (`/api/chat/stream`), sem expor detalhes internos de infraestrutura.

### Premissas
- A FSM canônica de orquestração já publica transições de estado no `gpu-manager-service`.
- A preempção real de serving já está operacional (rodadas anteriores), portanto os avisos devem refletir eventos reais de runtime.
- O payload de aviso deve ser tipado, validado e compatível com os parsers existentes de SSE/WebSocket.
- A experiência de chat deve manter compatibilidade com eventos já emitidos no stream atual.

### Escopo
- Criar canal de anúncios de runtime via Redis (`alice:runtime:announcements`).
- Publicar eventos no `gpu-manager-service` em:
  - início de `serving_draining`;
  - entrada em `training_active`;
  - retorno para `serving_ready`.
- Assinar no `chat-service` e propagar para:
  - WebSocket;
  - SSE `/api/chat/stream` com evento tipado `runtime_notice`.
- Atualizar frontend do chat para interpretar `runtime_notice`, mostrar aviso amigável e incluir i18n `pt-BR`/`en`.
- Atualizar este status.

## Rodada 6 - Conclusão

### Alterações
- `packages/shared-utils/src/runtime-announcements.ts` (novo):
  - Contrato SSOT de anúncios de runtime:
    - canal Redis `alice:runtime:announcements`;
    - schema Zod tipado para evento `runtime_notice` com códigos canônicos:
      - `serving_interrupted_for_training`
      - `training_in_progress`
      - `serving_restored`.
- `packages/shared-utils/src/index.ts`:
  - Export do contrato compartilhado de anúncios de runtime.
- `apps/gpu-manager-service/src/index.ts`:
  - Publicação de anúncios de runtime no Redis a cada transição relevante da FSM:
    - `serving_draining` -> interrupção por treinamento;
    - `training_active` -> treinamento em progresso;
    - `serving_ready` -> serving restaurado.
  - Logs estruturados de publicação e fallback seguro quando Redis estiver indisponível.
- `apps/chat-service/src/chat-websocket-runtime.ts`:
  - Novo runtime subscriber `createRuntimeAnnouncementRuntime()`:
    - assinatura do canal `alice:runtime:announcements`;
    - validação Zod do payload;
    - broadcast para clientes WebSocket com evento `runtime_notice`.
- `apps/chat-service/src/chat-bootstrap.ts`:
  - Startup/shutdown atualizados para inicializar e encerrar subscriber de anúncios de runtime.
- `apps/chat-service/src/index.ts`:
  - Registro de streams SSE ativos para fan-out de `runtime_notice` em `/api/chat/stream`.
  - Reemissão do último aviso para streams novos (melhora de continuidade operacional).
  - Integração do runtime subscriber de anúncios de runtime no ciclo de vida do serviço.
- Frontend Chat:
  - `apps/frontend-service/src/pages/Chat/chat-stream-mutation.ts`:
    - parser SSE atualizado para evento `runtime_notice` tipado;
    - atualização de estado local;
    - toast amigável no recebimento de interrupção/restauração.
  - `apps/frontend-service/src/pages/Chat/components/types.ts`:
    - tipos `RuntimeNoticeCode` e `RuntimeNotice`.
  - `apps/frontend-service/src/pages/Chat/useChatLocalState.ts`:
    - estado `runtimeNotice` adicionado.
  - `apps/frontend-service/src/pages/Chat/components/ChatMessagesViewport.tsx`:
    - banner visual para interrupção/restauração.
  - `apps/frontend-service/src/pages/Chat/components/ChatPageLayout.tsx`
  - `apps/frontend-service/src/pages/Chat/chat-page-layout-props-builder.ts`
  - `apps/frontend-service/src/pages/Chat/useChatPageLayoutController.ts`
    - propagação do estado `runtimeNotice` no layout do chat.
- i18n:
  - `apps/frontend-service/src/locales/pt-BR.json`
  - `apps/frontend-service/src/locales/en.json`
    - chaves `chat.runtimeNotice.*` adicionadas.
    - Mensagem PT-BR canônica aplicada:
      - “Inferência interrompida momentaneamente por causa de um treinamento em andamento. O serviço retornará automaticamente assim que o treinamento terminar.”
- Testes:
  - `tests/unit/runtime-announcements.test.ts` (novo) validando contrato e schema do anúncio.

### Inventário de Acoplamentos Qwen2.5
- Sem novos acoplamentos Qwen2.5 introduzidos na Rodada 6.
- Compatibilidade histórica de registros legados Qwen2.5 permanece preservada.

### Validações
Executadas em sequência, sem paralelização:
1. `typecheck` (`cmd.exe /c pnpm typecheck`) -> OK
2. `testes` (`cmd.exe /c pnpm test`) -> OK (125 arquivos, 1371 testes)
3. `eslint` (`cmd.exe /c pnpm lint`) -> OK
4. `build` (`cmd.exe /c pnpm build`) -> OK

### Riscos
- A entrega de `runtime_notice` via SSE depende de stream ativo em `/api/chat/stream`; o canal WebSocket cobre clientes conectados em tempo real, mas clientes sem stream/WS ativo verão o aviso apenas no próximo fluxo ativo.
- Em indisponibilidade de Redis, os serviços fazem fail-safe (sem crash em dev e com logs estruturados), porém sem distribuição de aviso em tempo real.

### Próximo Passo
Aguardar prompt da próxima rodada para evolução de UX operacional adicional e integrações complementares da migração.

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
