# Índice de Documentação (SSOT) - Alice Enterprise Platform

Author: Fillipe Guerra  
Data: 11 de Março de 2026

## Objetivo
Manter a documentação canônica enxuta, com separação explícita entre SSOT normativo e histórico arquivado.

## Documentação canônica (SSOT)
- `README.md`: visão geral e onboarding rápido.
- `docs/ARQUITETURA.md`: arquitetura vigente e decisões técnicas.
- `docs/STATUS-REAL-ATUAL.md`: snapshot operacional consolidado.
- `docs/DEPLOYMENT.md`: deploy, release e operação.
- `docs/OBSERVABILITY.md`: métricas, dashboards, alertas e runbooks de observabilidade.
- `docs/SECRETS.md`: governança de secrets e variáveis.
- `docs/PERMISSIONS.md`: RBAC e permissões de plataforma.
- `docs/VALIDACAO-INCREMENTAL-MONOREPO.md`: fluxo local incremental por workspace e gates full oficiais.
- `docs/PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md`: tracking canônico por rodada.
- `docs/ROADMAP.md`: direcionamento futuro (não substitui status de execução).

## Histórico arquivado
- Índice de histórico: `docs/archive/INDEX.md`.
- Relatórios históricos: `docs/archive/relatorios/RELATORIO-*.md`.
- Planos e relatórios históricos são referência temporal e não substituem os SSOT acima.

## Regra de precedência
1. Status de execução por rodada: `docs/PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md`.
2. Arquitetura e convenções vigentes: `docs/ARQUITETURA.md`.
3. Estado operacional consolidado: `docs/STATUS-REAL-ATUAL.md`.
4. Evidências históricas: `docs/archive/INDEX.md` e conteúdos arquivados.

## Regras de manutenção
- Documentação em Português Brasileiro (termos técnicos em inglês quando necessário).
- Atualizar somente documentos impactados por mudanças reais.
- Evitar duplicidade: referenciar SSOT em vez de replicar conteúdo.
