# Smart Pull e Fluxo de Decisao

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026
**Status:** ativo
**Tipo:** ssot

## Objetivo

Explicar como o `Deploy` decide entre `skip`, `retag local` e `pull`, usando `built_images` e, quando disponivel, o manifesto de imagens da `Release`.

## Fontes de verdade

- Workflow de release: [`.github/workflows/release.yml`](../../.github/workflows/release.yml)
- Workflow de deploy: [`.github/workflows/deploy-stack-modular.yml`](../../.github/workflows/deploy-stack-modular.yml)
- Script de decisao: [`infra/scripts/deploy-functions.sh`](../../infra/scripts/deploy-functions.sh)

## Conceitos

### Smart pull

Decisao por imagem no servidor para evitar download desnecessario e impedir uso de artefato stale.

### Selective pull

Otimizacao do workflow de deploy que verifica no GHCR apenas as imagens que realmente foram buildadas na `Release`.

### `built_images`

Sinal emitido pela `Release` que informa quais imagens foram buildadas de fato.

### `images-manifest.json`

Manifesto com `digest` esperado por imagem, usado como referencia preferencial no servidor.

## Semantica de `built_images`

| Valor | Significado |
| --- | --- |
| lista CSV | houve build seletivo dessas imagens |
| `__NONE__` | a release foi 100 por cento retag |
| vazio | deploy manual, sem contexto de release |

## Prioridade de decisao

1. Se existir manifesto valido no servidor, comparar digest local versus digest esperado.
2. Se nao houver manifesto, usar a logica legada baseada em `built_images`.
3. Imagens externas ao GHCR fazem `pull` direto.

## Comportamento com manifesto

| Situacao | Acao |
| --- | --- |
| tag local com digest esperado | `skip` |
| outra tag local do mesmo repo com digest esperado | `retag local` |
| digest local ausente ou diferente | `pull` |

## Comportamento sem manifesto

### Caso `built_images="__NONE__"`

- o deploy entende que a release so retaggeou imagens
- tenta `retag local`
- se nao encontrar imagem local, falha em modo seguro e orienta uso de deploy manual com `built_images` vazio

### Caso `built_images="svc1,svc2"`

- imagens listadas fazem `pull`
- imagens nao listadas tentam `retag local`

### Caso `built_images=""`

- deploy manual
- o workflow faz `pull` conservador

## Selective pull no prepare

Antes dos deploys por stack, o workflow:

- ignora verificacao remota quando `built_images="__NONE__"`
- verifica no GHCR apenas as imagens efetivamente buildadas
- evita manifest inspect desnecessario para imagens apenas retaggeadas

## Relacao com retag e build inteligente

- O `Release` decide `build` versus `retag` por imagem com base em diff e integridade do release anterior.
- O `Deploy` nao reavalia o diff de codigo.
- O `Deploy` so decide como obter o artefato correto no servidor.

## Falhas e resposta esperada

| Falha | Resposta |
| --- | --- |
| credencial GHCR invalida | fail-fast |
| release 100 por cento retag sem imagem local | fail-fast, usar deploy manual se for preciso forcar pull |
| manifesto ausente | fallback para `built_images` |
| imagem externa | `pull` com retry |

## Referencias

- [docs/engineering/pipeline-overview.md](pipeline-overview.md)
- [docs/operations/release.md](../operations/release.md)
- [docs/operations/deploy.md](../operations/deploy.md)
