# Deploy em Producao

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026

## Objetivo

Documentar o fluxo real de `Deploy` em producao, incluindo preflight, smart deploy, smart pull, health checks e rollback por stack.

## Workflow oficial

- Arquivo: [`.github/workflows/deploy-stack-modular.yml`](../../.github/workflows/deploy-stack-modular.yml)
- Nome do workflow: `Deploy - Production (Modular)`

## Inputs operacionais

| Input | Papel |
| --- | --- |
| `stack` | seleciona `all`, `infra`, `alice`, `observability` ou `backup` |
| `version` | tag a implantar |
| `rollback` / `rollback_version` | executa rollback cirurgico |
| `cleanup_server` | limpeza completa para primeiro deploy ou recuperacao controlada |
| `dry_run` | validacao sem aplicar mudancas |
| `smart_deploy` | pula stacks saudaveis quando o alvo for `all` |
| `built_images` | contexto vindo da `Release` para smart pull |
| `pgbackrest_allow_stanza_reset` | guarda de excecao para recuperacao de backup |

## Fases do workflow

### 1. Validacao

- Resolve o contexto do disparo.
- Determina quais stacks serao considerados.
- Coleta o estado de stacks no servidor quando `smart_deploy=true`.

### 2. Prepare

- Login no GHCR.
- Gera `.env.prod` a partir de versoes e secrets.
- Verifica imagens remotas apenas quando isso e necessario.
- Transfere scripts, compose files e manifesto para o servidor.
- Restringe permissoes de `.env.prod`.
- Valida o host de producao antes de qualquer `compose up`.

### 3. Deploy por stack

Cada stack tem jobs separados de:

- deploy
- health
- rollback

`INFRA` entra primeiro. O `drizzle-push` roda entre `INFRA` e os stacks dependentes, apenas quando houver mudanca real de schema. Os demais stacks seguem os guards declarados no workflow, sem reabrir o gate de qualidade do `CI`.

## Smart deploy versus smart pull

### Smart deploy

- Decide se um stack selecionado precisa ser redeployado com base no estado do servidor.
- Quando `smart_deploy=true` e `stack=all`, stacks `healthy` podem ser pulados.
- Quando `stack=X`, o workflow forca a operacao daquele stack mesmo que ele esteja saudavel.

### Smart pull

- Ocorre dentro dos jobs de deploy de stack.
- Usa `built_images` e, preferencialmente, `images-manifest.json`.
- Distingue `skip`, `retag local` e `pull` por imagem antes do `docker compose up`.

## Ordem logica do deploy

1. Validar inputs e contexto.
2. Preparar servidor e artefatos.
3. Implantar `INFRA`.
4. Executar `drizzle-push` quando houver diff de schema.
5. Implantar os stacks selecionados restantes.
6. Rodar health checks por stack.
7. Executar rollback apenas no stack que falhou.

## SSH remoto

- A action local [`.github/actions/hetzner-ssh`](../../.github/actions/hetzner-ssh/action.yml) centraliza boa parte da execucao remota.
- A centralizacao ainda e parcial.
- Transferencias com `scp`, copia de scripts, captura de resultados intermediarios e alguns passos de bootstrap continuam usando `ssh`/`scp` diretos.

## Preflight e fail-fast

Antes do `compose up`, o workflow aplica:

- geracao fail-fast de `.env.prod`
- verificacao de credenciais de registry
- `preflight-secrets.sh` por stack
- `docker compose ... config`
- validacao do host de producao

## Rollback

- O rollback e modular e por stack.
- Falha em `health` nao deve causar reversao indiscriminada de stacks saudaveis.
- Primeiro deploy sem versao anterior pode cair em modo de cleanup conforme o caso de uso declarado no workflow.

## Relacao com a Release

- O deploy normal de producao parte de uma `Release` aprovada.
- A `Release` passa `version` e `built_images`.
- Quando o manifesto existe, ele passa a ser a referencia preferencial para smart pull por digest.
- Deploy manual com `built_images` vazio continua suportado como caminho de recuperacao ou operacao assistida.

## Referencias

- [docs/operations/deployment.md](deployment.md)
- [docs/operations/release.md](release.md)
- [docs/engineering/pull-inteligente-flow.md](../engineering/pull-inteligente-flow.md)
- [docs/operations/secrets.md](secrets.md)
- [docs/operations/permissions.md](permissions.md)
- [docs/operations/runbooks/INDEX.md](runbooks/INDEX.md)
