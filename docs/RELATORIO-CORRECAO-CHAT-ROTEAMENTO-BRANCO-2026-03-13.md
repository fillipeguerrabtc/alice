# Relatorio de Correcao - Chat em Branco por Conflito de Roteamento

**Author:** Fillipe Guerra  
**Data:** 13 de Marco de 2026

## 1. Escopo da rodada
- Investigar em profundidade por que a rota `/chat` continuava renderizando apenas a shell autenticada, sem o conteudo do chat.
- Confirmar a causa raiz com evidencias reais de producao, bundle servido e comportamento do browser.
- Aplicar correcao cirurgica no codigo sem tocar em workflows ou introduzir workaround.
- Publicar a correcao em producao com bundle completo e coerente entre entrypoint e chunks lazy.

## 2. Evidencias coletadas

### 2.1 Producao
- Host `178.63.41.108` respondeu normalmente via SSH.
- Containers `alice-frontend`, `alice-chat`, `alice-auth` e `alice-caddy` estavam saudaveis.
- As APIs consumidas no bootstrap do chat responderam corretamente quando autenticadas:
  - `/api/auth/user`
  - `/api/chat/version`
  - `/api/chat/conversations`
  - `/api/assistant-settings`
  - `/api/agents`
  - `/api/namespaces`
- O bundle servido em producao ja continha a correcao anterior de layout (`AuthenticatedLayout` com wrapper `h-full min-h-0 w-full`), eliminando a hipotese de deploy defasado dessa correcao.

### 2.2 Browser reproduzido via CDP
- A rota final permaneceu em `https://yesyoudeserve.duckdns.org/chat`.
- O `body` renderizado continha apenas os controles do shell global (`Toggle Sidebar` e `Toggle theme`).
- Nao havia `text-chat-title`, `button-new-chat` nem `chat-workspace-all` no DOM final.
- Nao houve erro de rede, `console.error`, `window.onerror` ou `unhandledrejection`.
- O `<main>` autenticado terminava exatamente em `<div class="h-full min-h-0 w-full"></div>`, ou seja, o shell montava e o conteudo interno da pagina nao.

## 3. Causa raiz confirmada
- O problema nao estava no backend, nem no bootstrap de dados, nem na correcao anterior de layout.
- Em `apps/frontend-service/src/App.tsx`, o `Switch` do `wouter` definia duas rotas nesta ordem:
  - `path="/chat/"`
  - `path="/chat/:conversationId?"`
- A biblioteca usada pelo router (`wouter` com `regexparam`) trata a barra final como opcional.
- Evidencia objetiva:
  - o pattern gerado para `/chat/` e `^/chat/?$`
  - esse pattern casa tanto `/chat/` quanto `/chat`
- Resultado:
  - ao acessar `/chat`, o `Switch` parava na rota de redirect de `/chat/`
  - o app renderizava `Redirect to="/chat"` para a propria URL
  - o componente `Chat` nunca era montado
  - a shell autenticada aparecia sem conteudo, produzindo a pagina preta/vazia observada

## 4. Causa operacional adicional observada em producao
- Durante a correcao em producao ficou evidente um segundo fator operacional: os assets JS sao servidos com `Cache-Control: public, immutable`.
- Um hotfix parcial apenas no bundle de entrada, mantendo o mesmo nome de arquivo, nao resolve para browsers com cache quente.
- Alem disso, trocar somente o entrypoint gerou incoerencia de chunks: o browser passou a carregar o entrypoint novo e, ao entrar no Chat, tambem puxava chunks antigos ainda referenciados pelo grafo anterior.
- Evidencia via CDP:
  - o navegador carregou `index-chatfix-20260313.js`
  - ao abrir `/chat`, tambem carregou `index-B473dloa.js` e `index-Bft6v6hc.js`
  - com isso, a pagina permanecia vazia mesmo sem erro explicito
- Conclusao:
  - a correcao definitiva em producao precisava substituir o `dist` completo do frontend, nao apenas um arquivo isolado.

## 5. Correcao implementada
Arquivo alterado:
- `apps/frontend-service/src/App.tsx`

Mudanca:
- Removida a rota separada `path="/chat/"`.
- Mantida apenas a rota `path="/chat/:conversationId?"`, com comentario explicito documentando que:
  - `/chat`
  - `/chat/`
  - `/chat/:conversationId`
  devem ser atendidas pela mesma rota.
- Adicionado teste de regressao para documentar o conflito real do matcher (`regexparam`) entre `/chat/` e `/chat`.

## 6. Publicacao em producao
- Foi gerado o `dist` completo do frontend localmente a partir do codigo corrigido.
- O `dist` completo foi enviado ao servidor e empacotado em uma imagem derivada apenas para o `alice-frontend`.
- O container `alice-frontend` foi recriado isoladamente, sem alterar outros servicos.
- O `index.html` publicado passou a referenciar o bundle coerente `assets/index-DoQClgUU.js`.

## 7. Validacao final em producao
- Validacao em navegador real via CDP, autenticado:
  - URL final: `https://yesyoudeserve.duckdns.org/chat`
  - `data-testid="text-chat-title"` encontrado com valor `Nova Conversa`
  - workspace do chat presente no DOM
  - mensagem inicial de boas-vindas presente
  - sem erros de `console`, `window.onerror` ou `unhandledrejection`
- Validacao adicional:
  - `/` continuou renderizando normalmente o dashboard
  - o browser passou a carregar apenas o grafo coerente do build atual (`index-DoQClgUU.js` + chunks correspondentes)

## 8. Resultado esperado
- `/chat` passa a montar o componente `Chat` corretamente.
- `/chat/` continua funcionando por compatibilidade, sem remount extra e sem redirect recursivo para a propria URL.
- O comportamento permanece estavel para `/chat/:conversationId`.

## 9. Arquivos alterados nesta rodada
- `apps/frontend-service/src/App.tsx`
- `tests/unit/frontend/chat-route-guard.test.ts`
- `docs/RELATORIO-CORRECAO-CHAT-ROTEAMENTO-BRANCO-2026-03-13.md`

## 10. Observacoes operacionais
- A investigacao em producao incluiu:
  - inspeção de containers
  - verificacao de respostas HTTP autenticadas
  - reproducao do browser via Chrome DevTools Protocol
- A publicacao em producao foi restrita ao container `alice-frontend`.
- Nenhum workflow, trigger ou gatilho de deploy foi alterado.
- Nenhum mock, stub, hardcode funcional ou workaround foi introduzido.
