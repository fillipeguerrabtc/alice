# Índice de Documentação (SSOT) - Alice Enterprise Platform

**Autor:** Fillipe Guerra  
**Data:** 11 de Março de 2026  
**Objetivo:** Centralizar a fonte de verdade (SSOT) e reduzir redundância entre documentos.

---

## SSOT por domínio

| Documento | Propósito | Fonte de verdade | Observações |
|-----------|-----------|------------------|------------|
| `README.md` | Visão geral + onboarding rápido | Sim (resumo) | Deve ser conciso e apontar para docs detalhadas |
| `docs/ARQUITETURA.md` | Arquitetura (arc42 + C4 + ADRs) | Sim | Decisões e diagramas de sistema |
| `docs/ARQUITETURA-GPU-MANAGER.md` | Arquitetura GPU (Gate 2) | Sim | VRAM budget, serviços GPU, OpenAI Vision/Images |
| `docs/DEPLOYMENT.md` | Deploy e CI/CD | Sim | Workflow, ordem de deploy, checklist e troubleshooting |
| `docs/STATUS-REAL-ATUAL.md` | Estado atual (snapshot factual) | Sim | Referência operacional consolidada |
| `docs/PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md` | Tracking canônico do backlog por rodada | Sim | Fonte de verdade de status/validações/commits do backlog governado |
| `docs/OBSERVABILITY.md` | Observabilidade (métricas/dashboards/alertas) | Sim | Inclui auditoria consolidada |
| `docs/SISTEMA-APRENDIZADO.md` | Aprendizado contínuo (auto-learning) | Sim | Fluxos e status do sistema de aprendizado |
| `docs/TRAINING.md` | Treinamento/QLoRA | Sim | API, schedule, requisitos e fluxo |
| `docs/TREINAMENTO-LIMITES-E-BOAS-PRATICAS.md` | Limites e boas práticas de treinamento | Sim | Janelas conversa/documento, minChars, validação dimensões, resolução escopo |
| `docs/GUIA-TREINAMENTO-AGENTES.md` | Guia de treinamento para negócios | Sim | Passo a passo didático (RAG + treinamento) |
| `docs/SECRETS.md` | Secrets e variáveis | Sim | SSOT de secrets + geração de `.env.prod` |
| `docs/PERMISSIONS.md` | SSOT de permissões | Sim | UIDs/GIDs + RBAC de aplicação |
| `docs/GUIA-CONFIGURACAO-INICIAL.md` | Configuração inicial (passo a passo) | Sim | Manual completo de onboarding |
| `docs/ROADMAP.md` | Funcionalidades futuras (Trading, integrações) | Sim | Itens de expansão, não pendências |

---

## Fonte canônica de execução

- O status oficial do backlog governado por rounds está em `docs/PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md`.
- Em caso de divergência entre relatórios históricos e status de execução, prevalece o tracking canônico acima.

---

## Classificação canônica dos documentos

### Documentos normativos (SSOT)
- `README.md`: visão geral e onboarding.
- `docs/ARQUITETURA.md`: decisões e visão arquitetural canônica.
- `docs/STATUS-REAL-ATUAL.md`: snapshot operacional consolidado do estado atual.
- `docs/SECRETS.md` e `docs/PERMISSIONS.md`: governança de configuração sensível e RBAC.

### Documentos de execução e histórico
- `docs/PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md`: tracking canônico por rodada, com validações e commits reais.
- Relatórios históricos (`docs/RELATORIO-*.md` e correlatos): contexto temporal complementar, sem precedência sobre documentos normativos e tracking canônico.

### Regra de precedência
1. Para status de execução por rodada, prevalece `docs/PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md`.
2. Para arquitetura e convenções vigentes, prevalece `docs/ARQUITETURA.md`.
3. Para estado operacional consolidado, prevalece `docs/STATUS-REAL-ATUAL.md`.

## Regras de atualização (obrigatórias)

- Toda documentação deve estar em **Português Brasileiro** (termos técnicos em inglês).
- Sempre manter **Autor** e **Data** atualizados em cada documento alterado.
- Evitar duplicidade: se um conteúdo já existir em um SSOT, referenciar ao invés de repetir.
- Documentos de **relatório histórico** mantêm contexto temporal original; quando houver divergência de line numbers após refactors, considerar `README.md`, `docs/ARQUITETURA.md` e `docs/STATUS-REAL-ATUAL.md` como referência vigente.
