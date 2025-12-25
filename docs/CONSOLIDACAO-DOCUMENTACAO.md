# Consolidação de Documentação - Alice Platform

**Autor:** Fillipe Guerra  
**Data:** 25 de Dezembro de 2025  
**Versão:** 4.0  
**Atualizado:** 25 de Dezembro de 2025 (Migração completa para Hetzner GPU GEX44 + Deploy Server)

> Atualização 21/12/2025: CI ajustado para evitar execuções duplicadas (push apenas em `main` + PR) e correção de tipos no frontend (SignalApprovalPanel/TechnicalAnalysisPanel) garantindo sucesso do Release.

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
| `ARQUITETURA.md` | **Arquitetura completa (arc42 + C4 + ADRs)** | ✅ Ativo |
| `DEPLOYMENT.md` | Guia de deploy para produção (50 containers) | ✅ Ativo |
| `SECRETS.md` | Guia completo de secrets e webhooks (inclui lista de obsoletos) | ✅ Ativo |
| `STATUS-REAL-ATUAL.md` | Status detalhado da plataforma | ✅ Ativo |
| `SISTEMA-APRENDIZADO.md` | Sistema de auto-aprendizado | ✅ Ativo |
| `FRAPPE-PATCHING.md` | Guia de patching ERPNext v15.91.3 | ✅ Ativo |
| `ARQUITETURA-GPU-MANAGER.md` | Arquitetura do GPU Manager Service | ✅ Ativo |
| `CONSOLIDACAO-DOCUMENTACAO.md` | Este documento | ✅ Ativo |

### Documentação de Infraestrutura (`infra/`)

| Documento | Propósito | Status |
|-----------|-----------|--------|
| `infra/erpnext/README.md` | SSO ERPNext com Alice IdP | ✅ Ativo |
| `infra/observability/grafana/README.md` | SSO Grafana com Alice IdP | ✅ Ativo |

---

## Limpeza Realizada em 14/12/2025

### Documentos Removidos (Obsoletos/Redundantes)

| Documento Removido | Motivo | Data |
|-------------------|--------|------|
| `GAPS-CRITICOS-ENCONTRADOS.md` | ❌ Obsoleto - todos os gaps já corrigidos | 14/12/2025 |
| `ANALISE-COMPLETA-TAKEOVER-HANDOVER.md` | ❌ Redundante - informações em STATUS-REAL-ATUAL | 14/12/2025 |
| `AUDITORIA-SECRETS.md` | ❌ Redundante - consolidado em SECRETS.md | 14/12/2025 |
| `SECRETS-OBSOLETOS-REMOVER.md` | ❌ Consolidado em SECRETS.md (seção dedicada) | 25/12/2025 |

### Justificativa

- **GAPS-CRITICOS-ENCONTRADOS.md**: Continha apenas histórico de problemas já resolvidos, causando confusão
- **ANALISE-COMPLETA-TAKEOVER-HANDOVER.md**: Análise pontual de funcionalidade já documentada em STATUS-REAL-ATUAL
- **AUDITORIA-SECRETS.md**: Duplicava informações do SECRETS.md sem valor adicional

---

## Resumo da Documentação

**Total de Documentos Ativos:** 12  
- Raiz: 3 (`CLAUDE.md`, `README.md`, `design_guidelines.md`)
- `/docs`: 7 documentos técnicos principais (consolidados)
- `/infra`: 2 READMEs de SSO

**Princípios Seguidos:**
- ✅ Sem redundância entre documentos
- ✅ Cada documento com propósito claro
- ✅ Documentação em Português Brasileiro
- ✅ Autor: Fillipe Guerra em todos
- ✅ 43 containers documentados corretamente

---

*Autor: Fillipe Guerra*  
*Documento atualizado em: 25 de Dezembro de 2025*
*Versão: 4.0 - Migração Completa para Hetzner GPU GEX44 + Deploy Server*
*Total de Containers: 50 (8 infra + 7 Alice + 15 ERPNext + 14 observability + 4 GPU + 1 backup)*
*Total de Documentos: 12 (7 docs técnicos principais + 3 raiz + 2 infra)*
*Servidor: Hetzner GEX44 (RTX 4000 Ada 20GB, Intel Core i5-13500 14 Core, 64GB RAM, 2x 1.92TB NVMe SSD)*
*LLM: Mixtral 8x7B (vLLM AWQ) via GPU Manager Service (Hetzner GEX44 - local)*
*ARQUITETURA ENTERPRISE: Texto 4096 dim Qwen3-Embedding-8B Apache 2.0 (Qdrant) | Imagem 1024 dim OpenCLIP MIT (pgvector)*
*GPU Manager Service (25/12/2025): Gerenciamento centralizado de requisições GPU com fila priorizada, monitoramento VRAM e circuit breakers*
*Arquitetura Deploy (25/12/2025): Deploy Server (CX11) separado + Production Server (GEX44 GPU) - isolamento completo CI/CD e produção*
*Pipeline: Versionamento automático + Cache GHA + Auto-instalação requisitos + Scripts limpeza pós-deploy*
*Trading: KuCoin Futures BTC Perpetuals (XBTUSDTM) + Scalping (1m/3m/5m) + LoRA Fine-tuning*
