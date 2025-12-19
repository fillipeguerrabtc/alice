# Consolidação de Documentação - Alice Platform

**Autor:** Fillipe Guerra  
**Data:** 19 de Dezembro de 2025  
**Versão:** 3.2  
**Atualizado:** 17 de Dezembro de 2025 (Documento de Arquitetura Enterprise - arc42 + C4 + ADRs)

## Estrutura Atual da Documentação

### Documentos Principais (Ativos)

| Documento | Propósito | Status |
|-----------|-----------|--------|
| `CLAUDE.md` | Regras e visão geral (18 regras) | ✅ Ativo |
| `README.md` | Documentação principal do projeto | ✅ Ativo |
| `design_guidelines.md` | Diretrizes de design UI/UX | ✅ Ativo |

### Documentação Técnica (`docs/`)

| Documento | Propósito | Status |
|-----------|-----------|--------|
| `ARQUITETURA.md` | **Arquitetura completa (arc42 + C4 + ADRs)** | ✅ **NOVO** |
| `DEPLOYMENT.md` | Guia de deploy para produção (43 containers) | ✅ Ativo |
| `SECRETS.md` | Guia completo de secrets e webhooks | ✅ Ativo |
| `STATUS-REAL-ATUAL.md` | Status detalhado da plataforma | ✅ Ativo |
| `SISTEMA-APRENDIZADO.md` | Sistema de auto-aprendizado | ✅ Ativo |
| `FRAPPE-PATCHING.md` | Guia de patching ERPNext v15.91.3 | ✅ Ativo |
| `PLANO-100%-BASE.md` | Histórico de gaps e correções (completo) | ✅ Histórico |
| `DOCKERFILE-VARIABLE-EXPANSION.md` | Referência técnica Dockerfile | ✅ Ativo |
| `CONSOLIDACAO-DOCUMENTACAO.md` | Este documento | ✅ Ativo |

### Documentação de Infraestrutura (`infra/`)

| Documento | Propósito | Status |
|-----------|-----------|--------|
| `infra/erpnext/README.md` | SSO ERPNext com Alice IdP | ✅ Ativo |
| `infra/observability/grafana/README.md` | SSO Grafana com Alice IdP | ✅ Ativo |

---

## Limpeza Realizada em 14/12/2025

### Documentos Removidos (Obsoletos/Redundantes)

| Documento Removido | Motivo |
|-------------------|--------|
| `GAPS-CRITICOS-ENCONTRADOS.md` | ❌ Obsoleto - todos os gaps já corrigidos (09/12) |
| `ANALISE-COMPLETA-TAKEOVER-HANDOVER.md` | ❌ Redundante - informações em STATUS-REAL-ATUAL |
| `AUDITORIA-SECRETS.md` | ❌ Redundante - consolidado em SECRETS.md |

### Justificativa

- **GAPS-CRITICOS-ENCONTRADOS.md**: Continha apenas histórico de problemas já resolvidos, causando confusão
- **ANALISE-COMPLETA-TAKEOVER-HANDOVER.md**: Análise pontual de funcionalidade já documentada em STATUS-REAL-ATUAL
- **AUDITORIA-SECRETS.md**: Duplicava informações do SECRETS.md sem valor adicional

---

## Resumo da Documentação

**Total de Documentos Ativos:** 13  
- Raiz: 3 (`CLAUDE.md`, `README.md`, `design_guidelines.md`)
- `/docs`: 8 documentos técnicos (incluindo novo `ARQUITETURA.md`)
- `/infra`: 2 READMEs de SSO

**Princípios Seguidos:**
- ✅ Sem redundância entre documentos
- ✅ Cada documento com propósito claro
- ✅ Documentação em Português Brasileiro
- ✅ Autor: Fillipe Guerra em todos
- ✅ 43 containers documentados corretamente

---

*Autor: Fillipe Guerra*  
*Documento atualizado em: 19 de Dezembro de 2025*
*Versão: 3.1 - Bug Fix SQL IN Clause (learning-worker.ts)*
*Total de Containers: 43 (7 infra + 7 Alice + 15 ERPNext + 13 observability + 1 backup)*
*Total de Documentos: 13 (8 docs técnicos + 3 raiz + 2 infra)*
*LLM: Mixtral 8x7B (vLLM AWQ) via Salad Cloud RTX 4090*
*ARQUITETURA ENTERPRISE: Texto 4096 dim Qwen3-Embedding-8B Apache 2.0 (Qdrant) | Imagem 1024 dim OpenCLIP MIT (pgvector)*
*ARQUITETURA.md (17/12/2025): Documento completo com arc42, C4 Model, ADRs, 12-Factor App, 18 Regras*
*Response Cache (17/12/2025): Greetings Gate implementado - saudações respondidas via cache Redis (sem GPU)*
*Bug Fixes Trading (17/12/2025): extractNumber (regex groups), WebSocket unsubscribe (oldSymbol), Orchestrator atomicity*
*Pipeline: Versionamento automático + Cache GHA + Auto-instalação requisitos + Scripts limpeza pós-deploy*
*Trading: KuCoin Futures BTC Perpetuals (XBTUSDTM) + Scalping (1m/3m/5m) + LoRA Fine-tuning*
