# Status - Refatoracao da UI do Chat para padrao ChatGPT

**Author:** Fillipe Guerra
**Data:** 19 de Marco de 2026
**Atualizado:** 19 de Marco de 2026
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
  - aparece apenas quando `Area` e/ou `Agente` estiverem em modo manual;
  - nao deve ter cara de formulario.
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

- O host `178.63.41.108` respondeu a `ping` e o dominio HTTPS respondeu normalmente durante a investigacao.
- A porta `22/tcp` permaneceu com timeout a partir deste ambiente, impedindo coleta de logs por SSH nesta sessao.
- Nenhuma alteracao foi feita no servidor de producao.

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
- `apps/frontend-service/src/pages/Chat/useChatSectionProps.ts`
- `apps/frontend-service/src/pages/Chat/useChatPageLayoutController.ts`
- `apps/frontend-service/src/components/ui/dropdown-menu.tsx`
- `apps/frontend-service/src/App.tsx`
- `apps/frontend-service/src/locales/pt-BR.json`
- `apps/frontend-service/src/locales/en.json`
- `docs/product/design-guidelines.md`

## Validacoes executadas

- `pnpm --filter @alice/frontend-service run typecheck`
- `pnpm exec vitest run --passWithNoTests tests/unit/chat-selection.test.ts tests/unit/chat-conversation-selection-sync.test.ts tests/unit/chat-container-bindings.test.ts apps/frontend-service/src/pages/Chat/useChatWorkspacePresentation.test.ts`
- `pnpm --filter @alice/frontend-service run lint`
- `pnpm --filter @alice/frontend-service run build`

## Riscos conhecidos

- A investigacao remota de producao permanece parcialmente bloqueada enquanto a porta `22/tcp` nao estiver acessivel a partir deste ambiente.
- O ajuste de scroll do chat foi feito no shell autenticado somente para a rota `/chat`; qualquer regressao em paginas full-height adjacentes precisa ser observada na validacao final.

## Proximos passos

1. Executar testes, lint e build no escopo alterado do frontend.
2. Revisar consistencia visual e funcional do chat apos a remediacao.
3. Criar o commit consolidado em English.
4. Encerrar sem push, conforme a governanca vigente.
