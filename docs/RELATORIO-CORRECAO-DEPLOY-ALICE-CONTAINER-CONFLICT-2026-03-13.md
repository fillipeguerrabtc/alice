# Relatorio de Correcao - Falha de Deploy ALICE por Conflito de Container

**Author:** Fillipe Guerra  
**Data:** 13 de Marco de 2026

## Resumo
Foi aplicada uma correcao cirurgica no workflow de deploy da stack ALICE para prevenir falhas de `docker compose up` causadas por conflito de `container_name` em containers com nome fixo, especialmente `alice-frontend`.

## Causa Raiz
O deploy normal da stack ALICE executava `docker compose up -d --remove-orphans` diretamente. Quando existia um container com nome fixo em estado divergente do esperado, o Docker recusava o recreate com erro de conflito de nome.

O rollback da stack ALICE ja possuia limpeza forcada de containers nomeados, o que explicava o comportamento observado em producao:

1. O deploy falhava no `compose up`.
2. O rollback automatico limpava os containers conflitantes.
3. Uma nova execucao manual podia funcionar porque o estado sujo ja havia sido removido.

## Evidencias
No incidente de producao em 13/03/2026, o erro bloqueador registrado foi:

```text
The container name "/alice-frontend" is already in use
```

Os erros de Redis, PostgreSQL e Wise observados no mesmo intervalo foram consequencias do restart parcial apos a falha do `compose up`, nao a causa raiz do bloqueio do job.

## Correcao Aplicada
Arquivo alterado:

- `.github/workflows/deploy-stack-modular.yml`

Antes do `docker compose up`, o workflow agora:

1. Inspeciona apenas os containers nomeados da stack ALICE.
2. Preserva containers que ja estejam consistentes com:
   - projeto `alice-alice`
   - `service` correspondente ao nome esperado
   - estado `running=true`
3. Remove somente containers conflitantes, incluindo casos de:
   - container fora do projeto correto
   - `service` divergente
   - container parado/stale mantendo o nome reservado

## Motivo da Abordagem
Essa estrategia segue o padrao ja existente no rollback e evita uma parada ampla desnecessaria da stack. A mudanca e preventiva, focada na causa raiz, e nao altera gatilhos ou triggers de workflow.

## Impacto Esperado
- Evitar recorrencia da falha de deploy por conflito de `container_name`.
- Manter o deploy normal resiliente a estado sujo residual no Docker.
- Preservar containers validos e em execucao quando nao houver conflito real.
