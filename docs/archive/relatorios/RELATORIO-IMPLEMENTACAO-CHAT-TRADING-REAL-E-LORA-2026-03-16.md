# Relatorio de Implementacao - Chat, Trading Real e LoRA

**Author:** Fillipe Guerra  
**Data:** 16 de Marco de 2026

## Contexto
Foi executada uma rodada completa de correcao para resolver seis problemas acoplados entre chat, pagina Trading, pipeline de dados de treinamento, binding de LoRA e runtime operacional de treinamento.

Os sintomas observados eram:
- streaming de Thinking com corte lateral e reaproveitamento visual de linhas antigas;
- respostas superficiais no chat com agente Trading;
- bloqueio indevido por `TRADING_SCOPE_REQUIRED` mesmo com datasets aprovados;
- ausencia de adapter LoRA ativo para Trading;
- requisicoes internas caindo para modelo base por falha de autenticacao entre servicos;
- pipeline auto de Trading sem catalogo de instrumentos e sem universo persistivel.

## Causas raiz confirmadas
- O componente de mensagem do chat usava uma logica circular de tres linhas para Thinking, sobrescrevendo apenas a primeira linha e preservando conteudo antigo nas demais.
- O renderer de Thinking aplicava corte horizontal com `text-ellipsis`, truncando a parte direita do texto.
- O escopo de datasets de Trading considerava apenas `trading_signal`, `trading_order`, `trading_demo` e `trading_postmortem`, ignorando entradas importadas com `source_type=external` mesmo quando o dominio era `trading`.
- O primeiro treinamento de Trading ainda nao havia concluido com sucesso porque os jobs recentes falhavam ao ler `/opt/alice/app/infra/docker/.env.prod` em producao.
- A consulta interna ao endpoint de LoRA ativo enviava apenas `X-Internal-Api-Secret`, sem os headers completos de autenticacao interna usados pelas rotas protegidas.
- O chat com agente Trading nem sempre convertia pedidos contextuais de analise/sinal em execucao real do pipeline de Trading.
- O auto-run de Trading podia iniciar sem catalogo populado em `trading_instruments`, levando a falha por ausencia de simbolos elegiveis para persistencia.

## Correcoes implementadas

### 1. Chat Thinking com reset real de tres linhas
- O calculo de exibicao do Thinking foi refeito para operar por janelas fechadas de tres linhas.
- Ao iniciar uma nova janela, as tres linhas anteriores sao descartadas visualmente e o streaming recomeca limpo.
- O renderer passou a permitir rolagem horizontal leve, eliminando corte no lado direito.

### 2. Classificacao enterprise de datasets de Trading
- Foi criado um SSOT compartilhado para fontes de treinamento de Trading em `packages/shared/src/trading-training.ts`.
- Frontend, integrations-service e training-service passaram a reconhecer como Trading tanto as fontes especializadas quanto imports `external` com namespace/dominio `trading`.
- A pagina Training agora reflete corretamente a existencia de dados aprovados de Trading.

### 3. Binding interno de LoRA entre servicos
- O utilitario compartilhado de roteamento LLM passou a usar os headers completos de autenticacao interna ao consultar `/api/training/lora/active`.
- Isso remove o gap que permitia `401` internos e fallback silencioso para modelo base em fluxos protegidos.

### 4. Robustez operacional do runtime de treinamento
- O `gpu-manager-service` passou a verificar legibilidade do arquivo de environment antes de forcar `--env-file`.
- Quando o arquivo nao esta legivel, o orquestrador cai para um caminho explicito de fallback operacional, em vez de falhar tardiamente.
- Em producao, foi aplicada a correcao cirurgica de permissao para `/opt/alice/app/infra/docker/.env.prod`, restaurando leitura pelo runtime de treinamento.
- O exemplo `infra/docker/.env.prod.example` foi atualizado para documentar a permissao correta.

### 5. Integracao real entre Chat e Trading
- O `chat-service` passou a detectar pedidos contextuais de sinal e analise quando a conversa esta no contexto Trading, mesmo sem comando manual estrito.
- Esses pedidos agora sao convertidos para o pipeline real de Trading, com resposta formatada a partir do payload real retornado pela execucao.
- A resposta final foi enriquecida com contexto, validacoes, consenso, timeframe e resumo operacional quando disponiveis.

### 6. Integridade do pipeline auto de Trading
- O `training-service` passou a sincronizar e garantir o catalogo de `trading_instruments` antes de rodadas auto que dependem de universo elegivel.
- Quando o catalogo estiver vazio, o servico busca simbolos via integracoes internas e faz upsert do inventario inicial.
- O scheduler e a selecao de datasets deixaram de contaminar dados de chat com dados de Trading e vice-versa.

## Arquivos principais impactados
- `apps/frontend-service/src/pages/Chat/components/MessageBubble.tsx`
- `apps/frontend-service/src/pages/Training.tsx`
- `apps/chat-service/src/index.ts`
- `apps/integrations-service/src/index.ts`
- `apps/integrations-service/src/routes/trading-dataset-routes.ts`
- `apps/integrations-service/src/trading-scope-profile-service.ts`
- `apps/integrations-service/src/trading-training-data-scope.ts`
- `apps/training-service/src/index.ts`
- `apps/training-service/src/trading-data-governance.ts`
- `apps/training-service/src/datasets/dataset-selection.ts`
- `apps/training-service/src/auto-learning-scheduler.ts`
- `apps/gpu-manager-service/src/gpu-orchestrator.ts`
- `packages/shared/src/trading-training.ts`
- `packages/shared-utils/src/llm-routing.ts`
- `infra/docker/.env.prod.example`

## Validacoes executadas
- `pnpm --dir packages/shared run typecheck`
- `pnpm --dir packages/shared-utils run typecheck`
- `pnpm --dir apps/frontend-service run typecheck`
- `pnpm --dir apps/integrations-service run typecheck`
- `pnpm --dir apps/chat-service run typecheck`
- `pnpm --dir apps/training-service run typecheck`
- `pnpm --dir apps/gpu-manager-service run typecheck`
- `pnpm --dir packages/shared run lint`
- `pnpm --dir packages/shared-utils run lint`
- `pnpm --dir apps/frontend-service run lint`
- `pnpm --dir apps/integrations-service run lint`
- `pnpm --dir apps/chat-service run lint`
- `pnpm --dir apps/training-service run lint`
- `pnpm --dir apps/gpu-manager-service run lint`
- `pnpm --dir packages/shared run build`
- `pnpm --dir packages/shared-utils run build`
- `pnpm --dir apps/frontend-service run build`
- `pnpm --dir apps/integrations-service run build`
- `pnpm --dir apps/chat-service run build`
- `pnpm --dir apps/training-service run build`
- `pnpm --dir apps/gpu-manager-service run build`

## Testes
- Nao ha `test` script declarado nos workspaces alterados desta rodada.
- A validacao formal desta entrega ficou composta por `typecheck`, `lint` e `build` sequenciais por componente modificado.

## Resultado esperado
- Thinking do chat sem corte lateral e sem mistura de linhas antigas ao reiniciar o bloco de tres linhas.
- Chat com agente Trading utilizando o pipeline real de Trading para pedidos contextuais compatíveis.
- Datasets aprovados importados para Trading reconhecidos corretamente pelo frontend e backend.
- Resolucao de LoRA ativo funcional entre servicos internos.
- Primeiro treinamento de Trading desbloqueado operacionalmente no ambiente de producao.
- Auto-runs de Trading com bootstrap de catalogo de instrumentos quando necessario.

## Atualizacao de CI - 17 de Marco de 2026
- A CI identificou uma regressao nos testes do `gpu-orchestrator` apos o hardening do preflight de leitura do `env-file`.
- Causa raiz: o preflight via `access()` tratava qualquer erro de leitura como motivo para remover `--env-file` antes da execucao do `docker compose`, incluindo cenarios de teste em que o arquivo nao existe localmente.
- Impacto: os testes esperavam a primeira tentativa com `--env-file` e fallback apenas quando o erro real do compose fosse `permission denied`.
- Correcao aplicada: o preflight agora so pula o `--env-file` quando recebe erro de permissao real (`EACCES` ou `EPERM`). Para `ENOENT` ou outros erros, a validacao antecipada e ignorada e o compose continua sendo executado com `--env-file`, preservando o contrato esperado pela FSM e pelos testes.
