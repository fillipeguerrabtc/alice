# Alice

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026

## Visao geral

Alice e uma plataforma enterprise de IA autonoma com arquitetura modular de microsservicos, foco em financas e trading, e operacao com integracoes reais. Este `README.md` e apenas a porta de entrada: a navegacao documental vive em [docs/INDEX.md](docs/INDEX.md), e a governanca para agentes vive em [AGENTS.md](AGENTS.md) e [CLAUDE.md](CLAUDE.md).

## Quick start

1. Instale as dependencias do monorepo:

   ```bash
   pnpm install
   ```

2. Configure ambiente e secrets reais:
   - [docs/operations/getting-started.md](docs/operations/getting-started.md)
   - [docs/operations/secrets.md](docs/operations/secrets.md)

3. Inicie o fluxo local do repositorio:

   ```bash
   pnpm dev
   ```

4. Antes de encerrar qualquer mudanca, siga a validacao incremental e a esteira de entrega:
   - [docs/engineering/validation-monorepo.md](docs/engineering/validation-monorepo.md)
   - [docs/operations/deployment.md](docs/operations/deployment.md)

> O fluxo local e a producao exigem integracoes reais. Nao use mocks, stubs ou placeholders.

## Mapa de documentacao

- Entrada e governanca: [README.md](README.md), [AGENTS.md](AGENTS.md), [CLAUDE.md](CLAUDE.md), [docs/INDEX.md](docs/INDEX.md)
- Arquitetura: [docs/architecture/platform.md](docs/architecture/platform.md), [docs/architecture/gpu-manager.md](docs/architecture/gpu-manager.md)
- Operacao e deploy: [docs/operations/deployment.md](docs/operations/deployment.md), [docs/operations/observability.md](docs/operations/observability.md)
- Configuracao e seguranca: [docs/operations/getting-started.md](docs/operations/getting-started.md), [docs/operations/secrets.md](docs/operations/secrets.md), [docs/operations/permissions.md](docs/operations/permissions.md)
- Validacao de engenharia: [docs/engineering/validation-monorepo.md](docs/engineering/validation-monorepo.md)
- Contexto temporal ativo: [docs/status/current-platform-status.md](docs/status/current-platform-status.md), [docs/status/roadmap.md](docs/status/roadmap.md), [docs/documentation-refactor-rollout.md](docs/documentation-refactor-rollout.md)
- Historico arquivado: [docs/archive/INDEX.md](docs/archive/INDEX.md)

## Links canonicos principais

- Portal documental: [docs/INDEX.md](docs/INDEX.md)
- Guia operacional para agentes: [AGENTS.md](AGENTS.md)
- SSOT de engenharia e operacao: [CLAUDE.md](CLAUDE.md)
- Arquitetura da plataforma: [docs/architecture/platform.md](docs/architecture/platform.md)
- Deploy e release: [docs/operations/deployment.md](docs/operations/deployment.md)
- Secrets e configuracao: [docs/operations/secrets.md](docs/operations/secrets.md)

[README.md](README.md) nao substitui SSOT tecnico. Em caso de duvida, use [docs/INDEX.md](docs/INDEX.md) para localizar o documento vigente e sua precedencia.
