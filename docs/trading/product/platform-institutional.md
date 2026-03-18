# Plataforma Institucional de Trading

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026
**Status:** ativo
**Tipo:** ssot

## Objetivo

Consolidar a visao de produto do Trading institucional da Alice, conectando operacao real, demo, sinais IA, auto engine e trilha auditavel de promocao sem transformar este documento em plano de rollout.

## Pilares do produto

- Trading Real e Demo compartilham a mesma shell de workspace quando a V2 esta habilitada.
- Sinais IA operam com estados explicitos e com handoff first-class para Demo e Training.
- Auto Engine trata `signal` e `portfolio` como fluxos assincros auditaveis.
- Promotion path conecta evidencias, dataset curation, calibracao, demo eligibility e real eligibility.

## Principios obrigatorios

- O sistema nao promete lucro.
- `no_trade` e resultado valido quando risco, custo ou contexto derrubam a oportunidade.
- Demo e Live compartilham leitura de mercado quando necessario, mas nunca a execucao.
- LLM participa como camada de arbitragem, explicacao e enriquecimento, nao como unico motor de decisao.

## Superficie funcional atual

### Operacao de workspace

- Modo `operate` para monitoramento e execucao.
- Modo `ai-signals` para geracao, leitura e handoff de sinais.
- Modo `portfolio-auto` para auto runs e acompanhamento de ciclo.
- Modo `post-trade` para historico e leitura operacional.

### Jornadas de sinais

- `POST /api/integrations/trading/signals/generate`
- `GET /api/integrations/trading/signals/:id/promotion-path`
- `POST /api/integrations/trading/datasets/from-signal`
- `POST /api/integrations/demo-trading/orders/from-signal`
- `POST /api/integrations/trading/signals/:id/promote-real-eligibility`

### Jornadas de auto engine

- `POST /api/trading/auto/signal/run`
- `POST /api/trading/auto/portfolio/run`
- `GET /api/trading/auto/runs`
- `GET /api/trading/auto/runs/:id`

## O que este documento nao cobre

- Governanca geral de `release`, `deploy` e `validacao` do monorepo.
- Historico de rodadas, incidentes ou fechamento de implementacao.
- Checklist operacional passo a passo.

## Referencias

- [workspace-shell.md](workspace-shell.md)
- [ai-signals-cockpit.md](ai-signals-cockpit.md)
- [demo-workspace-convergence.md](demo-workspace-convergence.md)
- [../operations/training-calibration-promotion-path.md](../operations/training-calibration-promotion-path.md)
