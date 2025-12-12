# Processo de Atualização Periódica de Pacotes - Alice Platform

**Autor:** Fillipe Guerra  
**Data:** 09 de Dezembro de 2025  
**Versão:** 1.1 - Compliance Completo com 18 Regras e 12 Fatores App

---

## 📋 VISÃO GERAL

Este documento descreve o processo **enterprise-grade** de atualização periódica de todos os pacotes da plataforma Alice:

1. **Dependências npm/pnpm** (pacotes Node.js)
2. **Pacotes do sistema** (apt no servidor Hetzner)

---

## 🔄 ATUALIZAÇÃO DE DEPENDÊNCIAS (npm/pnpm)

### Workflow Automático

**Arquivo:** `.github/workflows/update-dependencies.yml`

**Execução:**
- **Automática:** Todo domingo às 02:00 UTC
- **Manual:** Via `workflow_dispatch` no GitHub Actions

**Processo:**
1. ✅ Verifica atualizações disponíveis usando `pnpm outdated`
2. ✅ Cria branch `deps/update-YYYYMMDD`
3. ✅ Atualiza dependências (tipo: patch, minor, major ou all)
4. ✅ Executa validações (TypeScript check, build)
5. ✅ Cria Pull Request para revisão manual
6. ✅ **REGRA 4:** Aprovação obrigatória antes de merge

**Tipos de Atualização:**
- `patch`: Apenas patches de segurança (padrão, mais seguro)
  - Estratégia: Backup `package.json` → conversão de ranges `^` para `~` → `pnpm update` → restore `package.json` → `pnpm install --lockfile-only`
  - Atualiza APENAS patches (X.Y.Z → X.Y.Z+1), não minor nem major
  - Mantém ranges originais no `package.json`, atualiza apenas `pnpm-lock.yaml`
- `minor`: Minor + patches (recomendado para atualizações regulares)
  - Estratégia: `pnpm outdated --format json` → filtragem de pacotes com updates minor/patch → `pnpm update <pacotes>`
  - Atualiza minor e patch (X.Y.Z → X.Y+1.0 ou X.Y.Z+1), mas não major
  - Respeita ranges `^` do `package.json` (atualiza para 'wanted', não 'latest')
- `major`: Major + minor + patches de dependências diretas (requer revisão cuidadosa)
  - Comando: `pnpm update --latest`
  - Atualiza apenas dependências diretas do package.json raiz para a versão mais recente
  - NÃO atualiza workspaces nem dependências transitivas
- `all`: Todas as atualizações disponíveis incluindo workspaces
  - Comando: `pnpm update --latest --recursive`
  - Atualiza todas as dependências (diretas, transitivas) e workspaces para a versão mais recente
  - Ignora ranges do package.json e atualiza tudo recursivamente

### Execução Manual

```bash
# Via GitHub Actions UI
1. Acesse: Actions → Update Dependencies → Run workflow
2. Selecione tipo de atualização (patch, minor, major, all)
3. Execute o workflow
4. Revise o PR criado automaticamente
5. Aprove e faça merge após validação
```

### Validações Automáticas

- ✅ TypeScript check (`pnpm run typecheck`)
- ✅ Build de packages (`pnpm run build:packages`)
- ✅ Verificação de conflitos no `pnpm-lock.yaml`

---

## 🔄 ATUALIZAÇÃO DE PACOTES DO SISTEMA (Hetzner)

### Workflow Automático

**Arquivo:** `.github/workflows/update-system-packages.yml`

**Execução:**
- **Automática:** Todo domingo às 03:00 UTC
- **Manual:** Via `workflow_dispatch` no GitHub Actions

**Processo:**
1. ✅ Verifica atualizações disponíveis (`apt list --upgradable`)
2. ✅ Cria issue no GitHub com resumo das atualizações
3. ✅ **REGRA 4:** Aprovação obrigatória - não atualiza automaticamente por padrão
4. ✅ Se `auto_update=true`, executa atualização com:
   - Backup completo antes de atualizar
   - Atualização de pacotes
   - Health checks após atualização

### Execução Manual (Recomendado)

**Script:** `scripts/update-system-packages.sh`

```bash
# Conectar ao servidor Hetzner
ssh alice-hetzner

# Executar script de atualização
cd /opt/alice/app
./scripts/update-system-packages.sh

# Ou executar diretamente
bash /opt/alice/app/scripts/update-system-packages.sh
```

**O script executa:**
1. ✅ Backup completo (configurações, containers, logs)
2. ✅ Verificação de atualizações disponíveis
3. ✅ Confirmação do usuário (se interativo)
4. ✅ Atualização de pacotes (`apt update && apt upgrade`)
5. ✅ Limpeza de pacotes órfãos (`apt autoremove`)
6. ✅ Health checks (Docker, containers, disco, memória)

### Execução Automática (Avançado)

**⚠️ ATENÇÃO:** Execução automática requer aprovação explícita.

```bash
# Via GitHub Actions UI
1. Acesse: Actions → Update System Packages → Run workflow
2. Marque "auto_update" como "true"
3. Execute o workflow
4. Monitore logs e health checks
```

---

## 📅 CRONOGRAMA RECOMENDADO

### Semanal (Domingos)

| Horário (UTC) | Processo | Tipo |
|---------------|----------|------|
| 02:00 | Atualização de dependências npm/pnpm | Automático (cria PR) |
| 03:00 | Verificação de pacotes do sistema | Automático (cria issue) |

### Mensal (Primeiro domingo do mês)

- Revisar e aprovar PRs de dependências
- Executar atualização de pacotes do sistema manualmente
- Verificar versões de componentes externos (`.github/component-versions.json`)

---

## 🔒 SEGURANÇA E COMPLIANCE

### REGRA 4: Aprovação Obrigatória

- ✅ Dependências: PR criado automaticamente, merge requer aprovação
- ✅ Pacotes do sistema: Issue criada automaticamente, atualização requer aprovação manual

### REGRA 6: Enterprise-Grade

- ✅ Backup completo antes de atualizar pacotes do sistema
- ✅ Validações automáticas após atualização de dependências
- ✅ Health checks após atualização de pacotes do sistema
- ✅ Sem workarounds ou soluções temporárias

### REGRA 16: Health Checks

Após atualização de pacotes do sistema, verifica:
- ✅ Docker está rodando
- ✅ Containers críticos estão ativos
- ✅ Espaço em disco (< 90%)
- ✅ Uso de memória (< 90%)
- ✅ Logs de erros

---

## 📊 MONITORAMENTO

### Dependências

- **PRs criados:** Verificar em `Pull Requests` com label `dependencies`
- **Última atualização:** Verificar data do último commit em `pnpm-lock.yaml`

### Pacotes do Sistema

- **Issues criadas:** Verificar em `Issues` com label `system-updates`
- **Última atualização:** Verificar logs do servidor ou backup em `/opt/alice/backups/`

---

## 🚨 TROUBLESHOOTING

### Dependências

**Problema:** PR falha em TypeScript check
- **Solução:** Revisar erros de tipo, pode ser breaking change
- **Ação:** Atualizar código ou reverter dependência

**Problema:** Conflitos no `pnpm-lock.yaml`
- **Solução:** Resolver conflitos manualmente no PR
- **Ação:** `pnpm install` localmente e resolver conflitos

### Pacotes do Sistema

**Problema:** Docker não inicia após atualização
- **Solução:** Verificar logs: `journalctl -u docker`
- **Ação:** Restaurar backup se necessário

**Problema:** Containers não iniciam após atualização
- **Solução:** Verificar logs: `docker compose logs`
- **Ação:** Verificar se volumes estão intactos

**Problema:** Kernel atualizado (requer reboot)
- **Solução:** Agendar reboot em janela de manutenção
- **Ação:** `reboot` após verificar backups

---

## 📝 CHECKLIST DE ATUALIZAÇÃO MANUAL

### Antes de Atualizar Pacotes do Sistema

- [ ] Verificar backups recentes
- [ ] Agendar janela de manutenção
- [ ] Notificar usuários (se necessário)
- [ ] Verificar espaço em disco (> 10GB livre)
- [ ] Verificar logs de erros atuais

### Durante Atualização

- [ ] Executar script: `./scripts/update-system-packages.sh`
- [ ] Monitorar output para erros
- [ ] Verificar health checks

### Após Atualização

- [ ] Verificar containers: `docker ps`
- [ ] Verificar logs: `docker compose logs --tail=100`
- [ ] Testar endpoints: `curl https://yesyoudeserve.duckdns.org/api/health`
- [ ] Verificar métricas no Grafana
- [ ] Fechar issue no GitHub

---

## 🔗 ARQUIVOS RELACIONADOS

- `.github/workflows/update-dependencies.yml` - Workflow de atualização de dependências
- `.github/workflows/update-system-packages.yml` - Workflow de atualização de pacotes do sistema
- `scripts/update-system-packages.sh` - Script manual de atualização
- `docs/RELATORIO-VERSIONAMENTO-AUTOMATICO.md` - Relatório de versionamento automático

---

## ✅ COMPLIANCE COM 18 REGRAS DO CLAUDE.MD

### Regras Aplicadas

- ✅ **Regra 1 (LER ANTES DE AGIR)**: Workflows verificam código existente antes de atualizar
- ✅ **Regra 4 (APROVAÇÃO OBRIGATÓRIA)**: PRs e issues criados para revisão manual
- ✅ **Regra 6 (SEM SOLUÇÕES TEMPORÁRIAS)**: Processo enterprise-grade com backup, validações e health checks
- ✅ **Regra 9 (VALIDAÇÃO CONTÍNUA)**: TypeScript check e build após atualização de dependências
- ✅ **Regra 11 (SEGUIR DOCS OFICIAIS)**: Melhores práticas GitHub Actions 2025, SHA pinning para supply chain security
- ✅ **Regra 16 (MELHORES PRÁTICAS)**: Health checks após atualização de pacotes do sistema

### 12 Fatores App

- ✅ **I. Codebase**: Versionamento via Git, workflows versionados
- ✅ **II. Dependencies**: Dependências explicitamente declaradas (package.json, pnpm-lock.yaml)
- ✅ **III. Config**: Configuração via variáveis de ambiente e secrets
- ✅ **IV. Backing Services**: PostgreSQL, Redis tratados como recursos anexados
- ✅ **V. Build, release, run**: Separação estrita entre build, release e run
- ✅ **VI. Processes**: Aplicação stateless, dados persistidos em PostgreSQL
- ✅ **VII. Port binding**: Serviços expõem portas via Traefik
- ✅ **VIII. Concurrency**: Processos escalam horizontalmente via containers
- ✅ **IX. Disposability**: Containers podem ser iniciados/parados rapidamente
- ✅ **X. Dev/prod parity**: Ambientes similares (Docker em dev e prod)
- ✅ **XI. Logs**: Logs tratados como streams (Pino structured logging)
- ✅ **XII. Admin processes**: Scripts de atualização executados como processos one-off

---

*Este processo garante que a plataforma Alice esteja sempre atualizada com as últimas versões de pacotes, mantendo segurança e estabilidade enterprise-grade, 100% aderente às 18 regras do CLAUDE.md e aos 12 Fatores App.*

