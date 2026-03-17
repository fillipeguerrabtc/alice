# AGENTS.md - Guia Operacional de Agentes do Projeto Alice

**Author:** Fillipe Guerra
**Data:** 17 de Marco de 2026
**Atualizado:** 17 de Marco de 2026

## Objetivo

Definir as regras permanentes para agentes que atuam no repositorio `/mnt/c/APPs/alice`.

## Precedencia obrigatoria

1. Instrucoes de sistema, developer e do bloco atual pedido pelo usuario.
2. [AGENTS.md](AGENTS.md) para regras operacionais especificas deste repositorio.
3. [CLAUDE.md](CLAUDE.md) para convencoes permanentes de engenharia, arquitetura e entrega.
4. [docs/INDEX.md](docs/INDEX.md) para navegacao e classificacao documental.
5. Documentacao canonica tematica em `docs/` para o conteudo tecnico vigente.
6. Planos, rollouts, status, relatorios, reviews e [docs/archive/](docs/archive/) servem como contexto e historico, nunca como override do SSOT vigente.

Se houver conflito entre documentos do mesmo nivel, prevalece o mais especifico para o escopo afetado.

## Regras permanentes

- Ler o codigo e a documentacao existentes antes de planejar ou implementar.
- Trabalhar apenas no escopo solicitado, com mudancas cirurgicas e sem tocar em triggers de workflow.
- Sao proibidos mocks, stubs, placeholders, hardcoded, in-memory e workarounds.
- Priorizar evidencia real de repositorio, logs e comandos sobre suposicoes.
- Nao remover validacoes, guardrails de seguranca ou mudancas do usuario sem autorizacao explicita.
- Seguir a documentacao oficial e os padroes ja adotados no repositorio.
- Conferir secrets e variaveis existentes antes de introduzir novas dependencias.
- Respeitar a arquitetura do monorepo: servicos em `apps/` e compartilhamento em `packages/`.

## Idioma e comunicacao

- Documentacao, comentarios de codigo e logs em Portugues Brasileiro.
- Variaveis, identificadores e nomes de tipos em English.
- Termos tecnicos podem permanecer em English.

## Encerramento obrigatorio

- Validar o que foi modificado de forma sequencial: typecheck, testes, lint e build.
- Corrigir integralmente erros e warnings, inclusive nao bloqueantes.
- Atualizar a documentacao impactada em Portugues Brasileiro com `Author` e data atual.
- Criar commit consolidado em English.
- Nunca fazer push automatico.

## Referencias canonicas

- [CLAUDE.md](CLAUDE.md)
- [docs/INDEX.md](docs/INDEX.md)
- [.github/workflows/deploy-stack-modular.yml](.github/workflows/deploy-stack-modular.yml)
- [infra/scripts/permissions-config.sh](infra/scripts/permissions-config.sh)
