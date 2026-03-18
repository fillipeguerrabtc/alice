# CLAUDE.md - SSOT de Engenharia e Operacao da Alice

**Author:** Fillipe Guerra
**Data:** 17 de Marco de 2026
**Atualizado:** 18 de Marco de 2026
**Status:** ativo
**Tipo:** governanca

## Objetivo

Consolidar as convencoes permanentes de engenharia, arquitetura, documentacao e entrega do projeto Alice.

## Precedencia documental

1. Instrucoes ativas de sistema, developer e usuario no bloco atual.
2. [AGENTS.md](AGENTS.md) para regras operacionais especificas de agentes neste repositorio.
3. [CLAUDE.md](CLAUDE.md) para convencoes duraveis de engenharia e operacao.
4. [docs/INDEX.md](docs/INDEX.md) como portal de navegacao e regra editorial de precedencia.
5. Documentos canonicos tematicos em `docs/` como SSOT tecnico vigente.
6. Planos, status, rollouts, relatorios e [docs/archive/INDEX.md](docs/archive/INDEX.md) como contexto temporal e historico, sem precedencia sobre o SSOT vigente.

## Regras fundamentais

- Ler antes de agir e verificar se ja existe implementacao ou documento equivalente.
- Nao duplicar solucao, logica ou fonte de verdade sem necessidade real.
- Manter workflow estruturado: diagnostico, plano, implementacao cirurgica e validacao.
- Executar somente o escopo pedido; nao expandir trabalho por conta propria.
- Dizer claramente quando algo nao puder ser afirmado com seguranca.
- Nao usar workarounds, mocks, hardcoded, placeholders ou persistencia falsa.
- Priorizar causa raiz, impacto conhecido e mudanca isolada.
- Manter TypeScript strict, zero `any` deliberado e logging padrao com Pino.
- Separar responsabilidades da pipeline: CI valida qualidade, Release publica artefatos aprovados sem repetir o gate do CI e Deploy implanta os artefatos publicados.
- Validar continuamente e fechar cada bloco com zero erros e zero warnings.
- Manter documentacao em Portugues Brasileiro e seguir docs oficiais.
- Conferir secrets e variaveis existentes antes de adicionar configuracoes novas.
- Fazer commit consolidado em English antes de qualquer review ou push; push e sempre manual do usuario.

## Contexto estavel do projeto

- Desenvolvimento e producao operam com integracoes reais; mocks e previews nao fazem parte do fluxo oficial.
- A arquitetura e modular e multi-stack, com separacao entre `INFRA`, `ALICE`, `OBSERVABILITY` e `BACKUP`.
- A identificacao dos servidores de `Deploy` (Runner) e `Producao`, assim como as indicacoes corretas de acesso SSH, ficam em [docs/operations/servers.md](docs/operations/servers.md).
- Redes e volumes compartilhados entre stacks devem permanecer `external: true`, com rollback cirurgico por stack.
- O workflow recomendado de deploy e [.github/workflows/deploy-stack-modular.yml](.github/workflows/deploy-stack-modular.yml).
- O SSOT de permissoes operacionais e [infra/scripts/permissions-config.sh](infra/scripts/permissions-config.sh).
- Servicos vivem em `apps/`; codigo compartilhado vive em `packages/`.

## Modelo documental

- [README.md](README.md) e onboarding e ponto de entrada, nao SSOT tecnico.
- [AGENTS.md](AGENTS.md) governa como agentes devem operar neste repositorio.
- [docs/INDEX.md](docs/INDEX.md) define navegacao, classificacao e precedencia editorial.
- Documentos tematicos canonicos em [docs/INDEX.md](docs/INDEX.md) concentram a verdade tecnica vigente.
- Planos, status, rollouts, reviews e relatorios sao documentos temporais de acompanhamento.
- [docs/archive/INDEX.md](docs/archive/INDEX.md) preserva historico e nunca prevalece sobre documentos vigentes.

## Fechamento obrigatorio

- Em mudancas exclusivamente documentais, validar somente o conteudo e a consistencia do que foi alterado; nao executar typecheck, testes, lint ou build de codigo.
- Em mudancas de codigo, executar typecheck, testes, lint e build somente no escopo alterado.
- Executar validacao full apenas quando a necessidade estiver explicita pelo escopo, impacto ou dependencia cruzada.
- Corrigir todos os erros e warnings das validacoes executadas antes de encerrar o bloco.
- Atualizar a documentacao necessaria em Portugues Brasileiro com `Author` e data atual.
- Criar commit consolidado em English.
- Nao realizar push sem comando explicito do usuario.
