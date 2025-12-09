# Análise de Versões de Componentes - Alice Enterprise Platform

**Autor:** Fillipe Guerra  
**Data:** 09 de Dezembro de 2025  
**Versão:** 1.0

## 📊 RESUMO EXECUTIVO

Esta análise compara as versões atuais configuradas na plataforma Alice com as versões mais recentes disponíveis de cada componente, identificando quais precisam ser atualizadas para manter a plataforma 100% enterprise com software atualizado.

---

## 🔍 COMPONENTES ANALISADOS

### 1. pgBackRest

| Item | Valor |
|------|-------|
| **Versão Atual (component-versions.json)** | 2.57.0 |
| **Versão Mais Recente (GitHub)** | release/2.57.0 |
| **Status** | ✅ **ATUALIZADO** |
| **Observação** | Versão mais recente disponível |

---

### 2. Traefik

| Item | Valor |
|------|-------|
| **Versão Atual (component-versions.json)** | 3.3.0 |
| **Versão Mais Recente (GitHub)** | v3.6.4 |
| **Status** | ⚠️ **DESATUALIZADO** |
| **Diferença** | 3 versões minor atrás |
| **Ação Necessária** | Atualizar para 3.6.4 |

---

### 3. Prometheus

| Item | Valor |
|------|-------|
| **Versão Atual (component-versions.json)** | 3.0.1 |
| **Versão Mais Recente (GitHub)** | v3.8.0 |
| **Status** | ⚠️ **DESATUALIZADO** |
| **Diferença** | 8 versões minor atrás |
| **Ação Necessária** | Atualizar para 3.8.0 |

---

### 4. Grafana

| Item | Valor |
|------|-------|
| **Versão Atual (component-versions.json)** | 11.3 |
| **Versão Mais Recente (GitHub)** | v12.3.0 |
| **Status** | ⚠️ **DESATUALIZADO (MAJOR)** |
| **Diferença** | 1 versão major atrás |
| **Ação Necessária** | **VERIFICAR COMPATIBILIDADE** antes de atualizar para 12.3.0 |
| **Observação** | Major version - pode ter breaking changes. Verificar changelog e compatibilidade de dashboards/provisioning |

---

### 5. Jaeger

| Item | Valor |
|------|-------|
| **Versão Atual (component-versions.json)** | 1.62 |
| **Versão Mais Recente (GitHub)** | v1.76.0 |
| **Status** | ⚠️ **DESATUALIZADO** |
| **Diferença** | 14 versões minor atrás |
| **Ação Necessária** | Atualizar para 1.76.0 |

---

### 6. Langfuse

| Item | Valor |
|------|-------|
| **Versão Atual (component-versions.json)** | 2.39.1 |
| **Versão Mais Recente (GitHub)** | v3.138.0 |
| **Status** | ⚠️ **DESATUALIZADO (MAJOR)** |
| **Diferença** | 1 versão major + muitas minor atrás |
| **Ação Necessária** | **VERIFICAR COMPATIBILIDADE** antes de atualizar para 3.138.0 |
| **Observação** | Major version - pode ter breaking changes. Verificar changelog e migração de dados |

---

### 7. Loki

| Item | Valor |
|------|-------|
| **Versão Atual (component-versions.json)** | 3.1.0 |
| **Versão Mais Recente (GitHub)** | v3.6.2 |
| **Status** | ⚠️ **DESATUALIZADO** |
| **Diferença** | 5 versões minor atrás |
| **Ação Necessária** | Atualizar para 3.6.2 |

---

### 8. Promtail

| Item | Valor |
|------|-------|
| **Versão Atual (component-versions.json)** | 3.1.0 |
| **Versão Mais Recente (Docker Hub)** | 3.6.2 |
| **Status** | ⚠️ **DESATUALIZADO** |
| **Diferença** | 5 versões minor atrás |
| **Ação Necessária** | Atualizar para 3.6.2 |

---

### 9. ERPNext

| Item | Valor |
|------|-------|
| **Versão Atual (component-versions.json)** | 38.6 |
| **Versão Mais Recente (GitHub v15.x)** | v15.91.0 |
| **Status** | ⚠️ **DESATUALIZADO** |
| **Diferença** | 52 versões minor atrás |
| **Ação Necessária** | Atualizar para 15.91.0 |
| **Observação** | ERPNext usa versionamento v15.X onde X é o número da versão minor |

---

### 10. Docker Socket Proxy

| Item | Valor |
|------|-------|
| **Versão Atual (component-versions.json)** | 0.4.1 |
| **Versão Mais Recente (GitHub)** | v0.4.1 |
| **Status** | ✅ **ATUALIZADO** |
| **Observação** | Versão mais recente disponível |

---

### 11. Busybox

| Item | Valor |
|------|-------|
| **Versão Atual (component-versions.json)** | 1.36 |
| **Versão Mais Recente (Docker Hub)** | 1.37 |
| **Status** | ⚠️ **DESATUALIZADO** |
| **Diferença** | 1 versão minor atrás |
| **Ação Necessária** | Atualizar para 1.37 |

---

### 12. Redis

| Item | Valor |
|------|-------|
| **Versão Atual (component-versions.json)** | 7-alpine |
| **Versão Mais Recente (Docker Hub)** | 7.4-alpine |
| **Status** | ⚠️ **DESATUALIZADO** |
| **Diferença** | 4 versões minor atrás |
| **Ação Necessária** | Atualizar para 7.4-alpine |

---

### 13. MariaDB

| Item | Valor |
|------|-------|
| **Versão Atual (component-versions.json)** | 10.11 |
| **Versão Mais Recente (Docker Hub)** | 10.11.15 |
| **Status** | ⚠️ **DESATUALIZADO** |
| **Diferença** | 15 versões patch atrás |
| **Ação Necessária** | Atualizar para 10.11.15 |

---

### 14. pgvector

| Item | Valor |
|------|-------|
| **Versão Atual (component-versions.json)** | pg16 |
| **Versão Mais Recente** | pg16 (tag fixa) |
| **Status** | ✅ **ATUALIZADO** |
| **Observação** | Tag `pg16` é atualizada automaticamente pelo Docker Hub para a versão mais recente compatível com PostgreSQL 16 |

---

## 📋 RESUMO DE ATUALIZAÇÕES NECESSÁRIAS

### Atualizações Seguras (Minor/Patch)

| Componente | Versão Atual | Versão Mais Recente | Prioridade |
|------------|--------------|---------------------|------------|
| **Traefik** | 3.3.0 | 3.6.4 | 🔴 Alta |
| **Prometheus** | 3.0.1 | 3.8.0 | 🔴 Alta |
| **Jaeger** | 1.62 | 1.76.0 | 🔴 Alta |
| **Loki** | 3.1.0 | 3.6.2 | 🟡 Média |
| **Promtail** | 3.1.0 | 3.6.2 | 🟡 Média |
| **ERPNext** | 38.6 | 91.0 | 🔴 Alta |
| **Busybox** | 1.36 | 1.37 | 🟢 Baixa |
| **Redis** | 7-alpine | 7.4-alpine | 🟡 Média |
| **MariaDB** | 10.11 | 10.11.15 | 🟡 Média |

### Atualizações que Requerem Verificação (Major Versions)

| Componente | Versão Atual | Versão Mais Recente | Ação |
|------------|--------------|---------------------|------|
| **Grafana** | 11.3 | 12.3.0 | ⚠️ Verificar changelog e compatibilidade de dashboards |
| **Langfuse** | 2.39.1 | 3.138.0 | ⚠️ Verificar changelog e migração de dados |

---

## 🎯 PLANO DE AÇÃO

### FASE 1: Atualizações Seguras (Minor/Patch) - Prioridade Alta

1. **Traefik 3.3.0 → 3.6.4**
   - Verificar changelog para breaking changes
   - Testar em ambiente de desenvolvimento
   - Atualizar `component-versions.json`

2. **Prometheus 3.0.1 → 3.8.0**
   - Verificar changelog para breaking changes
   - Testar configuração de scraping
   - Atualizar `component-versions.json`

3. **Jaeger 1.62 → 1.76.0**
   - Verificar changelog para breaking changes
   - Testar tracing distribuído
   - Atualizar `component-versions.json`

4. **ERPNext 38.6 → 91.0**
   - **CRÍTICO**: Verificar changelog completo (52 versões de diferença)
   - Verificar se há migrations necessárias
   - Testar em ambiente de desenvolvimento
   - Atualizar `component-versions.json`

### FASE 2: Atualizações Seguras (Minor/Patch) - Prioridade Média

5. **Loki 3.1.0 → 3.6.2**
6. **Promtail 3.1.0 → 3.6.2**
7. **Redis 7-alpine → 7.4-alpine**
8. **MariaDB 10.11 → 10.11.15**

### FASE 3: Atualizações que Requerem Verificação (Major)

9. **Grafana 11.3 → 12.3.0**
   - Verificar changelog completo da versão 12.x
   - Verificar compatibilidade de dashboards JSON
   - Verificar compatibilidade de datasources
   - Testar provisioning de dashboards
   - **Recomendação**: Criar branch de teste e validar antes de produção

10. **Langfuse 2.39.1 → 3.138.0**
    - Verificar changelog completo da versão 3.x
    - Verificar migração de dados (se houver)
    - Verificar compatibilidade de API
    - **Recomendação**: Criar branch de teste e validar antes de produção

### FASE 4: Atualizações Baixa Prioridade

11. **Busybox 1.36 → 1.37**
    - Atualização simples, baixo risco

---

## ⚠️ OBSERVAÇÕES IMPORTANTES

### Grafana 12.x

- **Breaking Changes Potenciais**: Versão major pode ter mudanças significativas
- **Dashboards**: Verificar se todos os dashboards JSON são compatíveis
- **Datasources**: Verificar compatibilidade de datasources (Prometheus, Loki, Jaeger)
- **Provisioning**: Verificar se provisioning de dashboards/datasources funciona
- **Recomendação**: Testar em ambiente de desenvolvimento antes de produção

### Langfuse 3.x

- **Breaking Changes Potenciais**: Versão major pode ter mudanças significativas
- **Migração de Dados**: Verificar se há migração necessária de dados existentes
- **API Changes**: Verificar se endpoints usados pela plataforma ainda existem
- **Recomendação**: Testar em ambiente de desenvolvimento antes de produção

### ERPNext 38.6 → 91.0

- **CRÍTICO**: 52 versões de diferença - muitas atualizações acumuladas
- **Migrations**: Provavelmente há migrations do banco de dados necessárias
- **Breaking Changes**: Verificar changelog completo de todas as versões intermediárias
- **Recomendação**: Atualização gradual (ex: 38.6 → 50 → 70 → 91) ou atualização completa com backup

---

## 📝 CHECKLIST DE ATUALIZAÇÃO

Para cada componente a ser atualizado:

- [ ] Verificar changelog oficial da versão mais recente
- [ ] Verificar breaking changes
- [ ] Testar em ambiente de desenvolvimento
- [ ] Atualizar `component-versions.json`
- [ ] Verificar se workflow `deploy-production.yml` busca versão correta
- [ ] Atualizar documentação (CLAUDE.md, README.md, DEPLOYMENT.md)
- [ ] Verificar compatibilidade com outros componentes
- [ ] Executar testes de integração
- [ ] Fazer backup antes de atualizar em produção

---

## 🔄 VERSIONAMENTO AUTOMÁTICO

**IMPORTANTE**: O workflow `deploy-production.yml` já implementa versionamento automático que busca as versões mais recentes via GitHub API. O arquivo `component-versions.json` serve apenas como **fallback** quando a API do GitHub não está disponível.

**Recomendação**: Manter `component-versions.json` atualizado com versões recentes para garantir que, mesmo em caso de falha da API, o deploy use versões atualizadas e não versões muito antigas.

---

*Autor: Fillipe Guerra*  
*Documento criado em: 09 de Dezembro de 2025*  
*Versão: 1.0*  
*Próxima Revisão: Após atualização dos componentes*

