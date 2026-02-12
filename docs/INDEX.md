# Índice de Documentação (SSOT) - Alice Enterprise Platform

**Autor:** Fillipe Guerra  
**Data:** 12 de Fevereiro de 2026  
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
| `docs/OBSERVABILITY.md` | Observabilidade (métricas/dashboards/alertas) | Sim | Inclui auditoria consolidada |
| `docs/SISTEMA-APRENDIZADO.md` | Aprendizado contínuo (auto-learning) | Sim | Fluxos e status do sistema de aprendizado |
| `docs/TRAINING.md` | Treinamento/QLoRA | Sim | API, schedule, requisitos e fluxo |
| `docs/TREINAMENTO-LIMITES-E-BOAS-PRATICAS.md` | Limites e boas práticas de treinamento | Sim | Janelas conversa/documento, minChars, validação dimensões, resolução escopo |
| `docs/GUIA-TREINAMENTO-AGENTES.md` | Guia de treinamento para negócios | Sim | Passo a passo didático (RAG + treinamento) |
| `docs/SECRETS.md` | Secrets e variáveis | Sim | SSOT de secrets + geração de `.env.prod` |
| `docs/PERMISSIONS.md` | SSOT de permissões | Sim | UIDs/GIDs + RBAC de aplicação |
| `docs/FRAPPE-PATCHING.md` | Patching ERPNext/Frappe | Sim | Segurança e procedimento de atualização |
| `docs/GUIA-CONFIGURACAO-INICIAL.md` | Configuração inicial (passo a passo) | Sim | Manual completo de onboarding |
| `docs/ROADMAP.md` | Funcionalidades futuras (Trading, integrações) | Sim | Itens de expansão, não pendências |

---

## Consolidações realizadas

- **Auditoria de Observabilidade (13/01/2026)**: conteúdo consolidado no `docs/OBSERVABILITY.md` para evitar duplicidade de informações.
- **Alinhamento documentação com código (02/2026)**: README (estrutura `apps/` com biometrics, llm-gateway, gpu-manager; contagem 17 imagens release), ARQUITETURA (biometrics como Python FastAPI), OBSERVABILITY (targets/dashboards Biometrics e LLM Gateway, smoke test dashboards). Índice e SECRETS já refletiam LLM_GATEWAY_URL e BIOMETRICS; STATUS-REAL-ATUAL já listava todos os serviços Alice.

---

## Regras de atualização (obrigatórias)

- Toda documentação deve estar em **Português Brasileiro** (termos técnicos em inglês).
- Sempre manter **Autor** e **Data** atualizados em cada documento alterado.
- Evitar duplicidade: se um conteúdo já existir em um SSOT, referenciar ao invés de repetir.
