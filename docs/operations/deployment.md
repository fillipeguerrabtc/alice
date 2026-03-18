# Entrega Operacional

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026
**Status:** ativo
**Tipo:** ssot

## Objetivo

Ser o ponto de entrada da entrega operacional da Alice, separando claramente o que e `CI`, `Release` e `Deploy`, quais mudancas seguem para publicacao e onde ficam os procedimentos detalhados.

## Mapa da trilha

| Assunto | Documento |
| --- | --- |
| Pipeline de ponta a ponta | [docs/engineering/pipeline-overview.md](../engineering/pipeline-overview.md) |
| Release de artefatos | [docs/operations/release.md](release.md) |
| Deploy em producao | [docs/operations/deploy.md](deploy.md) |
| Smart pull e `built_images` | [docs/engineering/pull-inteligente-flow.md](../engineering/pull-inteligente-flow.md) |
| Validacao incremental do monorepo | [docs/engineering/validation-monorepo.md](../engineering/validation-monorepo.md) |
| Observabilidade e SLOs | [docs/operations/observability.md](observability.md) |
| Runbooks operacionais | [docs/operations/runbooks/INDEX.md](runbooks/INDEX.md) |

## Responsabilidades da esteira

| Etapa | Responsabilidade | Nao faz |
| --- | --- | --- |
| `CI` | valida qualidade, seguranca e governanca do commit elegivel | nao publica artefatos de producao |
| `Release` | cria tag, publica imagens e release notes, gera manifesto e dispara deploy normal | nao repete `typecheck`, `lint`, `test` ou `build` do `CI` |
| `Deploy` | implanta artefatos publicados, executa preflight, health check e rollback por stack | nao substitui o gate de qualidade do `CI` |

## Tipos de mudanca e efeito na esteira

| Tipo | Definicao operacional | Validacao | `Release` / `Deploy` |
| --- | --- | --- | --- |
| `docs-only` | todos os arquivos alterados sao documentacao | validacao documental e de coerencia apenas | nao segue automaticamente |
| `pipeline-only` | alteracoes restritas a `.github/workflows/`, `.github/actions/` ou `.github/.workflow-test` | revisao da esteira; sem gate de codigo da aplicacao | nao segue automaticamente |
| `release-eligible` | existe ao menos um arquivo alterado fora de documentacao e fora de pipeline-only | `CI` incremental ou full fallback, conforme o escopo | pode seguir para `Release` e `Deploy` |

## Regras vigentes

- Mudancas exclusivamente documentais nao executam `typecheck`, `lint`, `test` ou `build`.
- Mudancas apenas de pipeline nao seguem para `Release` nem `Deploy`.
- `Release` exige `CI` previo bem-sucedido para o mesmo commit alvo.
- `Release` nao duplica o gate de qualidade do `CI`.
- `Deploy` trabalha com artefatos ja publicados pela `Release`.

## Topologia de producao

| Stack | Compose | Papel |
| --- | --- | --- |
| `INFRA` | `infra/docker/stacks/docker-compose.infra.yml` | base de dados, cache, rede, Caddy, MinIO, SearXNG e dependencias compartilhadas |
| `ALICE` | `infra/docker/stacks/docker-compose.alice.yml` | servicos de produto, treinamento e runtime GPU |
| `OBSERVABILITY` | `infra/docker/stacks/docker-compose.observability.yml` | Prometheus, Grafana, Loki, Jaeger, Langfuse, Vector e ClickHouse |
| `BACKUP` | `infra/docker/stacks/docker-compose.backup.yml` | pgBackRest e rotinas de restore |

## Artefatos e sinais usados pela entrega

| Artefato | Origem | Uso |
| --- | --- | --- |
| tag semantica `vX.Y.Z` | `Release` | referencia imutavel do artefato publicado |
| `built_images` | `Release` | informa ao `Deploy` o que foi buildado de fato versus retag |
| `images-manifest.json` | `Release` | permite smart pull por digest no servidor |
| `.env.prod` | `Deploy` | consolidacao fail-fast de secrets e versoes antes do compose |

## SSH e execucao remota

- A action local [`.github/actions/hetzner-ssh`](../../.github/actions/hetzner-ssh/action.yml) centraliza parte relevante dos comandos remotos.
- A centralizacao ainda e parcial: transferencia de arquivos, download de manifesto e alguns passos de captura continuam usando `ssh` e `scp` diretos.
- O SSOT documental deve refletir essa centralizacao parcial, nunca afirmar que todo o deploy remoto ja foi encapsulado pela action local.

## Referencias operacionais

- [docs/operations/release.md](release.md)
- [docs/operations/deploy.md](deploy.md)
- [docs/operations/secrets.md](secrets.md)
- [docs/operations/permissions.md](permissions.md)
- [docs/operations/observability.md](observability.md)
- [docs/operations/runbooks/INDEX.md](runbooks/INDEX.md)
