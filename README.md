# Alice

**Author:** Fillipe Guerra
**Data:** 17 de Marco de 2026
**Atualizado:** 17 de Marco de 2026

## Visao geral

Alice e uma plataforma enterprise de IA autonoma com arquitetura modular de microsservicos, foco em financas e trading, e operacao com integracoes reais. Este `README.md` e apenas a porta de entrada: a navegacao documental vive em [docs/INDEX.md](docs/INDEX.md), e a governanca para agentes vive em [AGENTS.md](AGENTS.md) e [CLAUDE.md](CLAUDE.md).

## Quick start

1. Instale as dependencias do monorepo:

   ```bash
   pnpm install
   ```

2. Configure ambiente e secrets reais:
   - [docs/GUIA-CONFIGURACAO-INICIAL.md](docs/GUIA-CONFIGURACAO-INICIAL.md)
   - [docs/SECRETS.md](docs/SECRETS.md)

3. Inicie o fluxo local do repositorio:

   ```bash
   pnpm dev
   ```

4. Antes de encerrar qualquer mudanca, siga a validacao incremental e a esteira de entrega:
   - [docs/VALIDACAO-INCREMENTAL-MONOREPO.md](docs/VALIDACAO-INCREMENTAL-MONOREPO.md)
   - [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

> O fluxo local e a producao exigem integracoes reais. Nao use mocks, stubs ou placeholders.

## Mapa de documentacao

- Entrada e governanca: [README.md](README.md), [AGENTS.md](AGENTS.md), [CLAUDE.md](CLAUDE.md), [docs/INDEX.md](docs/INDEX.md)
- Arquitetura: [docs/ARQUITETURA.md](docs/ARQUITETURA.md), [docs/ARQUITETURA-GPU-MANAGER.md](docs/ARQUITETURA-GPU-MANAGER.md)
- Operacao e deploy: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), [docs/OBSERVABILITY.md](docs/OBSERVABILITY.md)
- Configuracao e seguranca: [docs/GUIA-CONFIGURACAO-INICIAL.md](docs/GUIA-CONFIGURACAO-INICIAL.md), [docs/SECRETS.md](docs/SECRETS.md), [docs/PERMISSIONS.md](docs/PERMISSIONS.md)
- Validacao de engenharia: [docs/VALIDACAO-INCREMENTAL-MONOREPO.md](docs/VALIDACAO-INCREMENTAL-MONOREPO.md)
- Contexto temporal ativo: [docs/STATUS-REAL-ATUAL.md](docs/STATUS-REAL-ATUAL.md), [docs/ROADMAP.md](docs/ROADMAP.md), [docs/documentation-refactor-rollout.md](docs/documentation-refactor-rollout.md)
- Historico arquivado: [docs/archive/INDEX.md](docs/archive/INDEX.md)

## Links canonicos principais

- Portal documental: [docs/INDEX.md](docs/INDEX.md)
- Guia operacional para agentes: [AGENTS.md](AGENTS.md)
- SSOT de engenharia e operacao: [CLAUDE.md](CLAUDE.md)
- Arquitetura da plataforma: [docs/ARQUITETURA.md](docs/ARQUITETURA.md)
- Deploy e release: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- Secrets e configuracao: [docs/SECRETS.md](docs/SECRETS.md)

[README.md](README.md) nao substitui SSOT tecnico. Em caso de duvida, use [docs/INDEX.md](docs/INDEX.md) para localizar o documento vigente e sua precedencia.
