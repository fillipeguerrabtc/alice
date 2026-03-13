# Relatorio de Correcao - Chat em Branco apos Deploy

**Author:** Fillipe Guerra  
**Data:** 12 de Marco de 2026

## 1. Escopo da rodada
- Investigar por que a pagina `/chat` passou a renderizar a shell autenticada, mas sem exibir o conteudo do Chat.
- Validar evidencias reais em ambiente local e no servidor de producao.
- Aplicar correcao cirurgica sem alterar workflows nem expandir escopo para a logica de stream.

## 2. Evidencias coletadas

### 2.1 Producao
- Frontend em producao respondeu `200` para `/chat` e entregou os assets esperados do SPA.
- Containers principais permaneceram saudaveis no servidor `178.63.41.108`, incluindo `alice-frontend` e `alice-chat`.
- Nao houve evidencias de erro correspondente no `chat-service` ou no `observability-service` para explicar tela vazia por falha de API.

### 2.2 Comportamento observado
- Sidebar, header global, `ThemeToggle` e `LanguageSwitch` continuaram renderizando normalmente.
- A area central do Chat permanecia vazia, inclusive em navegacao anonima e em outro navegador.
- Isso indicou problema de renderizacao/layout na area `main` do shell autenticado, e nao falha de autenticacao, roteamento HTTP ou indisponibilidade do backend.

## 3. Causa raiz confirmada
- O ultimo deploy do Chat havia alterado rota e comportamento de stream, mas a evidencia atual nao apontou erro de API ou crash do componente.
- A pagina do Chat depende de container com altura definida (`h-full`) para montar o layout principal.
- No `AuthenticatedLayout`, os filhos eram renderizados diretamente dentro de `main`, sem um wrapper garantindo area util definida para paginas full-height.
- Resultado: o shell carregava, mas a area do Chat podia colapsar visualmente, levando ao efeito de pagina em branco.

## 4. Correcao implementada
Arquivo alterado:
- `apps/frontend-service/src/App.tsx`

Mudanca:
- Adicionado wrapper interno em `AuthenticatedLayout` com `className="h-full min-h-0 w-full"` ao redor de `{children}`.

Resultado esperado:
- Garante area de renderizacao estavel para paginas full-height como Chat.
- Mantem o shell global inalterado para as demais paginas.
- Evita regressao sem tocar na logica de stream, fetch ou WebSocket.

## 5. Validacao executada
Executado de forma sequencial:

1. `pnpm typecheck` -> OK
2. `pnpm test` -> OK (`129` arquivos, `1385` testes, `1385` passed)
3. `pnpm lint` -> OK
4. `pnpm build` -> OK

## 6. Arquivos alterados
- `apps/frontend-service/src/App.tsx`
- `docs/RELATORIO-CORRECAO-CHAT-LAYOUT-BRANCO-2026-03-12.md`

## 7. Observacoes operacionais
- Investigacao incluiu SSH em producao para coleta de evidencias reais.
- Nenhum workflow trigger foi alterado.
- Nenhum push foi realizado.
- O commit desta rodada deve incluir apenas os arquivos acima.
