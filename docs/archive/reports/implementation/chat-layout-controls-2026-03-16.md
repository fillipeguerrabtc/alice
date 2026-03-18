# Relatorio de Correcao - Chat Layout e Controles

**Author:** Fillipe Guerra  
**Data:** 16 de Marco de 2026

## Contexto
Foi identificada uma regressao de UX no chat principal do frontend. A interface passou a exibir uma faixa dedicada abaixo do header apenas para o seletor de workspace, consumindo altura util sem entregar valor proporcional. Ao mesmo tempo, controles uteis do chat deixaram de aparecer na experiencia padrao, incluindo selecao de reasoning mode e acoes operacionais da conversa.

## Causa raiz
- O estado inicial de `activeWorkspace` foi alterado para `conversation`, fazendo o chat abrir em um modo restritivo.
- A apresentacao do chat passou a condicionar governanca, operacoes e diagnostico apenas aos workspaces especificos, em vez de mantelos acessiveis no modo padrao.
- O seletor de workspace foi renderizado em uma barra separada do header, criando uma segunda linha visual quase vazia em cenarios comuns.

## Correcao aplicada
- O chat voltou a iniciar no workspace `all`, restaurando a experiencia padrao com controles uteis disponiveis.
- Governanca, operacoes e diagnostico voltaram a ficar disponiveis no modo `all`.
- O seletor de workspace foi movido para dentro do header do chat, eliminando a barra dedicada abaixo do titulo.
- O header foi reorganizado para manter os controles importantes acessiveis no desktop sem desperdicar altura.
- No mobile, o seletor de workspace foi mantido compacto para evitar poluicao visual excessiva no estado padrao.

## Validacoes executadas
- `pnpm --filter @alice/frontend-service run typecheck`
- `pnpm exec vitest run --passWithNoTests apps/frontend-service/src/pages/Chat`
- `pnpm --filter @alice/frontend-service run lint`
- `pnpm --filter @alice/frontend-service run build`

## Resultado esperado
- Remocao da faixa vazia abaixo de `Nova Conversa`.
- Retorno dos controles uteis do chat na experiencia padrao.
- Layout do header mais compacto e consistente com o uso diario do workspace de conversa.
