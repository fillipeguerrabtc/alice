# Getting Started Operacional

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026
**Status:** ativo
**Tipo:** onboarding

## Objetivo

Ser o onboarding tecnico curto da Alice para quem vai usar o repositorio, operar o ambiente real ou iniciar a trilha de treinamento sem precisar navegar por manuais longos.

## Para quem este guia serve

- Quem acabou de entrar no projeto e precisa localizar o SSOT certo.
- Quem vai subir o ambiente local ou revisar configuracao real.
- Quem vai operar treinamento, namespaces, agentes ou dados aprovados pela primeira vez.

## Checklist de inicio rapido

1. Ler a governanca e a navegacao:
   - [../INDEX.md](../INDEX.md)
   - [../../AGENTS.md](../../AGENTS.md)
   - [../../CLAUDE.md](../../CLAUDE.md)
2. Instalar dependencias do monorepo:

   ```bash
   pnpm install
   ```

3. Configurar secrets e acessos reais:
   - [secrets.md](secrets.md)
   - [permissions.md](permissions.md)
4. Iniciar o fluxo local quando o escopo for desenvolvimento:

   ```bash
   pnpm dev
   ```

5. Entender como a esteira trata `docs-only`, `pipeline-only` e `release-eligible`:
   - [deployment.md](deployment.md)
   - [../engineering/validation-monorepo.md](../engineering/validation-monorepo.md)

## Onboarding por uso real

### Operar o produto

1. Validar secrets e permissoes do ambiente.
2. Confirmar stacks e topologia em [../architecture/platform.md](../architecture/platform.md).
3. Usar [deploy.md](deploy.md) e [release.md](release.md) quando a demanda for publicacao ou recuperacao operacional.

### Trabalhar com agentes, namespaces e treinamento

1. Entender a diferenca entre `RAG` e `Training` em [../product/training-business-guide.md](../product/training-business-guide.md).
2. Ler o panorama tecnico em [training/overview.md](training/overview.md).
3. Revisar o modelo de aprendizado em [training/learning-system.md](training/learning-system.md).
4. Conferir limites e governanca antes de alterar configuracao:
   - [training/reference-limits.md](training/reference-limits.md)
   - [training/auto-collect-governance.md](training/auto-collect-governance.md)
5. Usar o runbook de GPU apenas quando houver necessidade operacional real:
   - [runbooks/training-gpu-validation.md](runbooks/training-gpu-validation.md)

## O que este guia nao faz

- Nao substitui [secrets.md](secrets.md) nem [permissions.md](permissions.md).
- Nao descreve passo a passo de deploy em producao.
- Nao replica templates longos de prompt, historico de rodadas ou checklist de incidente.

## Referencias principais

- [../architecture/platform.md](../architecture/platform.md)
- [deployment.md](deployment.md)
- [training/overview.md](training/overview.md)
- [../status/current-platform-status.md](../status/current-platform-status.md)
