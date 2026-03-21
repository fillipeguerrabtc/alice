# Status - Refatoracao da UI do Chat para padrao ChatGPT

**Author:** Fillipe Guerra
**Data:** 19 de Marco de 2026
**Atualizado:** 21 de Marco de 2026
**Status:** em andamento
**Tipo:** status

## Objetivo da iniciativa

Refatorar a UI/UX do chat da Alice para um padrao premium no estilo ChatGPT, removendo a faixa dedicada de controles no topo e centralizando a configuracao da conversa no titulo `Alice`, com foco em densidade visual, clareza operacional, acessibilidade e escalabilidade.

## Escopo aprovado

- Remover a faixa visual persistente com `Area`, `Agente` e `Raciocinio` abaixo do header.
- Refatorar o topo do chat para um padrao minimalista de uma linha.
- Centralizar `Raciocinio`, `Area` e `Agente` no menu do titulo `Alice`.
- Manter o botao `+` do composer exclusivo para anexos.
- Exibir resumo discreto de estado manual somente quando houver override de `Area` e/ou `Agente`.
- Atualizar a documentacao canonica impactada e validar o escopo alterado do frontend.
- Corrigir regressões funcionais e visuais introduzidas na primeira entrega do padrao ChatGPT-like.

## Decisoes congeladas

1. O topo do chat deve ficar minimalista, com `Alice` como elemento principal de configuracao da conversa.
2. `Raciocinio`, `Area` e `Agente` devem ficar todos dentro do menu do titulo `Alice`.
3. O botao `+` do composer deve ficar exclusivo para anexos e futuras ferramentas do input.
4. O bloco atual com os tres controles persistentes no topo deve ser removido completamente.
5. Quando tudo estiver em automatico, a interface deve ficar clean e sem ruido.
6. Quando `Area` ou `Agente` estiverem em modo manual, mostrar apenas resumo discreto de estado, sem reintroduzir formulario persistente na superficie.
7. A experiencia deve ficar o mais proxima possivel do ChatGPT em fluxo, densidade e percepcao premium, preservando a logica real da Alice.
8. O estado atual de `Raciocinio`, `Area` e `Agente` precisa ficar visivel na superficie principal sem reintroduzir controles altos e persistentes.

## Blocos estrategicos

1. Diagnostico e leitura
2. Blueprint final de UX
3. Refatoracao estrutural
4. Implementacao premium da UI
5. Preservacao da logica e regressões
6. Documentacao canonica
7. Validacao final no escopo alterado
8. Fechamento

## Progresso por bloco

### 1. Diagnostico e leitura

- Concluido.
- Governanca e SSOT lidos: `AGENTS.md`, `CLAUDE.md`, `docs/INDEX.md`, `docs/product/design-guidelines.md`.
- Implementacao atual mapeada em:
  - `apps/frontend-service/src/pages/Chat/components/ChatHeaderSection.tsx`
  - `apps/frontend-service/src/pages/Chat/components/ChatGovernanceControls.tsx`
  - `apps/frontend-service/src/pages/Chat/components/ChatInput.tsx`
  - `apps/frontend-service/src/pages/Chat/components/ChatPageLayout.tsx`
  - `apps/frontend-service/src/pages/Chat/useChatSectionProps.ts`
  - `apps/frontend-service/src/pages/Chat/useChatPageLayoutController.ts`
- Diagnostico principal:
  - o desperdicio vertical vem do conjunto `titulo + descricao + card persistente` no topo;
  - a logica de selecao ja esta isolada e reaproveitavel;
  - o `+` do composer ja possui semantica clara de anexos e nao deve absorver configuracao da conversa.

### 2. Blueprint final de UX

- Concluido.
- Header:
  - linha unica, baixa altura, sem faixa dedicada de governanca abaixo do titulo;
  - titulo principal `Alice` com menu contextual premium.
- Menu `Alice`:
  - grupo `Raciocinio` com item ativo marcado;
  - grupo `Area` com item automatico e lista de areas;
  - grupo `Agente` com item automatico e lista de agentes;
  - hierarquia por separadores e labels compactos;
  - acessivel por mouse, toque e teclado.
- Botao `+`:
  - exclusivo para anexos e futuras acoes do input;
  - sem configuracao de conversa.
- Resumo discreto:
  - o topo deve exibir o estado atual de `Area` e `Agente` em formato compacto;
  - quando houver override manual, o resumo deve sinalizar esse modo sem voltar a ter cara de formulario.
- Desktop/mobile:
  - mesma logica de interacao;
  - menu contextual ancorado no titulo;
  - layout responsivo sem reintroduzir a faixa antiga.

### 3. Refatoracao estrutural

- Concluido.
- A antiga faixa persistente de governanca foi removida da composicao do header.
- O contrato visual foi refatorado de `ChatGovernanceControls` para `ChatIdentityMenu`.
- O header foi reconstruido como uma barra unica, com menor altura e menor ruido visual.
- O componente legado de controles fixos foi removido do modulo de chat.

### 4. Implementacao premium da UI

- Concluido.
- O menu `Alice` foi implementado com:
  - grupo de `Raciocinio`;
  - submenu de `Area`;
  - submenu de `Agente`;
  - hierarquia visual por labels compactos, separadores e estados ativos.
- O `+` do composer foi mantido exclusivo para anexos.
- O composer foi refinado para uma densidade visual mais proxima do padrao premium desejado.
- O resumo discreto de override manual passou a aparecer apenas quando `Area` e/ou `Agente` saem do automatico.

### 5. Preservacao da logica e regressões

- Concluido.
- A logica de selecao existente foi preservada e reaproveitada na nova camada visual.
- `Area` continua filtrando `Agente` conforme o estado atual.
- `Agente` continua respeitando a relacao com o namespace/area selecionado.
- `Raciocinio` continua respeitando as restricoes de override existentes.
- Os testes relevantes de selecao e sincronizacao passaram apos a refatoracao.

### 6. Documentacao canonica

- Concluido.
- `docs/product/design-guidelines.md` foi atualizado para formalizar o novo padrao do topo do chat, o menu `Alice` e a responsabilidade exclusiva do `+` para anexos/input.

### 7. Validacao final no escopo alterado

- Concluido.
- Validacoes executadas no escopo alterado do frontend:
  - `pnpm --filter @alice/frontend-service run typecheck`
  - `pnpm exec vitest run --passWithNoTests tests/unit/chat-selection.test.ts tests/unit/chat-conversation-selection-sync.test.ts tests/unit/chat-container-bindings.test.ts apps/frontend-service/src/pages/Chat/useChatWorkspacePresentation.test.ts`
  - `pnpm --filter @alice/frontend-service run lint`
  - `pnpm --filter @alice/frontend-service run build`
- Todas as validacoes executadas encerraram sem erros e sem warnings reportados pela ferramenta.

### 8. Fechamento

- Em andamento.
- Revisao final de consistencia e consolidacao de entrega em curso.

## Rodada de remediacao em 19 de Marco de 2026

### Diagnostico adicional confirmado

- `Area` e `Agente` falhavam porque o submenu lateral do dropdown era renderizado sem `Portal`, enquanto o menu pai usava `overflow-x-hidden`, cortando a abertura lateral.
- O estado atual de `Raciocinio` nao ficava visivel fora do menu `Alice`.
- O topo nao exibia `Area` e `Agente` atuais quando estavam em automatico, reduzindo previsibilidade operacional.
- A tela inicial permanecia pesada, com robozinho e card hero, contrariando o objetivo de leveza do padrao ChatGPT.
- Havia uma race condition no bootstrap da primeira mensagem em conversa nova: o frontend navegava para a conversa antes da persistencia do stream e a sincronizacao podia sobrescrever o estado otimista com um payload ainda vazio.
- O shell autenticado mantinha scroll global concorrendo com o scroll interno do chat.
- O painel de thinking usava overflow horizontal por linha, gerando corte visual e tremor na experiencia de streaming.

### Implementacao aplicada nesta rodada

- Dropdown compartilhado refatorado para suportar `SubContent` em `Portal` e evitar clipping lateral.
- `ChatIdentityMenu` atualizado para:
  - usar `RadioGroup` controlado por `onValueChange`;
  - expor `Area` e `Agente` atuais no topo do chat em formato compacto;
  - manter a configuracao centralizada em `Alice`.
- Composer atualizado para exibir o `Raciocinio` atual de forma persistente e compacta, no estilo ChatGPT.
- `WelcomeScreen` simplificada para uma tela inicial leve, sem robozinho e sem card hero pesado.
- `MessageBubble` endurecida contra overflow horizontal no painel de thinking e no corpo da resposta.
- Shell autenticado do app ajustado para evitar scroll externo concorrente na rota do chat.
- Protecao de sincronizacao otimista adicionada para impedir que a query de mensagens apague a primeira interacao antes da persistencia real.
- Teste unitario adicionado cobrindo a regra de deferimento da sincronizacao otimista.

### Validacoes concluídas nesta rodada

- `pnpm --filter @alice/frontend-service run typecheck`
- `pnpm exec vitest run --passWithNoTests tests/unit/chat-selection.test.ts tests/unit/chat-conversation-selection-sync.test.ts tests/unit/chat-container-bindings.test.ts apps/frontend-service/src/pages/Chat/useChatWorkspacePresentation.test.ts apps/frontend-service/src/pages/Chat/useChatMessageSyncEffects.test.ts`
- `pnpm --filter @alice/frontend-service run lint`
- `pnpm --filter @alice/frontend-service run build`
- Todas as validacoes desta rodada encerraram sem erros.

### Investigacao remota de producao

- O acesso SSH ao servidor de producao foi validado em modo somente leitura.
- O host `alice-prod` e o IP `178.63.41.108` responderam normalmente por SSH nesta sessao.
- Nenhuma alteracao foi feita no servidor de producao.

## Rodada 2 enterprise em 19 de Marco de 2026

### Causa raiz adicional confirmada em producao

- A primeira mensagem nao se perde no backend; a conversa investigada `502ff751-01ea-437d-9ac5-27f9656bf8be` persistiu a primeira mensagem do usuario e a primeira resposta em menos de 400 ms apos a criacao da conversa.
- O frontend precisava continuar protegendo o bootstrap otimista, mas a producao revelou um gap novo de modelagem:
  - `metadata.selection` pode permanecer totalmente automatica;
  - `metadata.routing` e `conversation.namespaceId` podem registrar uma `Area` efetiva escolhida pelo backend;
  - portanto, o topo do chat nao pode tratar selecao do usuario e roteamento efetivo como a mesma coisa.
- Evidencia concreta observada em producao:
  - `metadata.selection.selectedNamespaceId = null`
  - `metadata.routing.selectedNamespaceId = ee55f977-8a9a-4689-ace7-79e95fa191b5`
  - `conversation.namespaceId = ee55f977-8a9a-4689-ace7-79e95fa191b5`
- Isso exigiu uma segunda rodada para separar:
  - configuracao escolhida pelo usuario no menu `Alice`
  - estado efetivo de `Area` e `Agente` exibido no topo

### Implementacao aplicada nesta rodada

- O contrato `Conversation.metadata` do frontend foi expandido para tipar `routing`.
- A camada `chat-selection.ts` passou a expor leitura separada para:
  - `selection` canonica persistida;
  - roteamento efetivo da conversa;
  - estado de exibicao da superficie principal.
- `ChatIdentityMenu` passou a:
  - continuar controlando `Area`, `Agente` e `Raciocinio` via estado de selecao;
  - exibir no topo `Area atual` e `Agente atual` com base no roteamento efetivo;
  - marcar overrides manuais com badge compacto.
- `useChatPageLayoutController.ts` foi atualizado para derivar o resumo do topo a partir de:
  - `metadata.routing`
  - `conversation.namespaceId`
  - `conversation.agentId`
  - `routedAgent` observado no fluxo local
- As traducoes do chat foram atualizadas para diferenciar `Area atual`, `Agente atual` e badge `Manual`.

### Validacoes concluídas nesta rodada

- `pnpm exec vitest run tests/unit/chat-selection.test.ts tests/unit/chat-conversation-selection-sync.test.ts apps/frontend-service/src/pages/Chat/useChatMessageSyncEffects.test.ts`
- `pnpm --filter @alice/frontend-service run typecheck`
- `pnpm --filter @alice/frontend-service run lint`
- `pnpm --filter @alice/frontend-service run build`
- Todas as validacoes desta rodada encerraram sem erros.

## Arquivos impactados

- `docs/status/chat-ui-chatgpt-refactor-status.md`
- `apps/frontend-service/src/pages/Chat/components/ChatIdentityMenu.tsx`
- `apps/frontend-service/src/pages/Chat/components/ChatHeaderSection.tsx`
- `apps/frontend-service/src/pages/Chat/components/ChatPageLayout.tsx`
- `apps/frontend-service/src/pages/Chat/components/ChatInput.tsx`
- `apps/frontend-service/src/pages/Chat/components/WelcomeScreen.tsx`
- `apps/frontend-service/src/pages/Chat/components/MessageBubble.tsx`
- `apps/frontend-service/src/pages/Chat/components/ChatGovernanceControls.tsx`
- `apps/frontend-service/src/pages/Chat/components/index.ts`
- `apps/frontend-service/src/pages/Chat/chat-page-layout-props-builder.ts`
- `apps/frontend-service/src/pages/Chat/chat-stream-mutation.ts`
- `apps/frontend-service/src/pages/Chat/useChatMessageSyncEffects.ts`
- `apps/frontend-service/src/pages/Chat/useChatMessageSyncEffects.test.ts`
- `apps/frontend-service/src/pages/Chat/useChatLocalState.ts`
- `apps/frontend-service/src/pages/Chat/useChatPageLifecycle.ts`
- `apps/frontend-service/src/pages/Chat/chat-selection.ts`
- `apps/frontend-service/src/pages/Chat/useChatSectionProps.ts`
- `apps/frontend-service/src/pages/Chat/useChatPageLayoutController.ts`
- `apps/frontend-service/src/components/ui/dropdown-menu.tsx`
- `apps/frontend-service/src/App.tsx`
- `apps/frontend-service/src/pages/Chat/components/types.ts`
- `apps/frontend-service/src/locales/pt-BR.json`
- `apps/frontend-service/src/locales/en.json`
- `docs/product/design-guidelines.md`

## Validacoes executadas

- `pnpm --filter @alice/frontend-service run typecheck`
- `pnpm exec vitest run --passWithNoTests tests/unit/chat-selection.test.ts tests/unit/chat-conversation-selection-sync.test.ts tests/unit/chat-container-bindings.test.ts apps/frontend-service/src/pages/Chat/useChatWorkspacePresentation.test.ts`
- `pnpm --filter @alice/frontend-service run lint`
- `pnpm --filter @alice/frontend-service run build`
- `pnpm exec vitest run tests/unit/chat-selection.test.ts tests/unit/chat-conversation-selection-sync.test.ts apps/frontend-service/src/pages/Chat/useChatMessageSyncEffects.test.ts`

## Riscos conhecidos

- O ajuste de scroll do chat foi feito no shell autenticado somente para a rota `/chat`; qualquer regressao em paginas full-height adjacentes precisa ser observada na validacao final.
- Em conversas automaticas muito recentes, o topo depende de `metadata.routing`, `conversation.namespaceId` e `routedAgent`; qualquer regressao futura nesse contrato do backend precisa manter esses campos sincronizados.

## Proximos passos

1. Revisar consistencia visual e funcional do chat apos a rodada 2 enterprise.
2. Criar o commit consolidado em English.
3. Encerrar sem push, conforme a governanca vigente.

## Rodada 4 routing e identidade em 21 de Marco de 2026

### Causa raiz adicional confirmada

- O `greetings gate` cobria apenas saudacoes mais formais e deixava de fora entradas curtas como `Opa`, `Bora` e variacoes de `Tudo bem por ai`.
- O scoring semantico antigo aceitava overlap lexical fraco sem stopwords robustas, permitindo falso positivo de especialista em mensagens curtas e generalistas.
- A politica hibrida padrao ainda buscava slug `default`, enquanto o namespace canonico observado no banco e `default-chat`; quando a busca falhava, o fallback podia cair no primeiro namespace ativo.
- O backend gravava `selectedAgentId = null` corretamente, mas o contrato em tempo real nao limpava o badge do frontend com seguranca quando nao havia agente.
- A normalizacao de mensagens no frontend reaplicava `fallbackAgent` mesmo quando o payload trazia `agent: null`, reintroduzindo autoria stale.

### Implementacao aplicada nesta rodada

- O `greetings gate` foi ampliado de forma controlada para cobrir saudacoes curtas e variacoes relevantes em Portugues Brasileiro, sem aceitar termos de dominio.
- A logica de relevancia semantica foi extraida para utilitario dedicado com:
  - normalizacao forte;
  - stopwords pt-BR/en;
  - peso maior para tokens fortes;
  - penalizacao de mensagens curtas/generalistas sem sinal robusto.
- O fallback da politica hibrida passou a preferir explicitamente `default-chat`, com alias seguro para `default`, antes de qualquer fallback por ordem de namespace.
- SSE e WebSocket agora emitem `agent_route` mesmo quando `agent = null`, carregando tambem `selected.agentId` e `selected.namespaceId` para o frontend limpar estado stale imediatamente.
- O frontend passou a:
  - respeitar `agent: null` explicito ao normalizar mensagens;
  - limpar `routedAgent` com base na ultima resposta renderizavel da conversa;
  - usar o estado de roteamento mais recente para compor `Agente atual` e `Area atual`.

### Validacoes concluidas nesta rodada

- `pnpm --filter @alice/chat-service run typecheck`
- `pnpm --filter @alice/frontend-service run typecheck`
- `timeout 120s pnpm exec vitest run tests/unit/response-cache-greeting.test.ts --reporter verbose`
- `timeout 120s pnpm exec vitest run tests/unit/routing-relevance.test.ts tests/unit/chat-message-normalization.test.ts --reporter verbose`
- `pnpm --filter @alice/chat-service exec eslint src/index.ts src/response-cache.ts src/routing-relevance.ts --max-warnings=0`
- `pnpm --filter @alice/frontend-service exec eslint src/pages/Chat/chat-message-normalization.ts src/pages/Chat/chat-stream-mutation.ts src/pages/Chat/useChatConversationSurfaceState.ts src/pages/Chat/useChatPageLayoutController.ts src/pages/Chat/useChatRoutingState.ts --max-warnings=0`
- `pnpm exec eslint tests/unit/response-cache-greeting.test.ts tests/unit/routing-relevance.test.ts tests/unit/chat-message-normalization.test.ts --max-warnings=0`
- `pnpm --filter @alice/chat-service run build`
- `pnpm --filter @alice/frontend-service run build`

## Rodada 3 light empty state em 20 de Marco de 2026

### Diagnostico adicional confirmado

- O `ChatComposerSection` ainda aplicava `border-t`, criando uma linha divisoria explicita entre a viewport e o input.
- O layout principal nao diferenciava estruturalmente `empty state mode` de `conversation mode`; o estado vazio era apenas um conteúdo alternativo dentro da viewport de mensagens.
- A `WelcomeScreen` ainda dependia de string fixa de locale e renderizava duas camadas de texto, mantendo a abertura do chat com cara de pagina comum.
- A headline inicial nao usava contrato real do backend, nem contexto autentico de `preferredName`, `firstName`, `timezone` e `location`.

### Implementacao aplicada nesta rodada

- `ChatPageLayout` passou a separar explicitamente:
  - `empty state mode`, com headline unica e composer centralizado;
  - `conversation mode`, com fluxo normal de mensagens e composer no rodape.
- A linha divisoria superior do composer foi removida e o shell visual do chat ficou mais leve.
- `WelcomeScreen` foi reescrita para exibir apenas uma frase curta e premium.
- O `chat-service` ganhou o endpoint real `GET /api/chat/empty-state-headline`, com:
  - uso de contexto autentico do usuario quando disponivel;
  - headline curta em uma unica sentenca;
  - variacao por turno do dia, tema e localizacao;
  - saudações ocasionais com nome;
  - historico curto em preferencias do usuario para evitar repeticao imediata.
- O frontend passou a consumir esse contrato e manteve fallback local apenas para contingencia.
- O composer continua preservando `Raciocinio`, `Area`, `Agente` e o menu `Alice` no modelo ja aprovado.

### Validacoes concluidas nesta rodada

- `pnpm --filter @alice/frontend-service run typecheck`
- `pnpm --filter @alice/chat-service run typecheck`
- `pnpm exec vitest run tests/unit/chat-empty-state-headline.test.ts tests/unit/chat-user-name-utils.test.ts tests/unit/frontend/chat-empty-state-headline-frontend.test.ts tests/unit/services/chat-openapi-sync.test.ts tests/unit/services/chat-openapi-rbac-sync.test.ts`
- `pnpm --filter @alice/frontend-service run lint`
- `pnpm --filter @alice/chat-service run lint`
- `pnpm --filter @alice/frontend-service run build`
- `pnpm --filter @alice/chat-service run build`
- Todas as validacoes desta rodada encerraram sem erros e sem warnings reportados pelas ferramentas executadas.

### Arquivos impactados nesta rodada

- `apps/chat-service/src/chat-empty-state-headline.ts`
- `apps/chat-service/src/index.ts`
- `apps/chat-service/src/openapi-specs.ts`
- `apps/chat-service/src/user-name-utils.ts`
- `apps/frontend-service/src/pages/Chat/chat-empty-state-headline.ts`
- `apps/frontend-service/src/pages/Chat/chat-page-layout-props-builder.ts`
- `apps/frontend-service/src/pages/Chat/components/ChatComposerSection.tsx`
- `apps/frontend-service/src/pages/Chat/components/ChatHeaderSection.tsx`
- `apps/frontend-service/src/pages/Chat/components/ChatInput.tsx`
- `apps/frontend-service/src/pages/Chat/components/ChatMessagesViewport.tsx`
- `apps/frontend-service/src/pages/Chat/components/ChatPageLayout.tsx`
- `apps/frontend-service/src/pages/Chat/components/WelcomeScreen.tsx`
- `apps/frontend-service/src/pages/Chat/useChatPageLayoutController.ts`
- `apps/frontend-service/src/pages/Chat/useChatPagePresentationModel.ts`
- `docs/product/design-guidelines.md`
- `docs/status/chat-ui-chatgpt-refactor-status.md`
- `tests/unit/chat-empty-state-headline.test.ts`
- `tests/unit/frontend/chat-empty-state-headline-frontend.test.ts`
- `tests/unit/chat-user-name-utils.test.ts`

## Rodada 4 headline refinement em 20 de Marco de 2026

### Diagnostico adicional confirmado

- A headline do frontend ainda podia aparecer em duas etapas: fallback local imediato e frase final retornada pelo backend.
- A query da headline estava acoplada ao `focusNonce`, permitindo novas resolucoes na mesma sessao visual do chat.
- O repertorio atual funcionava, mas ainda estava longo demais e com pouca variacao de humor, energia, provocacao e filosofia.
- O uso do nome do usuario ficava abaixo do alvo desejado quando existia contexto autenticado.

### Implementacao aplicada nesta rodada

- O gerador em `apps/chat-service/src/chat-empty-state-headline.ts` foi reescrito com frases mais curtas, uma unica sentenca, limite de comprimento na origem e repertorio ampliado em tons:
  - divertidos;
  - energicos;
  - provocativos;
  - motivacionais;
  - inspiracionais;
  - filosoficos.
- O backend passou a usar o nome curto do usuario em frequencia deterministica aproximada de 60% quando `displayName` existe.
- Referencias breves a Sêneca, Aristóteles e Descartes foram adicionadas como parte do repertorio premium, sem virar quote card.
- O frontend deixou de competir com o backend no bootstrap:
  - a headline principal continua vindo do endpoint real;
  - o fallback local so entra quando a query falha de verdade;
  - a query deixou de variar por `focusNonce` e passou a permanecer estavel durante a abertura corrente da pagina.
- `WelcomeScreen` passou a reservar o espaco da headline durante o carregamento e aplicar clamp visual de no maximo 2 linhas.
- O contrato OpenAPI e os testes unitarios foram atualizados para refletir os novos temas e a nova regra de resolucao.

### Validacoes concluidas nesta rodada

- `pnpm --filter @alice/frontend-service run typecheck`
- `pnpm --filter @alice/chat-service run typecheck`
- `pnpm exec vitest run tests/unit/chat-empty-state-headline.test.ts tests/unit/frontend/chat-empty-state-headline-frontend.test.ts tests/unit/chat-user-name-utils.test.ts`
- `pnpm --filter @alice/frontend-service run lint`
- `pnpm --filter @alice/chat-service run lint`
- `pnpm --filter @alice/frontend-service run build`
- `pnpm --filter @alice/chat-service run build`
- Todas as validacoes desta rodada encerraram sem erros e sem warnings reportados pelas ferramentas executadas.

### Arquivos impactados nesta rodada

- `apps/chat-service/src/chat-empty-state-headline.ts`
- `apps/chat-service/src/openapi-specs.ts`
- `apps/frontend-service/src/pages/Chat/chat-empty-state-headline.ts`
- `apps/frontend-service/src/pages/Chat/components/ChatPageLayout.tsx`
- `apps/frontend-service/src/pages/Chat/components/WelcomeScreen.tsx`
- `apps/frontend-service/src/pages/Chat/useChatPageLayoutController.ts`
- `apps/frontend-service/src/pages/Chat/useChatPagePresentationModel.ts`
- `docs/product/design-guidelines.md`
- `docs/status/chat-ui-chatgpt-refactor-status.md`
- `tests/unit/chat-empty-state-headline.test.ts`
- `tests/unit/frontend/chat-empty-state-headline-frontend.test.ts`
