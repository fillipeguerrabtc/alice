# Revisao Chat Enterprise 2026-03-15

**Author:** Fillipe Guerra  
**Data:** 15 de Marco de 2026

## Objetivo

Consolidar a investigacao end-to-end do chat da Alice, incluindo:

- comportamento anomalo de streaming com fallback para resposta "nao confiavel";
- validacao operacional do modelo `Qwen3-8B`;
- revisao de UX para padrao enterprise inspirado em produtos como ChatGPT e Claude;
- gaps de DX/CI relacionados a lentidao de `typecheck`, `lint` e `build`.

## Escopo revisado

- Backend do chat
- Frontend do chat
- Pipeline de streaming SSE
- Guardrails de resposta
- Runtime do LLM `Qwen3-8B`
- Nomenclatura e referencias legadas de `Qwen2.5`
- Fluxo de validacao local do monorepo

## Evidencias confirmadas

### 1. Qwen3-8B estava rodando em producao

A verificacao operacional confirmou que o serving real estava apontando para `Qwen/Qwen3-8B-AWQ`, mesmo com imagem/container ainda carregando nomenclatura legada em alguns pontos de deploy.

Conclusao:

- o modelo novo estava ativo;
- havia sujeira de naming herdada (`qwen25`) em partes do codigo e infraestrutura versionada;
- a compatibilidade legada precisava ser mantida apenas para leitura historica, nao para UX.

### 2. A falha do chat nao era quebra do streaming do LLM

Os logs mostraram que:

- o stream iniciava normalmente;
- havia texto valido sendo gerado;
- o backend classificava a resposta como degenerada/corrompida no pos-processamento;
- ao final, o fallback seguro substituia a resposta parcial por "Nao consegui gerar uma resposta confiavel...".

Conclusao:

- a causa raiz principal estava no guardrail do chat-service;
- o frontend apenas refletia o estado final enviado pelo backend.

### 3. O heuristico de corrupcao estava agressivo para respostas numericas

A heuristica `fragmented_tokens` marcava respostas financeiras legitimas como corrompidas por excesso de fragmentacao numerica curta.

Exemplo afetado:

- cotacao de Bitcoin com `US$`, percentuais, numeros com milhares/decimais e capitalizacao de mercado.

Conclusao:

- o modelo estava respondendo corretamente;
- o guardrail estava gerando falso positivo.

### 4. Havia risco secundario em perfis legados de namespace

Foi identificado caminho com potencial de excecao em configuracoes legadas/parciais de `autoCollect`, causando leitura insegura de `enabled` em objetos incompletos.

Conclusao:

- o sistema precisava normalizar configuracoes legadas antes do uso em runtime;
- isso nao explica o print principal, mas era um risco real de robustez.

### 5. A UX do chat estava poluida para uso enterprise

Foram identificados sinais de excesso visual:

- barra de workspaces com cinco botoes simultaneos;
- controles de governanca e operacao expostos no topo mesmo fora do contexto;
- botoes de selecao e exclusao sempre visiveis na lista lateral;
- estados auxiliares/hints competindo com a conversa.

Conclusao:

- a UI estava mais proxima de um console interno do que de uma experiencia "conversation first";
- isso aumenta ruido cognitivo e reduz percepcao de confianca.

## Correcoes aplicadas nesta rodada

### Backend

- Ajuste cirurgico da heuristica de corrupcao para nao suprimir respostas financeiras legitimas.
- Inclusao de teste unitario cobrindo resposta valida de cotacao de Bitcoin.
- Normalizacao segura de `autoCollect` em `namespace-profiles` para perfis legados/parciais.
- Inclusao de teste unitario para runtime legado de namespace profile.
- Ajuste de labels user-facing para nao exibir `Qwen2.5` ao usuario final.

### Frontend

- Workspace inicial alterado para `conversation`, reduzindo poluicao no topo.
- Controles de governanca/operacao/diagnostico restritos ao workspace correto.
- Hint visual da area conversacional removido.
- Barra de workspaces refatorada para seletor compacto.
- Acoes de selecao/exclusao em lista lateral movidas para menu mais discreto.
- Acao de exclusao por conversa escondida ate hover/focus.
- Hook legado de streaming atualizado para normalizar `sources` como o fluxo novo do chat.

### Naming e limpeza de Qwen

- Renomeacao versionada de `docker/gpu/llm-qwen25` para `docker/gpu/llm-qwen3`.
- Atualizacao de referencias ativas em compose, workflows, docs, dashboards e codigo.
- Compatibilidade legada preservada apenas nos aliases internos necessarios para leitura historica.

## Resultado tecnico desta rodada

Validacoes executadas em sequencia:

1. `pnpm typecheck`
2. `pnpm test`
3. `pnpm lint`
4. `pnpm build`

Resultado:

- tudo aprovado apos correcao da sintaxe final em um novo teste unitario;
- sem erros restantes nas validacoes obrigatorias da rodada.

## Leitura de produto e UX enterprise

Baseado em documentacao oficial recente de OpenAI e Anthropic, a direcao correta para a Alice e:

- priorizar a conversa como elemento central da tela;
- esconder controles avancados por padrao e exibi-los somente quando agregam valor contextual;
- preservar streaming confiavel sem substituir progresso valido por mensagens confusas;
- tornar fontes/citacoes claras, estruturadas e confiaveis;
- tratar estado, contexto e reasoning como capacidades do sistema, nao como ruida visual para o usuario comum.

## Gaps ainda existentes

### Produto/UX

- O chat ainda mistura experiencia conversacional com console operacional em alguns estados.
- Faltam hierarquias mais fortes entre "conversa primaria" e "controles avancados".
- Falta desenho sistematico para estados de regeneracao, falha parcial, fontes e confianca.

### Backend/LLM

- O guardrail ainda precisa de bateria maior de casos reais para evitar novos falsos positivos.
- Falta observabilidade dedicada para classificar: resposta valida, resposta regenerada, fallback seguro e motivo do fallback.
- O pipeline de streaming pode evoluir para registrar e comparar melhor resposta parcial vs resposta final.

### Monorepo / DX / CI

- `typecheck` no root percorre quase todo o monorepo.
- `lint` no root usa `eslint .`, varrendo tudo.
- `build` no root recompila todos os workspaces.
- O cache incremental do TypeScript fica dentro de `node_modules`, o que aumenta invalidações apos reinstalacoes.
- Existe `turbo.json`, mas os scripts principais nao usam `turbo run`.

## Recomendacoes objetivas para proximas rodadas

### Bloco 1 - Estabilizacao do chat

- ampliar testes do guardrail com corpus real de respostas financeiras, web, RAG e multimodal;
- instrumentar metricas de fallback por motivo;
- separar fallback de seguranca real de falso positivo heuristico.

### Bloco 2 - UX enterprise do chat

- manter layout "conversation first";
- mover controles avancados para drawer/painel contextual;
- padronizar estados de streaming, regeneracao, sources e erro;
- revisar composer, header, sidebar e bubble actions com foco em limpeza visual.

### Bloco 3 - Governanca de modelos

- expor apenas `Qwen3` para UX e admin comum;
- manter aliases legados somente na camada de compatibilidade;
- consolidar SSOT de modelos para frontend, backend e deploy.

### Bloco 4 - DX/CI sem hack

- trocar scripts globais por execucao orientada a workspace alterado quando apropriado;
- mover cache `tsbuildinfo` para fora de `node_modules`;
- usar `turbo run typecheck|lint|build` com cache local consistente;
- manter job full em CI principal e job incremental em PR/rodada local;
- preservar gates de qualidade, sem remover verificacoes.

## Proposta concreta de DX/CI

### Curto prazo

- introduzir scripts paralelos ao fluxo atual:
  - `typecheck:changed`
  - `lint:changed`
  - `build:changed`
- manter `typecheck`, `lint` e `build` full como gate oficial.

### Medio prazo

- migrar scripts principais para Turbo:
  - `turbo run typecheck`
  - `turbo run lint`
  - `turbo run build`
- definir inputs/outputs mais precisos por workspace.

### Longo prazo

- separar pipeline em dois niveis:
  - validacao incremental por mudanca;
  - validacao full em merge/release/deploy.

## Conclusao

O comportamento estranho do chat nao indicava falha do `Qwen3-8B`, e sim falso positivo de guardrail somado a uma UX que comunicava mal o estado final. A rodada corrigiu a causa raiz mais evidente, limpou a experiencia do chat, removeu sujeira de nomenclatura visivel do modelo e consolidou uma trilha clara para evolucao enterprise do produto e da engenharia.
