# Relatorio de Correcao - Training Queue e Namespace

**Autor:** Fillipe Guerra  
**Data:** 06 de Marco de 2026

## Escopo
- Corrigir causa raiz real de falha no start do `gpu-trainer` em producao.
- Permitir ajuste de namespace no dataset antes e depois da aprovacao.

## Evidencia de producao (somente investigacao)
- Container `alice-gpu-manager` registrou:
  - tentativa principal com `--env-file /opt/alice/compose/.env.prod` falhando por `permission denied`;
  - fallback sem `--env-file` tambem falhando por leitura de `.env.prod`.
- Causa complementar confirmada:
  - o parse de `docker-compose.alice.yml` continua exigindo `../.env.prod` por entradas `env_file` de outros servicos.

## Causas raiz
1. Permissao de leitura negada no `.env.prod` para o usuario do container `gpu-manager`.
2. Fallback anterior removia `--env-file`, mas ainda usava `docker-compose.alice.yml`, que continuava exigindo `.env.prod` durante o parse.

## Correcoes aplicadas no codigo local
1. `apps/gpu-manager-service/src/gpu-orchestrator.ts`
- Mantida tentativa principal (compose completo com `--env-file`).
- Mantido fallback intermediario (compose completo sem `--env-file`).
- Adicionado fallback final para compose dedicado de treino (`training_only`) quando o erro de permissao no `.env.prod` persiste.

2. `infra/docker/stacks/docker-compose.gpu-training.yml`
- Novo compose minimo com apenas `gpu-trainer` (sem `env_file`), usado somente no fallback tecnico do orquestrador.

3. `tests/unit/gpu-orchestrator-compose-fallback.test.ts`
- Novo teste cobrindo o fluxo de 3 tentativas (principal -> fallback sem env-file -> fallback compose dedicado).

4. `apps/frontend-service/src/pages/Training.tsx`
- Acao de alterar namespace habilitada para `pending` e `approved`.
- Override de escopo na aprovacao alterado para `Select` de namespace (sem UUID manual).

## Resultado esperado
- Job deixa de ficar bloqueado por erro de permissao do `.env.prod` quando houver necessidade de start on-demand do `gpu-trainer`.
- Curadoria de datasets fica operacionalmente mais segura para realocar namespace antes e depois da aprovacao.
