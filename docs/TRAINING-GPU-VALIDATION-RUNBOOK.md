# Runbook de Validação Training GPU

**Autor:** Fillipe Guerra  
**Data:** 06 de Março de 2026  
**Escopo:** validação enterprise de fine-tuning real em GPU

## Objetivo
- Comprovar que o pipeline de treino executa com GPU real (sem mocks).
- Validar fila, orquestrador e execução on-demand por tenant/namespace.

## Pré-requisitos
- `training-service` e `gpu-manager` operacionais.
- Token com permissões:
  - `training:fine_tuning_jobs:read`
  - `training:training_data:manage`
- `tenantId` válido para o ambiente alvo.

## Execução (somente validação)
```bash
bash infra/scripts/validate-gpu-fine-tuning.sh \
  --base-url https://yesyoudeserve.duckdns.org \
  --auth-token "$ADMIN_BEARER_TOKEN" \
  --tenant-id "<tenant-uuid>"
```

## Execução (com disparo on-demand)
```bash
bash infra/scripts/validate-gpu-fine-tuning.sh \
  --base-url https://yesyoudeserve.duckdns.org \
  --auth-token "$ADMIN_BEARER_TOKEN" \
  --tenant-id "<tenant-uuid>" \
  --namespace-id "<namespace-uuid>" \
  --trigger-run
```

## Evidências mínimas
- `01-health.json`
- `02-queue-status.json`
- `03-gpu-orchestrator-state.json`
- `04-run-status.json`
- `05-run-start.json` (quando `--trigger-run`)

## Critério de sucesso
- Health do training OK.
- Fila e orchestrator retornam status válido.
- Run on-demand é aceito e enfileirado com idempotência.

## Incidente conhecido (06/03/2026)
- **Sintoma observado:** run permanece "na fila" e não evolui para `preparing/training`.
- **Causa raiz real:** `gpu-manager` falha no `docker compose` ao usar `--env-file /opt/alice/compose/.env.prod` com erro de permissão (`permission denied`) no ambiente de produção.
- **Causa raiz complementar identificada em produção (16:21 UTC):** mesmo sem `--env-file`, o `docker compose` ainda parseava `docker-compose.alice.yml` e tentava ler `../.env.prod` por causa de entradas `env_file` de outros serviços do stack.
- **Correção aplicada no código (versão atual):**
  - tentativa 1: compose padrão com `docker-compose.alice.yml` + `--env-file`;
  - tentativa 2: compose padrão sem `--env-file`;
  - tentativa 3 (somente se persistir erro de permissão no `.env.prod`): compose dedicado `docker-compose.gpu-training.yml` (apenas `gpu-trainer`, sem `env_file`), reutilizando variáveis já carregadas no processo.
  - para erros não relacionados à permissão, falha imediata (sem fallback indevido).

## Incidente conhecido (12/03/2026)
- **Autor:** Fillipe Guerra
- **Sintoma observado:** cockpit de runtime em `/training` alternando carregamento/erro e banner crítico de inferência interrompida sem treinamento ativo.
- **Causa raiz real:** serviço `alice-gpu-manager` sem `DATABASE_URL` no stack `docker-compose.alice.yml`, causando `500` em `GET /api/gpu/orchestrator/state`.
- **Evidência operacional (produção):**
  - `docker exec alice-training ... GET http://alice-gpu-manager:3010/api/gpu/orchestrator/state` retornando `status=500`.
  - `docker logs alice-gpu-manager` com `Falha ao persistir snapshot/evento de runtime GPU` no startup.
- **Correção aplicada no código:**
  - stack ALICE: inclusão explícita de `DATABASE_URL` no serviço `gpu-manager` (mesmo padrão dos demais serviços backend).
  - frontend training cockpit: estado de inferência tratado como `available | unavailable | unknown`, evitando banner de interrupção de treino quando o estado do orquestrador está indisponível.
  - endpoint de estado no `gpu-manager`: hardening para não derrubar resposta operacional quando a leitura do estado durável falhar; retorno mantém FSM em memória e registra erro detalhado com stack.
