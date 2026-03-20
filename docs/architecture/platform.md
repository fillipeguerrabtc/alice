# Arquitetura da Plataforma Alice

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 20 de Marco de 2026
**Status:** ativo
**Tipo:** ssot

## Objetivo

Descrever a arquitetura estrutural vigente da plataforma Alice sem misturar procedimento operacional, historico de correcoes ou runbooks.

## Escopo e limites

- Este documento cobre a topologia da plataforma, seus boundaries e os fluxos principais entre stacks, servicos e dependencias.
- Procedimentos de `CI`, `Release` e `Deploy` ficam em [docs/engineering/pipeline-overview.md](../engineering/pipeline-overview.md), [docs/operations/release.md](../operations/release.md) e [docs/operations/deploy.md](../operations/deploy.md).
- Observabilidade, permissoes, secrets e runbooks ficam na trilha `docs/operations/`.
- Dominios especializados ficam nos seus SSOTs proprios, como [docs/architecture/gpu-manager.md](gpu-manager.md) e [docs/trading/INDEX.md](../trading/INDEX.md).

## Principios arquiteturais

- Monorepo modular com servicos em `apps/` e compartilhamento em `packages/`.
- Separacao de responsabilidade entre stacks `INFRA`, `ALICE`, `OBSERVABILITY` e `BACKUP`.
- Integracoes reais, sem mocks ou persistencia in-memory no fluxo oficial.
- Deploy por stack com rollback cirurgico e artefatos publicados pela `Release`.
- Observabilidade e seguranca tratadas como capacidade transversal, nao como detalhe de implementacao local.
- Conteudo sensivel e segregado por `tenant + ownership/grant + policy`, com `private by default`.
- Autonomia agentic sempre opera como delegacao do usuario autenticado, nunca como elevacao implicita de privilegio.
- Fluxos agentic sensiveis usam capability catalog, approval transacional e token delegado single-use revalidado no servico alvo.

## Topologia macro

### Monorepo

| Area | Local | Responsabilidade |
| --- | --- | --- |
| Aplicacoes | `apps/` | microsservicos e frontend |
| Pacotes compartilhados | `packages/` | tipos, config, logger, database e utilitarios |
| Infraestrutura | `infra/` | compose stacks, provisionamento, scripts operacionais |
| Documentacao | `docs/` | SSOTs, runbooks e historico arquivado |

### Stacks de producao

| Stack | Compose principal | Papel |
| --- | --- | --- |
| `INFRA` | `infra/docker/stacks/docker-compose.infra.yml` | dados, rede base, cache, reverse proxy e dependencias comuns |
| `ALICE` | `infra/docker/stacks/docker-compose.alice.yml` | servicos de produto, orquestracao de IA e runtime principal |
| `OBSERVABILITY` | `infra/docker/stacks/docker-compose.observability.yml` | metricas, logs, traces, dashboards e alerting |
| `BACKUP` | `infra/docker/stacks/docker-compose.backup.yml` | pgBackRest e rotinas de backup/restore |

## Mapa de servicos

### Borda e experiencia

| Servico | Funcao |
| --- | --- |
| `alice-caddy` | entrada HTTP/HTTPS, roteamento publico e terminacao TLS |
| `alice-frontend` | SPA React do produto |

### Identidade e acesso

| Servico | Funcao |
| --- | --- |
| `alice-auth` | autenticacao, autorizacao, RBAC e SSO |
| `alice-biometrics` | biometria usada pelo fluxo de autenticacao |

### Orquestracao aplicacional

| Servico | Funcao |
| --- | --- |
| `alice-chat` | chat, streaming e composicao da experiencia principal |
| `alice-llm-gateway` | roteamento LLM por contexto e politicas de acesso |
| `alice-integrations` | integracoes externas, trading, Stripe, Twilio e conectores |
| `alice-observability` | health endpoints, rotinas operacionais e backup orchestration |

### Conhecimento, treinamento e GPU

| Servico | Funcao |
| --- | --- |
| `alice-rag` | ingestao, indexacao e recuperacao semantica |
| `alice-training` | coleta, governanca e jobs de treinamento |
| `alice-gpu-manager` | arbitragem de capacidade GPU e fila priorizada |
| `gpu-llm` | inferencia de texto |
| `gpu-embeddings` | embeddings de texto |
| `qwen-trainer` | treino on-demand sob profile `gpu-training` |

### Dados e suporte

| Componente | Papel |
| --- | --- |
| PostgreSQL | persistencia transacional principal |
| Redis | cache, filas e coordenacao |
| Qdrant | indice vetorial |
| MinIO | artefatos e object storage auxiliar |
| SearXNG + Tor | busca web e casos com proxy dedicado |

## Fluxos estruturais

### Fluxo de usuario

1. O usuario entra pela borda `alice-caddy`.
2. A SPA em `alice-frontend` consome APIs e canais de streaming.
3. `alice-auth` protege sessao, identidade e autorizacao.
4. `alice-chat` coordena resposta, consulta `alice-rag`, `alice-integrations`, `alice-training` e `alice-llm-gateway` quando necessario.
5. `alice-gpu-manager` encaminha chamadas para `gpu-llm`, `gpu-embeddings` ou `qwen-trainer` conforme a capacidade ativa.

### Fluxo agentic delegado

1. A dashboard continua sendo a fonte de verdade das permissoes efetivas do usuario.
2. `alice-chat` resolve o mesmo envelope efetivo, aplica `Capability Layer` e reduz as tools expostas ao modelo para o subconjunto autorizado.
3. Quando a acao e sensivel, o chat calcula `payloadHash`, exige approval/step-up/dual control quando aplicavel e emite `delegated_execution_token`.
4. `alice-integrations` e demais servicos alvo atuam como PEP downstream, recusando chamada interna sem token delegado ou com token divergente.
5. Revogacao de permissao, grants ou governanca invalida o token antes da execucao final.

### Fluxo de conhecimento

1. Documentos e eventos entram em `alice-rag` e `alice-training`.
2. O processamento usa PostgreSQL, Redis, Qdrant e GPU para indexacao e enriquecimento.
3. O material aprovado pode alimentar treinamento, adapters e recuperacao contextual.
4. Ownership, grants e visibilidade acompanham o recurso no banco, cache, storage e payload vetorial.

## Boundary de segregacao de conteudo

- O isolamento estrutural de conteudo nao termina no tenant; recursos privados exigem ownership ou grant explicito.
- `RLS + FORCE RLS`, helper aplicacional de autorizacao e filtros vetoriais na origem formam o enforcement canonico.
- Cache, storage e training seguem o mesmo boundary para evitar mistura cross-user.
- O SSOT detalhado desta trilha fica em [docs/architecture/content-segregation.md](content-segregation.md).

### Fluxo operacional

1. `CI` valida o commit elegivel.
2. `Release` publica artefatos aprovados e descreve o que foi buildado ou retaggeado.
3. `Deploy` implanta por stack os artefatos publicados, faz preflight, health check e rollback quando necessario.

## Boundaries documentais

- Arquitetura geral de plataforma: este documento.
- Arquitetura especializada de GPU: [docs/architecture/gpu-manager.md](gpu-manager.md).
- Segregacao de conteudo e grants: [docs/architecture/content-segregation.md](content-segregation.md).
- Pipeline e classificacao de mudancas: [docs/engineering/pipeline-overview.md](../engineering/pipeline-overview.md).
- Deployment operacional: [docs/operations/deployment.md](../operations/deployment.md).
- Observabilidade: [docs/operations/observability.md](../operations/observability.md).
- Permissoes: [docs/operations/permissions.md](../operations/permissions.md).
- Secrets: [docs/operations/secrets.md](../operations/secrets.md).

## SSOTs relacionados

- [docs/architecture/gpu-manager.md](gpu-manager.md)
- [docs/architecture/content-segregation.md](content-segregation.md)
- [docs/trading/INDEX.md](../trading/INDEX.md)
- [docs/operations/deployment.md](../operations/deployment.md)
- [docs/operations/observability.md](../operations/observability.md)
- [docs/engineering/pipeline-overview.md](../engineering/pipeline-overview.md)
