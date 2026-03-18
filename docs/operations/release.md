# Release de Artefatos

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026

## Objetivo

Documentar o fluxo real de `Release` da Alice: prerequisitos, decisao de build versus retag, artefatos gerados e integracao com o `Deploy`.

## Workflow oficial

- Arquivo: [`.github/workflows/release.yml`](../../.github/workflows/release.yml)
- Nome do workflow: `Release & Tag`

## Preconditions

- O commit alvo precisa ter um `CI` bem-sucedido na mesma branch e no mesmo `head_sha`.
- A versao informada precisa seguir o padrao `vX.Y.Z` ou `vX.Y.Z-sufixo`.
- O registry GHCR precisa estar acessivel com credenciais validas.

## O que a Release faz

1. Valida que o `CI` ja aprovou o commit alvo.
2. Valida o formato da versao e cria a tag Git.
3. Detecta a tag anterior para reaproveitamento seguro de imagens.
4. Decide por imagem se o caminho e `build` ou `retag`.
5. Publica imagens no GHCR.
6. Gera `built_images`.
7. Gera `images-manifest.json` com `digest` e `action` por imagem.
8. Publica a GitHub Release.
9. Dispara o workflow de `Deploy` para releases normais.

## O que a Release nao faz

- Nao repete `typecheck`, `lint`, `test` ou `build` da aplicacao como gate de qualidade.
- Nao substitui a classificacao de escopo feita no `CI`.
- Nao faz deploy em prerelease.

## Build versus retag

### Fonte de verdade

- Script compartilhado: [`scripts/release-functions.sh`](../../scripts/release-functions.sh)
- Workflow: [`.github/workflows/release.yml`](../../.github/workflows/release.yml)

### Regras operacionais

- Se nao houver tag anterior, o comportamento e conservador: build de tudo.
- Se o release anterior nao tiver manifesto de imagens, o workflow ativa `FORCE_FULL_REBUILD`.
- Mudancas globais de build, lockfile ou bases TypeScript podem forcar rebuild amplo.
- Mudancas em `packages/*` expandem o impacto para os microservicos Node dependentes.
- Na ausencia de impacto relevante, a `Release` retaggeia a imagem da tag anterior em vez de rebuildar.

## `built_images`

`built_images` e a saida que informa ao `Deploy` quais imagens foram realmente buildadas nesta `Release`.

| Valor | Significado |
| --- | --- |
| lista CSV, ex: `auth,chat,rag` | essas imagens foram buildadas; as demais foram retaggeadas |
| `__NONE__` | a release rodou, mas nenhuma imagem precisou de build |
| vazio | caso de deploy manual, sem contexto de release anterior |

## Manifesto de imagens

### Arquivo

- Nome: `images-manifest.json`
- Origem: anexado como asset da GitHub Release

### Conteudo

O manifesto registra, para cada imagem publicada:

- nome logico do servico
- referencia completa da imagem
- `digest` esperado no GHCR
- `action` (`build` ou `retag`)

### Papel na pipeline

- O `Deploy` baixa esse manifesto para `/opt/alice/manifests/images-manifest.json`.
- `infra/scripts/deploy-functions.sh` prioriza o manifesto para decidir `skip`, `retag local` ou `pull`.
- Quando o manifesto nao existe, o deploy cai para a logica legada baseada em `built_images`.

## Prerelease

- `prerelease=true` publica a release como prerelease.
- O job `build-images` nao entra no fluxo produtivo normal.
- O job `trigger-deploy` nao roda para prerelease.
- O workflow ainda publica a release com manifesto minimo quando necessario.

## Relacao com tipos de mudanca

- `docs-only` e `pipeline-only` nao chegam automaticamente na `Release` porque nao sao `release-eligible`.
- `release-eligible` depende de ao menos uma mudanca fora de documentacao e fora do conjunto pipeline-only.
- Ainda que alguem dispare a `Release` manualmente, o guard de `CI` continua obrigatorio para o commit alvo.

## Saidas esperadas

- tag Git criada
- GitHub Release publicada
- imagens publicadas ou retaggeadas no GHCR
- `built_images`
- `images-manifest.json`
- `workflow_dispatch` do `Deploy` para releases normais

## Referencias

- [docs/engineering/pipeline-overview.md](../engineering/pipeline-overview.md)
- [docs/engineering/pull-inteligente-flow.md](../engineering/pull-inteligente-flow.md)
- [docs/operations/deploy.md](deploy.md)
