# Relatório de Implementação - Correção UX /documents (Documentos RAG)

**Author:** Fillipe Guerra  
**Data:** 28 de Fevereiro de 2026

## Objetivo
Corrigir o bug de UX da página `/documents`, onde a lista de documentos ficava espremida no rodapé com scrollbar interna pequena devido a layout com scroll duplo e topo excessivamente alto.

## Alterações implementadas
- Refatoração estrutural de `apps/frontend-service/src/pages/Documents.tsx` para separar:
  - Header enxuto com título, subtítulo, badges e `TabsList`.
  - Conteúdo das abas (`TabsContent`) com layout em duas colunas no desktop (`lg:grid-cols-[420px_minmax(0,1fr)]`) e empilhado no mobile.
- Remoção do bloco antigo de listagem com scroll separado no final da página (`overflow-y-auto` antigo), eliminando o comportamento de rodapé comprimido.
- Migração da toolbar de listagem para dentro do painel direito (card da lista), com:
  - Busca
  - Filtros
  - Alternância de modo de visualização (grid/list)
- Garantia de classes de altura/layout para evitar colapso:
  - `min-h-0` em ancestrais flex
  - painel direito com `flex flex-col min-h-0`
  - área rolável da lista com `flex-1 min-h-0 overflow-y-auto`
- Compactação do `UploadZone`:
  - `p-8` -> `p-5 sm:p-6`
- Inclusão de busca local para aba de mídia (`mediaSearchQuery`) sem alterar queries/mutations.

## Requisitos preservados
- Queries React Query mantidas.
- `enabled` da query de mídia preservado (`activeTab === 'media'`).
- Mutations de upload/delete/send-to-training preservadas.
- Modais existentes mantidos (visualização, deleções e envio para treinamento).

## Validações executadas
Comandos rodados separadamente e individualmente:

1. `pnpm -w typecheck`  
   Resultado: **OK**
2. `pnpm -w test`  
   Resultado: **Falha preexistente** em `tests/unit/chat-stream-corruption-heuristics.test.ts`  
   Teste com falha: `detecta ruído linguístico em texto embaralhado`
3. `pnpm -w lint`  
   Resultado: **OK**
4. `pnpm -w build`  
   Resultado: **OK**

## Resultado da correção
- Layout da página `/documents` agora evita compressão da lista no rodapé.
- Área de listagem ganhou painel dedicado com rolagem utilizável.
- Controles principais foram redistribuídos para melhorar previsibilidade de altura e usabilidade em desktop/mobile.
