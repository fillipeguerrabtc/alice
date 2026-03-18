# Servidores Operacionais e Acesso SSH

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026
**Status:** ativo
**Tipo:** ssot

## Objetivo

Ser o SSOT do inventario de servidores operacionais da Alice e das indicacoes corretas de acesso SSH para os ambientes de `Deploy` e `Producao`.

## Regras de leitura

- Este documento e a referencia canonica para identificar qual servidor e qual antes de qualquer acesso remoto.
- `Deploy Server` e `Production Server` sao ambientes distintos e nao devem ser confundidos.
- Em caso de divergencia com material historico em `docs/archive/`, prevalece este documento.

## Inventario oficial

| Servidor | Papel | Host / IP publico | Usuario SSH | Runner self-hosted | GPU |
| --- | --- | --- | --- | --- | --- |
| `Deploy Server` | hospeda o runner self-hosted, execucao de CI/Release/Deploy e observabilidade do host de deploy | `46.224.46.93` | `root` | sim | nao |
| `Production Server` | hospeda as stacks `INFRA`, `ALICE`, `OBSERVABILITY` e `BACKUP` em producao | `178.63.41.108` | `root` | nao | sim |

## Acesso SSH

### Chave

- A mesma chave e usada para acessar os dois servidores.
- O material da chave fica na pasta local `C:\Users\filli\.ssh`.
- O alias operacional da chave e `alice-deploy`.

### Usuario

- O usuario de acesso SSH e `root` em ambos os servidores.

### Comandos de referencia

```bash
ssh -i C:/Users/filli/.ssh/alice-deploy root@46.224.46.93
ssh -i C:/Users/filli/.ssh/alice-deploy root@178.63.41.108
```

## Guardrails operacionais

- Antes de investigar runner, caches, releases ou conectividade do GitHub Actions, usar o `Deploy Server`.
- Antes de investigar containers de producao, GPU, stacks, `.env.prod` ou health checks de servicos, usar o `Production Server`.
- O secret `HETZNER_VM_HOST` da pipeline aponta para o `Production Server`, nao para o `Deploy Server`.
- O `Deploy Server` pode expor observabilidade propria para scrape pelo `Production Server`, mas nao substitui o host de producao.

## Relacao com outros SSOTs

- `docs/operations/deploy.md` documenta o fluxo de deploy em producao.
- `docs/operations/deployment.md` documenta a separacao entre `CI`, `Release` e `Deploy`.
- `docs/operations/secrets.md` documenta os secrets usados pela pipeline.
- `AGENTS.md` e `CLAUDE.md` devem apontar explicitamente para este arquivo quando o assunto envolver acesso SSH ou identificacao dos servidores.

## Referencias

- [docs/operations/deploy.md](deploy.md)
- [docs/operations/deployment.md](deployment.md)
- [docs/operations/secrets.md](secrets.md)
- [docs/operations/observability.md](observability.md)
