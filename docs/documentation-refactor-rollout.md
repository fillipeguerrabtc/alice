# Rollout da Refatoracao Documental

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026
**Status:** Bloco 2 concluido
**Escopo:** SSOT da refatoracao documental e acompanhamento por blocos

## Objetivo

Registrar o estado real da refatoracao documental apos os blocos executados, com taxonomia fisica vigente, rastreabilidade dos movimentos e proximos passos editoriais sem perder historico.

## Nao objetivos desta rodada

- Nao consolidar profundamente os monolitos de treinamento, aprendizado e status.
- Nao reescrever em profundidade documentos normativos grandes alem do necessario para navegacao e consistencia.
- Nao alterar comportamento de produto, pipelines ou workflows fora de ajustes minimos de path documental.

## Execucao consolidada

### Bloco 0 - inventario e taxonomia

- `docs/documentation-refactor-rollout.md` foi criado como SSOT da refatoracao.
- O inventario inicial separou documentos canonicos, temporais, runbooks, relatorios e archive.
- A taxonomia-alvo foi definida editorialmente antes da movimentacao fisica.

### Bloco 1 - topo canonico principal

- `README.md` foi reduzido para onboarding e ponte de navegacao.
- `AGENTS.md` e `CLAUDE.md` foram sincronizados com precedencia, regras permanentes e fechamento obrigatorio.
- `docs/INDEX.md` passou a ser portal de navegacao e precedencia, sem tratar historico como SSOT.

### Bloco 2 - reorganizacao taxonomica e archive temporal

- A estrutura fisica foi reorganizada em `docs/architecture/`, `docs/operations/`, `docs/product/`, `docs/engineering/`, `docs/status/` e `docs/archive/`.
- O espaco canonico deixou de misturar SSOT, runbook, plano, review, relatorio e historico na raiz de `docs/`.
- Runbooks ativos foram movidos para `docs/operations/runbooks/`.
- O dominio trading foi repartido por natureza em arquitetura, produto, operacao e historico.
- Planos, reviews, validacoes, status datados e relatorios por rodada foram movidos para `docs/archive/`.
- Markdown solto da raiz do repositorio foi realocado para `docs/product/`, `docs/architecture/` ou `docs/archive/`.
- `README.md`, `docs/INDEX.md`, `docs/archive/INDEX.md` e referencias internas principais foram atualizados para a nova taxonomia.

## Evidencias usadas neste bloco

- `sed -n '1,240p' AGENTS.md`
- `sed -n '1,260p' CLAUDE.md`
- `sed -n '1,260p' docs/documentation-refactor-rollout.md`
- `find . -maxdepth 2 -type f -name '*.md'`
- `find docs -maxdepth 4 -type d | sort`
- `git status --short`
- `git ls-files '*.md'`
- `rg -n` para caminhos documentais antigos e novas referencias

## Snapshot confirmado apos o Bloco 2

- Total de arquivos Markdown rastreados: `90`
- Arquivos Markdown na raiz do repositorio: `3`
- Arquivos Markdown na raiz de `docs/`: `2`
- Arquivos em `docs/architecture/`: `9`
- Arquivos em `docs/operations/`: `16`
- Arquivos em `docs/product/`: `7`
- Arquivos em `docs/engineering/`: `3`
- Arquivos em `docs/status/`: `2`
- Arquivos em `docs/archive/`: `45`

## Taxonomia vigente

```text
/
├── README.md
├── AGENTS.md
├── CLAUDE.md
└── docs/
    ├── INDEX.md
    ├── documentation-refactor-rollout.md
    ├── architecture/
    │   ├── gpu-manager.md
    │   ├── platform.md
    │   └── trading/
    ├── operations/
    │   ├── deployment.md
    │   ├── getting-started.md
    │   ├── observability.md
    │   ├── permissions.md
    │   ├── secrets.md
    │   ├── runbooks/
    │   ├── trading/
    │   └── training/
    ├── product/
    │   ├── design-guidelines.md
    │   ├── training-business-guide.md
    │   └── trading/
    ├── engineering/
    │   ├── pipeline-overview.md
    │   ├── pull-inteligente-flow.md
    │   └── validation-monorepo.md
    ├── status/
    │   ├── current-platform-status.md
    │   └── roadmap.md
    └── archive/
        ├── INDEX.md
        ├── ops/
        ├── plans/
        ├── relatorios/
        ├── reports/
        │   ├── implementation/
        │   ├── reviews/
        │   ├── status/
        │   └── validation/
        └── root/
```

## Movimentos executados

### Canonicos por trilha

| Origem | Destino atual | Resultado |
| --- | --- | --- |
| `docs/ARQUITETURA.md` | `docs/architecture/platform.md` | arquitetura de plataforma isolada em trilha canonica |
| `docs/ARQUITETURA-GPU-MANAGER.md` | `docs/architecture/gpu-manager.md` | arquitetura especializada mantida como SSOT |
| `docs/DEPLOYMENT.md` | `docs/operations/deployment.md` | operacao de release e deploy retirada da raiz |
| `docs/OBSERVABILITY.md` | `docs/operations/observability.md` | operacao de observabilidade retirada da raiz |
| `docs/GUIA-CONFIGURACAO-INICIAL.md` | `docs/operations/getting-started.md` | onboarding tecnico movido para operacoes |
| `docs/SECRETS.md` | `docs/operations/secrets.md` | seguranca concentrada em operacoes |
| `docs/PERMISSIONS.md` | `docs/operations/permissions.md` | governanca operacional concentrada em operacoes |
| `docs/TRAINING.md` e correlatos | `docs/operations/training/` | SSOTs de treinamento agrupados por tema |
| `docs/VALIDACAO-INCREMENTAL-MONOREPO.md`, `docs/ESTEIRA-ENTERPRISE-2026.md`, `docs/PULL-INTELIGENTE-FLOW.md` | `docs/engineering/` | trilha de engenharia separada do canonico operacional |
| `design_guidelines.md`, `docs/GUIA-TREINAMENTO-AGENTES.md`, `docs/TRADING_PLATFORM_INSTITUTIONAL_V2.md` | `docs/product/` | conteudo de produto retirado da raiz e da raiz de `docs/` |

### Runbooks ativos

| Origem | Destino atual |
| --- | --- |
| `docs/DR-RUNBOOK.md` | `docs/operations/runbooks/dr-game-day.md` |
| `docs/RUNBOOK-CONTAMINACAO-ESCOPO.md` | `docs/operations/runbooks/training-scope-contamination.md` |
| `docs/SLO-BURN-RATE-RUNBOOK.md` | `docs/operations/runbooks/slo-burn-rate-validation.md` |
| `docs/TRAINING-GPU-VALIDATION-RUNBOOK.md` | `docs/operations/runbooks/training-gpu-validation.md` |
| `docs/trading/operacao-testes-trading-v2.md` | `docs/operations/runbooks/trading/operacao-testes.md` |
| `docs/trading/rollout-migration-rollback-trading-v2.md` | `docs/operations/runbooks/trading/migration-rollback.md` |

### Trading reorganizado por natureza

| Natureza | Destino atual |
| --- | --- |
| arquitetura de dominio | `docs/architecture/trading/` |
| produto e UX | `docs/product/trading/` |
| operacao de dominio | `docs/operations/trading/` |
| runbooks de dominio | `docs/operations/runbooks/trading/` |
| plano temporal | `docs/archive/plans/trading-refactor.md` |

### Material temporal e historico arquivado

| Grupo | Destino atual |
| --- | --- |
| trackers e planos enterprise | `docs/archive/plans/` |
| relatorios de implementacao e correcao | `docs/archive/reports/implementation/` |
| reviews e revisoes | `docs/archive/reports/reviews/` |
| validacao | `docs/archive/reports/validation/` |
| snapshots e migracoes datadas | `docs/archive/reports/status/` |
| markdown historico da raiz | `docs/archive/root/` |
| nota operacional datada | `docs/archive/ops/` |
| lote historico legado | `docs/archive/relatorios/` |

## Espaco canonico apos a limpeza

- A raiz do repositorio voltou a conter apenas `README.md`, `AGENTS.md` e `CLAUDE.md`.
- A raiz de `docs/` ficou restrita a `docs/INDEX.md` e `docs/documentation-refactor-rollout.md`.
- Diretorios antigos `docs/trading/` e `docs/ops/` foram eliminados apos a realocacao do conteudo.
- O SSOT vigente agora e encontrado pela combinacao de trilha tematica e precedencia editorial, sem depender de convencoes antigas de nome de arquivo.

## Validacao documental executada

- Conferencia da nova arvore com `find docs -maxdepth 3 -type d | sort`
- Conferencia do inventario de markdowns com `git ls-files '*.md'`
- Varredura de referencias para caminhos antigos com `rg -n`
- Revisao manual de `README.md`, `docs/INDEX.md`, `docs/archive/INDEX.md` e links relativos impactados por movimentacao

## Proximos blocos recomendados

| Bloco | Escopo sugerido | Status inicial |
| --- | --- | --- |
| `3` | consolidar sobreposicoes grandes de treinamento, aprendizado e status sem perder SSOT | nao iniciado |
| `4` | revisar redundancias editoriais residuais e normalizar cabecalhos/metadata | nao iniciado |
| `5` | varredura final de links, headings e referencias historicas de baixa prioridade | nao iniciado |

## Handoff

- Usar `docs/INDEX.md` como portal principal para qualquer bloco seguinte.
- Tratar `docs/status/` como contexto ativo e `docs/archive/` como historico sem precedencia.
- Priorizar no proximo bloco a consolidacao de conteudo sobreposto antes de criar novos SSOTs.
- Evitar reabrir discussao taxonomica: a movimentacao fisica desta rodada e a referencia vigente.
