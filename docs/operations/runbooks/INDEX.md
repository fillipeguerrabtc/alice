# Indice de Runbooks Operacionais

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026

## Objetivo

Centralizar os runbooks ativos da trilha operacional da Alice e manter esses procedimentos separados dos SSOTs conceituais.

## Runbooks ativos

| Assunto | Documento |
| --- | --- |
| DR e game day de backup/restore | [dr-game-day.md](dr-game-day.md) |
| Validacao de burn rate e SLO | [slo-burn-rate-validation.md](slo-burn-rate-validation.md) |
| Validacao operacional de GPU training | [training-gpu-validation.md](training-gpu-validation.md) |
| Contaminacao de escopo em training/LoRA | [training-scope-contamination.md](training-scope-contamination.md) |
| Trading | [../../trading/runbooks/INDEX.md](../../trading/runbooks/INDEX.md) |

## Regras editoriais

- Runbook descreve resposta operacional passo a passo.
- SSOT conceitual nao deve carregar checklist de incidente ou game day.
- Historico fechado vai para `docs/archive/`, nunca para esta pasta.
