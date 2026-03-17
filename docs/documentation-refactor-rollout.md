# Rollout da Refatoracao Documental

Author: Fillipe Guerra
Data: 17 de Marco de 2026
Status: Bloco 1 concluido
Escopo: SSOT da refatoracao documental e acompanhamento por blocos

## Objetivo

Estabelecer a fonte unica de verdade da refatoracao documental, com inventario rastreavel dos arquivos Markdown existentes, classificacao por tipo/status/acao proposta e sequenciamento dos proximos blocos sem mover arquivos neste momento.

## Nao objetivos desta rodada

- Nao mover ainda todos os arquivos temporais para `archive`.
- Nao quebrar ainda os grandes monolitos documentais.
- Nao reorganizar ainda todos os subdiretorios.
- Nao alterar comportamento do produto.
- Nao redefinir conteudo tecnico fora da camada documental.

## Execucao consolidada ate aqui

### Bloco 0 - inventario e taxonomia

- `docs/documentation-refactor-rollout.md` foi criado como SSOT da refatoracao.
- O inventario classificou arquivos canonicos, temporais, runbooks, relatorios e archive.
- A taxonomia-alvo foi definida sem movimentacao fisica de arquivos.

### Bloco 1 - topo canonico principal

- `README.md` foi reescrito como porta de entrada curta, com visao geral, quick start, mapa documental e links canonicos principais.
- `AGENTS.md` e `CLAUDE.md` foram reduzidos e sincronizados, com foco em precedencia, regras permanentes e fechamento obrigatorio.
- `docs/INDEX.md` foi reescrito como mapa principal da documentacao, separando claramente raiz canonica, docs tematicas, documentos temporais e archive.
- A precedencia documental deixou de tratar `status`, `roadmap` e trackers temporais como nucleo do SSOT.
- Nao houve movimentacao fisica de arquivos neste bloco.

## Evidencias do repositorio

### Evidencias usadas neste bloco

- `git ls-files '*.md'`
- `find docs -maxdepth 3 -type d | sort`
- leitura de `AGENTS.md`
- leitura de `CLAUDE.md`
- leitura de `README.md`
- leitura de `docs/INDEX.md`
- leitura de `docs/archive/INDEX.md`
- leitura de documentos amostrais das categorias runbook, trading, relatorio e README local

### Snapshot confirmado

- Total de arquivos Markdown rastreados: `89`
- Arquivos Markdown na raiz do repositorio: `6`
- Arquivos Markdown no nivel raiz de `docs/`: `39`
- Arquivos em `docs/trading/`: `14`
- Arquivos em `docs/archive/relatorios/`: `25`
- READMEs locais fora da raiz: `3`
- Subpastas documentais atualmente existentes sob `docs/`: `docs/archive/`, `docs/archive/relatorios/`, `docs/ops/`, `docs/trading/`

### Onde o repositorio coloca cada categoria hoje

| Categoria confirmada | Evidencia no repositorio | Resultado |
| --- | --- | --- |
| Arquivos canonicos declarados hoje | `docs/INDEX.md` lista explicitamente `README.md`, `docs/ARQUITETURA.md`, `docs/STATUS-REAL-ATUAL.md`, `docs/DEPLOYMENT.md`, `docs/OBSERVABILITY.md`, `docs/SECRETS.md`, `docs/PERMISSIONS.md`, `docs/VALIDACAO-INCREMENTAL-MONOREPO.md`, `docs/ESTEIRA-ENTERPRISE-2026.md`, `docs/PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md` e `docs/ROADMAP.md` | O SSOT atual mistura canonicos estaveis com documentos temporais |
| Docs temporais | Padroes `docs/PLANO-*`, `docs/RELATORIO-*`, `docs/REVISAO_*`, `docs/STATUS_*`, `docs/MODULARIZACAO-*`, `docs/MODO-AGENTIC-REFATORACAO.md` | Temporais estao majoritariamente no nivel raiz de `docs/` |
| Relatorios | `docs/RELATORIO-*.md`, `docs/RELATORIO-REVIEW-*.md`, `docs/RELATORIO-VALIDACAO-*.md` e `docs/archive/relatorios/RELATORIO-*.md` | Existem relatorios ativos e relatorios ja arquivados |
| Runbooks | `docs/DR-RUNBOOK.md`, `docs/RUNBOOK-CONTAMINACAO-ESCOPO.md`, `docs/SLO-BURN-RATE-RUNBOOK.md`, `docs/TRAINING-GPU-VALIDATION-RUNBOOK.md` | Runbooks ativos estao soltos na raiz de `docs/` |
| Docs de trading | `docs/trading/*.md` | Dominio trading ja tem pasta propria, mas mistura arquitetura, produto, plano e operacao |
| READMEs locais | `apps/observability-service/README.md`, `assets/branding/README.md`, `infra/observability/grafana/README.md` | READMEs locais ja vivem perto do codigo/asset dono |
| Markdown solto na raiz | `ARCHITECTURE-AUTH-FLOW.md`, `FIXES-TRADING-CRITICAL-ERRORS.md`, `design_guidelines.md` | A raiz ainda contem documentos fora da taxonomia desejada |

## Problema documental confirmado

- A raiz de `docs/` acumula documentos canonicos, temporais, operacionais e historicos no mesmo nivel.
- O SSOT atual em `docs/INDEX.md` ainda trata status, roadmap e plano de execucao como canonicos, embora sejam artefatos temporais por natureza editorial.
- O dominio trading tem pasta dedicada, mas sem separacao interna entre arquitetura, produto, runbook e plano.
- A raiz do repositorio ainda contem Markdown fora dos tres arquivos permanentes esperados (`README.md`, `AGENTS.md`, `CLAUDE.md`).
- Ha sobreposicao tematica especialmente em treinamento/aprendizado e em documentos de status/execucao.

## Taxonomia-alvo

### Estrutura-alvo

```text
/
├── README.md
├── AGENTS.md
├── CLAUDE.md
└── docs/
    ├── INDEX.md
    ├── canonical/
    │   ├── architecture/
    │   ├── operations/
    │   ├── product/
    │   └── domains/
    │       └── trading/
    ├── runbooks/
    ├── plans/
    ├── reports/
    └── archive/
```

### Regras da taxonomia-alvo

- `README.md`, `AGENTS.md` e `CLAUDE.md` permanecem na raiz como excecoes permanentes.
- `docs/INDEX.md` vira apenas o portal de navegacao e precedencia, sem carregar historico ou status detalhado.
- `docs/canonical/` guarda apenas documentos normativos, duraveis e sem carimbo de data no nome.
- `docs/runbooks/` guarda procedimentos operacionais passo a passo, de incidente, validacao e recovery.
- `docs/plans/` guarda planos ativos, roadmaps, rollouts e trackers de execucao.
- `docs/reports/` guarda relatorios de implementacao, validacao, review, status temporal e post-mortems.
- `docs/archive/` guarda conteudo historico fechado, supersedido ou preservado apenas por rastreabilidade.
- READMEs locais permanecem proximos do codigo, do servico ou do asset que descrevem.

## Criterios editoriais

- Um assunto normativo deve ter um unico SSOT.
- Documento canonico nao deve carregar data ou versao no nome do arquivo.
- Documento temporal deve explicitar natureza temporal no nome ou na pasta de destino.
- Documento de relatorio nao deve ocupar espaco canonico.
- Documento de runbook deve ser procedural, acionavel e orientado a evidencia operacional.
- Documento de plano deve registrar intencao, fases, status e handoff; nao substituir o SSOT tecnico.
- Documento local deve existir perto do artefato quando serve apenas a um servico, pasta ou asset especifico.
- A raiz do repositorio nao deve receber Markdown adicional fora de onboarding e governanca de agentes.
- Conteudos sobrepostos devem ser consolidados antes de serem promovidos como SSOT.
- `docs/INDEX.md` deve apontar para documentos finais por categoria, nunca servir como deposito de excecoes.

## Inventario consolidado

### Resumo por grupo atual

| Grupo atual | Qtde | Tipo dominante | Status inicial | Acao proposta |
| --- | ---: | --- | --- | --- |
| Raiz obrigatoria (`README.md`, `AGENTS.md`, `CLAUDE.md`) | 3 | onboarding e governanca | vigente | manter na raiz |
| Markdown solto na raiz | 3 | relatorio pontual e design guide | fora da taxonomia | realocar para `docs/canonical/` ou `docs/reports/` conforme o caso |
| `docs/` raiz com conteudo ativo | 39 | mistura de canonical, plano, relatorio, status e runbook | misto | separar por taxonomia-alvo |
| `docs/trading/` | 14 | dominio trading misturado | ativo, mas heterogeneo | separar por arquitetura, produto, runbook e plano |
| `docs/ops/` | 1 | nota operacional/implementacao | temporal | mover para `docs/reports/` ou absorver em canonical depois da consolidacao |
| READMEs locais | 3 | documentacao local | vigente | manter junto do dono |
| `docs/archive/` | 26 | historico arquivado | arquivado | manter em archive |

### Raiz do repositorio

| Arquivo | Tipo | Status | Acao proposta |
| --- | --- | --- | --- |
| `AGENTS.md` | governanca operacional para agentes | vigente | manter na raiz |
| `CLAUDE.md` | SSOT de regras de engenharia e operacao para agentes | vigente | manter na raiz |
| `README.md` | onboarding e visao geral | vigente | manter na raiz e reduzir a ponte para `docs/INDEX.md` |
| `ARCHITECTURE-AUTH-FLOW.md` | relatorio tecnico pontual de correcao | fora da taxonomia | mover para `docs/reports/implementation/` ou `docs/archive/` apos validar relevancia ativa |
| `FIXES-TRADING-CRITICAL-ERRORS.md` | relatorio de correcao pontual | fora da taxonomia | mover para `docs/reports/implementation/` ou `docs/archive/` apos validar relevancia ativa |
| `design_guidelines.md` | guia de design do produto | ativo fora da taxonomia | mover para `docs/canonical/product/design-guidelines.md` |

### `docs/` raiz - portal, canonical e operacao

| Arquivo | Tipo | Status | Acao proposta |
| --- | --- | --- | --- |
| `docs/INDEX.md` | portal de precedencia documental | vigente | manter em `docs/INDEX.md` e enxugar para apontar apenas para a taxonomia final |
| `docs/ARQUITETURA.md` | arquitetura de plataforma | canonico vigente | mover para `docs/canonical/architecture/platform.md` |
| `docs/ARQUITETURA-GPU-MANAGER.md` | arquitetura especializada de GPU | canonico vigente | mover para `docs/canonical/architecture/gpu-manager.md` |
| `docs/DEPLOYMENT.md` | operacao de deploy e release | canonico vigente | mover para `docs/canonical/operations/deployment.md` |
| `docs/OBSERVABILITY.md` | operacao e stack de observabilidade | canonico vigente | mover para `docs/canonical/operations/observability.md` |
| `docs/SECRETS.md` | governanca de secrets | canonico vigente | mover para `docs/canonical/operations/secrets.md` |
| `docs/PERMISSIONS.md` | governanca de permissoes | canonico vigente | mover para `docs/canonical/operations/permissions.md` |
| `docs/GUIA-CONFIGURACAO-INICIAL.md` | onboarding tecnico inicial | canonico vigente | mover para `docs/canonical/operations/getting-started.md` |
| `docs/VALIDACAO-INCREMENTAL-MONOREPO.md` | fluxo de validacao/local gates | canonico vigente | mover para `docs/canonical/operations/validation-monorepo.md` |
| `docs/ESTEIRA-ENTERPRISE-2026.md` | esteira de engenharia/release | ativo com nome temporal | mover para `docs/canonical/operations/engineering-pipeline.md` |
| `docs/GUIA-TREINAMENTO-AGENTES.md` | guia de negocio para treinamento | canonico de produto | mover para `docs/canonical/product/training-business-guide.md` |
| `docs/TRADING_PLATFORM_INSTITUTIONAL_V2.md` | visao de produto do dominio trading | ativo com nome versionado | mover para `docs/canonical/domains/trading/platform.md` |
| `docs/TRAINING.md` | SSOT tecnico de treinamento | vigente com sobreposicao | consolidar em `docs/canonical/operations/training/overview.md` |
| `docs/SISTEMA-APRENDIZADO.md` | visao ampla de aprendizado | vigente com forte sobreposicao | consolidar com `docs/TRAINING.md` e reclassificar depois da reducao de duplicidade |
| `docs/TRAINING-AUTO-COLLECT-GOVERNANCE.md` | politica/governanca de auto-collect | canonico de operacao | mover para `docs/canonical/operations/training/auto-collect-governance.md` |
| `docs/TREINAMENTO-LIMITES-E-BOAS-PRATICAS.md` | referencia de limites/configuracoes | vigente com sobreposicao | consolidar em `docs/canonical/operations/training/reference-limits.md` |
| `docs/PULL-INTELIGENTE-FLOW.md` | detalhe de engenharia de deploy | ativo fora da taxonomia | mover para `docs/canonical/operations/deployment/pull-inteligente.md` |
| `docs/STATUS-REAL-ATUAL.md` | snapshot operacional | temporal ativo, embora hoje listado como canonico | mover para `docs/reports/status/current-platform-status.md` |
| `docs/ROADMAP.md` | roadmap de evolucao | temporal ativo, embora hoje listado como canonico | mover para `docs/plans/roadmap.md` |
| `docs/MODO-AGENTIC-REFATORACAO.md` | relatorio de implementacao | temporal fora da taxonomia | mover para `docs/reports/implementation/agentic-page-refactor-2026-02-27.md` |

### `docs/` raiz - planos, relatorios, revisoes e status temporais

| Arquivo | Tipo | Status | Acao proposta |
| --- | --- | --- | --- |
| `docs/PLANO-DE-CORRECOES-ENTERPRISE.md` | plano | temporal ativo | mover para `docs/plans/enterprise-corrections.md` |
| `docs/PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md` | tracker de execucao | temporal ativo | mover para `docs/plans/execution/codex-enterprise.md` |
| `docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md` | plano por blocos | temporal ativo | mover para `docs/plans/execution/enterprise-blocks.md` |
| `docs/MODULARIZACAO-SHARED-CHAT-3-2026-03-17.md` | relatorio de implementacao/refactor | temporal ativo | mover para `docs/reports/implementation/modularizacao-shared-chat-3-2026-03-17.md` |
| `docs/RELATORIO-CORRECAO-CHAT-LAYOUT-CONTROLES-2026-03-16.md` | relatorio de correcao | temporal ativo | mover para `docs/reports/implementation/` |
| `docs/RELATORIO-CORRECAO-CHAT-ROTEAMENTO-BRANCO-2026-03-13.md` | relatorio de correcao | temporal ativo | mover para `docs/reports/implementation/` |
| `docs/RELATORIO-CORRECAO-CHAT-STREAM-FALLBACK-DESAPARECIMENTO-2026-03-12.md` | relatorio de correcao | temporal ativo | mover para `docs/reports/implementation/` |
| `docs/RELATORIO-CORRECAO-CI-TRADING-FRONTEND-2026-03-15.md` | relatorio de correcao | temporal ativo | mover para `docs/reports/implementation/` |
| `docs/RELATORIO-CORRECAO-DEPLOY-ALICE-CONTAINER-CONFLICT-2026-03-13.md` | relatorio de correcao | temporal ativo | mover para `docs/reports/implementation/` |
| `docs/RELATORIO-CORRECAO-RELEASE-GOVERNANCA-2026-03-15.md` | relatorio de correcao | temporal ativo | mover para `docs/reports/implementation/` |
| `docs/RELATORIO-REDUCAO-MONOLITOS-SERVICOS-2026-03-17-CHAT4.md` | relatorio de refatoracao | temporal ativo | mover para `docs/reports/implementation/` |
| `docs/RELATORIO-REVIEW-CHAT-ENTERPRISE-2026-03-12.md` | relatorio de review | temporal ativo | mover para `docs/reports/reviews/` |
| `docs/RELATORIO-VALIDACAO-MONOREPO-INCREMENTAL-2026-03-15.md` | relatorio de validacao | temporal ativo | mover para `docs/reports/validation/` |
| `docs/REVISAO_CHAT_ENTERPRISE_2026-03-15.md` | revisao tecnica | temporal ativo | mover para `docs/reports/reviews/` |
| `docs/STATUS_QWEN3_8B_MIGRATION.md` | status de migracao | temporal ativo | mover para `docs/reports/status/qwen3-8b-migration.md` |

### Runbooks ativos soltos na raiz de `docs/`

| Arquivo | Tipo | Status | Acao proposta |
| --- | --- | --- | --- |
| `docs/DR-RUNBOOK.md` | runbook de DR | vigente | mover para `docs/runbooks/dr-game-day.md` |
| `docs/RUNBOOK-CONTAMINACAO-ESCOPO.md` | runbook de incidente | vigente | mover para `docs/runbooks/training-scope-contamination.md` |
| `docs/SLO-BURN-RATE-RUNBOOK.md` | runbook de validacao SLO | vigente | mover para `docs/runbooks/slo-burn-rate-validation.md` |
| `docs/TRAINING-GPU-VALIDATION-RUNBOOK.md` | runbook de validacao GPU | vigente | mover para `docs/runbooks/training-gpu-validation.md` |

### Dominio trading em `docs/trading/`

| Arquivo | Tipo | Status | Acao proposta |
| --- | --- | --- | --- |
| `docs/trading/ai-signals-cockpit-v2.md` | especificacao de produto/UX | ativo com nome versionado | mover para `docs/canonical/domains/trading/product/ai-signals-cockpit.md` |
| `docs/trading/arquitetura-compatibilidade-trading-v2.md` | arquitetura de dominio | ativo com nome versionado | mover para `docs/canonical/domains/trading/architecture/compatibility.md` |
| `docs/trading/auto-engine-contracts-observability.md` | contratos e observabilidade | canonico de dominio | mover para `docs/canonical/domains/trading/architecture/auto-engine-observability-contracts.md` |
| `docs/trading/auto-engine-state-model.md` | modelo de estados | canonico de dominio | mover para `docs/canonical/domains/trading/architecture/auto-engine-state-model.md` |
| `docs/trading/convergencia-demo-workspace-v2.md` | especificacao de produto/workspace | ativo com nome versionado | mover para `docs/canonical/domains/trading/product/demo-workspace-convergence.md` |
| `docs/trading/demo-isolation-guarantees.md` | garantia arquitetural/politica operacional | canonico de dominio | mover para `docs/canonical/domains/trading/architecture/demo-isolation-guarantees.md` |
| `docs/trading/domain-map-trading.md` | mapa de dominio | canonico de dominio | mover para `docs/canonical/domains/trading/domain-map.md` |
| `docs/trading/operacao-testes-trading-v2.md` | runbook operacional | ativo com nome versionado | mover para `docs/runbooks/trading/operacao-testes.md` |
| `docs/trading/plano-refatoracao-trading.md` | plano | temporal ativo | mover para `docs/plans/trading/refatoracao.md` |
| `docs/trading/rollout-migration-rollback-trading-v2.md` | rollout/runbook | ativo com nome versionado | mover para `docs/runbooks/trading/rollout-migration-rollback.md` |
| `docs/trading/signal-engine-pipeline.md` | arquitetura/pipeline | canonico de dominio | mover para `docs/canonical/domains/trading/architecture/signal-engine-pipeline.md` |
| `docs/trading/strategy-specialists-data-requirements.md` | requisitos de dados | canonico de produto/dominio | mover para `docs/canonical/domains/trading/product/strategy-specialists-data-requirements.md` |
| `docs/trading/training-calibration-promotion-path.md` | processo operacional de dominio | ativo | mover para `docs/canonical/domains/trading/operations/training-calibration-promotion-path.md` |
| `docs/trading/workspace-shell-v2.md` | especificacao de produto/UX | ativo com nome versionado | mover para `docs/canonical/domains/trading/product/workspace-shell.md` |

### `docs/ops/` e READMEs locais

| Arquivo | Tipo | Status | Acao proposta |
| --- | --- | --- | --- |
| `docs/ops/rag-doc-processing.md` | relatorio operacional/implementacao | temporal ativo | mover para `docs/reports/implementation/rag-doc-processing-2026-03-01.md` ou consolidar em canonical de RAG se o conteudo ainda for normativo |
| `apps/observability-service/README.md` | README local de servico | vigente | manter proximo ao servico |
| `assets/branding/README.md` | README local de asset SSOT | vigente | manter proximo ao asset |
| `infra/observability/grafana/README.md` | README local de integracao/infra | vigente | manter proximo a infraestrutura |

### Conteudo ja arquivado

| Arquivo ou grupo | Tipo | Status | Acao proposta |
| --- | --- | --- | --- |
| `docs/archive/INDEX.md` | indice de historico | arquivado vigente | manter em `docs/archive/INDEX.md` |
| `docs/archive/relatorios/RELATORIO-*.md` | relatorios historicos | arquivado | manter em `docs/archive/relatorios/` |

## Blocos de execucao

| Bloco | Escopo | Saida esperada | Status inicial |
| --- | --- | --- | --- |
| `0` | SSOT da refatoracao e inventario classificado | `docs/documentation-refactor-rollout.md` criado e validado | concluido |
| `1` | Reescrita do topo canonico principal | `README.md`, `AGENTS.md`, `CLAUDE.md` e `docs/INDEX.md` reescritos; precedencia documental corrigida | concluido |
| `2` | Separacao fisica de canonical estavel | documentos normativos movidos para `docs/canonical/` com links atualizados | nao iniciado |
| `3` | Separacao fisica de runbooks | runbooks movidos para `docs/runbooks/` e indexados | nao iniciado |
| `4` | Isolamento de planos, roadmaps, status e trackers | temporais movidos para `docs/plans/` | nao iniciado |
| `5` | Isolamento de relatorios, reviews e validacoes | relatorios ativos movidos para `docs/reports/` | nao iniciado |
| `6` | Normalizacao do dominio trading | trading separado internamente por arquitetura, produto, operacao e plano | nao iniciado |
| `7` | Varredura final de archive, redundancia e links | historico fechado em `docs/archive/`, links resolvidos e lixo removido | nao iniciado |

## Handoff para o proximo bloco

- Criar a estrutura fisica da taxonomia-alvo sem reabrir a discussao editorial do topo canonico.
- Mover primeiro os casos sem controversia editorial: runbooks ativos, planos claramente temporais, relatorios claramente temporais e Markdown solto da raiz.
- Tratar a classificacao definida em `docs/INDEX.md` como regra de navegacao durante a transicao fisica.
- Deixar consolidacao de conteudo sobreposto de treinamento/aprendizado para bloco proprio, sem inventar novo texto no mesmo passo dos movimentos.
- Preservar READMEs locais junto de seus respectivos donos e apenas indexa-los quando agregarem navegacao.

## Validacao deste bloco

### Consistencia documental

- `rg '^#' README.md AGENTS.md CLAUDE.md docs/INDEX.md docs/documentation-refactor-rollout.md`: `OK`
- Validacao automatizada de links Markdown locais nos 5 arquivos alterados: `OK`
- Resultado da validacao de links locais: `74` referencias verificadas, `0` quebradas
- `git diff --check`: `OK` apos normalizacao do metadata sem trailing whitespace

### Gates sequenciais obrigatorios

| Gate | Resultado | Observacao |
| --- | --- | --- |
| `pnpm typecheck` | OK | runner escopado selecionou `15` workspaces por tratar docs da raiz como caminho nao classificado com seguranca |
| `pnpm test` | OK | `140` arquivos de teste e `1433` testes passaram; duracao total `513.27s` |
| `pnpm lint` | OK | runner escopado selecionou `15` workspaces sem warnings reportados |
| `pnpm build` | OK | runner escopado selecionou `15` workspaces e concluiu build sem erros |

## Checklist de saida deste bloco

- [x] `README.md` reescrito como porta de entrada enxuta
- [x] `AGENTS.md` refatorado como guia curto e sincronizado
- [x] `CLAUDE.md` refatorado como SSOT curto e duravel
- [x] `docs/INDEX.md` reescrito como mapa principal e regra de precedencia
- [x] Precedencia entre canonicos, docs tematicas, temporais e archive corrigida
- [x] Rollout atualizado com status e handoff do bloco 1
- [x] Links, headings e coerencia editorial validados
- [x] Validacoes sequenciais finais executadas
- [x] Commit consolidado em ingles realizado
