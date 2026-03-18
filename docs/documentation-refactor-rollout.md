# Rollout da Refatoracao Documental

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026
**Status:** concluido
**Tipo:** rollout

## Objetivo

Registrar o estado real da refatoracao documental apos os blocos executados, com taxonomia fisica vigente, rastreabilidade dos movimentos e proximos passos editoriais sem perder historico.

## Nao objetivos desta rodada

- Nao alterar comportamento de produto, pipelines ou workflows.
- Nao duplicar governanca geral de validacao, release, deploy ou observability dentro do dominio Trading.
- Nao transformar a documentacao de Trading em backlog operacional ou historico por rodada.

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

### Bloco 3 - arquitetura, operacoes, deploy e observabilidade

- Monolitos remanescentes de arquitetura, operacoes e esteira foram reduzidos para overviews objetivos.
- A trilha operacional passou a separar explicitamente `deployment`, `release`, `deploy`, `observability`, `permissions`, `secrets` e `runbooks`.
- A trilha de engenharia passou a separar `pipeline overview`, `validacao incremental` e `smart pull`.
- A documentacao canonica agora reflete o comportamento real da esteira:
  - `CI` valida
  - `Release` publica
  - `Deploy` implanta
  - `Release` nao repete o gate do `CI`
  - `Release` exige `CI` previo bem-sucedido
  - `docs-only` e `pipeline-only` nao seguem para `Release` ou `Deploy`
  - `built_images` e `images-manifest.json` governam smart pull e retag local no deploy
- O runbook ativo passou a ficar concentrado em `docs/operations/runbooks/INDEX.md`, sem infiltrar checklist operacional dentro dos SSOTs conceituais.

### Bloco 4 - training, aprendizado, onboarding e status

- A trilha `docs/operations/training/` foi reduzida a quatro documentos com papeis explicitos:
  - `overview.md` como porta de entrada e snapshot
  - `learning-system.md` como modelo de aprendizado
  - `reference-limits.md` como SSOT de limites e configuracoes
  - `auto-collect-governance.md` como SSOT de governanca de coleta automatica
- O runbook `docs/operations/runbooks/training-gpu-validation.md` deixou de carregar historico de incidentes por data e passou a manter somente execucao, criterios de sucesso e troubleshooting ativo.
- `docs/operations/getting-started.md` foi refeito como onboarding tecnico curto, orientado a uso real e navegacao do SSOT.
- `docs/product/training-business-guide.md` foi reduzido a um guia de negocio focado em quando usar `RAG` versus `Training`.
- `docs/status/current-platform-status.md` virou snapshot curto do estado atual da plataforma.
- `docs/archive/reports/status/qwen3-8b-migration.md` permaneceu em `archive`, mas foi resumido para historico consolidado, sem tracking cumulativo de rodadas.
- A separacao entre overview, governanca, runbook e historico passou a ficar explicita tambem na trilha de treinamento.

### Bloco 5 - namespace e precedencia do dominio Trading

- O dominio Trading ganhou um namespace dedicado em `docs/trading/`, com indice proprio e precedencia explicita.
- Os SSOTs do dominio passaram a ficar agrupados por natureza dentro do proprio namespace:
  - `docs/trading/architecture/`
  - `docs/trading/product/`
  - `docs/trading/operations/`
  - `docs/trading/runbooks/`
- Documentos que ainda estavam com linguagem de rodada, rollout ou fechamento foram reescritos para refletir somente o estado vigente do produto.
- `docs/TRADING_PLATFORM_INSTITUTIONAL_V2.md` permaneceu absorvido como documento canonico em `docs/trading/product/platform-institutional.md`.
- `FIXES-TRADING-CRITICAL-ERRORS.md` permaneceu corretamente rebaixado para historico em `docs/archive/root/trading-critical-errors-2026-02-16.md`.
- Referencias a `validacao`, `release`, `deploy` e `research/lab` foram revisadas para apontar para SSOTs gerais ou para o estado real da workspace atual, sem contradizer a esteira vigente.

### Bloco 6 - READMEs locais e docs de subsistema

- `apps/observability-service/README.md` deixou de repetir arquitetura global, deploy e inventario completo da plataforma, passando a documentar somente API local, compose local, arquivos da pasta e links para os SSOTs corretos.
- `assets/branding/README.md` passou a cobrir somente assets raster, fluxo real do script de atualizacao e limites locais, sem redefinir guidelines globais de design.
- `infra/observability/grafana/README.md` foi reduzido a configuracao local de provisioning e compose isolado, com referencia explicita para o compose oficial da stack e para os SSOTs globais de observabilidade e deploy.
- As referencias locais a pipeline, arquitetura, SSO e deploy foram revisadas para apontar para fontes ativas do repositorio, evitando duplicacao editorial e drift com o estado atual do projeto.

### Bloco 7 - padronizacao editorial global

- A metadata minima dos documentos ativos foi normalizada com `Author`, `Atualizado`, `Status` e `Tipo`, incluindo raiz do repositorio, SSOTs em `docs/` e READMEs locais de subsistema.
- Os tipos documentais passaram a distinguir explicitamente `governanca`, `onboarding`, `indice`, `ssot`, `runbook`, `status`, `roadmap`, `rollout` e `readme local`.
- Links residuais para diretorios foram substituidos por referencias a documentos canonicos concretos, como `docs/archive/INDEX.md` e `docs/operations/training/overview.md`.
- Titulos e headings herdados do padrao anterior foram alinhados ao papel vigente de cada arquivo, com ajuste pontual em onboarding, roadmap, design e overviews tecnicos.
- A revisao final confirmou consistencia editorial da documentacao ativa sem reabrir monolitos ja estabilizados nem mover arquivos sem necessidade.

### Bloco 8 - fechamento, auditoria final e hardening documental

- A arvore final de documentacao foi revisada como sistema unico, com conferencia de raiz, canonicos, docs tematicas, namespace de Trading e archive.
- `README.md` foi confirmado como onboarding curto e util, sem assumir papel de SSOT tecnico.
- `AGENTS.md` e `CLAUDE.md` foram validados como documentos canonicos sincronizados em precedencia, regras permanentes e politica de validacao por escopo.
- `docs/INDEX.md` foi confirmado como mapa principal de navegacao e classificacao editorial.
- `docs/archive/INDEX.md` foi endurecido com metadata minima completa, mantendo o archive explicitamente fora do espaco canonico.
- A auditoria final confirmou que material temporal continua fora das trilhas canonicas e que `docs/status/` permanece restrito a contexto ativo.
- A documentacao de pipeline e validacao foi conferida contra `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `.github/workflows/deploy-stack-modular.yml`, `scripts/workspace-scope.mjs`, `scripts/release-functions.sh` e `infra/scripts/deploy-functions.sh`.
- O fechamento confirmou alinhamento explicito de comportamento atual:
  - `CI` valida qualidade
  - `Release` publica artefatos aprovados sem repetir o gate do `CI`
  - `Deploy` implanta artefatos publicados
  - `docs-only` e `pipeline-only` nao seguem automaticamente para `Release` ou `Deploy`
  - `built_images` e `images-manifest.json` seguem como contrato entre `Release` e `Deploy`
- Links relativos, headings e metadata dos documentos ativos foram revalidados por auditoria automatizada antes do encerramento.

## Evidencias usadas neste bloco

- `sed -n '1,240p' AGENTS.md`
- `sed -n '1,260p' CLAUDE.md`
- `sed -n '1,260p' docs/documentation-refactor-rollout.md`
- `sed -n '261,520p' docs/documentation-refactor-rollout.md`
- `find . -maxdepth 2 -type f -name '*.md'`
- `find docs -maxdepth 4 -type d | sort`
- `git status --short`
- `git ls-files '*.md'`
- `rg -n` para caminhos documentais antigos e novas referencias
- `sed -n '1,320p' docs/operations/deployment.md`
- `sed -n '1,320p' docs/engineering/pipeline-overview.md`
- `sed -n '1,360p' .github/workflows/release.yml`
- `sed -n '1,420p' .github/workflows/deploy-stack-modular.yml`
- `sed -n '1,320p' scripts/workspace-scope.mjs`
- `sed -n '1,320p' scripts/release-functions.sh`
- `sed -n '1,360p' infra/scripts/deploy-functions.sh`
- `sed -n '1,260p' infra/scripts/permissions-config.sh`
- validacao de links relativos via `node`
- validacao de headings via `node`
- `sed -n '1,260p' docs/operations/training/overview.md`
- `sed -n '1,260p' docs/operations/training/learning-system.md`
- `sed -n '1,260p' docs/operations/training/reference-limits.md`
- `sed -n '1,260p' docs/operations/training/auto-collect-governance.md`
- `sed -n '1,260p' docs/operations/getting-started.md`
- `sed -n '1,220p' docs/product/training-business-guide.md`
- `sed -n '1,260p' docs/status/current-platform-status.md`
- `sed -n '1,220p' docs/archive/reports/status/qwen3-8b-migration.md`
- `rg -n` em `apps/`, `packages/`, `infra/` e `docs/` para confirmar defaults de training, filas, reasoning mode, rotas canonicas e pipeline
- `find docs/trading -maxdepth 3 -type f | sort`
- `sed -n '1,260p' docs/archive/plans/trading-refactor.md`
- `sed -n '1,260p' docs/archive/root/trading-critical-errors-2026-02-16.md`
- `sed -n '1,220p' apps/frontend-service/src/components/trading-v2/workspace-rollout-adapter.ts`
- `sed -n '1,260p' apps/integrations-service/src/routes/trading-signal-promotion-routes.ts`
- `sed -n '1,200p' apps/integrations-service/src/routes/trading-websocket-routes.ts`
- `rg -n` em `apps/frontend-service/`, `apps/integrations-service/`, `apps/training-service/` e `packages/` para confirmar flag canonica, rotas de Trading, promotion path, handoff demo e capability matrix
- `git ls-files '*.md' | grep -v '^docs/archive/' | sort`
- auditoria de metadata, H1 e tipos documentais via `node`
- validacao automatizada de links relativos e links para diretorio residual via `node`
- validacao automatizada de hierarquia de headings via `node`
- `sed -n` em `docs/product/design-guidelines.md`, `docs/status/roadmap.md`, `docs/operations/getting-started.md`, `docs/engineering/pipeline-overview.md` e `docs/operations/training/overview.md`
- `sed -n '1,260p' docs/INDEX.md`
- `sed -n '1,260p' docs/archive/INDEX.md`
- `sed -n '1,260p' README.md`
- `sed -n '1,260p' .github/workflows/ci.yml`
- `sed -n '430,540p' .github/workflows/ci.yml`
- `sed -n '1,260p' docs/operations/release.md`
- `sed -n '1,260p' docs/operations/deploy.md`
- `sed -n '1,260p' docs/engineering/validation-monorepo.md`
- `sed -n '1,260p' docs/trading/INDEX.md`
- `sed -n '1,220p' apps/observability-service/README.md`
- `sed -n '1,220p' assets/branding/README.md`
- `sed -n '1,220p' infra/observability/grafana/README.md`
- `rg -n` em workflows e scripts para `docs-only`, `pipeline-only`, `release-eligible`, `built_images` e `images-manifest.json`
- contagem estrutural via `node` para raiz, `docs/`, `docs/archive/`, `docs/trading/` e READMEs locais

## Snapshot confirmado apos o Bloco 3

- Total de arquivos Markdown rastreados: `90`
- Arquivos Markdown na raiz do repositorio: `3`
- Arquivos Markdown na raiz de `docs/`: `2`
- Arquivos em `docs/architecture/`: `9`
- Arquivos em `docs/operations/`: `19`
- Arquivos em `docs/product/`: `7`
- Arquivos em `docs/engineering/`: `3`
- Arquivos em `docs/status/`: `2`
- Arquivos em `docs/archive/`: `45`

## Snapshot confirmado apos o Bloco 4

- Total de arquivos Markdown rastreados: `90`
- Arquivos Markdown na raiz do repositorio: `3`
- Arquivos Markdown na raiz de `docs/`: `2`
- Arquivos em `docs/architecture/`: `9`
- Arquivos em `docs/operations/`: `19`
- Arquivos em `docs/product/`: `7`
- Arquivos em `docs/engineering/`: `3`
- Arquivos em `docs/status/`: `2`
- Arquivos em `docs/archive/`: `45`

## Snapshot confirmado apos o Bloco 5

- Total de arquivos Markdown rastreados: `93`
- Arquivos Markdown na raiz do repositorio: `3`
- Arquivos Markdown na raiz de `docs/`: `2`
- Arquivos em `docs/architecture/`: `2`
- Arquivos em `docs/operations/`: `16`
- Arquivos em `docs/product/`: `2`
- Arquivos em `docs/engineering/`: `3`
- Arquivos em `docs/status/`: `2`
- Arquivos em `docs/archive/`: `45`
- Arquivos em `docs/trading/`: `17`

## Snapshot confirmado apos o Bloco 6

- Total de arquivos Markdown rastreados: `93`
- Arquivos Markdown na raiz do repositorio: `3`
- Arquivos Markdown na raiz de `docs/`: `2`
- Arquivos em `docs/architecture/`: `2`
- Arquivos em `docs/operations/`: `16`
- Arquivos em `docs/product/`: `2`
- Arquivos em `docs/engineering/`: `3`
- Arquivos em `docs/status/`: `2`
- Arquivos em `docs/archive/`: `45`
- Arquivos em `docs/trading/`: `17`

## Snapshot confirmado apos o Bloco 7

- Total de arquivos Markdown rastreados: `95`
- Arquivos Markdown ativos fora de `docs/archive/`: `50`
- Arquivos Markdown na raiz do repositorio: `3`
- READMEs locais ativos em `apps/`, `assets/` e `infra/`: `3`
- Arquivos Markdown na raiz de `docs/`: `2`
- Arquivos em `docs/architecture/`: `2`
- Arquivos em `docs/operations/`: `16`
- Arquivos em `docs/product/`: `2`
- Arquivos em `docs/engineering/`: `3`
- Arquivos em `docs/status/`: `2`
- Arquivos em `docs/archive/`: `45`
- Arquivos em `docs/trading/`: `17`

## Snapshot confirmado apos o Bloco 8

- Total de arquivos Markdown rastreados: `95`
- Arquivos Markdown ativos fora de `docs/archive/`: `50`
- Arquivos Markdown na raiz do repositorio: `3`
- READMEs locais ativos em `apps/`, `assets/` e `infra/`: `3`
- Arquivos Markdown na raiz de `docs/`: `2`
- Arquivos em `docs/architecture/`: `2`
- Arquivos em `docs/operations/`: `16`
- Arquivos em `docs/product/`: `2`
- Arquivos em `docs/engineering/`: `3`
- Arquivos em `docs/status/`: `2`
- Arquivos em `docs/archive/`: `45`
- Arquivos em `docs/trading/`: `17`

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
    │   └── platform.md
    ├── operations/
    │   ├── deploy.md
    │   ├── deployment.md
    │   ├── getting-started.md
    │   ├── observability.md
    │   ├── permissions.md
    │   ├── release.md
    │   ├── secrets.md
    │   ├── runbooks/
    │   └── training/
    ├── product/
    │   ├── design-guidelines.md
    │   └── training-business-guide.md
    ├── engineering/
    │   ├── pipeline-overview.md
    │   ├── pull-inteligente-flow.md
    │   └── validation-monorepo.md
    ├── status/
    │   ├── current-platform-status.md
    │   └── roadmap.md
    ├── trading/
    │   ├── INDEX.md
    │   ├── architecture/
    │   ├── operations/
    │   ├── product/
    │   └── runbooks/
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

### Canonicos novos criados no Bloco 3

| Arquivo atual | Papel |
| --- | --- |
| `docs/operations/release.md` | referencia especifica da publicacao de artefatos |
| `docs/operations/deploy.md` | procedimento operacional de implantacao em producao |
| `docs/operations/runbooks/INDEX.md` | indice de runbooks ativos |
| `design_guidelines.md`, `docs/GUIA-TREINAMENTO-AGENTES.md` | `docs/product/` | conteudo de produto retirado da raiz e da raiz de `docs/` |
| `docs/TRADING_PLATFORM_INSTITUTIONAL_V2.md` | `docs/trading/product/platform-institutional.md` | SSOT de produto do Trading consolidado no namespace do dominio |

### Runbooks ativos

| Origem | Destino atual |
| --- | --- |
| `docs/DR-RUNBOOK.md` | `docs/operations/runbooks/dr-game-day.md` |
| `docs/RUNBOOK-CONTAMINACAO-ESCOPO.md` | `docs/operations/runbooks/training-scope-contamination.md` |
| `docs/SLO-BURN-RATE-RUNBOOK.md` | `docs/operations/runbooks/slo-burn-rate-validation.md` |
| `docs/TRAINING-GPU-VALIDATION-RUNBOOK.md` | `docs/operations/runbooks/training-gpu-validation.md` |
| `docs/trading/operacao-testes-trading-v2.md` | `docs/trading/runbooks/operacao-testes.md` |
| `docs/trading/rollout-migration-rollback-trading-v2.md` | `docs/trading/runbooks/migration-rollback.md` |

### Trading reorganizado por natureza

| Natureza | Destino atual |
| --- | --- |
| arquitetura de dominio | `docs/trading/architecture/` |
| produto e UX | `docs/trading/product/` |
| operacao de dominio | `docs/trading/operations/` |
| runbooks de dominio | `docs/trading/runbooks/` |
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
- O namespace `docs/trading/` foi reintroduzido de forma curada, agora com separacao interna entre arquitetura, produto, operacao e runbooks.
- O SSOT vigente agora combina precedencia editorial global com navegacao dedicada por dominio quando o assunto e Trading.

## Validacao documental executada

- Conferencia da nova arvore com `find docs -maxdepth 3 -type d | sort`
- Conferencia do inventario de markdowns com `git ls-files '*.md'`
- Varredura de referencias para caminhos antigos com `rg -n`
- Revisao manual de `README.md`, `docs/INDEX.md`, `docs/archive/INDEX.md` e links relativos impactados por movimentacao
- Revisao manual de `docs/trading/INDEX.md`, `docs/trading/runbooks/INDEX.md` e dos SSOTs reescritos do dominio Trading
- Validacao automatizada de links Markdown locais com `node`
- Validacao automatizada de headings em `docs/**/*.md` com `node`
- Revisao manual de eliminacao de duplicacoes entre `training`, `learning`, `onboarding` e `status`
- Confirmacao de que `docs/status/current-platform-status.md` permaneceu como snapshot, e nao como historico de rodadas
- Revisao manual de escopo local em `apps/observability-service/README.md`, `assets/branding/README.md` e `infra/observability/grafana/README.md`
- Conferencia de caminhos e links relativos com `find`, `sed -n` e `rg -n` dentro de `apps/observability-service`, `assets/branding`, `infra/observability/grafana` e `apps/frontend-service`
- Verificacao de aderencia do branding com `scripts/update-branding.py`
- Verificacao de aderencia do Grafana local com `infra/docker/stacks/docker-compose.observability.yml`
- Validacao de metadata minima consistente em todos os Markdown ativos fora de `docs/archive/`
- Eliminacao de links ativos para diretorios quando ja existia documento canonico explicito
- Validacao automatizada de H1 por documento e de hierarquia sem salto de heading

## Blocos recentes desta rodada

| Bloco | Escopo sugerido | Status inicial |
| --- | --- | --- |
| `4` | consolidar sobreposicoes grandes de treinamento, aprendizado e status sem perder SSOT | concluido |
| `5` | refatorar o dominio Trading com namespace dedicado e precedencia explicita | concluido |
| `6` | normalizar READMEs locais e docs de subsistema sem reabrir SSOTs globais | concluido |
| `7` | padronizar metadata, tipos documentais, headings e links restantes da documentacao ativa | concluido |

## Auditoria final de consistencia

### Confirmacoes de fechamento

- `README.md` permanece curto, util e orientado a onboarding, com ponte clara para `docs/INDEX.md`.
- `AGENTS.md` e `CLAUDE.md` permanecem canonicos, sincronizados e consistentes com a politica atual de validacao por escopo e de separacao entre `CI`, `Release` e `Deploy`.
- `docs/INDEX.md` permanece como mapa principal da documentacao e regra editorial de classificacao.
- O material temporal permanece fora do espaco canonico tematico; `docs/archive/` e `docs/status/` nao invadem SSOTs de arquitetura, operacao, produto ou engenharia.
- Os links principais da documentacao local foram validados sem links quebrados nem referencias residuais para diretorios.
- A metadata minima dos documentos ativos foi confirmada com `Author`, `Atualizado`, `Status` e `Tipo`, incluindo `docs/archive/INDEX.md`.
- A documentacao de pipeline, release, deploy e validacao incremental esta alinhada com o comportamento real implementado nos workflows e scripts atuais.
- Nao foram encontradas contradicoes relevantes entre a documentacao ativa e o estado atual da esteira ou da arquitetura documental.

### Checklist final de completude documental

- [x] raiz do repositorio restrita a `README.md`, `AGENTS.md` e `CLAUDE.md`
- [x] `docs/INDEX.md` como portal principal
- [x] canonicos tematicos separados de status e archive
- [x] namespace `docs/trading/` organizado por natureza
- [x] material temporal fora do espaco canonico
- [x] pipeline documentada conforme comportamento real do codigo
- [x] politica de validacao por escopo refletida em governanca e SSOTs
- [x] `docs-only` e `pipeline-only` alinhados com a esteira real
- [x] metadata minima consistente nos documentos ativos
- [x] links relativos e headings validados

## Pendencias pequenas

- Nenhuma pendencia bloqueante foi identificada para o fechamento desta refatoracao documental.
- O historico legado em `docs/archive/relatorios/` continua preservado como lote arquivado e nao requer normalizacao adicional para manter a coerencia do SSOT vigente.

## Proximos passos opcionais

- Se houver manutencao documental recorrente, transformar a auditoria local de metadata, links e headings em script versionado de apoio editorial.
- Em alteracoes futuras de pipeline, manter a revisao cruzada entre SSOTs de `docs/engineering/` e `docs/operations/` para evitar drift.
