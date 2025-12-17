# Consolidação de Documentação - Alice Platform

**Autor:** Fillipe Guerra  
**Data:** 17 de Dezembro de 2025  
**Versão:** 2.1  
**Atualizado:** 17 de Dezembro de 2025 (Arquitetura Enterprise - Qwen3-Embedding-8B 4096 dim)

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

**Total de Documentos Ativos:** 12  
- Raiz: 3 (`CLAUDE.md`, `README.md`, `design_guidelines.md`)
- `/docs`: 7 documentos técnicos
- `/infra`: 2 READMEs de SSO

**Princípios Seguidos:**
- ✅ Sem redundância entre documentos
- ✅ Cada documento com propósito claro
- ✅ Documentação em Português Brasileiro
- ✅ Autor: Fillipe Guerra em todos
- ✅ 43 containers documentados corretamente

---

*Autor: Fillipe Guerra*  
*Documento atualizado em: 17 de Dezembro de 2025*
*Versão: 2.8 - Bug Fix CandleChart Wicks + Pipeline 100% Enterprise*
*Total de Containers: 43 (7 infra + 7 Alice + 15 ERPNext + 13 observability + 1 backup)*
*LLM: Mixtral 8x7B (vLLM AWQ) via Salad Cloud RTX 4090*
*ARQUITETURA ENTERPRISE: Texto 4096 dim Qwen3-Embedding-8B Apache 2.0 (Qdrant) | Imagem 1024 dim OpenCLIP MIT (pgvector)*
*Análise de Licenças: Qwen3 é ÚNICO modelo top-tier com licença comercial (Apache 2.0). Fin-E5/Linq-Embed/NV-Embed são CC BY-NC.*
*Bug Fixes (17/12/2025): CandleChart wicks + Schema import + initTradingOrchestrator + embeddings texto → Qdrant + KuCoin*
*Pipeline: Versionamento automático + Cache GHA + Auto-instalação requisitos + Scripts limpeza pós-deploy*
*Trading: KuCoin Futures BTC Perpetuals (XBTUSDTM) + Scalping (1m/3m/5m) + LoRA Fine-tuning*
