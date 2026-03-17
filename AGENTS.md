# AGENTS.md - Instrucoes Operacionais do Projeto Alice

**Author:** Fillipe Guerra  
**Data:** 11 de Marco de 2026
**Atualizado:** 17 de Marco de 2026

## Objetivo
Este arquivo define regras permanentes para agentes Codex no repositorio `/mnt/c/APPs/alice`.
As instrucoes abaixo devem ser tratadas como obrigatorias em toda atividade.

## Regras Quotidianas (Obrigatorias)
- Aja como especialista com honestidade e transparencia.
- NUNCA tocar em gatilhos/triggers de workflows durante consertos; realizar apenas mudancas cirurgicas.
- SAO PROIBIDOS: stubs, placeholders, workarounds, mocks, hardcoded, in-memory, ou qualquer codigo nivel MVP.
- Verificar sempre o codigo existente antes de planejar e antes de implementar; nao reinventar a roda.
- Garantir 100% de aderencia as 18 regras fundamentais do CLAUDE.md.
- Ao ler arquivos grandes ou logs extensos, ler em chunks de 200-300 linhas.
- Ao final de cada bloco/rodada, executar separadamente (um por vez, sem paralelizar): typecheck, testes, eslint e build dos componentes modificados.
- Corrigir todos os erros/warnings encontrados ate atingir zero erros e zero warnings, inclusive nao bloqueantes.
- Ao final de cada bloco/rodada, atualizar a documentacao necessaria em Portugues Brasileiro (termos tecnicos podem ficar em ingles), sempre com Author e data atual.
- Ao final de cada bloco/rodada, realizar commit consolidado em ingles.
- NUNCA fazer push automatico; push e sempre manual pelo usuario.

## 18 Regras Fundamentais (SSOT resumido do CLAUDE.md)
1. LER ANTES DE AGIR: inspecionar arquivos antes de implementar.
2. NAO DUPLICAR: verificar codigo existente primeiro.
3. WORKFLOW ESTRUTURADO: diagnostico -> plano -> aprovacao -> implementacao.
4. FIDELIDADE AO ESCOPO: executar somente o que foi solicitado no prompt, sem adicionar, remover ou expandir o escopo por conta propria.
5. NAO MENTIR: dizer "nao sei" quando nao souber.
6. SEM SOLUCOES TEMPORARIAS: proibido workaround/mock/hardcoded/in-memory/default falso; persistencia real em PostgreSQL.
7. MUDANCAS CIRURGICAS: causa raiz primeiro, impacto avaliado, mudanca isolada.
8. QUALIDADE OBRIGATORIA: TypeScript strict, zero `any`, logging com Pino.
9. VALIDACAO CONTINUA: validar apos cada micro-passo.
10. DOCUMENTACAO PT-BR: documentacao em Portugues Brasileiro.
11. SEGUIR DOCS OFICIAIS: aderencia a documentacao oficial e melhores praticas.
12. (numero nao utilizado no CLAUDE.md atual)
13. INTERNACIONALIZACAO: PT-BR primario, EN secundario.
14. VERIFICAR SECRETS: conferir variaveis e segredos existentes.
15. MICROSSERVICOS: codigo em `apps/`, compartilhado em `packages/`.
16. MELHORES PRATICAS: API Gateway, health checks, circuit breakers.
17. REVIEW APOS COMMIT: commit consolidado primeiro; review automatica/humana depois.
18. COMMITS CONSOLIDADOS E PUSH MANUAL: commit em ingles, sem push automatico.

## Idioma e Padroes de Comunicacao
- Documentacao: Portugues Brasileiro.
- Comentarios de codigo: Portugues Brasileiro.
- Logs: Portugues Brasileiro.
- Nomes de variaveis: Ingles.
- Termos tecnicos (OAuth, JWT etc.): Ingles.

## Ambiente e Arquitetura (Critico)
- Desenvolvimento: Cursor IDE com integracoes reais; proibido mock/preview.
- Producao: Hetzner Cloud GPU; proibido mock/hardcoded.
- Arquitetura: multi-stack modular (INFRA, ALICE, OBSERVABILITY, BACKUP).
- Workflow recomendado de deploy: `.github/workflows/deploy-stack-modular.yml`.
- Ordem de deploy base: `validate` -> `prepare` -> `deploy-infra` -> `health-*` -> `rollback-*` -> `notify`.
- Redes/volumes compartilhados entre stacks sao `external: true`; rollback deve ser cirurgico por stack.

## Regras Operacionais de Engenharia
- Fazer mudancas minimas e isoladas.
- Nao alterar comportamento fora do escopo.
- Nao remover protecoes de seguranca/validacao.
- Nao reverter mudancas do usuario sem solicitacao explicita.
- Em investigacoes, priorizar evidencias reais (logs/comandos) sobre suposicoes.

## SSH e Servidores (Producao e Deploy)
```bash
# Chaves SSH locais (Windows):
# C:\Users\filli\.ssh (exemplo de chave: alice-deploy)

# Producao (Hetzner GEX44 GPU)
ssh -i ~/.ssh/alice-deploy root@178.63.41.108

# Deploy Server (runner)
ssh -i ~/.ssh/alice-deploy root@46.224.46.93
```

## Informacoes de Deploy Relevantes
- Producao: `178.63.41.108`
- Deploy server: `46.224.46.93`
- Dominio principal: `yesyoudeserve.duckdns.org`
- Caminho de app no servidor: `/opt/alice/app`
- Stacks docker compose: `infra/docker/stacks/`
- SSOT de permissoes: `infra/scripts/permissions-config.sh`
- UID/GID de PostgreSQL em Alpine: `70:70`

## Checklist Obrigatorio Antes de Encerrar uma Rodada
1. Confirmar causa raiz com evidencias.
2. Implementar mudanca cirurgica sem tocar em triggers de workflow.
3. Executar validacoes necessarias de forma sequencial (um por vez) para o que foi modificado.
4. Corrigir integralmente erros e warnings.
5. Atualizar documentacao necessaria em PT-BR com Author e data.
6. Criar commit consolidado em ingles.
7. Nao realizar push; aguardar comando manual do usuario.

## Fonte de Verdade
- Este arquivo e um guia operacional rapido para agentes.
- Para detalhes completos, consultar `CLAUDE.md` (especialmente as primeiras 100 linhas e secoes de deploy/SSH).
